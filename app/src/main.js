import './style.css';
import * as THREE from 'three';
import { createStage } from './stage.js';
import { Glow } from './glow.js';
import { Model } from './model.js';
import { createUI } from './ui.js';
import { createTools } from './tools.js';
import { createAanki } from './aanki.js';
import { createHeart } from './heart.js';
import { createBrain } from './brain.js';
import { createLoco } from './locomotor.js';
import { createTour } from './tour.js';
import { createSections } from './sections.js';
import { loadMuscles } from './muscles.js';
import { createQuiz } from './quiz.js';
import { createExam } from './exam.js';
import * as progress from './progress.js';
import { setupPWA } from './pwa.js';
import * as users from './users.js';
import { setupUsers } from './users-ui.js';
import { setupWelcome, storedWelcome } from './welcome-ui.js';
import { SYSTEMS, SYS_ORDER, LOAD_ORDER, SUBS, SUB_DEFAULT_OFF, SEX, presetFor } from './text.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas);
const glow = new Glow(stage);
// ?batch=0 ile toplu çizim kapatılabilir (karşılaştırma ve hata ayıklama için)
const model = new Model(stage, glow, { batching: new URLSearchParams(location.search).get('batch') !== '0' });

// Beden: 'm' erkek, 'f' kadın. Seçim bu tarayıcıda hatırlanır; okunamazsa erkek.
const SEX_KEY = 'anatomi3d.sex';
const readSex = () => { try { return localStorage.getItem(SEX_KEY) === 'f' ? 'f' : 'm'; } catch { return 'm'; } };

const state = {
  sex: readSex(),
  mode: 'bone',
  layer: presetFor('bone'),
  sub: Object.fromEntries(Object.values(SUBS).flat().map(([k]) => [k, !SUB_DEFAULT_OFF.has(k)])),
  hidden: new Set(),
  isolate: null,
  selected: new Set(),
  primary: null,      // { type:'item', id } | { type:'group', gi } | { type:'multi' }
  hover: null,
};

