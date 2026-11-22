// Bacak hareketi kinematiği (sol bacak; pelvis durağan). Tasarım: data/work/motion/SPEC-LEG.md. Veri: public/data/motion-leg.json
// (tools/motion-leg-build.mjs). Kol kinematiğiyle (motion-kin.js) aynı arayüz: createModel, createFk, fk (mats, dq, pts),
// clampPose, limits, poseDistance, lerpPose, readout, solveKnee / solveFoot; kas çizgileri için compileLine / skinLine /
// lineLength ve ikili kuaterniyon kuralı motion-kin.js'den gelir.
// Koordinatlar (derece, Neutral-Null): hipFlex (Flexion + / Extension -), hipAbd (Abduktion + / Adduktion -), hipRot
// (Innenrotation + / Außenrotation -), knee (Flexion +), kneeRot (Innenrotation + / Außenrotation - der Tibia, nur bei
// gebeugtem Knie: Grenzen wachsen von 0 bei gestrecktem Knie bis IR 10 / AR 40 ab 90 Grad Flexion), ankle (Dorsalextension + / Plantarflexion -), subtalar
// (Pronation + / Supination -). Dinlenme = birim matris; her açı dinlenmeye göre fark olarak uygulanır.
// Eksenler (x sola = bacağın dışı, y yukarı, z öne): kalça mutlak yönelimi A = Rx(-flex) Rz(abd) Ry(-rot) (sıra: fleksiyon,
// abduksiyon, femur ekseni çevresinde rotasyon); diz ve OSG ölçülen menteşe eksenlerinde, USG ders kitabı eğik ekseninde.
import { rot3, mul3, apply3, toDualQuat, qAx, qMul, clamp, num, compileLine, skinLine, lineLength, skinPoint, ease } from './motion-kin.js';
export { compileLine, skinLine, lineLength, skinPoint, ease };

const D2R = Math.PI / 180;
export const COORDS = ['hipFlex', 'hipAbd', 'hipRot', 'knee', 'kneeRot', 'ankle', 'subtalar'];
export const SEGMENTS = ['pelvis', 'femur', 'patella', 'tibia', 'talus', 'foot'];
export const RANGES = { hipFlex: [-15, 130], hipAbd: [-25, 40], hipRot: [-45, 35], knee: [-5, 140], kneeRot: [-40, 10], ankle: [-45, 20], subtalar: [-30, 15] };
// Diz gergin iken kalça fleksiyonu hamstringlerle sınırlı: 90 (diz 0) .. 130 (diz 90 ve üstü), arada doğrusal
export const hipFlexMax = knee => 90 + 40 * clamp(knee / 90, 0, 1);
// Diz rotasyonu yalnız bükük dizde: sınırlar diz 0 -> 90 arasında doğrusal büyür
const kneeRotLim = knee => { const k = clamp(knee / 90, 0, 1); return [RANGES.kneeRot[0] * k, RANGES.kneeRot[1] * k]; };
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
// Patella dizle birlikte: tibia açısının bu oranı kadar diz ekseni çevresinde döner (yaklaşık; lig. patellae boyu korunur)
const PATELLA = 0.7;

export function createModel(data) {
  const J = { ...data.joints }, segs = data.segments.map(s => s.key);
  for (const k of ['kneeAxis', 'ankleAxis', 'subtalarAxis']) { const a = J[k], l = Math.hypot(a[0], a[1], a[2]); J[k] = [a[0] / l, a[1] / l, a[2] / l]; }   // yuvarlanmış veri: birim yap
  if (segs.join() !== SEGMENTS.join()) throw new Error('motion-kin-leg: segment sırası beklenmiyor: ' + segs.join());
  const rest = {}; for (const k of COORDS) rest[k] = num(data.rest?.[k], 0);
  const index = Object.fromEntries(segs.map((k, i) => [k, i]));
  const td = [J.ankle[0] - J.knee[0], J.ankle[1] - J.knee[1], J.ankle[2] - J.knee[2]], tl = Math.hypot(...td); J.tibAxis = td.map(x => x / tl);   // nach distal
  return { J, segs, index, rest, ranges: RANGES, lenFemur: Math.hypot(...J.knee.map((v, i) => v - J.hip[i])), lenTibia: Math.hypot(...J.ankle.map((v, i) => v - J.knee[i])) };
}
export const restPose = model => ({ ...model.rest });
export const neutralPose = () => Object.fromEntries(COORDS.map(k => [k, 0]));
export function limits(model, pose) {
  const L = {}; for (const k of COORDS) L[k] = RANGES[k].slice();
  L.hipFlex[1] = hipFlexMax(num(pose?.knee, model.rest.knee)); L.kneeRot = kneeRotLim(num(pose?.knee, model.rest.knee));
  return L;
}
export function clampPose(model, pose, out = {}) {
  const r = model.rest, q = pose || r;
  const knee = clamp(num(q.knee, r.knee), RANGES.knee[0], RANGES.knee[1]);
  const kr = kneeRotLim(knee);
  for (const k of COORDS) out[k] = k === 'kneeRot' ? clamp(num(q[k], r[k]), kr[0], kr[1]) : clamp(num(q[k], r[k]), RANGES[k][0], k === 'hipFlex' ? hipFlexMax(knee) : RANGES[k][1]);
  return out;
}
export const applySet = (model, base, set, out = {}) => clampPose(model, { ...(base || model.rest), ...(set || {}) }, out);
export function poseDistance(model, a, b) {
  let m = 0; for (const k of COORDS) m = Math.max(m, Math.abs(num(b?.[k], model.rest[k]) - num(a?.[k], model.rest[k]))); return m;
}
export function lerpPose(model, a, b, t, out = {}) {
  const r = model.rest, o = {};
  for (const k of COORDS) { const x = num(a?.[k], r[k]); o[k] = x + clamp(t, 0, 1) * (num(b?.[k], r[k]) - x); }
  return clampPose(model, o, out);
}
export const wrap180 = a => a;

