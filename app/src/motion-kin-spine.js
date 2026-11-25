// Gövde ve baş-boyun hareketi kinematiği (küçük sürüm; pelvis ve bacaklar durağan). Veri: public/data/motion-spine.json
// (tools/motion-spine-build.mjs ölçer: hareket segmentlerinin dönme merkezleri ve eksenleri, kemiklerin segmentleri).
// Kol ve bacak kinematiğiyle (motion-kin.js, motion-kin-leg.js) aynı arayüz: createModel, createFk, fk (mats, dq, pts),
// clampPose, limits, poseDistance, lerpPose, readout, solveHead; compileLine / skinLine / lineLength motion-kin.js'den.
// Koordinatlar (derece, Neutral-Null; her bölge kendi hareket segmentlerine dağıtılır):
//   HWS (C0/C1 .. C7/T1, Kopfgelenke dahil): cFlex (Flexion + / Extension -), cLat (Lateralflexion rechts + / links -),
//     cRot (Rotation rechts + / links -)
//   BWS (T1/T2 .. T12/L1): tFlex, tLat, tRot     LWS (L1/L2 .. L5/S1): lFlex, lLat, lRot
// Dinlenme (modelin duruşu) = Neutral-Null = bütün açılar 0 = birim matris.
// Segment zinciri aşağıdan yukarı: pelvis (durağan) -> L5 -> ... -> T1 -> C7 -> ... -> C1 -> head. Her segment, kendi alt hareket
// segmentinin dönme merkezi çevresinde, ebeveynine göre döner. Eksenler dinlenmede ölçülür: y = yerel boyuna eksen (merkezden
// bir üstteki merkeze), x = sola (gövdenin x'i, y'ye dik), z = öne (x × y).
// İşaretler: fleksiyonda üstteki kısım öne (+z), sağa lateral fleksiyonda sağa (-x), sağa rotasyonda yüzün önü sağa (-x).
import { rot3, mul3, apply3, toDualQuat, qAx, qMul, clamp, num, compileLine, skinLine, lineLength, skinPoint, ease } from './motion-kin.js';
export { compileLine, skinLine, lineLength, skinPoint, ease };

export const COORDS = ['cFlex', 'cLat', 'cRot', 'tFlex', 'tLat', 'tRot', 'lFlex', 'lLat', 'lRot'];
// Sınırlar: ders kitabı toplamları (Neutral-Null), bölge başına. AMBOSS "Orthopädische Untersuchung der Wirbelsäule":
// HWS Inklination / Reklination 45/0/45, Lateralflexion 45/0/45, Rotation 80/0/80; BWS 35/0/25, 20/0/20, 40/0/40;
// LWS 50/0/30, 20/0/20, 10/0/10. [negatif (Extension / links), pozitif (Flexion / rechts)]
export const RANGES = { cFlex: [-45, 45], cLat: [-45, 45], cRot: [-80, 80], tFlex: [-25, 35], tLat: [-20, 20], tRot: [-40, 40], lFlex: [-30, 50], lLat: [-20, 20], lRot: [-10, 10] };
export const REGION = { c: ['cFlex', 'cLat', 'cRot'], t: ['tFlex', 'tLat', 'tRot'], l: ['lFlex', 'lLat', 'lRot'] };
// Segment ROM tablosu (White & Panjabi, Clinical Biomechanics of the Spine, 2. baskı 1990, "representative values"):
// [hareket segmenti, üstteki segmentin anahtarı, bölge, Flexion+Extension toplamı, Lateralflexion tek yan, Rotation tek yan].
// Bölgenin açısı, segmentlere bu sütunların payıyla dağıtılır (fleksiyon ve ekstansiyon aynı payla: yaklaşık).
export const ROM = [
  ['C0/C1', 'head', 'c', 25, 5, 5], ['C1/C2', 'C1', 'c', 20, 5, 40], ['C2/C3', 'C2', 'c', 10, 10, 3], ['C3/C4', 'C3', 'c', 15, 11, 7],
  ['C4/C5', 'C4', 'c', 20, 11, 7], ['C5/C6', 'C5', 'c', 20, 8, 7], ['C6/C7', 'C6', 'c', 17, 7, 6], ['C7/T1', 'C7', 'c', 9, 4, 2],
  ['T1/T2', 'T1', 't', 4, 6, 9], ['T2/T3', 'T2', 't', 4, 6, 8], ['T3/T4', 'T3', 't', 4, 6, 8], ['T4/T5', 'T4', 't', 4, 6, 8],
  ['T5/T6', 'T5', 't', 4, 6, 8], ['T6/T7', 'T6', 't', 5, 6, 8], ['T7/T8', 'T7', 't', 6, 6, 8], ['T8/T9', 'T8', 't', 6, 6, 7],
  ['T9/T10', 'T9', 't', 6, 6, 4], ['T10/T11', 'T10', 't', 9, 7, 2], ['T11/T12', 'T11', 't', 12, 9, 2], ['T12/L1', 'T12', 't', 12, 8, 2],
  ['L1/L2', 'L1', 'l', 12, 6, 2], ['L2/L3', 'L2', 'l', 14, 6, 2], ['L3/L4', 'L3', 'l', 15, 8, 2], ['L4/L5', 'L4', 'l', 16, 6, 2], ['L5/S1', 'L5', 'l', 17, 3, 1],
];
// Zincir sırası (aşağıdan yukarı); veri dosyasının segments sırası bununla aynı olmalı
export const SEGMENTS = ['pelvis', 'L5', 'L4', 'L3', 'L2', 'L1', 'T12', 'T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2', 'T1', 'C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1', 'head'];
// Paylar: SHARE[seg] = { flex, lat, rot, region }; bölge içinde her sütunun toplamı 1
export const SHARE = (() => {
  const s = {}, sum = { c: [0, 0, 0], t: [0, 0, 0], l: [0, 0, 0] };
  for (const [, k, r, f, l, o] of ROM) { sum[r][0] += f; sum[r][1] += l; sum[r][2] += o; }
  for (const [label, k, r, f, l, o] of ROM) s[k] = { label, region: r, flex: f / sum[r][0], lat: l / sum[r][1], rot: o / sum[r][2] };
  return s;
})();