let ui, tools;
let aanki = null;     // Aanki konuları (data/aanki.json); yüklenemezse Aanki görünümü çıkmaz
let heart = null;     // kalp çalışma modu (heart.js)
let brain = null;     // beyin çalışma modu (brain.js)
let loco = null;      // hareket sistemi çalışma modu (locomotor.js)
let quiz = null;      // Aanki konu testi (quiz.js)
let sect = null;      // kesit atlası ve kesit testi (sections.js)
let exam = null;      // deneme sınavı (exam.js): bütün bilgi sorusu bankalarından süreli, karışık test
// Veriyle sürülen çalışma turları (tour.js; veri tools/tour-build.mjs ile derlenir). Yeni bir tur buraya bir satır ve bir
// veri dosyasıdır: düğme, panel, bağlantı (#m=<anahtar>:<spec>), eylem (actions.tour) ve ana yenilemedeki yeri döngülerle
// kurulur. exam: deneme sınavındaki konu adı (turun bilgi soruları sınava bu adla girer; exam.js).
const TOURS = [
  { key: 'situs', title: 'Situs çalışma modu', chip: 'Situs', short: 'Situs', dataUrl: 'data/situs.json', exam: 'Karın - Situs', hint: 'Karın arterleri, portal sistem, periton ilişkileri, karaciğer segmentleri, safra yolları ve pankreas, test' },
  { key: 'thorax', title: 'Göğüs ve solunum çalışma modu', chip: 'Göğüs', short: 'Göğüs', dataUrl: 'data/thorax.json', exam: 'Göğüs ve solunum', hint: 'Gırtlak, akciğer ve bronş ağacı, plevra ve solunum aygıtı, mediasten, test' },
  { key: 'uro', title: 'Ürogenital çalışma modu', chip: 'Ürogenital', short: 'Ürogenital', dataUrl: 'data/uro.json', exam: 'Ürogenital ve pelvis', hint: 'Böbrek ve idrar yolları, erkek ve kadın genital organları, pelvis ve mesane, test' },
  { key: 'head', title: 'Baş-boyun çalışma modu', chip: 'Baş-boyun', short: 'Baş-boyun', dataUrl: 'data/head.json', exam: 'Baş-boyun', hint: 'Orbita, kulak, ağız boşluğu, boyun, test' },
  { key: 'vessels', title: 'Ekstremite damarları çalışma modu', chip: 'Damarlar', short: 'Damarlar', dataUrl: 'data/vessels.json', exam: 'Ekstremite damarları', hint: 'Kol ve bacağın arterleri, venleri ve lenf düğümleri (sol taraf), test' },
  { key: 'lymph', title: 'Lenf sistemi çalışma modu', chip: 'Lenf', short: 'Lenf', dataUrl: 'data/lymph.json', exam: 'Lenf sistemi', hint: 'Lenfoid organlar ve dalak, baş-boyun, gövde, pelvis ve bacağın lenf düğümü grupları, test' },
];
const TOUR_KEYS = TOURS.map(t => t.key);
const tours = Object.create(null);     // anahtar -> createTour örneği (prototipsiz: #m=constructor gibi bağlantılar tur sayılmasın)
const allTours = () => Object.values(tours);
const STUDY = ['heart', 'brain', 'loco', ...TOUR_KEYS, 'sect'];   // kendi paneli ve renkleri olan çalışma modları
const ISO_VIEWS = ['topic', ...STUDY, 'quiz'];            // izole görünümle yaşayan birincil görünümler
// İzole görünümler (Aanki konusu, kalp modu, I ile izolasyon) katman durumlarını kullanır: gereken sistemler açılır,
// izolasyondan çıkınca önceki katman durumları geri gelir.
let savedLayers = null;
const ENVELOPE = new Set(['membrane', 'meninges', 'capsule', 'fascia', 'sheath', 'bursa']);
const ENVELOPE_TOPIC = /Mening|Liquor|Faszi|Kapsel|Bursa|Situs|Peritone|Omentum|Pleura|Perikard/i;
const BONE_BLOCKS = new Set(['BWA', 'Gelenke', 'SOK']), BONE_FACH = new Set(['Bewegungsapparat', 'Sinnesorgane']);
const BONE_TOPIC = /Kehlkopf|Nase|Kau|Zahn|Osteolog|Orbita|Ohr|Mundhöhle|Wirbelsäule|Hüfte|Schädel/i;
// Konu yalnız bir cinsiyete özgü yapılar içeriyorsa o cinsiyet (aynı adlı kadın-erkek ikizleri sayılmaz), yoksa null
function topicSex(recs) {
  const xsOf = new Map(); for (const r of recs) if (r.x) { if (!xsOf.has(r.n)) xsOf.set(r.n, new Set()); xsOf.get(r.n).add(r.x); }
  const only = new Set([...xsOf.values()].filter(xs => xs.size === 1).map(xs => [...xs][0]));
  return only.size === 1 ? [...only][0] : null;
}
// Konunun izole görünümü (selectTopic ve konu ilerlemesi aynı kuralı kullanır). Kılıf yapılar (plevra ve diğer zarlar,
// beyin zarları, fasyalar, eklem kapsülleri, tendon kılıfları, bursalar) içlerindeki yapıları örtmesin: saydam bağlam
// (env) olarak gösterilir. Konu kılıfın kendisiyse (Meningen, Halsfaszien, Abdominalsitus) ya da kılıflar konunun büyük
// kısmıysa olduğu gibi kalır. Konunun sistemleri görünür; yumuşak doku konularında (kalp, organlar, beyin) göğüs kafesi,
// omurga ve kafatası önü örtmesin diye kemikler saydam başlar; hareket sistemi, kafatası, kulak, göz çukuru, gırtlak ve
// burun konularında kemik konunun kendisidir, opak kalır.
function topicView(t, recs) {
  const envAll = recs.filter(r => ENVELOPE.has(r.sub));
  const envSubject = ENVELOPE_TOPIC.test(t.title) || envAll.length > 0.2 * recs.length;
  const env = envSubject ? [] : envAll, core = envSubject ? recs : recs.filter(r => !ENVELOPE.has(r.sub));
  const bySys = {}; for (const r of core) if (r.sub !== 'attach') bySys[r.s] = (bySys[r.s] || 0) + 1;
  const n = Object.values(bySys).reduce((a, b) => a + b, 0);
  const boneSubject = BONE_BLOCKS.has(t.block) || BONE_FACH.has(t.fach) || BONE_TOPIC.test(t.title);
  const layers = Object.fromEntries([...new Set(core.map(r => r.s))].map(s => [s, s === 'bone' && !boneSubject && bySys.bone < 0.4 * n ? 'ghost' : 'show']));
  return { core, env, layers };
}
// Konu testinin sorabileceği yapılar: saydam bağlam ve saydam başlayan sistem hariç (konu ilerlemesinin paydası)
function topicAskable(t, recs) { const v = topicView(t, recs); return v.core.filter(r => v.layers[r.s] !== 'ghost' && !model.failed?.has(r.s)); }
function viewLayers(set) { if (!savedLayers) savedLayers = { ...state.layer }; state.layer = { ...state.layer, ...set }; }
// Odaklanan yapıyı bugünkü bakış yönünden opak bir yapı örtüyorsa (arka yüzdeki bir kas tutunma yeri önden bakınca
// kamera leğen kemiğinin içine düşer) örtülmeyen bir yön seç: önce ters yön, sonra önden, arkadan, iki yandan.
// Dönüş: undefined (bugünkü yön açık, değişmez) ya da { dir, dist?, covered? }.
// Bir yönün açık olması için hedefle kamera arasındaki doğru parçasında hiçbir yüzey olmamalı. Malzemeler tek yüzlü
// olduğundan iki ışın atılır: kameradan hedefe (kameraya bakan yüzler) ve hedeften kameraya (hedefe bakan yüzler;
// kamera bir parçanın içindeyse o parçanın iç yüzü yalnız bu ışında görünür).
// Hiçbir yön açık değilse (ör. kalça kemiğindeki bir gluteal kas yapışma yeri, kas katmanı açıkken: arkadan kas,
// önden pelvis örter) hedefin önündeki boşluğu en geniş olan yön seçilir: boşluk yeterliyse kamera o boşluğun içinde,
// ilk yüzeyin berisinde durur (yakın çekim, yapı görünür); yetmiyorsa kamera o doğrultudaki en dış yüzeyin dışına
// çekilir (yapı örtülü kalır ama kamera hiçbir opak parçanın içinde olmaz; covered: kullanıcıya söylenir).
const _rc = new THREE.Raycaster(); _rc.firstHitOnly = true;
function clearView(box, recs) {
  const own = new Set(recs.map(r => r.mesh));
  const objs = [...model.pickables, ...model.occluders].filter(m => m && !own.has(m));
  if (!objs.length) return undefined;
  const c = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).length() / 2;
  // d doğrultusunda, hedeften half ile upto arasındaki yüzeylerin hedefe uzaklıkları (iki yönlü ışın)
  const hits = (d, upto) => {
    if (upto <= half) return [];
    const out = [], back = d.clone().negate();
    _rc.set(c.clone().addScaledVector(d, upto), back); _rc.near = 0; _rc.far = upto - half;
    for (const h of _rc.intersectObjects(objs, false)) out.push(upto - h.distance);
    _rc.set(c.clone().addScaledVector(d, half), d); _rc.near = 0; _rc.far = upto - half;
    for (const h of _rc.intersectObjects(objs, false)) out.push(half + h.distance);
    return out;
  };
  const planDist = d => { const p = stage.framePlan(box, d); return p.pos.distanceTo(p.target); };
  const blocked = d => hits(d, planDist(d)).length > 0;
  const cur = stage.camera.position.clone().sub(stage.controls.target).normalize();
  if (!blocked(cur)) return undefined;
  const cands = [new THREE.Vector3(-cur.x, cur.y, -cur.z), new THREE.Vector3(0, 0.05, 1), new THREE.Vector3(0, 0.05, -1), new THREE.Vector3(1, 0.05, 0), new THREE.Vector3(-1, 0.05, 0)]
    .filter(d => d.lengthSq() > 1e-6 && Math.abs(d.clone().normalize().y) < 0.95).map(d => d.normalize());
  const free = cands.find(d => !blocked(d));
  if (free) return { dir: free };
  // hepsi kapalı: hedefin önündeki boşluğu (ilk yüzeye uzaklık) en geniş yön
  let best = null;
  for (const d of [cur, ...cands]) {
    const want = planDist(d), hs = hits(d, Math.max(400, want + 20));
    const gap = hs.length ? Math.min(...hs) : Infinity, outer = hs.length ? Math.max(...hs) : 0;
    if (!best || gap > best.gap) best = { d, want, gap, outer };
  }
  const room = best.gap - Math.max(0.6, 0.1 * best.gap);   // ilk yüzeyden biraz beride
  if (room >= Math.max(2.5 * half, 3)) return { dir: best.d, dist: Math.min(best.want, room) };
  return { dir: best.d, dist: Math.max(best.want, best.outer + Math.max(3, 2 * half)), covered: true };
}
// style.css'teki çekmece kurallarıyla aynı sorgu (sol panel çekmece: dar ekran ya da yatay telefon)
const DRAWER_MQ = matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 520px) and (min-width: 600px)');
// Telefon genişliğinde arama kutusu dar: uzun yer tutucu metin "Yapı ara: fem" diye kesiliyordu, kısası gösterilir
{
  const s = document.getElementById('search'), mq = matchMedia('(max-width: 600px)'), long = s?.placeholder;
  const fit = () => { if (s) s.placeholder = mq.matches ? 'Yapı ara…' : long; };
  fit(); mq.addEventListener?.('change', fit);
}
// Panellerin örttüğü alanı ölç: odaklama, yapıyı serbest alanın ortasına getirsin.
function measureInsets() {
  const W = window.innerWidth, H = window.innerHeight;
  const rect = id => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' ? e.getBoundingClientRect() : null; };
  const L = rect('left'), R = rect('right'), T = rect('topbar');
  // üstteki haplar (izole görünüm, sınav sonucuna dönüş) da yapıyı örtmesin
  const pills = ['isolate-bar', 'exam-back'].map(id => document.getElementById(id)).filter(e => e && !e.hidden).map(e => e.getBoundingClientRect().bottom);
  const bottomSheet = R && R.left < W * 0.3;   // dar ekranda bilgi paneli alta iner
  const drawer = L && DRAWER_MQ.matches;      // dar ekranda ve yatay telefonda sol panel geçici bir çekmecedir, yer ayırma
  return {
    l: L && !drawer ? L.right + 8 : 0,
    r: R && !bottomSheet ? W - R.left + 8 : 0,
    t: Math.max(T ? T.bottom + 8 : 62, ...pills.map(b => b + 8)),      // dar ekranda üst çubuk iki satırdır
    b: bottomSheet ? H - R.top + 8 : 40,
  };
}
stage.setInsetsProvider(measureInsets);
function refresh({ flash = false, reveal = false } = {}) {
  // Aanki konusu izole görünümle birlikte yaşar: izolasyondan çıkılınca kart da konuyu bırakır
  if (ISO_VIEWS.includes(state.primary?.type) && !state.isolate) state.primary = null;
  heart?.sync(); brain?.sync(); loco?.sync(); for (const t of allTours()) t.sync(); sect?.sync(); quiz?.sync();      // çalışma modu bittiyse renkler, akış çizgileri ve etiketler kaldırılır
  if (savedLayers && !state.isolate) {
    state.layer = savedLayers; savedLayers = null;
    if (state.layer[state.mode] === 'hide') state.layer = presetFor(state.mode);   // görünümde mod değiştiyse
  }
  if (!state.isolate) state.isoGhost = null;
  // dar ekranda küçültülmüş bilgi paneli, yeni bir konu, çalışma modu ya da test açılınca büyür
  const pt = state.primary?.type || null;
  if (pt !== lastPrimaryType) { lastPrimaryType = pt; if (ISO_VIEWS.includes(pt)) setSheet(false); }
  const selMeshes = model.apply(state);
  tools?.refresh();
  const extra = [...(heart?.highlight() || []), ...(brain?.highlight() || []), ...(loco?.highlight() || []), ...allTours().flatMap(t => t.highlight()), ...(sect?.highlight() || []), ...(quiz?.highlight() || [])];   // çalışma modunda adımın, tıklanan ya da sorulan yapının parıltısı
  glow.setSelected(extra.length ? [...selMeshes, ...extra] : selMeshes, flash);
  // Üzerine gelme vurgusunu yeni durumla eşitle: gizlenen yapının halesi ve balonu kalmasın,
  // seçilen yapı beyaz hale almasın, seçimi kaldırılıp hâlâ imlecin altında kalan yapı halesini geri alsın.
  const h = state.hover ? model.items.get(state.hover) : null;
  if (h && !h.vis) { state.hover = null; ui.tooltip(null); }
  glow.setHovered(h?.mesh && h.vis && !state.selected.has(h.id) ? [h.mesh] : []);
  ui.update({ reveal });
  stage.requestRender();
  syncHash();
}
let lastPrimaryType = null;
function setHover(id, x, y) {
  if (id !== state.hover) {
    const prev = state.hover; state.hover = id;
    model.setHover(state, prev, id);
    const r = id && model.items.get(id);
    glow.setHovered(r?.mesh && r.vis && !state.selected.has(id) ? [r.mesh] : []);
  }
  if (x !== undefined) ui.tooltip(id && !heart?.hideTips() && !brain?.hideTips() && !loco?.hideTips() && !allTours().some(t => t.hideTips()) && !sect?.hideTips() && !quiz?.isActive() ? model.items.get(id) : null, x, y);
}
const selectedRecs = () => [...state.selected].map(id => model.items.get(id)).filter(r => r?.mesh);
// Konu çerçevesi: yapıların çoğunun durduğu yer. Omurilik boyunca inen uzun yollar gibi uçta kalan birkaç yapı
// çerçeveyi şişirmesin: ortanca merkeze en uzak %15 dışarıda kalır.
function coreBounds(recs) {
  if (recs.length < 6) return model.boundsOf(recs);
  const med = ['x', 'y', 'z'].map(k => recs.map(r => r.sphere.center[k]).sort((a, b) => a - b)[recs.length >> 1]);
  const near = recs.map(r => [r, Math.hypot(r.sphere.center.x - med[0], r.sphere.center.y - med[1], r.sphere.center.z - med[2])]).sort((a, b) => a[1] - b[1]);
  return model.boundsOf(near.slice(0, Math.ceil(near.length * 0.85)).map(x => x[0]));
}

