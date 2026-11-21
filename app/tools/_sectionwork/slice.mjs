// slice.mjs: cuts the whole model with an axis-aligned plane, like the app's cut tool (src/section.js), and lists every
// part the plane cuts with its cut-surface area, a label point, whether the app fills the cut, and its "island".
// Node-only (tools). Units cm; +x = body's LEFT, +y = cranial, +z = anterior. Axis x = sagittal, y = axial, z = coronal.
// In-plane coordinates (c2, bb2) are the two remaining world coordinates in the order x, y, z:
//   axis x -> [y, z]   axis y -> [x, z]   axis z -> [x, y]
//
// Module:   import { slice, load, fills, fillRule, insideCut } from './slice.mjs';  const r = await slice('y', 120.5);
//           (opts.sex defaults to 'm': parts that exist only on the female body are left out; 'all' keeps both)
// CLI:      node tools/_sectionwork/slice.mjs <x|y|z> <pos> [--island=trunk] [--min=0.02] [--sex=m|f|all] [--attach]
//                                                           [--split|--nosplit] [--json=<file>]
// Geometry is decoded from the GLBs once and cached in tools/_sectionwork/cache/ (rebuilt when a GLB, meta.json or
// holes.json changes). Details and field meanings: data/work/sections/SLICER.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(HERE, '../..');
const CACHE = path.join(HERE, 'cache');
const SYSTEMS = ['bone', 'muscle', 'nerve', 'vessel', 'organ', 'joint'];
const AX = { x: 0, y: 1, z: 2 };
const INPLANE = [[1, 2], [0, 2], [0, 1]];
export const TOUCH = 0.4;   // cm: outlines closer than this belong to the same island

let DB = null;              // { meta, holes, items: Map id->item, parts: Map id->{P,I,bb,nv,closed,capped,approx} }

function stamp() {
  const files = [path.join(APP, 'public/data/meta.json'), path.join(APP, 'public/data/holes.json'),
    ...fs.readdirSync(path.join(APP, 'public/models')).filter(f => f.endsWith('.glb')).map(f => path.join(APP, 'public/models', f))];
  return files.map(f => { const s = fs.statSync(f); return `${path.basename(f)}:${s.size}:${Math.round(s.mtimeMs)}`; }).join('|') + '|v3';
}

