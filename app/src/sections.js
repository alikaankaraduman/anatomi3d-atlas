// Kesit atlası ve kesit testi (Schnittbildtrainer): uygulamanın kesit aracını bir BT / MR atlası gibi kullanan çalışma modu.
// Veri: public/data/sections.json (tools/sections-build.mjs; kaynak data/work/sections/). Bölgeler (baş-boyun, göğüs,
// karın, pelvis, ekstremite) ve her bölgede kanonik kesit seviyeleri; her seviyede öğrencinin kesit yüzünde tanıması
// gereken yapılar (ask: Latince ve Almanca ad, model parça adları n, etiket noktaları pts, tanıma metni, ipucu) ve bilgi
// soruları (facts).
//
// Bir seviyenin sahnesi (setupLevel, Test sekmesi de kullanır):
//  - bütün sistemler yüklü (defer ile; yüklenirken kısa not) ve kullanıcının katman ayarlarından bağımsız opak çizilir
//    (viewLayers; saydam parçanın kesit yüzü olmaz); kas tutunma yamaları çizilmez (kesicide de yoktular); açma yok,
//    "Dolu" açık; düzlem seviyenin ekseninde ve mutlak yerinde (tools.cut.set({ at })).
//  - Atlas kuralları: aksiyal kesit aşağıdan görülür (kranial kısım kalır; ekranda ventral yukarıda, bedenin solu sağda),
//    sagittal kesit bedenin solundan (sağ yarı kalır), koronal kesit önden (dorsal kısım kalır). Kamera kesite dik bakar ve
//    seviyenin "frame" kutusunu çerçeveler; kullanıcı döndürüp yakınlaştırabilir, "Kesite bak" geri getirir.
//  - Uzuv seviyeleri yalnız "only" parçalarını gösterir. Cinsiyeti olan seviyeler o bedene aittir: pelvis bölgesi o anki
//    bedenin seviyelerini listeler ve beden değişince ikiz seviyeye (-m / -f) geçer.
// Atlas sekmesi: bölge düğmeleri, seviye listesi, Önceki / Sonraki (BT yığınında kaydırır gibi), giriş metni, yapı listesi;
// kesit yüzündeki etiketler (createLabels, işaret çizgili; seçili yapının altında Almanca adı; dar tuvalde numara);
// "Etiketler" düğmesi kendini sınamak için gizler. Seçim (liste, etiket ya da kesit yüzüne tıklama: model.capHit) yapının
// kesit yüzünü (tools.cut.mark) ve parçalarını (parıltı) vurgular, tanıma metni ve ipucu görünür; başka bir kesit yüzüne
// tıklama "Tıklanan yapı" altında o parçanın adını gösterir. "Kesiti kaydır" düzlemi seviyeden 3 cm'ye kadar oynatır
// (etiketler o sırada gizli; "Seviyeye dön").
// Test sekmesi: bölge seçici ("Tümü" ve bölgeler) ve dört soru türü; soru değişince sahne sorunun seviyesine geçer:
//  - "Yapıyı bul": adı verilen yapı kesit yüzünde tıklanır (etiketler gizli); model.capHit maddenin parçalarından birini
//    verirse doğru. Kesit yüzü olmayan bir yere tıklama sayılmaz (yalnız uyarı).
//  - "Bu ne?": maddenin etiket noktalarından birinde kesit yüzünde bir halka atar; dört şık (çeldiriciler aynı seviyenin
//    parçaları örtüşmeyen başka maddeleri).
//  - "Hangi seviye?": seviye başlıksız gösterilir; dört seviye başlığı (aynı bölgeden; pelviste bir bedende üç seviye
//    olduğundan eksik şık komşu bölgeden tamamlanır).
//  - "Bilgi": seviyenin bilgi soruları; cevaptan sonra "show" parçaları parlar.
// Cevaptan sonra açıklama ya da tanıma metni, doğru yapı vurgulu ve etiketli, "Sonraki soru"; sonra kesit yüzüne tıklama
// "Tıklanan yapı"yı gösterir (cevapsız soruda tıklama adları ele vermesin diye yok sayılır). Cevaplar kalıcı ilerlemeye
// yazılır (progress.js): yapı 'x:<seviye>:<madde>', seviye 'xl:<seviye>', bilgi sorusu factId; "Yanlışlarım" düğmesi ve
// "Bilinen X / Y" satırı study.js quizBar ile. Genel "Yanlışlarım" (main.js) bu kimlikleri weakCount ile sayar (veri yüklenince;
// onData) ve yanlış yapı yoksa ya da yapı tekrarı açıkken testi "Yanlışlarım" açık başlatır (enter('test:weak')). Yapılar
// askOf ile okunur: cinsiyetsiz seviyede yalnız bu bedende kesiti olan yapılar, kadında ptsF noktaları. Beden değişince sorusu cinsiyetli seviyede olan
// test yeni soru seçer.
// Mod izole görünümle yaşar: izolasyondan çıkılınca (Esc, "Moddan çık", başka bir mod) kullanıcının kesit ayarları, açma
// oranı ve (main.js) katmanları geri gelir.
import * as THREE from 'three';
import { titleName, subtitleName, esc, SEX, SYS_ORDER } from './text.js';
import { isExploded, createLabels, quizBar, weakEmpty, factHTML, resHTML, shuffle } from './study.js';
import { T, langAttr, shortText, getLang, tipLang } from './testlang.js';
import { record, weak, stats, pickWeighted, factId, weakIds, onChange } from './progress.js';