// Henüz yüklenmemiş sistemlerin kuyruğu (yükleme bölümünde iki yükleyici tüketir, pump).
// "Sistemleri gerektiğinde yükle" (lazy) açıkken kuyruktan yalnız istenen sistemler (wanted) yüklenir: mod değişimi,
// Göster ya da Saydam yapılan katman, arama sonucu, Aanki konusu ve çalışma modları (defer) bir sistemi ister.
// Telefonda bellek ve veri tasarrufu içindir; varsayılanı cihaza göre (lazyDefault), seçim localStorage'da.
const LAZY_KEY = 'anatomi3d.lazy';
function lazyDefault() {
  const mem = navigator.deviceMemory;   // yalnız Chromium tarayıcılar verir (GB, kaba)
  let phone = false;
  try { phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 820; } catch { /* eski tarayıcı */ }
  return (mem !== undefined && mem <= 4) || phone;
}
let lazy = (() => { try { const v = localStorage.getItem(LAZY_KEY); return v === null ? lazyDefault() : v === '1'; } catch { return lazyDefault(); } })();
const queue = LOAD_ORDER.filter(s => s !== 'bone');
const wanted = new Set();
let loadersBusy = 0, booted = false;
function prioritize(sys) {
  const i = queue.indexOf(sys); if (i < 0) return;   // yüklendi, yükleniyor ya da yüklenemedi
  if (i > 0) { queue.splice(i, 1); queue.unshift(sys); }
  wanted.add(sys); markQueue(); pump();
}
// mod düğmeleri: yüklenecek olanlarda dönen işaret, gerektiğinde yüklenecek olanlarda soluk görünüm
function markQueue() { for (const s of queue) { const on = !lazy || wanted.has(s); ui?.setPending(s, on); ui?.setIdle(s, !on); } }
// Yüklenmemiş bir sistemdeki yapı seçilirse (ör. aramadan) istek burada bekler; en son istek geçerlidir.
let deferred = null;
function defer(sys, run) {
  if (model.failed?.has(sys)) return;
  deferred = { sys, run }; prioritize(sys); ui?.setLoadingHint(sys);
  navReconcile();   // bekleyen istek de bir katmandır: Geri onu iptal etsin, sayfadan çıkmasın
}
function flushDeferred(sys) {
  if (deferred?.sys !== sys) return;
  const { run } = deferred; deferred = null; ui.setLoadingHint(null); run();
}
// Kullanıcı bu arada başka bir şey seçerse ya da yaparsa bekleyen istek iptal olur (yeni seçim eskisinin önüne geçer).
// Hiçbir şey değiştirmeyen eylemler (boşluğa tık, seçimsiz Esc) isteği iptal etmez: bu yüzden koruyuculardan sonra çağrılır.
function cancelDeferred() { brain?.cancelPending(); loco?.cancelPending(); for (const t of allTours()) t.cancelPending(); sect?.cancelPending(); if (deferred) { deferred = null; ui?.setLoadingHint(null); } }
// Bir çalışma modundan ötekine geçilirken önceki mod renklerini, çizgilerini ve etiketlerini yenisi kurulmadan kaldırsın
// (modlar model.overrides'ı ve #labels katmanını paylaşır).
function endStudy(next) {
  const t = state.primary?.type;
  // yeni modun viewLayers'ı kullanıcının ilk moddan önceki katmanlarının üstüne kurulsun, eski modunkilerin değil
  if (STUDY.includes(t) && t !== next) { if (savedLayers) state.layer = { ...savedLayers }; state.primary = null; heart?.sync(); brain?.sync(); loco?.sync(); for (const x of allTours()) x.sync(); sect?.sync(); }
}

// Bedeni değiştir: karşı cinsiyetin parçaları seçimden ve izolasyondan çıkar, birincil seçim buna göre düzelir.
const sexOk = r => !r?.x || r.x === state.sex;
// Yanlış listesindeki yapıların bu bedendeki kayıtları (yüklenemeyen sistemler hariç; yüklenmemiş sistemlerinkiler mesh olmadan gelir)
function weakRecs() {
  const names = new Set(progress.weakIds('s:').map(id => id.slice(2)));
  return names.size ? model.list.filter(r => names.has(r.n) && sexOk(r) && !model.failed?.has(r.s)) : [];
}
function applySex(sex) {
  state.sex = sex;
  try { localStorage.setItem(SEX_KEY, sex); } catch { /* özel pencere vb.: yalnızca bu oturum için geçerli */ }
  syncWeakBtn();   // yanlış listesindeki yapıların sayısı bedene göre değişir
  const ok = id => sexOk(model.items.get(id));
  const before = state.selected.size;
  state.selected = new Set([...state.selected].filter(ok));
  if (state.isolate) { state.isolate = new Set([...state.isolate].filter(ok)); if (!state.isolate.size) state.isolate = null; }
  if (state.selected.size !== before) {
    state.primary = !state.selected.size ? null
      : state.primary?.type === 'group' ? state.primary
      : state.selected.size === 1 ? { type: 'item', id: [...state.selected][0] } : { type: 'multi' };
  }
}

