// Beyin arterleri geometrisi (beyin çalışma modu, "Arterler" sekmesi).
// Saf JavaScript: içe aktarma yok, Node'a özgü API yok; fonksiyonlar src/brain.js'e olduğu gibi yapıştırılabilir.
// Girdi parça başına { P, I }: P dünya konumları (Float32Array, xyz), I üçgen indisleri. Tarayıcıda r.geo verilebilir
// (toPI). Birimler cm; +x gövdenin SOLU (anatomik sağ -x), +y yukarı, +z ön.
//
// İçerik:
//  1. Ağ temeli: weld, topo (kaynaklı köşeler, CSR komşuluk, sınır kenarları), boundaryLoops, components, dijkstra
//  2. Merkez çizgisi: skeleton (jeodezik eş-uzaklık konturlarının Reeb grafı), mainPath, chains, çoklu çizgi yardımcıları
//  3. Uzaklık: closestOnTriangle, TriGrid (yüzeye en yakın nokta), meshGap (iki ağ arası en kısa mesafe)
//  4. Bağlantı: endContacts (her açık ucun neye değdiği), acoaLink, pcoaLink (şematik bağlantılar)
//  5. Beslenme alanı: PointGrid, samplePoints, nearestLabels, smoothLabels, partVotes, subsampleLabels
//  6. Etiket yeri: labelAnchor (görünüm yönüne göre, isteğe bağlı örtülme sınaması)

export const toPI = g => (g.P ? g : { P: g.attributes.position.array, I: g.index.array });
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const dist = (a, b) => Math.sqrt(d2(a, b));
const lerp3 = (a, b, f) => [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];

// ---------------------------------------------------------------- 1. ağ temeli
// Aynı konumdaki köşeleri birleştir (normal/renk dikişlerinde çoğaltılmış köşeler). q: 1 / hassasiyet (cm)
export function weld(P, q = 1e4) {
  const n = P.length / 3, cl = new Int32Array(n), map = new Map(), Q = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[3 * i] * q) + ',' + Math.round(P[3 * i + 1] * q) + ',' + Math.round(P[3 * i + 2] * q);
    let j = map.get(k);
    if (j === undefined) { j = Q.length / 3; map.set(k, j); Q.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); }
    cl[i] = j;
  }
  return { cl, n: Q.length / 3, Q: Float64Array.from(Q) };
}

// Kaynaklı topoloji: tri (kaynaklı indisler), CSR komşuluk (off, adj, w: kenar boyu), bnd: yönlü sınır kenarları [a,b,...]
export function topo(part) {
  const { P, I } = toPI(part);
  const { cl, n, Q } = weld(P);
  const T = [];
  for (let t = 0; t + 2 < I.length; t += 3) { const a = cl[I[t]], b = cl[I[t + 1]], c = cl[I[t + 2]]; if (a !== b && b !== c && c !== a) T.push(a, b, c); }
  const tri = Int32Array.from(T);
  const cnt = new Map(), key = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) { const kk = key(tri[t + k], tri[t + (k + 1) % 3]); cnt.set(kk, (cnt.get(kk) || 0) + 1); }
  const off = new Int32Array(n + 1);
  for (const kk of cnt.keys()) { const a = Math.floor(kk / n); off[a + 1]++; off[kk - a * n + 1]++; }
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const adj = new Int32Array(off[n]), w = new Float32Array(off[n]), fill = off.slice(0, n);
  for (const kk of cnt.keys()) {
    const a = Math.floor(kk / n), b = kk - a * n;
    const l = Math.hypot(Q[3 * a] - Q[3 * b], Q[3 * a + 1] - Q[3 * b + 1], Q[3 * a + 2] - Q[3 * b + 2]);
    adj[fill[a]] = b; w[fill[a]++] = l; adj[fill[b]] = a; w[fill[b]++] = l;
  }
  const bnd = [];
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) { const a = tri[t + k], b = tri[t + (k + 1) % 3]; if (cnt.get(key(a, b)) === 1) bnd.push(a, b); }
  return { n, Q, tri, off, adj, w, bnd, cl, key };
}

// Sınır halkaları (açık damar uçları): { v: köşeler, c: merkez (kenar boyu ağırlıklı), r: ortalama yarıçap, per: çevre, nrm }
export function boundaryLoops(g) {
  const { Q, bnd } = g, m = bnd.length / 2, from = new Map(), used = new Uint8Array(m), loops = [];
  for (let e = 0; e < m; e++) { const a = bnd[2 * e]; if (!from.has(a)) from.set(a, []); from.get(a).push(e); }
  for (let e0 = 0; e0 < m; e0++) {
    if (used[e0]) continue;
    const v = []; let e = e0;
    while (e >= 0 && !used[e]) {
      used[e] = 1; v.push(bnd[2 * e]);
      const nx = (from.get(bnd[2 * e + 1]) || []).find(f => !used[f]); e = nx === undefined ? -1 : nx;
    }
    if (v.length < 3) continue;
    let cx = 0, cy = 0, cz = 0, per = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < v.length; i++) {
      const a = 3 * v[i], b = 3 * v[(i + 1) % v.length];
      const l = Math.hypot(Q[a] - Q[b], Q[a + 1] - Q[b + 1], Q[a + 2] - Q[b + 2]);
      cx += (Q[a] + Q[b]) / 2 * l; cy += (Q[a + 1] + Q[b + 1]) / 2 * l; cz += (Q[a + 2] + Q[b + 2]) / 2 * l; per += l;
      nx += (Q[a + 1] - Q[b + 1]) * (Q[a + 2] + Q[b + 2]); ny += (Q[a + 2] - Q[b + 2]) * (Q[a] + Q[b]); nz += (Q[a] - Q[b]) * (Q[a + 1] + Q[b + 1]);
    }
    const c = per > 0 ? [cx / per, cy / per, cz / per] : [Q[3 * v[0]], Q[3 * v[0] + 1], Q[3 * v[0] + 2]];
    let r = 0; for (const i of v) r += Math.hypot(Q[3 * i] - c[0], Q[3 * i + 1] - c[1], Q[3 * i + 2] - c[2]); r /= v.length;
    const nl = Math.hypot(nx, ny, nz) || 1;
    loops.push({ v, c, r, per, nrm: [nx / nl, ny / nl, nz / nl] });
  }
  return loops;
}

// Bağlı parçalar: id (köşe başına), count
export function components(g) {
  const id = new Int32Array(g.n).fill(-1); let count = 0; const st = [];
  for (let s = 0; s < g.n; s++) {
    if (id[s] >= 0) continue; id[s] = count; st.push(s);
    while (st.length) { const u = st.pop(); for (let e = g.off[u]; e < g.off[u + 1]; e++) { const v = g.adj[e]; if (id[v] < 0) { id[v] = count; st.push(v); } } }
    count++;
  }
  return { id, count };
}

// Çok kaynaklı Dijkstra (ikili yığın). sources: köşe indisleri. Dönüş: Float64Array uzaklık (ulaşılamayan: Infinity)
export function dijkstra(g, sources) {
  const d = new Float64Array(g.n).fill(Infinity);
  let hk = new Float64Array(64), hv = new Int32Array(64), size = 0;
  const push = (k, v) => {
    if (size === hk.length) { const k2 = new Float64Array(size * 2); k2.set(hk); hk = k2; const v2 = new Int32Array(size * 2); v2.set(hv); hv = v2; }
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const v = hv[0], k = hk[--size], x = hv[size]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= size) break; if (c + 1 < size && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = k; hv[i] = x; return v;
  };
  for (const s of sources) if (d[s] !== 0) { d[s] = 0; push(0, s); }
  while (size) {
    const du = hk[0], u = pop(); if (du > d[u]) continue;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) { const v = g.adj[e], nd = du + g.w[e]; if (nd < d[v]) { d[v] = nd; push(nd, v); } }
  }
  return d;
}

