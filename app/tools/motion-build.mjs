// Kol hareketi kipinin (src/motion.js, src/motion-kin.js) verisini üretir: sol kol. Bağlayıcı tasarım:
// data/work/motion/SPEC.md (bölüm 2 ve 3). Geometrik bir modeldir, fizik değildir.
//   public/data/motion.json       segmentler ve kemikleri, eklem merkezleri ve eksenleri (işaretleri sınanmış), dinlenme
//                                 duruşunun Neutral-Null açıları, göğüs kafesi elipsoidi, deri parçalarının dizini (sağlama
//                                 toplamı, zincir, orta çizgi, dinlenme boyu) ve hareket listesi (ders kitabı kasları
//                                 locomotor.json'dan)
//   public/models/motion-arm.bin  her deri köşesi için 9 bayt: 4 segment indisi, 4 ağırlık (toplamı 255), t
//                                 (0 = origo ucu, 255 = insersiyo ucu; eklem parçalarında 0). Parça sırası skin.parts,
//                                 köşe sırası uygulamanın yüklediği geometrinin sırasıdır (tools/scene.mjs aynı sırayı ve
//                                 aynı float32 değerlerini verir; skin.parts[].sum ile uygulamada doğrulanır).
// Çalıştırma (app/ içinde):  node tools/motion-build.mjs            (dosyaları yazar, raporu basar)
//                            node tools/motion-build.mjs --dry      (yazmaz)   --brief (kas başına rapor yok)
// Rapor ayrıca data/work/motion/motion-build-report.txt dosyasına yazılır. Bir denetim tutmazsa çıkış kodu 1 olur ve
// dosyalar yazılmaz (--force ile yine de yazılır). Deneme seçenekleri: --no-taut, --cut-at=<sigma>.
//
// Sayılar ölçülür, elle yazılmaz: SPEC'teki değerler yalnız karşılaştırma içindir (EXPECT; 0,5 cm / 5 dereceden fazla
// sapma hata sayılır). Eksen işaretleri uç noktaların hangi yöne gittiğine bakılarak belirlenir (SPEC "Conventions").
//
// Kas ağırlıkları (SPEC "Skin weights"; SPEC'ten ayrıldığı yerler ve gerekçeleri data/work/motion/motion-build-notes.md'de):
//   1. Köşeler konuma göre kaynaklanır (dikişlerdeki çift köşeler aynı kümeye düşer: aynı ağırlığı alırlar). Ayrı
//      kabuklar (latissimus, FDP parçaları, lumbrikaller, interosseuslar) yakınlık kenarlarıyla köprülenir.
//   2. Origo ve insersiyo kümeleri: muscles.json patch.o / patch.i yamalarına 0,3 cm'den yakın köşeler; yama yoksa ya da
//      kasa ulaşmıyorsa aşağıdaki FIX tablosu (kemiğe değme, orta düzlem, kasın serbest ucu, ortak kirişe karışma).
//      Birden çok kemiğe yayılan yerde (ulna + membran + radius) iğneler uzaklığa göre karışıktır.
//   3. t = origo kümesine jeodezik uzaklık / (origoya + insersiyoya uzaklık): kalınlaşma eğrisi ve orta çizgi bununla.
//   4. Yol: en proksimal ve en distal tutunma segmenti arasındaki segmentler. Aradaki humerus, ulna, radius her zaman
//      yoldadır (kas onların boyunca uzanır); klavikula ve skapula yalnız kas onlara tutunuyorsa (göğüsten skapulaya ya
//      da humerusa giden kas klavikulanın 30 derecelik eksen dönmesini izlememeli).
//   5. Eklem geçişi: kasın o eklem merkezine / eksenine en yakın geçtiği kesitin çevresi. Kuşak = uzaklığı en küçük
//      uzaklıktan 2,5 cm'den fazla büyümeyen bitişik kesitler, en çok 0,24 genişlikte (yarı genişlik 0,12), en yakın
//      kesiti ortalayarak; komşu geçişler üst üste binmez. Konum olarak sigma kullanılır (yolun iki ucundaki tutunma
//      kümelerine göre; tek kemikli origo ve insersiyoda t ile aynıdır). Sonraki segmentin ağırlığı kuşakta smoothstep.
//      Ayrı kurallar: ön kol dönmesi (ulna -> radius) komşu kuşakların arasındaki bütün aralığa yayılır (170 derecelik
//      büküm dar bir kuşağa sıkışmasın); göğüs <-> klavikula / skapula arasında eklem merkezi yoktur, kasın serbest
//      boyunun tamamı geçiştir; koltuk altı kıvrımı kaslarında (FIX: cut) geçiş anidir.
//   6. Tutunma köşeleri kendi kemiğine katı bağlıdır (iğne). İğneler serbest ağırlıkla çelişiyorsa fark, ağ üzerinde
//      perdelenmiş (0,6-2,5 cm'de sönen) harmonik bir düzeltmeyle çevreye yayılır: yırtılma olmaz.
//   7. Bir köşe yalnız ağaçta komşu segmentleri karıştırır (routeAdjacent): ikili kuaterniyon karışımı 180 dereceyi
//      aşan bağıl dönmede sıçrar. Tek istisna göğüs + skapula (kuşak kasları).
//   8. Orta çizgi: t'ye göre 12 örnek (alan ağırlıklı ağırlık merkezleri) ve o dilimin ağırlıkları; iki ucu tutunma
//      yerlerinin merkezleridir; omuz geçişinde gergindir (tautShoulder); L0 = dinlenme boyu. ends = iki uç (düz çizgi).
// Eklem parçaları: değdikleri segmentlerin kemiklerine uzaklıktan ağırlık (0,15 cm içindeki köşe o kemiğe katı), t = 0;
// yanlış kemiği seçecek parçalar JOINT_FIX tablosunda.
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene } from './scene.mjs';
import { clusterByPosition } from './geom.mjs';

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry'), BRIEF = ARGS.has('--brief'), FORCE = ARGS.has('--force');
const OUT_JSON = 'public/data/motion.json', OUT_BIN = 'public/models/motion-arm.bin', WORK = '../data/work/motion/';
const t0 = Date.now();

// ---------- rapor ----------
const lines = [], fails = [], warns = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const fail = s => { fails.push(s); say('  HATA: ' + s); };
const warn = s => { warns.push(s); say('  uyarı: ' + s); };

// ---------- vektörler ----------
import { sub, add, mul, dot, cross, len, norm, DEG, angle, perp, mean, rd, R, f2, smooth, rotAbout, solve, sphereFit, trimmedSphere, pca, longAxis, basis, revFit, verts } from './motion-geom.mjs';

// ---------- sahne ----------
const { meta, parts } = await loadScene({
  files: ['bones', 'joints', 'muscles', 'attach', 'attachm'],
  keep: it => (it.s === 'bone' && it.sub !== 'attach' && it.x !== 'f') || (it.sd === 'l' && it.x !== 'f'),
});
const G = meta.groups;
const gpath = g => { const a = []; while (g >= 0) { a.unshift(G[g].n); g = G[g].p; } return a.join(' > '); };
for (const p of parts) p.path = gpath(p.g);
const cards = JSON.parse(fs.readFileSync('public/data/muscles.json', 'utf8')).muscles;
const loco = JSON.parse(fs.readFileSync('public/data/locomotor.json', 'utf8'));

say('motion-build: kol hareketi verisi (sol kol)');
// Uygulamanın köşe sırası varsayımı (model.js _loadFile): her düğümde tek ağ ve tek ilkel, düğümde dönme yok.
// scene.mjs o ilkeli aynı sırayla okur ve dünya konumunu aynı işlem sırasıyla float32'ye çevirir.
for (const f of ['bones', 'joints', 'muscles']) {
  const b = fs.readFileSync(`public/models/${f}.glb`); const n = b.readUInt32LE(12);
  const j = JSON.parse(b.toString('utf8', 20, 20 + n));
  const multi = j.meshes.filter(m => m.primitives.length !== 1).length, rot = j.nodes.filter(nd => nd.rotation || nd.matrix || nd.children).length;
  if (multi || rot) fail(`${f}.glb: ${multi} ağda birden çok ilkel, ${rot} düğümde dönme / matris / çocuk: köşe sırası varsayımı geçersiz`);
}

