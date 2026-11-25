// Arayüz: mod düğmeleri, katmanlar, yapı ağacı, bilgi paneli, arama, ipucu balonu.
import { cardHTML } from './muscles.js';
import { SYSTEMS, SYS_ORDER, SUBS, SUB_LABEL, SIDE, SEX, LAYER_STATES, titleName, subtitleName, otherNames, compareNames, sortLength, fold, esc } from './text.js';
import { BLOCKS, BLOCK_SHORT } from './aanki.js';
import { known, structId, onChange as onProgress } from './progress.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Yapılar Latince adlarına göre doğal anatomik sırayla dizilir (Costa II, Costa X'dan önce); aynı adda sol önce.
const byName = (a, b) => compareNames(titleName(a), titleName(b)) || (a.sd || '').localeCompare(b.sd || '');
// Bir grubun içi: grubun kendi adını taşıyan yapı (ör. Nervus trigeminus grubunda sinirin gövdesi) en başta, sonra doğal sıra.
const ownFirst = own => (a, b) => (titleName(b) === own) - (titleName(a) === own) || byName(a, b);
// Fareyle üzerine gelince: tam ad (uzun adlar kesilebilir) ve diğer diller, alt alta.
const namesTip = o => esc([titleName(o), ...otherNames(o)].join('\n'));
// Ad etiketi: Latince ise lang="la" (ekran okuyucular doğru okusun).
const labelHTML = o => `<span class="label"${o.la ? ' lang="la"' : ''} title="${namesTip(o)}">${esc(titleName(o))}</span>`;