// ---------------------------------------------------------------- 2. merkez çizgisi
// Damar ağından merkez çizgisi grafı. Kökten (bir açık uç halkası) jeodezik uzaklık d hesaplanır; d = (k + 1/2) h
// eş-uzaklık konturları üçgenlerin içinden geçen halkalardır (seyrek köşeli, uzun üçgenli ağlarda da çalışır). Her halka
// bir düğüm (merkez: uzunluk ağırlıklı ağırlık merkezi, r: çevre / 2 pi). İki ardışık seviye arasındaki bant parçası alt
// ve üst halkalarını bağlar (Reeb grafı): dallanma = bir alt halkaya iki üst halka; uç = üst halkası olmayan bant (açık
// uç halkasının merkezi ya da en uzak köşe). opt.h: seviye aralığı (cm). opt.root: kök ipucu noktası (o noktaya en yakın
// uç halkası kök olur); yoksa en geniş halka (arterler incelerek dallanır, en geniş açık uç genellikle başlangıçtır).
// Dönüş: { nodes: [{ p, r, d, kind: 'root'|'c'|'end', comp }], edges: [[i, j], ...], loops, comps, roots }
export function skeleton(part, opt = {}) {
  const g = opt.topo || topo(part), h = opt.h || 0.1;
  const { n, Q, tri } = g;
  const comps = components(g), loops = boundaryLoops(g);
  const vp = i => [Q[3 * i], Q[3 * i + 1], Q[3 * i + 2]];
  const roots = [];
  for (let c = 0; c < comps.count; c++) {
    const L = loops.filter(l => comps.id[l.v[0]] === c);
    if (L.length) {
      const lp = opt.root ? L.reduce((a, b) => (d2(a.c, opt.root) <= d2(b.c, opt.root) ? a : b)) : L.reduce((a, b) => (a.r >= b.r ? a : b));
      roots.push({ comp: c, src: lp.v, p: lp.c, r: lp.r, loop: lp });
    } else {
      let cen = [0, 0, 0], cnt = 0, best = -1, bd = -Infinity;
      for (let i = 0; i < n; i++) if (comps.id[i] === c) { cen[0] += Q[3 * i]; cen[1] += Q[3 * i + 1]; cen[2] += Q[3 * i + 2]; cnt++; }
      cen = cen.map(x => x / cnt);
      for (let i = 0; i < n; i++) if (comps.id[i] === c) { const s = opt.root ? -d2(vp(i), opt.root) : d2(vp(i), cen); if (s > bd) { bd = s; best = i; } }
      roots.push({ comp: c, src: [best], p: vp(best), r: 0, loop: null });
    }
  }
  const d = dijkstra(g, roots.flatMap(x => x.src));
  const nodes = [], edges = [];
  for (const R of roots) { R.node = nodes.length; nodes.push({ p: R.p, r: R.r, d: 0, kind: 'root', comp: R.comp }); }
  let maxd = 0; for (let i = 0; i < n; i++) if (d[i] < Infinity && d[i] > maxd) maxd = d[i];
  const K = Math.max(1, Math.floor(maxd / h - 0.5) + 2);
  // konturlar: kesişme noktaları (kenar, seviye) birleşim-bul ile halkalara toplanır
  const pid = new Map(), par = [], px = [];
  const cross = (u, v, k, tk) => {
    const kk = g.key(u, v) * K + k; let id = pid.get(kk);
    if (id === undefined) {
      id = par.length; pid.set(kk, id); par.push(id);
      const f = (tk - d[u]) / (d[v] - d[u]);
      px.push(Q[3 * u] + f * (Q[3 * v] - Q[3 * u]), Q[3 * u + 1] + f * (Q[3 * v + 1] - Q[3 * u + 1]), Q[3 * u + 2] + f * (Q[3 * v + 2] - Q[3 * u + 2]));
    }
    return id;
  };
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const segs = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2], da = d[a], db = d[b], dc = d[c];
    if (!(da < Infinity && db < Infinity && dc < Infinity)) continue;
    const lo = Math.min(da, db, dc), hi = Math.max(da, db, dc);
    for (let k = Math.max(0, Math.floor(lo / h - 0.5) + 1); (k + 0.5) * h <= hi; k++) {
      const tk = (k + 0.5) * h, e = [];
      if ((da < tk) !== (db < tk)) e.push(cross(a, b, k, tk));
      if ((db < tk) !== (dc < tk)) e.push(cross(b, c, k, tk));
      if ((dc < tk) !== (da < tk)) e.push(cross(c, a, k, tk));
      if (e.length === 2) { const ra = find(e[0]), rb = find(e[1]); if (ra !== rb) par[ra] = rb; segs.push(e[0], e[1], t, k); }
    }
  }
  const cont = new Map();
  for (let s = 0; s < segs.length; s += 4) {
    const A = 3 * segs[s], B = 3 * segs[s + 1], r = find(segs[s]);
    const l = Math.hypot(px[A] - px[B], px[A + 1] - px[B + 1], px[A + 2] - px[B + 2]);
    let C = cont.get(r); if (!C) cont.set(r, C = { k: segs[s + 3], len: 0, sx: 0, sy: 0, sz: 0, t: segs[s + 2] });
    C.len += l; C.sx += (px[A] + px[B]) / 2 * l; C.sy += (px[A + 1] + px[B + 1]) / 2 * l; C.sz += (px[A + 2] + px[B + 2]) / 2 * l;
  }
  // bantlar: [t_k, t_k+1] aralığına dokunan üçgenlerin bağlı parçaları (k = -1: kök bölgesi)
  const bandTris = Array.from({ length: K + 2 }, () => []);
  for (let t = 0; t < tri.length; t += 3) {
    const da = d[tri[t]], db = d[tri[t + 1]], dc = d[tri[t + 2]];
    if (!(da < Infinity && db < Infinity && dc < Infinity)) continue;
    const lo = Math.min(da, db, dc), hi = Math.max(da, db, dc);
    const k0 = Math.max(-1, Math.ceil(lo / h - 1.5)), k1 = Math.min(K, Math.floor(hi / h - 0.5));
    for (let k = k0; k <= k1; k++) bandTris[k + 1].push(t);
  }
  const bandOf = new Map(), bands = [];
  for (let kb = 0; kb < bandTris.length; kb++) {
    const ts = bandTris[kb]; if (!ts.length) continue;
    const bp = Int32Array.from(ts.keys()), bf = x => { while (bp[x] !== x) { bp[x] = bp[bp[x]]; x = bp[x]; } return x; };
    const em = new Map();
    ts.forEach((t, i) => { for (let q = 0; q < 3; q++) { const kk = g.key(tri[t + q], tri[t + (q + 1) % 3]); const j = em.get(kk); if (j === undefined) em.set(kk, i); else { const ra = bf(i), rb = bf(j); if (ra !== rb) bp[ra] = rb; } } });
    const gid = new Map();
    ts.forEach((t, i) => { const r = bf(i); let id = gid.get(r); if (id === undefined) { id = bands.length; gid.set(r, id); bands.push({ k: kb - 1, lower: [], upper: [], tris: [] }); } bandOf.set(t * (K + 2) + kb, id); bands[id].tris.push(t); });
  }
  for (const C of cont.values()) {
    C.node = nodes.length;
    nodes.push({ p: [C.sx / C.len, C.sy / C.len, C.sz / C.len], r: C.len / (2 * Math.PI), d: (C.k + 0.5) * h, kind: 'c', comp: comps.id[tri[C.t]] });
    const lo = bandOf.get(C.t * (K + 2) + C.k + 1), up = bandOf.get(C.t * (K + 2) + C.k);
    if (lo !== undefined) bands[lo].lower.push(C.node);
    if (up !== undefined) bands[up].upper.push(C.node);
  }
  const triOf = new Int32Array(n).fill(-1); for (let t = 0; t < tri.length; t += 3) for (let q = 0; q < 3; q++) if (triOf[tri[t + q]] < 0) triOf[tri[t + q]] = t;
  for (const R of roots) { const t = triOf[R.src[0]]; const b = t >= 0 ? bandOf.get(t * (K + 2)) : undefined; if (b !== undefined) bands[b].lower.push(R.node); }
  const loopOf = new Int32Array(n).fill(-1); loops.forEach((L, i) => { for (const v of L.v) loopOf[v] = i; });
  const rootLoops = new Set(roots.map(R => R.loop).filter(Boolean));
  for (const B of bands) {
    if (!B.lower.length) continue;
    if (B.upper.length) { for (const a of B.lower) for (const b of B.upper) edges.push([a, b]); continue; }
    let vm = -1, dm = -1;
    for (const t of B.tris) for (let q = 0; q < 3; q++) { const v = tri[t + q]; if (d[v] > dm) { dm = d[v]; vm = v; } }
    const L = loopOf[vm] >= 0 && !rootLoops.has(loops[loopOf[vm]]) ? loops[loopOf[vm]] : null;
    const e = nodes.length; nodes.push({ p: L ? L.c : vp(vm), r: L ? L.r : 0, d: dm, kind: 'end', comp: comps.id[vm], loop: L });
    for (const a of B.lower) edges.push([a, e]);
  }
  return { nodes, edges, loops, comps, roots, h, maxd };
}

