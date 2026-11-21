// Beyin kabugu parcalarinin (Destrieux parselleri) geometrik ozeti: konum, yuzey yonu, oluk derinligi, sinir komsulari.
// Adlandirma denetimi icin: her parcanin adi, kabuk yuzeyindeki yeri ve komsulari Destrieux atlasiyla karsilastirilabilir.
// Kullanim: node tools/cortex-map.mjs   ->  data/work/cortex/cortex_map.json, cortex_points.json
// Eksenler (dunya, cm): x+ = sol yan (sol yarimkurede buyuk x = daha lateral), y+ = yukari, z+ = on.
import fs from 'node:fs';
import { loadFBX, THREE } from './fbxnode.mjs';
import { extract, isLabelLine, origName } from './geom.mjs';

const LOBES = new Set(['Frontal lobe', 'Parietal lobe', 'Temporal lobe', 'Occipital lobe', 'Limbic lobe', 'Insula', 'Interlobar sulci']);
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const byId = new Map(meta.items.map(o => [o.id, o]));
const pathOf = gi => { const p = []; for (let i = gi; i >= 0; i = meta.groups[i].p) p.unshift(meta.groups[i].n); return p; };

const t0 = Date.now();
const root = loadFBX('../data/zanatomy/NervousSystem100.fbx');
console.log(`FBX okundu ${(Date.now() - t0) / 1000 | 0}s`);
// convert.mjs ile ayni kimlik: ozgun ada gore sirali gercek mesh listesindeki sira
const reals = []; root.traverse(o => { if (o.isMesh && o.geometry.attributes.position.count > 0 && !isLabelLine(origName(o))) reals.push(o); });
reals.sort((a, b) => origName(a).localeCompare(origName(b)));

const parts = [];
for (let i = 0; i < reals.length; i++) {
  const it = byId.get('n' + i); if (!it || it.g < 0) continue;
  const path = pathOf(it.g); const lobe = path.find(p => LOBES.has(p)); if (!lobe) continue;
  const o = reals[i];
  const e = extract(o);
  const mats = [...new Set((Array.isArray(o.material) ? o.material : [o.material]).map(m => m.name))];
  parts.push({ id: it.id, sd: it.sd || '', raw: origName(o), n: it.n, la: it.la || '', de: it.de || '', tr: it.tr || '', lobe, group: path[path.length - 1], mats, P: e.P, idx: e.idx });
}
console.log(`kabuk parcasi: ${parts.length} (sol ${parts.filter(p => p.sd === 'l').length}, sag ${parts.filter(p => p.sd === 'r').length}, tek ${parts.filter(p => !p.sd).length})`);

const left = parts.filter(p => p.sd === 'l');
// yarimkure merkezi ve sinirlari
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0], cnt = 0;
for (const p of left) for (let k = 0; k < p.P.length; k += 3) for (let a = 0; a < 3; a++) { const v = p.P[k + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; sum[a] += v; if (a === 0) cnt++; }
const C = sum.map(s => s / cnt);
const center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];

// dis zarf: merkezden bakilan her yondeki en uzak kose (kure izgarasi); bir kosenin derinligi = zarf yaricapi - kendi yaricapi
const NT = 96, NP = 48;
const binOf = (x, y, z) => { const r = Math.hypot(x, y, z) || 1; const th = Math.atan2(z, x); const ph = Math.acos(Math.max(-1, Math.min(1, y / r))); return [Math.min(NT - 1, Math.floor((th + Math.PI) / (2 * Math.PI) * NT)), Math.min(NP - 1, Math.floor(ph / Math.PI * NP)), r]; };
const env = new Float32Array(NT * NP);
for (const p of left) for (let k = 0; k < p.P.length; k += 3) { const [t, f, r] = binOf(p.P[k] - center[0], p.P[k + 1] - center[1], p.P[k + 2] - center[2]); if (r > env[t * NP + f]) env[t * NP + f] = r; }
const envAt = (t, f) => { let m = env[t * NP + f]; for (let dt = -1; dt <= 1; dt++) for (let df = -1; df <= 1; df++) { const tt = (t + dt + NT) % NT, ff = f + df; if (ff >= 0 && ff < NP) m = Math.max(m, env[tt * NP + ff]); } return m; };

// kenar uzunlugu -> komsuluk esigi
const edges = [];
for (const p of left) for (let k = 0; k < Math.min(p.idx.length, 3000); k += 3) { const a = p.idx[k] * 3, b = p.idx[k + 1] * 3; edges.push(Math.hypot(p.P[a] - p.P[b], p.P[a + 1] - p.P[b + 1], p.P[a + 2] - p.P[b + 2])); }
edges.sort((a, b) => a - b); const medEdge = edges[edges.length >> 1]; const EPS = Math.max(0.05, 1.5 * medEdge);
console.log(`ortanca kenar ${medEdge.toFixed(3)} cm, komsuluk esigi ${EPS.toFixed(3)} cm`);

// uzamsal kafes: her kose hangi parcaya ait
const cell = EPS; const grid = new Map();
const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
left.forEach((p, pi) => { for (let k = 0; k < p.P.length; k += 3) { const kk = key(p.P[k], p.P[k + 1], p.P[k + 2]); let a = grid.get(kk); if (!a) grid.set(kk, a = []); a.push(pi, k); } });

