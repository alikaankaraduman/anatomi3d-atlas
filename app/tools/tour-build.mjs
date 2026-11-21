// Genel çalışma turu derleyicisi (Situs ve sonraki turlar: göğüs, ürogenital, baş-boyun ...). Her tur bir klasördeki
// sekme dosyalarından (content-<sekme>.verified.json; tek şema: src/tour.js ve aşağıdaki denetimler) tek bir public/data/<tur>.json
// üretir. Uygulamadaki motor (src/tour.js) yalnız bu dosyayı okur; bir tur eklemek için aşağıdaki TOURS tablosuna bir
// satır ve src/main.js'deki TOURS listesine bir satır yeter.
// Denetimler: model parça adları meta.json'a karşı (bilinmeyenler atlanır ve listelenir; çıkış kodu 1), soruların dört
// ayrı şıkkı, parçasız maddeler, parçaları başka maddeyle örtüşen maddeler, madde parçası olan bağlam parçaları (bağlamdan
// çıkarılır).
// Çalıştırma (app/ içinde): node tools/tour-build.mjs [tur ...]   (tur verilmezse hepsi)
import fs from 'node:fs';

const TOURS = {
  situs: { dir: '../data/work/situs', tabs: ['arteries', 'portal', 'peritoneum', 'liver'], out: 'public/data/situs.json', title: 'Situs' },
  thorax: { dir: '../data/work/tours/thorax', tabs: ['larynx', 'lung', 'pleura', 'mediastinum'], out: 'public/data/thorax.json', title: 'Göğüs ve solunum' },
  uro: { dir: '../data/work/tours/uro', tabs: ['kidney', 'male', 'female', 'pelvis'], out: 'public/data/uro.json', title: 'Ürogenital' },
  head: { dir: '../data/work/tours/head', tabs: ['orbita', 'ear', 'mouth', 'neck'], out: 'public/data/head.json', title: 'Baş-boyun' },
  vessels: { dir: '../data/work/tours/vessels', tabs: ['armart', 'armven', 'legart', 'legven'], out: 'public/data/vessels.json', title: 'Ekstremite damarları' },
  lymph: { dir: '../data/work/tours/lymph', tabs: ['organs', 'headneck', 'trunk', 'pelvisleg'], out: 'public/data/lymph.json', title: 'Lenf sistemi' },
};

