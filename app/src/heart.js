// Kalp çalışma modu: sınav için görsel tekrar (HKL bloğu, ÄBP 7. öğrenme günü). Sağ panelde dört bölüm:
//  - Kanın yolu: venöz kan mavi, arteriyel kan kırmızı. Odacıklar yarı saydam renkli, büyük damarlar kanın rengiyle;
//    odacıkların içinden geçen akış çizgisinde kan damlaları ilerler. On iki adım (Vv. cavae → … → Aorta): her adımda
//    yapı parlar, kısa bilgi ve akılda kalıcı bir ipucu gelir.
//  - Kapaklar: dört kapak ayrı renkte, göğüs iskeleti saydam. Oskültasyon noktaları göğüs duvarında, her kapağın gerçek
//    yerinden kendi noktasına çizgi ("Anton Pulmann trinkt Milch um 22:45").
//  - Koroner arterler: dallar ayrı renklerde, beslenme alanları ve enfarktüs yerleri.
//  - İleti: uyarı oluşturma ve iletme sistemi (heart-conduction.js): şematik düğümler ve demetler, EKG ile eş zamanlı
//    ilerleyen uyarı, kalbin sinirleri.
//  - Test: parlayan yapının adı (dört şık) ya da adı verilen yapıyı 3B görünümde bulma; ileti sisteminin bilgi soruları
//    (data/conduction.json gelince "Bilgi" türü açılır; dosya yüklenemezse yalnız yapı soruları kalır).
// Mod izole görünümle yaşar: izolasyondan çıkılınca (Esc, "Çık") renkler, çizgiler ve etiketler kaldırılır (sync).
import * as THREE from 'three';
import { titleName, subtitleName, esc } from './text.js';
import { createConduction } from './heart-conduction.js';
import { tint, solid, nameIndex, centerOf, anchorOf, isExploded, createLabels, flowLines, animateFlow, createStudyQuiz } from './study.js';

const VEN = 0x3f7fe0, ART = 0xe0473f;
const LEAF = {
  tri: ['Inferior leaflet of right atrioventricular valve', 'Septal leaflet of right atrioventricular valve'],
  pul: ['Anterior semilunar leaflet of pulmonary valve', 'Left semilunar leaflet of pulmonary valve', 'Right semilunar leaflet of pulmonary valve'],
  aor: ['Left coronary leaflet', 'Non-coronary leaflet', 'Right coronary leaflet'],
  mit: ['Posterior leaflet of left atrioventricular valve'],
};
const PAP_R = ['Anterior papillary muscle of right ventricle', 'Inferior papillary muscle of right ventricle', 'Septal papillary muscle of right ventricle'];
const PAP_L = ['Inferior papillary muscle of left ventricle'];
const PULM_V = ['Left superior pulmonary vein', 'Right superior pulmonary vein', 'Left inferior pulmonary vein', 'Right inferior pulmonary vein'];
const AORTA = ['Ascending aorta', 'Aortic arch', 'Thoracic aorta'];
const CAVA = ['Superior vena cava', 'Inferior vena cava (thoracic part)'];
const TRUNK = ['Pulmonary trunk', 'Bifurcation of pulmonary trunk'];
const CORONARY_A = ['Left coronary artery', 'Anterior interventricular artery', 'Septal branches of anterior interventricular artery', 'Circumflex artery of heart', 'Right coronary artery', 'Right inferolateral branch of right coronary artery'];

