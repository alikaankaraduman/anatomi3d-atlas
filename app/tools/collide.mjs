// Carpisma olcumu: secilen parcalarin, ayni bedende (erkek ya da kadin) gorunen diger parcalarla ic ice gecmesi.
// Kullanim: node tools/collide.mjs --sex f --parts "Vagina,Vaginal fornix" [--margin 0.05] [--top 12] [--union] [--json out.json]
//   --parts : Ingilizce ad ya da parca kimligi listesi (virgulle); ad tum taraflari kapsar
//   --union : hedef parcalar birlikte kapali bir kabuk olusturuyorsa (ornegin bir govdeden kesilmis acik parcalar:
//             klitoris, bulbuslar) diger parcalarin bu kabugun icine girmesi de olculur; tek tek acik parcalarda bu
//             yon olculemez
// Kapali ag (tek yuzlu cizilen) B icin: A'nin koseleri B'nin icinde mi (iki yonde isin paritesi, ikisi de tek sayi);
// icteki noktalarin B yuzeyine uzakligi derinliktir. Acik yuzey B icin: A koselerinden B yuzeyine `margin` cm'den
// yakin olanlar "temas" sayilir. A kapaliysa ters yon de (B'nin koseleri A'nin icinde) olculur.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import fs from 'node:fs';
import { loadScene, label, bounds } from './scene.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const sex = arg('sex', 'f'), margin = +arg('margin', 0.05), top = +arg('top', 12);
const want = arg('parts', '').split(',').map(s => s.trim()).filter(Boolean);
if (!want.length) throw new Error('--parts gerekli');

const { parts } = await loadScene({ keep: it => !it.x || it.x === sex });
const targets = parts.filter(p => want.includes(p.n) || want.includes(p.id));
if (!targets.length) throw new Error('parca bulunamadi: ' + want.join(', '));

const bvhOf = new Map();
const bvh = p => {
  let b = bvhOf.get(p.id);
  if (!b) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.P, 3)); g.setIndex(new THREE.BufferAttribute(p.I, 1)); b = new MeshBVH(g); bvhOf.set(p.id, b); }
  return b;
};
const box = new Map(parts.map(p => [p.id, bounds(p.P)]));
const overlap = (a, b, m) => [0, 1, 2].every(k => a.mn[k] - m <= b.mx[k] && b.mn[k] - m <= a.mx[k]);
const DIRS = [new THREE.Vector3(0.577, 0.611, 0.542).normalize(), new THREE.Vector3(-0.49, -0.62, 0.61).normalize()];
const ray = new THREE.Ray(), pt = new THREE.Vector3(), hit = {};
const inside = (b, x, y, z) => DIRS.every(d => { ray.set(pt.set(x, y, z), d); return b.raycast(ray, THREE.DoubleSide).length % 2 === 1; });
const sample = (P, max) => { const n = P.length / 3, step = Math.max(1, Math.ceil(n / max)), out = []; for (let i = 0; i < n; i += step) out.push(i); return out; };

// A'nin (orneklenmis) koselerinin B'ye gore durumu
function measure(A, B) {
  const bb = box.get(B.id), b = bvh(B), idx = sample(A.P, 4000); let n = 0, cnt = 0; const depth = [];
  for (const i of idx) {
    const x = A.P[i * 3], y = A.P[i * 3 + 1], z = A.P[i * 3 + 2];
    if (x < bb.mn[0] - margin || x > bb.mx[0] + margin || y < bb.mn[1] - margin || y > bb.mx[1] + margin || z < bb.mn[2] - margin || z > bb.mx[2] + margin) { n++; continue; }
    n++;
    if (!B.o) { if (inside(b, x, y, z)) { cnt++; b.closestPointToPoint(pt.set(x, y, z), hit); depth.push(hit.distance); } }
    else { const r = b.closestPointToPoint(pt.set(x, y, z), hit, 0, margin); if (r && hit.distance <= margin) cnt++; }
  }
  depth.sort((a, c) => a - c);
  return { share: cnt / n, cnt, n, max: depth.length ? depth[depth.length - 1] : 0, med: depth.length ? depth[depth.length >> 1] : 0 };
}

