// Kesit düzlemi ve dolu kesit yüzü.
//
// Düzlem sagittal (x), koronal (z) ya da aksiyal (y) olur; görünür yapıların sınırları içinde kaydırılır, yönü
// çevrilebilir. Çalışma modları (kesit atlası, sections.js) düzlemi mutlak bir yere (t.at, cm) koyabilir ve kesit
// yüzlerini seçim olmadan vurgulayabilir (t.mark); denetimleri tools.js'teki cut API'si bağlar. Düzlemin kesilen yanı hiçbir malzemede çizilmez. Kapalı ağlar kesit açıkken çift yüzlü çizilir: "Dolu"
// kapalıyken kesilen yapının içi (iç yüzeyleri ve içindeki yapılar) görünür. Tıklama, kesilen yandaki isabetleri saymaz.
//
// Dolu kesit yüzü ("Dolu", varsayılan açık): düzlemin kestiği her yapı için şablon (stencil) tamponuyla iki adım:
//  1) Yapının korunan yandaki yüzeyleri şablonu sayar; renk ve derinlik yazılmaz. Düzlemdeki nokta yapının içindeyse
//     kameradan gelen ışın yapının yüzeyini (girişlerden bir fazla çıkış, ya da tek sayıda) keser, şablon 0 kalmaz.
//     Arka yüzler 1 artırır, ön yüzler 1 azaltır (sıfır olmayan kuralı: birbirine giren bileşenler de dolu kalır).
//     Açık ağlarda (damar, bronş, mide, kalp odacıkları, mesane, uterus parçaları...) delikler önce kapak üçgenleriyle
//     kapatılır (tools/holes.mjs -> data/holes.json; aynı yönde tekrarlanmış üçgenler atılır; bir duvarın iç ve dış
//     yüzünün aynı açıklıktaki kenarları aralarında bir şeritle dikilir). Kapaklar ağın yönünü sürdürür; yüzü tutarsız
//     yönlenmiş birkaç parçada ise her yüzey şablonu tersine çevirir (tek-çift kuralı). Kalp odacıklarında (çift katlı
//     duvar, karıncıklarda dış yüzün kenarının kapağı boşluğu ortadan keser) yalnızca duvarın işaretindeki sarım dolu
//     sayılır (tek işaretli kural): duvar dolu, boşluk ve septum boş kalır.
//  2) Düzlemin üzerindeki kapak (yapının kesişim dikdörtgeni) şablonu 0 olmayan yere (tek işaretli kuralda yalnızca
//     doğru işaretli yere) yapının kesit rengini ve düzlemin derinliğini yazar; sonra şablon temizlenir.
// Her yapı ayrı sayıldığından birbirine biraz giren komşu yapılar ve içte kalan kesilmemiş yapılar kapağı delmez. İç içe
// kesilen yapılarda küçük olan (organın içinden geçen damar, beyaz cevherin içindeki çekirdek) sonra çizilip üstte kalır.
// Çizimler kapağın ekrandaki izdüşümüyle (makas dikdörtgeni) sınırlanır; ekranda 2 pikselden küçük kesit çizilmez.
// Kesit sınırları ince koyu çizgilerle (ağın üçgen-düzlem kesişimi) belirtilir; kapak üçgenleri çizgi vermez (açıklığın
// yapay sınırı, ör. dalın gövdenin içinde kalan ucu, kesitin ortasında çizgi olurdu). Kesit rengi bu çizgi boyunca
// yüzeyin rengidir: kasın tendonundan geçen kesit tendon, karnından geçen kas rengindedir. Kemiğin eklem kıkırdağı ve
// kasın aponevrozu gibi yüzey kaplamaları iç renk sayılmaz. Özel opak malzemeli parçanın (kalp modu) kesiti o renktedir.
// Dolu çizilmeyenler (kesitte içleri görünür; holes.mjs): kas fasyaları, eklem kapsülleri, tendon kılıfları (kapalılar
// da: sardıkları tendonu boyamasınlar), spinal dura, açık yaprak biçimli kas tutunma yerleri, mesane trigonu ve dış
// üretra ağzı.
import * as THREE from 'three';

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const LINE_LIFT = 0.02;           // kontur çizgileri düzlemin bu kadar önünde (cm): kesik kenardaki yüzeyle çakışmasın
const MIN_PX = 2;                 // ekranda bundan küçük kesit yüzü çizilmez
const ORDER0 = 1000;              // kesit çizimleri bütün opak çizimlerden sonra gelir

