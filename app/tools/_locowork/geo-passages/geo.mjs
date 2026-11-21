// geo-passages/geo.mjs: geometry for the "Geçitler" tab (topographic passages) of the musculoskeletal study mode.
//
// Run from app/:   node tools/_locowork/geo-passages/geo.mjs [passageKey,passageKey,...]
// Reads   ../data/work/locomotor/content-passages.json  (passages[] with bounds[], contents[], context, view_hint)
// Writes  ../data/work/locomotor/geo-passages.json      (one record per passage, see README block below)
// With passage keys as argument only those passages are computed and printed (the JSON is not written).
//
// Output per passage:
//   center   middle of the gap = mean of the points where the passing contents cross it (fallback: centre0)
//   dir      unit vector centre -> camera, |y| <= 0.75 (never along +-y): the view_hint direction when its visibility
//            is within HINT_SLACK of the best (or >= 85 % of it); otherwise the direction (Fibonacci set, at most
//            MAX_HINT_ANGLE from the hint) maximising visibility - HINT_WEIGHT * angle/90deg
//   box      min/max of boundary and content geometry within R (default 7 cm) of the centre (+ anchors and points)
//   contents per content key: p (where it crosses the gap: centre of its cross-section with the gap plane, i.e. an
//            approximate centreline point), passes, gap (distance from p to the nearest boundary part; 0 when p lies
//            inside a boundary mesh, listed in insideBound), plus diagnostics (wallDist, wallMax, part, sides, plane)
//   bounds   label anchors [{ i, p }]: closest surface point of each boundary entry to centre + 1.5 cm * role direction
//            (role_de lateral/medial/ventral/... parsed; Dach/Boden: no offset); empty boundary entries are omitted
//   visible  share of content sample points (within VIS_R of each p, equal weight per content) visible from dir
//   notes    missing parts, textbook order checks, contacts, view choice; diag: numbers behind all of this
//
// Method (details and results in data/work/locomotor/geo-passages.md):
//   wall score of a point s = max over the "wall" boundary entries of the distance from s to that entry's parts.
//   A point that lies in the gap is close to ALL walls at once, so the gap is where the wall score is small.
//   1. centre0 = vertex of the primary contents with the smallest wall score that is not buried in a wall mesh
//   2. per content: surface samples within 8 cm of centre0; the best (wallScore + 0.3 * dist(centre0), not buried)
//      gives p = mean of the samples within 0.6 cm. passes = wallScore(p) <= T and the side constraints hold.
//   2b. gap plane: axis = mean local direction of the elongated passing contents; every p is moved to the centre of
//      its cross-section with the plane through the provisional centre (rejected if that is worse or buried)
//   3. centre = mean of the passing p; anchors, order checks (on the gap plane and on 4 parallel planes -2..+2 cm,
//      majority verdict), contacts, view direction (ray casting) and box from there.
// Deterministic: no random numbers; all sampling is on fixed barycentric lattices, directions on a Fibonacci sphere.
import fs from 'node:fs';
import { loadMeta, loadParts } from '../../_brainwork/geo-nerves/load.mjs';
import { sampleSurface, closestOnGroup, groupDist, insidePart, rayFree, rayFirst, sphereDirs, hintVector, angleDeg, principalDir, r2, vec } from './lib.mjs';
const { sub, add, mul, dot, norm, dist } = vec;

const CONTENT = '../data/work/locomotor/content-passages.json';
const OUT = '../data/work/locomotor/geo-passages.json';
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const NX = [-1, 0, 0], NY = [0, -1, 0], NZ = [0, 0, -1];

