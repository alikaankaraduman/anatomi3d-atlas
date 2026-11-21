// geo-nerves/lib.mjs: portable geometry for the "Kranial sinirler" tab of the brain study mode.
//
// Every function takes plain inputs: a part is either { P: Float32Array (world xyz), I: index array } or a
// THREE.BufferGeometry with world-space positions and an index (a runtime record's r.geo; its boundsTree is reused
// when present, otherwise one is built and cached on it, exactly as r.geo.computeBoundsTree() would). Points are plain
// [x, y, z] arrays. Only 'three' and 'three-mesh-bvh' are imported, so the file runs unchanged in node (tools) and in
// the browser (paste into src/brain.js). Units cm; +x = body's left, +y up, +z anterior.
//
// Main entry points (runtime: the first group; the second group is for checks/offline work)
//   centreline(part, { root, tip, step, maxGeo })   skeleton of a tube mesh (separate touching tubes are bridged): main
//                                                    path from the end nearest root, radius profile, side branches
//   brainExit(pts, brainParts)                      where the centreline leaves the brainstem union (last inside->outside)
//   enclosureProfile(pts, bones, { R, nDirs, from, to, every })  share of perpendicular rays that hit bone within R
//   foramenRuns(pts, profile, { thr, gap })         enclosed stretches = skull openings/canals (entry, mid, exit, bones)
//   convergence(paths)                              common point of several nerves (SOF, IAM, jugular foramen)
//   extremeIndex(pts, dir, i0, i1)                  e.g. most dorsal sample (trochlear nerve exit)
//   radialOffset(p, brainstemParts, d)              label anchor moved away from the brainstem axis
//   ladder(points, gap, lift)                       vertical label ladder for crowded exits (VII/VIII/IX/X)
//   centroidOf(part), closestOnParts(bvhs, p), insideAny(bvhs, boxes, p), insideMesh(bvh, p), bvhOf(part)
//   surfaceCrossings(nerve, brainParts)             rings where the nerve surface pierces the brain surface (rootlets)
//   segmentBoneHits(pts, bones)                     where the centreline itself pierces a bone surface
//   openingSearch(p, t, bones, { radius, step })    cross-section flood fill: closed bony ring around the nerve? size?
//   canalScan(pts, bones, { from, to })             openingSearch along the path: closed-ring and in-bone stretches
//   spreadLabels(points, minDist), frameView(box, dir, fov, aspect), boxOfPoints, boxOfParts, resample, tangents, weld
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// ---------------------------------------------------------------------------------------------------------------
// part access
// ---------------------------------------------------------------------------------------------------------------
export function toPI(part) {
  if (part.P && part.I) return part;
  const g = part.isBufferGeometry ? part : part.geo;
  return { P: g.attributes.position.array, I: g.index.array };
}

// MeshBVH of a part (built once and cached). For a BufferGeometry this is geometry.boundsTree (same object
// computeBoundsTree() creates); for { P, I } a private geometry with a copied index is used, P/I stay untouched.
export function bvhOf(part) {
  if (part.isBufferGeometry) {
    if (!part.boundsTree) { if (part.computeBoundsTree) part.computeBoundsTree(); else part.boundsTree = new MeshBVH(part); }
    return part.boundsTree;
  }
  if (part.geo && part.geo.isBufferGeometry) return bvhOf(part.geo);
  if (part._bvh) return part._bvh;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.P, 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(part.I), 1));
  Object.defineProperty(part, '_bvh', { value: new MeshBVH(g), enumerable: false });
  return part._bvh;
}
export function boxOfBVH(bvh) {
  const g = bvh.geometry; if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox;
}

// ---------------------------------------------------------------------------------------------------------------
// small vector helpers on [x, y, z]
// ---------------------------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vec = { sub, add, mul, dot, cross, len, norm, dist, lerp };

// ---------------------------------------------------------------------------------------------------------------
// mesh topology
// ---------------------------------------------------------------------------------------------------------------
// Merge vertices that share a position (material/UV seams split them in the GLB). Drops degenerate triangles.
export function weld(P, I, tol = 1e-3) {
  const n = P.length / 3, q = 1 / tol, map = new Map(), remap = new Uint32Array(n), V = [];
  for (let i = 0; i < n; i++) {
    const key = Math.round(P[3 * i] * q) + ',' + Math.round(P[3 * i + 1] * q) + ',' + Math.round(P[3 * i + 2] * q);
    let j = map.get(key);
    if (j === undefined) { j = V.length / 3; map.set(key, j); V.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); }
    remap[i] = j;
  }
  const T = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
    if (a !== b && b !== c && a !== c) T.push(a, b, c);
  }
  // drop vertices no triangle uses (a sub-mesh passed with the full position array)
  const used = new Int32Array(V.length / 3).fill(-1); let m = 0;
  for (const v of T) if (used[v] < 0) used[v] = m++;
  if (m === V.length / 3) return { V: new Float32Array(V), T: Uint32Array.from(T), nV: m, remap };
  const V2 = new Float32Array(m * 3);
  for (let v = 0; v < used.length; v++) if (used[v] >= 0) { V2[3 * used[v]] = V[3 * v]; V2[3 * used[v] + 1] = V[3 * v + 1]; V2[3 * used[v] + 2] = V[3 * v + 2]; }
  for (let i = 0; i < n; i++) remap[i] = used[remap[i]] >= 0 ? used[remap[i]] : 0xffffffff;
  return { V: V2, T: Uint32Array.from(T, v => used[v]), nV: m, remap };
}

function makeUF(n) {
  const p = new Int32Array(n); for (let i = 0; i < n; i++) p[i] = i;
  const find = x => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) p[a] = b; return a !== b; };
  return { find, union };
}

// connected components over triangles: comp[v] in 0..count-1, size[c]
export function components(nV, T) {
  const uf = makeUF(nV);
  for (let t = 0; t < T.length; t += 3) { uf.union(T[t], T[t + 1]); uf.union(T[t + 1], T[t + 2]); }
  const id = new Map(), comp = new Int32Array(nV), size = [];
  for (let v = 0; v < nV; v++) {
    const r = uf.find(v); let c = id.get(r);
    if (c === undefined) { c = size.length; id.set(r, c); size.push(0); }
    comp[v] = c; size[c]++;
  }
  return { comp, count: size.length, size };
}

