// Kadin bedeni icin pelvis eklemleri: Z-Anatomy eklem dosyasindaki (Joints100.fbx), erkek pelvisine tutunan parcalarin
// kadin pelvisine tasinmis kopyalari. Hangi parcalarin kopyalanacagi ve yer degistirme alani tools/pelvis-warp.mjs
// ile bulunur (tools/pelvis-warp.json). Gruplar ve adlar kaynaktaki gibi kalir; meta.mjs ayni gruplara katar.
import fs from 'node:fs';
import { THREE, loadFBX } from './fbxnode.mjs';
import { origName } from './geom.mjs';

// Alan: orneklerin (erkek pelvis yuzeyinde nokta + yumusatilmis yer degistirme) Gauss agirlikli ortalamasi x guven.
// Guven erkek pelvisine uzaklikla duser (R0'a kadar tam, R1'de sifir) ve pelvis disi ortak kemige (others) daha yakin
// koselerde azalir. Uzakliklar en yakin ornege olcululur (ornek araligi ~0.5 cm, guven icin yeterli).
export function makeField(J) {
  const { SIGMA, R0, R1, samples, others } = J;
  const cell = 3 * SIGMA;
  const index = (pts, c) => { const g = new Map(); pts.forEach((p, i) => { const k = `${Math.floor(p[0] / c)},${Math.floor(p[1] / c)},${Math.floor(p[2] / c)}`; (g.get(k) || g.set(k, []).get(k)).push(i); }); return g; };
  const gS = index(samples, cell), gO = index(others, cell);
  const nearestDist = (pts, g, x, y, z, maxR) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell), r = Math.ceil(maxR / cell); let best = maxR * maxR;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const l = g.get(`${cx + a},${cy + b},${cz + c}`); if (l) for (const i of l) { const p = pts[i]; const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d2 < best) best = d2; }
    }
    return Math.sqrt(best);
  };
  return (x, y, z) => {
    let w = 0, dx = 0, dy = 0, dz = 0; const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = gS.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue;
      for (const i of l) { const t = samples[i]; const g = Math.exp(-((t[0] - x) ** 2 + (t[1] - y) ** 2 + (t[2] - z) ** 2) / (2 * SIGMA * SIGMA)); w += g; dx += g * t[3]; dy += g * t[4]; dz += g * t[5]; }
    }
    if (w < 1e-6) return [0, 0, 0];
    const rp = nearestDist(samples, gS, x, y, z, R1), ro = nearestDist(others, gO, x, y, z, R1);
    const conf = (rp <= R0 ? 1 : rp >= R1 ? 0 : 1 - (rp - R0) / (R1 - R0)) * (ro / (ro + rp + 1e-3));
    return [dx / w * conf, dy / w * conf, dz / w * conf];
  };
}

export function loadFemaleJoints(fbxFile) {
  const J = JSON.parse(fs.readFileSync(new URL('./pelvis-warp.json', import.meta.url), 'utf8'));
  const F = makeField(J); const keep = new Set(J.parts);
  const root = loadFBX(fbxFile); root.updateMatrixWorld(true);
  const base = o => origName(o).replace(/\.[rlg]$/, '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const v = new THREE.Vector3(); let kept = 0;
  for (const o of meshes) {
    // secilmeyen ag bos geometriyle kalir (convert.mjs atlar); silinseydi altindaki secilmis agler de giderdi
    if (!keep.has(base(o))) { o.geometry = new THREE.BufferGeometry(); o.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); continue; }
    // dunya koordinatinda tasi, sonra yerel koordinata geri cevir (convert.mjs matrixWorld ile yeniden dunyaya tasir)
    const M = o.matrixWorld, Mi = M.clone().invert();
    const g = o.geometry = o.geometry.clone(); const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M); const d = F(v.x, v.y, v.z);
      v.set(v.x + d[0], v.y + d[1], v.z + d[2]).applyMatrix4(Mi); pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true; g.deleteAttribute('normal'); kept++;
  }
  if (!kept) throw new Error('pelvis eklemi bulunamadi (pelvis-warp.json bos mu?)');
  return root;
}
