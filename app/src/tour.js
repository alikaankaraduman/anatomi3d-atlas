// Genel, veriyle sürülen çalışma turu motoru (ilk tur: Situs, karın). Bir tur bir veri dosyasıdır (public/data/<tur>.json,
// tools/tour-build.mjs derler): her içerik sekmesi gruplar, maddeler (model parça adlarıyla), bağlam parçaları, ek bilgiler,
// klinik notlar, bilgi soruları ve modelde olmayanlar listesi taşır; motor bunlardan sekmeleri ve bir "Test" sekmesi kurar.
// Motorda tura özgü hiçbir şey yoktur: yeni bir tur (göğüs, ürogenital, baş-boyun ...) yalnız bir veri dosyası ve
// main.js'deki TOURS listesine bir satırdır.
// İçerik sekmesinde:
//  - her grup sabit bir paletten ayrı bir renk alır (grubun maddeleri bu rengin açık-koyu tonları: komşu segmentler
//    ayrılsın); lejantta grubun Latince ve Almanca adı, tıklanınca süzgeç (yalnız o grubun maddeleri opak, ötekiler
//    hayalet; bu bedende parçası olmayan grup süzülemez);
//  - madde parçaları grup renginde opak, bağlam parçaları saydam (ikinci geçişte tıklanır), gerisi gizli; bütün beden
//    (iki taraf), beden cinsiyetine göre süzülür; parçası bu bedende ya da modelde olmayan madde "(modelde yok)";
//  - grup grup madde listesi; seçilen madde (listeden ya da 3B tıklamayla) parlar, metni görünür, etiketi öne çıkar;
//  - ek bilgiler, klinik ve modelde olmayanlar açılır listeler; kamera sekmenin maddelerini önden (biraz yukarıdan)
//    çerçeveler, yalnız sekme değişince.
// İsteğe bağlı sekme alanları: sex ('m' | 'f': o bedende anlamlı; açılınca beden uygulamanın kendi düğmesinin yoluyla
// değiştirilir ve kullanıcıya söylenir, çıkınca geri dönülmez), view (kamera yönü: front, back, left, right, above,
// below), side ('l' | 'r': eşli parçaların yalnız o taraftaki kopyası ve tek parçalar); düzeltme tablosundan
// (tools/tour-build.mjs) shell / noshell / frame.
// Mod izole görünümle yaşar: izolasyondan çıkılınca renkler ve etiketler kaldırılır (sync).
import * as THREE from 'three';
import { titleName, subtitleName, esc, SEX } from './text.js';
import { tint, solid, hex, nameIndex, anchorOf, centerOf, isExploded, createLabels, createStudyQuiz } from './study.js';
import { getLang, langAttr, Tin } from './testlang.js';

// Test sekmesinin sahne seçicisinde sekmelerin kısa Almanca adları (test dili Almancayken; tabloda olmayan sekme
// title_de'nin ilk parçasını, o da yoksa Türkçe kısa adı kullanır). Düğmenin title'ı title_de (yoksa title_tr).
const TAB_DE = {
  orbita: 'Orbita', ear: 'Ohr & VII', mouth: 'Mund-Rachen', neck: 'Hals',
  organs: 'Lymphorgane', headneck: 'Kopf-Hals', trunk: 'Rumpf', pelvisleg: 'Becken-Bein',
  arteries: 'Bauch­arterien', portal: 'Pfortader', peritoneum: 'Peritoneum', liver: 'Leber, Pankreas',
  larynx: 'Kehlkopf', lung: 'Lunge', pleura: 'Atmung', mediastinum: 'Mediastinum',
  kidney: 'Niere', male: 'Männlich', female: 'Weiblich', pelvis: 'Becken',
  armart: 'Armarterien', armven: 'Armvenen', legart: 'Beinarterien', legven: 'Beinvenen',
};

// açıkça ayrışan grup renkleri (sırayla)
const PALETTE = [0xe0473f, 0x3f7fe0, 0xf5c542, 0x3fbf6a, 0xb36ae0, 0xf08a2a, 0x3fd0d8, 0xe8579f, 0x9a7a4a, 0xa6e05a];
// bir grubun maddeleri için açıklık adımları (sırayla; ilk madde grubun kendi rengi)
const SHADE = [0, 0.13, -0.13, 0.07, -0.07, 0.2, -0.2];
const CTX = 0xcfc6bc;
const VIEW = { front: [0, 0.28, 1], back: [0, 0.28, -1], left: [1, 0.25, 0.12], right: [-1, 0.25, 0.12], above: [0, 1, 0.2], below: [0, -1, 0.2] };
const noPick = mat => { mat.userData.noPick = true; return mat; };
const sw = c => `<span class="sw" style="background:${hex(c)}"></span>`;
const short = (s, n = 26) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const shade = (c, k) => { if (!k) return c; const col = new THREE.Color(c), h = {}; col.getHSL(h); col.setHSL(h.h, h.s, Math.min(0.82, Math.max(0.22, h.l + k))); return col.getHex(); };

// İnce yapı (damar, sinir, kanal): yüzey alanı en büyük boyutunun karesine göre küçük. Böyle parçalar örten madde sayılmaz
// (uzun bir tüpün kutusu ya da önden geçişi rastlantıyla başka maddeleri "örter").
const areaCache = new WeakMap();
function slender(r) {
  if (!r.geo) return true;
  if (!areaCache.has(r.geo)) {
    const P = r.geo.attributes.position.array, I = r.geo.index?.array, n = I ? I.length : P.length / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let s = 0;
    for (let i = 0; i < n; i += 3) {
      a.fromArray(P, (I ? I[i] : i) * 3); b.fromArray(P, (I ? I[i + 1] : i + 1) * 3); c.fromArray(P, (I ? I[i + 2] : i + 2) * 3);
      s += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    areaCache.set(r.geo, s);
  }
  const z = r.box.getSize(new THREE.Vector3()), mx = Math.max(z.x, z.y, z.z);
  return !mx || areaCache.get(r.geo) / (mx * mx) < 0.3;
}

// Küçük parçalardan oluşan yapı: her bağlı bileşeni (kutu köşegeni) 3 cm'den küçük. Lenf düğümleri modelde tek düğüm ya
// da bir zincirin düğümleri olarak tek parçadır (Nodi intercostales boydan boya 30 cm); kutusu büyük olsa da hiçbir şeyi
// örtmez ve etiketi düğümün üstüne değil yanına konur.
const bitsCache = new WeakMap();
function smallBits(r) {
  if (!r.geo) return false;
  if (!bitsCache.has(r.geo)) {
    const P = r.geo.attributes.position.array, I = r.geo.index?.array, nv = P.length / 3;
    // aynı konumdaki köşeler birleştirilir (dikişli ağlar), sonra üçgenler üzerinden birleşim-bul
    const key = new Map(), root = new Int32Array(nv);
    for (let v = 0; v < nv; v++) { const k = P[v * 3].toFixed(3) + ',' + P[v * 3 + 1].toFixed(3) + ',' + P[v * 3 + 2].toFixed(3); if (!key.has(k)) key.set(k, v); root[v] = key.get(k); }
    const par = Int32Array.from(root), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    const n = I ? I.length : nv;
    for (let i = 0; i < n; i += 3) { const a = find(root[I ? I[i] : i]); for (let j = 1; j < 3; j++) { const b = find(root[I ? I[i + j] : i + j]); if (a !== b) par[b] = a; } }
    const boxes = new Map();
    for (let v = 0; v < nv; v++) { const c = find(root[v]); if (!boxes.has(c)) boxes.set(c, new THREE.Box3()); boxes.get(c).expandByPoint(new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])); }
    let mx = 0; for (const b of boxes.values()) mx = Math.max(mx, b.getSize(new THREE.Vector3()).length());
    bitsCache.set(r.geo, mx < 3);
  }
  return bitsCache.get(r.geo);
}