function uniqueEdges(nV, T) {
  const seen = new Set(), E = [];
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = T[t + k], b = T[t + (k + 1) % 3], u = a < b ? a : b, v = a < b ? b : a, key = u * nV + v;
    if (!seen.has(key)) { seen.add(key); E.push(u, v); }
  }
  return E;
}

// Bridges between components (separately modelled branch tubes that touch or overlap): closest vertex pairs, chosen
// Kruskal-style so every component is joined once. Pairs closer than `tol` are found with a grid; components still
// apart after that are joined by brute force and flagged gap=true (their distance is reported).
function bridgeComponents(V, nV, comp, nComp, tol) {
  if (nComp < 2) return [];
  // uniform grid with cell = tol, numeric keys relative to the bounding box
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nV; i++) { const x = V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
  const q = 1 / tol, nx = Math.floor((x1 - x0) * q) + 3, ny = Math.floor((y1 - y0) * q) + 3;
  const cell = new Int32Array(nV), grid = new Map();
  for (let i = 0; i < nV; i++) {
    const k = (Math.floor((V[3 * i] - x0) * q) + 1) + nx * ((Math.floor((V[3 * i + 1] - y0) * q) + 1) + ny * (Math.floor((V[3 * i + 2] - z0) * q) + 1));
    cell[i] = k; let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(i);
  }
  const best = new Map(), tol2 = tol * tol;
  for (let i = 0; i < nV; i++) {
    const ci = comp[i], xi = V[3 * i], yi = V[3 * i + 1], zi = V[3 * i + 2];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const arr = grid.get(cell[i] + dx + nx * (dy + ny * dz)); if (!arr) continue;
      for (let m = 0; m < arr.length; m++) {
        const j = arr[m]; if (j <= i || comp[j] === ci) continue;
        const ex = xi - V[3 * j], ey = yi - V[3 * j + 1], ez = zi - V[3 * j + 2], d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > tol2) continue;
        const key = Math.min(ci, comp[j]) * nComp + Math.max(ci, comp[j]);
        const bb = best.get(key); if (!bb || d2 < bb[2]) best.set(key, [i, j, d2]);
      }
    }
  }
  const uf = makeUF(nComp), out = [];
  for (const [i, j, d2] of [...best.values()].sort((u, w) => u[2] - w[2])) if (uf.union(comp[i], comp[j])) out.push({ i, j, d: Math.sqrt(d2), gap: false });
  // remaining separate sets: brute force closest pair between sets
  for (;;) {
    const sets = new Map();
    for (let v = 0; v < nV; v++) { const st = uf.find(comp[v]); let arr = sets.get(st); if (!arr) sets.set(st, arr = []); arr.push(v); }
    if (sets.size < 2) break;
    const keys = [...sets.keys()], A = sets.get(keys[0]);
    let bd = Infinity, bi = -1, bj = -1;
    for (let k = 1; k < keys.length; k++) for (const j of sets.get(keys[k])) for (const i of A) {
      const d = Math.hypot(V[3 * i] - V[3 * j], V[3 * i + 1] - V[3 * j + 1], V[3 * i + 2] - V[3 * j + 2]);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    uf.union(comp[bi], comp[bj]); out.push({ i: bi, j: bj, d: bd, gap: true });
  }
  return out;
}

