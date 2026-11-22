// Kol ve bacak hareketi verisi için ortak geometri (motion-build.mjs ve motion-leg-build.mjs kullanır).
export const verts = p => { const a = []; for (let i = 0; i < p.P.length / 3; i++) a.push([p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]); return a; };
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => mul(a, 1 / len(a));
export const DEG = 180 / Math.PI;
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * DEG;
export const perp = (v, ax) => sub(v, mul(ax, dot(v, ax)));                 // v'nin ax'e dik bileşeni (ax birim)
export const mean = pts => mul(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
export const rd = (v, k = 4) => { const f = 10 ** k; return Math.round(v * f) / f; };
export const R = (a, k = 4) => a.map(v => rd(v, k));
export const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
export const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// p noktasını c'den geçen ax ekseni (birim) çevresinde deg derece döndürür (sağ el kuralı)
export function rotAbout(p, c, ax, deg) {
  const a = deg / DEG, co = Math.cos(a), si = Math.sin(a), v = sub(p, c);
  return add(c, add(add(mul(v, co), mul(cross(ax, v), si)), mul(ax, dot(ax, v) * (1 - co))));
}
// ---------- işaret noktaları (yöntemler: data/work/motion/inv.mjs ve geo2.mjs, map-data.md bölüm 5) ----------
export function solve(A, b) {   // Gauss-Jordan (küçük sistemler)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function sphereFit(pts) {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (const [x, y, z] of pts) { const row = [2 * x, 2 * y, 2 * z, 1], rhs = x * x + y * y + z * z; for (let i = 0; i < 4; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; } }
  const s = solve(A, b), c = [s[0], s[1], s[2]], r = Math.sqrt(s[3] + dot(c, c));
  let e = 0; for (const p of pts) e += (len(sub(p, c)) - r) ** 2;
  return { c, r, rms: Math.sqrt(e / pts.length), n: pts.length };
}
export function trimmedSphere(pts, it = 4, k = 2.0) {
  let f = sphereFit(pts), cur = pts;
  for (let i = 0; i < it; i++) { const t = cur.filter(p => Math.abs(len(sub(p, f.c)) - f.r) < Math.max(0.05, k * f.rms)); if (t.length < 20) break; cur = t; f = sphereFit(cur); }
  return f;
}
export function pca(pts) {
  const c = mean(pts), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  const eig = []; let M = C.map(r => [...r]);
  for (let k = 0; k < 3; k++) {
    let v = [1, 0.3, 0.2]; for (let i = 0; i < 200; i++) v = norm([dot(M[0], v), dot(M[1], v), dot(M[2], v)]);
    const l = dot(v, [dot(M[0], v), dot(M[1], v), dot(M[2], v)]); eig.push({ v, l }); M = M.map((r, i) => r.map((x, j) => x - l * v[i] * v[j]));
  }
  return { c, axes: eig };
}
// uzun kemiğin gövde ekseni: orta %60'ın ana ekseni, proksimale bakar
export function longAxis(p) {
  const a = verts(p), f = pca(a); let ax = f.axes[0].v; if (ax[1] < 0) ax = mul(ax, -1);
  const t = a.map(x => dot(sub(x, f.c), ax)), tmin = Math.min(...t), tmax = Math.max(...t);
  const g = pca(a.filter((x, i) => t[i] > tmin + 0.2 * (tmax - tmin) && t[i] < tmin + 0.8 * (tmax - tmin)));
  let v = g.axes[0].v; if (v[1] < 0) v = mul(v, -1);
  return { c: g.c, v, length: tmax - tmin };
}
export const basis = d => { const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = norm(cross(d, a)); return [u, cross(d, u)]; };
// dönel yüzey oturtma: eksen boyunca 0,25 cm'lik dilimlerde yarıçap değişimi en küçük olan eksen (d0 çevresinde aranır)
export function revFit(pts, d0, maxDeg, stepDeg = 1, phStep = 6) {
  let best = null;
  for (let th = 0; th <= maxDeg + 1e-9; th += stepDeg) for (let ph = 0; ph < 360; ph += (th ? phStep : 360)) {
    const [u, w] = basis(d0), t = th / DEG, p = ph / DEG;
    const d = norm(add(mul(d0, Math.cos(t)), add(mul(u, Math.sin(t) * Math.cos(p)), mul(w, Math.sin(t) * Math.sin(p)))));
    const [e1, e2] = basis(d), pr = pts.map(x => [dot(x, e1), dot(x, e2), dot(x, d)]);
    let cx = pr.reduce((s, q) => s + q[0], 0) / pr.length, cy = pr.reduce((s, q) => s + q[1], 0) / pr.length;
    const bin = q => Math.floor(q[2] / 0.25);
    const stats = () => { const rb = new Map(); for (const q of pr) { const k = bin(q), r = Math.hypot(q[0] - cx, q[1] - cy); if (!rb.has(k)) rb.set(k, []); rb.get(k).push(r); } return { rb, m: new Map([...rb].map(([k, e]) => [k, e.reduce((a, b) => a + b, 0) / e.length])) }; };
    for (let k = 0; k < 40; k++) { const { m } = stats(); let gx = 0, gy = 0; for (const q of pr) { const r = Math.hypot(q[0] - cx, q[1] - cy) || 1e-6, res = r - m.get(bin(q)); gx += res * (cx - q[0]) / r; gy += res * (cy - q[1]) / r; } cx -= gx / pr.length; cy -= gy / pr.length; }
    const { rb, m } = stats(); let ss = 0, n = 0; for (const [k, e] of rb) for (const r of e) { ss += (r - m.get(k)) ** 2; n++; }
    const rms = Math.sqrt(ss / n);
    if (!best || rms < best.rms) best = { d, rms, c2: [cx, cy], e1, e2 };
  }
  return best;
}
