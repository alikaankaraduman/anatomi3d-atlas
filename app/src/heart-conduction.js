// Kalp modunun "İleti" sekmesi: uyarı oluşturma ve iletme sistemi (Erregungsbildungs- und Erregungsleitungssystem).
// İleti sistemi modelde yok: düğümler küçük küreler, demetler ve dallar önceden hesaplanmış noktalardan geçen tüpler
// (Catmull-Rom eğrisi üzerinde TubeGeometry) olarak saydam kalbin içine şematik çizilir (veri: data/conduction.json,
// tools/conduction-build.mjs). Bir kalp atımı (800 ms) yavaşlatılarak oynatılır: parlak bir uyarı adımların t_ms
// aralıklarına göre yol boyunca ilerler, kulakçıklar sinüs düğümünden dışa doğru, karıncıklar apeksten tabana doğru
// parlar, repolarizasyonda söner. Paneldeki küçük EKG eğrisi (D II biçimi) aynı zaman ekseninden çizilir; imleç
// animasyonla birlikte yürür, eğriye tıklamak ya da sürüklemek animasyonu o ana getirir.
// Veri sekme ilk açıldığında (ya da Test sekmesinde bilgi soruları için) indirilir; moddan çıkınca indirme iptal olur.
import * as THREE from 'three';
import { esc } from './text.js';
import { tint, solid, hex } from './study.js';

const BEAT = 800;                                   // bir atım (ms, 75/dk)
const SPEEDS = { slow: 6000, normal: 3000 };        // ekranda bir atımın süresi (ms)
// yapıların rengi ve tüp yarıçapı (cm); ince ve soluk olanlar: internodal yollar, Bachmann demeti, Purkinje yelpazeleri
const STYLE = {
  sa: { color: 0xffd23f }, av: { color: 0xff8a3d },
  internodal: { color: 0xffe7a3, r: 0.06, alpha: 0.5 }, bachmann: { color: 0xffb35c, r: 0.075, alpha: 0.55 },
  his: { color: 0xff4f9a, r: 0.17 }, rbb: { color: 0x3fd0ff, r: 0.15 }, lbb: { color: 0xa184ff, r: 0.17 },
  lbb_ant: { color: 0xc2a8ff, r: 0.13 }, lbb_post: { color: 0x7e5cf0, r: 0.14 },
  purkinje: { color: 0x7cf0a8, r: 0.07 }, koch: { color: 0xd8d8d8 },
};
// adım -> parlayan (seçili) yapılar
const STEP_STRUCT = { sa: ['sa'], atria: ['internodal', 'bachmann'], av: ['av', 'koch'], his: ['his'], branches: ['rbb', 'lbb', 'lbb_ant', 'lbb_post'], purkinje: ['purkinje'], ventricles: [], repol: [] };
const NERVE_COL = [0xf0a030, 0x3fc46a, 0x5fd0c0, 0xe07ad0];
const V = a => new THREE.Vector3(a[0], a[1], a[2]);
const clamp01 = x => Math.max(0, Math.min(1, x));

