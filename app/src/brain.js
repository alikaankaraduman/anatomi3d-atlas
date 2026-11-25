// Beyin çalışma modu: sınav için görsel tekrar (NEU bloğu: Liquor ve Meningen, Hirnstamm ve Hirnnerven, Blutversorgung;
// ÄBP'nin nöro günleri; SOK'un göz, kulak ve kafatası dersleri). Sağ panelde dört bölüm:
//  - BOS yolu: ventriküller yarı saydam mavi, plexus choroideus kırmızımsı, beyin çok soluk (tıklanmaz). Akış çizgisi
//    plexustan ventriküllerin içinden (Foramen interventriculare, III. ventrikül, aquaeductus, IV. ventrikül) aperturalara,
//    oradan subaraknoid aralıkta (modelde yok: şematik, soluk) sinus sagittalis superior'a ve sinüslerden V. jugularis
//    interna'ya gider; modelde olmayan delikler ve Confluens küçük noktalarla işaretli. Son adım lomber ponksiyon: iğne
//    yerleri, geçilen bağlar, Jacoby çizgisi, konus ve kanal boyunca şematik dural kese.
//  - Kranial sinirler: on iki sinir beyin sapı katına göre renk ailelerinde. Üç görünüm: beyinden çıkış yerleri, kafa
//    tabanındaki delikler (kafatası saydam, kubbesi gizli ve tıklanmaz), beyin sapındaki çekirdekler (beyin sapı saydam).
//  - Arterler: arterler ayrı renklerde; Willis halkasının modelde eksik ya da yanlış yerdeki bağlantıları (ACoA, ICA-PCoA)
//    şematik tüple; beslenme alanları sol yarımkürenin dış ve iç yüzünde (ders kitabı tablosu, bölünmüş girusta komşu
//    tek alanlı girustan yayılarak), beyincik SCA, AICA, PICA alanlarıyla.
//  - Test: yapının adı, yapıyı 3B görünümde bulma, bilgi soruları (BOS, sinirler, arterler).
// Metinler data/brain.json'da (ilk girişte yüklenir). Noktalar ve eğriler çalışma anında modelin geometrisinden hesaplanır:
// brain-csf.js, brain-nerves.js, brain-arteries.js (her sekmenin ilk açılışında, kamera uçuşu bittikten sonra boş anda;
// sinirler tek tek). Mod izole görünümle yaşar: izolasyondan çıkılınca renkler, çizgiler ve etiketler kaldırılır (sync).
import * as THREE from 'three';
import { titleName, subtitleName, esc } from './text.js';
import { tint, solid, hex, nameIndex, anchorOf, isExploded, createLabels, flowLines, animateFlow, createStudyQuiz } from './study.js';
import * as GC from './brain-csf.js';
import * as GN from './brain-nerves.js';
import * as GA from './brain-arteries.js';

const TABS = [['csf', 'BOS yolu'], ['nerves', 'Sinirler'], ['arteries', 'Arterler'], ['quiz', 'Test']];
const CN_VIEWS = [['exit', 'Çıkış'], ['skull', 'Kafa tabanı'], ['nuclei', 'Çekirdekler']];
const ART_VIEWS = [['basal', 'Alttan'], ['lateral', 'Dış yüz'], ['medial', 'İç yüz']];
const COL = { csf: 0x38c8f0, sas: 0x9fe6ff, ven: 0x3f7fe0, plexus: 0xe07a86, ctx: 0xc9c0bc, pale: 0xd8c3bc, cord: 0xe9d9a0, needle: 0xf4f4f4 };
// Kranial sinirler beyin sapındaki katlarına göre renk ailelerinde: uç ve ara beyin (I–II) sarı, orta beyin (III–IV) yeşil,
// pons (V–VIII) turuncu-kırmızı-mor, medulla oblongata (IX–XII) mavi
const CN_COLOR = { I: 0xf5e663, II: 0xf2c14e, III: 0x52d27a, IV: 0x2fb59a, V: 0xf0883a, VI: 0xe85d4a, VII: 0xe8487f, VIII: 0xc76be0, IX: 0x4fa3f0, X: 0x3f6fe0, XI: 0x7d8cf0, XII: 0x46c8e0 };
const ART_COLOR = { ica: 0xe0473f, ophthalmic: 0xe070b0, aca: 0x3fc46a, mca: 0x4f8fe8, lenticulostriate: 0x8fb8ff, acom: 0x9be07a, pcom: 0xf08a3a, vertebral: 0x9a6ae0, pica: 0xf09050, asa: 0x8a7ad0, basilar: 0x8a5ad8, aica: 0x4fc8b0, pontine: 0xb08ae0, sca: 0xe08ad8, pca: 0xf0c030 };
const TERR = [ART_COLOR.aca, ART_COLOR.mca, ART_COLOR.pca];          // ACA, MCA, PCA beslenme alanı renkleri (arterle aynı)
const CORTEX = ['Frontal lobe', 'Parietal lobe', 'Occipital lobe', 'Temporal lobe', 'Limbic lobe', 'Interlobar sulci'];
const DEEP = ['Basal forebrain', 'White matter of telencephalon', 'Corpus striatum'];
const VENTRICLES = ['Lateral ventricle', 'Third ventricle', 'Aqueduct of midbrain', 'Fourth ventricle'];
// modelde yanlış yerde (4,45 cm önde, beyinciğin içinden geçer): gösterilmez ve sorulmaz
const MISPLACED_SINUS = new Set(['Straight sinus', 'Occipital sinus']);
const BRAINSTEM = ['Midbrain', 'Pons', 'Medulla oblongata', 'Olive', 'Pyramid of medulla oblongata', 'Base of peduncle', 'Inferior colliculus', 'Superior colliculus', 'Superior cerebellar peduncle', 'Interpeduncular fossa'];
const SKULL_BONES = ['Sphenoid bone', 'Temporal bone', 'Occipital bone', 'Ethmoid bone', 'Frontal bone', 'Maxilla', 'Palatine bone', 'Zygomatic bone', 'Vomer', 'Lacrimal bone', 'Atlas (C1)'];
const SKULL_CUT_Y = 161.9;                // kafa tabanı görünümü: kafatasının bu yüksekliğin üstü çizilmez (en yüksek iç delik + 1,5 cm)
// BOS yolunun ventrikül içindeki adımları: kamera ventriküllere yaklaşır; sonraki adımlarda bütün beyin ve sinüsler
const INNER = new Set(['plexus', 'lateral', 'monro', 'third', 'aqueduct', 'fourth', 'apertures']);
// sinir yolu hesabı (brain-nerves.js): anahtar, ağ, kök (çekirdek; 'V' = V'nin çıkışı), deliğin beklenen kemiği
const CN_GEO = [
  ['II', 'Optic nerve (II)', 'Optic chiasm', ['Sphenoid bone']], ['III', 'Oculomotor nerve (III)', 'Nucleus of oculomotor nerve', ['Sphenoid bone']],
  ['IV', 'Trochlear nerve (IV)', 'Nucleus of trochlear nerve', ['Sphenoid bone']], ['V', 'Trigeminal nerve (V)', 'Motor root of trigeminal nerve', ['Sphenoid bone']],
  ['V1', 'Ophthalmic nerve', 'V', ['Sphenoid bone']], ['V2', 'Maxillary nerve', 'V', ['Sphenoid bone']],
  ['VI', 'Abducens nerve (VI)', 'Nucleus of abducens nerve', ['Sphenoid bone']], ['VII', 'Facial nerve (VII)', 'Motor nucleus of facial nerve', ['Temporal bone']],
  ['VIII', 'Vestibulocochlear nerve (VIII)', 'Vestibular nuclei', ['Temporal bone']], ['IX', 'Glossopharyngeal nerve (IX)', 'Nucleus ambiguus', ['Temporal bone', 'Occipital bone']],
  ['X', 'Vagus nerve (X)', 'Posterior nucleus of vagus nerve', ['Temporal bone', 'Occipital bone']], ['XI', 'Accessory nerve (XI)', 'Nucleus of accessory nerve', ['Temporal bone', 'Occipital bone']],
  ['XII', 'Hypoglossal nerve (XII)', 'Nucleus of hypoglossal nerve', ['Occipital bone']],
];
// alttan bakışta etiketin Willis halkası ortasından gövde yolu boyunca uzaklığı (cm): kalabalık ortadan uzak, ekranda kalsın
const ART_LABEL_OFF = { ica: 1.4, ophthalmic: 0.6, aca: 0.9, mca: 1.5, pcom: 0, vertebral: 1.6, pica: 0.8, asa: 0.8, basilar: 1.4, aica: 0.9, pontine: 0.5, sca: 0.9, pca: 1.2 };
// lomber ponksiyon: deri derinliği tahmini için sırtın orta hattaki yumuşak dokuları (kas sistemi yüklüyse)
const BACK = ['Posterior layer of thoracolumbar fascia', 'Supraspinous ligament', 'Multifidus lumborum muscle', 'Longissimus thoracis muscle', 'Iliocostalis lumborum muscle', 'Spinalis thoracis muscle', 'Interspinales lumborum muscles'];

const V3 = p => new THREE.Vector3(p[0], p[1], p[2]);
const avg = ps => ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0]);
const at = (pts, f) => pts[Math.max(0, Math.min(pts.length - 1, Math.round((pts.length - 1) * f)))];