// ---------------------------------------------------------------------------------------------------------------
// per-passage configuration (all optional)
//   primary  content keys that define centre0 (default: all contents)
//   walls    bound indices used for the wall score (default: all non-empty bounds); e.g. the Arcus iliopectineus
//            separates the two lacunae and is handled as a side constraint instead
//   T        max wall score (cm) for "passes" (default 2.5)
//   R        box radius around the centre (default 7)
//   c0Walls  bound indices used only to find centre0 (default: walls)
//   parts    { contentKey: [part names] }: only these parts of the content may carry its gap point p
//   transparent  bound indices whose parts do not occlude in the view search (fascia/retinaculum roofs "Dach" are
//            transparent automatically)
//   sides    [{ keys: [...] | '*', bound: i, axis, sign, what }]: (p - q) . axis must have this sign, q = point of
//            bound i nearest to p (tolerance SIDE_TOL); failing contents do not pass
//   order    [{ axis, keys: [...], what }]: projections on axis must DEcrease in the listed order (first key is
//            furthest along +axis)
//   contacts [{ a, b, what }]: report the smallest distance between two contents near the gap
// ---------------------------------------------------------------------------------------------------------------
const CONFIG = {
  skalenusluecke_hinten: {
    primary: ['a_subclavia'],
    sides: [{ keys: '*', bound: 0, axis: Z, sign: -1, what: 'behind (dorsal to) M. scalenus anterior' }],
    order: [{ axis: Y, keys: ['plexus', 'a_subclavia'], what: 'plexus cranial (above) the A. subclavia, artery on the first rib' }],
  },
  skalenusluecke_vorn: {
    sides: [{ keys: ['v_subclavia'], bound: 1, axis: Z, sign: 1, what: 'V. subclavia in front of M. scalenus anterior' }],
  },
  mediale_achselluecke: {
    T: 3.0,
    sides: [{ keys: '*', bound: 2, axis: X, sign: -1, what: 'medial to the long head of triceps' }],
  },
  laterale_achselluecke: {
    T: 3.0, primary: ['n_axillaris', 'a_circ_hum_post'],
    sides: [{ keys: '*', bound: 2, axis: X, sign: 1, what: 'lateral to the long head of triceps' }],
  },
  trizepsschlitz: {
    primary: ['n_radialis'],
    sides: [{ keys: '*', bound: 0, axis: Y, sign: -1, what: 'below the lower border of Teres major' }],
  },
  sulcus_bicipitalis_medialis: {
    R: 10, primary: ['a_brachialis', 'n_medianus'],
    order: [{ axis: Z, keys: ['a_brachialis', 'n_ulnaris'], what: 'N. ulnaris posterior to the A. brachialis (behind the septum)' }],
  },
  kubitaltunnel: {
    primary: ['n_ulnaris'],
    sides: [{ keys: ['n_ulnaris'], bound: 0, axis: Z, sign: -1, what: 'N. ulnaris dorsal to the medial epicondyle (Sulcus n. ulnaris)' }],
  },
  ellenbeuge: {
    primary: ['a_brachialis', 'bizepssehne', 'n_medianus'],
    order: [{ axis: X, keys: ['n_radialis', 'bizepssehne', 'a_brachialis', 'n_medianus'], what: 'lateral -> medial: N. radialis, biceps tendon, A. brachialis, N. medianus' }],
  },
  karpaltunnel: {
    primary: ['n_medianus', 'fds', 'fdp'], walls: [0, 1], T: 1.2,   // inside = between retinaculum (roof) and carpal floor
    order: [
      { axis: Z, keys: ['n_medianus', 'fdp'], what: 'N. medianus palmar to (more superficial than) the FDP tendons' },
      { axis: Z, keys: ['fds', 'fdp'], what: 'FDS tendons palmar to FDP tendons' },
      { axis: X, keys: ['fpl', 'fdp'], what: 'FPL most radial' },
    ],
  },
  guyon_loge: {
    primary: ['n_ulnaris'], T: 1.2, transparent: [1],   // the model's Flexor retinaculum covers the ulnar bundle palmarly (see report)
    order: [{ axis: X, keys: ['a_ulnaris', 'n_ulnaris'], what: 'A. ulnaris radial to the N. ulnaris' }],
  },
  tabatiere: {
    primary: ['a_radialis'], T: 1.5,
    order: [{ axis: norm([1, 0, -0.4]), keys: ['v_cephalica', 'a_radialis'], what: 'V. cephalica superficial, A. radialis deep on the floor (axis = view_hint)' },
      { axis: norm([1, 0, -0.4]), keys: ['r_superficialis', 'a_radialis'], what: 'R. superficialis n. radialis superficial to the artery' }],
  },
  strecksehnenfaecher: {
    primary: ['fach1', 'fach2', 'fach3', 'fach4', 'fach5', 'fach6'], T: 1.5,
    order: [{ axis: X, keys: ['fach1', 'fach2', 'fach3', 'fach4', 'fach5', 'fach6'], what: 'radial -> ulnar: compartments 1 to 6' }],
  },
  leistenkanal: {
    primary: ['funiculus'], T: 2.5, R: 8, walls: [0, 1, 2, 3], transparent: [0, 1],
    // the anterior wall (Externus aponeurosis) has to be opened to see the canal; the Transversalis fascia sheet of the
    // model also lies in front of the cord at its deep-ring end (y 86-88), so both walls are tinted, not occluding
  },
  lacuna_musculorum: {
    walls: [0, 1], primary: ['n_femoralis'],
    sides: [{ keys: '*', bound: 2, axis: X, sign: 1, what: 'lateral to the Arcus iliopectineus' }],
    order: [{ axis: X, keys: ['n_cut_fem_lat', 'n_femoralis'], what: 'N. cutaneus femoris lateralis at the lateral end (ASIS), N. femoralis medial' }],
  },
  lacuna_vasorum: {
    walls: [0, 1], primary: ['a_femoralis', 'v_femoralis'],
    sides: [{ keys: '*', bound: 2, axis: X, sign: -1, what: 'medial to the Arcus iliopectineus' }],
    order: [{ axis: X, keys: ['a_femoralis', 'v_femoralis'], what: 'A. femoralis lateral to the V. femoralis' },
      { axis: X, keys: ['r_femoralis', 'a_femoralis'], what: 'R. femoralis n. genitofemoralis lateral (anterolateral) to the artery' },
      { axis: X, keys: ['v_femoralis', 'rosenmueller'], what: 'Rosenmueller node medial to the vein (Anulus femoralis)' }],
  },
  hiatus_saphenus: {
    primary: ['v_saphena_magna'], T: 1.5,
    contacts: [{ a: 'v_saphena_magna', b: 'v_femoralis', what: 'V. saphena magna opens into the V. femoralis (Krosse)' }],
  },
  trigonum_femorale: {
    primary: ['a_femoralis'], R: 9, c0Walls: [0, 1, 2, 3, 4], walls: [3, 4], T: 2.0,   // inside = between floor and roof + side checks
    parts: { n_femoralis: ['Femoral nerve'], a_femoralis: ['Femoral artery'], v_femoralis: ['Femoral vein'] },
    sides: [{ keys: '*', bound: 1, axis: X, sign: -1, what: 'medial to the medial edge of Sartorius' },
      { keys: '*', bound: 2, axis: X, sign: 1, what: 'lateral to the medial edge of Adductor longus' },
      { keys: '*', bound: 0, axis: Y, sign: -1, what: 'below the Inguinal ligament' }],
    order: [{ axis: X, keys: ['n_femoralis', 'a_femoralis', 'v_femoralis'], what: 'lateral -> medial: N., A., V. femoralis (NAV)' }],
  },
  adduktorenkanal: {
    contacts: [{ a: 'a_femoralis', b: 'n_saphenus', what: 'N. saphenus accompanies the A. femoralis in the canal' }],
    primary: ['a_femoralis'], R: 10, transparent: [0],   // Sartorius roof is reflected in the dissection view
    order: [{ axis: Z, keys: ['a_femoralis', 'v_femoralis'], what: 'V. femoralis posterior to the A. femoralis' }],
  },
  canalis_obturatorius: {
    primary: ['n_obturatorius'], parts: { n_obturatorius: ['Obturator nerve'] },
    order: [{ axis: Y, keys: ['n_obturatorius', 'a_obturatoria'], what: 'N. obturatorius cranial to the A. obturatoria in the canal' }],
  },
  foramen_suprapiriforme: { primary: ['a_glut_sup', 'n_glut_sup'] },
  foramen_infrapiriforme: {
    primary: ['n_ischiadicus'], walls: [0, 1, 3],   // above, below, lateral (notch); the sacrotuberous ligament is only the medial limit
    order: [{ axis: X, keys: ['n_ischiadicus', 'n_cut_fem_post', 'a_pud_int', 'pudendus'], what: 'lateral -> medial: N. ischiadicus, N. cut. fem. post., Vasa pudenda int., N. pudendus' },
      { axis: X, keys: ['n_ischiadicus', 'a_glut_inf', 'a_pud_int', 'pudendus'], what: 'lateral -> medial: N. ischiadicus, Vasa glutea inf., Vasa pudenda int., N. pudendus' },
      { axis: X, keys: ['n_cut_fem_post', 'a_glut_inf'], what: 'Vasa glutea inf. medial to the N. cut. fem. post. (Prometheus order)' }],
  },
  foramen_ischiadicum_minus: {
    primary: ['m_obt_int'], T: 2.0,
    order: [{ axis: X, keys: ['a_pud_int', 'n_pudendus'], what: 'N. pudendus medial to the Vasa pudenda interna' }],
  },
  fossa_poplitea: {
    primary: ['n_tibialis', 'a_poplitea', 'v_poplitea'], T: 3.0, R: 8,
    order: [{ axis: NZ, keys: ['n_tibialis', 'v_poplitea'], what: 'N. tibialis superficial (posterior) to the V. poplitea' },
      { axis: NZ, keys: ['n_tibialis', 'a_poplitea'], what: 'N. tibialis superficial to the A. poplitea' },
      { axis: NZ, keys: ['v_poplitea', 'a_poplitea'], what: 'V. poplitea superficial to the A. poplitea (artery deepest, on the floor)' },
      { axis: X, keys: ['n_fib_comm', 'n_tibialis'], what: 'N. fibularis communis lateral along the biceps tendon' }],
  },
  malleolenkanal: {
    primary: ['tp', 'n_tibialis'],
    order: [{ axis: norm([-1, 0, 1]), keys: ['tp', 'fdl', 'n_tibialis', 'fhl'], what: 'anteromedial -> posterolateral (axis -x+z): TP, FDL, N. tibialis, FHL ("Tom, Dick And Nervous Harry")' },
      { axis: norm([-1, 0, 1]), keys: ['fdl', 'a_tib_post', 'fhl'], what: 'A. tibialis posterior between FDL and FHL' },
      { axis: norm([-1, 0, 1]), keys: ['a_tib_post', 'n_tibialis'], what: 'N. tibialis posterior(-lateral) to the A. tibialis posterior' }],
  },
};