// canonical vertex per position (weld seams) so that triangle-plane segments chain through shared edges
function weld(P) {
  const n = P.length / 3, map = new Uint32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[3 * i] * 1e4)},${Math.round(P[3 * i + 1] * 1e4)},${Math.round(P[3 * i + 2] * 1e4)}`;
    const j = seen.get(k); if (j === undefined) { seen.set(k, i); map[i] = i; } else map[i] = j;
  }
  return map;
}
function dedupe(I) {   // same rule as holes.mjs / section.js: a triangle repeated in the same winding counts once
  const seen = new Set(), out = [];
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    const key = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue; seen.add(key); out.push(a, b, c);
  }
  return out;
}

async function build(meta, holes) {
  const { loadParts } = await import('../_brainwork/geo-nerves/load.mjs');
  const cwd = process.cwd(); process.chdir(APP);
  let raw; try { raw = await loadParts(new Set(meta.items.map(i => i.id)), SYSTEMS); } finally { process.chdir(cwd); }
  const index = [], chunks = []; let off = 0;
  for (const it of meta.items) {
    const r = raw.get(it.id); if (!r) continue;
    const h = holes[it.id]; const nv = r.P.length / 3;
    const hOk = h && h.nv === nv && h.p.every((v, k) => Math.abs(r.P[k] - v) < 2e-3);
    let I = Array.from(r.I);
    if (hOk) { if (h.d) I = dedupe(I); I = I.concat(h.t); }
    const map = weld(r.P); const IW = new Uint32Array(I.length);
    for (let k = 0; k < I.length; k++) IW[k] = map[I[k]];
    const P = new Float32Array(r.P);
    chunks.push(Buffer.from(P.buffer), Buffer.from(IW.buffer));
    index.push({ id: it.id, nv, ni: IW.length, off, capped: hOk ? 1 : 0, holeStale: h && !hOk ? 1 : 0 });
    off += P.byteLength + IW.byteLength;
  }
  return { index, buf: Buffer.concat(chunks) };
}

// load meta, holes and all geometry (cached). Returns the DB object.
export async function load({ quiet = false } = {}) {
  if (DB) return DB;
  const t0 = Date.now();
  const meta = JSON.parse(fs.readFileSync(path.join(APP, 'public/data/meta.json'), 'utf8'));
  const holes = JSON.parse(fs.readFileSync(path.join(APP, 'public/data/holes.json'), 'utf8')).parts;
  const st = stamp(); const fj = path.join(CACHE, 'geo.json'), fb = path.join(CACHE, 'geo.bin');
  let index, buf, built = false;
  if (fs.existsSync(fj) && fs.existsSync(fb)) {
    const j = JSON.parse(fs.readFileSync(fj, 'utf8'));
    if (j.stamp === st) { index = j.index; buf = fs.readFileSync(fb); }
  }
  if (!index) {
    ({ index, buf } = await build(meta, holes)); built = true;
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(fb, buf); fs.writeFileSync(fj, JSON.stringify({ stamp: st, index }));
  }
  const items = new Map(meta.items.map(i => [i.id, i]));
  const parts = new Map();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  for (const e of index) {
    const P = new Float32Array(ab, e.off, e.nv * 3), I = new Uint32Array(ab, e.off + e.nv * 12, e.ni);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) { const v = P[k + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    const it = items.get(e.id);
    parts.set(e.id, { id: e.id, P, I, nv: e.nv, mn, mx, open: !!it.o, capped: !!e.capped, holeStale: !!e.holeStale });
  }
  DB = { meta, holes, items, parts, groups: meta.groups, loadMs: Date.now() - t0, built };
  if (!quiet && built) console.error(`[slice] geometry cache built in ${DB.loadMs} ms`);
  return DB;
}

// the fill rule the app uses for a part (section.js fillMode): 'nz' nonzero, 'eo' even-odd, 'pos' / 'neg' only
// positive / negative winding (heart chambers), '' = no filled cut surface
export function fillRule(it, db = DB) {
  if (it.sub === 'sheath') return '';
  if (!it.o) return 'nz';
  const h = db.holes[it.id], p = db.parts.get(it.id);
  if (!h || !p || !p.capped) return '';
  return !h.m ? 'eo' : h.s ? (h.s > 0 ? 'pos' : 'neg') : 'nz';
}
export const fills = (it, db = DB) => fillRule(it, db) !== '';

// ---------- 2D geometry ----------
function loopArea(L) {   // shoelace, flat [u0,v0,u1,v1,...], implicitly closed
  let a = 0; const n = L.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (L[2 * j] - L[2 * i]) * (L[2 * j + 1] + L[2 * i + 1]);
  return a / 2;
}
// winding number of an oriented loop around (u,v) (+1 counter-clockwise in (u,v)), and crossing count
function wind(L, u, v) {
  let w = 0, c = 0; const n = L.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, vi = L[2 * i + 1], vj = L[2 * j + 1];
    if ((vi > v) !== (vj > v)) {
      const x = L[2 * i] + (v - vi) / (vj - vi) * (L[2 * j] - L[2 * i]);
      if (x > u) { c++; w += vj > vi ? 1 : -1; }
    }
  }
  return [w, c];
}
const inBB = (b, u, v) => u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3];
const inLoop = (lp, u, v) => inBB(lp.bb, u, v) && (wind(lp.L, u, v)[1] & 1) === 1;
const ruleOf = rule => rule === 'eo' ? (w, c) => (c & 1) === 1 : rule === 'pos' ? w => w > 0 : rule === 'neg' ? w => w < 0 : w => w !== 0;
// is (u,v) filled under the part's rule? (cal: +1 / -1 so that an outward-wound solid has positive winding inside)
function ruleInside(loops, rule, cal, u, v) {
  let w = 0, c = 0;
  for (const lp of loops) if (inBB(lp.bb, u, v)) { const r = wind(lp.L, u, v); w += r[0]; c += r[1]; }
  return ruleOf(rule)(w * cal, c);
}
// area under the rule by scanlines (midpoint rule, line spacing <= 0.01 cm; error well below 0.5 %)
function ruleArea(loops, rule, cal) {
  let v0 = Infinity, v1 = -Infinity; for (const lp of loops) { v0 = Math.min(v0, lp.bb[1]); v1 = Math.max(v1, lp.bb[3]); }
  const H = v1 - v0; if (!(H > 0)) return 0;
  const N = Math.min(6000, Math.max(64, Math.ceil(H / 0.01))), h = H / N; const lines = Array.from({ length: N }, () => []);
  for (const lp of loops) {
    const L = lp.L, n = L.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ua = L[2 * i], va = L[2 * i + 1], ub = L[2 * j], vb = L[2 * j + 1]; if (va === vb) continue;
      const lo = Math.min(va, vb), hi = Math.max(va, vb), d = vb > va ? 1 : -1;
      for (let k = Math.max(0, Math.ceil((lo - v0) / h - 0.5)); k < N; k++) {
        const v = v0 + (k + 0.5) * h; if (v >= hi) break; if (v < lo) continue;
        lines[k].push(ua + (v - va) / (vb - va) * (ub - ua), d * cal);
      }
    }
  }
  const test = ruleOf(rule); let A = 0;
  for (const X of lines) {
    if (X.length < 4) continue;
    const idx = []; for (let i = 0; i < X.length; i += 2) idx.push(i); idx.sort((a, b) => X[a] - X[b]);
    // sweeping from the right end leftwards reproduces wind(): winding of a point = sum of the crossings right of it
    let w = 0, c = 0, len = 0;
    for (let m = idx.length - 1; m > 0; m--) { w += X[idx[m] + 1]; c++; if (test(w, c)) len += X[idx[m]] - X[idx[m - 1]]; }
    A += len * h;
  }
  return A;
}
function segDist2(u, v, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l > 0 ? ((u - ax) * dx + (v - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - u, ey = ay + t * dy - v; return ex * ex + ey * ey;
}
// distance to the nearest outline, or -1 as soon as some outline is nearer than `atLeast` (label search early-out)
function clearance(loops, u, v, atLeast) {
  const a2 = atLeast > 0 ? atLeast * atLeast : -1; let d = Infinity;
  for (const lp of loops) {
    const b = lp.bb; const gx = Math.max(b[0] - u, 0, u - b[2]), gy = Math.max(b[1] - v, 0, v - b[3]);
    if (gx * gx + gy * gy >= d) continue;
    const L = lp.L, n = L.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const q = segDist2(u, v, L[2 * j], L[2 * j + 1], L[2 * i], L[2 * i + 1]);
      if (q < d) { d = q; if (d <= a2) return -1; }
    }
  }
  return Math.sqrt(d);
}
function outlineDist(loops, u, v, best = Infinity) {
  let d = best * best;
  for (const lp of loops) {
    const b = lp.bb; const gx = Math.max(b[0] - u, 0, u - b[2]), gy = Math.max(b[1] - v, 0, v - b[3]);
    if (gx * gx + gy * gy >= d) continue;
    const L = lp.L, n = L.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) { const q = segDist2(u, v, L[2 * j], L[2 * j + 1], L[2 * i], L[2 * i + 1]); if (q < d) d = q; }
  }
  return Math.sqrt(d);
}

// ---------- cutting one part ----------
// Segments are oriented by the triangle winding (from the edge where the triangle enters the upper side to the edge
// where it leaves), so the loops of a consistently wound mesh come out oriented and the app's nonzero / signed rules
// can be applied. Vertices exactly on the plane count as above it (no degenerate segments).
function cutPart(part, ax, pos) {
  const { P, I, nv } = part; const [ua, va] = INPLANE[ax];
  const segA = [], segB = [], pts = new Map();
  const ept = (i, j) => {   // point where edge (i,j) crosses the plane; key = undirected edge id
    const lo = i < j ? i : j, hi = i < j ? j : i, key = lo * nv + hi;
    if (!pts.has(key)) {
      const di = P[3 * lo + ax] - pos, dj = P[3 * hi + ax] - pos, t = di / (di - dj);
      pts.set(key, [P[3 * lo + ua] + t * (P[3 * hi + ua] - P[3 * lo + ua]), P[3 * lo + va] + t * (P[3 * hi + va] - P[3 * lo + va])]);
    }
    return key;
  };
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k], b = I[k + 1], c = I[k + 2];
    if (a === b || b === c || a === c) continue;
    const na = P[3 * a + ax] < pos, nb = P[3 * b + ax] < pos, nc = P[3 * c + ax] < pos;
    if (na === nb && nb === nc) continue;
    let ein = -1, eout = -1;
    if (na !== nb) { const e = ept(a, b); if (na) ein = e; else eout = e; }
    if (nb !== nc) { const e = ept(b, c); if (nb) ein = e; else eout = e; }
    if (nc !== na) { const e = ept(c, a); if (nc) ein = e; else eout = e; }
    if (ein !== eout) { segA.push(ein); segB.push(eout); }
  }
  if (!segA.length) return null;
  const adj = new Map();
  const addAdj = (key, s) => { const l = adj.get(key); if (l) l.push(s); else adj.set(key, [s]); };
  for (let s = 0; s < segA.length; s++) { addAdj(segA[s], s); addAdj(segB[s], s); }
  const used = new Uint8Array(segA.length); const loops = []; let openChains = 0, flips = 0;
  const walk = (from, dirFwd) => {   // follow from key `from` along unused segments; returns [keys, consistent steps]
    const out = []; let key = from, f = 0;
    for (;;) {
      const l = adj.get(key); let nx = -1;
      for (const s of l) if (!used[s] && (dirFwd ? segA[s] : segB[s]) === key) { nx = s; break; }   // prefer consistent
      if (nx < 0) for (const s of l) if (!used[s]) { nx = s; break; }
      if (nx < 0) return [out, f];
      used[nx] = 1;
      if (segA[nx] === key) { if (dirFwd) f++; key = segB[nx]; } else { if (!dirFwd) f++; key = segA[nx]; }
      out.push(key);
    }
  };
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue; used[s] = 1;
    const [fwd, ff] = walk(segB[s], true);
    const closed = fwd.length > 0 && fwd[fwd.length - 1] === segA[s];
    let keys, f = ff + 1, tot = fwd.length + 1;
    if (closed) keys = [segA[s], ...fwd.slice(0, -1)];
    else {
      const [back, bf] = walk(segA[s], false); f += bf; tot += back.length;
      keys = [...back.reverse(), segA[s], segB[s], ...fwd]; openChains++;
    }
    if (keys.length < 3) continue;
    if (2 * f < tot) keys.reverse();
    if (f !== tot && f !== 0) flips++;
    const L = new Float64Array(keys.length * 2); const bb = [Infinity, Infinity, -Infinity, -Infinity];
    keys.forEach((key, i) => { const p = pts.get(key); L[2 * i] = p[0]; L[2 * i + 1] = p[1];
      if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; });
    loops.push({ L, bb, closed, A: Math.abs(loopArea(L)) });
  }
  if (!loops.length) return null;
  // exact even-odd area: nesting depth of each loop decides whether its shoelace area adds or subtracts
  let areaEO = 0;
  for (const lp of loops) {
    const u = (lp.L[0] + lp.L[2]) / 2, v = (lp.L[1] + lp.L[3]) / 2;
    let d = 0; for (const o of loops) if (o !== lp && o.A > lp.A * 0.999 && inLoop(o, u, v)) d++;
    lp.depth = d; areaEO += d % 2 ? -lp.A : lp.A;
  }
  return { loops, areaEO: Math.abs(areaEO), openChains, flips };
}

// filled intervals [u0, u1, u0, u1, ...] of the row v that lie inside the loop `big`
function rowIntervals(loops, big, rule, cal, v) {
  const X = [];
  for (const lp of loops) {
    if (v < lp.bb[1] || v > lp.bb[3]) continue;
    const L = lp.L, n = L.length / 2, isBig = lp === big ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, vi = L[2 * i + 1], vj = L[2 * j + 1];
      if ((vi > v) !== (vj > v)) X.push(L[2 * i] + (v - vi) / (vj - vi) * (L[2 * j] - L[2 * i]), (vj > vi ? 1 : -1) * cal, isBig);
    }
  }
  if (X.length < 6) return [];
  const idx = []; for (let i = 0; i < X.length; i += 3) idx.push(i); idx.sort((a, b) => X[a] - X[b]);
  const test = ruleOf(rule), out = []; let w = 0, c = 0, cb = 0;
  for (let m = idx.length - 1; m > 0; m--) {
    w += X[idx[m] + 1]; c++; cb += X[idx[m] + 2];
    if ((cb & 1) && test(w, c)) out.push(X[idx[m - 1]], X[idx[m]]);
  }
  return out;
}

// label point: inside the largest loop that holds filled area, filled under the part's rule, as far from every outline
// of the part as a coarse grid search (19 x 19, finer if nothing found, then 4 refinements) finds
function labelPoint(loops, rule, cal) {
  const sorted = [...loops].sort((a, b) => b.A - a.A);
  for (const big of sorted.slice(0, 4)) {
    const ok = (u, v) => inLoop(big, u, v) && ruleInside(loops, rule, cal, u, v);
    let best = null, bd = -1;
    const tryPt = (u, v) => { if (!ok(u, v)) return; const d = clearance(loops, u, v, bd); if (d > bd) { bd = d; best = [u, v]; } };
    const [x0, y0, x1, y1] = big.bb;
    for (const N of [19, 61, 181]) {
      const su = (x1 - x0) / N, sv = (y1 - y0) / N;
      for (let j = 0; j < N; j++) {   // row by row: filled intervals from one sorted crossing list
        const v = y0 + (j + 0.5) * sv, iv = rowIntervals(loops, big, rule, cal, v); if (!iv.length) continue;
        for (let i = 0; i < N; i++) {
          const u = x0 + (i + 0.5) * su; let inside = false; for (let k = 0; k < iv.length; k += 2) if (u > iv[k] && u < iv[k + 1]) { inside = true; break; }
          if (inside) { const d = clearance(loops, u, v, bd); if (d > bd) { bd = d; best = [u, v]; } }
        }
      }
      if (best) {
        let s = Math.max(su, sv);
        for (let r = 0; r < 4; r++) { s /= 3; const [cu, cv] = best; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) tryPt(cu + i * s, cv + j * s); }
        return { c2: best, clear: bd };
      }
    }
  }
  return { c2: [sorted[0].L[0], sorted[0].L[1]], clear: 0 };   // nothing filled found (degenerate sliver)
}

// orientation calibration: a unit cube wound outward, cut through its centre on each axis
const CAL = [0, 1, 2].map(ax => {
  const V = []; for (let i = 0; i < 8; i++) V.push(i & 1, (i >> 1) & 1, (i >> 2) & 1);
  const F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];   // outward quads
  const I = []; for (const [a, b, c, d] of F) I.push(a, b, c, a, c, d);
  const r = cutPart({ P: Float32Array.from(V), I: Uint32Array.from(I), nv: 8 }, ax, 0.5);
  return Math.sign(wind(r.loops[0].L, 0.5, 0.5)[0]);
});
export const _CAL = CAL;

// ---------- bone classification for islands ----------
function boneClassOf(it, db) {
  if (it.s !== 'bone' || it.sub === 'attach' || it.sub === 'tooth') return null;
  let g = it.g; const chain = [];
  while (g != null && g >= 0) { chain.push(db.groups[g].n); g = db.groups[g].p; }
  const has = n => chain.includes(n);
  if (has('Bones of pelvic girdle')) return 'trunk';
  if (has('Bones of lower limb')) return 'leg';
  if (has('Bones of pectoral girdle')) return 'girdle';
  if (has('Bones of upper limb')) return 'arm';
  return 'trunk';   // cranium, head, vertebral column, thoracic skeleton, larynx, sacrum, coccyx
}

// ---------- the slicer ----------
// opts: sex ('m' default | 'f' | 'all' = both bodies), attach (include muscle-attachment patches, default false),
//       split (split islands that join trunk and limb skeleton; default true on axial planes only),
//       keepEmpty (keep parts whose cut has no filled area, e.g. a heart chamber cut only through its cavity)
export async function slice(axis, pos, opts = {}) {
  const db = await load(opts);
  const ax = AX[axis]; if (ax === undefined) throw new Error(`axis must be x, y or z, not ${axis}`);
  const t0 = Date.now(); const out = [];
  for (const part of db.parts.values()) {
    if (part.mn[ax] >= pos || part.mx[ax] <= pos) continue;
    const it = db.items.get(part.id);
    if (!opts.attach && it.sub === 'attach') continue;
    const sex = opts.sex ?? 'm'; if (sex !== 'all' && it.x && it.x !== sex) continue;
    const cut = cutPart(part, ax, pos); if (!cut) continue;
    const rule = fillRule(it, db);
    const arule = rule || (part.open ? 'eo' : 'nz');   // area of a part without fill: closed -> nonzero, open -> even-odd
    const bb2 = [Infinity, Infinity, -Infinity, -Infinity];
    for (const lp of cut.loops) { bb2[0] = Math.min(bb2[0], lp.bb[0]); bb2[1] = Math.min(bb2[1], lp.bb[1]); bb2[2] = Math.max(bb2[2], lp.bb[2]); bb2[3] = Math.max(bb2[3], lp.bb[3]); }
    const area = ruleArea(cut.loops, arule, CAL[ax]);
    if (area <= 0 && !opts.keepEmpty) continue;
    const lab = labelPoint(cut.loops, arule, CAL[ax]);
    out.push({ id: it.id, n: it.n, la: it.la, de: it.de, s: it.s, sub: it.sub, sd: it.sd || '', x: it.x || '',
      fill: rule !== '', rule: arule, area: r3(area), areaEO: r3(cut.areaEO), approx: part.open || cut.openChains > 0,
      open: !!it.o, capped: part.capped, loops: cut.loops.length, openChains: cut.openChains,
      c2: lab.c2.map(r3), clear: r3(lab.clear), bb2: bb2.map(r3), island: '', islandId: -1,
      _loops: cut.loops, _bone: boneClassOf(it, db) });
  }
  const islands = makeIslands(out, ax, opts.split ?? ax === 1);
  out.sort((a, b) => b.area - a.area);
  const res = { axis, pos, inplane: INPLANE[ax].map(k => 'xyz'[k]), parts: out, islands, ms: Date.now() - t0 };
  for (const p of out) { Object.defineProperty(p, 'loopsGeo', { value: p._loops, enumerable: false }); delete p._loops; delete p._bone; }
  return res;
}
// is the in-plane point (u, v) filled in part p of a slice result (under its rule)? (uses the non-enumerable loopsGeo)
export function insideCut(p, u, v, axis) { return ruleInside(p.loopsGeo, p.rule, CAL[AX[axis]], u, v); }
const r3 = v => Math.round(v * 1000) / 1000;

// Islands: connected groups of filled cut surfaces. Two parts with a filled cut join when their outlines come within
// TOUCH cm of each other or one lies inside the other's filled area. Parts without a filled cut (fasciae, sheaths, open
// meshes without caps) do not bridge islands (a fascia sleeve would glue the arm to the chest wall); each joins the
// island of the nearest filled outline. Islands are named by the skeleton they contain at the plane.
function makeIslands(parts, ax, split) {
  const n = parts.length, par = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const adj = Array.from({ length: n }, () => new Set());
  const union = (a, b) => { adj[a].add(b); adj[b].add(a); a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const linker = parts.some(p => p.fill) ? p => p.fill : () => true;
  const cell = TOUCH, grid = new Map(), samples = [];   // outline points every <= 0.2 cm, hashed in cells of TOUCH
  const ck = (cu, cv) => cu * 100003 + cv;
  parts.forEach((p, pi) => {
    if (!linker(p)) return;
    for (const lp of p._loops) {
      const L = lp.L, m = L.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax_ = L[2 * i], ay = L[2 * i + 1], bx = L[2 * j], by = L[2 * j + 1];
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax_, by - ay) / 0.2));
        for (let s = 0; s < k; s++) {
          const u = ax_ + (bx - ax_) * s / k, v = ay + (by - ay) * s / k; samples.push(pi, u, v);
          const key = ck(Math.floor(u / cell), Math.floor(v / cell)); let g = grid.get(key); if (!g) grid.set(key, (g = new Map()));
          const l = g.get(pi); if (l) l.push(samples.length - 3); else g.set(pi, [samples.length - 3]);
        }
      }
    }
  });
  const T2 = TOUCH * TOUCH;
  const near = (A, B) => { for (const p of A) for (const q of B) { const du = samples[q + 1] - samples[p + 1], dv = samples[q + 2] - samples[p + 2]; if (du * du + dv * dv <= T2) return true; } return false; };
  for (const [key, g] of grid) {   // part pairs in this cell and its neighbour cells (each cell pair once)
    const cu = Math.round(key / 100003), cv = key - cu * 100003;
    for (const [a, b] of [[0, 0], [1, -1], [1, 0], [1, 1], [0, 1]]) {
      const h = grid.get(ck(cu + a, cv + b)); if (!h) continue;
      for (const [pa, A] of g) for (const [pb, B] of h) if (pa !== pb && !adj[pa].has(pb) && near(A, B)) union(pa, pb);
    }
  }
  for (let i = 0; i < n; i++) {   // containment: a filled cut lying inside another's filled area
    if (!linker(parts[i])) continue;
    const L = parts[i]._loops[0].L, u = L[0], v = L[1];
    for (let j = 0; j < n; j++) {
      if (i === j || !linker(parts[j]) || adj[i].has(j)) continue;
      const b = parts[j].bb2; if (u < b[0] || u > b[2] || v < b[1] || v > b[3]) continue;
      if (ruleInside(parts[j]._loops, parts[j].rule, CAL[ax], u, v)) union(i, j);
    }
  }
  // parts that do not link: the island of the nearest linking outline point (ring search, then brute force)
  for (let i = 0; i < n; i++) {
    if (linker(parts[i])) continue;
    const L = parts[i]._loops; let best = -1, bd = Infinity;
    for (const lp of L) for (let k = 0; k < lp.L.length; k += 2 * Math.max(1, Math.floor(lp.L.length / 40))) {
      const u = lp.L[k], v = lp.L[k + 1], cu = Math.floor(u / cell), cv = Math.floor(v / cell);
      for (let r = 0; r <= 8 && bd > (r - 1) * cell; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const g = grid.get(ck(cu + a, cv + b)); if (!g) continue;
        for (const l of g.values()) for (const q of l) { const d = Math.hypot(samples[q + 1] - u, samples[q + 2] - v); if (d < bd) { bd = d; best = samples[q]; } }
      }
    }
    if (best < 0 && samples.length) {
      const u = L[0].L[0], v = L[0].L[1];
      for (let q = 0; q < samples.length; q += 3) { const d = Math.hypot(samples[q + 1] - u, samples[q + 2] - v); if (d < bd) { bd = d; best = samples[q]; } }
    }
    if (best >= 0) { union(i, best); parts[i]._host = best; }
  }
  // Within a component that holds bones of more than one kind (the arm touching the chest wall), every part goes with
  // the nearest bone along the touch graph (Dijkstra, edge length = distance between the label points); the component
  // is split into one island per bone kind (field split: true, touches: the islands it was split from).
  const kindOf = p => !p._bone ? '' : p._bone === 'trunk' || p._bone === 'girdle' ? 'trunk' : `${p._bone}-${p.sd || 'l'}`;
  const lab = new Array(n).fill('');
  const comps = new Map(); for (let i = 0; i < n; i++) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
  for (const idx of comps.values()) {
    const kinds = new Set(idx.map(i => kindOf(parts[i])).filter(Boolean));
    if (kinds.size <= 1 || !split) { const k = kinds.has('trunk') ? 'trunk' : [...kinds][0] || 'other'; for (const i of idx) lab[i] = k; continue; }
    const dist = new Map(idx.map(i => [i, Infinity])), done = new Set();
    for (const i of idx) if (kindOf(parts[i])) { dist.set(i, 0); lab[i] = kindOf(parts[i]); }
    for (;;) {
      let a = -1, ad = Infinity; for (const i of idx) if (!done.has(i) && dist.get(i) < ad) { ad = dist.get(i); a = i; }
      if (a < 0) break; done.add(a);
      for (const b of adj[a]) {
        if (parts[b]._host !== undefined && parts[b]._host !== a) continue;   // non-linking parts only via their host
        const w = Math.hypot(parts[a].c2[0] - parts[b].c2[0], parts[a].c2[1] - parts[b].c2[1]) + 0.01;
        if (ad + w < dist.get(b)) { dist.set(b, ad + w); lab[b] = lab[a]; }
      }
    }
    for (const i of idx) if (!lab[i]) lab[i] = 'trunk';
  }
  // name the islands by their skeleton
  const groups = new Map();
  parts.forEach((p, i) => { const r = `${find(i)}|${lab[i]}`; if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const isl = [];
  for (const idx of groups.values()) {
    const cnt = { trunk: 0, girdle: 0, 'arm-l': 0, 'arm-r': 0, 'leg-l': 0, 'leg-r': 0 }; let area = 0;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const i of idx) {
      const p = parts[i]; if (p.fill) area += p.area;
      bb[0] = Math.min(bb[0], p.bb2[0]); bb[1] = Math.min(bb[1], p.bb2[1]); bb[2] = Math.max(bb[2], p.bb2[2]); bb[3] = Math.max(bb[3], p.bb2[3]);
      const c = p._bone; if (!c) continue;
      if (c === 'trunk' || c === 'girdle') cnt[c] += p.area; else cnt[`${c}-${p.sd || 'l'}`] += p.area;
    }
    const limbs = ['arm-l', 'arm-r', 'leg-l', 'leg-r'].filter(k => cnt[k] > 0).sort((a, b) => cnt[b] - cnt[a]);
    const name = cnt.trunk > 0 ? 'trunk' : limbs.length ? limbs[0] : cnt.girdle > 0 ? 'trunk' : 'other';
    const bones = idx.filter(i => parts[i]._bone).map(i => parts[i].n + (parts[i].sd ? ` (${parts[i].sd})` : ''));
    const comp = find(idx[0]);
    isl.push({ name, idx, comp, area: r3(area), bb2: bb.map(r3), nParts: idx.length, bones: [...new Set(bones)].slice(0, 6),
      limbsJoined: name === 'trunk' && limbs.length ? limbs : undefined });
  }
  isl.sort((a, b) => b.area - a.area);
  const islOf = new Int32Array(n); isl.forEach((I, k) => { I.id = k; for (const i of I.idx) islOf[i] = k; });
  isl.forEach((I, k) => {
    if (I.name !== 'other') return;
    let bd = Infinity, bk = -1;
    for (const i of I.idx) for (const lp of parts[i]._loops) for (let m = 0; m < lp.L.length; m += 2) {
      const u = lp.L[m], v = lp.L[m + 1], cu = Math.floor(u / cell), cv = Math.floor(v / cell);
      for (let r = 0; r <= 25 && bd > (r - 1) * cell; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const g = grid.get(ck(cu + a, cv + b)); if (!g) continue;
        for (const [pq, l] of g) { if (isl[islOf[pq]].name === 'other') continue;
          for (const q of l) { const d = Math.hypot(samples[q + 1] - u, samples[q + 2] - v); if (d < bd) { bd = d; bk = islOf[pq]; } } }
      }
    }
    if (bk >= 0) { I.near = `${isl[bk].name}#${bk}`; I.nearDist = r3(bd); } else I.near = 'none within 10 cm';
  });
  for (const I of isl) for (const i of I.idx) { parts[i].island = I.name; parts[i].islandId = I.id; if (I.near) parts[i].near = I.near; }
  for (const I of isl) { const sib = isl.filter(J => J !== I && J.comp === I.comp).map(J => J.id); if (sib.length) { I.split = true; I.touches = sib; } }
  for (const I of isl) { delete I.idx; delete I.comp; }
  for (const p of parts) delete p._host;
  return isl;
}

