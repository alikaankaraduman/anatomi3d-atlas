// Odile Fillod klitoris modelini (V2, STL, mm; CC BY-NC-SA) kadin pelvisine yerlestirir -> tools/fillod-fit.json
// Kullanim: node tools/fillod-fit.mjs   (once femalepelvis ve female donusturulmus olmali; ~10 dakika surer)
//
// Donusum: p = s * R * (q - j0) + J. s sabittir: mm -> cm, gercek boyut. Fillod modeli ortalama yetiskin boyutundadir;
// modelin kadin pelvisi de erkek pelvisine (ortalama yetiskin) oturtuldugu icin olcek 1 alinir. (Pelvis hizalamasindaki
// 0.81, VH_F'nin buyuk bedenini kucultur; once bu olcek kullanilmisti, corpus simfizin altinda kaliyordu.)
// j0 STL'de crura'nin birlestigi nokta. R ve J su maliyeti en kucuk yapacak bicimde aranir (Nelder-Mead, 9 baslangic +
// ince ayar):
//  - Crura ischiopubik kollarin ic-alt kenarina yaslanir: crus orta hattindaki 12 noktanin kemige uzakligi, o noktadaki
//    crus yaricapi + 0.05 cm olmali (TA: crura ramus ossis ischii ve ramus inferior ossis pubis'e tutunur).
//  - Hicbir kose kalca kemiklerinin ya da vajinanin (vajina + forniks kapali kabugu) icinde olmamali.
//  - Crura'nin birlesimi ve corpus'un acisi orta hatta (x = 0) olmali.
//  - Corpus'un acisi (genu) simfizin onunde olmali: z >= KNEE_Z (simfizin on yuzu ~3.9 + corpus yaricapi), y >= KNEE_Y
//    (simfizin alt kenari). Ders kitabi: corpus simfizin onunde yukari cikar, aci onunde durur, glans asagi-geri bakar.
// Kemik ici testi HRA pelvisinin kompakt ve sungerimsi aglarinin birlesimiyle yapilir: donusturulmus kalca kemigi yalniz
// ici bos kompakt kabuktur ve kabugun icindeki bosluk isin paritesinde "disarida" sayilir.
// Baslangic cercevesi: STL x -> modelin x'i, STL y -> pubis kemerinin yonu (tuber ischiadicum'lardan kemer tepesine),
// STL z = x * y (kemer duzleminin asagi-one bakan normali; bulbuslar ve glans bu yondedir).
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene } from './scene.mjs';
import { readSTL } from './fillod.mjs';
import { readGLBMeshes } from './glb.mjs';

const reg = JSON.parse(fs.readFileSync(new URL('./hra-registration.json', import.meta.url), 'utf8'));
const s = 0.1;   // mm -> cm, gercek boyut
const KNEE_Z = 4.25, KNEE_Y = 83.2;
const { P: Q } = readSTL('../data/fillod/Clitoris.stl');
const sub = []; for (let k = 0; k < Q.length; k += 3 * 21) sub.push([Q[k], Q[k + 1], Q[k + 2]]);
const j0 = [0, 9, 3.5];
// sol crus orta hatti [x, y, z, yaricap] (mm; tools/fillod.mjs ile ayni STL, dilim agirlik merkezleri); sag = ayna
const crusL = [[6.8, 10.7, 3.8, 3.94], [9.8, 8.1, 3.8, 3.63], [12.5, 5.1, 3.8, 3.25], [15.5, 2.5, 3.8, 3.0], [18.4, -0.3, 3.8, 2.85], [21.1, -3.2, 3.8, 2.77],
  [23.8, -6.4, 3.7, 2.68], [26.5, -9.2, 3.6, 2.55], [29.3, -12.2, 3.6, 2.36], [31.8, -15.3, 3.6, 2.2], [34.5, -18.4, 3.6, 2.02], [37.1, -21.5, 3.6, 1.73]];
const crus = [...crusL, ...crusL.map(c => [-c[0], c[1], c[2], c[3]])];