const actions = {
  setMode(mode, { keepLayers = false } = {}) {
    if (!SYSTEMS[mode]) return;
    cancelDeferred();
    state.mode = mode;
    if (!keepLayers && !state.isolate) state.layer = presetFor(mode);
    else if (state.layer[mode] === 'hide') state.layer = { ...state.layer, [mode]: 'show' };
    setHover(null); ui.tooltip(null);
    prioritize(mode);
    refresh();
  },
  setLayer(sys, st) { state.layer[sys] = st; if (st !== 'hide') prioritize(sys); refresh(); },
  setSub(sub, on) { state.sub[sub] = on; refresh(); },
  setView(name) { stage.setView(name, model.visibleBounds()); },
  setSex(sex) {
    if (!SEX[sex] || sex === state.sex) return;
    cancelDeferred();
    setHover(null); ui.tooltip(null);
    applySex(sex);
    if (state.primary?.type === 'topic') { actions.selectTopic(state.primary.id, { focus: false, autoSex: false }); return; }
    refresh();
  },

  selectItem(id, { focus = false, additive = false } = {}) {
    const r = model.items.get(id); if (!r) return;
    // Sistem henüz yüklenmediyse isteği beklet: yükleme bitince uygulanır.
    if (!r.mesh) { defer(r.s, () => actions.selectItem(id, { focus, additive })); return; }
    cancelDeferred();
    // Karşı cinsiyete özgü bir yapı seçildiyse (ağaçtan, aramadan) o bedene geçilir.
    if (!sexOk(r)) { applySex(r.x); ui.notify(`${SEX[r.x].label} anatomisine geçildi`); }
    state.hidden.delete(id);
    if (additive && state.selected.size) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.primary = state.selected.size === 0 ? null : state.selected.size === 1 ? { type: 'item', id: [...state.selected][0] } : { type: 'multi' };
    } else {
      state.selected = new Set([id]); state.primary = { type: 'item', id };
    }
    if (state.isolate && !state.isolate.has(id) && !state.isoGhost?.has(id)) state.isolate = null;
    if (state.isolate && state.isoGhost?.has(id) && !state.isolate.has(id)) state.isolate.add(id);
    if (r.s !== state.mode) { state.mode = r.s; if (state.layer[r.s] === 'hide') state.layer = state.isolate ? { ...state.layer, [r.s]: 'show' } : presetFor(r.s); }
    refresh({ flash: true, reveal: true });
    if (focus) actions.focusSelection();
  },
  selectGroup(gi, { focus = false } = {}) {
    const g = model.groups[gi]; if (!g) return;
    if (!model.loaded[g.s]) { defer(g.s, () => actions.selectGroup(gi, { focus })); return; }
    let recs = model.groupItems(gi).filter(r => r.mesh);
    if (!recs.length) return;
    cancelDeferred();
    // Grup yalnızca karşı cinsiyetin yapılarından oluşuyorsa o bedene geçilir; karışıksa bu bedenin yapıları seçilir.
    if (!recs.some(sexOk)) { applySex(recs[0].x); ui.notify(`${SEX[recs[0].x].label} anatomisine geçildi`); }
    recs = recs.filter(sexOk);
    for (const r of recs) state.hidden.delete(r.id);
    state.selected = new Set(recs.map(r => r.id)); state.primary = { type: 'group', gi };
    if (state.isolate) state.isolate = null;
    if (g.s !== state.mode) { state.mode = g.s; if (state.layer[g.s] === 'hide') state.layer = presetFor(g.s); }
    refresh({ flash: true });
    if (focus) actions.focusSelection();
  },
  selectTwin() {
    if (state.primary?.type !== 'item') return;
    const r = model.items.get(state.primary.id); if (!r?.twin?.mesh) return;
    cancelDeferred();
    state.hidden.delete(r.twin.id);
    if (state.isolate) state.isolate.add(r.twin.id);   // izole görünümde karşı taraf da görünsün
    state.selected = new Set([r.id, r.twin.id]); state.primary = { type: 'multi' };
    refresh({ flash: true }); actions.focusSelection();
  },
  clearSelection() {
    if (!state.selected.size) return;
    cancelDeferred();
    state.selected = new Set(); state.primary = null; refresh();
  },
  focusSelection() {
    const recs = selectedRecs();
    if (recs.length) {
      const box = model.boundsOf(recs), v = clearView(box, recs);
      stage.frameBox(box, v?.dir, v?.dist);
      if (v?.covered) ui.notify('Yapı her yönden örtülü: üstündeki yapıyı seçip Gizle (H) ile kaldır');
    }
    else if (state.isolate) stage.focusBox(coreBounds([...state.isolate].map(id => model.items.get(id)).filter(r => r?.mesh)));
    else actions.setView('home');
  },
  // Aanki konusu: konunun yapıları seçilmeden izole edilir (hepsi tıklanabilir), kart konuyu gösterir. Konu karşı
  // bedene özgü yapılardan oluşuyorsa (ör. kadın genital organları erkek bedendeyken) o bedene geçilir. Konunun bir
  // sistemi henüz yüklenmediyse istek, o sistem yüklenince yinelenir.
  selectTopic(id, { focus = true, autoSex = true } = {}) {
    const t = aanki?.byId.get(id); if (!t) return;
    const all = aanki.recsOf(t);
    // Yalnız bir cinsiyette bulunan adlara bakılır: kadın ve erkek pelvisi gibi aynı adlı ikizler kararı etkilemez.
    const x = autoSex ? topicSex(all) : null;
    const sex = x || state.sex, okFor = r => !r.x || r.x === sex;
    const wait = [...new Set(all.filter(r => !r.mesh && okFor(r)).map(r => r.s))].find(s => !model.failed.has(s));
    if (wait) { defer(wait, () => actions.selectTopic(id, { focus, autoSex })); return; }
    if (x && x !== state.sex) { applySex(x); ui.notify(`${SEX[x].label} anatomisine geçildi`); }
    const recs = all.filter(r => r.mesh && sexOk(r));
    if (!recs.length) { if (state.primary?.type === 'topic') { state.isolate = null; refresh(); } ui.notify('Bu konu için bu bedende yapı yok'); return; }
    cancelDeferred();
    setHover(null); ui.tooltip(null);
    state.selected = new Set(); state.primary = { type: 'topic', id };
    // kılıflar saydam bağlam, sistemler görünür, yumuşak doku konularında kemik saydam (topicView)
    const { core, env, layers } = topicView(t, recs);
    state.isolate = new Set(core.map(r => r.id));
    state.isoGhost = env.length ? new Set(env.map(r => r.id)) : null;
    viewLayers(layers);
    refresh();
    if (focus) stage.focusBox(coreBounds(core));
  },
  hideSelected() {
    if (!state.selected.size) return;
    cancelDeferred();
    for (const id of state.selected) state.hidden.add(id);
    if (state.isolate) {
      for (const id of state.selected) state.isolate.delete(id);
      if (!state.isolate.size) state.isolate = null;   // izole edilen her şey gizlendiyse boş bir görünümde kalma
    }
    state.selected = new Set(); state.primary = null; refresh();
  },
  showAll() { state.hidden.clear(); state.isolate = null; refresh(); },
  toggleIsolate() {
    if (state.isolate) state.isolate = null;
    else if (state.selected.size) {
      state.isolate = new Set(state.selected);
      // seçimde gizli ya da saydam katmandan yapı varsa o sistem açılır (izole görünüm katman durumlarına uyar)
      const hidden = [...new Set(selectedRecs().map(r => r.s))].filter(s => state.layer[s] !== 'show');
      if (hidden.length) viewLayers(Object.fromEntries(hidden.map(s => [s, 'show'])));
    } else return;
    cancelDeferred();
    refresh();
    if (state.isolate) actions.focusSelection();
  },
  exitIsolate() { if (state.isolate) { state.isolate = null; refresh(); } },
  heartMode(tab) { cancelDeferred(); setPanelOpen(false); heart.enter(tab); },
  brainMode(spec) { cancelDeferred(); setPanelOpen(false); brain.enter(spec); },
  locoMode(spec) { cancelDeferred(); setPanelOpen(false); loco.enter(spec); },
  // çalışma turu: spec 'sekme[:madde]' ya da 'quiz[:sahne]'
  tour(key, spec) { if (!tours[key]) return; cancelDeferred(); setPanelOpen(false); tours[key].enter(spec); },
  situsMode(spec) { actions.tour('situs', spec); },
  // kesit atlası: spec '<seviye anahtarı>', '<bölge>' ya da 'test[:bölge]'
  sectMode(spec) { cancelDeferred(); setPanelOpen(false); sect.enter(spec); },
  topicQuiz(id) { quiz.start(id); },
  // Genel tekrar: yanlış listesindeki bütün yapılar (bu bedende olanlar) izole görünümde, konu testi motoruyla.
  // Bir sistemi henüz yüklenmediyse istek selectTopic gibi bekler. Sistemleri selectTopic gibi görünür yapılır
  // (viewLayers); iki yapı adından azsa yalnız nedeni söylenir.
  reviewWeak() {
    const all = weakRecs();
    const wait = [...new Set(all.filter(r => !r.mesh).map(r => r.s))][0];
    if (wait) { defer(wait, () => actions.reviewWeak()); return; }
    const recs = all.filter(r => r.mesh);
    const n = new Set(recs.map(r => r.n)).size;
    const xs = sect.weakCount();   // kesit testinin zayıf soruları (kendi testinde tekrar edilir)
    // yalnız kesit yanlışları varsa ya da yapı tekrarı zaten açıksa (ikinci tıklama) kesit testi Yanlışlarım açık başlar
    if (xs && (n < 2 || (quiz.isActive() && state.primary?.id == null))) { actions.sectMode('test:weak'); return; }
    // yalnız bilgi sorusu yanlışları kaldıysa (ya da yapı tekrarı açıkken ikinci tıklama) deneme sınavı "Yalnız
    // yanlışlarım ve yeni sorular" seçili açılır
    const fx = weakFacts();
    if (fx && (n < 2 || (quiz.isActive() && state.primary?.id == null))) { actions.exam({ src: 'weak' }); return; }
    if (n < 2) {
      const other = progress.weakIds('s:').length > n;   // kalanlar öteki bedende (ya da modelde yok)
      ui.notify(n ? 'Tekrar için en az iki yanlış yapı gerekir' : other ? 'Yanlış yapıların bu bedende yok' : 'Tekrar edilecek yanlış yapı yok');
      return;
    }
    cancelDeferred(); endStudy('quiz'); setPanelOpen(false);
    setHover(null); ui.tooltip(null);
    for (const r of recs) state.hidden.delete(r.id);
    state.selected = new Set(); state.primary = null; state.isoGhost = null;
    state.isolate = new Set(recs.map(r => r.id));
    viewLayers(Object.fromEntries([...new Set(recs.map(r => r.s))].map(sys => [sys, 'show'])));
    refresh();   // soru havuzu görünürlüğe bakar: önce görünüm kurulur
    quiz.start(null, { title: 'Yanlışlarım', place: 'Testlerde yanlış cevapladığın yapılar', back: false });
    stage.focusBox(coreBounds(recs));
    if (xs) ui.notify(`Kesit testinde ${xs} yanlış daha var: onlar için Yanlışlarım'a bir daha bas`);
    else if (fx) ui.notify(`Bilgi sorularında ${fx} yanlış daha var: deneme sınavı için Yanlışlarım'a bir daha bas`);
  },
  // Deneme sınavı penceresi (açık çalışma modu altında olduğu gibi kalır). opts.src: 'weak' kaynağı önceden seçer.
  exam(opts) { cancelDeferred(); setPanelOpen(false); setHover(null); ui.tooltip(null); exam.open(opts); },
  // Sınav sonucundaki "3B'de göster": sorunun yapıları (model adları) izole edilip seçilir ve kameraya alınır. Gereken
  // sistem henüz yüklenmediyse istek bekler (defer); açık çalışma modu biter. Yapılar yalnız öteki bedende varsa o bedene geçilir.
  showParts(names) {
    const want = new Set(names);
    const all = model.list.filter(r => want.has(r.n) && !model.failed?.has(r.s));
    if (!all.length) { ui.notify('Bu sorunun yapıları modelde yok'); return; }
    const sex = all.some(sexOk) ? state.sex : all[0].x;
    const mine = all.filter(r => !r.x || r.x === sex);
    const wait = [...new Set(mine.filter(r => !r.mesh).map(r => r.s))][0];
    if (wait) { defer(wait, () => actions.showParts(names)); return; }
    const recs = mine.filter(r => r.mesh);
    if (!recs.length) { ui.notify('Bu sorunun yapıları modelde yok'); return; }
    cancelDeferred(); endStudy(null); setPanelOpen(false);
    setHover(null); ui.tooltip(null);
    if (matchMedia('(max-height: 500px)').matches) setSheet(true);   // yatay telefon: alt panel küçülsün, yapı görünsün
    if (sex !== state.sex) { applySex(sex); ui.notify(`${SEX[sex].label} anatomisine geçildi`); }
    for (const r of recs) state.hidden.delete(r.id);
    state.isoGhost = null;
    state.isolate = new Set(recs.map(r => r.id));
    state.selected = new Set(state.isolate);
    state.primary = recs.length === 1 ? { type: 'item', id: recs[0].id } : { type: 'multi' };
    viewLayers(Object.fromEntries([...new Set(recs.map(r => r.s))].map(sys => [sys, 'show'])));
    state.mode = recs[0].s;
    refresh({ flash: true, reveal: true });
    stage.focusBox(model.boundsOf(recs));
  },
  // yalnız açık kullanıcının (ya da Misafir'in) ilerlemesi silinir (progress.js anahtarı kullanıcı başınadır)
  resetProgress() { progress.reset(); ui.notify(`Test ilerlemesi sıfırlandı (${users.current()?.name || 'Misafir'})`); },
  hoverFromUI(id) { const r = id && model.items.get(id); setHover(r?.vis ? id : null); },
};