const HINT_SLACK = 0.12;      // accept the view_hint direction when its visibility is at most this much below the best (or >= 85 % of it)
const HINT_WEIGHT = 0.35;     // otherwise: maximise visibility - HINT_WEIGHT * (angle to the hint / 90 deg)
const MAX_HINT_ANGLE = 60;     // deg; the camera stays on the view_hint side of the body (no views from inside the trunk)
const VIS_R = 1.5;             // cm; content samples within this distance of p are used for the visibility test
const THIN = /fascia|retinaculum|membrane|septum|aponeurosis/i;   // sheet-like parts: no inside test (open/sleeve meshes)
const SIDE_TOL = 0.3;         // cm; side constraints tolerate structures that touch the reference boundary
const DIRS = sphereDirs(800).filter(d => Math.abs(d[1]) <= 0.75);   // camera at most ~49 deg above/below the horizontal

// ---------------------------------------------------------------------------------------------------------------
// model access: content names are side-neutral -> left (sd 'l') or unpaired parts; male version of sex-specific parts
// ---------------------------------------------------------------------------------------------------------------
const meta = loadMeta();
const C = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const pickItems = n => meta.items.filter(i => i.n === n && (i.sd === 'l' || !i.sd) && (!i.x || i.x === 'm'));
const allNames = new Set();
for (const p of C.passages) for (const g of [...p.bounds.map(b => b.n), ...p.contents.map(c => c.n), p.context]) for (const n of g) allNames.add(n);
const ids = new Set();
for (const n of allNames) for (const it of pickItems(n)) ids.add(it.id);
const parts = await loadParts(ids, ['bone', 'muscle', 'nerve', 'vessel', 'organ', 'joint']);
// group of parts for a list of names (each part object gets .name / .id)
const group = names => names.flatMap(n => pickItems(n).map(it => { const p = parts.get(it.id); if (p) { p.name = n; p.id = it.id; } return p; }).filter(Boolean));

