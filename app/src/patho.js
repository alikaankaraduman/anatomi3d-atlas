// Patoloji vakaları (pilot): topografik patoloji. Her vaka bir klinik tablo (Befund) ve tek soruyla başlar; soru cevaplanınca
// (ya da "Tabloyu şimdi göster" ile) 3B görünüm lezyonu gösterir:
//  - Sinir vakası: sol kol ya da bacak; sinir sarı, lezyon yeri kırmızı nokta, lezyonun altında dalını alan kaslar mor
//    (felçli), aynı sinirin sağlam kalan kasları turuncu, bölgenin öteki kasları saydam. Felçli kas listesi Hareket
//    modunun lezyon yeriyle aynıdır (tools/patho-build.mjs denetler).
//  - Beyin vakası: sol yarımküre; tıkanan arter kırmızı, etkilenen alan (model parçaları) turuncu, beynin kalanı saydam.
//    MCA dışarıdan, ACA ve PCA içten (sağ yarımküre gizli), derin ve beyin sapı vakaları önden-yandan görünür.
//  - Kranial sinir vakası: baş ve boyun, sol taraf; beyin sapı ve kafatası saydam, öteki kranial sinirler soluk, etkilenen
//    sinir sarı, çekirdek ya da Chiasma lezyonu kırmızı, lezyon noktası kırmızı top (data/work/patho/cranial-points.json'dan
//    derlenen struktur.p); gösterilince felçli kaslar mor, aynı sinirin sağlam kasları turuncu.
// Metinler data/patho.json'da (ilk girişte yüklenir; kaynak data/work/patho/cases.json). Sinir vakaları lezyon noktasını ve
// sinirin bölgesini data/locomotor.json'dan alır. Şıklar vaka açılınca karışır; soru dili test diline (testlang) uyar.
import * as THREE from 'three';
import { titleName, esc } from './text.js';
import { tint, solid, hex, nameIndex, anchorOf, isExploded, createLabels, shuffle } from './study.js';
import { getLang } from './testlang.js';

const COL = { nerve: 0xf5d742, lost: 0x9a6cf0, kept: 0xd9705f, artery: 0xe0302a, terr: 0xf0923f, mark: 0xff4d3d };
const BONES = { arm: ['Bones of upper limb'], leg: ['Bones of lower limb'] };
const BONE_CTX = { arm: ['Thoracic skeleton', 'Vertebral column'], leg: ['Vertebral column'] };
const MUSCLES = { arm: ['Muscular system of upper limb'], leg: ['Muscular system of lower limb'] };
const BRAIN = ['Frontal lobe', 'Parietal lobe', 'Occipital lobe', 'Temporal lobe', 'Limbic lobe', 'Interlobar sulci', 'Basal forebrain', 'White matter of telencephalon', 'Corpus striatum', 'Diencephalon', 'Brainstem', 'Cerebellum'];
const CORTEX = new Set(['Frontal lobe', 'Parietal lobe', 'Occipital lobe', 'Temporal lobe', 'Limbic lobe', 'Interlobar sulci']);
// bakış: lateral (sol yarımküre dışarıdan), medial (sol yarımkürenin iç yüzü; sağ yarımküre gizli), deep (önden-yandan, korteks saydam)
const VIEW = { mca: 'lateral', aca: 'medial', pca: 'medial' };
const HEAD_MUSCLES = ['Muscles of head', 'Muscles of neck'];
const CN_PARTS = ['Olfactory nerve (I)', 'Optic nerve (II)', 'Optic chiasm', 'Optic tract', 'Oculomotor nerve (III)', 'Trochlear nerve (IV)', 'Trigeminal nerve (V)', 'Sensory root of trigeminal nerve', 'Motor root of trigeminal nerve', 'Ophthalmic nerve', 'Maxillary nerve', 'Anterior division of mandibular nerve', 'Buccal nerve', 'Posterior division of mandibular nerve', 'Inferior alveolar nerve', 'Mental nerve', 'Nerve to mylohyoid muscle', 'Lingual nerve', 'Abducens nerve (VI)', 'Facial nerve (VII)', 'Chorda tympani', 'Vestibulocochlear nerve (VIII)', 'Vestibular nerve', 'Cochlear nerve', 'Glossopharyngeal nerve (IX)', 'Vagus nerve (X)', 'Accessory nerve (XI)', 'Hypoglossal nerve (XII)'];
// modelin bu vakada gösteremedikleri (data/work/patho/notes.md)
const MODEL_NOTE = {
  'lenticulostriata-capsula-interna': 'Modelde Capsula interna yok: asıl lezyon yeri (Crus posterius) gösterilemiyor; turuncu alan çevresindeki Putamen, Globus pallidus ve Nucleus caudatus.',
  'basilaris-locked-in': 'Modelde Pons tek parça: Basis pontis ile Tegmentum ayrılmıyor, bu yüzden bütün Pons turuncu.',
  'pica-wallenberg': 'Modelde Medulla oblongata tek parça: dorsolateral bölge ayrı gösterilemiyor.',
  'spinalis-anterior': 'Omurilik yolları modelde baştan sona tek parça: segmental (torakolomber) lezyon gösterilemiyor, yolun tamamı turuncu. A. spinalis anterior modelde yalnız omuriliğin üst ucunda var.',
  'medianus-karpaltunnel': 'Mm. lumbricales modelde tek parça: aslında yalnız I-II felçli.',
  'ulnaris-sulcus': 'M. flexor digitorum profundus ve Mm. lumbricales modelde tek parça: aslında yalnız ulnar yarı (III-IV) felçli.',
  'gluteus-superior-trendelenburg': 'Modelde Foramen suprapiriforme kapalı; lezyon noktası yaklaşık.',
  'gluteus-inferior-tep': 'N. gluteus inferior modelde yok: lezyon yalnız Foramen infrapiriforme\'deki kırmızı noktayla gösteriliyor.',
  'ulnaris-guyon': 'Modelde N. ulnaris bilekte ders kitabındaki yerinden biraz farklı geçiyor; Guyon noktası yaklaşık.',
  'musculocutaneus-coracobrachialis': 'Modelde sinir M. coracobrachialis\'i ders kitabındaki yerinden biraz farklı deliyor; lezyon noktası yaklaşık.',
  'ischiadicus-hueftluxation': 'Modelde N. ischiadicus gluteal bölgede ders kitabındaki yerinden biraz farklı geçiyor; lezyon noktası yaklaşık.',
};