export function createFk(model) {
  const n = model.segs.length, mats = new Float64Array(16 * n), m = {};
  for (let i = 0; i < n; i++) { m[model.segs[i]] = mats.subarray(16 * i, 16 * i + 16); mats[16 * i] = mats[16 * i + 5] = mats[16 * i + 10] = mats[16 * i + 15] = 1; }
  const seg = model.segs.map(() => ({ R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: new Float64Array(3), q: new Float64Array([0, 0, 0, 1]) }));
  return { model, mats, m, seg, dq: new Float64Array(8 * n), pose: {}, pts: { hip: [0, 0, 0], knee: [0, 0, 0], ankle: [0, 0, 0], toe: [0, 0, 0] } };
}
const _a = new Float64Array(9), _b = new Float64Array(9), _q1 = new Float64Array(4), _q2 = new Float64Array(4);
// segment: dönme R ve kuaterniyonu q (dinlenme koordinatında, c noktası çevresinde), sonra ebeveyn
function place(dst, par, R, q, c) {
  const lp = apply3(R, c), lx = c[0] - lp[0], ly = c[1] - lp[1], lz = c[2] - lp[2];
  if (!par) { dst.R.set(R); dst.t[0] = lx; dst.t[1] = ly; dst.t[2] = lz; dst.q.set(q); return; }
  const P = par.R;
  dst.t[0] = P[0] * lx + P[1] * ly + P[2] * lz + par.t[0]; dst.t[1] = P[3] * lx + P[4] * ly + P[5] * lz + par.t[1]; dst.t[2] = P[6] * lx + P[7] * ly + P[8] * lz + par.t[2];
  mul3(dst.R, P, R); qMul(dst.q, par.q, q);
}
const segPoint = (s, p, out) => { const R = s.R; out[0] = R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + s.t[0]; out[1] = R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + s.t[1]; out[2] = R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + s.t[2]; return out; };
// kalça: A(q) A(rest)^T; kuaterniyon zinciri aynı sırayla
function hipRel(R, q, p, r) {
  const ax = [[X, -p.hipFlex], [Z, p.hipAbd], [Y, -p.hipRot], [Y, r.hipRot], [Z, -r.hipAbd], [X, r.hipFlex]];
  R.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); q[0] = q[1] = q[2] = 0; q[3] = 1;
  for (const [v, d] of ax) { rot3(_b, v, d); mul3(R, R, _b); qMul(q, q, qAx(_q2, v, d)); }
}
const IDQ = new Float64Array([0, 0, 0, 1]), IDR = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export function fk(model, pose, out) {
  const o = out || createFk(model), J = model.J, r = model.rest, S = o.seg, q = o.pose;
  for (const k of COORDS) q[k] = num(pose && pose[k], r[k]);
  const Rq = new Float64Array(4);
  place(S[0], null, IDR, IDQ, J.hip);                                                          // pelvis durağan
  hipRel(_a, Rq, q, r); place(S[1], S[0], _a, Rq, J.hip);                                     // femur
  const dk = q.knee - r.knee;
  const dr = q.kneeRot - r.kneeRot;      // tibia: önce kendi ekseni çevresinde rotasyon (iç rotasyonda ayak ucu içe), sonra fleksiyon
  rot3(_a, J.kneeAxis, dk); rot3(_b, J.tibAxis, dr); mul3(_a, _a, _b);
  place(S[3], S[1], _a, qMul(_q1, qAx(_q1, J.kneeAxis, dk), qAx(_q2, J.tibAxis, dr)), J.knee);   // fleksiyonda ayak bileği arkaya
  rot3(_a, J.kneeAxis, PATELLA * dk); place(S[2], S[1], _a, qAx(_q1, J.kneeAxis, PATELLA * dk), J.knee);   // patella
  const da = -(q.ankle - r.ankle);
  rot3(_a, J.ankleAxis, da); place(S[4], S[3], _a, qAx(_q1, J.ankleAxis, da), J.ankle);        // talus (dorsalekstansiyonda ayak ucu yukarı)
  const ds = q.subtalar - r.subtalar;
  rot3(_a, J.subtalarAxis, ds); place(S[5], S[4], _a, qAx(_q1, J.subtalarAxis, ds), J.subtalar);   // ayak (supinasyonda iç kenar yukarı, taban içe bakar)
  for (let i = 0; i < S.length; i++) {
    const s = S[i], M = o.mats, k = 16 * i, R = s.R;
    M[k] = R[0]; M[k + 1] = R[3]; M[k + 2] = R[6]; M[k + 3] = 0; M[k + 4] = R[1]; M[k + 5] = R[4]; M[k + 6] = R[7]; M[k + 7] = 0;
    M[k + 8] = R[2]; M[k + 9] = R[5]; M[k + 10] = R[8]; M[k + 11] = 0; M[k + 12] = s.t[0]; M[k + 13] = s.t[1]; M[k + 14] = s.t[2]; M[k + 15] = 1;
    toDualQuat(R, s.t, o.dq, 8 * i, s.q);
  }
  segPoint(S[1], J.hip, o.pts.hip); segPoint(S[1], J.knee, o.pts.knee); segPoint(S[3], J.ankle, o.pts.ankle);
  // ayak tutamacı: ayak bileğinin 8 cm önü (ayakla birlikte)
  { const f = [J.ankle[0], J.ankle[1] - 3, J.ankle[2] + 8]; segPoint(S[5], f, o.pts.toe); }
  return o;
}