// Renkler köşe renkleriyle aynı (doğrusal, 0-255) uzayda; kaplama renkleri tools/palette.mjs'teki değerler.
const rgbKey = (r, g, b) => (r << 16) | (g << 8) | b;
const linKey = hex => { const c = new THREE.Color(hex); return rgbKey(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)); };
const COAT = { bone: linKey('#a9c6d6'), muscle: linKey('#eae2d3') };
const keyColor = (k, c) => c.setRGB(((k >> 16) & 255) / 255, ((k >> 8) & 255) / 255, (k & 255) / 255);
// parçanın varsayılan kesit rengi: kaplama dışındaki en sık köşe rengi
function baseKey(C, coat) {
  const cnt = new Map();
  for (let i = 0; i < C.length; i += 4) { const k = rgbKey(C[i], C[i + 1], C[i + 2]); cnt.set(k, (cnt.get(k) || 0) + 1); }
  let best = coat, bw = 0;
  for (const [k, w] of cnt) if (k !== coat && w > bw) { best = k; bw = w; }
  return best;
}
const SEL_COLOR = new THREE.Color(0xa6e2ff);   // seçili yapının malzemesiyle aynı ton (model.js)

// makas dikdörtgeni kapağın çizimleriyle sınırlı: ilk şablon çiziminden önce açılır, kapaktan sonra şablon temizlenip kapanır
function beginCap(renderer) { renderer.setScissor(this.userData.cap.px); renderer.setScissorTest(true); }
function endCap(renderer) { renderer.clearStencil(); renderer.setScissorTest(false); }