// role text of a bound -> direction (left limb, anatomical position); Dach/Boden/innen/außen give no direction
function roleDir(role) {
  if (!role) return null;
  const pick = t => {
    let d = [0, 0, 0];
    for (const w of t.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean)) {
      const ws = w.startsWith('ventro') ? ['ventral', w.slice(6)] : w.startsWith('dorso') ? ['dorsal', w.slice(5)] : [w];
      for (const q of ws) {
        if (/^(lateral|radial)$/.test(q)) d = add(d, X); if (/^(medial|ulnar)$/.test(q)) d = add(d, NX);
        if (/^(ventral|palmar|vorderwand)$/.test(q)) d = add(d, Z); if (/^(dorsal|hinterwand)$/.test(q)) d = add(d, NZ);
        if (/^(kranial|proximal)$/.test(q)) d = add(d, Y); if (/^(kaudal|distal)$/.test(q)) d = add(d, NY);
      }
    }
    return vec.len(d) > 0 ? norm(d) : null;
  };
  return pick(role.replace(/\(.*?\)/g, '')) || pick((role.match(/\((.*?)\)/) || [])[1] || '');
}

// centre of the cross-section of a part with the plane through planePt perpendicular to axis, taking the cluster
// nearest to 'near' (a curved structure can cut the plane twice). null when the part does not cut the plane there.
function sectionCentre(part, planePt, axis, near, reach = 2.5) {
  const S = sampleSurface(part, 0.12, a => dist(a, near) < reach + 0.5).filter(s => dist(s, near) < reach && Math.abs(dot(sub(s, planePt), axis)) < 0.2);
  if (S.length < 6) return null;
  const seed = S.reduce((a, s) => (dist(s, near) < dist(a, near) ? s : a));
  const cl = S.filter(s => dist(s, seed) < 1.2);
  return mul(cl.reduce((a, s) => add(a, s), [0, 0, 0]), 1 / cl.length);
}

