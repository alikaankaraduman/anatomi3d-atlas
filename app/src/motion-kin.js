// Kol hareketi kipinin kinematiği (sol kol). Saf matematik: DOM yok, three.js yok, sahne nesnesi yok; Node'da da içe
// aktarılır (tools/_qawork/motion-test.mjs, tools/motion-build.mjs). Bağlayıcı tasarım: data/work/motion/SPEC.md bölüm 2.
// Geometrik bir modeldir, fizik değildir.
//
// Birimler ve eksenler: cm; +x = bedenin solu (sol kol için lateral), +y yukarı, +z ön. Bütün açılar DERECE.
// Girdi: motion.json (createModel). Çıktı: her segment için 4x4 matris (sütun sıralı, three.js Matrix4.fromArray ile
// doğrudan kullanılır); dinlenme duruşunda (model.rest) hepsi birim matristir.
//
// Koordinatlar (9 serbestlik derecesi, Neutral-Null derecesi):
//   plane, elev, rot      humerus GÖĞSE göre: yükseltme düzlemi (0 = frontal/yana, +90 = öne, -90 = arkaya, 180 = gövdenin
//                         önünden içe), sarkan koldan yükseltme, eksen dönmesi (+ = Innenrotation)
//   girdleElev, girdleProt  omuz kuşağı tek başına (+ = Elevation, + = Protraktion)
//   elbow                 + = Flexion          forearm   + = Pronation (dinlenme yaklaşık -85: tam supinasyon)
//   wristFlex             + = Palmarflexion    wristDev  + = Ulnarabduktion
//
// Kurallar (SPEC ile aynı):
//   - Humerus yönü d = baş merkezinden dirsek ekseni noktasına. elev = d ile -Y arası açı, plane = atan2(d.z, d.x).
//   - Humerusun göğse göre yönelimi = Swing(d) * Twist(rot). Swing: -Y'yi d'ye götüren en kısa dönme; Twist: humerus
//     ekseni çevresinde; rot = 0 dinlenme duruşunun bükümüdür. Segment matrisi = şimdiki yönelim * dinlenme yöneliminin tersi.
//   - Saklanan eksenler işaretlidir: eksen çevresinde POZİTİF (sağ el) dönme = Flexion / Pronation / Palmarflexion /
//     Ulnarabduktion. İşaretleri veri aracı belirler, bu dosya onlara güvenir.
//   - Zincir: göğüs -> klavikula (SC çevresinde) -> skapula (yönelimi ritimden, konumu AC noktasını izler) -> humerus
//     (baş merkezi glenoidi izler) -> ulna (dirsek ekseni) -> radius (radius başı -> ulna başı ekseni) -> carpProx (el
//     bileği açılarının yarısı) ve hand (tamamı); ikisi de radiusun çocuğudur.
//   - Skapulohumeral ritim: biomech.md bölüm 3 "Teaching formulas". Formüller dinlenme duruşuna GÖRE uygulanır
//     (ritim(şimdi) - ritim(dinlenme)), böylece dinlenme duruşu birim matris kalır; okumada mutlak değerler gösterilir.
//
// motion.json'dan okunanlar: segments (sıra = matris indisi), joints (sc, ac, gh, elbow, forearm, wrist; isteğe bağlı
// forearm.dir ve scapula { ai, ts, aa }), rest, isteğe bağlı thoraxFit { c, r } ve tune.
//
// Kullanım:
//   const model = createModel(json);            // model.rest, model.ranges, model.warnings, model.notes
//   const out = createFk(model);                // bir kez ayrılır, her karede yeniden kullanılır
//   fk(model, clampPose(model, pose), out);     // out.m.<segment> ve out.mats: 4x4 matrisler; out.dq: ikili
//                                               // kuaterniyonlar; out.pts: ac, gh, elbow, wrist (tutamaç yerleri)
//   readout(model, pose)                        // Neutral-Null okuması (veri)
//   solveElbow / solveHand(model, pose, ray)    // sürükleme: sonuç .pose yeni duruştur
//   lerpPose / approachPose / ease / pingPong   // yumuşak geçiş
//   compileLine + lineLength, skinPoint         // kas merkez çizgilerinin uzunluğu
//
// Bu dosyanın kendi kararları (SPEC'in sustuğu ya da uygulanamadığı yerler) dosya sonundaki "Kararlar" notundadır.