// Kanın yolu: on iki adım. lab: etiket (adım numarasıyla), blood: v venöz / a arteriyel
const FLOW = [
  { n: CAVA, lab: 'Vv. cavae sup. / inf.', la: 'Venae cavae superior et inferior', de: 'Obere und untere Hohlvene', blood: 'v',
    tr: 'Vücudun oksijeni azalmış kanı iki ana toplardamarla sağ kulakçığa döner.' },
  { n: ['Right atrium'], lab: 'Atrium dextrum', la: 'Atrium dextrum', de: 'Rechter Vorhof', blood: 'v',
    tr: 'Sağ kulakçık venöz kanı toplar; kalbin kendi venöz kanı da koroner sinüsle buraya açılır.' },
  { n: LEAF.tri, lab: 'Valva tricuspidalis', la: 'Valva atrioventricularis dextra (tricuspidalis)', de: 'Trikuspidalklappe: Segelklappe mit 3 Segeln', blood: 'v',
    tr: 'Sağ AV kapak, üç yaprakçıklı yelken kapak; yaprakçıklar chordae tendineae ile papiller kaslara bağlıdır. Modelde ön yaprakçık yok.',
    tip: 'Try before you buy: kan önce triküspitten (tri), sonra bikuspitten (mitral) geçer.' },
  { n: ['Right ventricle', ...PAP_R], lab: 'Ventriculus dexter', la: 'Ventriculus dexter', de: 'Rechte Kammer', blood: 'v',
    tr: 'Sağ karıncık kanı küçük (akciğer) dolaşıma pompalar. Duvarı ince (3–5 mm); içinde trabeküller ve üç papiller kas.' },
  { n: LEAF.pul, lab: 'Valva trunci pulmonalis', la: 'Valva trunci pulmonalis', de: 'Pulmonalklappe: Taschenklappe mit 3 Taschen', blood: 'v',
    tr: 'Pulmoner kapak: üç cepli (semilunar) kapak, sağ karıncığın çıkış yolunun ucunda.' },
  { n: TRUNK, lab: 'Truncus pulmonalis', la: 'Truncus pulmonalis', de: 'Lungenarterienstamm', blood: 'v',
    tr: 'Kanı iki akciğer arterine ayrılarak akciğerlere götürür.',
    tip: 'Arter, kalpten uzaklaşan damardır: truncus pulmonalis bir arterdir ama içinde venöz kan taşır.' },
  { n: PULM_V, lab: 'Vv. pulmonales', la: 'Venae pulmonales', de: 'Lungenvenen', blood: 'a',
    tr: 'Akciğerlerde oksijenlenen kan dört akciğer veniyle sol kulakçığa döner.',
    tip: 'Ven, kalbe gelen damardır: Vv. pulmonales ven olduğu hâlde oksijenli kan taşır.' },
  { n: ['Left atrium'], lab: 'Atrium sinistrum', la: 'Atrium sinistrum', de: 'Linker Vorhof', blood: 'a',
    tr: 'Sol kulakçık kalbin en arkadaki boşluğudur; hemen arkasında yemek borusu vardır.',
    tip: 'Bu yüzden transözofageal eko (TEE) sol kulakçığı yakından görür; büyüyen sol kulakçık yemek borusuna bastırabilir.' },
  { n: LEAF.mit, lab: 'Valva mitralis', la: 'Valva atrioventricularis sinistra (mitralis)', de: 'Mitralklappe: Segelklappe mit 2 Segeln', blood: 'a',
    tr: 'Sol AV kapak, iki yaprakçıklı yelken kapak. Modelde yalnızca arka yaprakçık var.',
    tip: 'Mitra = piskopos külahı (Bischofsmütze): iki parçalı ve solda.' },
  { n: ['Left ventricle', ...PAP_L], lab: 'Ventriculus sinister', la: 'Ventriculus sinister', de: 'Linke Kammer', blood: 'a',
    tr: 'Sol karıncık en kalın duvarlı boşluktur (~10 mm); kanı büyük dolaşıma basar ve kalbin tepesini (apex) oluşturur.' },
  { n: LEAF.aor, lab: 'Valva aortae', la: 'Valva aortae', de: 'Aortenklappe: Taschenklappe mit 3 Taschen', blood: 'a',
    tr: 'Aort kapağı. Sağ ve sol koroner arterler, sağ ve sol koroner ceplerin hizasındaki aort sinüslerinden çıkar.' },
  { n: AORTA, lab: 'Aorta', la: 'Aorta ascendens · Arcus aortae · Aorta thoracica', de: 'Aorta', blood: 'a',
    tr: 'Oksijenli kan büyük dolaşıma çıkar. Arkus aortanın dalları: truncus brachiocephalicus, a. carotis communis sinistra, a. subclavia sinistra.' },
];