// Grup renkleri damar kuralıyla: arter grupları kırmızıdan başlar ve mavi / camgöbeği almaz, ven grupları maviden başlar
// ve kırmızı / turuncu / pembe almaz (öğrencinin bildiği renk kuralı). Grubun türü maddelerinin Latince adından: en az
// yarısı arter (A., Aa., Aorta) ve hiç ven yoksa arter grubu; tersi ven grubu. Bütün maddeleri arter (ya da ven) olan
// sekmede (en az yarısı arter ya da ven) türsüz gruplar da (düğümler, arkuslar) sekmenin türünü alır. Öteki gruplar paletin sırasıyla kalan renkleri alır.
const ART = /^(A|Aa|Arteria|Arteriae|Aorta)\b/, VEN = /^(V|Vv|Vena|Venae)\b/;
const NO = { art: [1, 6], ven: [0, 5, 7] }, FIRST = { art: 0, ven: 1 };
const palCache = new WeakMap();
// from_la arterde çıkış yeri, ven ve lenf yapılarında (düğüm, lenf gövdesi, Ductus thoracicus) akıntının gittiği yer
const DRAIN = /^(V|Vv|Vena|Venae|Nodi|Nodus|Nll?|Noduli|Cisterna|Angulus)\b|venos|lymph|Ductus thoracicus|^Truncus (jugularis|subclavius|bronchomediastinalis|lumbalis|intestinalis)/i;
function palOf(t) {
  if (palCache.has(t)) return palCache.get(t);
  const cnt = its => [its.filter(i => ART.test(i.la || '')).length, its.filter(i => VEN.test(i.la || '')).length];
  const [ta, tv] = cnt(t.items), tabKind = ta && !tv && ta * 2 >= t.items.length ? 'art' : tv && !ta && tv * 2 >= t.items.length ? 'ven' : null;
  const kinds = t.groups.map(g => {
    const its = t.items.filter(i => i.group === g.key), [a, v] = cnt(its);
    return a && !v && a * 2 >= its.length ? 'art' : v && !a && v * 2 >= its.length ? 'ven' : tabKind;
  });
  const map = new Map(), used = new Set();
  // önce her türün ilk grubu kendi rengini alır, sonra gruplar sırayla (palet biterse yeniden döner)
  for (const k of ['art', 'ven']) { const gi = kinds.indexOf(k); if (gi >= 0) { map.set(t.groups[gi].key, FIRST[k]); used.add(FIRST[k]); } }
  t.groups.forEach((g, gi) => {
    if (map.has(g.key)) return;
    const no = NO[kinds[gi]] || [];
    let c = PALETTE.findIndex((_, i) => !used.has(i) && !no.includes(i));
    if (c < 0) c = no.includes(gi % PALETTE.length) ? 2 : gi % PALETTE.length;
    map.set(g.key, c); used.add(c);
  });
  palCache.set(t, map);
  return map;
}

