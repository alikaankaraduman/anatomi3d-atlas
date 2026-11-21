// HRA (HuBMAP CCF) kadin pelvisini modelin (BodyParts3D, erkek) pelvisine hizalar ve donusumu kaydeder.
// Ayni donusum kadin organlarini (uterus, tubalar, overler) modelin leğenine yerlestirir.
// Yontem: benzerlik donusumu (donme + tek olcek + oteleme), yinelemeli en yakin nokta (ICP) ile; baslangic: HRA
// eksenleri modelle ayni (x+ sol, y+ yukari, z+ on), birim metre -> cm (x100), agirlik merkezleri ust uste.
// Kullanim: node tools/hra-register.mjs   ->  tools/hra-registration.json (tools/hra.mjs bunu kullanir)
import fs from 'node:fs';
import { loadFBX } from './fbxnode.mjs';
import { extract, isLabelLine, origName } from './geom.mjs';
import { readGLBMeshes } from './glb.mjs';

const HRA = '../data/hra';
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const idsOf = names => meta.items.filter(o => o.s === 'bone' && names.includes(o.n)).map(o => o.id);

// --- hedef: modelin pelvisi (cm) ---
const root = loadFBX('../data/zanatomy/SkeletalSystem100.fbx');
const reals = []; root.traverse(o => { if (o.isMesh && o.geometry.attributes.position.count > 0 && !isLabelLine(origName(o)) && !/\.[oe]\d*[rl]?$/.test(origName(o))) reals.push(o); });
reals.sort((a, b) => origName(a).localeCompare(origName(b)));
const byId = new Map(reals.map((o, i) => ['b' + i, o]));
const meshPts = id => { const e = extract(byId.get(id)); return e.P; };
const pelvisIds = idsOf(['Hip bone', 'Sacrum', 'Coccyx']);
const femurIds = idsOf(['Femur']);
console.log('model pelvisi:', pelvisIds.map(id => `${id} ${meta.items.find(o => o.id === id).n}${meta.items.find(o => o.id === id).sd ? '.' + meta.items.find(o => o.id === id).sd : ''}`).join(', '));
const concat = arrs => { const n = arrs.reduce((a, b) => a + b.length, 0); const out = new Float32Array(n); let k = 0; for (const a of arrs) { out.set(a, k); k += a.length; } return out; };
const T = concat(pelvisIds.map(meshPts));

// --- kaynak: HRA kadin pelvisi (m), yalniz dis (kompakt) kemik yuzeyi + sakrum + koksiks ---
const pel = readGLBMeshes(`${HRA}/VH_F_Pelvis.glb`).filter(m => !/spongy/i.test(m.name));
console.log('HRA pelvisi:', pel.map(m => m.name).join(', '));
const S = concat(pel.map(m => m.P));