// ---------- CLI ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// CLI in a function, not top-level await: the dynamic import of a sibling tool would deadlock on this module
async function main() {
  const args = process.argv.slice(2); const flag = k => { const a = args.find(a => a.startsWith(`--${k}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : undefined; };
  const pos_ = args.filter(a => !a.startsWith('--'));
  if (pos_.length < 2) { console.log('usage: node tools/_sectionwork/slice.mjs <x|y|z> <pos cm> [--island=trunk] [--min=0.02] [--sex=m|f|all] [--attach] [--split|--nosplit] [--json=<file>]'); process.exit(1); }
  const axis = pos_[0], pos = +pos_[1]; const min = +(flag('min') ?? 0.02); const isl = flag('island');
  const t0 = Date.now();
  const r = await slice(axis, pos, { sex: flag('sex'), attach: !!flag('attach'), split: flag('split') ? true : flag('nosplit') ? false : undefined });
  const t1 = Date.now();
  let lvl = '';
  if (axis === 'y') { try { const { levelOf } = await import('./levels.mjs'); lvl = ` = ${await levelOf(pos)}`; } catch (e) { lvl = ''; } }
  console.log(`plane ${axis} = ${pos} cm${lvl}; in-plane coords (${r.inplane.join(', ')}); load ${DB.loadMs} ms${DB.built ? ' (cache built)' : ' (cache)'}, slice ${r.ms} ms, total ${t1 - t0} ms`);
  console.log(`islands: ${r.islands.map(I => `#${I.id} ${I.name}${I.near ? `(near ${I.near}, ${I.nearDist} cm)` : ''}${I.split ? `[split from #${I.touches}]` : ''}${I.limbsJoined ? `[joined: ${I.limbsJoined}]` : ''} ${I.nParts} parts ${I.area} cm2`).join('; ')}`);
  if (axis !== 'y' && r.islands.some(I => I.limbsJoined)) console.log('(limbs joined to the trunk are not split off on sagittal / coronal planes; --split forces it)');
  else if (axis !== 'y' && r.islands.every(I => I.name === 'trunk' || I.name === 'other')) console.log('(all islands are trunk on this plane: limb logic not applicable)');
  const rows = r.parts.filter(p => p.area >= min && (!isl || p.island === isl || `${p.island}#${p.islandId}` === isl));
  const pad = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '~' : String(s).padEnd(n));
  console.log(`${pad('name', 44)} ${pad('Latin', 40)} ${pad('sys', 6)} sd x ${'area'.padStart(8)} fill  ${pad('label (' + r.inplane.join(',') + ')', 17)} island`);
  for (const p of rows) console.log(`${pad(p.n, 44)} ${pad(p.la || '', 40)} ${pad(p.s, 6)} ${pad(p.sd || '-', 2)} ${pad(p.x || '-', 1)} ${p.area.toFixed(2).padStart(8)}${p.approx ? '~' : ' '}${p.fill ? 'yes ' : 'no  '} ${pad(`(${p.c2.map(v => v.toFixed(1)).join(', ')})`, 17)} ${p.island}#${p.islandId}`);
  console.log(`${rows.length} of ${r.parts.length} parts shown (area >= ${min} cm2${isl ? `, island ${isl}` : ''}); ~ = approximate area (open mesh)`);
  const js = flag('json'); if (js && js !== true) { fs.mkdirSync(path.dirname(path.resolve(js)), { recursive: true }); fs.writeFileSync(js, JSON.stringify(r, null, 1)); console.log(`JSON -> ${js}`); }
}
if (isMain) main().catch(e => { console.error(e); process.exit(1); });