// Kapaklar ve oskültasyon noktaları ("Anton Pulmann trinkt Milch um 22:45")
const VALVES = [
  { k: 'A', n: LEAF.aor, la: 'Valva aortae', de: 'Aortenklappe', color: 0xe0473f, ics: 2, side: 'r', line: 'ps', where: '2. ICR rechts parasternal' },
  { k: 'P', n: LEAF.pul, la: 'Valva trunci pulmonalis', de: 'Pulmonalklappe', color: 0x3f7fe0, ics: 2, side: 'l', line: 'ps', where: '2. ICR links parasternal' },
  { k: 'T', n: LEAF.tri, la: 'Valva tricuspidalis', de: 'Trikuspidalklappe', color: 0x9b6bd8, ics: 4, side: 'r', line: 'ps', where: '4. ICR rechts parasternal' },
  { k: 'M', n: LEAF.mit, la: 'Valva mitralis', de: 'Mitralklappe', color: 0xf0a030, ics: 5, side: 'l', line: 'mcl', where: '5. ICR links medioklavikulär (Herzspitze)' },
];
const ERB = { k: 'E', la: 'Erb-Punkt', color: 0xf2f2f2, ics: 3, side: 'l', line: 'ps', where: '3. ICR links parasternal: alle Klappen' };

// Koroner arterler: renk, beslenme alanı, enfarktüs
const CORONARY = [
  { n: ['Left coronary artery'], la: 'A. coronaria sinistra (Hauptstamm)', de: 'Linke Koronararterie', color: 0xf2d13a,
    area: 'Kısa ana gövde; RIVA (LAD) ve RCX olarak ikiye ayrılır. Ana gövde tıkanması büyük bir sol karıncık alanını etkiler.' },
  { n: ['Anterior interventricular artery', 'Septal branches of anterior interventricular artery'], la: 'R. interventricularis anterior (RIVA, LAD)', de: 'Vordere Zwischenkammerarterie', color: 0xd94bd0,
    area: 'Sol karıncığın ön duvarı, septumun ön 2/3’ü ve apeks → ön duvar enfarktüsü.' },
  { n: ['Circumflex artery of heart'], la: 'R. circumflexus (RCX)', de: 'Ramus circumflexus', color: 0x3fc46a,
    area: 'Sol karıncığın yan ve arka duvarı, sol kulakçık → yan duvar enfarktüsü.' },
  { n: ['Right coronary artery', 'Right inferolateral branch of right coronary artery'], la: 'A. coronaria dextra (RCA)', de: 'Rechte Koronararterie', color: 0xf07a2a,
    area: 'Sağ kulakçık ve sağ karıncık; çoğu insanda arka interventriküler dalı (RIVP) da verir: arka duvar ve septumun arka 1/3’ü. Sinüs düğümünü çoğunlukla (~%60), AV düğümünü sıklıkla (~%80–90) besler → arka (inferior) duvar enfarktüsü, bradikardi, AV blok.' },
  { group: 'Cardiac veins', la: 'Vv. cordis · Sinus coronarius', de: 'Herzvenen', color: 0x5b8fd6,
    area: 'Kalbin venöz kanının çoğu V. cordis magna, media ve parva ile sinus coronarius’ta toplanıp sağ kulakçığa açılır. Vv. cordis anteriores doğrudan sağ kulakçığa, Vv. cordis minimae doğrudan kalp boşluklarına açılır (modelde magna ve media var).' },
];

// Test havuzu: kat (kategori) aynı olan şıklar birbirine çeldirici olur
const QUIZ = [
  { n: ['Right atrium'], cat: 'ch' }, { n: ['Left atrium'], cat: 'ch' }, { n: ['Right ventricle'], cat: 'ch' }, { n: ['Left ventricle'], cat: 'ch' },
  { n: LEAF.aor, la: 'Valva aortae', de: 'Aortenklappe', cat: 'va' }, { n: LEAF.pul, la: 'Valva trunci pulmonalis', de: 'Pulmonalklappe', cat: 'va' },
  { n: LEAF.tri, la: 'Valva tricuspidalis', de: 'Trikuspidalklappe', cat: 'va' }, { n: LEAF.mit, la: 'Valva mitralis', de: 'Mitralklappe', cat: 'va' },
  ...PAP_R.map(x => ({ n: [x], cat: 'pa' })), ...PAP_L.map(x => ({ n: [x], cat: 'pa' })),
  { n: ['Left coronary artery'], cat: 'co' }, { n: ['Anterior interventricular artery'], cat: 'co' }, { n: ['Circumflex artery of heart'], cat: 'co' }, { n: ['Right coronary artery'], cat: 'co' },
  { n: ['Coronary sinus'], cat: 've' }, { n: ['Great cardiac vein'], cat: 've' }, { n: ['Middle cardiac vein'], cat: 've' },
  { n: ['Ascending aorta'], cat: 'gv' }, { n: ['Aortic arch'], cat: 'gv' }, { n: TRUNK, la: 'Truncus pulmonalis', de: 'Lungenarterienstamm', cat: 'gv' }, { n: ['Superior vena cava'], cat: 'gv' },
  { n: ['Inferior vena cava (thoracic part)'], cat: 'gv' }, ...PULM_V.map(x => ({ n: [x], cat: 'gv' })),
];

