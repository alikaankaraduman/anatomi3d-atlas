// geo-nerves/geo.mjs: lesion-site points for the "Sinirler" tab (peripheral nerves of the limbs) of the
// musculoskeletal study mode (hareket sistemi modu).
//
// Run from app/:   node tools/_locowork/geo-nerves/geo.mjs [siteFilter] [--content=path] [--out=path]
//   (--content / --out override the defaults, e.g. --content=../data/work/locomotor/content-nerves.verified.json)
// Reads   ../data/work/locomotor/content-nerves.json   (nerves[] with key, n, muscle_groups, sites[] with key, landmarks)
// Writes  ../data/work/locomotor/geo-nerves.json       (with a filter argument only matching sites are printed, no write)
//
// Output
//   sites["<nerveKey>@<siteKey>"] = {
//     p        point on the nerve's centreline at the lesion site (cm, world)
//     out      unit vector radially away from the nearest long-bone axis (or from the trunk axis) at p: label direction
//     outFrom  "Humerus" | ... | "trunk": what `out` points away from
//     dist     distance from p to the nearest landmark surface (content's landmarks[]); near = that landmark
//     part     nerve part p lies on
//     ok       does p satisfy the anatomical check;  check: the check in words with the numbers
//     rule     the rule that picked p (one line)
//     female   (only for sites with sex-specific landmarks) distance from p to the male and to the female hip bone /
//              sacrum / sacrospinous ligament (the nerves themselves are not sex-specific)
//   }
//   nerves["<nerveKey>"] = { length (cm of the modelled trunk = centreline of the first model part of n[]), from, to,
//     trunk, reach { muscle: cm from all nerve parts of n[] to that muscle mesh, 0 = touching/inside }, issues [...] }
//   model_issues: global findings (meta side labels, missing names)
//
// Method
//   Every nerve part is a closed low-poly tube; its centreline (main path from the highest vertex + side branches) comes
//   from the brain-mode skeletoniser (_brainwork/geo-nerves/lib.mjs centreline: rings every 0.2 cm, samples 0.1 cm).
//   Each site has a rule in SITES below that scores the centreline samples against landmark meshes (surface distance,
//   inside tests, rays, long-bone axes from PCA, extreme vertices for bony points) and picks the best sample; then a
//   textbook check with numbers decides `ok`.
//   Parts: left side (sd 'l') where a left copy exists, otherwise the midline copy; sex-specific parts: male ('m').
//   Deterministic: no random sampling; results change only when the model or the content file changes.
import fs from 'node:fs';
import { loadMeta, loadParts } from '../../_brainwork/geo-nerves/load.mjs';
import { vec, r2, f1, fp, verts, bbox, extremeVertex, centroid, closest, inside, rayDist, boneAxis, nerveLine, nerveSamples,
  minDistPoints, sampleSurface } from './lib.mjs';
const { sub, add, mul, dot, norm, dist, len } = vec;