export function createModel(data) {
  const segs = data.segments.map(s => s.key);
  if (segs.join() !== SEGMENTS.join()) throw new Error('motion-kin-spine: segment sırası beklenmiyor: ' + segs.join());
  const C = {}, AX = {};
  for (const k of SEGMENTS.slice(1)) {
    const c = data.joints.centre[k], a = data.joints.axes[k];
    if (!c || !a) throw new Error('motion-kin-spine: merkez ya da eksen yok: ' + k);
    const u = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    C[k] = c.map(Number); AX[k] = { x: u(a.x), y: u(a.y), z: u(a.z) };
  }
  const rest = {}; for (const k of COORDS) rest[k] = num(data.rest?.[k], 0);
  const index = Object.fromEntries(segs.map((k, i) => [k, i]));
  return { segs, index, rest, ranges: RANGES, C, AX, headPt: data.joints.headPt.map(Number), headR: num(data.joints.headR, 18) };
}
export const restPose = model => ({ ...model.rest });
export const neutralPose = () => Object.fromEntries(COORDS.map(k => [k, 0]));
export function limits() { const L = {}; for (const k of COORDS) L[k] = RANGES[k].slice(); return L; }
export function clampPose(model, pose, out = {}) {
  const r = model.rest, q = pose || r;
  for (const k of COORDS) out[k] = clamp(num(q[k], r[k]), RANGES[k][0], RANGES[k][1]);
  return out;
}
export const applySet = (model, base, set, out = {}) => clampPose(model, { ...(base || model.rest), ...(set || {}) }, out);
export function poseDistance(model, a, b) { let m = 0; for (const k of COORDS) m = Math.max(m, Math.abs(num(b?.[k], model.rest[k]) - num(a?.[k], model.rest[k]))); return m; }
export function lerpPose(model, a, b, t, out = {}) {
  const r = model.rest, o = {};
  for (const k of COORDS) { const x = num(a?.[k], r[k]); o[k] = x + clamp(t, 0, 1) * (num(b?.[k], r[k]) - x); }
  return clampPose(model, o, out);
}
export const wrap180 = a => a;
// Bir segmentin açıları (bölge koordinatı x payı)
export function segAngles(model, pose, k) {
  const s = SHARE[k], [f, l, o] = REGION[s.region], r = model.rest;
  return { flex: s.flex * (num(pose[f], r[f]) - r[f]), lat: s.lat * (num(pose[l], r[l]) - r[l]), rot: s.rot * (num(pose[o], r[o]) - r[o]) };
}