// Grafın komşuluk listesi ve toplam uzunluğu
export function skelAdj(sk) { const A = sk.nodes.map(() => []); for (const [a, b] of sk.edges) { const l = dist(sk.nodes[a].p, sk.nodes[b].p); A[a].push([b, l]); A[b].push([a, l]); } return A; }
export const skelLength = sk => sk.edges.reduce((s, [a, b]) => s + dist(sk.nodes[a].p, sk.nodes[b].p), 0);

// Ana gövde: from düğümünden (varsayılan: en uzun yollu kök) en uzak düğüme giden yol. Dönüş: { idx, pts, r, len }
export function mainPath(sk, from = null) {
  const A = skelAdj(sk);
  const run = s => {
    const D = new Float64Array(A.length).fill(Infinity), prev = new Int32Array(A.length).fill(-1);
    D[s] = 0; const q = [s];
    while (q.length) { const u = q.shift(); for (const [v, l] of A[u]) if (D[u] + l < D[v] - 1e-12) { D[v] = D[u] + l; prev[v] = u; q.push(v); } }
    let far = s; for (let i = 0; i < A.length; i++) if (D[i] < Infinity && D[i] > D[far]) far = i;
    return { D, prev, far };
  };
  let best = null;
  for (const s of from === null ? sk.roots.map(R => R.node) : [from]) { const r = run(s); if (!best || r.D[r.far] > best.D[best.far]) best = r; }
  const idx = []; for (let v = best.far; v >= 0; v = best.prev[v]) idx.unshift(v);
  return { idx, pts: idx.map(i => sk.nodes[i].p), r: idx.map(i => sk.nodes[i].r), len: best.D[best.far] };
}

// Dallar: derecesi 2 olmayan düğümler arasındaki zincirler. Dönüş: [{ idx, pts, len }]
export function chains(sk) {
  const A = skelAdj(sk), seen = new Set(), out = [], key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  for (let s = 0; s < A.length; s++) {
    if (A[s].length === 2) continue;
    for (const [v0] of A[s]) {
      if (seen.has(key(s, v0))) continue;
      const idx = [s]; let u = s, v = v0;
      for (;;) { seen.add(key(u, v)); idx.push(v); if (A[v].length !== 2) break; const nx = A[v][0][0] === u ? A[v][1][0] : A[v][0][0]; u = v; v = nx; if (v === s) { idx.push(v); break; } }
      const pts = idx.map(i => sk.nodes[i].p);
      out.push({ idx, pts, len: polyLength(pts) });
    }
  }
  return out;
}

export function polyLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
// Yay uzunluğu s'deki nokta
export function pointAt(pts, s) {
  if (s <= 0) return pts[0].slice();
  for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); if (s <= l) return lerp3(pts[i - 1], pts[i], l > 0 ? s / l : 0); s -= l; }
  return pts[pts.length - 1].slice();
}
// Çoklu çizgiye en yakın nokta: { q, s (yay uzunluğu), d, i (parça), f }
export function nearestOnPoly(pts, p) {
  if (pts.length === 1) return { q: pts[0].slice(), s: 0, d: dist(pts[0], p), i: 0, f: 0 };
  let best = { d: Infinity }, s0 = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let f = l2 > 0 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2 : 0; f = Math.max(0, Math.min(1, f));
    const q = lerp3(a, b, f), dd = dist(q, p), l = Math.sqrt(l2);
    if (dd < best.d) best = { q, s: s0 + f * l, d: dd, i: i - 1, f };
    s0 += l;
  }
  return best;
}

// ---------------------------------------------------------------- 3. uzaklık
// Üçgene en yakın nokta (Ericson, Real-Time Collision Detection 5.1.5). Dönüş out = [x, y, z]
export function closestOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, e2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && e2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return out; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return out; }
  const vc = d1 * d4 - d3 * e2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return out; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return out; }
  const vb = d5 * e2 - d1 * d6;
  if (vb <= 0 && e2 >= 0 && d6 <= 0) { const w = e2 / (e2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return out; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return out; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w; return out;
}

// Düzgün ızgara (CSR): hücre başına öğe listesi. cellsOf(i, f): i. öğenin değdiği her hücre için f(hücre)
function gridBuild(nx, ny, nz, count, cellsOf) {
  const nc = nx * ny * nz, start = new Int32Array(nc + 1);
  for (let i = 0; i < count; i++) cellsOf(i, c => { start[c + 1]++; });
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[nc]), fill = start.slice(0, nc);
  for (let i = 0; i < count; i++) cellsOf(i, c => { items[fill[c]++] = i; });
  return { start, items };
}
function bounds(P, extra = null) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const A of extra ? [P, extra] : [P]) for (let i = 0; i < A.length; i += 3) for (let a = 0; a < 3; a++) { const v = A[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  return { mn, mx };
}
// Kabuk kabuk arama: (cx,cy,cz) hücresinin çevresindeki r. halka hücrelerini gez; lb(r) en iyi uzaklığı aşınca dur
function shellSearch(G, x, y, z, best2, visitCell) {
  const { mn, mx, cell, nx, ny, nz } = G;
  const bx = Math.max(mn[0] - x, 0, x - mx[0]), by = Math.max(mn[1] - y, 0, y - mx[1]), bz = Math.max(mn[2] - z, 0, z - mx[2]);
  if (bx * bx + by * by + bz * bz > best2()) return;
  const cx = Math.floor((x - mn[0]) / cell), cy = Math.floor((y - mn[1]) / cell), cz = Math.floor((z - mn[2]) / cell);
  const rmax = Math.max(nx, ny, nz) + Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz), Math.abs(cx - nx), Math.abs(cy - ny), Math.abs(cz - nz));
  for (let r = 0; r <= rmax; r++) {
    const lb = (r - 1) * cell; if (lb > 0 && lb * lb > best2()) break;
    const x0 = Math.max(0, cx - r), x1 = Math.min(nx - 1, cx + r), y0 = Math.max(0, cy - r), y1 = Math.min(ny - 1, cy + r), z0 = Math.max(0, cz - r), z1 = Math.min(nz - 1, cz + r);
    if (x0 > x1 || y0 > y1 || z0 > z1) continue;
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) {
      const face = r === 0 || iz === cz - r || iz === cz + r || iy === cy - r || iy === cy + r;
      if (face) { for (let ix = x0; ix <= x1; ix++) visitCell(ix + nx * (iy + ny * iz)); }
      else { if (cx - r >= 0) visitCell(cx - r + nx * (iy + ny * iz)); if (cx + r < nx) visitCell(cx + r + nx * (iy + ny * iz)); }
    }
  }
}

