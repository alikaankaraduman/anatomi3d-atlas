// lib.mjs: beyin çalışma modunun "BOS yolu" sekmesi için BOS akışı geometrisi (Anatomi 3D).
// İçe aktarma ve node API'si kullanmayan saf fonksiyonlar; src/brain.js'e yapıştırılmak (ya da modül olarak içe aktarılmak) üzere yazıldı.
// Ağlar düz nesnelerdir { P: Float32Array dünya xyz, I: indis dizisi }; meshOf(r.geo) bir THREE.BufferGeometry'yi sarar.
// Noktalar düz dizilerdir [x, y, z]. Birimler cm; +x = gövdenin SOLU (anatomik sağ = -x), +y yukarı, +z ön.
// Sayılar, süreler ve başarısız durumlar geliştirme sırasında ayrı bir çalışma notuna yazıldı (depoda yok).
// Ana giriş noktaları:
//   ventricularFlow(parts)                ventriküllerin içindeki akış çizgisi (eğriler 'lv.l', 'lv.r', 'main', 'luschka.l',
//                                         'luschka.r') + anahtar noktalar (glomus, Monro, aquaeductus uçları, Magendie, Luschka)
//   subarachnoidRoute(brain, opt)         beynin dışındaki şematik yol: Cisterna magna -> beyincik -> oksipital lob
//                                         -> konveksite -> Sinus sagittalis superior (sonra kontrol noktaları için fitAlong(route.pts))
//   basalBranch(stem, skull, exit, tgt)   isteğe bağlı dal: Apertura lateralis -> serebellopontin köşe -> Cisterna prepontina
//                                         -> Cisterna interpeduncularis
//   tubeCenterline(mesh) / venousRoute(sinuses, opt) / granulations(sssLine, vertex, opt)
//   lumbarPuncture(spine)                 tahmini deri derinliğinde L2/L3..L4/L5 interspinöz noktaları, konus, dural kese (S2)
//   surfaceAnchor(meshes, near)           heart.js anchor() kuralı: `near` noktasına en yakın yüzey köşesi (varsayılan: sınır kutusunun merkezi)
//   catmullRomPoint / sampleCurve / checkCurve: merkezcil Catmull-Rom, tam THREE.CatmullRomCurve3'ün hesapladığı gibi
// Kullanım taslağı (brain.js): const m = r => meshOf(r.geo);
//   const f = ventricularFlow({ lv: { l: m(lvL), r: m(lvR) }, plexus: { l: m(cpL), r: m(cpR) }, v3: m(v3), aq: m(aq), v4: m(v4) });
//   for (const c of f.curves) new THREE.CatmullRomCurve3(c.ctrl.map(p => new THREE.Vector3(...p)), false, 'centripetal');

// ---------------------------------------------------------------- küçük vektör yardımcıları
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vec = { sub, add, mul, dot, cross, len, dist, lerp, norm };
const vert = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- ağ temelleri
export function meshOf(g) {
  if (g.P) return g;
  const pos = g.attributes.position.array;
  return { P: pos, I: g.index ? g.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) };
}
export function meshBounds(...ms) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of ms) { const P = m.P; for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { const v = P[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; } }
  return { mn, mx };
}
export function mergeMeshes(ms) {
  let nv = 0, ni = 0; for (const m of ms) { nv += m.P.length; ni += m.I.length; }
  const P = new Float32Array(nv), I = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const m of ms) { P.set(m.P, ov); for (let k = 0; k < m.I.length; k++) I[oi + k] = m.I[k] + ov / 3; ov += m.P.length; oi += m.I.length; }
  return { P, I };
}
// konuma göre birleştirilen köşeler (malzeme dikişleri köşeleri çoğaltır); cl: köşe -> küme, rep: küme -> ilk köşe
export function weld(P, tol = 1e-3) {
  const n = P.length / 3, cl = new Uint32Array(n), map = new Map(), rep = []; const q = 1 / tol;
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[i * 3] * q) + ',' + Math.round(P[i * 3 + 1] * q) + ',' + Math.round(P[i * 3 + 2] * q);
    let j = map.get(k); if (j === undefined) { j = rep.length; map.set(k, j); rep.push(i); } cl[i] = j;
  }
  return { cl, rep, n: rep.length };
}
// Yönlü sınır kenarları boyunca izlenen sınır halkaları (a -> b, üçgenlerinde göründükleri sırayla).
// Dönüş { loops: [{ v: özgün köşe indisleri, c: ağırlık merkezi, r: en büyük yarıçap, len: çevre }], nonManifold, boundary }.
export function boundaryLoops(m, tol = 1e-3) {
  const { P, I } = m; const { cl, rep, n } = weld(P, tol);
  const und = new Map(), dir = new Set();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = cl[I[t + k]], b = cl[I[t + (k + 1) % 3]]; if (a === b) continue;
    const key = a < b ? a * n + b : b * n + a; und.set(key, (und.get(key) || 0) + 1); dir.add(a * n + b);
  }
  const out = new Map(); let nonManifold = 0, boundary = 0;
  for (const [key, c] of und) {
    if (c > 2) nonManifold++;
    if (c !== 1) continue;
    boundary++;
    let a = Math.floor(key / n), b = key % n; if (!dir.has(a * n + b)) [a, b] = [b, a];
    (out.get(a) || out.set(a, []).get(a)).push(b);
  }
  const loops = [];
  for (const s of [...out.keys()]) {
    while (out.get(s)?.length) {
      const v = [s]; let cur = out.get(s).pop(), guard = 0;
      while (cur !== s && guard++ < 1e6) { v.push(cur); const nx = out.get(cur); if (!nx || !nx.length) break; cur = nx.pop(); }
      const pts = v.map(k => vert(P, rep[k]));
      const c = [0, 0, 0]; for (const p of pts) for (let a = 0; a < 3; a++) c[a] += p[a] / pts.length;
      let r = 0, L = 0; for (let i = 0; i < pts.length; i++) { r = Math.max(r, dist(pts[i], c)); L += dist(pts[i], pts[(i + 1) % pts.length]); }
      loops.push({ v: v.map(k => rep[k]), c, r, len: L });
    }
  }
  return { loops, nonManifold, boundary };
}
// Sınır halkalarını (yarıçap <= maxR) ağırlık merkezlerinden açılan, yüzeyle aynı yönlü bir yelpazeyle kapatır. voxelize()
// için gerekmez (çoğunluk oyu küçük deliklerle başa çıkar); açık tüplerin (sinüsler) sarım sayısı sınamalarında kullanılır.
export function closeHoles(m, maxR = Infinity, tol = 1e-3) {
  const loops = boundaryLoops(m, tol).loops.filter(l => l.r <= maxR);
  if (!loops.length) return { P: m.P, I: m.I, caps: 0 };
  const nv = m.P.length / 3, P = new Float32Array(m.P.length + loops.length * 3); P.set(m.P);
  let ntri = 0; for (const l of loops) ntri += l.v.length;
  const I = new Uint32Array(m.I.length + ntri * 3); I.set(m.I); let o = m.I.length;
  loops.forEach((l, k) => {
    const ci = nv + k; P[ci * 3] = l.c[0]; P[ci * 3 + 1] = l.c[1]; P[ci * 3 + 2] = l.c[2];
    for (let i = 0; i < l.v.length; i++) { const a = l.v[i], b = l.v[(i + 1) % l.v.length]; I[o++] = b; I[o++] = a; I[o++] = ci; }
  });
  return { P, I, caps: loops.length };
}
// işaretli hacim (dışa bakan kapalı ağlarda pozitif)
export function signedVolume(m) {
  const { P, I } = m; let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}
// üç köşesi de süzgeçten geçen üçgenler
export function subMesh(m, filter) {
  const keep = []; const { P, I } = m;
  for (let t = 0; t < I.length; t += 3) if (filter(vert(P, I[t])) && filter(vert(P, I[t + 1])) && filter(vert(P, I[t + 2]))) keep.push(I[t], I[t + 1], I[t + 2]);
  return { P, I: Uint32Array.from(keep) };
}

// ---------------------------------------------------------------- uzaklıklar ve iç/dış sınamaları
// üçgen üzerindeki en yakın nokta (Ericson, Real-Time Collision Detection 5.1.5); sonucu out'a yazar, uzaklığın karesini döndürür
function closestOnTri(px, py, pz, P, ia, ib, ic, out) {
  const ax = P[ia], ay = P[ia + 1], az = P[ia + 2], bx = P[ib], by = P[ib + 1], bz = P[ib + 2], cx = P[ic], cy = P[ic + 1], cz = P[ic + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
    else if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); }
    else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
  }
  out[0] = qx; out[1] = qy; out[2] = qz;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}
