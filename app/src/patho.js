// Patoloji vakaları (pilot): topografik patoloji. Her vaka bir klinik tablo (Befund) ve tek soruyla başlar; soru cevaplanınca
// (ya da "Tabloyu şimdi göster" ile) 3B görünüm lezyonu gösterir:
//  - Sinir vakası: sol kol ya da bacak; sinir sarı, lezyon yeri kırmızı nokta, lezyonun altında dalını alan kaslar mor
//    (felçli), aynı sinirin sağlam kalan kasları turuncu, bölgenin öteki kasları saydam. Felçli kas listesi Hareket
//    modunun lezyon yeriyle aynıdır (tools/patho-build.mjs denetler).
//  - Beyin vakası: sol yarımküre; tıkanan arter kırmızı, etkilenen alan (model parçaları) turuncu, beynin kalanı saydam.
//    MCA dışarıdan, ACA ve PCA içten (sağ yarımküre gizli), derin ve beyin sapı vakaları önden-yandan görünür.
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
// modelin bu vakada gösteremedikleri (data/work/patho/notes.md)
const MODEL_NOTE = {
  'lenticulostriata-capsula-interna': 'Modelde Capsula interna yok: asıl lezyon yeri (Crus posterius) gösterilemiyor; turuncu alan çevresindeki Putamen, Globus pallidus ve Nucleus caudatus.',
  'basilaris-locked-in': 'Modelde Pons tek parça: Basis pontis ile Tegmentum ayrılmıyor, bu yüzden bütün Pons turuncu.',
  'pica-wallenberg': 'Modelde Medulla oblongata tek parça: dorsolateral bölge ayrı gösterilemiyor.',
  'spinalis-anterior': 'Omurilik yolları modelde baştan sona tek parça: segmental (torakolomber) lezyon gösterilemiyor, yolun tamamı turuncu. A. spinalis anterior modelde yalnız omuriliğin üst ucunda var.',
  'medianus-karpaltunnel': 'Mm. lumbricales modelde tek parça: aslında yalnız I-II felçli.',
  'ulnaris-sulcus': 'M. flexor digitorum profundus ve Mm. lumbricales modelde tek parça: aslında yalnız ulnar yarı (III-IV) felçli.',
  'gluteus-superior-trendelenburg': 'Modelde Foramen suprapiriforme kapalı; lezyon noktası yaklaşık.',
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
    const view = VIEW[c.struktur.artery] || 'deep';
    const seen = new Set(), parts = [];
    for (const n of BRAIN) for (const r of groupRecs(n)) if (sexOk(r) && !seen.has(r.id)) { seen.add(r.id); parts.push({ r, ctx: CORTEX.has(n) }); }
    const keep = view === 'medial' ? parts.filter(x => L(x.r)) : parts;
    const cord = c.struktur.artery === 'asa' ? groupRecs('Spinal cord') : [];
    const ov = model.overrides, list = [];
    const terr = p.shown ? lrecs(c.folge.territory) : [];
    const art = p.shown ? lrecs(c.struktur.n) : [];
    const terrIds = ids(terr), artIds = ids(art);
    for (const { r, ctx } of keep) if (!terrIds.has(r.id) && !artIds.has(r.id)) {
      if (p.shown || view === 'deep') ov.set(r.id, view === 'deep' && ctx ? mats.ctx : mats.ctxN);
    }
    for (const r of cord) if (!terrIds.has(r.id)) ov.set(r.id, mats.cord);
    for (const r of terr) ov.set(r.id, mats.terr);
    for (const r of art) ov.set(r.id, mats.artery);
    setMark(null);
    if (art.length) list.push({ text: `<b>${esc(artName(c))}</b>`, p: anchorOf(art), cls: 'on' });
    if (terr.length) list.push({ text: 'Infarkt', p: anchorOf(terr), cls: '' });
    return { iso: [...keep.map(x => x.r), ...cord, ...terr, ...art], ghost: [], list };
  }
  const artName = c => { const r = recs([c.struktur.n[0]])[0]; return r ? (r.la || titleName(r)) : c.struktur.n[0]; };

  function apply() {
    model.overrides.clear(); marks.clear();
    const c = cur(), s = c.system === 'nerve' ? nerveScene(c) : brainScene(c);
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
    } else {
      const view = VIEW[c.struktur.artery] || 'deep', terr = lrecs(c.folge.territory);
      box = boxOf(view === 'deep' ? [...terr, ...lrecs(c.struktur.n)] : grp(['Frontal lobe', 'Occipital lobe', 'Temporal lobe']).filter(L));
      if (view === 'deep') box.union(boxOf(groupRecs('Brainstem'))).expandByScalar(1.5);   // derin vakalar: beyin sapıyla birlikte, biraz uzaktan
      if (c.struktur.artery === 'asa') box = boxOf(lrecs(c.struktur.n).length ? lrecs(c.struktur.n) : groupRecs('Spinal cord'));
      dir = view === 'lateral' ? new THREE.Vector3(1, 0.2, 0.1) : view === 'medial' ? new THREE.Vector3(-1, 0.15, 0.08) : new THREE.Vector3(0.7, -0.05, 1);
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
    const groups = [['nerve', 'Periferik sinir lezyonları'], ['brain', 'Beyin ve omurilik infarktları']];
    const done = Object.values(p.score), right = done.filter(Boolean).length;
    const opts = f['options_' + lg];
    const answered = p.pick !== null;
    const optsHTML = `<div class="qopts" lang="${lg}">${p.order.map(j => {
      const cls = answered ? (j === 0 ? 'ok' : p.pick === j ? 'bad' : '') : '';
      return `<button class="qopt ${cls}" data-po="${j}"${answered ? ' disabled' : ''}><b>${esc(opts[j])}</b></button>`;
    }).join('')}</div>`;
    const legend = c.system === 'nerve'
      ? `${sw(COL.nerve, 'sinir')} ${sw(COL.mark, 'lezyon')} ${sw(COL.lost, 'felçli')} ${sw(COL.kept, 'aynı sinir, sağlam')}`
      : `${sw(COL.artery, 'tıkanan arter')} ${sw(COL.terr, 'etkilenen alan')}`;
    const where = c.system === 'nerve' ? (() => { const s = siteOf(c), nv = nerveOf(c); return `<span lang="la">${esc(nv?.la || '')}</span>${s ? ` · <span lang="de">${esc(s.de || s.la || '')}</span>` : ''}`; })()
      : `<span lang="la">${esc(artName(c))}</span>`;
    const affected = uniq(c.system === 'nerve' ? c.folge.paralysed.filter(n => !/tendon/i.test(n)) : c.folge.territory).map(nameOf);
    const reveal = p.shown ? `
      <div class="lesion">
        <h2>Lezyon</h2>
        <p class="htext">${where}</p>
        <div class="legend">${legend}</div>
      </div>
      <details class="clinic" open><summary>Mechanismus</summary><p lang="de">${esc(c.mechanismus_de)}</p><p class="htext small dim">${esc(c.mechanismus_tr)}</p></details>
      <details class="clinic" open><summary>Ausfälle</summary>${c.folge.deficits_de.map((d, j) => `<p><b lang="de">${esc(d)}</b><br><small>${esc(c.folge.deficits_tr[j] || '')}</small></p>`).join('')}</details>
      <details class="clinic"><summary>${c.system === 'nerve' ? 'Felçli kaslar' : 'Etkilenen yapılar'} (${affected.length})</summary><p lang="la">${affected.map(esc).join(', ')}</p></details>
      ${MODEL_NOTE[c.key] ? `<div class="tip">${esc(MODEL_NOTE[c.key])}</div>` : ''}
      <div class="btns">${c.system === 'nerve' ? `<button data-pg="loco" title="Bu siniri bütün lezyon yerleriyle Hareket modunda aç">Hareket modunda aç</button>` : `<button data-pg="brain" title="Beyin arterlerini ve beslenme alanlarını Beyin modunda aç">Beyin modunda aç</button>`}</div>`
      : `<div class="btns"><button data-pa="show" title="Soruyu cevaplamadan lezyonu 3B görünümde göster">Tabloyu şimdi göster</button></div>`;
    return `
      <div class="chips"><span class="chip loco">Patoloji vakaları</span><span class="chip dim">pilot</span></div>
      <div class="field"><select data-psel="case" aria-label="Vaka">${groups.map(([k, t]) => `<optgroup label="${t}">${D.cases.map((x, j) => x.system === k ? `<option value="${j}"${j === p.i ? ' selected' : ''}>${j + 1}. ${esc(x.title_de)}${p.score[x.key] === true ? ' ✓' : p.score[x.key] === false ? ' ✗' : ''}</option>` : '').join('')}</optgroup>`).join('')}</select></div>
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
