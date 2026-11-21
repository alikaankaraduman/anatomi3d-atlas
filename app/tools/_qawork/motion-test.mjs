// Node testi: src/motion-kin.js (kol hareketi kinematiği) ve veri dosyaları. Çalıştır: node tools/_qawork/motion-test.mjs
// (app/ içinde). İki veriyle koşar:
//   1) SPEC'teki işaret noktalarından kurulan sabit veri (fixture): eksen işaretleri, veri aracının yapacağı gibi, uzak
//      bir noktanın hangi yöne oynadığına bakılarak seçilir;
//   2) public/data/motion.json varsa aynı denetimler onunla da (ve public/models/motion-arm.bin ile biçim denetimi).
// Denetlenenler: dinlenme = birim matris, katı dönüşüm, eklemlerin bağlı kalması (SC, AC, baş merkezi, dirsek ekseni,
// ön kol ekseni, el bileği merkezi), hareket yönleri, sınırlar, ritim değerleri (0 / 90 / 180), skapulanın göğüs
// kafesinde kalması, dinlenme okuması, iki sürükleme çözücüsünün gidiş dönüşü, süreklilik (kutuplar dahil), yumuşak
// geçiş yardımcıları, karışık ağırlıklı nokta dönüşümü.
// Seçenek: --verbose (ölçülen en büyük değerleri yazar).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as K from '../../src/motion-kin.js';