// ağ üzerindeki kesin en yakın nokta (sınır kutusuyla elemeli kaba kuvvet; birkaç bin üçgen için yeterli)
export function closestPoint(m, p, maxD = Infinity) {
  const { P, I } = m; const o = [0, 0, 0]; let best = maxD < Infinity ? maxD * maxD : Infinity, bp = null, bt = -1;
  const [px, py, pz] = p;
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t] * 3, ib = I[t + 1] * 3, ic = I[t + 2] * 3;
    if (best < Infinity) {
      const lim = Math.sqrt(best);
      if (Math.min(P[ia], P[ib], P[ic]) > px + lim || Math.max(P[ia], P[ib], P[ic]) < px - lim ||
          Math.min(P[ia + 1], P[ib + 1], P[ic + 1]) > py + lim || Math.max(P[ia + 1], P[ib + 1], P[ic + 1]) < py - lim ||
          Math.min(P[ia + 2], P[ib + 2], P[ic + 2]) > pz + lim || Math.max(P[ia + 2], P[ib + 2], P[ic + 2]) < pz - lim) continue;
    }
    const d = closestOnTri(px, py, pz, P, ia, ib, ic, o);
    if (d < best) { best = d; bp = [o[0], o[1], o[2]]; bt = t / 3; }
  }
  return { p: bp, d: bp ? Math.sqrt(best) : Infinity, tri: bt };
}
// Genelleştirilmiş sarım sayısı (Jacobson ve ark. 2013): içeride ~1, dışarıda ~0; küçük deliklere ve dikişlere dayanıklı.
export function windingNumber(m, p) {
  const { P, I } = m; let w = 0; const [px, py, pz] = p;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a] - px, ay = P[a + 1] - py, az = P[a + 2] - pz, bx = P[b] - px, by = P[b + 1] - py, bz = P[b + 2] - pz, cx = P[c] - px, cy = P[c + 1] - py, cz = P[c + 2] - pz;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    w += 2 * Math.atan2(det, den);
  }
  return w / (4 * Math.PI);
}
export const isInside = (m, p) => Math.abs(windingNumber(m, p)) > 0.5;
// p noktasının ab doğru parçasına uzaklığı
export function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, mul(ab, t)));
}