const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const TABS = [['flow', 'Kanın yolu'], ['valves', 'Kapaklar'], ['coronary', 'Koronerler'], ['conduction', 'İleti'], ['quiz', 'Test']];

export function createHeart({ stage, model, state, refresh, defer, ui, glow, viewLayers, endStudy }) {
  let built = false, active = false;
  const h = { tab: 'flow', step: 0, playing: false, picked: null };
  const { recs, groupRecs } = nameIndex(model, state);
  const center = centerOf;
  // etiket yeri: yapıların ortasına en yakın yüzey köşesi (kıvrık damarda orta nokta boşlukta kalır, etiket damarın üstünde dursun)
  const anchor = rs => anchorOf(rs);
  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const labels = createLabels(stage);
  // İleti sekmesi (heart-conduction.js): yardımcıları bu modun grubunda (root), etiketleri ortak katmanda
  const cond = createConduction({
    stage, model, state, recs, groupRecs, root, labels, ui, defer, viewLayers, refresh,
    sets: () => ({ flowIds: set.flow, papR: set.papR, papL: set.papL, leaflets: [...LEAF.tri, ...LEAF.pul, ...LEAF.aor, ...LEAF.mit] }),
    isOn: () => active && h.tab === 'conduction',
    reapply: () => { applyTab(); refresh(); },
  });
  let flowObj = null, markObj = null;
  let mats = null;                       // sekmelere göre hazırlanan malzemeler
  let set = null;                        // yapı kümeleri (kimlikler)

  // --- yapı kümeleri ve geometri (ilk girişte bir kez) ---
  function build() {
    if (built) return;
    const ids = rs => new Set(rs.map(r => r.id));
    const heart = groupRecs('Heart'), coronary = recs(CORONARY_A), veins = groupRecs('Cardiac veins');
    const great = recs([...CAVA, ...TRUNK, ...PULM_V, ...AORTA]);
    const thorax = [...groupRecs('Sternum'), ...groupRecs('Ribs'), ...groupRecs('Costal cartilages'), ...recs(['Clavicle'])];
    set = {
      heart, core: [...heart, ...coronary],
      flow: ids([...heart, ...great]), valves: ids([...heart, ...great]), coronary: ids([...heart, ...coronary, ...veins, ...great]),
      quiz: ids([...heart, ...coronary, ...veins, ...great]), thorax: ids(thorax),
      // saydam çizilen yalnızca odacık duvarları; papiller kaslar opak kalır ki içlerinden tıklanabilsin
      chambersR: recs(['Right atrium', 'Right ventricle']), chambersL: recs(['Left atrium', 'Left ventricle']), papR: recs(PAP_R), papL: recs(PAP_L),
    };
    const pale = new THREE.MeshStandardMaterial({ color: 0xd8c3bc, roughness: 0.7, metalness: 0 });
    mats = {
      ghostR: tint(VEN, 0.05, 0.5), ghostL: tint(ART, 0.05, 0.5), ghostRon: tint(VEN, 0.22, 0.7), ghostLon: tint(ART, 0.22, 0.7),
      ghostN: tint(0xb9aaa6, 0.04, 0.42), ven: solid(VEN, 0.12), art: solid(ART, 0.12), leaflet: solid(0xf4efe6, 0.1), pale,
      papR: solid(0x8fb2ea, 0.1), papL: solid(0xea9a92, 0.1),
      valve: Object.fromEntries(VALVES.map(v => [v.k, solid(v.color, 0.3)])),
      cor: CORONARY.map(c => solid(c.color, 0.35)),
    };
    built = true;
  }

  // --- kanın yolu: akış çizgileri ve ilerleyen damlalar ---
  function buildFlow() {
    if (flowObj) return flowObj;
    const c = names => center(recs(names));
    // toplardamarların kalbe giren uçları: kulakçığa en yakın köşeler
    const endNear = (r, target) => {
      const P = r.geo.attributes.position.array; let best = null, bd = Infinity;
      for (let i = 0; i < P.length; i += 3) { const d = (P[i] - target.x) ** 2 + (P[i + 1] - target.y) ** 2 + (P[i + 2] - target.z) ** 2; if (d < bd) { bd = d; best = i; } }
      return new THREE.Vector3(P[best], P[best + 1], P[best + 2]);
    };
    const ra = c(['Right atrium']), la = c(['Left atrium']);
    const svc = recs(['Superior vena cava'])[0], ivc = recs(['Inferior vena cava (thoracic part)'])[0];
    const right = [
      svc ? center([svc]) : ra.clone().add(new THREE.Vector3(0, 6, 0)), ra, c(LEAF.tri), c(['Right ventricle']), c(LEAF.pul), c(['Pulmonary trunk']), c(['Bifurcation of pulmonary trunk']),
    ];
    const curves = [{ pts: right, color: VEN }];
    if (ivc) curves.push({ pts: [center([ivc]), endNear(ivc, ra), ra], color: VEN });
    for (const pv of recs(PULM_V)) { const e = endNear(pv, la); curves.push({ pts: [center([pv]), e, la], color: ART }); }
    curves.push({ pts: [la, c(LEAF.mit), c(['Left ventricle']), c(LEAF.aor), c(['Ascending aorta']), c(['Aortic arch']), c(['Thoracic aorta'])], color: ART });
    flowObj = flowLines(curves);
    root.add(flowObj.group);
    return flowObj;
  }
  // --- kapaklar: oskültasyon noktaları ---
  // ICR k: k. ve (k+1). kaburganın (ön uçta kaburga kıkırdağının) arası. Parasternal çizgi: sternum kenarının 1,2 cm
  // yanı; medioklavikular çizgi: köprücük kemiğinin ortası. Nokta göğüs duvarının 1 cm önüne konur (deri modelde yok).
  function icsPoint(k, side, line) {
    const sg = side === 'r' ? -1 : 1;                     // anatomik sağ = -x
    const sideRecs = names => recs(names).filter(r => r.sd === side);
    const ribSet = n => sideRecs([`${ORD[n]} rib`, `Costal cartilage of ${ORD[n].toLowerCase()} rib`]);
    const sternum = groupRecs('Sternum');
    const zFront = Math.max(...sternum.map(r => r.box.max.z));
    const verts = (rs, fn) => { for (const r of rs) { const P = r.geo.attributes.position.array; for (let i = 0; i < P.length; i += 3) fn(P[i], P[i + 1], P[i + 2]); } };
    // kıkırdağın sternuma yakın ucu: yüksekliğin ilk tahmini
    const medialY = n => { let bx = Infinity, y = 0; verts(sideRecs([`Costal cartilage of ${ORD[n].toLowerCase()} rib`]), (x, yy, z) => { if (Math.abs(x) < bx && z > zFront - 6) { bx = Math.abs(x); y = yy; } }); return y; };
    const yEst = (medialY(k) + medialY(k + 1)) / 2;
    let x;
    if (line === 'mcl') { const cl = sideRecs(['Clavicle'])[0]; x = cl ? cl.sphere.center.x : sg * 9; }
    else { let w = 0; verts(sternum, (xx, y) => { if (Math.abs(y - yEst) < 1.5) w = Math.max(w, Math.abs(xx)); }); x = sg * (w + 1.2); }
    const edge = (rs, lower) => {
      for (const tol of [0.6, 1.2, 2.5]) {
        let y = lower ? Infinity : -Infinity, z = -Infinity, n = 0;
        verts(rs, (xx, yy, zz) => { if (Math.abs(xx - x) < tol && zz > zFront - 9) { n++; if (lower ? yy < y : yy > y) y = yy; if (zz > z) z = zz; } });
        if (n) return { y, z };
      }
      return null;
    };
    const a = edge(ribSet(k), true), b = edge(ribSet(k + 1), false);
    if (!a || !b) return null;
    return new THREE.Vector3(x, (a.y + b.y) / 2, Math.max(a.z, b.z) + 1.0);
  }
  function buildMarks() {
    if (markObj) return markObj;
    const g = new THREE.Group(); const pts = [];
    const ball = new THREE.SphereGeometry(0.75, 20, 14);
    for (const vv of [...VALVES, ERB]) {
      const p = icsPoint(vv.ics, vv.side, vv.line); if (!p) continue;
      const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: vv.color, depthTest: false, transparent: true, opacity: 0.95 }));
      m.position.copy(p); m.renderOrder = 5; g.add(m);
      if (vv.n) {
        const from = center(recs(vv.n));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, p]), new THREE.LineDashedMaterial({ color: vv.color, dashSize: 0.6, gapSize: 0.4, depthTest: false, transparent: true }));
        line.computeLineDistances(); line.renderOrder = 5; g.add(line);
      }
      pts.push({ vv, p });
    }
    root.add(g);
    markObj = { group: g, pts };
    return markObj;
  }

  // --- sekmeler ---
  function applyTab() {
    const ov = model.overrides; ov.clear();
    const put = (rs, m) => { for (const r of rs) ov.set(r.id, m); };
    if (flowObj) flowObj.group.visible = h.tab === 'flow';
    if (h.tab !== 'conduction') cond.detach();
    if (markObj) markObj.group.visible = h.tab === 'valves';
    state.isoGhost = null;
    if (h.tab === 'flow') {
      const on = new Set(FLOW[h.step].n);
      for (const r of set.chambersR) ov.set(r.id, on.has(r.n) ? mats.ghostRon : mats.ghostR);
      for (const r of set.chambersL) ov.set(r.id, on.has(r.n) ? mats.ghostLon : mats.ghostL);
      put(set.papR, mats.papR); put(set.papL, mats.papL);
      put(recs([...LEAF.tri, ...LEAF.pul, ...LEAF.aor, ...LEAF.mit]), mats.leaflet);
      put(recs([...CAVA, ...TRUNK]), mats.ven); put(recs([...PULM_V, ...AORTA]), mats.art);
      state.isolate = new Set(set.flow);
      buildFlow(); flowObj.group.visible = true;
      // o anki adım adıyla, ötekiler yalnız numarayla (kalabalık olmasın)
      labels.set(FLOW.map((s, i) => ({ text: i === h.step ? `<b>${i + 1}</b> ${esc(s.lab)}` : `<b>${i + 1}</b>`, p: center(recs(s.n.slice(0, i === 0 ? 1 : s.n.length))), cls: i === h.step ? 'on' : 'num' })).map((l, i) => ({ ...l, p: i === 0 ? l.p : anchor(recs(FLOW[i].n)) })));
    } else if (h.tab === 'valves') {
      put([...set.chambersR, ...set.chambersL], mats.ghostN);
      put(recs([...CAVA, ...TRUNK, ...PULM_V, ...AORTA]), mats.ghostN);
      for (const vv of VALVES) put(recs(vv.n), mats.valve[vv.k]);
      state.isolate = new Set(set.valves); state.isoGhost = set.thorax;
      const mk = buildMarks(); mk.group.visible = true;
      labels.set(mk.pts.map(({ vv, p }) => ({ text: `<b>${vv.k}</b> ${esc(vv.where.split(':')[0])}`, p, cls: 'valve' })));
    } else if (h.tab === 'coronary') {
      // sol ana gövde truncus pulmonalis ile sol kulakçığın arasında: ikisi ve büyük damarlar saydam, karıncıklar opak
      put([...set.chambersR, ...set.chambersL], mats.pale);
      put(recs(['Left atrium', ...CAVA, ...TRUNK, ...PULM_V, ...AORTA]), mats.ghostN);
      CORONARY.forEach((c, i) => put(c.group ? groupRecs(c.group) : recs(c.n), mats.cor[i]));
      state.isolate = new Set(set.coronary);
      labels.set(CORONARY.map(c => { const rs = c.group ? recs(['Coronary sinus']) : recs([c.n[0]]); return { text: esc(c.la.split(' (')[0]), p: anchor(rs), cls: 'cor' }; }));
    } else if (h.tab === 'conduction') {
      cond.apply();   // odacıklar dalga malzemesiyle, ileti sistemi yardımcı nesnelerle, etiketler (heart-conduction.js)
    } else {
      put([...set.chambersR, ...set.chambersL], mats.ghostN);
      state.isolate = new Set(set.quiz);
      labels.set([]);
      test.ensure();
      // ileti sisteminin bilgi soruları: dosya gelince panel yenilenir (gelmezse yapı soruları yeter)
      cond.load().then(() => { if (active && h.tab === 'quiz') refresh(); }, () => {});
    }
  }
  // Kalbi belli bir yönden, panellerin örtmediği alana sığdır (kapaklar sekmesinde göğüs noktaları da girsin)
  function frame(dirFront) {
    const b = new THREE.Box3(); for (const r of set.core) b.union(r.box);
    if (dirFront && markObj) for (const { p } of markObj.pts) b.expandByPoint(p);
    stage.frameBox(b, dirFront ? new THREE.Vector3(0, 0.05, 1) : new THREE.Vector3(-0.45, 0.25, 1));
  }

  // --- test (study.js) ---
  // facts: ileti sisteminin soruları (cond.facts, veri gelince dolar); visible: yalnız sahnede çizilen yapılar sorulur ve
  // odaklanılır (bilgi sorusunun gösterdiği sinir modda çizilmiyorsa ona gidilmez)
  const test = createStudyQuiz({ recs, items: QUIZ, facts: cond.facts, refresh, stage, model, visible: r => !state.isolate || state.isolate.has(r.id) });

  function enter(tab = 'flow') {
    if (!model.loaded.vessel) { defer('vessel', () => enter(tab)); return; }
    build();
    endStudy?.('heart');   // başka bir çalışma modu açıksa renklerini ve etiketlerini şimdi kaldırsın
    active = true; h.tab = TABS.some(([k]) => k === tab) ? tab : 'flow'; h.picked = null; root.visible = true; wasExploded = null;   // parçalarına ayırma durumu ilk karede yeniden okunur
    state.selected = new Set(); state.primary = { type: 'heart' };
    viewLayers({ vessel: 'show' });   // kalp damar sisteminde; göğüs iskeleti bağlam olarak her durumda saydam (isoGhost)
    applyTab();
    refresh();
    frame(h.tab === 'valves');
  }
  function cleanup() {
    active = false; h.playing = false; test.clear(); cond.leave();   // ileti sistemi: yardımcılar kaldırılır, süren indirme iptal
    model.overrides.clear(); if (state.isoGhost === set?.thorax) state.isoGhost = null;   // başka görünümün bağlamına dokunma
    root.visible = false; labels.set([]);
  }
  // Ana yenilemeden önce: mod bittiyse (izolasyondan çıkıldı ya da kart başka bir şeye geçti) temizle
  function sync() { if (active && state.primary?.type !== 'heart') cleanup(); }
  // Parıltı: adımın yapıları, tıklanan yapı, testte sorulan yapı
  function highlight() {
    if (!active) return [];
    let rs = [];
    if (h.tab === 'flow') rs = recs(FLOW[h.step].n);
    if (h.tab === 'quiz') rs = test.asked();
    if (h.picked && h.tab !== 'quiz') rs = rs.concat(recs([h.picked]));
    return rs.filter(r => r.vis).map(r => r.mesh);
  }
  // 3B görünümde tıklanan yapı: modda kalınır; testin "bul" sorusunda cevap sayılır
  function onPick(id) {
    if (!active) return false;
    const r = model.items.get(id); if (!r) return true;
    if (h.tab === 'quiz') { if (test.pick(r)) refresh(); return true; }
    h.picked = r.n;
    refresh();
    return true;
  }
  let playT = 0;
  let wasExploded = false;
  stage.onFrame(now => {
    if (!active) return false;
    const exploded = isExploded(set.heart);
    if (exploded !== wasExploded) { wasExploded = exploded; root.visible = !exploded; labels.hide(exploded); }
    if (exploded) return false;
    labels.place();
    if (h.playing && now - playT > 2600) { playT = now; h.step = (h.step + 1) % FLOW.length; applyTab(); refresh(); }
    if (h.tab === 'flow' && flowObj) { animateFlow(flowObj, now, 4.5); return true; }
    if (h.tab === 'conduction') return cond.tick(now);
    return false;
  });

  // --- panel ---
  const tabsHTML = () => `<div class="seg small htabs hk">${TABS.map(([k, t]) => `<button data-ht="${k}" class="${h.tab === k ? 'active' : ''}">${t}</button>`).join('')}</div>`;
  const pickedHTML = () => {
    if (!h.picked) return '';
    const r = recs([h.picked])[0]; if (!r) return '';
    return `<div class="field"><div class="k">Tıklanan yapı</div><div class="v"><b lang="la">${esc(titleName(r))}</b>${subtitleName(r) ? ` · <span lang="de">${esc(subtitleName(r))}</span>` : ''}${r.tr ? `<br><small>${esc(r.tr)}</small>` : ''}</div></div>`;
  };
  function panelHTML() {
    let body = '';
    if (h.tab === 'flow') {
      const s = FLOW[h.step];
      body = `
        <div class="stepnav"><button data-ha="prev" title="Önceki adım">◀</button><span>Adım ${h.step + 1} / ${FLOW.length}</span><button data-ha="next" title="Sonraki adım">▶</button>
          <button data-ha="play" class="${h.playing ? 'active' : ''}">${h.playing ? '❚❚ Durdur' : '▶ Oynat'}</button></div>
        <h1 class="name" lang="la">${esc(s.la)}</h1>
        <div class="name-de" lang="de">${esc(s.de)}</div>
        <p class="htext">${esc(s.tr)}</p>
        ${s.tip ? `<div class="tip">${esc(s.tip)}</div>` : ''}
        <ol class="flowlist">${FLOW.map((f, i) => `<li class="${i === h.step ? 'on' : ''} ${f.blood}" data-step="${i}">${esc(f.lab)}</li>`).join('')}</ol>
        <div class="legend"><span class="sw v"></span>venöz kan <span class="sw a"></span>arteriyel kan</div>`;
    } else if (h.tab === 'valves') {
      body = `
        <div class="mnemonic" lang="de">„<b>A</b>nton <b>P</b>ulmann <b>t</b>rinkt <b>M</b>ilch um <b>22:45</b>“</div>
        <table class="ausk">${[...VALVES, ERB].map(vv => `<tr><td><span class="sw" style="background:#${vv.color.toString(16).padStart(6, '0')}"></span><b>${vv.k}</b></td><td lang="de">${esc(vv.de || vv.la)}</td><td lang="de">${esc(vv.where)}</td></tr>`).join('')}</table>
        <p class="htext">Kesik çizgiler kapağın gerçek yerinden dinleme noktasına gider. Kapak sesi kanın akış yönünde iletilir; bu yüzden en iyi duyulduğu yer kapağın tam üstü değildir.</p>
        <p class="htext">Yelken kapaklar (Segelklappen): triküspit 3, mitral 2 yaprakçık. Cep kapaklar (Taschenklappen): pulmoner ve aort, üçer cep. Dört kapak aynı düzlemde durur (Ventilebene).</p>`;
    } else if (h.tab === 'coronary') {
      body = `<div class="corlist">${CORONARY.map(c => `<div class="cor"><span class="sw" style="background:#${c.color.toString(16).padStart(6, '0')}"></span><div><b lang="la">${esc(c.la)}</b><br><small lang="de">${esc(c.de)}</small><p>${esc(c.area)}</p></div></div>`).join('')}</div>`;
    } else if (h.tab === 'conduction') body = cond.html();
    else body = test.html();
    return `
      <div class="chips"><span class="chip heart">♥ Kalp çalışma modu</span></div>
      ${tabsHTML()}
      ${body}
      ${h.tab !== 'quiz' ? pickedHTML() : ''}
      <div class="btns"><button data-ha="exit" title="Kalp modundan çık (Esc)">Kalp modundan çık</button></div>`;
  }
  function click(e) {
    if (test.click(e)) return;
    if (h.tab === 'conduction' && cond.click(e)) return;
    const t = e.target.closest('[data-ht],[data-ha],[data-step]'); if (!t) return;
    if (t.dataset.ht) { const tab = t.dataset.ht; if (tab !== h.tab) { h.tab = tab; h.picked = null; h.playing = false; applyTab(); refresh(); frame(tab === 'valves'); } return; }
    if (t.dataset.step) { h.step = +t.dataset.step; h.playing = false; applyTab(); refresh(); return; }
    const a = t.dataset.ha;
    if (a === 'prev' || a === 'next') { h.step = (h.step + (a === 'next' ? 1 : FLOW.length - 1)) % FLOW.length; h.playing = false; applyTab(); refresh(); }
    else if (a === 'play') { h.playing = !h.playing; playT = performance.now(); refresh(); }
    else if (a === 'exit') { state.isolate = null; refresh(); }
  }

  // spec: adres çubuğundaki bağlantı için açık bölüm (main.js, #m=heart:<bölüm>)
  return { conduction: cond, enter, sync, highlight, onPick, panelHTML, click, isActive: () => active, hideTips: () => active && h.tab === 'quiz', spec: () => h.tab };
}