// Üçgen ızgarası: yüzeye en yakın nokta. part: { P, I }. cell: hücre boyu (cm; varsayılan ortalama kenarın 2 katı)
export class TriGrid {
  constructor(part, cell = 0) {
    const { P, I } = toPI(part); this.P = P; this.I = I; const nt = I.length / 3;
    const { mn, mx } = bounds(P);
    if (!cell) { let s = 0; const m = Math.min(nt, 2000); for (let t = 0; t < m; t++) { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1]; s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); } cell = Math.max(0.05, 2 * s / Math.max(1, m)); }
    cell = Math.max(cell, Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 160);      // en çok ~160^3 hücre
    Object.assign(this, { mn, mx, cell, nx: Math.floor((mx[0] - mn[0]) / cell) + 1, ny: Math.floor((mx[1] - mn[1]) / cell) + 1, nz: Math.floor((mx[2] - mn[2]) / cell) + 1 });
    const ci = (v, a) => Math.min(Math.floor((v - mn[a]) / cell), [this.nx, this.ny, this.nz][a] - 1);
    const g = gridBuild(this.nx, this.ny, this.nz, nt, (t, f) => {
      const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const lo = [0, 1, 2].map(k => ci(Math.min(P[a + k], P[b + k], P[c + k]), k)), hi = [0, 1, 2].map(k => ci(Math.max(P[a + k], P[b + k], P[c + k]), k));
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) f(x + this.nx * (y + this.ny * z));
    });
    this.start = g.start; this.items = g.items; this.stamp = new Int32Array(nt); this.q = 0;
  }
  // (x,y,z) noktasına en yakın yüzey noktası; maxD'den uzaksa null. Dönüş { d, p: [x,y,z], t: üçgen }
  closest(x, y, z, maxD = Infinity) {
    const { P, I, start, items, stamp } = this, tmp = [0, 0, 0], bp = [0, 0, 0];
    const q = ++this.q; let best = maxD * maxD, bt = -1;
    shellSearch(this, x, y, z, () => best, c => {
      for (let k = start[c]; k < start[c + 1]; k++) {
        const t = items[k]; if (stamp[t] === q) continue; stamp[t] = q;
        const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], cc = 3 * I[3 * t + 2];
        closestOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[cc], P[cc + 1], P[cc + 2], tmp);
        const dd = (tmp[0] - x) ** 2 + (tmp[1] - y) ** 2 + (tmp[2] - z) ** 2;
        if (dd < best) { best = dd; bt = t; bp[0] = tmp[0]; bp[1] = tmp[1]; bp[2] = tmp[2]; }
      }
    });
    return bt < 0 ? null : { d: Math.sqrt(best), p: bp, t: bt };
  }
}

// İki ağ arasındaki en kısa mesafe (köşe-yüzey, iki yönde; kenar-kenar durumunu kenar boyuna göre fazla tahmin edebilir).
// Dönüş { d, pa, pb } (pa A'da, pb B'de). ga/gb: hazır TriGrid (yoksa kurulur)
export function meshGap(A, B, ga = null, gb = null) {
  ga = ga || new TriGrid(A); gb = gb || new TriGrid(B);
  let best = { d: Infinity, pa: null, pb: null };
  const pass = (src, grid, flip) => {
    const P = toPI(src).P;
    for (let i = 0; i < P.length; i += 3) {
      const r = grid.closest(P[i], P[i + 1], P[i + 2], best.d); if (!r || r.d >= best.d) continue;
      const v = [P[i], P[i + 1], P[i + 2]];
      best = flip ? { d: r.d, pa: r.p.slice(), pb: v } : { d: r.d, pa: v, pb: r.p.slice() };
    }
  };
  pass(A, gb, false); pass(B, ga, true);
  return best;
}

// ---------------------------------------------------------------- 4. bağlantı
// Parçayı bağlı bileşenlerine ayır (modelde her dal ayrı bir tüptür). Dönüş [{ P, I, comp }] (kaynaklı köşelerle)
export function splitComponents(part, g = null) {
  g = g || topo(part);
  const cc = components(g), out = [];
  for (let c = 0; c < cc.count; c++) {
    const map = new Int32Array(g.n).fill(-1), P = [], I = [];
    for (let t = 0; t < g.tri.length; t += 3) {
      if (cc.id[g.tri[t]] !== c) continue;
      for (let q = 0; q < 3; q++) { const v = g.tri[t + q]; if (map[v] < 0) { map[v] = P.length / 3; P.push(g.Q[3 * v], g.Q[3 * v + 1], g.Q[3 * v + 2]); } I.push(map[v]); }
    }
    out.push({ P: Float32Array.from(P), I: Uint32Array.from(I), comp: c });
  }
  return out;
}