// ---------------------------------------------------------------- voksel iç hacmi
// x, y ve z boyunca tarama çizgisi paritesi ve çoğunluk oyu: küçük bir delikten ya da dikişten geçen ışın yalnız kendi eksenini bozar.
// (i,j,k) vokselinin merkezi = o + (i+0.5, j+0.5, k+0.5) * h; inside: Uint8Array. Kesişme sayısı tek olan sütunlar
// çekimser kalır; tüm eksenlerin çekimser kaldığı ya da oyların eşit çıktığı vokselleri sarım sayısı belirler (nadir).
export function voxelize(m, h, pad = 2) {
  const { P, I } = m; const b = meshBounds(m);
  const jit = 0.1234567 * h;   // voksel merkezlerini tam simetri düzlemlerinden uzak tutar (birçok ağın x = 0 üzerinde köşeleri var)
  const o = [b.mn[0] - pad * h - jit, b.mn[1] - pad * h - jit * 0.7, b.mn[2] - pad * h - jit * 0.4];
  const n = [0, 1, 2].map(a => Math.ceil((b.mx[a] - o[a]) / h) + pad + 1);
  const [nx, ny, nz] = n, N = nx * ny * nz;
  const vote = new Int8Array(N), ambiguous = [];
  for (let ax = 0; ax < 3; ax++) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, nu = n[u], nvv = n[v];
    const cols = new Array(nu * nvv);
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
      const au = (P[A + u] - o[u]) / h - 0.5, av = (P[A + v] - o[v]) / h - 0.5;
      const bu = (P[B + u] - o[u]) / h - 0.5, bv = (P[B + v] - o[v]) / h - 0.5;
      const cu = (P[C + u] - o[u]) / h - 0.5, cv = (P[C + v] - o[v]) / h - 0.5;
      const den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv); if (Math.abs(den) < 1e-12) continue;
      const u0 = Math.max(0, Math.ceil(Math.min(au, bu, cu))), u1 = Math.min(nu - 1, Math.floor(Math.max(au, bu, cu)));
      const v0 = Math.max(0, Math.ceil(Math.min(av, bv, cv))), v1 = Math.min(nvv - 1, Math.floor(Math.max(av, bv, cv)));
      for (let iu = u0; iu <= u1; iu++) for (let iv = v0; iv <= v1; iv++) {
        const w1 = ((bv - cv) * (iu - cu) + (cu - bu) * (iv - cv)) / den, w2 = ((cv - av) * (iu - cu) + (au - cu) * (iv - cv)) / den, w3 = 1 - w1 - w2;
        if (w1 < 0 || w2 < 0 || w3 < 0) continue;
        const za = w1 * P[A + ax] + w2 * P[B + ax] + w3 * P[C + ax];
        const c = iu * nvv + iv; (cols[c] || (cols[c] = [])).push(za);
      }
    }
    const na = n[ax], stride = [1, nx, nx * ny], sa = stride[ax], su = stride[u], sv = stride[v];
    for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nvv; iv++) {
      const zs = cols[iu * nvv + iv], base = iu * su + iv * sv;
      if (!zs) { for (let ia = 0, q = base; ia < na; ia++, q += sa) vote[q]--; continue; }
      if (zs.length & 1) continue;                 // tek: ışın bir delikten, dikişten ya da kenardan geçti; çekimser
      zs.sort((p, q) => p - q);
      let k = 0;
      for (let ia = 0, q = base; ia < na; ia++, q += sa) {
        const z = o[ax] + (ia + 0.5) * h;
        while (k < zs.length && zs[k] < z) k++;
        vote[q] += (k & 1) ? 1 : -1;
      }
    }
  }
  const inside = new Uint8Array(N); let count = 0;
  for (let i = 0; i < N; i++) {
    if (vote[i] > 0) { inside[i] = 1; count++; }
    else if (vote[i] === 0) ambiguous.push(i);
  }
  let fixed = 0;
  for (const i of ambiguous) if (Math.abs(windingNumber(m, gridPoint({ o, h, n }, i))) > 0.5) { inside[i] = 1; count++; fixed++; }
  return { o, h, n, inside, count, ambiguous: ambiguous.length, fixedByWinding: fixed };
}
export function gridPoint(g, i) {
  const nx = g.n[0], ny = g.n[1]; const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
  return [g.o[0] + (x + 0.5) * g.h, g.o[1] + (y + 0.5) * g.h, g.o[2] + (z + 0.5) * g.h];
}
export function gridIndex(g, p) {
  const i = Math.floor((p[0] - g.o[0]) / g.h), j = Math.floor((p[1] - g.o[1]) / g.h), k = Math.floor((p[2] - g.o[2]) / g.h);
  if (i < 0 || j < 0 || k < 0 || i >= g.n[0] || j >= g.n[1] || k >= g.n[2]) return -1;
  return (k * g.n[1] + j) * g.n[0] + i;
}
// Kesin öklid uzaklık dönüşümü (Felzenszwalb & Huttenlocher): her iç voksel merkezinden en yakın dış voksel merkezine
// uzaklık (cm); dışarıda 0. Duvar bu değerden yaklaşık h/2 daha yakındadır.
export function distanceField(g) {
  const [nx, ny, nz] = g.n, N = nx * ny * nz, ins = g.inside;
  const f = new Float32Array(N);
  // 1. geçiş (x satırları, ikili girdi): satırdaki en yakın dış voksele uzaklığın karesi, iki taramayla
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const s0 = (k * ny + j) * nx; let any = false;
    for (let i = 0; i < nx; i++) if (ins[s0 + i]) { any = true; break; }
    if (!any) continue;
    let last = -1e9;
    for (let i = 0; i < nx; i++) { if (!ins[s0 + i]) last = i; f[s0 + i] = i - last; }
    last = 1e9;
    for (let i = nx - 1; i >= 0; i--) { if (!ins[s0 + i]) last = i; const dd = Math.min(f[s0 + i], last - i); f[s0 + i] = dd * dd; }
  }
  // 2. ve 3. geçiş: parabollerin alt zarfı; iç vokseli olmayan satırlar atlanır
  const mx = Math.max(nx, ny, nz), buf = new Float64Array(mx), out = new Float64Array(mx), v = new Int32Array(mx), z = new Float64Array(mx + 1);
  const line = (s0, count, stride) => {
    let any = false; for (let q = 0; q < count; q++) { const x = f[s0 + q * stride]; buf[q] = x; if (x) any = true; }
    if (!any) return;
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < count; q++) {
      let sv = ((buf[q] + q * q) - (buf[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (sv <= z[k]) { k--; sv = ((buf[q] + q * q) - (buf[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = sv; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < count; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + buf[v[k]]; }
    for (let q = 0; q < count; q++) f[s0 + q * stride] = out[q];
  };
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) line(k * ny * nx + i, ny, nx);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) line(j * nx + i, nz, nx * ny);
  for (let i = 0; i < N; i++) f[i] = ins[i] ? Math.sqrt(f[i]) * g.h : 0;
  return f;
}
// p noktasında üç doğrusal uzaklık alanı değeri (ızgaranın dışında 0)
export function fieldAt(g, d, p) {
  const fx = (p[0] - g.o[0]) / g.h - 0.5, fy = (p[1] - g.o[1]) / g.h - 0.5, fz = (p[2] - g.o[2]) / g.h - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), [nx, ny, nz] = g.n;
  if (i < 0 || j < 0 || k < 0 || i + 1 >= nx || j + 1 >= ny || k + 1 >= nz) return 0;
  const tx = fx - i, ty = fy - j, tz = fz - k; let s = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
    s += d[((k + dk) * ny + (j + dj)) * nx + (i + di)] * (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
  }
  return s;
}
// p'ye en yakın, uzaklık değeri en az minD olan iç voksel. p çevresinde yarıçapı büyüyen küp kabuklarda arar;
// böylece maliyet ızgara boyutuna değil cevabın uzaklığına bağlıdır; bulamazsa en derin vokseli döndürür.
export function nearestInterior(g, d, p, minD = 0, maxR = Infinity) {
  const [nx, ny, nz] = g.n, h = g.h, ins = g.inside;
  const cl = (v, n) => Math.min(n - 1, Math.max(0, v));
  const ci = cl(Math.floor((p[0] - g.o[0]) / h), nx), cj = cl(Math.floor((p[1] - g.o[1]) / h), ny), ck = cl(Math.floor((p[2] - g.o[2]) / h), nz);
  const R = Math.max(nx, ny, nz); let best = -1, bd = Infinity;
  for (let r = 0; r <= R; r++) {
    if ((best >= 0 && (r - 1) * h > bd) || (r - 1) * h > maxR) break;
    for (let dk = -r; dk <= r; dk++) {
      const k = ck + dk; if (k < 0 || k >= nz) continue;
      for (let dj = -r; dj <= r; dj++) {
        const j = cj + dj; if (j < 0 || j >= ny) continue;
        const full = Math.abs(dk) === r || Math.abs(dj) === r, step = full ? 1 : (2 * r || 1);
        for (let di = -r; di <= r; di += step) {
          const i = ci + di; if (i < 0 || i >= nx) continue;
          const q = (k * ny + j) * nx + i; if (!ins[q] || d[q] < minD) continue;
          const s2 = Math.hypot(g.o[0] + (i + 0.5) * h - p[0], g.o[1] + (j + 0.5) * h - p[1], g.o[2] + (k + 0.5) * h - p[2]);
          if (s2 < bd && s2 <= maxR) { bd = s2; best = q; }
        }
      }
    }
  }
  if (best >= 0) return best;
  let deep = -1, dd = -1; for (let q = 0; q < d.length; q++) if (d[q] > dd) { dd = d[q]; deep = q; }
  return deep;
}

// ---------------------------------------------------------------- voksel iç hacminde en kısa yollar
class Heap {
  constructor() { this.k = []; this.v = []; this.lastKey = 0; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0]; this.lastKey = k[0]; const lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}
const NB = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NB.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);
// iç voksellerin ardışık numaralandırması: list[c] = voksel indisi, cid[voksel] = c ya da -1
export function compactIndex(g) {
  const N = g.inside.length, cid = new Int32Array(N).fill(-1), list = new Int32Array(g.count); let c = 0;
  for (let i = 0; i < N; i++) if (g.inside[i]) { cid[i] = c; list[c++] = i; }
  return { cid, list };
}
// İç vokseller üzerinde Dijkstra (26 komşuluk). it: iç hacim (g, cid, list); W: her ardışık numaralı voksel için
// birim uzunluk başına maliyet katsayısı; sources / target: voksel indisleri. Dönüş ardışık numaralar üzerinden { dist, prev }.
export function voxelDijkstra(it, sources, W, target = -1) {
  const { g, cid, list } = it, [nx, ny] = g.n, n = list.length;
  const D = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const off = new Int32Array(26), L = new Float64Array(26);
  NB.forEach(([dx, dy, dz, l], q) => { off[q] = (dz * ny + dy) * nx + dx; L[q] = l * g.h * 0.5; });
  const h = new Heap(), tc = target >= 0 ? cid[target] : -1;
  for (const s of sources) { const c = cid[s]; if (c < 0) continue; D[c] = 0; h.push(0, c); }
  // iç vokseller ızgara kenarından en az iki voksel uzakta (dolgu payı), bu yüzden komşular için sınır denetimi gerekmez
  while (h.size) {
    const c = h.pop(); const dc = D[c]; if (h.lastKey > dc) continue; if (c === tc) break;
    const i = list[c], wc = W[c];
    for (let q = 0; q < 26; q++) {
      const cj = cid[i + off[q]]; if (cj < 0) continue;
      const nd = dc + L[q] * (wc + W[cj]);
      if (nd < D[cj]) { D[cj] = nd; prev[cj] = c; h.push(nd, cj); }
    }
  }
  return { dist: D, prev };
}
// yolları orta eksende tutan maliyet katsayısı: en derin voksellerde 1, duvarda ~1/eps^2
export function medialWeights(it, eps = 0.05) {
  const W = new Float64Array(it.list.length);
  for (let c = 0; c < W.length; c++) { const r = it.d[it.list[c]] / it.dmax + eps; W[c] = 1 / (r * r); }
  return W;
}
export function tracePath(it, prev, targetVoxel) {
  const out = []; for (let c = it.cid[targetVoxel]; c >= 0; c = prev[c]) out.push(gridPoint(it.g, it.list[c]));
  return out.reverse();
}
// tek bir iç hacimdeki iki nokta arasında orta eksen yolu (uç noktalar en az min(2h, dmax/2) derindeki voksellere oturtulur)
export function medialPath(it, a, b) {
  const md = Math.min(it.dmax * 0.5, 2 * it.g.h);
  const ia = nearestInterior(it.g, it.d, a, md), ib = nearestInterior(it.g, it.d, b, md);
  const { prev } = voxelDijkstra(it, [ia], it.W, ib);
  return tracePath(it, prev, ib);
}

// ---------------------------------------------------------------- çoklu çizgiler ve eğriler
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }
// çoklu çizgiyi (yaklaşık) eşit yay uzunluğu adımlarıyla yeniden örnekle; iki ucu da korur
export function resample(pts, step) {
  const L = polyLength(pts); const n = Math.max(1, Math.round(L / step)); const out = [pts[0]];
  let seg = 0, acc = 0;
  for (let k = 1; k < n; k++) {
    const target = (L * k) / n;
    while (seg < pts.length - 2 && acc + dist(pts[seg], pts[seg + 1]) < target) { acc += dist(pts[seg], pts[seg + 1]); seg++; }
    const l = dist(pts[seg], pts[seg + 1]) || 1;
    out.push(lerp(pts[seg], pts[seg + 1], Math.min(1, (target - acc) / l)));
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// Uçları sabit Laplace yumuşatması; bir kaydırma yalnız ok(nokta) doğru kalırsa tutulur
export function smoothPath(pts, ok, iters = 30, lambda = 0.5) {
  const p = pts.map(q => q.slice());
  for (let it = 0; it < iters; it++) for (let i = 1; i < p.length - 1; i++) {
    const t = lerp(p[i], lerp(p[i - 1], p[i + 1], 0.5), lambda);
    if (ok(t)) p[i] = t;
  }
  return p;
}
// Merkezcil Catmull-Rom; sayısal olarak THREE.CatmullRomCurve3(points, false, 'centripetal').getPoint(t) ile aynı
export function catmullRomPoint(pts, t) {
  const l = pts.length; const p = (l - 1) * t; let ip = Math.floor(p), w = p - ip;
  if (w === 0 && ip === l - 1) { ip = l - 2; w = 1; }
  const p0 = ip > 0 ? pts[ip - 1] : sub(mul(pts[0], 2), pts[1]);
  const p1 = pts[ip], p2 = pts[ip + 1];
  const p3 = ip + 2 < l ? pts[ip + 2] : sub(mul(pts[l - 1], 2), pts[l - 2]);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let dt0 = Math.pow(d2(p0, p1), 0.25), dt1 = Math.pow(d2(p1, p2), 0.25), dt2 = Math.pow(d2(p2, p3), 0.25);
  if (dt1 < 1e-4) dt1 = 1; if (dt0 < 1e-4) dt0 = dt1; if (dt2 < 1e-4) dt2 = dt1;
  const out = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const x0 = p0[a], x1 = p1[a], x2 = p2[a], x3 = p3[a];
    let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
    let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
    t1 *= dt1; t2 *= dt1;
    const c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
    out[a] = c0 + c1 * w + c2 * w * w + c3 * w * w * w;
  }
  return out;
}
// eğrinin sık örnekleri: kontrol noktası aralığı başına perSeg örnek (THREE'de aralıklar eşit t aralıklarına karşılık gelir)
export function sampleCurve(ctrl, perSeg = 24) {
  const n = (ctrl.length - 1) * perSeg, out = [];
  for (let i = 0; i <= n; i++) out.push(catmullRomPoint(ctrl, i / n));
  return out;
}
// Sık bir yol boyunca kontrol noktaları: içlerinden geçen Catmull-Rom, ok(örnek) doğru olan yerlerde kalır.
// Her `spacing` cm'de bir noktayla başlar, başarısız aralıklara yol noktaları ekler (uyarlamalı inceltme).
export function fitControlPoints(path, ok, spacing, maxIter = 12) {
  const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  const L = cum[cum.length - 1]; const nSeg = Math.max(2, Math.round(L / spacing));
  let sel = []; for (let k = 0; k <= nSeg; k++) { const target = (L * k) / nSeg; let j = 0; while (j < path.length - 1 && cum[j] < target) j++; if (!sel.includes(j)) sel.push(j); }
  if (sel[sel.length - 1] !== path.length - 1) sel.push(path.length - 1);
  for (let it = 0; it < maxIter; it++) {
    const ctrl = sel.map(j => path[j]); const bad = new Set(); const per = 24;
    for (let s = 0; s < ctrl.length - 1; s++) for (let q = 0; q <= per; q++) {
      if (!ok(catmullRomPoint(ctrl, (s + q / per) / (ctrl.length - 1)))) { bad.add(s); break; }
    }
    if (!bad.size) return { ctrl, iterations: it, fitted: true };
    const next = [];
    for (let s = 0; s < sel.length; s++) {
      next.push(sel[s]);
      if (bad.has(s) && s + 1 < sel.length && sel[s + 1] - sel[s] > 1) next.push(Math.round((sel[s] + sel[s + 1]) / 2));
    }
    if (next.length === sel.length) return { ctrl, iterations: it, fitted: false };
    sel = next;
  }
  return { ctrl: sel.map(j => path[j]), iterations: maxIter, fitted: false };
}
// Çizilen eğriyi örnekler ve ölçer. test(p) -> { inside: bool, clear: duvara cm (dışarıda negatif) }.
export function checkCurve(ctrl, test, perSeg = 24) {
  const s = sampleCurve(ctrl, perSeg); let out = 0, minClear = Infinity, at = null, sum = 0;
  for (const p of s) { const r = test(p); if (!r.inside) out++; if (r.clear < minClear) { minClear = r.clear; at = p; } sum += r.clear; }
  return { samples: s.length, outside: out, minClear, minAt: at, meanClear: sum / s.length, length: polyLength(s) };
}

// ---------------------------------------------------------------- ventriküllerin iç hacimleri
// Tek bir ağın voksel iç hacmi + uzaklık alanı + orta eksen ağırlıkları. h verilmezse sınır kutusunda yaklaşık 200k voksel olacak şekilde seçilir.
export function interior(m, h, name = '') {
  const b = meshBounds(m); const bv = (b.mx[0] - b.mn[0]) * (b.mx[1] - b.mn[1]) * (b.mx[2] - b.mn[2]);
  const hh = h || Math.cbrt(bv / 200000);
  const g = voxelize(m, hh); const d = distanceField(g);
  let dmax = 0, deep = -1; for (let i = 0; i < d.length; i++) if (d[i] > dmax) { dmax = d[i]; deep = i; }
  const it = { name, m, g, d, dmax, deep, h: hh, volume: g.count * hh ** 3, ...compactIndex(g) };
  it.W = medialWeights(it);
  return it;
}
export const depth = (it, p) => fieldAt(it.g, it.d, p);           // ~ duvara uzaklık + h/2 (dışarıda 0)
export const insideGrid = (it, p) => { const i = gridIndex(it.g, p); return i >= 0 && it.g.inside[i] === 1; };
export const interiorNear = (it, p, minD) => gridPoint(it.g, nearestInterior(it.g, it.d, p, minD));

// İki ağın en yakın noktaları (köşelerle ön süzme, kesin nokta-üçgen inceltmesi). filterB(p) B ağını bir anatomik
// pencereyle sınırlar. Dönüş { a: A üzerindeki nokta, b: B üzerindeki nokta, gap }.
export function closestApproach(A, B, filterB = null, keep = 24) {
  const PA = A.P, PB = B.P, cand = [];
  const nb = PB.length / 3, okB = new Uint8Array(nb);
  for (let j = 0; j < nb; j++) okB[j] = !filterB || filterB(vert(PB, j)) ? 1 : 0;
  for (let i = 0; i < PA.length; i += 3) {
    let best = Infinity, bj = -1;
    for (let j = 0; j < nb; j++) { if (!okB[j]) continue; const d = (PA[i] - PB[j * 3]) ** 2 + (PA[i + 1] - PB[j * 3 + 1]) ** 2 + (PA[i + 2] - PB[j * 3 + 2]) ** 2; if (d < best) { best = d; bj = j; } }
    if (bj >= 0) cand.push([best, i / 3, bj]);
  }
  cand.sort((x, y) => x[0] - y[0]);
  const Bf = filterB ? subMesh(B, filterB) : B;
  let best = { gap: Infinity };
  for (const [, i, j] of cand.slice(0, keep)) {
    const pa = vert(PA, i), cb = closestPoint(Bf, pa);
    if (cb.d < best.gap) best = { a: pa, b: cb.p, gap: cb.d };
    const pb = vert(PB, j), ca = closestPoint(A, pb);
    if (ca.d < best.gap) best = { a: ca.p, b: pb, gap: ca.d };
  }
  for (let k = 0; k < 4; k++) { const cb = closestPoint(Bf, best.a); const ca = closestPoint(A, cb.p); const gp = dist(ca.p, cb.p); if (gp < best.gap - 1e-6) best = { a: ca.p, b: cb.p, gap: gp }; else break; }
  return best;
}
// ana eksen (köşelerin kovaryansı üzerinde kuvvet yinelemesi)
export function principalAxis(m) {
  const P = m.P, n = P.length / 3, c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) c[a] += P[i * 3 + a] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) { const d = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b] / n; }
  let v = [0.3, 0.9, 0.2]; for (let it = 0; it < 60; it++) v = norm([dot(C[0], v), dot(C[1], v), dot(C[2], v)]);
  return { c, v };
}
// Uzun bir yapının ana ekseni boyunca iki ucu: uzanımın ilk ve son `frac` kesimindeki köşelerin ağırlık merkezi;
// `towards` noktasına yakın olan uç önce gelir.
export function axisEnds(m, towards, frac = 0.06) {
  const { c, v } = principalAxis(m), P = m.P, n = P.length / 3; let lo = Infinity, hi = -Infinity; const s = [];
  for (let i = 0; i < n; i++) { const t = dot(sub(vert(P, i), c), v); s.push(t); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const end = sel => { const q = [0, 0, 0]; let k = 0; for (let i = 0; i < n; i++) if (sel(s[i])) { for (let a = 0; a < 3; a++) q[a] += P[i * 3 + a]; k++; } return mul(q, 1 / k); };
  const w = (hi - lo) * frac; let A = end(t => t <= lo + w), B = end(t => t >= hi - w);
  if (towards && dist(B, towards) < dist(A, towards)) [A, B] = [B, A];
  return [A, B];
}
// Yan ventrikül: iç hacmin jeodezik uç noktaları olarak üç uç (ön = en öndeki, arka = en arkadaki, alt = üçüncüsü),
// ön uçtan orta eksen iskelet yolları ve bunların ayrılma noktası (atrium).
// Yalnız rapor için (yan başına yaklaşık 100 ms): akış çizgisinin buna ihtiyacı yok.
export function lateralVentricleParts(lv) {
  const unit = new Float64Array(lv.list.length).fill(1);
  const far = D => { let b = -1, bd = -1; for (let c = 0; c < D.length; c++) if (D[c] < Infinity && D[c] > bd) { bd = D[c]; b = c; } return lv.list[b]; };
  const A = far(voxelDijkstra(lv, [lv.deep], unit).dist);
  const DA = voxelDijkstra(lv, [A], unit).dist; const B = far(DA);
  const DB = voxelDijkstra(lv, [B], unit).dist;
  let C = -1, cd = -1; for (let c = 0; c < DA.length; c++) if (DA[c] < Infinity) { const m = Math.min(DA[c], DB[c]); if (m > cd) { cd = m; C = lv.list[c]; } }
  const tips = [A, B, C].map(i => ({ i, p: gridPoint(lv.g, i) })).sort((x, y) => y.p[2] - x.p[2]);   // z'ye göre: önce ön
  const anterior = tips[0], inferior = tips[1], posterior = tips[2];
  const { prev } = voxelDijkstra(lv, [anterior.i], lv.W);
  const chain = t => { const out = []; for (let c = lv.cid[t]; c >= 0; c = prev[c]) out.push(lv.list[c]); return out.reverse(); };
  const toPost = chain(posterior.i), toInf = chain(inferior.i);
  let k = 0; while (k < toPost.length && k < toInf.length && toPost[k] === toInf[k]) k++;
  const branch = toPost[Math.max(0, k - 1)];
  const pts = ch => ch.map(i => gridPoint(lv.g, i));
  return { anterior: anterior.p, posterior: posterior.p, inferior: inferior.p, atrium: gridPoint(lv.g, branch), atriumDepth: lv.d[branch],
    toPosterior: pts(toPost), toInferior: pts(toInf), radPost: toPost.map(i => lv.d[i]), radInf: toInf.map(i => lv.d[i]), common: k };
}
// Plexus choroideus: glomus = pleksusun en arkadaki `depthCm` kesimindeki köşelerinin ağırlık merkezi (atriumdaki kabarıklık);
// pleksus köşelerinin yan ventrikülün ve (verilmişse) diğer iç hacimlerin içinde kalan payı.
export function plexusFacts(plexus, lv, others = {}, depthCm = 0.6) {
  const P = plexus.P, n = P.length / 3; let zmin = Infinity; for (let i = 0; i < n; i++) zmin = Math.min(zmin, P[i * 3 + 2]);
  const q = [0, 0, 0]; let k = 0; for (let i = 0; i < n; i++) if (P[i * 3 + 2] < zmin + depthCm) { for (let a = 0; a < 3; a++) q[a] += P[i * 3 + a]; k++; }
  const glomus = mul(q, 1 / k);
  const share = it => { let c = 0; for (let i = 0; i < n; i++) if (insideGrid(it, vert(P, i))) c++; return c / n; };
  const res = { glomus, vertices: n, inLV: lv ? share(lv) : null };
  for (const [key, it] of Object.entries(others)) res['in' + key] = share(it);
  return res;
}
// IV. ventrikülün çıkışları. Magendie: orta hat bandında, Recessus laterales'in altındaki en arka köşe (çatının kaudal
// köşesi, Cisterna magna'ya açılır). Luschka: Recessus laterales'in uçları (en uç x değerleri).
export function fourthVentricleExits(v4) {
  const P = v4.P, n = P.length / 3; const b = meshBounds(v4);
  let li = -1, ri = -1; for (let i = 0; i < n; i++) { if (li < 0 || P[i * 3] > P[li * 3]) li = i; if (ri < 0 || P[i * 3] < P[ri * 3]) ri = i; }
  const yRecess = (P[li * 3 + 1] + P[ri * 3 + 1]) / 2, half = (b.mx[0] - b.mn[0]) / 2;
  let mi = -1, fi = -1;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (Math.abs(x) > 0.25 * half) continue;
    if (y < yRecess && (mi < 0 || z < P[mi * 3 + 2])) mi = i;
    if (y > yRecess && (fi < 0 || z < P[fi * 3 + 2])) fi = i;
  }
  return { magendie: vert(P, mi), luschkaL: vert(P, li), luschkaR: vert(P, ri), fastigium: vert(P, fi), yRecess };
}