export function createTour({ key, title, chip, dataUrl, stage, model, state, refresh, defer, cancel, viewLayers, endStudy, setSex, ui }) {
  let D = null, loading = null, enterSeq = 0, active = false, built = false, mats = null;
  const m = { tab: null, sel: {}, filter: {}, scene: null, pickedId: null, sex: null };
  const { recs } = nameIndex(model, state);
  const labels = createLabels(stage);
  const quizzes = new Map();   // sahne (içerik sekmesi) -> createStudyQuiz

  const load = () => loading ||= fetch(dataUrl).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { if (!Array.isArray(j?.tabs) || !j.tabs.length) throw new Error('sekme yok'); D = j; })
    .catch(e => { loading = null; console.warn(`${title} verisi yüklenemedi:`, e); ui?.notify?.(`${chip} verisi yüklenemedi`); throw e; });

  // --- veri erişimi ---
  const tabOf = k => D.tabs.find(t => t.key === k);
  const cur = () => tabOf(m.tab) || D.tabs[0];
  const shownTab = () => (m.tab === 'quiz' ? tabOf(m.scene) || D.tabs[0] : cur());
  const sideOk = t => r => !t.side || !r.sd || r.sd === t.side;
  const trecs = (t, names) => recs(names || []).filter(sideOk(t));   // yüklü, bu bedende, sekmenin tarafında
  const ids = rs => new Set(rs.map(r => r.id));
  const boxOf = rs => { const b = new THREE.Box3(); for (const r of rs) b.union(r.box); return b; };
  const colorOf = (t, g) => PALETTE[palOf(t).get(g) ?? 0];
  // maddenin rengi: grubun rengi, grupta kaçıncı maddeyse o kadar açık ya da koyu
  const itemColor = (t, it) => { const same = t.items.filter(x => x.group === it.group); return shade(colorOf(t, it.group), same.length > 1 ? SHADE[same.indexOf(it) % SHADE.length] : 0); };
  const selItem = t => t.items.find(i => i.key === m.sel[t.key]) || null;
  const dirOf = t => new THREE.Vector3(...(VIEW[t.view] || VIEW.front)).normalize();
  // yüklenmemiş kayıtlar dahil adlardan kayıtlar (hangi sistemlerin yükleneceğine karar vermek için)
  let byName = null;
  const allRecs = names => { if (!byName) { byName = new Map(); for (const r of model.list) { if (!byName.has(r.n)) byName.set(r.n, []); byName.get(r.n).push(r); } } return names.flatMap(n => byName.get(n) || []); };
  const tabNames = t => [...t.items.flatMap(i => i.n || []), ...(t.context || [])];
  // sekmenin düzeltme alanları (shell / noshell): madde ya da grup anahtarları; noshell: true hepsi
  const listed = (list, it) => list === true || (Array.isArray(list) && (list.includes(it.key) || list.includes(it.group)));

  function build() {
    if (built) return;
    mats = { cache: new Map(), shellQ: tint(0xd8cfc4, 0.08, 0.6), ctx: tint(CTX, 0.03, 0.26), ctxQ: noPick(tint(CTX, 0.02, 0.2)) };
    built = true;
  }
  // renk başına malzemeler (ilk kullanımda): item opak, dim süzgeç dışı hayalet, shell başka maddeleri örten madde (içi
  // görünür), shellOn seçili örten madde (belirgin ama içindekiler görünür ve tıklanır)
  function matOf(kind, c) {
    const k = kind + c;
    if (!mats.cache.has(k)) {
      const mt = kind === 'item' ? solid(c, 0.16) : kind === 'dim' ? tint(c, 0.04, 0.4) : kind === 'shell' ? tint(c, 0.07, 0.6) : tint(c, 0.2, 0.75);
      // kesit açıkken sonradan kurulan malzeme de kesilsin (section.js açılışta var olanları ayarlar)
      if (model.clipPlane) mt.clippingPlanes = [model.clipPlane];
      mats.cache.set(k, mt);
    }
    return mats.cache.get(k);
  }
  // Etiket ve ışın noktası: eşli maddede (sağ ve sol kopya; tarafı adında olan kayıtlar, ör. "... of left kidney", orta
  // hattın hangi yanında durduklarına göre) yalnız bakış yönüne dönük taraf (iki tarafın ortası orta hatta kalır);
  // within verilirse merkezi o kutunun dışındaki madde (boydan boya uzanan sempatik zincir) kutunun
  // içindeki en yakın yüzey noktasına bağlanır.
  const sideOf = r => r.sd || (r.box.min.x > 0.5 ? 'l' : r.box.max.x < -0.5 ? 'r' : null);   // model: +x bedenin solu
  function sideRecs(t, rs) {
    const L = rs.filter(r => sideOf(r) === 'l'), R = rs.filter(r => sideOf(r) === 'r');
    if (!L.length || !R.length) return rs;
    const d = dirOf(t), dl = centerOf(L).dot(d), dr = centerOf(R).dot(d);
    return [...(dl > dr + 0.5 ? L : R), ...rs.filter(r => !sideOf(r))];
  }
  function anchorFor(t, rs, within = null) {
    const use = sideRecs(t, rs);
    let c = centerOf(use);
    if (within && !within.isEmpty() && !within.containsPoint(c)) c = within.clampPoint(c, new THREE.Vector3());
    return anchorOf(use, c);
  }
  // küçük madde (lenf düğümleri, kısa ince dallar): etiketi yapının üstüne değil yanına konur (createLabels nudge)
  const tiny = (t, rs) => sideRecs(t, rs).every(smallBits);
  // sahnenin testi: sekmenin maddeleri yapı sorusu (grup = kategori; parçasızlar atlanır), sekmenin soruları bilgi sorusu
  function quizOf(t) {
    if (!quizzes.has(t.key)) {
      const items = t.items.filter(i => i.n?.length).map(i => ({ n: i.n, la: i.la, de: i.de || '', cat: i.group }));
      quizzes.set(t.key, createStudyQuiz({ recs: names => trecs(t, names), items, facts: t.quiz || [], factOk: f => !f.cat || f.cat === t.key,
        refresh, stage, model, visible: r => !!state.isolate?.has(r.id), findable: q => !enclosed(t, q) }));
    }
    return quizzes.get(t.key);
  }

  // --- görünüm ---
  // Küçük parçalı maddeler (lenf düğümleri) opak bir maddenin (V. femoralis, Lig. inguinale) ardında kalınca kaybolmasın:
  // içerik sekmesinde grup renginde soluk bir "röntgen" kopyası derinlik sınaması olmadan üstte çizilir (görünürken yalnız
  // biraz parlar, gömülüyken silueti görünür). Tıklanmaz; parçalarına ayırınca gizlenir; kesit düzlemine uyar.
  const xray = new THREE.Group(); xray.renderOrder = 5; stage.scene.add(xray);
  const xmats = new Map();
  const xmatOf = c => {
    if (!xmats.has(c)) xmats.set(c, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false }));
    const mt = xmats.get(c); mt.clippingPlanes = model.clipPlane ? [model.clipPlane] : null; return mt;
  };
  function setXray(list) {
    xray.clear();
    for (const { r, c } of list) { const mh = new THREE.Mesh(r.geo, xmatOf(c)); mh.renderOrder = 5; mh.matrixAutoUpdate = false; mh.raycast = () => {}; xray.add(mh); }
    xray.visible = !wasExploded;
    stage.requestRender?.();
  }
  // Tıklanan noktanın hemen ardında (ilk opak isabetten en çok 5 cm geride) küçük parçalı bir madde var mı (opak bir damarın
  // arkasındaki düğüm)? ok(rec) aranan kayıtları süzer.
  function buriedSmall(x, y, ok) {
    if (x === undefined) return null;
    const hs = model.hitsAt(x, y), i0 = hs.findIndex(h => !h.soft); if (i0 < 0) return null;
    const h = hs.slice(i0 + 1).find(h => h.distance <= hs[i0].distance + 5 && h.rec.mesh && ok(h.rec) && smallBits(h.rec));
    return h ? h.rec : null;
  }
  // Tıklamanın en çok 8 px yakınında küçük parçalı bir madde (bütün bacak çerçevelenince 2-3 px'lik düğümler) var mı?
  // Ekrana izdüşen köşelerinden tıklamaya en yakın olan alınır; ilk opak isabetten en çok 5 cm geride olmalı (bedenin
  // öbür yanındaki düğüm seçilmesin). ok(rec) aranan kayıtları süzer.
  const pv = new THREE.Vector3();
  function nearSmall(x, y, ok) {
    if (x === undefined) return null;
    const rect = stage.canvas.getBoundingClientRect(), cam = stage.camera;
    const hs = model.hitsAt(x, y), h0 = hs.find(h => !h.soft), maxD = h0 ? h0.distance + 5 : Infinity;
    let best = null, bd = 8;
    for (const id of state.isolate || []) {
      const r = model.items.get(id);
      if (!r?.mesh || !r.vis || !ok(r) || !smallBits(r)) continue;
      const P = r.geo.attributes.position.array, step = Math.max(1, Math.floor(P.length / 3 / 400));
      r.mesh.updateMatrixWorld();
      // yalnız ekranda gerçekten küçük düğümler (her bileşeni ~12 px'ten küçük; yakından bakınca düğüme doğrudan tıklanır,
      // yanındaki damar seçilebilir kalır): yakın köşenin çevresindeki köşeler 12 px içinde kalmalı
      let rd = bd, rp = null, rw = null;
      const w = new THREE.Vector3(), sc = q => [rect.left + (q.x * 0.5 + 0.5) * rect.width, rect.top + (-q.y * 0.5 + 0.5) * rect.height];
      for (let v = 0; v < P.length / 3; v += step) {
        w.fromArray(P, v * 3).applyMatrix4(r.mesh.matrixWorld);
        if (w.distanceTo(cam.position) > maxD) continue;
        pv.copy(w).project(cam); if (pv.z > 1) continue;
        const s = sc(pv), d = Math.hypot(s[0] - x, s[1] - y);
        if (d < rd) { rd = d; rp = s; rw = w.clone(); }
      }
      if (!rp) continue;
      // o düğümün ekrandaki boyu: yakın köşeye 1,5 cm'den yakın köşelerin izdüşümü 12 px'i aşıyorsa düğüm büyük görünüyor
      let big = false;
      for (let v = 0; v < P.length / 3 && !big; v += step) {
        w.fromArray(P, v * 3).applyMatrix4(r.mesh.matrixWorld);
        if (w.distanceTo(rw) > 1.5) continue;
        const s = sc(pv.copy(w).project(cam));
        if (Math.hypot(s[0] - rp[0], s[1] - rp[1]) > 12) big = true;
      }
      if (!big) { bd = rd; best = r; }
    }
    return best;
  }
  let narrow = false;
  function applyTab() {
    const ov = model.overrides; ov.clear();
    const t = shownTab();
    const itemRecs = t.items.map(i => trecs(t, i.n));
    const used = ids(itemRecs.flat());
    const ctx = trecs(t, t.context).filter(r => !used.has(r.id));
    const list = [];
    narrow = stage.canvas.clientWidth < 620;
    if (m.tab === 'quiz') {
      // test: maddeler doğal renginde (renk ipucu yok), bağlam neredeyse görünmez ve tıklanmaz
      for (const r of ctx) ov.set(r.id, mats.ctxQ);
      // örten maddeler nötr yarı saydam (renk ipucu yok; ikinci geçişte tıklanır, "Yapıyı bul" ışını içinden geçer)
      for (const i of shellsOf(t, itemRecs)) for (const r of itemRecs[i]) ov.set(r.id, mats.shellQ);
      state.isolate = ids([...itemRecs.flat(), ...ctx]);
      setXray([]);
      quizOf(t).ensure();
    } else {
      const f = m.filter[t.key] || null, sel = selItem(t);
      for (const r of ctx) ov.set(r.id, mats.ctx);
      const shells = shellsOf(t, itemRecs);
      t.items.forEach((it, i) => {
        const c = itemColor(t, it);
        // seçili madde süzgeç dışında da opak kalır
        const on = !f || it.group === f || it === sel;
        // başka maddeleri saran madde (akciğer lobu, böbrek ...): süzgeç onun grubunda değilse yarı saydam; seçiliyse
        // daha belirgin ama yine saydam (içindeki bronş ve damarlar görünür ve tıklanır kalsın)
        const shell = shells.has(i) && f !== it.group;
        const mt = !on ? matOf('dim', c) : shell ? matOf(it === sel ? 'shellOn' : 'shell', c) : matOf('item', c);
        for (const r of itemRecs[i]) if (!ov.has(r.id) || ov.get(r.id) === mats.ctx) ov.set(r.id, mt);
      });
      state.isolate = ids([...itemRecs.flat(), ...ctx]);
      setXray(t.items.flatMap((it, i) => (!f || it.group === f || it === sel) && itemRecs[i].length && itemRecs[i].every(smallBits)
        ? itemRecs[i].filter(r => r.mesh).map(r => ({ r, c: itemColor(t, it) })) : []));
      // etiketler: seçili madde tam adıyla; ötekiler kısa adla, kalabalıksa nokta; dar tuvalde yalnız seçili
      const shown = t.items.map((it, i) => ({ it, rs: itemRecs[i] })).filter(x => x.rs.length && (!f || x.it.group === f || x.it === sel));
      const crowded = shown.length > 12, fb = frameBoxOf(t);
      for (const { it, rs } of shown) {
        const on = it === sel, c = hex(itemColor(t, it));
        if (narrow && !on) continue;
        // etiket tıklanınca maddesini seçer (xpick; aşağıdaki dinleyici); küçük maddenin (düğüm) noktası daha küçük ve
        // düğümün yanına kayık durur, düğüm görünür ve tıklanır kalır
        const small = tiny(t, rs), dot = `<i class="ldot" data-tl="${esc(it.key)}" style="background:${c}"></i>`;
        list.push({ text: on ? `${dot}${esc(it.la)}` : crowded ? dot : `${dot}${esc(short(it.la, 22))}`, p: anchorFor(t, rs, fb), cls: 'xpick ' + (on ? 'on' : crowded ? 'num tdot' + (small ? ' tsm' : '') : 'dimlbl'), nudge: small });
      }
    }
    state.isoGhost = null;   // bağlam bu modda override ile çizilir; başka görünümün saydam bağlamı kalmasın
    labels.set(list);
  }

  // Örten maddeler, yarı saydam çizilir (süzgeç grubundayken opak; seçilince belirgin ama saydam):
  //  - saran: tek bir kalın (ince değil) kaydının hacmi kayıtların ortancasının 8 katını aşan ve o kaydın kutusu başka
  //    maddelerin en az üç kaydının merkezini içine alan maddeler (akciğer lobları bronşları ve damarları örter);
  //  - önde duran: sekmenin bakış yönünden bakınca kalın ve iri (hacmi ortancanın 4 katı) bir kaydıyla en az üç başka
  //    maddenin etiket noktasının önünde duran maddeler (dallı segment damarları sayılmaz) (göğüs duvarının yüzeysel kasları diyaframı ve interkostal damarları örter);
  //  - ince yapılar (damar, sinir, kanal; slender) ve küçük parçalar (lenf düğümleri) hiçbir kurala girmez;
  //  - veride tab.shell (madde ya da grup anahtarları) eklenir, tab.noshell (anahtarlar ya da true) çıkarılır
  //    (tools/tour-build.mjs düzeltme tablosundan).
  // Sekme başına bir kez hesaplanır (beden ve yüklü sistemlere bağlı olduğundan imzayla); parçalarına ayrılmışken
  // ışınlar yanlış yere düşeceğinden sonuç önbelleğe alınmaz.
  const shellCache = new Map(), ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const vol = r => { const s = r.box.getSize(new THREE.Vector3()); return s.x * s.y * s.z; };
  function shellsOf(t, itemRecs) {
    const sig = t.key + '|' + itemRecs.map(rs => rs.map(r => r.id).join('.')).join(',');
    if (shellCache.get(t.key)?.sig === sig) return shellCache.get(t.key).set;
    const all = itemRecs.flatMap((rs, i) => rs.map(r => ({ r, i, c: r.box.getCenter(new THREE.Vector3()) })));
    const med = all.map(x => vol(x.r)).sort((a, b) => a - b)[all.length >> 1] || 0;
    // küçük parçalar (lenf düğümleri, tek tek ya da zincir halinde) da örten sayılmaz: hep opak ve tıklanır madde kalırlar
    const thick = itemRecs.map(rs => rs.filter(r => !slender(r) && !smallBits(r)));
    const set = new Set();
    itemRecs.forEach((rs, i) => {
      const big = thick[i].filter(r => vol(r) > 8 * med);
      if (!big.length) return;
      const inside = all.filter(x => x.i !== i && big.some(r => r.box.containsPoint(x.c))).length;
      if (inside >= 3) set.add(i);
    });
    // bakış yönünden örtme: her maddenin etiket noktasına dışarıdan ışın
    const owner = new Map(all.filter(x => x.r.mesh).map(x => [x.r.mesh, x.i]));
    const thickMesh = new Set(thick.flat().filter(r => vol(r) >= 4 * med).map(r => r.mesh));   // kalın ve iri
    const meshes = [...owner.keys()], dir = dirOf(t), far = 400;
    const exploded = meshes.length && isExploded(all.slice(0, 40).map(x => x.r).filter(r => r.mesh));
    const hides = new Map();
    if (!exploded) itemRecs.forEach((rs, i) => {
      if (!rs.some(r => r.mesh)) return;
      const a = anchorFor(t, rs.filter(r => r.mesh));
      ray.set(a.clone().addScaledVector(dir, far), dir.clone().negate()); ray.far = far - 0.05;
      const front = new Set();
      for (const h of ray.intersectObjects(meshes, false)) { const j = owner.get(h.object); if (j !== i && thickMesh.has(h.object)) front.add(j); }
      for (const j of front) { if (!hides.has(j)) hides.set(j, new Set()); hides.get(j).add(i); }
    });
    for (const [j, s] of hides) if (s.size >= 3) set.add(j);
    t.items.forEach((it, i) => { if (listed(t.shell, it)) set.add(i); if (listed(t.noshell, it)) set.delete(i); });
    if (!exploded) shellCache.set(t.key, { sig, set });
    return set;
  }
  // "Yapıyı bul" için: madde tek bir başka (örtmeyen, opak) maddenin içinde mi? Altı yönün en az beşinde ilk çarpılan
  // aynı maddeyse (böbreğin içindeki damarlar: yalnız hilustan açık) sorulmaz: tıklama her zaman örtene düşer.
  const enclosedCache = new Map();
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(v => new THREE.Vector3(...v));
  function enclosed(t, q) {
    const own = sideRecs(t, trecs(t, q.n).filter(r => r.mesh)); if (!own.length || isExploded(own)) return false;
    const k = t.key + '|' + state.sex + '|' + q.n.join('|');
    if (enclosedCache.has(k)) return enclosedCache.get(k);
    const itemRecs = t.items.map(i => trecs(t, i.n)), shells = shellsOf(t, itemRecs), mine = new Set(q.n);
    const qb = boxOf(own), far = 400;
    // maddenin yüzeyinden örnek noktalar (kaydın merkezi dağınık parçalarda boşlukta kalabilir)
    const pts = own.flatMap(r => { const P = r.geo.attributes.position.array, n = P.length / 3, k = Math.max(1, Math.ceil(8 / own.length)); return Array.from({ length: k }, (_, j) => new THREE.Vector3().fromArray(P, Math.floor((j + 0.5) * n / k) * 3)); });
    // saran aday: örtmeyen (opak) bir maddenin, kutusu maddenin kutusunu içine alan kaydı; örnek noktaların en az dörtte
    // üçünde altı yönün en az beşinden dışarıdan gelen ışın önce ona çarpar (böbrek: yalnız hilustan açık)
    const wrapped = (mesh, p) => DIRS.filter(d => { ray.set(p.clone().addScaledVector(d, far), d.clone().negate()); ray.far = far - 0.02; return ray.intersectObject(mesh, false).length > 0; }).length >= 5;
    let res = false;
    itemRecs.forEach((rs, i) => {
      if (res || shells.has(i)) return;
      for (const r of rs) {
        if (!r.mesh || mine.has(r.n) || !r.box.containsBox(qb)) continue;
        if (pts.filter(p => wrapped(r.mesh, p)).length >= 0.75 * pts.length) { res = true; return; }
      }
    });
    enclosedCache.set(k, res);
    return res;
  }

  // kamera: sekmenin maddeleri, sekmenin yönünden (varsayılan önden, biraz yukarıdan)
  function frame() {
    const t = shownTab(), box = frameBoxOf(t);
    if (!box.isEmpty()) stage.frameBox(box, dirOf(t));
  }
  // tab.frame: çerçevelenecek grup anahtarları (iki uzak bölgeli sekmelerde; tools/tour-build.mjs düzeltme tablosundan)
  // Tek bir uzvu anlatan sekme (side, frame verilmemişse) ya da tab.frameAll: maddelerin hepsi kırpılmadan (uzun ince damarlar ve uçtaki el,
  // ayak dalları dahil), uzuv omuzdan ya da kalçadan parmaklara kadar görünsün.
  function frameBoxOf(t) {
    const fr = t.frame?.length ? t.items.filter(i => t.frame.includes(i.group)) : [];
    let groups = (fr.length ? fr : t.items).map(i => trecs(t, i.n)).filter(rs => rs.length);
    if (!groups.length) groups = [trecs(t, t.context)];
    return t.frameAll || (t.side && !fr.length) ? boxOf(groups.flat()) : coreBox(groups);
  }
  // Çerçeve kutusu (groups: madde başına kayıtlar). Uzun yapılar (N. vagus, aorta, testis damarları ...) ve sekmenin uzak
  // bir köşesindeki birkaç madde (kadın sekmesinde meme) sahneyi küçültmesin diye: yalnız boyutu kayıtların ortancasının
  // 2,5 katını aşmayan "derli toplu" kayıtlar alınır; madde merkezlerinin ortancasına en yakın %80 madde çekirdeği kurar;
  // çekirdek dışındaki kayıtlar çekirdek kutusunun biraz genişletilmişiyle kırpılarak eklenir.
  function coreBox(groups) {
    const rs = groups.flat();
    if (rs.length < 4) return boxOf(rs);
    const size = r => r.box.getSize(new THREE.Vector3()).length();
    const med = [...rs.map(size)].sort((a, b) => a - b)[rs.length >> 1];
    let items = groups.map(g => g.filter(r => size(r) <= 2.5 * med)).filter(g => g.length);
    if (items.flat().length < 3) return boxOf(rs);
    if (items.length >= 5) {
      const cen = items.map(g => boxOf(g).getCenter(new THREE.Vector3()));
      const c = ['x', 'y', 'z'].map(k => cen.map(p => p[k]).sort((a, b) => a - b)[cen.length >> 1]);
      const d = i => Math.hypot(cen[i].x - c[0], cen[i].y - c[1], cen[i].z - c[2]);
      items = items.map((g, i) => [g, d(i)]).sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(items.length * 0.8)).map(x => x[0]);
    }
    const core = new Set(items.flat());
    const b = boxOf([...core]), grow = b.clone().expandByScalar(b.getSize(new THREE.Vector3()).length() * 0.12);
    for (const r of rs) if (!core.has(r)) { const x = r.box.clone().intersect(grow); if (!x.isEmpty()) b.union(x); }
    return b;
  }
  // seçilen ya da sorulan yapı ekranın dışındaysa kamera sekmenin çerçevesiyle birlikte onu da alır
  function reveal(t, rs) {
    if (!rs.length || isExploded(rs)) return;
    const p = anchorFor(t, rs).project(stage.camera);
    if (Math.abs(p.x) > 0.9 || Math.abs(p.y) > 0.9 || p.z > 1) stage.frameBox(frameBoxOf(t).union(coreBox([rs])).expandByScalar(2), dirOf(t));
  }
  // panel (refresh ile eşzamanlı çizilir): seçilen maddenin metni görünür olsun; sekme değişince panel başa döner
  const scrollPanel = top => {
    const box = document.getElementById('info'); if (!box) return;
    // tıklanan bağlam yapısının kartı listenin altındadır: o varsa ona kaydır
    if (top) box.scrollTop = 0; else (box.querySelector('.tpicked') || box.querySelector('.tsel'))?.scrollIntoView({ block: 'nearest' });
  };

  // spec: 'sekme[:madde]' ya da 'quiz[:sahne]'
  function enter(spec) {
    // her istek bir sıra numarası alır: bekleyen (veri ya da sistem yüklemesi) eski istek, bu arada başka bir sekme
    // açıldıysa ya da moddan çıkıldıysa (cleanup) artık hiçbir şey yapmaz
    const seq = ++enterSeq;
    if (!D) { load().then(() => { if (seq === enterSeq) enter(spec); }, () => {}); return; }
    const s = String(spec || ''), i = s.indexOf(':'), tk = i < 0 ? s : s.slice(0, i), sub = i < 0 ? '' : s.slice(i + 1);
    const tab = tk === 'quiz' ? 'quiz' : tabOf(tk) ? tk : D.tabs[0].key;
    const scene = tab === 'quiz' ? (tabOf(sub) ? sub : tabOf(m.scene) ? m.scene : D.tabs[0].key) : null;
    const t = tabOf(scene || tab);
    // sekme bir bedene özgüyse o bedenin sistemleri; parçaları henüz yüklenmemiş sistemler önce yüklenir
    const sex = t.sex || state.sex;
    const need = [...new Set(allRecs(tabNames(t)).filter(r => !r.x || r.x === sex).map(r => r.s))];
    const wait = need.find(x => !model.loaded[x] && !model.failed?.has(x));
    if (wait) { defer(wait, () => { if (seq === enterSeq) enter(spec); }); return; }
    build();
    endStudy?.(key);   // başka bir çalışma modu açıksa renklerini ve etiketlerini şimdi kaldırsın
    // beden önce değişir: görünüm yeni bedende bir kez kurulur (eski bedende kurulup süzülünce boşalıp modu kapatmasın)
    const switched = !!(t.sex && t.sex !== state.sex && setSex);
    if (switched) setSex(t.sex);   // uygulamanın beden düğmesiyle aynı yol
    // mod kapalıyken açılırsa önceki süzgeç ve seçimler sıfırlanır (bağlantıyla gelen madde aşağıda yeniden seçilir)
    if (!active) { m.filter = {}; m.sel = {}; }
    const prevTab = m.tab;
    m.tab = tab;
    if (scene) {
      if (scene !== m.scene) {
        // soru türü sahne değişince korunur
        const mode = quizzes.get(m.scene)?.state().mode;
        quizzes.get(scene)?.clear(); m.scene = scene;
        if (mode) quizOf(t).setMode(mode);
      }
    } else if (sub && t.items.some(x => x.key === sub)) m.sel[tab] = sub;
    if (!m.scene) m.scene = D.tabs[0].key;
    active = true; m.pickedId = null; m.sex = state.sex; wasExploded = null; lastAsked = null;
    state.selected = new Set(); state.primary = { type: key };
    viewLayers(Object.fromEntries(need.filter(x => !model.failed?.has(x)).map(x => [x, 'show'])));
    applyTab();
    refresh();
    if (switched) ui?.notify?.(`${SEX[t.sex].label} modele geçildi`);
    frame();
    scrollPanel(prevTab !== tab || !sub);
  }
  function cleanup() {
    active = false; enterSeq++;
    model.overrides.clear(); labels.set([]); labels.hide(false); xray.clear();
    for (const q of quizzes.values()) q.clear();
  }
  // Ana yenilemeden önce: mod bittiyse temizle; beden değiştiyse görünümü yeniden kur
  function sync() {
    if (!active) return;
    if (state.primary?.type !== key) {
      // beden değişince sekmenin bütün yapıları kaybolduysa (ana kod izolasyonu boşaltıp modu kapattı) kullanıcıya söylenir
      if (state.primary == null && m.sex !== state.sex && !state.isolate) ui?.notify?.(`Bu sekmenin yapıları ${SEX[state.sex]?.label.toLowerCase() || 'bu'} modelde yok`);
      cleanup(); return;
    }
    if (m.sex !== state.sex) { m.sex = state.sex; m.pickedId = null; applyTab(); }
  }
  let lastAsked = null;
  function highlight() {
    if (!active || !D) return [];
    let rs = [];
    if (m.tab === 'quiz') {
      const t = tabOf(m.scene) || D.tabs[0];
      rs = quizOf(t).asked();
      // sorulan yapı ekranın dışındaysa (çerçevenin kenarındaki bir kas) kamera onu da alır; soru başına bir kez
      const k = rs.map(r => r.id).join(',');
      if (k && k !== lastAsked) { lastAsked = k; reveal(t, rs.filter(r => r.vis && r.mesh)); }
    } else { const t = cur(), it = selItem(t); if (it) rs = trecs(t, it.n); }
    const picked = m.pickedId && m.tab !== 'quiz' ? model.items.get(m.pickedId) : null;
    if (picked) rs = rs.concat([picked]);
    return rs.filter(r => r.vis && r.mesh).map(r => r.mesh);
  }
  // 3B tıklama: testte "Yapıyı bul" cevabı; içerik sekmesinde maddenin parçasıysa madde seçilir, değilse "Tıklanan yapı"
  function onPick(id, x, y) {
    if (!active || !D) return false;
    const r = model.items.get(id); if (!r) return true;
    if (m.tab === 'quiz') {
      const test = quizOf(tabOf(m.scene) || D.tabs[0]), q = test.findQuestion();
      if (q) {
        const want = new Set(q.n); let ok = want.has(r.n);
        if (!ok && x !== undefined) for (const h of model.hitsAt(x, y)) { if (want.has(h.rec.n)) { ok = true; break; } if (!h.soft) break; }
        // opak bir yapının hemen ardındaki küçük madde (derin lenf düğümü) de bulunmuş sayılır
        // (yalnız tıklanan parça küçük değilse: başka bir küçük düğüme doğrudan tıklama yanlış kalır)
        if (!ok && !smallBits(r) && buriedSmall(x, y, rec => want.has(rec.n))) ok = true;
        // ekranda birkaç piksellik düğüm: tıklama 8 px yakınına düştüyse de bulunmuş sayılır (nearSmall)
        if (!ok && !smallBits(r) && nearSmall(x, y, rec => want.has(rec.n))) ok = true;
        test.answer(ok, r); refresh();
      }
      return true;
    }
    const t = cur(), f = m.filter[t.key];
    // tıklanan yapı küçük değilse ve hemen ardında küçük parçalı bir madde (düğüm) varsa o seçilir
    if (!smallBits(r)) { const okr = rec => state.isolate?.has(rec.id) && t.items.some(it => (it.n || []).includes(rec.n)), b = buriedSmall(x, y, okr) || nearSmall(x, y, okr); if (b) return onPick(b.id); }
    // önce süzgeçteki (opak) maddeler, sonra ötekiler
    const hits = t.items.filter(it => (it.n || []).includes(r.n));
    const it = hits.find(h => !f || h.group === f) || hits[0];
    if (it) { m.sel[t.key] = it.key; m.pickedId = null; }
    else m.pickedId = id;
    applyTab(); refresh(); scrollPanel(false);
    return true;
  }
  // boşluğa tıklama (main.js: hiçbir parça isabet etmedi): birkaç piksellik bir düğümün hemen yanıysa o seçilir
  function pickNear(x, y) {
    if (!active || !D || wasExploded) return false;
    const t = m.tab === 'quiz' ? null : cur();
    const b = nearSmall(x, y, rec => (t ? t.items : shownTab().items).some(it => (it.n || []).includes(rec.n)));
    return b ? onPick(b.id, x, y) : false;
  }
  // etiket tıklaması: maddesini seçer (seçiliyse bırakır)
  document.querySelector('#labels')?.addEventListener('click', e => {
    if (!active || !D || m.tab === 'quiz') return;
    const k = e.target.closest('.lbl')?.querySelector('[data-tl]')?.dataset.tl, t = cur();
    if (!k || !t.items.some(i => i.key === k)) return;
    m.sel[t.key] = m.sel[t.key] === k ? null : k; m.pickedId = null; applyTab(); refresh(); scrollPanel(false);
  });
  let wasExploded = false;
  stage.onFrame(() => {
    if (!active || !D) return false;
    const rs = [...(state.isolate || [])].slice(0, 40).map(id => model.items.get(id)).filter(r => r?.mesh);
    const exploded = isExploded(rs);
    if (exploded !== wasExploded) { wasExploded = exploded; labels.hide(exploded); xray.visible = !exploded; }
    // tuval daralıp genişleyince (telefon döndürme, pencere) etiket kümesi yeniden kurulur
    if (m.tab !== 'quiz' && (stage.canvas.clientWidth < 620) !== narrow) applyTab();
    if (!exploded) labels.place();
    return false;
  });

  // --- panel ---
  const details = (head, body) => (body ? `<details class="clinic"><summary>${head}</summary>${body}</details>` : '');
  const field = (k, v) => (v ? `<div class="field"><div class="k">${k}</div><div class="v">${v}</div></div>` : '');
  function itemHTML(t, it) {
    const c = itemColor(t, it), has = trecs(t, it.n).length > 0;
    return `<div class="tsel" style="--c:${hex(c)}">
      <h1 class="name" lang="la">${esc(it.la)}</h1>
      ${it.de ? `<div class="name-de" lang="de">${esc(it.de)}</div>` : ''}
      ${has ? '' : '<p class="htext small">Bu yapı bu bedende ya da modelde yok; yalnız metni var.</p>'}
      ${field('Seviye', it.level_de ? `<span lang="de">${esc(it.level_de)}</span>` : '')}
      ${field(DRAIN.test(it.la || '') ? 'Drenajı' : 'Çıkışı', it.from_la ? `<span lang="la">${esc(it.from_la)}</span>` : '')}
      ${it.tr ? `<p class="htext">${esc(it.tr)}</p>` : ''}
      ${it.tip ? `<div class="tip">${esc(it.tip)}</div>` : ''}
      ${it.clinic_tr ? `<p class="htext tclin"><b>Klinik:</b> ${esc(it.clinic_tr)}</p>` : ''}</div>`;
  }
  // grubun bu bedende (ve sekmenin tarafında) çizilen bir parçası var mı
  const groupHas = (t, g) => t.items.some(it => it.group === g && trecs(t, it.n).length);
  function contentHTML() {
    const t = cur(), f = m.filter[t.key] || null, sel = selItem(t);
    const legend = `<div class="tlegend">${t.groups.map(g => {
      const c = colorOf(t, g.key), none = !groupHas(t, g.key);
      return `<button data-tg="${esc(g.key)}" class="${f === g.key ? 'on' : f ? 'off' : ''}${none ? ' none' : ''}"${none ? ' disabled' : ''} style="--c:${hex(c)}" title="${esc((g.tr || '') + (none ? '\nBu bedende ya da modelde parçası yok' : '\nTıkla: yalnız bu grubu göster'))}">${sw(c)}<span><b lang="la">${esc(g.la)}</b><small lang="de">${esc(g.de || '')}</small>${none ? '<small>(bu bedende yok)</small>' : ''}</span></button>`;
    }).join('')}</div>`;
    const lists = t.groups.map(g => {
      const its = t.items.filter(it => it.group === g.key); if (!its.length) return '';
      return `<div class="tgrp${f && f !== g.key ? ' off' : ''}"><div class="k">${sw(colorOf(t, g.key))}<span lang="la">${esc(g.la)}</span></div>${its.map(it => {
        const has = trecs(t, it.n).length > 0;
        return `<button class="titem${it === sel ? ' on' : ''}" data-ti="${esc(it.key)}" title="${esc(it.de || '')}"><span lang="la">${esc(it.la)}</span>${has ? '' : ' <small>(modelde yok)</small>'}</button>`;
      }).join('')}</div>`;
    }).join('');
    const orphans = t.items.filter(it => !t.groups.some(g => g.key === it.group));
    return `
      <h1 class="name">${esc(t.title_tr || t.key)}</h1>
      ${t.title_de ? `<div class="name-de" lang="de">${esc(t.title_de)}</div>` : ''}
      ${t.intro_tr ? `<p class="htext">${esc(t.intro_tr)}</p>` : ''}
      ${legend}
      ${f ? `<p class="htext small">Süzgeç: yalnız bu grup opak. Kaldırmak için gruba yeniden tıkla.</p>` : ''}
      ${sel ? itemHTML(t, sel) : '<p class="htext small">Bir yapıyı listeden seç ya da 3B görünümde tıkla.</p>'}
      <div class="tlist">${lists}${orphans.length ? `<div class="tgrp">${orphans.map(it => `<button class="titem${it === sel ? ' on' : ''}" data-ti="${esc(it.key)}">${esc(it.la)}</button>`).join('')}</div>` : ''}</div>
      ${details(`Ek bilgiler (${(t.extras || []).length})`, (t.extras || []).map(e => `<p>${e.title_de ? `<b lang="de">${esc(e.title_de)}</b>: ` : ''}${esc(e.tr || '')}</p>`).join(''))}
      ${details(`Klinik (${(t.clinic || []).length})`, (t.clinic || []).map(c => `<p>${c.de ? `<b lang="de">${esc(c.de)}</b>: ` : ''}${esc(c.tr || '')}</p>`).join(''))}
      ${details(`Modelde olmayanlar (${(t.notInModel || []).length})`, (t.notInModel || []).map(x => `<p>${esc(x)}</p>`).join(''))}`;
  }
  const pickedHTML = () => {
    const r = m.pickedId ? model.items.get(m.pickedId) : null; if (!r) return '';
    return `<div class="field tpicked"><div class="k">Tıklanan yapı</div><div class="v"><b lang="la">${esc(titleName(r))}</b>${subtitleName(r) ? ` · <span lang="de">${esc(subtitleName(r))}</span>` : ''}${r.tr ? `<br><small>${esc(r.tr)}</small>` : ''}</div></div>`;
  };
  const tabName = t => t.short_tr || (t.title_tr || t.key).split(/[,(]/)[0].trim();
  const de = () => getLang() === 'de';
  const sceneName = t => (de() ? t.short_de || TAB_DE[t.key] || (t.title_de || '').split(/[,(:]/)[0].trim() || tabName(t) : tabName(t));
  const sceneTitle = t => (de() ? t.title_de || Tin('de', 'tab.' + t.key) || t.title_tr || '' : t.title_tr || '');
  function panelHTML() {
    if (!D || !built) return `<p class="htext">${esc(title)} yükleniyor…</p>`;
    const body = m.tab === 'quiz'
      ? `<div class="seg tiny bview tscene"${langAttr()}>${D.tabs.map(t => `<button data-ts="${esc(t.key)}" class="${m.scene === t.key ? 'active' : ''}" title="${esc(sceneTitle(t))}">${esc(sceneName(t))}</button>`).join('')}</div>${quizOf(tabOf(m.scene) || D.tabs[0]).html()}`
      : contentHTML() + pickedHTML();
    return `
      <div class="chips"><span class="chip tour">${esc(chip)}</span></div>
      <div class="seg small htabs ttabs">${D.tabs.map(t => `<button data-tt="${esc(t.key)}" class="${m.tab === t.key ? 'active' : ''}" title="${esc(t.title_tr || '')}">${esc(tabName(t))}</button>`).join('')}<button data-tt="quiz" class="${m.tab === 'quiz' ? 'active' : ''}">Test</button></div>
      ${body}
      <div class="btns"><button data-ta="exit" title="${esc(title)}ndan çık (Esc)">Moddan çık</button></div>`;
  }
  function click(e) {
    if (m.tab === 'quiz' && quizOf(tabOf(m.scene) || D.tabs[0]).click(e)) return;
    const b = e.target.closest('[data-tt],[data-ta],[data-tg],[data-ti],[data-ts]'); if (!b || b.disabled) return;
    const d = b.dataset;
    // sekme, sahne ve çıkış: bekleyen eski bir istek (yüklenmekte olan sekme) iptal olur
    if (d.ta === 'exit') { cancel?.(); state.isolate = null; refresh(); return; }
    if (d.tt) { if (d.tt !== m.tab) { cancel?.(); enter(d.tt === 'quiz' ? 'quiz:' + (m.tab !== 'quiz' ? m.tab : m.scene || '') : d.tt + (m.sel[d.tt] ? ':' + m.sel[d.tt] : '')); } return; }
    if (d.ts) { if (d.ts !== m.scene) { cancel?.(); enter('quiz:' + d.ts); } return; }
    const t = cur();
    if (d.tg) { m.filter[t.key] = m.filter[t.key] === d.tg ? null : d.tg; m.pickedId = null; applyTab(); refresh(); return; }
    if (d.ti) {
      m.sel[t.key] = m.sel[t.key] === d.ti ? null : d.ti; m.pickedId = null; applyTab(); refresh(); scrollPanel(false);
      // listeden seçilen madde ekranın dışındaysa (uzak bölge: kadın sekmesinde meme) kamera ona döner
      const it = selItem(t), rs = it ? trecs(t, it.n) : [];
      if (rs.length && !isExploded(rs)) {
        const p = anchorFor(t, rs).project(stage.camera);
        if (Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95 || p.z > 1) stage.frameBox(coreBox([rs]).expandByScalar(4), dirOf(t));
      }
    }
  }

  return {
    key, enter, sync, highlight, onPick, pickNear, panelHTML, click,
    // Esc: içerik sekmesinde seçili madde (ya da tıklanan yapı) varsa önce o bırakılır; true: Esc tüketildi
    escape() {
      if (!active || !D || m.tab === 'quiz') return false;
      const t = cur(); if (!m.sel[t.key] && !m.pickedId) return false;
      m.sel[t.key] = null; m.pickedId = null; applyTab(); refresh(); return true;
    },
    isActive: () => active, hideTips: () => active && m.tab === 'quiz',
    cancelPending: () => { if (!active) enterSeq++; },
    // adres çubuğundaki bağlantı için enter() ile aynı biçim
    spec: () => (m.tab === 'quiz' ? 'quiz:' + m.scene : m.tab + (m.sel[m.tab] ? ':' + m.sel[m.tab] : '')),
  };
}