const r3 = v => Math.round(v * 1000) / 1000;
const out = [];
left.forEach((p, pi) => {
  const P = p.P, I = p.idx; const nv = P.length / 3;
  // alan ve alan agirlikli merkez
  let area = 0; const cen = [0, 0, 0];
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; area += ar;
    for (let d = 0; d < 3; d++) cen[d] += ar * (P[a + d] + P[b + d] + P[c + d]) / 3;
  }
  for (let d = 0; d < 3; d++) cen[d] /= area || 1;
  // en kucuk ozdeger yonu (yama duzleminin normali), yarimkure merkezinden disa bakacak isaretle
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < P.length; k += 3) { const d = [P[k] - cen[0], P[k + 1] - cen[1], P[k + 2] - cen[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j]; }
  const m3 = new THREE.Matrix3().set(...cov[0], ...cov[1], ...cov[2]);
  // ters yineleme ile en kucuk ozvektor
  let vec = new THREE.Vector3(1, 0.3, 0.2).normalize();
  const inv = m3.clone(); const det = inv.determinant();
  let normal = new THREE.Vector3(0, 0, 0), flat = 0;
  if (Math.abs(det) > 1e-12) { inv.invert(); for (let it = 0; it < 60; it++) vec.applyMatrix3(inv).normalize(); normal.copy(vec); }
  const out3 = new THREE.Vector3(cen[0] - center[0], cen[1] - center[1], cen[2] - center[2]);
  if (normal.dot(out3) < 0) normal.negate();
  // duzlemsellik: en kucuk ozdeger / iz
  const tr = cov[0][0] + cov[1][1] + cov[2][2];
  const tmp = new THREE.Vector3().copy(normal).applyMatrix3(m3); flat = tr ? tmp.dot(normal) / tr : 0;
  // derinlik
  const depths = new Float32Array(nv);
  for (let v = 0; v < nv; v++) { const [t, f, r] = binOf(P[v * 3] - center[0], P[v * 3 + 1] - center[1], P[v * 3 + 2] - center[2]); depths[v] = Math.max(0, envAt(t, f) - r); }
  const ds = Array.from(depths).sort((a, b) => a - b);
  // komsular: bu parcanin kac kosesi baska bir parcanin bir kosesine EPS'ten yakin
  const touch = new Map(); const e2 = EPS * EPS;
  for (let k = 0; k < P.length; k += 3) {
    const x = P[k], y = P[k + 1], z = P[k + 2]; const fx = Math.floor(x / cell), fy = Math.floor(y / cell), fz = Math.floor(z / cell);
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(`${fx + dx},${fy + dy},${fz + dz}`); if (!a) continue;
      for (let q = 0; q < a.length; q += 2) {
        const qi = a[q]; if (qi === pi || seen.has(qi)) continue;
        const Q = left[qi].P, qk = a[q + 1];
        const ddx = Q[qk] - x, ddy = Q[qk + 1] - y, ddz = Q[qk + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= e2) seen.add(qi);
      }
    }
    for (const qi of seen) touch.set(qi, (touch.get(qi) || 0) + 1);
  }
  const neighbors = [...touch].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([qi, c]) => ({ n: left[qi].n, verts: c, frac: r3(c / nv) }));
  const norm = d => r3((cen[d] - mn[d]) / (mx[d] - mn[d]));
  const axis = ['lateral(+x)', 'medial(-x)', 'superior(+y)', 'inferior(-y)', 'anterior(+z)', 'posterior(-z)'];
  const comps = [normal.x, -normal.x, normal.y, -normal.y, normal.z, -normal.z];
  const facing = axis[comps.indexOf(Math.max(...comps))];
  out.push({
    id: p.id, raw: p.raw, n: p.n, la: p.la, de: p.de, tr: p.tr, lobe: p.lobe, group: p.group, mats: p.mats,
    verts: nv, areaCm2: r3(area), centroid: cen.map(r3),
    rel: { x_medialToLateral: norm(0), y_bottomToTop: norm(1), z_posteriorToAnterior: norm(2) },
    bbox: { min: [0, 1, 2].map(d => r3(Math.min(...Array.from({ length: nv }, (_, v) => P[v * 3 + d])))), max: [0, 1, 2].map(d => r3(Math.max(...Array.from({ length: nv }, (_, v) => P[v * 3 + d])))) },
    facing, normal: [normal.x, normal.y, normal.z].map(r3), planarity: r3(flat),
    depthCm: { median: r3(ds[ds.length >> 1]), p90: r3(ds[Math.floor(ds.length * 0.9)]), max: r3(ds[ds.length - 1]) },
    neighbors,
  });
});

out.sort((a, b) => a.lobe.localeCompare(b.lobe) || a.n.localeCompare(b.n));
fs.mkdirSync('../data/work/cortex', { recursive: true });
const hemi = { min: mn.map(r3), max: mx.map(r3), center: center.map(r3), vertexMean: C.map(r3), adjacencyEpsCm: r3(EPS) };
const rightIds = Object.fromEntries(left.map(p => [p.n, parts.filter(q => q.sd === 'r' && q.n === p.n).map(q => q.id)]));
fs.writeFileSync('../data/work/cortex/cortex_map.json', JSON.stringify({ axes: 'world cm: x+ = left lateral, y+ = up, z+ = anterior; left hemisphere only', hemisphere: hemi, parts: out, unpaired: parts.filter(p => !p.sd).map(p => p.n), rightIds }, null, 1));
// her parcadan seyreltilmis nokta bulutu (ek olcumler icin)
const pts = {};
for (const p of left) { const nv = p.P.length / 3; const step = Math.max(1, Math.floor(nv / 200)); const a = []; for (let v = 0; v < nv; v += step) a.push(r3(p.P[v * 3]), r3(p.P[v * 3 + 1]), r3(p.P[v * 3 + 2])); pts[p.n] = a; }
fs.writeFileSync('../data/work/cortex/cortex_points.json', JSON.stringify(pts));
console.log(`yazildi: data/work/cortex/cortex_map.json (${out.length} parca), cortex_points.json`);