// ---------------------------------------------------------------- ventriküllerin içinden akış çizgisi
// parts: { lv: { l, r }, plexus: { l, r }, v3, aq, v4 }, { P, I } ağları olarak (dünya uzayı).
// Dönüş { curves: [{ key, ctrl, dense, ok, fitted }], keys, interiors, timings }.
//   'lv.l' / 'lv.r': glomus (atrium) -> gövde -> Foramen interventriculare (Monro) -> III. ventrikülün girişi (ikisi de orada biter);
//   'main': III. ventrikül -> aquaeductus -> IV. ventrikül -> Apertura mediana -> Cisterna magna'nın 0.3 cm içine;
//   'luschka.l' / 'luschka.r': ana çizgiden, Recessus laterales hizasından, uçlarının 0.3 cm ötesine.
//   ctrl: THREE.CatmullRomCurve3(ctrl, false, 'centripetal') için kontrol noktaları, voksel iç hacimlerine göre sınanmış.
export function ventricularFlow(parts, opt = {}) {
  const T = {}; let t0 = now();
  const it = {
    lvl: interior(parts.lv.l, opt.hLV || 0.1, 'Lateral ventricle.l'), lvr: interior(parts.lv.r, opt.hLV || 0.1, 'Lateral ventricle.r'),
    v3: interior(parts.v3, opt.hV3 || 0.04, 'Third ventricle'), aq: interior(parts.aq, opt.hAq || 0.018, 'Aqueduct of midbrain'),
    v4: interior(parts.v4, opt.hV4 || 0.055, 'Fourth ventricle'),
  };
  T.interiors = now() - t0; t0 = now();
  const b3 = meshBounds(parts.v3), c3 = mul(add(b3.mn, b3.mx), 0.5);
  const win = p => p[1] > c3[1] && p[2] > c3[2];            // III. ventrikülün ön-üst çeyreği
  const monro = { l: closestApproach(parts.lv.l, parts.v3, win), r: closestApproach(parts.lv.r, parts.v3, win) };
  const glomus = { l: plexusFacts(parts.plexus.l, null).glomus, r: plexusFacts(parts.plexus.r, null).glomus };
  const [aqTop, aqBot] = axisEnds(parts.aq, c3);
  const ex = fourthVentricleExits(parts.v4);
  T.keys = now() - t0; t0 = now();
  // eğri örneklerinin gereken derinliği: 0.12 cm ile en derin vokselin %30'undan küçüğü, ama hiçbir zaman o yapıdan geçen
  // orta eksen yolunun en sığ noktasının %75'inden fazla değil (dar geçitler: aquaeductus, IV. ventrikülün kaudal kısmı)
  const thrOf = new Map();
  const thr = I => thrOf.get(I) ?? Math.max(1.5 * I.h, Math.min(0.12, 0.3 * I.dmax));
  const tune = (I, path) => { let m = Infinity; for (let i = 3; i < path.length - 3; i++) m = Math.min(m, depth(I, path[i])); if (m < Infinity) thrOf.set(I, Math.max(1.5 * I.h, Math.min(thr(I), 0.75 * m))); };
  const deepOK = (I, p) => depth(I, p) >= thr(I);
  const corridor = (segs, r) => p => segs.some(([a, b]) => segDist(p, a, b) <= r);
  const curves = [];
  // yan ventriküller: glomus -> Monro -> III. ventrikülün ortak giriş noktası
  const v3Entry = interiorNear(it.v3, mul(add(monro.l.b, monro.r.b), 0.5), Math.min(0.15, 0.5 * it.v3.dmax));
  for (const sd of ['l', 'r']) {
    const I = sd === 'l' ? it.lvl : it.lvr, M = monro[sd];
    const start = interiorNear(I, glomus[sd], Math.min(0.3, 0.5 * I.dmax));
    const lvEnd = interiorNear(I, M.a, 2 * I.h);
    const v3In = interiorNear(it.v3, M.b, 2 * it.v3.h);
    const pLV = medialPath(I, start, lvEnd); tune(I, pLV);
    const path = [...pLV, M.a, M.b, v3In, v3Entry];
    const gap = [[lvEnd, M.a], [M.a, M.b], [M.b, v3In], [v3In, v3Entry]];
    const ok = p => deepOK(I, p) || deepOK(it.v3, p) || corridor(gap, Math.max(0.08, 0.6 * M.gap))(p);
    const dense = smoothPath(resample(path, 0.1), ok, opt.smooth || 12, 0.5);
    curves.push({ key: 'lv.' + sd, dense, ok, ...fitControlPoints(dense, ok, opt.spacingLV || 1.0) });
  }
  // III. ventrikül -> aquaeductus -> IV. ventrikül -> Apertura mediana
  const aqTopIn = interiorNear(it.aq, aqTop, 0.6 * it.aq.dmax), aqBotIn = interiorNear(it.aq, aqBot, 0.6 * it.aq.dmax);
  const v3Out = interiorNear(it.v3, aqTop, 2 * it.v3.h);
  const v4In = interiorNear(it.v4, aqBot, 2 * it.v4.h);
  const magIn = interiorNear(it.v4, ex.magendie, Math.min(0.1, 0.4 * it.v4.dmax));
  const magOut = add(ex.magendie, mul(norm(sub(ex.magendie, magIn)), 0.3));
  const p3 = medialPath(it.v3, v3Entry, v3Out);
  const pa = medialPath(it.aq, aqTopIn, aqBotIn);
  const p4 = medialPath(it.v4, v4In, magIn);
  tune(it.v3, p3); tune(it.aq, pa); tune(it.v4, p4);
  const mainPath = [...p3, aqTopIn, ...pa, aqBotIn, v4In, ...p4, ex.magendie, magOut];
  const jMain = [[p3[p3.length - 1], aqTopIn], [aqBotIn, v4In], [p4[p4.length - 1], ex.magendie], [ex.magendie, magOut]];
  const okMain = p => deepOK(it.v3, p) || deepOK(it.aq, p) || deepOK(it.v4, p) || corridor(jMain, 0.08)(p);
  const denseMain = smoothPath(resample(mainPath, 0.05), okMain, opt.smooth || 12, 0.5);
  curves.push({ key: 'main', dense: denseMain, ok: okMain, ...fitControlPoints(denseMain, okMain, opt.spacingMain || 0.5) });
  // Aperturae laterales: Recessus laterales hizasında ana çizgiden ayrılan dal
  let bi = 0; for (let i = 0; i < p4.length; i++) if (Math.abs(p4[i][1] - ex.yRecess) < Math.abs(p4[bi][1] - ex.yRecess)) bi = i;
  for (const sd of ['l', 'r']) {
    const tip = sd === 'l' ? ex.luschkaL : ex.luschkaR;
    const tipIn = interiorNear(it.v4, tip, 1.5 * it.v4.h);
    const out = add(tip, mul(norm(sub(tip, tipIn)), 0.3));
    const pl = medialPath(it.v4, p4[bi], tipIn);
    const okL = p => depth(it.v4, p) >= 1.5 * it.v4.h || corridor([[pl[pl.length - 1], tip], [tip, out]], 0.08)(p);
    const dense = smoothPath(resample([...pl, tip, out], 0.05), okL, opt.smooth || 12, 0.5);
    curves.push({ key: 'luschka.' + sd, dense, ok: okL, ...fitControlPoints(dense, okL, 0.4) });
  }
  T.paths = now() - t0;
  const keys = { glomus, monro, v3Entry, aqTop, aqBot, magendie: ex.magendie, magendieOut: magOut, luschkaL: ex.luschkaL, luschkaR: ex.luschkaR, fastigium: ex.fastigium, branch4: p4[bi] };
  const thresholds = Object.fromEntries(Object.entries(it).map(([k, I]) => [k, thr(I)]));
  return { curves, keys, interiors: it, thresholds, timings: T };
}