// ---------------------------------------------------------------------------------------------------------------
// one passage
// ---------------------------------------------------------------------------------------------------------------
function computePassage(ps) {
  const cfg = CONFIG[ps.key] || {};
  const T = cfg.T ?? 2.5, R = cfg.R ?? 7;
  const notes = [];
  const B = ps.bounds.map(b => group(b.n));
  ps.bounds.forEach((b, i) => { if (!b.n.length) notes.push(`bound ${i} (${b.role_de}: ${b.la}) is not in the model`); });
  const wallIdx = (cfg.walls ?? B.map((_, i) => i)).filter(i => B[i].length);
  const wallScore = s => Math.max(...wallIdx.map(i => groupDist(B[i], s)));
  const Cg = ps.contents.map(c => group(c.n));

  // 1. centre0: content vertex with the smallest wall score (vertices of the primary contents, every vertex)
  const prim = new Set(cfg.primary ?? ps.contents.map(c => c.key));
  const solidWalls = wallIdx.flatMap(i => B[i]).filter(p => !THIN.test(p.name));
  // best candidate by score that does not lie inside a (solid) wall part; meshes of neighbouring structures often
  // overlap in the model, and a point buried in a wall is close to that wall's surface but not in the gap
  const bestOutside = cands => {
    cands.sort((a, b) => a.v - b.v);
    for (let i = 0; i < Math.min(cands.length, 300); i++) if (!solidWalls.some(w => insidePart(w, cands[i].s))) return cands[i];
    return cands[0];
  };
  let best = null;
  const c0Idx = (cfg.c0Walls ?? wallIdx).filter(i => B[i].length);
  const c0Score = s => Math.max(...c0Idx.map(i => groupDist(B[i], s)));
  const c0Cands = [];
  ps.contents.forEach((c, k) => {
    if (!prim.has(c.key)) return;
    const pParts = cfg.parts?.[c.key] ? Cg[k].filter(x => cfg.parts[c.key].includes(x.name)) : Cg[k];
    for (const part of pParts) for (let i = 0; i < part.P.length; i += 3) {
      const s = [part.P[i], part.P[i + 1], part.P[i + 2]];
      c0Cands.push({ v: c0Score(s), s });
    }
  });
  if (c0Cands.length) best = bestOutside(c0Cands);
  if (!best) return { error: 'no primary content in the model' };
  const c0 = best.s;

  // 2. per content: gap point p
  const contents = {};
  ps.contents.forEach((c, k) => {
    if (!Cg[k].length) { contents[c.key] = { p: null, passes: false, gap: null, note: 'not in the model' }; notes.push(`content ${c.key} (${c.la}) is not in the model`); return; }
    const cands = [];
    const pParts = cfg.parts?.[c.key] ? Cg[k].filter(x => cfg.parts[c.key].includes(x.name)) : Cg[k];
    for (const part of pParts) for (const s of sampleSurface(part, 0.25, a => dist(a, c0) < 8.5)) {
      if (dist(s, c0) > 8) continue;
      cands.push({ v: wallScore(s) + 0.3 * dist(s, c0), s, part });
    }
    const b = cands.length ? bestOutside(cands) : null;
    if (!b) {   // the structure never comes within 8 cm of the gap
      let nb = null;
      for (const part of Cg[k]) { const h = closestOnGroup([part], c0); if (!nb || h.d < nb.d) nb = { ...h, part }; }
      contents[c.key] = { p: r2(nb.p), passes: false, gap: r2(groupDist(B.flat(), nb.p)), part: nb.part.name, dCentre: r2(nb.d), note: `nearest point is ${r2(nb.d)} cm from the gap` };
      return;
    }
    const near = sampleSurface(b.part, 0.12, a => dist(a, b.s) < 1.2).filter(s => dist(s, b.s) < 0.6);
    const p = near.length ? mul(near.reduce((a, s) => add(a, s), [0, 0, 0]), 1 / near.length) : b.s;
    const walls = wallIdx.map(i => groupDist(B[i], p));
    const all = B.map(g => (g.length ? groupDist(g, p) : Infinity));
    let gi = 0; all.forEach((d, i) => { if (d < all[gi]) gi = i; });
    const inside = B.flat().filter(part => !THIN.test(part.name) && insidePart(part, p)).map(x => x.name);
    contents[c.key] = { p: r2(p), passes: Math.max(...walls) <= T, gap: inside.length ? 0 : r2(all[gi]), nearestBound: gi, part: b.part.name,
      wallDist: r2(walls), wallMax: r2(Math.max(...walls)), dCentre0: r2(dist(p, c0)) };
    if (inside.length) contents[c.key].insideBound = [...new Set(inside)];
    Object.defineProperty(contents[c.key], '_part', { value: b.part, enumerable: false });   // the part p lies on
  });

  // 2b. gap plane: passage axis = mean local direction of the elongated passing contents (nerves, vessels, tendons)
  //     at their p; each p is then moved to the centre of its cross-section with the plane through the provisional
  //     centre (so that orders such as lateral -> medial are compared at one level)
  const elong = ps.contents.filter(c => /^[navt]$/.test(c.kind) && contents[c.key].passes);
  let axis = null;
  for (const c of elong) {
    const k = ps.contents.indexOf(c), ct = contents[c.key];
    const S = sampleSurface(ct._part, 0.15, a => dist(a, ct.p) < 2).filter(s => dist(s, ct.p) < 1.5);
    const d = principalDir(S); if (!d) continue;
    axis = axis ? add(axis, dot(d, axis) < 0 ? mul(d, -1) : d) : d;
  }
  if (axis) {
    axis = norm(axis);
    const pass0 = Object.values(contents).filter(c => c.passes);
    const ctr0 = pass0.length ? mul(pass0.reduce((a, c) => add(a, c.p), [0, 0, 0]), 1 / pass0.length) : c0;
    ps.contents.forEach((c, k) => {
      const ct = contents[c.key]; if (!ct.p || ct.wallMax === undefined) return;   // absent or far-away structures keep their point
      const p = sectionCentre(ct._part, ctr0, axis, ct.p);
      if (!p) { ct.plane = false; return; }
      const walls = wallIdx.map(i => groupDist(B[i], p));
      ct.plane = true; ct.shift = r2(dist(p, ct.p));
      // accept the in-plane point only if it is not worse for the gap than the original one
      const buried = solidWalls.some(w => insidePart(w, p)) && !solidWalls.some(w => insidePart(w, ct.p));
      if (!buried && Math.max(...walls) <= Math.max(ct.wallMax + 0.5, T * 0.8)) {
        const all = B.map(g => (g.length ? groupDist(g, p) : Infinity));
        let gi = 0; all.forEach((d, i) => { if (d < all[gi]) gi = i; });
        const inside = B.flat().filter(part => !THIN.test(part.name) && insidePart(part, p)).map(x => x.name);
        Object.assign(ct, { p: r2(p), passes: Math.max(...walls) <= T, gap: inside.length ? 0 : r2(all[gi]), nearestBound: gi, wallDist: r2(walls), wallMax: r2(Math.max(...walls)) });
        if (inside.length) ct.insideBound = [...new Set(inside)]; else delete ct.insideBound;
      } else ct.plane = 'rejected';
    });
  }

  // label anchors need a centre; first pass with centre0, side constraints, then the final centre
  const anchorsAt = ctr => B.map((g, i) => {
    if (!g.length) return null;
    const rd = roleDir(ps.bounds[i].role_de);
    const q = rd ? add(ctr, mul(rd, 1.5)) : ctr;
    return closestOnGroup(g, q).p;
  });
  let anchors = anchorsAt(c0);
  for (const sd of cfg.sides ?? []) {
    if (!B[sd.bound].length) continue;
    const keys = sd.keys === '*' ? Object.keys(contents) : sd.keys;
    for (const key of keys) {
      const ct = contents[key]; if (!ct || !ct.p) continue;
      // reference = point of that boundary nearest to p (local position of a sheet/septum/muscle border);
      // a structure touching the boundary (within SIDE_TOL) counts as being on the right side
      const a = closestOnGroup(B[sd.bound], ct.p).p;
      const v = dot(sub(ct.p, a), sd.axis) * sd.sign;
      (ct.sides ??= []).push({ what: sd.what, ok: v > -SIDE_TOL, by: r2(v * sd.sign) });
      if (v <= -SIDE_TOL && ct.passes) { ct.passes = false; ct.note = (ct.note ? ct.note + '; ' : '') + `fails side check: ${sd.what} (${r2(v * sd.sign)} cm)`; }
    }
  }
  for (const [key, ct] of Object.entries(contents)) if (ct.p && !ct.passes && !ct.note) ct.note = `does not run through the gap in the model (wall distance up to ${ct.wallMax} cm > ${T})`;

  // 3. centre = mean of passing points
  const pass = Object.values(contents).filter(c => c.passes);
  const center = pass.length ? mul(pass.reduce((a, c) => add(a, c.p), [0, 0, 0]), 1 / pass.length) : c0;
  if (!pass.length) notes.push('no content passes the gap in the model; centre = best gap point of the primary contents');
  anchors = anchorsAt(center);

  const center0Plane = axis ? center : null;   // plane of the order checks (through the final centre)
  // textbook order checks
  const checks = [];
  for (const o of cfg.order ?? []) {
    const ks = o.keys.filter(k => contents[k] && contents[k].p);
    const proj = ks.map(k => dot(contents[k].p, o.axis));
    let ok = ks.length >= 2; for (let i = 1; i < proj.length; i++) if (proj[i] >= proj[i - 1]) ok = false;   // order of the gap points p
    const missing = o.keys.filter(k => !ks.includes(k));
    // robustness: the same order evaluated on parallel planes 1 and 2 cm above/below the gap plane
    let levels = null;
    if (axis && ks.length >= 2) {
      levels = [];
      for (const off of [-2, -1, 0, 1, 2]) {
        const pp = add(center0Plane, mul(axis, off));
        const pr = ks.map(k => { const q = !contents[k]._part ? null : sectionCentre(contents[k]._part, pp, axis, add(contents[k].p, mul(axis, off))); return q ? dot(q, o.axis) : null; });
        if (pr.some(v => v === null)) { levels.push({ off, ok: null }); continue; }
        let lok = true; for (let i = 1; i < pr.length; i++) if (pr[i] >= pr[i - 1]) lok = false;
        levels.push({ off, ok: lok, values: r2(pr) });
      }
    }
    // verdict: majority of the parallel planes where all structures were found (the gap-point order otherwise)
    const valid = (levels || []).filter(l => l.ok !== null);
    if (valid.length) ok = valid.filter(l => l.ok).length * 2 > valid.length;
    checks.push({ what: o.what, ok, values: Object.fromEntries(ks.map((k, i) => [k, r2(proj[i])])), ...(missing.length ? { missing } : {}), ...(levels ? { levels } : {}) });
  }

  // contacts: smallest distance between two contents (e.g. the GSV opening into the femoral vein)
  const contacts = [];
  for (const cn of cfg.contacts ?? []) {
    const ka = ps.contents.findIndex(c => c.key === cn.a), kb = ps.contents.findIndex(c => c.key === cn.b);
    if (ka < 0 || kb < 0 || !Cg[ka].length || !Cg[kb].length) continue;
    let bst = null;
    for (const part of Cg[ka]) for (const s of sampleSurface(part, 0.3, a => dist(a, center) < 10)) { const h = closestOnGroup(Cg[kb], s); if (!bst || h.d < bst.d) bst = { d: h.d, p: s }; }
    if (bst) contacts.push({ what: cn.what, d: r2(bst.d), at: r2(bst.p) });
  }

  // 4. view direction: content samples near p (within 2 cm), rays against bounds + context parts
  const contentIds = new Set(Cg.flat().map(p => p.id));
  // roofs that are fasciae/retinacula ("Dach") cover the contents by definition; the app shows them tinted, so they
  // are not counted as occluders (muscle roofs such as Sartorius or the FCU heads are)
  const roofIds = new Set(ps.bounds.flatMap((b, i) => ((/^Dach/i.test(b.role_de || '') || (cfg.transparent ?? []).includes(i)) ? B[i].filter(p => (cfg.transparent ?? []).includes(i) || /fascia|retinaculum/i.test(p.name)).map(p => p.id) : [])));
  if (roofIds.size) notes.push(`treated as transparent (tinted) for the view search: ${[...new Set(B.flat().filter(p => roofIds.has(p.id)).map(p => p.name))].join(', ')}`);
  const occ = [...new Map([...B.flat(), ...group(ps.context)].filter(p => !contentIds.has(p.id) && !roofIds.has(p.id)).map(p => [p.id, p])).values()];
  const samp = [];
  ps.contents.forEach((c, k) => {
    const ct = contents[c.key]; if (!ct.p || !Cg[k].length) return;
    let S = Cg[k].flatMap(part => sampleSurface(part, 0.2, a => dist(a, ct.p) < 2)).filter(s => dist(s, ct.p) < VIS_R);
    if (S.length > 30) { const st = S.length / 30; S = Array.from({ length: 30 }, (_, i) => S[Math.floor(i * st)]); }
    if (S.length) samp.push(S);
  });
  const visOf = d => samp.reduce((a, S) => a + S.filter(s => rayFree(occ, s, d)).length / S.length, 0) / Math.max(1, samp.length);
  const hint = hintVector(ps.view_hint || '');
  const scored = DIRS.map(d => ({ d, v: visOf(d) }));
  const vmax = Math.max(...scored.map(s => s.v));
  let dir, how;
  const hv = hint && Math.abs(hint[1]) <= 0.75 ? visOf(hint) : -1;
  if (hint && (hv >= vmax - HINT_SLACK || hv >= 0.85 * vmax)) { dir = hint; how = 'view_hint'; }
  else {
    // trade visibility against the angle to the hint: vis - HINT_WEIGHT * angle / 90 deg
    const sc = s => s.v - (hint ? (HINT_WEIGHT * angleDeg(s.d, hint)) / 90 : 0);
    const cand = hint ? scored.filter(s => angleDeg(s.d, hint) <= MAX_HINT_ANGLE) : scored;
    const bestD = cand.reduce((a, s) => (sc(s) > sc(a) ? s : a));
    dir = bestD.d; how = hint ? `compromise visibility/hint (${r2(angleDeg(dir, hint))} deg from view_hint)` : 'best direction';
  }
  const visible = visOf(dir);
  const blockers = d => { const m = {}; for (const S of samp) for (const s of S) { const o = rayFirst(occ, s, d); if (o) m[o.name] = (m[o.name] || 0) + 1; } return m; };

  // 5. box: bounds + contents geometry within R of the centre (+ the anchors and points)
  const pts = [];
  for (const part of [...B.flat(), ...Cg.flat()]) for (let i = 0; i < part.P.length; i += 3) {
    const s = [part.P[i], part.P[i + 1], part.P[i + 2]]; if (dist(s, center) <= R) pts.push(s);
  }
  for (const a of anchors) if (a) pts.push(a);
  for (const c of Object.values(contents)) if (c.p && dist(c.p, center) <= R) pts.push(c.p);
  const mn = [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))), mx = [0, 1, 2].map(k => Math.max(...pts.map(p => p[k])));

  for (const ch of checks) {
    const lv = ch.levels ? ch.levels.filter(l => l.ok !== null) : [];
    const l0 = ch.levels && ch.levels.find(l => l.off === 0 && l.ok !== null);
    const shown = l0 ? Object.fromEntries(Object.keys(ch.values).map((k, i) => [k, l0.values[i]])) : ch.values;
    notes.push(`${ch.ok ? 'OK' : 'ORDER NOT MET'}: ${ch.what} [${Object.entries(shown).map(([k, v]) => `${k} ${v}`).join(', ')}${l0 ? ' (gap plane)' : ' (gap points)'}]${ch.missing ? ' (missing ' + ch.missing.join(', ') + ')' : ''}${lv.length ? `; holds on ${lv.filter(l => l.ok).length}/${lv.length} parallel planes (-2..+2 cm)` : ''}`);
  }
  for (const ct of contacts) notes.push(`contact: ${ct.what}: ${ct.d} cm at [${ct.at}]`);
  for (const [k, c] of Object.entries(contents)) if (c.note && c.p) notes.push(`${k}: ${c.note}`);
  notes.push(`view: ${how}; visibility at view_hint ${hv < 0 ? 'n/a' : r2(hv)}, best ${r2(vmax)}`);

  return {
    center: r2(center), dir: r2(norm(dir)).map(v => +v.toFixed(3)), box: { min: r2(mn), max: r2(mx) },
    contents, bounds: anchors.map((p, i) => (p ? { i, p: r2(p) } : null)).filter(Boolean),
    visible: r2(visible), notes,
    diag: { contacts, axis: axis ? r2(axis) : null, centre0: r2(c0), centre0WallScore: r2(best.v), T, R, checks, visHint: hv < 0 ? null : r2(hv), visBest: r2(vmax), nSamples: samp.reduce((a, S) => a + S.length, 0), blockersAtDir: blockers(dir), blockersAtHint: hint ? blockers(hint) : null, occluders: occ.map(o => o.name) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const out = {};
for (const ps of C.passages) {
  if (only && !only.has(ps.key)) continue;
  const t0 = Date.now();
  out[ps.key] = computePassage(ps);
  console.error(`${ps.key}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (only) console.log(JSON.stringify(out, null, 1));
else { fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.error('wrote', OUT); }