// --- yardimcilar ---
const N = a => a.length / 3;
function centroid(P) { let x = 0, y = 0, z = 0; for (let i = 0; i < P.length; i += 3) { x += P[i]; y += P[i + 1]; z += P[i + 2]; } const n = N(P); return [x / n, y / n, z / n]; }
function grid(P, cell) {
  const g = new Map(); const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < P.length; i += 3) { const k = key(P[i], P[i + 1], P[i + 2]); let a = g.get(k); if (!a) g.set(k, a = []); a.push(i); }
  return { nearest(x, y, z, maxR = 4) {
    const fx = Math.floor(x / cell), fy = Math.floor(y / cell), fz = Math.floor(z / cell); let best = Infinity, bi = -1;
    for (let r = 0; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const a = g.get(`${fx + dx},${fy + dy},${fz + dz}`); if (!a) continue;
        for (const i of a) { const d = (P[i] - x) ** 2 + (P[i + 1] - y) ** 2 + (P[i + 2] - z) ** 2; if (d < best) { best = d; bi = i; } }
      }
      if (bi >= 0 && Math.sqrt(best) <= r * cell) break;
    }
    return { d: Math.sqrt(best), i: bi };
  } };
}
// Umeyama: hedef ~ s R kaynak + t
function umeyama(A, B) {
  const n = A.length / 3; const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < A.length; i += 3) for (let d = 0; d < 3; d++) { ca[d] += A[i + d] / n; cb[d] += B[i + d] / n; }
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let va = 0;
  for (let i = 0; i < A.length; i += 3) {
    const a = [A[i] - ca[0], A[i + 1] - ca[1], A[i + 2] - ca[2]], b = [B[i] - cb[0], B[i + 1] - cb[1], B[i + 2] - cb[2]];
    va += (a[0] ** 2 + a[1] ** 2 + a[2] ** 2) / n;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += b[r] * a[c] / n;
  }
  const { U, S: sv, V } = svd3(C);
  const d = Math.sign(det3(U) * det3(V)) || 1;
  const D = [1, 1, d];
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r][c] += U[r][k] * D[k] * V[c][k];
  const s = (sv[0] + sv[1] + d * sv[2]) / va;
  const t = [0, 1, 2].map(r => cb[r] - s * (R[r][0] * ca[0] + R[r][1] * ca[1] + R[r][2] * ca[2]));
  return { R, s, t };
}
const det3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
// 3x3 SVD: M^T M ozvektorleri (Jacobi) ile
function svd3(M) {
  const At = [0, 1, 2].map(r => [0, 1, 2].map(c => M[c][r]));
  const MtM = [0, 1, 2].map(r => [0, 1, 2].map(c => M[0][r] * M[0][c] + M[1][r] * M[1][c] + M[2][r] * M[2][c]));
  const { vals, vecs } = jacobi(MtM);
  const order = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  const V = [0, 1, 2].map(r => order.map(k => vecs[r][k]));
  const S = order.map(k => Math.sqrt(Math.max(0, vals[k])));
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) {
    const v = [V[0][k], V[1][k], V[2][k]]; const u = [0, 1, 2].map(r => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);
    const len = Math.hypot(...u) || 1; for (let r = 0; r < 3; r++) U[r][k] = u[r] / len;
  }
  if (S[2] < 1e-9) { const a = [U[0][0], U[1][0], U[2][0]], b = [U[0][1], U[1][1], U[2][1]]; const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; for (let r = 0; r < 3; r++) U[r][2] = c[r]; }
  void At;
  return { U, S, V };
}
function jacobi(A0) {
  const A = A0.map(r => r.slice()); const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p][q] ** 2; if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]); const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { vals: [A[0][0], A[1][1], A[2][2]], vecs: V };
}
const apply = (X, P) => { const out = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) for (let r = 0; r < 3; r++) out[i + r] = X.s * (X.R[r][0] * P[i] + X.R[r][1] * P[i + 1] + X.R[r][2] * P[i + 2]) + X.t[r]; return out; };
const compose = (B, A) => { // B(A(p))
  const R = [0, 1, 2].map(r => [0, 1, 2].map(c => B.R[r][0] * A.R[0][c] + B.R[r][1] * A.R[1][c] + B.R[r][2] * A.R[2][c]));
  const t = [0, 1, 2].map(r => B.s * (B.R[r][0] * A.t[0] + B.R[r][1] * A.t[1] + B.R[r][2] * A.t[2]) + B.t[r]);
  return { R, s: B.s * A.s, t };
};
function subsample(P, n) { const step = Math.max(1, Math.floor(N(P) / n)); const out = []; for (let i = 0; i < P.length; i += 3 * step) out.push(P[i], P[i + 1], P[i + 2]); return new Float32Array(out); }