// Sahne denetiminde bulunan veri düzeltmeleri (denetlenmiş içerik dosyalarına dokunulmaz): tur -> sekme -> düzeltme.
// Alanlar: view / side / sex / shell / noshell / frame (sekmenin alanını değiştirir; null siler). shell: motorun
// kendiliğinden bulamadığı, yarı saydam çizilecek örten madde ya da grup anahtarları; noshell: motorun örten saydığı ama
// opak kalması gereken madde ya da grup anahtarları (true: hiçbiri örten değil); frame: kameranın çerçeveleyeceği grup
// anahtarları (iki uzak bölgeli ya da uzun yapılı sekmeler); frameAll: true kamera maddelerin hepsini kırpmadan alır (uzuv
// sekmeleri; side verilmiş sekmelerde motor bunu kendiliğinden yapar). dropContext: bağlamdan çıkarılacak parça adları ya da
// /düzenli ifadeler/; addContext: eklenecek adlar. title_tr: sekme adı (dil düzeltmesi); note: madde anahtarı -> maddenin
// metnine eklenecek cümle (modeldeki konumun metinden ayrıldığı yerler).
const PATCH = {
  situs: {
    // portal sekmesi: kava grubu (azygos göğse, epigastrik ve iç iliak damarlar) çerçeveyi şişiriyordu
    portal: { frame: ['stamm', 'magen', 'darm'] },
    // Peritoneum: kolonların hepsi opak (inen kolon tek başına saydam görünüyordu)
    peritoneum: { noshell: ['colon_descendens'] },
    // karaciğer segmentleri yüzeyi döşer: hiçbiri saydam olmasın (IV saydam olunca I önde görünüyordu)
    liver: { noshell: true },
  },
  thorax: {
    // Solunum: kamera diyafram ve göğüs kafesine; karın duvarı kasları saydam, diyafram opak (karın duvarının ardında kalmasın)
    pleura: { frame: ['zf', 'insp'], shell: ['rectus_abd', 'obl_ext', 'obl_int', 'transv_abd'], noshell: ['diaphragma'] },
  },
  uro: {
    // erkek: kamera dış genital organlara ve bezlere (lomber lenf düğümleri ve uzun damarlar sahneyi küçültüyordu)
    male: { frame: ['hoden', 'druesen', 'penis'] },
    // pelvis organları ile meme ve aksiller lenf düğümleri tek sekmede: kamera pelvise
    female: { frame: ['ovar', 'uterus', 'vulva', 'halte', 'gefaesse'] },
    // pelvis: dizlere inen sinirler çerçeveyi büyütüyordu; pelvis tabanı önden kenarından görünüyordu: yukarıdan
    pelvis: { frame: ['diaphragma', 'damm', 'wand'], view: 'above' },
  },
  head: {
    // sinus cavernosus III, IV, VI ve ICA'yı; sklera ve kornea iris ve lensi; retina camsı cismi örter
    orbita: { shell: ['sinus_cavernosus', 'sclera', 'cornea', 'retina'] },
    // mimik kasları ve platysma (N. facialis'in hedefleri) kulağı küçültüyordu: kamera temporal kemik ve içindekilere;
    // bu kaslar saydam (kesilmiş büyük mor kütleler kulağı örtmesin)
    ear: { frame: ['ohr', 'ossicula', 'kerne', 'felsen', 'temporale'], shell: ['extra'] },
  },
  vessels: {
    // modelin "Brachial nodes" parçası omuz hizasında (humerus başının önü) çizilmiş; metin üst koldaki yeri anlatır
    armven: { note: { nl_brach: 'Modelde bu düğüm grubu omuz hizasında, humerus başının önünde çizilmiştir; gerçekte üst kolda A. brachialis ve Vv. brachiales boyunca dizilir.' } },
  },
  lymph: {
    organs: { title_tr: 'Lenf organları' },
    // pelvis ve bacak: maddelerin çoğu iliak, sakral ve inguinal düğümler; bütün bacak çerçevelenince pelvis küçücük
    // kalıyordu: kamera pelvis ve kasığa (diz ve baldırdaki düğümler seçilince ya da sorulunca kamera onları da alır)
    pelvisleg: { frame: ['communes', 'externi', 'interni', 'ing_sup', 'ing_prof'] },
    // boyun: yol gösterici yapılar (V. jugularis interna ve externa, SCM, omohyoideus, N. accessorius) opak ve iri
    // camgöbeği tüplerdi, derin boyun zincirinin düğümlerini örtüyordu: yarı saydam (düğümler önde kalsın); soldan
    // bakılan boyunda yalnız sol taraf (sağ taraftaki düğümler saydam yapıların ardından ikinci kez görünüyordu); kamera
    // düğüm gruplarına (side tek başına bütün maddeleri, göğse inen Ductus thoracicus dahil, çerçeveletirdi)
    headneck: { shell: ['land'], side: 'l', frame: ['ring', 'face', 'superf', 'ant', 'deep', 'supra'] },
  },
};

const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const names = new Set(meta.items.map(i => i.n));
const VIEWS = new Set(['front', 'back', 'left', 'right', 'above', 'below']);
// boş alanlar yazılmaz
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map(k => [k, o[k]]));

// shell / noshell: madde ya da grup anahtarları (bilinmeyenler atlanır); noshell true kalır
const keysOf = (C, f) => {
  if (C[f] === true) return { [f]: true };
  const ks = Array.isArray(C[f]) ? C[f].filter(k => (C.items || []).some(i => i.key === k) || (C.groups || []).some(g => g.key === k)) : [];
  return ks.length ? { [f]: ks } : {};
};