// ---------------------------------------------------------------- subaraknoid yol (şematik; bu aralık modelde yok)
// Ağların x = x0 düzlemiyle kesişimi: (z, y) düzleminde doğru parçaları, düz dizi olarak [z0, y0, z1, y1, ...].
export function sliceX(meshes, x0) {
  const out = [];
  for (const m of meshes) {
    const { P, I } = m;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const da = P[a] - x0, db = P[b] - x0, dc = P[c] - x0;
      if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
      const pts = [];
      const edge = (i, j, di, dj) => { if ((di > 0) !== (dj > 0) && di !== dj) { const s = di / (di - dj); pts.push(P[i + 2] + (P[j + 2] - P[i + 2]) * s, P[i + 1] + (P[j + 1] - P[i + 1]) * s); } };
      edge(a, b, da, db); edge(b, c, db, dc); edge(c, a, dc, da);
      if (pts.length >= 4) out.push(pts[0], pts[1], pts[2], pts[3]);
    }
  }
  return Float64Array.from(out);
}
// 2B ışın C + t*dir ile doğru parçalarının tüm kesişimleri (ışın parametreleri t > 0, sıralı)
function rayHits(segs, cz, cy, dz, dy) {
  const out = [];
  for (let k = 0; k < segs.length; k += 4) {
    const z0 = segs[k], y0 = segs[k + 1], ez = segs[k + 2] - z0, ey = segs[k + 3] - y0;
    const den = dz * ey - dy * ez; if (Math.abs(den) < 1e-12) continue;
    const wz = z0 - cz, wy = y0 - cy;
    const t = (wz * ey - wy * ez) / den, s = (wz * dy - wy * dz) / den;
    if (t > 0 && s >= 0 && s <= 1) out.push(t);
  }
  return out.sort((p, q) => p - q);
}
// (z, y) noktasından doğru parçalarına 2B uzaklık
function segs2dDist(segs, z, y) {
  let best = Infinity;
  for (let k = 0; k < segs.length; k += 4) {
    const z0 = segs[k], y0 = segs[k + 1], ez = segs[k + 2] - z0, ey = segs[k + 3] - y0, l2 = ez * ez + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((z - z0) * ez + (y - y0) * ey) / l2)) : 0;
    const d = (z0 + ez * t - z) ** 2 + (y0 + ey * t - y) ** 2; if (d < best) best = d;
  }
  return Math.sqrt(best);
}
// `start` noktasından (Apertura mediana çıkışı) Cisterna magna'dan geçip beyinciğin, oksipital lobun ve konveksitenin
// üstünden `end` noktasına (verteks yakınında, Sinus sagittalis superior içinde bir nokta) giden yol; parasagital x = side * xs
// düzleminde (falx'tan uzakta; yol son kısmında sinüse döner). Işınlar bu düzlemde `center` noktasından dışarı doğru
// atılır; her ışın boyunca en dıştaki beyin yüzeyi komşu ışınlara genişletilir (araknoid sulkusların üstünden köprü kurar)
// ve yumuşatılır. Yol bunun `off` cm dışındadır, ama hiçbir zaman kafatasının iç tablasına kalan boşluğun yarısından
// öteye geçmez (bu modelde beyin kafatasını doldurur: boşluk çoğu zaman 0.3 cm'nin altında) ve en az `minOff` dışarıdadır.
// brain: korteks, beyincik ve beyin sapı ağları; skull: kafatası kemikleri (isteğe bağlı).
export function subarachnoidRoute(brain, opt) {
  const { start, end, side = 1, xs = 1.0, off = 0.4, minOff = 0.12, stepDeg = 1, dilate = 4, smooth = 3, blend = 0.12, skull = null } = opt;
  const x0 = side * xs, segs = sliceX(brain, x0), bone = skull ? sliceX(skull, x0) : null;
  const bb = meshBounds(...brain), C = opt.center || [(bb.mn[2] + bb.mx[2]) / 2, (bb.mn[1] + bb.mx[1]) / 2];   // (z, y): beynin merkezi
  const ang = (z, y) => Math.atan2(-(z - C[0]), y - C[1]);       // 0 = yukarı, +90 derece = arka, 180 = aşağı
  // Cisterna magna: apertura ile arka-aşağı yönde ilk engel (beyin ya da kemik) arasının yarısı
  const cmPlane = opt.cmX ?? side * 0.3, cmSegs = sliceX(brain, cmPlane), cmBone = skull ? sliceX(skull, cmPlane) : new Float64Array(0);
  const dirCM = norm([0, -0.55, -1]);
  const free = Math.min(rayHits(cmSegs, start[2], start[1], dirCM[2], dirCM[1]).find(t => t > 0.15) ?? 2, rayHits(cmBone, start[2], start[1], dirCM[2], dirCM[1])[0] ?? 2);
  const cm = [cmPlane, start[1] + dirCM[1] * free * 0.5, start[2] + dirCM[2] * free * 0.5];
  const a0 = ang(cm[2], cm[1]), a1 = ang(end[2], end[1]);
  const n = Math.max(8, Math.round(Math.abs(a0 - a1) / (stepDeg * Math.PI / 180)));
  const phis = [], rb = [], rsk = [];
  for (let i = 0; i <= n; i++) {
    const p = a0 + (a1 - a0) * i / n, dz = -Math.sin(p), dy = Math.cos(p); phis.push(p);
    const hb = rayHits(segs, C[0], C[1], dz, dy); rb.push(hb.length ? hb[hb.length - 1] : 0);
    rsk.push(bone ? rayHits(bone, C[0], C[1], dz, dy) : []);
  }
  const rd = rb.map((_, i) => { let m = 0; for (let k = -dilate; k <= dilate; k++) { const j = i + k; if (j >= 0 && j <= n) m = Math.max(m, rb[j]); } return m; });
  const rs = rd.map((_, i) => { let s2 = 0, w = 0; for (let k = -smooth; k <= smooth; k++) { const j = i + k; if (j >= 0 && j <= n) { s2 += rd[j]; w++; } } return s2 / w; });
  const gap = [], R = [];
  for (let i = 0; i <= n; i++) {
    let o = off, gp = null;
    if (bone) {
      const hits = rsk[i], inner = hits.find(t => t > rs[i]), before = hits.filter(t => t <= rs[i]).length;
      if (inner !== undefined && before % 2 === 0) { gp = inner - rs[i]; o = Math.max(minOff, Math.min(off, 0.5 * gp)); }
      else if (before % 2 === 1) { gp = 0; o = minOff; }                   // beyin yüzeyi kemiğin içinde (örtüşme)
    }
    gap.push(gp); R.push(rs[i] + o);
  }
  const Rs = R.map((_, i) => { let s2 = 0, w = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j <= n) { s2 += R[j]; w++; } } return s2 / w; });
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([x0, C[1] + Rs[i] * Math.cos(phis[i]), C[0] - Rs[i] * Math.sin(phis[i])]);
  const nb = Math.max(2, Math.round(n * blend));
  for (let i = n - nb; i <= n; i++) { const t = (i - (n - nb)) / nb, w = t * t * (3 - 2 * t); pts[i] = lerp(pts[i], end, w); }
  // ilk birkaç ışın Cisterna magna noktasından başlar (`cm` noktasından taramaya yumuşak geçiş)
  const na = Math.max(2, Math.round(n * 0.06));
  for (let i = 0; i <= na; i++) { const t = i / na, w = t * t * (3 - 2 * t); pts[i] = lerp(cm, pts[i], w); }
  return { pts: [start, ...pts], cisternaMagna: cm, segments: segs.length / 4, rays: n + 1, brainR: rs, gap, phis, planeX: x0,
    clear2d: pts.map(p => segs2dDist(segs, p[2], p[1])) };
}
// p noktasının bir çoklu çizgiye uzaklığı (parçaları üzerinde kaba kuvvet)
export function polyDist(p, pts) { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i])); return d; }