const report = [];
for (const A of targets) {
  const ab = box.get(A.id); const rows = [];
  for (const B of parts) {
    if (B.id === A.id || !overlap(ab, box.get(B.id), margin)) continue;
    const ab2 = measure(A, B); const ba = !A.o ? measure(B, A) : null;
    if (ab2.cnt || (ba && ba.cnt)) rows.push({ B: label(B), id: B.id, s: B.s, open: !!B.o, aInB: ab2, bInA: ba });
  }
  rows.sort((r1, r2) => Math.max(r2.aInB.share, r2.bInA?.share ?? 0) - Math.max(r1.aInB.share, r1.bInA?.share ?? 0));
  report.push({ A: label(A), id: A.id, open: !!A.o, rows });
  console.log(`\n# ${label(A)} (${A.id}, ${A.o ? 'acik' : 'kapali'}) sinir ${ab.mn.map(v => v.toFixed(1)).join(',')} .. ${ab.mx.map(v => v.toFixed(1)).join(',')}`);
  if (!rows.length) console.log('  carpisma yok');
  for (const r of rows.slice(0, top)) {
    const f = m => m ? `${(100 * m.share).toFixed(1)}% (${m.cnt}/${m.n})${m.max ? ` derinlik med ${m.med.toFixed(2)} max ${m.max.toFixed(2)} cm` : ''}` : '-';
    console.log(`  ${r.B.padEnd(46)} ${r.s.padEnd(6)} ${r.open ? 'acik  ' : 'kapali'}  A->B ${f(r.aInB)}  B->A ${f(r.bInA)}`);
  }
}
if (process.argv.includes('--union')) {
  // hedeflerin birlesimi: 0.003 cm icindeki koseler birlesir (her parca GLB'de kendi sinir kutusuna gore nicemlendigi
  // icin ortak sinir koseleri birkac mikron kayar), kapali mi (her kenar iki ucgende)?
  const P = [], I = [], cells = new Map(); const TOL = 0.003, C = TOL * 2;
  const find = (x, y, z) => {
    const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = cells.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (const j of a) if (Math.abs(P[j * 3] - x) <= TOL && Math.abs(P[j * 3 + 1] - y) <= TOL && Math.abs(P[j * 3 + 2] - z) <= TOL) return j;
    }
    const j = P.length / 3; P.push(x, y, z); const k = `${cx},${cy},${cz}`; (cells.get(k) || cells.set(k, []).get(k)).push(j); return j;
  };
  for (const A of targets) {
    const remap = new Uint32Array(A.P.length / 3);
    for (let i = 0; i < remap.length; i++) remap[i] = find(A.P[i * 3], A.P[i * 3 + 1], A.P[i * 3 + 2]);
    for (const i of A.I) I.push(remap[i]);
  }
  const E = new Map(); for (let k = 0; k < I.length; k += 3) for (let j = 0; j < 3; j++) { const a = I[k + j], b = I[k + (j + 1) % 3]; if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; E.set(e, (E.get(e) || 0) + 1); }
  let open = 0; for (const c of E.values()) if (c === 1) open++;
  const U = { id: '[union]', n: 'birlesik hedef', P: Float32Array.from(P), I: Uint32Array.from(I), o: open > 0 ? 1 : 0 };
  box.set(U.id, bounds(U.P));
  console.log(`\n# birlesik hedef (${targets.length} parca): acik kenar ${open}${open ? ' - kapali degil; icine girme olculemez, yalniz temas sayilir' : ' - kapali kabuk'}`);
  const rows = [];
  for (const B of parts) {
    if (targets.includes(B) || !overlap(box.get(U.id), box.get(B.id), margin)) continue;
    const m = measure(B, U); if (m.cnt) rows.push({ B: label(B), s: B.s, m });
  }
  rows.sort((r1, r2) => r2.m.share - r1.m.share);
  if (!rows.length) console.log('  hedefin icine giren parca yok');
  for (const r of rows.slice(0, top)) console.log(`  ${r.B.padEnd(46)} ${r.s.padEnd(6)} B->hedef ${(100 * r.m.share).toFixed(1)}% (${r.m.cnt}/${r.m.n})${r.m.max ? ` derinlik med ${r.m.med.toFixed(2)} max ${r.m.max.toFixed(2)} cm` : ''}`);
  report.push({ A: 'union', open, rows });
}
const out = arg('json'); if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
