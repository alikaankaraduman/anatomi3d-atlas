// geo-passages/lib.mjs: small geometry helpers for the "Geçitler" (topographic passages) tab of the
// musculoskeletal study mode. Node-only use (tools); imports 'three' + 'three-mesh-bvh' through the brain-mode lib.
// Units cm; +x = body's LEFT (= lateral for the left limb), +y up, +z anterior.
import * as THREE from 'three';
import { bvhOf, vec } from '../../_brainwork/geo-nerves/lib.mjs';
export { bvhOf, vec };
const { sub, add, mul, dot, cross, len, norm, dist } = vec;

// ---------------------------------------------------------------------------------------------------------------
// deterministic surface sampling: every triangle is subdivided into a k x k barycentric lattice
// (k = ceil(longest edge / step)) and the lattice points (triangle centres for k = 1) are returned.
// Shared edges produce duplicates, which is harmless for scoring. Returns [[x,y,z], ...].
// ---------------------------------------------------------------------------------------------------------------
export function sampleSurface(part, step = 0.3, keep = null) {
  const { P, I } = part, out = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = [P[3 * I[t]], P[3 * I[t] + 1], P[3 * I[t] + 2]];
    const b = [P[3 * I[t + 1]], P[3 * I[t + 1] + 1], P[3 * I[t + 1] + 2]];
    const c = [P[3 * I[t + 2]], P[3 * I[t + 2] + 1], P[3 * I[t + 2] + 2]];
    if (keep && !keep(a) && !keep(b) && !keep(c)) continue;
    const k = Math.max(1, Math.ceil(Math.max(dist(a, b), dist(b, c), dist(c, a)) / step));
    for (let i = 0; i <= k; i++) for (let j = 0; i + j <= k; j++) {
      const u = (i + 1 / 3) / (k + 1), v = (j + 1 / 3) / (k + 1);       // shifted lattice: strictly inside
      if (u + v >= 1) continue;
      out.push([a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]), a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2])]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// distances to part groups (a group = the model parts of one boundary entry)
// ---------------------------------------------------------------------------------------------------------------
const _p = new THREE.Vector3(), _ray = new THREE.Ray();
// nearest surface point over the parts of a group: { p, d, part (index in group), n (face normal) }
export function closestOnGroup(group, p, maxD = Infinity) {
  _p.set(p[0], p[1], p[2]);
  let best = null;
  for (let k = 0; k < group.length; k++) {
    const h = bvhOf(group[k]).closestPointToPoint(_p, {}, 0, best ? best.d : maxD);
    if (h && (!best || h.distance < best.d)) best = { p: [h.point.x, h.point.y, h.point.z], d: h.distance, part: k, face: h.faceIndex };
  }
  return best;
}
export const groupDist = (group, p) => { const h = closestOnGroup(group, p); return h ? h.d : Infinity; };

// inside a closed mesh (majority of three rays: first hit seen from behind)
const DIRS3 = [[0.577, 0.577, 0.578], [-0.7, 0.12, 0.7], [0.1, -0.8, -0.59]].map(norm);
export function insidePart(part, p) {
  const bvh = bvhOf(part); let votes = 0;
  const bb = bvh.geometry.boundingBox || (bvh.geometry.computeBoundingBox(), bvh.geometry.boundingBox);
  _p.set(p[0], p[1], p[2]); if (!bb.containsPoint(_p)) return false;
  for (let k = 0; k < 3; k++) {
    _ray.origin.set(p[0], p[1], p[2]); _ray.direction.set(...DIRS3[k]);
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (hit && hit.face.normal.dot(_ray.direction) > 0) votes++;
  }
  return votes >= 2;
}