// binary-heap Dijkstra on a CSR graph. dist0: optional pre-filled distances (multi-source).
function dijkstra(nV, off, nbr, w, seeds, maxD = Infinity) {
  const d = new Float64Array(nV).fill(Infinity), par = new Int32Array(nV).fill(-1);
  const heap = [], push = (v, k) => { heap.push([k, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of seeds) { d[s] = 0; push(s, 0); }
  while (heap.length) {
    const [k, v] = pop(); if (k > d[v]) continue;
    for (let e = off[v]; e < off[v + 1]; e++) { const u = nbr[e], nd = k + w[e]; if (nd < d[u] && nd <= maxD) { d[u] = nd; par[u] = v; push(u, nd); } }
  }
  return { d, par };
}

function csr(n, pairs, weights) {
  const off = new Int32Array(n + 1);
  for (let k = 0; k < pairs.length; k += 2) { off[pairs[k] + 1]++; off[pairs[k + 1] + 1]++; }
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const fill = off.slice(0, n), nbr = new Int32Array(pairs.length), w = new Float64Array(pairs.length);
  for (let k = 0, e = 0; k < pairs.length; k += 2, e++) {
    const a = pairs[k], b = pairs[k + 1];
    nbr[fill[a]] = b; w[fill[a]++] = weights[e]; nbr[fill[b]] = a; w[fill[b]++] = weights[e];
  }
  return { off, nbr, w };
}

// ---------------------------------------------------------------------------------------------------------------
// centreline: geodesic level-set skeleton
// ---------------------------------------------------------------------------------------------------------------
// Geodesic distance (Dijkstra over mesh edges plus bridges) from the vertex nearest opts.root; iso-contours of that
// distance every `step` cm are rings around the tube. Ring centroids are skeleton nodes (ring length / 2 pi = radius);
// rings at neighbouring levels joined by the band between them are linked, so branches appear where one ring splits
// into two. Main path = root -> node nearest opts.tip (or the farthest node). Returns
//   { pts, r, s, len, root, tip, branches: [{ pts, r, len, at, depth }], stats }
// pts/r/s are resampled every opts.sample cm (default = step); s = arc length from the root.
export function centreline(part, opts = {}) {
  const { P, I } = toPI(part);
  const h = opts.step ?? 0.1;
  const { V, T, nV } = weld(P, I, opts.weldTol ?? 1e-3);
  const { comp, count: nComp } = components(nV, T);
  const E = uniqueEdges(nV, T);
  const bridges = bridgeComponents(V, nV, comp, nComp, opts.bridgeTol ?? 0.2);
  const pairs = E.slice(), wts = [];
  for (let k = 0; k < E.length; k += 2) wts.push(Math.hypot(V[3 * E[k]] - V[3 * E[k + 1]], V[3 * E[k] + 1] - V[3 * E[k + 1] + 1], V[3 * E[k] + 2] - V[3 * E[k + 1] + 2]));
  for (const b of bridges) { pairs.push(b.i, b.j); wts.push(b.d); }
  const G = csr(nV, pairs, wts);
  // seed: vertex nearest opts.root, else one end of the longest geodesic (double sweep)
  let seed = 0;
  if (opts.root) {
    let bd = Infinity;
    for (let v = 0; v < nV; v++) { const d = (V[3 * v] - opts.root[0]) ** 2 + (V[3 * v + 1] - opts.root[1]) ** 2 + (V[3 * v + 2] - opts.root[2]) ** 2; if (d < bd) { bd = d; seed = v; } }
  } else {
    const d0 = dijkstra(nV, G.off, G.nbr, G.w, [0]).d; let m = -1;
    for (let v = 0; v < nV; v++) if (d0[v] > m && isFinite(d0[v])) { m = d0[v]; seed = v; }
  }
  const { d } = dijkstra(nV, G.off, G.nbr, G.w, [seed], opts.maxGeo ?? Infinity);   // maxGeo: ignore the mesh farther than this (cm along the surface)
  // iso-contour crossings (level k at t = k*h) on triangle edges
  const NN = nV * nV, xKey = new Map(), X = [];       // X: { k, lo, hi, p }
  const crossing = (k, i, j, di, dj, t) => {
    const lo = di <= t ? i : j, hi = di <= t ? j : i, key = k * NN + Math.min(i, j) * nV + Math.max(i, j);
    let x = xKey.get(key);
    if (x === undefined) {
      const dl = d[lo], dh = d[hi], s = (t - dl) / (dh - dl || 1e-12);
      x = X.length; xKey.set(key, x);
      X.push({ k, lo, hi, p: [V[3 * lo] + (V[3 * hi] - V[3 * lo]) * s, V[3 * lo + 1] + (V[3 * hi + 1] - V[3 * lo + 1]) * s, V[3 * lo + 2] + (V[3 * hi + 2] - V[3 * lo + 2]) * s] });
    }
    return x;
  };
  const segs = [], tri = [0, 0, 0], dd = [0, 0, 0];
  for (let t = 0; t < T.length; t += 3) {
    tri[0] = T[t]; tri[1] = T[t + 1]; tri[2] = T[t + 2]; dd[0] = d[tri[0]]; dd[1] = d[tri[1]]; dd[2] = d[tri[2]];
    if (dd[0] === Infinity || dd[1] === Infinity || dd[2] === Infinity) continue;
    const lo = Math.min(dd[0], dd[1], dd[2]), hi = Math.max(dd[0], dd[1], dd[2]);
    for (let k = Math.max(1, Math.ceil(lo / h)); k * h < hi; k++) {
      const tl = k * h; let e0 = -1, e1 = -1;
      for (let e = 0; e < 3; e++) {
        const f = e === 2 ? 0 : e + 1;
        if ((dd[e] > tl) !== (dd[f] > tl)) { const x = crossing(k, tri[e], tri[f], dd[e], dd[f], tl); if (e0 < 0) e0 = x; else e1 = x; }
      }
      if (e1 >= 0) segs.push(e0, e1);
    }
  }
  // rings = connected crossing chains per level
  const ufX = makeUF(X.length);
  for (let s = 0; s < segs.length; s += 2) ufX.union(segs[s], segs[s + 1]);
  const ringOf = new Int32Array(X.length).fill(-1), rings = [];
  for (let x = 0; x < X.length; x++) {
    const r = ufX.find(x);
    if (ringOf[r] < 0) { ringOf[r] = rings.length; rings.push({ k: X[x].k, L: 0, c: [0, 0, 0], n: 0, m: [0, 0, 0] }); }
    ringOf[x] = ringOf[r]; const R = rings[ringOf[x]]; R.n++; R.m = add(R.m, X[x].p);
  }
  for (let s = 0; s < segs.length; s += 2) {
    const a = X[segs[s]].p, b = X[segs[s + 1]].p, l = dist(a, b), R = rings[ringOf[segs[s]]];
    R.L += l; R.c = add(R.c, mul(add(a, b), l / 2));
  }
  for (const R of rings) R.c = R.L > 1e-9 ? mul(R.c, 1 / R.L) : mul(R.m, 1 / R.n);
  // bands between levels: vertex v lies in interval ceil(d/h)-1 (above level k, at or below level k+1)
  const iv = new Int32Array(nV);
  for (let v = 0; v < nV; v++) iv[v] = isFinite(d[v]) ? Math.max(0, Math.ceil(d[v] / h) - 1) : -2;
  const ufV = makeUF(nV);
  for (let k = 0; k < E.length; k += 2) if (iv[E[k]] === iv[E[k + 1]] && iv[E[k]] >= 0) ufV.union(E[k], E[k + 1]);
  for (const b of bridges) ufV.union(b.i, b.j);
  const nR = rings.length, ROOT = nR;               // node index of the root (seed vertex)
  const touch = new Map(), links = new Set();
  const addTouch = (band, ring) => { let a = touch.get(band); if (!a) touch.set(band, a = new Set()); a.add(ring); };
  const link = (a, b) => { if (a !== b) links.add(Math.min(a, b) * (nR + 1) + Math.max(a, b)); };
  addTouch(ufV.find(seed), ROOT);
  for (let x = 0; x < X.length; x++) {
    const { k, lo, hi } = X[x], g = ringOf[x];
    if (iv[lo] === k - 1) addTouch(ufV.find(lo), g);
    else { const y = xKey.get((k - 1) * NN + Math.min(lo, hi) * nV + Math.max(lo, hi)); if (y !== undefined) link(g, ringOf[y]); else if (k === 1) addTouch(ufV.find(lo), g); }
    if (iv[hi] === k) addTouch(ufV.find(hi), g);
    else { const y = xKey.get((k + 1) * NN + Math.min(lo, hi) * nV + Math.max(lo, hi)); if (y !== undefined) link(g, ringOf[y]); }
  }
  const lvl = g => (g === ROOT ? 0 : rings[g].k);
  for (const set of touch.values()) {
    const a = [...set];
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (lvl(a[i]) !== lvl(a[j]) || a.length === 2) link(a[i], a[j]);
  }
  // skeleton graph and shortest-path tree from the root
  const pos = g => (g === ROOT ? [V[3 * seed], V[3 * seed + 1], V[3 * seed + 2]] : rings[g].c);
  const sp = [], sw = [];
  for (const key of links) { const a = Math.floor(key / (nR + 1)), b = key % (nR + 1); sp.push(a, b); sw.push(dist(pos(a), pos(b))); }
  const S = csr(nR + 1, sp, sw);
  const { d: sd, par: spar } = dijkstra(nR + 1, S.off, S.nbr, S.w, [ROOT]);
  let end = -1;
  if (opts.tip) { let bd = Infinity; for (let g = 0; g < nR; g++) if (isFinite(sd[g])) { const q = dist(rings[g].c, opts.tip); if (q < bd) { bd = q; end = g; } } }
  else { let m = -1; for (let g = 0; g < nR; g++) if (isFinite(sd[g]) && sd[g] > m) { m = sd[g]; end = g; } }
  const chain = g => { const out = []; while (g >= 0) { out.push(g); g = spar[g]; } return out.reverse(); };
  const radius = g => (g === ROOT ? null : rings[g].L / (2 * Math.PI));
  const mainNodes = end >= 0 ? chain(end) : [ROOT];
  const main = polyFromNodes(mainNodes, pos, radius, opts.sample ?? h, opts.smooth ?? 1);
  // side branches: children of path nodes that are not on the path, followed down their deepest leaf
  const kids = Array.from({ length: nR + 1 }, () => []);
  for (let g = 0; g < nR; g++) if (spar[g] >= 0 && isFinite(sd[g])) kids[spar[g]].push(g);
  const height = new Float64Array(nR + 1), deep = new Int32Array(nR + 1).fill(-1);
  const order = [...Array(nR + 1).keys()].filter(g => isFinite(sd[g])).sort((a, b) => sd[b] - sd[a]);
  for (const g of order) for (const c of kids[g]) { const hh = height[c] + sd[c] - sd[g]; if (hh > height[g]) { height[g] = hh; deep[g] = c; } }
  const branches = [], minB = opts.minBranch ?? 0.4, maxDepth = opts.branchDepth ?? 2;
  const walk = (nodes, depth) => {
    const on = new Set(nodes);
    for (const g of nodes) for (const c of kids[g]) {
      if (on.has(c) || height[c] + sd[c] - sd[g] < minB) continue;
      const path = [g]; let x = c; while (x >= 0) { path.push(x); x = deep[x]; }
      const poly = polyFromNodes(path, pos, radius, opts.sample ?? h, opts.smooth ?? 1);
      branches.push({ ...poly, at: pos(g), depth });
      if (depth < maxDepth) walk(path.slice(1), depth + 1);
    }
  };
  walk(mainNodes, 1);
  let unreached = 0; for (let g = 0; g < nR; g++) if (!isFinite(sd[g])) unreached++;
  return {
    ...main, root: main.pts[0], tip: main.pts[main.pts.length - 1], branches,
    stats: { nV, nT: T.length / 3, comps: nComp, bridges: bridges.map(b => ({ d: +b.d.toFixed(3), gap: b.gap })), rings: nR, unreachedRings: unreached, step: h, seed: [V[3 * seed], V[3 * seed + 1], V[3 * seed + 2]], geoMax: Math.max(...Array.from(d).filter(isFinite)) },
  };
}

// node chain -> smoothed, resampled polyline with radius and arc length
function polyFromNodes(nodes, pos, radius, sample, smooth) {
  let pts = nodes.map(pos), rr = nodes.map(radius);
  for (let i = 0; i < rr.length; i++) if (rr[i] == null) rr[i] = rr[i + 1] ?? rr[i - 1] ?? 0;
  for (let it = 0; it < smooth; it++) {          // light [1 2 1] smoothing, endpoints fixed
    const q = pts.map(p => p.slice());
    for (let i = 1; i < pts.length - 1; i++) q[i] = mul(add(add(pts[i - 1], pts[i + 1]), mul(pts[i], 2)), 0.25);
    pts = q;
  }
  return resample(pts, rr, sample);
}

// uniform arc-length resampling of a polyline (values: optional per-point scalar)
export function resample(pts, values, step) {
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  const L = s[s.length - 1];
  if (pts.length < 2 || L < 1e-9) return { pts: [pts[0]], r: [values ? values[0] : 0], s: [0], len: 0 };
  const n = Math.max(1, Math.round(L / step)), out = [], rv = [], ss = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * L; while (j < pts.length - 2 && s[j + 1] < t) j++;
    const f = (t - s[j]) / (s[j + 1] - s[j] || 1);
    out.push(lerp(pts[j], pts[j + 1], f)); ss.push(t);
    rv.push(values ? values[j] + (values[j + 1] - values[j]) * f : 0);
  }
  return { pts: out, r: rv, s: ss, len: L };
}

export function tangents(pts) {
  return pts.map((p, i) => norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])));
}

