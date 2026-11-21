// Meme tabani bukmesi (tools/hra-breast-fit.mjs ile bulunur, tools/hra.mjs uygular; ikisi de bu islevi kullanir).
// Alan taban orneklerinden kurulur: her ornek, tabanin bir noktasini gogus duvarindan GAP uzaga tasiyan yer degistirme
// (duvarin o noktadaki normali yonunde). Bir kosenin yer degistirmesi yakin orneklerin Gauss agirlikli ortalamasi
// (sigma SIGMA cm) x tabana yakinlik: en yakin ornege uzaklik h icin (1 - h/H)^2, H'den uzakta sifir. Boylece taban
// duvara uyar, meme basi ve on yuz yerinde kalir.
export function makeWarp(W) {
  const { samples, SIGMA, H } = W; const cell = 3 * SIGMA;
  const grid = new Map();
  samples.forEach((s, i) => { const k = `${Math.floor(s[0] / cell)},${Math.floor(s[1] / cell)},${Math.floor(s[2] / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  return (x, y, z) => {
    let w = 0, dx = 0, dy = 0, dz = 0, near = Infinity;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue;
      for (const i of l) {
        const s = samples[i]; const r2 = (s[0] - x) ** 2 + (s[1] - y) ** 2 + (s[2] - z) ** 2;
        if (r2 < near) near = r2;
        const g = Math.exp(-r2 / (2 * SIGMA * SIGMA)); w += g; dx += g * s[3]; dy += g * s[4]; dz += g * s[5];
      }
    }
    if (w < 1e-9) return [0, 0, 0];
    const h = Math.sqrt(near), f = h >= H ? 0 : (1 - h / H) ** 2;
    return [dx / w * f, dy / w * f, dz / w * f];
  };
}
