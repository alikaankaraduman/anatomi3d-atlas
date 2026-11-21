// HRA kadin memelerini (CC BY 4.0, VH_F) modelin (erkek) gogus duvarina oturtur -> tools/hra-breast-fit.json
// Kullanim: node tools/hra-breast-fit.mjs   (once kemik ve kas modelleri donusturulmus olmali: public/models)
//
// Pelvis hizalamasi (hra-registration.json) memeleri ~11 cm asagi ve ~4.5 cm geriye koyar: VH_F govdesinin oranlari
// ve donuk (sirtustu) durusu modelden farklidir. Pelvis olcegiyle (0.81) memeler bu (erkek boyutlu) gogus icin de
// kucuk kalir: taban 3. kaburgadan baslar ve pectoralis major'un dis kenarinin 5.5 cm icinde biter. Bu yuzden:
//  1. On donusum: yag govdesinin agirlik merkezi etrafinda K kat buyutme ve DX cm disa kaydirma.
//  2. Poz: agirlik merkezi etrafinda donme (rx, ry, rz); meme basi 4. interkostal araliga (meme basinin kendi x'inde,
//     4. kaburganin alt ve 5. kaburganin ust kenarinin ortasi) gelecek kadar yukari (dy); taban duvara gelecek kadar
//     one (dz). Donme, taban ile duvar arasindaki uzakligin dagilimini (p90 - p10) en kucuk yapan acidir (5 derece kaba,
//     1 derece ince tarama); dz uzakliklarin ortancasi.
//  3. Taban bukmesi (tools/breastwarp.mjs): tabanin noktalari gogus duvarinin yerel normali yonunde duvardan GAP uzaga
//     tasinir, etki tabandan uzaklastikca H cm icinde sifira iner. Duvarin icinde kalan kose oldukca ilgili orneklerin
//     yer degistirmesi artirilip yeniden denenir. (Yalniz z yonunde bukme genis tabanda yan kenari 5 cm'ye kadar
//     geriye cekiyordu.)
// Taban: yag aginin duvara S_BASE cm'den yakin ve duvara bakan koseleri. Duvar: kemik ve kaslar (kapali aglar).
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { readGLBMeshes } from './glb.mjs';
import { loadScene, bounds } from './scene.mjs';
import { makeWarp } from './breastwarp.mjs';

const STEP = 0.5, HALF = 11, K = 1.2, DX = 1.5, GAP = 0.1, SIGMA = 1.0, H = 4, S_BASE = 1.5, NSAMP = 3000;   // cm
const reg = JSON.parse(fs.readFileSync(new URL('./hra-registration.json', import.meta.url), 'utf8'));
const tf = (x, y, z) => { const { R, s, t } = reg; return [0, 1, 2].map(i => s * (R[i][0] * x + R[i][1] * y + R[i][2] * z) + t[i]); };
const mkBVH = (P, I) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(I), 1)); return new MeshBVH(g); };
const cen = P => { const c = [0, 0, 0]; for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) c[a] += P[k + a] * 3 / P.length; return c; };
const deg = Math.PI / 180;
const DIRS = [new THREE.Vector3(0.577, 0.611, 0.542).normalize(), new THREE.Vector3(-0.49, -0.62, 0.61).normalize()];

const { parts } = await loadScene({ files: ['bones', 'muscles'], keep: it => (!it.x || it.x === 'f') && !it.o });
const out = { note: 'HRA meme on donusumu, pozu ve taban bukmesi; tools/hra-breast-fit.mjs', K, DX, GAP, SIGMA, H, sides: {} };