function prep(p) {
  if (p.bvh) return p;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.P, 3)); g.setIndex(new THREE.BufferAttribute(p.I, 1));
  p.bvh = new MeshBVH(g);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.P.length; k += 3) for (let a = 0; a < 3; a++) { const v = p.P[k + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  p.mn = mn; p.mx = mx;
  return p;
}
const _v = new THREE.Vector3(), _hit = {};
const nearBox = (p, x, m) => x[0] > p.mn[0] - m && x[0] < p.mx[0] + m && x[1] > p.mn[1] - m && x[1] < p.mx[1] + m && x[2] > p.mn[2] - m && x[2] < p.mx[2] + m;
const dist = (p, x) => { prep(p).bvh.closestPointToPoint(_v.set(x[0], x[1], x[2]), _hit); return _hit.distance; };
const closest = (p, x) => { prep(p).bvh.closestPointToPoint(_v.set(x[0], x[1], x[2]), _hit); return { d: _hit.distance, q: [_hit.point.x, _hit.point.y, _hit.point.z] }; };

// ---------- segmentler ----------
// f0..f4: izleyen segmentler (FIX: cut kasları başına bir tane). Dönmezler; humerustaki insersiyo merkeziyle birlikte
// ötelenirler (motion-kin.js: segments[].at). Kemikleri yoktur.
const NFOLLOW = 5, FOLLOWERS = [];
const SEGS = ['thorax', 'clavicle', 'scapula', 'humerus', 'ulna', 'radius', 'carpProx', 'hand', ...Array.from({ length: NFOLLOW }, (_, i) => 'f' + i)];
const PARENT = { thorax: null, clavicle: 'thorax', scapula: 'clavicle', humerus: 'scapula', ulna: 'humerus', radius: 'ulna', carpProx: 'radius', hand: 'radius' };
for (let i = 0; i < NFOLLOW; i++) PARENT['f' + i] = 'humerus';
const SI = Object.fromEntries(SEGS.map((k, i) => [k, i]));
const NS = SEGS.length;
// kemik adı -> segment (kural); elin kemikleri: proksimal sıra ayrı, gerisi (distal sıra, metakarplar, parmaklar) "hand"
const segOfArmBone = n => n === 'Clavicle' ? 'clavicle' : n === 'Scapula' ? 'scapula' : n === 'Humerus' ? 'humerus' : n === 'Ulna' ? 'ulna' : n === 'Radius' ? 'radius'
  : /^(Scaphoid|Lunate|Triquetrum|Pisiform) bone$/.test(n) ? 'carpProx'
    : /^(Trapezium|Trapezoid|Capitate|Hamate) bone$/.test(n) || / metacarpal bone$/.test(n) || /^(Proximal|Middle|Distal) phalanx of \w+ finger of hand$/.test(n) ? 'hand' : null;
const armBones = parts.filter(p => p.sd === 'l' && p.s === 'bone' && p.sub !== 'attach' && p.path.startsWith('Bones of upper limb'));
const staticBones = parts.filter(p => p.s === 'bone' && p.sub !== 'attach' && !armBones.includes(p));
for (const b of armBones) { b.seg = segOfArmBone(b.n); if (!b.seg) fail(`segmenti olmayan kol kemiği: ${b.n}`); }
for (const b of staticBones) b.seg = 'thorax';       // hareket etmeyen her şey (gövde, baş, sağ kol, bacaklar)
const allBones = [...armBones, ...staticBones]; for (const b of allBones) prep(b);
const segBones = Object.fromEntries(SEGS.map(k => [k, armBones.filter(b => b.seg === k)]));
const B = n => { const b = armBones.find(x => x.n === n); if (!b) throw new Error('kemik yok: ' + n); return b; };
const staticB = n => staticBones.find(x => x.n === n && x.sd !== 'r');
if (armBones.length !== 32) fail(`sol kol kemiği sayısı ${armBones.length}, beklenen 32`);
{ const seen = new Map(); for (const b of armBones) seen.set(b.n, (seen.get(b.n) || 0) + 1); for (const [n, c] of seen) if (c !== 1) fail(`kemik ${n} ${c} kez`); }

// en yakın kemik (segment için). list verilirse yalnız o kemikler.
function nearestBone(x, maxD = 3, list = allBones) {
  let best = maxD, bb = null;
  for (const b of list) { if (!nearBox(b, x, best)) continue; const d = dist(b, x); if (d < best) { best = d; bb = b; } }
  return { b: bb, d: best };
}


const hum = B('Humerus'), sca = B('Scapula'), cla = B('Clavicle'), radB = B('Radius'), uln = B('Ulna');
const cap = B('Capitate bone'), lun = B('Lunate bone'), scp = B('Scaphoid bone'), mc3 = B('Third metacarpal bone');
const armJoints = parts.filter(p => p.sd === 'l' && p.s === 'joint' && p.path.startsWith('Joints of upper limb'));
if (armJoints.length !== 73) fail(`sol kol eklem parçası sayısı ${armJoints.length}, beklenen 73`);
const jointPart = n => { const p = armJoints.find(j => j.n === n); if (!p) throw new Error('eklem parçası yok: ' + n); return p; };

const LM = {};
// SC ve AC: eklem diskinin ağırlık merkezi
LM.sc = mean(verts(jointPart('Articular disc of sternoclavicular joint')));
LM.ac = mean(verts(jointPart('Articular disc of acromioclavicular joint')));
// humerus başı: skapulaya bakan proksimal köşelere küre; sonra o küreye 0,15 cm'den yakın proksimal köşelerle yeniden
{
  const hv = verts(hum), top = Math.max(...hv.map(x => x[1])), prox = hv.filter(x => x[1] > top - 7);
  const f1 = trimmedSphere(prox.filter(x => dist(sca, x) < 2.0));
  const f2 = trimmedSphere(prox.filter(x => Math.abs(len(sub(x, f1.c)) - f1.r) < 0.15));
  LM.gh = f2.c; LM.ghR = f2.r; LM.ghRms = f2.rms; LM.ghN = f2.n;
  const gl = verts(sca).filter(x => len(sub(x, f2.c)) < f2.r + 0.6), g = pca(gl);
  let nrm = g.axes[2].v; if (dot(nrm, sub(f2.c, g.c)) < 0) nrm = mul(nrm, -1);
  LM.glenoid = g.c; LM.glenoidN = nrm;
}
// dirsek fleksiyon ekseni: troklea + kapitulumun dönel yüzeyi; nokta = epikondillerin orta noktasının eksendeki izdüşümü
{
  const hv = verts(hum), bot = Math.min(...hv.map(x => x[1])), d8 = hv.filter(x => x[1] < bot + 8);
  let me = d8[0], le = d8[0]; for (const x of d8) { if (x[0] < me[0]) me = x; if (x[0] > le[0]) le = x; }
  const art = hv.filter(x => x[1] < bot + 6 && (dist(uln, x) < 1.0 || dist(radB, x) < 1.0));
  const epi = norm(sub(le, me)), fit2 = P => { const c = revFit(P, epi, 45); return revFit(P, c.d, 1.5, 0.25, 20); };   // kaba arama (1 x 6 derece), sonra ince (0,25 derece)
  const f = fit2(art);
  const on = ref => add(mul(f.e1, f.c2[0]), add(mul(f.e2, f.c2[1]), mul(f.d, dot(ref, f.d))));
  LM.epiMed = me; LM.epiLat = le; LM.elbow = on(mul(add(me, le), 0.5)); LM.elbowLine = f.d; LM.elbowRms = f.rms; LM.elbowN = art.length;
  LM.elbowEnds = [on(me), on(le)];     // eksen parçası: epikondillerin izdüşümleri; orta noktası LM.elbow
  const notch = verts(uln).filter(x => x[1] > bot - 4 && dist(hum, x) < 0.6);
  LM.elbowNotchLine = fit2(notch).d;
}
// ön kol: radius başı (proksimal uçtan 0,3-1,0 cm aşağıdaki köşelerin merkezi), ulna başı (distal uçtan 0,4-1,6 cm yukarıdaki
// köşelere küre), stiloidler (gövde ekseninde en distal köşe)
const rAx = longAxis(radB), uAx = longAxis(uln), hAx = longAxis(hum);
{
  const ra = verts(radB), ua = verts(uln), tR = ra.map(x => dot(x, rAx.v)), tU = ua.map(x => dot(x, uAx.v));
  const rTop = Math.max(...tR), rBot = Math.min(...tR), uBot = Math.min(...tU);
  LM.radHead = mean(ra.filter((x, i) => tR[i] < rTop - 0.3 && tR[i] > rTop - 1.0));
  const uh = trimmedSphere(ua.filter((x, i) => tU[i] > uBot + 0.4 && tU[i] < uBot + 1.6));
  LM.ulnHead = uh.c; LM.ulnHeadR = uh.r;
  LM.radSty = ra[tR.indexOf(rBot)]; LM.ulnSty = ua[tU.indexOf(uBot)];
  LM.radDistal = mean(ra.filter((x, i) => tR[i] > rBot + 0.5 && tR[i] < rBot + 2.0));   // distal radius kesitinin merkezi
}
// el bileği merkezi: kapitatum başı (lunatum ya da skafoide 0,5 cm'den yakın kapitatum köşelerine küre)
{
  const f = trimmedSphere(verts(cap).filter(x => dist(lun, x) < 0.5 || dist(scp, x) < 0.5));
  LM.wrist = f.c; LM.wristR = f.r; LM.wristRms = f.rms;
  const a = longAxis(mc3), mv = verts(mc3), t = mv.map(x => dot(sub(x, a.c), a.v)), tmin = Math.min(...t), tmax = Math.max(...t);
  LM.mc3Head = mean(mv.filter((x, i) => t[i] < tmin + 0.15 * (tmax - tmin)));   // 3. metakarpın distal ucu (baş)
  LM.mc3Axis = mul(a.v, -1);                                                    // distale bakan gövde ekseni
  LM.pisTri = sub(mean(verts(B('Pisiform bone'))), mean(verts(B('Triquetrum bone'))));   // avuç yönü (pisiform triquetrumun palmarinde)
}
// skapula işaret noktaları (ritmin eksenleri ve göğüs kafesi denetimi için; motion-kin.js joints.scapula'yı okur)
{
  const sv = verts(sca);
  LM.ai = sv.reduce((a, b) => (b[1] < a[1] ? b : a));                           // angulus inferior: en alt köşe
  LM.ts = sv.reduce((a, b) => (b[0] < a[0] ? b : a));                           // trigonum spinae: en mediyal köşe (spina kökü)
  const acr = sv.filter(x => x[1] > LM.glenoid[1] + 1.5 && x[0] > LM.gh[0] - 2.5);
  LM.aa = acr.reduce((a, b) => (b[0] - b[2] > a[0] - a[2] ? b : a));            // angulus acromialis: akromiyonun arka-yan köşesi
  LM.as = sv.filter(x => x[0] < LM.ts[0] + 3).reduce((a, b) => (b[1] > a[1] ? b : a));   // angulus superior
  LM.mb = [];                                                                   // mediyal kenar örnekleri (2 cm aralıkla)
  for (let y = LM.ai[1] + 2; y < LM.as[1] - 0.5; y += 2) { const sl = sv.filter(x => Math.abs(x[1] - y) < 0.6); if (sl.length) LM.mb.push(sl.reduce((a, b) => (b[0] < a[0] ? b : a))); }
  LM.coracoid = sv.reduce((a, b) => (b[2] > a[2] ? b : a));
}

// ---------- beklenen değerlerle karşılaştırma (SPEC bölüm 2; map-data.md bölüm 5) ----------
const EXPECT = {
  sc: [1.67, 139.95, 3.95], ac: [15.09, 141.55, -3.83], gh: [16.71, 138.24, -2.67], elbow: [21.89, 110.52, -3.47],
  radHead: [23.98, 108.73, -3.13], ulnHead: [24.80, 86.83, 1.52], wrist: [26.46, 84.77, 1.95], radSty: [28.66, 85.65, 1.77], ulnSty: [24.45, 85.57, 1.21],
};
const EXPECT_GH_R = 2.23, EXPECT_ELBOW_DIR = [0.93, 0.26, -0.25], EXPECT_FOREARM_DIR = [-0.04, 0.98, -0.21];
say('\n== İşaret noktaları (ölçülen | beklenen | fark) ==');
for (const [k, e] of Object.entries(EXPECT)) {
  const d = len(sub(LM[k], e));
  say(`  ${k.padEnd(8)} [${R(LM[k], 2).join(', ')}] | [${e.join(', ')}] | ${f2(d)} cm`);
  if (d > 0.5) fail(`${k}: beklenenden ${f2(d)} cm uzak (sınır 0,5 cm)`);
}
{
  say(`  humerus başı yarıçapı ${f2(LM.ghR)} (beklenen ${EXPECT_GH_R}), rms ${f2(LM.ghRms)}, ${LM.ghN} köşe`);
  if (Math.abs(LM.ghR - EXPECT_GH_R) > 0.2) fail(`humerus başı yarıçapı ${f2(LM.ghR)}: beklenen ${EXPECT_GH_R}`);
  const a = Math.min(angle(LM.elbowLine, EXPECT_ELBOW_DIR), 180 - angle(LM.elbowLine, EXPECT_ELBOW_DIR));
  say(`  dirsek ekseni doğrultusu [${R(LM.elbowLine, 3).join(', ')}] | beklenen ±[${EXPECT_ELBOW_DIR.join(', ')}] | ${f2(a)} derece (oturtma rms ${f2(LM.elbowRms)}, ${LM.elbowN} köşe; ulna çentiğinden bulunan eksenle ${f2(Math.min(angle(LM.elbowLine, LM.elbowNotchLine), 180 - angle(LM.elbowLine, LM.elbowNotchLine)))} derece)`);
  if (a > 5) fail(`dirsek ekseni beklenenden ${f2(a)} derece sapıyor (sınır 5)`);
  const fd = norm(sub(LM.radHead, LM.ulnHead)), b = angle(fd, EXPECT_FOREARM_DIR);
  say(`  ön kol ekseni (distalden proksimale) [${R(fd, 3).join(', ')}] | beklenen [${EXPECT_FOREARM_DIR.join(', ')}] | ${f2(b)} derece, boy ${f2(len(sub(LM.radHead, LM.ulnHead)))} cm`);
  if (b > 5) fail(`ön kol ekseni beklenenden ${f2(b)} derece sapıyor (sınır 5)`);
}

// ---------- yazılacak eklem verisi: önce yuvarla, türetilen her şey yuvarlanmış değerlerden hesaplanır ----------
const J = {
  sc: R(LM.sc), ac: R(LM.ac), gh: R(LM.gh), elbow: R(LM.elbow), radHead: R(LM.radHead), ulnHead: R(LM.ulnHead), wrist: R(LM.wrist),
};
const styMid = mul(add(LM.radSty, LM.ulnSty), 0.5);

// ---------- eksen işaretleri: uç noktanın gittiği yöne bakılır ----------
say('\n== Eksen işaretleri (uç noktası sınaması, +5 derece) ==');
function signed(name, axis0, centre, probe, tests) {
  // tests: [[ad, yön vektörü ya da ölçüt işlevi]]; hepsi aynı işareti vermeli
  const ax = norm(axis0), moved = sub(rotAbout(probe, centre, ax, 5), probe);
  const votes = tests.map(([label, t]) => [label, typeof t === 'function' ? t(rotAbout(probe, centre, ax, 5)) : dot(moved, t)]);
  const pos = votes.filter(v => v[1] > 0).length;
  if (pos !== 0 && pos !== votes.length) fail(`${name}: işaret sınamaları çelişiyor: ${votes.map(v => v[0] + ' ' + f2(v[1])).join(', ')}`);
  const out = pos === votes.length ? ax : mul(ax, -1);
  say(`  ${name.padEnd(15)} [${R(out, 3).join(', ')}]  (${pos === votes.length ? 'aday eksen korundu' : 'aday eksen ters çevrildi'}; ${votes.map(v => v[0] + ' ' + (pos === votes.length ? '' : '-> ') + f2(pos === votes.length ? v[1] : -v[1])).join(', ')})`);
  return out;
}
// Fleksiyon: el bileği omza yaklaşır ve öne gider
const elbowAxis = signed('elbow.axis', LM.elbowLine, J.elbow, styMid, [
  ['omza yaklaşma (cm)', q => len(sub(styMid, J.gh)) - len(sub(q, J.gh))], ['öne (+z, cm)', [0, 0, 1]]]);
// Pronasyon (supinasyondaki dinlenme duruşundan): radius stiloidi avuç tarafına / öne ve ulnaya doğru gider
const palmar0 = norm(perp(LM.pisTri, norm(sub(J.ulnHead, J.radHead))));
const forearmDir = signed('forearm.dir', sub(J.ulnHead, J.radHead), J.radHead, LM.radSty, [
  ['avuç yönüne (cm)', palmar0], ['öne (+z, cm)', [0, 0, 1]]]);
// El bileği çerçevesi: F = ön kolun uzun ekseni (dirsek noktası -> stiloidlerin ortası), r = radyoulnar doğrultu (F'ye dik)
const Faxis = norm(sub(styMid, J.elbow));
const ruLine = norm(perp(sub(LM.ulnSty, LM.radSty), Faxis));          // radiustan ulnaya
const palmar = norm(perp(LM.pisTri, Faxis));
const flexAxis = signed('wrist.flexAxis', ruLine, J.wrist, LM.mc3Head, [['avuç yönüne (cm)', palmar], ['öne (+z, cm)', [0, 0, 1]]]);
const devAxis = signed('wrist.devAxis', cross(Faxis, ruLine), J.wrist, LM.mc3Head, [['ulnaya doğru (cm)', ruLine]]);
if (Math.abs(dot(flexAxis, devAxis)) > 1e-9) fail('wrist.flexAxis ile wrist.devAxis dik değil');
const AX = { elbow: R(elbowAxis, 9), forearm: R(forearmDir, 9), flex: R(flexAxis, 9), dev: R(devAxis, 9) };

// ---------- dinlenme duruşu (Neutral-Null derecesi) ----------
say('\n== Dinlenme duruşu (Neutral-Null derecesi) ==');
const rest = { plane: 0, elev: 0, rot: 0, girdleElev: 0, girdleProt: 0, elbow: 0, forearm: 0, wristFlex: 0, wristDev: 0 };
{
  // humerus yönü d = baş merkezi -> dirsek ekseni parçasının orta noktası (yazılan, yuvarlanmış noktalardan)
  const d = norm(sub(J.elbow, J.gh));
  rest.elev = Math.acos(Math.max(-1, Math.min(1, -d[1]))) * DEG; rest.plane = Math.atan2(d[2], d[0]) * DEG;
  say(`  humerus: elev ${f2(rest.elev)} (kol yana ${f2(rest.elev)} derece açık), plane ${f2(rest.plane)} (0 = yana, + = öne); rot = 0 tanım gereği dinlenme bükümüdür`);
  say(`           (karşılaştırma: gövde ekseninin [orta %60, PCA] düşeyle açısı ${f2(angle(hAx.v, [0, 1, 0]))} derece)`);
  // dirsek: fleksiyon ekseni çevresinde, humerus yönü ile ön kol yönü (dirsek noktası -> stiloidlerin ortası) arasındaki açı
  const ax = AX.elbow, dp = perp(d, ax), fp = perp(norm(sub(styMid, J.elbow)), ax);
  rest.elbow = Math.atan2(dot(ax, cross(dp, fp)), dot(dp, fp)) * DEG;
  const hp = perp(mul(hAx.v, -1), ax), alt = Math.atan2(dot(ax, cross(hp, fp)), dot(hp, fp)) * DEG;
  say(`  elbow: ${f2(rest.elbow)} fleksiyon (eklem merkezleri çizgisi: baş merkezi -> dirsek noktası -> stiloidlerin ortası)`);
  say(`           (karşılaştırma: humerusun gövde eksenine göre ${f2(alt)}; SPEC "yaklaşık 17" bu ikinci ölçüdür. Neutral-Null ölçümü`);
  say(`            akromiyon - epikondil - stiloid hattıyla yapıldığı için eklem merkezleri çizgisi saklandı)`);
  // ön kol: Neutral-Null sıfırı = sarkan kolda başparmak öne bakar (radius ulnanın önünde). Ön kol ekseni çevresinde, öne
  // bakan doğrultudan (göğüs +Z) distal radyoulnar doğrultuya (ulna başı merkezi -> distal radius kesitinin merkezi) açı.
  const fa = AX.forearm, ant = norm(perp([0, 0, 1], fa)), T = norm(perp(sub(LM.radSty, LM.ulnSty), fa));
  rest.forearm = Math.atan2(dot(fa, cross(ant, T)), dot(ant, T)) * DEG;
  const T2 = norm(perp(sub(LM.radDistal, J.ulnHead), fa)), viaCen = Math.atan2(dot(fa, cross(ant, T2)), dot(ant, T2)) * DEG;
  const ref2 = norm(perp(cross(fa, AX.elbow), fa)), ref2s = dot(ref2, [0, 0, 1]) < 0 ? mul(ref2, -1) : ref2;
  const viaElbow = Math.atan2(dot(fa, cross(ref2s, T)), dot(ref2s, T)) * DEG;
  say(`  forearm: ${f2(rest.forearm)} (${rest.forearm < 0 ? 'supinasyon' : 'pronasyon'} ${f2(Math.abs(rest.forearm))}); sıfır = sarkan kolda başparmak öne (Neutral-Null duruşu); ölçü: stiloid doğrultusu (ulna -> radius, ISB işaret noktaları)`);
  say(`           (karşılaştırma: ulna başı merkezi -> distal radius kesiti doğrultusuyla ${f2(viaCen)}; dirsek fleksiyon düzlemine göre ${f2(viaElbow)}: modelde dirsek ekseni frontal düzlemden`);
  say(`            ${f2(Math.atan2(-AX.elbow[2] * Math.sign(AX.elbow[0]), Math.abs(AX.elbow[0])) * DEG)} derece içe dönüktür, rot = 0 tanımı bunu sıfır sayar)`);
  // el bileği: el ekseni H (bilek merkezi -> 3. metakarp başı) ile F arasındaki açının iki bileşeni
  const H = norm(sub(LM.mc3Head, J.wrist));
  rest.wristFlex = Math.atan2(dot(H, cross(AX.flex, Faxis)), dot(H, Faxis)) * DEG;
  rest.wristDev = Math.atan2(dot(H, cross(AX.dev, Faxis)), dot(H, Faxis)) * DEG;
  const H2 = LM.mc3Axis;
  say(`  wristFlex: ${f2(rest.wristFlex)} (+ = Palmarflexion), wristDev: ${f2(rest.wristDev)} (+ = Ulnarabduktion); el ekseni = bilek merkezi -> 3. metakarp başı`);
  say(`           (karşılaştırma: 3. metakarpın gövde ekseniyle ${f2(Math.atan2(dot(H2, cross(AX.flex, Faxis)), dot(H2, Faxis)) * DEG)} / ${f2(Math.atan2(dot(H2, cross(AX.dev, Faxis)), dot(H2, Faxis)) * DEG)})`);
  if (!(rest.elev > 2 && rest.elev < 20)) fail(`rest.elev ${f2(rest.elev)}: beklenen yaklaşık 9`);
  if (!(rest.elbow > 5 && rest.elbow < 25)) fail(`rest.elbow ${f2(rest.elbow)}: beklenen yaklaşık 17`);
  if (!(rest.forearm < -70 && rest.forearm > -100)) fail(`rest.forearm ${f2(rest.forearm)}: beklenen yaklaşık -85`);
  if (Math.abs(rest.wristFlex) > 15 || Math.abs(rest.wristDev) > 15) fail(`el bileği dinlenme açıları büyük: ${f2(rest.wristFlex)} / ${f2(rest.wristDev)}`);
  if (Math.abs(rest.elbow - 17) > 5) warn(`rest.elbow ${f2(rest.elbow)}, SPEC'teki "yaklaşık 17"den ${f2(Math.abs(rest.elbow - 17))} derece farklı (ölçü tanımı farkı, yukarıda)`);
  for (const k of Object.keys(rest)) rest[k] = rd(rest[k], 6);
}

// ---------- göğüs kafesi elipsoidi (skapula denetimi için) ----------
// Sol 2.-9. kaburgaların arka ve yan bölümünün (x > 3,5, z < 5) dış yüzüne eksenlere hizalı elipsoit:
// A x^2 + B y^2 + C z^2 + D x + E y + F z = 1, BÜTÜN köşelere (cebirsel en küçük kareler; kin-interface.md'nin önerdiği).
// Bütünleştirme notu (motion-validate.mjs ile ölçüldü): önceki "yalnız dış yüz" oturtması (rms 0,17) arka duvarı iyi,
// yan duvarı kötü izliyordu; kol tam yukarıdayken alt açı gerçek kaburgalardan 2,1-2,5 cm kalkıyor, 90-150 derecede
// skapula kaburgalara 0,07 cm'ye kadar yaklaşıyordu. Bütün köşelere oturtulan elipsoit (rms yaklaşık 1,1) yan duvarı
// izler: en çok 1,3 cm kalkma, en az 0,32 cm aralık; motion-kin.js içindeki TUNE oranları da bununla ayarlanmıştı.
const thoraxFit = (() => {
  const names = ['Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'].map(s => s + ' rib');
  const ribs = names.map(n => { const b = staticB(n); if (!b) throw new Error('kaburga yok: ' + n); return b; });
  let pts = []; for (const r of ribs) for (const x of verts(r)) if (x[0] > 3.5 && x[2] < 5) pts.push(x);
  const fit = P => {
    const n = 6, A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
    for (const [x, y, z] of P) { const row = [x * x, y * y, z * z, x, y, z]; for (let i = 0; i < n; i++) { b[i] += row[i]; for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j]; } }
    const [a, bq, c, d, e, f] = solve(A, b), cen = [-d / (2 * a), -e / (2 * bq), -f / (2 * c)], k = 1 + a * cen[0] ** 2 + bq * cen[1] ** 2 + c * cen[2] ** 2;
    return { c: cen, r: [Math.sqrt(k / a), Math.sqrt(k / bq), Math.sqrt(k / c)] };
  };
  // yaklaşık işaretli uzaklık (dışarısı +): birinci derece (Sampson); kin-scapcheck.mjs ile aynı formül
  const sd = (F, x) => { const u = [(x[0] - F.c[0]) / F.r[0], (x[1] - F.c[1]) / F.r[1], (x[2] - F.c[2]) / F.r[2]], f = len(u); return (f - 1) / (Math.hypot(u[0] / F.r[0], u[1] / F.r[1], u[2] / F.r[2]) / f); };
  const F = fit(pts);
  const outer = pts; let ss = 0; for (const x of outer) ss += sd(F, x) ** 2;
  return { ...F, rms: Math.sqrt(ss / outer.length), n: outer.length, sd, ribs };
})();
{
  const ribDist = x => Math.min(...thoraxFit.ribs.map(r => (nearBox(r, x, 6) ? dist(r, x) : 6)));
  say('\n== Göğüs kafesi elipsoidi (sol 2.-9. kaburga, arka ve yan bölüm, bütün köşeler) ==');
  say(`  merkez [${R(thoraxFit.c, 2).join(', ')}], yarı eksenler [${R(thoraxFit.r, 2).join(', ')}], rms ${f2(thoraxFit.rms)} cm (${thoraxFit.n} köşe)`);
  const pt = (k, x) => `${k} elipsoit ${f2(thoraxFit.sd(thoraxFit, x))} / kaburga ağı ${f2(ribDist(x))}`;
  say('  dinlenmede skapula noktalarının uzaklığı (cm): ' + [pt('ai', LM.ai), pt('ts', LM.ts), pt('as', LM.as)].join('; '));
  say('  mediyal kenar örnekleri (elipsoit / kaburga): ' + LM.mb.map(x => `${f2(thoraxFit.sd(thoraxFit, x))}/${f2(ribDist(x))}`).join(' '));
  if (thoraxFit.rms > 1.5) fail(`göğüs kafesi elipsoidi kötü oturdu (rms ${f2(thoraxFit.rms)} cm)`);
}

