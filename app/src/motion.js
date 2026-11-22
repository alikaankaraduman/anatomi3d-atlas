// Kol hareketi modu (anahtar: move): sol kolun kemikleri ve tek kemiğe bağlı eklem parçaları, motion-kin.js'in segment
// matrisleriyle katı cisim olarak hareket eder (klavikula ve skapula ritimle eşlik eder). Az gerilen kaslar deri
// ağırlıklarıyla (models/motion-arm.bin) CPU'da bükülerek çizilir, boy değişimine göre renklenir ve kısalınca kalınlaşır.
// Bir kasın ağı bir duruşta bozuluyorsa (eklemi saran kaslar perde gibi gerilir) kas yalnız o duruşta gizlenir ve panelde
// adıyla söylenir. Panel bütün kasların boy değişimini motion.json'daki orta çizgilerden listeler.
// Birden çok segmente tutunan eklem parçaları (bağlar, kapsüller) kol dinlenme duruşundan ayrılınca gizlenir, çünkü
// katı olarak taşınırlarsa eklemden kopmuş görünürler. Veri: public/data/motion.json (tools/motion-build.mjs üretir).
import * as THREE from 'three';
import * as K from './motion-kin.js';
import { esc } from './text.js';
import { cardHTML } from './muscles.js';

// Sürgüler: [koordinat, etiket, alt, üst, pozitif terim, negatif terim]
const GROUPS = [
  ['Schultergürtel', [['girdleElev', 'Elevation / Depression', -10, 40, 'Elevation', 'Depression'], ['girdleProt', 'Protraktion / Retraktion', -16, 25, 'Protraktion', 'Retraktion']], ['gElev', 'gDep', 'gProt', 'gRetr']],
  ['Schulter', [['elev', 'Elevation (kolu kaldırma)', 0, 180, '', ''], ['plane', 'Ebene: 0 = yana, 90 = öne, −90 = geriye', -100, 135, '', ''], ['rot', 'Innen- / Außenrotation', -70, 95, 'Innenrotation', 'Außenrotation']], ['abd', 'ante', 'retro', 'add', 'ar', 'ir']],
  ['Ellenbogen', [['elbow', 'Flexion / Extension', -10, 150, 'Flexion', 'Extension']], ['flex', 'ext']],
  ['Unterarm', [['forearm', 'Pronation / Supination', -85, 85, 'Pronation', 'Supination']], ['pro', 'sup']],
  ['Hand', [['wristFlex', 'Palmarflexion / Dorsalextension', -60, 60, 'Palmarflexion', 'Dorsalextension'], ['wristDev', 'Ulnar- / Radialabduktion', -25, 35, 'Ulnarabduktion', 'Radialabduktion']], ['palmar', 'dorsal', 'radial', 'ulnar']],
];
const SLIDERS = Object.fromEntries(GROUPS.flatMap(g => g[1]).map(s => [s[0], s]));
// Bir kas parçası, o duruşta ağı bozuluyorsa gizlenir (eklemi saran kaslarda deri ağırlıkları perde gibi gerer). Ölçü: örnek
// kenarların dinlenmeye oranı. Gizleme eşikleri HIDE, yeniden gösterme eşikleri bunların 0.8 katı (titreme olmasın diye).
// Eklemi saran kaslarda dar geçiş kuşağı bütün dönmeyi birkaç üçgene yığar. Bu kaslarda .bin ağırlıkları yerine geniş
// geçiş kullanılır: köşe, origo kemiği ile insersiyo kemiğinin ikili kuaterniyonları arasında t (0 origo, 1 insersiyo)
// boyunca yumuşak adımla karışır; kasın ortası eklemin çevresinde dönmenin yarısıyla döner (sarma). [başlangıç, bitiş]
// Yalnız denemede daha iyi sonuç veren kaslar: omzu örten deltoid ve humerus başına yakın kısa kaslar. Gövdeden ya da
// skapuladan gelen geniş kaslarda (pectoralis major, latissimus, teres major, romboidler, pectoralis minor, levator) geniş
// geçiş daha kötü sonuç verdi (2026-11-22 denemesi); onlar .bin ağırlıklarıyla kalır ve bozuldukları duruşta gizlenir.
const WIDE = Object.fromEntries([
  [[0.05, 0.95], ["Acromial part of deltoid muscle", "Scapular spinal part of deltoid muscle", "Clavicular part of deltoid muscle"]],
  [[0.1, 0.95], ["Teres minor muscle", "Coracobrachialis muscle", "Supraspinatus muscle"]],
  // dirseği saran mediyal baş ve anconeus için geniş geçiş denendi, sonuç vermedi (tam fleksiyonda yine bozuluyor)
  // iki eklemi aşan kas: [origo kemiğinden çıkış başı, sonu, insersiyo kemiğine geçiş başı, sonu], arada humerus
  [[0.02, 0.35, 0.6, 1], ["Long head of triceps brachii"]],
].flatMap(([b, ns]) => ns.map(n => [n, b])));
// Yol izleyen bükme uygulanan kaslar: köşe orta çizgiye bağlanır, uzama bütün boya yayılır (pathSkin). 2026-11-22 denemesinde
// bozulan duruş sayısını azaltanlar. Triceps mediyal başı ve pectoralis major sternokostal parçası bu yöntemle DAHA kötü
// oldu, supinator da öyle (geniş origo ya da kemiği saran yassı kas, tek orta çizgi yetmiyor): onlar .bin ağırlıklarıyla ve bozuldukları duruşta gizlenerek kalır.
const PATH = new Set(['Abductor pollicis longus', 'Extensor indicis', 'Scapular spinal part of deltoid muscle', 'Teres major muscle', 'Long head of triceps brachii', 'Anconeus muscle', 'Coracobrachialis muscle', 'Teres minor muscle',
  'Pectoralis minor muscle', 'Latissimus dorsi muscle', 'Abdominal part of pectoralis major muscle', 'Rhomboid major muscle', 'Rhomboid minor muscle', 'Levator scapulae']);