// Damar parçacıkları (segment) hazırla: her biri tek tüp. Dönüş [{ key, part, comp, P, I, loops, sk, path, len, box, grid }]
export function makeSegments(parts, opt = {}) {
  const segs = [];
  for (const part of parts) {
    for (const s of splitComponents(part)) {
      const g = topo(s), loops = boundaryLoops(g), sk = skeleton(s, { topo: g, h: opt.h || 0.1 }), mp = mainPath(sk);
      const { mn, mx } = bounds(s.P);
      segs.push({ key: `${part.id}#${s.comp}`, part, comp: s.comp, P: s.P, I: s.I, loops, sk, path: mp, len: skelLength(sk), box: { mn, mx }, grid: null, _g: g });
    }
  }
  return segs;
}
const boxGap = (a, b) => Math.hypot(Math.max(0, a.mn[0] - b.mx[0], b.mn[0] - a.mx[0]), Math.max(0, a.mn[1] - b.mx[1], b.mn[1] - a.mx[1]), Math.max(0, a.mn[2] - b.mx[2], b.mn[2] - a.mx[2]));
// Bir noktanın tüpün içinde olup olmadığı: merkez çizgisine (tüm dallar) uzaklık < yerel yarıçap
export function insideTube(seg, p, tol = 0) {
  let best = { d: Infinity, r: 0 };
  for (const [a, b] of seg.sk.edges) {
    const A = seg.sk.nodes[a], B = seg.sk.nodes[b], q = nearestOnPoly([A.p, B.p], p);
    if (q.d < best.d) best = { d: q.d, r: A.r + q.f * (B.r - A.r), q: q.q };
  }
  return { inside: best.d < best.r + tol, dCenter: best.d, rLocal: best.r, q: best.q };
}
// Her parçacığın her açık ucu (sınır halkası) için en yakın başka parçacık. Halka merkezi o tüpün içindeyse ya da halka
// kenarı yüzeye değiyorsa uç bağlıdır. Dönüş: [{ seg, loop, c, r, to, dSurf (merkez-yüzey), rim (halka köşeleri-yüzey en kısa),
// inside, dCenter, rLocal }]. maxD: aranacak en uzak mesafe (cm)
export function endContacts(segs, maxD = 1.5) {
  const out = [];
  for (const s of segs) {
    for (let li = 0; li < s.loops.length; li++) {
      const L = s.loops[li]; let best = null;
      for (const o of segs) {
        if (o === s || boxGap(s.box, o.box) > maxD) continue;
        o.grid = o.grid || new TriGrid(o);
        const r = o.grid.closest(L.c[0], L.c[1], L.c[2], maxD); if (!r) continue;
        const it = insideTube(o, L.c);
        const score = it.inside ? -1 + it.dCenter / Math.max(it.rLocal, 1e-6) : r.d;     // içerdekiler önce
        if (!best || score < best.score) best = { score, to: o, dSurf: r.d, p: r.p.slice(), ...it };
      }
      // halka kenarının en yakın yüzeye uzaklığı
      let rim = Infinity;
      if (best) { const g = best.to.grid; const Ls = loopVerts(s, L); for (let i = 0; i < Ls.length; i += 3) { const q = g.closest(Ls[i], Ls[i + 1], Ls[i + 2], 2 * maxD); if (q && q.d < rim) rim = q.d; } }
      out.push({ seg: s, loop: li, c: L.c, r: L.r, to: best ? best.to : null, dSurf: best ? best.dSurf : Infinity, rim, inside: best ? best.inside : false, dCenter: best ? best.dCenter : Infinity, rLocal: best ? best.rLocal : 0 });
    }
  }
  return out;
}
// Halka köşelerinin konumları (parçacığın kendi kaynaklı köşe dizisinden)
function loopVerts(s, L) {
  if (!s._g) s._g = topo(s);
  const Q = s._g.Q, out = [];
  for (const v of L.v) out.push(Q[3 * v], Q[3 * v + 1], Q[3 * v + 2]);
  return out;
}
// --- Şematik bağlantılar (Willis halkasında modelde değmeyen ya da yanlış yerde duran halkalar)
// Yardımcı: ana yol üzerinde s yay uzunluğundaki nokta, yarıçap ve teğet
function pathFrame(mp, s) {
  const pts = mp.pts, p = pointAt(pts, s), q = nearestOnPoly(pts, p), i = Math.min(q.i, pts.length - 2);
  const r = mp.r[i] + (q.f || 0) * ((mp.r[i + 1] ?? mp.r[i]) - mp.r[i]);
  const a = pointAt(pts, Math.max(0, s - 0.15)), b = pointAt(pts, Math.min(mp.len, s + 0.15));
  const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(...t) || 1;
  return { p, r, t: t.map(x => x / tl) };
}
// İki merkez çizgisi noktası arasında bağlantı: yüzey uçları (merkez + yarıçap * yön), boylar
function linkBetween(A, B, extra = {}) {
  const u = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]], cl = Math.hypot(...u) || 1, e = u.map(x => x / cl);
  const a = A.p.map((x, k) => x + A.r * e[k]), b = B.p.map((x, k) => x - B.r * e[k]);
  return { ca: A.p, cb: B.p, a, b, clen: cl, len: Math.max(0, cl - A.r - B.r), ra: A.r, rb: B.r, dir: e, ...extra };
}
// A1/A2 kavşağı: kökten (A1 başı) yürürken teğetin yukarı bileşeninin ilk kez upT'yi geçtiği nokta (A2 yukarı çıkar).
// Bulunamazsa ilk %70'teki en büyük eğrilik. Dönüş yay uzunluğu
export function a1a2Junction(mp, upT = 0.7) {
  for (let s = 0.2; s < mp.len * 0.9; s += 0.02) { const f = pathFrame(mp, s); if (f.t[1] > upT) return s; }
  let best = 0, bs = mp.len / 2;
  for (let s = 0.3; s < mp.len * 0.7; s += 0.02) { const a = pathFrame(mp, s - 0.2).t, b = pathFrame(mp, s + 0.2).t; const c = 1 - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]); if (c > best) { best = c; bs = s; } }
  return bs;
}
// Şematik ACoA: sol ve sağ ACA'nın A1/A2 kavşağı çevresinde (± win cm) merkez çizgileri arasındaki en yakın nokta çifti.
// acaL/acaR: { P, I } ya da hazır { mp } (mainPath). Dönüş linkBetween(...) + { sL, sR: kavşak yay uzunlukları }
export function acoaLink(acaL, acaR, opt = {}) {
  const win = opt.win ?? 0.5, step = opt.step ?? 0.02;
  const mpOf = x => x.mp || mainPath(skeleton(x, { h: opt.h || 0.1, root: opt.root }));
  const mL = mpOf(acaL), mR = mpOf(acaR), jL = a1a2Junction(mL, opt.upT), jR = a1a2Junction(mR, opt.upT);
  let best = null;
  for (let s = Math.max(0, jL - win); s <= Math.min(mL.len, jL + win); s += step) {
    const A = pathFrame(mL, s);
    for (let t = Math.max(0, jR - win); t <= Math.min(mR.len, jR + win); t += step) {
      const B = pathFrame(mR, t), d = dist(A.p, B.p) - A.r - B.r;
      if (!best || d < best.d) best = { d, A, B, s, t };
    }
  }
  return linkBetween(best.A, best.B, { sL: best.s, sR: best.t, jL, jR });
}
// Şematik PCoA: ICA'nın uç kısmı (son tLen cm, C7) ile PCA'nın P1/P2 kavşağı arası. P1/P2 kavşağı PCA'nın kökünden
// (baziler tepe) yay uzunluğu [sMin, sMax] aralığında, ICA'ya uzaklık + lam * |s - p1| en küçük olan nokta
// (p1: P1 boyu önsel değeri, ders kitabında ~0,7 cm). ica, pca: { P, I } ya da { mp }. opt.pcaRoot: baziler tepe ipucu
export function pcoaLink(ica, pca, opt = {}) {
  const tLen = opt.tLen ?? 0.6, p1 = opt.p1 ?? 0.75, lam = opt.lam ?? 0.5, sMin = opt.sMin ?? 0.3, sMax = opt.sMax ?? 1.6, step = opt.step ?? 0.02;
  const mI = ica.mp || mainPath(skeleton(ica, { h: opt.h || 0.1, root: opt.icaRoot }));
  let mP = pca.mp;
  if (!mP) { const sk = skeleton(pca, { h: opt.h || 0.1, root: opt.pcaRoot }); const R = opt.pcaRoot ? sk.roots.reduce((a, b) => (d2(a.p, opt.pcaRoot) <= d2(b.p, opt.pcaRoot) ? a : b)) : sk.roots[0]; mP = mainPath(sk, R.node); }
  let best = null, closest = null;
  for (let s = Math.max(0, mI.len - tLen); s <= mI.len; s += step) {
    const A = pathFrame(mI, s);
    for (let t = sMin; t <= Math.min(sMax, mP.len); t += step) {
      const B = pathFrame(mP, t), d = dist(A.p, B.p) - A.r - B.r, c = d + lam * Math.abs(t - p1);
      if (!best || c < best.c) best = { c, d, A, B, s, t };
      if (!closest || d < closest.d) closest = { d, s, t, A, B };
    }
  }
  return linkBetween(best.A, best.B, { sIca: best.s, icaLen: mI.len, sPca: best.t, closest: { len: closest.d, sIca: closest.s, sPca: closest.t, a: closest.A.p, b: closest.B.p } });
}
// İki ağın en yakın noktaları arasında köprü (küçük boşluklar için): uçlar ext kadar ağların içine uzatılır
export function bridge(A, B, ext = 0.05) {
  const g = meshGap(A, B); if (!g.pa) return null;
  const u = [g.pb[0] - g.pa[0], g.pb[1] - g.pa[1], g.pb[2] - g.pa[2]], l = Math.hypot(...u) || 1, e = u.map(x => x / l);
  return { gap: g.d, a: g.pa.map((x, k) => x - ext * e[k]), b: g.pb.map((x, k) => x + ext * e[k]), pa: g.pa, pb: g.pb };
}

// Bir parçanın gövde yolu: near (nokta) verilirse köke en yakın bileşen, yoksa en uzun ana yollu bileşen
export function trunkPath(part, opt = {}) {
  const sk = opt.sk || skeleton(part, { h: opt.h || 0.1, root: opt.root });
  let best = null;
  for (const R of sk.roots) {
    const mp = mainPath(sk, R.node);
    const score = opt.near ? -d2(R.p, opt.near) : mp.len;
    if (!best || score > best.score) best = { score, mp };
  }
  return best.mp;
}

// Willis halkası için hepsi bir arada: parçalar { acaL, acaR, icaL, icaR, pcaL, pcaR, basilar, pcoaL?, pcoaR?, acoa? }.
// Dönüş { acoa: acoaLink, pcoa: { l, r }, bridges: { icaPcoaL, icaPcoaR }, acoaModelGap: { l, r } }
export function willisLinks(p, opt = {}) {
  const tip = trunkPath(p.basilar).pts.at(-1);                       // baziler tepe = PCA kökleri
  const out = { acoa: acoaLink(p.acaL, p.acaR, opt), pcoa: {}, bridges: {}, acoaModelGap: {} };
  for (const s of ['L', 'R']) {
    out.pcoa[s.toLowerCase()] = pcoaLink(p['ica' + s], p['pca' + s], { ...opt, pcaRoot: tip });
    if (p['pcoa' + s]) out.bridges['icaPcoa' + s] = bridge(p['ica' + s], p['pcoa' + s]);
    if (p.acoa) out.acoaModelGap[s.toLowerCase()] = meshGap(p.acoa, p['aca' + s]).d;
  }
  return out;
}