ui = createUI({ state, model, actions });
tools = createTools({ stage, model, glow, state });
heart = createHeart({ stage, model, state, refresh, defer, ui, glow, viewLayers, endStudy });
ui.registerPanel('heart', { html: heart.panelHTML, click: heart.click });
brain = createBrain({ stage, model, state, refresh, defer, ui, glow, viewLayers, endStudy });
ui.registerPanel('brain', { html: brain.panelHTML, click: brain.click });
// kas kartları: açılışı bekletmeden yüklenir; yapı kartında ve hareket sistemi modunda kullanılır
const musclesReady = loadMuscles().then(mu => { ui.setMuscles(mu); return mu; }).catch(e => { console.warn('muscles.json yüklenemedi:', e); return null; });
loco = createLoco({ stage, model, state, refresh, defer, ui, glow, viewLayers, endStudy, musclesReady });
ui.registerPanel('loco', { html: loco.panelHTML, click: loco.click });
// çalışma turları: örnek, panel ve "Çalışma modları" ızgarasındaki kısa düğme listeden kurulur (kalp, beyin ve hareket
// düğmelerinin arkasına; düğme kimliği <anahtar>-mode, title tam ad ve içerik)
{
  const grid = document.getElementById('study-modes');
  for (const T of TOURS) {
    tours[T.key] = createTour({ ...T, stage, model, state, refresh, defer, cancel: cancelDeferred, viewLayers, endStudy, setSex: sex => actions.setSex(sex), ui });
    ui.registerPanel(T.key, { html: tours[T.key].panelHTML, click: tours[T.key].click });
    const b = document.createElement('button'); b.id = T.key + '-mode'; b.textContent = T.short || T.chip || T.title;
    b.title = T.title + (T.hint ? ': ' + T.hint : '');
    b.addEventListener('click', e => { e.currentTarget.blur(); actions.tour(T.key, ''); });
    grid?.appendChild(b);
  }
  ui.setTours?.(TOURS);
}
sect = createSections({ stage, model, state, refresh, defer, cancel: cancelDeferred, viewLayers, endStudy, setSex: sex => actions.setSex(sex), ui, tools, onData: () => syncWeakBtn() });
ui.registerPanel('sect', { html: sect.panelHTML, click: sect.click });
quiz = createQuiz({ stage, model, state, refresh, getTopic: id => aanki?.byId.get(id) });
exam = createExam({ tours: TOURS, onShow: names => actions.showParts(names), onToggle: () => syncHash(), onData: () => syncWeakBtn() });
document.getElementById('exam-btn').addEventListener('click', e => { e.currentTarget.blur(); actions.exam(); });
ui.registerPanel('quiz', { html: quiz.panelHTML, click: quiz.click });
document.getElementById('heart-mode').addEventListener('click', e => { e.currentTarget.blur(); actions.heartMode('flow'); });
document.getElementById('brain-mode').addEventListener('click', e => { e.currentTarget.blur(); actions.brainMode('csf'); });
document.getElementById('sect-mode').addEventListener('click', e => { e.currentTarget.blur(); actions.sectMode(''); });
document.getElementById('loco-mode').addEventListener('click', e => { e.currentTarget.blur(); actions.locoMode('nerves'); });
// Yanlışlarım (genel tekrar) ve ilerlemeyi sıfırlama. Sıfırlama iki adımlıdır: ilk tıklama düğmeyi birkaç saniyeliğine
// "onay" durumuna getirir, ikinci tıklama siler.
// Düğmedeki sayı, tekrarın açabileceği yapı adlarıdır: bu bedende kaydı olan ve sistemi yüklenebilen zayıf yapılar.
const weakBtn = document.getElementById('weak-review'), resetBtn = document.getElementById('progress-reset');
// Kesit testinin zayıf soruları (kimlikler 'x:', 'xl:' ve kesit bilgi soruları) da sayılır; yalnız onlar varsa düğme
// kesit testini "Yanlışlarım" açık başlatır; ikisi de varsa önce yapı tekrarı, tekrar açıkken ikinci tıklama kesit testi.
// Kesit sayısı sections.json yüklenince gelir (weakCount yüklemeyi başlatır, onData düğmeyi yeniler).
// Öteki bankaların (beyin, hareket, kaslar, turlar; deneme sınavı) zayıf bilgi soruları da sayılır, ama yalnız deneme
// sınavının sorabildikleri (exam.bankIds): sonradan metni değişen soruların eski kimlikleri ve hareket sistemi testinin
// çalışırken üretilen kas-sinir soruları sayılmaz (onlar kendi testlerindeki Yanlışlarım'da tekrar edilir). Bir 'f:'
// kimliğinin kesit sorusu olup olmadığı sections.json yüklenince, sınavda olup olmadığı bankalar indirilince bilinir
// (zayıf bilgi sorusu varsa ikisi de indirmeyi başlatır, bitince düğme yenilenir); o zamana kadar 0.
function weakFacts() {
  const ids = sect ? progress.weakIds('f:').filter(id => sect.isFact(id) === false) : [];
  if (!ids.length) return 0;
  const bank = exam?.bankIds();
  return bank ? ids.filter(id => bank.has(id)).length : 0;
}
function syncWeakBtn() { const n = new Set(weakRecs().map(r => r.n)).size + (sect?.weakCount() || 0) + weakFacts(); weakBtn.textContent = `Yanlışlarım (${n})`; weakBtn.disabled = !n; }
syncWeakBtn();
// İlerleme değişince (cevap, sıfırlama, başka sekme) düğme ve açık test paneli güncellenir. Yalnız panel değil tam
// yenileme: "Yanlışlarım" açıkken soru değiştiyse hareket sistemi modu görünümü soruya göre yeniden kurar.
let progTimer = null;
progress.onChange(() => {
  clearTimeout(progTimer);
  progTimer = setTimeout(() => { syncWeakBtn(); if (['quiz', ...STUDY].includes(state.primary?.type)) refresh(); }, 250);
});
weakBtn.addEventListener('click', e => { e.currentTarget.blur(); actions.reviewWeak(); });
let resetArmed = null;
const disarm = () => { clearTimeout(resetArmed); resetArmed = null; resetBtn.classList.remove('armed'); resetBtn.textContent = 'İlerlemeyi sıfırla'; };
resetBtn.addEventListener('click', e => {
  e.currentTarget.blur();
  if (resetArmed) { disarm(); actions.resetProgress(); return; }
  resetBtn.classList.add('armed'); resetBtn.textContent = 'Emin misin? Silmek için tekrar tıkla';
  resetArmed = setTimeout(disarm, 4000);
});