// Düz lif yöntemi: [geçişin başladığı t, bittiği t]. Kasın gövde üzerindeki bölümü (t küçük) origo kemiğinde kalır.
const LIN = {
  'Sternocostal head of pectoralis major muscle': [0.35, 1], 'Supinator': [0.1, 0.9],
};      // denendi, daha kötü ya da kazançsız: latissimus [0.6, 1], triceps mediyal başı [0.7, 1], anconeus [0.2, 0.9]
const WIDE_ON = !(typeof location !== 'undefined' && /[?&]mvwide=0/.test(location.search));   // denetim: ?mvwide=0 eski ağırlıklar
// Ölçü bu dört kası uç duruşlarda (abduksiyon / anteversiyon 170, dirsek 150) "bozuk" sayıyordu; ?mvshow=1 ile çizdirilip
// bakıldı (2026-11-23): gergin ama tutarlı görünüyorlar, bu yüzden gizlenmezler. Düzgün uzama da "iki katını aşan kenar"
// ölçüsünü tetikler; ölçü perde gibi yerel bozulmayı yakalamak içindir.
const KEEP = new Set(['Latissimus dorsi muscle', 'Sternocostal head of pectoralis major muscle', 'Medial head of triceps brachii', 'Anconeus muscle']);
const SHOW_BAD = typeof location !== 'undefined' && /[?&]mvshow=1/.test(location.search);   // denetim: bozulan kasları da çiz
const HIDE = { longShare: 0.06, max: 7, shortShare: 0.10 };   // > 2 kat uzayan kenar payı, en uzun kenar oranı, < 0.4 kat kısalan pay
const fnv = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
const PLANE_MIN = -100, PLANE_MAX = 135;   // gövdenin içinden geçen duruşlar (düzlem 180 çevresi) kapalı