// ---------------------------------------------------------------- 5. beslenme alanı (vasküler bölge) boyama
// Damar grupları (meta.json İngilizce adları; M2 ve M3 adları sol/sağda farklı yazılır, ikisi de listede). ACoA, PCoA ve
// ICA kabuğu beslemez, dışarıda. TERRITORY_TRUNKS: "yalnız kabuk dalları" varyantında çıkarılan gövde ve derin dallar.
export const TERRITORY_ARTERIES = {
  ACA: ['Anterior cerebral artery', 'Pericallosal artery', 'Callosomarginal artery', 'Frontal branches of callosomarginal artery', 'Orbitofrontal branches of anterior cerebral artery'],
  MCA: ['Middle cerebral artery (M1-segment)', 'Insular branches of middle cerebral artery (M2-segment)', 'Insular branches of middle cerebral artery (M2)',
    'Middle cerebral artery (M3 segment)', 'Middle cerebral artery (M3-segment)', 'Anterior temporal branch', 'Artery of precentral sulcus', 'Prefrontal artery',
    'Lateral frontobasal artery', 'Artery of central sulcus', 'Parietal branches of middle cerebral artery', 'Postcentral arterial branch', 'Posterior parietal artery',
    'Posterior temporal branch', 'Temporal branches of middle cerebral artery', 'Temporo-occipital branch', 'Branch to angular gyrus',
    'Proximal lateral striate branches', 'Distal lateral striate branches'],
  PCA: ['Posterior cerebral artery', 'Medial occipital artery', 'Lateral occipital artery', 'Parieto-occipital artery'],
};
export const TERRITORY_TRUNKS = ['Anterior cerebral artery', 'Middle cerebral artery (M1-segment)', 'Proximal lateral striate branches', 'Distal lateral striate branches'];
// Ders kitabı beslenme alanı tablosu, 64 kabuk parçası (her yarımküre; Tatu ve ark. 1998, Prometheus, Radiology Assistant).
// Tek harf: tek alan. İki harf: bölünmüş parça (sınır bölgesi), ilk harf baskın alan. A = ACA, M = MCA, P = PCA.
export const TERRITORY_TABLE = {
  'Superior frontal gyrus': 'A', 'Superior frontal sulcus': 'AM', 'Middle frontal gyrus': 'M', 'Middle frontal sulcus': 'M', 'Inferior frontal sulcus': 'M',
  'Opercular part of inferior frontal gyrus': 'M', 'Triangular part of inferior frontal gyrus': 'M', 'Orbital part of inferior frontal gyrus': 'M',
  'Anterior ascending ramus of lateral sulcus': 'M', 'Anterior horizontal ramus of lateral sulcus': 'M', 'Precentral gyrus': 'MA', 'Precentral sulcus (Superior part)': 'MA',
  'Precentral sulcus (inferior part)': 'M', 'Paracentral gyrus and sulcus': 'A', 'Subcentral gyrus and sulci': 'M', 'Frontomarginal gyrus and sulcus': 'MA',
  'Transverse frontopolar gyrus and sulcus': 'AM', 'Orbital gyri': 'AM', 'Orbital sulci (H-shaped orbital sulci)': 'AM', 'Orbital sulci (Lateral Orbital sulcus)': 'M',
  'Olfactory sulcus': 'A', 'Straight gyrus (Gyrus rectus)': 'A',
  'Postcentral gyrus': 'MA', 'Postcentral sulcus': 'M', 'Superior parietal lobule': 'AM', 'Intraparietal sulcus': 'M', 'Supramarginal gyrus': 'M', 'Angular gyrus': 'M', 'Precuneus': 'AP',
  'Cuneus': 'P', 'Lingual gyrus': 'P', 'Calcarine sulcus': 'P', 'Occipital pole': 'P', 'Superior occipital gyri': 'PM', 'Superior and transverse occipital sulci': 'PM',
  'Lateral occipital gyrus (Middle occipital gyrus)': 'MP', 'Middle occipital sulcus and lunate sulcus': 'MP', 'Inferior occipital gyrus and sulcus': 'PM',
  'Temporal pole': 'M', 'Superior temporal gyrus (Lateral part)': 'M', 'Anterior transverse temporal gyrus': 'M', 'Temporal plane': 'M', 'Superior temporal sulcus': 'M',
  'Middle temporal gyrus': 'M', 'Inferior temporal gyrus': 'PM', 'Occipitotemporal sulcus (Lateral part)': 'P', 'Lateral occipitotemporal gyrus': 'P',
  'Medial occipitotemporal gyrus (Parahippocampal)': 'P', 'Anterior transverse collateral sulcus': 'P',
  'Cingulate gyrus and sulcus (Middle anterior part)': 'A', 'Cingulate gyrus and sulcus (Middle posterior part)': 'A', 'Cingulate gyrus (Posterior dorsal part)': 'A',
  'Cingulate gyrus (Posteroventral part)': 'PA', 'Cingulate sulcus (Marginal part)': 'A', 'Hippocampus': 'P',
  'Central sulcus': 'MA', 'Circular sulcus of insula (Superior part)': 'M', 'Posterior ramus of lateral sulcus': 'M', 'Intermediate sulcus of Jensen': 'M',
  'Anterior occipital sulcus': 'MP', 'Parieto-occipital sulcus': 'PA', 'Subparietal sulcus': 'A', 'Collateral sulcus': 'P', 'Posterior transverse collateral sulcus': 'P',
};
// Nokta ızgarası: en yakın örnek noktası. P: xyz dizisi. cell: hücre boyu (cm)
export class PointGrid {
  constructor(P, cell = 0.3) {
    const n = P.length / 3; this.P = P;
    const { mn, mx } = bounds(P);
    cell = Math.max(cell, Math.cbrt(((mx[0] - mn[0] + cell) * (mx[1] - mn[1] + cell) * (mx[2] - mn[2] + cell)) / 4e6));   // en çok ~4 M hücre
    Object.assign(this, { mn, mx, cell, nx: Math.floor((mx[0] - mn[0]) / cell) + 1, ny: Math.floor((mx[1] - mn[1]) / cell) + 1, nz: Math.floor((mx[2] - mn[2]) / cell) + 1 });
    const g = gridBuild(this.nx, this.ny, this.nz, n, (i, f) => f(Math.floor((P[3 * i] - mn[0]) / cell) + this.nx * (Math.floor((P[3 * i + 1] - mn[1]) / cell) + this.ny * Math.floor((P[3 * i + 2] - mn[2]) / cell))));
    this.start = g.start; this.items = g.items; this.d = Infinity;
  }
  // en yakın noktanın indisi (yoksa -1); uzaklık this.d
  nearest(x, y, z, maxD = Infinity) {
    const { P, start, items } = this; let best = maxD * maxD, bi = -1;
    shellSearch(this, x, y, z, () => best, c => {
      for (let k = start[c]; k < start[c + 1]; k++) {
        const i = items[k], dd = (P[3 * i] - x) ** 2 + (P[3 * i + 1] - y) ** 2 + (P[3 * i + 2] - z) ** 2;
        if (dd < best) { best = dd; bi = i; }
      }
    });
    this.d = bi < 0 ? Infinity : Math.sqrt(best);
    return bi;
  }
}