// ---------------------------------------------------------------- tüpler: dural sinüsler ve venler
// Açık bir tüpün merkez çizgisi (iki uç halkası): `from` noktasına en yakın uç halkasından ağ kenarları boyunca jeodezik uzaklık;
// köşeler bu uzaklığa göre dilimlere ayrılır (`step` cm), sırayla dilimlerin ağırlık merkezleri. Ayrıca her dilimin ortalama yarıçapı.
export function tubeCenterline(m, opt = {}) {
  const { from = null, step = 0.25 } = opt;
  const { P, I } = m; const { cl, rep, n } = weld(P);
  const { loops } = boundaryLoops(m);
  if (!loops.length) return null;
  loops.sort((a, b) => b.v.length - a.v.length);
  let ends = loops.slice(0, 2);
  if (from && ends.length > 1 && dist(ends[1].c, from) < dist(ends[0].c, from)) ends = [ends[1], ends[0]];
  // kaynaklı köşeler üzerinde kenar grafı
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = cl[I[t + k]], b = cl[I[t + (k + 1) % 3]]; if (a === b) continue;
    const w = dist(vert(P, rep[a]), vert(P, rep[b])); adj[a].push(b, w); adj[b].push(a, w);
  }
  const D = new Float64Array(n).fill(Infinity), h = new Heap();
  for (const v of ends[0].v) { const c = cl[v]; D[c] = 0; h.push(0, c); }
  while (h.size) {
    const a = h.pop(); if (h.lastKey > D[a]) continue;
    const L = adj[a]; for (let q = 0; q < L.length; q += 2) { const b = L[q], nd = D[a] + L[q + 1]; if (nd < D[b]) { D[b] = nd; h.push(nd, b); } }
  }
  let maxD = 0; for (let c = 0; c < n; c++) if (D[c] < Infinity) maxD = Math.max(maxD, D[c]);
  // halkalar: üçgenlerden kesilen D = (k + 0.5) * step eş-uzaklık çizgileri; merkez parça uzunluğuyla ağırlıklandırılır
  const K = Math.max(1, Math.floor(maxD / step)), acc = Array.from({ length: K }, () => [0, 0, 0, 0]), seg = Array.from({ length: K }, () => []);
  for (let t = 0; t < I.length; t += 3) {
    const v = [cl[I[t]], cl[I[t + 1]], cl[I[t + 2]]], dv = v.map(c => D[c]); if (dv.some(x => x === Infinity)) continue;
    const lo = Math.min(...dv), hi = Math.max(...dv);
    for (let k = Math.max(0, Math.ceil(lo / step - 0.5)); k < K && (k + 0.5) * step <= hi; k++) {
      const lev = (k + 0.5) * step, q = [];
      for (let e = 0; e < 3; e++) {
        const i = e, j = (e + 1) % 3, di = dv[i] - lev, dj = dv[j] - lev;
        if ((di < 0) !== (dj < 0)) { const f = di / (di - dj); q.push(lerp(vert(P, rep[v[i]]), vert(P, rep[v[j]]), f)); }
      }
      if (q.length < 2) continue;
      const L = dist(q[0], q[1]), mid = lerp(q[0], q[1], 0.5);
      acc[k][0] += mid[0] * L; acc[k][1] += mid[1] * L; acc[k][2] += mid[2] * L; acc[k][3] += L; seg[k].push(mid, L);
    }
  }
  const cen = [], rad = [];
  for (let k = 0; k < K; k++) {
    if (!acc[k][3]) continue;
    const c = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]]; let r = 0;
    for (let q = 0; q < seg[k].length; q += 2) r += dist(seg[k][q], c) * seg[k][q + 1];
    cen.push(c); rad.push(r / acc[k][3]);
  }
  const pts = [ends[0].c, ...cen, ...(ends[1] ? [ends[1].c] : [])];
  const radius = [ends[0].r, ...rad, ...(ends[1] ? [ends[1].r] : [])];
  return { pts, radius, length: maxD, ends: ends.map(e => ({ c: e.c, r: e.r, n: e.v.length })) };
}
// Çoklu çizgi parçaları üzerinde uzamsal karma: dist(p), maxD'nin altındaysa çoklu çizgiye uzaklığı döndürür (yoksa Infinity).
export function polylineIndex(pts, cell = 0.5) {
  const map = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  for (let s = 1; s < pts.length; s++) {
    const a = pts[s - 1], b = pts[s];
    for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i++)
      for (let j = Math.floor(Math.min(a[1], b[1]) / cell); j <= Math.floor(Math.max(a[1], b[1]) / cell); j++)
        for (let k = Math.floor(Math.min(a[2], b[2]) / cell); k <= Math.floor(Math.max(a[2], b[2]) / cell); k++) {
          const kk = key(i, j, k); (map.get(kk) || map.set(kk, []).get(kk)).push(s);
        }
  }
  return {
    near(p) {   // { d, s }: uzaklık ve parça indisi (yalnız p'nin bir hücre çevresindeki parçalara bakılır)
      const i0 = Math.floor(p[0] / cell), j0 = Math.floor(p[1] / cell), k0 = Math.floor(p[2] / cell); let d = Infinity, bs = -1;
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) {
        const l = map.get(key(i, j, k)); if (!l) continue;
        for (const s of l) { const q = segDist(p, pts[s - 1], pts[s]); if (q < d) { d = q; bs = s; } }
      }
      return { d, s: bs };
    },
  };
}
// çoklu çizgi üzerindeki en yakın noktanın indisi
const nearestIdx = (pts, p) => { let b = 0, bd = Infinity; pts.forEach((q, i) => { const d = dist(q, p); if (d < bd) { bd = d; b = i; } }); return b; };
// Bir yan için sinüslerin içinden venöz drenaj: Sinus sagittalis superior `from` noktasından (verteks) geriye Confluens sinuum'a,
// Sinus transversus, Sinus sigmoideus, V. jugularis interna'ya kalan boşluk, V. jugularis interna boyunca `ijvLength` cm aşağı.
// s: { sss, ts: { l, r }, sig: { l, r }, ijv: { l, r } }. Dönüş: sık merkez çizgisi, kontrol noktaları ve birleşim yerlerindeki boşluklar.
export function venousRoute(s, opt = {}) {
  const { side = 'r', from = null, ijvLength = 8, spacing = 1.2 } = opt;
  const b = meshBounds(s.sss);
  const sss = tubeCenterline(s.sss, { from: [0, (b.mn[1] + b.mx[1]) / 2, b.mx[2]] });   // önce ön uç
  let i0 = 0; if (from) i0 = nearestIdx(sss.pts, from); else { sss.pts.forEach((p, i) => { if (p[1] > sss.pts[i0][1]) i0 = i; }); }
  const sssPart = sss.pts.slice(i0), sssRad = sss.radius.slice(i0);
  const conf = sssPart[sssPart.length - 1];
  const ts = tubeCenterline(s.ts[side], { from: conf });
  const sig = tubeCenterline(s.sig[side], { from: ts.pts[ts.pts.length - 1] });
  const ijv = tubeCenterline(s.ijv[side], { from: sig.pts[sig.pts.length - 1] });
  let acc = 0, k = 1; while (k < ijv.pts.length && acc < ijvLength) { acc += dist(ijv.pts[k - 1], ijv.pts[k]); k++; }
  const ijvPart = ijv.pts.slice(0, k), ijvRad = ijv.radius.slice(0, k);
  const gaps = { sssTs: dist(conf, ts.pts[0]), tsSig: dist(ts.pts[ts.pts.length - 1], sig.pts[0]), sigIjv: dist(sig.pts[sig.pts.length - 1], ijv.pts[0]) };
  const dense0 = [...sssPart, ...ts.pts.slice(1), ...sig.pts.slice(1), ...ijvPart];
  const rad0 = [...sssRad, ...ts.radius.slice(1), ...sig.radius.slice(1), ...ijvRad];
  // sık yol (0.1 cm) ve ok sınaması: merkez çizgisinden yerel yarıçapın yarısı içinde kal
  const dense = resample(dense0, 0.1);
  const idx = polylineIndex(dense0, 0.5);
  const ok = p => { const q = idx.near(p); return q.s > 0 && q.d <= Math.max(0.04, 0.5 * Math.min(rad0[q.s - 1], rad0[q.s])); };
  const fit = fitControlPoints(dense, ok, spacing);
  return { side, dense, ok, ...fit, gaps, confluence: conf, pieces: { sss: sssPart, ts: ts.pts, sig: sig.pts, ijv: ijvPart }, sssFull: sss, radius: rad0, raw: dense0 };
}
// Araknoid granülasyon işaretleri: Sinus sagittalis superior merkez çizgisi boyunca `at` (verteks) çevresinde `n` nokta,
// aralarında `spread` cm, verilen yanda sinüsün yanına konur (Lacunae laterales).
export function granulations(sssLine, at, opt = {}) {
  const { n = 4, spread = 1.6, side = 1, lateral = 0.35 } = opt;
  const pts = sssLine.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const i0 = nearestIdx(pts, at), s0 = cum[i0], out = [];
  for (let k = 0; k < n; k++) {
    const s = s0 + (k - (n - 1) / 2) * spread; let j = 1; while (j < pts.length - 1 && cum[j] < s) j++;
    const t = Math.max(0, Math.min(1, (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)));
    const c = lerp(pts[j - 1], pts[j], t);
    out.push({ sinus: c, marker: [c[0] + side * lateral, c[1] - 0.15, c[2]] });
  }
  return out;
}

