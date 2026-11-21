// geo-nerves/lib.mjs: small helpers for the lesion-site geometry of the "Sinirler" tab (musculoskeletal study mode).
// Node-only (tools). Parts are { P: Float32Array world xyz, I: index array, name }; a "group" is an array of parts
// (all model parts that carry one catalog name). Units cm; +x = body's LEFT (= lateral/radial for the left limb,
// -x = medial/ulnar), +y up, +z anterior (palmar in the anatomical position).
import * as THREE from 'three';
import { bvhOf, centroidOf, centreline, vec } from '../../_brainwork/geo-nerves/lib.mjs';
import { closestOnGroup, insidePart, sampleSurface } from '../geo-passages/lib.mjs';
export { bvhOf, centroidOf, centreline, vec, closestOnGroup, insidePart, sampleSurface };
const { sub, add, mul, dot, cross, len, norm, dist } = vec;

export const r2 = v => (Array.isArray(v) ? v.map(r2) : Math.round(v * 100) / 100);
export const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
export const fp = p => `(${p.map(f1).join(', ')})`;

// all vertices of a group as [x,y,z]
export function verts(group) {
  const out = [];
  for (const { P } of group) for (let i = 0; i < P.length; i += 3) out.push([P[i], P[i + 1], P[i + 2]]);
  return out;
}
export function bbox(group) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts(group)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  return { mn, mx };
}
// vertex of the group maximising score(v) among those passing keep(v)
export function extremeVertex(group, score, keep = () => true) {
  let best = null, bs = -Infinity;
  for (const v of verts(group)) if (keep(v)) { const s = score(v); if (s > bs) { bs = s; best = v; } }
  return best;
}
// area/volume centroid of a group (volume-weighted over its parts)
export function centroid(group) {
  let w = 0, c = [0, 0, 0];
  for (const part of group) { const r = centroidOf(part); const k = r.vol || r.area; c = add(c, mul(r.c, k)); w += k; }
  return mul(c, 1 / w);
}

// distance from p to the surface of a group, plus the closest point, the part and the outward face normal there
export function closest(group, p) {
  const h = closestOnGroup(group, p);
  const { P, I } = group[h.part], f = h.face;
  const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
  const A = [P[a], P[a + 1], P[a + 2]], B = [P[b], P[b + 1], P[b + 2]], C = [P[c], P[c + 1], P[c + 2]];
  return { ...h, n: norm(cross(sub(B, A), sub(C, A))) };
}
export const inside = (group, p) => group.some(part => insidePart(part, p));

// distance along the ray p + t*dir to the first surface of the group (Infinity when nothing within maxT)
const _ray = new THREE.Ray();
export function rayDist(group, p, dir, maxT = 50) {
  _ray.origin.set(p[0], p[1], p[2]); _ray.direction.set(...norm(dir));
  let best = Infinity;
  for (const part of group) { const h = bvhOf(part).raycastFirst(_ray, THREE.DoubleSide, 0, maxT); if (h && h.distance < best) best = h.distance; }
  return best;
}

// principal axis of a long bone (PCA of its vertices, 30 power iterations, deterministic start).
// Oriented proximal -> distal (towards -y). t(p) = 0 at the proximal end, 1 at the distal end (vertex projections).
export function boneAxis(group) {
  const V = verts(group), n = V.length;
  const m = mul(V.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of V) { const d = sub(v, m); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  let e = [0, -1, 0];
  for (let it = 0; it < 30; it++) e = norm([dot(C[0], e), dot(C[1], e), dot(C[2], e)]);
  if (e[1] > 0) e = mul(e, -1);
  let lo = Infinity, hi = -Infinity;
  for (const v of V) { const s = dot(sub(v, m), e); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  const a = add(m, mul(e, lo)), L = hi - lo;
  const ax = { a, b: add(m, mul(e, hi)), e, L };
  ax.t = p => dot(sub(p, a), e) / L;                       // 0 proximal end, 1 distal end
  ax.at = t => add(a, mul(e, t * L));                      // point on the axis
  ax.radial = p => sub(p, ax.at(ax.t(p)));                 // perpendicular offset of p from the axis
  return ax;
}

// centreline samples of nerve parts: main path + side branches, each { p, part, s, branch }
// root = highest vertex (all limb nerves run proximal -> distal; see report for exceptions)
const _clCache = new Map();
export function nerveLine(part) {
  if (_clCache.has(part)) return _clCache.get(part);
  const { P } = part; let top = 0;
  for (let i = 1; i < P.length / 3; i++) if (P[3 * i + 1] > P[3 * top + 1]) top = i;
  const cl = centreline(part, { root: [P[3 * top], P[3 * top + 1], P[3 * top + 2]], step: 0.2, sample: 0.1 });
  _clCache.set(part, cl);
  return cl;
}
export function nerveSamples(group, name) {
  const out = [];
  for (const part of group) {
    const cl = nerveLine(part);
    cl.pts.forEach((p, i) => out.push({ p, part: name, s: cl.s[i], branch: false }));
    for (const b of cl.branches) b.pts.forEach((p, i) => out.push({ p, part: name, s: b.s[i], branch: true }));
  }
  return out;
}

// minimum distance from a set of points to a group surface (0 when one of the points lies inside the group)
export function minDistPoints(points, group) {
  const bb = bbox(group);
  let best = Infinity, bestP = null;
  const boxD = p => Math.hypot(Math.max(bb.mn[0] - p[0], 0, p[0] - bb.mx[0]), Math.max(bb.mn[1] - p[1], 0, p[1] - bb.mx[1]), Math.max(bb.mn[2] - p[2], 0, p[2] - bb.mx[2]));
  for (const p of points) {
    if (boxD(p) >= best) continue;
    const h = closestOnGroup(group, p, best);
    if (h && h.d < best) { best = h.d; bestP = p; }
  }
  if (bestP && best < 0.5 && points.some(p => boxD(p) === 0 && inside(group, p))) return 0;
  return best;
}