// Ağ yüzeyinden örnek noktalar: köşeler + uzun kenarlarda ara noktalar (aralık <= step). parts: [{ P, I }]
export function samplePoints(parts, step = 0.1) {
  const out = [];
  for (const part of parts) {
    const { P, I } = toPI(part), seen = new Set();
    for (let i = 0; i < P.length; i++) out.push(P[i]);
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = I[t + k], b = I[t + (k + 1) % 3], key = a < b ? a * 1e7 + b : b * 1e7 + a; if (seen.has(key)) continue; seen.add(key);
      const l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]), m = Math.ceil(l / step);
      for (let j = 1; j < m; j++) { const f = j / m; out.push(P[3 * a] + f * (P[3 * b] - P[3 * a]), P[3 * a + 1] + f * (P[3 * b + 1] - P[3 * a + 1]), P[3 * a + 2] + f * (P[3 * b + 2] - P[3 * a + 2])); }
    }
  }
  return Float32Array.from(out);
}

// Etiketli örnek kümesi: groups = [{ label, parts: [{P, I}] }] -> { P, L (Uint8Array etiket), grid }
export function labeledSamples(groups, step = 0.1, cell = 0.3) {
  const Ps = [], Ls = [];
  for (const g of groups) { const S = samplePoints(g.parts, step); Ps.push(S); Ls.push(new Uint8Array(S.length / 3).fill(g.label)); }
  const n = Ps.reduce((s, a) => s + a.length, 0), P = new Float32Array(n), L = new Uint8Array(n / 3);
  let o = 0; Ps.forEach((S, i) => { P.set(S, o); L.set(Ls[i], o / 3); o += S.length; });
  return { P, L, grid: new PointGrid(P, cell) };
}

// En yakın damar grubu. V: sorgu noktaları (xyz). Tek ızgara: S = labeledSamples(...) -> her nokta için 1 sorgu.
// Dönüş { lab: Uint8Array, d: Float32Array }. maxD: bundan uzak noktalara 255 (atanmadı) yazılır
export function nearestLabels(V, S, maxD = Infinity) {
  const n = V.length / 3, lab = new Uint8Array(n), d = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = S.grid.nearest(V[3 * i], V[3 * i + 1], V[3 * i + 2], maxD); lab[i] = j < 0 ? 255 : S.L[j]; d[i] = S.grid.d; }
  return { lab, d };
}
// Ağırlıklı sürüm: groups = [{ label, grid: PointGrid, w }]: d / w en küçük olan grup (w > 1 grubu "uzağa ulaştırır").
// allow(i): (isteğe bağlı) i. nokta için izinli etiketler kümesi (Set) ya da null
export function weightedLabels(V, groups, allow = null) {
  const n = V.length / 3, lab = new Uint8Array(n), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity, bl = 255, bd = Infinity; const A = allow ? allow(i) : null;
    for (const g of groups) {
      if (A && !A.has(g.label)) continue;
      const j = g.grid.nearest(V[3 * i], V[3 * i + 1], V[3 * i + 2], best * (g.w || 1)); if (j < 0) continue;
      const s = g.grid.d / (g.w || 1); if (s < best) { best = s; bl = g.label; bd = g.grid.d; }
    }
    lab[i] = bl; d[i] = bd;
  }
  return { lab, d };
}

// Parça içi çoğunluk süzgeci (kaynaklı komşuluk üzerinde, iter tur). parts: [{ P, I }] ve her parçanın lab içindeki başlangıcı
export function smoothLabels(lab, parts, offs, iter = 2, nLab = 4) {
  const out = lab.slice();
  parts.forEach((part, pi) => {
    const g = part._topo || (part._topo = topo(part)), o = offs[pi];
    let cur = new Uint8Array(g.n);
    for (let i = 0; i < g.cl.length; i++) cur[g.cl[i]] = out[o + i];
    const cnt = new Int32Array(nLab + 1);
    for (let it = 0; it < iter; it++) {
      const nxt = cur.slice();
      for (let v = 0; v < g.n; v++) {
        cnt.fill(0); cnt[Math.min(cur[v], nLab)] += 1;
        for (let e = g.off[v]; e < g.off[v + 1]; e++) cnt[Math.min(cur[g.adj[e]], nLab)]++;
        let b = cur[v]; for (let l = 0; l < nLab; l++) if (cnt[l] > cnt[Math.min(b, nLab)]) b = l;
        nxt[v] = b;
      }
      cur = nxt;
    }
    for (let i = 0; i < g.cl.length; i++) out[o + i] = cur[g.cl[i]];
  });
  return out;
}

// Parça başına etiket sayıları ve çoğunluk. offs: parça başlangıçları (n+1 uzunlukta, son = toplam)
export function partVotes(lab, offs, nLab = 3) {
  const out = [];
  for (let p = 0; p + 1 < offs.length; p++) {
    const c = new Array(nLab).fill(0);
    for (let i = offs[p]; i < offs[p + 1]; i++) if (lab[i] < nLab) c[lab[i]]++;
    const tot = c.reduce((a, b) => a + b, 0) || 1;
    out.push({ counts: c, frac: c.map(x => x / tot), major: c.indexOf(Math.max(...c)) });
  }
  return out;
}

// --- Uzaklık alanı (öklid uzaklık dönüşümü, Felzenszwalb & Huttenlocher 2012): örnek noktalarına en kısa uzaklık bir
// voksel ızgarasında doğrusal sürede, kesin olarak (voksel merkezleri için) hesaplanır; köşe başına sorgu O(1).
// 1B kare uzaklık dönüşümü: f (giriş, INF = yok) -> d. v, z: çalışma dizileri
function edt1d(f, d, n, v, z) {
  let k = -1;
  for (let q = 0; q < n; q++) {
    if (f[q] >= 1e30) continue;
    const fq = f[q] + q * q;
    while (k >= 0) { const s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) k--; else { k++; v[k] = q; z[k] = s; break; } }
    if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; }
  }
  if (k < 0) { for (let q = 0; q < n; q++) d[q] = 1e30; return; }
  z[k + 1] = Infinity; let j = 0;
  for (let q = 0; q < n; q++) { while (z[j + 1] < q) j++; const t = q - v[j]; d[q] = t * t + f[v[j]]; }
}
// Izgara tanımı: kutu (mn, mx) ve voksel boyu h (cm). Dönüş { mn, h, nx, ny, nz }
export function makeVoxelGrid(mn, mx, h) { return { mn: mn.slice(), h, nx: Math.floor((mx[0] - mn[0]) / h) + 1, ny: Math.floor((mx[1] - mn[1]) / h) + 1, nz: Math.floor((mx[2] - mn[2]) / h) + 1 }; }
// Örnek noktalarına uzaklık alanı. P: xyz. Dönüş Float32Array (voksel merkezinden en yakın örneğin vokseline uzaklık, cm)
export function distanceField(G, P) {
  const { mn, h, nx, ny, nz } = G, N = nx * ny * nz, F = new Float32Array(N).fill(1e30);
  for (let i = 0; i < P.length; i += 3) {
    const x = Math.min(nx - 1, Math.max(0, Math.floor((P[i] - mn[0]) / h))), y = Math.min(ny - 1, Math.max(0, Math.floor((P[i + 1] - mn[1]) / h))), z = Math.min(nz - 1, Math.max(0, Math.floor((P[i + 2] - mn[2]) / h)));
    F[x + nx * (y + ny * z)] = 0;
  }
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), zz = new Float64Array(m + 1);
  // satır: başlangıç o, adım st, uzunluk n. Tamamen boş satır atlanır (seyrek örneklerde x ve y geçişlerinin çoğu)
  const row = (o, st, n) => {
    let any = false; for (let q = 0, p = o; q < n; q++, p += st) { const x = F[p]; f[q] = x; if (x < 1e30) any = true; }
    if (!any) return; edt1d(f, d, n, v, zz); for (let q = 0, p = o; q < n; q++, p += st) F[p] = d[q];
  };
  const sz = nx * ny;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) row(nx * (j + ny * k), 1, nx);    // x boyunca
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) row(i + sz * k, nx, ny);           // y boyunca
  for (let o = 0; o < sz; o++) row(o, sz, nz);                                                 // z boyunca
  for (let i = 0; i < N; i++) F[i] = F[i] >= 1e29 ? Infinity : Math.sqrt(F[i]) * h;
  return F;
}
// Alanın (x,y,z) noktasındaki değeri: çevredeki 8 voksel merkezinden üç doğrusal ara değer
export function fieldAt(G, F, x, y, z) {
  const { mn, h, nx, ny, nz } = G;
  let u = (x - mn[0]) / h - 0.5, w = (y - mn[1]) / h - 0.5, t = (z - mn[2]) / h - 0.5;
  u = Math.min(nx - 1, Math.max(0, u)); w = Math.min(ny - 1, Math.max(0, w)); t = Math.min(nz - 1, Math.max(0, t));
  const i = Math.min(nx - 2, Math.floor(u)), j = Math.min(ny - 2, Math.floor(w)), k = Math.min(nz - 2, Math.floor(t));
  if (i < 0 || j < 0 || k < 0) return F[Math.round(u) + nx * (Math.round(w) + ny * Math.round(t))];
  const fu = u - i, fw = w - j, ft = t - k, o = i + nx * (j + ny * k), sy = nx, sz = nx * ny;
  const c00 = F[o] * (1 - fu) + F[o + 1] * fu, c10 = F[o + sy] * (1 - fu) + F[o + sy + 1] * fu;
  const c01 = F[o + sz] * (1 - fu) + F[o + sz + 1] * fu, c11 = F[o + sz + sy] * (1 - fu) + F[o + sz + sy + 1] * fu;
  return (c00 * (1 - fw) + c10 * fw) * (1 - ft) + (c01 * (1 - fw) + c11 * fw) * ft;
}
// Alanlardan etiket: fields = [{ label, F, w = 1 }], d / w en küçük olan. allow(i): izinli etiket kümesi ya da null
export function fieldLabels(V, G, fields, allow = null) {
  const n = V.length / 3, lab = new Uint8Array(n), dd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const A = allow ? allow(i) : null; let best = Infinity, bl = 255, bd = Infinity;
    for (const f of fields) { if (A && !A.has(f.label)) continue; const d = fieldAt(G, f.F, V[3 * i], V[3 * i + 1], V[3 * i + 2]); const s = d / (f.w || 1); if (s < best) { best = s; bl = f.label; bd = d; } }
    lab[i] = bl; dd[i] = bd;
  }
  return { lab, d: dd };
}