// ---------- fare ----------
const FUZZY_MODES = new Set(['nerve', 'vessel']);     // ince yapılar: imlecin yakınındakini de yakala
let down = null; let pendingHover = null; let buttons = 0;
// Dokunmatik: tek parmak döndürür, iki parmak yakınlaştırır ve kaydırır (OrbitControls). Ekrandaki parmaklar sayılır;
// iki parmaklı bir hareketten sonra kalkan parmak "dokunma" sayılıp yapı seçmez.
const touches = new Set(); let multiTouch = false;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { touches.add(e.pointerId); if (touches.size > 1) multiTouch = true; } });
const touchEnd = e => { touches.delete(e.pointerId); if (!touches.size) setTimeout(() => { if (!touches.size) multiTouch = false; }, 0); };
canvas.addEventListener('pointercancel', e => { touchEnd(e); down = null; });
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() }; buttons = e.buttons; ui.tooltip(null); canvas.focus({ preventScroll: true }); });
canvas.addEventListener('pointermove', e => {
  buttons = e.buttons;
  if (e.buttons) { pendingHover = null; if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) setHover(null); return; }
  if (e.pointerType === 'touch') return;
  pendingHover = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', e => {
  buttons = e.buttons;
  if (e.pointerType === 'touch') { const multi = multiTouch; touchEnd(e); if (multi) { down = null; return; } }
  if (!down || e.button !== 0 || down.button !== 0) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > 5) return;
  const rec = model.pick(e.clientX, e.clientY, 9);
  if (rec && (sect?.onPick(rec.id, e.clientX, e.clientY) || heart?.onPick(rec.id) || brain?.onPick(rec.id, e.clientX, e.clientY) || loco?.onPick(rec.id, e.clientX, e.clientY) || allTours().some(t => t.onPick(rec.id, e.clientX, e.clientY)) || quiz?.onPick(rec.id))) return;   // çalışma modunda tıklama modda kalır (testte cevap sayılır)
  // çalışma turunda birkaç piksellik bir lenf düğümünün hemen yanına tıklama o düğümü seçer (tour.js pickNear)
  if (!rec && allTours().some(t => t.pickNear(e.clientX, e.clientY))) return;
  if (rec) actions.selectItem(rec.id, { additive: e.ctrlKey || e.shiftKey || e.metaKey });
  else if (!(e.ctrlKey || e.shiftKey || e.metaKey)) actions.clearSelection();
});
canvas.addEventListener('dblclick', e => {
  if (heart?.isActive() || brain?.isActive() || loco?.isActive() || allTours().some(t => t.isActive()) || sect?.isActive() || quiz?.isActive()) return;
  const rec = model.pick(e.clientX, e.clientY, 9);
  if (rec) { if (!state.selected.has(rec.id)) actions.selectItem(rec.id); actions.focusSelection(); }
});
canvas.addEventListener('pointerleave', () => { pendingHover = null; setHover(null); ui.tooltip(null); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
// üzerine gelme tespitini kare başına bir kez yap
stage.onFrame(() => {
  if (!pendingHover || buttons || stage.isFlying()) return false;
  const { x, y } = pendingHover; pendingHover = null;
  const rec = model.pick(x, y, FUZZY_MODES.has(state.mode) ? 5 : 0);
  setHover(rec ? rec.id : null, x, y);
  return false;
});

// Hakkında penceresi; içinde çevrimdışı kullanım (önbellek durumu, hepsini indir, temizle: src/pwa.js)
const pwa = setupPWA({ notify: t => ui.notify(t) });
document.getElementById('about-btn').addEventListener('click', () => { document.getElementById('about').showModal(); pwa.refreshStatus(); });

// Kullanıcılar (bu cihazdaki profiller, src/users.js): sol paneldeki giriş düğmesi ve pencere. Öğrenme verisi
// (progress.js, exam.js) açık kullanıcının anahtarlarıyla yüklenir; kullanıcı değişince sayfa yeniden yüklenir.
// Açılışta şifre bekleyen profil ya da kullanıcı listesi burada açılır (Geri tuşu katmanı #users'ı da kapatır).
// Cihazda kullanıcı yoksa ve bir kişisel not saklıysa pencere notun adıyla kullanıcı oluşturmayı önerir (src/welcome-ui.js).
const usersUI = setupUsers({ notify: t => ui.notify(t), suggestName: () => storedWelcome()?.to });

// "Sistemleri gerektiğinde yükle" ayarı (Araçlar)
const lazyBox = document.getElementById('lazy-load');
lazyBox.checked = lazy;
lazyBox.addEventListener('change', () => {
  lazy = lazyBox.checked; lazyBox.blur();
  try { localStorage.setItem(LAZY_KEY, lazy ? '1' : '0'); } catch { /* özel pencere: yalnızca bu oturum */ }
  markQueue(); pump();
  ui.notify(lazy ? 'Sistemler gerektiğinde yüklenecek' : queue.length ? 'Kalan sistemler arka planda yükleniyor' : 'Bütün sistemler yüklü');
});

// Dar ekranda alttaki bilgi paneli küçültülüp büyütülebilir (tutamak); küçükken panele dokunmak onu büyütür.
const rightPanel = document.getElementById('right'), sheetBtn = document.getElementById('sheet-btn');
function setSheet(collapsed) {
  if (rightPanel.classList.contains('collapsed') === collapsed) return;
  rightPanel.classList.toggle('collapsed', collapsed);
  sheetBtn.setAttribute('aria-expanded', String(!collapsed));
  sheetBtn.title = collapsed ? 'Bilgi panelini büyüt' : 'Bilgi panelini küçült';
  stage.requestRender();
}
sheetBtn.addEventListener('click', () => setSheet(!rightPanel.classList.contains('collapsed')));
rightPanel.addEventListener('click', e => { if (rightPanel.classList.contains('collapsed') && !e.target.closest('#sheet-btn')) setSheet(false); });

// Dar pencerede katman paneli üst çubuktaki düğmeyle açılıp kapanır; 3B alana dokununca kapanır.
const panelBtn = document.getElementById('panel-btn');
function setPanelOpen(open) { document.body.classList.toggle('panel-open', open); panelBtn.setAttribute('aria-expanded', String(open)); }
panelBtn.addEventListener('click', () => setPanelOpen(!document.body.classList.contains('panel-open')));
canvas.addEventListener('pointerdown', () => setPanelOpen(false));

// ---------- klavye ----------
window.addEventListener('keydown', e => {
  // Yazı alanlarında kısayol yok; ama odak bir onay kutusu ya da düğmedeyken kısayollar çalışmaya devam eder.
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'range' && /^(Arrow|Page|Home|End)/.test(e.key)) return;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable ||
      (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(t.type))) return;
  if (document.querySelector('dialog[open]')) return;
  // Türkçe Q klavyede "I" tuşu noktasız "ı", Caps Lock ile "i" tuşu "İ" üretir: hepsi "i" sayılır.
  const k = e.key === 'ı' || e.key === 'I' || e.key === 'İ' ? 'i' : e.key.toLowerCase();
  if (e.code === 'Numpad1') return actions.setView(e.ctrlKey ? 'back' : 'front');
  if (e.code === 'Numpad3') return actions.setView(e.ctrlKey ? 'left' : 'right');
  if (e.code === 'Numpad7') return actions.setView(e.ctrlKey ? 'bottom' : 'top');
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.ctrlKey && !e.altKey && !e.metaKey) { const s = SYS_ORDER[+digit[1] - 1]; if (s) actions.setMode(s); return; }
  if (k === 'f' || e.code === 'NumpadDecimal') return actions.focusSelection();
  if (k === 'h') { e.preventDefault(); return e.altKey ? actions.showAll() : e.shiftKey ? actions.toggleIsolate() : actions.hideSelected(); }
  if (k === 'i' || e.key === '/' || e.code === 'NumpadDivide') { e.preventDefault(); return actions.toggleIsolate(); }
  if (e.key === 'Home') return actions.setView('home');
  // çalışma turunda ilk Esc seçili maddeyi bırakır, ikincisi moddan çıkar
  if (e.key === 'Escape') { if (state.selected.size) actions.clearSelection(); else if (!allTours().some(t => t.escape())) actions.exitIsolate(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'k' || (k === 's' && !e.ctrlKey && !e.altKey && !e.metaKey)) { e.preventDefault(); document.getElementById('search').focus(); }
});