// ---------------------------------------------------------------------------------------------------------------
// inside tests, closest points
// ---------------------------------------------------------------------------------------------------------------
const _ray = new THREE.Ray(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const DIRS3 = [[0.577, 0.577, 0.578], [-0.7, 0.12, 0.7], [0.1, -0.8, -0.59]].map(norm);

// inside a closed, outward-wound mesh: the first surface hit faces away from the ray. Majority of three rays,
// so one ray slipping through a small hole does not flip the answer.
export function insideMesh(bvh, p) {
  let votes = 0;
  for (let k = 0; k < 3; k++) {
    _ray.origin.set(p[0], p[1], p[2]); _ray.direction.set(DIRS3[k][0], DIRS3[k][1], DIRS3[k][2]);
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (hit && hit.face.normal.dot(_ray.direction) > 0) votes++;
    if (votes === 2 || votes + (2 - k) < 2) break;
  }
  return votes >= 2;
}
// index of the first mesh (of bvhs) containing p, or -1. boxes: bounding boxes for a cheap pre-test.
export function insideAny(bvhs, boxes, p) {
  _p.set(p[0], p[1], p[2]);
  for (let k = 0; k < bvhs.length; k++) if (boxes[k].containsPoint(_p) && insideMesh(bvhs[k], p)) return k;
  return -1;
}

// nearest surface point over several parts: { p, d, part, n (outward face normal) }
export function closestOnParts(bvhs, p, maxD = Infinity) {
  _p.set(p[0], p[1], p[2]);
  let best = null;
  for (let k = 0; k < bvhs.length; k++) {
    const hit = bvhs[k].closestPointToPoint(_p, {}, 0, best ? best.d : maxD);
    if (hit && (!best || hit.distance < best.d)) best = { p: [hit.point.x, hit.point.y, hit.point.z], d: hit.distance, part: k, face: hit.faceIndex };
  }
  if (best) best.n = faceNormal(bvhs[best.part].geometry, best.face);
  return best;
}
function faceNormal(g, f) {
  const idx = g.index.array, pa = g.attributes.position.array, a = idx[3 * f] * 3, b = idx[3 * f + 1] * 3, c = idx[3 * f + 2] * 3;
  const u = [pa[b] - pa[a], pa[b + 1] - pa[a + 1], pa[b + 2] - pa[a + 2]], v = [pa[c] - pa[a], pa[c + 1] - pa[a + 1], pa[c + 2] - pa[a + 2]];
  return norm(cross(u, v));
}

// ---------------------------------------------------------------------------------------------------------------
// brain exit
// ---------------------------------------------------------------------------------------------------------------
// pts: centreline from the root (nucleus side). brain: parts whose union is "brain" (brainstem halves, olive, ...).
// Exit = last inside->outside transition along the path, refined by bisection. If the path never enters the brain,
// the exit is the brain surface point nearest the root end and `gap` is that distance.
// Returns { p, n (outward face normal), part (index into brain), gap, i (segment index), intraLen (arc length from the
// root to the exit), inside: [bool per sample], surf (nearest surface point) | minGap, minGapAt when gap > 0 }
export function brainExit(pts, brain, opts = {}) {
  const bvhs = brain.map(bvhOf), boxes = bvhs.map(boxOfBVH);
  const ins = pts.map(p => insideAny(bvhs, boxes, p) >= 0);
  let last = -1; for (let i = 0; i < pts.length - 1; i++) if (ins[i] && !ins[i + 1]) last = i;
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  if (last >= 0) {
    let a = pts[last], b = pts[last + 1], ta = 0, tb = 1;
    for (let it = 0; it < (opts.iters ?? 12); it++) { const tm = (ta + tb) / 2; if (insideAny(bvhs, boxes, lerp(a, b, tm)) >= 0) ta = tm; else tb = tm; }
    const p = lerp(a, b, (ta + tb) / 2), c = closestOnParts(bvhs, p);
    return { p, n: c.n, part: c.part, gap: 0, i: last, intraLen: s[last] + dist(a, p), inside: ins, surf: c.p };
  }
  // no intra-axial part: nearest approach of the root end (and of the whole path, reported separately)
  const c0 = closestOnParts(bvhs, pts[0]);
  let bi = 0, bd = c0.d;
  for (let i = 1; i < pts.length; i++) { const c = closestOnParts(bvhs, pts[i], bd); if (c && c.d < bd) { bd = c.d; bi = i; } }
  return { p: c0.p, n: c0.n, part: c0.part, gap: c0.d, i: 0, intraLen: 0, inside: ins, minGap: bd, minGapAt: bi };
}

// Rings where the nerve surface pierces the brain surface (one ring per nerve component that has vertices on both
// sides): crossing points on mesh edges by bisection, then centroid. Rootlet nerves (IX, X, XI, XII) give one ring
// per rootlet. Returns [{ comp, c, n: count, spread }] sorted by count.
export function surfaceCrossings(nerve, brain, opts = {}) {
  const { P, I } = toPI(nerve);
  const { V, T, nV } = weld(P, I, opts.weldTol ?? 1e-3);
  const { comp } = components(nV, T);
  const bvhs = brain.map(bvhOf), boxes = bvhs.map(boxOfBVH);
  const big = new THREE.Box3(); for (const b of boxes) big.union(b);
  const st = new Int8Array(nV); // 0 = outside box (outside), 1 = inside brain, -1 = outside brain
  for (let v = 0; v < nV; v++) {
    _q.set(V[3 * v], V[3 * v + 1], V[3 * v + 2]);
    st[v] = big.containsPoint(_q) && insideAny(bvhs, boxes, [_q.x, _q.y, _q.z]) >= 0 ? 1 : -1;
  }
  const E = uniqueEdges(nV, T), byComp = new Map();
  for (let k = 0; k < E.length; k += 2) {
    const a = E[k], b = E[k + 1]; if (st[a] === st[b]) continue;
    const pin = st[a] === 1 ? [V[3 * a], V[3 * a + 1], V[3 * a + 2]] : [V[3 * b], V[3 * b + 1], V[3 * b + 2]];
    const pout = st[a] === 1 ? [V[3 * b], V[3 * b + 1], V[3 * b + 2]] : [V[3 * a], V[3 * a + 1], V[3 * a + 2]];
    let ta = 0, tb = 1;
    for (let it = 0; it < 8; it++) { const tm = (ta + tb) / 2; if (insideAny(bvhs, boxes, lerp(pin, pout, tm)) >= 0) ta = tm; else tb = tm; }
    const x = lerp(pin, pout, (ta + tb) / 2), c = comp[a];
    let r = byComp.get(c); if (!r) byComp.set(c, r = []); r.push(x);
  }
  const out = [];
  for (const [c, xs] of byComp) {
    // a component may pierce the surface more than once (in and out again): split by proximity
    for (const cl of clusterPoints(xs, opts.link ?? 0.25)) {
      const m = mul(cl.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / cl.length);
      out.push({ comp: c, c: m, n: cl.length, spread: Math.max(...cl.map(q => dist(q, m))) });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

// single-linkage clusters of points (small sets)
export function clusterPoints(xs, link) {
  const uf = makeUF(xs.length);
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (dist(xs[i], xs[j]) < link) uf.union(i, j);
  const m = new Map(); xs.forEach((x, i) => { const r = uf.find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(x); });
  return [...m.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// skull passage
// ---------------------------------------------------------------------------------------------------------------
// For each centreline sample cast nDirs rays perpendicular to the local tangent; a ray counts when it hits any bone
// within R. frac = share of hit rays (1 = completely surrounded), dist = mean hit distance, bones = hits per bone,
// inBone = index of a bone whose solid contains the sample (-1 if none; >=0 means the canal is not hollow in the
// model or the nerve runs through bone). opts.from/opts.to limit the samples (indices), opts.every evaluates only every
// k-th sample (others null; foramenRuns bridges the holes). Runtime setting used in the bench: R 1.5, nDirs 12, every 2,
// from = exit index, to = exit + 90 samples (9 cm).
export function enclosureProfile(pts, bones, opts = {}) {
  const nDirs = opts.nDirs ?? 16, R = opts.R ?? 1.0;
  const bvhs = bones.map(bvhOf), boxes = bvhs.map(boxOfBVH), tg = tangents(pts);
  const from = opts.from ?? 0, to = opts.to ?? pts.length - 1, every = opts.every ?? 1, out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i < from || i > to || (i - from) % every) { out.push(null); continue; }
    const p = pts[i], t = tg[i];
    const a = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(t, a)), w = cross(t, u);
    _p.set(p[0], p[1], p[2]);
    const cand = []; for (let k = 0; k < bvhs.length; k++) if (boxes[k].distanceToPoint(_p) <= R) cand.push(k);
    let hits = 0, sum = 0; const per = {};
    for (let j = 0; j < nDirs; j++) {
      const th = (2 * Math.PI * j) / nDirs, dir = add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
      _ray.origin.set(p[0], p[1], p[2]); _ray.direction.set(dir[0], dir[1], dir[2]);
      let best = R, bk = -1;
      for (const k of cand) { const hit = bvhs[k].raycastFirst(_ray, THREE.DoubleSide, 0, best); if (hit && hit.distance <= best) { best = hit.distance; bk = k; } }
      if (bk >= 0) { hits++; sum += best; per[bk] = (per[bk] || 0) + 1; }
    }
    let inBone = -1;
    for (const k of cand) if (boxes[k].containsPoint(_p) && insideMesh(bvhs[k], p)) { inBone = k; break; }
    out.push({ frac: hits / nDirs, dist: hits ? sum / hits : null, bones: per, inBone });
  }
  return out;
}

// Enclosed stretches of a profile: runs with frac >= thr (gaps shorter than `gap` cm merged, runs shorter than
// minLen dropped). Each run: { i0, i1, s0, s1, len, entry, exit, mid, maxFrac, meanDist, bones: [[boneIndex, hits]...],
// inBone: share of samples inside a bone solid }
export function foramenRuns(pts, prof, opts = {}) {
  const thr = opts.thr ?? 0.75, gap = opts.gap ?? 0.25, minLen = opts.minLen ?? 0.1;
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  const runs = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const ok = prof[i] && (prof[i].frac >= thr || (opts.inBone !== false && prof[i].inBone >= 0));
    if (ok) { if (cur && s[i] - s[cur.i1] <= gap) cur.i1 = i; else { cur = { i0: i, i1: i }; runs.push(cur); } }
  }
  const out = [];
  for (const r of runs) {
    const L = s[r.i1] - s[r.i0]; if (L < minLen) continue;
    const per = {}; let mf = 0, md = 0, nd = 0, nb = 0, n = 0;
    for (let i = r.i0; i <= r.i1; i++) {
      const q = prof[i]; if (!q) continue; n++;
      mf = Math.max(mf, q.frac); if (q.dist != null) { md += q.dist; nd++; } if (q.inBone >= 0) nb++;
      for (const k in q.bones) per[k] = (per[k] || 0) + q.bones[k];
    }
    const sm = (s[r.i0] + s[r.i1]) / 2; let j = r.i0; while (j < r.i1 && s[j + 1] < sm) j++;
    const mid = lerp(pts[j], pts[Math.min(j + 1, pts.length - 1)], (sm - s[j]) / ((s[j + 1] ?? s[j]) - s[j] || 1));
    out.push({ i0: r.i0, i1: r.i1, s0: s[r.i0], s1: s[r.i1], len: L, entry: pts[r.i0], exit: pts[r.i1], mid, maxFrac: mf,
      meanDist: nd ? md / nd : null, bones: Object.entries(per).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]), inBone: n ? nb / n : 0 });
  }
  return out;
}