const D2R = Math.PI / 180, R2D = 180 / Math.PI, EPS = 1e-12;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const isVec = v => (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length >= 3 && Number.isFinite(+v[0]) && Number.isFinite(+v[1]) && Number.isFinite(+v[2]);
const V = v => [+v[0], +v[1], +v[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : null; };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const COORDS = ['plane', 'elev', 'rot', 'girdleElev', 'girdleProt', 'elbow', 'forearm', 'wristFlex', 'wristDev'];
// İç sıra (zincir sırası). Çıktı matrisleri motion.json'daki segments sırasına göre dizilir (model.segs).
export const SEGMENTS = ['thorax', 'clavicle', 'scapula', 'humerus', 'ulna', 'radius', 'carpProx', 'hand'];
const PARENT = { thorax: null, clavicle: 'thorax', scapula: 'clavicle', humerus: 'scapula', ulna: 'humerus', radius: 'ulna', carpProx: 'radius', hand: 'radius' };
const CL = 1, SC = 2, HU = 3, UL = 4, RA = 5, CP = 6, HA = 7;   // SEGMENTS içindeki yerler (0 = göğüs, hep birim)

// (-180, 180] aralığına indirger
export function wrap180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

// ---------- sınırlar ----------
// Yükseltme sınırı düzleme bağlıdır: 180 (Abduktion), 170 (Anteversion), 40 (Retroversion), 40 (gövde önünde Adduktion).
// Düğümler arasında smoothstep: her düğümde eğim sıfır, aşma yok, her yerde sürekli türevli.
export const ELEV_LIMITS = { abd: 180, ante: 170, add: 40, retro: 40 };
export function elevLimit(plane) {
  const p = wrap180(plane), L = ELEV_LIMITS;
  if (p >= 0) return p <= 90 ? L.abd + (L.ante - L.abd) * smooth(p / 90) : L.ante + (L.add - L.ante) * smooth((p - 90) / 90);
  return p >= -90 ? L.retro + (L.abd - L.retro) * smooth((p + 90) / 90) : L.add + (L.retro - L.add) * smooth((p + 180) / 90);
}
// Dönme sınırı [dış (negatif), iç]: kol yandayken 60 dış / 95 iç; 60 derece yükseltmeden sonra 70 / 70.
// 30-60 derece arasında yumuşak geçiş (sıçrama olmasın diye).
export function rotLimits(elev) { const k = smooth((elev - 30) / 30); return [-(60 + 10 * k), 95 - 25 * k]; }
// Sabit aralıklar [alt, üst] (Neutral-Null: 40-0-10, 25-0-25, 10-0-150, 85-0-85, 60-0-60, 25-0-35)
export const RANGES = { girdleElev: [-10, 40], girdleProt: [-25, 25], elbow: [-10, 150], forearm: [-85, 85], wristFlex: [-60, 60], wristDev: [-25, 35] };
// Omuz kuşağı koordinatlarında skapulanın klavikulaya eşlik etme oranları (derece başına derece) ve retraksiyon
// sınırı için orta hat payı (cm). Gerçek kaburga ve omur ağlarıyla ayarlandı (data/work/motion/kin-shrug.mjs);
// motion.json içindeki "tune" alanı aynı adlarla değiştirebilir.
//   carryProt  protraksiyon / retraksiyonda skapula klavikulayla birlikte düşey eksen çevresinde döner (1 = tam)
//   shrugUR    kuşak yükselmesinin derecesi başına ek yukarı dönme (alt açı yana kaymaz, kaburgalara binmez)
//   shrugTilt  kuşak yükselmesinin derecesi başına öne eğilme (kafes yukarıda daralır)
//   retrTilt   retraksiyonun derecesi başına öne eğilme
//   spineClear spina kökünün orta hatta en fazla yaklaşabileceği uzaklık (cm); 0 = retraksiyon sınırı kısılmaz
//   fitW       göğüs kafesi düzeltmesinde [retraksiyon, yükselme, dış dönme, eğilme] paylarının ölçeği (ağırlıklı en küçük norm).
//              Yükselme 0.3: klavikula yükselmesi formüldeki ~12 derecede kalır (Ludewig 2009); düzeltme retraksiyon ve
//              skapula açılarıyla yapılır. Böylece AC fazla yükselmez, trigonum spinae yukarı dönmede aşağı iner
//              (trapezius pars ascendens kısalır).
export const TUNE = { carryProt: 1, shrugUR: 0.35, shrugTilt: 0.2, retrTilt: 0.12, spineClear: 2, fitW: [1, 0.3, 1, 1] };

// ---------- skapulohumeral ritim (mutlak öğretim formülleri, derece) ----------
// w = frontal düzlem ağırlığı: 1 = Abduktion (plane 0), 0 = sagittal düzlem ve ötesi. max(0, cos)^2: sürekli türevli.
export const planeWeight = plane => { const c = Math.cos(wrap180(plane) * D2R); return c > 0 ? c * c : 0; };
export function rhythm(elev, plane, o = {}) {
  const th = elev, s = th / 180, w = planeWeight(plane);
  o.w = w;
  o.UR = th < 30 ? 0.1 * th : 3 + 0.38 * (th - 30);             // skapula yukarı dönme (lateral rotasyon)
  o.PT = th < 90 ? 0.05 * th : 4.5 + 0.28 * (th - 90);          // skapula arkaya eğilme
  o.ER = (8 + 12 * w) * s * s;                                    // skapula dış dönme: 20 s^2 (abd), 8 s^2 (fleks)
  o.CE = 12 * Math.min(th, 120) / 120;                           // klavikula yükselme
  o.CR = 15 * s * (0.6 + 0.4 * w);                               // klavikula retraksiyon (fleksiyonda 0.6 katı)
  o.CP = th < 90 ? 0.05 * th : 4.5 + 0.30 * (th - 90);          // klavikula arkaya eksen dönmesi
  o.AR = w * (th < 70 ? 0 : 0.4 * (th - 70));                    // humerusun eşlenik dış dönmesi (frontal düzlemde)
  o.GH = th - o.UR;                                              // glenohumeral pay
  return o;
}

// ---------- 3x3 dönme matrisleri (satır sıralı 9 sayı) ----------
function rot(out, ax, deg) {   // ax: birim eksen, sağ el kuralı
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = ax[0], y = ax[1], z = ax[2];
  out[0] = t * x * x + c; out[1] = t * x * y - s * z; out[2] = t * x * z + s * y;
  out[3] = t * x * y + s * z; out[4] = t * y * y + c; out[5] = t * y * z - s * x;
  out[6] = t * x * z - s * y; out[7] = t * y * z + s * x; out[8] = t * z * z + c;
  return out;
}
function mul(out, A, B) {      // out = A * B (out, A ya da B ile aynı dizi olabilir)
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
  const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3], b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7], b8 = B[8];
  out[0] = a0 * b0 + a1 * b3 + a2 * b6; out[1] = a0 * b1 + a1 * b4 + a2 * b7; out[2] = a0 * b2 + a1 * b5 + a2 * b8;
  out[3] = a3 * b0 + a4 * b3 + a5 * b6; out[4] = a3 * b1 + a4 * b4 + a5 * b7; out[5] = a3 * b2 + a4 * b5 + a5 * b8;
  out[6] = a6 * b0 + a7 * b3 + a8 * b6; out[7] = a6 * b1 + a7 * b4 + a8 * b7; out[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return out;
}
const transpose = (out, A) => { const a1 = A[1], a2 = A[2], a5 = A[5]; out[0] = A[0]; out[4] = A[4]; out[8] = A[8]; out[1] = A[3]; out[2] = A[6]; out[5] = A[7]; out[3] = a1; out[6] = a2; out[7] = a5; return out; };
const apply = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const Y_UP = [0, 1, 0], Y_DOWN = [0, -1, 0];
// Kuaterniyonlar [x, y, z, w]: yalnız ikili kuaterniyonların İŞARETİNİ belirlemek için (fk içindeki "işaret" notu).
// Yarım açı formülü her açıda süreklidir; matristen çıkarılan kuaterniyon ise 180 derecede işaret değiştirir.
function qAx(out, ax, deg) { const h = 0.5 * deg * D2R, sn = Math.sin(h); out[0] = ax[0] * sn; out[1] = ax[1] * sn; out[2] = ax[2] * sn; out[3] = Math.cos(h); return out; }
function qMul(out, a, b) {     // out = a * b (out, a ya da b ile aynı dizi olabilir)
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by; out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw; out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
const _q1 = new Float64Array(4), _q2 = new Float64Array(4);
// (plane, elev) -> humerus yönü (birim) ve tersi
export function dirOf(plane, elev) { const p = plane * D2R, e = elev * D2R, s = Math.sin(e); return [s * Math.cos(p), -Math.cos(e), s * Math.sin(p)]; }
export function coordsOf(d, planeIfPole = 0) {
  const elev = Math.acos(clamp(-d[1], -1, 1)) * R2D;
  const h = Math.hypot(d[0], d[2]);
  return { plane: h > 1e-9 ? Math.atan2(d[2], d[0]) * R2D : planeIfPole, elev };
}
// Humerusun göğse göre yönelimi: Swing(plane, elev) * Twist(tw). Swing ekseni (-sin p, 0, cos p) yataydır; büküm,
// sarkan kolda -Y (distale bakan humerus ekseni) çevresinde pozitif = Innenrotation (sol kol).
const _s1 = new Float64Array(9), _s2 = new Float64Array(9);
function humOrient(out, plane, elev, tw) {
  const p = plane * D2R;
  rot(_s1, [-Math.sin(p), 0, Math.cos(p)], elev);
  rot(_s2, Y_DOWN, tw);
  return mul(out, _s1, _s2);
}

// ---------- model ----------
// data: motion.json (ya da aynı biçimde bir test verisi). Eksik zorunlu alan hata fırlatır; küçük tutarsızlıklar
// model.warnings dizisine yazılır (konsola yazılmaz).
// opts.correct === false: skapulanın göğüs kafesi düzeltmesi kapatılır (karşılaştırma ve test için).
export function createModel(data, opts) {
  if (!data || typeof data !== 'object') throw new Error('motion-kin: veri yok');
  const warnings = [], notes = [];
  const Jd = data.joints || {};
  const need = (o, k, name) => { const v = o && o[k]; if (!isVec(v)) throw new Error('motion-kin: eksik ya da bozuk alan: ' + name); return V(v); };
  const axis = (o, k, name) => { const u = unit(need(o, k, name)); if (!u) throw new Error('motion-kin: sıfır uzunlukta eksen: ' + name); return u; };
  const J = {
    sc: need(Jd.sc, 'p', 'joints.sc.p'), ac: need(Jd.ac, 'p', 'joints.ac.p'), gh: need(Jd.gh, 'p', 'joints.gh.p'),
    ghR: num(Jd.gh && Jd.gh.r, 0),
    elbow: need(Jd.elbow, 'p', 'joints.elbow.p'), elbowAxis: axis(Jd.elbow, 'axis', 'joints.elbow.axis'),
    radHead: need(Jd.forearm, 'p', 'joints.forearm.p'), ulnHead: need(Jd.forearm, 'q', 'joints.forearm.q'),
    wrist: need(Jd.wrist, 'p', 'joints.wrist.p'), flexAxis: axis(Jd.wrist, 'flexAxis', 'joints.wrist.flexAxis'), devAxis: axis(Jd.wrist, 'devAxis', 'joints.wrist.devAxis')
  };
  // ön kol ekseni: dir verilmişse o (pozitif = Pronation); yoksa radius başı -> ulna başı (sol kolda pronasyon yönü)
  if (isVec(Jd.forearm.dir)) J.forearmDir = axis(Jd.forearm, 'dir', 'joints.forearm.dir');
  else { J.forearmDir = unit(sub(J.ulnHead, J.radHead)); notes.push('joints.forearm.dir yok: radius başı -> ulna başı yönü kullanıldı'); }
  if (!J.forearmDir) throw new Error('motion-kin: ön kol ekseni sıfır uzunlukta');

  // segment sırası: verideki sıra (.bin indisleri buna göredir); yoksa iç sıra
  const segs = Array.isArray(data.segments) && data.segments.length ? data.segments.map(s => String(s.key)) : SEGMENTS.slice();
  const index = {}; segs.forEach((k, i) => { index[k] = i; });
  for (const k of SEGMENTS) if (!(k in index)) throw new Error('motion-kin: segments içinde eksik: ' + k);
  // tanınmayan segment en yakın tanınan atasıyla birlikte hareket eder
  const src = segs.map((k, i) => {
    let key = k, guard = 0;
    while (!(key in PARENT) && guard++ < 20) { const s = data.segments[index[key]]; key = s && s.parent in index ? s.parent : 'thorax'; }
    if (key !== k && !isVec(data.segments[i].at)) notes.push('tanınmayan segment ' + k + ' -> ' + key + ' ile birlikte');
    return SEGMENTS.indexOf(key in PARENT ? key : 'thorax');
  });

  // İzleyen segment (motion.json: { key, parent, at: [x,y,z] }): dönmez, yalnız ötelenir; ötelemesi, ebeveyn segmentin
  // dinlenmedeki "at" noktasının yer değiştirmesidir. Gövdeden kola uzanan geniş kaslar (koltuk altı kıvrımı) gövde ile
  // bu segment arasında karıştırılır: iki öteleme arasındaki ikili kuaterniyon karışımı doğrusaldır, kas origo ile
  // insersiyo arasında düzgün uzar (ani geçişteki 20-30 cm'lik gergin üçgenler ve yarım açıyla dolanan kanat olmaz).
  const followers = [];
  if (Array.isArray(data.segments)) data.segments.forEach((sg, i) => { if (sg && isVec(sg.at) && !(segs[i] in PARENT)) followers.push({ i, at: V(sg.at), src: src[i] }); });

  // dinlenme duruşu
  const armVec = sub(J.elbow, J.gh), armLen = len(armVec), dGeo = unit(armVec);
  if (!dGeo) throw new Error('motion-kin: baş merkezi ile dirsek noktası aynı');
  const geo = coordsOf(dGeo);
  const rd = data.rest || {}, rest = {};
  for (const k of COORDS) rest[k] = num(rd[k], k === 'plane' ? geo.plane : k === 'elev' ? geo.elev : 0);
  rest.plane = wrap180(rest.plane);
  for (const k of ['elbow', 'forearm']) if (typeof rd[k] !== 'number') warnings.push('rest.' + k + ' yok: 0 alındı');
  const off = Math.acos(clamp(dot(dirOf(rest.plane, rest.elev), dGeo), -1, 1)) * R2D;
  if (off > 0.05) warnings.push('rest.plane / rest.elev, baş merkezi -> dirsek noktası yönünden ' + off.toFixed(2) + ' derece sapıyor');

  // aralıklar: dinlenme duruşu her zaman sınırların içinde kalır
  const ranges = {};
  for (const k of Object.keys(RANGES)) {
    const [a, b] = RANGES[k]; ranges[k] = [Math.min(a, rest[k]), Math.max(b, rest[k])];
    if (rest[k] < a || rest[k] > b) notes.push('rest.' + k + ' = ' + rest[k].toFixed(1) + ' aralığın dışında: aralık genişletildi');
  }
  if (rest.elev > elevLimit(rest.plane) + 1e-9 || rest.elev < 0) warnings.push('rest.elev yükseltme sınırının dışında');
  { const [a, b] = rotLimits(rest.elev); if (rest.rot < a || rest.rot > b) warnings.push('rest.rot dönme sınırının dışında'); }

  // klavikula eksenleri: c0 = SC -> AC; e0 = yatay, klavikulaya dik (çevresinde pozitif dönme dış ucu kaldırır)
  const c0 = unit(sub(J.ac, J.sc));
  if (!c0) throw new Error('motion-kin: SC ile AC aynı nokta');
  const e0 = unit(cross(c0, Y_UP)) || [0, 0, 1];
  // skapula eksenleri: n0 = skapula düzleminin öne bakan normali (çevresinde pozitif dönme = yukarı dönme, sol),
  // m0 = spina boyunca mediyalden laterale (çevresinde NEGATİF dönme = arkaya eğilme)
  const Sd = Jd.scapula || (data.thoraxFit && data.thoraxFit.scapula) || null;
  let n0, m0, scapPts = null;
  if (Sd && isVec(Sd.ai) && isVec(Sd.ts) && isVec(Sd.aa)) {
    const ai = V(Sd.ai), ts = V(Sd.ts), aa = V(Sd.aa);
    m0 = unit(sub(aa, ts)); n0 = m0 && unit(cross(sub(aa, ts), sub(ai, ts)));
    if (n0 && n0[2] < 0) n0 = [-n0[0], -n0[1], -n0[2]];
    scapPts = { ai, ts, aa };
  }
  if (!n0 || !m0) {
    const a = 30 * D2R; n0 = [-Math.sin(a), 0, Math.cos(a)]; m0 = [Math.cos(a), 0, Math.sin(a)];
    notes.push('skapula işaret noktaları (ai, ts, aa) yok: genel skapula düzlemi (frontal düzlemin 30 derece önü) kullanıldı');
  }

  // göğüs kafesi elipsoidi + skapula noktaları (ai, ts): skapulayı kaburgaların üstünde tutan düzeltme için
  let fit = null;
  const Fd = data.thoraxFit, use = !(opts && opts.correct === false);
  if (Fd && use) {
    const c = [Fd.c, Fd.center, Fd.centre].find(isVec), rr = [Fd.r, Fd.radii].find(isVec);
    if (!c || !rr || !(rr[0] > 0 && rr[1] > 0 && rr[2] > 0)) notes.push('thoraxFit içinde c / r yok ya da bozuk: skapula düzeltmesi kapalı');
    else if (!scapPts) notes.push('skapula noktaları (ai, ts) yok: skapula düzeltmesi kapalı');
    else {
      fit = { c: V(c), r: V(rr), v: [sub(scapPts.ai, J.ac), sub(scapPts.ts, J.ac)], d0: [0, 0], cl: sub(J.ac, J.sc) };
      // dinlenme uzaklıkları: fk ile aynı hesap yolu (AC + (nokta - AC)), böylece dinlenmede hata tam sıfırdır
      for (let i = 0; i < 2; i++) fit.d0[i] = ellDist(fit, J.ac[0] + fit.v[i][0], J.ac[1] + fit.v[i][1], J.ac[2] + fit.v[i][2], null);
      if (!(fit.d0[0] > 0 && fit.d0[1] > 0) || fit.d0[0] > 8 || fit.d0[1] > 8) {
        warnings.push('thoraxFit skapula noktalarıyla uyuşmuyor (dinlenme uzaklıkları ' + fit.d0.map(v => v.toFixed(2)).join(', ') + ' cm): skapula düzeltmesi kapalı');
        fit = null;
      }
    }
  } else if (!Fd) notes.push('thoraxFit yok: skapula düzeltmesi kapalı (yalnız ritim formülleri)');

  const tune = { ...TUNE };
  if (data.tune && typeof data.tune === 'object') for (const k of Object.keys(TUNE)) if (typeof data.tune[k] === 'number') tune[k] = data.tune[k];
  const model = {
    v: num(data.v, 0), side: data.side || 'l', segs, index, src, followers, J, rest, ranges, armLen,
    c0, e0, n0, m0, scapPts, warnings, notes, tune,
    A0: rhythm(rest.elev, rest.plane, {}),
    OrestT: new Float64Array(9),
    fit
  };
  humOrient(model.OrestT, rest.plane, rest.elev, rest.rot - model.A0.AR);
  transpose(model.OrestT, model.OrestT);

  // Retraksiyon sınırı: bu modelde klavikula dinlenmede zaten arkaya bakar; 25 derece retraksiyonda skapulanın
  // mediyal kenarı omurganın üstüne çıkar. Spina kökü (ts) orta hatta spineClear cm'den fazla yaklaşmayacak biçimde
  // sınır kısılır (ts biliniyorsa; orta hat x = 0).
  if (scapPts && tune.spineClear > 0 && scapPts.ts[0] > tune.spineClear) {
    const o = createFk(model), q = { ...rest }, p = [0, 0, 0];
    const tsX = prot => { q.girdleProt = prot; fk(model, q, o); return transformPoint(o.m.scapula, scapPts.ts, p)[0]; };
    let lo = ranges.girdleProt[0], hi = Math.min(0, rest.girdleProt);
    if (tsX(lo) < tune.spineClear) {
      for (let i = 0; i < 30; i++) { const mid = 0.5 * (lo + hi); if (tsX(mid) < tune.spineClear) lo = mid; else hi = mid; }
      const lim = Math.min(Math.ceil(hi), rest.girdleProt);
      notes.push('Retraktion sınırı ' + (-ranges.girdleProt[0]) + ' yerine ' + (-lim) + ' derece: daha fazlasında skapulanın mediyal kenarı orta hatta ' + tune.spineClear + ' cm\'den fazla yaklaşıyor');
      ranges.girdleProt[0] = lim;
    }
  }
  return model;
}

// Eksenlere hizalı elipsoide yaklaşık işaretli uzaklık (birinci derece; dışarısı +). n verilirse o noktadaki
// düzey yüzeyinin birim normali yazılır.
function ellDist(F, x, y, z, n) {
  const r = F.r, ux = (x - F.c[0]) / r[0], uy = (y - F.c[1]) / r[1], uz = (z - F.c[2]) / r[2];
  const f = Math.hypot(ux, uy, uz);
  if (f < 1e-9) { if (n) { n[0] = 1; n[1] = 0; n[2] = 0; } return -Math.min(r[0], r[1], r[2]); }
  const qx = ux / r[0], qy = uy / r[1], qz = uz / r[2], q = Math.hypot(qx, qy, qz);
  if (n) { n[0] = qx / q; n[1] = qy / q; n[2] = qz / q; }
  return (f - 1) * f / q;
}
// Bir noktanın göğüs kafesi elipsoidine uzaklığı (denetim betikleri için); thoraxFit yoksa NaN
export const thoraxDistance = (model, p) => (model.fit ? ellDist(model.fit, p[0], p[1], p[2], null) : NaN);

export const restPose = model => ({ ...model.rest });
// Neutral-Null sıfır duruşu: bütün açılar 0 (kol yanda sarkar, dirsek düz, ön kol orta konumda)
export const neutralPose = () => { const q = {}; for (const k of COORDS) q[k] = 0; return q; };

// Omuz kuşağının sınırları kol yükseltmesine bağlıdır: ritim klavikulayı zaten kaldırır ve geriye alır. Toplam, kuşağın
// tek başına yapabildiğini aşmasın diye Elevation ve Retraktion payı ritmin kullandığı kadar kısalır (kol tam
// yukarıdayken 40 derece omuz silkme, omzu boynun içine sokar). Dinlenme duruşunda sınırlar değişmez.
const _gl = {};
function girdleLimits(model, plane, elev, out) {
  const R = model.ranges, r = model.rest, A = rhythm(elev, plane, _gl), A0 = model.A0;
  const ce = Math.max(0, A.CE - A0.CE), cr = Math.max(0, A.CR - A0.CR);
  out.girdleElev = [R.girdleElev[0], Math.max(r.girdleElev, R.girdleElev[1] - ce)];
  out.girdleProt = [Math.min(r.girdleProt, R.girdleProt[0] + cr), R.girdleProt[1]];
  return out;
}
// Şimdiki duruşta her koordinatın [alt, üst] sınırı (sürgüler için)
export function limits(model, pose) {
  const q = pose || model.rest, r = model.rest, R = model.ranges;
  const plane = wrap180(num(q.plane, r.plane)), elev = clamp(num(q.elev, r.elev), 0, elevLimit(plane));
  const L = {
    plane: [-180, 180], elev: [0, elevLimit(plane)], rot: rotLimits(elev),
    elbow: R.elbow.slice(), forearm: R.forearm.slice(), wristFlex: R.wristFlex.slice(), wristDev: R.wristDev.slice()
  };
  return girdleLimits(model, plane, elev, L);
}
// Duruşu sınırlara oturtur; eksik koordinatlar dinlenme duruşundan alınır. Yükseltme, düzlemi koruyarak kısılır
// (sürgü davranışı); sürükleme için en yakın izinli yön solveElbow içinde ayrıca aranır.
const _cl = {};
export function clampPose(model, pose, out = {}) {
  const r = model.rest, R = model.ranges, q = pose || r;
  let plane = num(q.plane, r.plane), elev = num(q.elev, r.elev);
  if (elev < 0) { elev = -elev; plane += 180; }
  plane = wrap180(plane);
  elev = Math.min(elev, elevLimit(plane));
  const rl = rotLimits(elev), g = girdleLimits(model, plane, elev, _cl);
  const vals = [plane, elev, clamp(num(q.rot, r.rot), rl[0], rl[1]),
    clamp(num(q.girdleElev, r.girdleElev), g.girdleElev[0], g.girdleElev[1]), clamp(num(q.girdleProt, r.girdleProt), g.girdleProt[0], g.girdleProt[1])];
  for (let i = 5; i < COORDS.length; i++) { const k = COORDS[i]; vals.push(clamp(num(q[k], r[k]), R[k][0], R[k][1])); }
  for (let i = 0; i < COORDS.length; i++) out[COORDS[i]] = vals[i];
  return out;
}
// Bir hareketin "set" alanını taban duruşa uygular ve sınırlara oturtur
export const applySet = (model, base, set, out = {}) => clampPose(model, { ...(base || model.rest), ...(set || {}) }, out);

// ---------- ileri kinematik ----------
export function createFk(model) {
  const n = model.segs.length, mats = new Float64Array(16 * n), m = {};
  for (let i = 0; i < n; i++) { m[model.segs[i]] = mats.subarray(16 * i, 16 * i + 16); mats[16 * i] = mats[16 * i + 5] = mats[16 * i + 10] = mats[16 * i + 15] = 1; }
  const seg = SEGMENTS.map(() => ({ R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: new Float64Array(3), q: new Float64Array([0, 0, 0, 1]) }));
  // humerusun dinlenme yöneliminin tersi (kuaterniyon): işaret zinciri dinlenmede tam birimden başlasın diye
  const r0 = model.rest, p0 = r0.plane * D2R, qRestInv = new Float64Array(4);
  qMul(qRestInv, qAx(_q1, [-Math.sin(p0), 0, Math.cos(p0)], r0.elev), qAx(_q2, Y_DOWN, r0.rot - model.A0.AR));
  qRestInv[0] = -qRestInv[0]; qRestInv[1] = -qRestInv[1]; qRestInv[2] = -qRestInv[2];
  return {
    qRestInv,
    model, mats, m, seg, dq: new Float64Array(8 * n), pose: {}, rhythm: {},
    pts: { ac: [0, 0, 0], gh: [0, 0, 0], elbow: [0, 0, 0], wrist: [0, 0, 0] }, elbowAxis: [0, 0, 0],
    // formüllere eklenenler (derece): [0..3] göğüs kafesi düzeltmesi = ek klavikula retraksiyonu, ek klavikula
    // yükselmesi, ek skapula dış dönmesi, ek skapula arkaya eğilmesi; [4..5] omuz kuşağı eşliği = skapulanın ek
    // yukarı dönmesi, ek öne eğilmesi
    corr: [0, 0, 0, 0, 0, 0]
  };
}
const _a = new Float64Array(9), _b = new Float64Array(9), _c = new Float64Array(9);
// çocuk segment: yerel dönme Rl, dinlenme koordinatındaki pv noktası çevresinde; sonra ebeveynin dönüşümü
function child(dst, par, Rl, pv) {
  const lp = apply(Rl, pv), lx = pv[0] - lp[0], ly = pv[1] - lp[1], lz = pv[2] - lp[2], P = par.R;
  dst.t[0] = P[0] * lx + P[1] * ly + P[2] * lz + par.t[0];
  dst.t[1] = P[3] * lx + P[4] * ly + P[5] * lz + par.t[1];
  dst.t[2] = P[6] * lx + P[7] * ly + P[8] * lz + par.t[2];
  mul(dst.R, P, Rl);
}
const segPoint = (s, p, out) => { const R = s.R, x = p[0], y = p[1], z = p[2]; out[0] = R[0] * x + R[1] * y + R[2] * z + s.t[0]; out[1] = R[3] * x + R[4] * y + R[5] * z + s.t[1]; out[2] = R[6] * x + R[7] * y + R[8] * z + s.t[2]; return out; };
// dönme matrisi + öteleme -> birim ikili kuaterniyon [rx, ry, rz, rw, dx, dy, dz, dw]. İşaret: ref verilmişse onunla
// aynı yarıkürede (ref = zincir boyunca çarpılmış kuaterniyon), verilmemişse rw >= 0.
function toDualQuat(R, t, out, o, ref) {
  const m00 = R[0], m01 = R[1], m02 = R[2], m10 = R[3], m11 = R[4], m12 = R[5], m20 = R[6], m21 = R[7], m22 = R[8];
  const tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w) * ((ref ? x * ref[0] + y * ref[1] + z * ref[2] + w * ref[3] : w) < 0 ? -1 : 1); x /= l; y /= l; z /= l; w /= l;
  const tx = t[0], ty = t[1], tz = t[2];
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
  out[o + 4] = 0.5 * (tx * w + ty * z - tz * y); out[o + 5] = 0.5 * (-tx * z + ty * w + tz * x);
  out[o + 6] = 0.5 * (tx * y - ty * x + tz * w); out[o + 7] = 0.5 * (-tx * x - ty * y - tz * z);
}

const _fp = [0, 0, 0];
// pose: dokuz koordinat (eksik olan dinlenme değerini alır). Sınırlara oturtmaz: önce clampPose çağırın.
// out: createFk(model) ile ayrılmış çıktı (verilmezse yenisi ayrılır; kare başına yeniden kullanın).
export function fk(model, pose, out) {
  const o = out || createFk(model), J = model.J, r0 = model.rest, S = o.seg, q = o.pose;
  for (const k of COORDS) q[k] = num(pose && pose[k], r0[k]);
  const A = rhythm(q.elev, q.plane, o.rhythm), A0 = model.A0;
  const dElev = q.girdleElev - r0.girdleElev, dProt = q.girdleProt - r0.girdleProt;

  // ritim açıları (dinlenmeye göre fark) + göğüs kafesi düzeltmesi (1. aşama: yalnız yükseltmeye bağlı)
  let cr = A.CR - A0.CR, ce = A.CE - A0.CE, er = A.ER - A0.ER, pt = A.PT - A0.PT;
  const ur = A.UR - A0.UR, cp = A.CP - A0.CP, X = o.corr;
  X[0] = X[1] = X[2] = X[3] = 0;
  if (model.fit) { solveRhythmFit(model, cr, ce, er, ur, pt, X); cr += X[0]; ce += X[1]; er += X[2]; pt += X[3]; }

  // klavikula: Y (retraksiyon) -> e0 (yükselme) -> c0 (eksen dönmesi), SC çevresinde
  rot(_a, Y_UP, cr - dProt);
  rot(_b, model.e0, ce + dElev);
  mul(_a, _a, _b);
  rot(_b, model.c0, -cp);
  mul(S[CL].R, _a, _b);
  qMul(S[CL].q, qMul(_q1, qAx(_q1, Y_UP, cr - dProt), qAx(_q2, model.e0, ce + dElev)), qAx(_q2, model.c0, -cp));
  { const p = apply(S[CL].R, J.sc); S[CL].t[0] = J.sc[0] - p[0]; S[CL].t[1] = J.sc[1] - p[1]; S[CL].t[2] = J.sc[2] - p[2]; }
  segPoint(S[CL], J.ac, o.pts.ac);

  // skapula: yönelim ritimden (Y dış dönme -> n0 yukarı dönme -> m0 eğilme), konum AC noktasını izler.
  // Omuz kuşağı koordinatlarında klavikulaya eşlik eder (TUNE): protraksiyonda onunla birlikte düşey eksen
  // çevresinde döner; yükselmede biraz yukarı döner ve öne eğilir, retraksiyonda biraz öne eğilir.
  const tn = model.tune, fwd = tn.shrugTilt * (dElev > 0 ? dElev : 0) + tn.retrTilt * (dProt < 0 ? -dProt : 0);
  X[4] = tn.shrugUR * dElev; X[5] = fwd;
  rot(_a, Y_UP, er - tn.carryProt * dProt);
  rot(_b, model.n0, ur + X[4]);
  mul(_a, _a, _b);
  rot(_b, model.m0, fwd - pt);
  mul(S[SC].R, _a, _b);
  qMul(S[SC].q, qMul(_q1, qAx(_q1, Y_UP, er - tn.carryProt * dProt), qAx(_q2, model.n0, ur + X[4])), qAx(_q2, model.m0, fwd - pt));
  { const p = apply(S[SC].R, J.ac); S[SC].t[0] = o.pts.ac[0] - p[0]; S[SC].t[1] = o.pts.ac[1] - p[1]; S[SC].t[2] = o.pts.ac[2] - p[2]; }
  segPoint(S[SC], J.gh, o.pts.gh);

  // humerus: göğse göre yönelim = Swing * Twist; baş merkezi glenoidi izler
  humOrient(_a, q.plane, q.elev, q.rot - A.AR);
  mul(S[HU].R, _a, model.OrestT);
  { const pr = q.plane * D2R; qMul(S[HU].q, qMul(_q1, qAx(_q1, [-Math.sin(pr), 0, Math.cos(pr)], q.elev), qAx(_q2, Y_DOWN, q.rot - A.AR)), o.qRestInv); }
  { const p = apply(S[HU].R, J.gh); S[HU].t[0] = o.pts.gh[0] - p[0]; S[HU].t[1] = o.pts.gh[1] - p[1]; S[HU].t[2] = o.pts.gh[2] - p[2]; }
  segPoint(S[HU], J.elbow, o.pts.elbow);
  { const a = apply(S[HU].R, J.elbowAxis); o.elbowAxis[0] = a[0]; o.elbowAxis[1] = a[1]; o.elbowAxis[2] = a[2]; }

  // ulna: dirsek ekseni; radius: ön kol ekseni; el bileği: proksimal sıra açıların yarısını, el tamamını alır
  child(S[UL], S[HU], rot(_a, J.elbowAxis, q.elbow - r0.elbow), J.elbow);
  child(S[RA], S[UL], rot(_a, J.forearmDir, q.forearm - r0.forearm), J.radHead);
  const wf = q.wristFlex - r0.wristFlex, wd = q.wristDev - r0.wristDev;
  child(S[CP], S[RA], mul(_c, rot(_a, J.flexAxis, 0.5 * wf), rot(_b, J.devAxis, 0.5 * wd)), J.wrist);
  child(S[HA], S[RA], mul(_c, rot(_a, J.flexAxis, wf), rot(_b, J.devAxis, wd)), J.wrist);
  segPoint(S[RA], J.wrist, o.pts.wrist);
  // İşaret: her segmentin kuaterniyonu ebeveyninkiyle yerel dönmenin yarım açılı kuaterniyonunun çarpımıdır. Böylece
  // ikili kuaterniyonlar duruşun SÜREKLİ işlevidir (matristen rw >= 0 seçmek bağıl dönme 180 dereceyi geçince işaret
  // sıçratır; skapula + humerus çiftinde bu, izinli aralığın içinde oluyordu: motion-validate.mjs bölüm 0).
  qMul(S[UL].q, S[HU].q, qAx(_q1, J.elbowAxis, q.elbow - r0.elbow));
  qMul(S[RA].q, S[UL].q, qAx(_q1, J.forearmDir, q.forearm - r0.forearm));
  qMul(S[CP].q, S[RA].q, qMul(_q1, qAx(_q1, J.flexAxis, 0.5 * wf), qAx(_q2, J.devAxis, 0.5 * wd)));
  qMul(S[HA].q, S[RA].q, qMul(_q1, qAx(_q1, J.flexAxis, wf), qAx(_q2, J.devAxis, wd)));

  // matrisler (sütun sıralı) ve ikili kuaterniyonlar, verideki segment sırasıyla
  const M = o.mats, src = model.src;
  for (let i = 0; i < src.length; i++) {
    const s = S[src[i]], R = s.R, k = 16 * i;
    M[k] = R[0]; M[k + 1] = R[3]; M[k + 2] = R[6]; M[k + 3] = 0;
    M[k + 4] = R[1]; M[k + 5] = R[4]; M[k + 6] = R[7]; M[k + 7] = 0;
    M[k + 8] = R[2]; M[k + 9] = R[5]; M[k + 10] = R[8]; M[k + 11] = 0;
    M[k + 12] = s.t[0]; M[k + 13] = s.t[1]; M[k + 14] = s.t[2]; M[k + 15] = 1;
    toDualQuat(R, s.t, o.dq, 8 * i, s.q);
  }
  // izleyen segmentler: birim dönme + ebeveynin "at" noktasının ötelemesi
  for (const f of model.followers) {
    const p = segPoint(S[f.src], f.at, _fp), k = 16 * f.i, d = 8 * f.i, tx = p[0] - f.at[0], ty = p[1] - f.at[1], tz = p[2] - f.at[2];
    M[k] = M[k + 5] = M[k + 10] = M[k + 15] = 1; M[k + 1] = M[k + 2] = M[k + 3] = M[k + 4] = M[k + 6] = M[k + 7] = M[k + 8] = M[k + 9] = M[k + 11] = 0;
    M[k + 12] = tx; M[k + 13] = ty; M[k + 14] = tz;
    const D = o.dq; D[d] = D[d + 1] = D[d + 2] = 0; D[d + 3] = 1; D[d + 4] = 0.5 * tx; D[d + 5] = 0.5 * ty; D[d + 6] = 0.5 * tz; D[d + 7] = 0;
  }
  return o;
}

// ---------- skapulayı göğüs kafesinde tutan düzeltme ----------
// Neden: ritim formülleri AC çevresinde olduğu gibi uygulanınca alt açı (ai) tam yükseltmede kaburgalardan 7 cm kadar
// uzaklaşır (ölçüm: data/work/motion/kin-scapcheck.mjs). Düzeltme yalnız kol yükseltmesine (plane, elev) bağlıdır ve
// ai ile ts noktalarını (alt açı, spina kökü) göğüs kafesi elipsoidine DİNLENMEDEKİ uzaklıklarında tutar:
// yukarı dönme (UR) formüldeki değerinde kalır (panelde gösterilen pay budur); klavikulanın retraksiyon ve yükselmesi
// ile skapulanın dış dönme ve eğilmesi formülden en az sapacak biçimde çözülür (dört bilinmeyen, iki koşul, en küçük
// norm). x = [ek retraksiyon, ek yükselme, ek dış dönme, ek eğilme] (derece). Dinlenme duruşunda x tam sıfırdır.
// Omuz kuşağı koordinatları (girdleElev, girdleProt) bu çözüme girmez: kullanıcının verdiği klavikula açısı aynen
// uygulanır, skapula TUNE oranlarıyla eşlik eder (elipsoidin üst bölümü gerçek kafese uymadığı için orada temas
// çözümü kötü sonuç verdi; oranlar gerçek kaburga ağlarıyla ayarlandı: data/work/motion/kin-shrug.mjs).
const _n1 = [0, 0, 0], _n2 = [0, 0, 0], _rn = new Float64Array(9), _rm = new Float64Array(9), _ry = new Float64Array(9), _re = new Float64Array(9);
function solveRhythmFit(model, cr, ce, er, ur, pt, x) {
  const F = model.fit, sc = model.J.sc, v0 = F.v[0], v1 = F.v[1], m0 = model.m0;
  rot(_rn, model.n0, ur);
  let x0 = 0, x1 = 0, x2 = 0, x3 = 0;
  const FW = (model.tune && model.tune.fitW) || TUNE.fitW, W0 = FW[0], W1 = FW[1], W2 = FW[2], W3 = FW[3];
  for (let it = 0; it < 12; it++) {
    // klavikulanın dış ucu: AC' = SC + Ry(cr) Re0(ce) (AC - SC); a1 = taşınmış yükselme ekseni
    rot(_re, model.e0, ce + x1); rot(_ry, Y_UP, cr + x0);
    const u = apply(_ry, apply(_re, F.cl)), a1 = apply(_ry, model.e0);
    const ax = sc[0] + u[0], ay = sc[1] + u[1], az = sc[2] + u[2];
    // skapula: R = Ry(er) Rn(ur) Rm(-pt); ms = taşınmış spina ekseni
    rot(_ry, Y_UP, er + x2); mul(_ry, _ry, _rn);
    const ms = apply(_ry, m0);
    rot(_rm, m0, -(pt + x3)); mul(_ry, _ry, _rm);
    const w0 = apply(_ry, v0), w1 = apply(_ry, v1);
    const e0 = ellDist(F, ax + w0[0], ay + w0[1], az + w0[2], _n1) - F.d0[0];
    const e1 = ellDist(F, ax + w1[0], ay + w1[1], az + w1[2], _n2) - F.d0[1];
    // Jakobiyen satırları (derece başına cm)
    const yu = cross(Y_UP, u), au = cross(a1, u);
    // ağırlıklı en küçük norm: sütunlar W ile ölçeklenir, çözüm y = x / W üzerinde yapılır
    const j00 = W0 * dot(_n1, yu) * D2R, j01 = W1 * dot(_n1, au) * D2R, j02 = W2 * dot(_n1, cross(Y_UP, w0)) * D2R, j03 = -W3 * dot(_n1, cross(ms, w0)) * D2R;
    const j10 = W0 * dot(_n2, yu) * D2R, j11 = W1 * dot(_n2, au) * D2R, j12 = W2 * dot(_n2, cross(Y_UP, w1)) * D2R, j13 = -W3 * dot(_n2, cross(ms, w1)) * D2R;
    x0 /= W0; x1 /= W1; x2 /= W2; x3 /= W3;
    // en küçük norm: x_yeni = J^T (J J^T)^-1 (J x - e)
    const b0 = j00 * x0 + j01 * x1 + j02 * x2 + j03 * x3 - e0, b1 = j10 * x0 + j11 * x1 + j12 * x2 + j13 * x3 - e1;
    const a11 = j00 * j00 + j01 * j01 + j02 * j02 + j03 * j03, a12 = j00 * j10 + j01 * j11 + j02 * j12 + j03 * j13, a22 = j10 * j10 + j11 * j11 + j12 * j12 + j13 * j13;
    const det = a11 * a22 - a12 * a12;
    if (!(det > 1e-14)) { x0 *= W0; x1 *= W1; x2 *= W2; x3 *= W3; break; }
    const l0 = (a22 * b0 - a12 * b1) / det, l1 = (a11 * b1 - a12 * b0) / det;
    let d0 = j00 * l0 + j10 * l1 - x0, d1 = j01 * l0 + j11 * l1 - x1, d2 = j02 * l0 + j12 * l1 - x2, d3 = j03 * l0 + j13 * l1 - x3;
    const st = Math.hypot(d0, d1, d2, d3);
    if (!(st < 1e9)) { x0 *= W0; x1 *= W1; x2 *= W2; x3 *= W3; break; }                                  // NaN ya da taşma: son iyi değerde kal
    if (st > 20) { const k = 20 / st; d0 *= k; d1 *= k; d2 *= k; d3 *= k; }
    x0 = (x0 + d0) * W0; x1 = (x1 + d1) * W1; x2 = (x2 + d2) * W2; x3 = (x3 + d3) * W3;
    if (st < 1e-9) break;
  }
  x[0] = x0; x[1] = x1; x[2] = x2; x[3] = x3;
}

// 4x4 (sütun sıralı) matrisle nokta dönüştürme
export function transformPoint(m, p, out = [0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; out[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}
// fk çıktısından gerçekleşen kuşak açıları (derece; formül + göğüs kafesi düzeltmesi + kuşak koordinatları).
// Ritim formüllerinin kendisi o.rhythm içindedir; ikisinin farkı o.corr dizisidir.
export function realized(o) {
  const A = o.rhythm, X = o.corr, q = o.pose, r = o.model.rest, tn = o.model.tune, dE = q.girdleElev - r.girdleElev, dP = q.girdleProt - r.girdleProt;
  return {
    clavicle: { elev: A.CE + X[1] + dE, retr: A.CR + X[0] - dP, post: A.CP },
    scapula: { up: A.UR + X[4], tilt: A.PT + X[3] - X[5], ext: A.ER + X[2] - tn.carryProt * dP }
  };
}

// ---------- Neutral-Null okuması (veri olarak; yazıya dökmek arayüzün işi) ----------
// Almanca terimler (sınav dili). key alanları hareket anahtarı olarak da kullanılabilir.
export const TERMS = {
  neutral: 'Neutralstellung', abd: 'Abduktion', scap: 'Elevation in der Skapulaebene', ante: 'Anteversion',
  anteAdd: 'Anteversion mit Adduktion', add: 'Adduktion', retroAdd: 'Retroversion mit Adduktion', retro: 'Retroversion',
  abdRetro: 'Abduktion mit Retroversion', ir: 'Innenrotation', ar: 'Außenrotation',
  elev: 'Elevation', depr: 'Depression', prot: 'Protraktion', retr: 'Retraktion', flex: 'Flexion', ext: 'Extension',
  pron: 'Pronation', sup: 'Supination', palmar: 'Palmarflexion', dorsal: 'Dorsalextension', ulnar: 'Ulnarabduktion', radial: 'Radialabduktion'
};
const SECTORS = ['add', 'retroAdd', 'retro', 'abdRetro', 'abd', 'scap', 'ante', 'anteAdd'];   // düzlem -180, -135, ..., 135
const CARDINAL = ['add', 'retro', 'abd', 'ante'];                                           // düzlem -180, -90, 0, 90
// Omuz duruşunun klinik adı: 45 derecelik sekiz dilim; 2 derecenin altındaki yükseltme "Neutralstellung".
export function shoulderName(plane, elev) {
  if (elev < 2) return 'neutral';
  return SECTORS[Math.round((wrap180(plane) + 180) / 45) % 8];
}
const nn = (v, pos, neg) => { const k = v >= 0 ? pos : neg; return { value: v, abs: Math.abs(v), key: k, de: TERMS[k] }; };
// pose -> okunacak değerler. shoulder.gh + shoulder.scap = shoulder.elev (glenohumeral pay = yükseltme - skapula payı).
// scap, ÇİZİLEN skapula yukarı dönmesidir: ritim formülü + omuz kuşağı koordinatının eşlik payı (tune.shrugUR *
// girdleElev); kuşak 0 iken formülün kendisidir. rhythm alanı da çizilen açılardır (formül + göğüs kafesi düzeltmesi +
// kuşak; realized() ile aynı); formülün kendisi rhythmFormula alanındadır.
// frontal / sagittal: yükseltmenin iki anatomik düzleme dağılımı (+ Abduktion / - Adduktion, + Anteversion / - Retroversion).
export function readout(model, pose) {
  const r = model.rest, v = k => num(pose && pose[k], r[k]);
  const plane = wrap180(v('plane')), elev = v('elev'), rotv = v('rot'), A = rhythm(elev, plane, {});
  const key = shoulderName(plane, elev), p = plane * D2R;
  const rz = realized(fk(model, pose, scratchFk(model))), scap = rz.scapula.up;
  return {
    shoulder: {
      key, de: TERMS[key], cardinal: elev < 2 ? 'neutral' : CARDINAL[Math.round((plane + 180) / 90) % 4],
      plane, elev, frontal: elev * Math.cos(p), sagittal: elev * Math.sin(p),
      gh: elev - scap, scap, rot: nn(rotv, 'ir', 'ar'), coupledER: A.AR, rotTotal: rotv - A.AR
    },
    rhythm: rz,
    rhythmFormula: { scapula: { up: A.UR, tilt: A.PT, ext: A.ER }, clavicle: { elev: A.CE, retr: A.CR, post: A.CP } },
    girdle: { elev: nn(v('girdleElev'), 'elev', 'depr'), prot: nn(v('girdleProt'), 'prot', 'retr') },
    elbow: nn(v('elbow'), 'flex', 'ext'),
    forearm: nn(v('forearm'), 'pron', 'sup'),
    wrist: { flex: nn(v('wristFlex'), 'palmar', 'dorsal'), dev: nn(v('wristDev'), 'ulnar', 'radial') }
  };
}

// ---------- sürükleme çözücüleri ----------
// ray: { o: [x,y,z], d: [x,y,z] } ya da three.js Ray gibi { origin: {x,y,z}, direction: {x,y,z} } (dünya koordinatı).
const vec3 = v => (v && typeof v.x === 'number' ? [v.x, v.y, v.z] : V(v));
function rayOf(ray) {
  const o = vec3(ray.o || ray.origin), d = unit(vec3(ray.d || ray.direction));
  if (!d) throw new Error('motion-kin: ışın yönü sıfır');
  return { o, d };
}
const _scratch = new WeakMap();
const scratchFk = model => { let f = _scratch.get(model); if (!f) { f = createFk(model); _scratch.set(model, f); } return f; };

// Yükseltme sınırının küre üzerindeki eğrisi (yarım derecelik adımlarla yön tablosu), bir kez kurulur.
let _bound = null;
function boundary() {
  if (_bound) return _bound;
  const n = 720, B = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) { const p = -180 + i * 0.5, d = dirOf(p, elevLimit(p)); B[3 * i] = d[0]; B[3 * i + 1] = d[1]; B[3 * i + 2] = d[2]; }
  return (_bound = { n, B });
}
// u (birim yön) izinli bölgedeyse kendisi; değilse sınır eğrisi üzerinde, hintPlane'den başlayan tırmanışla bulunan en
// yakın yön. Düzlemi koruyup yükseltmeyi kısmak tepe noktası çevresinde sıçratır (sınır düzleme göre 180'den 40'a iner);
// en yakın yön sürüklerken sınır boyunca kayar.
export function nearestAllowed(u, hintPlane = 0) {
  const c = coordsOf(u, hintPlane);
  if (c.elev <= elevLimit(c.plane) + 1e-9) return { plane: wrap180(c.plane), elev: c.elev, clamped: false };
  const { n, B } = boundary();
  const g = i => { i = ((i % n) + n) % n; return u[0] * B[3 * i] + u[1] * B[3 * i + 1] + u[2] * B[3 * i + 2]; };
  let i = Math.round((wrap180(hintPlane) + 180) * 2) % n, gi = g(i);
  for (let k = 0; k < n; k++) {
    const gl = g(i - 1), gr = g(i + 1);
    if (gl <= gi && gr <= gi) break;
    if (gr > gl) { i++; gi = gr; } else { i--; gi = gl; }
  }
  // tablonun iki komşu adımı arasında altın oran araması
  const f = p => { const d = dirOf(p, elevLimit(p)); return u[0] * d[0] + u[1] * d[1] + u[2] * d[2]; };
  const G = 0.6180339887498949;
  let a = -180 + (i - 1) * 0.5, b = a + 1, x1 = b - G * (b - a), x2 = a + G * (b - a), f1 = f(x1), f2 = f(x2);
  for (let k = 0; k < 44; k++) {
    if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = a + G * (b - a); f2 = f(x2); }
    else { b = x2; x2 = x1; f2 = f1; x1 = b - G * (b - a); f1 = f(x1); }
  }
  const p = wrap180(0.5 * (a + b));
  return { plane: p, elev: elevLimit(p), clamped: true };
}

// Dirsek tutamacı. İşaretçi ışını, şimdiki omuz merkezi çevresindeki küreyle (yarıçap = baş merkezi - dirsek noktası)
// kesiştirilir; ışın küreyi ıskalarsa kürenin ışına en yakın noktası alınır. Sonuç yön -> plane, elev (sınırlar içinde).
// Omuz merkezi yükseltmeyle birlikte kaydığı için birkaç kez yinelenir (opts.iter, varsayılan 6): tutamaç işaretçinin
// altında kalır.
// opts.side: 'near' | 'far' | 'auto'. Işın küreyi iki yerde keser; 'auto' şimdiki dirseğin bulunduğu yarıyı seçer
// (kameraya yakın yarı önceliklidir). Sürükleme boyunca bir önceki sonucun side değerini geri verin: tutamaç yarı
// değiştirmez; ışın küreden çıkınca (miss) side 'near' olur.
// opts.edge (0..1, varsayılan 1 = tam küre): kürenin görünen kenarında derinlik işaretçiye çok duyarlıdır (kenarda
// yarım santimlik oynama 5 cm derinlik demektir). edge < 1 verilirse, ışın merkezden edge * R'den uzak geçtiğinde
// derinlik kenara doğru doğrusal olarak sıfıra iner: titreme azalır, karşılığında o dar kuşakta tutamaç işaretçinin
// tam altında kalmaz (1 cm'den az kayar). 0.9 makul bir değerdir.
// opts.transport (varsayılan false): false iken rot değişmez (SPEC); tepeye yakın düzlem değiştikçe kol kendi ekseni
// çevresinde hızla döner (yönelim Swing(d) ile tanımlı olduğu için). true iken humerus eski yönünden yenisine EN KISA
// dönmeyle taşınır ve rot buna göre güncellenir (Codman dönmesi rot değerinde görünür), sonra sınırlara oturtulur.
// opts.pole (derece, varsayılan 10; 0 = kapalı): tepe (elev 180) yakınında düzlem belirsizleşir; yönelim Swing(d) ile
// tanımlı olduğundan orada işaretçinin küçük bir oynaması kolu kendi ekseni çevresinde çevirir (elev 178'de düzlem
// -3 -> 12: kol 0,5 derece oynar, epikondil hattı 28 derece döner). Hedef yükseltme 180 - pole'ün üstündeyse düzlem
// değişimi (180 - elev) / pole oranıyla kısılır (tam tepede düzlem değişmez); karşılığında tutamaç o dar bölgede
// işaretçinin en çok 1-2 cm gerisinde kalır.
// Dönen: { pose (sınırlara oturtulmuş tam duruş), plane, elev, hit: kürede hedef nokta, miss, side, clamped }
export function solveElbow(model, pose, ray, opts = {}) {
  const { o: O, d } = rayOf(ray), R = model.armLen, iter = opts.iter > 0 ? opts.iter : 6;
  const edge = opts.edge > 0 && opts.edge < 1 ? opts.edge : 1, pole = opts.pole === undefined ? 10 : +opts.pole || 0;
  const cur = clampPose(model, pose, {}), f = scratchFk(model), H = [0, 0, 0];
  const p0 = cur.plane, e0 = cur.elev, r0 = cur.rot;
  let side = opts.side === 'near' || opts.side === 'far' ? opts.side : 'auto', miss = false, clamped = false;
  for (let k = 0; k < iter; k++) {
    fk(model, cur, f);
    const C = f.pts.gh, E = f.pts.elbow;
    // ışının merkeze en yakın noktası P (t = -b), merkezden uzaklığı rho; küre üzerindeki derinlik z (ışın boyunca)
    const oc = sub(O, C), b = dot(oc, d);
    let px = oc[0] - b * d[0], py = oc[1] - b * d[1], pz = oc[2] - b * d[2];
    const rho = Math.hypot(px, py, pz);
    let z = rho < R ? Math.sqrt(R * R - rho * rho) : 0, hitOk = rho < R && z - b > 0;
    if (hitOk) {
      if (-b - z <= 0) side = 'far';                                // ışın kürenin içinden başlıyor
      else if (side === 'auto') side = dot(sub(E, C), d) > 0.15 * R ? 'far' : 'near';
      if (rho > edge * R) z = Math.sqrt(1 - edge * edge) * R * (R - rho) / (R - edge * R);
      const s = side === 'far' ? z : -z;
      px += s * d[0]; py += s * d[1]; pz += s * d[2]; miss = false;
    } else {
      if (b > 0) { px = oc[0]; py = oc[1]; pz = oc[2]; }             // küre ışın başlangıcının arkasında
      miss = true; side = 'near';
    }
    const w = unit([px, py, pz]) || unit(sub(E, C));
    H[0] = C[0] + R * w[0]; H[1] = C[1] + R * w[1]; H[2] = C[2] + R * w[2];
    // hedef yön; veri yuvarlanmışsa modelin yönü ile gerçek dirsek yönü arasındaki küçük fark da düzeltilir
    const dq = dirOf(cur.plane, cur.elev);
    const u = unit([(H[0] - E[0]) / R + dq[0], (H[1] - E[1]) / R + dq[1], (H[2] - E[2]) / R + dq[2]]) || dq;
    const r = nearestAllowed(u, cur.elev >= 10 ? cur.plane : coordsOf(u, cur.plane).plane);
    cur.plane = r.plane; cur.elev = r.elev; clamped = r.clamped;
    if (pole > 0 && cur.elev > 180 - pole && e0 >= 10) { cur.plane = wrap180(p0 + wrap180(cur.plane - p0) * Math.max(0, (180 - cur.elev) / pole)); cur.elev = Math.min(cur.elev, elevLimit(cur.plane)); }
    clampPose(model, cur, cur);
  }
  if (opts.transport) {
    // Swing(yeni)^T * EnKısa(d0 -> d1) * Swing(eski) = humerus ekseni çevresinde bir büküm; açısı rot'a eklenir
    const d0 = dirOf(p0, e0), d1 = dirOf(cur.plane, cur.elev), ax = unit(cross(d0, d1));
    if (ax) {
      const ang = Math.atan2(len(cross(d0, d1)), dot(d0, d1)) * R2D;
      humOrient(_a, p0, e0, 0); rot(_b, ax, ang); mul(_b, _b, _a);
      humOrient(_a, cur.plane, cur.elev, 0); transpose(_a, _a); mul(_a, _a, _b);
      cur.rot = r0 - rhythm(e0, p0, _gl).AR + Math.atan2(-_a[2], _a[0]) * R2D + rhythm(cur.elev, cur.plane, _gl).AR;
      clampPose(model, cur, cur);
    }
  }
  return { pose: cur, plane: cur.plane, elev: cur.elev, hit: H, miss, side, clamped };
}

// El tutamacı. Tutamaç noktası (varsayılan: el bileği merkezi, radius segmentinde) dirsek açısı değişirken dirsek
// ekseni çevresinde bir çember çizer; izinli yay üzerinde işaretçi ışınına en yakın açı bulunur -> elbow.
// opts.point: tutamacın DİNLENME koordinatı, opts.seg: onu taşıyan segment.
// Dönen: { pose, elbow, point: çemberdeki nokta (dünya), dist: ışına uzaklık (cm) }
export function solveHand(model, pose, ray, opts = {}) {
  const { o: O, d } = rayOf(ray), cur = clampPose(model, pose, {}), f = scratchFk(model);
  fk(model, cur, f);
  const m = f.m[opts.seg || 'radius'];
  if (!m) throw new Error('motion-kin: bilinmeyen segment: ' + opts.seg);
  const Z = transformPoint(m, opts.point ? vec3(opts.point) : model.J.wrist, [0, 0, 0]);
  const A = f.pts.elbow, a = f.elbowAxis, w = sub(Z, A), h = dot(w, a);
  const pr = [w[0] - h * a[0], w[1] - h * a[1], w[2] - h * a[2]], r = len(pr);
  if (r < 1e-6) return { pose: cur, elbow: cur.elbow, point: Z, dist: 0 };
  const e1 = [pr[0] / r, pr[1] / r, pr[2] / r], e2 = cross(a, e1);
  const cx = A[0] + h * a[0], cy = A[1] + h * a[1], cz = A[2] + h * a[2];             // çember merkezi
  const lo = model.ranges.elbow[0] - cur.elbow, hi = model.ranges.elbow[1] - cur.elbow; // açı aralığı (şimdikine göre)
  const P = [0, 0, 0];
  const at = phi => { const c = Math.cos(phi * D2R) * r, s = Math.sin(phi * D2R) * r; P[0] = cx + c * e1[0] + s * e2[0]; P[1] = cy + c * e1[1] + s * e2[1]; P[2] = cz + c * e1[2] + s * e2[2]; return P; };
  const dist2 = phi => { const p = at(phi), x = p[0] - O[0], y = p[1] - O[1], z = p[2] - O[2], al = x * d[0] + y * d[1] + z * d[2], ux = x - al * d[0], uy = y - al * d[1], uz = z - al * d[2]; return ux * ux + uy * uy + uz * uz; };
  // kaba tarama: eşit uzaklıkta iki aday varsa şimdiki açıya yakın olan seçilsin diye çok küçük bir ceza (yalnız burada)
  const N = 96; let bi = 0, bv = Infinity;
  for (let i = 0; i <= N; i++) { const ph = lo + (hi - lo) * i / N, v = dist2(ph) + 1e-6 * (r * ph * D2R) * (r * ph * D2R); if (v < bv) { bv = v; bi = i; } }
  // komşu iki adım arasında altın oran araması (cezasız)
  const G = 0.6180339887498949;
  let x0 = lo + (hi - lo) * Math.max(bi - 1, 0) / N, x3 = lo + (hi - lo) * Math.min(bi + 1, N) / N;
  let x1 = x3 - G * (x3 - x0), x2 = x0 + G * (x3 - x0), f1 = dist2(x1), f2 = dist2(x2);
  for (let k = 0; k < 60; k++) {
    if (f1 > f2) { x0 = x1; x1 = x2; f1 = f2; x2 = x0 + G * (x3 - x0); f2 = dist2(x2); }
    else { x3 = x2; x2 = x1; f2 = f1; x1 = x3 - G * (x3 - x0); f1 = dist2(x1); }
  }
  let phi = 0.5 * (x0 + x3);
  // uç noktalar: altın oran araması sınıra yaklaşır ama değmez
  if (dist2(lo) <= dist2(phi)) phi = lo;
  if (dist2(hi) <= dist2(phi)) phi = hi;
  cur.elbow = clamp(cur.elbow + phi, model.ranges.elbow[0], model.ranges.elbow[1]);
  const p = at(phi);
  return { pose: cur, elbow: cur.elbow, point: [p[0], p[1], p[2]], dist: Math.sqrt(Math.max(0, dist2(phi))) };
}

// ---------- yumuşak geçiş ----------
export const ease = smooth;                                            // 0..1 -> 0..1, uçlarda eğim sıfır
export const pingPong = t => { t = clamp(t, 0, 1); return smooth(t < 0.5 ? 2 * t : 2 - 2 * t); };   // 0 -> 1 -> 0 (git ve dön)
// İki duruş arası ara değer. (plane, elev) çifti, sarkan kol çevresindeki kutupsal haritada (elev * (cos, sin)) doğrusal
// ilerler: kol sarkan konumdan geçerken düzlem sıçraması olmaz, -180 / 180 dikişi sorun çıkarmaz. Öbür koordinatlar
// doğrusaldır. Sonuç sınırlara oturtulur.
const _lp = {};
export function lerpPose(model, a, b, t, out = {}) {
  if (!(t > 0)) return clampPose(model, a, out);
  if (t >= 1) return clampPose(model, b, out);
  const r = model.rest, A = k => num(a && a[k], r[k]), B = k => num(b && b[k], r[k]);
  const pa = A('plane') * D2R, pb = B('plane') * D2R, ea = A('elev'), eb = B('elev');
  const ax = ea * Math.cos(pa), ay = ea * Math.sin(pa), ux = ax + t * (eb * Math.cos(pb) - ax), uy = ay + t * (eb * Math.sin(pb) - ay);
  const e = Math.hypot(ux, uy);
  _lp.elev = e; _lp.plane = e > 1e-9 ? Math.atan2(uy, ux) * R2D : B('plane');
  for (let i = 2; i < COORDS.length; i++) { const k = COORDS[i], x = A(k); _lp[k] = x + t * (B(k) - x); }
  return clampPose(model, _lp, out);
}
// İki duruş arasındaki en büyük koordinat farkı (derece; plane farkı yükseltmeyle ölçeklenir)
export function poseDistance(model, a, b) {
  const r = model.rest, A = k => num(a && a[k], r[k]), B = k => num(b && b[k], r[k]);
  const pa = A('plane') * D2R, pb = B('plane') * D2R;
  let m = Math.hypot(B('elev') * Math.cos(pb) - A('elev') * Math.cos(pa), B('elev') * Math.sin(pb) - A('elev') * Math.sin(pa));
  for (let i = 2; i < COORDS.length; i++) m = Math.max(m, Math.abs(B(COORDS[i]) - A(COORDS[i])));
  return m;
}
// cur duruşunu target'a doğru dt saniye ilerletir: üstel yaklaşma (kare hızından bağımsız), isteğe bağlı hız sınırı.
// opts.tau: zaman sabiti (s, varsayılan 0.12; 0 = hemen), opts.maxSpeed: derece/s (varsayılan sınırsız),
// opts.eps: bu kadar yaklaşınca hedefe oturur (derece, varsayılan 0.05). out'a yazar (varsayılan cur); hedefe
// varıldıysa true döner. Hedef önce sınırlara oturtulur.
const _tg = {}, _ap = {};
export function approachPose(model, cur, target, dt, opts = {}, out = cur) {
  const tau = num(opts.tau, 0.12), cap = num(opts.maxSpeed, Infinity) * dt, eps = num(opts.eps, 0.05);
  const k = tau > 0 ? 1 - Math.exp(-Math.max(dt, 0) / tau) : 1, r = model.rest;
  const tg = clampPose(model, target, _tg);
  let done = true;
  // (plane, elev): kutupsal haritada vektör adımı
  const pc = num(cur.plane, r.plane) * D2R, ec = num(cur.elev, r.elev), pt = tg.plane * D2R;
  const cx = ec * Math.cos(pc), cy = ec * Math.sin(pc), tx = tg.elev * Math.cos(pt), ty = tg.elev * Math.sin(pt);
  let dx = (tx - cx) * k, dy = (ty - cy) * k; const dl = Math.hypot(dx, dy);
  if (dl > cap) { dx *= cap / dl; dy *= cap / dl; }
  if (Math.hypot(tx - cx - dx, ty - cy - dy) <= eps) { _ap.plane = tg.plane; _ap.elev = tg.elev; }
  else { const e = Math.hypot(cx + dx, cy + dy); _ap.elev = e; _ap.plane = e > 1e-9 ? Math.atan2(cy + dy, cx + dx) * R2D : tg.plane; done = false; }
  for (let i = 2; i < COORDS.length; i++) {
    const key = COORDS[i], x = num(cur[key], r[key]); let s = (tg[key] - x) * k;
    if (Math.abs(s) > cap) s = Math.sign(s) * cap;
    if (Math.abs(tg[key] - x - s) <= eps) _ap[key] = tg[key]; else { _ap[key] = x + s; done = false; }
  }
  clampPose(model, _ap, out);
  return done;
}

// ---------- karışık ağırlıklı nokta dönüşümü (kas merkez çizgileri için) ----------
// Ağırlıklar: [[segment, ağırlık], ...]; segment = anahtar ('humerus') ya da motion.json segments indisi.
// dq = true (varsayılan): ikili kuaterniyon karışımı; false: doğrusal karışım. İkili kuaterniyon kuralı (gölgelendirici
// ile aynı olmalı): etkiler ağırlıklarıyla OLDUĞU GİBİ toplanır (köşe başına işaret çevirme YOK: işaretleri fk zincir
// boyunca sürekli seçer), toplam gerçek kısmın boyuna bölünür;
// nokta = p + 2 r.xyz x (r.xyz x p + r.w p) + 2 (r.w d.xyz - d.w r.xyz + r.xyz x d.xyz).
// fk çıktısındaki o.dq dizisi segment başına 8 sayıdır [rx, ry, rz, rw, dx, dy, dz, dw] ve doğrudan yüklenebilir.
function blend(o, px, py, pz, I, W, base, cnt, dq, out, oo) {
  if (dq) {
    const Q = o.dq; let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, b7 = 0;
    for (let j = 0; j < cnt; j++) {
      const w = W[base + j]; if (!(w > 0)) continue;
      const k = 8 * I[base + j];
      b0 += w * Q[k]; b1 += w * Q[k + 1]; b2 += w * Q[k + 2]; b3 += w * Q[k + 3]; b4 += w * Q[k + 4]; b5 += w * Q[k + 5]; b6 += w * Q[k + 6]; b7 += w * Q[k + 7];
    }
    const n = Math.hypot(b0, b1, b2, b3);
    if (n > 1e-12) {
      const rx = b0 / n, ry = b1 / n, rz = b2 / n, rw = b3 / n, dx = b4 / n, dy = b5 / n, dz = b6 / n, dw = b7 / n;
      const ux = ry * pz - rz * py + rw * px, uy = rz * px - rx * pz + rw * py, uz = rx * py - ry * px + rw * pz;
      out[oo] = px + 2 * (ry * uz - rz * uy) + 2 * (rw * dx - dw * rx + ry * dz - rz * dy);
      out[oo + 1] = py + 2 * (rz * ux - rx * uz) + 2 * (rw * dy - dw * ry + rz * dx - rx * dz);
      out[oo + 2] = pz + 2 * (rx * uy - ry * ux) + 2 * (rw * dz - dw * rz + rx * dy - ry * dx);
      return;
    }
  }
  const M = o.mats; let x = 0, y = 0, z = 0, sw = 0;
  for (let j = 0; j < cnt; j++) {
    const w = W[base + j]; if (!(w > 0)) continue;
    const k = 16 * I[base + j]; sw += w;
    x += w * (M[k] * px + M[k + 4] * py + M[k + 8] * pz + M[k + 12]);
    y += w * (M[k + 1] * px + M[k + 5] * py + M[k + 9] * pz + M[k + 13]);
    z += w * (M[k + 2] * px + M[k + 6] * py + M[k + 10] * pz + M[k + 14]);
  }
  if (sw > 0) { out[oo] = x / sw; out[oo + 1] = y / sw; out[oo + 2] = z / sw; } else { out[oo] = px; out[oo + 1] = py; out[oo + 2] = pz; }
}
const segIndex = (model, s) => { const i = typeof s === 'number' ? s : model.index[s]; if (!(i >= 0 && i < model.segs.length)) throw new Error('motion-kin: bilinmeyen segment: ' + s); return i; };
// Tek nokta. w: [[segment, ağırlık], ...]
export function skinPoint(o, p, w, out = [0, 0, 0], dq = true) {
  const n = w.length, I = new Array(n), W = new Array(n);
  for (let j = 0; j < n; j++) { I[j] = segIndex(o.model, w[j][0]); W[j] = +w[j][1]; }
  blend(o, p[0], p[1], p[2], I, W, 0, n, dq, out, 0);
  return out;
}
// Merkez çizgisini bir kez derler: line = [{ p: [x,y,z], w: [[segment, ağırlık], ...] }, ...] (motion.json skin.parts[].line)
export function compileLine(model, line) {
  const n = line.length, cl = { n, P: new Float64Array(3 * n), I: new Uint8Array(4 * n), W: new Float64Array(4 * n), out: new Float64Array(3 * n) };
  for (let i = 0; i < n; i++) {
    const s = line[i], w = s.w || [];
    cl.P[3 * i] = +s.p[0]; cl.P[3 * i + 1] = +s.p[1]; cl.P[3 * i + 2] = +s.p[2];
    if (w.length > 4) throw new Error('motion-kin: bir örnekte en çok 4 ağırlık olabilir');
    for (let j = 0; j < w.length; j++) { cl.I[4 * i + j] = segIndex(model, w[j][0]); cl.W[4 * i + j] = +w[j][1]; }
  }
  return cl;
}
// Derlenmiş çizgiyi şimdiki duruşa taşır (out: 3n sayı) ve uzunluğunu verir
export function skinLine(o, cl, out = cl.out, dq = true) {
  for (let i = 0; i < cl.n; i++) blend(o, cl.P[3 * i], cl.P[3 * i + 1], cl.P[3 * i + 2], cl.I, cl.W, 4 * i, 4, dq, out, 3 * i);
  return out;
}
export function lineLength(o, cl, dq = true) {
  const P = skinLine(o, cl, cl.out, dq); let L = 0;
  for (let i = 1; i < cl.n; i++) L += Math.hypot(P[3 * i] - P[3 * i - 3], P[3 * i + 1] - P[3 * i - 2], P[3 * i + 2] - P[3 * i - 1]);
  return L;
}

// ---------- Kararlar (SPEC'in sustuğu ya da uygulanamadığı yerler) ----------
// 1. Dinlenme = birim matris: yönelimler veri içindeki rest koordinatlarından kurulur (rest tam o değerlerle birim
//    verir); ritim ve bütün eklem açıları dinlenmeye göre fark olarak uygulanır.
// 2. Yükseltme sınırı dört düğüm arasında smoothstep; dönme sınırı 30-60 derece yükseltme arasında geçer.
// 3. Ritmin düzlem karışımı w = max(0, cos(plane))^2 (frontal 1, sagittal ve ötesi 0).
// 4. Eşlenik dış dönme rot koordinatına eklenir (toplam büküm = rot - AR); sınırlar rot'a uygulanır.
// 5. El bileği: R = Rflex(k a) * Rdev(k b), k = 0.5 (proksimal sıra) ve 1 (el): sapma ekseni elle birlikte taşınır.
// 6. Skapula ekseni: ai, ts, aa noktalarından (yoksa genel 30 derecelik skapula düzlemi).
// 7. Skapulanın göğüs kafesinde kalması: SPEC "AC çevresinde küçük bir düzeltme dönmesi" öngörüyordu; ölçüm 7 cm sapma
//    ve 27 dereceye varan düzeltme gösterdi, bu da tam yükseltmede çizilen yukarı dönmeyi 60 yerine 35 dereceye
//    indiriyordu. Onun yerine: UR formülde kalır, klavikula ve skapulanın öbür açıları en küçük sapmayla çözülür
//    (solveRhythmFit). Gerçek veriyle tam yükseltmede: klavikula retraksiyonu 28 (formül 15), yükselmesi 26 (formül 12),
//    skapula eğilmesi 52 (formül 30), dış dönmesi 9 (formül 20) derece.
// 8. Omuz kuşağı: skapula TUNE oranlarıyla eşlik eder; Retraktion sınırı skapula omurgaya binmeyecek biçimde kısılır;
//    Elevation ve Retraktion sınırı ritmin kullandığı klavikula payı kadar kısalır (girdleLimits).
// 9. Dirsek tutamacı: sınır dışındaki hedef, düzlem korunarak değil sınır eğrisinde en yakın yöne oturtulur.
// 10. İkili kuaterniyonların işareti (bütünleştirme düzeltmesi): matristen rw >= 0 seçmek yerine zincir boyunca yarım açılı
//     kuaterniyonlar çarpılır; karışımda köşe başına işaret çevrilmez. Eski kuralda skapula + humerus çifti izinli aralıkta
//     180 derece bağıl dönmeye varıp sıçrıyordu (tools/_qawork/motion-validate.mjs bölüm 0).