const argv = process.argv.slice(2), opt = k => (argv.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const CONTENT = opt('content') || '../data/work/locomotor/content-nerves.json';
const OUT = opt('out') || '../data/work/locomotor/geo-nerves.json';
const LONG_BONES = ['Humerus', 'Radius', 'Ulna', 'Femur', 'Tibia', 'Fibula'];
const SEX_PARTS = ['Hip bone', 'Sacrum', 'Sacrospinous ligament'];
const EXTRA = ['Sciatic nerve', 'Scalenus medius muscle', 'Inferior gluteal nerve', 'Femoral artery', 'Femoral vein'];   // parts used beyond the content's lists
const Y = [0, 1, 0], Z = [0, 0, 1];

// ---------------------------------------------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------------------------------------------
const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const meta = loadMeta();
const filter = argv.find(a => !a.startsWith('--')) || null;
const modelIssues = [];                                   // global model findings (meta + geometry)

const wanted = new Set([...LONG_BONES, ...EXTRA, 'Scapula']);
for (const n of content.nerves) {
  n.n.forEach(x => wanted.add(x));
  n.muscle_groups.forEach(g => g.n.forEach(x => wanted.add(x)));
  n.sites.forEach(s => s.landmarks.forEach(x => wanted.add(x)));
}
// choose items: left copy where one exists, else the midline copy; male for sex-specific parts; female kept separately
const byName = new Map();
for (const it of meta.items) if (wanted.has(it.n)) { if (!byName.has(it.n)) byName.set(it.n, []); byName.get(it.n).push(it); }
const pick = new Map(), pickF = new Map(), missing = [];
const sexOk = x => !x || x === 'm';
for (const name of wanted) {
  const its = byName.get(name) || [];
  if (!its.length) { missing.push(name); continue; }
  const left = its.filter(i => i.sd === 'l' && sexOk(i.x)), mid = its.filter(i => !i.sd && sexOk(i.x));
  pick.set(name, left.length ? left : mid);
  const fem = its.filter(i => i.x === 'f' && i.sd !== 'r');
  if (fem.length) pickF.set(name, fem.some(i => i.sd === 'l') ? fem.filter(i => i.sd === 'l') : fem);
}
// side-less copies of names that also have a left copy are ignored; check where they really lie (meta defects)
const sideless = [...byName.values()].flat().filter(it => !it.sd && byName.get(it.n).some(o => o.sd === 'l'));
const ids = new Set([...pick.values(), ...pickF.values(), sideless].flat().map(i => i.id));
const loaded = await loadParts(ids, ['bone', 'muscle', 'joint', 'nerve', 'vessel']);
const mkGroup = (its, name) => its.map(i => loaded.get(i.id)).filter(Boolean).map(p => Object.assign(p, { name }));
const GROUPS = new Map(), GROUPS_F = new Map();
for (const [name, its] of pick) GROUPS.set(name, mkGroup(its, name));
for (const [name, its] of pickF) GROUPS_F.set(name, mkGroup(its, name));
for (const it of sideless) {
  const part = loaded.get(it.id); if (!part) continue;
  const c = centroid([part]);
  modelIssues.push(`meta: item ${it.id} '${it.n}' has no side (sd) besides a left copy and lies at x = ${f1(c[0])} cm` +
    (Math.abs(c[0]) > 3 ? ` (${c[0] < 0 ? 'right' : 'left'} side: should be sd '${c[0] < 0 ? 'r' : 'l'}'); ignored here` : '; ignored here'));
}

const G = name => { const g = GROUPS.get(name); if (!g || !g.length) throw new Error(`model part '${name}' not available`); return g; };
const has = name => (GROUPS.get(name) || []).length > 0;
const d = (name, p) => closest(G(name), p).d;
const AX = new Map(); const ax = name => { if (!AX.has(name)) AX.set(name, boneAxis(G(name))); return AX.get(name); };
const S = (...names) => names.filter(has).flatMap(n => nerveSamples(G(n), n));
const argmin = (arr, f) => { let b = null, bs = Infinity; for (const x of arr) { const s = f(x); if (s < bs) { bs = s; b = x; } } return b; };
const range = (v, lo, hi) => v >= lo && v <= hi;

// trunk axis: vertical line through x = 0 and the middle (z) of the midline bones (sternum/vertebrae, sacrum/symphysis)
// within +-3 cm of the height of p
const midBones = meta.items.filter(i => i.s === 'bone' && !i.sd && sexOk(i.x));
const trunkVerts = verts([...(await loadParts(new Set(midBones.map(i => i.id)), ['bone'])).values()]).filter(v => Math.abs(v[0]) < 2);
function trunkZ(y) {
  let lo = Infinity, hi = -Infinity;
  for (const v of trunkVerts) if (Math.abs(v[1] - y) < 3) { lo = Math.min(lo, v[2]); hi = Math.max(hi, v[2]); }
  return lo < hi ? (lo + hi) / 2 : 0;
}
// lateral wall of the trunk skeleton (ribs, costal cartilages, sternum, vertebrae, hip bone, sacrum; left/midline,
// male) at height y: max x of its vertices within +-2 cm (-Infinity below the pelvis / above the neck)
const TRUNK_RE = /^(.* rib|Costal cartilage of .*|Body of sternum|Manubrium of sternum|Xiphoid process|Vertebra .*|Hip bone|Sacrum|Coccyx)$/;
const wallItems = meta.items.filter(i => i.s === 'bone' && TRUNK_RE.test(i.n) && i.sd !== 'r' && sexOk(i.x));
const wallVerts = verts([...(await loadParts(new Set(wallItems.map(i => i.id)), ['bone'])).values()]);
function trunkWallX(y) { let mx = -Infinity; for (const v of wallVerts) if (Math.abs(v[1] - y) < 2 && v[0] > mx) mx = v[0]; return mx; }
// label direction: away from the trunk axis (horizontal) when p lies within 1 cm outside the lateral trunk wall at its
// height (axilla wall, pelvis), else away from the nearest long-bone axis when p lies beside a long bone (axis
// parameter t in [-0.15, 1.15], perpendicular distance < 6 cm), else away from the trunk axis again
function outDir(p) {
  if (p[0] <= trunkWallX(p[1]) + 1) return { out: norm([p[0], 0, p[2] - trunkZ(p[1])]), from: 'trunk' };
  let best = null;
  for (const b of LONG_BONES) {
    const A = ax(b), t = A.t(p), r = A.radial(p), rl = len(r);
    if (t >= -0.15 && t <= 1.15 && rl < 6 && (!best || rl < best.rl)) best = { b, rl, r };
  }
  if (best && best.rl > 1e-6) return { out: norm(best.r), from: best.b };
  return { out: norm([p[0], 0, p[2] - trunkZ(p[1])]), from: 'trunk' };
}

// ---------------------------------------------------------------------------------------------------------------
// shared bony / ligamentous reference points (computed on first use)
// ---------------------------------------------------------------------------------------------------------------
const L = {};
const lazy = (k, f) => Object.defineProperty(L, k, { configurable: true, get() { const v = f(); Object.defineProperty(L, k, { value: v }); return v; } });
lazy('humTop', () => bbox(G('Humerus')).mx[1]);
// epicondyles: most medial / most lateral humerus vertices in the distal 15 % of the bone
lazy('epiM', () => extremeVertex(G('Humerus'), v => -v[0], v => ax('Humerus').t(v) > 0.85));
lazy('epiL', () => extremeVertex(G('Humerus'), v => v[0], v => ax('Humerus').t(v) > 0.85));
lazy('olecranon', () => extremeVertex(G('Ulna'), v => v[1]));
lazy('radiusTop', () => bbox(G('Radius')).mx[1]);
lazy('hamulus', () => extremeVertex(G('Hamate bone'), v => v[2]));            // hook of hamate = most palmar point
lazy('fibTop', () => bbox(G('Fibula')).mx[1]);
lazy('jointLineKnee', () => (bbox(G('Femur')).mn[1] + bbox(G('Tibia')).mx[1]) / 2);
lazy('malleolusMed', () => { const mn = bbox(G('Tibia')).mn[1]; return extremeVertex(G('Tibia'), v => -v[0], v => v[1] < mn + 4); });
lazy('ischialTub', () => extremeVertex(G('Hip bone'), v => -v[1], v => v[2] < 0));
lazy('greaterTroch', () => { const mx = bbox(G('Femur')).mx[1]; return extremeVertex(G('Femur'), v => v[0], v => v[1] > mx - 10); });
lazy('asis', () => extremeVertex(G('Hip bone'), v => v[2], v => v[0] > 8 && v[1] > 88));
lazy('ingAxis', () => boneAxis(G('Inguinal ligament')));     // PCA axis of the ligament (works for any elongated mesh)

// ---------------------------------------------------------------------------------------------------------------
// site rules. Each returns { s (chosen centreline sample), ok, check, rule, notes? }
// ---------------------------------------------------------------------------------------------------------------
const SITES = {
  'axillaris@achsellucke': () => {
    const walls = ['Teres minor muscle', 'Teres major muscle', 'Long head of triceps brachii', 'Humerus'];
    const s = argmin(S('Axillary nerve', 'Muscular branches of axillary nerve'), s => Math.max(...walls.map(w => d(w, s.p))));
    const W = walls.map(w => d(w, s.p)), depth = L.humTop - s.p[1], r = ax('Humerus').radial(s.p);
    return { s, rule: 'axillary nerve sample with the smallest max distance to the four walls of the lateral axillary gap (teres minor, teres major, long head of triceps, humerus)',
      ok: Math.max(...W) <= 2.5 && range(depth, 3, 9),
      check: `walls: teres minor ${f1(W[0])}, teres major ${f1(W[1])}, long head of triceps ${f1(W[2])}, humerus ${f1(W[3])} cm (all <= 2.5 required); ${f1(depth)} cm below the top of the humeral head (surgical neck: 3-9 required); offset from the humeral axis: ${f1(-r[0])} cm medial, ${f1(-r[2])} cm posterior` };
  },
  'musculocutaneus@coracobrachialis': () => {
    const bb = bbox(G('Coracobrachialis muscle'));
    const cand = S('Musculocutaneous nerve').filter(s => range(s.p[1], bb.mn[1], bb.mx[1]));
    const s = argmin(cand, s => d('Coracobrachialis muscle', s.p));
    const dc = d('Coracobrachialis muscle', s.p), inC = cand.filter(c => inside(G('Coracobrachialis muscle'), c.p)).length;
    return { s, rule: 'musculocutaneous nerve sample within the height of coracobrachialis that is closest to it',
      ok: dc <= 0.5 || inC > 0,
      check: `closest approach to coracobrachialis ${f1(dc)} cm, ${inC} centreline samples inside the muscle (textbook: the nerve pierces it, so <= 0.5 cm or inside required); short head of biceps ${f1(d('Short head of biceps brachii', s.p))} cm; the nerve part begins at y ${f1(nerveLine(G('Musculocutaneous nerve')[0]).root[1])} vs. muscle top ${f1(bb.mx[1])}` };
  },
  'radialis@axilla': () => {
    const s = argmin(S('Radial nerve'), s => d('Teres major muscle', s.p) + d('Latissimus dorsi muscle', s.p));
    const a = d('Teres major muscle', s.p), b = d('Latissimus dorsi muscle', s.p), r = ax('Humerus').radial(s.p);
    const inLD = inside(G('Latissimus dorsi muscle'), s.p), inTM = inside(G('Teres major muscle'), s.p);
    return { s, rule: 'radial nerve sample with the smallest sum of distances to teres major and latissimus dorsi (where it crosses their tendons in the axilla)',
      ok: a <= 1 && b <= 1 && r[0] < 0,
      check: `teres major ${f1(a)} cm${inTM ? ' (inside)' : ''}, latissimus dorsi ${f1(b)} cm${inLD ? ' (inside)' : ''} (<= 1 required); ${f1(-r[0])} cm medial of the humeral axis (medial required); ${f1(L.humTop - s.p[1])} cm below the top of the humeral head` };
  },
  'radialis@sulcus': () => {
    const A = ax('Humerus');
    const cand = S('Radial nerve').filter(s => range(A.t(s.p), 0.33, 0.67) && A.radial(s.p)[2] < 0);
    const s = argmin(cand, s => d('Humerus', s.p) + 0.1 * Math.abs(A.t(s.p) - 0.5) * A.L);
    const r = A.radial(s.p), ang = Math.atan2(r[0], -r[2]) * 180 / Math.PI;
    const dh = d('Humerus', s.p), dl = d('Lateral head of triceps brachii', s.p), dm = d('Medial head of triceps brachii', s.p);
    return { s, rule: 'radial nerve sample behind the middle third of the humeral axis (t 0.33-0.67) that is closest to the humerus, ties broken towards mid-shaft',
      ok: dh <= 1 && dl <= 1 && dm <= 1 && Math.abs(ang) <= 90,
      check: `humerus ${f1(dh)} cm, lateral head of triceps ${f1(dl)} cm${inside(G('Lateral head of triceps brachii'), s.p) ? ' (inside)' : ''}, medial head ${f1(dm)} cm (all <= 1 required); at ${(A.t(s.p) * 100).toFixed(0)} % of the humeral length; direction from the shaft axis ${f1(ang)} deg from posterior towards lateral (posterior/posterolateral required)` };
  },
  'radialis@supinator': () => {
    const sup = G('Supinator');
    const main = S('Deep branch of radial nerve').filter(s => !s.branch);
    const enc = main.filter(s => d('Supinator', s.p) <= 0.15 || inside(sup, s.p));
    if (!enc.length) throw new Error('deep branch never reaches the supinator');
    const entry = enc[0], exit = enc[enc.length - 1], encLen = exit.s - entry.s;
    const mid = argmin(enc, s => Math.abs(s.s - (entry.s + exit.s) / 2));
    const pin = S('Posterior interosseous nerve of forearm').filter(s => !s.branch), pinIn = pin.filter(s => inside(sup, s.p)).length;
    const below = L.radiusTop - entry.p[1];
    // the model has both a deep branch running to the wrist and a separate posterior interosseous nerve: how close?
    const gaps = pin.map(q => Math.min(...main.map(m => dist(m.p, q.p)))).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
    const notes = pin.length ? [`'Deep branch of radial nerve' runs on to the wrist (to y ${f1(main[main.length - 1].p[1])}) next to the separate part 'Posterior interosseous nerve of forearm' (median gap ${f1(med)} cm over ${f1(pin[pin.length - 1].s)} cm): two parallel models of the same nerve`] : [];
    return { s: entry, notes, rule: 'first sample (from proximal) of the deep branch of the radial nerve that lies inside or within 0.15 cm of the supinator = entry under the Frohse arcade (content geo_hint)',
      ok: encLen >= 2 && range(below, 0.5, 5),
      check: `deep branch inside/at the supinator over ${f1(encLen)} cm of its length (y ${f1(entry.p[1])} to ${f1(exit.p[1])}; textbook canal ~3-5 cm, >= 2 required); entry ${f1(below)} cm below the top of the radial head (neck level: 0.5-5 required); middle of the enclosed stretch ${fp(mid.p)}; radius ${f1(d('Radius', entry.p))} cm, ECRB ${f1(d('Extensor carpi radialis brevis', entry.p))} cm; 'Posterior interosseous nerve of forearm' part: ${pinIn} samples inside the supinator` };
  },
  'medianus@ellenbogen': () => {
    const A = ax('Humerus'), te = A.t(mul(add(L.epiM, L.epiL), 0.5)), target = te - 4 / A.L;
    const s = argmin(S('Median nerve'), s => Math.abs(A.t(s.p) - target) + (s.branch ? 1 : 0));
    const r = A.radial(s.p), cb = closest(G('Brachialis muscle'), s.p), dv = sub(s.p, cb.p);
    return { s, rule: 'median nerve sample 4 cm proximal to the epicondylar line, measured along the humeral axis (supracondylar level)',
      ok: r[2] > 0 && cb.d <= 1.0,
      check: `${f1((te - A.t(s.p)) * A.L)} cm above the epicondylar line; ${f1(r[2])} cm anterior and ${f1(-r[0])} cm medial of the humeral axis (anterior required); brachialis ${f1(cb.d)} cm (<= 1 required), the nerve lies ${dv[2] >= 0 ? 'anterior' : 'posterior'}/${dv[0] <= 0 ? 'medial' : 'lateral'} of its nearest surface point (anteromedial expected)` };
  },
  'medianus@pronator': () => {
    const s = argmin(S('Median nerve'), s => Math.max(d('Superficial head of pronator teres', s.p), d('Deep head of pronator teres', s.p)));
    const a = d('Superficial head of pronator teres', s.p), b = d('Deep head of pronator teres', s.p), ye = (L.epiM[1] + L.epiL[1]) / 2;
    return { s, rule: 'median nerve sample with the smallest max distance to the superficial and the deep head of pronator teres (passage between the heads)',
      ok: Math.max(a, b) <= 1.0 && s.p[1] < ye,
      check: `superficial head ${f1(a)} cm, deep head ${f1(b)} cm (both <= 1 required); ${f1(ye - s.p[1])} cm distal to the epicondylar line (forearm required; textbook ~2-5 cm); ulna ${f1(d('Ulna', s.p))} cm` };
  },
  'medianus@karpaltunnel': () => {
    const R = centroid(G('Flexor retinaculum of wrist'));
    const s = argmin(S('Median nerve').filter(s => !s.branch), s => dist(s.p, R));
    const roof = rayDist(G('Flexor retinaculum of wrist'), s.p, Z, 3);
    const xr = (centroid(G('Scaphoid bone'))[0] + centroid(G('Trapezium bone'))[0]) / 2, xu = (centroid(G('Pisiform bone'))[0] + centroid(G('Hamate bone'))[0]) / 2;
    return { s, rule: 'median nerve sample closest to the centroid of the flexor retinaculum',
      ok: roof < 3 && range(s.p[0], xu, xr),
      check: `${f1(dist(s.p, R))} cm from the retinaculum centre; the retinaculum lies ${roof < Infinity ? f1(roof) + ' cm palmar (superficial) to the nerve' : 'NOT palmar to the nerve'} (roof required); x = ${f1(s.p[0])} between the ulnar pillar (pisiform/hamate, x ${f1(xu)}) and the radial pillar (scaphoid/trapezium, x ${f1(xr)}) required` };
  },
  'ulnaris@sulcus': () => {
    const E = L.epiM;
    const s = argmin(S('Ulnar nerve').filter(s => !s.branch), s => dist(s.p, E));
    const de = dist(s.p, E);
    return { s, rule: 'ulnar nerve sample closest to the tip of the medial epicondyle (most medial humerus vertex in the distal 15 %)',
      ok: s.p[2] < E[2] && de <= 2 && s.p[0] < L.olecranon[0],
      check: `${f1(de)} cm from the epicondyle tip ${fp(E)} (<= 2 required); ${f1(E[2] - s.p[2])} cm posterior to it (posterior required); ${f1(L.olecranon[0] - s.p[0])} cm medial of the olecranon tip (medial required); humerus surface ${f1(d('Humerus', s.p))} cm` };
  },
  'ulnaris@guyon': () => {
    const D = nerveLine(G('Deep branch of ulnar nerve')[0]).root;
    const s = argmin(S('Ulnar nerve', 'Superficial branch of ulnar nerve').filter(s => !s.branch), s => dist(s.p, D));
    const gap = dist(s.p, D), xp = centroid(G('Pisiform bone'))[0], R = G('Flexor retinaculum of wrist');
    // Guyon's canal lies on (palmar to) the flexor retinaculum: the retinaculum must be dorsal, not palmar, of the point
    const roof = rayDist(R, s.p, Z, 3), floor = rayDist(R, s.p, [0, 0, -1], 3);
    return { s, rule: 'point of the ulnar nerve / its superficial branch closest to the proximal end of the deep branch (= division)',
      ok: gap <= 1 && s.p[0] > xp && s.p[1] > L.hamulus[1] && roof === Infinity && d('Pisiform bone', s.p) <= 1.5,
      check: `deep branch starts ${f1(gap)} cm from this point (<= 1 required); ${f1(s.p[0] - xp)} cm radial of the pisiform centre (radial required); ${f1(s.p[1] - L.hamulus[1])} cm proximal to the hook of hamate (proximal required); flexor retinaculum ${roof < Infinity ? f1(roof) + ' cm PALMAR to the point (the nerve lies under it, i.e. in the carpal-tunnel layer)' : 'not palmar to the point'}${floor < Infinity ? ', ' + f1(floor) + ' cm dorsal to it' : ''} (superficial to the retinaculum required); pisiform ${f1(d('Pisiform bone', s.p))} cm (<= 1.5)` };
  },
  'suprascapularis@incisura': () => {
    const C = centroid(G('Superior transverse scapular ligament'));
    const s = argmin(S('Suprascapular nerve'), s => dist(s.p, C));
    return { s, rule: 'suprascapular nerve sample closest to the centre of the superior transverse scapular ligament',
      ok: s.p[1] < C[1] && dist(s.p, C) <= 1.5,
      check: `${f1(dist(s.p, C))} cm from the ligament centre (<= 1.5 required), ${f1(C[1] - s.p[1])} cm below it (below required); ligament surface ${f1(d('Superior transverse scapular ligament', s.p))} cm, scapula ${f1(d('Scapula', s.p))} cm, supraspinatus ${f1(d('Supraspinatus muscle', s.p))} cm` };
  },
  'suprascapularis@spinoglenoidal': () => {
    const C = centroid(G('Inferior transverse scapular ligament'));
    const s = argmin(S('Suprascapular nerve'), s => dist(s.p, C));
    return { s, rule: 'suprascapular nerve sample closest to the centre of the inferior transverse scapular ligament',
      ok: dist(s.p, C) <= 1.5 && d('Scapula', s.p) <= 1,
      check: `${f1(dist(s.p, C))} cm from the ligament centre (<= 1.5 required), scapula ${f1(d('Scapula', s.p))} cm (<= 1 required), infraspinatus ${f1(d('Infraspinatus muscle', s.p))} cm; nerve ${f1(s.p[1] - C[1])} cm above and ${f1(s.p[2] - C[2])} cm anterior of the ligament centre` };
  },
  'thoracicus_longus@thoraxwand': () => {
    // mid-axillary line: mean of the rib vertices within 0.5 cm of each rib's lateral-most x
    const latBand = g => { const v = verts(G(g)), mx = Math.max(...v.map(a => a[0])), b = v.filter(a => a[0] > mx - 0.5); return mul(b.reduce((t, a) => add(t, a), [0, 0, 0]), 1 / b.length); };
    const r5 = latBand('Fifth rib'), r6 = latBand('Sixth rib');
    const y56 = (r5[1] + r6[1]) / 2, zMAL = (r5[2] + r6[2]) / 2;
    const cand = S('Long thoracic nerve').filter(s => d('Serratus anterior muscle', s.p) <= 0.5 && !inside(G('Serratus anterior muscle'), s.p));
    const s = argmin(cand, s => Math.abs(s.p[1] - y56));
    const cs = closest(G('Serratus anterior muscle'), s.p), inS = inside(G('Serratus anterior muscle'), s.p);
    return { s, rule: 'long thoracic nerve sample on the serratus (<= 0.5 cm) at the height of the lateral-most points of the 5th and 6th ribs (mid-axillary line)',
      ok: Math.abs(s.p[1] - y56) <= 2 && range(s.p[2] - zMAL, -4, 1.5) && !inS,
      check: `serratus anterior ${f1(cs.d)} cm, ${inS ? 'INSIDE the muscle' : 'on its outer surface'} (outside required); ${f1(s.p[1] - y56)} cm from the 5th/6th-rib level (|dy| <= 2); ${f1(Math.abs(s.p[2] - zMAL))} cm ${s.p[2] < zMAL ? 'posterior' : 'anterior'} to the mid-axillary line = z of the lateral-most rib points (textbook: on or just behind the MAL; from 1.5 anterior to 4 posterior accepted); 5th rib ${f1(d('Fifth rib', s.p))} cm, 6th rib ${f1(d('Sixth rib', s.p))} cm` };
  },
  'thoracodorsalis@axilla_hinterwand': () => {
    const all = S('Thoracodorsal nerve').filter(s => !s.branch);
    const s = all.find(s => d('Latissimus dorsi muscle', s.p) <= 0.3) || argmin(all, s => d('Latissimus dorsi muscle', s.p));
    const yS = bbox(G('Subscapularis muscle')).mn[1], c = closest(G('Latissimus dorsi muscle'), s.p);
    return { s, rule: 'first thoracodorsal nerve sample (from proximal) within 0.3 cm of latissimus dorsi (where it reaches the deep surface)',
      ok: c.d <= 0.3 && s.p[1] <= yS + 1 && d('Teres major muscle', s.p) <= 3,
      check: `latissimus dorsi ${f1(c.d)} cm (<= 0.3); ${f1(yS - s.p[1])} cm below the lowest point of subscapularis (inferior required, >= -1); teres major ${f1(d('Teres major muscle', s.p))} cm (<= 3); outward normal of the touched latissimus surface ${fp(c.n)} (deep surface faces anterior/medial)` };
  },
  'dorsalis_scapulae@scalenus_medius': () => {
    // the content says the scalenus medius is not a model part, but 'Scalenus medius muscle' exists: use it when the
    // nerve comes within 1.5 cm of it, otherwise fall back to the content's levator rule
    const all = S('Dorsal scapular nerve').filter(s => !s.branch), Lmax = Math.max(...all.map(s => s.s));
    const prox = all.filter(s => s.s <= 0.5 * Lmax);
    const useSM = has('Scalenus medius muscle') && Math.min(...prox.map(s => d('Scalenus medius muscle', s.p))) <= 1.5;
    const s = useSM ? argmin(prox, s => d('Scalenus medius muscle', s.p)) : argmin(prox, s => d('Levator scapulae', s.p));
    const sm = has('Scalenus medius muscle') ? d('Scalenus medius muscle', s.p) : NaN, lv = d('Levator scapulae', s.p), above = s.p[1] - bbox(G('Scapula')).mx[1];
    return { s, rule: useSM ? 'proximal half of the dorsal scapular nerve: sample closest to Scalenus medius muscle (a model part, although the content says it is not)' : 'proximal half of the dorsal scapular nerve: sample closest to levator scapulae',
      ok: (useSM ? sm <= 1.0 : lv <= 1.5) && above >= 2,
      check: `scalenus medius ${f1(sm)} cm${useSM && inside(G('Scalenus medius muscle'), s.p) ? ' (inside = pierces it)' : ''}${useSM ? ' (<= 1 required)' : ''}, levator scapulae ${f1(lv)} cm; ${f1(above)} cm above the highest point of the scapula (in the neck: >= 2 required)` };
  },
  'subscapularis@fossa_subscapularis': () => {
    const all = S('Superior subscapular nerve').filter(s => !s.branch), s = all[all.length - 1];
    const ds = d('Subscapularis muscle', s.p);
    return { s, rule: 'distal end (tip) of the superior subscapular nerve main path',
      ok: ds <= 0.5,
      check: `subscapularis ${f1(ds)} cm${inside(G('Subscapularis muscle'), s.p) ? ' (inside)' : ''} (<= 0.5 required), scapula ${f1(d('Scapula', s.p))} cm; nerve length to here ${f1(s.s)} cm` };
  },
  'pectorales@pectoralis_minor': () => {
    const all = S('Medial pectoral nerve').filter(s => !s.branch);
    const s = all.find(s => d('Pectoralis minor muscle', s.p) <= 0.2) || argmin(all, s => d('Pectoralis minor muscle', s.p));
    const c = closest(G('Pectoralis minor muscle'), s.p);
    // the deep surface of pectoralis minor faces the chest wall, i.e. the trunk axis (posteromedially)
    const toTrunk = norm([-s.p[0], 0, trunkZ(s.p[1]) - s.p[2]]), facing = dot(c.n, toTrunk);
    return { s, rule: 'first medial pectoral nerve sample (from proximal) within 0.2 cm of pectoralis minor (where it reaches the muscle)',
      ok: c.d <= 0.5 && facing > 0,
      check: `pectoralis minor ${f1(c.d)} cm (<= 0.5); outward normal of the touched surface ${fp(c.n)}, its component towards the trunk axis ${facing.toFixed(2)} (deep surface facing the chest wall: > 0 required); clavicle ${f1(d('Clavicle', s.p))} cm` };
  },
  'femoralis@becken': () => {
    const crest = bbox(G('Hip bone')).mx[1];
    const cand = S('Femoral nerve').filter(s => !s.branch && s.p[1] <= crest && d('Inguinal ligament', s.p) >= 3);
    const s = argmin(cand, s => Math.max(d('Psoas major', s.p), d('Iliacus muscle', s.p)));
    const a = d('Psoas major', s.p), b = d('Iliacus muscle', s.p);
    const ps = verts(G('Psoas major')).filter(v => Math.abs(v[1] - s.p[1]) < 1.5), px = ps.reduce((t, v) => t + v[0], 0) / ps.length;
    return { s, rule: 'femoral nerve sample above the inguinal ligament (>= 3 cm from it, below the iliac crest) with the smallest max distance to psoas major and iliacus (the groove between them)',
      ok: Math.max(a, b) <= 1 && s.p[0] > px,
      check: `psoas ${f1(a)} cm, iliacus ${f1(b)} cm (both <= 1 required); ${f1(s.p[0] - px)} cm lateral of the psoas centre at this height (lateral required); ${f1(crest - s.p[1])} cm below the iliac crest; ${f1(d('Inguinal ligament', s.p))} cm above/behind the inguinal ligament; hip bone ${f1(d('Hip bone', s.p))} cm` };
  },
  'femoralis@leiste': () => {
    const s = argmin(S('Femoral nerve').filter(s => !s.branch), s => d('Inguinal ligament', s.p));
    const c = closest(G('Inguinal ligament'), s.p), A = L.ingAxis;
    const latFirst = A.at(0)[0] > A.at(1)[0], f = latFirst ? A.t(c.p) : 1 - A.t(c.p);
    // textbook order under the ligament from lateral to medial: nerve (lacuna musculorum) - artery - vein (lacuna vasorum)
    const xAt = g => { if (!has(g)) return NaN; const v = verts(G(g)).filter(a => Math.abs(a[1] - s.p[1]) < 0.6); return v.length ? v.reduce((t, a) => t + a[0], 0) / v.length : NaN; };
    const xa = xAt('Femoral artery'), xv = xAt('Femoral vein');
    return { s, rule: 'femoral nerve sample closest to the inguinal ligament',
      ok: c.d <= 2 && c.p[2] > s.p[2] && s.p[0] > xa && xa > xv,
      check: `inguinal ligament ${f1(c.d)} cm (<= 2), the ligament lies ${f1(c.p[2] - s.p[2])} cm anterior to the nerve (nerve deep to it required); order from lateral: nerve x ${f1(s.p[0])}, femoral artery x ${f1(xa)}, femoral vein x ${f1(xv)} at this height (nerve lateral of the artery, artery lateral of the vein required; nerve ${f1(s.p[0] - xa)} cm lateral of the artery, textbook ~1 cm); crossing at ${(f * 100).toFixed(0)} % of the ligament length from its lateral end (the ligament mesh runs to the pubic tubercle, so the mid-inguinal point lies medial of 50 %); iliacus ${f1(d('Iliacus muscle', s.p))} cm, psoas ${f1(d('Psoas major', s.p))} cm` };
  },
  'obturatorius@canalis_obturatorius': () => {
    const mb = bbox(G('Obturator membrane')), top = verts(G('Obturator membrane')).filter(v => v[1] >= mb.mx[1] - 0.5);
    const U = mul(top.reduce((t, v) => add(t, v), [0, 0, 0]), 1 / top.length);
    const s = argmin(S('Obturator nerve', 'Anterior branch of obturator nerve', 'Posterior branch of obturator nerve'), s => dist(s.p, U));
    return { s, rule: 'obturator nerve sample (trunk or branches) closest to the middle of the upper free edge of the obturator membrane (its vertices within 0.5 cm of the top)',
      ok: dist(s.p, U) <= 2 && s.p[1] >= mb.mx[1] - 0.5 && d('Hip bone', s.p) <= 1.5,
      check: `${f1(dist(s.p, U))} cm from the middle of the membrane's upper edge ${fp(U)} (<= 2), ${f1(s.p[1] - mb.mx[1])} cm relative to the membrane top (above or at the edge required); hip bone ${f1(d('Hip bone', s.p))} cm (obturator groove: <= 1.5 required), obturator internus ${f1(d('Obturator internus', s.p))} cm, externus ${f1(d('Obturator externus', s.p))} cm` };
  },
  'gluteus_superior@suprapiriforme': () => {
    const pir = G('Piriformis muscle'), all = S('Superior gluteal nerve');
    const cand = all.filter(s => !inside(pir, s.p) && rayDist(pir, s.p, [0, -1, 0], 4) < 4);
    const s = argmin(cand, s => d('Piriformis muscle', s.p) + d('Hip bone', s.p));
    const later = all.filter(q => q.part === s.part && q.s > s.s + 0.5);
    const mm = later.length ? Math.min(...later.map(q => Math.max(d('Gluteus medius muscle', q.p), d('Gluteus minimus muscle', q.p)))) : Infinity;
    const gap = rayDist(pir, s.p, [0, -1, 0], 4);
    return { s, rule: 'superior gluteal nerve sample above the piriformis (a downward ray hits it within 4 cm) with the smallest sum of distances to piriformis and hip bone (greater sciatic notch)',
      ok: gap <= 2 && d('Hip bone', s.p) <= 1 && mm <= 0.5,
      check: `piriformis ${f1(gap)} cm below the nerve (<= 2 required), hip bone ${f1(d('Hip bone', s.p))} cm (<= 1); further distally the nerve runs within ${f1(mm)} cm of both gluteus medius and minimus (between them: <= 0.5 required)` };
  },
  'gluteus_inferior@infrapiriforme': () => {
    // the inferior gluteal nerve is not a model part: the content asks for the sciatic nerve as a stand-in
    const pir = G('Piriformis muscle'), all = S('Sciatic nerve').filter(s => !s.branch);
    const cand = all.filter(s => !inside(pir, s.p) && rayDist(pir, s.p, Y, 4) < 4);
    const s = argmin(cand, s => d('Piriformis muscle', s.p) + d('Sacrospinous ligament', s.p));
    const up = rayDist(pir, s.p, Y, 4), ss = closest(G('Sacrospinous ligament'), s.p);
    const inPir = all.filter(q => inside(pir, q.p));
    const note = inPir.length ? `the sciatic nerve centreline runs inside the piriformis over ${f1(inPir[inPir.length - 1].s - inPir[0].s + 0.1)} cm (y ${f1(inPir[0].p[1])} to ${f1(inPir[inPir.length - 1].p[1])}): in the model it pierces the muscle instead of passing below it` : null;
    return { s, rule: 'sciatic nerve sample (stand-in; the inferior gluteal nerve is not modelled) below the piriformis (an upward ray hits it within 4 cm) with the smallest sum of distances to piriformis and sacrospinous ligament',
      ok: up <= 2 && ss.d <= 3 && s.p[1] > ss.p[1] - 0.5,
      notes: note ? [note] : [],
      check: `piriformis ${f1(up)} cm above the nerve (<= 2 required), sacrospinous ligament ${f1(ss.d)} cm (<= 3), its nearest point ${f1(s.p[1] - ss.p[1])} cm below the nerve (nerve above the ligament required); hip bone ${f1(d('Hip bone', s.p))} cm, gluteus maximus ${f1(d('Gluteus maximus muscle', s.p))} cm` + (note ? `; NOTE: ${note}` : '') };
  },
  'ischiadicus@gluteal': () => {
    const IT = L.ischialTub, GT = L.greaterTroch, M = mul(add(IT, GT), 0.5);
    const s = argmin(S('Sciatic nerve').filter(s => !s.branch), s => Math.hypot(s.p[0] - M[0], s.p[1] - M[1]));
    const fx = (s.p[0] - IT[0]) / (GT[0] - IT[0]), q = closest(G('Quadratus femoris muscle'), s.p), pr = closest(G('Piriformis muscle'), s.p);
    // lateral edge of the ischial tuberosity at the nerve's height (posterior hip-bone vertices within 0.5 cm in y)
    const tub = verts(G('Hip bone')).filter(v => Math.abs(v[1] - s.p[1]) < 0.5 && v[2] < -1), edge = tub.length ? Math.max(...tub.map(v => v[0])) : NaN;
    return { s, rule: 'sciatic nerve sample closest (in the frontal x-y projection) to the midpoint between ischial tuberosity (lowest posterior hip-bone vertex) and greater trochanter (most lateral femur vertex in its top 10 cm)',
      ok: range(fx, 0.25, 0.6) && s.p[0] > edge && s.p[2] < q.p[2] && pr.p[1] > s.p[1],
      check: `${f1(Math.hypot(s.p[0] - M[0], s.p[1] - M[1]))} cm from the midpoint in the frontal view; at ${(fx * 100).toFixed(0)} % of the way from the ischial tuberosity ${fp(IT)} to the greater trochanter ${fp(GT)} (textbook: midway or at the junction of the medial and middle thirds; 25-60 % required); ${f1(s.p[0] - edge)} cm lateral of the lateral edge of the tuberosity at this height (x ${f1(edge)}; lateral required, the nerve must not lie on the tuberosity); hip bone ${f1(d('Hip bone', s.p))} cm; quadratus femoris ${f1(q.d)} cm, ${f1(q.p[2] - s.p[2])} cm anterior to the nerve (nerve posterior required); piriformis ${f1(pr.p[1] - s.p[1])} cm above (nerve below required); gluteus maximus ${f1(d('Gluteus maximus muscle', s.p))} cm` };
  },
  'tibialis@kniekehle': () => {
    const yJ = L.jointLineKnee;
    const s = argmin(S('Tibial nerve').filter(s => !s.branch), s => Math.abs(s.p[1] - yJ));
    const band = g => { const v = verts(G(g)).filter(v => Math.abs(v[1] - yJ) < 3); return v.reduce((t, w) => t + w[0], 0) / v.length; };
    const xm = band('Medial head of gastrocnemius'), xl = band('Lateral head of gastrocnemius');
    const bt = closest(G('Tibia'), s.p), bf = closest(G('Femur'), s.p);
    const sciTip = nerveLine(G('Sciatic nerve')[0]).tip;
    return { s, rule: 'tibial nerve sample at the knee joint line (mean of the lowest femur point and the highest tibia point)',
      ok: range(s.p[0], xm, xl) && s.p[2] < Math.max(bt.p[2], bf.p[2]),
      check: `x = ${f1(s.p[0])} between the medial (${f1(xm)}) and lateral (${f1(xl)}) gastrocnemius heads at this level (required); femur ${f1(bf.d)} cm, tibia ${f1(bt.d)} cm, nerve posterior to both (required); the sciatic nerve divides ${f1(sciTip[1] - yJ)} cm above the joint line in the model (textbook: usually at the apex of the popliteal fossa, ~5-10 cm, variable)` };
  },
  'tibialis@tarsaltunnel': () => {
    const all = S('Tibial nerve').filter(s => !s.branch), s = all[all.length - 1];
    const m = nerveLine(G('Medial plantar nerve')[0]).root, l = nerveLine(G('Lateral plantar nerve')[0]).root;
    const MM = L.malleolusMed, rc = closest(G('Flexor retinaculum of ankle'), s.p), xc = centroid(G('Calcaneus'))[0];
    return { s, rule: 'distal end of the tibial nerve = division into medial and lateral plantar nerve',
      ok: Math.max(dist(s.p, m), dist(s.p, l)) <= 1 && s.p[2] < MM[2] && s.p[1] < MM[1] + 1 && rc.d <= 1.5 && s.p[0] < xc,
      check: `plantar nerves start ${f1(dist(s.p, m))} / ${f1(dist(s.p, l))} cm away (<= 1); ${f1(MM[2] - s.p[2])} cm posterior and ${f1(MM[1] - s.p[1])} cm inferior to the tip of the medial malleolus ${fp(MM)} (posterior-inferior required); flexor retinaculum ${f1(rc.d)} cm (<= 1.5), nerve ${f1(s.p[0] - rc.p[0])} cm lateral (= deep) of its nearest point; ${f1(xc - s.p[0])} cm medial of the calcaneus centre (medial side required), calcaneus ${f1(d('Calcaneus', s.p))} cm` };
  },
  'fibularis_communis@fibulakopf': () => {
    const top = L.fibTop, A = ax('Fibula');
    const cand = S('Common fibular nerve').filter(s => range(top - s.p[1], 0.5, 5));
    const s = argmin(cand, s => d('Fibula', s.p));
    const r = A.radial(s.p), pl = dot(norm([r[0], 0, r[2]]), norm([1, 0, -1]));
    return { s, rule: 'common fibular nerve sample 0.5-5 cm below the fibular apex that is closest to the fibula',
      ok: d('Fibula', s.p) <= 1 && range(top - s.p[1], 1.5, 4.5) && pl > 0,
      check: `fibula ${f1(d('Fibula', s.p))} cm (<= 1), ${f1(top - s.p[1])} cm below the fibular apex (neck: 1.5-4.5 required); direction from the fibular axis ${fp(norm(r))}, posterolateral component ${pl.toFixed(2)} (> 0 required); fibularis longus ${f1(d('Fibularis longus muscle', s.p))} cm; the nerve divides ${f1(top - nerveLine(G('Common fibular nerve')[0]).tip[1])} cm below the apex` };
  },
  'fibularis_communis@extensorenloge': () => {
    const tb = bbox(G('Tibia')), ym = (tb.mn[1] + tb.mx[1]) / 2;
    const s = argmin(S('Deep fibular nerve').filter(s => !s.branch), s => Math.abs(s.p[1] - ym));
    const m = closest(G('Interosseous membrane of leg'), s.p), xt = closest(G('Tibia'), s.p).p[0], xf = closest(G('Fibula'), s.p).p[0];
    return { s, rule: 'deep fibular nerve sample at the mid-height of the tibia',
      ok: m.d <= 1 && s.p[2] >= m.p[2] - 0.1 && range(s.p[0], Math.min(xt, xf), Math.max(xt, xf)) && d('Tibialis anterior muscle', s.p) <= 1,
      check: `interosseous membrane ${f1(m.d)} cm (<= 1), nerve ${f1(s.p[2] - m.p[2])} cm anterior to its nearest point (anterior required); x = ${f1(s.p[0])} between tibia (${f1(xt)}) and fibula (${f1(xf)}) (required); tibialis anterior ${f1(d('Tibialis anterior muscle', s.p))} cm (<= 1)` };
  },
  'cutaneus_femoris_lateralis@spina': () => {
    const A = L.ingAxis, latFirst = A.at(0)[0] > A.at(1)[0];
    const LE = extremeVertex(G('Inguinal ligament'), v => (latFirst ? -1 : 1) * A.t(v));
    const s = argmin(S('Lateral femoral cutaneous nerve').filter(s => !s.branch), s => dist(s.p, LE));
    const asis = L.asis;
    return { s, rule: 'lateral femoral cutaneous nerve sample closest to the lateral end of the inguinal ligament',
      ok: range(asis[0] - s.p[0], 0, 4) && d('Inguinal ligament', s.p) <= 1.5 && dist(s.p, asis) <= 5,
      check: `${f1(dist(s.p, LE))} cm from the lateral end of the ligament ${fp(LE)}; ${f1(asis[0] - s.p[0])} cm medial and ${f1(Math.abs(asis[1] - s.p[1]))} cm ${s.p[1] < asis[1] ? 'below' : 'above'} the ASIS ${fp(asis)} (textbook ~1-2 cm medial; 0-4 accepted), ${f1(dist(s.p, asis))} cm from it (<= 5); ligament ${f1(d('Inguinal ligament', s.p))} cm (<= 1.5), sartorius ${f1(d('Sartorius muscle', s.p))} cm` };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// run sites
// ---------------------------------------------------------------------------------------------------------------
const out = { v: 1, generated_by: 'tools/_locowork/geo-nerves/geo.mjs', units: 'cm; +x = body left (lateral for the left limb), +y up, +z anterior', sites: {}, nerves: {}, model_issues: [] };
const siteNotes = {};
for (const n of content.nerves) for (const site of n.sites) {
  const key = `${n.key}@${site.key}`;
  if (filter && !key.includes(filter)) continue;
  const rule = SITES[key];
  if (!rule) { out.sites[key] = { ok: false, check: 'not computed: no rule defined for this site' }; console.log(key, 'NO RULE'); continue; }
  let r;
  try { r = rule(); } catch (e) { out.sites[key] = { ok: false, check: `not computed: ${e.message}` }; console.log(key, 'ERROR', e.stack); continue; }
  const p = r.s.p, lm = site.landmarks.filter(has);
  const near = argmin(lm, l => d(l, p)), od = outDir(p);
  const rec = { p: r2(p), out: r2(od.out), outFrom: od.from, dist: r2(d(near, p)), near, part: r.s.part, ok: !!r.ok, check: r.check, rule: r.rule };
  const sexLm = site.landmarks.filter(l => SEX_PARTS.includes(l) && GROUPS_F.has(l));
  if (sexLm.length) rec.female = Object.fromEntries(sexLm.map(l => [l, { male: r2(d(l, p)), female: r2(closest(GROUPS_F.get(l), p).d) }]));
  const lost = site.landmarks.filter(l => !has(l)); if (lost.length) rec.check += `; landmarks not in the model: ${lost.join(', ')}`;
  out.sites[key] = rec; if (r.notes?.length) siteNotes[key] = r.notes;
  console.log(`${key.padEnd(42)} ${rec.ok ? 'OK  ' : 'FAIL'} ${fp(p)} ${r.s.part}  dist ${f1(rec.dist)} (${near})  out ${fp(od.out)} from ${od.from}\n    ${rec.check}`);
  if (rec.female) console.log('    female:', JSON.stringify(rec.female));
}

// ---------------------------------------------------------------------------------------------------------------
// nerves: trunk length, ends, reach of every muscle in muscle_groups, issues
// ---------------------------------------------------------------------------------------------------------------
const CURATED = {
  gluteus_inferior: ['Inferior gluteal nerve is not a model part: its site and reach use the sciatic nerve as a stand-in (reach says nothing about the real nerve)'],
  ischiadicus: ['The sciatic nerve part ends at its division; the leg and foot muscles are reached by the tibial / common fibular nerve parts (see those entries)'],
  tibialis: ['The hamstrings and the adductor magnus are supplied by the tibial part of the sciatic nerve in the thigh; the model has no separate tibial division there, so their reach is measured from the tibial nerve part below the division (see ischiadicus.reach)'],
  fibularis_communis: ['The short head of biceps femoris is supplied by the fibular part of the sciatic nerve in the thigh; reach is measured from the common fibular nerve part below the division (see ischiadicus.reach)'],
};
if (!filter) for (const n of content.nerves) {
  const issues = [...(CURATED[n.key] || [])];
  const nameList = n.n.filter(has), absent = n.n.filter(x => !has(x));
  if (absent.length) issues.push(`nerve parts not in the model: ${absent.join(', ')}`);
  const reachParts = nameList.length ? nameList : (n.key === 'gluteus_inferior' ? ['Sciatic nerve'] : []);
  const rec = { length: null, from: null, to: null, trunk: null, reach: {}, issues };
  if (nameList.length) {
    const cl = nerveLine(G(nameList[0])[0]);
    Object.assign(rec, { length: r2(cl.len), from: r2(cl.root), to: r2(cl.tip), trunk: nameList[0] });
    if (cl.stats.comps > 1) issues.push(`'${nameList[0]}' consists of ${cl.stats.comps} separate mesh pieces (bridged for the centreline)`);
  } else if (reachParts.length) {
    rec.trunk = `${reachParts[0]} (stand-in)`;
  }
  const pts = reachParts.flatMap(nm => G(nm).flatMap(part => sampleSurface(part, 0.3)));
  const muscles = [...new Set(n.muscle_groups.flatMap(g => g.n))];
  for (const m of muscles) {
    if (!has(m)) { rec.reach[m] = null; issues.push(`muscle '${m}' not in the model`); continue; }
    rec.reach[m] = pts.length ? r2(minDistPoints(pts, G(m))) : null;
  }
  const far = muscles.filter(m => rec.reach[m] != null && rec.reach[m] > 2);
  if (far.length && !CURATED[n.key]) issues.push(`the modelled nerve parts stay > 2 cm away from: ${far.map(m => `${m} (${f1(rec.reach[m])})`).join(', ')}`);
  for (const s of n.sites) {
    const k = `${n.key}@${s.key}`, srec = out.sites[k];
    if (srec && !srec.ok) issues.push(`site '${s.key}' fails its check: ${srec.check}`);
    for (const note of siteNotes[k] || []) issues.push(note);
  }
  out.nerves[n.key] = rec;
  console.log(`\n## ${n.key}: trunk ${rec.trunk} length ${rec.length} reach ${JSON.stringify(rec.reach)}\n   ${issues.join('\n   ')}`);
}
out.model_issues = [...new Set(modelIssues)];
if (missing.length) out.model_issues.push(`names not found in meta.json: ${missing.join(', ')}`);
console.log('\nmodel issues:\n  ' + out.model_issues.join('\n  '));
if (!filter) { fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`\nwrote ${OUT}`); }