// Where the centreline polyline itself crosses a bone surface (a modelled opening is crossed without hits).
// Returns [{ i, p, bone, s }] (i = segment index, s = arc length).
export function segmentBoneHits(pts, bones, opts = {}) {
  const bvhs = bones.map(bvhOf), out = []; let s = 0;
  const from = opts.from ?? 0, to = opts.to ?? pts.length - 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = dist(a, b);
    if (i >= from && i < to && L > 1e-9) {
      const dir = mul(sub(b, a), 1 / L);
      _ray.origin.set(a[0], a[1], a[2]); _ray.direction.set(dir[0], dir[1], dir[2]);
      for (let k = 0; k < bvhs.length; k++) for (const hit of bvhs[k].raycast(_ray, THREE.DoubleSide, 0, L)) out.push({ i, p: [hit.point.x, hit.point.y, hit.point.z], bone: k, s: s + hit.distance });
    }
    s += L;
  }
  return out.sort((x, y) => x.s - y.s);
}

// ---------------------------------------------------------------------------------------------------------------
// labels and framing
// ---------------------------------------------------------------------------------------------------------------
export const offsetPoint = (p, n, d) => add(p, mul(norm(n), d));

// Push anchors apart until every pair is >= minDist (3D, simple relaxation; fixed: indices that must not move).
// Returns new points; pair the label with a leader line from the original point when it moved.
export function spreadLabels(points, minDist, opts = {}) {
  const q = points.map(p => p.slice()), fixed = new Set(opts.fixed || []), it = opts.iters ?? 60;
  for (let k = 0; k < it; k++) {
    let moved = false;
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
      const dv = sub(q[j], q[i]), d = len(dv); if (d >= minDist) continue;
      const dir = d > 1e-6 ? mul(dv, 1 / d) : norm([1, (i % 3) - 1, 0.3]), push = (minDist - d) / 2;
      if (!fixed.has(i)) q[i] = sub(q[i], mul(dir, fixed.has(j) ? 2 * push : push));
      if (!fixed.has(j)) q[j] = add(q[j], mul(dir, fixed.has(i) ? 2 * push : push));
      moved = true;
    }
    if (!moved) break;
  }
  return q;
}