export function createSection({ stage, model, glow, state }) {
  const { renderer, camera } = stage;
  renderer.localClippingEnabled = true;
  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  // pos: düzlemin yeri, görünür sınırların kesri (0..1; sol paneldeki kaydırıcı); at: mutlak yer (cm, model koordinatı),
  // verildiği sürece pos'un önüne geçer (kesit atlası seviyeleri); mark: kesit yüzü seçili gibi vurgulanacak parça
  // kimlikleri (çalışma modları, state.selected'a dokunmadan)
  const t = { axis: '', pos: 0.5, at: null, flip: false, cap: true, mark: null };
  let dirty = false;

  const root = new THREE.Group(); root.visible = false; stage.scene.add(root);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x0c0d10, transparent: true, opacity: 0.85, depthWrite: false }));
  lines.frustumCulled = false; lines.matrixAutoUpdate = false; lines.renderOrder = 3;
  root.add(lines);

  const stencilMat = (side, op) => new THREE.MeshBasicMaterial({
    side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [plane],
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
  });
  const matBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
  const matFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  const matInvert = stencilMat(THREE.DoubleSide, THREE.InvertStencilOp);
  // tek işaretli kural ('ppos'): yönler ters sayılır, böylece iki işaret de "128'den büyük" (sarım -1..-127) sınamasına düşer
  const matBackDec = stencilMat(THREE.BackSide, THREE.DecrementWrapStencilOp);
  const matFrontInc = stencilMat(THREE.FrontSide, THREE.IncrementWrapStencilOp);
  const quad = new THREE.PlaneGeometry(1, 1);
  const caps = new Map();         // kayıt -> kesit yüzü nesneleri
  const proxies = new Map();      // kayıt -> delikleri kapatılmış vekil ağ (açık parçalar)
  let order = [];                 // çizilen kesit yüzleri, çizim sırasıyla (büyükten küçüğe)

  // --- açık parçaların delik kapakları: ilk dolu kesitte bir kez yüklenir ---
  // Yüklenene kadar (ya da yüklenemezse) eski davranış: kapalı ve neredeyse kapalı (meta'da c) parçalar dolu çizilir.
  let holes = null, holesReq = false;
  function loadHoles() {
    if (holesReq) return;
    holesReq = true;
    fetch('data/holes.json').then(r => (r.ok ? r.json() : null)).then(j => {
      if (j?.v !== 2 || !j.parts) return;
      holes = j.parts; dirty = true; stage.requestRender();
    }).catch(() => { /* dosya yoksa açık parçalar eski kurala göre çizilir */ });
  }
  // Dosya bu modele mi ait: köşe sayısı ve ilk köşenin konumu tutmalı (modeller yeniden dönüştürülüp holes.json
  // yenilenmediyse kimlikler kayar; aynı köşe sayılı sol/sağ eşler de konumdan ayrılır).
  function current(r, h) {
    const P = r.geo.attributes.position.array;
    return h.nv === r.geo.attributes.position.count && h.p.every((x, i) => Math.abs(P[i] - x) < 2e-3);
  }
  // Dolu çizim kuralı: 'nz' ağın kendisi, sıfır olmayan kural (kapalı ağ ya da kapağa gerek duymayan açık ağ);
  // 'pnz' kapatılmış vekil ağ, sıfır olmayan kural; 'peo' kapatılmış vekil ağ, tek-çift kuralı; 'ppos' / 'pneg'
  // kapatılmış vekil ağ, yalnızca artı / eksi sarım (arka / ön yüzler fazla) dolu; '' içi boş.
  function fillMode(r) {
    if (r.sub === 'sheath') return '';   // tendon kılıfı (kapalısı da) sardığı tendonu boyamasın
    if (!r.o) return 'nz';
    const h = holes?.[r.id];
    if (h) return !current(r, h) ? '' : !h.m ? 'peo' : h.s ? (h.s > 0 ? 'ppos' : 'pneg') : h.d || h.t.length ? 'pnz' : 'nz';
    return !holes && r.c ? 'nz' : '';
  }
  // Saydam çizilen parça kesit yüzü almaz: saydam katman ya da izole görünümdeki saydam bağlam (r.ghost) ve saydam özel
  // malzeme (model.overrides, ör. kalp modundaki odacıklar). Seçili parça opak çizildiğinden alır. Parçanın kalıcı
  // malzemesine bakılır, o anki malzemesine değil: üzerine gelinen parça anlık opaktır, imleç çekilince opak kapak kalırdı.
  function seeThrough(r) {
    if (state.selected.has(r.id)) return false;
    const ov = model.overrides?.get(r.id);
    return ov ? model.isGhostMat(ov) : r.ghost;
  }
  // Üçgenin döndürmeye göre kanonik anahtarı (tools/holes.mjs dedupe() ile aynı eşitlik): köşe sayısı nv ile sayı
  // (nv^3 < 2^53; metin anahtarlı Set büyük kaslarda ilk kesitte 50-80 ms sürüyordu), çok büyük ağda metin.
  const triKeyOf = nv => (nv < 131072
    ? (a, b, c) => (a < b && a < c ? (a * nv + b) * nv + c : b < c ? (b * nv + c) * nv + a : (c * nv + a) * nv + b)
    : (a, b, c) => (a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`));
  // Aynı köşelerden aynı yönde geçen tekrarlanmış üçgenler atılır.
  function dedupe(I, nv) {
    const key = triKeyOf(nv), seen = new Set(), out = new I.constructor(I.length); let k = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2], kk = key(a, b, c);
      if (seen.has(kk)) continue;
      seen.add(kk); out[k++] = a; out[k++] = b; out[k++] = c;
    }
    return out.subarray(0, k);
  }
  // vekil ağ: ağın (tekrarsız) üçgenleri + kapak üçgenleri; konum özniteliği paylaşılır.
  // cap0: kapak üçgenlerinin indis dizisindeki başlangıcı (tıklamada ayrıca sayılırlar, kontur çizmezler).
  function proxyOf(r) {
    let p = proxies.get(r); if (p) return p;
    const h = holes[r.id], I = h.d ? dedupe(r.geo.index.array, r.geo.attributes.position.count) : r.geo.index.array;
    const idx = new I.constructor(I.length + h.t.length);
    idx.set(I); idx.set(h.t, I.length);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', r.geo.attributes.position); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = r.geo.boundingSphere; geo.boundingBox = r.geo.boundingBox;
    p = { geo, cap0: I.length };
    proxies.set(r, p);
    return p;
  }

  const prep = (m, c) => { m.matrixAutoUpdate = false; m.frustumCulled = false; m.visible = false; m.userData.cap = c; root.add(m); };
  function capOf(r, mode) {
    let c = caps.get(r);
    if (!c) {
      const cover = new THREE.Mesh(quad, new THREE.MeshStandardMaterial({
        roughness: 0.9, metalness: 0, side: THREE.DoubleSide, depthFunc: THREE.AlwaysDepth,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      }));
      c = { r, mode: '', draws: [], cover, px: new THREE.Vector4(), corners: [0, 1, 2, 3].map(() => new THREE.Vector3()), lo: new THREE.Vector3(), hi: new THREE.Vector3(), color: new THREE.Color(), base: null, hl: '' };
      prep(cover, c); cover.onAfterRender = endCap;
      caps.set(r, c);
    }
    if (c.mode !== mode) {   // ilk kez ya da delik dosyası yüklenince kural değişti
      for (const m of c.draws) root.remove(m);
      const g = mode === 'nz' ? r.geo : proxyOf(r).geo;
      c.draws = mode === 'peo' ? [new THREE.Mesh(g, matInvert)]
        : mode === 'ppos' ? [new THREE.Mesh(g, matBackDec), new THREE.Mesh(g, matFrontInc)]
        : [new THREE.Mesh(g, matBack), new THREE.Mesh(g, matFront)];
      for (const m of c.draws) prep(m, c);
      c.draws[0].onBeforeRender = beginCap;
      // tek işaretli kuralda şablon değeri 128 < değer (sarım -1..-127, 'ppos'ta ters sayıldığından +1..+127) olan yer dolu
      const one = mode === 'ppos' || mode === 'pneg';
      c.cover.material.stencilFunc = one ? THREE.LessStencilFunc : THREE.NotEqualStencilFunc;
      c.cover.material.stencilRef = one ? 128 : 0;
      c.mode = mode;
    }
    return c;
  }
  const show = (c, vis) => { for (const m of c.draws) m.visible = vis; c.cover.visible = vis; };
  function paint(c) {
    const m = c.cover.material;
    m.color.copy(c.color); if (c.hl === 's') m.color.multiply(SEL_COLOR);
    m.emissive.setHex(c.hl === 's' ? 0x0878b0 : c.hl === 'h' ? 0xffffff : 0);
    m.emissiveIntensity = c.hl === 's' ? 0.5 : c.hl === 'h' ? 0.16 : 1;
  }

  // --- kontur, kesit rengi ve kapakların yeri (değişiklikten sonraki ilk karede bir kez) ---
  let buf = new Float32Array(6 * 16384);
  const votes = new Map(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), mid = new THREE.Vector3();
  const vote = (C, i, w) => { const k = rgbKey(C[i * 4], C[i * 4 + 1], C[i * 4 + 2]); votes.set(k, (votes.get(k) || 0) + w); };
  // kaplama kemikte hiç, kasta ancak kesit çizgisinin %85'inden fazlası tendondaysa iç renk sayılır; null: varsayılan renk
  function capKey(r) {
    const coat = COAT[r.s] ?? -1; let total = 0, best = -1, bw = 0;
    for (const [k, w] of votes) { total += w; if (k !== coat && w > bw) { best = k; bw = w; } }
    if (r.s === 'muscle' && (votes.get(coat) || 0) > 0.85 * total) return coat;
    return best < 0 ? null : best;
  }
  const ROT = { x: new THREE.Euler(0, Math.PI / 2, 0), y: new THREE.Euler(-Math.PI / 2, 0, 0), z: new THREE.Euler(0, 0, 0) };
  const PLANE_UV = { x: [2, 1], y: [0, 2], z: [0, 1] };   // kapak dörtgeninin yerel x ve y yönündeki dünya eksenleri

  function build() {
    const ax = 'xyz'.indexOf(t.axis), s = plane.normal.getComponent(ax), c0 = plane.constant, at = -s * c0;
    const [ua, va] = PLANE_UV[t.axis];
    const next = [];
    let k = 0;
    for (const r of model.list) {
      if (!r.vis || !r.mesh || !r.box || seeThrough(r)) continue;
      const T = r.mesh.matrixWorld.elements, tr = [T[12], T[13], T[14]];
      const c = c0 + s * tr[ax];
      const a0 = s * r.box.min.getComponent(ax) + c, a1 = s * r.box.max.getComponent(ax) + c;
      if ((a0 > 0 && a1 > 0) || (a0 < 0 && a1 < 0)) continue;   // sınır kutusu düzlemi kesmiyor
      const mode = fillMode(r);
      // delikleri kapatılmış açık ağda kapak üçgenleri de kesilir: kontur çizmezler ama kapak dikdörtgenine girerler
      // (dolu bölge kapağa kadar uzanır)
      const P = r.geo.attributes.position.array, C = r.geo.attributes.color.array;
      const px = mode[0] === 'p' ? proxyOf(r) : null;
      const I = px ? px.geo.index.array : r.geo.index.array, cap0 = px ? px.cap0 : I.length;
      if (k + 2 * I.length > buf.length) { const b = new Float32Array(Math.max(2 * buf.length, k + 2 * I.length)); b.set(buf.subarray(0, k)); buf = b; }
      votes.clear();
      const k0 = k, bb = [Infinity, -Infinity, Infinity, -Infinity];   // dikdörtgen: ua en küçük/büyük, va en küçük/büyük
      for (let i = 0; i < I.length; i += 3) {
        const ia = I[i], ib = I[i + 1], ie = I[i + 2];
        const da = s * P[ia * 3 + ax] + c, db = s * P[ib * 3 + ax] + c, de = s * P[ie * 3 + ax] + c;
        const pa = da >= 0, pb = db >= 0, pe = de >= 0;
        if (pa === pb && pb === pe) continue;
        // yalnız kalan köşe (öbür ikisiyle düzlemin ayrı yanında) ve ona bağlı iki kenar düzlemi keser
        let li, dl, ui, du, vi, dv;
        if (pa === pb) { li = ie; dl = de; ui = ia; du = da; vi = ib; dv = db; }
        else if (pa === pe) { li = ib; dl = db; ui = ia; du = da; vi = ie; dv = de; }
        else { li = ia; dl = da; ui = ib; du = db; vi = ie; dv = de; }
        const l = li * 3, u = ui * 3, v = vi * 3, f = dl / (dl - du), g = dl / (dl - dv);
        const x0 = P[l] + (P[u] - P[l]) * f, y0 = P[l + 1] + (P[u + 1] - P[l + 1]) * f, z0 = P[l + 2] + (P[u + 2] - P[l + 2]) * f;
        const x1 = P[l] + (P[v] - P[l]) * g, y1 = P[l + 1] + (P[v + 1] - P[l + 1]) * g, z1 = P[l + 2] + (P[v + 2] - P[l + 2]) * g;
        buf[k] = x0 + tr[0]; buf[k + 1] = y0 + tr[1]; buf[k + 2] = z0 + tr[2]; buf[k + 3] = x1 + tr[0]; buf[k + 4] = y1 + tr[1]; buf[k + 5] = z1 + tr[2];
        for (let o = k; o <= k + 3; o += 3) {
          const uu = buf[o + ua], vv = buf[o + va];
          if (uu < bb[0]) bb[0] = uu; if (uu > bb[1]) bb[1] = uu; if (vv < bb[2]) bb[2] = vv; if (vv > bb[3]) bb[3] = vv;
        }
        if (i >= cap0) continue;   // kapak üçgeni: yalnızca dikdörtgen (k ilerlemez, sonraki parça üzerine yazar)
        k += 6;
        // uçlardaki renk, kenarın iki köşesinin renginin karışımıdır
        const w = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
        vote(C, li, (2 - f - g) * w); vote(C, ui, f * w); vote(C, vi, g * w);
      }
      if (k === k0 || !mode) continue;    // kesmiyor ya da dolu çizilmeyen açık yüzey (fasya): yalnızca kontur
      // kapak: kesitin (ağ ve kapak üçgenleri) düzlemdeki sınır dikdörtgeni
      const cap = capOf(r, mode);
      cap.lo.setComponent(ua, bb[0]); cap.hi.setComponent(ua, bb[1]); cap.lo.setComponent(va, bb[2]); cap.hi.setComponent(va, bb[3]);
      cap.lo.setComponent(ax, at); cap.hi.setComponent(ax, at);
      const du2 = (cap.hi.getComponent(ua) - cap.lo.getComponent(ua)) * 1.02 + 0.02, dv2 = (cap.hi.getComponent(va) - cap.lo.getComponent(va)) * 1.02 + 0.02;
      mid.addVectors(cap.lo, cap.hi).multiplyScalar(0.5);
      cap.cover.matrix.compose(mid, q.setFromEuler(ROT[t.axis]), s3.set(du2, dv2, 1));
      for (const [j, p] of cap.corners.entries()) p.set(j & 1 ? 0.5 : -0.5, j & 2 ? 0.5 : -0.5, 0).applyMatrix4(cap.cover.matrix);
      for (const m of cap.draws) m.matrix.copy(r.mesh.matrixWorld);
      cap.area = du2 * dv2;
      // özel opak malzemeli parça (kalp modundaki koroner arterler, soluk odacıklar) o renkte; seçiliyse kendi renginde
      const ov = state.selected.has(r.id) ? null : model.overrides?.get(r.id), key = capKey(r);
      const own = ov?.userData?.capColor?.(r);
      if (own) cap.color.copy(own);
      else if (ov?.color && !model.isGhostMat(ov)) cap.color.copy(ov.color);
      else if (key === null) { if (cap.base === null) cap.base = baseKey(C, COAT[r.s] ?? -1); keyColor(cap.base, cap.color); } else keyColor(key, cap.color);
      paint(cap);
      next.push(cap);
    }
    // düzlemin kesilen yanına (kameraya doğru) az kaldır
    for (let i = ax; i < k; i += 3) buf[i] -= s * LINE_LIFT;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf.slice(0, k), 3));
    lines.geometry.dispose(); lines.geometry = geo;
    // büyükten küçüğe: iç içe kesitlerde içteki üstte kalsın
    next.sort((a, b) => b.area - a.area);
    const keep = new Set(next);
    for (const c of order) if (!keep.has(c)) show(c, false);
    next.forEach((c, i) => { c.draws.forEach((m, j) => { m.renderOrder = ORDER0 + 3 * i + j; }); c.cover.renderOrder = ORDER0 + 3 * i + 2; });
    order = next;
  }

  // Kapakların ekrandaki izdüşümü: makas dikdörtgeni; ekran dışındaki ya da çok küçük kesitler çizilmez.
  const v = new THREE.Vector3();
  function layout() {
    camera.updateMatrixWorld();
    const W = stage.size.x, H = stage.size.y;
    for (const c of order) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (const p of c.corners) {
        v.copy(p).applyMatrix4(camera.matrixWorldInverse);
        if (v.z > -1e-3) { behind = true; break; }
        v.applyMatrix4(camera.projectionMatrix);
        const x = (v.x * 0.5 + 0.5) * W, y = (v.y * 0.5 + 0.5) * H;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      let vis = true;
      if (behind) c.px.set(0, 0, W, H);
      else {
        const X0 = Math.max(0, Math.floor(x0) - 1), Y0 = Math.max(0, Math.floor(y0) - 1), X1 = Math.min(W, Math.ceil(x1) + 1), Y1 = Math.min(H, Math.ceil(y1) + 1);
        vis = X1 > X0 && Y1 > Y0 && (x1 - x0 >= MIN_PX || y1 - y0 >= MIN_PX);
        c.px.set(X0, Y0, X1 - X0, Y1 - Y0);
      }
      show(c, vis);
    }
  }
  // seçili / üzerine gelinen yapının kesit yüzü de vurgulanır
  function highlight() {
    let changed = false;
    for (const c of order) {
      const hl = state.selected.has(c.r.id) || t.mark?.has(c.r.id) ? 's' : state.hover === c.r.id ? 'h' : '';
      if (hl !== c.hl) { c.hl = hl; paint(c); changed = true; }
    }
    return changed;
  }
  // Kesit yüzleri ve çizgiler yalnızca kamera düzlemin kesilen yanındayken görünür (öbür yandan kesit görülmez).
  stage.onFrame(() => {
    const visible = !!t.axis && t.cap && plane.distanceToPoint(camera.position) < 0;
    let changed = false;
    if (root.visible !== visible) { root.visible = visible; changed = true; }
    if (!visible) return changed;
    if (dirty) { dirty = false; build(); changed = true; }
    layout();
    return highlight() || changed;
  });

  // Tıklama: imleç ışınının düzlemi kestiği nokta en üstteki (en son çizilen) hangi kesit yüzünün içindeyse o yapı.
  // İçerde mi: noktadan korunan yana doğru atılan ışının yapının yüzeyini (açık ağda kapak üçgenleri dahil) kesişleri
  // şablondaki kuralla sayılır: yönlü toplam 0 değilse (sıfır olmayan kural), yalnızca artı ya da eksiyse (tek işaretli)
  // ya da kesiş sayısı tekse (tek-çift). Arka yüze çarpış +1: şablondaki arka yüz sayımıyla aynı işaret.
  const ray0 = new THREE.Ray(), tilt = new THREE.Vector3(0.0123, 0.0071, 0.0049), hit = new THREE.Vector3();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tmp = new THREE.Vector3(), off = new THREE.Vector3();
  // ışın üçgeni hangi yönden kesiyor: +1 / -1 (yalnız işaret önemli)
  const side = (P, a, b, c, dir) => {
    ta.fromArray(P, a * 3); tb.fromArray(P, b * 3).sub(ta); tc.fromArray(P, c * 3).sub(ta);
    return tb.cross(tc).dot(dir) > 0 ? 1 : -1;
  };
  function inside(c, ray) {
    const r = c.r, geo = r.geo, P = geo.attributes.position.array, signed = c.mode !== 'peo';
    off.setFromMatrixPosition(r.mesh.matrixWorld);   // parçalarına ayırmada ağın matrisi yalnızca ötelemedir
    ray0.origin.subVectors(ray.origin, off); ray0.direction.copy(ray.direction);
    if (!geo.boundsTree) geo.computeBoundsTree();
    const seen = c.mode[0] === 'p' && holes[r.id].d ? new Set() : null, key = seen && triKeyOf(geo.attributes.position.count);
    let w = 0;
    for (const h of geo.boundsTree.raycast(ray0, THREE.DoubleSide)) {
      const { a, b, c: e } = h.face;
      if (seen) { const k = key(a, b, e); if (seen.has(k)) continue; seen.add(k); }
      w += signed ? side(P, a, b, e, ray0.direction) : 1;
    }
    if (c.mode[0] === 'p') {
      const p = proxies.get(r), I = p.geo.index.array;
      for (let i = p.cap0; i < I.length; i += 3) {
        ta.fromArray(P, I[i] * 3); tb.fromArray(P, I[i + 1] * 3); tc.fromArray(P, I[i + 2] * 3);
        if (ray0.intersectTriangle(ta, tb, tc, false, tmp)) w += signed ? side(P, I[i], I[i + 1], I[i + 2], ray0.direction) : 1;
      }
    }
    return c.mode === 'ppos' ? w > 0 : c.mode === 'pneg' ? w < 0 : signed ? w !== 0 : (w & 1) === 1;
  }
  model.capHit = ray => {
    if (!root.visible) return null;
    const d = ray.distanceToPlane(plane); if (d === null) return null;
    ray.at(d, hit);
    const [ua, va] = PLANE_UV[t.axis];
    const r1 = new THREE.Ray(hit, plane.normal.clone().add(tilt).normalize());
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i]; if (!c.cover.visible) continue;
      const u = hit.getComponent(ua), w = hit.getComponent(va);
      if (u < c.lo.getComponent(ua) || u > c.hi.getComponent(ua) || w < c.lo.getComponent(va) || w > c.hi.getComponent(va)) continue;
      if (inside(c, r1)) return { rec: c.r, distance: d, point: hit.clone() };
    }
    return null;
  };

  function apply() {
    const on = !!t.axis;
    if (on) {
      const b = model.visibleBounds(); const n = AXES[t.axis].clone();
      const lo = b.min[t.axis], hi = b.max[t.axis]; const at = Number.isFinite(t.at) ? t.at : lo + (hi - lo) * t.pos;
      // varsayılan: eksenin artı yanı kesilir (x: bedenin solu, y: üst, z: ön); çevrilince öbür yanı
      if (!t.flip) n.negate();
      plane.normal.copy(n); plane.constant = -n.dot(new THREE.Vector3().setComponent('xyz'.indexOf(t.axis), at));
    }
    // parçaya özel malzemeler (model.overrides, ör. kalp modunun renkli kapakları) de kesilir; özel bir ShaderMaterial
    // ancak kendisi kesme düzlemini destekliyorsa (clipping: true ve clipping_planes parçaları) kesilir
    const own = model.overrides ? new Set(model.overrides.values()) : [];
    for (const m of [...Object.values(model.mat), ...own, glow.matSel, glow.matHov]) { m.clippingPlanes = on ? [plane] : null; m.needsUpdate = true; }
    for (const m of [model.mat.solid, model.mat.batchSolid]) { m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }
    model.clipPlane = on ? plane : null;
    stage.clipPlane = model.clipPlane;   // ekrandaki etiketler (study.js createLabels) kesilen yandakileri gizler
    dirty = on && t.cap;
    if (dirty) loadHoles();
    stage.requestRender();
  }

  return { t, apply };
}