// ---------- yükleme ----------
// Önce iskelet yüklenir ve ekran açılır; diğer sistemler arka planda ikişer ikişer gelir.
// Kullanıcı henüz yüklenmemiş bir moda geçerse o sistem kuyruğun başına alınır (prioritize).
// Aanki konuları (data/aanki.json): yoksa ya da okunamazsa Aanki görünümü çıkmaz
async function loadAanki() {
  try { aanki = createAanki(model, await (await fetch('data/aanki.json')).json()); ui.setAanki(aanki, topicSex, topicAskable, topicView); }
  catch (err) { console.warn('Aanki konuları yüklenemedi:', err); }
}
async function loadOne(s) {
  ui.setIdle(s, false); ui.setPending(s, true);
  try { await model.loadSystem(s); ui.setPending(s, false); refresh(); flushDeferred(s); }
  catch (err) {
    console.error('Sistem yüklenemedi:', s, err);
    model.failed.add(s); ui.setPending(s, false, true); syncWeakBtn();
    if (deferred?.sys === s) { deferred = null; ui.setLoadingHint(null); }
  }
}
// En çok iki sistem aynı anda yüklenir. lazy kapalıyken kuyruğun hepsi, açıkken yalnız istenenler.
function pump() {
  if (!booted) return;
  while (loadersBusy < 2) {
    const i = lazy ? queue.findIndex(x => wanted.has(x)) : queue.length ? 0 : -1;
    if (i < 0) break;
    const s = queue.splice(i, 1)[0]; loadersBusy++;
    loadOne(s).finally(() => {
      loadersBusy--;
      if (!queue.length && !loadersBusy) document.body.classList.add('ready');
      pump();
    });
  }
}