// ---------- Neutral-Null okuması (Almanca terimler) ----------
export const TERMS = { flex: 'Flexion', ext: 'Extension', abd: 'Abduktion', add: 'Adduktion', ir: 'Innenrotation', ar: 'Außenrotation', dorsal: 'Dorsalextension', plantar: 'Plantarflexion', pron: 'Pronation', sup: 'Supination' };
const nn = (v, pos, neg) => ({ v, abs: Math.abs(v), de: v >= 0 ? TERMS[pos] : TERMS[neg] });
export function readout(model, pose) {
  const q = clampPose(model, pose, {});
  return {
    hip: { flex: nn(q.hipFlex, 'flex', 'ext'), abd: nn(q.hipAbd, 'abd', 'add'), rot: nn(q.hipRot, 'ir', 'ar') },
    knee: nn(q.knee, 'flex', 'ext'), kneeRot: nn(q.kneeRot, 'ir', 'ar'), ankle: nn(q.ankle, 'dorsal', 'plantar'), subtalar: nn(q.subtalar, 'pron', 'sup')
  };
}

// ---------- tutamaçlar ----------
// Diz tutamacı: femur yönü, ışının kalça merkezine en yakın noktasına (ya da femur boyundaki küreyle kesişimine) bakar.
// Yön -> mutlak (flex, abd): A (0,-1,0) = (sin a, -cos a cos f, cos a sin f); dinlenme yönelimi (rot) korunur.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rayPoint(ray, c, R) {
  const o = [ray.origin.x, ray.origin.y, ray.origin.z], d = [ray.direction.x, ray.direction.y, ray.direction.z];
  const oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - R * R, disc = b * b - cc;
  const t = disc >= 0 ? -b - Math.sqrt(disc) : -b;      // önce görünen kesişim, yoksa en yakın nokta
  return [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
}
export function solveKnee(model, pose, ray) {
  const J = model.J, q = clampPose(model, pose, {});
  // femurun dinlenme yönü (kalça -> diz) ile A(rest)(0,-1,0) arasındaki fark küçük; hedef yön bu farkla düzeltilmez
  const p = rayPoint(ray, J.hip, model.lenFemur), d = sub(p, J.hip), l = Math.hypot(...d) || 1;
  const x = d[0] / l, y = d[1] / l, z = d[2] / l;
  const abd = Math.asin(clamp(x, -1, 1)) / D2R, flex = Math.atan2(z, -y) / D2R;
  // dinlenme ofseti: ölçülen femur yönünün açıları ile dinlenme açıları arasındaki fark
  return { pose: clampPose(model, { ...q, hipFlex: flex, hipAbd: abd }, {}) };
}
// Ayak tutamacı: diz açısı, ayak bileği ışına en yakın olacak biçimde (1 derecelik tarama, sonra ince)
const _fo = {};
export function solveFoot(model, pose, ray) {
  const q = clampPose(model, pose, {}), o = _fo.o || (_fo.o = createFk(model));
  const dAt = k => { fk(model, { ...q, knee: k }, o); const p = o.pts.ankle, w = [p[0] - ray.origin.x, p[1] - ray.origin.y, p[2] - ray.origin.z], t = w[0] * ray.direction.x + w[1] * ray.direction.y + w[2] * ray.direction.z; return Math.hypot(w[0] - t * ray.direction.x, w[1] - t * ray.direction.y, w[2] - t * ray.direction.z); };
  let best = q.knee, bd = Infinity;
  for (let k = RANGES.knee[0]; k <= RANGES.knee[1]; k += 2) { const e = dAt(k); if (e < bd) { bd = e; best = k; } }
  for (let k = best - 2; k <= best + 2; k += 0.25) { const e = dAt(k); if (e < bd) { bd = e; best = k; } }
  return { pose: clampPose(model, { ...q, knee: best }, {}) };
}