// --- ICP ---
const gT = grid(T, 1.0);
function icp(scaleFree) {
  const cS = centroid(S), cT = centroid(T);
  let X = { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], s: 100, t: [cT[0] - 100 * cS[0], cT[1] - 100 * cS[1], cT[2] - 100 * cS[2]] };
  const src = subsample(S, 12000);
  let rms = Infinity;
  for (let it = 0; it < 80; it++) {
    const cur = apply(X, src); const d = []; const pairs = [];
    for (let i = 0; i < cur.length; i += 3) { const nn = gT.nearest(cur[i], cur[i + 1], cur[i + 2], 6); d.push(nn.d); pairs.push(nn.i); }
    const sorted = [...d].sort((a, b) => a - b); const cut = Math.max(0.5, 2.5 * sorted[sorted.length >> 1]);
    const A = [], B = [];
    for (let k = 0; k < pairs.length; k++) if (pairs[k] >= 0 && d[k] <= cut) { A.push(cur[3 * k], cur[3 * k + 1], cur[3 * k + 2]); B.push(T[pairs[k]], T[pairs[k] + 1], T[pairs[k] + 2]); }
    const step = umeyama(new Float32Array(A), new Float32Array(B));
    if (!scaleFree) step.s = 1;
    if (!scaleFree) { const a = new Float32Array(A); const ca = centroid(a), cb = centroid(new Float32Array(B)); step.t = [0, 1, 2].map(r => cb[r] - (step.R[r][0] * ca[0] + step.R[r][1] * ca[1] + step.R[r][2] * ca[2])); }
    X = compose(step, X);
    const newRms = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length);
    if (Math.abs(rms - newRms) < 1e-5) { rms = newRms; break; }
    rms = newRms;
  }
  return { X, rms };
}
const stats = (X, P) => { const cur = apply(X, P); const d = []; for (let i = 0; i < cur.length; i += 3) d.push(gT.nearest(cur[i], cur[i + 1], cur[i + 2], 8).d); d.sort((a, b) => a - b); const q = f => +d[Math.floor(d.length * f)].toFixed(2); return { median: q(0.5), p90: q(0.9), p99: q(0.99), max: +d[d.length - 1].toFixed(2) }; };

const free = icp(true), fixed = icp(false);
console.log(`ICP olcek serbest: s=${free.X.s.toFixed(2)} (100 = gercek boyut), rms ${free.rms.toFixed(2)} cm`);
console.log(`ICP olcek sabit (x100): rms ${fixed.rms.toFixed(2)} cm`);
const best = free;
// bolgelere gore uyum (cm): HRA parcasi -> modelin pelvis yuzeyine uzaklik
const regions = {};
for (const m of pel) regions[m.name.replace('VH_F_', '')] = stats(best.X, subsample(m.P, 3000));
console.log('bolgelere gore uzaklik (cm):'); for (const [k, v] of Object.entries(regions)) console.log(`  ${k.padEnd(28)} ${JSON.stringify(v)}`);
// kalca eklemi: modelin femur basi noktalarinin kadin pelvisine en yakin uzakligi ile erkek pelvisine uzakligi
const hraAll = apply(best.X, S); const gH = grid(hraAll, 1.0);
for (const id of femurIds) {
  const F = meshPts(id); let top = -Infinity; for (let i = 1; i < F.length; i += 3) top = Math.max(top, F[i]);
  // femur basi: en ust 6 cm icinde ve ortaya (medial) en yakin noktalar
  const pts = []; for (let i = 0; i < F.length; i += 3) if (F[i + 1] > top - 6) pts.push(i);
  const xs = pts.map(i => Math.abs(F[i])); const med = Math.min(...xs) + 2.5;
  const head = pts.filter(i => Math.abs(F[i]) < med);
  const dm = head.map(i => gT.nearest(F[i], F[i + 1], F[i + 2], 8).d).sort((a, b) => a - b);
  const df = head.map(i => gH.nearest(F[i], F[i + 1], F[i + 2], 8).d).sort((a, b) => a - b);
  const q = (a, f) => +a[Math.floor(a.length * f)].toFixed(2);
  const it = meta.items.find(o => o.id === id);
  console.log(`femur basi ${it.sd}: erkek pelvisine en yakin p10/p50 ${q(dm, 0.1)}/${q(dm, 0.5)} cm, kadin pelvisine ${q(df, 0.1)}/${q(df, 0.5)} cm (${head.length} nokta)`);
}
fs.writeFileSync('tools/hra-registration.json', JSON.stringify({ note: 'HRA VH_F (m) -> model (cm): p_model = s * R * p_hra + t; tools/hra-register.mjs', R: best.X.R, s: best.X.s, t: best.X.t, rmsCm: best.rms, fixedScaleRmsCm: fixed.rms, regions }, null, 1));
console.log('yazildi: tools/hra-registration.json');