const V3 = p => new THREE.Vector3(p[0], p[1], p[2]);
const noPick = mat => { mat.userData.noPick = true; return mat; };
const sw = (c, t = '') => `<span class="sw" style="background:${hex(c)}"></span>${t}`;

export function createPatho({ stage, model, state, refresh, defer, viewLayers, endStudy, ui, actions }) {
  let built = false, active = false, D = null, LO = null, loading = null, enterSeq = 0;
  const p = { i: 0, order: null, pick: null, shown: false, sex: null, score: {} };
  const { recs, groupRecs } = nameIndex(model, state);
  const ids = rs => new Set(rs.map(r => r.id));
  const L = r => r.sd === 'l' || (!r.sd && !(r.sphere && r.sphere.center.x < -2));
  const sexOk = r => !r.x || r.x === state.sex;
  const grp = names => [...new Set(names.flatMap(groupRecs))].filter(sexOk);
  const lrecs = names => recs(names || []).filter(L);
  const boxOf = rs => { const b = new THREE.Box3(); for (const r of rs) b.union(r.box); return b; };
  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const marks = new THREE.Group(); root.add(marks);
  const labels = createLabels(stage);
  let mats = null, ownGhost = null;

  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const load = () => loading ||= Promise.all([get('data/patho.json'), get('data/locomotor.json')])
    .then(([a, b]) => { D = a; LO = b; })
    .catch(e => { loading = null; console.warn('patoloji verisi yüklenemedi:', e); ui?.notify?.('Patoloji verisi yüklenemedi'); throw e; });

  const cur = () => D.cases[p.i];
  const nerveOf = c => { const k = (c.struktur.site || '').split('@')[0]; return LO.nerves.list.find(n => n.key === k); };
  const siteOf = c => { const nv = nerveOf(c), k = (c.struktur.site || '').split('@')[1]; return nv?.sites?.find(s => s.key === k); };
  const lang = () => (getLang() === 'tr' ? 'tr' : 'de');

  function build() {
    if (built) return;
    mats = {
      nerve: solid(COL.nerve, 0.35), lost: solid(COL.lost, 0.2), kept: solid(COL.kept, 0.1),
      ghostM: tint(0xd9a79d, 0.03, 0.3), ctx: noPick(tint(0xc9c0bc, 0.012, 0.18)), ctxN: noPick(tint(0xc9c0bc, 0.02, 0.28)),
      artery: solid(COL.artery, 0.3), terr: solid(COL.terr, 0.22), cord: tint(0xe9d9a0, 0.03, 0.35),
      lesion: solid(COL.mark, 0.35), lostT: tint(COL.lost, 0.4, 0.9), keptT: tint(COL.kept, 0.35, 0.85), cnCtx: noPick(tint(0xe8dca0, 0.03, 0.3)),
      mark: new THREE.MeshBasicMaterial({ color: COL.mark, depthTest: false, transparent: true }),
    };
    built = true;
  }

  // --- 3B ---
  const ballGeo = new THREE.SphereGeometry(1, 16, 12);
  function setMark(pt) {
    marks.clear();
    if (!pt) return;
    const s = new THREE.Mesh(ballGeo, mats.mark); s.position.copy(pt); s.scale.setScalar(0.42); s.renderOrder = 6; marks.add(s);
  }
  // sinir vakası: bölge, sinir; gösterilince felçli ve sağlam kaslar, lezyon noktası
  function nerveScene(c) {
    const nv = nerveOf(c), reg = nv?.region === 'leg' ? 'leg' : 'arm';
    const bones = grp(BONES[reg]).filter(r => r.sub !== 'attach' && L(r));
    const all = grp(MUSCLES[reg]).filter(r => r.sub === 'muscle' && L(r));
    const nerve = lrecs([...new Set([...(nv?.n || []), ...c.struktur.n])]);
    const ov = model.overrides, list = [];
    let extra = [];
    if (p.shown) {
      const lost = new Set(c.folge.paralysed), own = lrecs((nv?.muscle_groups || []).flatMap(g => g.n)), ownIds = ids(own);
      const lostRecs = lrecs(c.folge.paralysed);
      for (const r of all) if (!ownIds.has(r.id) && !lost.has(r.n)) ov.set(r.id, mats.ghostM);
      for (const r of own) ov.set(r.id, lost.has(r.n) ? mats.lost : mats.kept);
      for (const r of lostRecs) ov.set(r.id, mats.lost);
      extra = [...own, ...lostRecs];
      const g = LO.geo?.sites?.[c.struktur.site];
      if (g?.p) {
        const pt = V3(g.p); setMark(pt);
        const s = siteOf(c);
        list.push({ text: `<b>${esc((s?.de || s?.la || 'Läsion').split(' (')[0])}</b>`, p: g.out ? pt.clone().addScaledVector(V3(g.out), 2.2) : pt, at: pt, cls: 'on' });
      }
    } else for (const r of all) ov.set(r.id, mats.ghostM);
    for (const r of nerve) ov.set(r.id, mats.nerve);
    const ghost = grp(BONE_CTX[reg]).filter(r => r.sub !== 'attach' && L(r));
    return { iso: [...bones, ...all, ...extra, ...nerve], ghost, list };
  }
  // beyin vakası: beyin; gösterilince arter ve etkilenen alan
  function brainScene(c) {
    const view = viewOf(c), side = sideOf(c);
    const seen = new Set(), parts = [];
    for (const n of BRAIN) for (const r of groupRecs(n)) if (sexOk(r) && !seen.has(r.id)) { seen.add(r.id); parts.push({ r, ctx: CORTEX.has(n) }); }
    const keep = view === 'orbit' ? [] : view === 'medial' ? parts.filter(x => L(x.r)) : parts;
    const eye = view === 'orbit' ? grp(['Eyeball']).filter(L) : [];   // orbita vakası: beyin yok, göz küresi saydam
    const cord = c.struktur.artery === 'asa' ? groupRecs('Spinal cord') : [];
    const ov = model.overrides, list = [];
    const terr = p.shown ? side(c.folge.territory) : [];
    const art = p.shown ? side(c.struktur.n) : [];
    const terrIds = ids(terr), artIds = ids(art);
    for (const { r, ctx } of keep) if (!terrIds.has(r.id) && !artIds.has(r.id)) {
      if (p.shown || view === 'deep') ov.set(r.id, view === 'deep' && ctx ? mats.ctx : mats.ctxN);
    }
    for (const r of cord) if (!terrIds.has(r.id)) ov.set(r.id, mats.cord);
    for (const r of eye) if (!terrIds.has(r.id)) ov.set(r.id, mats.ctxN);
    for (const r of terr) ov.set(r.id, mats.terr);
    for (const r of art) ov.set(r.id, mats.artery);
    setMark(null);
    if (art.length) list.push({ text: `<b>${esc(artName(c))}</b>`, p: anchorOf(art), cls: 'on' });
    if (terr.length) list.push({ text: 'Infarkt', p: anchorOf(terr), cls: '' });
    return { iso: [...keep.map(x => x.r), ...cord, ...eye, ...terr, ...art], ghost: [], list };
  }
  // kranial sinir vakası: baş-boyun kasları, beyin sapı, kranial sinirler; gösterilince felçli ve sağlam kaslar
  function cranialScene(c) {
    const st = c.struktur, cn = st.cn || [];
    const all = grp([...HEAD_MUSCLES, ...(cn.includes('XI') ? ['Trapezius muscle'] : [])]).filter(r => r.sub === 'muscle' && L(r));
    const both = cn.includes('II');   // görme yolu: iki göz ve iki N. opticus (Chiasma orta hatta)
    const eye = grp(['Eyeball']).filter(r => both || L(r)), stem = groupRecs('Brainstem');
    const nerve = both ? recs(st.n) : lrecs(st.n), nerveIds = ids(nerve), lesion = lrecs(st.lesion), lesionIds = ids(lesion);
    const others = lrecs(CN_PARTS).filter(r => !nerveIds.has(r.id) && !lesionIds.has(r.id));
    const ov = model.overrides, list = [];
    let extra = [];
    for (const r of stem) if (!lesionIds.has(r.id)) ov.set(r.id, mats.ctxN);
    for (const r of eye) ov.set(r.id, mats.ctxN);
    for (const r of others) ov.set(r.id, mats.cnCtx);
    const lost = new Set(p.shown ? c.folge.paralysed : []), kept = new Set(p.shown ? c.folge.kept || [] : []);
    for (const r of all) if (!lost.has(r.n) && !kept.has(r.n)) ov.set(r.id, mats.ghostM);
    setMark(null);
    if (p.shown) {
      const lr = lrecs(c.folge.paralysed), kr = lrecs(c.folge.kept || []);
      for (const r of kr) ov.set(r.id, mats.keptT);   // yarı saydam: sinir kasların içinden görünsün
      for (const r of lr) ov.set(r.id, mats.lostT);
      extra = [...lr, ...kr];
      for (const r of lesion) ov.set(r.id, mats.lesion);
      const pt = st.p ? V3(st.p) : lesion.length ? anchorOf(lesion) : null;
      if (st.p) setMark(pt);
      if (pt) list.push({ text: `<b>${esc(cranialName(c))}</b>`, p: st.p ? pt.clone().add(new THREE.Vector3(2.5, 1.8, 1)) : pt, at: st.p ? pt : undefined, cls: 'on' });   // etiket yana, çizgiyle noktaya
    }
    for (const r of nerve) if (!lesionIds.has(r.id)) ov.set(r.id, mats.nerve);
    const skull = grp(['Cranium']).filter(r => r.sub !== 'attach' && L(r));
    return { iso: [...all, ...eye, ...stem, ...others, ...nerve, ...lesion, ...extra], ghost: skull, list };
  }
  const CN_LABEL = { 'foramen-jugulare': 'Foramen jugulare' };   // birden çok sinirin ortak lezyon yeri
  const cranialName = c => CN_LABEL[c.key] || (c.struktur.lesion?.length ? nameOf(c.struktur.lesion[0]) : nameOf(c.struktur.n[0]));
  // bakış vakada verilebilir (struktur.view: lateral | medial | deep | orbit); struktur.both: alan iki taraflı (ör. Percheron)
  const viewOf = c => c.struktur.view || VIEW[c.struktur.artery] || 'deep';
  const sideOf = c => (c.struktur.both ? recs : lrecs);
  const artName = c => { const r = recs([c.struktur.n[0]])[0]; return r ? (r.la || titleName(r)) : c.struktur.n[0]; };

  function apply() {
    model.overrides.clear(); marks.clear();
    const c = cur(), s = c.system === 'nerve' ? nerveScene(c) : c.system === 'cranial' ? cranialScene(c) : brainScene(c);
    state.isolate = ids(s.iso);
    state.isoGhost = ownGhost = s.ghost.length ? ids(s.ghost) : null;
    labels.set(s.list);
  }
  function frame() {
    const c = cur();
    let box, dir = new THREE.Vector3(0.7, 0.12, 1);
    if (c.system === 'nerve') {
      const nv = nerveOf(c), own = lrecs([...(nv?.muscle_groups || []).flatMap(g => g.n), ...c.folge.paralysed]);
      box = boxOf(own.length ? own : lrecs(c.struktur.n));
      const g = LO.geo?.sites?.[c.struktur.site];
      if (g?.p) box.expandByPoint(V3(g.p));
      if (g?.out) { dir = V3(g.out); dir.y = Math.max(dir.y, 0.1); }
    } else if (c.system === 'cranial') {
      const st = c.struktur;
      box = boxOf([...lrecs([...st.n, ...(st.lesion || []), ...c.folge.paralysed, ...(c.folge.kept || [])]), ...groupRecs('Brainstem')]);
      if (st.p) box.expandByPoint(V3(st.p));
      dir = (st.cn || []).includes('II') ? new THREE.Vector3(0.25, -0.55, 1) : new THREE.Vector3(0.9, 0.15, 0.8);
    } else {
      const view = viewOf(c), terr = sideOf(c)(c.folge.territory);
      box = boxOf(view === 'deep' ? [...terr, ...lrecs(c.struktur.n)] : grp(['Frontal lobe', 'Occipital lobe', 'Temporal lobe']).filter(L));
      if (view === 'deep') box.union(boxOf(groupRecs('Brainstem'))).expandByScalar(1.5);   // derin vakalar: beyin sapıyla birlikte, biraz uzaktan
      if (view === 'orbit') box = boxOf([...terr, ...lrecs(c.struktur.n), ...grp(['Eyeball']).filter(L)]);
      if (c.struktur.artery === 'asa') box = boxOf(lrecs(c.struktur.n).length ? lrecs(c.struktur.n) : groupRecs('Spinal cord'));
      dir = view === 'orbit' ? new THREE.Vector3(0.55, 0.2, 1) : view === 'lateral' ? new THREE.Vector3(1, 0.2, 0.1) : view === 'medial' ? new THREE.Vector3(-1, 0.15, 0.08) : new THREE.Vector3(0.7, -0.05, 1);
    }
    if (box && !box.isEmpty()) stage.frameBox(box, dir);
  }

  // spec: vaka anahtarı ya da sırası (ör. 'radialis-sulcus'); boşsa son açılan vaka
  function enter(spec = '') {
    for (const s of ['muscle', 'nerve', 'vessel', 'organ']) if (!model.loaded[s]) { defer(s, () => enter(spec)); return; }
    if (!D) { const seq = ++enterSeq; load().then(() => { if (seq === enterSeq) enter(spec); }, () => {}); return; }
    build();
    endStudy?.('patho');
    const k = String(spec || ''), i = D.cases.findIndex(c => c.key === k);
    if (i >= 0) open(i, false); else if (!p.order) open(p.i, false);
    active = true; p.sex = state.sex; root.visible = true; wasExploded = null;
    state.selected = new Set(); state.primary = { type: 'patho' };
    viewLayers({ bone: 'show', muscle: 'show', nerve: 'show', vessel: 'show', joint: 'show', organ: 'show' });
    apply(); refresh(); frame();
  }
  function open(i, redraw = true) {
    p.i = (i + D.cases.length) % D.cases.length; p.pick = null; p.shown = false;
    p.order = shuffle(cur().frage.options_de.map((_, j) => j));
    if (redraw) { apply(); refresh(); frame(); }
  }
  function cleanup() {
    active = false; enterSeq++;
    model.overrides.clear(); if (ownGhost && state.isoGhost === ownGhost) state.isoGhost = null;
    ownGhost = null; root.visible = false; marks.clear(); labels.set([]);
  }
  function sync() {
    if (!active) return;
    if (state.primary?.type !== 'patho') { cleanup(); return; }
    if (p.sex !== state.sex) { p.sex = state.sex; apply(); }
  }
  function highlight() {
    if (!active || !D || !p.shown) return [];
    const c = cur();
    return lrecs(c.struktur.n).filter(r => r.vis).map(r => r.mesh);
  }
  function onPick(id) {
    if (!active) return false;
    return true;   // vaka görünümünde tıklama paneli değiştirmez
  }
  let wasExploded = false;
  stage.onFrame(() => {
    if (!active || !D) return false;
    const rs = [...(state.isolate || [])].slice(0, 40).map(id => model.items.get(id)).filter(r => r?.mesh);
    const exploded = isExploded(rs);
    if (exploded !== wasExploded) { wasExploded = exploded; root.visible = !exploded; labels.hide(exploded); }
    if (!exploded) labels.place();
    return false;
  });

  // --- panel ---
  const nameOf = n => { const r = recs([n])[0]; return r ? (r.la || titleName(r)) : n; };
  const uniq = a => [...new Set(a)];
  function panelHTML() {
    if (!D) return '<p class="htext">Yükleniyor…</p>';
    const c = cur(), f = c.frage, lg = lang(), other = lg === 'de' ? 'tr' : 'de';
    const groups = [['arm', 'Kol sinirleri'], ['leg', 'Bacak sinirleri'], ['cranial', 'Kranial sinirler'], ['brain', 'Beyin ve omurilik infarktları']];
    const grpOf = x => (x.system === 'brain' ? 'brain' : x.system === 'cranial' ? 'cranial' : nerveOf(x)?.region === 'leg' ? 'leg' : 'arm');
    const done = Object.values(p.score), right = done.filter(Boolean).length;
    const opts = f['options_' + lg];
    const answered = p.pick !== null;
    const optsHTML = `<div class="qopts" lang="${lg}">${p.order.map(j => {
      const cls = answered ? (j === 0 ? 'ok' : p.pick === j ? 'bad' : '') : '';
      return `<button class="qopt ${cls}" data-po="${j}"${answered ? ' disabled' : ''}><b>${esc(opts[j])}</b></button>`;
    }).join('')}</div>`;
    const legend = c.system !== 'brain'
      ? `${sw(COL.nerve, 'sinir')} ${sw(COL.mark, 'lezyon')} ${c.folge.paralysed.length ? sw(COL.lost, 'felçli') + ' ' : ''}${c.system === 'nerve' || c.folge.kept?.length ? sw(COL.kept, 'aynı sinir, sağlam') : ''}`
      : `${sw(COL.artery, 'tıkanan arter')} ${sw(COL.terr, 'etkilenen alan')}`;
    const where = c.system === 'cranial' ? `<span lang="la">${(c.struktur.cn || []).map(k => 'N. ' + k).join(', ')} · ${esc(cranialName(c))}</span>`
      : c.system === 'nerve' ? (() => { const s = siteOf(c), nv = nerveOf(c); return `<span lang="la">${esc(nv?.la || '')}</span>${s ? ` · <span lang="de">${esc(s.de || s.la || '')}</span>` : ''}`; })()
      : `<span lang="la">${esc(artName(c))}</span>`;
    const affected = uniq(c.system !== 'brain' ? c.folge.paralysed.filter(n => !/tendon/i.test(n)) : c.folge.territory).map(nameOf);
    const reveal = p.shown ? `
      <div class="lesion">
        <h2>Lezyon</h2>
        <p class="htext">${where}</p>
        <div class="legend">${legend}</div>
      </div>
      <details class="clinic" open><summary>Mechanismus</summary><p lang="de">${esc(c.mechanismus_de)}</p><p class="htext small dim">${esc(c.mechanismus_tr)}</p></details>
      <details class="clinic" open><summary>Ausfälle</summary>${c.folge.deficits_de.map((d, j) => `<p><b lang="de">${esc(d)}</b><br><small>${esc(c.folge.deficits_tr[j] || '')}</small></p>`).join('')}</details>
      ${affected.length ? `<details class="clinic"><summary>${c.system !== 'brain' ? 'Felçli kaslar' : 'Etkilenen yapılar'} (${affected.length})</summary><p lang="la">${affected.map(esc).join(', ')}</p></details>` : '<p class="htext small">Kas felci yok: yalnız duyu kaybı.</p>'}
      ${MODEL_NOTE[c.key] || c.model_note_tr ? `<div class="tip">${esc(MODEL_NOTE[c.key] || c.model_note_tr)}</div>` : ''}
      <div class="btns">${c.system === 'cranial' ? `<button data-pg="cn" title="Bu siniri Beyin modunda, Sinirler bölümünde aç">Beyin modunda aç</button>` : c.system === 'nerve' ? `<button data-pg="loco" title="Bu siniri bütün lezyon yerleriyle Hareket modunda aç">Hareket modunda aç</button>` : `<button data-pg="brain" title="Beyin arterlerini ve beslenme alanlarını Beyin modunda aç">Beyin modunda aç</button>`}</div>`
      : `<div class="btns"><button data-pa="show" title="Soruyu cevaplamadan lezyonu 3B görünümde göster">Tabloyu şimdi göster</button></div>`;
    return `
      <div class="chips"><span class="chip loco">Patoloji vakaları</span><span class="chip dim">pilot</span></div>
      <div class="field"><select data-psel="case" aria-label="Vaka">${groups.map(([k, t]) => `<optgroup label="${t}">${D.cases.map((x, j) => grpOf(x) === k ? `<option value="${j}"${j === p.i ? ' selected' : ''}>${j + 1}. ${esc(x.title_de)}${p.score[x.key] === true ? ' ✓' : p.score[x.key] === false ? ' ✗' : ''}</option>` : '').join('')}</optgroup>`).join('')}</select></div>
      <div class="btns"><button data-pa="prev" title="Önceki vaka">◀</button><span class="htext small dim">${p.i + 1} / ${D.cases.length}${done.length ? ` · ${right}/${done.length} doğru` : ''}</span><button data-pa="next" title="Sonraki vaka">▶</button></div>
      <h1 class="name" lang="de">${esc(c.title_de)}</h1>
      <p lang="de" class="htext">${esc(c.befund_de)}</p>
      <details class="clinic"><summary>Türkçe</summary><p class="htext small">${esc(c.befund_tr)}</p></details>
      <p class="htext qtext" lang="${lg}"><b>${esc(f['q_' + lg])}</b></p>
      ${optsHTML}
      ${answered ? `<div class="qres ${p.pick === 0 ? 'ok' : 'bad'}">${p.pick === 0 ? (lg === 'de' ? 'Richtig' : 'Doğru') : (lg === 'de' ? 'Falsch' : 'Yanlış')}</div>
        <p class="htext" lang="${lg}">${esc(f['explain_' + lg])}</p>
        <details class="clinic"><summary>${other === 'tr' ? 'Türkçe' : 'Deutsch'}</summary><p class="htext small" lang="${other}"><b>${esc(f['q_' + other])}</b></p><p class="htext small" lang="${other}">${esc(f['explain_' + other])}</p></details>` : ''}
      ${reveal}
      <p class="htext small dim">Vakalar yapay zekâyla yazıldı ve kaynaklarla denetlendi; bir hekim ya da anatomist bakmadı.</p>
      <div class="btns"><button data-pa="exit" title="Patoloji modundan çık (Esc)">Moddan çık</button></div>`;
  }
  function click(e) {
    const t = e.target.closest('[data-pa],[data-po],[data-pg]'); if (!t) return;
    const d = t.dataset;
    if (d.po !== undefined) {
      if (p.pick !== null) return;
      p.pick = +d.po; p.score[cur().key] = p.pick === 0;
      const was = p.shown; p.shown = true;
      if (!was) { apply(); refresh(); frame(); } else refresh();
      return;
    }
    if (d.pa === 'show') { p.shown = true; apply(); refresh(); frame(); return; }
    if (d.pa === 'prev') { open(p.i - 1); return; }
    if (d.pa === 'next') { open(p.i + 1); return; }
    if (d.pa === 'exit') { state.isolate = null; refresh(); return; }
    if (d.pg === 'loco') { const nv = nerveOf(cur()); actions?.locoMode?.('nerves' + (nv ? ':' + nv.key : '')); return; }
    if (d.pg === 'cn') { actions?.brainMode?.(`nerves:exit:${(cur().struktur.cn || [])[0] || ''}`); return; }
    if (d.pg === 'brain') { actions?.brainMode?.(cur().struktur.artery === 'asa' ? 'arteries:basal' : `arteries:${VIEW[cur().struktur.artery] || 'basal'}`); }
  }
  document.querySelector('#info')?.addEventListener('change', e => {
    if (!active) return;
    const t = e.target.closest('select[data-psel]'); if (!t) return;
    open(+t.value);
  });

  return {
    enter, sync, highlight, onPick, panelHTML, click,
    isActive: () => active, hideTips: () => active && !p.shown,
    cancelPending: () => { if (!active) enterSeq++; },
    spec: () => (D ? cur().key : ''),
  };
}