export function createMotion({ stage, model, state, refresh, defer, viewLayers, endStudy, tools, glow, musclesReady }) {
  let MU = null;                         // kas kartları (muscles.json): seçilen kasın Ursprung, Ansatz, Innervation, Funktion satırları
  musclesReady?.then(m => { MU = m; }, () => {});
  let D = null, KM = null, out = null, out2 = null, failed = false;
  let active = false, enterSeq = 0;
  const pose = {};
  let segRecs = [], multi = [], moved = [], lines = [], byName = new Map();
  let mv = null, baseLen = [];           // etkin hareket ve boyların karşılaştırıldığı başlangıç
  let anim = null, drag = null, away = false, lastLive = 0;
  let skinBuf = null, skins = null, hiddenNames = [];
  let picked = null;                     // tıklanan kas (bükülen ağ kaydı)   // bükülen kas ağları (bir kez kurulur)

  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const M = new THREE.Matrix4(), IDENT = new THREE.Matrix4(), FAR = new THREE.Matrix4().makeTranslation(0, -1e5, 0);
  const handle = color => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92 }));
    h.renderOrder = 60; h.raycast = () => {}; root.add(h); return h;
  };
  const mroot = new THREE.Group(); root.add(mroot);
  const hElbow = handle(0xffa23a), hHand = handle(0x35c8f5);
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), v3 = new THREE.Vector3();

  const load = () => fetch('data/motion.json').then(r => { if (!r.ok) throw new Error('motion.json ' + r.status); return r.json(); }).then(d => {
    D = d; KM = K.createModel(d); out = K.createFk(KM); out2 = K.createFk(KM);
    // deri ağırlıkları: gelmezse mod kemiklerle çalışır, kaslar çizilmez
    return fetch(d.skin.file).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => { skinBuf = b; }, () => { skinBuf = null; });
  });

  // Az gerilen kasların bükülen ağları: konumlar motion-kin'in ikili kuaterniyon karışımıyla CPU'da hesaplanır (doğrulama
  // betiğiyle aynı işlev), normaller konum + normal noktasının taşınmasıyla bulunur. Şişme yok; renk boy değişimine göre.
  function buildSkins() {
    if (skins) return;
    skins = []; hiddenNames = [];
    const u8 = skinBuf ? new Uint8Array(skinBuf) : null, HUM = D.segments.findIndex(x => x.key === 'humerus');
    const multiIds = new Set(multi.map(x => x.id));
    for (const p of D.skin.parts) {
      const isJ = p.kind === 'joint';
      if (isJ ? !multiIds.has(p.id) : p.kind !== 'muscle') continue;      // eklem parçalarından yalnız çok kemikli olanlar
      const r = model.items.get(p.id), g = r?.geo;
      if (!u8 || !g) { if (!isJ) hiddenNames.push(r?.la || p.n); continue; }
      const pos = g.attributes.position, nor = g.attributes.normal, nv = pos.count;
      if (nv !== p.verts || fnv(pos.array) !== p.sum || p.offset + 9 * nv > u8.length) { console.warn('Kol hareketi: ağ veriyle uyuşmuyor, çizilmedi:', p.n); if (!isJ) hiddenNames.push(r.la || p.n); continue; }
      const P = new Float64Array(3 * nv), I = new Uint8Array(4 * nv), W = new Float64Array(4 * nv), N0 = new Float32Array(3 * nv);
      for (let i = 0; i < nv; i++) {
        const o = p.offset + 9 * i;
        for (let j = 0; j < 4; j++) { I[4 * i + j] = u8[o + j]; W[4 * i + j] = u8[o + 4 + j] / 255; }
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z; N0[3 * i] = nx; N0[3 * i + 1] = ny; N0[3 * i + 2] = nz;
      }
      const wd = WIDE_ON && (LIN[p.n] || WIDE[p.n]), lin = WIDE_ON && !!LIN[p.n];
      if (wd) {
        // origo ve insersiyo segmenti: uçlardaki köşelerin ağırlık oylaması
        const va = new Float64Array(64), vb = new Float64Array(64);
        for (let i = 0; i < nv; i++) { const t = u8[p.offset + 9 * i + 8] / 255; if (t > 0.1 && t < 0.9) continue; for (let j = 0; j < 4; j++) (t <= 0.1 ? va : vb)[I[4 * i + j]] += W[4 * i + j]; }
        const A = va.indexOf(Math.max(...va)), B = vb.indexOf(Math.max(...vb));
        if (A !== B) for (let i = 0; i < nv; i++) {
          const t = u8[p.offset + 9 * i + 8] / 255, sm = (lo, hi) => { const x = Math.max(0, Math.min(1, (t - lo) / (hi - lo))); return x * x * (3 - 2 * x); };
          I[4 * i + 2] = I[4 * i + 3] = 0; W[4 * i + 2] = W[4 * i + 3] = 0;
          if (wd.length === 4 && HUM >= 0) {      // origo kemiği -> humerus -> insersiyo kemiği
            const wa = 1 - sm(wd[0], wd[1]), wb = sm(wd[2], wd[3]);
            I[4 * i] = HUM; I[4 * i + 1] = A; I[4 * i + 2] = B; W[4 * i] = Math.max(0, 1 - wa - wb); W[4 * i + 1] = wa; W[4 * i + 2] = wb;
          } else { const w = sm(wd[0], wd[1]); I[4 * i] = A; I[4 * i + 1] = B; W[4 * i] = 1 - w; W[4 * i + 1] = w; }
        }
      }
      let path = null;
      const li0 = byName.get(p.n);
      if (WIDE_ON && PATH.has(p.n) && !lin && li0 !== undefined) {
        const cl = lines[li0].cl, C = cl.P, m = cl.n, cum = new Float64Array(m);
        for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(C[3 * k] - C[3 * k - 3], C[3 * k + 1] - C[3 * k - 2], C[3 * k + 2] - C[3 * k - 1]);
        const va = new Float64Array(64), vb = new Float64Array(64);
        for (let j = 0; j < 4; j++) { va[cl.I[j]] += cl.W[j]; vb[cl.I[4 * (m - 1) + j]] += cl.W[4 * (m - 1) + j]; }
        const A = va.indexOf(Math.max(...va)), B = vb.indexOf(Math.max(...vb)), S = cum[m - 1];
        if (A !== B && S > 0) {
          const U = new Float32Array(nv), O = new Float32Array(3 * nv);
          for (let i = 0; i < nv; i++) {
            const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
            let bd = Infinity, bu = 0, cx = x, cy = y, cz = z;
            for (let k = 1; k < m; k++) {
              const ax = C[3 * k - 3], ay = C[3 * k - 2], az = C[3 * k - 1], ux = C[3 * k] - ax, uy = C[3 * k + 1] - ay, uz = C[3 * k + 2] - az, l2 = ux * ux + uy * uy + uz * uz;
              const tt = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy + (z - az) * uz) / l2)) : 0;
              const qx = ax + tt * ux, qy = ay + tt * uy, qz = az + tt * uz, d = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
              if (d < bd) { bd = d; bu = (cum[k - 1] + tt * (cum[k] - cum[k - 1])) / S; cx = qx; cy = qy; cz = qz; }
            }
            U[i] = bu; O[3 * i] = x - cx; O[3 * i + 1] = y - cy; O[3 * i + 2] = z - cz;
          }
          path = { A, B, U, O, cum: new Float64Array(m) };
        }
      }
      // Şişme için: köşenin dinlenmedeki orta çizgiye en yakın noktasından uzaklık vektörü x karın profili sin(pi t)
      // (t: origo 0, insersiyo 1; uçlar yerinde kalır). Kas kısalınca köşe bu yönde dışarı itilir.
      const R = new Float32Array(3 * nv), ln = p.line || [];
      for (let i = 0; i < nv && ln.length > 1; i++) {
        const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
        let bd = Infinity, cx = x, cy = y, cz = z;
        for (let k = 1; k < ln.length; k++) {
          const a = ln[k - 1].p, b = ln[k].p, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], l2 = ux * ux + uy * uy + uz * uz;
          const tt = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * ux + (y - a[1]) * uy + (z - a[2]) * uz) / l2)) : 0;
          const qx = a[0] + tt * ux, qy = a[1] + tt * uy, qz = a[2] + tt * uz, d = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
          if (d < bd) { bd = d; cx = qx; cy = qy; cz = qz; }
        }
        const w = Math.sin(Math.PI * u8[p.offset + 9 * i + 8] / 255);
        R[3 * i] = (x - cx) * w; R[3 * i + 1] = (y - cy) * w; R[3 * i + 2] = (z - cz) * w;
      }
      const geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(new Float32Array(pos.array), 3), na = new THREE.BufferAttribute(N0.slice(), 3);
      pa.setUsage(THREE.DynamicDrawUsage); na.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa); geo.setAttribute('normal', na); geo.setAttribute('color', g.attributes.color); geo.setIndex(g.index);
      const mesh = new THREE.Mesh(geo, (r.o ? model.mat.solidOpen : model.mat.solid).clone());
      mesh.frustumCulled = false; mesh.raycast = () => {}; mroot.add(mesh);
      // bozulma ölçüsü için örnek kenarlar (en çok 400 üçgenin ikişer kenarı) ve dinlenme boyları
      const ix = g.index.array, tri = ix.length / 3, step = Math.max(1, Math.floor(tri / 400)), E = [], EL = [];
      for (let t = 0; t < tri; t += step) for (let k = 0; k < 2; k++) {
        const a = ix[3 * t + k], b = ix[3 * t + k + 1], l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
        if (l > 1e-4) { E.push(a, b); EL.push(l); }
      }
      skins.push({ joint: isJ, wide: !!wd || !!path, path, lin, mesh, pa, na, P0: pos.array, N0, R, L0: p.L0 || 0, name: p.n, la: r.la || p.n, E, EL, bad: false, a: { n: nv, P, I, W, out: null }, li: byName.get(p.n), rest: true });
    }
  }
  // Yol izleyen bükme: lineLength az önce çağrıldığı için cl.out duruştaki orta çizgidir
  function pathSkin(s, g) {
    const cl = lines[s.li].cl, C = cl.out, m = cl.n, pt = s.path, cum = pt.cum, Q = out.dq, pa = s.pa.array, na = s.na.array, N = s.N0, U = pt.U, O = pt.O;
    for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(C[3 * k] - C[3 * k - 3], C[3 * k + 1] - C[3 * k - 2], C[3 * k + 2] - C[3 * k - 1]);
    const S = cum[m - 1], a = 8 * pt.A, b = 8 * pt.B, nv = s.a.n;
    for (let v = 0; v < nv; v++) {
      const i = 3 * v, u = U[v], t = u * S;
      let k = 1; while (k < m - 1 && cum[k] < t) k++;
      const d = cum[k] - cum[k - 1], fr = d > 1e-9 ? (t - cum[k - 1]) / d : 0, j = 3 * k;
      const w = u * u * (3 - 2 * u), w0 = 1 - w;
      let rx = w0 * Q[a] + w * Q[b], ry = w0 * Q[a + 1] + w * Q[b + 1], rz = w0 * Q[a + 2] + w * Q[b + 2], rw = w0 * Q[a + 3] + w * Q[b + 3];
      const il = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1); rx *= il; ry *= il; rz *= il; rw *= il;
      const e = 1 + g * Math.sin(Math.PI * u), ox = O[i] * e, oy = O[i + 1] * e, oz = O[i + 2] * e, nx = N[i], ny = N[i + 1], nz = N[i + 2];
      let cx = ry * oz - rz * oy + rw * ox, cy = rz * ox - rx * oz + rw * oy, cz = rx * oy - ry * ox + rw * oz;
      pa[i] = C[j - 3] + fr * (C[j] - C[j - 3]) + ox + 2 * (ry * cz - rz * cy);
      pa[i + 1] = C[j - 2] + fr * (C[j + 1] - C[j - 2]) + oy + 2 * (rz * cx - rx * cz);
      pa[i + 2] = C[j - 1] + fr * (C[j + 2] - C[j - 1]) + oz + 2 * (rx * cy - ry * cx);
      cx = ry * nz - rz * ny + rw * nx; cy = rz * nx - rx * nz + rw * ny; cz = rx * ny - ry * nx + rw * nz;
      na[i] = nx + 2 * (ry * cz - rz * cy); na[i + 1] = ny + 2 * (rz * cx - rx * cz); na[i + 2] = nz + 2 * (rx * cy - ry * cx);
    }
  }
  function updateSkins() {
    if (!skins) return;
    for (const s of skins) {
      const pa = s.pa.array, na = s.na.array;
      const Lnow = s.li === undefined ? 0 : K.lineLength(out, lines[s.li].cl);
      // hacim korunumu: kalınlık çarpanı sqrt(L0 / L), 0.85 ile 1.3 arasında (L0: model duruşundaki boy)
      const g = away && Lnow > 0 && s.L0 > 0 ? Math.max(0.85, Math.min(1.3, Math.sqrt(s.L0 / Lnow))) - 1 : 0;
      if (!away) { if (!s.rest) { pa.set(s.P0); na.set(s.N0); s.rest = true; s.pa.needsUpdate = s.na.needsUpdate = true; } }
      else {
        // motion-kin'in karışım kuralı (skinLine ile aynı sonuç, ama köşe başına ayırma yapmadan): ağırlıklı ikili
        // kuaterniyonlar olduğu gibi toplanır, gerçek kısmın boyuna bölünür. Tek segmente bağlı köşe doğrudan matrisle taşınır.
        if (s.path) pathSkin(s, g); else {
        const P = s.a.P, I = s.a.I, W = s.a.W, N = s.N0, Q = out.dq, Mx = out.mats, nv = s.a.n, R = s.R;
        for (let v = 0; v < nv; v++) {
          const i = 3 * v, j = 4 * v, px = P[i] + g * R[i], py = P[i + 1] + g * R[i + 1], pz = P[i + 2] + g * R[i + 2], nx = N[i], ny = N[i + 1], nz = N[i + 2];
          if (W[j] === 1) {
            const m = 16 * I[j];
            pa[i] = Mx[m] * px + Mx[m + 4] * py + Mx[m + 8] * pz + Mx[m + 12]; pa[i + 1] = Mx[m + 1] * px + Mx[m + 5] * py + Mx[m + 9] * pz + Mx[m + 13]; pa[i + 2] = Mx[m + 2] * px + Mx[m + 6] * py + Mx[m + 10] * pz + Mx[m + 14];
            na[i] = Mx[m] * nx + Mx[m + 4] * ny + Mx[m + 8] * nz; na[i + 1] = Mx[m + 1] * nx + Mx[m + 5] * ny + Mx[m + 9] * nz; na[i + 2] = Mx[m + 2] * nx + Mx[m + 6] * ny + Mx[m + 10] * nz;
            continue;
          }
          if (s.lin) {      // düz lif: iki kemiğin taşıdığı konumların doğrusal karışımı
            const a = 16 * I[j], b = 16 * I[j + 1], wa = W[j], wb = W[j + 1];
            pa[i] = wa * (Mx[a] * px + Mx[a + 4] * py + Mx[a + 8] * pz + Mx[a + 12]) + wb * (Mx[b] * px + Mx[b + 4] * py + Mx[b + 8] * pz + Mx[b + 12]);
            pa[i + 1] = wa * (Mx[a + 1] * px + Mx[a + 5] * py + Mx[a + 9] * pz + Mx[a + 13]) + wb * (Mx[b + 1] * px + Mx[b + 5] * py + Mx[b + 9] * pz + Mx[b + 13]);
            pa[i + 2] = wa * (Mx[a + 2] * px + Mx[a + 6] * py + Mx[a + 10] * pz + Mx[a + 14]) + wb * (Mx[b + 2] * px + Mx[b + 6] * py + Mx[b + 10] * pz + Mx[b + 14]);
            const ux = wa * (Mx[a] * nx + Mx[a + 4] * ny + Mx[a + 8] * nz) + wb * (Mx[b] * nx + Mx[b + 4] * ny + Mx[b + 8] * nz);
            const uy = wa * (Mx[a + 1] * nx + Mx[a + 5] * ny + Mx[a + 9] * nz) + wb * (Mx[b + 1] * nx + Mx[b + 5] * ny + Mx[b + 9] * nz);
            const uz = wa * (Mx[a + 2] * nx + Mx[a + 6] * ny + Mx[a + 10] * nz) + wb * (Mx[b + 2] * nx + Mx[b + 6] * ny + Mx[b + 10] * nz);
            const ul = Math.hypot(ux, uy, uz) || 1;
            na[i] = ux / ul; na[i + 1] = uy / ul; na[i + 2] = uz / ul;
            continue;
          }
          let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0;
          for (let k = 0; k < 4; k++) {
            const w = W[j + k]; if (!w) continue;
            const q = 8 * I[j + k];
            rx += w * Q[q]; ry += w * Q[q + 1]; rz += w * Q[q + 2]; rw += w * Q[q + 3]; dx += w * Q[q + 4]; dy += w * Q[q + 5]; dz += w * Q[q + 6]; dw += w * Q[q + 7];
          }
          const il = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1);
          rx *= il; ry *= il; rz *= il; rw *= il; dx *= il; dy *= il; dz *= il; dw *= il;
          // p' = p + 2 r x (r x p + rw p) + 2 (rw d - dw r + r x d)
          let cx = ry * pz - rz * py + rw * px, cy = rz * px - rx * pz + rw * py, cz = rx * py - ry * px + rw * pz;
          pa[i] = px + 2 * (ry * cz - rz * cy + rw * dx - dw * rx + ry * dz - rz * dy);
          pa[i + 1] = py + 2 * (rz * cx - rx * cz + rw * dy - dw * ry + rz * dx - rx * dz);
          pa[i + 2] = pz + 2 * (rx * cy - ry * cx + rw * dz - dw * rz + rx * dy - ry * dx);
          cx = ry * nz - rz * ny + rw * nx; cy = rz * nx - rx * nz + rw * ny; cz = rx * ny - ry * nx + rw * nz;
          na[i] = nx + 2 * (ry * cz - rz * cy); na[i + 1] = ny + 2 * (rz * cx - rx * cz); na[i + 2] = nz + 2 * (rx * cy - ry * cx);
        }
        }
        s.rest = false; s.pa.needsUpdate = s.na.needsUpdate = true;
      }
      // bu duruşta ağ bozuluyor mu? (dinlenmede hiçbir kas gizlenmez)
      if (!away) s.bad = false;
      else {
        const E = s.E, EL = s.EL, ne = EL.length; let lo = 0, sh = 0, mx = 0;
        for (let e = 0; e < ne; e++) {
          const a = 3 * E[2 * e], b = 3 * E[2 * e + 1], q = Math.hypot(pa[a] - pa[b], pa[a + 1] - pa[b + 1], pa[a + 2] - pa[b + 2]) / EL[e];
          if (q > 2) lo++; else if (q < 0.4) sh++;
          if (q > mx) mx = q;
        }
        const k = s.bad ? 0.8 : 1;
        s.bad = ne > 0 && !KEEP.has(s.name) && (lo / ne > HIDE.longShare * k || mx > HIDE.max * k || sh / ne > HIDE.shortShare * k);
      }
      s.mesh.visible = s.joint ? away && !s.bad : !s.bad || SHOW_BAD;
      // renk: kısalan sıcak, uzayan soğuk; % 2 içinde nötr, % 25'te tam
      const L0 = s.li === undefined ? 0 : baseLen[s.li], d = L0 > 0 ? (Lnow - L0) / L0 : 0;
      const k = Math.abs(d) < 0.02 || s.joint ? 0 : Math.min(1, Math.abs(d) / 0.3), c = s.mesh.material.color;
      const e = s.mesh.material.emissive;      // kas zaten kırmızı: çarpan tek başına görünmez, hafif ışıma eklenir
      if (d < 0) { c.setRGB(1, 1 - 0.2 * k, 1 - 0.5 * k); e.setRGB(0.36 * k, 0.17 * k, 0); } else { c.setRGB(1 - 0.5 * k, 1 - 0.25 * k, 1); e.setRGB(0, 0.11 * k, 0.36 * k); }
      if (s === picked) e.setRGB(e.r + 0.26, e.g + 0.26, e.b + 0.26);      // seçili kas parlar
    }
  }

  // Boy okuması için çizgi düzeltmesi: trapezius alt parçasının çizgisi skapulayla yana taşınan bir noktada bitiyordu ve
  // abduksiyonda uzuyor görünüyordu; gerçek insersiyo spina scapulae'nin köküdür (joints.scapula.ts).
  function fixLine(p) {
    const ts = D.joints.scapula?.ts;
    if (p.n === 'Ascending part of trapezius muscle' && ts) return [p.line[0], { p: ts, w: [['scapula', 1]] }];
    return p.line;
  }
  // Parça kayıtları: segment başına kemikler ve tek segmentli eklem parçaları; çok segmentli eklem parçaları ayrı
  function build() {
    const get = id => { const r = model.items.get(id); return r && r.mesh ? r : null; };
    const bySeg = new Map();
    D.segments.forEach((s, i) => { if (s.parent && s.ids?.length) bySeg.set(s.key, [i, s.ids.map(get).filter(Boolean)]); });
    multi = [];
    for (const p of D.skin.parts) {
      if (p.kind !== 'joint') continue;
      const r = get(p.id); if (!r) continue;
      const chain = (p.chain || []).filter(k => bySeg.has(k) || k === 'thorax');
      if (chain.length === 1) { if (bySeg.has(chain[0])) bySeg.get(chain[0])[1].push(r); } else multi.push(r);
    }
    segRecs = [...bySeg.values()];
    moved = [...segRecs.flatMap(x => x[1]), ...multi];
    lines = D.skin.parts.filter(p => p.kind === 'muscle' && p.line?.length > 1).map(p => {
      const r = model.items.get(p.id);
      return { n: p.n, la: r?.la || p.n, de: r?.de || '', cl: K.compileLine(KM, fixLine(p)) };
    });
    byName = new Map(lines.map((l, i) => [l.n, i]));
  }
  const setRec = (r, m) => { r.mesh.matrix.copy(m); r.mesh.matrixWorld.copy(m); if (r.batch) r.batch.setMatrixAt(r.inst, m); };

  // Bilinen kötü duruşları kapat: kol gövdenin önünden / arkasından içeri girmesin
  function guard(q) {
    if (q.elev > 2) { const p = K.wrap180(q.plane); q.plane = p > PLANE_MAX ? PLANE_MAX : p < PLANE_MIN ? PLANE_MIN : p; }
    return K.clampPose(KM, q, q);
  }
  function applyPose() {
    guard(pose);
    K.fk(KM, pose, out);
    for (const [i, recs] of segRecs) { M.fromArray(out.mats, 16 * i); for (const r of recs) setRec(r, M); }
    const aw = K.poseDistance(KM, pose, KM.rest) > 0.5;
    if (aw !== away) { away = aw; for (const r of multi) setRec(r, aw ? FAR : IDENT); }
    hElbow.position.fromArray(out.pts.elbow); hHand.position.fromArray(out.pts.wrist);
    updateSkins();
    glow.syncMatrices();
    stage.requestRender();
  }
  const lengthsAt = q => { K.fk(KM, K.clampPose(KM, q, {}), out2); return lines.map(l => K.lineLength(out2, l.cl)); };
  const neutral = () => K.clampPose(KM, K.neutralPose(), {});
  function setBase(q) { baseLen = lengthsAt(q || KM.rest); if (active) { K.fk(KM, pose, out); updateSkins(); stage.requestRender(); } }

  // Hareketin başı ve sonu: öbür koordinatlar şimdiki duruştan kalır; rotasyon dirsek bükülüyken görünür
  function movePoses(m) {
    const from = { ...(m.from || (m.set.elev !== undefined ? { plane: m.set.plane, elev: 0 } : {})) };
    if ((m.key === 'ar' || m.key === 'ir') && pose.elbow < 45) from.elbow = 90;
    if (m.key === 'retro') { from.plane = 90; from.elev = 60; }      // retroversiyon öne kaldırılmış koldan başlar (latissimus, teres major)
    const a = guard({ ...pose, ...from }), b = guard({ ...a, ...m.set });
    return [a, b];
  }
  function play(m) {
    const [a, b] = movePoses(m), cur = { ...pose };
    mv = m; setBase(a);
    anim = { segs: [[cur, a, Math.min(700, 12 * K.poseDistance(KM, cur, a))], [a, b, 1700]], i: 0, t0: 0 };
  }

  // ---- panel ----
  const deg = v => Math.round(v) + '°';
  const valText = c => {
    const s = SLIDERS[c], v = Math.round(pose[c]);
    return s[4] ? (v >= 0 ? s[4] : s[5]) + ' ' + Math.abs(v) + '°' : v + '°';
  };
  function readHTML() {
    const r = K.readout(KM, pose), s = r.shoulder, t = x => esc(x.de) + ' ' + deg(x.abs);
    return `<b>Schulter:</b> ${esc(s.de)} ${deg(s.elev)} <span class="mv-dim">(glenohumeral ${deg(s.gh)}, Skapula ${deg(s.scap)})</span>, ${t(s.rot)}<br>`
      + `<b>Schultergürtel:</b> ${t(r.girdle.elev)}, ${t(r.girdle.prot)}<br>`
      + `<b>Ellenbogen:</b> ${t(r.elbow)} · <b>Unterarm:</b> ${t(r.forearm)}<br>`
      + `<b>Hand:</b> ${t(r.wrist.flex)}, ${t(r.wrist.dev)}`;
  }
  const pct = d => (Math.abs(d) < 0.005 ? '0 %' : (d > 0 ? '+' : '−') + Math.abs(d * 100).toFixed(0) + ' %');
  const mrow = (l, d) => `<li><span lang="la">${esc(l.la)}</span>${l.de ? `<small lang="de">${esc(l.de)}</small>` : ''}<b class="${d < 0 ? 'mv-sh' : 'mv-lo'}">${pct(d)}</b></li>`;
  function listsHTML() {
    const ch = lines.map((l, i) => ({ l, d: baseLen[i] > 0 ? (K.lineLength(out, l.cl) - baseLen[i]) / baseLen[i] : 0 }));
    const sh = ch.filter(x => x.d <= -0.02).sort((a, b) => a.d - b.d).slice(0, 6), lo = ch.filter(x => x.d >= 0.02).sort((a, b) => b.d - a.d).slice(0, 4);
    let h = `<p class="mv-base">Boylar şuna göre: ${mv ? '<b lang="de">' + esc(mv.de) + '</b> hareketinin başlangıcı' : 'model duruşu (modun açıldığı duruş)'}</p>`;
    h += `<h4>En çok kısalan kaslar</h4>${sh.length ? `<ul class="mv-list">${sh.map(x => mrow(x.l, x.d)).join('')}</ul>` : '<p class="mv-dim">Belirgin kısalan kas yok (eşik % 2).</p>'}`;
    h += `<h4>Uzayan kaslar</h4>${lo.length ? `<ul class="mv-list">${lo.map(x => mrow(x.l, x.d)).join('')}</ul>` : '<p class="mv-dim">Belirgin uzayan kas yok.</p>'}`;
    if (mv?.textbook?.length) {
      h += `<h4>Ders kitabına göre ana kaslar: <span lang="de">${esc(mv.de)}</span></h4><ul class="mv-list">${mv.textbook.map(n => {
        const i = byName.get(n), x = i === undefined ? null : ch[i];
        if (!x) return `<li><span>${esc(n)}</span><b class="mv-dim">–</b></li>`;
        const ok = x.d <= -0.02;
        return `<li><span lang="la">${esc(x.l.la)}</span><small>${ok ? 'modelde de kısalıyor' : 'modelde kısalmıyor (düz çizgi yaklaşımı)'}</small><b class="${ok ? 'mv-sh' : 'mv-dim'}">${pct(x.d)}</b></li>`;
      }).join('')}</ul>`;
    } else if (mv) h += '<p class="mv-dim">Bu hareket için ders kitabı kas listesi yok.</p>';
    return h;
  }
  // Bu duruşta gizlenen kaslar: eklemi sardıkları için bugünkü bükme yöntemiyle perde gibi geriliyorlar
  function hiddenHTML() {
    const h = (skins || []).filter(x => x.bad && !x.joint).map(x => x.la).concat(hiddenNames);
    return h.length ? `Bu duruşta çizilemeyen kaslar (${h.length}): <span lang="la">${h.map(esc).join(', ')}</span>. Eklemi sardıkları için bugünkü yöntemle bozuluyorlar; boy değişimleri yine listelerde.` : 'Bu duruşta bütün kol kasları çiziliyor.';
  }
  // Tıklanan kas: bükülmüş ağlar ışınla sınanır (yalnız tıklamada; ağın sınır küresi o an yeniden hesaplanır)
  function pickMuscle(x, y, id) {
    if (!skins) return;
    const rect = stage.canvas.getBoundingClientRect(), hits = [];
    v2.set((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v2, stage.camera);
    let best = null, bd = Infinity;
    for (const s of skins) {
      if (s.joint || !s.mesh.visible) continue;
      s.mesh.geometry.computeBoundingSphere(); s.mesh.updateMatrixWorld(); hits.length = 0;
      THREE.Mesh.prototype.raycast.call(s.mesh, ray, hits);
      for (const h of hits) if (h.distance < bd) { bd = h.distance; best = s; }
    }
    // tıklanan yerde atlasın bir parçası (kemik, bağ) kastan belirgin biçimde öndeyse kas seçilmez
    const front = id && model.items.get(id)?.mesh;
    if (best && front) { hits.length = 0; front.raycast(ray, hits); for (const h of hits) if (h.distance < bd - 0.3) { best = null; break; } }
    if (!best && front) return;
    picked = best === picked ? null : best;      // aynı kasa ikinci tıklama seçimi kaldırır
    K.fk(KM, pose, out); updateSkins(); stage.requestRender(); live(true);
  }
  function pickHTML() {
    if (!picked) return '<p class="mv-dim">Bir kasa tıkla: adı ve boy değişimi burada görünür.</p>';
    const l = picked.li === undefined ? null : lines[picked.li], L0 = l ? baseLen[picked.li] : 0, d = L0 > 0 ? (K.lineLength(out, l.cl) - L0) / L0 : 0;
    return `<p class="mv-picked"><b lang="la">${esc(picked.la)}</b>${l?.de ? ` <small lang="de">${esc(l.de)}</small>` : ''}<br>Boy değişimi: <b class="${d < 0 ? 'mv-sh' : 'mv-lo'}">${pct(d)}</b>${picked.bad ? ' · bu duruşta çizilemiyor' : ''}</p>${MU?.muscles?.[picked.name] ? cardHTML([MU.muscles[picked.name]]) : ''}`;
  }
  function panelHTML() {
    if (!D) return '<p class="htext">Kol hareketi modu yükleniyor…</p>';
    const mvBy = new Map(D.movements.map(m => [m.key, m]));
    const groups = GROUPS.map(([title, sl, keys]) => `<div class="mv-g"><h4 lang="de">${title}</h4>${sl.map(s =>
      `<label class="mv-s"><span lang="de">${esc(s[1])}</span><output id="mv-o-${s[0]}">${valText(s[0])}</output><input type="range" data-mvc="${s[0]}" min="${s[2]}" max="${s[3]}" step="1" value="${Math.round(pose[s[0]])}"></label>`).join('')}
      <div class="mv-plays">${keys.map(k => mvBy.get(k)).filter(Boolean).map(m => `<button data-mvp="${m.key}" class="${mv === m ? 'active' : ''}" title="${esc(m.tr || '')}" lang="de">▶ ${esc(m.de)}</button>`).join('')}</div></div>`).join('');
    return `
      <div class="chips"><span class="chip loco">Kol hareketi</span><span class="chip dim">sol kol · geometrik model</span></div>
      <p class="htext">Turuncu topu (dirsek) sürükle: omuz hareket eder. Mavi topu (el) sürükle: dirsek bükülür. Ya da sürgüleri ve ▶ düğmelerini kullan.</p>
      <p class="htext mv-read" id="mv-read" lang="de">${readHTML()}</p>
      <div class="btns"><button data-mva="neutral" title="Neutral-Null sıfır duruşu">Nötr duruş</button><button data-mva="rest" title="Modelin kendi duruşu">Model duruşu</button></div>
      ${groups}
      <div id="mv-pick">${pickHTML()}</div>
      <div id="mv-lists">${listsHTML()}</div>
      <p class="htext mv-note">Geometrik bir modeldir, fizik değildir: kas boyu, origo ile insersiyo arasındaki orta çizgiden hesaplanır ve eklemi saran kaslarda yanılabilir. Çizilen kaslar kısalınca turuncuya, uzayınca maviye döner (başlangıca göre) ve kısaldıkça kalınlaşır (hacim korunumu, yaklaşık). Bağlar ve eklem kapsülleri de kolla birlikte bükülür; ağı bozulan bağ ya da kapsül o duruşta gizlenir.</p>
      ${skins?.length ? `<p class="htext mv-note" id="mv-hidden">${hiddenHTML()}</p>` : '<p class="htext mv-note">Kas ağları yüklenemedi: kaslar çizilmiyor, boy değişimleri listelerde.</p>'}
      <div class="btns"><button data-mva="exit" title="Kol hareketi modundan çık (Esc)">Moddan çık</button></div>`;
  }
  // Sürükleme ve oynatma sırasında panel yeniden kurulmaz: yalnız değişen düğümler yazılır
  function live(force) {
    const now = performance.now(); if (!force && now - lastLive < 80) return; lastLive = now;
    const rd = document.getElementById('mv-read'); if (!rd) return;
    rd.innerHTML = readHTML();
    const ls = document.getElementById('mv-lists'); if (ls) ls.innerHTML = listsHTML();
    const hd = document.getElementById('mv-hidden'); if (hd) hd.innerHTML = hiddenHTML();
    const pk = document.getElementById('mv-pick'); if (pk) pk.innerHTML = pickHTML();
    for (const c of K.COORDS) {
      const o = document.getElementById('mv-o-' + c); if (o) o.textContent = valText(c);
      const i = document.querySelector(`input[data-mvc="${c}"]`); if (i) i.value = String(Math.round(pose[c]));
    }
  }
  function click(e) {
    const t = e.target.closest('[data-mva],[data-mvp]'); if (!t) return;
    const d = t.dataset;
    if (d.mva === 'exit') { state.isolate = null; refresh(); return; }
    if (d.mva === 'neutral' || d.mva === 'rest') {
      const cur = { ...pose }, to = d.mva === 'rest' ? { ...KM.rest } : neutral();
      mv = null; setBase(); anim = { segs: [[cur, to, 600]], i: 0, t0: 0 }; refresh(); return;
    }
    if (d.mvp) { const m = D.movements.find(x => x.key === d.mvp); if (m) { play(m); refresh(); } }
  }
  document.addEventListener('input', e => {
    const c = active && e.target?.dataset?.mvc; if (!c || !SLIDERS[c]) return;
    anim = null; pose[c] = +e.target.value; applyPose(); live(true);
  });

  // ---- tutamaçlar ----
  const host = stage.canvas.parentElement || stage.canvas;
  function screenOf(h, rect) { v3.copy(h.position).project(stage.camera); return [rect.left + (v3.x + 1) / 2 * rect.width, rect.top + (1 - v3.y) / 2 * rect.height]; }
  function hitHandle(x, y, tol) {
    const rect = stage.canvas.getBoundingClientRect(); let best = null, bd = tol;
    for (const [k, h] of [['hand', hHand], ['elbow', hElbow]]) { const [sx, sy] = screenOf(h, rect), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  host.addEventListener('pointerdown', e => {
    if (!active || drag || e.button !== 0 || e.target !== stage.canvas) return;
    const h = hitHandle(e.clientX, e.clientY, e.pointerType === 'touch' ? 36 : 22); if (!h) return;
    drag = { id: e.pointerId, h, side: 'auto', x: e.clientX, y: e.clientY, dirty: false };
    anim = null; stage.controls.enabled = false;      // OrbitControls bu basışı görmez (yakalama aşaması ondan öncedir)
    try { stage.canvas.setPointerCapture(e.pointerId); } catch { /* yakalanamazsa pencere dinleyicileri yeter */ }
  }, true);
  window.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) { drag.x = e.clientX; drag.y = e.clientY; drag.dirty = true; e.preventDefault(); } }, { passive: false });
  const endDrag = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (active && drag.dirty) dragStep();      // bırakmadan önceki son konum bir kare beklemeden işlensin (hızlı sürükleme)
    drag = null; stage.controls.enabled = true; if (active) live(true);
  };
  window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
  function dragStep() {
    const rect = stage.canvas.getBoundingClientRect();
    v2.set((drag.x - rect.left) / rect.width * 2 - 1, -((drag.y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v2, stage.camera);
    try {
      if (drag.h === 'elbow') { const r = K.solveElbow(KM, pose, ray.ray, { side: drag.side, edge: 0.9 }); drag.side = r.side; Object.assign(pose, r.pose); }
      else Object.assign(pose, K.solveHand(KM, pose, ray.ray).pose);
    } catch { /* çözülemeyen ışın: duruş değişmez */ }
    applyPose(); live();
  }

  stage.onFrame(now => {
    if (!active) return false;
    let ch = false;
    if (drag?.dirty) { drag.dirty = false; dragStep(); ch = true; }
    else if (anim && !drag) {
      const sg = anim.segs[anim.i]; if (!anim.t0) anim.t0 = now;
      const t = sg[2] > 1 ? Math.min(1, (now - anim.t0) / sg[2]) : 1;
      K.lerpPose(KM, sg[0], sg[1], K.ease(t), pose);
      applyPose();
      if (t >= 1) { anim.i++; anim.t0 = 0; if (anim.i >= anim.segs.length) { anim = null; live(true); } }
      else live();
      ch = true;
    }
    // tutamaçlar ekranda hep aynı boyda görünsün
    for (const h of [hElbow, hHand]) { const s = stage.camera.position.distanceTo(h.position) * 0.007; if (Math.abs(h.scale.x - s) > 1e-4) h.scale.setScalar(s); }
    return ch;
  });

  function frame() { stage.frameBox(new THREE.Box3(new THREE.Vector3(-6, 80, -20), new THREE.Vector3(64, 186, 26)), new THREE.Vector3(0.28, 0.06, 1)); }

  function enter(spec = '') {
    for (const s of ['bone', 'joint', 'muscle']) if (!model.loaded[s]) { defer(s, () => enter(spec)); return; }
    if (!D) {
      if (failed) return;
      const seq = ++enterSeq;
      load().then(() => { if (seq === enterSeq) enter(spec); }, err => { failed = true; console.warn('Kol hareketi verisi yüklenemedi:', err); });
      return;
    }
    endStudy?.('move');
    build(); buildSkins();
    tools.cut.save(); tools.cut.set({ axis: '' }); tools.setExplode(0);
    active = true; root.visible = true; anim = null; away = false; mv = null; picked = null;
    state.selected = new Set(); state.primary = { type: 'move' };
    viewLayers({ bone: 'show', joint: 'show' });
    const ids = new Set(moved.map(r => r.id));
    for (const r of model.list) if (r.s === 'bone' && r.sub !== 'attach') ids.add(r.id);
    state.isolate = ids; state.isoGhost = null;
    Object.assign(pose, KM.rest);
    const m = D.movements.find(x => x.key === spec);
    if (m) { const [a, b] = movePoses(m); mv = m; setBase(a); Object.assign(pose, b); } else setBase();
    applyPose();
    refresh();
    frame();
  }
  function cleanup() {
    active = false; enterSeq++; anim = null; drag = null; picked = null; stage.controls.enabled = true;
    for (const r of moved) setRec(r, IDENT);
    away = false; root.visible = false;
    glow.syncMatrices();
    tools.cut.restore();
    stage.requestRender();
  }
  function sync() { if (active && state.primary?.type !== 'move') cleanup(); }

  return {
    enter, sync, panelHTML, click,
    highlight: () => [],
    // modda tıklama atlas yapısı seçmez (mod açık kalır); tıklanan yerde bükülmüş bir kas varsa o kas seçilir
    onPick: (id, x, y) => { if (!active) return false; if (x !== undefined) pickMuscle(x, y, id); return true; },
    pickAt: (x, y) => { if (!active) return false; pickMuscle(x, y); return true; },
    picked: () => picked?.name || null,
    isActive: () => active, hideTips: () => active && !!drag,
    cancelPending: () => { if (!active) enterSeq++; },
    spec: () => (mv ? mv.key : ''),
    // deneme ve denetim için: duruşu oku / yaz
    pose: () => ({ ...pose }),
    setPose(q) { if (!active) return; anim = null; Object.assign(pose, q); applyPose(); live(true); },
    // denetim: bir kasın hızlı karışımını motion-kin skinLine ile karşılaştır (en büyük fark, cm)
    skinCheck() { let m = 0; for (const x of skins || []) { x.a.out = new Float64Array(3 * x.a.n); const A = K.skinLine(out, x.a), p = x.pa.array; for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs(A[i] - p[i])); x.a.out = null; } return { joints: (skins || []).filter(x => x.joint).length, jointsHidden: (skins || []).filter(x => x.joint && x.bad).map(x => x.name), lins: (skins || []).filter(x => x.lin).length, paths: (skins || []).filter(x => x.path).map(x => x.name), wide: (skins || []).filter(x => x.wide).length, hidden: (skins || []).filter(x => x.bad && !x.joint).map(x => x.name), parts: skins?.length || 0, verts: (skins || []).reduce((t, x) => t + x.a.n, 0), maxDiff: m }; },
    handles: () => { const rect = stage.canvas.getBoundingClientRect(); return { elbow: screenOf(hElbow, rect), hand: screenOf(hHand, rect) }; },
  };
}