export function createFk(model) {
  const n = model.segs.length, mats = new Float64Array(16 * n), m = {};
  for (let i = 0; i < n; i++) { m[model.segs[i]] = mats.subarray(16 * i, 16 * i + 16); mats[16 * i] = mats[16 * i + 5] = mats[16 * i + 10] = mats[16 * i + 15] = 1; }
  const seg = model.segs.map(() => ({ R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: new Float64Array(3), q: new Float64Array([0, 0, 0, 1]) }));
  return { model, mats, m, seg, dq: new Float64Array(8 * n), pose: {}, pts: { head: [0, 0, 0] } };
}
const _a = new Float64Array(9), _b = new Float64Array(9), _q1 = new Float64Array(4), _q2 = new Float64Array(4), _q3 = new Float64Array(4);
const IDR = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
function place(dst, par, R, q, c) {
  const lp = apply3(R, c), lx = c[0] - lp[0], ly = c[1] - lp[1], lz = c[2] - lp[2];
  const P = par.R;
  dst.t[0] = P[0] * lx + P[1] * ly + P[2] * lz + par.t[0]; dst.t[1] = P[3] * lx + P[4] * ly + P[5] * lz + par.t[1]; dst.t[2] = P[6] * lx + P[7] * ly + P[8] * lz + par.t[2];
  mul3(dst.R, P, R); qMul(dst.q, par.q, q);
}
// Segment dönmesi: R = Rx(flex) Rz(lat) Ry(-rot) (yerel eksenlerle; segment başına açılar birkaç derece olduğundan sıra önemsiz)
export function fk(model, pose, out) {
  const o = out || createFk(model), S = o.seg, q = o.pose;
  for (const k of COORDS) q[k] = num(pose && pose[k], model.rest[k]);
  S[0].R.set(IDR); S[0].t.fill(0); S[0].q[0] = S[0].q[1] = S[0].q[2] = 0; S[0].q[3] = 1;
  for (let i = 1; i < model.segs.length; i++) {
    const k = model.segs[i], ax = model.AX[k], a = segAngles(model, q, k);
    rot3(_a, ax.x, a.flex); rot3(_b, ax.z, a.lat); mul3(_a, _a, _b); rot3(_b, ax.y, -a.rot); mul3(_a, _a, _b);
    qMul(_q1, qAx(_q1, ax.x, a.flex), qAx(_q2, ax.z, a.lat)); qMul(_q1, _q1, qAx(_q3, ax.y, -a.rot));
    place(S[i], S[i - 1], _a, _q1, model.C[k]);
  }
  for (let i = 0; i < S.length; i++) {
    const s = S[i], M = o.mats, k = 16 * i, R = s.R;
    M[k] = R[0]; M[k + 1] = R[3]; M[k + 2] = R[6]; M[k + 3] = 0; M[k + 4] = R[1]; M[k + 5] = R[4]; M[k + 6] = R[7]; M[k + 7] = 0;
    M[k + 8] = R[2]; M[k + 9] = R[5]; M[k + 10] = R[8]; M[k + 11] = 0; M[k + 12] = s.t[0]; M[k + 13] = s.t[1]; M[k + 14] = s.t[2]; M[k + 15] = 1;
    toDualQuat(R, s.t, o.dq, 8 * i, s.q);
  }
  const h = S[S.length - 1], p = model.headPt, R = h.R;
  o.pts.head[0] = R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + h.t[0]; o.pts.head[1] = R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + h.t[1]; o.pts.head[2] = R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + h.t[2];
  return o;
}

// ---------- Neutral-Null okuması (Almanca terimler) ----------
export const TERMS = { flex: 'Flexion', ext: 'Extension', latR: 'Lateralflexion rechts', latL: 'Lateralflexion links', rotR: 'Rotation rechts', rotL: 'Rotation links' };
const nn = (v, pos, neg) => ({ v, abs: Math.abs(v), de: v >= 0 ? TERMS[pos] : TERMS[neg] });
export function readout(model, pose) {
  const q = clampPose(model, pose, {}), reg = (f, l, o) => ({ flex: nn(q[f], 'flex', 'ext'), lat: nn(q[l], 'latR', 'latL'), rot: nn(q[o], 'rotR', 'rotL') });
  // Kopfgelenke: C0/C1 + C1/C2 payı (HWS koordinatından)
  const kg = k => SHARE.head[k] + SHARE.C1[k];
  return { c: reg('cFlex', 'cLat', 'cRot'), t: reg('tFlex', 'tLat', 'tRot'), l: reg('lFlex', 'lLat', 'lRot'),
    atlantoaxial: nn(SHARE.C1.rot * q.cRot, 'rotR', 'rotL'), kopf: { flex: nn(kg('flex') * q.cFlex, 'flex', 'ext'), rot: nn(kg('rot') * q.cRot, 'rotR', 'rotL') } };
}

// ---------- tutamaç: baş (tepe noktası) ----------
// HWS fleksiyonu ve lateral fleksiyonu, baş noktası ışına en yakın olacak biçimde (koordinat sırayla iniş: 3, sonra 0,5 derece)
const _fo = {};
export function solveHead(model, pose, ray) {
  const q = clampPose(model, pose, {}), o = _fo.o || (_fo.o = createFk(model));
  const dAt = p => { fk(model, p, o); const h = o.pts.head, w = [h[0] - ray.origin.x, h[1] - ray.origin.y, h[2] - ray.origin.z], t = w[0] * ray.direction.x + w[1] * ray.direction.y + w[2] * ray.direction.z; return Math.hypot(w[0] - t * ray.direction.x, w[1] - t * ray.direction.y, w[2] - t * ray.direction.z); };
  let best = { ...q }, bd = dAt(best);
  for (let it = 0; it < 3; it++) for (const k of ['cFlex', 'cLat']) for (const st of [3, 0.5]) {
    const c0 = best[k];
    for (let v = c0 - 10 * st; v <= c0 + 10 * st + 1e-9; v += st) { const p = clampPose(model, { ...best, [k]: v }, {}); const e = dAt(p); if (e < bd - 1e-9) { bd = e; best = p; } }
  }
  return { pose: best, dist: bd };
}