function buildTour(key, T) {
  const bad = new Set(), warn = [], missing = [];
  const ok = (where, list) => [...new Set(list || [])].filter(n => { if (names.has(n)) return true; bad.add(`${where}: ${n}`); return false; });
  const read = tab => {
    // yalnız denetlenmiş dosya: taslaktan (content-<sekme>.json) asla derlenmez
    const p = `${T.dir}/content-${tab}.verified.json`;
    if (fs.existsSync(p)) {
      const C = JSON.parse(fs.readFileSync(p, 'utf8'));
      const P = PATCH[key]?.[tab];
      if (P) {
        for (const f of ['view', 'side', 'sex', 'shell', 'noshell', 'frame', 'frameAll', 'title_tr']) if (f in P) { if (P[f] === null) delete C[f]; else C[f] = P[f]; }
        const drop = P.dropContext || [];
        const hit = n => drop.some(d => (d instanceof RegExp ? d.test(n) : d === n));
        if (drop.length) C.context = (C.context || []).filter(n => !hit(n));
        if (P.addContext) C.context = [...(C.context || []), ...P.addContext];
        for (const [k, txt] of Object.entries(P.note || {})) { const it = (C.items || []).find(i => i.key === k); if (it) it.tr = [it.tr, txt].filter(Boolean).join(' '); else warn.push(`${tab}: düzeltme notu için madde yok: ${k}`); }
        warn.push(`${tab}: düzeltme tablosu uygulandı (${Object.keys(P).join(', ')})`);
      }
      return C;
    }
    missing.push(tab);
    warn.push(`${tab}: denetlenmiş dosya yok${fs.existsSync(`${T.dir}/content-${tab}.json`) ? ' (taslak var, kullanılmadı)' : ''}, sekme atlandı`); return null;
  };
  const tabs = [];
  let nItems = 0, nQuiz = 0;
  for (const tabKey of T.tabs) {
    const C = read(tabKey); if (!C) continue;
    const t = C.tab || tabKey;
    if (C.sex && !['m', 'f'].includes(C.sex)) warn.push(`${t}: geçersiz sex "${C.sex}" yok sayıldı`);
    if (C.view && !VIEWS.has(C.view)) warn.push(`${t}: geçersiz view "${C.view}" yok sayıldı`);
    if (C.side && !['l', 'r'].includes(C.side)) warn.push(`${t}: geçersiz side "${C.side}" yok sayıldı`);
    const groups = (C.groups || []).map(g => pick(g, ['key', 'la', 'de', 'tr']));
    const gkeys = new Set(groups.map(g => g.key));
    const seen = new Set();
    const items = [];
    for (const it of C.items || []) {
      if (!it.key || seen.has(it.key)) { warn.push(`${t}: anahtarı eksik ya da yinelenen madde atlandı: ${it.key || it.la}`); continue; }
      seen.add(it.key);
      if (!gkeys.has(it.group)) warn.push(`${t}.${it.key}: bilinmeyen grup "${it.group}"`);
      const n = ok(`${t}.${it.key}`, it.n);
      if (!n.length) warn.push(`${t}.${it.key}: modelde parçası yok (listede "modelde yok" görünür)`);
      items.push({ ...pick(it, ['key', 'group', 'la', 'de', 'tr', 'level_de', 'from_la', 'tip', 'clinic_tr']), n });
    }
    // parçaları örtüşen maddeler (bütün ve parçası): bilgi amaçlı; testte birbirine çeldirici olmazlar (study.js)
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const sh = items[i].n.filter(x => items[j].n.includes(x));
      if (sh.length) warn.push(`${t}: ${items[i].key} ve ${items[j].key} parça paylaşıyor (${sh.slice(0, 3).join(', ')}${sh.length > 3 ? ' …' : ''})`);
    }
    const itemParts = new Set(items.flatMap(i => i.n));
    const ctxAll = ok(`${t}.context`, C.context);
    const dup = ctxAll.filter(n => itemParts.has(n));
    if (dup.length) warn.push(`${t}: madde parçası olan ${dup.length} bağlam parçası bağlamdan çıkarıldı (${dup.slice(0, 4).join(', ')}${dup.length > 4 ? ' …' : ''})`);
    const context = ctxAll.filter(n => !itemParts.has(n));
    const quiz = [];
    for (const q of C.quiz || []) {
      if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options.map(o => String(o).trim())).size !== 4 || !q.q) { warn.push(`${t}: şıkları bozuk soru atlandı: ${String(q.q).slice(0, 60)}`); continue; }
      const show = ok(`${t}.quiz`, q.show);
      quiz.push({ q: q.q, options: q.options, ...(q.explain ? { explain: q.explain } : {}), cat: t, ...(show.length ? { show } : {}) });
    }
    tabs.push({
      ...pick(C, ['title_tr', 'title_de', 'intro_tr']), key: t,
      ...(['m', 'f'].includes(C.sex) ? { sex: C.sex } : {}), ...(VIEWS.has(C.view) ? { view: C.view } : {}), ...(['l', 'r'].includes(C.side) ? { side: C.side } : {}), ...keysOf(C, 'shell'), ...keysOf(C, 'noshell'),
      ...(Array.isArray(C.frame) && C.frame.length ? { frame: C.frame.filter(k => (C.groups || []).some(g => g.key === k)) } : {}),
      ...(C.frameAll === true ? { frameAll: true } : {}),
      groups, items, context,
      extras: (C.extras || []).map(e => pick(e, ['title_de', 'tr'])).filter(e => e.tr || e.title_de),
      clinic: (C.clinic || []).map(c => pick(c, ['de', 'tr'])).filter(c => c.tr || c.de),
      quiz, notInModel: (C.notInModel || []).map(x => (typeof x === 'string' ? x : [x.la, x.de, x.tr].filter(Boolean).join(' · '))).filter(Boolean),
    });
    nItems += items.length; nQuiz += quiz.length;
  }
  const out = { v: 1, key, title: T.title, source: `${T.dir.replace(/^\.\.\//, '')} (tools/tour-build.mjs)`, tabs };
  // hiç sekmesi yoksa dosya yazılmaz (eski dosya kalır; yoksa uygulama "verisi yüklenemedi" der)
  if (!tabs.length) { console.log(`${key}: hiç denetlenmiş sekme yok (eksik: ${missing.join(', ')}); ${T.out} yazılmadı\n`); return false; }
  fs.writeFileSync(T.out, JSON.stringify(out) + '\n');
  const kb = (fs.statSync(T.out).size / 1024).toFixed(0);
  console.log(`${key}: ${T.out} ${kb} KB · ${tabs.length} sekme (${tabs.map(t => `${t.key} ${t.items.length} madde / ${t.context.length} bağlam / ${t.quiz.length} soru`).join('; ')}) · toplam ${nItems} madde, ${nQuiz} soru`);
  if (missing.length) console.log(`EKSİK SEKMELER (denetlenmiş dosya yok): ${missing.join(', ')}`);
  if (bad.size) console.log(`\nMODELDE OLMAYAN ADLAR (${bad.size}; atlandı):\n` + [...bad].join('\n'));
  if (warn.length) console.log(`\nUyarılar (${warn.length}):\n` + warn.join('\n'));
  return !bad.size;
}

const want = process.argv.slice(2);
const keys = want.length ? want : Object.keys(TOURS);
let fine = true;
for (const k of keys) {
  if (!TOURS[k]) { console.log(`Bilinmeyen tur: ${k} (bilinenler: ${Object.keys(TOURS).join(', ')})`); fine = false; continue; }
  if (!buildTour(k, TOURS[k])) fine = false;
  console.log('');
}
if (!fine) process.exitCode = 1;
