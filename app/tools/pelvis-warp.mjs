// Kadin bedeninde pelvis eklemleri -> tools/pelvis-warp.json
// Kullanim: node tools/pelvis-warp.mjs   (once bones, femalepelvis ve joints donusturulmus olmali)
//
// Kadin bedeninde erkek kalca kemikleri, sakrum ve koksiks yerine HRA kadin pelvisi gosterilir. Bu kemiklere tutunan
// Z-Anatomy eklem parcalari (simfiz, sakrokoksigeal eklem, sakrospinal ve sakrotuberal baglar, L5-S1 diski ...) erkek
// kemiklerinin yerinde kalir; ornegin simfiz parcalari kadin pubisinin ~1.6 cm onunde durur. Bu arac erkek pelvisinden
// kadin pelvisine bir yer degistirme alani kurar ve hangi eklem parcalarinin kadin bedeninde tasinmis kopyayla
// gosterilecegini secer:
//  - Yer degistirme yerel oteleme ICP'siyle bulunur: erkek yuzeyinde secilen her capa noktasi icin, cevresindeki
//    (ANCHOR_R cm) erkek noktalarini ayni kemigin (ayni ad ve taraf) kadin karsiligina en iyi oturtan oteleme (en yakin
//    nokta eslesmesi, 15 tur). Tek tek en yakin nokta, yuzeyler teget yonde kaydiginda kaymayi eksik olcer (simfiz
//    bolgesinde ~1.6 cm yerine ~0.7 cm). Ornek noktalarinin yer degistirmesi capalarin Gauss agirlikli ortalamasidir.
//  - Alan (tools/femalejoints.mjs makeField): yakin orneklerin Gauss agirlikli ortalamasi x guven. Guven erkek pelvisine
//    uzaklikla duser ve pelvis disi ortak bir kemige (L5, femur ...) daha yakin koselerde azalir: bir disk ya da kapsulun
//    ortak kemige tutunan ucu yerinde kalir, pelvise tutunan ucu tasinir.
//  - Secilen parca: koselerinin yarisindan fazlasi erkek pelvisine 1 cm'den yakin, en az bir kosesi 0.2 cm'den fazla
//    tasiniyor ve tasinmis kopya kadin kemiklerine ortalamada en az 0.1 cm daha yakin. Bir tarafi secilen adin iki
//    tarafi da kopyalanir (sex.mjs ada gore gizler).
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene, bounds } from './scene.mjs';
import { makeField } from './femalejoints.mjs';

