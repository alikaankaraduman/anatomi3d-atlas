// Hareket sistemi çalışma modu: sınav için görsel tekrar (BWA bloğu: ÄBP'nin kol ve bacak günleri, preparasyon kursu,
// 7. dönemin eklem dersleri). Sol kol ya da sol bacak gösterilir. Sağ panelde beş bölüm:
//  - Sinir: bir periferik sinir seçilir; siniri sarı, innerve ettiği kaslar canlı renkte, bölgenin öteki kasları saydam.
//    Lezyon yeri seçilince (ör. Sulcus n. radialis) o yerden sonra dalını alan kaslar gri (felçli) olur; klinik tablo
//    (Fallhand, Krallenhand, Steppergang …), nedenleri ve muayene bulguları yanda. Lezyon yerleri sinirin üstünde işaretli.
//  - Geçit: topografik geçitler (Achsellücken, Karpaltunnel, Leistenkanal, Lacunae, Foramen supra-/infrapiriforme …):
//    sınırlar ayrı renklerde saydam, içinden geçenler türüne göre renkli (sinir sarı, arter kırmızı, ven mavi, tendon ten rengi).
//  - Kas: kas kartları (Ursprung, Ansatz, Innervation, Funktion; data/muscles.json). Seçili kas opak, grubundaki öteki
//    kaslar saydam; origo (kırmızı) ve insersiyo (mavi) yamaları ve siniri görünür. "Kendini sına" satırları gizler.
//  - Eklem: büyük eklemler: kemikler saydam, bağlar ayrı renklerde; hareket seçilince o hareketin ana kasları eklenir.
//  - Test: yapının adı, yapıyı 3B görünümde bulma (yalnız dışarıdan görünen kaslar), bilgi soruları (ajanların yazdıkları
//    ve kas kartlarından üretilen innervasyon soruları).
// Metinler data/locomotor.json'da (ilk girişte yüklenir); lezyon yeri ve geçit noktaları o dosyanın geo bölümünde hazır
// gelir (tools/locomotor-geo ile modelin geometrisinden üretilir). Mod izole görünümle yaşar: izolasyondan çıkılınca
// renkler, işaretler ve etiketler kaldırılır (sync).
import * as THREE from 'three';
import { titleName, subtitleName, esc } from './text.js';
import { tint, solid, hex, nameIndex, anchorOf, isExploded, createLabels, createStudyQuiz, shuffle } from './study.js';
import { T, langAttr } from './testlang.js';
import { cardHTML } from './muscles.js';

const TABS = [['nerves', 'Sinir'], ['passages', 'Geçit'], ['muscles', 'Kas'], ['joints', 'Eklem'], ['quiz', 'Test']];
const REGIONS = [['arm', 'Kol'], ['leg', 'Bacak']];
const TEST_REGIONS = [...REGIONS, ['other', 'Gövde, baş']];   // test: gövde ve baş-boyun kasları ayrı sahnede
const BATCHES = [['upper', 'Kol'], ['lower', 'Bacak'], ['trunk', 'Gövde'], ['headneck', 'Baş-boyun']];
const JOINT_SHORT = { schulter: 'Schulter', ellenbogen: 'Ellenbogen', hand: 'Hand', huefte: 'Hüfte', knie: 'Knie', sprunggelenke: 'Sprunggelenk', wirbelsaeule: 'Wirbelsäule', fuss: 'Fuß', iliosakralgelenk: 'ISG' };
const PASS_REGION = { neck: 'Boyun', shoulder: 'Omuz', arm: 'Kol', hand: 'El', groin: 'Kasık', hip: 'Kalça', thigh: 'Uyluk', knee: 'Diz', foot: 'Ayak' };
// geçitlerin içinden geçenler: türüne göre renk
const KIND = { n: [0xf5d742, 'sinir'], a: [0xe0473f, 'arter'], v: [0x3f7fe0, 'ven'], t: [0xd9a066, 'tendon / kas'], l: [0x4fc46a, 'lenf'], o: [0xd8d8e0, 'diğer'] };
const BOUND_COLORS = [0x7fd6c8, 0xc8a0e8, 0xe8c07a, 0x9fc8f0, 0xf0a0b8, 0xb8e08a, 0xd0d0a0];
const LIG_COLORS = [0xf2d13a, 0x3fc46a, 0xd94bd0, 0xf07a2a, 0x5b8fd6, 0x4fc8b0, 0xe8487f, 0xb08ae0, 0x9be07a, 0xf0c030, 0x46c8e0, 0xe0705a];
const COL = { nerve: 0xf5d742, active: 0xd9705f, lost: 0x8389a8 };
const BONES = { arm: ['Bones of upper limb'], leg: ['Bones of lower limb'], other: ['Thoracic skeleton', 'Vertebral column', 'Cranium'] };
const BONE_CTX = { arm: ['Thoracic skeleton', 'Vertebral column'], leg: ['Vertebral column'] };   // saydam bağlam
const MUSCLES = { arm: ['Muscular system of upper limb'], leg: ['Muscular system of lower limb'],
  other: ['Dorsal part of muscular system', 'Thoracic part of muscular system', 'Abdominal part of muscular system', 'Pelvic part of muscular system', 'Cranial part of muscular system', 'Cervical part of muscular system'] };

const V3 = p => new THREE.Vector3(p[0], p[1], p[2]);
const noPick = mat => { mat.userData.noPick = true; return mat; };
const sw = (c, t = '') => `<span class="sw" style="background:${hex(c)}"></span>${t}`;