// =====================================================================================================================
// Deri ağırlıkları
// =====================================================================================================================
// konuma göre kaynak + küme komşuluğu (kenar uzunluklarıyla) + küme alanı
function topology(p) {
  const { cluster, count } = clusterByPosition(p.P);
  const rep = new Int32Array(count).fill(-1); for (let i = 0; i < cluster.length; i++) if (rep[cluster[i]] < 0) rep[cluster[i]] = i;
  const X = new Float64Array(count * 3); for (let c = 0; c < count; c++) { X[c * 3] = p.P[rep[c] * 3]; X[c * 3 + 1] = p.P[rep[c] * 3 + 1]; X[c * 3 + 2] = p.P[rep[c] * 3 + 2]; }
  const nb = Array.from({ length: count }, () => new Map()), area = new Float64Array(count);
  const elen = (a, b) => Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
  for (let t = 0; t < p.I.length; t += 3) {
    const a = cluster[p.I[t]], b = cluster[p.I[t + 1]], c = cluster[p.I[t + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if (!nb[u].has(v)) { const l = Math.max(elen(u, v), 1e-4); nb[u].set(v, l); nb[v].set(u, l); }
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    area[a] += ar; area[b] += ar; area[c] += ar;
  }
  for (let c = 0; c < count; c++) if (area[c] <= 0) area[c] = 1e-6;
  // bağlı bileşenler; ayrı bileşenler arasına köprü kenarları (0,5 cm'den yakın komşular + her bileşenin en yakın çifti)
  const comp = new Int32Array(count).fill(-1); let nc = 0;
  for (let s = 0; s < count; s++) { if (comp[s] >= 0) continue; const st = [s]; comp[s] = nc; while (st.length) { const u = st.pop(); for (const v of nb[u].keys()) if (comp[v] < 0) { comp[v] = nc; st.push(v); } } nc++; }
  let bridges = 0;
  if (nc > 1) {
    const cell = 0.5, grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
    for (let c = 0; c < count; c++) { const k = key(Math.floor(X[c * 3] / cell), Math.floor(X[c * 3 + 1] / cell), Math.floor(X[c * 3 + 2] / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
    for (let c = 0; c < count; c++) {
      const i0 = Math.floor(X[c * 3] / cell), j0 = Math.floor(X[c * 3 + 1] / cell), k0 = Math.floor(X[c * 3 + 2] / cell); let bd = cell, bv = -1;
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) { const g = grid.get(key(i, j, k)); if (!g) continue; for (const v of g) if (comp[v] !== comp[c]) { const d = elen(c, v); if (d < bd) { bd = d; bv = v; } } }
      if (bv >= 0 && !nb[c].has(bv)) { nb[c].set(bv, Math.max(bd, 1e-4)); nb[bv].set(c, Math.max(bd, 1e-4)); bridges++; }
    }
    // hâlâ ayrı kalan bileşenler: en yakın çift (kaba kuvvet), birleşene kadar
    const par = new Int32Array(count); for (let c = 0; c < count; c++) par[c] = c;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let c = 0; c < count; c++) for (const v of nb[c].keys()) par[find(c)] = find(v);
    for (;;) {
      const roots = new Map(); for (let c = 0; c < count; c++) { const r = find(c); if (!roots.has(r)) roots.set(r, []); roots.get(r).push(c); }
      if (roots.size < 2) break;
      const groups = [...roots.values()].sort((a, b) => a.length - b.length), small = groups[0], inSmall = new Set(small);
      let bd = Infinity, bu = -1, bv = -1;
      for (const u of small) for (let v = 0; v < count; v++) if (!inSmall.has(v)) { const d = elen(u, v); if (d < bd) { bd = d; bu = u; bv = v; } }
      nb[bu].set(bv, Math.max(bd, 1e-4)); nb[bv].set(bu, Math.max(bd, 1e-4)); par[find(bu)] = find(bv); bridges++;
    }
  }
  return { cluster, count, rep, X, nb, area, comp, nc, bridges };
}
// çok kaynaklı Dijkstra (ikili yığın): kümelerin kaynak kümesine jeodezik uzaklığı
function geodesic(T, sources) {
  const n = T.count, D = new Float64Array(n).fill(Infinity), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of sources) { D[s] = 0; push(0, s); }
  while (heap.length) { const [d, u] = pop(); if (d > D[u]) continue; for (const [v, l] of T.nb[u]) { const nd = d + l; if (nd < D[v]) { D[v] = nd; push(nd, v); } } }
  return D;
}
const cx = (T, c) => [T.X[c * 3], T.X[c * 3 + 1], T.X[c * 3 + 2]];

// ---------- kas seçimi (map-data.md bölüm 2 kuralı) ----------
const patches = parts.filter(p => p.sub === 'attach' && p.sd === 'l');
const patchParts = n => patches.filter(p => p.n === n);
const armBoneSet = new Set(armBones);
const onArm = (() => {   // yamanın örneklenen köşelerinin en az %10'u bir kol kemiğinin üstünde mi
  const cache = new Map();
  return pp => {
    if (cache.has(pp)) return cache.get(pp);
    const n = pp.P.length / 3, st = Math.max(1, Math.floor(n / 400)); let k = 0, tot = 0;
    for (let i = 0; i < n; i += st) { tot++; const nbn = nearestBone([pp.P[i * 3], pp.P[i * 3 + 1], pp.P[i * 3 + 2]], 1.0); if (nbn.b && armBoneSet.has(nbn.b)) k++; }
    const v = k / tot >= 0.1; cache.set(pp, v); return v;
  };
})();
const boundPatches = p => { const c = cards[p.n]; return c?.patch ? { o: c.patch.o || [], i: c.patch.i || [] } : { o: [p.n + ' (origin)'], i: [p.n + ' (insertion)'] }; };
const muscleParts = parts.filter(p => p.sd === 'l' && p.s === 'muscle' && p.sub === 'muscle').filter(p => {
  const bp = boundPatches(p);
  return p.path.includes('Muscles of upper limb') || [...bp.o, ...bp.i].some(n => patchParts(n).some(onArm));
});
if (muscleParts.length !== 67) fail(`kas parçası sayısı ${muscleParts.length}, beklenen 67`);
for (const p of muscleParts) if (!cards[p.n]) warn(`muscles.json kartı olmayan kas: ${p.n}`);

// ---------- düzeltme tablosu: yaması eksik ya da kasa ulaşmayan tutunma yerleri ----------
// Uç (o = origo, i = insersiyo) başına bir kural; yama da bir şey buluyorsa ikisi birleştirilir. Kurallar:
//   contact: [kemik adları / düzenli ifadeler]  o kemiklere d (varsayılan 0,25) cm'den yakın köşeler; end (varsayılan 0,5):
//            öbür uçtan jeodezik uzaklığı en büyük uzaklığın bu katından fazla olanlar ("doğru uç"); end: 0 = süzme yok
//   median: x                                   orta düzleme x cm'den yakın köşeler (dikensi çıkıntılar, Lig. nuchae / supraspinale)
//   far: true, seg?                             kasın öbür uca en uzak ucu (kemiğe değmeyen uç); seg verilmezse en yakın kemik
//   cont: '<parça>'                             uç başka bir parçanın sürdürdüğü ortak kirişe karışır: uç o parçanın oradaki
//                                               ağırlıklarını alır, orta çizgi o parçanın çizgisiyle insersiyoya kadar uzatılır
//   axis: true (kasın tamamı için)              iki uç da kemiğe değmiyor: ana eksenin iki ucu (omza yakın olan origo)
// Anatomik dayanak: muscles.json kartlarının o / i metinleri (doğrulanmış içerik).
// Ayrıca (uç kuralı değil, kasın tamamı için):
//   cut: '<neden>'    omuz geçişi insersiyonun hemen önünde ani yapılır (kuşak yok). Gövdeden humerusun üst ucuna uzanan
//                     koltuk altı kıvrımı kasları için: geniş bir kuşakta ikili kuaterniyon karışımı ara köşeleri omuz merkezi
//                     çevresinde yarım açıyla döndürür ve kas omzun dışından dolanan bir "kanat" olur; ani geçişte kirişin
//                     üçgenleri gövdedeki kenardan koldaki insersiyoya düz gerilir (gergin bant).
//   drop: { seg, why } yamanın o segmentteki bölümü iğnelenmez
//   ext: { bone, why } orta çizgi insersiyodan öteye, kuvvetin aktarıldığı kemiğin tabanına uzatılır
const FOLD = 'koltuk altı kıvrımı kası: karın gövdede kalır, kiriş humerusa düz gerilir (kuşak olursa omzun dışından dolanır)';
const FIX = {
  'Latissimus dorsi muscle': {
    i: { contact: ['Humerus'], why: 'kaynakta humerus yaması yok; Crista tuberculi minoris humeri' },
    o: [
      { contact: [/^(Ninth|Tenth|Eleventh|Twelfth) rib$/, /^Vertebra /, 'Sacrum', 'Hip bone'], end: 0, why: 'yama yalnız Crista iliaca ile Angulus inferior scapulae üstünde; kaburga (9.-12.) ve omur origosu değmeyle' },
      { median: 0.6, why: 'Procc. spinosi T7-L5 (Fascia thoracolumbalis üzerinden): iki kabuğun orta düzlemdeki kenarı' },
    ],
    drop: { seg: 'scapula', why: 'Angulus inferior scapulae origosu değişkendir (kartta parantez içinde); iğnelenirse skapula dönerken kas örtüsünü 8-10 cm sürükler. Skapula kasın altında kayar' },
    cut: FOLD,
  },
  'Teres major muscle': { i: { contact: ['Humerus'], why: 'insersiyo yaması yok; Crista tuberculi minoris humeri' }, cut: FOLD },
  'Clavicular head of pectoralis major muscle': { cut: FOLD },
  'Sternocostal head of pectoralis major muscle': { cut: FOLD, drop: { seg: 'clavicle', why: 'klavikula yaması klaviküler başındır; bu başa yalnız birkaç köşeyle değiyor' } },
  'Abdominal part of pectoralis major muscle': { cut: FOLD },
  'Coracobrachialis muscle': { i: { contact: ['Humerus'], why: 'insersiyo yaması yok; humerusun anteromediyal yüzü (orta)' } },
  'Short head of biceps brachii': {
    o: { contact: ['Scapula'], end: 0, why: 'sol tarafta origo yaması yok; Processus coracoideus' },
    i: { cont: 'Long head of biceps brachii', why: 'ağ dirseğin 2 cm üstünde ortak kirişte biter; insersiyo Tuberositas radii (uzun başla ortak)' },
  },
  'Descending part of trapezius muscle': { o: { median: 0.6, why: 'yama yalnız oksipital kemikte; Lig. nuchae origosu orta düzlemde' } },
  'Transverse part of trapezius muscle': { o: { median: 0.6, why: 'origo yaması yok; Procc. spinosi T1-T4 (orta düzlem)' } },
  'Ascending part of trapezius muscle': { o: { median: 0.6, why: 'origo yaması yok; Procc. spinosi T5-T12 (orta düzlem)' } },
  'Rhomboid major muscle': { o: { median: 0.6, why: 'origo yaması yok; Procc. spinosi T1-T4 (orta düzlem)' } },
  'Rhomboid minor muscle': { o: { median: 0.6, why: 'origo yaması yok; Procc. spinosi C6-C7 (orta düzlem)' } },
  'Subclavius muscle': { o: { far: true, seg: 'thorax', why: 'origo yaması yok; 1. kaburga (kıkırdak-kemik sınırı): kasın mediyal ucu. Kas boyunca kaburgaya değer ama oraya tutunmaz, değme kuralı kullanılmaz' } },
  'Deep head of pronator teres': { o: { contact: ['Ulna'], why: 'bağlı yamalar yüzeyel başın humerus yamaları, bu başa ulaşmıyor; Processus coronoideus ulnae' } },
  'Flexor digitorum profundus': { o: { contact: ['Ulna', 'Radius'], why: 'origo yaması yok; Facies anterior ulnae (proksimal 2/3), Membrana interossea' } },
  'Pronator quadratus': {
    o: { contact: ['Ulna'], end: 0, why: 'yamalar yalnız sağ tarafta var; Facies anterior ulnae (distal çeyrek)' },
    i: { contact: ['Radius'], end: 0, why: 'yamalar yalnız sağ tarafta var; Facies anterior radii (distal çeyrek)' },
  },
  'Flexor carpi radialis': { i: { contact: ['Second metacarpal bone', 'Third metacarpal bone'], why: 'insersiyo yaması yok; Basis ossis metacarpi II (III)' } },
  'Palmaris longus muscle': { i: { far: true, seg: 'hand', why: 'insersiyo yaması yok; Aponeurosis palmaris (kemiğe değmez), elle birlikte hareket eder' } },
  'Extensor digitorum': { o: { contact: ['Humerus'], why: 'Caput commune yaması bu ağa 0,4 cm uzak kalıyor; Epicondylus lateralis humeri' } },
  'Extensor digiti minimi': {
    o: { contact: ['Humerus'], why: 'Caput commune yaması bu ağa ulaşmıyor; Epicondylus lateralis humeri' },
    i: { contact: [/phalanx of fifth finger of hand$/], why: 'insersiyo yaması yok; küçük parmağın dorsal aponevrozu' },
  },
  'Humeral head of extensor carpi ulnaris': {
    o: { contact: ['Humerus'], why: 'Caput commune yaması bu ağa ulaşmıyor; Epicondylus lateralis humeri (ulna yaması ayrıca bulunur)' },
    i: { cont: 'Ulnar head of extensor carpi ulnaris', why: 'insersiyo yaması dönüştürmede atılmış; ağ triquetrumun üstünde (bilek ekseni düzeyinde) biter ve ulnar başın kirişine karışır; insersiyo Basis ossis metacarpi V' },
  },
  'Ulnar head of extensor carpi ulnaris': { i: { contact: ['Fifth metacarpal bone'], why: 'insersiyo yaması dönüştürmede atılmış; Basis ossis metacarpi V' } },
  'Humeral head of flexor carpi ulnaris': { ext: { bone: 'Fifth metacarpal bone', why: 'Os pisiforme kirişin içindeki susam kemiğidir; kuvvet Lig. pisometacarpale ile Basis ossis metacarpi V\'e geçer: çizgi oraya uzatılır (ağırlıklar değişmez)' } },
  'Ulnar head of flexor carpi ulnaris': { i: { cont: 'Humeral head of flexor carpi ulnaris', why: 'ağ el bileğinin 3 cm üstünde ortak kirişte biter; insersiyo Os pisiforme (humerus başıyla ortak)' } },
  'Radial head of flexor digitorum superficialis': { i: { cont: 'Humero-ulnar head of flexor digitorum superficialis', why: 'ağ el bileğinin üstünde ortak karna karışır; insersiyo orta falankslar (humeroulnar başla ortak)' } },
  'Abductor pollicis brevis': {
    o: { contact: ['Scaphoid bone', 'Trapezium bone'], end: 0, why: 'yama yok; Tuberculum ossis scaphoidei, Retinaculum flexorum (trapezium üstünde)' },
    i: { far: true, why: 'yama yok; başparmağın proksimal falanksının tabanı (ağ kemiğe değmeden biter)' },
  },
  'Opponens pollicis muscle': {
    o: { contact: ['Trapezium bone', 'Trapezoid bone', 'Capitate bone'], end: 0, why: 'yama yok; Tuberculum ossis trapezii, Retinaculum flexorum' },
    i: { contact: ['First metacarpal bone'], end: 0, why: 'yama yok; Os metacarpi I (radyal kenar)' },
  },
  'Superficial head of flexor pollicis brevis': { axis: true, why: 'yama yok ve uçlar kemiğe değmiyor (Retinaculum flexorum -> proksimal falanks tabanı)' },
  'Deep head of flexor pollicis brevis': { i: { far: true, why: 'insersiyo yaması yok; başparmağın proksimal falanksının tabanı' } },
  'Lumbrical muscles of hand': { axis: true, why: 'yama yok; origo FDP kirişleri, insersiyo dorsal aponevroz (kemiğe değmez); dört ayrı karın' },
  'Palmar interossei muscles': {
    o: { contact: [/ metacarpal bone$/], end: 0, why: 'yama yok; metakarp gövdeleri' },
    i: { contact: [/^Proximal phalanx of /], end: 0, why: 'yama yok; proksimal falanks tabanı' },
  },
  'Dorsal interossei muscles of hand': { i: { contact: [/^Proximal phalanx of /], end: 0, why: 'insersiyo yaması yok; proksimal falanks tabanı ve dorsal aponevroz' } },
  'Opponens digiti minimi muscle of hand': { i: { contact: ['Fifth metacarpal bone'], why: 'insersiyo yaması yok; Os metacarpi V (ulnar kenar)' } },
  'Transverse head of adductor pollicis': { o: { contact: ['Third metacarpal bone'], end: 0, why: 'bağlı origo yaması eğik başın (Os capitatum) yaması; bu başın origosu Os metacarpi III' } },
};
// Kasın tamamı için ek seçenekler (inceleme düzeltmeleri):
//   force: { o | i: '<segment>', why }  o ucun bütün iğneleri tek segmente bağlanır (yama başka kemiğe de değse bile)
//   twist: g                            ön kol dönmesi (ulna -> radius) aralığın tamamına değil yalnız distal g kadarına (sigma) yayılır
//   tautEnd: true                       omuzda gergin çizgi insersiyo merkezine kadar düz gider (başın üstündeki kiriş örnekleri atlanır)
FIX['Extensor pollicis brevis'] = { force: { o: 'radius', why: 'origo Facies posterior radii + Membrana interossea; zar köşeleri ulnaya iğnelenince kas pronasyonda ulna ile radius arasında geriliyor, supinasyonda %20 kısalıyordu. Kas radyoulnar ekseni geçmez: radius -> el' } };
for (const n of ['Humeral head of flexor carpi ulnaris', 'Ulnar head of flexor carpi ulnaris', 'Humeral head of extensor carpi ulnaris', 'Ulnar head of extensor carpi ulnaris']) {
  if (!FIX[n]) throw new Error('FIX kaydı yok: ' + n);
  FIX[n].twist = 0.15;   // bu kaslar bileğe kadar ulna boyunca uzanır: ulnadan ayrılmamaları için dönme yalnız distal uçta
}
for (const n of ['Supraspinatus muscle', 'Infraspinatus muscle', 'Teres minor muscle', 'Subscapularis muscle']) (FIX[n] ||= {}).tautEnd = true;
// Eklem parçaları: yalnız şu segmentlere bağlanır (uzaklık kuralı yanlış kemiği seçeceği için)
const JOINT_FIX = {
  'Glenoid labrum': { segs: ['scapula'], why: 'labrum glenoid kenarına yapışıktır; humerus başına yakın köşeleri başla birlikte dönmemeli' },
  'Annular ligament of radius': { segs: ['ulna'], why: 'ulnaya (Incisura radialis kenarları) tutunur; radius başı içinde döner' },
  'Radial collateral ligament': { segs: ['humerus', 'ulna'], why: 'Epicondylus lateralis -> Lig. anulare (ulna ile hareket eder); radiusla dönmemeli' },
  'Quadrate ligament': { segs: ['ulna', 'radius'], why: 'ulna (Incisura radialis alt kenarı) -> radius boynu' },
  'Ulnar collateral ligament': { segs: ['humerus', 'ulna'], why: 'Epicondylus medialis -> Processus coronoideus / Olecranon; radiusa tutunmaz' },
  'Articular disc of distal radio-ulnar joint': { segs: ['radius'], why: 'disk radiusla birlikte ulna başının üstünde döner; ulnadaki ucu (fovea) dönme ekseninin üstündedir' },
  'Palmar radio-ulnar ligament': { segs: ['radius'], why: 'diskin palmar kenarı (TFCC): radiusla birlikte, ulnadaki ucu eksen üstünde' },
  'Dorsal radio-ulnar ligament': { segs: ['radius'], why: 'diskin dorsal kenarı (TFCC): radiusla birlikte, ulnadaki ucu eksen üstünde' },
  'Articular capsule of elbow joint': { segs: ['humerus', 'ulna'], why: 'distalde ulnaya ve Lig. anulare radii\'ye (ulna ile hareket eder) tutunur; radius içinde döner' },
  'Articular capsule of radiocarpal joint': { segs: ['radius', 'carpProx', 'hand'], why: 'proksimalde radiusa ve diske (TFCC, radiusla döner) tutunur; ulna başına değil' },
  'Ulnolunate ligament': { segs: ['radius', 'carpProx', 'hand'], why: 'palmar radyoulnar bağdan (TFCC) çıkar: bilekle birlikte ulna başının çevresinde döner' },
  'Ulnotriquetral ligament': { segs: ['radius', 'carpProx', 'hand'], why: 'palmar radyoulnar bağdan (TFCC) çıkar: bilekle birlikte ulna başının çevresinde döner' },
  'Ulnocapitate ligament': { segs: ['radius', 'carpProx', 'hand'], why: 'palmar radyoulnar bağdan (TFCC) çıkar: bilekle birlikte ulna başının çevresinde döner' },
};

const TH_PATCH = 0.3, TH_CONTACT = 0.25, TH_RIGID = 0.15, TH_TOUCH = 0.3, WIN = +(process.argv.find(a => a.startsWith("--win=")) || "").slice(6) || 2.5, HMAX = +(process.argv.find(a => a.startsWith("--hmax=")) || "").slice(7) || 0.12;
const CUT_AT = +(process.argv.find(a => a.startsWith('--cut-at=')) || '').slice(9) || 0.93;   // ani geçişte kirişin humerusla giden son bölümü (sigma)
const ORDER = SI;   // ana yol sırası = segment sırası (thorax 0 ... hand 7)
const ALONG = new Set(['humerus', 'ulna', 'radius']);   // kasların boyunca uzandığı ara segmentler
const boneMatch = spec => allBones.filter(b => b.sd !== 'r' && spec.some(s => (typeof s === 'string' ? b.n === s : s.test(b.n))));

// Bir köşe yalnız ağaçta komşu segmentleri karıştırmalı: ikili kuaterniyon karışımı, bağıl dönmesi 180 dereceyi aşabilen
// çiftlerde (humerus - radius: dirsek fleksiyonu + pronasyon; ulna - el: pronasyon + bilek) sıçrar. Komşu olmayan karışım,
// ağırlıklı ortalama zincir konumunun iki yanındaki komşu segmentlere indirilir (ör. humerus + radius -> humerus + ulna ya
// da ulna + radius). carpProx ve hand radiusun çocuklarıdır (aynı düzey; aralarındaki oran korunur). Kaslarda göğüs +
// skapula doğrudan karışımına izin verilir (bağıl dönme 70 dereceyi aşmaz; klavikulanın eksen dönmesi istenmez).
const LEVEL = [0, 1, 2, 3, 4, 5, 6, 6];
function routeAdjacent(W, c, allowThoraxScapula) {
  let lo = 99, hi = -1, sum = 0, mean = 0;
  for (let k = 0; k < NS; k++) { const w = W[c * NS + k]; if (w > 1e-6) { if (LEVEL[k] < lo) lo = LEVEL[k]; if (LEVEL[k] > hi) hi = LEVEL[k]; mean += w * LEVEL[k]; sum += w; } }
  if (hi - lo <= 1) return false;
  if (allowThoraxScapula && lo === 0 && hi === 2 && W[c * NS + 1] <= 1e-6) return false;
  mean /= sum;
  const a = Math.min(5, Math.floor(mean)), f = mean - a, cp = W[c * NS + SI.carpProx], ha = W[c * NS + SI.hand], ds = cp + ha;
  for (let k = 0; k < NS; k++) W[c * NS + k] = 0;
  const put = (level, w) => { if (w <= 0) return; if (level < 6) W[c * NS + level] += w; else if (ds > 0) { W[c * NS + SI.carpProx] += w * cp / ds; W[c * NS + SI.hand] += w * ha / ds; } else W[c * NS + SI.hand] += w; };
  put(a, (1 - f) * sum); put(a + 1, f * sum);
  return true;
}

// geçiş türü: yolun ardışık iki segmenti için eklem
function crossingRef(a, b) {
  const k = a + '|' + b;
  if (k === 'humerus|ulna') return { type: 'line', name: 'dirsek', p: J.elbow, d: AX.elbow };
  if (k === 'ulna|radius') return { type: 'twist', name: 'ön kol' };
  if (k === 'radius|hand' || k === 'radius|carpProx' || k === 'carpProx|hand') return { type: 'point', name: 'el bileği', p: J.wrist };
  if (b === 'humerus') return { type: 'point', name: 'omuz (GH)', p: J.gh };
  return { type: 'span', name: 'kuşak (serbest boy)' };   // thorax|clavicle, thorax|scapula, clavicle|scapula
}

function buildMuscle(p, done) {
  const T = topology(p), n = T.count, fix = FIX[p.n] || {};
  const m = { p, T, how: { o: [], i: [] }, notes: [] };
  const O = new Map(), I = new Map();       // küme -> segment indisi
  const put = (set, c, seg) => { if (!set.has(c)) set.set(c, seg); };
  let dropped = 0;
  // --- yamalar
  const bp = boundPatches(p);
  for (const [end, set] of [['o', O], ['i', I]]) {
    for (const pn of bp[end]) {
      const pps = patchParts(pn).map(prep); if (!pps.length) { m.how[end].push(`${pn}: solda yama yok`); continue; }
      let k = 0;
      for (let c = 0; c < n; c++) {
        const x = cx(T, c); let best = TH_PATCH, q = null;
        for (const pp of pps) { if (!nearBox(pp, x, best)) continue; const r = closest(pp, x); if (r.d < best) { best = r.d; q = r.q; } }
        if (!q) continue;
        const nbn = nearestBone(q, 1.5); if (!nbn.b) continue;
        if (fix.drop && nbn.b.seg === fix.drop.seg) { dropped++; continue; }
        put(set, c, SI[nbn.b.seg]); k++;
      }
      m.how[end].push(k ? `yama "${pn}" (${k} küme)` : `yama "${pn}" kasa ulaşmıyor`);
    }
  }
  if (dropped) m.notes.push(`TABLO: yamanın ${fix.drop.seg} üstündeki ${dropped} kümesi iğnelenmedi: ${fix.drop.why}`);
  // --- düzeltme tablosu
  const farOf = (other, frac) => { const D = geodesic(T, other.keys()); let mx = 0; for (let c = 0; c < n; c++) if (D[c] < Infinity && D[c] > mx) mx = D[c]; return { D, mx, frac }; };
  const applyRule = (end, set, other, rule) => {
    if (rule.contact) {
      const bones = boneMatch(rule.contact), th = rule.d ?? TH_CONTACT, e = rule.end ?? 0.5;
      if (!bones.length) { fail(`${p.n}: düzeltme tablosundaki kemik bulunamadı: ${rule.contact}`); return; }
      const far = e > 0 && other.size ? farOf(other, e) : null; let k = 0;
      for (let c = 0; c < n; c++) {
        const x = cx(T, c); const nbn = nearestBone(x, th, bones); if (!nbn.b) continue;
        if (far && !(far.D[c] >= far.frac * far.mx)) continue;
        put(set, c, SI[nbn.b.seg]); k++;
      }
      m.how[end].push(`TABLO değme [${rule.contact.map(String).join(', ')}] (${k} küme): ${rule.why}`);
    } else if (rule.median !== undefined) {
      let k = 0; for (let c = 0; c < n; c++) if (Math.abs(T.X[c * 3]) < rule.median) { put(set, c, SI.thorax); k++; }
      m.how[end].push(`TABLO orta düzlem < ${rule.median} cm (${k} küme): ${rule.why}`);
    } else if (rule.far || rule.cont) {
      if (!other.size) { fail(`${p.n}: "${end}" ucu için öbür uç boş`); return; }
      const { D, mx } = farOf(other, 0), cut = mx - Math.max(0.4, 0.04 * mx); let k = 0; const tip = [];
      for (let c = 0; c < n; c++) if (D[c] < Infinity && D[c] >= cut) tip.push(c);
      if (rule.cont) {
        const Bm = done.get(rule.cont); if (!Bm) { fail(`${p.n}: izlenen parça henüz hazır değil: ${rule.cont}`); return; }
        m.cont = { B: Bm, tip, name: rule.cont };
        const vecs = tip.map(c => { // izlenen parçanın en yakın kümesinin ağırlıkları (yumuşak iğne)
          const x = cx(T, c); let bd = Infinity, bj = -1; for (let j = 0; j < Bm.T.count; j++) { const d = Math.hypot(Bm.T.X[j * 3] - x[0], Bm.T.X[j * 3 + 1] - x[1], Bm.T.X[j * 3 + 2] - x[2]); if (d < bd) { bd = d; bj = j; } }
          return Bm.W.subarray(bj * NS, bj * NS + NS);
        });
        const avg = new Float64Array(NS); for (const v of vecs) for (let q = 0; q < NS; q++) avg[q] += v[q] / vecs.length;
        let dom = 0; for (let q = 1; q < NS; q++) if (avg[q] > avg[dom]) dom = q;     // ucun baskın segmenti: yol buna göre kurulur
        tip.forEach((c, q) => { put(set, c, { vec: vecs[q], dom }); k++; });
        m.how[end].push(`TABLO ortak kiriş -> "${rule.cont}" (${k} küme): ${rule.why}`);
      } else {
        for (const c of tip) { const seg = rule.seg ? SI[rule.seg] : SI[(nearestBone(cx(T, c), 4).b || { seg: 'thorax' }).seg]; put(set, c, seg); k++; }
        m.how[end].push(`TABLO serbest uç${rule.seg ? ' -> ' + rule.seg : ' (en yakın kemik)'} (${k} küme): ${rule.why}`);
      }
    }
  };
  if (fix.axis) {
    // iki uç da bilinmiyor: her bağlı bileşenin ana ekseninin iki ucu; omza (humerus başına) yakın uç origo
    for (let ci = 0; ci < T.nc; ci++) {
      const idx = []; for (let c = 0; c < n; c++) if (T.comp[c] === ci) idx.push(c);
      if (idx.length < 4) continue;
      const f = pca(idx.map(c => cx(T, c))), ax = f.axes[0].v, t = idx.map(c => dot(sub(cx(T, c), f.c), ax)), lo = Math.min(...t), hi = Math.max(...t), w = 0.07 * (hi - lo);
      const A = idx.filter((c, k) => t[k] < lo + w), Bq = idx.filter((c, k) => t[k] > hi - w);
      const dA = len(sub(mean(A.map(c => cx(T, c))), J.gh)), dB = len(sub(mean(Bq.map(c => cx(T, c))), J.gh));
      const [oo, ii] = dA < dB ? [A, Bq] : [Bq, A];
      for (const c of oo) put(O, c, SI[(nearestBone(cx(T, c), 4).b || { seg: 'thorax' }).seg]);
      for (const c of ii) put(I, c, SI[(nearestBone(cx(T, c), 4).b || { seg: 'thorax' }).seg]);
    }
    m.how.o.push(`TABLO ana eksenin proksimal ucu (${O.size} küme): ${fix.why}`); m.how.i.push(`TABLO ana eksenin distal ucu (${I.size} küme): ${fix.why}`);
  } else {
    // önce "doğru uç" süzmesi gerektirmeyen kurallar, sonra öbür uca bağlı olanlar
    const needsOther = r => (r.contact && (r.end ?? 0.5) > 0) || r.far || r.cont;
    const rulesOf = end => (fix[end] ? (Array.isArray(fix[end]) ? fix[end] : [fix[end]]) : []);
    for (const [end, set, other] of [['o', O, I], ['i', I, O]]) for (const r of rulesOf(end)) if (!needsOther(r)) applyRule(end, set, other, r);
    for (const [end, set, other] of [['o', O, I], ['i', I, O]]) for (const r of rulesOf(end)) if (needsOther(r)) applyRule(end, set, other, r);
  }
  // bir küme iki uçta birden olamaz: yamalar çakışıyorsa insersiyo kazanır (küçük kaslarda nadir)
  for (const c of I.keys()) if (O.has(c)) O.delete(c);
  if (fix.force) for (const [end, set] of [['o', O], ['i', I]]) {
    const sg = fix.force[end]; if (!sg) continue;
    let k = 0; for (const [c, v] of set) if (v !== SI[sg]) { set.set(c, SI[sg]); k++; }
    m.how[end].push(`TABLO tek segment -> ${sg} (${k} küme başka kemikten alındı): ${fix.force.why}`);
  }
  // Birden çok kemiğe yayılan tutunma yeri (ör. ulna + Membrana interossea + radius): köşeler "en yakın kemik" ile sert
  // bölünürse komşu iki iğne 170 derece ayrışan iki kemiğe düşer. Yerin önemli segmentleri arasında uzaklığa göre
  // karışım (eklem parçalarındaki kural): kemiğe 0,15 cm'den yakın köşe o kemiğe katı, aradakiler karışık.
  for (const set of [O, I]) {
    const cnt = new Float64Array(NS); let hard = 0;
    for (const s of set.values()) if (typeof s === 'number') { cnt[s]++; hard++; }
    const sigs = []; for (let k = 0; k < NS; k++) if (hard && cnt[k] / hard >= 0.15) sigs.push(k);
    if (sigs.length < 2) continue;
    const lists = sigs.map(k => (k === SI.thorax ? staticBones : segBones[SEGS[k]]));
    let mixed = 0;
    for (const [c, s] of set) {
      if (typeof s !== 'number' || !sigs.includes(s)) continue;
      const x = cx(T, c), d = lists.map(l => nearestBone(x, 3, l).d), near = d.filter(v => v < TH_RIGID).length;
      const v = new Float64Array(NS); let sum = 0, dom = sigs[0], best = 0;
      sigs.forEach((k, q) => { const w = near ? (d[q] < TH_RIGID ? 1 / (d[q] + 0.01) ** 2 : 0) : (d[q] < 3 ? 1 / (d[q] - TH_RIGID + 0.02) ** 2 : 0); v[k] = w; sum += w; if (w > best) { best = w; dom = k; } });
      if (!(sum > 0)) continue;
      for (let k = 0; k < NS; k++) v[k] /= sum;
      if (v[dom] < 0.98) { set.set(c, { vec: v, dom }); mixed++; }
    }
    if (mixed) m.notes.push(`${set === O ? 'origo' : 'insersiyo'}: ${mixed} küme iki kemik arasında karışık iğne (${sigs.map(k => SEGS[k]).join(' / ')})`);
  }
  m.O = O; m.I = I;
  if (!O.size || !I.size) { fail(`${p.n}: ${!O.size ? 'origo' : 'insersiyo'} kümesi boş (FIX tablosuna kural ekleyin)`); return m; }

  // --- t (origo -> insersiyo)
  const DO = geodesic(T, O.keys()), DI = geodesic(T, I.keys());
  const t = new Float64Array(n);
  for (let c = 0; c < n; c++) { const a = DO[c], b = DI[c]; t[c] = a + b > 0 && a < Infinity && b < Infinity ? a / (a + b) : (a === 0 ? 0 : b === 0 ? 1 : 0.5); }
  m.t = t; m.span = 0; for (let c = 0; c < n; c++) if (DO[c] < Infinity && I.has(c) && DO[c] > m.span) m.span = DO[c];

  // --- iğneler: küme -> 8'li ağırlık vektörü
  const pin = new Map(), pinSeg = new Map();
  const segShare = { o: new Float64Array(NS), i: new Float64Array(NS) };
  for (const [end, set] of [['o', O], ['i', I]]) for (const [c, s] of set) {
    const v = new Float64Array(NS), dom = typeof s === 'number' ? s : s.dom; if (typeof s === 'number') v[s] = 1; else v.set(s.vec);
    segShare[end][dom] += 1 / set.size; pin.set(c, v); pinSeg.set(c, dom);
  }
  m.segShare = segShare;
  // --- yol: önemli (ucun en az %15'i) tutunma segmentlerinin en proksimali ile en distali arası
  const sig = []; for (let k = 0; k < NS; k++) if (segShare.o[k] >= 0.15 || segShare.i[k] >= 0.15) sig.push(k);
  const kmin = Math.min(...sig), kmax = Math.max(...sig);
  // klavikuladan humerusa giden kas (deltoid pars clavicularis) skapula üzerinden karışır: klavikula ile humerus arasındaki
  // bağıl dönme 180 dereceyi aşabilir (ikili kuaterniyon karışımı sıçrar); skapula - humerus arası aşmaz
  const viaScapula = k => SEGS[k] === 'scapula' && kmin === SI.clavicle && kmax >= SI.humerus && !fix.cut;
  const path = []; for (let k = kmin; k <= kmax; k++) if (k === kmin || k === kmax || ALONG.has(SEGS[k]) || viaScapula(k)) path.push(k);
  m.path = path;
  const W0 = new Float64Array(n * NS);
  m.cross = [];
  if (path.length === 1) { for (let c = 0; c < n; c++) W0[c * NS + kmin] = 1; }
  else {
    // sigma: yolun iki ucundaki tutunma kümelerine göre konum
    const Ap = [], Ad = [];
    for (const [c, k] of pinSeg) { if (k === kmin) Ap.push(c); if (k === kmax) Ad.push(c); }
    if (!Ap.length || !Ad.length) { fail(`${p.n}: yolun uç kümeleri boş`); return m; }
    const Dp = geodesic(T, Ap), Dd = geodesic(T, Ad), sg = new Float64Array(n);
    for (let c = 0; c < n; c++) sg[c] = Dp[c] + Dd[c] > 0 ? Dp[c] / (Dp[c] + Dd[c]) : 0;
    m.sigma = sg;
    // kesitler: sigma'ya göre 48 dilimin alan ağırlıklı merkezleri
    const NB = 48, cen = Array.from({ length: NB }, () => [0, 0, 0, 0]);
    for (let c = 0; c < n; c++) { const b = Math.min(NB - 1, Math.floor(sg[c] * NB)), a = T.area[c]; cen[b][0] += a * T.X[c * 3]; cen[b][1] += a * T.X[c * 3 + 1]; cen[b][2] += a * T.X[c * 3 + 2]; cen[b][3] += a; }
    const cr = [];
    for (let j = 0; j + 1 < path.length; j++) {
      const ref = crossingRef(SEGS[path[j]], SEGS[path[j + 1]]), o = { ref, s: null, h: 0 };
      if (ref.p === J.gh) m.gh = path[j];      // omuz geçişi var: proksimal segment (orta çizginin gergin bölümü için)
      if (ref.type === 'point' || ref.type === 'line') {
        const r = new Float64Array(NB).fill(Infinity); let bb = -1;
        for (let b = 0; b < NB; b++) {
          if (!cen[b][3]) continue; const q = [cen[b][0] / cen[b][3], cen[b][1] / cen[b][3], cen[b][2] / cen[b][3]];
          r[b] = ref.type === 'point' ? len(sub(q, ref.p)) : len(perp(sub(q, ref.p), ref.d));
          if (bb < 0 || r[b] < r[bb]) bb = b;
        }
        // pencere: ekleme en yakın kesitin çevresinde, uzaklığı en küçük uzaklık + WIN'i aşmayan bitişik kesitler
        let lo = bb, hi = bb;
        while (lo > 0 && (r[lo - 1] === Infinity || r[lo - 1] <= r[bb] + WIN)) lo--;
        while (hi < NB - 1 && (r[hi + 1] === Infinity || r[hi + 1] <= r[bb] + WIN)) hi++;
        // kuşak: pencerenin içinde, en yakın kesiti ortalamaya çalışan en çok 0,24 genişliğinde aralık
        const w0 = lo / NB, w1 = (hi + 1) / NB;
        o.near = (bb + 0.5) / NB; o.dist = r[bb]; o.h = Math.min(HMAX, (w1 - w0) / 2);
        o.s = Math.min(w1 - o.h, Math.max(w0 + o.h, o.near));
        if (fix.cut && ref.p === J.gh) { o.s = 1; o.h = 0; o.cut = true; m.binary = true; m.notes.push('TABLO ani omuz geçişi (yalnız insersiyo köşeleri humerusta, ara ağırlık yok): ' + fix.cut); }
      }
      cr.push(o);
    }
    // sıra: ölçülen geçişler yol boyunca artmalı; komşu geçişler üst üste binmez (aradaki uzaklığın en çok %45'i)
    const measured = cr.filter(o => o.s !== null);
    for (let k = 1; k < measured.length; k++) if (measured[k].s < measured[k - 1].s + 0.04) measured[k].s = Math.min(0.98, measured[k - 1].s + 0.04);
    measured.forEach((o, k) => {
      if (k) o.h = Math.min(o.h, 0.45 * (o.s - measured[k - 1].s));
      if (k + 1 < measured.length) o.h = Math.min(o.h, 0.45 * (measured[k + 1].s - o.s));
      o.a = Math.max(0, o.s - o.h); o.b = Math.min(1, o.s + o.h);
    });
    // geniş bir geçişe (ön kol dönmesi) en az 0,08 genişlik kalsın: komşu dar kuşak o kadar kısalır
    for (let k = 0; k < cr.length; k++) {
      if (cr[k].s !== null) continue;
      const pv = k > 0 && cr[k - 1].s !== null ? cr[k - 1] : null, nx = k + 1 < cr.length && cr[k + 1].s !== null ? cr[k + 1] : null;
      let need = 0.08 - ((nx ? nx.a : 1) - (pv ? pv.b : 0));
      if (need > 0 && pv) { const t = Math.min(need, Math.max(0, pv.b - pv.a - 0.06)); pv.b -= t; need -= t; }
      if (need > 0 && nx) { const t = Math.min(need, Math.max(0, nx.b - nx.a - 0.06)); nx.a += t; }
    }
    // geniş geçişler (ön kol dönmesi, kuşak): komşu dar kuşakların arasındaki bütün aralık
    for (let k = 0; k < cr.length; k++) {
      if (cr[k].s !== null) continue;
      let a = k, b = k; while (a > 0 && cr[a - 1].s === null) a--; while (b + 1 < cr.length && cr[b + 1].s === null) b++;   // art arda geniş geçişler aralığı paylaşır
      const lo = a > 0 ? cr[a - 1].b : 0, hi = b + 1 < cr.length ? cr[b + 1].a : 1, w = (hi - lo) / (b - a + 1);
      cr[k].a = lo + (k - a) * w; cr[k].b = cr[k].a + w; cr[k].h = w / 2; cr[k].wide = true;
      if (fix.twist && cr[k].ref.type === 'twist' && cr[k].b - cr[k].a > fix.twist) { cr[k].a = cr[k].b - fix.twist; cr[k].h = fix.twist / 2; m.notes.push(`TABLO ön kol dönmesi yalnız distal ${fix.twist} sigma aralığında (kas ulna boyunca kalır)`); }
    }
    for (const o of cr) m.cross.push({ joint: o.ref.name, from: SEGS[path[cr.indexOf(o)]], to: SEGS[path[cr.indexOf(o) + 1]], a: rd(o.a, 3), b: rd(o.b, 3), wide: !!o.wide, dist: o.dist === undefined ? null : rd(o.dist, 2), near: o.near === undefined ? null : rd(o.near, 2) });
    for (let c = 0; c < n; c++) {
      let u = 0; for (const o of cr) u += o.cut ? (sg[c] >= CUT_AT ? 1 : 0) : smooth((sg[c] - o.a) / (o.b - o.a));
      const k = Math.min(path.length - 2, Math.floor(u)), f = u - k;
      W0[c * NS + path[k]] += 1 - f; W0[c * NS + path[k + 1]] += f;
    }
  }
  // --- iğnelerin düzeltmesi: perdelenmiş harmonik yayılım
  let diag = 0; { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let c = 0; c < n; c++) for (let a = 0; a < 3; a++) { const v = T.X[c * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; } diag = len(sub(mx, mn)); }
  const ell = Math.min(2.5, Math.max(0.6, 0.04 * diag)), lam = 1 / (2 * ell * ell);   // sönüm boyu: parçanın büyüklüğüne göre 0,6-2,5 cm
  const C = new Float64Array(n * NS), fixed = new Uint8Array(n); let maxMis = 0;
  for (const [c, v] of pin) { fixed[c] = 1; for (let k = 0; k < NS; k++) { const d = v[k] - W0[c * NS + k]; C[c * NS + k] = d; if (Math.abs(d) > maxMis) maxMis = Math.abs(d); } }
  m.maxMis = maxMis;
  if (m.binary) { for (let c = 0; c < n; c++) if (!fixed[c]) for (let k = 0; k < NS; k++) C[c * NS + k] = 0; }   // ani geçiş: düzeltme yayılmaz
  else if (maxMis > 1e-6) {
    const wsum = new Float64Array(n), mass = new Float64Array(n);
    for (let c = 0; c < n; c++) for (const l of T.nb[c].values()) { wsum[c] += 1 / l; mass[c] += l / 2; }
    const used = []; for (let k = 0; k < NS; k++) { let any = false; for (const c of pin.keys()) if (Math.abs(C[c * NS + k]) > 1e-9) { any = true; break; } if (any) used.push(k); }
    for (let it = 0; it < 400; it++) {
      let ch = 0;
      for (let c = 0; c < n; c++) {
        if (fixed[c]) continue; const den = wsum[c] + lam * mass[c];
        for (const k of used) { let s = 0; for (const [v, l] of T.nb[c]) s += C[v * NS + k] / l; const nv = s / den, d = nv - C[c * NS + k]; C[c * NS + k] = nv; if (Math.abs(d) > ch) ch = Math.abs(d); }
      }
      if (ch < 2e-5) break;
    }
  }
  const W = new Float64Array(n * NS);
  for (let c = 0; c < n; c++) {
    let s = 0; for (let k = 0; k < NS; k++) { const v = Math.max(0, W0[c * NS + k] + C[c * NS + k]); W[c * NS + k] = v; s += v; }
    if (s <= 0) { W[c * NS + path[0]] = 1; s = 1; }
    for (let k = 0; k < NS; k++) W[c * NS + k] /= s;
  }
  { let routed = 0; for (let c = 0; c < n; c++) if (routeAdjacent(W, c, true)) routed++; if (routed) m.notes.push(`${routed} kümede komşu olmayan segment karışımı ara segmente indirildi`); }
  m.W = W; m.ell = ell;
  // --- ani omuz geçişli kas: karın, proksimal kemik ile "izleyen segment" arasında sigma ile doğrusal karışır. İzleyen
  // segment dönmez, insersiyo merkeziyle birlikte ötelenir; iki öteleme arasındaki karışım doğrusal olduğundan kas
  // origodan insersiyoya düzgün uzar (eskiden bütün karın gövdede kalıyor, son üçgen sırası 20-30 cm geriliyordu).
  // İğneli köşeler (origo, insersiyo) kemiklerinde kalır; sigma >= CUT_AT olan kiriş ucu humerusla gider.
  if (m.binary && !ARGS.has('--no-follow')) {
    const fi = FOLLOWERS.length, Fk = SI['f' + fi];
    if (Fk === undefined) fail(`${p.n}: izleyen segment kalmadı (NFOLLOW = ${NFOLLOW})`);
    else {
      const at = [0, 0, 0]; let aa = 0;
      for (const c of I.keys()) { if (pinSeg.get(c) !== SI.humerus) continue; const ar = T.area[c]; aa += ar; at[0] += ar * T.X[c * 3]; at[1] += ar * T.X[c * 3 + 1]; at[2] += ar * T.X[c * 3 + 2]; }
      if (!(aa > 0)) fail(`${p.n}: izleyen segment için humerusta insersiyo kümesi yok`);
      else {
        let moved = 0;
        for (let c = 0; c < n; c++) {
          if (fixed[c]) continue; const g = Math.max(0, Math.min(1, m.sigma[c] / CUT_AT)); if (!(g > 0)) continue;
          for (let k = 0; k < SI.humerus; k++) { const d = W[c * NS + k] * g; if (d > 0) { W[c * NS + k] -= d; W[c * NS + Fk] += d; moved++; } }
        }
        FOLLOWERS.push({ key: 'f' + fi, at: R(mul(at, 1 / aa), 3), n: p.n }); m.follow = 'f' + fi;
        m.notes.push(`izleyen segment f${fi} (insersiyo merkezi ${R(mul(at, 1 / aa), 2).join(', ')}): ${moved} küme ağırlığı sigma / ${CUT_AT} oranında ona taşındı`);
      }
    }
  }
  // uç noktaları: origo ve insersiyo yerlerinin alan ağırlıklı merkezi ve oradaki ağırlıklar (düz çizgi boyu için)
  const endOf = set => { const p = [0, 0, 0], w = new Float64Array(NS); let a = 0; for (const c of set.keys()) { const ar = T.area[c]; a += ar; p[0] += ar * T.X[c * 3]; p[1] += ar * T.X[c * 3 + 1]; p[2] += ar * T.X[c * 3 + 2]; for (let k = 0; k < NS; k++) w[k] += ar * W[c * NS + k]; } for (let k = 0; k < NS; k++) w[k] /= a; return { p: mul(p, 1 / a), w }; };
  // Yer iki kemiğe yayılıyorsa (hiçbir segment %90'a ulaşmıyorsa) karışık ağırlıklı ortak merkez yanlış okuma verir
  // (ECU humerus başı: ulna .55 + humerus .45 merkezi dirsek ekseninin 6 cm altında, fleksiyonda +%22 "uzuyordu").
  // Çizgi, origoda zincirin en proksimal, insersiyoda en distal önemli (>= %15) kemiğindeki alt yerden, ağırlık 1 ile başlar.
  const endPure = (set, end) => {
    const e = endOf(set); let top = 0; for (let k = 0; k < NS; k++) if (e.w[k] > top) top = e.w[k];
    if (top >= 0.9) return e;
    let pick = -1; for (let k = 0; k < LEVEL.length; k++) if (segShare[end][k] >= 0.15 && (pick < 0 || (end === 'o' ? LEVEL[k] < LEVEL[pick] : LEVEL[k] > LEVEL[pick]))) pick = k;
    const part = new Map(); for (const c of set.keys()) if (pinSeg.get(c) === pick) part.set(c, 1);
    if (pick < 0 || !part.size) return e;
    const r = endOf(part); r.w = new Float64Array(NS); r.w[pick] = 1;
    m.notes.push(`${end === 'o' ? 'origo' : 'insersiyo'} iki kemikte: çizgi ucu ${SEGS[pick]} üstündeki alt yerin merkezi (${part.size} küme, ağırlık 1)`);
    return r;
  };
  m.endO = endPure(O, 'o'); m.endI = m.cont ? m.cont.B.endI : endPure(I, 'i');
  return m;
}

// orta çizgi: t'ye göre N örnek (şapka çekirdeği, alan ağırlıklı)
function centreline(m, N) {
  const T = m.T, n = T.count, S = Array.from({ length: N }, () => ({ p: [0, 0, 0], w: new Float64Array(NS), a: 0 }));
  for (let c = 0; c < n; c++) {
    const u = m.t[c] * (N - 1), i0 = Math.min(N - 2, Math.floor(u)), f = u - i0;
    for (const [i, k] of [[i0, 1 - f], [i0 + 1, f]]) { if (k <= 0) continue; const a = k * T.area[c], s = S[i]; s.p[0] += a * T.X[c * 3]; s.p[1] += a * T.X[c * 3 + 1]; s.p[2] += a * T.X[c * 3 + 2]; s.a += a; for (let q = 0; q < NS; q++) s.w[q] += a * m.W[c * NS + q]; }
  }
  for (const s of S) if (s.a > 0) { s.p = mul(s.p, 1 / s.a); for (let q = 0; q < NS; q++) s.w[q] /= s.a; }
  // boş dilim: komşularından ara değer
  for (let i = 0; i < N; i++) if (!(S[i].a > 0)) {
    let a = i - 1, b = i + 1; while (a >= 0 && !(S[a].a > 0)) a--; while (b < N && !(S[b].a > 0)) b++;
    const A = a >= 0 ? S[a] : S[b], Bq = b < N ? S[b] : S[a], f = a >= 0 && b < N ? (i - a) / (b - a) : 0;
    S[i].p = add(mul(A.p, 1 - f), mul(Bq.p, f)); for (let q = 0; q < NS; q++) S[i].w[q] = A.w[q] * (1 - f) + Bq.w[q] * f; S[i].fill = true;
  }
  return S.map(s => ({ p: s.p, w: s.w }));
}
const polyLen = L => { let s = 0; for (let i = 1; i < L.length; i++) s += len(sub(L[i].p, L[i - 1].p)); return s; };
// Omuz geçişinde orta çizgi gergin tutulur: deri ağırlıklarıyla taşınan ara örnekler omuz merkezi çevresinde çember
// çizer (kas "dolanır": kısalması gereken kas uzamış görünür). Gergin bir kas köşeyi keser; bu yüzden geçiş kuşağındaki
// örnekler, kuşaktan önceki son (proksimal kemiğe katı bağlı) örneğin üstüne toplanır: çizgi oradan humerusa katı bağlı
// ilk örneğe düz gider. Ani geçişli (cut) kaslarda bütün karın proksimal kemiğe bağlıdır; orada "ayrılma noktası",
// proksimal segmentin kemiklerine 2 cm'den yakın duran son örnektir (kiriş oradan insersiyoya düz gerilir).
// Örnek sayısı ve t = i / (N - 1) eşlemesi değişmez (toplanan örnekler üst üste biner).
const TAUT = !ARGS.has('--no-taut');
function tautShoulder(m) {
  const L = m.line, N = L.length, distal = s => { let w = 0; for (let k = SI.humerus; k < NS; k++) w += s.w[k]; return w; };
  let a = -1, b = -1;
  if (m.binary) {
    const bones = m.gh === SI.thorax ? staticBones.filter(x => x.sd !== 'r') : segBones[SEGS[m.gh]];
    for (let i = N - 2; i >= 0; i--) if (nearestBone(L[i].p, 2.0, bones).b) { a = i; break; }
    if (a < 0) a = 0; b = N - 1;
  } else {
    for (let i = 0; i < N; i++) { const d = distal(L[i]); if (d <= 0.05) a = i; if (d >= 0.95) { b = i; break; } }
    // döndürücü manşet (FIX: tautEnd): humerus başının üstündeki kiriş örnekleri başla birlikte eklemin içine döner ve
    // çizgiyi uzatır (supraspinatus abduksiyonda +%1,8); çizgi son skapula örneğinden insersiyo merkezine düz gider
    if ((FIX[m.p.n] || {}).tautEnd && a >= 0) b = N - 1;
    if (a < 0 || b < 0 || b <= a + 1) return;
  }
  m.axis = L.map(s => s.p.slice());     // toplanmadan önceki geometrik orta çizgi (kalınlaşmanın radyal uzaklıkları için)
  for (let i = a + 1; i < b; i++) L[i] = { p: L[a].p.slice(), w: Float64Array.from(L[a].w) };
  m.taut = { a, b };
  m.notes.push(`orta çizgi omuzda gergin: ${a}. örnekten ${b}. örneğe düz (aradaki ${b - a - 1} örnek ${a}. örneğin üstünde)`);
}

// ---------- kaslar ----------
say('\n== Kaslar ==');
const NLINE = 12;
const done = new Map();
const order = [...muscleParts.filter(p => !Object.values(FIX[p.n] || {}).some(r => r && r.cont)), ...muscleParts.filter(p => Object.values(FIX[p.n] || {}).some(r => r && r.cont))];
for (const p of order) {
  const m = buildMuscle(p, done); done.set(p.n, m);
  if (!m.W) continue;
  const lerpS = (A, Bq, f) => ({ p: add(mul(A.p, 1 - f), mul(Bq.p, f)), w: A.w.map((v, q) => v * (1 - f) + Bq.w[q] * f) });
  let contPts = null, info = null;
  if (m.cont) {
    // çizgi: kendi örnekleri + izlenen parçanın çizgisinin devamı; t buna göre ölçeklenir
    const Bl = m.cont.B.line, tipC = mean(m.cont.tip.map(c => cx(m.T, c)));
    let bi = 0, bd = Infinity, bf = 0;   // izlenen çizgide uca en yakın nokta
    for (let i = 0; i + 1 < Bl.length; i++) { const a = Bl[i].p, b = Bl[i + 1].p, ab = sub(b, a), f = Math.max(0, Math.min(1, dot(sub(tipC, a), ab) / dot(ab, ab))), d = len(sub(tipC, add(a, mul(ab, f)))); if (d < bd) { bd = d; bi = i; bf = f; } }
    contPts = [lerpS(Bl[bi], Bl[bi + 1], bf), ...Bl.slice(bi + 1)]; info = { name: m.cont.name, gap: bd };
  } else if (FIX[p.n] && FIX[p.n].ext) {
    // çizgi insersiyodan öteye, kuvvetin aktarıldığı kemiğin tabanına uzatılır (köşe ağırlıkları değişmez)
    const b = B(FIX[p.n].ext.bone), a = longAxis(b), bv = verts(b), tt = bv.map(x => dot(sub(x, a.c), a.v)), hi = Math.max(...tt), lo = Math.min(...tt);
    const w = new Float64Array(NS); w[SI[b.seg]] = 1;
    const base = { p: mean(bv.filter((x, i) => tt[i] > hi - 0.2 * (hi - lo))), w };   // gövde ekseni proksimale bakar: üst %20 = taban
    contPts = [centreline(m, NLINE)[NLINE - 1], base]; info = { name: FIX[p.n].ext.bone + ' (taban)', gap: 0, ext: true };
    m.endI = base; m.how.i.push(`TABLO çizgi uzatması -> ${FIX[p.n].ext.bone}: ${FIX[p.n].ext.why}`);
  }
  if (contPts) {
    const own0 = centreline(m, NLINE), Lown = polyLen(own0), Lcont = polyLen(contPts);
    const nOwn = Math.min(NLINE - 2, Math.max(3, Math.round((NLINE - 1) * Lown / (Lown + Lcont)) + 1));
    const tau = (nOwn - 1) / (NLINE - 1);
    const own = centreline(m, nOwn), line = [...own];
    line[0] = { p: m.endO.p, w: m.endO.w };
    // devam: yay uzunluğuna göre eşit aralıklı
    const cum = [0]; for (let i = 1; i < contPts.length; i++) cum.push(cum[i - 1] + len(sub(contPts[i].p, contPts[i - 1].p)));
    for (let i = nOwn; i < NLINE; i++) {
      const s = (i - (nOwn - 1)) / (NLINE - nOwn) * Lcont; let k = 1; while (k < cum.length - 1 && cum[k] < s) k++;
      line.push(lerpS(contPts[k - 1], contPts[k], cum[k] > cum[k - 1] ? (s - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0));
    }
    m.line = line; m.tScale = tau; m.contInfo = { ...info, nOwn, Lown, Lcont };
  } else {
    // çizginin iki ucu tutunma yerlerinin kendisidir (yer merkezi, kendi kemiğine bağlı): uç dilimin ortalaması değil
    m.line = centreline(m, NLINE); m.tScale = 1;
    m.line[0] = { p: m.endO.p, w: m.endO.w }; m.line[NLINE - 1] = { p: m.endI.p, w: m.endI.w };
  }
  if (m.gh !== undefined && TAUT) tautShoulder(m);
  m.L0 = polyLen(m.line);
}

// ---------- eklem parçaları ----------
function buildJoint(p) {
  const T = topology(p), n = T.count, D = new Float64Array(n * NS).fill(Infinity);
  for (let c = 0; c < n; c++) { const x = cx(T, c); for (const b of allBones) { if (!nearBox(b, x, 2.5)) continue; const d = dist(b, x), k = SI[b.seg]; if (d < D[c * NS + k]) D[c * NS + k] = d; } }
  const fixj = JOINT_FIX[p.n];
  const touch = new Float64Array(NS), minD = new Float64Array(NS).fill(Infinity);
  for (let c = 0; c < n; c++) for (let k = 0; k < NS; k++) { if (D[c * NS + k] < TH_TOUCH) touch[k] += 1 / n; if (D[c * NS + k] < minD[k]) minD[k] = D[c * NS + k]; }
  let segs;
  if (fixj) segs = fixj.segs.map(s => SI[s]);
  else {
    segs = []; for (let k = 0; k < NS; k++) if (touch[k] >= 0.03 && touch[k] * n >= 2) segs.push(k);
    if (!segs.length) { let b = 0; for (let k = 1; k < NS; k++) if (minD[k] < minD[b]) b = k; segs = [b]; }
  }
  const W = new Float64Array(n * NS);
  for (let c = 0; c < n; c++) {
    if (segs.length === 1) { W[c * NS + segs[0]] = 1; continue; }
    const ds = segs.map(k => [k, D[c * NS + k]]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    const inside = ds.filter(e => e[1] < TH_RIGID);
    let s = 0;
    if (inside.length) { for (const [k, d] of inside) { const w = 1 / (d + 0.01) ** 2; W[c * NS + k] = w; s += w; } if (inside.length === 1) { W[c * NS + inside[0][0]] = 1; s = 1; } }
    else for (const [k, d] of ds) { if (d === Infinity) continue; const w = 1 / (d - TH_RIGID + 0.02) ** 2; W[c * NS + k] = w; s += w; }
    if (s <= 0) { W[c * NS + ds[0][0]] = 1; s = 1; }
    for (let k = 0; k < NS; k++) W[c * NS + k] /= s;
  }
  let routed = 0; for (let c = 0; c < n; c++) if (routeAdjacent(W, c, false)) routed++;
  return { p, T, W, segs, touch, fix: fixj, routed };
}
const jointBuilt = armJoints.map(buildJoint);

// ---------- ağırlıkları bayta çevir, .bin ve parça dizini ----------
const fnv1a = bytes => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const posSum = p => fnv1a(new Uint8Array(p.P.buffer, p.P.byteOffset, p.P.byteLength));
function quantize(W, c, out, o) {   // en büyük 4 ağırlık -> toplamı tam 255 olan 4 bayt
  const e = []; for (let k = 0; k < NS; k++) if (W[c * NS + k] > 0) e.push([k, W[c * NS + k]]);
  e.sort((a, b) => b[1] - a[1]); e.length = Math.min(e.length, 4);
  const s = e.reduce((a, b) => a + b[1], 0), q = e.map(([k, w]) => [k, Math.floor(w / s * 255), w / s * 255 % 1]);
  let rem = 255 - q.reduce((a, b) => a + b[1], 0);
  for (const x of [...q].sort((a, b) => b[2] - a[2])) { if (rem <= 0) break; x[1]++; rem--; }
  const kept = q.filter(x => x[1] > 0);
  for (let i = 0; i < 4; i++) { out[o + i] = i < kept.length ? kept[i][0] : kept[0][0]; out[o + 4 + i] = i < kept.length ? kept[i][1] : 0; }
}
const skinParts = [], chunks = []; let offset = 0;
const muscleBuilt = muscleParts.map(p => done.get(p.n)).filter(m => m && m.W);
const segPct = (m) => { const nV = m.p.P.length / 3, acc = new Float64Array(NS); for (let v = 0; v < nV; v++) { const c = m.T.cluster[v]; for (let k = 0; k < NS; k++) acc[k] += m.W[c * NS + k] / nV; } return acc; };
const lineOut = L => L.map(s => { const e = []; for (let k = 0; k < NS; k++) if (s.w[k] > 0.004) e.push([SEGS[k], s.w[k]]); e.sort((a, b) => b[1] - a[1]); e.length = Math.min(e.length, 4); const t = e.reduce((a, b) => a + b[1], 0); return { p: R(s.p, 3), w: e.map(([k, w]) => [k, rd(w / t, 3)]) }; });
for (const [kind, list] of [['muscle', muscleBuilt], ['joint', jointBuilt]]) for (const m of list) {
  const p = m.p, nV = p.P.length / 3, buf = new Uint8Array(nV * 9), tmp = new Uint8Array(8), cache = new Map();
  for (let v = 0; v < nV; v++) {
    const c = m.T.cluster[v]; let q = cache.get(c);
    if (!q) { quantize(m.W, c, tmp, 0); q = Array.from(tmp); q.push(kind === 'muscle' ? Math.max(0, Math.min(255, Math.round(m.t[c] * m.tScale * 255))) : 0); cache.set(c, q); }
    buf.set(q, v * 9);
  }
  const pct = segPct(m), chain = []; for (let k = 0; k < NS; k++) if (pct[k] > 0.0005) chain.push(SEGS[k]);
  m.pct = pct; m.chain = chain;
  const rec = { n: p.n, id: p.id, kind, verts: nV, offset, sum: posSum(p), chain };
  if (kind === 'muscle') { rec.L0 = rd(m.L0, 3); rec.line = lineOut(m.line); rec.ends = lineOut([m.endO, m.endI]); if (m.axis) rec.axis = m.axis.map(q => R(q, 3)); if (m.contInfo) rec[m.contInfo.ext ? 'ext' : 'cont'] = m.contInfo.name; if (m.tScale < 1) rec.tMax = rd(m.tScale, 3); if (m.follow) rec.follow = m.follow; }
  // zincire orta çizgi örneklerinin segmentleri de girer (köşe payı çok küçük olan uç segmentler, ör. FCU ulnar başında el)
  if (rec.line) { const set = new Set(rec.chain); for (const smp of rec.line) for (const [k] of smp.w) set.add(k); rec.chain = SEGS.filter(k => set.has(k)); }
  skinParts.push(rec); chunks.push(buf); offset += buf.length;
}
const bin = new Uint8Array(offset); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; } }

// ---------- kas raporu ----------
const pctStr = pct => SEGS.map((k, i) => (pct[i] > 0.0005 ? `${k} ${(pct[i] * 100).toFixed(pct[i] < 0.01 ? 1 : 0)}%` : null)).filter(Boolean).join(', ');
const shareStr = v => SEGS.map((k, i) => (v[i] > 0.005 ? `${k}${v[i] < 0.995 ? ' ' + Math.round(v[i] * 100) + '%' : ''}` : null)).filter(Boolean).join(' + ');
const tableUsed = [];
for (const m of muscleBuilt) {
  const fix = FIX[m.p.n]; if (fix) tableUsed.push(m.p.n);
  if (BRIEF) continue;
  say(`\n- ${m.p.n} (${m.p.id}; ${m.p.P.length / 3} köşe, ${m.T.count} küme${m.T.nc > 1 ? `, ${m.T.nc} bileşen, ${m.T.bridges} köprü` : ''})`);
  say(`    origo: ${shareStr(m.segShare.o)} (${m.O.size} küme) <- ${m.how.o.join(' | ')}`);
  say(`    insersiyo: ${shareStr(m.segShare.i)} (${m.I.size} küme) <- ${m.how.i.join(' | ')}`);
  say(`    yol: ${m.path.map(k => SEGS[k]).join(' -> ')}${m.path.length === 1 ? ' (katı)' : ''}; zincir: ${m.chain.join(', ')}; köşe payı: ${pctStr(m.pct)}`);
  if (m.cross.length) say('    geçişler: ' + m.cross.map(c => `${c.joint} ${c.from}->${c.to} sigma ${c.a}-${c.b}${c.wide ? ' (geniş)' : ''}${c.dist !== null ? ` (en yakın kesit sigma ${c.near}, ${c.dist} cm)` : ''}`).join('; '));
  say(`    L0 ${f2(m.L0)} cm; iğne düzeltmesi en çok ${f2(m.maxMis)} (sönüm ${f2(m.ell)} cm)${m.contInfo ? `; çizgi "${m.contInfo.name}" ile uzatıldı (kendi ${m.contInfo.nOwn} örnek, ${f2(m.contInfo.Lown)} + ${f2(m.contInfo.Lcont)} cm, aralık ${f2(m.contInfo.gap)} cm)` : ''}`);
  if (m.notes.length) say('    not: ' + m.notes.join('; '));
}
say(`\nDüzeltme tablosuyla belirlenen kaslar (${tableUsed.length}): ${tableUsed.join('; ')}`);
say(`Kas özeti: ${muscleBuilt.length} parça, ${muscleBuilt.reduce((a, m) => a + m.p.P.length / 3, 0)} köşe; katı (tek segment) ${muscleBuilt.filter(m => m.chain.length === 1).map(m => m.p.n).join('; ') || '-'}`);

say('\n== Eklem parçaları ==');
for (const m of jointBuilt) {
  if (BRIEF && !m.fix) continue;
  say(`- ${m.p.n} (${m.p.id}; ${m.p.P.length / 3} köşe): ${m.segs.length === 1 ? 'katı ' : ''}${pctStr(m.pct)}${m.fix ? `  [TABLO: ${m.fix.why}]` : ''}`);
}
say(`Eklem özeti: ${jointBuilt.length} parça, ${jointBuilt.reduce((a, m) => a + m.p.P.length / 3, 0)} köşe; katı ${jointBuilt.filter(m => m.chain.length === 1).length}, çok segmentli ${jointBuilt.filter(m => m.chain.length > 1).length}`);

// ---------- hareket listesi (ders kitabı kasları locomotor.json'dan) ----------
const skinNames = new Set(skinParts.filter(s => s.kind === 'muscle').map(s => s.n));
const locoMove = (joint, de) => { const j = loco.joints.list.find(x => x.key === joint), mv = j && j.movements.find(x => x.de === de || x.de.startsWith(de + ' ')); if (!mv) fail(`locomotor.json: ${joint} / ${de} hareketi yok`); return mv || { muscles: [] }; };
const MOVES = [
  // [anahtar, grup, locomotor eklemi, locomotor'daki Almanca ad, set, from]; from: çalma ve kısalma karşılaştırması için önerilen başlangıç
  ['gElev', 'guertel', null, 'Elevation', { girdleElev: 40 }, { girdleElev: 0 }, 'Omuz kuşağını yükseltme (elevasyon)'],
  ['gDep', 'guertel', null, 'Depression', { girdleElev: -10 }, { girdleElev: 0 }, 'Omuz kuşağını indirme (depresyon)'],
  ['gProt', 'guertel', null, 'Protraktion', { girdleProt: 25 }, { girdleProt: 0 }, 'Omuz kuşağını öne alma (protraksiyon)'],
  ['gRetr', 'guertel', null, 'Retraktion', { girdleProt: -25 }, { girdleProt: 0 }, 'Omuz kuşağını geriye alma (retraksiyon)'],
  ['abd', 'schulter', 'schulter', 'Abduktion', { plane: 0, elev: 170 }, null],
  ['ante', 'schulter', 'schulter', 'Anteversion', { plane: 90, elev: 170 }, null],
  ['retro', 'schulter', 'schulter', 'Retroversion', { plane: -90, elev: 40 }, null],
  // Adduktion: SPEC'teki hedef (plane 180, elev 40: gövdenin önünden içe) bu bedende humerusu göğüs kafesinin içinden
  // geçirir (kin-interface.md, critique.md M1). Hareket, 90 derece abduksiyondan sarkan kola dönüş olarak tanımlandı.
  ['add', 'schulter', 'schulter', 'Adduktion', { plane: rest.plane, elev: rest.elev }, { plane: 0, elev: 90 }],
  ['ar', 'schulter', 'schulter', 'Außenrotation', { rot: -60 }, { rot: 0 }],
  ['ir', 'schulter', 'schulter', 'Innenrotation', { rot: 95 }, { rot: 0 }],
  ['flex', 'ellenbogen', 'ellenbogen', 'Flexion', { elbow: 150 }, { elbow: 0 }],
  ['ext', 'ellenbogen', 'ellenbogen', 'Extension', { elbow: 0 }, { elbow: 150 }],
  ['sup', 'unterarm', 'ellenbogen', 'Supination', { forearm: -85 }, { forearm: 85 }],
  ['pro', 'unterarm', 'ellenbogen', 'Pronation', { forearm: 85 }, { forearm: -85 }],
  ['palmar', 'hand', 'hand', 'Palmarflexion', { wristFlex: 60 }, { wristFlex: 0 }],
  ['dorsal', 'hand', 'hand', 'Dorsalextension', { wristFlex: -60 }, { wristFlex: 0 }],
  ['radial', 'hand', 'hand', 'Radialabduktion', { wristDev: -25 }, { wristDev: 0 }],
  ['ulnar', 'hand', 'hand', 'Ulnarabduktion', { wristDev: 35 }, { wristDev: 0 }],
];
const movements = MOVES.map(([key, group, joint, de, set, from, trOwn]) => {
  const mv = joint ? locoMove(joint, de) : null;
  const o = { key, group, joint, de: mv ? mv.de : de, tr: mv ? mv.tr : trOwn, set };
  if (from) o.from = from;
  if (mv && mv.range_de) o.range_de = mv.range_de;
  o.textbook = mv ? mv.muscles.filter(n => { if (skinNames.has(n)) return true; warn(`${key}: ders kitabı kası deri parçaları arasında yok: ${n}`); return false; }) : [];
  return o;
});
say('\n== Hareketler ==');
for (const mv of movements) say(`  ${mv.key.padEnd(7)} ${mv.de.padEnd(26)} set ${JSON.stringify(mv.set)}${mv.from ? ' from ' + JSON.stringify(mv.from) : ''}  ders kitabı: ${mv.textbook.length ? mv.textbook.length + ' kas' : 'yok (locomotor.json omuz kuşağını içermiyor)'}`);

// ---------- motion.json ----------
if (FOLLOWERS.length !== NFOLLOW) fail(`izleyen segment sayısı ${FOLLOWERS.length}, ayrılan ${NFOLLOW} (NFOLLOW'u ani geçişli kas sayısına eşitleyin)`);
const segments = SEGS.map(k => { const f = FOLLOWERS.find(x => x.key === k); return f ? { key: k, parent: PARENT[k], at: f.at, bones: [], ids: [], for: f.n } : { key: k, parent: PARENT[k], bones: segBones[k].map(b => b.n).sort(), ids: segBones[k].sort((a, b) => (a.n < b.n ? -1 : 1)).map(b => b.id) }; });
// Hareket eden kemiklere değen ama ne segmentte ne deri listesinde olan sol parçalar (bursa, kiriş kılıfı, fasya, retinakulum):
// kip bunları gizlemelidir, yoksa kol giderken yerlerinde asılı kalırlar. Ölçüt: örneklenen köşelerin %15'inden fazlası
// hareketli bir kemiğe 0,3 cm'den yakın.
const unskinned = (() => {
  const have = new Set([...skinParts.map(x => x.id), ...armBones.map(b => b.id)]), out = [];
  for (const p of parts) {
    if (p.sd !== 'l' || p.sub === 'attach' || (p.s !== 'joint' && p.s !== 'muscle') || have.has(p.id)) continue;
    const nV = p.P.length / 3, st = Math.max(1, Math.floor(nV / 200)); let near = 0, tot = 0;
    for (let i = 0; i < nV; i += st) { tot++; if (nearestBone([p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]], 0.3, armBones).b) near++; }
    if (near / tot > 0.15) out.push(p);
  }
  return out.sort((a, b) => (a.n < b.n ? -1 : 1));
})();
say(`\n== Deri verilmeyen, hareketli kemiğe değen parçalar (kip gizlemeli): ${unskinned.length} ==`);
for (const p of unskinned) say(`  ${p.id} ${p.s}/${p.sub || ''} ${p.n}`);
const data = {
  v: 1, side: 'l',
  note: 'tools/motion-build.mjs üretir; elle düzenlemeyin. Birim cm; +x = bedenin solu, +y yukarı, +z ön. Açılar Neutral-Null derecesi.',
  segments,
  joints: {
    sc: { p: J.sc }, ac: { p: J.ac }, gh: { p: J.gh, r: rd(LM.ghR, 3) },
    elbow: { p: J.elbow, axis: AX.elbow, ends: LM.elbowEnds.map(e => R(e)) },
    forearm: { p: J.radHead, q: J.ulnHead, dir: AX.forearm },
    wrist: { p: J.wrist, flexAxis: AX.flex, devAxis: AX.dev },
    scapula: { ai: R(LM.ai), ts: R(LM.ts), aa: R(LM.aa), as: R(LM.as), mb: LM.mb.map(x => R(x)), glenoid: R(LM.glenoid), glenoidN: R(LM.glenoidN, 6) },
  },
  rest,
  thoraxFit: { c: R(thoraxFit.c), r: R(thoraxFit.r), rms: rd(thoraxFit.rms, 3), about: 'sol 2.-9. kaburgaların arka ve yan bölümünün bütün köşelerine eksenlere hizalı elipsoit; skapula noktaları joints.scapula içinde' },
  skin: {
    file: 'models/motion-arm.bin', bytesPerVertex: 9, bytes: bin.length,
    layout: 'köşe başına: 4 segment indisi (uint8, segments sırası), 4 ağırlık (uint8, toplam 255), t (uint8; kaslarda 0 = origo ucu, 255 = insersiyo ucu; eklem parçalarında 0)',
    sum: 'FNV-1a 32 bit: parçanın float32 dünya konumlarının baytları üzerinde (uygulamada r.geo.attributes.position.array, küçük sonlu); işaretsiz tam sayı',
    line: `orta çizgi ${NLINE} örnek; i. örnek t = i / ${NLINE - 1} konumundadır; w = o dilimin segment ağırlıkları; L0 = dinlenmedeki çizgi boyu (cm). cont: çizgi adı verilen parçanın çizgisiyle insersiyoya kadar uzatılmıştır (köşelerin t değeri buna göre 1'den küçük kalır). ends: [origo yerinin merkezi, insersiyo yerinin merkezi] ve oradaki ağırlıklar (düz çizgi boyu için; SPEC dışı ek). axis (yalnız omuzda gergin tutulan çizgilerde): toplanmamış geometrik orta çizginin ${NLINE} noktası; kalınlaşmanın radyal uzaklıkları için line yerine bunu kullanın`,
    parts: skinParts,
    unskinned: unskinned.map(p => p.id),
  },
  movements,
};

// ---------- denetimler ----------
say('\n== Denetimler ==');
{
  // her hareketli kemik tam bir segmentte
  const cnt = new Map(); for (const s of segments) for (const id of s.ids) cnt.set(id, (cnt.get(id) || 0) + 1);
  const bad = armBones.filter(b => cnt.get(b.id) !== 1);
  if (bad.length) fail(`tam bir segmentte olmayan kemikler: ${bad.map(b => b.n).join(', ')}`); else say(`  [tamam] ${armBones.length} hareketli kemiğin her biri tam bir segmentte (${segments.map(s => s.key + ' ' + s.bones.length).join(', ')})`);
  // ağırlık toplamı 255, indisler geçerli; kaynaklı köşeler aynı baytları taşıyor
  let badSum = 0, badIdx = 0, seam = 0;
  for (let o = 0; o < bin.length; o += 9) { if (bin[o + 4] + bin[o + 5] + bin[o + 6] + bin[o + 7] !== 255) badSum++; for (let i = 0; i < 4; i++) if (bin[o + i] >= segments.length) badIdx++; }
  for (const s of skinParts) {
    const p = (s.kind === 'muscle' ? muscleBuilt : jointBuilt).find(m => m.p.id === s.id).p, seen = new Map();
    for (let v = 0; v < s.verts; v++) { const k = p.P[v * 3] + ',' + p.P[v * 3 + 1] + ',' + p.P[v * 3 + 2], a = s.offset + v * 9, prev = seen.get(k); if (prev === undefined) seen.set(k, a); else for (let i = 0; i < 9; i++) if (bin[prev + i] !== bin[a + i]) { seam++; break; } }
  }
  if (badSum || badIdx) fail(`${badSum} köşede ağırlık toplamı 255 değil, ${badIdx} geçersiz segment indisi`); else say(`  [tamam] ${bin.length / 9} köşenin hepsinde ağırlık toplamı 255, indisler 0-${NS - 1}`);
  if (seam) fail(`${seam} dikiş köşesi eşinden farklı ağırlık taşıyor`); else say('  [tamam] aynı konumdaki (kaynaklı) köşeler aynı baytları taşıyor: dikişlerde yırtılma olmaz');
  const empty = muscleParts.filter(p => { const m = done.get(p.n); return !m || !m.W || !m.O.size || !m.I.size; });
  if (empty.length) fail(`origo ya da insersiyo kümesi boş kaslar: ${empty.map(p => p.n).join(', ')}`); else say(`  [tamam] ${muscleParts.length} kasın hepsinde origo ve insersiyo kümesi dolu`);
  const sums = new Set(skinParts.map(s => s.id)); if (sums.size !== skinParts.length || skinParts.some(s => !Number.isInteger(s.sum))) fail('sağlama toplamı tablosu eksik'); else say(`  [tamam] sağlama toplamı tablosu: ${skinParts.length} parça (${skinParts.filter(s => s.kind === 'muscle').length} kas, ${skinParts.filter(s => s.kind === 'joint').length} eklem parçası), .bin ${bin.length} bayt`);
  // uygulamadan alınmış toplamlar varsa (data/work/motion/crit-sums-app.txt: tarayıcıda çalışan uygulamanın geometrisi) karşılaştır
  const appSums = WORK + 'crit-sums-app.txt', glbTime = Math.max(...['bones', 'joints', 'muscles'].map(f => fs.statSync(`public/models/${f}.glb`).mtimeMs));
  if (fs.existsSync(appSums) && fs.statSync(appSums).mtimeMs < glbTime) say('  [atlandı] crit-sums-app.txt modellerden eski: uygulama toplamlarıyla karşılaştırılmadı (modeller yeniden dönüştürülmüş)');
  else if (fs.existsSync(appSums)) {
    const app = new Map(fs.readFileSync(WORK + 'crit-sums-app.txt', 'utf8').trim().split(/\s+/).map(e => { const a = e.split(':'); return [a[0], [+a[1], +a[3]]]; }));
    let same = 0, diff = 0, miss = 0; for (const s of skinParts) { const a = app.get(s.id); if (!a) miss++; else if (a[0] === s.verts && a[1] === s.sum) same++; else { diff++; say(`    fark: ${s.n}`); } }
    if (diff) fail(`${diff} parçanın köşe sayısı / toplamı uygulamadakinden farklı`); else say(`  [tamam] uygulamadan alınmış toplamlarla (crit-sums-app.txt) karşılaştırma: ${same} parça aynı${miss ? `, ${miss} parça o dosyada yok` : ''}`);
  } else say('  [atlandı] uygulamadan alınmış toplam dosyası yok (crit-sums-app.txt)');
  say(fails.some(f => /beklenen|sapıyor|uzak/.test(f)) ? '  [HATA] işaret noktaları beklenen değerlerden uzak' : '  [tamam] işaret noktaları beklenen değerlerin 0,5 cm / 5 derece içinde');
}
// kinematik modülle: dinlenme duruşu birim matris veriyor mu, işaretler onun kullandığı yönde mi
const kinPath = new URL('../src/motion-kin.js', import.meta.url);
if (fs.existsSync(kinPath)) {
  try {
    const K = await import(kinPath.href);
    {
      // rest.rot (Neutral-Null): sıfır = sarkan kolda, dirsek 90 derece bükülüyken ön kol tam öne bakar. Dinlenme bükümü 0
      // sayılarak kurulan modelde bu duruşu veren büküm x aranır; dinlenmenin Neutral-Null dönmesi -x olur.
      const m0 = K.createModel(JSON.parse(JSON.stringify({ ...data, rest: { ...rest, rot: 0 } })));
      const side = x => { const o = K.fk(m0, { ...K.neutralPose(), rot: x, elbow: 90 }), e = o.pts.elbow, w = o.pts.wrist; return (w[0] - e[0]) / Math.hypot(w[0] - e[0], w[2] - e[2]); };
      let lo = -40, hi = 40;
      if (!(side(lo) * side(hi) < 0)) fail('rest.rot ölçülemedi: ön kol -40..40 derece bükümde öne bakmıyor');
      else {
        for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (side(lo) * side(mid) <= 0) hi = mid; else lo = mid; }
        rest.rot = rd(-0.5 * (lo + hi), 6);
        say(`  rest.rot: ${f2(rest.rot)} (${rest.rot < 0 ? 'Außenrotation' : 'Innenrotation'} ${f2(Math.abs(rest.rot))}); sıfır = sarkan kol, dirsek 90 derecede ön kol tam öne (Neutral-Null). Nötr duruşta düz dirsekle ön kol`);
        const o = K.fk(m0, { ...K.neutralPose(), rot: -rest.rot, forearm: -85 }), e = o.pts.elbow, w = o.pts.wrist;
        say(`            frontal düzlemde düşeyden ${f2(Math.atan2(w[0] - e[0], e[1] - w[1]) * DEG)} derece dışa sapar (+ = valgus; modelde taşıma açısı yok, biomech.md bölüm 7)`);
        if (Math.abs(rest.rot) > 20) fail(`rest.rot ${f2(rest.rot)}: beklenen 0'a yakın`);
      }
    }
    const model = K.createModel(JSON.parse(JSON.stringify(data)));
    // hareket hedefleri izinli aralığın içinde olmalı (ör. Retraktion sınırı skapula omurgaya binmesin diye 25 değil 16)
    for (const mv of movements) {
      const base = { ...rest, ...(mv.from || {}) }, q = K.applySet(model, base, mv.set);
      for (const k of Object.keys(mv.set)) if (Math.abs(q[k] - mv.set[k]) > 0.01) { say(`  hareket ${mv.key}: ${k} hedefi ${mv.set[k]} -> ${rd(q[k], 2)} (motion-kin.js sınırı)`); mv.set[k] = rd(q[k], 2); }
    }
    for (const w of model.warnings || []) warn('motion-kin: ' + w);
    for (const w of model.notes || []) say('  motion-kin notu: ' + w);
    const o = K.fk(model, K.restPose(model)); let dev = 0;
    for (let i = 0; i < segments.length; i++) for (let k = 0; k < 16; k++) dev = Math.max(dev, Math.abs(o.mats[i * 16 + k] - (k % 5 === 0 ? 1 : 0)));
    if (dev > 1e-9) fail(`kinematik dinlenme duruşu birim matris vermiyor (en büyük sapma ${dev.toExponential(2)})`); else say(`  [tamam] motion-kin.js: dinlenme duruşunda ${SEGS.length} segment matrisi birim (en büyük sapma ${dev.toExponential(1)})`);
    // işaretler: +10 derece, kinematik modülün matrisleriyle
    const at = (pose, seg, pt) => K.transformPoint(K.fk(model, { ...K.restPose(model), ...pose }).m[seg], pt);
    const chk = (name, ok) => { if (ok) say(`  [tamam] motion-kin.js ile işaret: ${name}`); else fail(`motion-kin.js ile işaret sınaması tutmadı: ${name}`); };
    { const q = at({ elbow: rest.elbow + 10 }, 'ulna', styMid); chk('elbow + = Flexion (el bileği omza yaklaşır)', len(sub(q, J.gh)) < len(sub(styMid, J.gh))); }
    { const q = at({ forearm: rest.forearm + 10 }, 'radius', LM.radSty); chk('forearm + = Pronation (radius stiloidi avuç yönüne)', dot(sub(q, LM.radSty), palmar0) > 0); }
    { const q = at({ wristFlex: rest.wristFlex + 10 }, 'hand', LM.mc3Head); chk('wristFlex + = Palmarflexion', dot(sub(q, LM.mc3Head), palmar) > 0); }
    { const q = at({ wristDev: rest.wristDev + 10 }, 'hand', LM.mc3Head); chk('wristDev + = Ulnarabduktion', dot(sub(q, LM.mc3Head), ruLine) > 0); }
    { const q = at({ wristFlex: rest.wristFlex + 10 }, 'carpProx', LM.mc3Head), h = at({ wristFlex: rest.wristFlex + 10 }, 'hand', LM.mc3Head); chk('carpProx el bileği açısının yarısını alır', Math.abs(len(sub(q, LM.mc3Head)) / len(sub(h, LM.mc3Head)) - 0.5) < 0.02); }
  } catch (e) { fail('motion-kin.js denetimi çalışmadı: ' + (e && e.message)); }
} else warn('src/motion-kin.js yok: "dinlenme duruşu birim matris" denetimi YAPILAMADI');

// ---------- yaz ----------
const json = JSON.stringify(data);
say(`\nmotion.json ${(json.length / 1024).toFixed(1)} KB, motion-arm.bin ${(bin.length / 1024).toFixed(1)} KB; süre ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
if (warns.length) say(`${warns.length} uyarı`);
if (fails.length) { say(`\n${fails.length} DENETİM TUTMADI:`); for (const f of fails) say('  - ' + f); }
const write = !DRY && (!fails.length || FORCE);
if (write) { fs.writeFileSync(OUT_JSON, json); fs.writeFileSync(OUT_BIN, bin); say(`yazıldı: ${OUT_JSON}, ${OUT_BIN}`); }
else say(DRY ? '(--dry: dosyalar yazılmadı)' : 'dosyalar YAZILMADI (denetim hatası; --force ile yazılır)');
if (fs.existsSync(WORK)) fs.writeFileSync(WORK + 'motion-build-report.txt', lines.join('\n') + '\n');
process.exit(fails.length ? 1 : 0);