// is the ray p + t*dir (t in (eps, maxT]) free of all occluder parts?
export function rayFree(occluders, p, dir, eps = 0.05, maxT = 80) {
  _ray.origin.set(p[0] + dir[0] * eps, p[1] + dir[1] * eps, p[2] + dir[2] * eps); _ray.direction.set(dir[0], dir[1], dir[2]);
  for (const o of occluders) {
    const bvh = bvhOf(o);
    if (!o._box) { const g = bvh.geometry; if (!g.boundingBox) g.computeBoundingBox(); Object.defineProperty(o, '_box', { value: g.boundingBox, enumerable: false }); }
    if (!_ray.intersectsBox(o._box)) continue;
    const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxT);
    if (h) return false;
  }
  return true;
}

// deterministic, roughly uniform unit vectors (Fibonacci sphere)
export function sphereDirs(n) {
  const out = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y); out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// view_hint text -> unit vector (LEFT limb in anatomical position: lateral/radial = +x, medial/ulnar = -x,
// anterior/palmar = +z, posterior/dorsal = -z, superior/above = +y, inferior/below = -y).
// "slightly X" contributes 0.4, a plain word 1. Only the first clause group describing the camera side is used;
// words after "or" (an alternative view) are ignored.
// ---------------------------------------------------------------------------------------------------------------
const WORDS = [
  [/^(anterior|ventral|palmar|front)$/, [0, 0, 1]], [/^(posterior|dorsal|behind|back)$/, [0, 0, -1]],
  [/^(lateral|radial)$/, [1, 0, 0]], [/^(medial|ulnar)$/, [-1, 0, 0]],
  [/^(above|superior|cranial)$/, [0, 1, 0]], [/^(below|inferior|caudal)$/, [0, -1, 0]],
];
export function hintVector(hint) {
  let text = hint.toLowerCase().split(/\bor\b/)[0];
  text = text.replace(/left side of the neck/g, 'lateral');
  const acc = new Map();                                 // axis-sign -> weight (max, so "radial (lateral)" counts once)
  for (const clause of text.split(/[,;]/)) {             // "slightly" applies to the following words of its clause
    let w = 1;
    for (let t of clause.split(/[^a-z]+/).filter(Boolean)) {
      if (t === 'slightly') { w = 0.4; continue; }
      const parts = /^(antero|postero)./.test(t) ? [t.startsWith('antero') ? 'anterior' : 'posterior', t.replace(/^(antero|postero)/, '')] : [t];
      for (const q of parts) for (const [re, v] of WORDS) if (re.test(q)) { const key = v.join(); acc.set(key, Math.max(acc.get(key) || 0, w)); break; }
    }
  }
  let d = [0, 0, 0];
  for (const [k, w] of acc) d = add(d, mul(k.split(',').map(Number), w));
  return len(d) > 1e-6 ? norm(d) : null;
}
export const angleDeg = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;
export const r2 = v => (Array.isArray(v) ? v.map(r2) : Math.round(v * 100) / 100);

// principal direction (unit) of a point set (power iteration on the covariance), or null for < 3 points
export function principalDir(S) {
  if (S.length < 3) return null;
  const m = S.reduce((a, s) => add(a, s), [0, 0, 0]).map(v => v / S.length);
  const Cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const s of S) { const d = sub(s, m); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Cv[i][j] += d[i] * d[j]; }
  let v = norm([1, 0.7, 0.3]);
  for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map(i => dot(Cv[i], v)); if (len(w) < 1e-12) return null; v = norm(w); }
  return v;
}

// first occluder hit by the ray p + t*dir (t in (eps, maxT]) -> part object or null
export function rayFirst(occluders, p, dir, eps = 0.05, maxT = 80) {
  _ray.origin.set(p[0] + dir[0] * eps, p[1] + dir[1] * eps, p[2] + dir[2] * eps); _ray.direction.set(dir[0], dir[1], dir[2]);
  let best = null, bd = maxT;
  for (const o of occluders) {
    const bvh = bvhOf(o);
    if (!o._box) { const g = bvh.geometry; if (!g.boundingBox) g.computeBoundingBox(); Object.defineProperty(o, '_box', { value: g.boundingBox, enumerable: false }); }
    if (!_ray.intersectsBox(o._box)) continue;
    const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, bd);
    if (h && h.distance <= bd) { bd = h.distance; best = o; }
  }
  return best;
}