const NARROW = 620;      // px: görünür tuval (paneller düşülünce) bundan darsa yapı etiketleri numaradır (seçili olan tam adla)
const NARROW_H = 420;    // px: görünür tuval bundan alçaksa da (telefonda alt panel açıkken) numara
const DENSE = 22, DENSE_W = 900;   // bundan çok etiketli seviyede (baş) görünür tuval 900 px'den darsa da numara
const MAX_OFF = 3;       // cm: "Kesiti kaydır" sınırı
const short = (s, n = 24) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
// kamera yönü (hedeften kameraya) ve kesilen yan: aksiyal aşağıdan (alt yan kesilir), sagittal soldan (sol yarı kesilir),
// koronal önden (ön yan kesilir). Aksiyalde z'deki küçük pay, ekranın üstünü ventral yapar (stage.frameBox ve OrbitControls).
const VIEW = { y: [0, -1, 1e-4], x: [1, 0, 0], z: [0, 0, 1] };
const FLIP = { y: true, x: false, z: false };

export function createSections({ stage, model, state, refresh, defer, cancel, viewLayers, endStudy, setSex, ui, tools, onData }) {
  let D = null, loading = null, enterSeq = 0, active = false;
  // tab: 'atlas' | 'test'; level: seviye anahtarı; sel: seçili yapı anahtarı; picked: tıklanan (madde olmayan) parça;
  // labels: etiketler açık mı; off: düzlemin seviyeden kayması (cm); away: kullanıcı sol panelden düzlemi oynattı
  const m = { tab: 'atlas', region: null, level: null, sel: null, picked: null, labels: true, off: 0, away: false, sex: null };
  // Test: region 'all' | bölge; mode 'find' | 'name' | 'level' | 'facts'; cur: o anki soru; last: önceki (tekrar gelmesin)
  const z = { region: 'all', mode: 'find', cur: null, score: [0, 0], weakOnly: false, last: null };
  const labels = createLabels(stage);
  const labelEl = document.getElementById('labels');

  const load = () => loading ||= fetch('data/sections.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { if (!Array.isArray(j?.regions) || !j.regions.length) throw new Error('bölge yok'); D = j; })
    .catch(e => { loading = null; console.warn('Kesit atlası verisi yüklenemedi:', e); ui?.notify?.('Kesit atlası verisi yüklenemedi'); throw e; });

  // --- veri erişimi ---
  const regionOf = k => D.regions.find(r => r.key === k);
  const regionOfLevel = k => D.regions.find(r => r.levels.some(l => l.key === k));
  const findLevel = k => { for (const r of D.regions) { const l = r.levels.find(x => x.key === k); if (l) return l; } return null; };
  // bölgenin bu bedende geçerli seviyeleri (cinsiyetli seviyeler yalnız kendi bedeninde)
  const levelsOf = (reg, sex = state.sex) => (regionOf(reg)?.levels || []).filter(l => !l.sex || l.sex === sex);
  // öteki bedenin ikiz seviyesi (anahtar -m / -f ile biter)
  const twinOf = (L, sex) => (L.sex && L.sex !== sex ? findLevel(L.key.replace(/-[mf]$/, '-' + sex)) : null);
  const cur = () => findLevel(m.level);
  // seviyenin bu bedende sorulabilen yapıları: x (yalnız o bedende kesiti olan yapı) süzülür, kadın bedeninde ayrı
  // noktaları olan yapıda (ptsF) noktalar onlardır. Beden başına önbellekte: nesne kimlikleri (şıklar, havuz) sabit kalır.
  const askCache = new Map();
  function askOf(L, sex = state.sex) {
    const k = sex + ':' + L.key;
    if (!askCache.has(k)) askCache.set(k, L.ask.filter(a => !a.x || a.x === sex).map(a => (sex === 'f' && a.ptsF ? { ...a, pts: a.ptsF } : a)));
    return askCache.get(k);
  }
  const itemOf = (L, r) => (r ? askOf(L).find(a => a.n.includes(r.n)) : null) || null;
  const selItem = L => (L ? askOf(L) : []).find(a => a.key === m.sel) || null;
  let byName = null;
  const recsOf = names => {
    if (!byName) { byName = new Map(); for (const r of model.list) { if (!byName.has(r.n)) byName.set(r.n, []); byName.get(r.n).push(r); } }
    return names.flatMap(n => byName.get(n) || []).filter(r => r.mesh && (!r.x || r.x === state.sex) && state.isolate?.has(r.id));
  };

  // --- sahne (Test sekmesi de kullanır) ---
  // seviyenin çizilecek parçaları: uzuvda yalnız "only", gövdede bu bedenin bütün parçaları (tutunma yamaları hariç)
  function sceneIds(L) {
    if (L.only) return new Set(L.only.filter(id => { const r = model.items.get(id); return r?.mesh && (!r.x || r.x === state.sex); }));
    return new Set(model.list.filter(r => r.mesh && (!r.x || r.x === state.sex) && r.sub !== 'attach').map(r => r.id));
  }
  const dirOf = L => new THREE.Vector3(...VIEW[L.axis]).normalize();
  // düzlemin korunan yana bakan birim vektörü (etiketler düzlemin bu yanında, az önde durur)
  const keptDir = L => { const v = new THREE.Vector3(); v[L.axis] = FLIP[L.axis] ? 1 : -1; return v; };
  function frameBoxOf(L) {
    // biraz pay: kesitin çevresindeki (düzlemin ardında kalan) yüzeyler de görünsün
    const c = new THREE.Vector3(...L.frame.c), h = new THREE.Vector3(...L.frame.h).multiplyScalar(1.15);
    return new THREE.Box3(c.clone().sub(h), c.clone().add(h));
  }
  // kamerayı seviyenin kesitine dik getir ve çerçevele
  function frameLevel(L = cur()) { if (L) stage.frameBox(frameBoxOf(L), dirOf(L)); }
  // Seviyenin sahnesini kur: izolasyon, düzlem (seviye + kayma), Dolu açık. Görünür katmanlar ve açma enter'da ayarlanır.
  let isoSet = null;   // modun kurduğu izolasyon kümesi (çıkışta tanımak için)
  function setupLevel(L, off = 0) {
    state.isolate = isoSet = sceneIds(L);
    state.isoGhost = null;
    model.overrides.clear();
    tools.cut.set({ axis: L.axis, at: L.pos + off, flip: FLIP[L.axis], cap: true });
  }
  // düzlem seviyede mi (kaydırılmadı, kullanıcı sol panelden oynatmadı)
  const onLevel = () => !m.off && !m.away;
  // Kesit yüzündeki etiketler: her etiket noktası için bir etiket (eşli yapıda iki); etiket kendi noktasından çerçevenin
  // merkezine göre biraz dışarıda durur, ince çizgiyle noktaya bağlanır. opts: sel (seçili yapı anahtarı), narrow (numara),
  // only (yalnız bu yapı anahtarları), cls (ek sınıf)
  function labelList(L, { sel = null, narrow = false, only = null } = {}) {
    const c = new THREE.Vector3(...L.frame.c), lift = keptDir(L).multiplyScalar(0.03);
    const k = 0.1 * Math.max(...L.frame.h);
    const out = [];
    askOf(L).forEach((a, i) => {
      if (only && !only.includes(a.key)) return;
      const on = a.key === sel;
      for (const p0 of a.pts) {
        const at = new THREE.Vector3(...p0).add(lift);
        const d = at.clone().sub(c); d.setComponent('xyz'.indexOf(L.axis), 0);
        const p = d.lengthSq() > 1e-6 ? at.clone().addScaledVector(d.normalize(), k) : at.clone();
        const text = on ? `<span data-xl="${esc(a.key)}" lang="la">${esc(a.la)}${a.de ? `<br><small lang="de">${esc(a.de)}</small>` : ''}</span>`
          : narrow ? `<span data-xl="${esc(a.key)}">${i + 1}</span>` : `<span data-xl="${esc(a.key)}" lang="la">${esc(short(a.la))}</span>`;
        out.push({ text, p, at, cls: 'xpick ' + (on ? 'on' : narrow ? 'num' : 'dimlbl') });
      }
    });
    return out;
  }
  // ekran noktasının altındaki kesit yüzünün parçası (yoksa null)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function capAt(x, y) {
    const rect = stage.canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    return model.capHit?.(ray.ray)?.rec || null;
  }

  // --- görünüm ---
  let narrow = false;
  // görünür tuval alanı: alt panel (telefon) ya da yan paneller düşülür
  const isNarrow = () => {
    const c = stage.canvas, ins = stage.insets?.() || { l: 0, r: 0, t: 0, b: 0 }, w = c.clientWidth - ins.l - ins.r;
    const L = cur(), dense = L && askOf(L).reduce((n, a) => n + a.pts.length, 0) > DENSE;
    return w < (dense ? DENSE_W : NARROW) || c.clientHeight - ins.t - ins.b < NARROW_H;
  };
  function applyLabels() {
    const L = cur(); narrow = isNarrow();
    labels.set(!L ? [] : m.tab === 'test' ? testLabels() : m.labels ? labelList(L, { sel: m.sel, narrow }) : []);
  }
  function showLevel(L, { frame = true } = {}) {
    m.level = L.key; m.region = regionOfLevel(L.key).key;
    m.sel = null; m.picked = null; m.off = 0; m.away = false;
    setupLevel(L);
    applyLabels();
    refresh();
    syncHidden();
    if (frame) frameLevel(L);
    const box = document.getElementById('info'); if (box) box.scrollTop = 0;
  }

  // spec: '<seviye>' | '<bölge>' | 'test[:bölge]' | ''
  function enter(spec) {
    const seq = ++enterSeq;
    if (!D) { load().then(() => { if (seq === enterSeq) enter(spec); }, () => {}); return; }
    const s = String(spec || ''), i = s.indexOf(':'), head = i < 0 ? s : s.slice(0, i), sub = i < 0 ? '' : s.slice(i + 1);
    const tab = head === 'test' ? 'test' : 'atlas';
    if (tab === 'test') {
      // 'test:weak': genel "Yanlışlarım"dan gelindi (bütün bölgeler, yalnız zayıf sorular)
      if (sub === 'weak') {
        z.region = 'all'; z.weakOnly = true; z.cur = null; z.last = null;
        // zayıf sorusu olan ilk soru türü (önce o anki tür)
        const has = k => pool(k).some(x => weak(idOf(x, k)));
        z.mode = [z.mode, ...TYPES].find(has) || z.mode;   // TYPES düz ad dizisi
      }
      else if (sub && (sub === 'all' || regionOf(sub)) && sub !== z.region) { z.region = sub; z.cur = null; }
    }
    let L = tab === 'atlas' ? findLevel(head) : null;
    if (!L) {
      const reg = regionOf(tab === 'test' ? sub : head) ? (tab === 'test' ? sub : head) : m.region || D.regions[0].key;
      L = (cur() && regionOfLevel(m.level).key === reg ? cur() : null) || levelsOf(reg)[0] || regionOf(reg).levels[0];
      // açık bir seviye bağlantısı yoksa kullanıcının seçtiği beden korunur: hatırlanan seviye öteki bedene aitse ikizi
      if (L.sex && L.sex !== state.sex) L = twinOf(L, state.sex) || L;
    }
    // bütün sistemler gerekli: yüklenmemiş olan sırayla beklenir (defer yükleme notunu gösterir)
    const wait = SYS_ORDER.find(x => !model.loaded[x] && !model.failed?.has(x));
    if (wait) { defer(wait, () => { if (seq === enterSeq) enter(spec); }); return; }
    endStudy?.('sect');
    // seviye öteki bedene aitse beden önce değişir (uygulamanın beden düğmesiyle aynı yol)
    const switched = !!(L.sex && L.sex !== state.sex && setSex);
    if (switched) setSex(L.sex);
    if (!active) {
      tools.cut.save();          // kullanıcının kesiti ve açma oranı, çıkınca geri gelir
      tools.setExplode(0);
      m.labels = true;
    }
    active = true; m.tab = tab; m.sex = state.sex;
    state.selected = new Set(); state.primary = { type: 'sect' };
    viewLayers(Object.fromEntries(SYS_ORDER.filter(x => !model.failed?.has(x)).map(x => [x, 'show'])));
    if (tab === 'test') { if (!z.cur) nextQ(false); showQ({ force: true }); refresh(); toQuestion(); }
    else showLevel(L);
    if (switched) ui?.notify?.(`${SEX[L.sex].label} modele geçildi`);
  }
  function cleanup() {
    active = false; enterSeq++;
    z.cur = null;   // yarım kalan soru sayılmaz; dönünce yeni soru
    labels.set([]); labels.hide(false);
    tools.cut.mark(null);
    tools.cut.restore();
    // Mod bir seçimle bittiyse (arama, ağaç: selectItem izolasyonu seçilen parçayı içerdiği için korur) modun bütün beden
    // izolasyonu da biter: refresh kullanıcının katmanlarını geri koyar. Başka bir modun kurduğu küme (başka nesne) kalır.
    if (state.isolate && state.isolate === isoSet) { state.isolate = null; state.isoGhost = null; }
    isoSet = null;
  }
  // Ana yenilemeden önce: mod bittiyse temizle (kesit ve açma geri gelir); beden değiştiyse ikiz seviyeye geç
  function sync() {
    if (!active) return;
    if (state.primary?.type !== 'sect') { cleanup(); return; }
    if (m.sex !== state.sex) {
      m.sex = state.sex;
      const L = cur(), T = L && twinOf(L, state.sex);
      if (T) { m.level = T.key; m.sel = null; }
      m.picked = null; m.away = false;   // düzlem aşağıda seviyeye (ve kaydırma payına) yeniden konur
      // testte sorusu cinsiyetli seviyede, yalnız öbür bedende olan bir yapıda ya da noktaları bedene göre değişen bir yapıda
      // ise yeni soru (bu bedenin havuzundan); sahne showQ ile kurulur
      const a = z.cur?.a;
      if (m.tab === 'test' && z.cur && ((z.cur.L.sex && z.cur.L.sex !== state.sex) || (a?.x && a.x !== state.sex) || a?.ptsF)) { z.cur = null; nextQ(false); showQ({ force: true }); return; }
      setupLevel(cur(), m.off);
      applyLabels();
    }
  }
  function highlight() {
    if (!active || !D) return [];
    const L = cur(), it = m.tab === 'atlas' ? selItem(L) : null;
    let rs = it ? recsOf(it.n) : m.tab === 'test' ? recsOf(testShown()) : [];
    // testte yanlış tıklanan parça vurgulanmaz (yalnız "Tıklanan yapı" satırında): doğru yapı tek başına parlasın
    const wrong = m.tab === 'test' && z.cur?.answer && !z.cur.answer.ok && z.cur.answer.pid === m.picked;
    const picked = m.picked && !wrong ? model.items.get(m.picked) : null;
    if (picked?.mesh && picked.vis) rs = rs.concat([picked]);
    tools.cut.mark(rs.length ? new Set(rs.map(r => r.id)) : null);
    return rs.filter(r => r.vis && r.mesh).map(r => r.mesh);
  }
  // 3B tıklama: kesit yüzündeyse o parça (maddeyse madde seçilir), değilse tıklanan yüzey; test sekmesinde şimdilik yok sayılır
  function onPick(id, x, y) {
    if (!active || !D) return false;
    if (m.tab === 'test') return testPick(id, x, y);
    const L = cur(), r = (x !== undefined ? capAt(x, y) : null) || model.items.get(id);
    const it = onLevel() ? itemOf(L, r) : null;
    if (it) { m.sel = it.key; m.picked = null; } else { m.picked = r?.id || null; }
    applyLabels(); refresh(); scrollSel();
    return true;
  }
  const scrollSel = () => document.getElementById('info')?.querySelector('.xsel')?.scrollIntoView({ block: 'nearest' });

  // etiket tıklaması (etiketler xpick sınıfıyla tıklanabilir)
  labelEl?.addEventListener('click', e => {
    if (!active || m.tab !== 'atlas') return;
    const k = e.target.closest('.lbl')?.querySelector('[data-xl]')?.dataset.xl; if (!k) return;
    m.sel = m.sel === k ? null : k; m.picked = null; applyLabels(); refresh(); scrollSel();
  });
  // kullanıcı sol panelden düzlemi oynattı ya da çevirdi: etiketler gizlenir, "Seviyeye dön" belirir; yalnız "Dolu"
  // değiştiyse düzlem seviyede kalır (panel yenilenir)
  tools.cut.onUser(kind => { if (!active) return; if (kind !== 'cap') m.away = true; syncHidden(); refresh(); });
  // "Kesiti kaydır": sürüklerken yalnız düzlem ve değer değişir (panel yeniden çizilmez), bırakınca panel yenilenir
  document.addEventListener('input', e => {
    if (!active || e.target?.id !== 'sect-off') return;
    const L = cur(); if (!L) return;
    m.off = Math.max(-MAX_OFF, Math.min(MAX_OFF, +e.target.value / 10)); m.away = false;
    tools.cut.set({ axis: L.axis, at: L.pos + m.off, flip: FLIP[L.axis] });
    syncHidden();
    const v = document.getElementById('sect-off-v'); if (v) v.textContent = offText();
  });
  document.addEventListener('change', e => { if (active && e.target?.id === 'sect-off') { e.target.blur(); refresh(); } });
  const offText = () => (m.off ? `${m.off > 0 ? '+' : '−'}${Math.abs(m.off).toFixed(1).replace('.', ',')} cm` : 'seviyede');

  // etiketler düzlem seviyede değilken ya da parçalarına ayrılmışken gizli
  let wasHidden = null;
  function syncHidden() {
    const rs = [...(state.isolate || [])].slice(0, 40).map(id => model.items.get(id)).filter(r => r?.mesh);
    const hidden = !onLevel() || isExploded(rs);
    if (hidden !== wasHidden) { wasHidden = hidden; labels.hide(hidden); }
    return hidden;
  }
  stage.onFrame(() => {
    if (!active || !D) return false;
    const L = cur(); if (!L) return false;
    const hidden = syncHidden();
    if (isNarrow() !== narrow) applyLabels();
    if (!hidden) labels.place();
    return false;
  });

  // --- Test ---
  const TYPES = ['find', 'name', 'level', 'facts'];   // adları test dilinde: T('sx.<tür>')
  const testLevels = () => (z.region === 'all' ? D.regions.flatMap(r => levelsOf(r.key)) : levelsOf(z.region));
  // havuz öğeleri kalıcı nesnelerdir (pickWeighted'ın "öncekini tekrar seçme" karşılaştırması kimlikle)
  const qCache = new Map();
  const qOf = (k, mk) => { if (!qCache.has(k)) qCache.set(k, mk()); return qCache.get(k); };
  function pool(mode = z.mode) {
    const ls = testLevels();
    if (mode === 'level') return ls;
    if (mode === 'facts') return ls.flatMap(L => L.facts.map((f, i) => qOf(`f:${L.key}:${i}`, () => ({ L, f, id: factId(f.q) }))));
    return ls.flatMap(L => askOf(L).map(a => qOf(`a:${state.sex}:${L.key}:${a.key}`, () => ({ L, a }))));
  }
  const idOf = (x, mode = z.mode) => (mode === 'level' ? 'xl:' + x.key : mode === 'facts' ? x.id : `x:${x.L.key}:${x.a.key}`);
  const curId = c => (c.kind === 'level' ? 'xl:' + c.L.key : c.kind === 'facts' ? factId(c.f.q) : `x:${c.L.key}:${c.a.key}`);
  // "Hangi seviye?" çeldiricileri: aynı bölgenin (bu bedendeki) öteki seviyeleri; yetmezse komşu bölgelerden
  function levelOpts(L) {
    const regs = D.regions, ri = regs.findIndex(r => r.levels.includes(L));
    const out = shuffle(levelsOf(regs[ri].key).filter(l => l !== L)).slice(0, 3);
    for (let d = 1; out.length < 3 && d < regs.length; d++) {
      for (const j of [ri - d, ri + d]) if (regs[j] && out.length < 3) out.push(...shuffle(levelsOf(regs[j].key)).slice(0, 3 - out.length));
    }
    return shuffle([L, ...out]);
  }
  function nextQ(render = true) {
    const p = pool(), cand = z.weakOnly ? p.filter(x => weak(idOf(x))) : p;
    m.picked = null;
    if (!cand.length) z.cur = null;
    else {
      const x = pickWeighted(cand, x2 => idOf(x2), z.last); z.last = x;
      if (z.mode === 'level') z.cur = { kind: 'level', L: x, opts: levelOpts(x), answer: null };
      else if (z.mode === 'facts') z.cur = { kind: 'facts', L: x.L, f: x.f, order: shuffle(x.f.options.map((_, i) => i)), answer: null };
      else {
        const { L, a } = x;
        z.cur = { kind: z.mode, L, a, answer: null };
        if (z.mode === 'name') {
          const ok = o => o !== a && !o.n.some(n => a.n.includes(n));
          z.cur.opts = shuffle([a, ...shuffle(askOf(L).filter(ok)).slice(0, 3)]);
          z.cur.pt = a.pts[Math.floor(Math.random() * a.pts.length)];
        }
      }
    }
    if (render) { showQ(); refresh(); toQuestion(); }
  }
  // telefonda (alt panel) panelin üst kısmını bölge ve tür düğmeleri doldurur: yeni soruda panel puan satırına kayar
  const SHEET = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  function toQuestion() {
    if (!SHEET?.matches) return;
    requestAnimationFrame(() => {
      const box = document.getElementById('info'), q = box?.querySelector('.qbar');
      if (box && q) box.scrollTop += q.getBoundingClientRect().top - box.getBoundingClientRect().top - 4;
    });
  }
  // telefonda cevaptan sonra sonuç ve "Sonraki soru" alt panelin görünür kısmına kaydırılır
  function toResult() {
    if (!SHEET?.matches) return;
    requestAnimationFrame(() => {
      const box = document.getElementById('info'), q = box?.querySelector('.qres'), nx = box?.querySelector('.qnext');
      if (!box || !q) return;
      const b = box.getBoundingClientRect(), top = q.getBoundingClientRect().top, bot = (nx || q).getBoundingClientRect().bottom;
      // sonuçtan düğmeye kadar sığıyorsa düğme alta, sığmıyorsa sonuç üste gelir
      box.scrollTop += bot - top < b.height - 8 ? Math.max(0, bot - b.bottom + 8) : top - b.top - 4;
    });
  }
  // sahneyi sorunun seviyesine getir (seviye aynıysa ve düzlem yerindeyse kamera yerinde kalır)
  function showQ({ force = false } = {}) {
    const L = z.cur?.L || cur(); if (!L) return;
    const moved = L.key !== m.level;
    if (moved || force || !onLevel()) {
      m.level = L.key; m.region = regionOfLevel(L.key).key; m.sel = null; m.off = 0; m.away = false;
      setupLevel(L);
      if (moved || force) frameLevel(L);
    }
    syncHidden();
    applyLabels();
    const box = document.getElementById('info'); if (box && moved) box.scrollTop = 0;
  }
  // bilgi sorusunun ilgili parçalarıyla örtüşen maddeler (cevaptan sonra etiketlenir)
  const factItems = c => askOf(c.L).filter(a => a.n.some(n => (c.f.show || []).includes(n))).map(a => a.key);
  // cevaptan sonra parlayan parçaların adları
  function testShown() {
    const c = z.cur; if (!c?.answer) return [];
    if (c.kind === 'facts') return c.f.show || [];
    if (c.kind === 'level') return [];
    return c.a.n;
  }
  function testLabels() {
    const c = z.cur; if (!c || c.L.key !== m.level) return [];
    const plain = l => ({ ...l, cls: l.cls.replace('xpick ', '') });   // testte etiketler tıklanmaz
    if (!c.answer) {
      if (c.kind !== 'name') return [];
      const p = new THREE.Vector3(...c.pt).add(keptDir(c.L).multiplyScalar(0.03));
      return [{ text: '<span class="xring"></span>', p, cls: 'xmark' }];
    }
    if (c.kind === 'level') return labelList(c.L, { narrow }).map(plain);
    if (c.kind === 'facts') { const only = factItems(c); return only.length ? labelList(c.L, { only, narrow }).map(plain) : []; }
    return labelList(c.L, { sel: c.a.key, only: [c.a.key] }).map(plain);
  }
  function answer(ok, extra = {}) {
    const c = z.cur; if (!c || c.answer) return;
    c.answer = { ok, ...extra };
    z.score[1]++; if (ok) z.score[0]++;
    record(curId(c), ok);
    applyLabels(); refresh();
    toResult();
  }
  function testPick(id, x, y) {
    const c = z.cur, r = x !== undefined ? capAt(x, y) : null;
    if (c && !c.answer) {
      if (c.kind !== 'find') return true;   // şıklı soruda tıklama adı ele vermesin
      if (!onLevel()) { ui?.notify?.(T('sx.offLevel')); return true; }
      if (!r) { ui?.notify?.(T('sx.clickCap')); return true; }
      const ok = c.a.n.includes(r.n);
      m.picked = ok ? null : r.id;
      answer(ok, { picked: titleName(r), pid: r.id });
      return true;
    }
    // cevaplanmış soruda (ya da soru yokken) tıklanan kesit yüzünün adı görünür
    const rr = r || model.items.get(id);
    m.picked = rr?.id || null; refresh();
    return true;
  }
  function testClick(d) {
    const c = z.cur;
    if (d.yr) { if (d.yr !== z.region) { z.region = d.yr; z.cur = null; z.last = null; nextQ(); } return; }
    if (d.ym) { if (d.ym !== z.mode) { z.mode = d.ym; z.cur = null; z.last = null; nextQ(); } return; }
    if (d.yw) { z.weakOnly = !z.weakOnly; nextQ(); return; }
    if (d.yo !== undefined) {
      if (!c || c.answer) return;
      const i = +d.yo;
      if (c.kind === 'facts') return answer(i === 0, { pick: i });
      const o = c.opts[i];
      return answer(c.kind === 'level' ? o === c.L : o === c.a, { pick: o });
    }
    if (d.ya === 'next') return nextQ();
    if (d.ya === 'view') return frameLevel();
    if (d.ya === 'back') { showQ(); refresh(); }
  }
  // ilerleme dışarıdan değişirse (sıfırlama, başka sekme) "Yanlışlarım" açıkken bekleyen soru artık zayıf olmayabilir
  onChange(() => {
    const c = z.cur;
    if (active && m.tab === 'test' && z.weakOnly && c && !c.answer && !weak(curId(c))) { nextQ(false); showQ(); }
  });
  // Genel "Yanlışlarım" için: kesit testinin zayıf soruları (veri yüklüyse yalnız bu bedende sorulabilenler)
  // Veri yüklenmeden sayılamaz (hangi kimlik bu bedende sorulur, hangi f: kimliği kesit sorusu): 0 döner; kesit kimliği
  // (ya da bir bilgi sorusu kimliği) zayıfsa veri hemen arka planda yüklenir ve onData ile sayı yenilenir.
  // İkiz pelvis seviyeleri aynı bilgi sorularını paylaşır: kimlik -> seviyeler kümesi.
  let factIds = null, countWait = false;
  function factMap() {
    if (!factIds) {
      factIds = new Map();
      for (const r of D.regions) for (const l of r.levels) for (const f of l.facts) {
        const id = factId(f.q); if (!factIds.has(id)) factIds.set(id, new Set()); factIds.get(id).add(l);
      }
    }
    return factIds;
  }
  // Genel "Yanlışlarım" sayısı için: bu bilgi sorusu kimliği kesit sorusu mu? (veri yüklenmediyse null)
  const isFact = id => (D ? factMap().has(id) : null);
  function weakCount() {
    if (!D) {
      if (!countWait && (weakIds('x:').length || weakIds('xl:').length || weakIds('f:').length)) { countWait = true; load().then(() => onData?.(), () => {}); }
      return 0;
    }
    factMap();
    const ls = new Set(D.regions.flatMap(r => levelsOf(r.key)));
    let n = 0;
    for (const L of ls) {
      if (weak('xl:' + L.key)) n++;
      for (const a of askOf(L)) if (weak(`x:${L.key}:${a.key}`)) n++;
    }
    for (const id of weakIds('f:')) if ([...(factIds.get(id) || [])].some(l => ls.has(l))) n++;
    return n;
  }
  const res = resHTML;
  const nameOpt = (o, cls, i, dis) => `<button class="qopt ${cls}" data-yo="${i}"${dis ? ' disabled' : ''}><b lang="la">${esc(o.la)}</b>${o.de ? `<small lang="de">${esc(o.de)}</small>` : ''}</button>`;
  const levelField = L => `<div class="field"><div class="k">${T('sx.level.k')}</div><div class="v" lang="de">${esc(L.title_de)}</div></div>`;
  // cevaptan sonraki tanıma metni ve ipucu test dilinde (Almancası quiz-de.json "texts" içinde; yoksa kaynak metin).
  // İpuçlarının bir kısmı kaynakta zaten Almanca, bir kısmı Türkçe: Almancası bulunmayan ipucunun dili tipLang ile kestirilir.
  const itemText = a => {
    const t = a.tr ? shortText(a.tr) : null, tp = a.tip ? shortText(a.tip) : null;
    return `${t ? `<p class="htext" lang="${t.de ? 'de' : 'tr'}">${esc(t.text)}</p>` : ''}${tp ? `<div class="tip" lang="${tp.de ? 'de' : tipLang(tp.text)}">${esc(tp.text)}</div>` : ''}`;
  };
  // bölge adı test dilinde (Almanca: sabit tablo; tabloda yoksa Türkçe ad)
  const regionNameT = r => (getLang() === 'de' && T('sreg.' + r.key) !== 'sreg.' + r.key ? T('sreg.' + r.key) : regionName(r));
  function testHTML() {
    const c = z.cur, a = c?.answer;
    const ids = pool().map(x => idOf(x)), st = stats(ids);
    let body = '';
    if (!c) body = z.weakOnly && ids.length && !st.weak ? weakEmpty() : `<p class="htext">${T('sx.noQ')}</p>`;
    else if (c.kind === 'find') {
      body = `${levelField(c.L)}<p class="htext">${T('sx.q.find')}</p><h1 class="name" lang="la">${esc(c.a.la)}</h1>${c.a.de ? `<div class="name-de" lang="de">${esc(c.a.de)}</div>` : ''}
        ${a ? res(a.ok, T('sx.badFind', `<span lang="la">${esc(a.picked)}</span>`)) + itemText(c.a) : ''}`;
    } else if (c.kind === 'name') {
      body = `${levelField(c.L)}<p class="htext">${T('sx.q.name')}</p><div class="qopts">${c.opts.map((o, i) =>
        nameOpt(o, a ? (o === c.a ? 'ok' : a.pick === o ? 'bad' : '') : '', i, a)).join('')}</div>
        ${a ? res(a.ok, T('res.bad')) + itemText(c.a) : ''}`;
    } else if (c.kind === 'level') {
      // cevaptan sonra seviyenin adı: Almancada seviye adı ve yüksekliği, Türkçede Türkçe adı ve Almanca yüksekliği
      const after = getLang() === 'de'
        ? `<p class="htext" lang="de">${esc(c.L.title_de)}${c.L.level_de ? ` · ${esc(c.L.level_de)}` : ''}</p>`
        : `<p class="htext">${esc(c.L.title_tr)}${c.L.level_de ? ` · <span lang="de">${esc(c.L.level_de)}</span>` : ''}</p>`;
      body = `<p class="htext">${T('sx.q.level')}</p><div class="qopts">${c.opts.map((o, i) => {
        const cls = a ? (o === c.L ? 'ok' : a.pick === o ? 'bad' : '') : '';
        return `<button class="qopt ${cls}" data-yo="${i}"${a ? ' disabled' : ''}><b lang="de">${esc(o.title_de)}</b></button>`;
      }).join('')}</div>${a ? res(a.ok, T('res.bad')) + after : ''}`;
    } else body = factHTML(c.f, c, 'data-yo', { pre: levelField(c.L) });
    return `<div class="tlbox"${langAttr()}>
      <div class="seg tiny bview xregion">${[['all', T('all'), T('sx.allRegions')], ...D.regions.map(r => [r.key, regionNameT(r), getLang() === 'de' ? regionNameT(r) : r.title_tr])].map(([k, t, ti]) =>
        `<button data-yr="${esc(k)}" class="${z.region === k ? 'active' : ''}" title="${esc(ti)}">${esc(t)}</button>`).join('')}</div>
      <div class="seg tiny qmode xqmode">${TYPES.map(k => `<button data-ym="${k}" class="${z.mode === k ? 'active' : ''}">${T('sx.' + k)}</button>`).join('')}</div>
      ${quizBar({ attr: 'data-yw', on: z.weakOnly, st, score: z.score })}
      ${body}
      ${c && a ? pickedHTML(T('sx.picked')) : ''}
      <div class="xtools">
        ${c ? `<button data-ya="next" class="qnext">${a ? T('next') : T('skip')}</button>` : ''}
        <button data-ya="view" title="${T('sx.view.title')}">${T('sx.view')}</button>
        ${onLevel() ? '' : `<button data-ya="back" title="${T('sx.back.title')}">${T('sx.back')}</button>`}
      </div>
      ${a ? `<p class="htext small">${T('sx.clickHint')}</p>` : ''}</div>`;
  }

  // --- panel ---
  const regionName = r => (r.title_tr || r.key).split(/[(]/)[0].trim();
  function levelNav(L) {
    const list = levelsOf(m.region), i = list.findIndex(l => l.key === L.key);
    return `<div class="stepnav xnav"><button data-xa="prev"${i <= 0 ? ' disabled' : ''} title="Bir önceki seviye">◀ Önceki</button><span>${i + 1} / ${list.length}</span><button data-xa="next"${i < 0 || i >= list.length - 1 ? ' disabled' : ''} title="Bir sonraki seviye">Sonraki ▶</button></div>`;
  }
  function pickedHTML(label = 'Tıklanan yapı') {
    const r = m.picked ? model.items.get(m.picked) : null; if (!r) return '';
    return `<div class="field"><div class="k">${label}</div><div class="v"><b lang="la">${esc(titleName(r))}</b>${subtitleName(r) ? `<br><span lang="de">${esc(subtitleName(r))}</span>` : ''}</div></div>`;
  }
  function atlasHTML(L) {
    const sel = selItem(L);
    const levels = levelsOf(m.region);
    return `
      <div class="seg tiny bview xregion">${D.regions.map(r => `<button data-xr="${esc(r.key)}" class="${m.region === r.key ? 'active' : ''}" title="${esc(r.title_tr)}">${esc(regionName(r))}</button>`).join('')}</div>
      <div class="xlevels">${levels.map(l => `<button class="titem xlevel${l.key === L.key ? ' on' : ''}" data-xv="${esc(l.key)}" title="${esc(l.title_tr)}"><span lang="de">${esc(l.title_de)}</span>${l.level_de ? `<small lang="de">${esc(l.level_de)}</small>` : ''}</button>`).join('')}</div>
      ${levelNav(L)}
      <h1 class="name" lang="de">${esc(L.title_de)}</h1>
      <div class="name-de">${esc(L.title_tr)}</div>
      ${L.level_de ? `<div class="field"><div class="k">Seviye</div><div class="v" lang="de">${esc(L.level_de)}</div></div>` : ''}
      ${L.intro_tr ? `<p class="htext">${esc(L.intro_tr)}</p>` : ''}
      <div class="xtools">
        <button data-xa="labels" class="${m.labels ? 'on' : ''}" aria-pressed="${m.labels}" title="Etiketleri gizle ya da göster (kendini sınamak için gizle)">Etiketler</button>
        <button data-xa="view" title="Kamerayı kesite dik ve seviyeyi çerçeveleyecek şekilde getir">Kesite bak</button>
        ${onLevel() ? '' : '<button data-xa="back" title="Düzlemi seviyenin yerine geri koy">Seviyeye dön</button>'}
      </div>
      <label class="xoff" title="Düzlemi seviyeden 3 cm'ye kadar kaydır: kesitin nasıl değiştiğini gör">Kesiti kaydır <input id="sect-off" type="range" min="-30" max="30" step="1" value="${Math.round(m.off * 10)}"><span id="sect-off-v">${offText()}</span></label>
      ${m.away ? '<p class="htext small">Düzlem sol paneldeki kesit denetimleriyle değiştirildi; etiketler gizli.</p>' : m.off ? '<p class="htext small">Düzlem seviyeden kaydırıldı; etiketler gizli.</p>' : ''}
      ${sel ? `<div class="tsel xsel">
        <h1 class="name" lang="la">${esc(sel.la)}</h1>${sel.de ? `<div class="name-de" lang="de">${esc(sel.de)}</div>` : ''}
        ${sel.tr ? `<p class="htext">${esc(sel.tr)}</p>` : ''}${sel.tip ? `<div class="tip" lang="${tipLang(sel.tip)}">${esc(sel.tip)}</div>` : ''}</div>`
        : '<p class="htext small">Bir yapıyı listeden, etiketinden ya da kesit yüzüne tıklayarak seç.</p>'}
      ${pickedHTML()}
      <div class="tlist xitems">${askOf(L).map((a, i) => `<button class="titem${a === sel ? ' on' : ''}" data-xi="${esc(a.key)}" title="${esc(a.de || '')}"><b class="xn">${i + 1}</b> <span lang="la">${esc(a.la)}</span></button>`).join('')}</div>`;
  }
  function panelHTML() {
    if (!D || !active) return '<p class="htext">Kesit atlası yükleniyor…</p>';
    const L = cur();
    const body = m.tab === 'test' ? testHTML() : atlasHTML(L);
    return `
      <div class="chips"><span class="chip tour">Kesit atlası</span>${m.tab === 'test' ? `<span class="chip"${langAttr()}>${esc(z.region === 'all' ? T('sx.allRegions') : regionNameT(regionOf(z.region)))}</span>` : `<span class="chip">${esc(regionName(regionOf(m.region)))}</span>`}</div>
      <div class="seg small htabs xtabs"><button data-xt="atlas" class="${m.tab === 'atlas' ? 'active' : ''}">Atlas</button><button data-xt="test" class="${m.tab === 'test' ? 'active' : ''}" title="Kesit yüzünde yapı bul, yapıyı adlandır, seviyeyi tanı, bilgi soruları">Test</button></div>
      ${body}
      <div class="btns"><button data-xa="exit" title="Kesit atlasından çık (Esc)">Moddan çık</button></div>`;
  }
  function step(d) {
    const list = levelsOf(m.region), i = list.findIndex(l => l.key === m.level), L = list[i + d];
    if (L) showLevel(L, { frame: true });
  }
  function click(e) {
    const b = e.target.closest('[data-xt],[data-xa],[data-xr],[data-xv],[data-xi],[data-yr],[data-ym],[data-yo],[data-ya],[data-yw]'); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.xa === 'exit') { cancel?.(); state.isolate = null; refresh(); return; }
    if (d.xt) {
      if (d.xt === m.tab) return;
      m.tab = d.xt; m.picked = null;
      if (m.tab === 'test') { if (!z.cur) nextQ(false); showQ({ force: true }); refresh(); toQuestion(); }
      else { const L = cur(); if (L) showLevel(L, { frame: false }); }
      return;
    }
    if (m.tab === 'test') return testClick(d);
    if (d.xr) { if (d.xr !== m.region) { const L = levelsOf(d.xr)[0]; if (L) showLevel(L); } return; }
    if (d.xv) { if (d.xv !== m.level) { const L = findLevel(d.xv); if (L) showLevel(L); } return; }
    if (d.xa === 'prev') return step(-1);
    if (d.xa === 'next') return step(1);
    if (d.xa === 'view') return frameLevel();
    if (d.xa === 'labels') { m.labels = !m.labels; applyLabels(); refresh(); return; }
    if (d.xa === 'back') { const L = cur(); m.off = 0; m.away = false; tools.cut.set({ axis: L.axis, at: L.pos, flip: FLIP[L.axis], cap: true }); syncHidden(); refresh(); return; }
    if (d.xi) { m.sel = m.sel === d.xi ? null : d.xi; m.picked = null; applyLabels(); refresh(); scrollSel(); }
  }

  return {
    key: 'sect', enter, sync, highlight, onPick, panelHTML, click,
    isActive: () => active,
    // yapının adı balonda görünmesin: testte ve etiketler kendini sınamak için gizliyken
    hideTips: () => active && (m.tab !== 'atlas' || !m.labels),
    cancelPending: () => { if (!active) enterSeq++; },
    spec: () => (m.tab === 'test' ? 'test' + (z.region !== 'all' ? ':' + z.region : '') : m.level || ''),
    weakCount, isFact, z,
    // Test sekmesi ve hata ayıklama için yeniden kullanılabilir parçalar
    get data() { return D; }, m, levelsOf, findLevel, twinOf, itemOf, setupLevel, frameLevel, labelList, capAt, labels, recsOf, onLevel,
  };
}