export function createLoco({ stage, model, state, refresh, defer, viewLayers, endStudy, musclesReady, ui }) {
  let built = false, active = false, D = null, MU = null, loading = null, enterSeq = 0;
  const m = {
    tab: 'nerves', region: 'arm', nerve: { arm: null, leg: null }, site: -1, pass: null,
    batch: 'upper', group: null, whole: null, hide: false, revealed: new Set(),
    joint: null, lig: -1, move: -1, pickedId: null, testRegion: 'arm', sex: null,
  };
  const { recs, groupRecs } = nameIndex(model, state);
  const ids = rs => new Set(rs.map(r => r.id));
  const L = r => r.sd === 'l' || (!r.sd && !(r.sphere && r.sphere.center.x < -2));                                   // sol yan ve orta hat
  const sexOk = r => !r.x || r.x === state.sex;
  const grp = names => [...new Set(names.flatMap(groupRecs))].filter(sexOk);
  const lrecs = names => recs(names || []).filter(L);
  const boxOf = rs => { const b = new THREE.Box3(); for (const r of rs) b.union(r.box); return b; };
  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const marks = new THREE.Group(); root.add(marks);
  const labels = createLabels(stage);
  let mats = null, test = null, ownGhost = null, lastSig = '';

  const load = () => loading ||= Promise.all([
    fetch('data/locomotor.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), musclesReady,
  ]).then(([j, mu]) => { if (!mu) throw new Error('muscles.json yok'); D = j; MU = mu; })
    .catch(e => { loading = null; console.warn('hareket sistemi verisi yüklenemedi:', e); ui?.notify?.('Hareket sistemi verisi yüklenemedi'); throw e; });

  // --- veri erişimi ---
  const nervesOf = region => D.nerves.list.filter(n => n.region === region);
  const curNerve = () => { const l = nervesOf(m.region); return l.find(n => n.key === m.nerve[m.region]) || l[0]; };
  const curPass = () => D.passages.list.find(p => p.key === m.pass) || D.passages.list[0];
  const curJoint = () => D.joints.list.find(j => j.key === m.joint) || D.joints.list[0];
  const groupsOf = batch => MU.groups?.[batch]?.length ? MU.groups[batch] : [...new Set([...MU.wholes.values()].filter(w => w.batch === batch).map(w => w.group_de))];
  const wholesOf = (batch, group) => [...MU.wholes.values()].filter(w => w.batch === batch && (!group || w.group_de === group));
  const curGroup = () => (groupsOf(m.batch).includes(m.group) ? m.group : groupsOf(m.batch)[0]);
  const curWhole = () => { const l = wholesOf(m.batch, curGroup()); return l.find(w => w.whole_la === m.whole) || l[0]; };
  const cardsOf = w => w.parts.map(n => MU.muscles[n]).filter(Boolean);
  // kartın siniri: model parçasıyla, yoksa adıyla (ör. N. gluteus inferior modelde yok ama sinir listesinde var)
  const nerveBase = s => (s || '').replace(/^Nervus /, 'N. ').split(' (')[0].toLowerCase();
  const nerveOfCard = c => D.nerves.list.find(n => (c.nerve_n || []).some(x => n.n.includes(x))) || D.nerves.list.find(n => c.nerve_la && nerveBase(c.nerve_la) === nerveBase(n.la));
  // bölümün verisi var mı (veri eksik derlenmişse o bölüm kapalı kalır)
  const hasTab = tab => (tab === 'nerves' ? D.nerves.list.length : tab === 'passages' ? D.passages.list.length : tab === 'joints' ? D.joints.list.length : tab === 'muscles' ? MU.wholes.size : 1) > 0;
  const regionBones = reg => grp(BONES[reg]).filter(r => r.sub !== 'attach' && L(r));
  const regionMuscles = reg => grp(MUSCLES[reg]).filter(r => r.sub === 'muscle' && L(r));

  // --- malzemeler ve test (ilk girişte bir kez) ---
  function build() {
    if (built) return;
    mats = {
      nerve: solid(COL.nerve, 0.35), nerveDim: noPick(tint(COL.nerve, 0.03, 0.3)),
      active: solid(COL.active, 0.1), lost: solid(COL.lost, 0.04),
      ghostM: tint(0xd9a79d, 0.03, 0.3), ctxM: noPick(tint(0xd9a79d, 0.02, 0.22)),
      bound: BOUND_COLORS.map(c => tint(c, 0.12, 0.62)),
      kind: Object.fromEntries(Object.entries(KIND).map(([k, [c]]) => [k, solid(c, 0.25)])),
      sheath: tint(0xd8d8e0, 0.08, 0.35), lig: LIG_COLORS.map(c => solid(c, 0.25)), extra: solid(0x9fd6e0, 0.15), boneT: tint(0xe8dcc0, 0.08, 0.5), mover: tint(COL.active, 0.16, 0.62),
      mark: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
      markOn: new THREE.MeshBasicMaterial({ color: 0xff4d3d, depthTest: false, transparent: true }),
    };
    const visible = r => !!state.isolate?.has(r.id);
    test = createStudyQuiz({ recs: lrecs, items: quizItems(), facts: tagFacts([...(D.quiz || []), ...(MU.quiz || []), ...genFacts()]), factOk: f => !f.reg || f.reg === m.testRegion,
      cats: [['nerve', 'cat.nerve'], ['passage', 'cat.passage'], ['joint', 'cat.joint'], ['muscle', 'cat.muscle']], refresh, stage, model, visible, findable });
    built = true;
  }
  // Yapı testi havuzu: kol ve bacağın kasları (bütün kas, bütün başlarıyla) ve listedeki sinirler. Aynı gruptaki kaslar
  // birbirine çeldirici olur. reg: hangi sahnede sorulur.
  function quizItems() {
    const out = [];
    for (const w of MU.wholes.values()) {
      if (cardsOf(w).every(c => c.nonMuscle)) continue;   // tendon, retinaculum gibi kas olmayan satırlar sorulmaz
      const r = recs(w.parts)[0];
      out.push({ n: w.parts, la: w.whole_la, de: w.parts.length === 1 && r ? subtitleName(r) : '', cat: w.group_de || w.batch, reg: w.batch === 'upper' ? 'arm' : w.batch === 'lower' ? 'leg' : 'other' });
    }
    for (const n of D.nerves.list) if (n.n?.length) out.push({ n: n.n, la: n.la, de: n.de, cat: 'nerve', reg: n.region });
    return out;
  }
  // Bilgi sorularının bölgesi: cevaptan sonra parlatılan yapılara (show) göre kol, bacak ya da öteki (gövde, baş-boyun);
  // show'suz sorular her bölgede sorulur
  function tagFacts(list) {
    const namesOf = reg => new Set([...regionBones(reg), ...regionMuscles(reg), ...lrecs(nervesOf(reg).flatMap(n => n.n))].map(r => r.n));
    const arm = namesOf('arm'), leg = namesOf('leg');
    for (const f of list) f.reg = !f.show?.length ? null : f.show.some(n => arm.has(n)) ? 'arm' : f.show.some(n => leg.has(n)) ? 'leg' : 'other';
    return list;
  }
  // Kas kartlarından üretilen innervasyon soruları (kol ve bacak). Şıklar sinirin dal ayrıntısı olmadan adıdır (ör.
  // "N. radialis (Ramus profundus)" -> "N. radialis"): aynı sinirin dalı ikinci doğru şık olmasın. Çift ya da belirsiz
  // innervasyonlu kaslar ve kas olmayan satırlar (tendon, retinaculum) sorulmaz, çeldirici de olmaz.
  function genFacts() {
    const out = [];
    const base = s => s.split(/ \(|;/)[0].trim();
    const mixed = s => !s || /( und |,|\/|\+|;|:|z\. ?T\.|auch|zusätzlich|keine eigene|Direkte)/.test(s);
    for (const batch of ['upper', 'lower']) {
      const ws = wholesOf(batch).filter(w => !cardsOf(w).every(c => c.nonMuscle)).map(w => ({ w, nv: uniqNerve(w) })).filter(x => !mixed(x.nv));
      const nerves = [...new Set(ws.map(x => base(x.nv)))];
      if (nerves.length < 4) continue;
      for (const { w, nv } of ws) {
        const seg = cardsOf(w).find(c => !c.nonMuscle)?.seg, b = base(nv);
        // q Türkçe kalır (ilerleme kimliği), qde Almanca soru metni (testlang.factText); şıklar ve açıklama dilden bağımsız
        out.push({ q: `${w.whole_la} hangi sinirle innerve edilir?`, qde: `${w.whole_la}: Innervation durch welchen Nerv?`, options: [b, ...shuffle(nerves.filter(x => x !== b)).slice(0, 3)],
          explain: `${w.whole_la}: ${nv}${seg ? ` (${seg})` : ''}.`, cat: 'muscle', show: w.parts });
      }
    }
    return out;
  }
  const uniqNerve = w => { const s = [...new Set(cardsOf(w).map(c => c.nerve_la).filter(Boolean))]; return s.length === 1 ? s[0] : s.join(' und '); };

  // "Yapıyı bul" için: kas dışarıdan görünüyor mu? Kasın köşelerinden altı yöne ışın; öteki kaslar ve kemikler örtmüyorsa
  // görünür. En iyi yönde köşelerin en az üçte biri görünüyorsa sorulabilir (derin kaslar yalnız "Bu yapı ne?" sorusunda).
  const findCache = new Map(), sceneCache = {};
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.7, 0, 0.7], [0.7, 0, -0.7]].map(d => new THREE.Vector3(...d).normalize());
  function findable(q) {
    if (q.cat === 'nerve') return true;
    if (findCache.has(q)) return findCache.get(q);
    const own = lrecs(q.n), ownIds = ids(own);
    const scene = (sceneCache[q.reg] ||= [...regionBones(q.reg), ...regionMuscles(q.reg)]).filter(r => !ownIds.has(r.id));
    const pts = [];
    for (const r of own) { const P = r.geo.attributes.position.array, n = P.length / 3, step = Math.max(1, Math.floor(n / Math.ceil(24 / own.length))); for (let i = 0; i < n; i += step) pts.push(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); }
    const ray = new THREE.Ray(); let best = 0;
    for (const d of DIRS) {
      let vis = 0;
      for (const p of pts) {
        ray.origin.copy(p).addScaledVector(d, 80); ray.direction.copy(d).negate();
        let hidden = false;
        for (const r of scene) {
          if (!ray.intersectsSphere(r.sphere)) continue;
          if (!r.geo.boundsTree) r.geo.computeBoundsTree();
          const h = r.geo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
          if (h && h.distance < 79.9) { hidden = true; break; }
        }
        if (!hidden) vis++;
      }
      best = Math.max(best, vis / (pts.length || 1));
    }
    const ok = best >= 0.34; findCache.set(q, ok);
    return ok;
  }

  // --- yardımcılar ---
  const ballGeo = new THREE.SphereGeometry(1, 16, 12);
  function setMarks(list) {
    marks.clear();
    for (const { p, on } of list) { const s = new THREE.Mesh(ballGeo, on ? mats.markOn : mats.mark); s.position.copy(p); s.scale.setScalar(on ? 0.36 : 0.22); s.renderOrder = 6; marks.add(s); }
  }
  // lezyon yerinin noktası: hazır geometri (geo.sites) ya da sinirin, yer işaretlerinin ortasına en yakın köşesi
  function sitePoint(nv, site) {
    const g = D.geo?.sites?.[`${nv.key}@${site.key}`];
    if (g?.p) return { p: V3(g.p), out: g.out ? V3(g.out) : null };
    const parts = lrecs(nv.n), lm = lrecs(site.landmarks);
    if (!parts.length) return null;
    return { p: anchorOf(parts, lm.length ? boxOf(lm).getCenter(new THREE.Vector3()) : undefined), out: null };
  }
  // Kamera yönü: yapıların ortasına en yakın kemik yüzeyi noktasından yapıya doğru (kas kemiğin hangi yanındaysa oradan
  // bakılır; ör. M. gluteus maximus arkadan), biraz yukarıdan
  function sideDir(rs, bones) {
    const def = new THREE.Vector3(0.7, 0.12, 1);
    if (!rs.length || !bones.length) return def;
    const c = boxOf(rs).getCenter(new THREE.Vector3()), tgt = {};
    let best = null, bd = Infinity;
    for (const b of bones) {
      if (b.box.distanceToPoint(c) > bd) continue;
      if (!b.geo.boundsTree) b.geo.computeBoundsTree();
      const h = b.geo.boundsTree.closestPointToPoint(c, tgt);
      if (h && h.distance < bd) { bd = h.distance; best = h.point.clone(); }
    }
    if (!best) return def;
    const d = c.clone().sub(best); d.y = 0;
    if (d.length() < 0.3) return def;
    d.normalize(); d.y = 0.12;
    return d;
  }
  // bir yapının çevresindeki kemikler (kutusu yapının kutusuna pay kadar yakın olanlar): kas ve geçit görünümlerinin bağlamı
  const bonesNear = (box, pad = 3) => { const b = box.clone().expandByScalar(pad); return model.list.filter(r => r.mesh && r.s === 'bone' && r.sub !== 'attach' && L(r) && sexOk(r) && r.box.intersectsBox(b)); };
  const siteName = s => (s.de || s.la || '').split(' (')[0];
  const lesionName = s => (s.lesion_de || '').split(': ').pop().split(' (')[0];
  const short = (s, n = 34) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

  // --- sekmeler ---
  function applyTab() {
    const ov = model.overrides; ov.clear();
    const put = (rs, mat) => { for (const r of rs) ov.set(r.id, mat); };
    marks.clear();
    let iso = [], ghost = [], list = [];
    if (m.tab === 'nerves') {
      const nv = curNerve(), reg = nv.region, site = nv.sites?.[m.site] || null;
      const parts = lrecs(nv.n), mus = lrecs((nv.muscle_groups || []).flatMap(g => g.n)), musIds = ids(mus);
      const lost = new Set(site?.lost || []);
      const all = regionMuscles(reg), bones = regionBones(reg);
      put(all.filter(r => !musIds.has(r.id)), mats.ghostM);
      for (const r of mus) ov.set(r.id, lost.has(r.n) ? mats.lost : mats.active);
      put(parts, mats.nerve);
      iso = [...bones, ...all, ...mus, ...parts]; ghost = grp(BONE_CTX[reg]).filter(r => r.sub !== 'attach' && L(r));
      const pts = (nv.sites || []).map((s, i) => ({ s, i, g: sitePoint(nv, s) })).filter(x => x.g);
      setMarks(pts.map(x => ({ p: x.g.p, on: x.i === m.site })));
      list = pts.map(x => ({ text: esc(short(siteName(x.s))) + (x.i === m.site && x.s.lesion_de ? ` → <b>${esc(short(lesionName(x.s), 28))}</b>` : ''), p: x.g.out ? x.g.p.clone().addScaledVector(x.g.out, 1.8) : x.g.p, at: x.g.p, cls: x.i === m.site ? 'on' : '' }));
    } else if (m.tab === 'passages') {
      const ps = curPass(), g = D.geo?.passages?.[ps.key];
      const bounds = ps.bounds.map(b => lrecs(b.n)), contents = ps.contents.map(c => lrecs(c.n));
      const used = ids([...bounds.flat(), ...contents.flat()]);
      const ctx = lrecs(ps.context).filter(r => !used.has(r.id));
      put(ctx.filter(r => r.s !== 'bone'), mats.ghostM);
      bounds.forEach((rs, i) => { for (const r of rs) if (!ov.has(r.id)) ov.set(r.id, mats.bound[i % mats.bound.length]); });   // iki sınırda geçen parça ilk rengini korur
      contents.forEach((rs, i) => { for (const r of rs) ov.set(r.id, r.sub === 'sheath' ? mats.sheath : mats.kind[ps.contents[i].kind] || mats.kind.o); });   // tendon kılıfı saydam: içindeki tendonlar görünsün
      iso = [...ctx, ...bounds.flat(), ...contents.flat()];
      const centre = g?.center ? V3(g.center) : boxOf(bounds.flat().length ? bounds.flat() : contents.flat()).getCenter(new THREE.Vector3());
      ps.contents.forEach((c, i) => {
        if (!contents[i].length) return;
        const gp = g?.contents?.[c.key]?.p;
        list.push({ text: `<i class="ldot" style="background:${hex((KIND[c.kind] || KIND.o)[0])}"></i>${esc(short(c.la))}`, p: gp ? V3(gp) : anchorOf(contents[i], centre), cls: contents[i].some(r => r.id === m.pickedId) ? 'on' : '' });
      });
      ps.bounds.forEach((b, i) => {
        if (!bounds[i].length) return;
        const gp = g?.bounds?.find(x => x.i === i)?.p;
        list.push({ text: `<i class="ldot" style="background:${hex(BOUND_COLORS[i % BOUND_COLORS.length])}"></i>${esc(short(b.la))}`, p: gp ? V3(gp) : anchorOf(bounds[i], centre), cls: bounds[i].some(r => r.id === m.pickedId) ? 'on' : 'dimlbl' });
      });
    } else if (m.tab === 'muscles') {
      const w = curWhole(), cards = w ? cardsOf(w) : [];
      const parts = w ? lrecs(w.parts) : [], box = boxOf(parts);
      const patch = k => lrecs([...new Set(cards.flatMap(c => c.patch?.[k] || []))]);   // yamalar kartta (tools/locomotor-build.mjs bağlar)
      const origin = patch('o'), insertion = patch('i');
      const showNerve = !m.hide || m.revealed.has('n');      // kendini sınarken sinir de gizli
      const mates = lrecs(wholesOf(w?.batch, w?.group_de).flatMap(x => x.parts)).filter(r => !parts.includes(r));
      const nerve = showNerve ? lrecs([...new Set(cards.flatMap(c => c.nerve_n || []))]) : [];
      const bones = parts.length ? bonesNear(box) : [];
      put(mates, mats.ghostM); put(nerve, mats.nerve);
      iso = [...bones, ...mates, ...parts, ...origin, ...insertion, ...nerve];
      if (origin.length) list.push({ text: '<i class="ldot" style="background:#e0473f"></i>Ursprung', p: anchorOf(origin), cls: 'on' });
      if (insertion.length) list.push({ text: '<i class="ldot" style="background:#3f7fe0"></i>Ansatz', p: anchorOf(insertion), cls: 'on' });
      if (nerve.length && parts.length) list.push({ text: `<i class="ldot" style="background:${hex(COL.nerve)}"></i>${esc(short(cards[0]?.nerve_la || ''))}`, p: anchorOf(nerve, box.getCenter(new THREE.Vector3())), cls: '' });
    } else if (m.tab === 'joints') {
      const j = curJoint(), bones = lrecs(j.bones), ligs = j.ligaments.map(l => lrecs(l.n)), extras = (j.extras || []).flatMap(x => lrecs(x.n));
      const mv = j.movements?.[m.move], movers = mv ? lrecs(mv.muscles) : [];
      const boneIds = ids(bones), ligIds = ids(ligs.flat());
      put(bones, mats.boneT); put(extras.filter(r => !boneIds.has(r.id) && !ligIds.has(r.id)), mats.extra); put(movers, mats.mover);   // kemik ya da bağ olarak geçen parça o rengini korur
      ligs.forEach((rs, i) => put(rs, mats.lig[i % mats.lig.length]));
      iso = [...bones, ...extras, ...ligs.flat(), ...movers];
      j.ligaments.forEach((l, i) => { if (ligs[i].length) list.push({ text: i === m.lig ? `<b>${i + 1}</b> ${esc(short(l.la))}` : `<b>${i + 1}</b>`, p: anchorOf(ligs[i]), cls: i === m.lig ? 'on' : 'num' }); });
    } else {
      // test: bölgenin kemikleri, kasları ve listedeki sinirleri. "Bu yapı ne?" sorusunda sorulan yapı opak, öteki kaslar
      // saydam (derin kas da görünsün); öteki türlerde hepsi doğal renginde
      const reg = m.testRegion, bones = regionBones(reg), mus = regionMuscles(reg), nv = lrecs(nervesOf(reg).flatMap(n => n.n));
      iso = [...bones, ...mus, ...nv];
      state.isolate = ids(iso);            // test.ensure görünürlüğe bakar
      test.ensure();
      const st = test.state();
      if (st.mode === 'name' && st.q) {
        const asked = ids(lrecs(st.q.n));
        put(mus.filter(r => !asked.has(r.id)), mats.ctxM);
        for (const r of nv) ov.set(r.id, asked.has(r.id) ? mats.nerve : mats.nerveDim);
      } else { put(nv, mats.nerve); if (st.mode === 'find' && st.q?.cat === 'nerve') put(mus, mats.ghostM); }   // sinir sorulurken kaslar saydam: tıklama sinire ulaşsın
      lastSig = quizSig();
    }
    state.isolate = ids(iso);
    state.isoGhost = ownGhost = ghost.length ? ids(ghost) : null;
    labels.set(list);
  }
  const quizSig = () => { const s = test.state(); return `${m.testRegion}|${s.mode}|${s.q ? s.q.la : ''}|${s.answered}`; };

  // Kamera: sekmeye göre
  function frame() {
    let box = new THREE.Box3(), dir = new THREE.Vector3(0.7, 0.12, 1);
    if (m.tab === 'nerves') {
      const nv = curNerve(), parts = lrecs(nv.n), mus = lrecs((nv.muscle_groups || []).flatMap(g => g.n));
      box = boxOf(mus.length ? [...mus, ...parts.filter(r => r.box.getSize(new THREE.Vector3()).length() < 60)] : parts);
      if (box.isEmpty()) box = boxOf(parts);
      dir = sideDir(mus.length ? mus : parts, regionBones(nv.region));
    } else if (m.tab === 'passages') {
      const ps = curPass(), g = D.geo?.passages?.[ps.key];
      if (g?.box) { box.set(V3(g.box.min), V3(g.box.max)); if (g.dir) dir = V3(g.dir); }
      else { const b = ps.bounds.flatMap(x => lrecs(x.n)); box = boxOf(b.length ? b : ps.contents.flatMap(x => lrecs(x.n))); if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()); box.setFromCenterAndSize(c, box.getSize(new THREE.Vector3()).clampScalar(0, 16)); } }
    } else if (m.tab === 'muscles') {
      const w = curWhole(), parts = w ? lrecs(w.parts) : [];
      box = boxOf(parts); dir = sideDir(parts, bonesNear(box, 3));
    } else if (m.tab === 'joints') {
      const j = curJoint(), ligs = j.ligaments.flatMap(l => lrecs(l.n)), extras = (j.extras || []).flatMap(x => lrecs(x.n));
      box = boxOf(ligs.length ? [...ligs, ...extras] : lrecs(j.bones));
      if (!box.isEmpty() && box.getCenter(new THREE.Vector3()).x < 0.8) dir = new THREE.Vector3(1, 0.15, -0.5);   // orta hat (omurga): arka-yandan
    } else {
      const reg = m.testRegion; box = boxOf(regionMuscles(reg)); dir = new THREE.Vector3(0.8, 0.1, 1);
    }
    if (!box.isEmpty()) stage.frameBox(box, dir);
  }

  // spec: 'bölüm[:anahtar]' (ör. 'nerves:radialis', 'passages:karpaltunnel', 'joints:knie', 'muscles:M. biceps brachii')
  function enter(spec = 'nerves') {
    for (const s of ['muscle', 'nerve', 'vessel', 'joint', 'organ']) if (!model.loaded[s]) { defer(s, () => enter(spec)); return; }
    if (!D) { const seq = ++enterSeq; load().then(() => { if (seq === enterSeq) enter(spec); }, () => {}); return; }
    build();
    endStudy?.('loco');   // başka bir çalışma modu açıksa renklerini ve etiketlerini şimdi kaldırsın
    const s = String(spec), i = s.indexOf(':'), tab = i < 0 ? s : s.slice(0, i), key = i < 0 ? '' : s.slice(i + 1);
    m.tab = TABS.some(([k]) => k === tab) ? tab : 'nerves';
    if (!hasTab(m.tab)) m.tab = TABS.map(([k]) => k).find(hasTab) || 'quiz';
    if (key) {
      if (m.tab === 'nerves') { const n = D.nerves.list.find(x => x.key === key); if (n) { m.region = n.region; m.nerve[n.region] = key; m.site = -1; } else if (REGIONS.some(([k]) => k === key)) { m.region = key; m.site = -1; } }
      else if (m.tab === 'passages') { if (D.passages.list.some(x => x.key === key)) m.pass = key; else { const p = D.passages.list.find(x => x.region === key); if (p) m.pass = p.key; } }
      else if (m.tab === 'joints') { if (D.joints.list.some(x => x.key === key)) { m.joint = key; m.lig = -1; m.move = -1; } }
      else if (m.tab === 'muscles') pickWhole(key) || (BATCHES.some(([k]) => k === key) && (m.batch = key, m.group = null, m.whole = null));
      else if (m.tab === 'quiz' && TEST_REGIONS.some(([k]) => k === key)) m.testRegion = key;
    }
    active = true; m.pickedId = null; m.sex = state.sex; root.visible = true; wasExploded = null;
    state.selected = new Set(); state.primary = { type: 'loco' };
    viewLayers({ bone: 'show', muscle: 'show', nerve: 'show', vessel: 'show', joint: 'show', organ: 'show' });
    applyTab();
    refresh();
    frame();
  }
  // bir kası (bütün kasın Latince adı ya da model parça adı) seç; bulunursa true
  function pickWhole(key) {
    const w = MU.wholes.get(key) || [...MU.wholes.values()].find(x => x.parts.includes(key));
    if (!w) return false;
    m.batch = w.batch; m.group = w.group_de; m.whole = w.whole_la; m.revealed = new Set();
    return true;
  }
  function cleanup() {
    active = false; test?.clear(); enterSeq++;
    model.overrides.clear(); if (ownGhost && state.isoGhost === ownGhost) state.isoGhost = null;   // başka görünümün bağlamına dokunma
    ownGhost = null; root.visible = false; marks.clear(); labels.set([]);
  }
  // Ana yenilemeden önce: mod bittiyse temizle; beden değiştiyse ya da testte soru değiştiyse görünümü yeniden kur
  function sync() {
    if (!active) return;
    if (state.primary?.type !== 'loco') { cleanup(); return; }
    if (m.sex !== state.sex) { m.sex = state.sex; findCache.clear(); for (const k of Object.keys(sceneCache)) delete sceneCache[k]; applyTab(); return; }
    if (m.tab === 'quiz' && quizSig() !== lastSig) applyTab();
  }
  function highlight() {
    if (!active || !D) return [];
    let rs = [];
    if (m.tab === 'nerves') rs = lrecs(curNerve().n);
    else if (m.tab === 'muscles') { const w = curWhole(); rs = w ? lrecs(w.parts) : []; }
    else if (m.tab === 'joints') { const l = curJoint().ligaments[m.lig]; rs = l ? lrecs(l.n) : []; }
    else if (m.tab === 'quiz') rs = test.asked();
    const picked = m.pickedId && m.tab !== 'quiz' ? model.items.get(m.pickedId) : null;
    if (picked) rs = rs.concat([picked]);
    return rs.filter(r => r.vis).map(r => r.mesh);
  }
  // 3B görünümde tıklanan yapı. Sinir bölümünde başka bir sinire tıklanırsa ona geçilir; kas bölümünde gruptaki başka bir
  // kasa tıklanırsa o seçilir; eklemde bağ seçilir; ötekiler panelde gösterilir (kas ise kartıyla). Testte cevap sayılır.
  function onPick(id, x, y) {
    if (!active) return false;
    const r = model.items.get(id); if (!r) return true;
    if (m.tab === 'quiz') {
      const q = test.findQuestion();
      if (q) {
        const want = new Set(q.n); let ok = want.has(r.n);
        if (!ok && x !== undefined) for (const h of model.hitsAt(x, y)) { if (want.has(h.rec.n)) { ok = true; break; } if (!h.soft) break; }
        test.answer(ok, r); refresh();
      }
      return true;
    }
    m.pickedId = null;
    if (m.tab === 'nerves') {
      const n = D.nerves.list.find(nv => nv.n.includes(r.n));
      if (n && n !== curNerve()) { m.region = n.region; m.nerve[n.region] = n.key; m.site = -1; applyTab(); refresh(); frame(); return true; }
      if (!n) m.pickedId = id;
    } else if (m.tab === 'muscles') {
      const w = curWhole();
      if (r.s === 'muscle' && MU.muscles[r.n] && !(w && w.parts.includes(r.n))) pickWhole(r.n); else if (!(w && w.parts.includes(r.n))) m.pickedId = id;
    } else if (m.tab === 'joints') {
      const i = curJoint().ligaments.findIndex(l => l.n.includes(r.n));
      if (i >= 0) m.lig = i; else m.pickedId = id;
    } else m.pickedId = id;
    applyTab(); refresh();
    return true;
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
  const seg = (list, cur, attr, cls = 'tiny bview') => `<div class="seg ${cls}">${list.map(([k, t]) => `<button ${attr}="${k}" class="${cur === k ? 'active' : ''}">${t}</button>`).join('')}</div>`;
  const row = (k, v) => (v ? `<tr><td>${k}</td><td>${v}</td></tr>` : '');
  const nameOf = n => { const r = recs([n])[0]; return r ? titleName(r) : n; };
  const details = (title, body) => (body ? `<details class="clinic"><summary>${title}</summary>${body}</details>` : '');
  const lesionsHTML = l => (!l ? '' : (Array.isArray(l) ? l : [l]).map(x => `<p>${esc(typeof x === 'string' ? x : [x.de, x.tr].filter(Boolean).join(': '))}</p>`).join(''));
  const clinic = l => details('Klinik', (l || []).map(c => `<p><b lang="de">${esc(c.de)}</b>: ${esc(c.tr)}</p>`).join(''));
  const notIn = l => details(`Modelde olmayanlar (${(l || []).length})`, (l || []).map(x => `<p>${esc(typeof x === 'string' ? x : [x.la, x.de, x.tr].filter(Boolean).join(' · '))}</p>`).join(''));
  const pickedHTML = () => {
    const r = m.pickedId ? model.items.get(m.pickedId) : null; if (!r) return '';
    const card = MU.muscles[r.n], nv = card ? nerveOfCard(card) : null;
    return `<div class="field"><div class="k">Tıklanan yapı</div><div class="v"><b lang="la">${esc(titleName(r))}</b>${subtitleName(r) ? ` · <span lang="de">${esc(subtitleName(r))}</span>` : ''}${r.tr ? `<br><small>${esc(r.tr)}</small>` : ''}</div>
      ${card ? cardHTML([card]) : ''}${nv && m.tab === 'nerves' && nv !== curNerve() ? `<div class="btns"><button data-go="nerves:${nv.key}">→ ${esc(nv.la)}</button></div>` : ''}</div>`;
  };
  function nervesHTML() {
    const list = nervesOf(m.region), nv = curNerve(), site = nv.sites?.[m.site] || null;
    const chip = n => { const t = n.key.replace(/_/g, ' ').replace('cutaneus femoris lateralis', 'cut. femoris lat.').replace('fibularis communis', 'fibularis'); return t[0].toUpperCase() + t.slice(1); };
    const lostNames = site ? [...new Set((site.lost || []).filter(n => !/tendon/i.test(n)))].map(nameOf) : [];   // tendonlar kasıyla boyanır ama listede yazılmaz
    const plexus = D.nerves.plexus?.[m.region === 'arm' ? 'brachialis' : 'lumbosacralis'];
    return `
      ${seg(REGIONS, m.region, 'data-lr')}
      <div class="cnlist nvlist">${list.map(n => `<button data-nv="${n.key}" class="${n === nv ? 'on' : ''}" style="--c:${hex(COL.nerve)}" title="${esc(n.de || '')}">${esc(chip(n))}</button>`).join('')}</div>
      <h1 class="name" lang="la">${esc(nv.la)}</h1>
      <div class="name-de" lang="de">${esc(nv.de || '')}</div>
      <div class="legend">${sw(COL.nerve, 'sinir')} ${sw(COL.active, 'innerve ettiği kaslar')} ${site ? sw(COL.lost, 'felçli') : ''}</div>
      ${(nv.sites || []).length ? `<div class="field"><div class="k">Lezyon yeri</div><div class="sites"><button data-site="-1" class="${m.site < 0 ? 'on' : ''}">yok</button>${nv.sites.map((s, i) => `<button data-site="${i}" class="${i === m.site ? 'on' : ''}" lang="de" title="${esc(s.de || s.la || '')}">${esc(siteName(s))}</button>`).join('')}</div></div>` : ''}
      ${site ? `<div class="lesion">
          ${site.lesion_de ? `<h2 lang="de">${esc(site.lesion_de)}</h2>` : ''}
          <p class="htext">${esc(site.lesion_tr || '')}</p>
          <table class="cnfacts">
            ${row('Yer', esc(site.where_tr || '') + (site.la ? `<br><small lang="la">${esc(site.la)}</small>` : '') + (D.geo?.sites?.[`${nv.key}@${site.key}`]?.ok === false ? '<br><small>Modelde sinir burada ders kitabındaki yerinden biraz farklı geçiyor; işaret yaklaşık.</small>' : ''))}
            ${row('Neden', site.cause_de ? `<span lang="de">${esc(site.cause_de)}</span>` : '')}
            ${row('Felçli', lostNames.length ? `<span lang="la">${lostNames.map(esc).join(', ')}</span>` : 'kas felci yok')}
            ${row('Sağlam', esc(site.spared_tr || ''))}
            ${row('Duyu', esc(site.sensory_loss_tr || ''))}
            ${row('Bulgular', (site.signs_de || []).length ? `<span lang="de">${site.signs_de.map(esc).join('<br>')}</span>` : '')}
          </table></div>` : ''}
      <table class="cnfacts">
        ${row('Kökler', esc(nv.roots || '') + (nv.origin_de ? `<br><small lang="de">${esc(nv.origin_de)}</small>` : ''))}
        ${row('Seyir', esc(nv.course_tr || ''))}
        ${row('Kaslar', (nv.muscle_groups || []).map(g => `<b lang="de">${esc(g.label_de)}</b>: <span lang="la">${[...new Set(g.n)].map(n => `<a data-mus="${esc(n)}">${esc(nameOf(n))}</a>`).join(', ')}</span>${g.note_tr ? ` <small>(${esc(g.note_tr)})</small>` : ''}`).join('<br>'))}
        ${row('Duyu', esc(nv.sensory_tr || '') + (nv.autonom_de ? `<br><small lang="de">${esc(nv.autonom_de)}</small>` : ''))}
        ${row('Refleks', nv.reflex_de ? `<span lang="de">${esc(nv.reflex_de)}</span>` : '')}
      </table>
      ${nv.tip ? `<div class="tip">${esc(nv.tip)}</div>` : ''}
      ${details(m.region === 'arm' ? 'Plexus brachialis' : 'Plexus lumbosacralis', plexus ? `${plexus.roots ? `<p><b>${esc(plexus.roots)}</b></p>` : ''}<p>${esc(plexus.tr || '')}</p>${lesionsHTML(plexus.lesions_tr)}${plexus.tip ? `<div class="tip">${esc(plexus.tip)}</div>` : ''}` : '')}
      ${details('Kennmuskeln', (D.nerves.kennNote ? `<p><small>${esc(D.nerves.kennNote)}</small></p>` : '') + (D.nerves.kennmuskeln || []).map(k => `<p><b>${esc(k.seg)}</b>: <span lang="de">${esc(k.muscle_de)}</span>${k.reflex_de ? ` <small lang="de">(${esc(k.reflex_de)})</small>` : ''}</p>`).join(''))}
      ${notIn(nv.notInModel)}`;
  }
  function passagesHTML() {
    const list = D.passages.list, ps = curPass();
    const regs = [...new Set(list.map(p => p.region))];
    const has = n => lrecs(n).length > 0;
    return `
      <div class="selrow"><button data-pa="prev" title="Önceki geçit">◀</button>
        <select data-sel="pass">${regs.map(rg => `<optgroup label="${esc(PASS_REGION[rg] || rg)}">${list.filter(p => p.region === rg).map(p => `<option value="${p.key}"${p === ps ? ' selected' : ''}>${esc(p.de || p.la)}</option>`).join('')}</optgroup>`).join('')}</select>
        <button data-pa="next" title="Sonraki geçit">▶</button></div>
      <h1 class="name" lang="la">${esc(ps.la)}</h1>
      <div class="name-de" lang="de">${esc(ps.de || '')}</div>
      <p class="htext">${esc(ps.short_tr || '')}</p>
      <div class="field"><div class="k">Sınırlar</div><div class="corlist plist">${ps.bounds.map((b, i) => `<div class="cor">${sw(BOUND_COLORS[i % BOUND_COLORS.length])}<div><b lang="la">${esc(b.la || '')}</b>${has(b.n) ? '' : ' <small>(modelde yok)</small>'}<br><small>${esc(b.role_tr || '')}${b.role_de ? ` · <span lang="de">${esc(b.role_de)}</span>` : ''}</small></div></div>`).join('')}</div></div>
      <div class="field"><div class="k">İçinden geçenler</div><ol class="plist pcont">${ps.contents.map(c => `<li>${sw((KIND[c.kind] || KIND.o)[0])}<b lang="la">${esc(c.la || '')}</b>${c.de ? ` · <span lang="de">${esc(c.de)}</span>` : ''}${has(c.n) ? '' : ' <small>(modelde yok)</small>'}${D.geo?.passages?.[ps.key]?.contents?.[c.key]?.passes === false ? ' <small>(modelde geçidin biraz dışında)</small>' : ''}${c.note_tr ? `<br><small>${esc(c.note_tr)}</small>` : ''}</li>`).join('')}</ol>
        <div class="legend">${Object.values(KIND).slice(0, 4).map(([c, t]) => sw(c, t)).join(' ')}</div></div>
      ${ps.order_tr ? `<p class="htext">${esc(ps.order_tr)}</p>` : ''}
      ${ps.tip ? `<div class="tip">${esc(ps.tip)}</div>` : ''}
      ${ps.sex_tr ? `<p class="htext small">${esc(ps.sex_tr)}</p>` : ''}
      ${clinic(ps.clinic)}
      ${notIn(ps.notInModel)}`;
  }
  function musclesHTML() {
    const groups = groupsOf(m.batch), g = curGroup(), ws = wholesOf(m.batch, g), w = curWhole();
    if (!w) return `${seg(BATCHES, m.batch, 'data-mb')}<p class="htext">Bu bölgede kas kartı yok.</p>`;
    const cards = cardsOf(w), r = recs(w.parts)[0], nv = cards.map(nerveOfCard).find(Boolean);
    const hidden = m.hide ? new Set(['o', 'i', 'n', 'f'].filter(k => !m.revealed.has(k))) : null;
    return `
      ${seg(BATCHES, m.batch, 'data-mb')}
      <select class="wide" data-sel="group">${groups.map(x => `<option value="${esc(x)}"${x === g ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <div class="selrow"><button data-ma="prev" title="Önceki kas">◀</button>
        <select data-sel="whole">${ws.map(x => `<option value="${esc(x.whole_la)}"${x === w ? ' selected' : ''}>${esc(x.whole_la)}</option>`).join('')}</select>
        <button data-ma="next" title="Sonraki kas">▶</button></div>
      <h1 class="name" lang="la">${esc(w.whole_la)}</h1>
      <div class="name-de" lang="de">${esc(w.parts.length === 1 && r ? subtitleName(r) : g || '')}</div>
      <label class="selftest"><input type="checkbox" data-ma="hide"${m.hide ? ' checked' : ''}> Kendini sına: satırları gizle</label>
      ${cardHTML(cards, { hidden })}
      <div class="legend">${sw(0xe0473f, 'Ursprung')} ${sw(0x3f7fe0, 'Ansatz')} ${sw(COL.nerve, 'sinir')}</div>
      ${nv && (!m.hide || m.revealed.has('n')) ? `<div class="btns"><button data-go="nerves:${nv.key}" title="Bu sinirin bütün kasları ve lezyonları">Sinirine git: ${esc(nv.la.replace(/^Nervus /, 'N. '))}</button></div>` : ''}`;
  }
  function jointsHTML() {
    const list = D.joints.list, j = curJoint(), lig = j.ligaments[m.lig], mv = j.movements?.[m.move];
    const has = n => lrecs(n).length > 0;
    return `
      <div class="cnlist nvlist">${list.map(x => `<button data-jt="${x.key}" class="${x === j ? 'on' : ''}" style="--c:#e8dcc0" lang="de" title="${esc(x.de || '')}">${esc(JOINT_SHORT[x.key] || (x.de || x.la).split(/[ (:,]/)[0])}</button>`).join('')}</div>
      <h1 class="name" lang="la">${esc(j.la)}</h1>
      <div class="name-de" lang="de">${esc(j.de || '')}</div>
      <table class="cnfacts">
        ${row('Tür', `<span lang="de">${esc(j.type_de || '')}</span>${j.type_tr ? `<br><small>${esc(j.type_tr)}</small>` : ''}`)}
        ${row('Eksen', j.freiheitsgrade ? `${esc(String(j.freiheitsgrade))} hareket ekseni` : '')}
        ${row('Yüzeyler', esc(j.partner_tr || ''))}
      </table>
      <div class="field"><div class="k">Bağlar</div><ol class="plist ligs">${j.ligaments.map((l, i) => `<li data-lig="${i}" class="${i === m.lig ? 'on' : ''}">${sw(LIG_COLORS[i % LIG_COLORS.length])}<b lang="la">${esc(l.la || '')}</b>${has(l.n) ? '' : ' <small>(modelde yok)</small>'}${i === m.lig ? `<br><small lang="de">${esc(l.de || '')}</small><p>${esc(l.course_tr || '')}</p><p>${esc(l.function_tr || '')}</p>${l.test_de ? `<p><small lang="de">${esc(l.test_de)}</small></p>` : ''}` : ''}</li>`).join('')}</ol></div>
      ${(j.extras || []).length ? `<div class="field"><div class="k">Diğer yapılar</div><div class="v">${j.extras.map(x => `${sw(0x9fd6e0)}<b lang="la">${esc(x.la || '')}</b>${has(x.n) ? '' : ' <small>(modelde yok)</small>'}: ${esc(x.tr || '')}`).join('<br>')}</div></div>` : ''}
      ${(j.movements || []).length ? `<div class="field"><div class="k">Hareketler <small>(tıkla: ana kasları göster)</small></div><table class="cnfacts moves">${j.movements.map((x, i) => `<tr data-mv="${i}" class="${i === m.move ? 'on' : ''}"><td lang="de">${esc(x.de)}</td><td>${esc(x.tr || '')}${x.range_de ? ` <small lang="de">${esc(x.range_de)}</small>` : ''}${i === m.move ? `<br><span lang="la">${(x.muscles || []).map(n => esc(nameOf(n))).join(', ')}</span>${x.note_tr ? `<br><small>${esc(x.note_tr)}</small>` : ''}` : ''}</td></tr>`).join('')}</table></div>` : ''}
      ${j.tip ? `<div class="tip">${esc(j.tip)}</div>` : ''}
      ${clinic(j.clinic)}
      ${notIn(j.notInModel)}`;
  }
  function panelHTML() {
    if (!D || !built) return '<p class="htext">Hareket sistemi modu yükleniyor…</p>';
    const body = m.tab === 'nerves' ? nervesHTML() : m.tab === 'passages' ? passagesHTML() : m.tab === 'muscles' ? musclesHTML() : m.tab === 'joints' ? jointsHTML()
      : `<div class="tlbox"${langAttr()}>${seg(TEST_REGIONS.map(([k]) => [k, esc(T('reg.' + k))]), m.testRegion, 'data-tr')}</div>${test.html()}`;
    return `
      <div class="chips"><span class="chip loco">Hareket sistemi modu</span></div>
      <div class="seg small htabs">${TABS.map(([k, t]) => `<button data-lt="${k}" class="${m.tab === k ? 'active' : ''}"${hasTab(k) ? '' : ' disabled'}>${t}</button>`).join('')}</div>
      ${body}
      ${m.tab !== 'quiz' ? pickedHTML() : ''}
      <div class="btns"><button data-la="exit" title="Hareket sistemi modundan çık (Esc)">Moddan çık</button></div>`;
  }
  const redo = (reframe = false) => { applyTab(); refresh(); if (reframe) frame(); };
  const stepIn = (list, cur, d) => list[(list.indexOf(cur) + d + list.length) % list.length];
  function click(e) {
    if (m.tab === 'quiz' && test.click(e)) return;
    const t = e.target.closest('[data-lt],[data-la],[data-lr],[data-nv],[data-site],[data-mus],[data-go],[data-pa],[data-mb],[data-ma],[data-mrow],[data-jt],[data-lig],[data-mv],[data-tr]'); if (!t) return;
    const d = t.dataset;
    if (d.lt) { if (d.lt !== m.tab && hasTab(d.lt)) { m.tab = d.lt; m.pickedId = null; redo(true); } return; }
    if (d.la === 'exit') { state.isolate = null; refresh(); return; }
    if (d.go) { enter(d.go); return; }
    if (d.lr) { if (d.lr !== m.region) { m.region = d.lr; m.site = -1; m.pickedId = null; redo(true); } return; }
    if (d.nv) { m.nerve[m.region] = d.nv; m.site = -1; m.pickedId = null; redo(true); return; }
    if (d.site !== undefined) { m.site = +d.site; m.pickedId = null; redo(); return; }
    if (d.mus) { const r = lrecs([d.mus])[0]; if (r) { m.pickedId = r.id; redo(); setTimeout(() => document.querySelector('#info .mcard')?.scrollIntoView({ block: 'nearest' }), 0); } return; }
    if (d.pa) { const l = D.passages.list; m.pass = stepIn(l, curPass(), d.pa === 'next' ? 1 : -1).key; m.pickedId = null; redo(true); return; }
    if (d.mb) { if (d.mb !== m.batch) { m.batch = d.mb; m.group = null; m.whole = null; m.revealed = new Set(); m.pickedId = null; redo(true); } return; }
    if (d.ma === 'hide') { m.hide = t.checked; m.revealed = new Set(); redo(); return; }
    if (d.ma) {
      // gruptaki sonraki / önceki kas; grubun sonunda sıradaki gruba geçilir
      const groups = groupsOf(m.batch), g = curGroup(), ws = wholesOf(m.batch, g), i = ws.indexOf(curWhole()) + (d.ma === 'next' ? 1 : -1);
      if (i >= 0 && i < ws.length) m.whole = ws[i].whole_la;
      else { const ng = stepIn(groups, g, d.ma === 'next' ? 1 : -1), nw = wholesOf(m.batch, ng); m.group = ng; m.whole = (d.ma === 'next' ? nw[0] : nw[nw.length - 1])?.whole_la || null; }
      m.revealed = new Set(); m.pickedId = null; redo(true); return;
    }
    if (d.mrow) { m.revealed.add(d.mrow); if (d.mrow === 'n') redo(); else refresh(); return; }
    if (d.jt) { if (d.jt !== curJoint().key) { m.joint = d.jt; m.lig = -1; m.move = -1; m.pickedId = null; redo(true); } return; }
    if (d.lig !== undefined) { m.lig = m.lig === +d.lig ? -1 : +d.lig; m.pickedId = null; redo(); return; }
    if (d.mv !== undefined) { m.move = m.move === +d.mv ? -1 : +d.mv; redo(); return; }
    if (d.tr) { if (d.tr !== m.testRegion) { m.testRegion = d.tr; test.clear(); redo(true); } }
  }
  // açılır listeler (panel her yenilemede yeniden yazıldığı için olay üst öğeden dinlenir)
  document.querySelector('#info')?.addEventListener('change', e => {
    if (!active) return;
    const t = e.target.closest('select[data-sel]'); if (!t) return;
    if (t.dataset.sel === 'pass') m.pass = t.value;
    else if (t.dataset.sel === 'group') { m.group = t.value; m.whole = null; }
    else if (t.dataset.sel === 'whole') m.whole = t.value;
    m.revealed = new Set(); m.pickedId = null; redo(true);
  });

  return {
    enter, sync, highlight, onPick, panelHTML, click,
    isActive: () => active, hideTips: () => active && m.tab === 'quiz',
    cancelPending: () => { if (!active) enterSeq++; },
    // adres çubuğundaki bağlantı için enter() ile aynı biçim: 'bölüm[:anahtar]'
    spec: () => {
      const k = m.tab === 'nerves' ? m.nerve[m.region] || m.region : m.tab === 'passages' ? m.pass : m.tab === 'joints' ? m.joint
        : m.tab === 'muscles' ? m.whole || m.batch : m.tab === 'quiz' ? m.testRegion : '';
      return m.tab + (k ? ':' + k : '');
    },
  };
}