// Yalnız belli bir yüksekliğin altında çizilen saydam malzeme (kafa tabanı görünümünde kafatası kubbesi gizlensin). Kesit
// düzleminden bağımsızdır: model._present parçaya özel malzemenin clippingPlanes'ini kullanıcının kesit düzlemiyle eşitler.
function tintBelow(color, alpha, edge, maxY) {
  const m = tint(color, alpha, edge);
  m.uniforms.uMaxY = { value: maxY };
  m.vertexShader = m.vertexShader.replace('varying vec3 vV;', 'varying vec3 vV; varying float vY;').replace('vN = normalMatrix * normal;', 'vN = normalMatrix * normal; vY = (modelMatrix * vec4(position, 1.0)).y;');
  m.fragmentShader = m.fragmentShader.replace('varying vec3 vV;', 'varying vec3 vV; varying float vY; uniform float uMaxY;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n        if (vY > uMaxY) discard;');
  return m;
}
// Beslenme alanı malzemesi: köşe başına renk (aTerr), kameradan gelen ışıkla gölgeli, opak; kesit düzlemini izler
function terrMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, clipping: true,
    vertexShader: /* glsl */`
      attribute vec3 aTerr; varying vec3 vC; varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_vertex>
      void main() {
        vC = aTerr; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float l = 0.42 + 0.58 * max(dot(n, normalize(vV)), 0.0);
        gl_FragColor = vec4(vC * l, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
const noPick = m => { m.userData.noPick = true; return m; };

export function createBrain({ stage, model, state, refresh, defer, viewLayers, endStudy }) {
  let built = false, active = false, data = null, loading = null, enterSeq = 0;
  const b = { tab: 'csf', step: 0, playing: false, pickedId: null, cn: 2, cnView: 'exit', art: 3, artView: 'basal', sex: null };
  const { recs, groupRecs } = nameIndex(model, state);
  const ids = rs => new Set(rs.map(r => r.id));
  const one = (name, sd) => recs([name]).find(r => (sd ? r.sd === sd : true));
  const mesh = r => GC.meshOf(r.geo);
  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const labels = createLabels(stage);
  let set = null, mats = null, test = null, ownGhost = null;
  const G = { lp: {} };                  // geometri önbelleği (model dosyalarına bağlı; lomber ponksiyon bedene göre)
  const busy = new Set(), failed = new Set();   // sürmekte olan ve başarısız hesaplar (başarısız olan yeniden denenmez)
  const narrow = () => stage.canvas.clientWidth < 600;   // dar ekranda yalnız etkin etiketler

  // Bir işi kamera uçuşu bittikten sonra, tarayıcı boşken çalıştır (uçuş takılmasın)
  const later = fn => {
    const go = () => (stage.isFlying() ? setTimeout(go, 60) : window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 30));
    go();
  };
  const load = () => loading ||= fetch('data/brain.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { data = j; }).catch(e => { loading = null; console.warn('brain.json yüklenemedi:', e); throw e; });

  // --- yapı kümeleri ve malzemeler (ilk girişte bir kez) ---
  function build() {
    if (built) return;
    const grp = names => [...new Set(names.flatMap(groupRecs))];
    const cortex = grp(CORTEX), deep = grp(DEEP), dien = groupRecs('Diencephalon'), stem = groupRecs('Brainstem'), cereb = groupRecs('Cerebellum');
    const ventricles = recs(VENTRICLES), plexus = recs(['Choroid plexus']), septum = recs(['Septum pellucidum']);
    const vIds = ids(ventricles);
    const cnRecs = {};
    for (const n of data.nerves.list) cnRecs[n.num] = recs([...n.n, ...(n.branches || []).flatMap(x => x.n)]);
    const cnAll = [...new Set(Object.values(cnRecs).flat())];
    const nuclei = recs([...new Set(data.nerves.list.flatMap(n => n.nuclei || []))]);
    const nucIds = ids(nuclei), cnIds = ids(cnAll);
    const brain = [...cortex, ...deep, ...dien, ...stem, ...cereb, ...septum].filter(r => !vIds.has(r.id) && !cnIds.has(r.id));
    const artKeyOf = new Map();
    for (const a of data.arteries.list) for (const r of recs(a.n || [])) if (!artKeyOf.has(r.id)) artKeyOf.set(r.id, a.key);
    set = {
      cortex, deep, dien, stem, cereb, brain, ventricles, plexus, septum, cnRecs, cnAll, nuclei, artKeyOf,
      sinuses: [...groupRecs('Dural venous sinuses'), ...recs(['Internal jugular vein'])].filter(r => !MISPLACED_SINUS.has(r.n)),
      // modelin A. communicans anterior'u yanlış yerde: gösterilmez, yerine şematik tüp çizilir
      arteries: [...artKeyOf.keys()].map(id => model.items.get(id)).filter(r => r?.mesh && r.n !== 'Anterior communicating artery'),
      skull: groupRecs('Cranium').filter(r => r.n !== 'Parietal bone'),   // kafa tabanı görünümü: tavan kemiği tümüyle kesik
      stemOnly: stem.filter(r => !vIds.has(r.id) && !nucIds.has(r.id) && !cnIds.has(r.id)),
      dienCtx: dien.filter(r => !vIds.has(r.id) && !cnIds.has(r.id) && !nucIds.has(r.id)),
      core: [...stem, ...ventricles],
    };
    const fam = (pal, em) => Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, solid(c, em)]));
    mats = {
      // neredeyse görünmez bağlam tıklanmaz: tıklama içindeki ventriküle, beyin sapına ya da sinire gelsin
      ctx: noPick(tint(COL.ctx, 0.006, 0.1)), ctxN: noPick(tint(COL.ctx, 0.02, 0.26)), ctxOn: tint(0xe9dcb0, 0.05, 0.5),
      csf: tint(COL.csf, 0.07, 0.6), csfOn: tint(COL.csf, 0.26, 0.85), plexus: solid(COL.plexus, 0.15), plexusT: tint(COL.plexus, 0.16, 0.55),
      septum: tint(0xcfe6f2, 0.1, 0.6), mark: new THREE.MeshBasicMaterial({ color: 0xeafcff, depthTest: false, transparent: true, opacity: 0.95 }),
      ven: tint(COL.ven, 0.16, 0.6), venOn: tint(0x6fa8ff, 0.32, 0.85), venS: solid(COL.ven, 0.12),
      pale: new THREE.MeshStandardMaterial({ color: COL.pale, roughness: 0.7, metalness: 0 }), stemGhost: tint(0xd8c3bc, 0.035, 0.42),
      cn: fam(CN_COLOR, 0.22), nuc: fam(CN_COLOR, 0.45), art: fam(ART_COLOR, 0.3),
      skullCut: noPick(tintBelow(0xe8dcc0, 0.035, 0.42, SKULL_CUT_Y)),   // kesilen kubbe görünmez; tıklama oraya gitmesin
      cord: solid(COL.cord, 0.12), dura: tint(0x9fd0e0, 0.06, 0.5), lig: tint(0xd9d0b0, 0.07, 0.5), terr: terrMaterial(),
      cereb: fam({ sca: ART_COLOR.sca, aica: ART_COLOR.aica, pica: ART_COLOR.pica }, 0.18),
      nerveQ: solid(0xf0dc8c, 0.2), artQ: solid(0xd9534a, 0.2), nucQ: solid(0xe8c070, 0.35),
    };
    // kesit yüzü: beslenme alanı renginde (parçanın çoğunluk alanı)
    mats.terr.userData.capColor = r => G.terr?.cap.get(r.id) || null;
    const visible = r => !!(state.isolate?.has(r.id) || state.isoGhost?.has(r.id));
    test = createStudyQuiz({ recs, items: quizItems(), facts: data.quiz, cats: [['csf', 'cat.csf'], ['cn', 'cat.cn'], ['art', 'cat.art']], refresh, stage, model, visible });
    built = true;
  }
  // Yapı testi havuzu: her madde yapının bütün parçalarıyla (ör. MCA'nın bütün dalları; V'nin bütün dalları): parçalardan
  // birine tıklamak doğru sayılır. Aynı kategoridekiler birbirine çeldirici olur; bütün ve kendi parçası çeldirici olmaz.
  // Modelde yanlış yerde duran yapılar sorulmaz.
  function quizItems() {
    const out = [];
    for (const n of VENTRICLES) out.push({ n: [n], cat: 'csf' });
    out.push({ n: ['Choroid plexus'], cat: 'csf' }, { n: ['Septum pellucidum'], cat: 'csf' });
    for (const n of ['Superior sagittal sinus', 'Inferior sagittal sinus', 'Transverse sinus', 'Sigmoid sinus', 'Cavernous sinus', 'Superior petrosal sinus', 'Internal jugular vein']) out.push({ n: [n], cat: 'sin' });
    for (const cn of data.nerves.list) {
      if (cn.inModel === false || !cn.n.length) continue;
      const parts = cn.num === 'II' ? ['Optic nerve (II)'] : [...new Set([...cn.n, ...(cn.branches || []).flatMap(x => x.n)])];
      out.push({ n: parts, la: `${cn.la} (${cn.num})`, de: cn.de, cat: 'cn' });
    }
    for (const n of ['Ophthalmic nerve', 'Maxillary nerve', 'Lingual nerve', 'Inferior alveolar nerve', 'Chorda tympani', 'Optic chiasm', 'Optic tract']) out.push({ n: [n], cat: 'cnb' });
    out.push({ n: ['Midbrain', 'Superior colliculus', 'Inferior colliculus', 'Base of peduncle', 'Interpeduncular fossa'], cat: 'bs' }, { n: ['Pons'], cat: 'bs' },
      { n: ['Medulla oblongata', 'Olive', 'Pyramid of medulla oblongata'], cat: 'bs' });
    for (const n of ['Olive', 'Pyramid of medulla oblongata', 'Superior colliculus', 'Inferior colliculus']) out.push({ n: [n], cat: 'bs' });
    for (const n of new Set(data.nerves.list.flatMap(x => x.nuclei || []))) out.push({ n: [n], cat: 'nuc' });
    for (const a of data.arteries.list) if (a.n?.length && a.key !== 'acom' && a.key !== 'lenticulostriate') out.push({ n: a.n, la: a.la, de: a.de, cat: 'art' });
    return out;
  }

  // --- geometri ---
  // Bir hesabı kamera uçuşundan sonra çalıştır; bitince mod hâlâ o sekmedeyse görünümü yenile. Başarısız olan yeniden denenmez.
  function compute(key, fn, tab) {
    if (busy.has(key) || failed.has(key)) return;
    busy.add(key);
    later(() => {
      try { fn(); } catch (e) { failed.add(key); console.warn('beyin modu: hesaplanamadı:', key, e); }
      busy.delete(key);
      if (active && (!tab || b.tab === tab)) { applyTab(); refresh(); }
    });
  }
  // BOS yolu: ventriküllerin içinden akış (brain-csf.js ventricularFlow), subaraknoid yol (sol), venöz yol (iki yan),
  // granülasyon ve delik işaretleri. İki parça: ventriküller ve geri kalanı (her biri birkaç yüz ms).
  function csfVentricles() {
    const lv = { l: one('Lateral ventricle', 'l'), r: one('Lateral ventricle', 'r') }, cp = { l: one('Choroid plexus', 'l'), r: one('Choroid plexus', 'r') };
    const f = GC.ventricularFlow({ lv: { l: mesh(lv.l), r: mesh(lv.r) }, plexus: { l: mesh(cp.l), r: mesh(cp.r) },
      v3: mesh(one('Third ventricle')), aq: mesh(one('Aqueduct of midbrain')), v4: mesh(one('Fourth ventricle')) }, { hV3: 0.05, hAq: 0.02, hV4: 0.06 });
    const K = f.keys, by = Object.fromEntries(f.curves.map(c => [c.key, c]));
    const c = G.csf = { curves: [], pts: {}, gran: [], marks: [], keys: K };
    for (const cv of f.curves) c.curves.push({ pts: cv.ctrl.map(V3), color: 0x4fdcff, tube: 0.04, dot: 0.11, gap: 0.55, speed: 1.6, seg: Math.max(48, cv.ctrl.length * 14) });
    // etiket yerleri (geo-csf.md §7): saydam ventriküllerde hesaplanan iç noktalar
    const b3 = model.boundsOf(recs(['Third ventricle'])).getCenter(new THREE.Vector3());
    const near = (pts, q) => pts.reduce((a, p) => (Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z) < Math.hypot(a[0] - q.x, a[1] - q.y, a[2] - q.z) ? p : a));
    Object.assign(c.pts, {
      plexus: anchorOf(recs(['Choroid plexus']).filter(r => r.sd === 'l'), V3(K.glomus.l)), lateral: V3(at(by['lv.l'].dense, 0.45)),
      monro: V3(avg([K.monro.l.a, K.monro.l.b])), third: V3(near(by.main.dense, b3)), aqueduct: V3(avg([K.aqTop, K.aqBot])),
      fourth: V3(K.branch4), magendie: V3(K.magendie),
    });
    // modelde olmayan delikler: iki Foramen interventriculare, Apertura mediana ve iki Apertura lateralis noktayla
    c.marks.push(...[avg([K.monro.l.a, K.monro.l.b]), avg([K.monro.r.a, K.monro.r.b]), K.magendie, K.luschkaL, K.luschkaR].map(V3));
  }
  function csfRest() {
    const c = G.csf; if (!c) return;
    const sssRec = one('Superior sagittal sinus'), sss = mesh(sssRec), bx = GC.meshBounds(sss);
    const line = GC.tubeCenterline(sss, { from: [0, (bx.mn[1] + bx.mx[1]) / 2, bx.mx[2]] });
    const vtx = line.pts.reduce((a, p) => (p[1] > a[1] ? p : a));
    // subaraknoid yol: sol yanda (kamera soldan bakar), orak beyinden 1 cm uzakta
    const brainM = [...set.cortex, ...set.cereb, ...recs(['Medulla oblongata', 'Pons', 'Midbrain'])].map(mesh);
    const route = GC.subarachnoidRoute(brainM, { start: c.keys.magendieOut, end: [0.15, vtx[1] - 0.1, vtx[2]], side: 1, skull: groupRecs('Cranium').map(mesh) });
    c.curves.push({ pts: GC.fitAlong(route.pts, 0.08, 1.0).ctrl.map(V3), color: COL.sas, tube: 0.04, dot: 0.09, gap: 0.9, speed: 2.2, opacity: 0.6, seg: 220 });
    c.pts.cisterna = V3(route.cisternaMagna); c.pts.sas = V3(at(route.pts, 0.62));
    c.gran = GC.granulations(line, vtx, { n: 4, spread: 1.6, side: 1 }).map(g => V3(g.marker));
    c.pts.gran = c.gran[1];
    // venöz yol: iki yan (modelde baskın yan yok); Confluens sinuum ayrı parça değil: noktayla
    const sd = s => ({ l: mesh(one(s, 'l')), r: mesh(one(s, 'r')) });
    const sin = { sss, ts: sd('Transverse sinus'), sig: sd('Sigmoid sinus'), ijv: sd('Internal jugular vein') };
    for (const side of ['l', 'r']) {
      const vr = GC.venousRoute(sin, { side, from: vtx });
      c.curves.push({ pts: vr.ctrl.map(V3), color: 0x6f9fff, tube: 0.045, dot: 0.1, gap: 1.0, speed: 2.6, seg: 360 });
      if (side === 'l') { Object.assign(c.pts, { sss: V3(at(vr.pieces.sss, 0.5)), sinus: V3(at(vr.pieces.ts, 0.5)), ijv: V3(at(vr.pieces.ijv, 0.25)) }); c.marks.push(V3(vr.confluence)); }
    }
  }
  // akış çizgileri, granülasyon ve delik işaretleri (ikinci hesap bitince yeniden kurulur: subaraknoid ve venöz yol eklenir)
  function csfDraw() {
    const c = G.csf; if (!c) return;
    if (c.group) { root.remove(c.group); c.group.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== mats.mark) o.material.dispose?.(); }); }
    c.flow = flowLines(c.curves);
    c.group = new THREE.Group(); c.group.add(c.flow.group);
    const ball = new THREE.SphereGeometry(0.16, 14, 10), gm = new THREE.MeshBasicMaterial({ color: 0xd8f6ff }), dot = new THREE.SphereGeometry(0.1, 12, 8);
    for (const p of c.gran) { const m = new THREE.Mesh(ball, gm); m.position.copy(p); c.group.add(m); }
    for (const p of c.marks) { const m = new THREE.Mesh(dot, mats.mark); m.position.copy(p); m.renderOrder = 5; c.group.add(m); }
    c.group.visible = false; root.add(c.group);
  }
  // Lomber ponksiyon (brain-csf.js lumbarPuncture): bedene göre (kalça kemikleri ve sacrum kadında ayrı)
  // sırt kasları (deri noktası) ve bağlar (katmanlar) kas ve eklem sistemlerinde: onlar yüklenmeden hesap eksik kalır;
  // eksik sonuç saklanır ama sistemler yüklenince yeniden hesaplanır
  const LP_SYS = ['muscle', 'joint'];
  function lpGeo() {
    const sex = state.sex, full = LP_SYS.every(s => model.loaded[s] || model.failed?.has(s)), old = G.lp[sex];
    if (old && (old.full || !full)) return old;
    if (old) { root.remove(old.group); old.group.traverse(o => o.geometry?.dispose()); }
    const vert = Object.fromEntries(['L1', 'L2', 'L3', 'L4', 'L5'].map(k => [k, one('Vertebra ' + k)]).filter(([, r]) => r).map(([k, r]) => [k, mesh(r)]));
    const opt = (n, sd) => { const r = one(n, sd); return r ? mesh(r) : null; };
    const layers = Object.fromEntries(['Supraspinous ligament', 'Interspinous ligaments', 'Ligamenta flava', 'Cauda equina'].map(n => [n, opt(n)]).filter(([, m]) => m));
    const L = GC.lumbarPuncture({ vertebrae: vert, sacrum: opt('Sacrum'), hip: { l: opt('Hip bone', 'l'), r: opt('Hip bone', 'r') }, cord: groupRecs('Spinal cord').map(mesh),
      dura: opt('Spinal dura'), cauda: opt('Cauda equina'), back: recs(BACK).map(mesh), layers });
    const g = new THREE.Group(), pts = {};
    const needleM = new THREE.MeshBasicMaterial({ color: COL.needle }), dotM = new THREE.MeshBasicMaterial({ color: 0xffd479, depthTest: false, transparent: true });
    const tube = (a, bb, r, m) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V3(a), V3(bb)), 2, r, 8, false), m);
    const ball = (p, r, m) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); s.position.copy(V3(p)); s.renderOrder = 5; return s; };
    for (const k of ['L3/L4', 'L4/L5']) {
      const it = L.interspaces[k]; if (!it?.canal) continue;
      g.add(tube(it.skin, it.canal, 0.045, needleM), ball(it.skin, 0.22, dotM));
      pts[k] = V3(it.skin);
    }
    if (L.conus) { g.add(ball(L.conus.point, 0.2, new THREE.MeshBasicMaterial({ color: 0xff8a6a, depthTest: false, transparent: true }))); pts.conus = V3(L.conus.point); }
    const cauda = one('Cauda equina');
    if (L.s2?.sacEnd) {
      g.add(ball(L.s2.sacEnd, 0.2, new THREE.MeshBasicMaterial({ color: 0x7fe3ff, depthTest: false, transparent: true }))); pts.sac = V3(L.s2.sacEnd);
      // dural kese ve Cisterna lumbalis modelde yok: konustan S2'ye kanal boyunca (cauda equina'nın her 1 cm'deki ortası)
      // şematik saydam tüp; iğnelerin ucu (cauda'nın ortası) tüpün içinde kalır
      if (L.conus && cauda) {
        const P = cauda.geo.attributes.position.array, path = [L.conus.point];
        for (let y = L.conus.point[1] - 1; y > L.s2.sacEnd[1] + 0.5; y -= 1) {
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.4 && Math.abs(P[i]) < 1.5) { sx += P[i]; sy += P[i + 1]; sz += P[i + 2]; n++; }
          if (n) path.push([sx / n, sy / n, sz / n]);
        }
        path.push(L.s2.sacEnd);
        if (path.length > 2) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path.map(V3), false, 'centripetal'), path.length * 6, 0.45, 12, false), tint(COL.csf, 0.08, 0.55)));
      }
    }
    if (L.tuffier) {
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(L.tuffier.left), V3(L.tuffier.right)]), new THREE.LineDashedMaterial({ color: 0xffd479, dashSize: 0.5, gapSize: 0.35, depthTest: false, transparent: true }));
      ln.computeLineDistances(); ln.renderOrder = 5; g.add(ln);
      pts.jacoby = V3(L.tuffier.left); pts.jacobyLevel = L.tuffier.spinous;   // etiket sol crista iliaca'nın tepesinde
    }
    g.visible = false; root.add(g);
    const lev = s => (s || '').split(' ')[0];
    return (G.lp[sex] = { group: g, pts, conusLevel: lev(L.conus?.level), full });
  }
  // Kranial sinirler (brain-nerves.js; geo-nerves.md §11): sol yanda her sinir için merkez çizgisi, beyinden çıkış ve kafa
  // tabanındaki delik; ardından ortak noktalar (Fissura orbitalis superior, Foramen jugulare, Foramen magnum) ve etiket
  // yerleri. Sinir başına bir iş, işler arasında çizim sürer.
  function computeNerves() {
    if (G.cn || busy.has('cn')) return;
    busy.add('cn');
    const sd = 'l', K = {};
    const brainG = recs(BRAINSTEM).map(r => r.geo), boneRecs = recs(SKULL_BONES), bones = boneRecs.map(r => r.geo);
    const stem = recs(['Midbrain', 'Pons', 'Medulla oblongata']).map(r => r.geo);
    const jobs = CN_GEO.map(([k, meshName, rootName, want]) => () => {
      const rec = one(meshName, sd); if (!rec) return;
      const rp = rootName === 'V' ? K.V?.exit?.p : GN.centroidOf(one(rootName, sd).geo).c;
      if (!rp) return;
      const cl = GN.centreline(rec.geo, { root: rp, maxGeo: 12 });
      let exit = null;
      if (k !== 'V1' && k !== 'V2') {
        exit = GN.brainExit(cl.pts, k === 'II' ? recs(['Optic chiasm']).map(r => r.geo) : brainG);
        if (k === 'IV') { const i = GN.extremeIndex(cl.pts, [0, 0, -1], 0, cl.pts.length >> 1); exit = { ...exit, i, p: cl.pts[i] }; }
      }
      const from = exit ? exit.i : 0;
      const prof = GN.enclosureProfile(cl.pts, bones, { R: 1.5, nDirs: 12, every: 2, from, to: Math.min(cl.pts.length - 1, from + 90) });
      const runs = GN.foramenRuns(cl.pts, prof, { thr: 0.75, gap: 0.3 }).filter(r => want.includes(boneRecs[r.bones[0]?.[0]]?.n));
      const opening = runs.length ? runs.reduce((a, c) => (c.len > a.len ? c : a)) : null;
      const label = exit ? (k === 'II' ? GN.offsetPoint(exit.p, exit.n, 0.35) : GN.radialOffset(exit.p, stem, 0.45)) : null;
      K[k] = { cl, exit, opening, label };
    });
    jobs.push(() => {
      const out = { exit: {}, exitAt: {}, open: [], nuclei: {} };
      // VII–X: ders kitabı sırasıyla dikey etiket merdiveni (modelde X kökleri IX'un biraz üstünde)
      const four = ['VII', 'VIII', 'IX', 'X'];
      if (four.every(k => K[k]?.label)) GN.ladder(four.map(k => K[k].label), 0.45, 0.2).forEach((p, i) => { K[four[i]].label = p; });
      for (const k of ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']) if (K[k]?.label) { out.exit[k] = V3(K[k].label); if (K[k].exit) out.exitAt[k] = V3(K[k].exit.p); }
      // I: koku soğanı ve yolu (sol); Lamina cribrosa: fila uçlarından aşağı Os ethmoidale'ye
      const olf = recs(['Olfactory nerve (I)']).filter(r => r.sd === sd);
      let plate = null;
      if (olf.length) {
        out.exit.I = anchorOf(olf);
        const P = olf[0].geo.attributes.position.array; let minY = Infinity;
        for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]);
        const low = []; for (let i = 0; i < P.length; i += 3) if (P[i + 1] < minY + 0.25) low.push([P[i], P[i + 1], P[i + 2]]);
        const c0 = avg(low), eth = one('Ethmoid bone');
        if (eth) {
          if (!eth.geo.boundsTree) eth.geo.computeBoundsTree();
          const hit = eth.geo.boundsTree.raycastFirst(new THREE.Ray(V3(c0), new THREE.Vector3(0, -1, 0)), THREE.DoubleSide);
          plate = hit ? [hit.point.x, hit.point.y, hit.point.z] : [c0[0], c0[1] - 0.43, c0[2]];
        }
      }
      // ortak delikler: üst orbita yarığı (III, IV, V1, VI) ve Foramen jugulare (IX, X, XI run ortalarının ortalaması)
      const cut = k => K[k].cl.pts.slice(K[k].exit ? K[k].exit.i : 0, (K[k].opening?.i1 ?? 60) + 20);
      const sofK = ['III', 'IV', 'V1', 'VI'].filter(k => K[k]);
      const sof = sofK.length > 1 ? GN.convergence(sofK.map(cut)).c : null;
      const mids = ['IX', 'X', 'XI'].map(k => K[k]?.opening?.mid).filter(Boolean);
      // VII: Porus acusticus internus (Os temporale'ye ilk giriş) ve Foramen stylomastoideum (son çıkış)
      let porus = null, stylo = null;
      if (K.VII) {
        const temporal = boneRecs.filter(r => r.n === 'Temporal bone' && r.sd === sd).map(r => r.geo);
        const hits = GN.segmentBoneHits(K.VII.cl.pts, temporal, { from: K.VII.exit ? K.VII.exit.i : 0 });
        if (hits.length) { porus = hits[0].p; stylo = hits[hits.length - 1].p; }
      }
      // Foramen magnum: Os occipitale'nin orta hat dilimindeki en büyük ön-arka boşluk (arkada opisthion, önde basion);
      // XI'in merkez çizgisinin bu düzlemi kestiği yer (geo-nerves.md §5, §7.2)
      let magnum = null;
      const occ = one('Occipital bone');
      if (occ && K.XI) {
        const P = occ.geo.attributes.position.array, zs = [];
        for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.35 && P[i + 1] > 153 && P[i + 1] < 158.5) zs.push([P[i + 2], P[i + 1]]);
        zs.sort((a, c) => a[0] - c[0]);
        let gap = 0, bi = -1; for (let i = 0; i + 1 < zs.length; i++) { const d = zs[i + 1][0] - zs[i][0]; if (d > gap) { gap = d; bi = i; } }
        if (gap > 2.5) {
          const op = zs[bi], ba = zs[bi + 1], yAt = z => op[1] + (z - op[0]) * (ba[1] - op[1]) / (ba[0] - op[0]);
          const pts = K.XI.cl.pts;
          for (let i = 1; i < pts.length && !magnum; i++) {
            const a = pts[i - 1], c = pts[i], fa = a[1] - yAt(a[2]), fc = c[1] - yAt(c[2]);
            if ((fa <= 0 && fc > 0) || (fa >= 0 && fc < 0)) { const t = fa / (fa - fc); magnum = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]; }
          }
        }
      }
      out.open = [
        { la: 'Lamina cribrosa', nums: ['I'], p: plate },
        { la: 'Canalis opticus', nums: ['II'], p: K.II?.opening?.entry },
        { la: 'Fissura orbitalis superior', nums: ['III', 'IV', 'V1', 'VI'], p: sof },
        { la: 'Foramen rotundum', nums: ['V2'], p: K.V2?.opening?.mid },
        { la: 'Foramen ovale', nums: ['V3'], p: K.V?.opening?.mid },
        { la: 'Porus acusticus internus', nums: ['VII', 'VIII'], p: porus },
        { la: 'Foramen stylomastoideum', nums: ['VII'], p: stylo },
        { la: 'Foramen jugulare', nums: ['IX', 'X', 'XI'], p: mids.length ? avg(mids) : null },
        { la: 'Canalis n. hypoglossi', nums: ['XII'], p: K.XII?.opening?.mid },
        { la: 'Foramen magnum', nums: ['XI'], p: magnum },
      ].filter(o => o.p).map(o => ({ ...o, p: V3(o.p) }));
      for (const n of data.nerves.list) out.nuclei[n.num] = (n.nuclei || []).map(name => one(name, sd)).filter(Boolean).map(r => ({ r, p: V3(GN.centroidOf(r.geo).c) }));
      G.cn = out;
    });
    const run = i => later(() => {
      if (i >= jobs.length) { busy.delete('cn'); if (!G.cn) failed.add('cn'); if (active && b.tab === 'nerves') { applyTab(); refresh(); } return; }
      try { jobs[i](); } catch (e) { console.warn('beyin modu: sinir geometrisi:', CN_GEO[i]?.[0] || 'son', e); }
      run(i + 1);
    });
    run(0);
  }
  // Arterler (brain-arteries.js): Willis halkası bağlantıları ve etiket yerleri
  function artGeo() {
    const part = r => (r ? GA.toPI(r.geo) : null), o = (n, sd) => part(one(n, sd));
    const W = GA.willisLinks({
      acaL: o('Anterior cerebral artery', 'l'), acaR: o('Anterior cerebral artery', 'r'), icaL: o('Internal carotid artery', 'l'), icaR: o('Internal carotid artery', 'r'),
      pcaL: o('Posterior cerebral artery', 'l'), pcaR: o('Posterior cerebral artery', 'r'), basilar: o('Basilar artery'),
      pcoaL: o('Posterior communicating artery', 'l'), pcoaR: o('Posterior communicating artery', 'r'), acoa: o('Anterior communicating artery'),
    });
    const g = new THREE.Group();
    const tube = (a, bb, r, m) => g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(V3(a), V3(bb)), 4, r, 10, false), m));
    tube(W.acoa.ca, W.acoa.cb, 0.07, mats.art.acom);
    for (const s of ['L', 'R']) { const br = W.bridges['icaPcoa' + s]; if (br) tube(br.a, br.b, 0.07, mats.art.pcom); }
    g.visible = false; root.add(g);
    // etiketler: her arterin sol (ya da tek) parçasının gövde yolunda, Willis halkasının ortasına en yakın noktadan
    // ART_LABEL_OFF kadar uzakta (ICA'nın ucundan aşağı, vertebralisin bazilere katıldığı yerden aşağı, PICA'nın çıkışından
    // dışa…); alttan bakışta kameraya bakan yüzünde
    const acoaMid = avg([W.acoa.a, W.acoa.b]);
    const tip = GA.trunkPath(o('Basilar artery')).pts.at(-1);
    const C = avg([acoaMid, tip]);
    const toCam = new THREE.Vector3(0, -0.97, 0.243).normalize().toArray();
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const lbl = {};
    for (const a of data.arteries.list) {
      if (a.key === 'acom') { lbl[a.key] = V3(acoaMid); continue; }
      const r = recs(a.n || []).find(x => x.sd === 'l') || recs(a.n || [])[0]; if (!r) continue;
      try {
        const pts = GA.trunkPath(GA.toPI(r.geo)).pts;
        let i0 = 0; pts.forEach((p, i) => { if (dist(p, C) < dist(pts[i0], C)) i0 = i; });
        const off = ART_LABEL_OFF[a.key] ?? 1, dir = i0 < pts.length / 2 ? 1 : -1;
        let i = i0, s = 0;
        if (off === 0) i = pts.length >> 1;
        else while (i + dir >= 0 && i + dir < pts.length && s < off) { s += dist(pts[i], pts[i + dir]); i += dir; }
        lbl[a.key] = V3(pts[i].map((x, k) => x + 0.15 * toCam[k]));
      } catch { lbl[a.key] = anchorOf([r]); }
    }
    G.art = { group: g, lbl, willis: W };
  }
  // Beslenme alanları: sol yarımkürenin kabuk parçaları, ders kitabı tablosu (brain.json) ve bölünmüş parçalarda en yakın tek
  // alanlı komşu parçadan yayılma (territoryLabels 'seed'). Sonuç her parçanın geometrisine aTerr renk özelliği olarak yazılır;
  // kesit yüzü için parçanın çoğunluk alanının rengi saklanır.
  function terrGeo() {
    const T = data.arteries.territories, L = { aca: 'A', mca: 'M', pca: 'P' };
    const code = n => { const v = T.gyri[n]; if (!v) return null; const p = v.split('/').map(x => L[x]); if (p.length === 1) return p[0]; const m = L[T.main?.[n]] || p[0]; return m + p.filter(x => x !== m).join(''); };
    const cortex = set.cortex.filter(r => r.sd === 'l');
    const res = GA.territoryLabels([], cortex.map(r => ({ ...GA.toPI(r.geo), code: code(r.n) })), { mode: 'seed', h: 0.2 });
    const cols = TERR.map(c => new THREE.Color(c)), rgb = cols.map(c => c.toArray());
    const cap = new Map();
    cortex.forEach((r, i) => {
      const n = res.offs[i + 1] - res.offs[i], arr = new Float32Array(n * 3), cnt = [0, 0, 0];
      for (let k = 0; k < n; k++) { const l = res.lab[res.offs[i] + k]; arr.set(rgb[l] || rgb[1], k * 3); cnt[l in cnt ? l : 1]++; }
      r.geo.setAttribute('aTerr', new THREE.BufferAttribute(arr, 3));
      cap.set(r.id, cols[cnt.indexOf(Math.max(...cnt))]);
    });
    G.terr = { parts: new Set(cortex.map(r => r.id)), cap };
  }

  // --- sekmeler ---
  const csfStep = () => data.csf.steps[b.step];
  const csfZone = () => (csfStep().view === 'lumbar' ? 'lumbar' : INNER.has(csfStep().key) ? 'inner' : 'outer');
  function applyTab() {
    const ov = model.overrides; ov.clear();
    const put = (rs, m) => { for (const r of rs) ov.set(r.id, m); };
    for (const x of [G.csf, G.art, ...Object.values(G.lp)]) if (x?.group) x.group.visible = false;
    let ghost = null, list = [];
    const onlyOn = l => !narrow() || l.cls === 'on';
    if (b.tab === 'csf') {
      const s = csfStep();
      if (s.view === 'lumbar') {
        const cord = groupRecs('Spinal cord'), cauda = recs(['Cauda equina']), dura = recs(['Spinal dura']), lig = recs(s.layers || []);
        put(cord, mats.cord); put(cauda, mats.cord); put(dura, mats.dura); put(lig, mats.lig);
        // bağlar eklem sisteminde (katmanı kapalı olabilir): bağlam olarak her durumda çizilir
        state.isolate = ids([...cord, ...cauda, ...dura]); ghost = ids([...recs(s.bones || []), ...lig]);
        // kas ve eklem sistemi yüklenmemişse (telefonda gerektiğinde yükleme) istenir; yüklenince sahne yeniden kurulur
        const need = LP_SYS.find(k => !model.loaded[k] && !model.failed?.has(k));
        if (need) defer(need, () => { if (active && b.tab === 'csf' && csfStep().view === 'lumbar') { applyTab(); refresh(); } });
        let lp = null;
        try { lp = lpGeo(); } catch (e) { failed.add('lp'); console.warn('beyin modu: lomber ponksiyon hesaplanamadı:', e); }
        if (lp) {
          lp.group.visible = true;
          const P = lp.pts, lvl = P.jacobyLevel || [], lev = lvl.length ? `Dornfortsatz ${lvl.join('/')}` : '';
          const off = (p, dx, dy, dz) => p.clone().add(new THREE.Vector3(dx, dy, dz));
          list = [
            P['L3/L4'] && { text: '<b>L3/L4</b>', p: off(P['L3/L4'], 0, 0.6, -2.6), at: P['L3/L4'], cls: 'on' }, P['L4/L5'] && { text: '<b>L4/L5</b>', p: off(P['L4/L5'], 0, -0.6, -2.6), at: P['L4/L5'], cls: 'on' },
            P.conus && { text: `Conus medullaris <small>(modelde ${esc(lp.conusLevel)}, normalde L1/L2)</small>`, p: off(P.conus, 0, 0, 4.5), at: P.conus },
            P.sac && { text: 'Saccus duralis sonu ≈ S2 <small>(şematik)</small>', p: off(P.sac, 0, 0, 4.5), at: P.sac },
            P.jacoby && { text: `Jacoby-Linie${lev ? ' → ' + esc(lev) : ''}${lvl.length && !lvl.includes('L4') ? ' <small>(bu modelde; ders kitabı: L4)</small>' : ''}`, p: off(P.jacoby, 1.2, 1.6, -0.5), at: P.jacoby },
          ].filter(Boolean);
        }
      } else {
        const on = new Set(s.n || []), ctx = recs((s.ctx || []).filter(n => !MISPLACED_SINUS.has(n)));
        put(set.brain, mats.ctx); put(ctx, mats.ctxOn);
        for (const r of set.ventricles) ov.set(r.id, on.has(r.n) ? mats.csfOn : mats.csf);
        put(set.septum, on.has('Septum pellucidum') ? mats.csfOn : mats.septum);
        put(set.plexus, on.has('Choroid plexus') ? mats.plexus : mats.plexusT);   // akış çizgisi pleksusun üstünden geçer: kendi adımı dışında saydam
        for (const r of set.sinuses) ov.set(r.id, on.has(r.n) ? mats.venOn : mats.ven);
        state.isolate = ids([...set.brain, ...set.ventricles, ...set.plexus, ...set.sinuses, ...ctx]);
        if (!G.csf) compute('csf1', () => { csfVentricles(); compute('csf2', () => { csfRest(); csfDraw(); }, 'csf'); csfDraw(); }, 'csf');
        if (G.csf?.group) G.csf.group.visible = true;
        list = data.csf.steps.map((st, i) => { if (st.view === 'lumbar') return null; const p = stepAnchor(st); return p && { text: i === b.step ? `<b>${i + 1}</b> ${esc(st.lab)}` : `<b>${i + 1}</b>`, p, cls: i === b.step ? 'on' : 'num' }; }).filter(Boolean);
      }
    } else if (b.tab === 'nerves') {
      const view = b.cnView, cur = data.nerves.list[b.cn];
      for (const n of data.nerves.list) put(set.cnRecs[n.num] || [], mats.cn[n.num]);
      if (view === 'nuclei') {
        // beyin sapı saydam, IV. ventrikül gizli (çekirdekler tabanının hemen altında); sinirlerden yalnız seçili olan
        put(set.stemOnly, mats.stemGhost);
        for (const n of data.nerves.list) put(recs(n.nuclei || []), mats.nuc[n.num]);
        put(recs(cur.nuclei || []), mats.nuc[cur.num]);
        state.isolate = ids([...set.stemOnly, ...set.nuclei, ...(set.cnRecs[cur.num] || [])]);
      } else if (view === 'skull') {
        put(set.stemOnly, mats.pale);
        put(set.skull, mats.skullCut);
        state.isolate = ids([...set.stem, ...set.cnAll]); ghost = ids(set.skull);
      } else {
        put(set.stemOnly, mats.pale); put(set.cereb, mats.ctx); put(set.dienCtx, mats.ctx);
        state.isolate = ids([...set.stem, ...set.cereb, ...set.dienCtx, ...set.cnAll]);
      }
      if (!G.cn) computeNerves();
      else if (view === 'exit') list = data.nerves.list.filter(n => G.cn.exit[n.num]).map(n => ({ text: n.num === cur.num ? `<b>${n.num}</b> ${esc(n.la.replace('Nervus ', 'N. '))}` : `<b>${n.num}</b>`, p: G.cn.exit[n.num], at: G.cn.exitAt[n.num] || null, cls: n.num === cur.num ? 'on' : 'num' })).filter(onlyOn);
      else if (view === 'skull') {
        const curNums = cur.num === 'V' ? ['V1', 'V2', 'V3'] : [cur.num];
        list = skullCallouts().map(({ o, p }) => { const on = o.nums.some(x => curNums.includes(x)); return { text: `${esc(o.la)} <b>${o.nums.join(', ')}</b>`, p, at: o.p, align: 'end', cls: on ? 'on' : '' }; }).filter(onlyOn);
      } else {
        // çekirdekler birbirine yakın: yanda dikey sıra (aralar en az 0,55 cm), etiketten çekirdeğe çizgi
        const ns = (G.cn.nuclei[cur.num] || []).slice().sort((p1, p2) => p2.p.y - p1.p.y);
        let prev = Infinity;
        list = ns.map(({ r, p }) => { const y = Math.min(p.y, prev - 0.55); prev = y; return { text: esc(titleName(r)), p: new THREE.Vector3(p.x + 1.6, y, p.z), at: p, align: 'end', cls: 'on' }; });
      }
    } else if (b.tab === 'arteries') {
      const view = b.artView;
      for (const r of set.arteries) ov.set(r.id, mats.art[set.artKeyOf.get(r.id)] || mats.art.ica);
      if (view === 'basal') {
        // yer işareti: kiazma ve görme sinirleri soluk (ACoA kiazmanın önünde-üstünde)
        const optic = recs(['Optic chiasm', 'Optic nerve (II)', 'Optic tract']);
        put([...set.cortex, ...set.deep, ...set.dienCtx, ...set.stemOnly, ...set.cereb], mats.ctxN); put(optic, mats.ctxOn);
        state.isolate = ids([...set.cortex, ...set.deep, ...set.dienCtx, ...set.stemOnly, ...set.cereb, ...set.arteries, ...optic]);
        if (!G.art) compute('art', artGeo, 'arteries');
        else {
          G.art.group.visible = true;
          list = data.arteries.list.filter(a => G.art.lbl[a.key]).map(a => ({ text: esc(a.abbr || a.la), p: G.art.lbl[a.key], cls: data.arteries.list.indexOf(a) === b.art ? 'on' : 'cor' })).filter(onlyOn);
        }
      } else {
        // sol yarımküre: kabuk beslenme alanı renginde, beyincik SCA/AICA/PICA alanında; sağ yarımküre gizli
        const left = r => r.sd !== 'r';
        const cortexL = set.cortex.filter(r => r.sd === 'l');
        if (G.terr) for (const r of cortexL) ov.set(r.id, G.terr.parts.has(r.id) ? mats.terr : mats.ctxN);
        else { put(cortexL, mats.ctxN); compute('terr', terrGeo, 'arteries'); }
        const cmap = data.arteries.territories.cerebellum || {};
        const cereb = set.cereb.filter(left);
        for (const r of cereb) ov.set(r.id, mats.cereb[cmap[r.n]] || mats.ctxN);
        const deepL = [...set.deep, ...set.dienCtx, ...set.stemOnly].filter(left);
        put(deepL, view === 'medial' ? mats.pale : mats.ctx);   // iç yüzde derin yapılar opak: arkadaki insula (MCA) görünmesin
        const artL = set.arteries.filter(left);
        state.isolate = ids([...cortexL, ...cereb, ...deepL, ...artL]);
      }
    } else {
      // testte renk ipucu vermesin: sinirler, arterler ve çekirdekler tek renk; beyin sapı saydam ki çekirdekler görünsün
      put([...set.cortex, ...set.deep], mats.ctx); put(set.ventricles, mats.csf); put(set.septum, mats.septum); put([...set.dienCtx, ...set.cereb], mats.ctxN);
      put(set.stemOnly, mats.stemGhost); put(set.cnAll, mats.nerveQ); put(set.arteries, mats.artQ); put(set.sinuses, mats.venS); put(set.nuclei, mats.nucQ);
      state.isolate = ids([...set.cortex, ...set.deep, ...set.dienCtx, ...set.stem, ...set.cereb, ...set.ventricles, ...set.septum, ...set.plexus, ...set.nuclei, ...set.cnAll, ...set.arteries, ...set.sinuses]);
      test.ensure();
    }
    state.isoGhost = ownGhost = ghost;
    labels.set(list);
  }
  // Kafa tabanı etiketleri: deliklerin dışında (sol yanda) bir sütun; ön-arka sırası korunur, aralar en az 0,9 cm (dar ekranda
  // daha geniş); etiketten deliğe çizgi. Delikler birbirine yakın (Fissura orbitalis superior, Canalis opticus, Foramen
  // rotundum 1 cm içinde). Etiket katmanı ayrıca çakışanları ekranda ayırır.
  function skullCallouts() {
    const os = [...G.cn.open].sort((a, c) => c.p.z - a.p.z);
    const x = Math.max(...os.map(o => o.p.x)) + 1.3, w = stage.canvas.clientWidth;
    const gap = w < 760 ? 1.45 : w < 1100 ? 1.1 : 0.9;
    let prev = Infinity;
    return os.map(o => { const z = Math.min(o.p.z, prev - gap); prev = z; return { o, p: new THREE.Vector3(x, o.p.y, z) }; });
  }
  function stepAnchor(st) {
    const p = G.csf?.pts;
    if (p) { const k = { plexus: 'plexus', lateral: 'lateral', monro: 'monro', third: 'third', aqueduct: 'aqueduct', fourth: 'fourth', apertures: 'magendie', sas: 'sas', granulations: 'gran', sss: 'sss', transverse_sigmoid: 'sinus', ijv: 'ijv' }[st.key]; if (k && p[k]) return p[k]; }
    const rs = recs(st.n || []).filter(r => r.sd !== 'r');
    return rs.length ? anchorOf(rs) : null;
  }
  // Kamera: sekmeye ve görünüme göre (yön: hedeften kameraya)
  function frame() {
    const box = new THREE.Box3(), add = rs => { for (const r of rs) box.union(r.box); };
    let dir;
    if (b.tab === 'csf' && csfStep().view === 'lumbar') { add(recs(['Vertebra L1', 'Vertebra L2', 'Vertebra L3', 'Vertebra L4', 'Vertebra L5', 'Sacrum'])); dir = new THREE.Vector3(0.8, 0.12, -0.75); }   // arka-yan: iğne yolu ve Jacoby çizgisi birlikte
    else if (b.tab === 'csf' && csfZone() === 'inner') { add([...set.ventricles, ...set.plexus].filter(r => r.sd !== 'r')); dir = new THREE.Vector3(1, 0.25, 0.2); }   // sol yan: kamera soldan bakar
    else if (b.tab === 'csf') { add([...set.ventricles, ...set.plexus, ...set.sinuses.filter(r => r.n !== 'Internal jugular vein')]); dir = new THREE.Vector3(1, 0.3, 0.25); }
    else if (b.tab === 'nerves' && b.cnView === 'skull') { add(set.skull.filter(r => r.box.min.y < SKULL_CUT_Y && r.box.max.y > 150)); box.max.y = Math.min(box.max.y, SKULL_CUT_Y); dir = new THREE.Vector3(0, 0.97, -0.24); }
    else if (b.tab === 'nerves') { add(set.stem); for (const k of ['II', 'III', 'V', 'VII', 'IX', 'XII']) for (const r of (set.cnRecs[k] || []).slice(0, 1)) box.expandByPoint(r.box.getCenter(new THREE.Vector3())); dir = b.cnView === 'nuclei' ? new THREE.Vector3(0.55, 0.3, -1) : new THREE.Vector3(0, -0.5, 1); }
    else if (b.tab === 'arteries' && b.artView === 'basal') {
      // Willis halkası çevresi: baziler arter, kiazma ve bağlantı arterleri, payla
      add(recs(['Basilar artery', 'Optic chiasm', 'Posterior communicating artery', 'Anterior communicating artery']));
      box.expandByVector(new THREE.Vector3(2.5, 0.5, 2.8)); dir = new THREE.Vector3(0, -0.97, 0.243);
    }
    else if (b.tab === 'arteries') { add([...set.cortex.filter(r => r.sd === 'l'), ...set.cereb.filter(r => r.sd !== 'r')]); dir = b.artView === 'medial' ? new THREE.Vector3(-1, 0.15, 0.08) : new THREE.Vector3(1, 0.2, 0.1); }
    else { add([...set.cortex, ...set.cereb, ...set.stem]); dir = new THREE.Vector3(0.7, 0.25, 1); }
    stage.frameBox(box, dir);
  }

  // spec: 'bölüm[:görünüm[:sinir]]' (Aanki konu kartından; ör. 'nerves:skull:III')
  function enter(spec = 'csf') {
    for (const s of ['nerve', 'vessel']) if (!model.loaded[s]) { defer(s, () => enter(spec)); return; }
    if (!data) { const seq = ++enterSeq; load().then(() => { if (seq === enterSeq) enter(spec); }, () => {}); return; }
    build();
    endStudy?.('brain');   // başka bir çalışma modu açıksa renklerini ve etiketlerini şimdi kaldırsın
    const [tab, view, num] = String(spec).split(':');
    b.tab = TABS.some(([k]) => k === tab) ? tab : 'csf';
    if (view && b.tab === 'nerves' && CN_VIEWS.some(([k]) => k === view)) b.cnView = view;
    if (view && b.tab === 'arteries' && ART_VIEWS.some(([k]) => k === view)) b.artView = view;
    if (num) { const i = data.nerves.list.findIndex(n => n.num === num); if (i >= 0) b.cn = i; }
    // lomber ponksiyon ayrı bir sahne: moda yeniden girilince BOS yolunun başından başlansın
    if (b.step >= data.csf.steps.length || csfStep().view === 'lumbar') b.step = 0;
    active = true; b.pickedId = null; b.playing = false; b.sex = state.sex; root.visible = true; wasExploded = null;
    state.selected = new Set(); state.primary = { type: 'brain' };
    viewLayers({ nerve: 'show', vessel: 'show' });   // beyin, sinirler ve damarlar; kafatası, omurlar ve bağlar bağlam olarak saydam (isoGhost)
    applyTab();
    refresh();
    frame();
  }
  function cleanup() {
    active = false; b.playing = false; test?.clear(); enterSeq++;
    model.overrides.clear(); if (ownGhost && state.isoGhost === ownGhost) state.isoGhost = null;   // başka görünümün bağlamına dokunma
    ownGhost = null; root.visible = false; labels.set([]);
  }
  // Ana yenilemeden önce: mod bittiyse temizle; beden değiştiyse (lomber ponksiyonda kalça kemikleri ve sacrum ayrı) yeniden kur
  function sync() {
    if (!active) return;
    if (state.primary?.type !== 'brain') { cleanup(); return; }
    if (b.sex !== state.sex) { b.sex = state.sex; applyTab(); }
  }
  // Parıltı: adımın, sinirin ya da arterin yapıları (arter yalnız alttan bakışta), tıklanan yapı, testte sorulan yapı
  function highlight() {
    if (!active || !set) return [];
    let rs = [];
    if (b.tab === 'csf') { const s = csfStep(); rs = s.view === 'lumbar' ? [] : recs(s.n || []); }
    else if (b.tab === 'nerves') { const n = data.nerves.list[b.cn]; rs = (set.cnRecs[n.num] || []).concat(b.cnView === 'nuclei' ? recs(n.nuclei || []) : []); }
    else if (b.tab === 'arteries') { const a = data.arteries.list[b.art]; rs = b.artView === 'basal' ? recs(a?.n || []) : []; }
    else rs = test.asked();
    const picked = b.pickedId && b.tab !== 'quiz' ? model.items.get(b.pickedId) : null;
    if (picked) rs = rs.concat([picked]);
    return rs.filter(r => r.vis).map(r => r.mesh);
  }
  // 3B görünümde tıklanan yapı: bölümün bir adımına (sinire, artere, BOS yapısına) aitse ona geçilir, değilse panelde
  // gösterilir. Testin "Yapıyı bul" sorusunda: tıklanan yapı ya da tıklama ışınında önce sorulan yapı gelirse (önündeki saydam
  // parçalar sayılmaz, opak bir yapı önündeyse sayılır) doğru.
  function onPick(id, x, y) {
    if (!active) return false;
    const r = model.items.get(id); if (!r) return true;
    if (b.tab === 'quiz') {
      const q = test.findQuestion();
      if (q) {
        const want = new Set(q.n); let ok = want.has(r.n);
        if (!ok && x !== undefined) for (const h of model.hitsAt(x, y)) { if (want.has(h.rec.n)) { ok = true; break; } if (!h.soft) break; }
        test.answer(ok, r); refresh();
      }
      return true;
    }
    b.pickedId = null;
    if (b.tab === 'nerves') { const i = data.nerves.list.findIndex(n => (set.cnRecs[n.num] || []).includes(r) || (n.nuclei || []).includes(r.n)); if (i >= 0) b.cn = i; else b.pickedId = r.id; }
    else if (b.tab === 'arteries') { const k = set.artKeyOf.get(r.id), i = data.arteries.list.findIndex(a => a.key === k); if (i >= 0 && b.artView === 'basal') b.art = i; else b.pickedId = r.id; }
    else if (b.tab === 'csf') { const i = data.csf.steps.findIndex(s => s.view !== 'lumbar' && s.n?.includes(r.n)); if (i >= 0 && csfStep().view !== 'lumbar') b.step = i; else b.pickedId = r.id; }
    applyTab(); refresh();
    return true;
  }
  let playT = 0, wasExploded = false;
  stage.onFrame(now => {
    if (!active || !set) return false;
    // parçalarına ayırma: görünen sahnenin parçalarına bakılır (lomber ponksiyonda omurilik)
    const exploded = isExploded(b.tab === 'csf' && csfStep().view === 'lumbar' ? [...groupRecs('Spinal cord'), ...recs(['Cauda equina'])] : set.core);
    if (exploded !== wasExploded) { wasExploded = exploded; root.visible = !exploded; labels.hide(exploded); }
    if (exploded) return false;
    labels.place();
    if (b.playing && now - playT > 2800) { playT = now; go(1, true); }
    if (b.tab === 'csf' && G.csf?.flow && csfStep().view !== 'lumbar') { animateFlow(G.csf.flow, now, 1.6); return true; }
    return false;
  });
  // adım değiştir (BOS yolu ve sinirler); oynatırken lomber ponksiyon sahnesi atlanır; tıklanan yapı bırakılır
  function go(d, auto = false) {
    b.pickedId = null;
    if (b.tab === 'csf') {
      const steps = data.csf.steps, prev = csfZone();
      b.step = (b.step + d + steps.length) % steps.length;
      if (auto && steps[b.step].view === 'lumbar') b.step = 0;
      applyTab(); refresh(); if (csfZone() !== prev) frame();
    } else if (b.tab === 'nerves') { b.cn = (b.cn + d + data.nerves.list.length) % data.nerves.list.length; applyTab(); refresh(); }
  }

  // --- panel ---
  const seg = (list, cur, attr) => `<div class="seg tiny bview">${list.map(([k, t]) => `<button ${attr}="${k}" class="${cur === k ? 'active' : ''}">${t}</button>`).join('')}</div>`;
  const pickedHTML = () => {
    const r = b.pickedId ? model.items.get(b.pickedId) : null; if (!r) return '';
    const extra = data.csf.parts?.[r.n]?.tr;
    return `<div class="field"><div class="k">Tıklanan yapı</div><div class="v"><b lang="la">${esc(titleName(r))}</b>${subtitleName(r) ? ` · <span lang="de">${esc(subtitleName(r))}</span>` : ''}${extra ? `<br><small>${esc(extra)}</small>` : r.tr ? `<br><small>${esc(r.tr)}</small>` : ''}</div></div>`;
  };
  const waiting = key => (busy.has(key) ? '<p class="htext dim">Noktalar modelden hesaplanıyor…</p>' : failed.has(key) ? '<p class="htext dim">Bu görünümün noktaları hesaplanamadı; yapılar yine de gösteriliyor.</p>' : '');
  // modelde olmayan yapılar (içerik ajanlarının ve denetçilerin listesi)
  const notIn = l => (l?.length ? `<details class="clinic notin"><summary>Modelde olmayanlar (${l.length})</summary>${l.map(x => `<p><b lang="la">${esc(x.la || x.for || '')}</b>${x.de ? ` · <span lang="de">${esc(x.de)}</span>` : ''}${x.tr ? `<br><small>${esc(x.tr)}</small>` : ''}</p>`).join('')}</details>` : '');
  function csfHTML() {
    const steps = data.csf.steps, s = csfStep();
    const row = (k, v) => (v ? `<tr><td>${k}</td><td>${v}</td></tr>` : '');
    const lp = s.view === 'lumbar' ? `<table class="cnfacts">
        ${row('Seviye', esc(s.level))}${row('Neden', esc(s.why))}${row('İşaret', esc(s.landmark))}${row('Hedef', esc(s.target))}
        ${row('Katmanlar', `<span lang="de">${(s.layers_de || []).map(esc).join(' → ')}</span>`)}${row('Modelde', esc(s.model_note))}</table>` : '';
    return `
      <div class="stepnav"><button data-ba="prev" title="Önceki adım">◀</button><span>Adım ${b.step + 1} / ${steps.length}</span><button data-ba="next" title="Sonraki adım">▶</button>
        <button data-ba="play" class="${b.playing ? 'active' : ''}">${b.playing ? '❚❚ Durdur' : '▶ Oynat'}</button></div>
      <h1 class="name" lang="la">${esc(s.la)}</h1>
      <div class="name-de" lang="de">${esc(s.de)}</div>
      ${s.schematic ? `<div class="chips"><span class="chip">${s.view === 'lumbar' ? 'Dural kese ve sisterna modelde yok: şematik' : 'Modelde yok: yeri hesaplanmış / şematik'}</span></div>` : ''}
      ${s.view === 'lumbar' ? waiting('lp') : waiting('csf1') || waiting('csf2')}
      <p class="htext">${esc(s.tr)}</p>
      ${lp}
      ${s.facts_de?.length ? `<ul class="facts" lang="de">${s.facts_de.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${s.tip ? `<div class="tip">${esc(s.tip)}</div>` : ''}
      <ol class="flowlist">${steps.map((f, i) => `<li class="${i === b.step ? 'on' : ''} ${f.kind || 'c'}" data-step="${i}">${esc(f.lab)}</li>`).join('')}</ol>
      <div class="legend"><span class="sw c"></span>BOS <span class="sw s"></span>şematik yol <span class="sw v"></span>venöz kan</div>
      ${data.csf.clinic?.length ? `<details class="clinic"><summary>Klinik</summary>${data.csf.clinic.map(c => `<p><b lang="de">${esc(c.de)}</b>: ${esc(c.tr)}</p>`).join('')}</details>` : ''}
      ${notIn(data.csf.notInModel)}
      <p class="htext dim small">Modelde düz ve oksipital sinüs 4,5 cm önde, beyinciğin içinde duruyor; bu yüzden burada gösterilmiyor. Küçük beyaz noktalar modelde olmayan delikleri (iki Foramen interventriculare, Apertura mediana ve aperturae laterales) ve Confluens sinuum'u gösterir.</p>`;
  }
  function cnHTML() {
    const list = data.nerves.list, n = list[b.cn];
    const row = (k, v) => (v ? `<tr><td>${k}</td><td>${v}</td></tr>` : '');
    const small = s => (s ? `<br><small lang="de">${esc(s)}</small>` : '');
    const skull = (n.skull || []).map(s => `<b lang="la">${esc(s.la)}</b>${s.what ? `<br><small lang="de">${esc(s.what)}</small>` : ''}`).join('<br>');
    const br = n.branches?.length ? `<details class="clinic"><summary>Dallar ve parçalar (${n.branches.length})</summary>${n.branches.map(x => `<p><b lang="la">${esc(x.la)}</b>${x.de ? ` · <span lang="de">${esc(x.de)}</span>` : ''}${x.skull_la ? `<br><small lang="la">${esc(x.skull_la)}</small>` : ''}${x.tr ? `<br>${esc(x.tr)}` : ''}</p>`).join('')}</details>` : '';
    const mn = data.nerves.mnemonics || [];
    return `
      ${seg(CN_VIEWS, b.cnView, 'data-bv')}
      <div class="stepnav"><button data-ba="prev" title="Önceki sinir">◀</button><span>${esc(n.num)} / XII</span><button data-ba="next" title="Sonraki sinir">▶</button></div>
      <h1 class="name" lang="la"><span class="cnnum" style="color:${hex(CN_COLOR[n.num])}">${esc(n.num)}</span> ${esc(n.la)}</h1>
      <div class="name-de" lang="de">${esc(n.de)}</div>
      ${waiting('cn')}
      <table class="cnfacts">
        ${row('Nitelik', esc(n.quality_tr) + small(n.quality_de))}
        ${row('Çıkış', esc(n.brain_tr) + small(n.brain_de))}
        ${row('Kafatası', skull)}
        ${row('Çekirdekler', esc(n.nuclei_tr || ''))}
        ${row('İşlev', esc(n.function_tr))}
        ${row('Hasar', esc(n.lesion_tr))}
        ${row('Modelde', esc(n.modelNote || ''))}
      </table>
      ${n.tip ? `<div class="tip">${esc(n.tip)}</div>` : ''}
      ${br}
      <div class="cnlist">${list.map((x, i) => `<button data-cn="${i}" class="${i === b.cn ? 'on' : ''}" style="--c:${hex(CN_COLOR[x.num])}" title="${esc(x.la)}">${esc(x.num)}</button>`).join('')}</div>
      ${data.nerves.levelsTip_tr ? `<p class="htext small">${esc(data.nerves.levelsTip_tr)}</p>` : ''}
      ${mn[0] ? `<div class="mnemonic" lang="de">„${esc(mn[0].text)}“</div>` : ''}
      ${mn.length > 1 ? `<details class="clinic"><summary>Kodlamalar (${mn.length})</summary>${mn.map(m => `<p><b>${esc(m.for)}</b>: <span lang="${m.lang === 'en' ? 'en' : 'de'}">„${esc(m.text)}“</span>${m.key ? `<br><small>${esc(m.key)}</small>` : ''}${m.tr ? `<br>${esc(m.tr)}` : ''}</p>`).join('')}</details>` : ''}
      ${notIn(data.nerves.notInModel)}`;
  }
  function artHTML() {
    const A = data.arteries, T = A.territories;
    if (b.artView !== 'basal') {
      const sw = (c, t) => `<span class="sw" style="background:${hex(c)}"></span>${t}`;
      const cmap = T.cerebellum || {};
      return `
        ${seg(ART_VIEWS, b.artView, 'data-bv')}
        ${waiting('terr')}
        <div class="legend">${sw(TERR[0], 'ACA')} ${sw(TERR[1], 'MCA')} ${sw(TERR[2], 'PCA')}</div>
        <p class="htext">${esc(b.artView === 'medial' ? T.views?.medial_tr : T.views?.lateral_tr || T.scheme_tr)}</p>
        ${T.watershed_tr ? `<p class="htext small">${esc(T.watershed_tr)}</p>` : ''}
        ${T.tip ? `<div class="tip">${esc(T.tip)}</div>` : ''}
        ${Object.keys(cmap).length ? `<div class="legend">Beyincik: ${sw(ART_COLOR.sca, 'SCA')} ${sw(ART_COLOR.aica, 'AICA')} ${sw(ART_COLOR.pica, 'PICA')}</div>${T.cerebellum_tr ? `<p class="htext small">${esc(T.cerebellum_tr)}</p>` : ''}` : ''}
        <p class="htext dim small">Renkler ders kitabı tablosuna göre girus girus verildi; iki alan arasında kalan girusta sınır, komşu tek alanlı girustan yayılarak çizildi. Gerçek sınırlar kişiden kişiye değişir.</p>`;
    }
    const list = A.list;
    return `
      ${seg(ART_VIEWS, b.artView, 'data-bv')}
      ${waiting('art')}
      ${A.intro_tr ? `<p class="htext small">${esc(A.intro_tr)}</p>` : ''}
      <div class="corlist">${list.map((a, i) => `<div class="cor${i === b.art ? ' on' : ''}" data-art="${i}"><span class="sw" style="background:${hex(ART_COLOR[a.key] || ART_COLOR.ica)}"></span><div><b lang="la">${esc(a.la)}</b>${a.abbr ? ` <small>${esc(a.abbr)}</small>` : ''}<br><small lang="de">${esc(a.de)}</small>${i === b.art ? `
        ${a.origin_tr ? `<p>${esc(a.origin_tr)}</p>` : ''}
        ${Array.isArray(a.segments) && a.segments.length ? `<p class="segs">${a.segments.map(s => `<b>${esc(s.k)}</b> <span lang="la">${esc(s.la || '')}</span>${s.tr ? `: ${esc(s.tr)}` : ''}`).join('<br>')}</p>` : ''}
        ${a.segments_note ? `<p class="segs dim">${esc(a.segments_note)}</p>` : ''}
        ${a.supply_tr ? `<p><b>Beslediği alan:</b> ${esc(a.supply_tr)}</p>` : ''}${a.infarct_tr ? `<p class="inf"><b>Tıkanırsa:</b> ${esc(a.infarct_tr)}</p>` : ''}${a.tip ? `<div class="tip">${esc(a.tip)}</div>` : ''}` : ''}</div></div>`).join('')}</div>
      ${A.willis ? `<div class="field"><div class="k">Circulus arteriosus cerebri (Willisi)</div><div class="v">${esc(A.willis.tr)}${A.willis.facts_de?.length ? `<ul class="facts" lang="de">${A.willis.facts_de.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${A.willis.tip ? `<div class="tip">${esc(A.willis.tip)}</div>` : ''}</div></div>` : ''}
      ${notIn(A.notInModel)}
      <p class="htext dim small">Modelde A. communicans anterior iki ACA'ya ulaşmıyor (yaklaşık 0,6 cm boşluk); A1/A2 birleşiminin yaklaşık 1,2 cm gerisinde, kiazmanın ön yüzüne dayalı duruyor. Burada gizlendi ve A1/A2 birleşiminde açık yeşil şematik tüple çizildi. A. communicans posterior'lar ICA'ya 1,4 mm ulaşmıyor; bu aralık PCoA renginde kısa bir tüple kapatıldı.</p>`;
  }
  function panelHTML() {
    if (!data || !set) return '<p class="htext">Beyin çalışma modu yükleniyor…</p>';
    const body = b.tab === 'csf' ? csfHTML() : b.tab === 'nerves' ? cnHTML() : b.tab === 'arteries' ? artHTML() : test.html();
    return `
      <div class="chips"><span class="chip brain">Beyin çalışma modu</span></div>
      <div class="seg small htabs">${TABS.map(([k, t]) => `<button data-bt="${k}" class="${b.tab === k ? 'active' : ''}">${t}</button>`).join('')}</div>
      ${body}
      ${b.tab !== 'quiz' ? pickedHTML() : ''}
      <div class="btns"><button data-ba="exit" title="Beyin modundan çık (Esc)">Beyin modundan çık</button></div>`;
  }
  function click(e) {
    if (b.tab === 'quiz' && test.click(e)) return;
    const t = e.target.closest('[data-bt],[data-ba],[data-step],[data-bv],[data-cn],[data-art]'); if (!t) return;
    if (t.dataset.bt) { const tab = t.dataset.bt; if (tab !== b.tab) { b.tab = tab; b.pickedId = null; b.playing = false; applyTab(); refresh(); frame(); } return; }
    if (t.dataset.step) { const prev = csfZone(); b.step = +t.dataset.step; b.playing = false; b.pickedId = null; applyTab(); refresh(); if (csfZone() !== prev) frame(); return; }
    if (t.dataset.bv) { const v = t.dataset.bv; if (b.tab === 'nerves') b.cnView = v; else b.artView = v; b.pickedId = null; applyTab(); refresh(); frame(); return; }
    if (t.dataset.cn) { b.cn = +t.dataset.cn; b.pickedId = null; applyTab(); refresh(); return; }
    if (t.dataset.art) { const i = +t.dataset.art; if (i !== b.art) { b.art = i; b.pickedId = null; applyTab(); refresh(); } return; }
    const a = t.dataset.ba;
    if (a === 'prev' || a === 'next') { b.playing = false; go(a === 'next' ? 1 : -1); }
    else if (a === 'play') { b.playing = !b.playing; playT = performance.now(); if (b.playing && csfStep().view === 'lumbar') go(1, true); else refresh(); }
    else if (a === 'exit') { state.isolate = null; refresh(); }
  }

  return {
    enter, sync, highlight, onPick, panelHTML, click,
    isActive: () => active, hideTips: () => active && b.tab === 'quiz',
    cancelPending: () => { if (!active) enterSeq++; },   // brain.json yüklenirken başka bir eylem bekleyen girişi iptal eder
    // adres çubuğundaki bağlantı için enter() ile aynı biçim: 'bölüm[:görünüm[:sinir]]'
    spec: () => b.tab + (b.tab === 'nerves' ? ':' + b.cnView + (data?.nerves.list[b.cn] ? ':' + data.nerves.list[b.cn].num : '') : b.tab === 'arteries' ? ':' + b.artView : ''),
  };
}