// ---------------------------------------------------------------- lomber ponksiyon
// bir doğru parçasının bir ağla tüm kesişimleri (a->b parçası boyunca uzaklık; kaba kuvvet Moller-Trumbore)
export function segmentCrossings(m, a, b) {
  const { P, I } = m, d = sub(b, a), L = len(d), u = mul(d, 1 / (L || 1)), out = [];
  for (let t = 0; t < I.length; t += 3) {
    const p0 = vert(P, I[t]), p1 = vert(P, I[t + 1]), p2 = vert(P, I[t + 2]);
    const e1 = sub(p1, p0), e2 = sub(p2, p0), pv = cross(u, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
    const tv = sub(a, p0), uu = dot(tv, pv) / det; if (uu < 0 || uu > 1) continue;
    const qv = cross(tv, e1), vv = dot(u, qv) / det; if (vv < 0 || uu + vv > 1) continue;
    const s = dot(e2, qv) / det; if (s >= 0 && s <= L) out.push(s);
  }
  return out.sort((x, y) => x - y);
}
// spine: { vertebrae: { T12, L1, ..., L5 } ağları, sacrum, hip: { l, r }, cord: [omurilik parça ağları], dura, cauda,
// back: [orta hatta yakın arka yumuşak doku ağları: sırt kasları, Fascia thoracolumbalis'in arka yaprağı,
// Lig. supraspinale], layers: { ad: ağ } iğnenin geçtiği katmanlar (bağlar, cauda equina) }.
// Seviyeler omur gövdelerinin arka duvarlarına (kanal tarafı) göre adlandırılır; böylece kanaldaki yapılar (konus,
// dural kesenin sonu) karşılarındaki gövdeye ya da diske göre verilir.
export function lumbarPuncture(spine, opt = {}) {
  const { subcutis = 1.0 } = opt;                // en derin arka yapının arkasında varsayılan deri altı doku (cm)
  const names = Object.keys(spine.vertebrae), info = {};
  for (const k of names) {
    const m = spine.vertebrae[k], P = m.P;
    let tip = null; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 1.0 && (!tip || P[i + 2] < tip[2])) tip = [P[i], P[i + 1], P[i + 2]];
    let top = -Infinity, bot = Infinity;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 1.0 && P[i + 2] < tip[2] + 1.0) { top = Math.max(top, P[i + 1]); bot = Math.min(bot, P[i + 1]); }
    // gövdenin arka duvarı: orta hat köşelerinin z değerleri arasındaki en büyük boşluğun ön ucu (kanal)
    const zs = []; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.6) zs.push(P[i + 2]); zs.sort((x, y) => x - y);
    let gap = 0, zw = null; for (let q = 0; q + 1 < zs.length; q++) { const gp = zs[q + 1] - zs[q]; if (gp > gap) { gap = gp; zw = zs[q + 1]; } }
    let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 1.2 && P[i + 2] >= zw && P[i + 2] <= zw + 0.8) { y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
    info[k] = { tip, spinousTop: top, spinousBottom: bot, bodyWallZ: zw, canalAP: gap, body: [y0, y1] };
  }
  const order = names.slice().sort((a, b) => info[b].body[1] - info[a].body[1]);   // yukarıdan aşağıya
  const level = y => {
    for (let i = 0; i < order.length; i++) {
      const [y0, y1] = info[order[i]].body;
      if (y <= y1 && y >= y0) { const f = (y1 - y) / (y1 - y0); return `${order[i]} (${f < 1 / 3 ? 'upper' : f < 2 / 3 ? 'middle' : 'lower'} third of the body)`; }
      const nx = order[i + 1]; if (nx && y < y0 && y > info[nx].body[1]) return `${order[i]}/${nx} disc`;
    }
    return y > info[order[0]].body[1] ? `above ${order[0]}` : `below ${order[order.length - 1]}`;
  };
  const back = spine.back || [];
  const posteriorZ = (y, xr = 2.5) => { let z = Infinity; for (const m of back) { const P = m.P; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < xr && Math.abs(P[i + 1] - y) < 0.6) z = Math.min(z, P[i + 2]); } return z; };
  const canal = y => { if (!spine.cauda) return null; const P = spine.cauda.P, q = [0, 0, 0]; let c = 0; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.5) { q[0] += P[i]; q[1] += P[i + 1]; q[2] += P[i + 2]; c++; } return c ? mul(q, 1 / c) : null; };
  const inter = {};
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i], b2 = order[i + 1]; if (!['L2', 'L3', 'L4'].includes(a)) continue;
    const y = (info[a].spinousBottom + info[b2].spinousTop) / 2;
    const zb = Math.min(info[a].tip[2], info[b2].tip[2]), zSoft = posteriorZ(y);
    const skinZ = Math.min(zb, zSoft) - subcutis;
    const bone = [0, y, zb], skin = [0, y, skinZ], target = canal(y);
    const layers = {};
    if (target) for (const [nm, m] of Object.entries(spine.layers || {})) { const c = segmentCrossings(m, skin, target); if (c.length) layers[nm] = [c[0], c[c.length - 1]]; }
    inter[`${a}/${b2}`] = { y, gapCm: info[a].spinousBottom - info[b2].spinousTop, boneZ: zb, softTissueZ: zSoft === Infinity ? null : zSoft, skin, bone, canal: target,
      skinToCanal: target ? dist(skin, target) : null, level: level(y), layers };
  }
  const lowest = ms => { let p = null; for (const m of ms) { const P = m.P; for (let i = 0; i < P.length; i += 3) if (!p || P[i + 1] < p[1]) p = [P[i], P[i + 1], P[i + 2]]; } return p; };
  const conus = lowest(spine.cord), duraEnd = spine.dura ? lowest([spine.dura]) : null, caudaEnd = spine.cauda ? lowest([spine.cauda]) : null;
  // Sacrum'dan S2: promontoriumdan aşağı orta hattaki ön yüzey; S2'nin ortası yay uzunluğunun ~%36'sında
  // (segment payları S1 %25, S2 %22); dural kese normalde orada biter (aralık S1-S3).
  let s2 = null;
  if (spine.sacrum) {
    // orta sagital kesitte sacrum'un ön konturu: önden gelen yatay çizgilerin ilk kesişimi
    const sg = sliceX([spine.sacrum], 0.05), sb = meshBounds(spine.sacrum), curve = [];
    for (let y = sb.mx[1]; y >= sb.mn[1]; y -= 0.1) {
      let zf = -Infinity;
      for (let k = 0; k < sg.length; k += 4) { const y0 = sg[k + 1], y1 = sg[k + 3]; if ((y0 - y) * (y1 - y) > 0 || y0 === y1) continue; const z = sg[k] + (sg[k + 2] - sg[k]) * (y - y0) / (y1 - y0); if (z > zf) zf = z; }
      if (zf > -Infinity) curve.push([0, y, zf]);
    }
    // promontorium: üst üçte birin en ön noktası; altındaki kontur apekse kadar
    const yTop = curve[0][1], yBot = curve[curve.length - 1][1];
    let ip = 0; for (let i = 0; i < curve.length && curve[i][1] > yTop - (yTop - yBot) / 3; i++) if (curve[i][2] > curve[ip][2]) ip = i;
    const c2 = curve.slice(ip), cum = [0]; for (let i = 1; i < c2.length; i++) cum.push(cum[i - 1] + dist(c2[i - 1], c2[i]));
    const at = f => { const t = cum[cum.length - 1] * f; let j = 1; while (j < c2.length - 1 && cum[j] < t) j++; return lerp(c2[j - 1], c2[j], (t - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)); };
    const mid = at(0.36);
    let sac = null; if (spine.cauda) { const P = spine.cauda.P; let bd = Infinity; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 1.0) { const q = [P[i], P[i + 1], P[i + 2]], d = dist(q, mid); if (d < bd) { bd = d; sac = q; } } }
    s2 = { promontory: c2[0], s2Anterior: mid, y: mid[1], sacEnd: sac, s1s2: at(0.25), s2s3: at(0.47), anteriorArc: cum[cum.length - 1] };
  }
  let tuffier = null, psis = null;
  if (spine.hip) {
    const ext = (m, f) => { const P = m.P; let p = null; for (let i = 0; i < P.length; i += 3) { const q = [P[i], P[i + 1], P[i + 2]]; if (!p || f(q) > f(p)) p = q; } return p; };
    const cl = ext(spine.hip.l, q => q[1]), cr = ext(spine.hip.r, q => q[1]); const y = (cl[1] + cr[1]) / 2;
    tuffier = { y, left: cl, right: cr, level: level(y), spinous: order.filter(k => info[k].spinousBottom <= y && y <= info[k].spinousTop) };
    psis = { left: ext(spine.hip.l, q => -q[2]), right: ext(spine.hip.r, q => -q[2]) };
  }
  return { vertebrae: info, interspaces: inter, conus: conus && { point: conus, level: level(conus[1]) }, duraEnd: duraEnd && { point: duraEnd, level: level(duraEnd[1]) },
    caudaEnd, s2, tuffier, psis, order, levelOf: level };
}