const HERE = dirname(fileURLToPath(import.meta.url)), APP = join(HERE, '..', '..');
const VERBOSE = process.argv.includes('--verbose');
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('HATA:', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} ~ ${b}, pay ${tol})`);
const info = [];

// ---------- küçük matematik (modülden bağımsız) ----------
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s], neg = a => mulS(a, -1);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mulS(a, 1 / len(a));
const dist = (a, b) => len(sub(a, b));
// eksen çevresinde dönme (Rodrigues), satır sıralı 3x3
const rotM = (ax, deg) => { const a = deg * D2R, c = Math.cos(a), s = Math.sin(a), t = 1 - c, [x, y, z] = ax; return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]; };
const mulM = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c]; return o; };
const appM = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const rotPoint = (p, pivot, ax, deg) => add(appM(rotM(ax, deg), sub(p, pivot)), pivot);
// 4x4 (sütun sıralı) matrisin dönme bölümü, satır sıralı 3x3
const rotOf = m => [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
const angleOf = R => Math.atan2(Math.hypot(R[7] - R[5], R[2] - R[6], R[3] - R[1]) / 2, (R[0] + R[4] + R[8] - 1) / 2) * R2D;
const tr = (m, p) => K.transformPoint(m, p, [0, 0, 0]);
// tekrarlanabilir rastgele sayı
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- sabit veri (SPEC bölüm 2'deki işaret noktaları) ----------
const LM = {
  sc: [1.67, 139.95, 3.95], ac: [15.09, 141.55, -3.83], gh: [16.71, 138.24, -2.67], ghR: 2.23,
  elbow: [21.89, 110.52, -3.47], elbowDir: [0.93, 0.26, -0.25],
  radHead: [23.98, 108.73, -3.13], ulnHead: [24.80, 86.83, 1.52], wrist: [26.46, 84.77, 1.95],
  rs: [28.66, 85.65, 1.77], us: [24.45, 85.57, 1.21],
  // map-data.md bölüm 5'ten (SPEC listesinde yok): 3. metakarp, humerus gövde ekseni (proksimale bakar)
  m3: [27.02, 80.58, 2.57], shaft: [-0.16, 0.98, 0.11],
  // skapula noktaları ve kaburga elipsoidi: data/work/motion/kin-scapcheck.mjs --json ile gerçek ağlardan ölçüldü
  ai: [9.36, 125.43, -10.13], ts: [6.06, 136.66, -10.03], aa: [17.14, 140.22, -6.3],
  fit: { c: [4.56, 125.89, -0.57], r: [9.77, 15.83, 9.03] }
};
// işaret: eksen çevresinde pozitif dönme, probe noktasını want yönünde oynatmalı
const orient = (ax, pivot, probe, want) => (dot(sub(rotPoint(probe, pivot, ax, 5), probe), want) >= 0 ? ax : neg(ax));
// eksen çevresinde a'dan b'ye işaretli açı (ikisi de eksene dik düzleme izdüşürülür)
const signedAngle = (a, b, ax) => { const pa = sub(a, mulS(ax, dot(a, ax))), pb = sub(b, mulS(ax, dot(b, ax))); return Math.atan2(dot(cross(pa, pb), ax), dot(pa, pb)) * R2D; };
function fixture({ round = false, withFit = true, order = null, extra = false } = {}) {
  const elbowAxis = orient(unit(LM.elbowDir), LM.elbow, LM.wrist, [0, 0, 1]);                 // Flexion: el bileği öne
  const forearmDir = orient(unit(sub(LM.ulnHead, LM.radHead)), LM.radHead, LM.rs, [0, 0, 1]);  // Pronation: radius stiloidi öne
  const flexAxis = orient(unit(sub(LM.us, LM.rs)), LM.wrist, LM.m3, [0, 0, 1]);                // Palmarflexion: el avuç yönüne (öne)
  const devAxis = orient(unit(cross(sub(LM.m3, LM.wrist), flexAxis)), LM.wrist, LM.m3, sub(LM.us, LM.rs));   // Ulnarabduktion: el ulna yanına
  const d = unit(sub(LM.elbow, LM.gh));
  let plane = Math.atan2(d[2], d[0]) * R2D, elev = Math.acos(-d[1]) * R2D;
  // dirsek: humerus gövde ekseni ile ön kol çizgisi (dirsek -> stiloid ortası) arası, fleksiyon ekseni çevresinde
  const fore = sub(mulS(add(LM.rs, LM.us), 0.5), LM.elbow);
  let elbow = signedAngle(neg(LM.shaft), fore, elbowAxis);
  // ön kol: SPEC'in değeri (tam supinasyon, yaklaşık 85). İşaret noktalarından ölçüm ayrıca bilgi olarak yazılır:
  // orta konumda stiloid çizgisi (ulna -> radius) = fleksiyon ekseni x ön kol ekseni
  const measuredForearm = signedAngle(cross(elbowAxis, forearmDir), sub(LM.rs, LM.us), forearmDir);
  if (round) { plane = Math.round(plane * 100) / 100; elev = Math.round(elev * 100) / 100; elbow = Math.round(elbow * 10) / 10; }
  const keys = order || K.SEGMENTS, parent = { thorax: null, clavicle: 'thorax', scapula: 'clavicle', humerus: 'scapula', ulna: 'humerus', radius: 'ulna', carpProx: 'radius', hand: 'radius', twist: 'ulna' };
  const data = {
    v: 1, side: 'l',
    segments: [...keys, ...(extra ? ['twist'] : [])].map(key => ({ key, parent: parent[key], bones: [] })),
    joints: {
      sc: { p: LM.sc }, ac: { p: LM.ac }, gh: { p: LM.gh, r: LM.ghR },
      elbow: { p: LM.elbow, axis: elbowAxis }, forearm: { p: LM.radHead, q: LM.ulnHead, dir: forearmDir },
      wrist: { p: LM.wrist, flexAxis, devAxis }, scapula: { ai: LM.ai, ts: LM.ts, aa: LM.aa }
    },
    rest: { plane, elev, rot: 0, girdleElev: 0, girdleProt: 0, elbow, forearm: -85, wristFlex: 0, wristDev: 0 }
  };
  if (withFit) data.thoraxFit = { c: LM.fit.c, r: LM.fit.r };
  return { data, measuredForearm };
}

// ---------- ortak denetimler: bir veriyle (sabit ya da gerçek) ----------
function randomPose(model, rnd) {
  const q = {};
  q.plane = -180 + 360 * rnd(); q.elev = K.elevLimit(q.plane) * rnd();
  const rl = K.rotLimits(q.elev); q.rot = rl[0] + (rl[1] - rl[0]) * rnd();
  const L = K.limits(model, q);
  for (const k of ['girdleElev', 'girdleProt', 'elbow', 'forearm', 'wristFlex', 'wristDev']) q[k] = L[k][0] + (L[k][1] - L[k][0]) * rnd();
  return q;
}
const identityDev = o => { let d = 0; for (let i = 0; i < o.mats.length; i++) d = Math.max(d, Math.abs(o.mats[i] - ((i % 16) % 5 === 0 ? 1 : 0))); return d; };
const matDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };

// tol: eklem açıklığı payı (cm). Sabit veride eksenler tam; gerçek dosyada birkaç basamağa yuvarlanmış olabilir.
function kinSuite(tag, data, tol = 1e-9) {
  const T = s => `[${tag}] ${s}`;
  const model = K.createModel(data), J = data.joints, rest = model.rest;
  const o = K.createFk(model), o2 = K.createFk(model);
  ok(model.warnings.length === 0, T('model uyarısız kurulur: ' + model.warnings.join(' | ')));
  if (VERBOSE && model.notes.length) info.push(T('notlar: ' + model.notes.join(' | ')));

  // --- dinlenme = birim ---
  K.fk(model, data.rest, o);
  ok(identityDev(o) <= 1e-9, T(`verideki rest koordinatlarıyla birim matris (sapma ${identityDev(o).toExponential(1)})`));
  K.fk(model, model.rest, o);
  ok(identityDev(o) <= 1e-9, T('model.rest ile birim matris'));
  K.fk(model, {}, o);
  ok(identityDev(o) <= 1e-9, T('boş duruş = dinlenme'));
  ok(o.corr.every(v => Math.abs(v) < 1e-9), T('dinlenmede düzeltme sıfır'));
  ok(o.mats.length === 16 * data.segments.length && data.segments.every((s, i) => o.m[s.key] && o.m[s.key].byteOffset === o.mats.byteOffset + 128 * i), T('matrisler verideki segment sırasıyla'));
  ok(Array.from(o.m.thorax).every((v, i) => v === (i % 5 === 0 ? 1 : 0)), T('göğüs matrisi tam birim'));
  { const c = K.clampPose(model, model.rest); ok(K.COORDS.every(k => Math.abs(c[k] - rest[k]) < 1e-12), T('dinlenme duruşu sınırların içinde (clampPose değiştirmez)')); }

  // --- rastgele duruşlar: katı dönüşüm + eklemler bağlı ---
  const rnd = rng(20261121);
  let worstRigid = 0, worstJoint = 0, worstDq = 0;
  const axisPts = [J.elbow.p, add(J.elbow.p, mulS(unit(J.elbow.axis), 3))];
  for (let n = 0; n < 600; n++) {
    const q = randomPose(model, rnd);
    if (n % 7 === 0) { q.elev += 15; q.elbow += 20; q.girdleElev += 10; }          // sınır dışı girdide de bağlı kalmalı
    K.fk(model, q, o);
    for (const s of data.segments) {
      const m = o.m[s.key], R = rotOf(m), RRt = mulM(R, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
      for (let i = 0; i < 9; i++) worstRigid = Math.max(worstRigid, Math.abs(RRt[i] - (i % 4 === 0 ? 1 : 0)));
      worstRigid = Math.max(worstRigid, Math.abs(dot(cross([R[0], R[3], R[6]], [R[1], R[4], R[7]]), [R[2], R[5], R[8]]) - 1), Math.abs(m[3]), Math.abs(m[7]), Math.abs(m[11]), Math.abs(m[15] - 1));
      // ikili kuaterniyon aynı dönüşümü verir
      const p = [20 + 5 * rnd(), 110 + 30 * rnd(), -5 + 10 * rnd()];
      worstDq = Math.max(worstDq, dist(K.skinPoint(o, p, [[s.key, 1]], [0, 0, 0], true), tr(m, p)));
    }
    const M = o.m, pairs = [
      [tr(M.clavicle, J.sc.p), J.sc.p], [tr(M.clavicle, J.ac.p), tr(M.scapula, J.ac.p)], [tr(M.scapula, J.gh.p), tr(M.humerus, J.gh.p)],
      [tr(M.humerus, axisPts[0]), tr(M.ulna, axisPts[0])], [tr(M.humerus, axisPts[1]), tr(M.ulna, axisPts[1])],
      [tr(M.ulna, J.forearm.p), tr(M.radius, J.forearm.p)], [tr(M.ulna, J.forearm.q), tr(M.radius, J.forearm.q)],
      [tr(M.radius, J.wrist.p), tr(M.carpProx, J.wrist.p)], [tr(M.radius, J.wrist.p), tr(M.hand, J.wrist.p)],
      [o.pts.ac, tr(M.scapula, J.ac.p)], [o.pts.gh, tr(M.humerus, J.gh.p)], [o.pts.elbow, tr(M.ulna, J.elbow.p)], [o.pts.wrist, tr(M.hand, J.wrist.p)]
    ];
    for (const [a, b] of pairs) worstJoint = Math.max(worstJoint, dist(a, b));
  }
  ok(worstRigid <= 1e-9, T(`600 rastgele duruşta matrisler katı (dönme dik, det +1; sapma ${worstRigid.toExponential(1)})`));
  ok(worstJoint <= tol, T(`600 rastgele duruşta eklemler bağlı: SC, AC, baş merkezi, dirsek ekseni, ön kol ekseni, el bileği (en büyük açıklık ${worstJoint.toExponential(1)} cm)`));
  ok(worstDq <= 1e-9, T(`ikili kuaterniyon = matris (tek segment; sapma ${worstDq.toExponential(1)})`));

  // --- hareket yönleri (anatomik) ---
  const P = (pose, seg, p) => tr(K.fk(model, { ...rest, ...pose }, o).m[seg], p);
  const foreAx = unit(sub(J.forearm.q, J.forearm.p)), probeHand = add(J.wrist.p, mulS(foreAx, 5));
  ok(P({ elbow: rest.elbow + 30 }, 'radius', J.wrist.p)[2] > J.wrist.p[2] + 3 && P({ elbow: rest.elbow + 30 }, 'radius', J.wrist.p)[1] > J.wrist.p[1], T('Flexion (+): el bileği öne ve yukarı'));
  ok(P({ forearm: rest.forearm + 20 }, 'radius', J.wrist.p)[2] > J.wrist.p[2], T('Pronation (+): el bileği merkezi (radius yanı) öne döner'));
  ok(matDiff(K.fk(model, { ...rest, forearm: rest.forearm + 60 }, o).m.ulna, K.fk(model, rest, o2).m.ulna) < 1e-12, T('pronasyonda ulna dönmez'));
  ok(P({ wristFlex: 30 + rest.wristFlex }, 'hand', probeHand)[2] > probeHand[2] + 1, T('Palmarflexion (+): el avuç yönüne (dinlenmede öne)'));
  ok(dot(sub(P({ wristDev: 20 + rest.wristDev }, 'hand', probeHand), probeHand), sub(J.forearm.q, J.wrist.p)) > 0.5, T('Ulnarabduktion (+): el ulna yanına'));
  ok(P({ girdleElev: 20 }, 'clavicle', J.ac.p)[1] > J.ac.p[1] + 3, T('kuşak Elevation (+): AC yukarı'));
  ok(P({ girdleProt: 15 }, 'clavicle', J.ac.p)[2] > J.ac.p[2] + 2, T('kuşak Protraktion (+): AC öne'));
  { // Innenrotation: dirsek 90 derece bükülüyken el bileği içe (orta hatta doğru)
    const a = P({ elbow: 90, rot: 0 }, 'radius', J.wrist.p), b = P({ elbow: 90, rot: 40 }, 'radius', J.wrist.p);
    ok(b[0] < a[0] - 5, T('Innenrotation (+): bükülü dirsekte el içe döner'));
  }
  { // yükseltme: dirsek noktası tam (plane, elev) yönünde; öne = +z, yana = +x, arkaya = -z
    let worst = 0;
    for (const [plane, elev] of [[0, 90], [90, 90], [-90, 35], [180, 30], [45, 120], [0, 180], [90, 170], [-30, 60]]) {
      K.fk(model, { ...rest, plane, elev }, o);
      const d = unit(sub(o.pts.elbow, o.pts.gh)), e = K.dirOf(plane, elev);
      worst = Math.max(worst, dist(d, e));
    }
    ok(worst < 2e-3, T(`dirsek noktası baş merkezinden (plane, elev) yönünde (sapma ${worst.toExponential(1)})`));
    ok(K.dirOf(0, 90)[0] > 0.999 && K.dirOf(90, 90)[2] > 0.999 && K.dirOf(-90, 90)[2] < -0.999 && K.dirOf(180, 90)[0] < -0.999 && K.dirOf(37, 0)[1] < -0.999, T('düzlem kuralı: 0 yana, 90 öne, -90 arkaya, 180 içe; elev 0 aşağı'));
  }
  { // humerusun yönelimi yalnız (plane, elev, rot)'a bağlı: kuşak koordinatları onu döndürmez, yalnız taşır
    const a = rotOf(K.fk(model, { ...rest, plane: 30, elev: 80, rot: 10 }, o).m.humerus), b = rotOf(K.fk(model, { ...rest, plane: 30, elev: 80, rot: 10, girdleElev: 25, girdleProt: 15 }, o2).m.humerus);
    ok(matDiff(a, b) < 1e-12 && dist(o.pts.gh, o2.pts.gh) > 2, T('humerus göğse göre yönelir: kuşak onu döndürmez, taşır'));
  }
  { // el bileği: proksimal sıra açının yarısını alır
    for (const [k, v] of [['wristFlex', 50], ['wristDev', 30], ['wristFlex', -40]]) {
      K.fk(model, { ...rest, [k]: rest[k] + v }, o);
      const Rr = rotOf(o.m.radius), Rt = [Rr[0], Rr[3], Rr[6], Rr[1], Rr[4], Rr[7], Rr[2], Rr[5], Rr[8]];
      near(angleOf(mulM(Rt, rotOf(o.m.hand))), Math.abs(v), 1e-6, T(`${k} ${v}: el radiusa göre tam açı`));
      near(angleOf(mulM(Rt, rotOf(o.m.carpProx))), Math.abs(v) / 2, 1e-6, T(`${k} ${v}: proksimal sıra yarım açı`));
    }
  }
  { // dirsek ve ön kol açıları: segmentler arası dönme açısı koordinat farkına eşit
    K.fk(model, { ...rest, elbow: rest.elbow + 70, forearm: rest.forearm + 110 }, o);
    const T3 = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
    near(angleOf(mulM(T3(rotOf(o.m.humerus)), rotOf(o.m.ulna))), 70, 1e-6, T('dirsek: ulna humerusa göre koordinat farkı kadar döner'));
    near(angleOf(mulM(T3(rotOf(o.m.ulna)), rotOf(o.m.radius))), 110, 1e-6, T('ön kol: radius ulnaya göre koordinat farkı kadar döner'));
  }

  // --- skapulanın göğüs kafesinde kalması (thoraxFit varsa) ---
  if (model.fit) {
    const S = model.scapPts, d0 = [K.thoraxDistance(model, S.ai), K.thoraxDistance(model, S.ts)];
    let worst = 0, worstUr = 0, maxCorr = 0;
    for (const plane of [0, 30, 60, 90, 135, -45, -90, 180]) for (let elev = 0; elev <= K.elevLimit(plane); elev += 5) {
      K.fk(model, { ...rest, plane, elev }, o);
      const m = o.m.scapula;
      worst = Math.max(worst, Math.abs(K.thoraxDistance(model, tr(m, S.ai)) - d0[0]), Math.abs(K.thoraxDistance(model, tr(m, S.ts)) - d0[1]));
      // yukarı dönme formüldeki değerde: (R m0).y yalnız UR'ye bağlıdır
      const ur = o.rhythm.UR - model.A0.UR, Rm = appM(rotOf(m), model.m0), exp = appM(rotM(model.n0, ur), model.m0);
      worstUr = Math.max(worstUr, Math.abs(Rm[1] - exp[1]));
      maxCorr = Math.max(maxCorr, ...Array.from(o.corr).slice(0, 4).map(Math.abs));
    }
    ok(worst < 1e-6, T(`yükseltme boyunca alt açı ve spina kökü kaburga elipsoidine dinlenme uzaklığında (sapma ${worst.toExponential(1)} cm)`));
    ok(worstUr < 1e-9, T('düzeltme skapulanın yukarı dönmesini değiştirmez (gösterilen pay = çizilen)'));
    ok(maxCorr < 45, T(`düzeltme açıları makul (en büyük ${maxCorr.toFixed(1)} derece)`));
    if (VERBOSE) info.push(T(`göğüs kafesi düzeltmesi: en büyük ek açı ${maxCorr.toFixed(1)} derece`));
    // kuşak koordinatlarında elipsoide uzaklık yaklaşık korunur (TUNE oranları; üst uçta elipsoit gerçek kafese uymaz)
    let wg = 0;
    for (const g of [{ girdleProt: model.ranges.girdleProt[0] }, { girdleProt: model.ranges.girdleProt[1] }, { girdleElev: model.ranges.girdleElev[0] }, { girdleElev: 20 }]) {
      const m = K.fk(model, K.clampPose(model, { ...rest, ...g }), o).m.scapula;
      wg = Math.max(wg, Math.abs(K.thoraxDistance(model, tr(m, S.ai)) - d0[0]), Math.abs(K.thoraxDistance(model, tr(m, S.ts)) - d0[1]));
    }
    ok(wg < 2, T(`kuşak koordinatlarının uçlarında alt açı ve spina kökü elipsoide 2 cm içinde (${wg.toFixed(2)})`));
    if (S.ts[0] > model.tune.spineClear) ok(tr(K.fk(model, K.clampPose(model, { ...rest, girdleProt: -99 }), o).m.scapula, S.ts)[0] >= model.tune.spineClear - 0.6, T('en büyük retraksiyonda spina kökü orta hattı geçmez'));
  }

  // --- sınırlar ---
  { const rnd2 = rng(7); let bad = 0, idem = 0;
    for (let n = 0; n < 400; n++) {
      const q = { plane: -400 + 800 * rnd2(), elev: -60 + 300 * rnd2(), rot: -200 + 400 * rnd2(), girdleElev: -60 + 120 * rnd2(), girdleProt: -60 + 120 * rnd2(), elbow: -100 + 400 * rnd2(), forearm: -200 + 400 * rnd2(), wristFlex: -150 + 300 * rnd2(), wristDev: -100 + 200 * rnd2() };
      const c = K.clampPose(model, q), L = K.limits(model, c);
      for (const k of K.COORDS) if (!(c[k] >= L[k][0] - 1e-9 && c[k] <= L[k][1] + 1e-9)) bad++;
      const c2 = K.clampPose(model, c); if (K.COORDS.some(k => Math.abs(c2[k] - c[k]) > 1e-9)) idem++;
    }
    ok(bad === 0, T('clampPose her koordinatı sınırların içine alır (' + bad + ' ihlal)'));
    ok(idem === 0, T('clampPose iki kez uygulanınca değişmez'));
  }
  { const L0 = K.limits(model, rest), L1 = K.limits(model, { ...rest, plane: 0, elev: 170 });
    ok(L0.girdleElev[1] === model.ranges.girdleElev[1] && L0.girdleProt[0] === model.ranges.girdleProt[0], T('dinlenmede kuşak sınırları kısılmaz'));
    ok(L1.girdleElev[1] < L0.girdleElev[1] && L1.girdleElev[1] >= 25 && L1.girdleProt[0] > L0.girdleProt[0] && L1.girdleProt[0] <= 0, T('kol yukarıdayken Elevation ve Retraktion payı kısalır'));
    ok(L1.rot[0] === -70 && L1.rot[1] === 70 && L0.rot[1] === 95 && L0.rot[0] === -60, T('dönme sınırı: yanda 60 / 95, yukarıda 70 / 70'));
  }
  { const c = K.clampPose(model, { ...rest, plane: 20, elev: -30 }); ok(Math.abs(c.plane + 160) < 1e-9 && Math.abs(c.elev - 30) < 1e-9, T('negatif yükseltme karşı düzleme çevrilir')); }
  { const s = K.applySet(model, rest, { plane: 0, elev: 999 }); ok(s.elev === 180 && s.elbow === rest.elbow, T('applySet: hareketin set alanı + sınır')); }

  // --- okuma ---
  { const r = K.readout(model, rest);
    near(r.shoulder.gh + r.shoulder.scap, r.shoulder.elev, 1e-9, T('glenohumeral + skapula = yükseltme'));
    ok(r.elbow.value === rest.elbow && r.forearm.value === rest.forearm && r.shoulder.elev === rest.elev, T('okuma koordinatları aynen verir'));
    ok(r.elbow.key === (rest.elbow >= 0 ? 'flex' : 'ext') && r.forearm.key === (rest.forearm >= 0 ? 'pron' : 'sup') && r.forearm.abs === Math.abs(rest.forearm), T('okuma hareket adını işaretten seçer'));
  }

  // --- sürükleme: dirsek tutamacı ---
  { // önden bakan kamera, dinlenme duruşu: tutamaç kürenin kameraya bakan yarısında kalır, kol öne (kameraya) gelir
    K.fk(model, rest, o);
    const C = o.pts.gh.slice(), E = o.pts.elbow.slice(), cam = [C[0], C[1] - 5, C[2] + 300];
    const aim = add(E, [-1, 6, 0]), r = K.solveElbow(model, rest, { o: cam, d: unit(sub(aim, cam)) });
    ok(r.side === 'near' && !r.miss && r.plane > 20 && r.plane < 160 && r.elev > rest.elev, T(`önden sürükleyince kol öne gelir (plane ${r.plane.toFixed(0)}, elev ${r.elev.toFixed(0)})`));
    const rf = K.solveElbow(model, rest, { o: cam, d: unit(sub(aim, cam)) }, { side: 'far' });
    ok(rf.side === 'far' && (rf.plane < 0 || rf.clamped), T('side: far verilince uzak yarı kullanılır'));
    // sürükleme benzetimi: işaretçi küçük adımlarla ilerler, her karede varsayılan yineleme sayısı; tutamaç ışının
    // üstünde kalır ve duruş sıçramaz
    let pose = { ...rest }, side = 'auto', worstOff = 0, worstJump = 0, n = 0; const cam2 = [C[0] + 120, C[1] + 20, C[2] + 260];
    for (let k = 0; k <= 110; k++) {
      const target = add(C, mulS(K.dirOf(25 + 0.2 * k, 12 + 1.3 * k), model.armLen));
      const d = unit(sub(target, cam2)), s = K.solveElbow(model, pose, { o: cam2, d }, { side });
      if (k > 0) worstJump = Math.max(worstJump, K.poseDistance(model, pose, s.pose));
      pose = s.pose; side = s.side;
      if (!s.miss && !s.clamped) { K.fk(model, pose, o); const v = sub(o.pts.elbow, cam2); worstOff = Math.max(worstOff, len(sub(v, mulS(d, dot(v, d))))); n++; }
    }
    ok(n > 60 && worstOff < 0.1, T(`sürükleme benzetimi: tutamaç işaretçinin altında kalır (${n} kare, en büyük sapma ${worstOff.toFixed(4)} cm; en büyüğü ışın küreye teğet girerken)`));
    ok(worstJump < 6, T(`sürükleme benzetimi: kareden kareye sıçrama yok (en büyük ${worstJump.toFixed(2)} derece)`));
    if (VERBOSE) info.push(T(`sürükleme benzetimi: sapma ${worstOff.toExponential(1)} cm, kare başına en büyük değişim ${worstJump.toFixed(2)} derece, son duruş plane ${pose.plane.toFixed(0)} elev ${pose.elev.toFixed(0)}`));
  }
  { // transport: tepeye yakın düzlem değişirken humerus en kısa dönmeyle taşınır, rot buna göre değişir
    const q = K.clampPose(model, { ...rest, plane: 10, elev: 165, elbow: 90 }); K.fk(model, q, o);
    const C = o.pts.gh.slice(), R0 = rotOf(o.m.humerus), R0t = [R0[0], R0[3], R0[6], R0[1], R0[4], R0[7], R0[2], R0[5], R0[8]];
    const cam = add(C, [30, 40, 400]), tgt = add(C, mulS(K.dirOf(25, 164), model.armLen)), d = unit(sub(tgt, cam));
    const side = dot(sub(tgt, C), d) > 0 ? 'far' : 'near';
    const a = K.solveElbow(model, q, { o: cam, d }, { side, iter: 30 }), b = K.solveElbow(model, q, { o: cam, d }, { side, iter: 30, transport: true });
    const arc = Math.acos(dot(K.dirOf(q.plane, q.elev), K.dirOf(b.plane, b.elev))) * R2D;
    const angA = angleOf(mulM(rotOf(K.fk(model, a.pose, o).m.humerus), R0t)), angB = angleOf(mulM(rotOf(K.fk(model, b.pose, o).m.humerus), R0t));
    ok(a.pose.rot === q.rot && angA > arc + 10, T(`transport kapalı: rot değişmez, tepe yakınında kol ekseni çevresinde döner (yay ${arc.toFixed(1)}, dönme ${angA.toFixed(1)} derece)`));
    ok(Math.abs(angB - arc) < 1e-6 && Math.abs(b.pose.rot - q.rot) > 10 && Math.abs(b.plane - a.plane) < 1e-9 && Math.abs(b.elev - a.elev) < 1e-9, T(`transport açık: humerus en kısa dönmeyle taşınır (dönme ${angB.toFixed(2)} = yay), rot ${b.pose.rot.toFixed(1)} olur`));
    // edge: kenar kuşağında derinlik azalır; kuşağın içinde (merkeze yakın) sonuç değişmez
    K.fk(model, rest, o); const C0 = o.pts.gh.slice(), cam3 = add(C0, [0, 0, 500]), dz = [0, 0, -1];
    const at = (rho, opt) => K.solveElbow(model, rest, { o: add(cam3, [rho * model.armLen * 0.6, -rho * model.armLen * 0.8, 0]), d: dz }, { side: 'near', iter: 30, ...opt });
    const depth = s => { K.fk(model, s.pose, o); return (o.pts.elbow[2] - o.pts.gh[2]) / model.armLen; };
    const in1 = at(0.5, {}), in2 = at(0.5, { edge: 0.9 }), e1 = at(0.95, {}), e2 = at(0.95, { edge: 0.9 });
    ok(Math.abs(in1.plane - in2.plane) < 1e-9 && Math.abs(in1.elev - in2.elev) < 1e-9, T('edge: kenar kuşağının içinde sonuç aynı'));
    ok(!e2.miss && depth(e2) > 0.05 && depth(e2) < depth(e1) - 0.05, T(`edge 0.9: kenar kuşağında derinlik azalır (${depth(e1).toFixed(2)} -> ${depth(e2).toFixed(2)} yarıçap)`));
  }
  { const rnd3 = rng(99); let worstFix = 0, worstConv = 0, worstSame = 0, nConv = 0, worstMiss = 0, nMiss = 0;
    for (let n = 0; n < 200; n++) {
      const q = randomPose(model, rnd3); q.elev = Math.max(q.elev, 3);
      K.fk(model, q, o);
      const E = o.pts.elbow.slice(), C = o.pts.gh.slice();
      const cam = [C[0] + 400 * (rnd3() - 0.5), C[1] + 200 * (rnd3() - 0.5), C[2] + 150 + 250 * rnd3()], d = unit(sub(E, cam));
      const depth = dot(sub(E, C), d) / model.armLen;                // > 0: kürenin uzak yarısı
      if (Math.abs(depth) < 0.25) continue;
      const side = depth > 0 ? 'far' : 'near';
      // 1) aynı duruştan: tutamaç yerinden oynamaz
      const a = K.solveElbow(model, q, { o: cam, d }, { side });
      worstFix = Math.max(worstFix, dist(K.dirOf(a.plane, a.elev), K.dirOf(q.plane, q.elev)) * R2D);
      if (Math.abs(depth) > 0.3) { const au = K.solveElbow(model, q, { o: cam, d }); if (au.side !== side) worstFix = 999; }
      // 2) başka bir duruştan: yinelemeyle aynı yöne varır
      const q0 = { ...q, plane: q.plane + 40 * (rnd3() - 0.5), elev: Math.max(1, q.elev + 30 * (rnd3() - 0.5)) };
      const b = K.solveElbow(model, K.clampPose(model, q0), { origin: { x: cam[0], y: cam[1], z: cam[2] }, direction: { x: d[0], y: d[1], z: d[2] } }, { side, iter: 40 });
      if (!b.clamped && !b.miss) {            // dirsek noktası ışının üstünde (kuşak sınırı yükseltmeyle değişebildiği için yön değil nokta ölçülür)
        K.fk(model, b.pose, o); const v = sub(o.pts.elbow, cam); worstConv = Math.max(worstConv, len(sub(v, mulS(d, dot(v, d))))); nConv++;
        if (Math.abs(b.pose.girdleElev - q.girdleElev) < 1e-9 && Math.abs(b.pose.girdleProt - q.girdleProt) < 1e-9) worstSame = Math.max(worstSame, dist(K.dirOf(b.plane, b.elev), K.dirOf(q.plane, q.elev)) * R2D);
      }
      // 3) ıskalayan ışın: küre üzerinde ışına en yakın nokta (merkezden ışına dik)
      const side2 = unit(cross(d, [0.3, 1, 0.2])), cam2 = add(cam, mulS(side2, 3 * model.armLen));
      const c = K.solveElbow(model, q, { o: cam2, d }, { iter: 10 });
      if (c.miss && !c.clamped) { K.fk(model, c.pose, o); worstMiss = Math.max(worstMiss, Math.abs(dot(unit(sub(o.pts.elbow, o.pts.gh)), d))); nMiss++; }
    }
    ok(worstFix < 1e-6, T(`dirsek tutamacı: kendi ışınıyla duruş değişmez (sapma ${worstFix.toExponential(1)} derece)`));
    ok(nConv > 40 && worstConv < 1e-4, T(`dirsek tutamacı: başka duruştan başlayınca dirsek ışının üstüne gelir (${nConv} deneme, uzaklık ${worstConv.toExponential(1)} cm)`));
    ok(worstSame < 1e-3, T(`dirsek tutamacı: kuşak koordinatları aynı kalınca aynı yöne varır (sapma ${worstSame.toExponential(1)} derece)`));
    ok(nMiss > 20 && worstMiss < 1e-3, T(`dirsek tutamacı: ıskalayan ışında küre kenarındaki en yakın nokta (${nMiss} deneme)`));
    // sınır dışı hedef: en yakın izinli yön, sıçrama yok
    const top = K.nearestAllowed(K.dirOf(-90, 174), 0);
    ok(top.clamped && top.elev > 170 && Math.abs(top.plane) < 30, T(`tepede arkaya doğru hedef: kol yukarıda kalır (plane ${top.plane.toFixed(1)}, elev ${top.elev.toFixed(1)})`));
    let worstNear = 0;
    for (let n = 0; n < 60; n++) {
      const p = -180 + 360 * rnd3(), L = K.elevLimit(p), e = Math.min(179.5, L + 1 + 6 * rnd3()), u = K.dirOf(p, e);
      if (e <= L) continue;
      const r = K.nearestAllowed(u, p); let best = -2;
      for (let pp = r.plane - 3; pp <= r.plane + 3; pp += 0.002) { const b = dot(u, K.dirOf(pp, K.elevLimit(pp))); if (b > best) best = b; }
      if (p < -100 && p > -170) ok(Math.abs(r.plane - p) < 1e-4, T('sabit sınırlı bölgede en yakın yön aynı düzlemdedir'));
      worstNear = Math.max(worstNear, (Math.acos(Math.min(1, dot(u, K.dirOf(r.plane, r.elev)))) - Math.acos(Math.min(1, best))) * R2D);
      ok(Math.abs(r.elev - K.elevLimit(r.plane)) < 1e-9, T('sınır dışı hedef sınır eğrisine oturur'));
    }
    ok(worstNear < 1e-3, T(`sınır dışı hedef: sınır eğrisinde yerel en yakın yön (kaba aramaya göre fark ${worstNear.toExponential(1)} derece)`));
    const inside = K.nearestAllowed(K.dirOf(40, 100), 0);
    ok(!inside.clamped && Math.abs(inside.plane - 40) < 1e-9 && Math.abs(inside.elev - 100) < 1e-9, T('izinli hedef değişmeden kalır'));
  }

  // --- sürükleme: el tutamacı ---
  { const rnd4 = rng(1234); let worst = 0, n2 = 0, worstPt = 0;
    for (let n = 0; n < 200; n++) {
      const q = randomPose(model, rnd4);
      K.fk(model, q, o);
      const X = o.pts.wrist.slice(), cam = [X[0] + 300 * (rnd4() - 0.5), X[1] + 200 * (rnd4() - 0.5), X[2] + 120 + 200 * rnd4()], d = unit(sub(X, cam));
      const q0 = { ...q, elbow: model.ranges.elbow[0] + (model.ranges.elbow[1] - model.ranges.elbow[0]) * rnd4() };
      const r = K.solveHand(model, q0, { o: cam, d });
      // çember ışına başka bir açıda da değebilir: yalnız bulunan nokta ışının üstündeyse ve açı farklıysa say
      if (Math.abs(r.elbow - q.elbow) > 1e-4 && r.dist < 1e-6) continue;
      worst = Math.max(worst, Math.abs(r.elbow - q.elbow)); worstPt = Math.max(worstPt, dist(r.point, X)); n2++;
    }
    ok(n2 > 150 && worst < 1e-4, T(`el tutamacı: ışın el bileğinden geçince dirsek açısı geri bulunur (${n2} deneme, sapma ${worst.toExponential(1)} derece)`));
    ok(worstPt < 1e-4, T('el tutamacı: verilen nokta çember üzerindeki el bileği'));
    // sınır: ışın izinli yayın ötesini gösterirse açı uçta kalır
    K.fk(model, { ...rest, elbow: model.ranges.elbow[1] }, o);
    const beyond = rotPoint(o.pts.wrist, o.pts.elbow, o.elbowAxis, 25), cam = add(beyond, [10, 30, 200]);
    const r = K.solveHand(model, { ...rest, elbow: 60 }, { o: cam, d: unit(sub(beyond, cam)) });
    near(r.elbow, model.ranges.elbow[1], 1e-6, T('el tutamacı: fleksiyon sınırının ötesinde uçta kalır'));
    // başka tutamaç noktası (el segmentinde)
    const q = { ...rest, elbow: 75, wristFlex: 20 }; K.fk(model, q, o);
    const X = tr(o.m.hand, probeHand), cam3 = add(X, [-40, 20, 180]);
    const r3 = K.solveHand(model, { ...q, elbow: 30 }, { o: cam3, d: unit(sub(X, cam3)) }, { seg: 'hand', point: probeHand });
    ok(Math.abs(r3.elbow - 75) < 1e-4 || r3.dist < 1e-6, T('el tutamacı: başka nokta ve segmentle de çalışır'));
  }

  // --- süreklilik ---
  // ölçü: her segmentin kendi eklem noktalarının (ve 6 cm ötelenmiş birer noktanın) iki duruş arasındaki yer değiştirmesi
  const off6 = p => add(p, [3.5, 3.5, 3.5]);
  const probes = { clavicle: [J.sc.p, J.ac.p], scapula: [J.ac.p, J.gh.p, ...(model.scapPts ? [model.scapPts.ai, model.scapPts.ts] : [])], humerus: [J.gh.p, J.elbow.p], ulna: [J.elbow.p, J.forearm.q], radius: [J.forearm.p, J.wrist.p], carpProx: [J.wrist.p], hand: [J.wrist.p, probeHand] };
  for (const k of Object.keys(probes)) probes[k] = [...probes[k], ...probes[k].map(off6)];
  const moved = (oa, ob) => { let d = 0; for (const k of Object.keys(probes)) for (const p of probes[k]) d = Math.max(d, dist(tr(oa.m[k], p), tr(ob.m[k], p))); return d; };
  { const rnd5 = rng(555), h = 1e-3; let worst = 0, where = '';
    for (let n = 0; n < 300; n++) {
      const q = randomPose(model, rnd5);
      if (n % 5 === 0) q.elev = n % 10 === 0 ? 1e-4 : Math.min(K.elevLimit(q.plane), 179.999);     // kutupların yakını
      K.fk(model, q, o);
      for (const k of K.COORDS) {
        const q2 = { ...q, [k]: q[k] + h }; K.fk(model, q2, o2);
        const dlt = moved(o, o2) / (h * D2R);
        if (dlt > worst) { worst = dlt; where = `${k} @ ${JSON.stringify(q)}`; }
      }
    }
    // el, SC ekleminden yaklaşık 75 cm uzakta: radyan başına 75-150 cm beklenir (ritim eklenir); sıçrama bunun çok üstüne çıkar
    ok(worst < 200, T(`küçük koordinat değişimi küçük matris değişimi verir (en büyük ${worst.toFixed(0)} cm/rad; ${where})`));
    if (VERBOSE) info.push(T(`süreklilik: en büyük türev ${worst.toFixed(1)} cm/rad`));
    const cont = [];
    // taramalar: çeyrek derecelik adımlarda sıçrama yok (göğüs kafesi çözümü dahil)
    let sweep = 0;
    const step = (qa, qb) => { K.fk(model, qa, o); K.fk(model, qb, o2); sweep = Math.max(sweep, moved(o, o2)); };
    for (const plane of [0, 45, 90, 135, 180, -90, -45]) for (let e = 0; e + 0.25 <= K.elevLimit(plane); e += 0.25) step({ ...rest, plane, elev: e, elbow: 60 }, { ...rest, plane, elev: e + 0.25, elbow: 60 });
    for (const elev of [5, 40, 90, 150]) for (let p = -180; p < 180; p += 0.25) { const e = Math.min(elev, K.elevLimit(p), K.elevLimit(p + 0.25)); step({ ...rest, plane: p, elev: e }, { ...rest, plane: p + 0.25, elev: e }); }
    for (const k of ['girdleElev', 'girdleProt', 'rot', 'elbow', 'forearm', 'wristFlex', 'wristDev']) for (let v = -30; v < 40; v += 0.25) step({ ...rest, plane: 20, elev: 70, [k]: v }, { ...rest, plane: 20, elev: 70, [k]: v + 0.25 });
    cont.push(`tarama ${sweep.toFixed(3)}`);
    ok(sweep < 0.6, T(`taramalarda çeyrek derecelik adım başına en büyük yer değiştirme ${sweep.toFixed(3)} cm (sıçrama yok)`));
    // alt kutup: sarkan kolda düzlemin anlamı yok, matrisler düzleme bağlı olmamalı
    let pole = 0;
    for (const p of [0, 45, 90, 180, -90, -135]) { K.fk(model, { ...rest, plane: 0, elev: 0 }, o); K.fk(model, { ...rest, plane: p, elev: 0 }, o2); pole = Math.max(pole, matDiff(o.mats, o2.mats)); }
    ok(pole < 1e-9, T(`elev = 0 iken matrisler düzleme bağlı değil (${pole.toExponential(1)})`));
    // alt kutuptan geçiş: yön sürekli değişirken (plane 30 -> 210) matrisler de sürekli
    let cross0 = 0;
    for (let s = -2; s < 2; s += 0.05) { const pa = s < 0 ? { plane: 210, elev: -s } : { plane: 30, elev: s }, s2 = s + 0.05, pb = s2 < 0 ? { plane: 210, elev: -s2 } : { plane: 30, elev: s2 }; K.fk(model, { ...rest, ...pa }, o); K.fk(model, { ...rest, ...pb }, o2); cross0 = Math.max(cross0, moved(o, o2)); }
    cont.push(`alt kutup ${cross0.toFixed(4)}`); if (VERBOSE) info.push(T(`süreklilik (cm): ${cont.join(", ")}`));
    ok(cross0 < 0.15, T(`sarkan konumdan geçerken sıçrama yok (0.05 derecelik adımda ${cross0.toFixed(4)} cm)`));
    // -180 / 180 dikişi
    K.fk(model, { ...rest, plane: 179.9995, elev: 30 }, o); K.fk(model, { ...rest, plane: -179.9995, elev: 30 }, o2);
    ok(moved(o, o2) < 2e-3, T(`plane -180 / 180 dikişinde sıçrama yok (${moved(o, o2).toExponential(1)} cm)`));
    K.fk(model, { ...rest, plane: 180, elev: 30 }, o); K.fk(model, { ...rest, plane: -180, elev: 30 }, o2);
    ok(matDiff(o.mats, o2.mats) < 1e-9, T('plane 180 ile -180 aynı duruş'));
  }

  // --- yumuşak geçiş ---
  { const a = K.clampPose(model, { ...rest, plane: 0, elev: 30, elbow: 20 }), b = K.clampPose(model, { ...rest, plane: 180, elev: 30, elbow: 100 });
    const mid = K.lerpPose(model, a, b, 0.5), s = K.lerpPose(model, a, b, 0), e = K.lerpPose(model, a, b, 1);
    ok(mid.elev < 1e-6 && Math.abs(mid.elbow - 60) < 1e-9, T('lerpPose: karşı düzleme geçiş sarkan konumdan geçer'));
    ok(K.COORDS.every(k => s[k] === a[k] && e[k] === b[k]), T('lerpPose: uçlar tam'));
    let jump = 0; K.fk(model, a, o2);
    for (let t = 0.01; t <= 1.0001; t += 0.01) { K.fk(model, K.lerpPose(model, a, b, t), o); jump = Math.max(jump, moved(o, o2)); o2.mats.set(o.mats); }
    ok(jump < 1.2, T(`lerpPose: yüzde birlik adımlarda sıçrama yok (${jump.toFixed(3)} cm)`));
    const c = K.clampPose(model, { ...rest, plane: 90, elev: 170 }), d2 = K.clampPose(model, { ...rest, plane: -90, elev: 40 });
    let inLim = true; for (let t = 0; t <= 1; t += 0.02) { const q = K.lerpPose(model, c, d2, t); if (q.elev > K.elevLimit(q.plane) + 1e-9) inLim = false; }
    ok(inLim, T('lerpPose: ara duruşlar sınırların içinde'));
    // approachPose: yakınsar, kare hızından bağımsız, hız sınırına uyar
    const cur = { ...a }; let steps = 0, done = false;
    while (!done && steps < 2000) { done = K.approachPose(model, cur, b, 1 / 60); steps++; }
    ok(done && K.COORDS.every(k => Math.abs(cur[k] - b[k]) < 1e-9) && steps < 200, T(`approachPose: hedefe varır ve tam oturur (${steps} kare)`));
    const one = { ...a }, two = { ...a };
    K.approachPose(model, one, b, 0.1, { eps: 0 }); K.approachPose(model, two, b, 0.05, { eps: 0 }); K.approachPose(model, two, b, 0.05, { eps: 0 });
    ok(K.poseDistance(model, one, two) < 1e-9, T('approachPose: iki yarım adım = bir tam adım'));
    const lim = { ...a }; K.approachPose(model, lim, b, 0.1, { tau: 0, maxSpeed: 50 });
    ok(Math.abs(Math.abs(lim.elbow - a.elbow) - 5) < 1e-9, T('approachPose: hız sınırı (derece/s)'));
    ok(K.ease(0) === 0 && K.ease(1) === 1 && K.ease(0.5) === 0.5 && K.ease(0.25) < 0.25 && K.pingPong(0) === 0 && K.pingPong(0.5) === 1 && K.pingPong(1) === 0, T('ease ve pingPong uç değerleri'));
  }

  // --- karışık ağırlıklı nokta dönüşümü ---
  { // 170 derecelik pronasyon bükümünde ikili kuaterniyon eksene uzaklığı korur, doğrusal karışım çökertir
    const q = { ...rest, plane: 20, elev: 40, elbow: 80, forearm: rest.forearm + 170 }; K.fk(model, q, o);
    const mid = mulS(add(J.forearm.p, J.forearm.q), 0.5), perp = unit(cross(foreAx, [0, 0, 1])), p = add(mid, mulS(perp, 2));
    const w = [['ulna', 0.5], ['radius', 0.5]];
    const axA = tr(o.m.ulna, J.forearm.p), axD = unit(sub(tr(o.m.ulna, J.forearm.q), axA));
    const dAxis = x => { const v = sub(x, axA); return len(sub(v, mulS(axD, dot(v, axD)))); };
    near(dAxis(K.skinPoint(o, p, w, [0, 0, 0], true)), 2, tol, T('ikili kuaterniyon: 170 derece bükümde eksene uzaklık korunur'));
    ok(dAxis(K.skinPoint(o, p, w, [0, 0, 0], false)) < 0.3, T('doğrusal karışım aynı noktayı eksene çökertir (beklenen)'));
    near(dist(K.skinPoint(o, p, [['ulna', 0.25], ['ulna', 0.75]], [0, 0, 0], false), tr(o.m.ulna, p)), 0, 1e-9, T('aynı segmentin ağırlıkları toplanır'));
    near(dist(K.skinPoint(o, p, [[model.index.radius, 1]]), tr(o.m.radius, p)), 0, 1e-9, T('segment indisle de verilebilir'));
    // merkez çizgisi: tek segmentte uzunluk korunur; dirseğin önünden geçen çizgi fleksiyonda kısalır, arkasından geçen uzar
    const up = unit(sub(J.gh.p, J.elbow.p)), fw = unit(cross(up, unit(J.elbow.axis)));       // öne (fleksiyon yönü)
    const line = side => K.compileLine(model, [0, 0.25, 0.5, 0.75, 1].map(t => ({ p: add(add(J.elbow.p, mulS(up, 12 - 20 * t)), mulS(fw, side * 2.5)), w: t < 0.5 ? [['humerus', 1]] : t > 0.5 ? [['ulna', 1]] : [['humerus', 0.5], ['ulna', 0.5]] })));
    const front = line(1), back = line(-1), rigid = K.compileLine(model, [0, 0.5, 1].map(t => ({ p: add(J.elbow.p, mulS(up, 5 + 10 * t)), w: [['humerus', 1]] })));
    K.fk(model, rest, o); const f0 = K.lineLength(o, front), b0 = K.lineLength(o, back), r0 = K.lineLength(o, rigid);
    near(r0, 10, 1e-9, T('dinlenmede çizgi uzunluğu = dinlenme uzunluğu'));
    K.fk(model, { ...rest, plane: 60, elev: 100, elbow: rest.elbow + 80 }, o);
    ok(K.lineLength(o, front) < f0 - 1 && K.lineLength(o, back) > b0 + 1, T('dirseğin önündeki çizgi fleksiyonda kısalır, arkasındaki uzar'));
    near(K.lineLength(o, rigid), r0, 1e-9, T('tek segmentteki çizginin uzunluğu değişmez'));
    ok(K.skinLine(o, front).length === 15, T('skinLine 3n sayı verir'));
  }
  // --- okuma çizileni gösterir (inceleme K1, K4) ---
  { const el = Math.min(32, K.limits(model, { ...rest, plane: 0, elev: 90 }).girdleElev[1]);
    for (const q of [{ ...rest, girdleElev: 40 }, { ...rest, plane: 0, elev: 90, girdleElev: el }, { ...rest, plane: 0, elev: 180 }, { ...rest, plane: 60, elev: 120, girdleProt: 10 }]) {
      const r = K.readout(model, q), rz = K.realized(K.fk(model, q, o)), name = JSON.stringify({ plane: Math.round(q.plane), elev: Math.round(q.elev), gE: q.girdleElev, gP: q.girdleProt });
      near(r.shoulder.scap + r.shoulder.gh, q.elev, 1e-9, T('okuma: glenohumeral + skapula = yükseltme ' + name));
      near(r.shoulder.scap, rz.scapula.up, 1e-9, T('okuma: skapula payı = çizilen yukarı dönme ' + name));
      near(r.shoulder.scap, K.rhythm(q.elev, q.plane, {}).UR + model.tune.shrugUR * (q.girdleElev - rest.girdleElev), 1e-9, T('okuma: skapula payı = formül + kuşak eşliği ' + name));
      // çizilen yukarı dönme, matristen: skapulanın m0 ekseni, n0 çevresinde (dış dönme ve eğilme dışında) bu kadar dönmüş olmalı
      ok(Math.abs(r.rhythm.scapula.tilt - rz.scapula.tilt) < 1e-9 && Math.abs(r.rhythm.clavicle.retr - rz.clavicle.retr) < 1e-9 && Math.abs(r.rhythm.clavicle.elev - rz.clavicle.elev) < 1e-9 && Math.abs(r.rhythm.scapula.ext - rz.scapula.ext) < 1e-9, T('okuma: rhythm alanı çizilen açılardır (realized) ' + name));
      near(r.rhythmFormula.scapula.up, K.rhythm(q.elev, q.plane, {}).UR, 1e-12, T('okuma: rhythmFormula formülün kendisidir ' + name));
    }
    // matristen bağımsız ölçüm: yalnız kuşak yükselmesinde skapulanın dinlenmeye göre dönme açısı shrugUR * 40'tan küçük olamaz
    K.fk(model, { ...rest, girdleElev: 40 }, o);
    const a = K.readout(model, { ...rest, girdleElev: 40 }), b = K.readout(model, rest);
    near(a.shoulder.scap - b.shoulder.scap, model.tune.shrugUR * 40, 1e-9, T('okuma: 40 derece Elevation skapula payını shrugUR * 40 artırır'));
    ok(angleOf(rotOf(o.m.scapula)) >= model.tune.shrugUR * 40 - 1e-6, T('çizilen skapula gerçekten o kadar dönmüş (matristen)'));
  }
  // --- ikili kuaterniyon işaret zinciri: komşu segment çiftlerinde 0,5 / 0,5 ağırlıklı nokta sıçramaz (inceleme K3) ---
  { const pairs = [['clavicle', 'scapula', J.ac.p], ['scapula', 'humerus', J.gh.p], ['humerus', 'ulna', J.elbow.p], ['ulna', 'radius', J.forearm.p], ['radius', 'hand', J.wrist.p], ['radius', 'carpProx', J.wrist.p], ['thorax', 'scapula', J.ac.p]];
    const lim = K.limits(model, rest), A = { ...rest, plane: -90, elev: 40, rot: -60, elbow: lim.elbow[0], forearm: lim.forearm[0], wristFlex: lim.wristFlex[0], wristDev: lim.wristDev[0] };
    const sweeps = [[A, { ...A, plane: 0, elev: 180, rot: 70, elbow: lim.elbow[1], forearm: lim.forearm[1], wristFlex: lim.wristFlex[1], wristDev: lim.wristDev[1] }],
      [{ ...rest, plane: 0, elev: 0, rot: -60 }, { ...rest, plane: 0, elev: 180, rot: 70 }], [{ ...rest, plane: 90, elev: 0, rot: 95 }, { ...rest, plane: 90, elev: 170, rot: -70 }],
      [{ ...rest, plane: -180, elev: 40 }, { ...rest, plane: 180, elev: 40 }], [{ ...rest, plane: -179, elev: 100, rot: 70 }, { ...rest, plane: 179, elev: 100, rot: -70 }]];
    let worst = 0, where = '';
    for (const [a, b] of sweeps) {
      const prev = pairs.map(() => null), N = 2000, q = {};
      for (let i = 0; i <= N; i++) {
        for (const k of K.COORDS) q[k] = a[k] + (b[k] - a[k]) * i / N;
        K.fk(model, q, o);
        pairs.forEach(([s1, s2, c], j) => {
          const x = K.skinPoint(o, [c[0] + 3, c[1] - 4, c[2] + 2], [[s1, 0.5], [s2, 0.5]], [0, 0, 0], true);
          if (prev[j]) { const d = dist(x, prev[j]); if (d > worst) { worst = d; where = s1 + ' + ' + s2; } }
          prev[j] = x;
        });
      }
    }
    ok(worst < 0.5, T(`ikili kuaterniyon karışımı süreklidir: yarı yarıya ağırlıklı nokta binde yarımlık adımda en çok ${worst.toFixed(3)} cm oynar (${where})`));
  }
  // --- tepe yakınında dirsek tutamacı kolu kendi ekseninde çevirmez (inceleme K5) ---
  { const p0 = { ...rest, plane: -3, elev: 178, rot: 0 }, tgt = K.fk(model, { ...p0, plane: 12 }).pts.elbow.slice();
    const ray = { o: [tgt[0], tgt[1] + 300, tgt[2]], d: [0, -1, 0] };   // yukarıdan bakış: tepe kürenin ortasında, derinlik belirsizliği yok
    const epi = q => { K.fk(model, q, o); return unit(appM(rotOf(o.m.humerus), unit(J.elbow.axis))); };
    const e0 = epi(p0), turn = r => Math.acos(Math.min(1, dot(e0, epi(r.pose)))) * R2D;
    const damped = K.solveElbow(model, p0, ray), free = K.solveElbow(model, p0, ray, { pole: 0 });
    ok(turn(damped) < 8 && Math.abs(damped.pose.plane - p0.plane) < 4, T(`tepe yakınında düzlem sönümü: epikondil hattı ${turn(damped).toFixed(1)} derece döner (sönümsüz ${turn(free).toFixed(1)})`));
    ok(turn(free) > 10, T('sönüm kapalıyken (pole: 0) aynı sürükleme kolu kendi ekseninde çevirir (denetimin kendisi çalışıyor)'));
    const low = K.solveElbow(model, { ...rest, plane: 0, elev: 90 }, { o: add(K.fk(model, { ...rest, plane: 30, elev: 90 }).pts.elbow, [0, 300, 0]), d: [0, -1, 0] });
    ok(Math.abs(low.pose.plane - 30) < 1, T('tepeden uzakta düzlem sönümü yok'));
  }
  return model;
}

// ---------- 1) sabit veri ----------
const fx = fixture();
const model = kinSuite('sabit veri', fx.data);

// sınır fonksiyonları (veriden bağımsız)
near(K.elevLimit(0), 180, 1e-12, 'yükseltme sınırı: Abduktion 180');
near(K.elevLimit(90), 170, 1e-12, 'yükseltme sınırı: Anteversion 170');
near(K.elevLimit(-90), 40, 1e-12, 'yükseltme sınırı: Retroversion 40');
near(K.elevLimit(180), 40, 1e-12, 'yükseltme sınırı: gövde önünde Adduktion 40');
near(K.elevLimit(-180), 40, 1e-12, 'yükseltme sınırı: -180 = 180');
{ let okRange = true, maxStep = 0, prev = K.elevLimit(-180);
  for (let p = -180; p <= 180; p += 0.1) {
    const L = K.elevLimit(p); maxStep = Math.max(maxStep, Math.abs(L - prev)); prev = L;
    const lo = p <= -90 ? 40 : p <= 0 ? 40 : p <= 90 ? 170 : 40, hi = p <= -90 ? 40 : p <= 0 ? 180 : p <= 90 ? 180 : 170;
    if (L < lo - 1e-9 || L > hi + 1e-9) okRange = false;
  }
  ok(okRange, 'yükseltme sınırı düğümler arasında aşma yapmaz');
  ok(maxStep < 0.4, `yükseltme sınırı sürekli (0.1 derecede en çok ${maxStep.toFixed(3)})`);
}
ok(K.rotLimits(0)[0] === -60 && K.rotLimits(0)[1] === 95 && K.rotLimits(30)[1] === 95, 'dönme sınırı: kol yandayken 60 dış, 95 iç');
ok(K.rotLimits(60)[0] === -70 && K.rotLimits(60)[1] === 70 && K.rotLimits(150)[1] === 70, 'dönme sınırı: 60 derece yükseltmeden sonra 70 / 70');
ok(K.rotLimits(45)[1] < 95 && K.rotLimits(45)[1] > 70, 'dönme sınırı: 30-60 arası yumuşak geçiş');
ok(JSON.stringify(K.RANGES) === JSON.stringify({ girdleElev: [-10, 40], girdleProt: [-25, 25], elbow: [-10, 150], forearm: [-85, 85], wristFlex: [-60, 60], wristDev: [-25, 35] }), 'sabit aralıklar SPEC ile aynı');
ok(K.wrap180(190) === -170 && K.wrap180(-180) === 180 && K.wrap180(540) === 180 && K.wrap180(-190) === 170, 'wrap180');

// ritim değerleri: 0 / 90 / 180 (SPEC bölüm 2)
{ const A = (e, p) => K.rhythm(e, p, {}), tbl = [
  ['UR', 0, [0, 25.8, 60]], ['PT', 0, [0, 4.5, 29.7]], ['ER', 0, [0, 5, 20]], ['ER', 90, [0, 2, 8]], ['CE', 0, [0, 9, 12]],
  ['CR', 0, [0, 7.5, 15]], ['CR', 90, [0, 4.5, 9]], ['CP', 0, [0, 4.5, 31.5]], ['AR', 0, [0, 8, 44]], ['AR', 90, [0, 0, 0]], ['GH', 0, [0, 64.2, 120]]];
  for (const [k, plane, v] of tbl) [0, 90, 180].forEach((e, i) => near(A(e, plane)[k], v[i], 1e-9, `ritim ${k} (plane ${plane}) @ ${e}`));
  near(A(30, 0).UR, 3, 1e-12, 'ritim UR @ 30'); near(A(150, 0).UR, 48.6, 1e-9, 'ritim UR @ 150'); near(A(120, 0).CE, 12, 1e-12, 'ritim CE @ 120'); near(A(70, 0).AR, 0, 1e-12, 'ritim AR @ 70');
  ok(K.planeWeight(0) === 1 && K.planeWeight(90) < 1e-30 && K.planeWeight(-90) < 1e-30 && K.planeWeight(180) === 0 && Math.abs(K.planeWeight(45) - 0.5) < 1e-12, 'düzlem ağırlığı: frontal 1, sagittal ve ötesi 0');
  let cont = 0; for (let e = 0; e < 180; e += 0.01) for (const k of ['UR', 'PT', 'ER', 'CE', 'CR', 'CP', 'AR']) cont = Math.max(cont, Math.abs(A(e + 0.01, 30)[k] - A(e, 30)[k]));
  ok(cont < 0.01, 'ritim formülleri sürekli');
}
// ritim matrislerde (düzeltme kapalı): skapula = Ry(dER) Rn0(dUR) Rm0(-dPT), klavikula = Ry(dCR) Re0(dCE) Rc0(-dCP)
{ const m0 = K.createModel(fixture({ withFit: false }).data), o = K.createFk(m0);
  ok(m0.fit === null && m0.notes.some(s => s.includes('thoraxFit yok')), 'thoraxFit yoksa düzeltme kapalı ve not düşülür');
  let worst = 0;
  for (const [plane, elev] of [[0, 90], [0, 180], [90, 170], [45, 120], [-90, 40]]) {
    K.fk(m0, { ...m0.rest, plane, elev }, o);
    const A = K.rhythm(elev, plane, {}), A0 = m0.A0;
    const Rs = mulM(mulM(rotM([0, 1, 0], A.ER - A0.ER), rotM(m0.n0, A.UR - A0.UR)), rotM(m0.m0, -(A.PT - A0.PT)));
    const Rc = mulM(mulM(rotM([0, 1, 0], A.CR - A0.CR), rotM(m0.e0, A.CE - A0.CE)), rotM(m0.c0, -(A.CP - A0.CP)));
    worst = Math.max(worst, matDiff(rotOf(o.m.scapula), Rs), matDiff(rotOf(o.m.clavicle), Rc));
  }
  ok(worst < 1e-12, `düzeltme kapalıyken skapula ve klavikula tam ritim formüllerini izler (${worst.toExponential(1)})`);
  // eşlenik dış dönme: frontal düzlemde 180 derecede humerus 44 derece dışa döner, sagittal düzlemde dönmez
  const tw = (plane, elev) => { K.fk(m0, { ...m0.rest, plane, elev }, o); const a = rotOf(o.m.humerus); K.fk(m0, { ...m0.rest, plane, elev, rot: K.rhythm(elev, plane, {}).AR }, o); return angleOf(mulM([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]], rotOf(o.m.humerus))); };
  near(tw(0, 180), 44, 1e-6, 'eşlenik dış dönme: Abduktion 180 derecede 44 derece');
  near(tw(90, 170), 0, 1e-9, 'eşlenik dış dönme: sagittal düzlemde yok');
  ok(Math.abs(K.fk(m0, { ...m0.rest, girdleElev: 20, girdleProt: -10 }, o).corr[4] - 7) < 1e-9, 'kuşak eşliği düzeltme kapalıyken de uygulanır (TUNE)');
}
// dinlenme okuması (SPEC: dirsek yaklaşık 17, ön kol yaklaşık -85, yükseltme yaklaşık 9)
{ const r = K.readout(model, model.rest);
  ok(Math.abs(r.elbow.value - 17) < 1.5 && r.elbow.key === 'flex' && r.elbow.de === 'Flexion', `dinlenme okuması: dirsek Flexion yaklaşık 17 (${r.elbow.value.toFixed(1)})`);
  ok(Math.abs(r.forearm.value + 85) < 5 && r.forearm.key === 'sup' && r.forearm.de === 'Supination' && Math.abs(r.forearm.abs - 85) < 5, `dinlenme okuması: ön kol Supination yaklaşık 85 (${r.forearm.value.toFixed(1)})`);
  ok(r.shoulder.elev > 6 && r.shoulder.elev < 13 && r.shoulder.key === 'abd' && r.shoulder.de === 'Abduktion', `dinlenme okuması: omuz Abduktion yaklaşık 9 (${r.shoulder.elev.toFixed(1)}, plane ${r.shoulder.plane.toFixed(1)})`);
  near(r.shoulder.scap, 0.1 * r.shoulder.elev, 1e-9, 'dinlenme okuması: skapula payı');
  ok(Math.abs(r.wrist.flex.value) < 1e-9 && Math.abs(r.wrist.dev.value) < 1e-9 && r.girdle.elev.value === 0 && r.shoulder.rot.value === 0, 'dinlenme okuması: el bileği, kuşak ve dönme 0');
  const z = K.readout(model, K.neutralPose());
  ok(z.shoulder.key === 'neutral' && z.shoulder.de === 'Neutralstellung' && z.elbow.value === 0 && z.forearm.value === 0, 'Neutral-Null sıfır duruşu');
  const names = [[0, 'abd'], [40, 'scap'], [90, 'ante'], [135, 'anteAdd'], [180, 'add'], [-135, 'retroAdd'], [-90, 'retro'], [-45, 'abdRetro'], [-10, 'abd'], [-180, 'add']];
  ok(names.every(([p, k]) => K.shoulderName(p, 60) === k), 'omuz duruşunun adı düzlemden');
  const x = K.readout(model, { ...model.rest, plane: 0, elev: 120, rot: -20, elbow: -5, forearm: 30, wristFlex: -25, wristDev: 10, girdleElev: -4, girdleProt: 6 });
  ok(x.shoulder.de === 'Abduktion' && Math.abs(x.shoulder.scap - 35.8) < 1e-9 && Math.abs(x.shoulder.gh - 84.2) < 1e-9 && x.shoulder.cardinal === 'abd', 'okuma: Abduktion 120, Depression 4 = glenohumeral 84.2 + skapula 35.8 (kuşak payı dahil)');
  ok(['ante', 'Anteversion', 'retro', 'Retroversion', 'add', 'Adduktion', 'abd', 'Abduktion', 'ir', 'Innenrotation', 'ar', 'Außenrotation', 'flex', 'Flexion', 'ext', 'Extension', 'pron', 'Pronation', 'sup', 'Supination'].every((k, i, a) => i % 2 || K.TERMS[k] === a[i + 1]), 'TERMS: Almanca hareket adları anahtarlarıyla eşleşir');
  ok(x.shoulder.rot.de === 'Außenrotation' && x.shoulder.rot.abs === 20 && x.elbow.de === 'Extension' && x.forearm.de === 'Pronation' && x.wrist.flex.de === 'Dorsalextension' && x.wrist.dev.de === 'Ulnarabduktion' && x.girdle.elev.de === 'Depression' && x.girdle.prot.de === 'Protraktion', 'okuma: Almanca hareket adları işarete göre');
  near(x.shoulder.coupledER, 20, 1e-9, 'okuma: eşlenik dış dönme');
  ok(Math.abs(x.shoulder.frontal - 120) < 1e-9 && Math.abs(x.shoulder.sagittal) < 1e-9, 'okuma: frontal / sagittal bileşen');
  const rz = K.realized(K.fk(model, { ...model.rest, plane: 0, elev: 120 }));
  ok(Math.abs(rz.scapula.up - 37.2) < 1e-9 && rz.clavicle.retr > 10, 'realized: gerçekleşen kuşak açıları');
}
info.push(`bilgi (sabit veri): dinlenme plane ${model.rest.plane.toFixed(1)}, elev ${model.rest.elev.toFixed(1)}, dirsek ${model.rest.elbow.toFixed(1)}; işaret noktalarından ölçülen ön kol açısı ${fx.measuredForearm.toFixed(0)} (SPEC varsayımı -85..-90)`);
if (model.notes.length) info.push('bilgi (sabit veri): ' + model.notes.join(' | '));

// eksen işaretleri: sabit veride beklenen yönler
{ const J = fx.data.joints;
  ok(J.elbow.axis[0] < -0.9, 'sabit veri: fleksiyon ekseni mediyale bakar (sol kol)');
  ok(J.forearm.dir[1] < -0.9, 'sabit veri: pronasyon ekseni distale bakar (sol kol)');
  ok(J.wrist.flexAxis[0] < -0.9 && J.wrist.devAxis[2] < -0.7, 'sabit veri: el bileği eksenleri (palmar fleksiyon mediyale, ulnar abdüksiyon arkaya bakan eksen)');
}
// veri değişkenleri: yuvarlanmış rest, başka segment sırası, tanınmayan segment, dir alanı yok
{ const r = fixture({ round: true }); const m = K.createModel(r.data), o = K.fk(m, r.data.rest);
  ok(m.warnings.length === 0 && identityDev(o) <= 1e-9, 'yuvarlanmış rest değerleriyle de dinlenme tam birim');
  K.fk(m, { ...m.rest, plane: 35, elev: 95, rot: 12 }, o);
  const E = o.pts.elbow.slice(), cam = [60, 150, 320], d = unit(sub(E, cam));
  const s = K.solveElbow(m, { ...m.rest, plane: 35, elev: 95, rot: 12 }, { o: cam, d });
  ok(dist(K.dirOf(s.plane, s.elev), K.dirOf(35, 95)) * R2D < 1e-6, 'yuvarlanmış veride de dirsek tutamacı yerinde kalır');
}
{ const ord = ['thorax', 'hand', 'carpProx', 'radius', 'ulna', 'humerus', 'scapula', 'clavicle'];
  const a = K.createModel(fixture({ order: ord, extra: true }).data), q = { ...model.rest, plane: 50, elev: 110, elbow: 70, forearm: 20, wristFlex: 15, girdleProt: 10 };
  const oa = K.fk(a, q), ob = K.fk(model, q);
  ok(K.SEGMENTS.every(k => matDiff(oa.m[k], ob.m[k]) < 1e-12) && a.index.hand === 1 && matDiff(oa.mats.subarray(16, 32), ob.m.hand) < 1e-12, 'matrisler verideki segment sırasına göre dizilir');
  ok(matDiff(oa.m.twist, oa.m.ulna) === 0 && a.notes.some(s => s.includes('twist')), 'tanınmayan segment atasıyla birlikte hareket eder');
  ok(Math.abs(K.skinPoint(oa, [25, 100, 0], [['hand', 1]])[0] - K.skinPoint(ob, [25, 100, 0], [['hand', 1]])[0]) < 1e-12, 'ağırlıklı dönüşüm segment sırasından bağımsız');
}
{ const d = fixture().data; delete d.joints.forearm.dir; const m = K.createModel(d);
  ok(dist(m.J.forearmDir, unit(sub(LM.ulnHead, LM.radHead))) < 1e-12 && m.notes.some(s => s.includes('forearm.dir')), 'forearm.dir yoksa radius başı -> ulna başı (sol kolda pronasyon yönü)');
  const bad = fixture().data; delete bad.joints.elbow.axis;
  let threw = false; try { K.createModel(bad); } catch { threw = true; }
  ok(threw, 'eksik zorunlu alan hata verir');
  const off = fixture().data; off.rest.elev += 3; ok(K.createModel(off).warnings.some(s => s.includes('sapıyor')), 'rest ile işaret noktaları uyuşmazsa uyarı');
  const wide = fixture().data; wide.rest.forearm = -89; const mw = K.createModel(wide);
  ok(mw.ranges.forearm[0] === -89 && identityDev(K.fk(mw, K.clampPose(mw, mw.rest))) <= 1e-9, 'aralığın dışındaki dinlenme değeri için aralık genişler');
  ok(K.createModel(fixture().data, { correct: false }).fit === null, 'correct: false düzeltmeyi kapatır');
  const tn = fixture().data; tn.tune = { spineClear: 0, shrugUR: 0 }; const mt = K.createModel(tn);
  ok(mt.ranges.girdleProt[0] === -25 && mt.tune.shrugUR === 0 && mt.tune.shrugTilt === K.TUNE.shrugTilt, 'tune alanı oranları değiştirir; spineClear 0 retraksiyon sınırını kısmaz');
}
ok(model.ranges.girdleProt[0] > -25 && model.ranges.girdleProt[0] <= -10 && model.notes.some(s => s.includes('Retraktion')), `sabit veri: retraksiyon sınırı skapula omurgaya binmeyecek biçimde kısıldı (${-model.ranges.girdleProt[0]} derece)`);

// izleyen segment: dönmez, ebeveyninin "at" noktasıyla birlikte ötelenir (inceleme data-D3)
{ const d = fixture().data, at = [18.5, 132, -1.5];
  d.segments.push({ key: 'f0', parent: 'humerus', at, bones: [] });
  const m = K.createModel(d), o = K.fk(m, m.rest);
  ok(m.followers.length === 1 && !m.notes.some(s => s.includes('f0')) && identityDev(o) <= 1e-9, 'izleyen segment: dinlenmede birim');
  let worstR = 0, worstT = 0, worstDq = 0, worstLin = 0; const rnd = rng(77);
  for (let i = 0; i < 200; i++) {
    const q = randomPose(m, rnd); K.fk(m, q, o);
    const M = o.m.f0, R = rotOf(M), p = tr(o.m.humerus, at);
    worstR = Math.max(worstR, angleOf(R)); worstT = Math.max(worstT, dist(p, add(at, [M[12], M[13], M[14]])));
    const x = [5, 120, 3];
    worstDq = Math.max(worstDq, dist(K.skinPoint(o, x, [['f0', 1]], [0, 0, 0], true), add(x, sub(p, at))));
    // gövde ile izleyen arasındaki karışım doğrusaldır: ağırlık w -> ötelemenin w katı
    worstLin = Math.max(worstLin, dist(K.skinPoint(o, x, [['thorax', 0.7], ['f0', 0.3]], [0, 0, 0], true), add(x, mulS(sub(p, at), 0.3))));
  }
  ok(worstR < 1e-9 && worstT < 1e-9, `izleyen segment: dönme yok, öteleme = ebeveynde "at" noktasının yer değiştirmesi (${worstT.toExponential(1)})`);
  ok(worstDq < 1e-9 && worstLin < 1e-9, `izleyen segment: ikili kuaterniyonu matrisiyle aynı; gövdeyle karışımı doğrusal (${worstLin.toExponential(1)})`);
}

// ---------- 2) veri dosyaları ----------
// Biçim denetimi (SPEC bölüm 3): json alanları ve motion-arm.bin (köşe başına 9 bayt: 4 indis, 4 ağırlık, t)
function checkData(tag, json, bin) {
  const T = s => `[${tag}] ${s}`;
  ok(json.v === 1 && json.side === 'l', T('v = 1, side = l'));
  const keys = (json.segments || []).map(s => s.key);
  ok(K.SEGMENTS.every(k => keys.includes(k)) && new Set(keys).size === keys.length, T('segments: sekiz segmentin hepsi, yinelenmeden'));
  ok((json.segments || []).every(s => s.parent === null ? s.key === 'thorax' : keys.includes(s.parent)), T('segments: parent alanları geçerli'));
  ok(K.COORDS.every(k => typeof (json.rest || {})[k] === 'number'), T('rest: dokuz koordinat sayı'));
  const J = json.joints || {};
  for (const [k, f] of [['elbow', 'axis'], ['wrist', 'flexAxis'], ['wrist', 'devAxis']]) ok(J[k] && Array.isArray(J[k][f]) && Math.abs(len(J[k][f]) - 1) < 1e-3, T(`joints.${k}.${f} birim vektör`));
  if (J.wrist && J.wrist.flexAxis && J.wrist.devAxis) ok(Math.abs(dot(unit(J.wrist.flexAxis), unit(J.wrist.devAxis))) < 0.35, T('el bileği eksenleri birbirine yaklaşık dik'));
  const mv = json.movements || [];
  ok(mv.every(m => m && typeof m.key === 'string' && m.set && Object.keys(m.set).every(k => K.COORDS.includes(k) && typeof m.set[k] === 'number')), T(`movements: ${mv.length} hareket, set alanları geçerli koordinat`));
  const skin = json.skin;
  if (!skin) { info.push(T('skin alanı yok: deri ağırlıkları denetlenmedi')); return; }
  const parts = skin.parts || [], bpv = skin.bytesPerVertex;
  ok(bpv === 9, T('skin.bytesPerVertex = 9'));
  let off = 0, seqOk = true, lineOk = true;
  for (const p of parts) { if (p.offset !== off) seqOk = false; off += p.verts * 9; if (!(p.kind === 'muscle' || p.kind === 'joint') || !Array.isArray(p.chain) || !p.chain.every(k => keys.includes(k))) lineOk = false; }
  ok(seqOk, T('skin.parts: offset değerleri sıralı ve boşluksuz'));
  ok(lineOk, T('skin.parts: kind ve chain alanları geçerli'));
  if (bin) {
    ok(bin.length === off, T(`motion-arm.bin boyutu = köşe sayısı x 9 (${bin.length} / ${off})`));
    let badIdx = 0, badSum = 0, badT = 0;
    for (const p of parts) for (let v = 0; v < p.verts; v++) {
      const b = p.offset + 9 * v; if (b + 9 > bin.length) { badIdx++; break; }
      let s = 0; for (let j = 0; j < 4; j++) { const w = bin[b + 4 + j]; s += w; if (w > 0 && bin[b + j] >= keys.length) badIdx++; }
      if (s !== 255) badSum++;
      if (p.kind === 'joint' && bin[b + 8] !== 0) badT++;
    }
    ok(badIdx === 0, T(`bin: segment indisleri geçerli (${badIdx} bozuk)`));
    ok(badSum === 0, T(`bin: ağırlık toplamı 255 (${badSum} bozuk)`));
    ok(badT === 0, T(`bin: eklem parçalarında t = 0 (${badT} bozuk)`));
  } else info.push(T('motion-arm.bin yok: ağırlık dosyası denetlenmedi'));
  // merkez çizgileri: ağırlıklar tanınan segmentlerde, toplam 1; L0 = dinlenme uzunluğu
  const m = K.createModel(json), o = K.fk(m, m.rest); let badLine = 0, badL0 = 0, nLine = 0;
  for (const p of parts) {
    if (p.kind !== 'muscle') continue;
    if (!Array.isArray(p.line) || p.line.length < 2) { badLine++; continue; }
    try {
      if (p.line.some(s => Math.abs(s.w.reduce((a, w) => a + w[1], 0) - 1) > 0.02)) badLine++;
      const L = K.lineLength(o, K.compileLine(m, p.line)); nLine++;
      if (!(Math.abs(L - p.L0) <= 0.02 * p.L0 + 0.05)) badL0++;
    } catch { badLine++; }
  }
  ok(badLine === 0, T(`kas merkez çizgileri derlenir, ağırlık toplamı 1 (${badLine} bozuk)`));
  ok(badL0 === 0, T(`L0 = merkez çizgisinin dinlenme uzunluğu (${nLine} kas, ${badL0} uyuşmaz)`));
  // çizginin iki ucu tek kemiğe bağlıdır (iki kemiğin karışık merkezi yanlış boy okuması verir: inceleme D1)
  const mixed = parts.filter(p => p.kind === 'muscle' && Array.isArray(p.ends) && p.ends.some(e => Math.max(...e.w.map(w => w[1])) < 0.9)).map(p => p.n);
  ok(mixed.length === 0, T('kas çizgilerinin uçları tek segmentte (karışık: ' + (mixed.join(', ') || 'yok') + ')'));
  // hareket hedefleri izinli aralıkta (inceleme D5)
  const outside = mv.filter(x => { const q = K.applySet(m, { ...m.rest, ...(x.from || {}) }, x.set); return Object.keys(x.set).some(k => Math.abs(q[k] - x.set[k]) > 0.011); }).map(x => x.key);
  ok(outside.length === 0, T('movements: hedefler sınırların içinde (dışında: ' + (outside.join(', ') || 'yok') + ')'));
  // izleyen segmentler ve onlara bağlı parçalar
  ok((json.segments || []).every(x => !('at' in x) || (Array.isArray(x.at) && x.at.length === 3 && keys.includes(x.parent))) && parts.every(p => !p.follow || (keys.includes(p.follow) && p.chain.includes(p.follow))), T('izleyen segment alanları (at, follow) geçerli'));
}
// denetleyicinin kendisi: küçük uydurma veri ve bayt dizisiyle
{ const j = fixture().data; j.movements = [{ key: 'abd', joint: 'schulter', de: 'Abduktion', tr: 'x', set: { plane: 0, elev: 170 }, textbook: [] }];
  const idx = k => j.segments.findIndex(s => s.key === k);
  const L = [0, 0.5, 1].map(t => ({ p: add(LM.elbow, [0, 10 - 20 * t, 2]), w: t < 0.5 ? [['humerus', 1]] : t > 0.5 ? [['ulna', 1]] : [['humerus', 0.5], ['ulna', 0.5]] }));
  j.skin = { file: 'models/motion-arm.bin', bytesPerVertex: 9, parts: [
    { n: 'Deneme kası', kind: 'muscle', verts: 2, offset: 0, sum: 0, chain: ['humerus', 'ulna'], L0: 20, line: L },
    { n: 'Deneme bağı', kind: 'joint', verts: 1, offset: 18, sum: 0, chain: ['humerus'] }] };
  const bin = Uint8Array.from([idx('humerus'), idx('ulna'), 0, 0, 200, 55, 0, 0, 10, idx('ulna'), 0, 0, 0, 255, 0, 0, 0, 250, idx('humerus'), 0, 0, 0, 255, 0, 0, 0, 0]);
  const before = fails; checkData('denetleyici', j, bin);
  ok(fails === before, 'veri denetleyicisi doğru veriyi kabul eder');
  // bozuk veri yakalanmalı (hata sayacı geri alınır)
  const f0 = fails, p0 = passes, errLog = console.error; console.error = () => {};
  const bad = Uint8Array.from(bin); bad[4] = 100; checkData('bozuk', j, bad);
  console.error = errLog; const caught = fails - f0; fails = f0; passes = p0;
  ok(caught >= 1, 'veri denetleyicisi bozuk ağırlık toplamını yakalar');
}
const jsonPath = join(APP, 'public', 'data', 'motion.json'), binPath = join(APP, 'public', 'models', 'motion-arm.bin');
if (existsSync(jsonPath)) {
  let json = null;
  try { json = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { ok(false, 'motion.json okunamadı: ' + e.message); }
  if (json) {
    let real = null;
    try { real = kinSuite('motion.json', json, 1e-6); } catch (e) { ok(false, 'motion.json ile kinematik denetimler çalışmadı: ' + e.message); }
    try { checkData('motion.json', json, existsSync(binPath) ? new Uint8Array(readFileSync(binPath)) : null); } catch (e) { ok(false, 'motion.json biçim denetimi çalışmadı: ' + e.message); }
    if (real) {
      const r = K.readout(real, real.rest), J = json.joints;
      ok(r.elbow.value > 10 && r.elbow.value < 24, `[motion.json] dinlenme: dirsek yaklaşık 17 derece Flexion (${r.elbow.value.toFixed(1)})`);
      ok(r.forearm.value < -65 && r.forearm.value > -95, `[motion.json] dinlenme: ön kol yaklaşık 85 derece Supination (${r.forearm.value.toFixed(1)})`);
      ok(r.shoulder.elev > 5 && r.shoulder.elev < 14 && r.shoulder.key === 'abd', `[motion.json] dinlenme: omuz yaklaşık 9 derece Abduktion (${r.shoulder.elev.toFixed(1)}, plane ${r.shoulder.plane.toFixed(1)})`);
      ok(Math.abs(r.wrist.flex.value) < 15 && Math.abs(r.wrist.dev.value) < 15 && Math.abs(r.shoulder.rot.value) < 10, '[motion.json] dinlenme: el bileği yaklaşık nötr, dönme 10 derecenin altında');
      // K2: rot = 0 Neutral-Null sıfırıdır: sarkan kolda dirsek 90 derece bükülünce ön kol tam öne bakar
      { const o = K.fk(real, { ...K.neutralPose(), elbow: 90 }), e = o.pts.elbow, w = o.pts.wrist, side = Math.atan2(w[0] - e[0], w[2] - e[2]) * R2D;
        ok(Math.abs(side) < 0.1 && w[2] > e[2], `[motion.json] rot = 0, dirsek 90: ön kol tam öne bakar (yana sapma ${side.toFixed(2)} derece)`); }
      // --- inceleme düzeltmeleri: kas okumaları (orta çizgi boyu, hareketin başından sonuna yüzde) ---
      { const part = n => json.skin.parts.find(p => p.n === n), o1 = K.createFk(real);
        const pct = (n, from, to) => { const cl = K.compileLine(real, part(n).line); K.fk(real, K.clampPose(real, { ...real.rest, ...from }), o1); const a = K.lineLength(o1, cl); K.fk(real, K.clampPose(real, { ...real.rest, ...from, ...to }), o1); return 100 * (K.lineLength(o1, cl) / a - 1); };
        // D1: iki kemikten çıkan başın çizgisi karışık merkezden başlamaz (ECU humerus başı fleksiyonda %22 "uzuyordu")
        const ecu = pct('Humeral head of extensor carpi ulnaris', { elbow: 0 }, { elbow: 150 });
        ok(Math.abs(ecu) < 5, `[motion.json] ECU humerus başı dirsek fleksiyonunda yaklaşık eş boy (${ecu.toFixed(1)} %)`);
        // D2: EPB radyoulnar ekseni geçmez
        const epb = part('Extensor pollicis brevis'), epbS = pct('Extensor pollicis brevis', { forearm: 85 }, { forearm: -85 });
        ok(!epb.chain.includes('ulna') && Math.abs(epbS) < 2, `[motion.json] Extensor pollicis brevis ulnaya bağlı değil, supinasyonda boyu değişmez (${epbS.toFixed(1)} %)`);
        // D4 + kabul ölçütü 3'ün klasikleri
        const ssp = pct('Supraspinatus muscle', {}, { plane: 0, elev: 170 });
        ok(ssp < -2, `[motion.json] M. supraspinatus abduksiyonda kısalır (${ssp.toFixed(1)} %)`);
        const cls = [['Long head of biceps brachii', { elbow: 0 }, { elbow: 150 }, -1], ['Brachialis muscle', { elbow: 0 }, { elbow: 150 }, -1], ['Brachioradialis muscle', { elbow: 0 }, { elbow: 150 }, -1], ['Long head of triceps brachii', { elbow: 0 }, { elbow: 150 }, 1],
          ['Acromial part of deltoid muscle', {}, { plane: 0, elev: 170 }, -1], ['Clavicular part of deltoid muscle', {}, { plane: 90, elev: 170 }, -1], ['Teres major muscle', {}, { plane: -90, elev: 40 }, -1],
          ['Supinator', { forearm: 85 }, { forearm: -85 }, -1], ['Pronator quadratus', { forearm: -85 }, { forearm: 85 }, -1], ['Serratus anterior muscle', {}, { plane: 0, elev: 170 }, -1]];
        for (const [n, a, b, sign] of cls) { if (!part(n)) { ok(false, '[motion.json] kas yok: ' + n); continue; } const v = pct(n, a, b); ok(sign * v > 2, `[motion.json] klasik okuma: ${n} ${sign < 0 ? 'kısalır' : 'uzar'} (${v.toFixed(1)} %)`); }
        // D2 + D3: ağırlık dosyasından
        if (existsSync(binPath)) {
          const bin = readFileSync(binPath), si = Object.fromEntries(json.segments.map((x, i) => [x.key, i]));
          const share = (p, seg, pred) => { let n = 0, k = 0; for (let v = 0; v < p.verts; v++) { const b = p.offset + 9 * v; if (!pred(bin[b + 8])) continue; n++; let w = 0; for (let j = 0; j < 4; j++) if (bin[b + j] === si[seg]) w += bin[b + 4 + j]; if (w > 25) k++; } return n ? k / n : 0; };
          for (const n of ['Humeral head of flexor carpi ulnaris']) {   // ECU'da t ulnadaki uzun origoya göre ölçülür, bu ölçüt ona uymaz (geometrik ölçüm: data/work/motion/review/rv-ulnar.mjs)
            const p = part(n), sh = share(p, 'radius', t => t < 0.5 * 255 * (p.tMax || 1));
            ok(sh < 0.02, `[motion.json] ${n}: karnın proksimal yarısında radius ağırlığı yok (ulna boyunca kalır; payı ${(100 * sh).toFixed(1)} %)`);
          }
          const fol = json.segments.filter(x => Array.isArray(x.at));
          ok(fol.length === 5 && fol.every(x => x.parent === 'humerus' && x.bones.length === 0 && real.followers.some(f => f.i === si[x.key])), '[motion.json] beş izleyen segment (humerusun çocuğu, kemiksiz), kinematik modül tanıyor');
          for (const n of ['Latissimus dorsi muscle', 'Teres major muscle', 'Clavicular head of pectoralis major muscle', 'Sternocostal head of pectoralis major muscle', 'Abdominal part of pectoralis major muscle']) {
            const p = part(n), f = p && p.follow, sh = f ? share(p, f, () => true) : 0;
            ok(f && si[f] !== undefined && p.chain.includes(f) && sh > 0.4, `[motion.json] ${n}: karın izleyen segmente kademeli bağlı (köşelerin ${(100 * sh).toFixed(0)} %'inde payı var)`);
          }
        }
        const un = json.skin.unskinned, ids = new Set(json.skin.parts.map(p => p.id));
        ok(Array.isArray(un) && un.length >= 20 && un.every(id => typeof id === 'string' && !ids.has(id)), `[motion.json] skin.unskinned: kipin gizleyeceği ${un ? un.length : 0} parça (deri listesinde olmayan)`);
      }
      // işaret noktaları SPEC'teki beklenen değerlerin 0.5 cm / 5 derece içinde
      const exp = [['sc.p', J.sc.p, LM.sc], ['ac.p', J.ac.p, LM.ac], ['gh.p', J.gh.p, LM.gh], ['elbow.p', J.elbow.p, LM.elbow], ['forearm.p', J.forearm.p, LM.radHead], ['forearm.q', J.forearm.q, LM.ulnHead], ['wrist.p', J.wrist.p, LM.wrist]];
      for (const [n, a, b] of exp) ok(dist(a, b) <= 0.5, `[motion.json] joints.${n} beklenen değerin 0.5 cm içinde (${dist(a, b).toFixed(2)})`);
      const ang = Math.acos(Math.min(1, Math.abs(dot(unit(J.elbow.axis), unit(LM.elbowDir))))) * R2D;
      ok(ang <= 5, `[motion.json] dirsek ekseni beklenen yönün 5 derece içinde (${ang.toFixed(1)})`);
      ok(real.fit !== null, '[motion.json] thoraxFit ve skapula noktaları var: skapula göğüs kafesinde tutuluyor');
      info.push(`bilgi (motion.json): dinlenme plane ${real.rest.plane.toFixed(1)}, elev ${real.rest.elev.toFixed(1)}, dirsek ${real.rest.elbow.toFixed(1)}, ön kol ${real.rest.forearm.toFixed(1)}, el bileği ${real.rest.wristFlex.toFixed(1)} / ${real.rest.wristDev.toFixed(1)}`);
      if (real.notes.length) info.push('bilgi (motion.json): ' + real.notes.join(' | '));
    }
  }
} else info.push('bilgi: public/data/motion.json henüz yok; yalnız sabit veriyle denetlendi');

for (const s of info) console.log(s);
console.log(`${passes} denetim geçti, ${fails} hata`);
process.exit(fails ? 1 : 0);