const { parts } = await loadScene({ files: ['femalepelvis', 'female'], keep: it => it.x === 'f' });
const bvhOf = list => {
  let nP = 0, nI = 0; for (const p of list) { nP += p.P.length; nI += p.I.length; }
  const P = new Float32Array(nP), I = new Uint32Array(nI); let o = 0, oi = 0;
  for (const p of list) { P.set(p.P, o); for (let k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + o / 3; o += p.P.length; oi += p.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); return new MeshBVH(g);
};
const tfH = (x, y, z) => { const { R, s: k, t } = reg; return [0, 1, 2].map(i => k * (R[i][0] * x + R[i][1] * y + R[i][2] * z) + t[i]); };
const hipRaw = readGLBMeshes('../data/hra/VH_F_Pelvis.glb').filter(m => /^VH_F_(ilium|ischium|pubis)_(compact|spongy)_bone_[LR]$/.test(m.name))
  .map(m => { const P = new Float32Array(m.P.length); for (let k = 0; k < m.P.length; k += 3) P.set(tfH(m.P[k], m.P[k + 1], m.P[k + 2]), k); return { P, I: m.idx }; });
const hip = bvhOf(hipRaw), vag = bvhOf(parts.filter(p => p.n === 'Vagina' || p.n === 'Vaginal fornix'));
const DIRS = [new THREE.Vector3(0.577, 0.611, 0.542).normalize(), new THREE.Vector3(-0.49, -0.62, 0.61).normalize()];
const ray = new THREE.Ray(), pt = new THREE.Vector3(), hit = {};
const inside = (bv, p) => DIRS.every(d => { ray.set(pt.copy(p), d); return bv.raycast(ray, THREE.DoubleSide).length % 2 === 1; });

// pubis kemeri: tepe (iki kolun ic kenarlarinin bulustugu yer) ve tuber ischiadicum'larin orta noktasi (olculdu)
const apex = new THREE.Vector3(0.4, 83.0, 0.7), tub = new THREE.Vector3(0.06, 81.15, -3.0);
const ey = apex.clone().sub(tub).normalize(); const ez = new THREE.Vector3(1, 0, 0).cross(ey).normalize(); const ex = ey.clone().cross(ez).normalize();
const R0 = new THREE.Matrix4().makeBasis(ex, ey, ez);
const rotOf = prm => { const rv = new THREE.Vector3(prm[0], prm[1], prm[2]); const a = rv.length(); return (a > 1e-9 ? new THREE.Matrix4().makeRotationAxis(rv.clone().normalize(), a) : new THREE.Matrix4()).multiply(R0); };
const xform = prm => { const R = rotOf(prm), J = new THREE.Vector3(prm[3], prm[4], prm[5]); return q => new THREE.Vector3(q[0] - j0[0], q[1] - j0[1], q[2] - j0[2]).multiplyScalar(s).applyMatrix4(R).add(J); };
const GAP = 0.05;
function cost(prm, detail = false) {
  const T = xform(prm); let e = 0; const crusErr = [];
  for (const c of crus) { const p = T(c); hip.closestPointToPoint(p, hit); const d = inside(hip, p) ? -hit.distance : hit.distance; const err = d - (c[3] * s + GAP); crusErr.push(err); e += err * err * 4; }
  let pen = 0, vpen = 0, depth = 0; const stride = detail ? 1 : 3;
  for (let k = 0; k < sub.length; k += stride) { const p = T(sub[k]); if (inside(hip, p)) { hip.closestPointToPoint(p, hit); pen++; depth += hit.distance; } if (inside(vag, p)) { vag.closestPointToPoint(p, hit); vpen++; depth += hit.distance; } }
  e += depth * stride * 2;
  const Jm = T(j0), K = T([0, 37, 8]); e += (Jm.x ** 2 + K.x ** 2) * 2;
  e += 10 * (Math.max(0, KNEE_Z - K.z) ** 2 + Math.max(0, KNEE_Y - K.y) ** 2);
  return detail ? { e, crusErr, pen, vpen, J: Jm, K, glans: T([0, 25.5, 24]), comm: T([0, 9.5, 4.4]) } : e;
}
function nelderMead(f, x0, step, iters) {
  const dim = x0.length; let S = [x0.slice()]; for (let i = 0; i < dim; i++) { const x = x0.slice(); x[i] += step[i]; S.push(x); }
  let V = S.map(f);
  for (let it = 0; it < iters; it++) {
    const ord = V.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(p => p[1]); S = ord.map(i => S[i]); V = ord.map(i => V[i]);
    const c = Array(dim).fill(0); for (let i = 0; i < dim; i++) for (let d = 0; d < dim; d++) c[d] += S[i][d] / dim;
    const xr = c.map((v, d) => 2 * v - S[dim][d]), fr = f(xr);
    if (fr < V[0]) { const xe = c.map((v, d) => 3 * v - 2 * S[dim][d]), fe = f(xe); if (fe < fr) { S[dim] = xe; V[dim] = fe; } else { S[dim] = xr; V[dim] = fr; } }
    else if (fr < V[dim - 1]) { S[dim] = xr; V[dim] = fr; }
    else { const xc = c.map((v, d) => 0.5 * (v + S[dim][d])), fc = f(xc); if (fc < V[dim]) { S[dim] = xc; V[dim] = fc; } else for (let i = 1; i <= dim; i++) { S[i] = S[i].map((v, d) => 0.5 * (v + S[0][d])); V[i] = f(S[i]); } }
  }
  const i = V.indexOf(Math.min(...V)); return { x: S[i], v: V[i] };
}
let best = null;
for (const dx of [-0.3, 0, 0.3]) for (const [dy, dz] of [[-0.5, 0], [0, 0.4], [0.3, -0.3]]) {
  const r = nelderMead(cost, [dx, 0, 0, 0, 82.3 + dy, 1.3 + dz], [0.15, 0.15, 0.15, 0.3, 0.3, 0.3], 300); if (!best || r.v < best.v) best = r;
}
const fin = nelderMead(cost, best.x, [0.05, 0.05, 0.05, 0.1, 0.1, 0.1], 400);
const D = cost(fin.x, true); const v3 = v => [v.x, v.y, v.z].map(a => +a.toFixed(3));
const R = rotOf(fin.x);
const out = {
  note: 'Fillod klitoris: p = s * R * (q - j0) + J (q STL mm, p model cm); tools/fillod-fit.mjs',
  s, j0, R: R.elements, J: fin.x.slice(3),
  report: { crusErrorCm: D.crusErr.map(v => +v.toFixed(3)), insideHip: D.pen, insideVagina: D.vpen, samples: sub.length, junction: v3(D.J), knee: v3(D.K), glansTip: v3(D.glans), commissure: v3(D.comm) },
};
fs.writeFileSync(new URL('./fillod-fit.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.report), '\n-> tools/fillod-fit.json');