// ---------------------------------------------------------------- etiket yerleri
// heart.js anchor(): ağların `near` noktasına en yakın köşesi (varsayılan: sınır kutularının merkezi)
export function surfaceAnchor(meshes, near = null) {
  const b = meshBounds(...meshes), c = near || mul(add(b.mn, b.mx), 0.5); let best = null, bd = Infinity;
  for (const m of meshes) { const P = m.P; for (let i = 0; i < P.length; i += 3) { const d = (P[i] - c[0]) ** 2 + (P[i + 1] - c[1]) ** 2 + (P[i + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = [P[i], P[i + 1], P[i + 2]]; } } }
  return best || c;
}

// ---------------------------------------------------------------- çizim yardımcıları
// Sık bir çoklu çizgi (ör. subaraknoid yol) için kontrol noktaları: Catmull-Rom çoklu çizgiden en çok `tol` uzakta kalır.
export function fitAlong(pts, tol = 0.08, spacing = 1.0) {
  const dense = resample(pts, 0.1), idx = polylineIndex(dense, Math.max(0.5, 2 * tol));
  return fitControlPoints(dense, p => idx.near(p).d <= tol, spacing);
}

// ---------------------------------------------------------------- isteğe bağlı yan dal: Luschka -> bazal sisternalar
// Ağların y = y0 düzlemiyle kesişimi: (x, z) düzleminde doğru parçaları, düz dizi olarak [x0, z0, x1, z1, ...].
export function sliceY(meshes, y0) {
  const out = [];
  for (const m of meshes) {
    const { P, I } = m;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const da = P[a + 1] - y0, db = P[b + 1] - y0, dc = P[c + 1] - y0;
      if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
      const pts = [];
      const edge = (i, j, di, dj) => { if ((di > 0) !== (dj > 0) && di !== dj) { const s = di / (di - dj); pts.push(P[i] + (P[j] - P[i]) * s, P[i + 2] + (P[j + 2] - P[i + 2]) * s); } };
      edge(a, b, da, db); edge(b, c, db, dc); edge(c, a, dc, da);
      if (pts.length >= 4) out.push(pts[0], pts[1], pts[2], pts[3]);
    }
  }
  return Float64Array.from(out);
}
// (cx, cz) noktasından 2B ışın (parçalar sg) boyunca en dış yüzeyin `off` cm ötesindeki nokta; sk kafatası parçalarına
// kalan boşluğun yarısıyla sınırlı
function outAlong(sg, sk, cx, cz, dx, dz, off, minOff) {
  const hb = rayHits(sg, cx, cz, dx, dz); if (!hb.length) return null;
  const rb = hb[hb.length - 1]; let o = off;
  if (sk) { const inner = rayHits(sk, cx, cz, dx, dz).find(t => t > rb); if (inner !== undefined) o = Math.max(minOff, Math.min(off, 0.5 * (inner - rb))); }
  return [cx + dx * (rb + o), cz + dz * (rb + o)];
}
// Apertura lateralis'ten beyin sapının çevresinden giden yan dal: önce apertura hizasında beyin sapının yan yüzünü dolanır
// (serebellopontin köşe), sonra A. basilaris'in yanında pons'un önünden yukarı (Cisterna prepontina) `target` noktasına
// (Cisterna interpeduncularis, ör. o yandaki Fossa interpeduncularis ağının ağırlık merkezi). stem: pons, medulla ve
// orta beyin ağları; skull: kafatası kemikleri (isteğe bağlı); side +1 sol, -1 sağ.
export function basalBranch(stem, skull, exit, target, opt = {}) {
  const { side = 1, off = 0.3, minOff = 0.1, lateral = 0.4, n = 10, step = 0.3 } = opt;
  const y0 = exit[1], sg = sliceY(stem, y0), sk = skull ? sliceY(skull, y0) : null;
  let cx = 0, cz = 0, k = 0; for (let q = 0; q < sg.length; q += 2) { cx += sg[q]; cz += sg[q + 1]; k++; } cx /= k; cz /= k;
  let a0 = Math.atan2(exit[2] - cz, exit[0] - cx), a1 = Math.atan2(1, side * 0.3);
  if (side < 0 && a0 < 0) a0 += 2 * Math.PI;                       // yan yüzden geçerek tara (0 sol, 180 derece sağ)
  const pts = [exit];
  for (let i = 1; i <= n; i++) { const t = a0 + (a1 - a0) * i / n, q = outAlong(sg, sk, cx, cz, Math.cos(t), Math.sin(t), off, minOff); if (q) pts.push([q[0], y0, q[1]]); }
  for (let y = y0 + step; y < target[1] - step; y += step) {
    const sy = sliceY(stem, y), ky = skull ? sliceY(skull, y) : null; let cz2 = 0, m = 0; for (let q = 1; q < sy.length; q += 2) { cz2 += sy[q]; m++; } if (!m) continue;
    const q = outAlong(sy, ky, side * lateral, cz2 / m, 0, 1, off, minOff); if (q) pts.push([q[0], y, q[1]]);
  }
  pts.push(target);
  return { pts, center: [cx, y0, cz] };
}