// Seyrek örnekleme + en yakın örnekten aktarma: V'yi cell boyutlu vokselde birer köşeye indir, yalnız onları labelFn ile
// etiketle (labelFn(Vsub) -> Uint8Array), sonra her köşeye en yakın örneğin etiketini ver. Dönüş { lab, nSub }
export function subsampleLabels(V, cell, labelFn) {
  const n = V.length / 3, seen = new Map(), pick = [];
  for (let i = 0; i < n; i++) { const k = Math.floor(V[3 * i] / cell) + ',' + Math.floor(V[3 * i + 1] / cell) + ',' + Math.floor(V[3 * i + 2] / cell); if (!seen.has(k)) { seen.set(k, pick.length); pick.push(i); } }
  const Vs = new Float32Array(pick.length * 3); pick.forEach((i, j) => { Vs[3 * j] = V[3 * i]; Vs[3 * j + 1] = V[3 * i + 1]; Vs[3 * j + 2] = V[3 * i + 2]; });
  const ls = labelFn(Vs), grid = new PointGrid(Vs, cell), lab = new Uint8Array(n);
  for (let i = 0; i < n; i++) lab[i] = ls[grid.nearest(V[3 * i], V[3 * i + 1], V[3 * i + 2])];
  return { lab, nSub: pick.length };
}

// Bir yarımküre için hepsi bir arada (önerilen yol). arteries: [{ label, parts }] (0 ACA, 1 MCA, 2 PCA; aynı taraf),
// cortex: [{ P, I, code? }] (code: 'A' | 'M' | 'P' tek alanlı, 'AM' gibi iki harf bölünmüş, yoksa serbest).
// mode: 'nearest' (yalnız arterler), 'hybrid' (tablo + bölünmüş parçada iki izinli arter), 'seed' (tablo + bölünmüş parçada
// en yakın tek alanlı komşu parça), 'mix' (bölünmüş parçada arter + tohum uzaklıkları toplamı). h: voksel boyu (cm).
// Dönüş { lab: Uint8Array (parçalar art arda), offs, G, ms }
export function territoryLabels(arteries, cortex, opt = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const h = opt.h || 0.2, mode = opt.mode || 'hybrid', CODE = { A: 0, M: 1, P: 2 };
  const offs = [0]; for (const c of cortex) offs.push(offs[offs.length - 1] + toPI(c).P.length / 3);
  const V = new Float32Array(offs[offs.length - 1] * 3); let o = 0; for (const c of cortex) { V.set(toPI(c).P, o); o += toPI(c).P.length; }
  const { mn, mx } = bounds(V); for (let a = 0; a < 3; a++) { mn[a] -= 1; mx[a] += 1; }
  const G = makeVoxelGrid(mn, mx, h);
  const partOf = new Int32Array(V.length / 3); cortex.forEach((c, i) => partOf.fill(i, offs[i], offs[i + 1]));
  const allow = cortex.map(c => (c.code ? new Set([...c.code].map(x => CODE[x])) : null));
  let fields = null;
  if (mode !== 'seed') fields = arteries.map(g => ({ label: g.label, F: distanceField(G, samplePoints(g.parts, Math.min(0.1, h / 2))) }));
  if (mode === 'seed' || mode === 'mix') {
    const seed = [[], [], []];
    cortex.forEach((c, i) => { if (c.code && c.code.length === 1) for (let k = offs[i]; k < offs[i + 1]; k++) seed[CODE[c.code]].push(V[3 * k], V[3 * k + 1], V[3 * k + 2]); });
    const FS = seed.map((P, label) => ({ label, F: distanceField(G, Float32Array.from(P)) }));
    fields = mode === 'seed' ? FS : fields.map((f, g) => { const F = new Float32Array(f.F.length); for (let i = 0; i < F.length; i++) F[i] = f.F[i] + FS[g].F[i]; return { label: f.label, F }; });
  }
  const res = fieldLabels(V, G, fields, mode === 'nearest' ? null : k => allow[partOf[k]]);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { lab: res.lab, d: res.d, offs, G, ms };
}

// ---------------------------------------------------------------- 6. etiket yeri
// Bir damarın etiketi için nokta. mp: ana yol { pts, r, len } (trunkPath / mainPath). [lo, hi]: yay uzunluğu oranı
// aralığı. Aday = merkez + (r + lift) * toCam (damarın kameraya bakan yüzü). Puan: örtülüyse +10; teğet bakış yönüne
// paralelse (damar uçtan görünür) + |t . toCam|; ortadan uzaklık + |s/len - 0.5|. occluded(p, toCam) -> bool isteğe bağlı
// (tarayıcıda beyin parçalarının boundsTree.raycastFirst'ü ile). Dönüş { p, s, visible, score }
export function labelAnchor(mp, toCam, opt = {}) {
  const lo = opt.lo ?? 0.15, hi = opt.hi ?? 0.85, lift = opt.lift ?? 0.05, n = opt.n ?? 24;
  let best = null;
  for (let k = 0; k <= n; k++) {
    const s = mp.len * (lo + (hi - lo) * k / n), f = pathFrame(mp, s);
    const p = f.p.map((x, a) => x + (f.r + lift) * toCam[a]);
    const occ = opt.occluded ? opt.occluded(p, toCam) : false;
    const par = Math.abs(f.t[0] * toCam[0] + f.t[1] * toCam[1] + f.t[2] * toCam[2]);
    const score = (occ ? 10 : 0) + par + Math.abs(s / (mp.len || 1) - 0.5);
    if (!best || score < best.score) best = { p, s, visible: !occ, score };
  }
  return best;
}