// ---------- derin bağlantılar (adres çubuğundaki #) ----------
// Ana görünüm adreste tutulur ve açılışta geri yüklenir: Aanki konusu (#t=<konu>), yapı (#s=<parça kimliği>),
// çalışma modu (#m=heart:<bölüm>, #m=brain:<spec>, #m=loco:<spec>, turlar #m=<tur>:<spec>, ör. #m=situs:arteries:ams). Anki kartları ve paylaşılan bağlantılar bir görünümü
// doğrudan açar; telefon uygulaması (Capacitor) da gelen bağlantıyı aynı yoldan açar. Gereken sistem henüz yüklenmediyse
// istek mevcut bekletme düzeneğiyle (defer) bekler.
const enc = v => encodeURIComponent(v).replace(/%3A/gi, ':');
function viewHash() {
  if (exam?.isOpen()) return 'm=exam';   // sınav penceresi açıkken adres onu gösterir
  const p = state.primary; if (!p) return '';
  if (p.type === 'topic' || (p.type === 'quiz' && p.id != null)) return 't=' + enc(p.id);
  if (p.type === 'heart') return 'm=heart:' + enc(heart.spec());
  if (p.type === 'brain') return 'm=brain:' + enc(brain.spec());
  if (p.type === 'loco') return 'm=loco:' + enc(loco.spec());
  if (p.type === 'sect') return 'm=sect:' + enc(sect.spec());
  if (tours[p.type]) return 'm=' + p.type + ':' + enc(tours[p.type].spec());
  if (p.type === 'item') return 's=' + enc(p.id);
  return '';
}
let hashReady = false;   // açılıştaki bağlantı okunana kadar adrese dokunma
function syncHash() {
  if (!hashReady) return;
  if (!deferred) {   // bekleyen bir istek varken adres onun görünümünü bekler (bekçi yine de kurulur)
    const h = fullHash();
    if (h !== location.hash.replace(/^#/, '')) {
      try { history.replaceState(history.state, '', h ? '#' + h : location.pathname + location.search); } catch { /* file:// vb. */ }
    }
  }
  navReconcile();   // Geri tuşu için geçmişteki bekçi girişi (aşağıda)
}
let aankiReady = null;
function applyHash(raw) {
  const q = new URLSearchParams(String(raw || '').replace(/^#/, ''));
  const t = q.get('t'), sId = q.get('s'), m = q.get('m');
  // bulunamayan bağlantı: uyar ve adresi ekrandaki görünüme geri yaz (yeniden yükleme aynı uyarıyı vermesin)
  const miss = msg => { ui.notify(msg); syncHash(); };
  if (t) {
    // Aanki verisi gelene kadar kullanıcı kendisi bir şey seçtiyse ya da mod değiştirdiyse onun görünümü kalır
    const before = state.primary;
    return aankiReady?.then(() => {
      if (state.primary !== before) { syncHash(); return; }
      if (aanki?.byId.has(t)) actions.selectTopic(t); else miss('Bağlantıdaki Aanki konusu bulunamadı');
    });
  }
  if (sId) { if (model.items.has(sId)) actions.selectItem(sId, { focus: true }); else miss('Bağlantıdaki yapı bulunamadı'); return; }
  if (m) {
    const i = m.indexOf(':'), kind = i < 0 ? m : m.slice(0, i), spec = i < 0 ? undefined : m.slice(i + 1) || undefined;
    if (kind === 'exam') actions.exam();
    else if (kind === 'heart') actions.heartMode(spec || 'flow');
    else if (kind === 'brain') actions.brainMode(spec || 'csf');
    else if (kind === 'loco') actions.locoMode(spec || 'nerves');
    else if (tours[kind]) actions.tour(kind, spec || '');
    else if (kind === 'sect') actions.sectMode(spec || '');
    else miss('Bağlantıdaki çalışma modu bulunamadı');
    return;
  }
  syncHash();   // tanınmayan bağlantı (ya da yalnız kişisel bağlantı, #g=)
}
// Kişisel bağlantı (#g=..., src/welcome-ui.js): bir görünüm değildir. Geçerliyse yalnız iOS / macOS Safari sekmesinde adreste kalır
// (ana ekran / Dock yer imi onu taşısın diye): syncHash onu görünümün önüne ekler (fullHash). applyHash g'yi yok sayar,
// derin bağlantılar (#g=...&t=...) eskisi gibi uygulanır. Öteki tarayıcılarda, kurulu uygulamada ve Android kabuğunda adresten silinir.
// Kart açılıştan önce gösterilir; Geri tuşu katmanı onu da kapatır.
const welcomeUI = setupWelcome({ notify: t => ui.notify(t), onHash: () => syncHash() });
function fullHash() { return [welcomeUI?.hashParam(), viewHash()].filter(Boolean).join('&'); }
// Sınav penceresi açıkken (Geri tuşu) alttaki görünüm değişmez; adres sınavı göstermeye devam eder
// Uygulamanın kendi geçmiş girişlerine (taban ve bekçi, aşağıda) dönüşleri popstate işler: adresleri yeniden yazılır.
window.addEventListener('hashchange', () => { if (navMark(history.state)) { syncHash(); return; } navCur = history.state; welcomeUI.onHashChange(location.hash); if (exam?.isOpen()) { syncHash(); return; } try { applyHash(location.hash); } catch (err) { console.error(err); ui.notify('Bağlantı açılamadı'); syncHash(); } });
// ---------- Geri tuşu / geri hareketi (telefon tarayıcısı, kurulu uygulama, Android WebView) ----------
/* TASARIM
   Amaç: telefonda sistemin Geri tuşu ya da hareketi uygulamadan çıkmasın, en üstteki açık katmanı kapatsın (her
   Geri bir katman). Katmanlar üstten alta (topLayer): açık pencere (deneme sınavı: süren sınavda kendi çıkış onayını
   gösterir, Hakkında), arama sonuçları, dar ekranda sol çekmece, bekleyen yükleme isteği, seçim (çalışma turunda
   seçili madde: Esc ile aynı), konu testi (konudan açıldıysa konu kartına döner), çalışma modu / izole görünüm /
   Aanki konusu. Hiçbiri açık değilse Geri eskisi gibi sayfadan çıkar.
   Yöntem: "bekçi girişi". Bir katman açıkken geçmişin sonunda iki giriş durur: taban (o anki giriş, durumuna
   { a3d:'base', pair } yazılır) ve hemen ardında bekçi ({ a3d:'guard', pair }, pushState). Geri basılınca tarayıcı
   tabana döner (popstate, bekçiden aynı çiftin tabanına): en üstteki katman kapanır; hâlâ açık katman varsa yeni bir
   bekçi eklenir. Böylece geçmiş hiçbir zaman taban + bekçiden fazla büyümez (pushState ileri girişleri siler; her
   refresh'te yeni giriş açılmaz, adres yine replaceState ile yazılır ve girişin durumu korunur).
   Değişmez kural (navReconcile, her syncHash'in ve katman değişiminin sonunda): katman açık ve bekçide değilsek bekçi
   eklenir; hiçbir katman açık değil ve bekçideysek (katman düğmeyle kapandı) sessizce bir geri gidilir (navSilent:
   o popstate katman kapatmaz). Bu sayede her şey kapandıktan sonraki ilk Geri sayfadan çıkar (tuzak yok).
   Derin bağlantılarla birlikte: bizim girişlerimize dönüşte gelen hashchange bağlantı uygulamaz, yalnız adresi
   görünümden yeniden yazar. İşaretsiz girişler (yapıştırılan yeni bir bağlantı, eski girişler) eskisi gibi hashchange
   ile uygulanır; açılan katman için o girişin üstüne yeni bir bekçi gelir. İleri tuşu ya da sonraki bir girişten geri
   gelinerek bir bekçiye varılırsa o bekçinin adresindeki görünüm uygulanır (ileri = son Geri'nin geri alınması);
   görünüm boşsa değişmez kural sessizce tabana döner. Sayfa yenilenirse girişlerin durumu tarayıcıda kalır: bekçide
   yenilenen sayfa görünümü adresten kurar, sonraki Geri yine tabana döner ve katmanı kapatır. Sınav penceresi açıkken
   Android Chrome Geri'yi önce pencereye verir (cancel: sınavın kendi Esc davranışı); geçmiş o zaman değişmez.
   Yapılmayanlar: açılan her katman için ayrı giriş (geçmiş büyür), eski görünümlere geri dönüş (Geri kapatır, geri
   getirmez). */
const navMark = s => (s && typeof s === 'object' && s.a3d ? s : null);
let navCur = history.state;   // bulunduğumuz girişin bilinen durumu (popstate'te "nereden" sorusu için)
let navSilent = null;         // sessiz geri gidişte beklenen tabanın çifti (navReconcile'ı o sürece kilitler)
let navQuiet = null;          // son sessiz geri gidişin çifti: süresi dolmaz, geç gelen popstate'i de katman kapatmaktan alıkoyar
// Chromium, kullanıcı etkileşimi olmadan pushState yapan girişi Geri için atlanabilir sayar (derin bağlantıyla açılıp
// hiç dokunulmadan Geri): o durumda bekçi ilk dokunuşa/tuşa kadar bekler. userActivation yoksa eskisi gibi hemen eklenir.
const navNoGesture = () => !!navigator.userActivation && !navigator.userActivation.hasBeenActive;
let navWaitGesture = false;
function navAfterGesture() {
  if (navWaitGesture) return;
  navWaitGesture = true;
  const go = () => { for (const t of ['pointerup', 'keydown', 'click']) window.removeEventListener(t, go, true); navWaitGesture = false; setTimeout(navReconcile, 0); };
  for (const t of ['pointerup', 'keydown', 'click']) window.addEventListener(t, go, true);
}
function topLayer() {
  if (exam?.isOpen()) return () => exam.close();   // süren sınavda close() çıkış onayını açar ya da kapatır
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();   // en son açılan (Hakkında'nın üstündeki #doc) önce kapanır
  if (dlg) return () => { if (dlg.id === 'users' && usersUI?.back()) return; if (dlg.id === 'welcome' && welcomeUI?.back()) return; dlg.close(); };   // Kullanıcılar: alt görünümden önce listeye; kişisel not: kaldırma onayından önce karta
  const res = document.getElementById('results');
  if (res && !res.hidden) return () => { res.hidden = true; document.getElementById('search')?.blur(); };
  if (document.body.classList.contains('panel-open') && DRAWER_MQ.matches) return () => setPanelOpen(false);
  if (deferred) return () => cancelDeferred();
  if (state.selected.size) return () => actions.clearSelection();
  const p = state.primary;
  if (p?.type === 'quiz' && p.id != null && aanki?.byId.has(p.id) && state.isolate) return () => { state.primary = { type: 'topic', id: p.id }; refresh(); };
  if (state.isolate || STUDY.includes(p?.type) || p?.type === 'quiz') return () => { if (!allTours().some(t => t.escape())) { cancelDeferred(); state.isolate = null; refresh(); } };
  return null;
}
function navReconcile() {
  if (!hashReady || navSilent) return;
  const open = !!topLayer(), at = navMark(history.state);
  try {
    if (open && at?.a3d !== 'guard') {
      if (navNoGesture()) { navAfterGesture(); return; }
      const pair = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const base = { ...(history.state && typeof history.state === 'object' ? history.state : {}), a3d: 'base', pair };
      history.replaceState(base, '');
      history.pushState({ a3d: 'guard', pair }, '', location.href);
      navCur = history.state;
    } else if (!open && at?.a3d === 'guard') {
      const pair = at.pair; navSilent = navQuiet = pair;
      // popstate hiç gelmezse kilit kalmasın; geç gelirse navQuiet yine de onu sessiz sayar
      setTimeout(() => { if (navSilent === pair) { navSilent = null; } }, 3000);
      history.back();
    }
  } catch { /* file:// ya da tarayıcı sınırı: Geri eski davranışta kalır */ }
}
window.addEventListener('popstate', e => {
  const from = navMark(navCur), to = navMark(e.state); navCur = e.state;
  if (navQuiet && to?.a3d === 'base' && to.pair === navQuiet) { navSilent = navQuiet = null; syncHash(); return; }
  navSilent = null;
  if (!hashReady) return;
  if (to?.a3d === 'base' && from?.a3d === 'guard' && from.pair === to.pair) {
    const close = topLayer();
    if (!close) { history.back(); return; }   // kapatılacak bir şey yok: Geri sayfadan çıkmaya devam eder
    try { close(); } catch (err) { console.error(err); }
    syncHash();   // tabanın adresi görünümden yazılır; hâlâ katman varsa yeni bekçi
    return;
  }
  if (to?.a3d === 'guard') {
    // ileri tuşu ya da sonraki bir girişten geri: bekçinin adresindeki görünüm
    if (!exam?.isOpen() && location.hash.replace(/^#/, '') !== fullHash()) {
      try { Promise.resolve(applyHash(location.hash)).catch(err => console.error(err)).finally(() => syncHash()); } catch (err) { console.error(err); }
    }
    syncHash();
  }
  // işaretsiz giriş: hashchange eskisi gibi uygular
});
// Hash'e yazılmayan katmanlar (pencereler, arama sonuçları, çekmece) açılıp kapanınca da kural uygulanır
{
  const mo = new MutationObserver(() => navReconcile());
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const res = document.getElementById('results'); if (res) mo.observe(res, { attributes: true, attributeFilter: ['hidden'] });
  for (const d of document.querySelectorAll('dialog')) mo.observe(d, { attributes: true, attributeFilter: ['open'] });
}
(async function boot() {
  try {
    ui.setLoading('Yapı listesi yükleniyor…', 0.03);
    await model.loadMeta();
    if (!model.sexes.has(state.sex)) state.sex = 'm';   // veride kadına özgü parça yoksa erkek beden
    ui.buildLayers(); ui.buildTree(); ui.buildIndex(); syncWeakBtn();
    markQueue();
    await model.loadSystem('bone', f => ui.setLoading('İskelet yükleniyor…', 0.05 + 0.95 * f));
    refresh(); actions.setView('home'); ui.hideLoading();
    aankiReady = loadAanki();   // açılışı bekletmez
    flushDeferred('bone');   // yükleme ekranı sırasında aramadan seçilen bir kemik varsa şimdi seç (kamera ona uçsun)
    booted = true; pump();
    if (!queue.length && !loadersBusy) document.body.classList.add('ready');
    const startHash = location.hash;
    // bozuk bir bağlantı açılışı durdurmasın: hata bildirilir, adres görünümden yeniden yazılır
    if (startHash.length > 1) Promise.resolve().then(() => applyHash(startHash)).catch(err => { console.error(err); ui.notify('Bağlantı açılamadı'); }).finally(() => { hashReady = true; syncHash(); });
    else hashReady = true;
  } catch (err) {
    console.error(err);
    ui.fail('Model yüklenemedi: ' + (err?.message || err));
  }
})();

// Barındırıcı rozeti: bazı ücretsiz barındırıcılar yayındaki sayfaya sağ alt köşede sabit duran bir rozet ekler (Netlify:
// "Powered by Netlify", #nl-badge-frame; betiği sayfadan sonra yüklenir). Rozet varsa kaydırılan panellerin sonuna
// --host-pad kadar boşluk açılır (style.css) ki en alttaki öğeler rozetin üstüne kaydırılabilsin.
{
  const hostBadge = () => {
    const f = document.getElementById('nl-badge-frame') || document.getElementById('nl-hud-frame');
    if (f) document.documentElement.style.setProperty('--host-pad', '56px');
    return !!f;
  };
  if (!hostBadge()) {
    const mo = new MutationObserver(() => { if (hostBadge()) mo.disconnect(); });
    mo.observe(document.body, { childList: true });
    setTimeout(() => mo.disconnect(), 20000);
  }
}

// hata ayıklama / test için
window.__anatomi ={ state, model, stage, actions, glow, progress, get aanki() { return aanki; }, get heart() { return heart; }, get brain() { return brain; }, get loco() { return loco; }, tours, get situs() { return tours.situs; }, get thorax() { return tours.thorax; }, get uro() { return tours.uro; }, get head() { return tours.head; }, get sect() { return sect; }, get exam() { return exam; }, tools, users, usersUI };