export function boxOfPoints(points, pad = 0) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  return { min: mn.map(v => v - pad), max: mx.map(v => v + pad) };
}
export function boxOfParts(parts, filter) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const { P } = toPI(part);
    for (let i = 0; i < P.length; i += 3) {
      if (filter && !filter(P[i], P[i + 1], P[i + 2])) continue;
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
    }
  }
  return { min: mn, max: mx };
}

// Same geometry as stage.frameBox without the panel insets: distance so the box fits a perspective camera looking
// along -dir (dir points from the target towards the camera; must not be parallel to +y, frameBox uses up=(0,1,0)).
export function frameView(box, dir, fovDeg = 35, aspect = 16 / 9, margin = 1.14) {
  const d = norm(dir), right = norm(cross([0, 1, 0], d)), up = cross(d, right);
  const c = mul(add(box.min, box.max), 0.5);
  let hw = 0, hh = 0, hd = 0;
  for (let i = 0; i < 8; i++) {
    const q = sub([i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]], c);
    hw = Math.max(hw, Math.abs(dot(q, right))); hh = Math.max(hh, Math.abs(dot(q, up))); hd = Math.max(hd, Math.abs(dot(q, d)));
  }
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const D = Math.max(Math.max((hh * margin) / tanV, (hw * margin) / (tanV * aspect)) + hd, 1.2);
  return { target: c, position: add(c, mul(d, D)), dist: D, half: [hw, hh, hd] };
}