const SMOOTH = 1.0, SIGMA = 1.0, R0 = 1.0, R1 = 3.0, NSAMPLE = 6000, ANCHOR_R = 2.0, ANCHOR_EVERY = 8;
const { parts } = await loadScene({ files: ['bones', 'femalepelvis', 'joints'] });
const PELVIC = new Set(['Hip bone', 'Sacrum', 'Coccyx']);
const male = parts.filter(p => p.s === 'bone' && PELVIC.has(p.n) && p.x === 'm');
const female = parts.filter(p => p.s === 'bone' && PELVIC.has(p.n) && p.x === 'f');
const bvhOf = list => {
  let nP = 0, nI = 0; for (const p of list) { nP += p.P.length; nI += p.I.length; }
  const P = new Float32Array(nP), I = new Uint32Array(nI); let o = 0, oi = 0;
  for (const p of list) { P.set(p.P, o); for (let k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + o / 3; o += p.P.length; oi += p.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); return new MeshBVH(g);
};
const fem = new Map(female.map(p => [p.n + '|' + (p.sd || ''), bvhOf([p])]));
const femAll = bvhOf(female), maleAll = bvhOf(male);
const pb = bounds(Float32Array.from(male.flatMap(p => Array.from(p.P))));
const near = (b, m) => [0, 1, 2].every(k => b.mn[k] - m <= pb.mx[k] && pb.mn[k] - m <= b.mx[k]);
const others = parts.filter(p => p.s === 'bone' && !p.x && near(bounds(p.P), 2));
console.log(`erkek pelvis ${male.length} parca, kadin ${female.length}, yakindaki ortak kemik ${others.length}: ${[...new Set(others.map(p => p.n))].slice(0, 14).join(', ')}`);

const v = new THREE.Vector3(), hit = {};
// 1. ornekler: erkek yuzeyinde noktalar (kemik anahtariyla)
const total = male.reduce((s, p) => s + p.P.length / 3, 0), stride = Math.max(1, Math.floor(total / NSAMPLE));
const S = []; let ctr = 0;
for (const p of male) {
  const k = p.n + '|' + (p.sd || ''); if (!fem.get(k)) throw new Error('kadin karsiligi yok: ' + p.n + ' ' + p.sd);
  for (let i = 0; i < p.P.length; i += 3) { if (ctr++ % stride) continue; S.push([p.P[i], p.P[i + 1], p.P[i + 2], 0, 0, 0, k]); }
}
const C = 3 * SMOOTH, grid = new Map(); const key = (x, y, z) => `${Math.floor(x / C)},${Math.floor(y / C)},${Math.floor(z / C)}`;
S.forEach((s, i) => { const k = key(s[0], s[1], s[2]); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
// 2. capalarda yerel oteleme ICP'si; orneklere Gauss agirlikli ortalama (sigma SMOOTH)
const anchors = [];
for (let i = 0; i < S.length; i += ANCHOR_EVERY) {
  const a = S[i], fb = fem.get(a[6]); const nb = [];
  const cx = Math.floor(a[0] / C), cy = Math.floor(a[1] / C), cz = Math.floor(a[2] / C);
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const l = grid.get(`${cx + x},${cy + y},${cz + z}`); if (l) for (const j of l) { const t = S[j]; if (t[6] === a[6] && (t[0] - a[0]) ** 2 + (t[1] - a[1]) ** 2 + (t[2] - a[2]) ** 2 <= ANCHOR_R * ANCHOR_R) nb.push(t); } }
  const t = [0, 0, 0];
  for (let it = 0; it < 15; it++) {
    const s = [0, 0, 0];
    for (const q of nb) { v.set(q[0] + t[0], q[1] + t[1], q[2] + t[2]); fb.closestPointToPoint(v, hit); s[0] += hit.point.x - q[0]; s[1] += hit.point.y - q[1]; s[2] += hit.point.z - q[2]; }
    const nt = s.map(c => c / nb.length); const ch = Math.hypot(nt[0] - t[0], nt[1] - t[1], nt[2] - t[2]); t[0] = nt[0]; t[1] = nt[1]; t[2] = nt[2]; if (ch < 0.002) break;
  }
  anchors.push([a[0], a[1], a[2], t[0], t[1], t[2]]);
}
const ag = new Map(); anchors.forEach((s, i) => { const k = key(s[0], s[1], s[2]); (ag.get(k) || ag.set(k, []).get(k)).push(i); });
for (const s of S) {
  let w = 0, dx = 0, dy = 0, dz = 0; const cx = Math.floor(s[0] / C), cy = Math.floor(s[1] / C), cz = Math.floor(s[2] / C);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = ag.get(`${cx + a},${cy + b},${cz + c}`); if (l) for (const j of l) { const t = anchors[j]; const g = Math.exp(-((t[0] - s[0]) ** 2 + (t[1] - s[1]) ** 2 + (t[2] - s[2]) ** 2) / (2 * SMOOTH * SMOOTH)); w += g; dx += g * t[3]; dy += g * t[4]; dz += g * t[5]; } }
  s[3] = dx / w; s[4] = dy / w; s[5] = dz / w;
}
const D = S.map(s => s.slice(0, 6).map(c => +c.toFixed(3)));
console.log(`capa ${anchors.length}; en buyuk capa otelemesi ${Math.max(...anchors.map(a => Math.hypot(a[3], a[4], a[5]))).toFixed(2)} cm`);
// ortak kemik yuzey ornekleri (guven icin)
const totO = others.reduce((s, p) => s + p.P.length / 3, 0), strideO = Math.max(1, Math.floor(totO / 4000)); let co = 0; const O = [];
for (const p of others) for (let i = 0; i < p.P.length; i += 3) if (co++ % strideO === 0) O.push([p.P[i], p.P[i + 1], p.P[i + 2]].map(c => +c.toFixed(3)));
const J = { note: 'Kadin pelvisine uyarlanan eklem parcalari ve yer degistirme alani; tools/pelvis-warp.mjs', SIGMA, R0, R1, samples: D, others: O };
const F = makeField(J);

// 3. eklem parcalari: secim ve olcum (kadin kemiklerine ortalama uzaklik once / sonra)
const joints = parts.filter(p => p.s === 'joint' && !p.x);
const chosen = new Set(); const report = [];
const dist = (b, x, y, z) => { b.closestPointToPoint(v.set(x, y, z), hit); return hit.distance; };
for (const p of joints) {
  if (!near(bounds(p.P), 1)) continue;
  const n = p.P.length / 3, step = Math.max(1, Math.floor(n / 600)); let close = 0, cnt = 0, before = 0, after = 0, maxMove = 0;
  for (let i = 0; i < n; i += step) {
    const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2]; cnt++;
    if (dist(maleAll, x, y, z) < 1) close++;
    before += dist(femAll, x, y, z);
    const d = F(x, y, z); maxMove = Math.max(maxMove, Math.hypot(...d));
    after += dist(femAll, x + d[0], y + d[1], z + d[2]);
  }
  before /= cnt; after /= cnt;
  if (close / cnt <= 0.5) continue;
  const ok = maxMove > 0.2 && before - after >= 0.1;
  report.push({ part: p.n + (p.sd ? '.' + p.sd : ''), attached: +(close / cnt).toFixed(2), before: +before.toFixed(2), after: +after.toFixed(2), maxMove: +maxMove.toFixed(2), chosen: ok });
  if (ok) chosen.add(p.n);
}
report.sort((a, b) => (b.before - b.after) - (a.before - a.after));
for (const r of report) console.log(`${r.chosen ? '*' : ' '} ${r.part.padEnd(52)} tutunma ${r.attached}  kadin kemige ort. uzaklik ${r.before} -> ${r.after} cm  en cok kayma ${r.maxMove}`);
J.parts = [...chosen].sort(); J.report = report;
fs.writeFileSync(new URL('./pelvis-warp.json', import.meta.url), JSON.stringify(J));
console.log(`secilen ad ${chosen.size}: ${J.parts.join(' | ')}\n-> tools/pelvis-warp.json (${D.length} ornek, ${O.length} ortak kemik noktasi)`);