for (const sd of ['l', 'r']) {
  const sgn = sd === 'l' ? 1 : -1;
  const meshes = readGLBMeshes(`../data/hra-breast/3d-vh-f-mammary-gland-${sd}.glb`).map(m => {
    const P = new Float32Array(m.P.length); for (let k = 0; k < m.P.length; k += 3) P.set(tf(m.P[k], m.P[k + 1], m.P[k + 2]), k);
    return { name: m.name, P, I: m.idx };
  });
  const fat = meshes.find(m => /_fat_/.test(m.name)), nip = meshes.find(m => /_nipple_/.test(m.name));
  const c0 = cen(fat.P);
  const pre = (x, y, z) => [c0[0] + K * (x - c0[0]) + sgn * DX, c0[1] + K * (y - c0[1]), c0[2] + K * (z - c0[2])];
  const FP = new Float32Array(fat.P.length); for (let k = 0; k < FP.length; k += 3) FP.set(pre(fat.P[k], fat.P[k + 1], fat.P[k + 2]), k);
  const C1 = new THREE.Vector3(c0[0] + sgn * DX, c0[1], c0[2]), N1 = new THREE.Vector3(...pre(...cen(nip.P)));
  const fatB = mkBVH(FP, fat.I);
  const wallParts = parts.filter(p => { const b = bounds(p.P); return b.mx[1] > 105 && b.mn[1] < 150 && b.mx[2] > 0 && (sd === 'l' ? b.mx[0] > 0 : b.mn[0] < 0); });
  const wall = wallParts.map(p => ({ p, b: mkBVH(p.P, p.I) }));
  let wP = 0, wI = 0; for (const p of wallParts) { wP += p.P.length; wI += p.I.length; }
  const WP = new Float32Array(wP), WI = new Uint32Array(wI); { let o = 0, oi = 0; for (const p of wallParts) { WP.set(p.P, o); for (let k = 0; k < p.I.length; k++) WI[oi + k] = p.I[k] + o / 3; o += p.P.length; oi += p.I.length; } }
  const wallB = mkBVH(WP, WI);
  const ray = new THREE.Ray(), o3 = new THREE.Vector3(), d3 = new THREE.Vector3(), pt = new THREE.Vector3(), hit = {};
  const Wc = new Map();
  const wallAt = (x, y) => {
    const kx = Math.round(x / STEP), ky = Math.round(y / STEP), k = kx + ',' + ky; let h = Wc.get(k);
    if (h === undefined) { h = null; ray.set(o3.set(kx * STEP, ky * STEP, 60), d3.set(0, 0, -1)); for (const w of wall) { const r = w.b.raycastFirst(ray, THREE.DoubleSide); if (r && (!h || r.point.z > h.z)) h = { z: r.point.z, n: w.p.n }; } Wc.set(k, h); }
    return h;
  };
  // 4. interkostal aralik: verilen x'te 4. kaburganin alt ve 5. kaburganin ust kenari (on yarim)
  const ribY = (name, x, lower) => { const r = parts.find(p => p.n === name && p.sd === sd); let v = null; for (let k = 0; k < r.P.length; k += 3) if (Math.abs(r.P[k] - x) < 0.35 && r.P[k + 2] > 0) v = v === null ? r.P[k + 1] : lower ? Math.min(v, r.P[k + 1]) : Math.max(v, r.P[k + 1]); return v; };
  const targetAt = x => (ribY('Fourth rib', x, true) + ribY('Fifth rib', x, false)) / 2;
  const pose = (rx, ry, rz, targetY, keep = false) => {
    const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')), Mi = M.clone().invert();
    const nn = N1.clone().sub(C1).applyMatrix4(M).add(C1); const dy = targetY - nn.y;
    const cols = []; const dir = new THREE.Vector3(0, 0, 1).transformDirection(Mi);
    for (let x = C1.x - HALF; x <= C1.x + HALF; x += STEP) for (let y = C1.y - HALF; y <= C1.y + HALF; y += STEP) {
      ray.set(new THREE.Vector3(x, y, -40).sub(C1).applyMatrix4(Mi).add(C1), dir);
      const h = fatB.raycastFirst(ray, THREE.DoubleSide); if (!h) continue;
      const pb = h.point.clone().sub(C1).applyMatrix4(M).add(C1); const w = wallAt(pb.x, pb.y + dy); if (!w) continue;
      cols.push({ x: pb.x, y: pb.y + dy, zb: pb.z, zw: w.z, n: w.n });
    }
    const need = cols.map(c => c.zw - c.zb).sort((a, b) => a - b); const q = p => need[Math.min(need.length - 1, Math.floor(p * need.length))];
    return { rx, ry, rz, dy, dz: q(0.5), spread: q(0.9) - q(0.1), cols: keep ? cols : null, nipple: [nn.x, targetY, nn.z + q(0.5)] };
  };
  let targetY = targetAt(N1.x), best = null;
  for (let pass = 0; pass < 2; pass++) {
    best = null;
    for (let rx = -40; rx <= 20; rx += 5) for (let ry = -35; ry <= 35; ry += 5) for (let rz = -25; rz <= 25; rz += 5) { const r = pose(rx * deg, ry * deg, rz * deg, targetY); if (!best || r.spread < best.spread) best = r; }
    const b0 = best;
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (let c = -4; c <= 4; c++) { const r = pose(b0.rx + a * deg, b0.ry + b * deg, b0.rz + c * deg, targetY); if (r.spread < best.spread) best = r; }
    targetY = targetAt(best.nipple[0]);   // ikinci tur: hedef meme basinin yeni x'inde
  }
  const P = pose(best.rx, best.ry, best.rz, targetY, true);
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(best.rx, best.ry, best.rz, 'XYZ'));
  // pozlanmis yag koseleri (dz dahil) ve normalleri
  const n = FP.length / 3, V = new Float32Array(FP.length), NF = new Float32Array(FP.length); const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) { tmp.set(FP[i * 3], FP[i * 3 + 1], FP[i * 3 + 2]).sub(C1).applyMatrix4(R).add(C1); V[i * 3] = tmp.x; V[i * 3 + 1] = tmp.y + P.dy; V[i * 3 + 2] = tmp.z + P.dz; }
  for (let k = 0; k < fat.I.length; k += 3) {
    const a = fat.I[k] * 3, b = fat.I[k + 1] * 3, c = fat.I[k + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) { NF[j] += nx; NF[j + 1] += ny; NF[j + 2] += nz; }
  }
  // duvara isaretli uzaklik ve duvardan disa dogru yon (en yakin noktadan)
  const signed = (x, y, z) => {
    wallB.closestPointToPoint(pt.set(x, y, z), hit); const d = hit.distance; const cp = hit.point.clone();
    const ins = DIRS.every(dd => { ray.set(pt.set(x, y, z), dd); return wallB.raycast(ray, THREE.DoubleSide).length % 2 === 1; });
    const nrm = new THREE.Vector3(x - cp.x, y - cp.y, z - cp.z).multiplyScalar(ins ? -1 : 1); if (d > 1e-6) nrm.divideScalar(d); else nrm.set(0, 0, 1);
    return { s: ins ? -d : d, nrm };
  };
  // duvara yakin koseler (bukmenin dokunabilecegi): olcum ve taban secimi
  const cand = [];
  for (let i = 0; i < n; i++) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2]; const r = signed(x, y, z); if (r.s > S_BASE + 1) continue;
    const L = Math.hypot(NF[i * 3], NF[i * 3 + 1], NF[i * 3 + 2]) || 1; const facing = (NF[i * 3] * r.nrm.x + NF[i * 3 + 1] * r.nrm.y + NF[i * 3 + 2] * r.nrm.z) / L;
    cand.push({ i, x, y, z, s: r.s, nrm: r.nrm, base: r.s < S_BASE && facing < -0.3 });
  }
  const baseAll = cand.filter(c => c.base), stride = Math.max(1, Math.floor(baseAll.length / NSAMP));
  const S = baseAll.filter((_, k) => k % stride === 0).map(c => ({ c, d: c.nrm.clone().multiplyScalar(GAP - c.s) }));
  const toW = () => ({ SIGMA, H, samples: S.map(o => [o.c.x, o.c.y, o.c.z, o.d.x, o.d.y, o.d.z].map(v => +v.toFixed(4))) });
  let iter = 0, worst = 0, nviol = 0;
  for (; ; iter++) {
    const F = makeWarp(toW()); const inc = new Float64Array(S.length); worst = 0; nviol = 0;
    const cell = 1.0, g = new Map(); S.forEach((o, k) => { const key = `${Math.floor(o.c.x / cell)},${Math.floor(o.c.y / cell)},${Math.floor(o.c.z / cell)}`; (g.get(key) || g.set(key, []).get(key)).push(k); });
    for (const c of cand) {
      const d = F(c.x, c.y, c.z); const r = signed(c.x + d[0], c.y + d[1], c.z + d[2]); const viol = GAP - 0.02 - r.s; if (viol <= 0) continue;
      nviol++; worst = Math.max(worst, viol);
      const cx = Math.floor(c.x / cell), cy = Math.floor(c.y / cell), cz = Math.floor(c.z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) { const l = g.get(`${cx + a},${cy + b},${cz + e}`); if (l) for (const k of l) { const o = S[k]; const r2 = (o.c.x - c.x) ** 2 + (o.c.y - c.y) ** 2 + (o.c.z - c.z) ** 2; if (r2 < SIGMA * SIGMA) inc[k] = Math.max(inc[k], viol + 0.02); } }
    }
    if (worst <= 0.02 || iter >= 25) break;
    S.forEach((o, k) => { if (inc[k]) o.d.addScaledVector(o.c.nrm, inc[k]); });
  }
  const sNear = cand.filter(c => c.base).map(c => c.s).sort((a, b) => a - b); const qs = p => sNear[Math.min(sNear.length - 1, Math.floor(p * sNear.length))];
  const under = {}; for (const c of P.cols) under[c.n] = (under[c.n] || 0) + 1;
  out.sides[sd] = {
    c0, dx: sgn * DX, pivot: C1.toArray(), euler: [best.rx, best.ry, best.rz], t: [0, P.dy, P.dz], warp: toW(),
    report: {
      eulerDeg: [best.rx, best.ry, best.rz].map(v => +(v / deg).toFixed(1)), dy: +P.dy.toFixed(2), dz: +P.dz.toFixed(2), nipple: P.nipple.map(v => +v.toFixed(2)),
      targetY: +targetY.toFixed(2), spreadP10P90: +best.spread.toFixed(2), baseDistanceBeforeWarp: { p10: +qs(0.1).toFixed(2), p50: +qs(0.5).toFixed(2), p90: +qs(0.9).toFixed(2) },
      warpIterations: iter, worstViolation: +worst.toFixed(3), violatingVertices: nviol, baseSamples: S.length, wallUnderBase: under,
    },
  };
  console.log(`[${sd}]`, JSON.stringify(out.sides[sd].report));
}
fs.writeFileSync(new URL('./hra-breast-fit.json', import.meta.url), JSON.stringify(out));
console.log('-> tools/hra-breast-fit.json');