// ---------------------------------------------------------------------------------------------------------------
// more helpers: opening search, common passage, extremes, centroids
// ---------------------------------------------------------------------------------------------------------------
// Opening search in the cross-section plane through p (perpendicular to t), on a grid of opts.step inside a disc of
// opts.radius: grid points inside a bone solid are walls, the others free. Starting from the free point nearest p, the
// connected free region is flood-filled (the hole the nerve lies in, or lies next to when the nerve mesh runs through
// bone). closed = the region does not reach the disc rim, i.e. a bony ring around it in this plane (canal/foramen);
// area / eqRadius = its size. Best point = most enclosed (perpendicular rays within R), then most clearance, close to p.
// Returns { q, frac, clearance, offset, startOffset, pInBone, closed, area, eqRadius, cells, nFull } or null.
export function openingSearch(p, t, bones, opts = {}) {
  const rad = opts.radius ?? 0.6, step = opts.step ?? 0.05, R = opts.R ?? 1.0, nDirs = opts.nDirs ?? 16, wOff = opts.offsetWeight ?? 2;
  const bvhs = bones.map(bvhOf), boxes = bvhs.map(boxOfBVH);
  const tt = norm(t), a = Math.abs(tt[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(tt, a)), w = cross(tt, u);
  _p.set(p[0], p[1], p[2]);
  const cand = []; for (let k = 0; k < bvhs.length; k++) if (boxes[k].distanceToPoint(_p) <= R + rad) cand.push(k);
  const n = Math.round(rad / step), W = 2 * n + 1, st = new Int8Array(W * W).fill(-1);
  const at = (i, j) => add(p, add(mul(u, i * step), mul(w, j * step)));
  let start = -1, sd = Infinity;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    if (i * i + j * j > n * n) continue;
    const q = at(i, j); _q.set(q[0], q[1], q[2]);
    let inside = false;
    for (const k of cand) if (boxes[k].containsPoint(_q) && insideMesh(bvhs[k], q)) { inside = true; break; }
    const c = (i + n) * W + (j + n); st[c] = inside ? 0 : 1;
    if (!inside && i * i + j * j < sd) { sd = i * i + j * j; start = c; }
  }
  if (start < 0) return null;
  const pInBone = st[n * W + n] === 0;
  const region = [start], seen = new Uint8Array(W * W); seen[start] = 1; let closed = true;
  for (let h = 0; h < region.length; h++) {
    const c = region[h], i = Math.floor(c / W) - n, j = (c % W) - n;
    if ((Math.abs(i) + 1) ** 2 + j * j > n * n || i * i + (Math.abs(j) + 1) ** 2 > n * n) closed = false;   // touches the rim
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj; if (Math.abs(ii) > n || Math.abs(jj) > n) continue;
      const cc = (ii + n) * W + (jj + n); if (seen[cc] || st[cc] !== 1) continue;
      seen[cc] = 1; region.push(cc);
    }
  }
  let best = null, nFull = 0;
  let cx = [0, 0, 0]; for (const c of region) cx = add(cx, at(Math.floor(c / W) - n, (c % W) - n));
  const centroid = mul(cx, 1 / region.length), area = region.length * step * step;
  const base = { centroid, startOffset: Math.sqrt(sd) * step, pInBone, closed, area, eqRadius: closed ? Math.sqrt(area / Math.PI) : null, cells: region.length };
  if (opts.rays === false) return { ...base, q: centroid, offset: dist(centroid, p) };
  for (const c of region) {
    const i = Math.floor(c / W) - n, j = (c % W) - n, q = at(i, j);
    let hits = 0, minD = R;
    for (let m = 0; m < nDirs; m++) {
      const th = (2 * Math.PI * m) / nDirs, dir = add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
      _ray.origin.set(q[0], q[1], q[2]); _ray.direction.set(dir[0], dir[1], dir[2]);
      let bd = R, hit = false;
      for (const k of cand) { const h = bvhs[k].raycastFirst(_ray, THREE.DoubleSide, 0, bd); if (h && h.distance <= bd) { bd = h.distance; hit = true; } }
      if (hit) { hits++; minD = Math.min(minD, bd); }
    }
    const frac = hits / nDirs; if (frac === 1) nFull++;
    const off = Math.hypot(i * step, j * step), score = frac * 10 + minD - wOff * off;
    if (!best || score > best.score) best = { q, frac, clearance: minD, offset: off, score };
  }
  delete best.score;
  return { ...base, ...best, nFull };
}