// Odacık duvarı için dalga malzemesi: tint() gibi kenarda belirgin saydam; ayrıca bir noktadan (uAxial 0: uzaklık,
// kulakçıklar) ya da bir eksen boyunca (uAxial 1: apeksten tabana, karıncıklar) ilerleyen bir uyarı cephesi.
// uFront: cephenin yeri (cm), uLit: cephenin gerisindeki parlaklık, uWave: cephedeki parlak bant.
function waveMat(color, hot) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color(hot) }, uBase: { value: 0.04 }, uEdge: { value: 0.42 },
      uO: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3(0, 1, 0) }, uAxial: { value: 0 },
      uFront: { value: -100 }, uLit: { value: 0 }, uWave: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vN = normalMatrix * normal; vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uHot; uniform float uBase; uniform float uEdge;
      uniform vec3 uO; uniform vec3 uD; uniform float uAxial; uniform float uFront; uniform float uLit; uniform float uWave;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        vec3 q = vW - uO;
        float s = mix(length(q), dot(q, uD), uAxial);
        float lit = (1.0 - smoothstep(uFront - 0.3, uFront + 0.3, s)) * uLit;
        float band = uWave * exp(-pow((s - uFront) / 0.8, 2.0));
        float k = clamp(lit * 0.55 + band, 0.0, 1.0);
        gl_FragColor = vec4(mix(uColor, uHot, k), uBase + uEdge * pow(f, 2.0) + lit * 0.10 + band * 0.32);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  m.userData.ghost = true;
  return m;
}
// İleti yolu tüpü: uProg'a kadar olan kısım (uyarının geçtiği yer) parlak, uProg'daki bant beyaz (ilerleyen uyarı)
function tubeMat(color, alpha = 1) {
  return new THREE.ShaderMaterial({
    transparent: alpha < 1, depthWrite: alpha >= 1, clipping: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uProg: { value: 0 }, uLit: { value: 0 }, uHead: { value: 0 }, uLen: { value: 1 }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */`
      varying float vA; varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_vertex>
      void main() {
        vA = uv.x;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uProg; uniform float uLit; uniform float uHead; uniform float uLen; uniform float uAlpha;
      varying float vA; varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float lit = step(vA, uProg) * uLit;
        float band = uHead * exp(-pow((vA - uProg) * uLen / 0.45, 2.0));
        float shade = 0.6 + 0.4 * abs(dot(normalize(vN), normalize(vV)));
        vec3 c = uColor * (0.55 + 0.75 * lit) * shade + vec3(1.0, 0.97, 0.85) * (band + lit * 0.18);
        gl_FragColor = vec4(c, clamp(uAlpha + lit * 0.4 + band, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// EKG (D II): zaman (ms) -> mV. Bölümlerin sınırları verinin t_ms değerlerinden gelir, böylece eğri ile animasyon aynı
// zaman ekseninde kalır.
function ecgShape(seg) {
  const T = k => seg.find(s => s.key === k)?.t_ms;
  const P = T('P') || [0, 100], Q = T('QRS') || [160, 260], ST = T('ST') || [Q[1], Q[1] + 100], TW = T('T') || [ST[1], ST[1] + 160];
  const q = Q[1] - Q[0];
  // QRS: kısa negatif Q, yüksek R, negatif S, J noktasına dönüş
  const qrs = [[0, 0], [0.16, -0.12], [0.44, 1.1], [0.68, -0.3], [0.9, 0.02], [1, 0.02]].map(([x, y]) => [Q[0] + x * q, y]);
  return t => {
    if (t >= P[0] && t <= P[1]) return 0.15 * Math.sin(Math.PI * (t - P[0]) / (P[1] - P[0]));
    if (t >= Q[0] && t <= Q[1]) { for (let i = 1; i < qrs.length; i++) if (t <= qrs[i][0]) { const [x0, y0] = qrs[i - 1], [x1, y1] = qrs[i]; return y0 + (y1 - y0) * (t - x0) / (x1 - x0); } }
    if (t > ST[0] && t < ST[1]) return 0.02 + 0.02 * (t - ST[0]) / (ST[1] - ST[0]);
    if (t >= TW[0] && t <= TW[1]) { const x = (t - TW[0]) / (TW[1] - TW[0]); return 0.04 * (1 - x) + 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(x, 0.8)), 1.5); }
    return 0;
  };
}
const EW = 320, EH = 96, EX0 = 6, EXW = 308, EY0 = 64, EYK = 46;   // EKG çiziminin ölçüleri (SVG viewBox)
const ex = t => EX0 + t / BEAT * EXW, ey = v => EY0 - v * EYK;

export function createConduction({ stage, model, state, recs, groupRecs, sets, root, labels, ui, defer, viewLayers, reapply, isOn, refresh }) {
  let D = null, loading = null, ctrl = null, failed = false;
  const facts = [];                                  // Test sekmesinin bilgi soruları (veri gelince dolar)
  const c = { t: 0, playing: false, speed: 'slow', stepSel: null, sel: null, nerves: false, nerveWas: undefined, last: 0, curStep: null, curSeg: null, dirty: true };
  let group = null, tubes = [], nodes = {}, heads = null, mats = null, helperMats = [], lastClip = undefined;
  let steps = [], segs = [], ecgY = null, labelPts = {};

  // --- veri: sekme ilk açıldığında; moddan çıkınca indirme iptal edilir ---
  function load() {
    if (D) return Promise.resolve(D);
    if (loading) return loading;
    failed = false; ctrl = new AbortController();
    loading = fetch('data/conduction.json', { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { D = d; steps = d.steps || []; segs = d.ecg?.segments || []; ecgY = ecgShape(segs); facts.push(...(d.quiz || [])); return d; })
      .catch(e => {
        loading = null;
        if (e?.name !== 'AbortError') { failed = true; console.warn('ileti sistemi verisi yüklenemedi:', e); ui?.notify?.('İleti sistemi verisi yüklenemedi'); }
        throw e;
      });
    return loading;
  }
  function cancel() { if (loading && !D) { ctrl?.abort(); loading = null; } }

  // --- malzemeler (ilk kullanımda) ---
  function buildMats() {
    if (mats) return;
    mats = {
      atria: waveMat(0xc9b3ad, 0xffc857), vent: waveMat(0xc9b3ad, 0xffc857),
      faint: tint(0xb9aaa6, 0.02, 0.28), leaflet: tint(0xf4efe6, 0.05, 0.4), pap: tint(0xe6b0a8, 0.05, 0.42),
      nerve: NERVE_COL.map(col => solid(col, 0.3)),
    };
  }
  // --- yardımcı nesneler: tüpler, düğümler, Koch üçgeni (veri gelince bir kez) ---
  function buildGroup() {
    if (group) return;
    const G = D.geo; group = new THREE.Group(); group.name = 'conduction';
    const st = Object.fromEntries(steps.map(s => [s.key, s.t_ms]));
    const S = (k, d) => st[k] || d;
    const headGeo = new THREE.SphereGeometry(0.22, 14, 10), headMat = new THREE.MeshBasicMaterial({ color: 0xfffbe6, transparent: true, opacity: 0.95 });
    heads = { geo: headGeo, mat: headMat }; helperMats.push(headMat);
    const addTube = (key, pts, t0, t1, fade, extra = {}) => {
      if (!pts || pts.length < 2) return null;
      const s = STYLE[key], curve = new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal'), len = curve.getLength();
      const mat = tubeMat(s.color, s.alpha ?? 1); mat.uniforms.uLen.value = len; helperMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 10)), s.r, 8, false), mat);
      mesh.renderOrder = s.alpha ? 2 : 1;
      const head = new THREE.Mesh(headGeo, headMat); head.visible = false; head.renderOrder = 3;
      if (s.r < 0.1) head.scale.setScalar(0.7);
      group.add(mesh, head);
      const it = { key, curve, len, mesh, mat, head, t0, t1, fade, pts, ...extra };
      // yol boyunca birikimli uzunluk (Purkinje yelpazesinin başlama zamanı için)
      let acc = 0; it.cum = pts.map((p, i) => (i ? (acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2])) : 0));
      tubes.push(it); return it;
    };
    const atr = S('atria', [10, 100]), av = S('av', [50, 150]), his = S('his', [150, 165]), br = S('branches', [160, 185]), pk = S('purkinje', [175, 200]);
    const fadeA = [av[1], av[1] + 100];                // kulakçık yolları: AV gecikmesinden sonra söner
    const fadeV = [300, 450];                          // karıncık yolları: ST sırasında parlak, T dalgasında söner
    // internodal yollar sinüs düğümünden AV düğümüne: en uzunu AV adımının başında varır
    const inl = (G.internodal || []).map(p => p.reduce((a, q, i) => a + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1], q[2] - p[i - 1][2]) : 0), 0));
    const maxIn = Math.max(...inl, 1);
    (G.internodal || []).forEach((p, i) => addTube('internodal', p, atr[0], atr[0] + (av[0] - atr[0]) * inl[i] / maxIn, fadeA, { name: G.internodal_names?.[i] }));
    addTube('bachmann', G.bachmann, atr[0], atr[1] - 10, fadeA);
    addTube('his', G.his, his[0], br[0], fadeV);
    addTube('rbb', G.rbb, br[0], br[1], fadeV);
    // sol dal: kısa ortak gövde, sonra iki fasikül aynı anda (sağ dalla birlikte sona erer)
    const lbbLen = G.arc?.lbb || 1.8, fasLen = Math.max(G.arc?.lbb_ant || 5, G.arc?.lbb_post || 9);
    const lbbEnd = br[0] + (br[1] - br[0]) * lbbLen / (lbbLen + fasLen);
    addTube('lbb', G.lbb, br[0], lbbEnd, fadeV);
    addTube('lbb_ant', G.lbb_ant, lbbEnd, br[1], fadeV);
    addTube('lbb_post', G.lbb_post, lbbEnd, br[1], fadeV);
    // Purkinje yelpazesi: her çizgi uyarının bağlandığı dal noktasına vardığı anda başlar, ~3 m/s (0,3 cm/ms) ilerler
    const parents = tubes.filter(t => ['rbb', 'lbb', 'lbb_ant', 'lbb_post'].includes(t.key));
    (G.purkinje || []).forEach((p, i) => {
      let best = null, bd = Infinity;
      for (const par of parents) par.pts.forEach((q, j) => { const d = Math.hypot(q[0] - p[0][0], q[1] - p[0][1], q[2] - p[0][2]); if (d < bd) { bd = d; best = { par, u: par.cum[j] / (par.cum.at(-1) || 1) }; } });
      const t0 = Math.max(pk[0] - 8, best ? best.par.t0 + best.u * (best.par.t1 - best.par.t0) : pk[0]);
      const len = p.reduce((a, q, k) => a + (k ? Math.hypot(q[0] - p[k - 1][0], q[1] - p[k - 1][1], q[2] - p[k - 1][2]) : 0), 0);
      addTube('purkinje', p, t0, Math.min(pk[1] + 5, t0 + Math.max(6, len / 0.3)), fadeV, { name: G.purkinje_names?.[i] });
    });
    // düğümler: küçük küreler; sinüs düğümü atımın başında parlar, AV düğümü gecikme boyunca uyarıyı tutar
    for (const k of ['sa', 'av']) {
      const m = new THREE.MeshBasicMaterial({ color: STYLE[k].color }); helperMats.push(m);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(G[k].r, 22, 16), m); mesh.position.copy(V(G[k].p)); mesh.renderOrder = 1;
      group.add(mesh); nodes[k] = { mesh, mat: m, base: new THREE.Color(STYLE[k].color) };
    }
    // Koch üçgeni: kesik çizgi (sinus coronarius ağzı, triküspit septal yaprakçığın tutunma yeri, Todaro tendonu)
    const K = G.koch || {};
    const kp = ['apex', 'tv', 'cs', 'eustachian', 'todaro'].filter(k => K[k]).map(k => V(K[k]));
    if (kp.length >= 3) {
      const m = new THREE.LineDashedMaterial({ color: STYLE.koch.color, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.8 }); helperMats.push(m);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(kp), m); line.computeLineDistances(); group.add(line);
    }
    // dalga malzemelerinin çıkış noktası ve ekseni
    mats.atria.uniforms.uO.value.copy(V(G.sa.p)); mats.atria.uniforms.uAxial.value = 0;
    const apex = V(G.axis.apex), base = V(G.axis.base);
    mats.vent.uniforms.uO.value.copy(apex); mats.vent.uniforms.uD.value.copy(base.clone().sub(apex).normalize()); mats.vent.uniforms.uAxial.value = 1;
    // etiketlerin gerçek noktaları
    const at = (pts, u) => { const cv = new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal'); return cv.getPointAt(u); };
    labelPts = {
      sa: V(G.sa.p), av: V(G.av.p), his: at(G.his, 0.5), rbb: at(G.rbb, 0.55), lbb: at(G.lbb, 0.6), lbb_ant: at(G.lbb_ant, 0.7), lbb_post: at(G.lbb_post, 0.65),
      purkinje: V(G.purkinje[0].at(-1)), bachmann: at(G.bachmann, 0.8), internodal: at(G.internodal[Math.min(2, G.internodal.length - 1)], 0.5),
    };
    if (kp.length >= 3) labelPts.koch = kp.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(kp.length);
    const box = new THREE.Box3(); for (const p of Object.values(labelPts)) box.expandByPoint(p);
    labelPts._c = box.getCenter(new THREE.Vector3());
  }

  // --- sahne: sekme açılınca (heart.applyTab) ---
  const S = () => sets();
  const structOf = k => D?.structures.find(s => s.key === k);
  function apply() {
    buildMats();
    const ov = model.overrides, put = (rs, m) => { for (const r of rs) ov.set(r.id, m); };
    const set = S();
    // kalbin geri kalanı (büyük damarlar, koroner sinüs, kapaklar) soluk; odacıklar dalga malzemesiyle
    put([...set.flowIds].map(id => model.items.get(id)).filter(Boolean), mats.faint);
    put(recs(['Coronary sinus']), mats.faint);   // koroner sinüs de soluk: ağzı Koch üçgeninin tabanıdır
    put(recs(['Right atrium', 'Left atrium']), mats.atria);
    put(recs(['Right ventricle', 'Left ventricle']), mats.vent);
    put([...set.papR, ...set.papL], mats.pap);
    put(recs(set.leaflets), mats.leaflet);
    const iso = new Set(set.flowIds);
    for (const r of recs(['Coronary sinus'])) iso.add(r.id);
    let layers = { vessel: 'show' };
    if (c.nerves && D) {
      const parts = D.innervation.filter(x => x.n?.length);
      // sinir sistemi yüklenemediyse beklenmez (defer zaten çalışmaz); panel "yüklenemedi" der
      if (!model.loaded.nerve) { if (!model.failed?.has('nerve')) defer('nerve', () => { if (isOn()) reapply(); }); }
      else parts.forEach((x, i) => { const rs = recs(x.n); put(rs, mats.nerve[i % mats.nerve.length]); for (const r of rs) iso.add(r.id); });
      // sinir katmanının önceki hâli: kutu kapanınca ya da başka sekmeye geçince geri verilir
      if (c.nerveWas === undefined) c.nerveWas = state.layer?.nerve ?? null;
      layers = { ...layers, nerve: 'show' };
    } else if (c.nerveWas !== undefined) { if (c.nerveWas !== null) layers.nerve = c.nerveWas; c.nerveWas = undefined; }
    state.isolate = iso; viewLayers(layers);
    if (!D) {
      labels.set([]);
      load().then(() => { if (isOn()) reapply(); }, () => { if (isOn()) refresh(); });
      return;
    }
    buildGroup();
    // sekmeye her girişte (ilk açılış ya da geri dönüş) animasyon oynar; aynı sekmede yeniden uygulamada değişmez
    if (group.parent !== root) { root.add(group); c.playing = true; c.last = performance.now(); }
    c.dirty = true; c.curStep = null; c.curSeg = null;
    setLabels();
  }
  // sekmeden ya da moddan çıkınca: yardımcılar sahneden kaldırılır, animasyon durur
  function detach() {
    if (group?.parent) group.parent.remove(group);
    c.playing = false;
    // başka bir kalp sekmesine geçilirken "Sinirler" ile açılan sinir katmanı eski hâline döner (kutu işaretli kalır)
    if (c.nerveWas !== undefined) { if (c.nerveWas !== null) viewLayers({ nerve: c.nerveWas }); c.nerveWas = undefined; }
  }
  // moddan çıkınca katmanları main.js geri yükler; "Sinirler" kapanır ki sonraki girişte sinir sistemi kendiliğinden inmesin
  function leave() { c.nerves = false; c.nerveWas = undefined; detach(); cancel(); }

  // --- zaman ---
  const stepAt = t => { let best = null; for (const s of steps) if (t >= s.t_ms[0] && t < s.t_ms[1] && (!best || s.t_ms[0] >= best.t_ms[0])) best = s; return best; };
  const segAt = t => segs.find(s => t >= s.t_ms[0] && t < s.t_ms[1]) || null;
  const curStep = () => (c.stepSel ? steps.find(s => s.key === c.stepSel) : stepAt(c.t)) || null;
  // zamanı t'ye getir (sahne, EKG imleci, liste ve metin)
  function setT(t) { c.t = ((t % BEAT) + BEAT) % BEAT; c.dirty = true; }
  function updateScene(t) {
    for (const it of tubes) {
      const u = it.mat.uniforms;
      const lit = t < it.t0 ? 0 : t < it.fade[0] ? 1 : t < it.fade[1] ? 1 - (t - it.fade[0]) / (it.fade[1] - it.fade[0]) : 0;
      const prog = clamp01((t - it.t0) / Math.max(1e-3, it.t1 - it.t0)), moving = t >= it.t0 && t < it.t1;
      u.uLit.value = lit; u.uProg.value = lit > 0 ? prog : 0; u.uHead.value = moving ? 1 : 0;
      it.head.visible = moving;
      if (moving) it.curve.getPointAt(prog, it.head.position);
    }
    const st = Object.fromEntries(steps.map(s => [s.key, s.t_ms]));
    const atr = st.atria || [10, 100], av = st.av || [50, 150], ven = st.ventricles || [180, 260], rep = st.repol || [260, 520];
    // sinüs düğümü: atımın başında parlar ve söner
    const fSa = t < 140 ? Math.exp(-t / 30) : 0;
    nodes.sa.mesh.scale.setScalar(1 + 0.7 * fSa); nodes.sa.mat.color.copy(nodes.sa.base).lerp(new THREE.Color(0xffffff), fSa * 0.8);
    // AV düğümü: gecikme boyunca uyarıyı tutar (nabız gibi atar), His'e geçince söner
    const hold = t >= av[0] && t < av[1] + 10, fAv = hold ? 0.55 + 0.35 * Math.sin((t - av[0]) / 18) ** 2 : t >= av[1] + 10 && t < av[1] + 80 ? 0.55 * (1 - (t - av[1] - 10) / 70) : 0;
    nodes.av.mesh.scale.setScalar(1 + 0.6 * fAv); nodes.av.mat.color.copy(nodes.av.base).lerp(new THREE.Color(0xffffff), fAv * 0.7);
    // kulakçıklar: cephe sinüs düğümünden dışa (yaklaşık 9 cm), AV gecikmesinden sonra söner
    const ua = mats.atria.uniforms;
    ua.uFront.value = t < atr[0] ? -1 : 9.5 * clamp01((t - atr[0]) / (atr[1] - atr[0]));
    ua.uLit.value = t < atr[0] ? 0 : t < av[1] ? 1 : t < av[1] + 100 ? 1 - (t - av[1]) / 100 : 0;
    ua.uWave.value = t >= atr[0] && t < atr[1] + 10 ? 1 : 0;
    // karıncıklar: apeksten tabana (eksen boyunca ~10 cm), ST boyunca parlak, T dalgasında (repolarizasyon) söner
    const uv = mats.vent.uniforms, Tseg = segs.find(s => s.key === 'T')?.t_ms || [360, rep[1]];
    uv.uFront.value = t < ven[0] ? -2 : -0.5 + 10.5 * clamp01((t - ven[0]) / (ven[1] - ven[0]));
    uv.uLit.value = t < ven[0] ? 0 : t < Tseg[0] ? 1 : t < Tseg[1] ? 1 - (t - Tseg[0]) / (Tseg[1] - Tseg[0]) : 0;
    uv.uWave.value = t >= ven[0] && t < ven[1] + 5 ? 1 : 0;
  }
  // kesit düzlemi: yardımcılar da kesilir (diğer parçalarla aynı düzlem)
  function syncClip() {
    const cp = model.clipPlane || null;
    if (cp === lastClip) return;
    lastClip = cp; for (const m of helperMats) { m.clippingPlanes = cp ? [cp] : null; m.needsUpdate = true; }
  }

  // --- etiketler: yapıların Latince adları, seçili olanda Almancası da ---
  function setLabels() {
    if (!D || !group) return;
    const step = curStep(), on = new Set(step ? STEP_STRUCT[step.key] || [] : []);
    const items = [];
    for (const s of D.structures) {
      const at = labelPts[s.key]; if (!at) continue;
      const d = at.clone().sub(labelPts._c); if (d.length() < 0.5) d.set(-1, 0.4, 0.3);
      const p = at.clone().addScaledVector(d.normalize(), 3.2);
      const sel = c.sel === s.key || (!c.sel && on.has(s.key));
      items.push({ text: `<i class="ldot" style="background:${hex(STYLE[s.key]?.color || 0xffffff)}"></i>${esc(s.la)}${sel ? `<br><small lang="de">${esc(s.de)}</small>` : ''}`, p, at, cls: (on.has(s.key) || c.sel === s.key ? 'on ' : '') + 'hc' });
    }
    // dar ekranda (telefon) yalnız etkin ve seçili yapıların etiketleri: on bir etiket kalbi örtüyordu
    narrow = window.innerWidth < 600;
    labels.set(narrow ? items.filter(l => /\bon\b/.test(l.cls)) : items);
  }
  // pencere telefon genişliği sınırını geçince (döndürme, yeniden boyutlandırma) etiket süzgeci yenilenir
  let narrow = null;
  stage.onResize?.(() => { if (isOn() && narrow !== null && narrow !== (window.innerWidth < 600)) setLabels(); });

  // --- her kare (heart.js onFrame): oynatma, sahne, EKG imleci ---
  function tick(now) {
    if (!group || !D) return false;
    syncClip();
    // sekme arka plandayken büyük sıçrama olmasın: bir karede en çok 250 ms
    if (c.playing) { const dt = Math.min(250, now - (c.last || now)); setT(c.t + dt * BEAT / SPEEDS[c.speed]); }
    c.last = now;
    if (!c.dirty) return false;
    c.dirty = false;
    updateScene(c.t); updateLive();
    return true;
  }
  // panelin canlı kısımları (panel yeniden çizilmeden): imleç, EKG bölümü, adım listesi, adım metni
  function updateLive() {
    const q = id => document.getElementById(id);
    const cur = q('hc-cur'); if (cur) { const x = ex(c.t).toFixed(1); cur.setAttribute('x1', x); cur.setAttribute('x2', x); }
    const dot = q('hc-dot'); if (dot && ecgY) { dot.setAttribute('cx', ex(c.t).toFixed(1)); dot.setAttribute('cy', ey(ecgY(c.t)).toFixed(1)); }
    const tm = q('hc-time'); if (tm) tm.textContent = `${Math.round(c.t)} ms`;
    q('hc-ecg')?.setAttribute('aria-valuenow', Math.round(c.t));
    const seg = segAt(c.t), sk = seg?.key || '';
    if (sk !== c.curSeg) {
      c.curSeg = sk;
      document.querySelectorAll('#hc-ecg .hc-band').forEach(b => b.classList.toggle('on', b.dataset.k === sk));
      const box = q('hc-seg'); if (box) box.innerHTML = segHTML(seg);
    }
    const step = curStep(), k = step?.key || '';
    if (k !== c.curStep) {
      c.curStep = k;
      document.querySelectorAll('.hc-steps li').forEach(li => li.classList.toggle('on', li.dataset.hcstep === k));
      const box = q('hc-live'); if (box) box.innerHTML = stepHTML(step);
      setLabels();
    }
  }

  // --- panel ---
  const badge = (t, cls = '') => (t ? `<span class="hc-badge ${cls}" lang="de">${esc(t)}</span>` : '');
  const segHTML = seg => (seg
    ? `<b lang="de">${esc(seg.de)}</b> · ${esc(seg.tr)}<br><small lang="de">${esc(seg.norm_de || '')}</small>`
    : '<b>İzoelektrik çizgi</b> · karıncıklar dinlenir ve kanla dolar; bir sonraki atım sinüs düğümünde başlar.');
  function stepHTML(s) {
    if (!s) return '<p class="htext dim">Atımlar arası dinlenme (diyastol). Bir adıma tıkla ya da EKG üzerinde sürükle.</p>';
    return `<h1 class="name" lang="la">${esc(s.la)}</h1><div class="name-de" lang="de">${esc(s.de)}</div>
      <p class="htext">${esc(s.tr)}</p>
      <table class="cnfacts">
        ${s.where_de ? `<tr><td>Yeri</td><td lang="de">${esc(s.where_de)}</td></tr>` : ''}
        ${s.rate_de ? `<tr><td>Frekans</td><td lang="de">${esc(s.rate_de)}</td></tr>` : ''}
        ${s.velocity_de ? `<tr><td>Hız</td><td lang="de">${esc(s.velocity_de)}</td></tr>` : ''}
        ${s.ecg ? `<tr><td>EKG</td><td lang="de">${esc(s.ecg)}</td></tr>` : ''}
        ${s.supply_de ? `<tr><td>Beslenme</td><td lang="de">${esc(s.supply_de)}</td></tr>` : ''}
      </table>
      ${s.tip ? `<div class="tip">${esc(s.tip)}</div>` : ''}
      ${s.clinic_tr ? `<p class="htext hc-clinic"><b>Klinik:</b> ${esc(s.clinic_tr)}</p>` : ''}`;
  }
  function ecgSVG() {
    const pts = []; for (let t = 0; t <= BEAT; t += 2) pts.push(`${ex(t).toFixed(1)},${ey(ecgY(t)).toFixed(1)}`);
    const bands = segs.map(s => `<rect class="hc-band${c.curSeg === s.key ? ' on' : ''}" data-k="${s.key}" x="${ex(s.t_ms[0]).toFixed(1)}" y="2" width="${(ex(s.t_ms[1]) - ex(s.t_ms[0])).toFixed(1)}" height="${EH - 16}"></rect>
      <text x="${((ex(s.t_ms[0]) + ex(s.t_ms[1])) / 2).toFixed(1)}" y="${EH - 3}" text-anchor="middle">${esc(s.key)}</text>`).join('');
    const x = ex(c.t).toFixed(1);
    return `<svg id="hc-ecg" viewBox="0 0 ${EW} ${EH}" role="slider" aria-label="EKG: animasyonun zamanı" aria-valuemin="0" aria-valuemax="${BEAT}" aria-valuenow="${Math.round(c.t)}">
      ${bands}<line class="hc-base" x1="${EX0}" x2="${EX0 + EXW}" y1="${EY0}" y2="${EY0}"></line>
      <polyline class="hc-trace" points="${pts.join(' ')}"></polyline>
      <line id="hc-cur" x1="${x}" x2="${x}" y1="2" y2="${EH - 14}"></line><circle id="hc-dot" r="3" cx="${x}" cy="${ey(ecgY(c.t)).toFixed(1)}"></circle></svg>`;
  }
  function html() {
    if (!D) {
      if (failed) return '<p class="htext">İleti sistemi verisi (data/conduction.json) yüklenemedi.</p><button class="qnext" data-hcr="1">Yeniden dene</button>';
      return '<p class="htext dim">İleti sistemi verisi yükleniyor…</p>';
    }
    const step = curStep(), seg = segAt(c.t);
    c.curStep = null; c.curSeg = null; c.dirty = true;   // sonraki karede etiketler ve canlı kısımlar yeni panele göre
    const sel = c.sel ? structOf(c.sel) : null;
    const inner = D.innervation;
    return `
      <div class="hc-ctl">
        <button data-hcp="1" id="hc-play" class="${c.playing ? 'active' : ''}" title="Oynat / durdur">${c.playing ? '❚❚ Durdur' : '▶ Oynat'}</button>
        <div class="seg tiny"><button data-hcs="slow" class="${c.speed === 'slow' ? 'active' : ''}" title="Bir atım yaklaşık 6 s">Yavaş</button><button data-hcs="normal" class="${c.speed === 'normal' ? 'active' : ''}" title="Bir atım yaklaşık 3 s">Normal</button></div>
        <span id="hc-time" class="hc-time">${Math.round(c.t)} ms</span>
      </div>
      <div class="hc-ecgbox">${ecgSVG()}<div id="hc-seg" class="hc-seg">${segHTML(seg)}</div></div>
      <p class="htext small">${esc(D.intro_tr)}</p>
      <div class="hc-legend">${D.structures.map(s => `<button data-hcst="${s.key}" class="${c.sel === s.key ? 'on' : ''}" title="${esc(s.de)}"><span class="sw" style="background:${hex(STYLE[s.key]?.color || 0xffffff)}"></span><span lang="la">${esc(s.la)}</span></button>`).join('')}</div>
      ${sel ? `<div class="hc-struct"><b lang="la">${esc(sel.la)}</b> · <span lang="de">${esc(sel.de)}</span><p>${esc(sel.tr)}</p><small lang="de">${esc(sel.landmarks_de || '')}</small></div>` : ''}
      <ol class="hc-steps">${steps.map(s => `<li data-hcstep="${s.key}" class="${step?.key === s.key ? 'on' : ''}"><span lang="la">${esc(s.la)}</span><small lang="de">${esc(s.de)}</small>${badge(s.rate_de?.split(' (')[0])}${badge(s.velocity_de?.split(' (')[0].replace(/, die .*$/, ''), 'v')}</li>`).join('')}</ol>
      <div id="hc-live">${stepHTML(step)}</div>
      <label class="hc-toggle"><input type="checkbox" data-hcn="1" ${c.nerves ? 'checked' : ''}> Sinirler <small>(sempatik ve parasempatik innervasyon)</small></label>
      ${c.nerves ? `<div class="hc-nerves">${inner.map((x, i) => { const col = x.n?.length ? NERVE_COL[inner.filter(y => y.n?.length).indexOf(x) % NERVE_COL.length] : null; return `<div class="cor">${col != null ? `<span class="sw" style="background:${hex(col)}"></span>` : '<span class="sw hc-nosw" title="Modelde ayrı parça yok"></span>'}<div><b lang="la">${esc(x.la)}</b><br><small lang="de">${esc(x.de)}</small><p>${esc(x.tr)}</p></div></div>`; }).join('')}
        ${model.failed?.has('nerve') ? '<p class="htext dim">Sinir sistemi yüklenemedi: yalnız metinler.</p>' : !model.loaded.nerve ? '<p class="htext dim">Sinir sistemi yükleniyor…</p>' : ''}<p class="htext dim small">Renkli olanlar modelde var (görmek için uzaklaştır); renksizler yalnız metin.</p></div>` : ''}
      <details class="clinic"><summary>Ek bilgiler (${D.extras.length})</summary>${D.extras.map(x => `<p><b lang="de">${esc(x.title_de)}</b><br>${esc(x.tr)}</p>`).join('')}</details>
      <details class="clinic"><summary>Klinik (${D.clinic.length})</summary>${D.clinic.map(x => `<p><b lang="de">${esc(x.de)}</b><br>${esc(x.tr)}</p>`).join('')}</details>
      <details class="clinic notin"><summary>Modelde olmayanlar (${D.notInModel.length})</summary>${D.notInModel.map(x => `<p lang="de">${esc(x)}</p>`).join('')}</details>`;
  }
  // panel tıklaması; true: işlendi
  function click(e) {
    const t = e.target.closest('[data-hcp],[data-hcs],[data-hcstep],[data-hcst],[data-hcn],[data-hcr]'); if (!t) return false;
    if (t.dataset.hcp) { c.playing = !c.playing; c.stepSel = null; c.last = performance.now(); refresh(); }
    else if (t.dataset.hcs) { c.speed = t.dataset.hcs; refresh(); }
    else if (t.dataset.hcstep) {
      // adıma atla ve dur: adımın aralığının %60'ı (uyarı yolun ortasında görünsün)
      const s = steps.find(x => x.key === t.dataset.hcstep);
      if (s) { c.playing = false; c.stepSel = s.key; setT(s.t_ms[0] + 0.6 * (s.t_ms[1] - s.t_ms[0])); c.curStep = null; refresh(); }
    } else if (t.dataset.hcst) { c.sel = c.sel === t.dataset.hcst ? null : t.dataset.hcst; setLabels(); refresh(); }
    else if (t.dataset.hcn) { c.nerves = !c.nerves; reapply(); }
    else if (t.dataset.hcr) { load().then(() => { if (isOn()) reapply(); }, () => {}); refresh(); }
    return true;
  }
  // EKG üzerinde tıklama ve sürükleme: animasyonu o ana getirir (durdurur)
  document.addEventListener('pointerdown', e => {
    const svg = e.target.closest?.('#hc-ecg'); if (!svg || !isOn() || !D) return;
    e.preventDefault();
    const toT = ev => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * EW; return clamp01((x - EX0) / EXW) * (BEAT - 0.5); };
    const wasPlaying = c.playing;
    c.playing = false; c.stepSel = null; setT(toT(e));
    const pb = document.getElementById('hc-play'); if (pb) { pb.textContent = '▶ Oynat'; pb.classList.remove('active'); }
    try { svg.setPointerCapture(e.pointerId); } catch { /* eski tarayıcı */ }
    const move = ev => { setT(toT(ev)); };
    const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); if (wasPlaying) refresh(); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  });

  return {
    load, cancel, facts, apply, detach, leave, tick, html, click,
    // test ve hata ayıklama için (window.__anatomi.heart.conduction)
    get data() { return D; }, get state() { return c; }, get group() { return group; },
    seek(t) { c.playing = false; c.stepSel = null; setT(t); },
  };
}