export function createUI({ state, model, actions }) {
  const el = {
    modes: $('#modes'), views: $('#views'), sex: $('#sex'), layers: $('#layers'), tree: $('#tree'), info: $('#info'),
    aanki: $('#aanki-tree'), treeView: $('#tree-view'),
    search: $('#search'), results: $('#results'), tooltip: $('#tooltip'),
    isolateBar: $('#isolate-bar'), peelTool: $('#peel-tool'), toast: $('#toast'), loading: $('#loading'), loadText: $('#load-text'), loadBar: $('#load-bar'),
  };

  // ---------- beden (kadın / erkek) ----------
  // Seçici yalnızca veride iki cinsiyetin de kendine özgü parçaları varsa görünür; işaretler (♂/♀) de öyle.
  const bothSexes = () => model.sexes?.has('m') && model.sexes?.has('f');
  el.sex.addEventListener('click', e => { const b = e.target.closest('button[data-sex]'); if (b) actions.setSex(b.dataset.sex); });
  const sexMark = x => (x && bothSexes() ? `<span class="sexmark" title="${SEX[x].label} anatomisi">${SEX[x].sign}</span>` : '');
  const sexAttr = x => (x && bothSexes() ? ` data-x="${x}"` : '');
  const sexCls = x => (x && bothSexes() && x !== state.sex ? ' othersex' : '');
  // Bir grubun bütün yapıları aynı cinsiyete özgüyse grup da o cinsiyetindir (ör. erkek üreme sistemi).
  const groupSex = new Map();
  const sexOfGroup = gi => {
    if (!groupSex.has(gi)) { const xs = new Set(model.groupItems(gi).map(r => r.x || '')); groupSex.set(gi, xs.size === 1 ? [...xs][0] : ''); }
    return groupSex.get(gi);
  };
  let toastTimer = 0;

  // ---------- mod ve görünüm ----------
  el.modes.innerHTML = SYS_ORDER.map((s, i) => `<button data-mode="${s}" role="tab" title="${SYSTEMS[s].label} seç (${i + 1})" data-title="${SYSTEMS[s].label} seç (${i + 1})"><i class="dot ${s}"></i>${SYSTEMS[s].label}</button>`).join('');
  el.modes.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) actions.setMode(b.dataset.mode); });
  const onView = e => { const b = e.target.closest('button[data-view]'); if (b) actions.setView(b.dataset.view); };
  el.views.addEventListener('click', onView);
  $('#views-tool')?.addEventListener('click', onView);   // dar ekranda Araçlar'daki kopya
  $('#exit-isolate').addEventListener('click', () => actions.exitIsolate());

  // ---------- katmanlar ----------
  function buildLayers() {
    const counts = {}; const subCounts = {};
    for (const r of model.list) { counts[r.s] = (counts[r.s] || 0) + 1; subCounts[r.sub] = (subCounts[r.sub] || 0) + 1; }
    el.layers.innerHTML = SYS_ORDER.map(s => `
      <div class="layer" data-sys="${s}">
        <div class="layer-head">
          <i class="dot ${s}"></i><span class="layer-name">${SYSTEMS[s].label}</span><span class="count">${counts[s] || 0}</span>
          <div class="seg tiny" data-layer="${s}">
            ${LAYER_STATES.map(([k, label]) => `<button data-st="${k}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="subs">
          ${SUBS[s].map(([k, label]) => `<label><input type="checkbox" data-sub="${k}"><span>${label}</span><em>${subCounts[k] || 0}</em></label>`).join('')}
        </div>
      </div>`).join('');
    el.layers.addEventListener('click', e => {
      const b = e.target.closest('button[data-st]'); if (!b) return;
      actions.setLayer(b.parentElement.dataset.layer, b.dataset.st);
    });
    el.layers.addEventListener('change', e => { const c = e.target.closest('input[data-sub]'); if (c) actions.setSub(c.dataset.sub, c.checked); });
  }

  // ---------- yapı ağacı ----------
  const groupCount = new Map();
  const countOf = gi => { if (!groupCount.has(gi)) groupCount.set(gi, model.groupItems(gi).length); return groupCount.get(gi); };
  // Satırlar sonradan (dal açılınca) üretildiğinde de seçim vurgusu doğru olsun: markTree() ile aynı koşullar.
  const isSelLeaf = id => state.selected.size <= 400 && state.selected.has(id);
  const isSelGroup = gi => state.primary?.type === 'group' && state.primary.gi === gi;
  const leafHTML = r => `<div class="row leaf${isSelLeaf(r.id) ? ' sel' : ''}${sexCls(r.x)}" data-id="${r.id}"${sexAttr(r.x)}><span class="tw"></span>${labelHTML(r)}${sexMark(r.x)}${r.sd ? `<span class="side ${r.sd}">${SIDE[r.sd]}</span>` : ''}</div>`;
  const groupHTML = g => {
    const x = sexOfGroup(g.i);
    return `<div class="node" data-g="${g.i}"><div class="row group${isSelGroup(g.i) ? ' sel' : ''}${sexCls(x)}"${sexAttr(x)}><button class="tw" aria-label="Aç/kapat">▸</button>${labelHTML(g)}${sexMark(x)}<span class="count">${countOf(g.i)}</span></div><div class="kids" hidden></div></div>`;
  };

  function fillKids(node) {
    const kids = $(':scope > .kids', node); if (kids.dataset.done) return kids;
    let groups, items, own = null;
    if (node.dataset.sys) { groups = model.roots[node.dataset.sys].map(i => model.groups[i]); items = model.rootItems[node.dataset.sys]; }
    else { const g = model.groups[+node.dataset.g]; groups = g.kids.map(i => model.groups[i]); items = g.items; own = titleName(g); }
    // Alt gruplar ve yapılar tek listede doğal sırayla: Nervi craniales I–XII (V, VII, VIII alt grup), Costae spuriae
    // içinde Costa octava, nona, decima ve ardından Costae fluctuantes. Aynı adda önce grup.
    const cmp = ownFirst(own);
    const rows = [...groups, ...items].sort((a, b) => cmp(a, b) || ('id' in a) - ('id' in b));
    kids.innerHTML = rows.map(o => ('id' in o ? leafHTML(o) : groupHTML(o))).join('');
    kids.dataset.done = '1';
    return kids;
  }
  function setOpen(node, open) {
    const kids = fillKids(node); kids.hidden = !open;
    node.classList.toggle('open', open);
  }
  function buildTree() {
    el.tree.innerHTML = SYS_ORDER.map(s => `
      <div class="node sys" data-sys="${s}"><div class="row group"><button class="tw" aria-label="Aç/kapat">▸</button><i class="dot ${s}"></i><span class="label">${SYSTEMS[s].title}</span></div><div class="kids" hidden></div></div>`).join('');
    el.tree.addEventListener('click', e => {
      const row = e.target.closest('.row'); if (!row) return;
      if (row.classList.contains('leaf')) { actions.selectItem(row.dataset.id, { focus: true, additive: e.ctrlKey || e.shiftKey }); return; }
      const node = row.parentElement;
      if (e.target.closest('.tw') || node.dataset.sys) { setOpen(node, !node.classList.contains('open')); return; }
      setOpen(node, true);
      actions.selectGroup(+node.dataset.g, { focus: true });
    });
    el.tree.addEventListener('mouseover', e => { const row = e.target.closest('.row.leaf'); actions.hoverFromUI(row ? row.dataset.id : null); });
    el.tree.addEventListener('mouseleave', () => actions.hoverFromUI(null));
  }
  // Seçili parçayı ağaçta görünür kıl.
  function reveal(rec) {
    const sysNode = $(`.node.sys[data-sys="${rec.s}"]`, el.tree); if (!sysNode) return;
    setOpen(sysNode, true);
    if (rec.g >= 0) for (const g of model.groupPath(rec.g)) { const n = $(`.node[data-g="${g.i}"]`, el.tree); if (n) setOpen(n, true); }
    const leaf = $(`.leaf[data-id="${rec.id}"]`, el.tree);
    if (leaf) leaf.scrollIntoView({ block: 'nearest' });
  }
  function markTree() {
    for (const n of $$('.row.sel', el.tree)) n.classList.remove('sel');
    for (const n of $$('.row[data-x]', el.tree)) n.classList.toggle('othersex', n.dataset.x !== state.sex);   // karşı cinsiyetin yapıları soluk
    if (state.primary?.type === 'group') { const n = $(`.node[data-g="${state.primary.gi}"] > .row`, el.tree); n?.classList.add('sel'); }
    if (state.selected.size <= 400) for (const id of state.selected) $(`.leaf[data-id="${id}"]`, el.tree)?.classList.add('sel');
  }

  // ---------- Aanki görünümü ----------
  // Yapı ağacının ikinci görünümü: Aanki destesinin (Fachschaft Medizin Aachen) ÄBP öğrenme planındaki anatomi günleri
  // ve dönemlerin anatomi dersleri. Bir konuya tıklamak o konunun yapılarını izole eder (actions.selectTopic).
  let aanki = null, aankiSex = null;
  let muscles = null;   // kas kartları (muscles.js); yüklenince kas yapılarının kartında görünür
  const panels = {};   // başka modüllerin sağ panel içeriği (ör. kalp modu): tür -> { html(), click(e) }
  const TREE_KEY = 'anatomi3d.treeview';
  function setTreeView(v) {
    if (v === 'aanki' && !aanki) v = 'sys';
    el.tree.hidden = v !== 'sys'; el.aanki.hidden = v !== 'aanki';
    for (const b of $$('button[data-tv]', el.treeView)) { const on = b.dataset.tv === v; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }
    try { localStorage.setItem(TREE_KEY, v); } catch { /* özel pencere: yalnızca bu oturum */ }
  }
  el.treeView.addEventListener('click', e => { const b = e.target.closest('button[data-tv]'); if (b) { setTreeView(b.dataset.tv); b.blur(); } });
  const sexOkRec = r => !r.x || r.x === state.sex;
  // kalp konularında kalp modunun hangi bölümüyle açılacağı (koroner dersi koronerlerle, topografi kapak noktalarıyla)
  // Herzinnervation: ileti sistemi ve kalbin sinirleri (İleti sekmesi); Herzinnenräume odacıklar ve kapaklarla kanın yolunda kalır
  const HEART_TAB = { 's3-hkl-5': 'coronary', 's3-hkl-3': 'valves', 's3-hkl-6': 'conduction' };
  // kesit ve görüntüleme anatomisi konuları: kesit atlası hangi bölgeyle açılır (ÄBP Schnittbildtrainer, nöro görüntüleme,
  // IPO "Bildgebende Verfahren" dersleri)
  const SECT_REGION = { 'abp-23': 'head', 's4-neu-2c': 'head', 's4-neu-p1': 'head', 's2-hkl': 'thorax', 's2-git': 'abdomen', 's2-harn': 'abdomen' };
  // nöro konularında beyin modunun bölümü (Liquor dersleri BOS yoluyla, Hirnnerven dersleri ve kafatası osteolojisi kranial
  // sinirlerle, Blutversorgung dersleri arterlerle); listede olmayan nöro konuları BOS yoluyla açılır
  // değer: 'bölüm[:görünüm[:sinir]]'
  // hareket sistemi modunun bölümü: BWA ve eklem derslerinde (değer: 'bölüm[:anahtar]')
  const LOCO_TAB = {
    'abp-01': 'nerves:arm', 'abp-02': 'nerves:leg', 's3-bwa': 'nerves', 's2-bwa-4': 'joints', 's2-bwa-6': 'muscles:upper', 's2-bwa-8': 'joints:huefte',
    's7-knie': 'joints:knie', 's7-schulter': 'joints:schulter', 's7-hand': 'joints:hand', 's7-fuss': 'joints:fuss', 's7-osg': 'joints:sprunggelenke',
    's5-git-m1': 'muscles:headneck',
  };
  // çalışma turlarının (tour.js) konu kartındaki düğmesi: konu -> [tur, sekme] (sekme 'sekme[:madde]' biçiminde de olabilir)
  // Tur başına yazılır (tur -> sekme -> konular); bir konu birden çok turda olabilir (Rektum: Situs ve Ürogenital), o zaman
  // kartta her turun düğmesi çıkar. Başka bir çalışma modunun düğmesi olan konular (kalp, beyin) onu da korur.
  const TOUR_TOPICS = {
    situs: {
      peritoneum: ['abp-34', 's5-git-5', 's5-git-p1', 's5-git-6', 's5-git-p10', 's5-git-7', 's5-git-8', 's5-git-p11', 's5-hugo-p1'],
      arteries: ['s5-git-p7', 's5-git-p4'],
      portal: ['s5-git-9', 's5-git-p13'],
      liver: ['abp-35', 's5-git-10', 's5-git-p9', 's5-git-11', 's5-git-p12'],
    },
    thorax: {
      lung: ['s4-atm-2', 'abp-16'],
      pleura: ['s4-atm-3'],
      larynx: ['s4-atm-5', 's4-atm-6', 's6-sok-k'],
      mediastinum: ['s3-hkl-2'],
    },
    uro: {
      kidney: ['abp-40', 's5-hugo-1', 's5-hugo-p1'],
      male: ['abp-42', 's5-hugo-2'],
      female: ['abp-41', 's5-hugo-6', 's5-hugo-vulva', 's5-hugo-mamma', 's5-hugo-3'],
      pelvis: ['s5-hugo-blase', 's5-git-9', 's5-git-p13'],
    },
    head: {
      orbita: ['s6-sok-8', 's6-sok-p3', 's6-sok-p4'],
      ear: ['s6-sok-4', 's6-sok-6', 's6-sok-p2'],
      mouth: ['abp-33', 's5-git-1', 's5-git-2', 's5-git-3', 's5-git-p2'],
      neck: ['s5-git-p8', 's6-endo-5'],
    },
    vessels: {
      armart: ['abp-01', 's2-hkl'],
      legart: ['abp-02'],
    },
    lymph: {
      organs: ['s4-bua-1', 'abp-12', 's2-bua', 's5-git-p10'],
    },
  };
  // konu -> [[tur, sekme], ...]
  const TOUR_TAB = {};
  for (const [tour, tabs] of Object.entries(TOUR_TOPICS)) for (const [tab, ids] of Object.entries(tabs)) for (const id of ids) (TOUR_TAB[id] ||= []).push([tour, tab]);
  let tours = [];   // main.js TOURS: { key, title, hint }
  const tourBtn = t => (TOUR_TAB[t.id] || []).map(([k, tab]) => {
    const T = tours.find(o => o.key === k);
    return T ? `<button data-act="tour" data-tour="${T.key}" data-tab="${esc(tab)}" title="${esc(T.hint || '')}">${esc(T.title)}</button>` : '';
  }).join('');
  // kas yapısının kartı: Ursprung, Ansatz, Innervation, Funktion
  const muscleField = r => {
    const c = r.s === 'muscle' && muscles?.muscles[r.n]; if (!c) return '';
    return `<div class="field"><div class="k">Kas kartı${c.whole_la && c.part_la ? ` · <span lang="la">${esc(c.whole_la)}</span>` : ''}</div>${cardHTML([c])}
      <div class="btns"><button data-act="loco" data-tab="muscles:${esc(r.n)}" title="Bu kası origo ve insersiyo yamaları, siniri ve grubuyla göster">Hareket sistemi modunda aç</button></div></div>`;
  };
  // ---------- kas katmanı soyma (Araçlar, boş kart, kas kartı) ----------
  // Katmanlar data/muscle-depth.json'dan; düğmeler data-peel taşır (tıklamalar belge düzeyinde tek dinleyicide).
  const studyOn = () => !!(state.primary && (panels[state.primary.type] || state.primary.type === 'quiz'));
  // katman sırasının kaba adı: 1 yüzeyel, son üçte bir derin, arası orta
  const depthWord = (k, max) => (k <= 1 ? 'yüzeyel' : k > Math.ceil((2 * max) / 3) ? 'derin' : 'orta');
  function peelHTML(r) {
    const D = model.depth; if (!D) return '';
    const n = state.peel.n, max = D.max, off = studyOn() || model.failed?.has('muscle');
    const dis = c => (off || c ? ' disabled' : '');
    const state_ = !n ? 'Bütün kaslar görünüyor' : `${n} katman kaldırıldı · görünen: ${n + 1}.–${max}. katman (${depthWord(n + 1, max)})`;
    const mine = r && D.d[r.id];
    return `<div class="peel${off ? ' off' : ''}">
      <div class="peel-btns">
        <button data-peel="up"${dis(n >= max - 1)} title="Dıştaki kas katmanını kaldır: altındaki derin kaslar görünür ve tıklanabilir">Üst katmanı kaldır</button>
        <button data-peel="down"${dis(!n)} title="Son kaldırılan kas katmanını geri getir">Geri getir</button>
        ${n > 1 ? `<button data-peel="reset"${dis(false)} title="Bütün kas katmanlarını geri getir">Hepsi</button>` : ''}
      </div>
      <div class="peel-state"><span class="hint">${state_}</span>
        <div class="seg tiny" role="group" aria-label="Kaldırılan kaslar"><button data-peel="hide" class="${state.peel.ghost ? '' : 'active'}" title="Kaldırılan kaslar gizlensin">Gizle</button><button data-peel="ghost" class="${state.peel.ghost ? 'active' : ''}" title="Kaldırılan kaslar saydam kalsın (yer bulmak için)">Saydam</button></div>
      </div>
      ${mine ? `<div class="peel-own"><span class="hint">Bu kas: ${mine}. katman / ${max} (${depthWord(mine, max)})</span>${mine > 1 && n !== mine - 1 ? `<button data-peel="to:${mine - 1}"${dis(false)} title="Bu kasın üstündeki bütün katmanları kaldır">Üstündekileri kaldır</button>` : ''}</div>` : ''}
      ${off && studyOn() ? '<div class="hint">Çalışma modunda kullanılmaz.</div>' : ''}
    </div>`;
  }
  const peelField = r => (model.depth && r.s === 'muscle' && r.sub === 'muscle' ? `<div class="field"><div class="k">Kas katmanı</div>${peelHTML(r)}</div>` : '');
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-peel]'); if (!b || b.disabled) return;
    const v = b.dataset.peel;
    actions.peel(v === 'up' ? 1 : v === 'down' ? -1 : v === 'reset' ? 0 : v.startsWith('to:') ? { to: +v.slice(3) } : v);
  });
  // Kraniyal sinir mi: adı ya da üst gruplarından biri "<…> nerve (Roma rakamı)" (dalları ve kökleri de sayılır)
  const CN_RE = /^(Olfactory|Optic|Oculomotor|Trochlear|Trigeminal|Abducens|Facial|Vestibulocochlear|Glossopharyngeal|Vagus|Accessory|Hypoglossal) nerve \(([IVX]+)\)$/;
  function cranialOf(r) {
    if (r.s !== 'nerve') return null;
    for (const o of [r, ...(r.g >= 0 ? model.groupPath(r.g).slice().reverse() : [])]) { const m = CN_RE.exec(o.n); if (m) return m[2]; if (o.n === 'Cranial nerves') return ''; }
    return null;
  }
  const cranialBtn = num => (num === null ? '' : `<div class="btns"><button data-act="cn" data-tab="${num}" title="Beyin çalışma modu, Sinirler: I–XII beyin sapından çıkış yerleriyle renkli ve etiketli; beyin ve kafatası saydam">Kraniyal sinirler görünümü${num ? ` (${num})` : ''}</button></div>`);

  const BRAIN_TAB = {
    's4-neu-3': 'csf', 's4-neu-p6': 'csf',
    's4-neu-7': 'nerves:exit', 's4-neu-8': 'nerves:exit', 's4-neu-p2': 'nerves:exit', 's4-neu-p3': 'nerves:exit', 's4-neu-p1b': 'nerves:exit', 's4-neu-0': 'nerves:nuclei',
    's6-sok-p1': 'nerves:skull', 's6-sok-8': 'nerves:skull:III', 's6-sok-p3': 'nerves:skull:III', 's6-sok-p4': 'nerves:exit:II', 's6-sok-9': 'nerves:exit:II',
    's6-sok-4': 'nerves:exit:VIII', 's6-sok-6': 'nerves:exit:VIII', 's6-sok-p2': 'nerves:exit:VIII', 's6-sok-7': 'nerves:nuclei:VIII', 's6-sok-5': 'nerves:exit:I',
    's4-neu-2': 'arteries', 's4-neu-p5': 'arteries', 's4-neu-4': 'arteries:lateral', 's4-neu-11b': 'arteries:lateral',
  };
  let topicSexOf = () => null;
  let topicAskable = (t, rs) => rs;   // konu testinin sorabileceği yapılar (main.js: kılıf bağlamı ve saydam kemik hariç)
  let topicViewOf = (t, rs) => ({ core: rs, env: [] });   // konunun izole görünümü (main.js topicView: izole yapılar ve saydam kılıf bağlamı)
  // ağaçtaki sayı kartla aynı: izole görünümün yapıları (saydam kılıf bağlamı hariç)
  const topicCount = t => { const rs = aanki.recsOf(t), x = topicSexOf(rs) || state.sex; return topicViewOf(t, rs.filter(r => !r.x || r.x === x)).core.length; };
  // Konunun ilerlemesi: bilinen yapı adları / konu testinin sorabileceği yapı adları (konu tek cinsiyete özgüyse o beden,
  // yoksa seçili beden; iki taraf tek ad; saydam bağlam olan kılıflar ve saydam başlayan kemikler sayılmaz). Ağaçta
  // satırın arkasında ince bir dolgu (--p), kartta "Bilinen X / Y".
  const namesCache = new Map();
  const topicNames = t => {
    const k = t.id + '|' + state.sex;
    if (!namesCache.has(k)) { const rs = aanki.recsOf(t), x = topicSexOf(rs) || state.sex; namesCache.set(k, [...new Set(topicAskable(t, rs.filter(r => !r.x || r.x === x)).map(r => r.n))]); }
    return namesCache.get(k);
  };
  const topicProgress = t => { const ns = topicNames(t); return [ns.filter(n => known(structId(n))).length, ns.length]; };
  const fillOf = t => { const [k, n] = topicProgress(t); return { k, n, p: n ? Math.round(1000 * k / n) / 10 : 0 }; };
  const rowTitle = (t, f) => `${t.place}\n${t.title}${f.k ? `\nBilinen ${f.k} / ${f.n}` : ''}`;
  // ilerleme değişince satırlar yerinde güncellenir (ağaç yeniden kurulmaz: açık dallar açık kalır)
  function fillAanki() {
    if (!aanki) return;
    for (const row of $$('.row.topic', el.aanki)) {
      const t = aanki.byId.get(row.dataset.t); if (!t) continue;
      const f = fillOf(t);
      row.style.setProperty('--p', f.p + '%'); row.title = rowTitle(t, f);
    }
  }
  let fillTimer = null;
  onProgress(() => {
    clearTimeout(fillTimer);
    fillTimer = setTimeout(() => { fillAanki(); if (state.primary?.type === 'topic') renderInfo(); }, 250);
  });
  const isSelTopic = id => state.primary?.type === 'topic' && state.primary.id === id;
  const topicRow = t => { const f = fillOf(t); return `<div class="row leaf topic${isSelTopic(t.id) ? ' sel' : ''}" data-t="${t.id}" style="--p:${f.p}%" title="${esc(rowTitle(t, f))}"><span class="tw"></span><span class="label">${esc(t.label)}</span><span class="count">${topicCount(t)}</span></div>`; };
  const branch = (label, rows, n, open = false) => `<div class="node${open ? ' open' : ''}"><div class="row group"><button class="tw" aria-label="Aç/kapat">▸</button><span class="label">${esc(label)}</span><span class="count">${n}</span></div><div class="kids"${open ? '' : ' hidden'}>${rows}</div></div>`;
  function buildAanki() {
    const days = aanki.topics.filter(t => t.kind === 'abp').sort((a, b) => parseInt(a.day, 10) - parseInt(b.day, 10));
    const lect = aanki.topics.filter(t => t.kind !== 'abp');
    let html = branch('ÄBP-Lernplan · Anatomie-Tage', days.map(topicRow).join(''), days.length, true);
    for (const sem of [...new Set(lect.map(t => t.sem))].sort((a, b) => a - b)) {
      const inSem = lect.filter(t => t.sem === sem);
      const blocks = [...new Set(inSem.map(t => t.block))];
      html += branch(`${sem}. Semester`, blocks.map(b => {
        const ts = inSem.filter(t => t.block === b);
        return branch(BLOCKS[b] || b, ts.map(topicRow).join(''), ts.length);
      }).join(''), inSem.length);
    }
    el.aanki.innerHTML = html + '<p class="hint">Kaynak: Aanki Wiki ve Aanki Arbeitsübersicht (Fachschaft Medizin Aachen). Yapılar ders ve öğrenme günü başlıklarına göre seçildi. Bu görünüm resmî değildir; uygulamanın Aanki ve Fachschaft Medizin Aachen ile bağlantısı yoktur.</p>';
    aankiSex = state.sex;
  }
  el.aanki.addEventListener('click', e => {
    const row = e.target.closest('.row'); if (!row) return;
    if (row.dataset.t) { actions.selectTopic(row.dataset.t); return; }
    const node = row.parentElement, open = !node.classList.contains('open');
    node.classList.toggle('open', open); $(':scope > .kids', node).hidden = !open;
  });
  function markAanki() {
    if (!aanki) return;
    if (aankiSex !== state.sex) {   // beden değişince konu başına yapı sayıları da değişir
      aankiSex = state.sex;
      for (const row of $$('.row.topic', el.aanki)) $('.count', row).textContent = topicCount(aanki.byId.get(row.dataset.t));
      fillAanki();
    }
    for (const n of $$('.row.topic.sel', el.aanki)) n.classList.remove('sel');
    if (state.primary?.type === 'topic') $(`.row.topic[data-t="${state.primary.id}"]`, el.aanki)?.classList.add('sel');
  }
  // Konunun yeri ve Aanki'deki etiket yolu (wiki'deki düzen: #Aanki_x_Ankizin → !Studienabschnitt_… → SB → Fach → Thema;
  // ÄBP: → !Ärztliche_Basisprüfung → ÄBP-60-Tage-Lernplan → Lerntag). Tam etiket adları destede; yol yaklaşık gösterilir.
  const tagPath = t => (t.kind === 'abp'
    ? ['#Aanki_x_Ankizin', '!Ärztliche_Basisprüfung', 'ÄBP-60-Tage-Lernplan', `Lerntag ${String(t.day).replace('-', '–')}`]
    : ['#Aanki_x_Ankizin', '!Studienabschnitt', BLOCKS[t.block] || t.block, t.block === 'IPO' ? t.fach : 'Anatomie', t.title]);
  const topicChip = t => (t.kind === 'abp' ? `ÄBP Tag ${String(t.day).replace('-', '–')} · ${BLOCK_SHORT[t.block] || t.block}` : `${t.sem}. Sem · ${t.title.length > 30 ? t.title.slice(0, 29) + '…' : t.title}`);
  // Yapı kartında: bu yapının geçtiği Aanki konuları (tıklanınca konu açılır)
  const aankiField = r => {
    const ts = aanki ? aanki.topicsOf(r.id) : [];
    if (!ts.length) return '';
    const shown = ts.slice(0, 14);
    return `<div class="field"><div class="k">Aanki</div><div class="crumbs">${shown.map(t => `<button class="crumb topic" data-t="${t.id}" title="${esc(`${t.place}\n${t.title}`)}">${esc(topicChip(t))}</button>`).join('')}${ts.length > shown.length ? `<span class="more">+${ts.length - shown.length}</span>` : ''}</div></div>`;
  };

  // Yapı kartında: bu yapının rol aldığı patoloji vakaları (sinir, lezyon yeri, felçli kas, etkilenen alan); tıklanınca vaka açılır
  const pathoField = r => {
    const cs = actions.pathoFor?.(r.n) || [];
    if (!cs.length) return '';
    const shown = cs.slice(0, 8);
    return `<div class="field"><div class="k">Patoloji vakaları</div><div class="crumbs">${shown.map(([k, t]) => `<button class="crumb pcase" data-k="${esc(k)}" title="Bu vakayı Patoloji modunda aç">${esc(t)}</button>`).join('')}${cs.length > shown.length ? `<span class="more">+${cs.length - shown.length}</span>` : ''}</div></div>`;
  };

  // ---------- bilgi paneli ----------
  const pathHTML = gi => {
    const p = gi >= 0 ? model.groupPath(gi) : [];
    if (!p.length) return '';
    return `<div class="field"><div class="k">Bölüm</div><div class="crumbs">${p.map(g => `<button class="crumb" data-g="${g.i}"${g.la ? ' lang="la"' : ''} title="${esc([...otherNames(g), 'Bu grubun tamamını seç'].join('\n'))}">${esc(titleName(g))}</button>`).join('<span class="sep">›</span>')}</div></div>`;
  };
  // Kısayolların ekrandaki karşılıkları (dokunmatik ekranda klavye yok): F, H, I, Esc ve Alt+H
  const showAllBtn = () => (state.hidden.size ? `<button data-act="showall" title="Gizlenen yapıların hepsini geri getir (Alt+H)">Gizlenenleri göster (${state.hidden.size})</button>` : '');
  const actionsHTML = extra => `
    <div class="btns">
      <button data-act="focus" title="Odaklan (F)">Odaklan</button>
      <button data-act="hide" title="Gizle (H)">Gizle</button>
      <button data-act="isolate" title="İzole et (I)">${state.isolate ? 'İzolasyondan çık' : 'İzole et'}</button>
      ${extra || ''}
      <button data-act="clear" title="Seçimi bırak (Esc)">Bırak</button>
      ${showAllBtn()}
    </div>`;
  // Kartın içindeki listeler de ağaçla aynı: Latince ad, aynı sıra; fareyle üzerine gelince diğer adlar görünür.
  const memberList = (recs, own = null) => {
    const sorted = [...recs].sort(ownFirst(own));
    const shown = sorted.slice(0, 300);
    return `<div class="members">${shown.map(r => `<button class="member" data-id="${r.id}">${labelHTML(r)}${r.sd ? `<span class="side ${r.sd}">${SIDE[r.sd]}</span>` : ''}</button>`).join('')}${sorted.length > shown.length ? `<div class="more">+${sorted.length - shown.length} yapı daha</div>` : ''}</div>`;
  };
  // Başlık (Latince, kalın) + altında Almanca + diğer diller.
  const namesHTML = o => {
    const title = titleName(o), sub = subtitleName(o);
    const rows = [];
    if (o.tr && o.tr !== title) rows.push(['Türkçe', o.tr]);
    if (o.n && o.n !== title && o.n !== o.tr) rows.push(['İngilizce', o.n]);
    return `<h1 class="name"${o.la && title === o.la ? ' lang="la"' : ''}>${esc(title)}</h1>
      ${sub ? `<div class="name-de" lang="de">${esc(sub)}</div>` : ''}
      ${rows.map(([k, v]) => `<div class="field"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}`;
  };

  // başka bir kart ya da çalışma paneli açılınca #info başa döner (aynı kartın yeniden çizimi kaydırmayı korur)
  let infoKey = '';
  const infoTop = p => {
    const key = !p ? '' : panels[p.type] ? `panel:${p.type}` : `${p.type}:${p.id ?? p.gi ?? ''}`;
    if (key !== infoKey) { infoKey = key; el.info.scrollTop = 0; }
  };
  // Konu kartındaki sayı: izole edilen yapılar (konu görünümünün çekirdeği); saydam bağlam olarak gösterilen kılıflar
  // (fasyalar, kapsüller, zarlar, bursalar) ayrı bir çipte. Kümeler selectTopic ile aynı kuraldan gelir (topicView).
  function topicCountChips(t, recs) {
    const v = topicViewOf(t, recs), n = v.core.length, env = v.env.length;
    return `<span class="chip" title="Konunun izole görünümündeki yapılar">${n} yapı</span>${env ? `<span class="chip dim" title="İçlerindeki yapıları örtmesin diye saydam bağlam olarak gösterilen kılıflar (fasya, kapsül, zar, bursa); yapı sayısına dahil değil">+${env} saydam kılıf</span>` : ''}`;
  }
  function renderInfo() {
    const p = state.primary; let html;
    if (p && panels[p.type]) { el.info.innerHTML = panels[p.type].html(); infoTop(p); return; }
    if (p?.type === 'topic' && aanki?.byId.has(p.id)) {
      // Aanki konusu: konunun yapıları izole görünümde; kartta yer, etiket yolu ve sisteme göre yapı listeleri
      const t = aanki.byId.get(p.id);
      const recs = aanki.recsOf(t).filter(r => r.mesh && sexOkRec(r));
      const bySys = SYS_ORDER.map(s => [s, recs.filter(r => r.s === s)]).filter(([, l]) => l.length);
      html = `
        <div class="chips">
          <span class="chip aanki">Aanki</span>
          <span class="chip">${esc(t.kind === 'abp' ? `ÄBP · Lerntag ${String(t.day).replace('-', '–')}` : `${t.sem}. Semester`)}</span>
          ${topicCountChips(t, recs)}${t.cards ? `<span class="chip">${t.cards} kart</span>` : ''}
        </div>
        <h1 class="name" lang="de">${esc(t.title)}</h1>
        <div class="name-de" lang="de">${esc(t.place)}${t.kind !== 'abp' && t.nr ? ` · ${t.fach === 'Präparierkurs' ? '' : t.kind === 'pr' ? 'Praktikum ' : 'Vorlesung '}${esc(t.nr)}` : ''}</div>
        ${(([k, n]) => `<div class="field"><div class="k">İlerleme</div><div class="v topicprog" title="Konu testinin sorduğu yapı adlarından (iki taraf tek ad) son cevabı doğru olan ve yanlış listesinde olmayanlar"><i style="--p:${n ? (100 * k / n).toFixed(1) : 0}%"></i><span>Bilinen ${k} / ${n}</span></div></div>`)(topicProgress(t))}
        ${t.hint ? `<div class="field"><div class="k">İpucu</div><div class="v">${esc(t.hint)}</div></div>` : ''}
        <div class="field"><div class="k">Anki'de etiket yolu (yaklaşık)</div><div class="v tagpath" lang="de">${tagPath(t).map(esc).join(' <span class="sep">›</span> ')}</div></div>
        <div class="btns">
          <button data-act="focus" title="Odaklan (F)">Odaklan</button>
          <button data-act="quiz" title="Bu konunun yapılarıyla test: adını seç ya da 3B görünümde bul">Test</button>
          <button data-act="exit-topic" title="İzole görünümden çık (Esc)">Konudan çık</button>
          ${/HKL/.test(t.block) || t.fach === 'Herz-Kreislauf-Organe' ? `<button data-act="heart" data-tab="${HEART_TAB[t.id] || 'flow'}" title="Kanın yolu, kapaklar, koronerler, ileti sistemi, test">♥ Kalp çalışma modu</button>` : ''}
          ${t.block === 'NEU' || t.fach === 'Nervensystem' || BRAIN_TAB[t.id] ? `<button data-act="brain" data-tab="${BRAIN_TAB[t.id] || 'csf'}" title="BOS yolu, kranial sinirler, beyin arterleri, test">Beyin çalışma modu</button>` : ''}
          ${t.block === 'BWA' || t.block === 'Gelenke' || t.fach === 'Bewegungsapparat' || LOCO_TAB[t.id] ? `<button data-act="loco" data-tab="${LOCO_TAB[t.id] || 'nerves'}" title="Sinir lezyonları, geçitler, kas kartları, eklemler, test">Hareket sistemi modu</button>` : ''}
          ${tourBtn(t)}
          ${SECT_REGION[t.id] ? `<button data-act="sect" data-tab="${SECT_REGION[t.id]}" title="Kanonik kesit seviyeleri (BT / MR atlası gibi), kesit yüzünde tanınacak yapılar, kesit testi">Kesit atlası</button>` : ''}
        </div>
        ${bySys.map(([s, l]) => `<div class="field"><div class="k"><i class="dot ${s}"></i> ${SYSTEMS[s].title} · ${l.length}</div>${memberList(l)}</div>`).join('')}`;
    } else if (!p || state.selected.size === 0) {
      const sys = SYSTEMS[state.mode];
      html = `
        <div class="empty">
          <div class="chips"><span class="chip sys ${state.mode}"><i class="dot ${state.mode}"></i>${sys.label} modu</span></div>
          <h1>Bir yapıya tıklayın</h1>
          <p>Şu anda <b>${sys.label.toLowerCase()}</b> seçebilirsiniz. Tıkladığınız yapı parlar ve adı burada görünür.</p>
          <p class="dim mouse-only">Başka bir sistemi seçmek için üstteki mod düğmelerini kullanın. Ctrl ile tıklayarak birden fazla yapı seçebilirsiniz. Derindeki bir yapıya ulaşmak için üstündekini seçip <b>H</b> (ya da karttaki Gizle) ile gizleyin; derin kaslar için aşağıdaki <b>Kas katmanı</b> ile dıştaki katmanları kaldırın (kas modunda).</p>
          <p class="dim touch-only">Başka bir sistem için üstteki mod düğmelerine dokunun. Bir parmakla döndürün, iki parmakla yakınlaştırıp kaydırın, dokunarak seçin, çift dokunuşla odaklanın. Derindeki bir yapı için üstündekini seçip karttaki Gizle ile gizleyin; derin kaslar için: Kas katmanı.</p>
          ${state.mode === 'muscle' && model.depth ? `<div class="field"><div class="k">Kas katmanı: derindeki kaslara ulaşmak için</div>${peelHTML(null)}</div>` : ''}
          ${state.hidden.size || state.isolate ? `<div class="btns">${state.isolate ? '<button data-act="isolate" title="İzole görünümden çık (I)">İzolasyondan çık</button>' : ''}${showAllBtn()}</div>` : ''}
        </div>`;
    } else if (p.type === 'item') {
      const r = model.items.get(p.id);
      const twin = r.twin && r.twin.mesh ? `<button data-act="twin">Karşı tarafı da seç</button>` : '';
      html = `
        <div class="chips">
          <span class="chip sys ${r.s}"><i class="dot ${r.s}"></i>${SYSTEMS[r.s].title}</span>
          <span class="chip">${SUB_LABEL[r.sub]}</span>
          ${r.sd ? `<span class="chip side ${r.sd}">${SIDE[r.sd]}</span>` : ''}
          ${r.x && bothSexes() ? `<span class="chip">${SEX[r.x].sign} ${SEX[r.x].label}</span>` : ''}
        </div>
        ${namesHTML(r)}
        ${pathHTML(r.g)}
        ${muscleField(r)}
        ${peelField(r)}
        ${cranialBtn(cranialOf(r))}
        ${pathoField(r)}
        ${aankiField(r)}
        ${actionsHTML(twin)}`;
    } else if (p.type === 'group') {
      const g = model.groups[p.gi]; const recs = model.groupItems(p.gi).filter(r => r.mesh && (!r.x || r.x === state.sex));
      html = `
        <div class="chips">
          <span class="chip sys ${g.s}"><i class="dot ${g.s}"></i>${SYSTEMS[g.s].title}</span>
          <span class="chip">Grup</span><span class="chip">${recs.length} yapı</span>
        </div>
        ${namesHTML(g)}
        ${pathHTML(g.p)}
        ${cranialBtn(cranialOf({ s: g.s, n: g.n, g: g.p }))}
        ${actionsHTML()}
        <div class="field"><div class="k">Bu gruptaki yapılar</div>${memberList(recs, titleName(g))}</div>`;
    } else {
      const recs = [...state.selected].map(id => model.items.get(id));
      html = `
        <div class="chips"><span class="chip">Çoklu seçim</span></div>
        <h1>${recs.length} yapı seçili</h1>
        ${actionsHTML()}
        <div class="field"><div class="k">Seçili yapılar</div>${memberList(recs)}</div>`;
    }
    el.info.innerHTML = html;
    infoTop(p);
  }
  el.info.addEventListener('click', e => {
    if (state.primary && panels[state.primary.type]) return panels[state.primary.type].click(e);
    const topic = e.target.closest('.crumb.topic'); if (topic) return actions.selectTopic(topic.dataset.t);
    const pcase = e.target.closest('.crumb.pcase'); if (pcase) return actions.pathoMode(pcase.dataset.k);   // yapının patoloji vakası
    const crumb = e.target.closest('.crumb'); if (crumb) return actions.selectGroup(+crumb.dataset.g, { focus: true });
    const member = e.target.closest('.member'); if (member) return actions.selectItem(member.dataset.id, { focus: true });
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (act === 'focus') actions.focusSelection();
    else if (act === 'hide') actions.hideSelected();
    else if (act === 'isolate') actions.toggleIsolate();
    else if (act === 'twin') actions.selectTwin();
    else if (act === 'exit-topic') actions.exitIsolate();
    else if (act === 'clear') actions.clearSelection();
    else if (act === 'showall') actions.showAll();
    else if (act === 'quiz' && state.primary?.type === 'topic') actions.topicQuiz(state.primary.id);
    else if (act === 'heart') actions.heartMode(e.target.closest('button[data-act]').dataset.tab || 'flow');
    else if (act === 'cn') actions.cranialNerves(e.target.closest('button[data-act]').dataset.tab || '');
    else if (act === 'brain') actions.brainMode(e.target.closest('button[data-act]').dataset.tab || 'csf');
    else if (act === 'loco') actions.locoMode(e.target.closest('button[data-act]').dataset.tab || 'nerves');
    else if (act === 'sect') actions.sectMode(e.target.closest('button[data-act]').dataset.tab || '');
    else if (act === 'tour') { const b = e.target.closest('button[data-act]'); actions.tour(b.dataset.tour, b.dataset.tab || ''); }
  });
  el.info.addEventListener('mouseover', e => { const m = e.target.closest('.member'); actions.hoverFromUI(m ? m.dataset.id : null); });
  el.info.addEventListener('mouseleave', () => actions.hoverFromUI(null));

  // ---------- arama ----------
  let index = []; let active = -1; let shown = [];
  function buildIndex() {
    index = [];
    // Arama tüm dillerde yapılır (Türkçe, İngilizce, Latince, Almanca); taraf sözcükleri de eklenir ("sağ femur").
    const sideWords = sd => (sd === 'r' ? 'sağ right dexter rechts' : sd === 'l' ? 'sol left sinister links' : '');
    // Baştaki sıra numarası yok sayılır: "1. kaburga", "1. Rippe" de "kaburga", "Rippe" aramasında tam eşleşme sayılır.
    const namesOf = o => [o.tr, o.n, o.la, o.de].filter(Boolean).map(s => fold(s).replace(/^\d+ /, ''));
    for (const r of model.list) index.push({ kind: 'item', o: r, key: fold(`${r.tr || ''} ${r.n} ${r.la || ''} ${r.de || ''} ${sideWords(r.sd)}`), name: fold(titleName(r)), names: namesOf(r) });
    // hızlı görünümler: aramada yapılardan önce gelir (anahtar sözcüklerin hepsi dört dilde ve yaygın yazımlarıyla)
    for (const v of QUICK) index.push({ kind: 'view', o: v, key: fold(`${v.label} ${v.words}`), name: fold(v.label), names: [v.label, ...v.words.split(',')].map(x => fold(x.trim())) });
    for (const g of model.groups) index.push({ kind: 'group', o: g, key: fold(`${g.tr || ''} ${g.n} ${g.la || ''} ${g.de || ''}`), name: fold(titleName(g)), names: namesOf(g) });
  }
  const QUICK = [
    { key: 'cn', label: 'Kraniyal sinirler (I–XII)', sub: 'Hızlı görünüm: beyin modu › Sinirler, çıkış yerleri', run: () => actions.cranialNerves(''),
      words: 'kraniyal sinirler, kranial sinirler, kafa çiftleri, beyin sinirleri, cranial nerves, nervi craniales, hirnnerven, kraniyal, kranial, cranial, hirnnerv' },
    { key: 'peel', label: 'Derin kaslar: üst kas katmanını kaldır', sub: 'Hızlı görünüm: Araçlar › Kas katmanı', run: () => actions.peel(1),
      words: 'derin kaslar, kas katmanı, katman, deep muscles, tiefe muskeln, muskelschicht, soy, yüzeyel kaslar, oberflächliche' },
  ];
  const SIDE_TOKENS = new Set(['sag', 'sol', 'right', 'left', 'dexter', 'sinister', 'rechts', 'links']);
  // Sonuç satırı kartla aynı düzende: Latince ad, altında Almanca. Arama yalnızca Türkçe ya da İngilizce adla
  // eşleştiyse Almanca yerine eşleşen ad gösterilir; böylece sonucun neden çıktığı görülür.
  const hintFor = (o, core) => {
    const has = s => s && core.every(t => fold(s).includes(t));
    if (core.length && !has(o.la) && !has(o.de)) for (const s of [o.tr, o.n]) if (s !== titleName(o) && has(s)) return s;
    return subtitleName(o) || (o.tr && o.tr !== titleName(o) ? o.tr : '');
  };
  function runSearch(q) {
    const toks = fold(q).split(' ').filter(Boolean);
    if (!toks.length) { shown = []; el.results.hidden = true; return; }
    // Sıralama: herhangi bir dildeki adı aramayla tam aynı olanlar önce (taraf sözcükleri hariç: "sol femur" -> Femur),
    // sonra herhangi bir dildeki adı arama sözcüğüyle başlayanlar, sonra bir sözcüğü öyle başlayanlar; eşitlikte kısa ad önce.
    const core = toks.filter(t => !SIDE_TOKENS.has(t)); const coreQ = core.join(' ');
    const out = [];
    for (const e of index) {
      if (!toks.every(t => e.key.includes(t))) continue;
      const starts = e.names.filter(n => core.some(t => n.startsWith(t)));
      let score = coreQ && e.names.includes(coreQ) ? -1 : starts.length ? 0 : (' ' + e.key).includes(' ' + (core[0] || toks[0])) ? 1 : 2;
      if (e.kind === 'view') score = -2;
      else if (e.kind === 'group') score += 0.5;
      // kas yapışma yerleri (İskelet sistemi > Kas yapışmaları: origo / insertio yamaları) aynı eşleşme düzeyinde kasın
      // kendisinden, başlarından ve kas grubundan sonra gelir; gizlenmez ("biceps brachii" önce kası getirir)
      else if (e.o.sub === 'attach') score += 0.6;
      if (e.kind === 'topic') score += 0.7;   // Aanki konuları yapı ve gruplardan sonra
      // gosterilmeyen bedene ozgu yapilar en sona: kadin bedeninde "Harnröhre" once kadin uretrasini getirir
      if (bothSexes()) { const x = e.kind === 'group' ? sexOfGroup(e.o.i) : e.o.x; if (x && x !== state.sex) score += 4; }
      const len = starts.length ? Math.min(...starts.map(sortLength)) : sortLength(e.name);
      out.push({ e, score: score * 1000 + len });
    }
    out.sort((a, b) => a.score - b.score || byName(a.e.o, b.e.o));   // eşitlikte ağaçtaki sıra: Costa prima, secunda…
    shown = out.slice(0, 40).map(o => o.e); active = shown.length ? 0 : -1;
    el.results.innerHTML = shown.length ? shown.map((e, i) => {
      if (e.kind === 'view') return `<button class="res${i === active ? ' on' : ''}" data-i="${i}"><i class="dot view"></i><span class="label"><span class="t">${esc(e.o.label)}</span><small>${esc(e.o.sub)}</small></span><span class="tag">görünüm</span></button>`;
      if (e.kind === 'topic') return `<button class="res${i === active ? ' on' : ''}" data-i="${i}" title="${esc(`${e.o.place}\n${e.o.title}`)}"><i class="dot aanki"></i><span class="label"><span class="t" lang="de">${esc(e.o.label)}</span><small>${esc(e.o.place)}</small></span><span class="tag">Aanki</span></button>`;
      const o = e.o, hint = hintFor(o, core);
      const end = e.kind === 'group' ? sexMark(sexOfGroup(o.i)) + '<span class="tag">grup</span>' : sexMark(o.x) + (o.sd ? `<span class="side ${o.sd}">${SIDE[o.sd]}</span>` : '');
      return `<button class="res${i === active ? ' on' : ''}" data-i="${i}" title="${namesTip(o)}"><i class="dot ${o.s}"></i><span class="label"><span class="t"${o.la ? ' lang="la"' : ''}>${esc(titleName(o))}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span>${end}</button>`;
    }).join('') : `<div class="nores">Sonuç yok</div>`;
    el.results.hidden = false;
  }
  function choose(i) {
    const e = shown[i]; if (!e) return;
    el.results.hidden = true; el.search.blur();
    if (e.kind === 'view') e.o.run();
    else if (e.kind === 'topic') actions.selectTopic(e.o.id);
    else if (e.kind === 'group') actions.selectGroup(e.o.i, { focus: true }); else actions.selectItem(e.o.id, { focus: true });
  }
  el.search.addEventListener('input', () => runSearch(el.search.value));
  el.search.addEventListener('focus', () => { if (el.search.value) runSearch(el.search.value); });
  el.search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      $$('.res', el.results).forEach((b, i) => b.classList.toggle('on', i === active));
      $('.res.on', el.results)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { el.results.hidden = true; el.search.blur(); }
    e.stopPropagation();
  });
  el.results.addEventListener('mousedown', e => { const b = e.target.closest('.res'); if (b) { e.preventDefault(); choose(+b.dataset.i); } });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#search-wrap')) el.results.hidden = true; });

  // ---------- ipucu balonu ----------
  function tooltip(rec, x, y) {
    if (!rec) { el.tooltip.hidden = true; return; }
    // Kartla aynı düzen: kalın Latince, altında Almanca (Almanca yoksa Türkçe).
    const title = titleName(rec), sub = subtitleName(rec) || (rec.tr && rec.tr !== title ? rec.tr : '');
    el.tooltip.innerHTML = `<b>${esc(title)}</b>${rec.sd ? `<span class="side ${rec.sd}">${SIDE[rec.sd]}</span>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    el.tooltip.hidden = false;
    const w = el.tooltip.offsetWidth, h = el.tooltip.offsetHeight;
    el.tooltip.style.left = Math.min(x + 16, window.innerWidth - w - 8) + 'px';
    el.tooltip.style.top = Math.min(y + 18, window.innerHeight - h - 8) + 'px';
  }

  // ---------- genel güncelleme ----------
  function update({ reveal: doReveal } = {}) {
    for (const b of $$('button[data-mode]', el.modes)) b.classList.toggle('active', b.dataset.mode === state.mode);
    for (const seg of $$('.seg[data-layer]', el.layers)) for (const b of $$('button', seg)) b.classList.toggle('active', state.layer[seg.dataset.layer] === b.dataset.st);
    for (const c of $$('input[data-sub]', el.layers)) c.checked = state.sub[c.dataset.sub] !== false;
    for (const l of $$('.layer', el.layers)) {
      l.classList.toggle('current', l.dataset.sys === state.mode);
      l.classList.toggle('off', state.layer[l.dataset.sys] === 'hide');   // gizli katmanın alt katmanları yer kaplamasın
    }
    el.isolateBar.hidden = !state.isolate;
    if (el.peelTool) { const h = peelHTML(null); el.peelTool.hidden = !h; if (h) el.peelTool.querySelector('.peel-slot').innerHTML = h; }
    el.sex.hidden = !bothSexes();
    for (const b of $$('button[data-sex]', el.sex)) { const on = b.dataset.sex === state.sex; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
    renderInfo();
    if (doReveal && state.primary?.type === 'item') reveal(model.items.get(state.primary.id));
    markTree();
    markAanki();
  }

  // Aanki konuları yüklenince: ağacın ikinci görünümü ve aramadaki konular
  function setAanki(a, sexOf, askable, view) {
    aanki = a; if (sexOf) topicSexOf = sexOf; if (askable) topicAskable = askable; if (view) topicViewOf = view;
    el.treeView.hidden = false;
    buildAanki();
    for (const t of aanki.topics) {
      const names = [t.title, t.label].map(fold);
      index.push({ kind: 'topic', o: t, key: fold(`${t.label} ${t.place} ${t.fach || ''} aanki${t.kind === 'abp' ? ' abp lerntag' : ''}`), name: fold(t.title), names });
    }
    let v = 'sys'; try { v = localStorage.getItem(TREE_KEY) || 'sys'; } catch { /* varsayılan */ }
    setTreeView(v);
  }

  return {
    buildLayers, buildTree, buildIndex, update, tooltip, setAanki,
    setMuscles(mu) { muscles = mu; update(); },
    setTours(list) { tours = list || []; },
    registerPanel(type, p) { panels[type] = p; },
    setPending(sys, on, failed = false) {
      const b = $(`button[data-mode="${sys}"]`, el.modes); if (!b) return;
      b.classList.toggle('pending', on); b.classList.toggle('failed', failed);
      if (failed) b.title = `${SYSTEMS[sys].label}: model yüklenemedi`;
    },
    // "Sistemleri gerektiğinde yükle" açıkken henüz istenmemiş sistem: soluk, ilk dokunuşta yüklenir
    setIdle(sys, on) {
      const b = $(`button[data-mode="${sys}"]`, el.modes); if (!b || b.classList.contains('failed')) return;
      b.classList.toggle('idle', on);
      b.title = on ? `${b.dataset.title}: seçince yüklenir` : b.dataset.title;
    },
    // Seçilen yapının sistemi hâlâ yükleniyorsa kısa bir bilgi göster (sys = null: gizle).
    setLoadingHint(sys) { clearTimeout(toastTimer); el.toast.hidden = !sys; if (sys) el.toast.textContent = `${SYSTEMS[sys].title} yükleniyor…`; },
    // Kısa bilgi (ör. "Kadın anatomisine geçildi"), birkaç saniye sonra kaybolur.
    notify(text) { clearTimeout(toastTimer); el.toast.textContent = text; el.toast.hidden = false; toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2500); },
    setLoading(text, frac) { el.loadText.textContent = text; el.loadBar.style.width = Math.round(frac * 100) + '%'; },
    hideLoading() { el.loading.classList.add('done'); setTimeout(() => { el.loading.hidden = true; }, 400); },
    fail(msg) { el.loadText.textContent = msg; el.loading.classList.add('error'); },
  };
}