// Cross-section scan along a centreline (samples from..to, every k-th): openingSearch without rays at each sample.
// closedRuns = stretches where the section around the nerve is a closed bony ring (a modelled canal or foramen):
// { s0, s1, len, entry, exit, minEqR, maxEqR, centre (mid section centroid), meanOffset (nerve to hole centre) };
// boneRuns = stretches where the nerve centreline lies inside bone solid (no hollow canal around it).
export function canalScan(pts, bones, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? pts.length - 1, every = opts.every ?? 1, tg = tangents(pts);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  const rows = [];
  for (let i = from; i <= to; i += every) {
    const o = openingSearch(pts[i], tg[i], bones, { radius: opts.radius ?? 0.45, step: opts.step ?? 0.05, rays: false });
    rows.push({ i, s: s[i], closed: !!(o && o.closed), inBone: o ? o.pInBone : true, eqR: o ? o.eqRadius : null, c: o ? o.centroid : null, off: o ? o.offset : null });
  }
  const runsOf = key => {
    const out = []; let cur = null;
    for (const r of rows) {
      if (r[key]) { if (cur) cur.rows.push(r); else out.push(cur = { rows: [r] }); } else cur = null;
    }
    return out.map(({ rows: rr }) => {
      const m = rr[Math.floor(rr.length / 2)], eq = rr.map(r => r.eqR).filter(v => v != null);
      return { s0: rr[0].s, s1: rr[rr.length - 1].s, len: rr[rr.length - 1].s - rr[0].s, entry: pts[rr[0].i], exit: pts[rr[rr.length - 1].i], i0: rr[0].i, i1: rr[rr.length - 1].i,
        minEqR: eq.length ? Math.min(...eq) : null, maxEqR: eq.length ? Math.max(...eq) : null, centre: m.c, meanOffset: rr.reduce((a, r) => a + (r.off ?? 0), 0) / rr.length };
    });
  };
  return { rows, closedRuns: runsOf('closed'), boneRuns: runsOf('inBone') };
}

// Point where several centrelines come closest together (shared opening: SOF for III/IV/V1/VI, IAM for VII/VIII,
// jugular foramen for IX/X/XI). paths: arrays of points (cut by the caller to the relevant stretch).
// Returns { c, spread, near: nearest point of each path, cost }.
export function convergence(paths) {
  let best = null;
  for (let a = 0; a < paths.length; a++) for (const p of paths[a]) {
    let cost = 0; const near = [];
    for (let b = 0; b < paths.length; b++) {
      if (b === a) { near.push(p); continue; }
      let bd = Infinity, bp = null; for (const q of paths[b]) { const d = dist(p, q); if (d < bd) { bd = d; bp = q; } }
      cost += bd; near.push(bp);
    }
    if (!best || cost < best.cost) best = { cost, near };
  }
  const c = mul(best.near.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / best.near.length);
  return { c, spread: Math.max(...best.near.map(q => dist(q, c))), near: best.near, cost: best.cost };
}

// index of the sample with the largest projection on dir between i0 and i1 (e.g. most dorsal point: dir [0,0,-1])
export function extremeIndex(pts, dir, i0 = 0, i1 = pts.length - 1) {
  let bi = i0, bv = -Infinity;
  for (let i = i0; i <= i1; i++) { const v = dot(pts[i], dir); if (v > bv) { bv = v; bi = i; } }
  return bi;
}

// volume centroid of a closed mesh (signed tetrahedra); area-weighted surface centroid as fallback
export function centroidOf(part) {
  const { P, I } = toPI(part);
  let vol = 0, cx = 0, cy = 0, cz = 0, area = 0, ax = 0, ay = 0, az = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    const A = [P[a], P[a + 1], P[a + 2]], B = [P[b], P[b + 1], P[b + 2]], C = [P[c], P[c + 1], P[c + 2]];
    const v = dot(A, cross(B, C)) / 6; vol += v;
    cx += v * (A[0] + B[0] + C[0]) / 4; cy += v * (A[1] + B[1] + C[1]) / 4; cz += v * (A[2] + B[2] + C[2]) / 4;
    const ar = len(cross(sub(B, A), sub(C, A))) / 2; area += ar;
    ax += ar * (A[0] + B[0] + C[0]) / 3; ay += ar * (A[1] + B[1] + C[1]) / 3; az += ar * (A[2] + B[2] + C[2]) / 3;
  }
  if (Math.abs(vol) > 1e-9) { const c = [cx / vol, cy / vol, cz / vol]; return { c, vol: Math.abs(vol), area }; }
  return { c: [ax / area, ay / area, az / area], vol: 0, area };
}

// arc length position of a point along a polyline (nearest sample): { i, s, d }
export function nearestSample(pts, p) {
  let bi = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = dist(pts[i], p); if (d < bd) { bd = d; bi = i; } }
  let s = 0; for (let i = 1; i <= bi; i++) s += dist(pts[i - 1], pts[i]);
  return { i: bi, s, d: bd };
}

// Label offset away from the brainstem axis: the local centre (x, z) is the mean of the parts' vertices within
// +-band of p's height; the anchor is moved d cm radially outward in the transverse plane (anterior for VI, lateral for
// VII/VIII, posterolateral for IX/X, dorsal for IV). Falls back to `fallbackDir` (or +z) when no vertex is in the band.
export function radialOffset(p, parts, d, band = 0.15, fallbackDir = [0, 0, 1]) {
  let sx = 0, sz = 0, n = 0;
  for (const part of parts) {
    const { P } = toPI(part);
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - p[1]) < band) { sx += P[i]; sz += P[i + 2]; n++; }
  }
  const dir = n ? norm([p[0] - sx / n, 0, p[2] - sz / n]) : norm(fallbackDir);
  return add(p, mul(dir, d));
}

// Vertical label ladder for crowded exits (VII, VIII, IX, X sit within 0.1-0.7 cm of each other): points given in
// textbook order top -> bottom; the first is lifted by `lift`, every next one is kept at least `gap` below the
// previous label (never above its own anchor). Returns new points (x, z unchanged).
export function ladder(points, gap = 0.45, lift = 0.2) {
  const out = []; let prev = Infinity;
  points.forEach((p, i) => { const y = i === 0 ? p[1] + lift : Math.min(p[1], prev - gap); out.push([p[0], y, p[2]]); prev = y; });
  return out;
}
