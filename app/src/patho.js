// Patoloji vakaları: topografik patoloji. Her vaka bir klinik tablo (Befund) ve tek soruyla başlar; soru cevaplanınca
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
import * as S from './patho-store.js';

const COL = { nerve: 0xf5d742, lost: 0x9a6cf0, kept: 0xd9705f, artery: 0xe0302a, terr: 0xf0923f, mark: 0xff4d3d, hit: 0x3fc46a, miss: 0x4da3ff };
const GROUPS = [['arm', 'Kol sinirleri'], ['leg', 'Bacak sinirleri'], ['plexus', 'Pleksus ve kökler'], ['passage', 'Geçitler ve sıkışmalar'], ['spinal', 'Omurilik ve kauda'], ['cranial', 'Kranial sinirler'], ['brain', 'Beyin ve beyin sapı lezyonları'], ['organ', 'Gövde ve baş topografisi']];
const ISSUES = 'https://github.com/alikaankaraduman/anatomi3d-atlas/issues/new';   // Hata bildir: herkese açık depo
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
  // mode: browse | review | testat (Testat ayarı); q: çalışan sıra (Tekrar ya da Testat); loc: 3B görevinin sonucu ('skip' = atlandı)
  const p = { i: 0, order: null, pick: null, shown: false, sex: null, loc: null, mode: 'browse', q: null, tf: 'all' };
  let scene = null;
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
      ghostM: tint(0xd9a79d, 0.03, 0.3), ctx: noPick(tint(0xc9c0bc, 0.006, 0.09)), ctxN: noPick(tint(0xc9c0bc, 0.02, 0.28)),
      artery: solid(COL.artery, 0.3), terr: solid(COL.terr, 0.22), cord: tint(0xe9d9a0, 0.03, 0.35),
      lesion: solid(COL.mark, 0.35), octx: tint(0xe6d3bf, 0.14, 0.6), wall: noPick(tint(0x7fd6c8, 0.05, 0.42)),
      k_n: tint(COL.nerve, 0.05, 0.45), k_a: tint(0xe0473f, 0.06, 0.45), k_v: tint(0x3f7fe0, 0.06, 0.45), k_t: tint(0xd9a066, 0.06, 0.45), k_l: tint(0x4fc46a, 0.05, 0.4), k_o: tint(0xd8d8e0, 0.05, 0.4),
      s_n: solid(COL.nerve, 0.35), s_a: solid(COL.artery, 0.3), s_v: solid(0x3f7fe0, 0.3), s_t: solid(0xd9a066, 0.25), s_l: solid(0x4fc46a, 0.25), s_o: solid(0xd8d8e0, 0.2), lostT: tint(COL.lost, 0.4, 0.9), keptT: tint(COL.kept, 0.35, 0.85), cnCtx: noPick(tint(0xe8dca0, 0.03, 0.3)),
      mark: new THREE.MeshBasicMaterial({ color: COL.mark, depthTest: false, transparent: true }),
      hit: new THREE.MeshBasicMaterial({ color: COL.hit, depthTest: false, transparent: true }), neutral: new THREE.MeshBasicMaterial({ color: 0xe8e8f0, depthTest: false, transparent: true }), miss: new THREE.MeshBasicMaterial({ color: COL.miss, depthTest: false, transparent: true }),
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
    for (const n of BRAIN) for (const r of groupRecs(n)) if (sexOk(r) && !seen.has(r.id)) { seen.add(r.id); parts.push({ r, ctx: CORTEX.has(n) || n === 'White matter of telencephalon' }); }
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
    if (terr.length) list.push({ text: c.struktur.artery ? 'Infarkt' : 'Läsion', p: anchorOf(terr), cls: c.struktur.artery ? '' : 'on' });
    // 3B görevinde ışın sınamasına girmeyenler: derin bakışta saydam korteks, orbitada göz küresinin etkilenmeyen parçaları
    const tn = new Set(c.folge.territory), skip = new Set([...(view === 'deep' ? keep.filter(x => x.ctx).map(x => x.r.id) : []), ...eye.filter(r => !tn.has(r.n)).map(r => r.id)]);
    const keepIds = ids([...keep.map(x => x.r), ...cord, ...eye]), outside = side(c.folge.territory).filter(r => !keepIds.has(r.id));
    if (!p.shown) for (const r of outside) ov.set(r.id, mats.ctxN);
    return { iso: [...keep.map(x => x.r), ...cord, ...eye, ...outside, ...terr, ...art], ghost: [], list, skip };
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
  // pleksus ve geçit vakası: kol (pleksusta boyun kaslarıyla) ya da bacak; geçitte duvarlar ve içerikler locomotor.json'dan
  const PASS_LEG = new Set(['groin', 'thigh', 'hip', 'knee', 'foot']);
  const passOf = c => LO.passages.list.find(x => x.key === c.struktur.passage);
  // bel pleksusu vakası: sarı sinirlerden biri Lumbosacral plexus grubundaysa bacak bölgesi
  const lumbar = c => c.system === 'plexus' && lrecs(c.struktur.n).some(r => groupRecs('Lumbosacral plexus').includes(r));
  const regOf = c => ((c.system === 'passage' && PASS_LEG.has(passOf(c)?.region)) || lumbar(c) ? 'leg' : 'arm');
  function pointOf(c) {
    if (c.system === 'nerve') { const g = LO.geo?.sites?.[c.struktur.site]; return g?.p ? V3(g.p) : null; }
    if (c.system === 'passage') { const g = LO.geo?.passages?.[c.struktur.passage]?.contents?.[c.struktur.content]; return g?.p ? V3(g.p) : null; }
    if (c.system === 'spinal') return spinalPoint(c);
    if (c.system === 'organ') return c.struktur.p ? V3(c.struktur.p) : null;
    if (c.struktur.p) return V3(c.struktur.p);
    const les = lrecs(c.struktur.lesion); return les.length ? anchorOf(les) : null;
  }
  function regionScene(c) {
    const st = c.struktur, reg = regOf(c), ps = c.system === 'passage' ? passOf(c) : null;
    const bones = grp(BONES[reg]).filter(r => r.sub !== 'attach' && L(r));
    const all = grp([...MUSCLES[reg], ...((c.system === 'plexus' && reg === 'arm') || ps?.region === 'neck' ? ['Muscles of neck'] : [])]).filter(r => r.sub === 'muscle' && L(r));
    const nerve = lrecs(st.n), lesion = lrecs(st.lesion), ves = lrecs(st.v), lesionIds = ids(lesion);
    const ov = model.overrides, list = [];
    let extra = [];
    // bağlam: pleksusun bütün parçaları ya da geçidin duvarları ve içerikleri soluk
    const plex = c.system === 'plexus' ? grp([reg === 'leg' ? 'Lumbar plexus' : 'Brachial plexus']).filter(L) : [];
    const walls = ps ? ps.bounds.flatMap(b => lrecs(b.n)) : [], cont = ps ? ps.contents.map(x => ({ k: x.kind, rs: lrecs(x.n) })) : [];
    for (const r of walls) ov.set(r.id, mats.wall);
    for (const x of cont) for (const r of x.rs) ov.set(r.id, r.sub === 'sheath' ? mats.ctxN : mats['k_' + x.k] || mats.cnCtx);
    for (const r of plex) ov.set(r.id, mats.cnCtx);
    const lost = new Set(p.shown ? c.folge.paralysed : []), kept = new Set(p.shown ? c.folge.kept || [] : []);
    const wallIds = ids([...walls, ...cont.flatMap(x => x.rs)]);
    for (const r of all) if (!lost.has(r.n) && !kept.has(r.n) && !wallIds.has(r.id)) ov.set(r.id, mats.ghostM);
    setMark(null);
    if (p.shown) {
      const lr = lrecs(c.folge.paralysed), kr = lrecs(c.folge.kept || []);
      for (const r of kr) ov.set(r.id, mats.keptT);
      for (const r of lr) ov.set(r.id, mats.lostT);
      extra = [...lr, ...kr];
      for (const r of lesion) ov.set(r.id, mats.lesion);
      const hit = ps?.contents.find(x => x.key === st.content);   // gösterilince etkilenen içerik güçlü renkle
      if (hit) for (const r of lrecs(hit.n)) if (r.sub !== 'sheath') ov.set(r.id, mats['s_' + hit.kind] || mats.s_o);
      const pt = pointOf(c);
      if (pt) {
        setMark(pt);
        const txt = ps ? (ps.contents.find(x => x.key === st.content)?.la || ps.la).split(':')[0] : nameOf((st.lesion?.[0]) || st.n[0]);
        list.push({ text: `<b>${esc(ps ? ps.la : txt)}</b>`, p: pt.clone().add(new THREE.Vector3(2.5, 1.8, 1)), at: pt, cls: 'on' });
      }
    }
    for (const r of ves) if (!lesionIds.has(r.id)) ov.set(r.id, mats.artery);
    for (const r of nerve) if (!lesionIds.has(r.id)) ov.set(r.id, mats.nerve);
    if (!p.shown) for (const r of lesion) if (!nerve.includes(r) && r.s !== 'muscle') ov.set(r.id, mats.nerve);   // gösterilmeden lezyon parçası sarı (ele vermesin); kas lezyonu soluk kalır
    const ghost = grp(BONE_CTX[reg]).filter(r => r.sub !== 'attach' && L(r));
    return { iso: [...bones, ...all, ...plex, ...walls, ...cont.flatMap(x => x.rs), ...nerve, ...lesion, ...ves, ...extra], ghost, list };
  }

  // organ / damar vakası (gövde ve baş topografisi): iskelet saydam, struktur.ctx (grup ya da parça adları) soluk bağlam;
  // gösterilince struktur.n kırmızı (lezyonlu yapı), folge.affected turuncu, struktur.v kırmızı damar; nokta varsa (at) kırmızı top.
  // Gösterilmeden önce lezyonlu ve etkilenen yapılar da bağlam gibi soluk (3B görevini ele vermesin).
  const ORGAN_DIR = { front: [0, 0.12, 1], back: [0, 0.12, -1], left: [1, 0.12, 0.25], right: [-1, 0.12, 0.25], top: [0, 1, 0.35], below: [0, -1, 0.3] };
  const ctxRecs = names => { const out = []; for (const n of names || []) { const g = groupRecs(n); out.push(...(g.length ? g : recs([n]))); } return [...new Set(out)].filter(sexOk); };
  function organScene(c) {
    const st = c.struktur, side = sideOf(c), ov = model.overrides, list = [];
    const ctx = ctxRecs(st.ctx).filter(r => st.both || L(r)), les = side(st.n), aff = side(c.folge.affected || []), ves = side(st.v || []);
    const hot = ids([...les, ...aff, ...ves]);
    for (const r of ctx) if (!hot.has(r.id)) ov.set(r.id, mats.octx);   // bağlam: belirgin ama nötr (yapı bulma görevi için görünmeli)
    setMark(null);
    if (p.shown) {
      for (const r of aff) ov.set(r.id, mats.terr);
      for (const r of ves) ov.set(r.id, mats.artery);
      for (const r of les) ov.set(r.id, mats.lesion);
      const pt = st.p ? V3(st.p) : null;
      if (pt) setMark(pt);
      const at = pt || (les.length ? anchorOf(les) : null);
      if (at) list.push({ text: `<b>${esc(nameOf(st.n[0]))}</b>`, p: at.clone().add(new THREE.Vector3(3, 2, 1)), at, cls: 'on' });
    } else for (const r of [...les, ...aff, ...ves]) ov.set(r.id, mats.octx);
    const lr = p.shown ? lrecs(c.folge.paralysed || []) : [];
    for (const r of lr) ov.set(r.id, mats.lostT);
    const bones = grp(['Cranium', 'Thoracic skeleton', 'Vertebral column', 'Bones of lower limb']).filter(r => r.sub !== 'attach');
    return { iso: [...ctx, ...les, ...aff, ...ves, ...lr], ghost: bones, list };
  }

  // omurilik vakası: omurga saydam, omurilik parçaları soluk; seviye/taraf kesitli kopyalar (kesit düzlemleriyle) mor ve kırmızı
  const spinalExtra = new THREE.Group(); root.add(spinalExtra);
  const SPINE = ['Spinal cord'], CORD_EXTRA = ['Cauda equina', 'Anterior root of spinal nerve', 'Posterior root of spinal nerve'];
  const yOf = n => { const r = recs([n])[0]; return r ? (r.box.min.y + r.box.max.y) / 2 : null; };
  // omuriliğin bir yükseklikteki merkezi (beyaz cevherin o dilimdeki köşelerinin ortalaması; omurilik bitmişse kaudanın)
  function cordCentre(y) {
    for (const n of ['White matter of spinal cord', 'Cauda equina']) {
      const r = recs([n])[0]; if (!r?.geo) continue;
      const a = r.geo.attributes.position; let sx = 0, sz = 0, k = 0;
      for (let i = 0; i < a.count; i++) if (Math.abs(a.getY(i) - y) < 0.6) { sx += a.getX(i); sz += a.getZ(i); k++; }
      if (k) return new THREE.Vector3(sx / k, y, sz / k);
    }
    return null;
  }
  function spinalPoint(c) {
    const y = yOf(c.struktur.level || ''); if (y === null) return null;
    const ctr = cordCentre(y); if (!ctr) return null;
    const side = (c.struktur.lesion || c.struktur.tracts || [])[0]?.side;
    if (side === 'l') ctr.x += 0.35; else if (side === 'r') ctr.x -= 0.35;   // sol taraf +x
    return ctr;
  }
  function clipPlanes(t, st) {
    const y0 = yOf(st.level || ''), y1 = st.level2 ? yOf(st.level2) : null, P = [];
    if (t.side === 'l') P.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));      // x >= 0 kalır
    if (t.side === 'r') P.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0));
    if (t.part === 'below') P.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), y0));
    if (t.part === 'above') P.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0));
    if (t.part === 'level') { P.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), y0 + 1.5)); P.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y0 - 1.5))); }
    if (t.part === 'range') { const lo = Math.min(y0, y1), hi = Math.max(y0, y1); P.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), hi)); P.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -lo)); }
    return P;
  }
  function spinalScene(c) {
    const st = c.struktur, ov = model.overrides, list = [];
    spinalExtra.clear();
    const cord = grp(SPINE), more = recs(CORD_EXTRA), vert = grp(['Vertebral column']).filter(r => r.sub !== 'attach');
    for (const r of [...cord, ...more]) ov.set(r.id, mats.cord);
    const add = (t, col) => {
      for (const r of recs([t.n])) {
        if (!r.geo) continue;
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.5, side: THREE.DoubleSide, clippingPlanes: clipPlanes(t, st) });
        const mesh = new THREE.Mesh(r.geo, m); mesh.renderOrder = 5; mesh.userData.noPick = true; spinalExtra.add(mesh);
      }
    };
    setMark(null);
    if (p.shown) {
      for (const t of st.tracts || []) add(t, COL.lost);
      for (const t of st.lesion || []) add(t, COL.mark);
      const pt = spinalPoint(c);
      if (pt) {
        setMark(pt);
        list.push({ text: `<b>${esc(nameOf(st.level))}${st.level2 ? ' – ' + esc(nameOf(st.level2)) : ''}</b>`, p: pt.clone().add(new THREE.Vector3(4, 1.5, 0)), at: pt, cls: 'on' });
      }
    }
    // kas felci listesi varsa (ör. kök lezyonu) gösterilince mor
    const lr = p.shown ? lrecs(c.folge.paralysed) : [];
    for (const r of lr) ov.set(r.id, mats.lostT);
    return { iso: [...cord, ...more, ...lr], ghost: vert, list };
  }
  const CN_LABEL = { 'foramen-jugulare': 'Foramen jugulare' };   // birden çok sinirin ortak lezyon yeri
  const cranialName = c => CN_LABEL[c.key] || (c.struktur.lesion?.length ? nameOf(c.struktur.lesion[0]) : nameOf(c.struktur.n[0]));
  // bakış vakada verilebilir (struktur.view: lateral | medial | deep | orbit); struktur.both: alan iki taraflı (ör. Percheron)
  const viewOf = c => c.struktur.view || VIEW[c.struktur.artery] || 'deep';
  const sideOf = c => (c.struktur.both ? n => recs(n || []) : lrecs);
  // arteri olmayan beyin vakası (tümör, MS, kanama: struktur.artery yok, n boş): lezyon alanı yalnız turuncu
  const artName = c => { const n = c.struktur.n?.[0]; if (!n) return nameOf(c.folge.territory[0]); const r = recs([n])[0]; return r ? (r.la || titleName(r)) : n; };

  function apply() {
    model.overrides.clear(); marks.clear(); spinalExtra.clear();
    const c = cur(), sys = c.system;
    const s = scene = sys === 'nerve' ? nerveScene(c) : sys === 'cranial' ? cranialScene(c) : sys === 'plexus' || sys === 'passage' ? regionScene(c) : sys === 'spinal' ? spinalScene(c) : sys === 'organ' ? organScene(c) : brainScene(c);
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
    } else if (c.system === 'plexus') {
      box = boxOf(lrecs([...c.struktur.n, ...(c.struktur.lesion || [])]));
      const pt = pointOf(c); if (pt) box.expandByPoint(pt);
      box.expandByScalar(4);
    } else if (c.system === 'passage') {
      const g = LO.geo?.passages?.[c.struktur.passage];
      if (g?.box) { box = new THREE.Box3(V3(g.box.min), V3(g.box.max)); if (g.dir) dir = V3(g.dir); } else box = boxOf(lrecs(c.struktur.n));
      const pt = pointOf(c); if (pt) box.expandByPoint(pt);
    } else if (c.system === 'spinal') {
      // gösterilmeden önce bütün omurilik ve kauda (yükseklik 3B görevinin sorusu), sonra seviyeye yakın
      const pt = spinalPoint(c);
      box = boxOf([...grp(SPINE), ...recs(['Cauda equina'])]);
      if (pt && p.shown) box = new THREE.Box3(pt.clone().add(new THREE.Vector3(-6, -14, -6)), pt.clone().add(new THREE.Vector3(6, 14, 6)));
      dir = new THREE.Vector3(1, 0.12, -0.55);
    } else if (c.system === 'organ') {
      const st = c.struktur;
      box = boxOf([...sideOf(c)(st.n), ...sideOf(c)(c.folge.affected || []), ...sideOf(c)(st.v || [])]);
      if (!p.shown && !st.p) { const cx = ctxRecs(st.ctx).filter(r => st.both || L(r)); if (cx.length) box = boxOf([...cx, ...sideOf(c)(st.n)]); }   // yapı bulma görevi: bütün bağlam
      if (st.p) box.expandByPoint(V3(st.p));
      box.expandByScalar(st.zoom ?? 6);
      dir = V3(ORGAN_DIR[st.view] || ORGAN_DIR.front);
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
    // nokta vakalarında gösterilmeden önce kutu, vaka anahtarından türeyen sabit bir kaymayla çerçevelenir: lezyon noktası
    // (ör. geçidin merkezi) ekranın tam ortasına düşüp 3B görevinin cevabını vermesin
    if (box && !box.isEmpty() && !p.shown && c.system !== 'brain' && c.system !== 'spinal') {
      const sz = box.getSize(new THREE.Vector3()), hsh = [...c.key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const fx = ((hsh % 1000) / 1000 - 0.5) * 0.5, fy = (((hsh >>> 10) % 1000) / 1000 - 0.5) * 0.5;
      box.translate(new THREE.Vector3(sz.x * fx + Math.sign(fx || 1) * 1.5, sz.y * fy + Math.sign(fy || 1) * 1.5, 0));
      const lp = pointOf(c); if (lp) box.union(new THREE.Box3(lp.clone().subScalar(3), lp.clone().addScalar(3)));   // nokta kaymayla ekran kenarına / dışına çıkmasın (3 cm pay)
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
    if (i >= 0) {   // bağlantıyla açılan vaka: süren Testat bitirilir, sıra kapanır, Vakalar sekmesi
      settle();
      if (p.q?.kind === 'testat' && !p.q.done) endTestat();
      if (p.q || p.mode !== 'browse') { p.q = null; p.mode = 'browse'; }
      open(i, false);
    } else if (!p.order) open(p.i, false);
    active = true; p.sex = state.sex; root.visible = true; wasExploded = null;
    state.selected = new Set(); state.primary = { type: 'patho' };
    viewLayers({ bone: 'show', muscle: 'show', nerve: 'show', vessel: 'show', joint: 'show', organ: 'show' });
    apply(); refresh(); frame();
  }
  function open(i, redraw = true) {
    p.i = (i + D.cases.length) % D.cases.length; p.pick = null; p.shown = false; p.loc = null;
    p.order = shuffle(cur().frage.options_de.map((_, j) => j));
    clickMark.clear();
    if (redraw) { apply(); refresh(); frame(); }
  }
  const openKey = (key, redraw = true) => { const i = D.cases.findIndex(c => c.key === key); if (i >= 0) open(i, redraw); };
  function cleanup() {
    settle();
    if (p.q?.kind === 'testat' && !p.q.done) endTestat();   // Esc, Geri ya da başka mod: Testat sonucu yazılır
    active = false; enterSeq++;
    model.overrides.clear(); if (ownGhost && state.isoGhost === ownGhost) state.isoGhost = null;
    ownGhost = null; root.visible = false; marks.clear(); clickMark.clear(); labels.set([]);
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

  // --- 3B görevi: lezyonu modelde bul ---
  // Sinir ve kranial vaka: tıklama ışınının lezyon noktasına en yakın geçtiği uzaklık R'den küçükse doğru (R: sinir
  // vakasında aynı sinirin öteki lezyon yerlerine uzaklığın 0,45'i, 1,5-3,5 cm; kranial vakada 2 cm). Beyin vakası:
  // ışının ilk çarptığı yapı (derin bakışta saydam korteks, orbitada göz küresinin öteki parçaları sayılmaz) etkilenen
  // alanda ya da tıkanan arterdeyse doğru. Her vakada tek deneme; boşluğa tıklama sayılmaz.
  // yapı görevi (ışının çarptığı yapı): beyin vakası ve noktası olmayan organ vakası; öteki vakalar nokta görevi
  const partsTask = c => c.system === 'brain' || (c.system === 'organ' && !c.struktur.p);
  const hasLoc = c => (c.system === 'brain' ? !!c.folge.territory?.length : partsTask(c) ? sideOf(c)(c.struktur.n).length > 0 : !!pointOf(c));
  function radiusOf(c) {
    if (c.system !== 'nerve') return c.system === 'cranial' || c.system === 'plexus' ? 2 : 2.5;
    const nk = c.struktur.site.split('@')[0], me = V3(LO.geo.sites[c.struktur.site].p);
    let m = Infinity;
    for (const [k, g] of Object.entries(LO.geo.sites)) if (k !== c.struktur.site && k.split('@')[0] === nk && g?.p) m = Math.min(m, me.distanceTo(V3(g.p)));
    return Number.isFinite(m) ? Math.max(1.5, Math.min(3.5, 0.45 * m)) : 3;
  }
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  const clickMark = new THREE.Group(); root.add(clickMark);
  function showClick(pt, ok) {
    clickMark.clear(); if (!pt) return;
    const s = new THREE.Mesh(ballGeo, ok === null ? mats.neutral : ok ? mats.hit : mats.miss); s.position.copy(pt); s.scale.setScalar(0.36); s.renderOrder = 7; clickMark.add(s);
  }
  const locPending = () => active && D && p.pick !== null && !p.shown && p.loc === null && hasLoc(cur()) && !(p.q?.kind === 'testat' && p.q.done);
  function locClick(x, y) {
    const c = cur(), rect = stage.canvas.getBoundingClientRect();
    v2.set((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v2, stage.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (partsTask(c)) {
      const side = sideOf(c), good = ids(c.system === 'brain' ? [...side(c.folge.territory), ...side(c.struktur.n)] : [...side(c.struktur.n), ...side(c.folge.affected || []), ...side(c.struktur.v || [])]);
      // ışının bütün isabetleri uzaklığa göre: saydam çizilen (gösterilmeden önce soluk) parçalar arkasını örtmez; ilk opak
      // parçaya kadar etkilenen alana ya da artere değen isabet doğru sayılır
      const skip = scene?.skip || new Set(), hits = [], all = [];
      for (const id of state.isolate || []) {
        if (skip.has(id)) continue;
        const r = model.items.get(id); if (!r?.mesh) continue;
        hits.length = 0; r.mesh.raycast(ray, hits);
        for (const h of hits) all.push({ r, h });
      }
      if (!all.length) { ui?.notify?.('Bir yapının üstüne tıkla'); return; }
      all.sort((a, b) => a.h.distance - b.h.distance);
      let hit = null;
      for (const x of all) { if (good.has(x.r.id)) { hit = x; break; } if (!model.overrides.has(x.r.id)) break; }
      const first = hit || all[0];
      p.loc = { ok: !!hit, name: nameOf(first.r.n), pt: first.h.point.clone() };
    } else {
      const target = pointOf(c);
      const t = Math.max(0, target.clone().sub(o).dot(d)), q = o.clone().addScaledVector(d, t), dist = target.distanceTo(q), R = radiusOf(c);
      p.loc = { ok: dist <= R, d: dist, R, pt: q };
    }
    showClick(p.loc.pt, p.q?.kind === 'testat' ? null : p.loc.ok);
    finishCase();
  }
  // vaka bitti: sonuç kaydedilir; Testat dışında tablo açılır
  function finishCase() {
    const c = cur(), mc = p.pick === 0, loc = p.loc && p.loc !== 'skip' ? p.loc.ok : null;
    S.answer(c.key, mc, loc);
    if (p.q?.kind === 'testat') { p.q.res[c.key] = { mc, loc, pick: p.pick }; refresh(); return; }
    if (p.q?.kind === 'review') p.q.res[c.key] = { mc, loc, pick: p.pick };
    p.shown = true; apply(); refresh();
  }
  function onPick(id, x, y) {
    if (!active) return false;
    if (x !== undefined && locPending()) locClick(x, y);
    return true;   // vaka görünümünde tıklama paneli değiştirmez
  }
  const pickAt = (x, y) => { if (!locPending()) return false; locClick(x, y); return true; };
  let wasExploded = false;
  stage.onFrame(() => {
    if (!active || !D) return false;
    const rs = [...(state.isolate || [])].slice(0, 40).map(id => model.items.get(id)).filter(r => r?.mesh);
    const exploded = isExploded(rs);
    if (exploded !== wasExploded) { wasExploded = exploded; root.visible = !exploded; labels.hide(exploded); }
    if (!exploded) labels.place();
    return false;
  });

  // --- Tekrar ve Testat ---
  const allKeys = () => D.cases.map(c => c.key);
  const grpOf = x => (x.system !== 'nerve' ? x.system : nerveOf(x)?.region === 'leg' ? 'leg' : 'arm');
  const TESTAT_N = 10, TESTAT_MS = 90e3;   // 10 vaka, vaka başına 90 sn
  // bad: tarihi gelmemiş olsa da son cevabı yanlış olan bütün vakalar (Yanlışlarım)
  function startReview(bad = false) {
    const keys = bad ? allKeys().filter(k => S.status(k) === 'bad') : S.due(allKeys());
    if (!keys.length) { refresh(); return; }
    p.q = { kind: 'review', keys, i: 0, res: {} }; openKey(keys[0]);
  }
  function startTestat() {
    const pool = D.cases.filter(c => p.tf === 'all' || grpOf(c) === p.tf).map(c => c.key);
    const keys = shuffle(pool).slice(0, TESTAT_N);
    if (!keys.length) return;
    p.q = { kind: 'testat', keys, i: 0, res: {}, t0: Date.now(), limit: keys.length * TESTAT_MS, done: false, ms: 0 };
    openKey(keys[0]);
  }
  // şık seçilmiş, 3B görevi bekliyor, başka vakaya / sekmeye / moddan çıkılıyor: 3B atlanmış sayılıp kaydedilir
  // (Testat'ta endTestat aynı kuralı uygular)
  function settle() {
    if (!D || p.pick === null || p.shown || p.loc !== null || p.q?.kind === 'testat') return;
    const c = cur(), mc = p.pick === 0;
    S.answer(c.key, mc, null); if (p.q) p.q.res[c.key] = { mc, loc: null, pick: p.pick }; p.loc = 'skip';
  }
  function step(dir) {
    settle();
    const q = p.q;
    if (!q) { open(p.i + dir); return; }
    if (q.kind === 'testat' && dir > 0 && q.i === q.keys.length - 1) { endTestat(); refresh(); return; }
    if (q.kind === 'review' && dir > 0 && q.i === q.keys.length - 1) { p.q = null; p.mode = 'review'; clickMark.clear(); refresh(); return; }
    q.i = Math.max(0, Math.min(q.keys.length - 1, q.i + dir));
    const done = q.kind === 'review' ? q.res[q.keys[q.i]] : null;
    openKey(q.keys[q.i], !done);
    if (done) { p.pick = done.pick ?? null; p.loc = done.loc === null ? 'skip' : { ok: done.loc, restored: true }; p.shown = true; apply(); refresh(); frame(); }
  }
  function endTestat() {
    const q = p.q; if (!q || q.kind !== 'testat' || q.done) return;
    q.done = true; q.ms = Math.min(Date.now() - q.t0, q.limit);
    const k = D.cases[p.i]?.key;
    if (k && q.keys.includes(k) && !q.res[k] && p.pick !== null) { q.res[k] = { mc: p.pick === 0, loc: null, pick: p.pick }; S.answer(k, p.pick === 0, null); }
    const r = Object.values(q.res);
    S.testat({ t: q.t0, n: q.keys.length, ok: r.filter(x => x.mc).length, loc: r.filter(x => x.loc === true).length, locN: r.filter(x => x.loc !== null).length, ms: q.ms, keys: q.keys });
    clickMark.clear();
  }
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  setInterval(() => {
    const q = p.q; if (!active || !q || q.kind !== 'testat' || q.done) return;
    const left = q.limit - (Date.now() - q.t0), el = document.getElementById('pa-timer');
    if (el) el.textContent = mmss(left);
    if (left <= 0) { endTestat(); refresh(); }
  }, 1000);

  // --- panel ---
  const nameOf = n => { const r = recs([n])[0]; return r ? (r.la || titleName(r)) : n; };
  const uniq = a => [...new Set(a)];
  const day = ms => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  const issueURL = c => {
    const body = `Vaka: ${c.key}\nBaşlık: ${c.title_de}\nSoru dili: ${lang()}\nAdres: ${location.origin}${location.pathname}#m=patho:${c.key}\n\nNe yanlış? (hangi cümle, ne olmalı, varsa kaynak):\n\n`;
    return `${ISSUES}?title=${encodeURIComponent('Vaka: ' + c.title_de)}&body=${encodeURIComponent(body)}`;
  };
  const tabs = () => {
    const dueN = S.due(allKeys()).length, m = p.q ? p.q.kind : p.mode;
    const b = (k, t, title) => `<button data-pm="${k}" class="${m === k || (k === 'browse' && m === 'browse') ? 'active' : ''}" title="${title}">${t}</button>`;
    return `<div class="seg tiny bview">${b('browse', 'Vakalar', 'Bütün vakalar, listeden seç')}${b('review', `Tekrar${dueN ? ` (${dueN})` : ''}`, 'Tekrar zamanı gelen vakalar (aralıklı tekrar)')}${b('testat', 'Testat', '10 rastgele vaka, süreli, sonuç sonda')}</div>`;
  };
  function locHTML(c, lg, testat) {
    if (!hasLoc(c) || p.pick === null) return '';
    const what = c.system === 'brain' ? ['Welches Areal ist betroffen? Klicke im 3D-Modell darauf.', 'Hangi bölge etkilendi? 3B modelde o bölgeye tıkla.']
      : c.system === 'organ' ? (c.struktur.p ? ['Wo genau liegt die Läsion? Klicke im 3D-Modell auf die Stelle.', 'Lezyon tam olarak nerede? 3B modelde o noktaya tıkla.'] : ['Welche Struktur ist betroffen? Klicke im 3D-Modell darauf.', 'Hangi yapı etkilendi? 3B modelde o yapıya tıkla.'])
      : c.system === 'spinal' ? ['In welcher Höhe liegt die Läsion? Klicke am Rückenmark (bzw. an der Cauda) auf diese Höhe.', 'Lezyon hangi yükseklikte? 3B modelde omurilikte (ya da kaudada) o hizaya tıkla.']
      : c.system === 'passage' && !c.struktur.n?.length ? ['Wo liegt die Läsion? Klicke im 3D-Modell auf die betroffene Stelle.', 'Lezyon nerede? 3B modelde etkilenen yere tıkla.']
      : ['Wo liegt die Läsion? Klicke im 3D-Modell auf die Stelle am gelben Nerv.', 'Lezyon nerede? 3B modelde sarı sinirin üzerinde lezyon yerine tıkla.'];
    if (p.loc === null && !p.shown) return `<div class="lesion locask"><h2>3B görevi</h2><p lang="de"><b>${what[0]}</b></p><p class="htext small dim">${what[1]}</p><div class="btns"><button data-pa="skip" title="3B görevini atla">Atla</button></div></div>`;
    if (!p.loc || p.loc === 'skip') return '';
    if (testat) return '<p class="htext small dim">3B cevabın kaydedildi.</p>';
    const l = p.loc, ok = l.ok;
    if (l.restored) return `<div class="qres ${ok ? 'ok' : 'bad'}">3B: ${ok ? 'Doğru' : 'Yanlış'} (kayıtlı cevap)</div>`;
    const txt = partsTask(c)
      ? (ok ? `Doğru: tıkladığın yer (${esc(l.name)}) etkilenen alanda.` : `Yanlış: tıkladığın yer (${esc(l.name)}) etkilenmiyor; etkilenen alan turuncu.`)
      : (ok ? `Doğru: lezyon yerine ${l.d.toFixed(1).replace('.', ',')} cm.` : `Yanlış: lezyon yeri ${l.d.toFixed(1).replace('.', ',')} cm ötede (kırmızı nokta; ${l.R.toFixed(1).replace('.', ',')} cm içi doğru sayılır).`);
    return `<div class="qres ${ok ? 'ok' : 'bad'}">3B: ${txt}</div>`;
  }
  function testatSetupHTML() {
    const h = S.testats().slice(-5).reverse();
    const opt = (k, t) => `<option value="${k}"${p.tf === k ? ' selected' : ''}>${t}</option>`;
    return `
      <h1 class="name">Testat</h1>
      <p class="htext">${TESTAT_N} rastgele vaka, vaka başına ${TESTAT_MS / 1000} saniye (toplam ${mmss(TESTAT_N * TESTAT_MS)}). Her vakada önce soru, sonra 3B'de lezyon yeri. Doğru cevaplar ve açıklamalar sonda gösterilir; sonuçlar tekrar takvimine yazılır.</p>
      <div class="field"><select data-psel="tf" aria-label="Konu">${opt('all', 'Bütün vakalar')}${GROUPS.map(([k, t]) => opt(k, t)).join('')}</select></div>
      <div class="btns"><button data-pt="start" class="primary">Testatı başlat</button></div>
      ${h.length ? `<details class="clinic" open><summary>Son Testatlar</summary>${h.map(x => `<p class="htext small">${day(x.t)} · soru ${x.ok}/${x.n} · 3B ${x.loc}/${x.locN || 0} · ${mmss(x.ms)}</p>`).join('')}</details>` : ''}`;
  }
  function testatSummaryHTML(q) {
    const r = q.keys.map(k => ({ k, c: D.cases.find(c => c.key === k), x: q.res[k] }));
    const ok = r.filter(e => e.x?.mc).length, locOk = r.filter(e => e.x?.loc === true).length, locN = r.filter(e => e.x && e.x.loc !== null).length;
    const mark = v => (v === true ? '<span class="ok">✓</span>' : v === false ? '<span class="bad">✗</span>' : '<span class="dim">–</span>');
    return `
      <h1 class="name">Testat sonucu</h1>
      <p class="htext"><b>Soru: ${ok}/${q.keys.length}</b> · 3B: ${locOk}/${locN} · süre ${mmss(q.ms)}${q.ms >= q.limit ? ' (süre doldu)' : ''}</p>
      <table class="ptab"><tr><th>Vaka</th><th>Soru</th><th>3B</th><th></th></tr>${r.map(e => `<tr><td lang="de">${esc(e.c?.title_de || e.k)}</td><td>${e.x ? mark(e.x.mc) : '<span class="dim">cevapsız</span>'}</td><td>${mark(e.x?.loc ?? null)}</td><td><button data-pt="open" data-k="${e.k}" title="Vakayı açıklamasıyla aç">Aç</button></td></tr>`).join('')}</table>
      <div class="btns"><button data-pt="again" class="primary">Yeni Testat</button><button data-pm="browse">Vakalara dön</button></div>`;
  }
  function panelHTML() {
    if (!D) return '<p class="htext">Yükleniyor…</p>';
    const head = `<div class="chips"><span class="chip loco">Patoloji vakaları</span><span class="chip dim">${D.cases.length} vaka</span></div>${tabs()}`;
    const foot = `<p class="htext small dim">Vakalar yapay zekâyla yazıldı ve kaynaklarla denetlendi; bir hekim ya da anatomist bakmadı.</p>
      <div class="btns"><button data-pa="exit" title="Patoloji modundan çık (Esc)">Moddan çık</button></div>`;
    const q = p.q;
    if (!q && p.mode === 'testat') return head + testatSetupHTML() + foot;
    if (q?.kind === 'testat' && q.done) return head + testatSummaryHTML(q) + foot;
    if (!q && p.mode === 'review') {
      const s = S.summary(allKeys()), nd = S.nextDue(allKeys()), badN = allKeys().filter(k => S.status(k) === 'bad').length;
      const byGroup = GROUPS.map(([k, t]) => {
        const ks = D.cases.filter(x => grpOf(x) === k).map(x => x.key), seen = ks.filter(x => S.status(x)).length, ok = ks.filter(x => S.status(x) === 'ok').length;
        return `<tr><td>${t}</td><td>${seen}/${ks.length}</td><td class="ok">${ok || ''}</td><td class="bad">${seen - ok || ''}</td></tr>`;
      }).join('');
      const extra = (badN ? `<div class="btns"><button data-pt="wrong" title="Son cevabı yanlış olan bütün vakalar, tekrar tarihi gelmemiş olsa da">Yanlışlarımı çöz (${badN})</button></div>` : '')
        + (s.seen ? `<table class="ptab"><tr><th>Konu</th><th>Çözülen</th><th>Doğru</th><th>Yanlış</th></tr>${byGroup}</table>` : '');
      return head + `<h1 class="name">Aralıklı tekrar</h1>
        <p class="htext">Cevapladığın her vaka bir tekrar kutusuna girer: yanlışsa ertesi gün, doğruysa sırayla 3, 7, 16, 35 ve 90 gün sonra yeniden sorulur.</p>
        <p class="htext small">Çözülen ${s.seen}/${s.total} vaka · doğru kutuda ${s.ok} · bugün tekrar ${s.due}</p>
        ${s.due ? `<div class="btns"><button data-pt="review" class="primary">Tekrara başla (${s.due})</button></div>` : `<p class="htext small dim">${s.seen ? `Bugün tekrar edilecek vaka yok.${Number.isFinite(nd) ? ` Sonraki tekrar: ${day(nd)}.` : ''}` : 'Henüz cevaplanmış vaka yok: Vakalar sekmesinden başla.'}</p>`}${extra}` + foot;
    }
    const c = cur(), f = c.frage, lg = lang(), other = lg === 'de' ? 'tr' : 'de', testat = q?.kind === 'testat';
    const opts = f['options_' + lg];
    const answered = p.pick !== null, reveal = answered && !testat;
    const optsHTML = `<div class="qopts" lang="${lg}">${p.order.map(j => {
      const cls = reveal ? (j === 0 ? 'ok' : p.pick === j ? 'bad' : '') : testat && p.pick === j ? 'picked' : '';
      return `<button class="qopt ${cls}" data-po="${j}"${answered || p.shown ? ' disabled' : ''}><b>${esc(opts[j])}</b></button>`;
    }).join('')}</div>`;
    const you = p.loc?.pt ? ` ${sw(p.loc.ok ? COL.hit : COL.miss, 'senin tıklaman')}` : '';
    const legend = c.system === 'organ' ? `${sw(COL.mark, 'lezyon')}${c.folge.affected?.length ? ' ' + sw(COL.terr, 'etkilenen') : ''}${c.struktur.v?.length ? ' ' + sw(COL.artery, 'damar') : ''}${c.folge.paralysed?.length ? ' ' + sw(COL.lost, 'felçli') : ''}${you}`
      : c.system === 'spinal' ? `${sw(COL.mark, 'lezyon')} ${sw(COL.lost, 'işlevi kesilen yol')}${you}`
      : c.system !== 'brain'
      ? `${c.system === 'nerve' || c.system === 'cranial' || c.struktur.n?.length ? sw(COL.nerve, 'sinir') + ' ' : ''}${sw(COL.mark, 'lezyon')} ${c.folge.paralysed.length ? sw(COL.lost, 'felçli') + ' ' : ''}${c.system === 'nerve' || c.folge.kept?.length ? sw(COL.kept, 'aynı sinir, sağlam') : ''}${c.struktur.v?.length ? ' ' + sw(COL.artery, 'damar') : ''}${you}`
      : c.struktur.artery ? `${sw(COL.artery, 'tıkanan arter')} ${sw(COL.terr, 'etkilenen alan')}${you}` : `${sw(COL.terr, 'lezyon alanı')}${you}`;
    const ps = c.system === 'passage' ? passOf(c) : null;
    const where = c.system === 'organ' ? `<span lang="la">${c.struktur.n.map(n => esc(nameOf(n))).join(', ')}</span>`
      : c.system === 'spinal' ? `<span lang="la">${esc(nameOf(c.struktur.level || ''))}${c.struktur.level2 ? ' – ' + esc(nameOf(c.struktur.level2)) : ''}</span>`
      : ps ? `<span lang="la">${esc(ps.la)}</span> · <span lang="la">${esc(ps.contents.find(x => x.key === c.struktur.content)?.la || '')}</span>`
      : c.system === 'plexus' ? `<span lang="la">${esc(nameOf(c.struktur.lesion?.[0] || c.struktur.n[0]))}</span>`
      : c.system === 'cranial' ? `<span lang="la">${(c.struktur.cn || []).map(k => 'N. ' + k).join(', ')} · ${esc(cranialName(c))}</span>`
      : c.system === 'nerve' ? (() => { const s = siteOf(c), nv = nerveOf(c); return `<span lang="la">${esc(nv?.la || '')}</span>${s ? ` · <span lang="de">${esc(s.de || s.la || '')}</span>` : ''}`; })()
      : `<span lang="la">${esc(artName(c))}</span>`;
    const SIDE = { l: 'sol', r: 'sağ', both: 'iki taraf' }, PART = { below: 'seviyenin altı', above: 'seviyenin üstü', level: 'seviyede', range: 'aralıkta', all: 'boydan boya' };
    const affected = uniq(c.system === 'brain' ? c.folge.territory : c.system === 'organ' ? [...(c.folge.affected || []), ...(c.folge.paralysed || [])] : c.folge.paralysed.filter(n => !/tendon/i.test(n))).map(nameOf);
    const tractsHTML = c.system === 'spinal' && (c.struktur.tracts || []).length ? `<details class="clinic" open><summary>Kesilen yollar</summary><p class="htext small">${c.struktur.tracts.map(t => `<span lang="la">${esc(nameOf(t.n))}</span> (${SIDE[t.side]}, ${PART[t.part]})`).join('<br>')}</p></details>` : '';
    const st = S.get(c.key);
    const revealHTML = p.shown ? `
      <div class="lesion">
        <h2>Lezyon</h2>
        <p class="htext">${where}</p>
        <div class="legend">${legend}</div>
      </div>
      <details class="clinic" open><summary>Mechanismus</summary><p lang="de">${esc(c.mechanismus_de)}</p><p class="htext small dim">${esc(c.mechanismus_tr)}</p></details>
      <details class="clinic" open><summary>Ausfälle</summary>${c.folge.deficits_de.map((d, j) => `<p><b lang="de">${esc(d)}</b><br><small>${esc(c.folge.deficits_tr[j] || '')}</small></p>`).join('')}</details>
      ${affected.length ? `<details class="clinic"><summary>${c.system !== 'brain' && c.system !== 'organ' ? 'Felçli kaslar' : 'Etkilenen yapılar'} (${affected.length})</summary><p lang="la">${affected.map(esc).join(', ')}</p></details>` : c.system === 'nerve' || c.system === 'cranial' ? '<p class="htext small">Kas felci yok: yalnız duyu kaybı.</p>' : ''}
      ${tractsHTML}
      ${MODEL_NOTE[c.key] || c.model_note_tr ? `<div class="tip">${esc(MODEL_NOTE[c.key] || c.model_note_tr)}</div>` : ''}
      ${st ? `<p class="htext small dim">Kayıt: ${st.r} doğru, ${st.w} yanlış${st.lr + st.lw ? ` · 3B ${st.lr}/${st.lr + st.lw}` : ''} · sonraki tekrar ${day(st.d)}</p>` : ''}
      <div class="btns">${ps ? `<button data-pg="pass" title="Bu geçidi duvarları ve içindekilerle Hareket modunda aç">Geçidi Hareket modunda aç</button>` : c.system === 'plexus' || c.system === 'spinal' ? '' : c.system === 'cranial' ? `<button data-pg="cn" title="Bu siniri Beyin modunda, Sinirler bölümünde aç">Beyin modunda aç</button>` : c.system === 'nerve' ? `<button data-pg="loco" title="Bu siniri bütün lezyon yerleriyle Hareket modunda aç">Hareket modunda aç</button>` : c.struktur.artery ? `<button data-pg="brain" title="Beyin arterlerini ve beslenme alanlarını Beyin modunda aç">Beyin modunda aç</button>` : ''}
        <a class="btnlink" href="${issueURL(c)}" target="_blank" rel="noopener" title="Bu vakadaki bir hatayı herkese açık GitHub deposunda bildir (GitHub hesabı gerekir)">Hata bildir</a></div>`
      : testat ? '' : `<div class="btns"><button data-pa="show" title="${answered ? '3B görevini atlayıp tabloyu göster' : 'Soruyu cevaplamadan lezyonu 3B görünümde göster (sonuç kaydedilmez)'}">Tabloyu şimdi göster</button></div>`;
    // üst gezinme: Vakalar listesi, Tekrar ya da Testat sırası
    let nav;
    if (testat) {
      const left = q.limit - (Date.now() - q.t0), last = q.i === q.keys.length - 1, doneHere = !!q.res[c.key];
      nav = `<div class="btns"><span class="htext small"><b>Testat ${q.i + 1}/${q.keys.length}</b> · ⏱ <b id="pa-timer">${mmss(left)}</b></span><button data-pt="stop" title="Testatı şimdi bitir ve sonucu göster">Bitir</button></div>`;
      nav += doneHere ? `<div class="btns"><button data-pa="next" class="primary">${last ? 'Testatı bitir' : 'Sonraki vaka ▶'}</button></div>` : '';
    } else if (q?.kind === 'review') {
      const doneN = Object.keys(q.res).length;
      nav = `<div class="btns"><button data-pa="prev" title="Önceki">◀</button><span class="htext small"><b>Tekrar ${q.i + 1}/${q.keys.length}</b>${doneN ? ` · ${doneN} cevaplandı` : ''}</span><button data-pa="next" title="Sonraki">▶</button><button data-pt="endreview" title="Tekrardan çık">Bırak</button></div>`;
      if (q.res[c.key] && q.i === q.keys.length - 1) nav += '<p class="htext small ok">Bugünkü tekrar bitti.</p>';
    } else {
      const s = S.summary(allKeys());
      nav = `<div class="field"><select data-psel="case" aria-label="Vaka">${GROUPS.map(([k, t]) => `<optgroup label="${t}">${D.cases.map((x, j) => grpOf(x) === k ? `<option value="${j}"${j === p.i ? ' selected' : ''}>${j + 1}. ${esc(x.title_de)}${S.status(x.key) === 'ok' ? ' ✓' : S.status(x.key) === 'bad' ? ' ✗' : ''}</option>` : '').join('')}</optgroup>`).join('')}</select></div>
      ${p.last ? '<div class="btns"><button data-pt="back" class="primary" title="Testat sonuç tablosuna dön">◀ Testat sonucuna dön</button></div>' : ''}
      <div class="btns"><button data-pa="prev" title="Önceki vaka">◀</button><span class="htext small dim">${p.i + 1} / ${D.cases.length}${s.seen ? ` · çözülen ${s.seen} · doğru ${s.ok}` : ''}</span><button data-pa="next" title="Sonraki vaka">▶</button></div>`;
    }
    return head + nav + `
      <h1 class="name" lang="de">${esc(c.title_de)}</h1>
      <p lang="de" class="htext">${esc(c.befund_de)}</p>
      <details class="clinic"><summary>Türkçe</summary><p class="htext small">${esc(c.befund_tr)}</p></details>
      <p class="htext qtext" lang="${lg}"><b>${esc(f['q_' + lg])}</b></p>
      ${optsHTML}
      ${reveal ? `<div class="qres ${p.pick === 0 ? 'ok' : 'bad'}">${p.pick === 0 ? (lg === 'de' ? 'Richtig' : 'Doğru') : (lg === 'de' ? 'Falsch' : 'Yanlış')}</div>
        <p class="htext" lang="${lg}">${esc(f['explain_' + lg])}</p>
        <details class="clinic"><summary>${other === 'tr' ? 'Türkçe' : 'Deutsch'}</summary><p class="htext small" lang="${other}"><b>${esc(f['q_' + other])}</b></p><p class="htext small" lang="${other}">${esc(f['explain_' + other])}</p></details>` : ''}
      ${locHTML(c, lg, testat)}
      ${revealHTML}` + foot;
  }
  function click(e) {
    const t = e.target.closest('[data-pa],[data-po],[data-pg],[data-pm],[data-pt]'); if (!t) return;
    const d = t.dataset;
    if (d.po !== undefined) {
      if (p.pick !== null || p.shown) return;
      p.pick = +d.po;
      if (hasLoc(cur())) {   // önce 3B görevi; telefonda çekmece görev kutusuna kayar
        refresh(); requestAnimationFrame(() => document.querySelector('#info .locask')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        return;
      }
      finishCase(); return;
    }
    if (d.pm) {
      settle();
      if (p.q?.kind === 'testat' && !p.q.done) { if (d.pm === 'testat') return; endTestat(); }
      p.q = null; p.last = null; p.mode = d.pm; clickMark.clear();
      if (d.pm === 'browse') open(p.i); else refresh();
      return;
    }
    if (d.pt === 'start' || d.pt === 'again') { p.mode = 'testat'; startTestat(); return; }
    if (d.pt === 'stop') { endTestat(); refresh(); return; }
    if (d.pt === 'review') { startReview(); return; }
    if (d.pt === 'wrong') { startReview(true); return; }
    if (d.pt === 'back') { if (p.last) { p.q = p.last; p.last = null; clickMark.clear(); refresh(); } return; }
    if (d.pt === 'endreview') { p.q = null; p.mode = 'browse'; refresh(); return; }
    if (d.pt === 'open') {
      const last = p.q, r = last?.res?.[d.k];
      p.last = last?.kind === 'testat' && last.done ? last : null;
      p.q = null; p.mode = 'browse'; openKey(d.k, false);
      if (r) {   // Testat cevabıyla aç: seçilen şık, 3B sonucu ve tablo görünür
        p.pick = r.pick ?? null; p.loc = r.loc === null ? 'skip' : { ok: r.loc, restored: true }; p.shown = true;
      } else p.shown = true;
      apply(); refresh(); frame(); return;
    }
    if (d.pa === 'skip') { if (p.pick !== null && p.loc === null) { p.loc = 'skip'; finishCase(); } return; }
    if (d.pa === 'show') {
      if (p.pick !== null && p.loc === null) { p.loc = 'skip'; finishCase(); return; }
      p.shown = true; apply(); refresh(); frame(); return;
    }
    if (d.pa === 'prev') { step(-1); return; }
    if (d.pa === 'next') { step(1); return; }
    if (d.pa === 'exit') { if (p.q?.kind === 'testat' && !p.q.done) endTestat(); state.isolate = null; refresh(); return; }
    if (d.pg === 'pass') { actions?.locoMode?.('passages:' + cur().struktur.passage); return; }
    if (d.pg === 'loco') { const nv = nerveOf(cur()); actions?.locoMode?.('nerves' + (nv ? ':' + nv.key : '')); return; }
    if (d.pg === 'cn') { actions?.brainMode?.(`nerves:exit:${(cur().struktur.cn || [])[0] || ''}`); return; }
    if (d.pg === 'brain') { actions?.brainMode?.(cur().struktur.artery === 'asa' ? 'arteries:basal' : `arteries:${VIEW[cur().struktur.artery] || 'basal'}`); }
  }
  document.querySelector('#info')?.addEventListener('change', e => {
    if (!active) return;
    const t = e.target.closest('select[data-psel]'); if (!t) return;
    if (t.dataset.psel === 'tf') { p.tf = t.value; return; }
    settle(); open(+t.value);
  });

  return {
    enter, sync, highlight, onPick, pickAt, panelHTML, click,
    isActive: () => active, hideTips: () => active && !p.shown,
    cancelPending: () => { if (!active) enterSeq++; },
    spec: () => (D ? cur().key : ''),
  };
}
