// Görünüm araçları (sol paneldeki "Araçlar"): parçalarına ayırma ve kesit.
//
// Parçalarına ayır: izole görünümdeki parçalar (izole yoksa seçim modundaki sistemin görünür parçaları) ortak
// merkezlerinden dışa doğru kaydırılır: her parça, merkezinden kümenin merkezine olan uzaklığın k katı kadar uzaklaşır.
// Beyin izole edilip açılınca korteks bölgeleri dışa açılır, derindeki çekirdekler ve karıncıklar ortada görünür kalır.
// Kaydırma yalnızca dönüşümdür: hem tekil Mesh'in matrisine hem toplu ağdaki örneğin matrisine yazılır, geometri değişmez.
//
// Kesit düzlemi ve dolu kesit yüzü section.js'te; burada yalnızca denetimler bağlanır. "Dolu" seçimi tarayıcıda hatırlanır.
import * as THREE from 'three';
import { createSection } from './section.js';

const EXPLODE_K = 1.4;            // kaydırıcı sonuna gelince her parça merkezinden 1.4 kat uzaklaşır
const CAP_KEY = 'anatomi3d.cap';

export function createTools({ stage, model, glow, state }) {
  const $ = s => document.querySelector(s);
  const el = { explode: $('#explode'), explodeVal: $('#explode-val'), axis: $('#cut-axis'), row: $('#cut-row'), pos: $('#cut-pos'), flip: $('#cut-flip'), cap: $('#cut-cap') };
  const section = createSection({ stage, model, glow, state });
  const cut = section.t;
  try { cut.cap = localStorage.getItem(CAP_KEY) !== '0'; } catch { /* depolama kapalı: varsayılan açık */ }
  el.cap.checked = cut.cap;
  let explode = 0, wasIso = !!state.isolate;
  const moved = new Set();        // kaydırılmış parçalar (geri almak için)
  const M = new THREE.Matrix4();

  const setOffset = (r, x, y, z) => {
    M.makeTranslation(x, y, z);
    if (r.mesh) { r.mesh.matrix.copy(M); r.mesh.matrixWorld.copy(M); }
    if (r.batch) r.batch.setMatrixAt(r.inst, M);
  };
  function applyExplode() {
    const f = explode * EXPLODE_K;
    const set = !f ? [] : state.isolate ? model.list.filter(r => state.isolate.has(r.id) && r.mesh) : model.list.filter(r => r.vis && r.s === state.mode && r.mesh);
    const keep = new Set(set);
    for (const r of moved) if (!keep.has(r)) { setOffset(r, 0, 0, 0); moved.delete(r); }
    if (set.length) {
      const box = new THREE.Box3(); for (const r of set) if (r.box) box.union(r.box);
      const c = box.getCenter(new THREE.Vector3());
      for (const r of set) { const s = r.sphere.center; setOffset(r, (s.x - c.x) * f, (s.y - c.y) * f, (s.z - c.z) * f); moved.add(r); }
    }
    glow.syncMatrices();
    stage.requestRender();
  }

  function applyCut() {
    section.apply();
    el.row.hidden = !cut.axis;
    for (const b of el.axis.querySelectorAll('button')) b.classList.toggle('active', b.dataset.axis === cut.axis);
    el.flip.classList.toggle('active', cut.flip);
    el.cap.checked = cut.cap;
    // mutlak yerdeki düzlem: kaydırıcı görünür sınırlardaki kesrini gösterir
    if (cut.axis && Number.isFinite(cut.at)) {
      const b = model.visibleBounds(), lo = b.min[cut.axis], hi = b.max[cut.axis];
      if (hi > lo) el.pos.value = String(Math.round(1000 * Math.min(1, Math.max(0, (cut.at - lo) / (hi - lo)))));
    }
  }
  // Kullanıcı sol paneldeki kesit denetimlerinden birine dokundu; dinleyenlere (kesit atlası) ne değiştiği bildirilir:
  // 'axis' / 'pos' düzlemi taşır: mutlak yer bırakılır, kaydırıcı yeniden geçerlidir (pos, kaydırıcının o an gösterdiği yer
  // olur: düzlem sıçramasın); 'flip' yalnız korunan yanı, 'cap' yalnız dolu yüzü değiştirir, mutlak yer kalır.
  const userHooks = new Set();
  const userMoved = kind => {
    if (kind === 'axis' || kind === 'pos') { if (Number.isFinite(cut.at)) cut.pos = +el.pos.value / 1000; cut.at = null; }
    for (const f of userHooks) { try { f(kind); } catch (e) { console.error(e); } }
  };

  const label = () => { el.explodeVal.textContent = '%' + el.explode.value; };
  // kesit düzlemi görünür sınırların kesridir; sınırlar açılmayla değiştiği için düzlem de yeniden yerleştirilir
  el.explode.addEventListener('input', () => { explode = +el.explode.value / 100; label(); applyExplode(); if (cut.axis) applyCut(); });
  // fareyle sürüklemeden sonra odak kaydırıcıda kalmasın: kısayollar (I, H, F, Home) sahneye gitsin
  for (const s of [el.explode, el.pos]) s.addEventListener('pointerdown', () => window.addEventListener('pointerup', () => s.blur(), { once: true, capture: true }));
  el.axis.addEventListener('click', e => { const b = e.target.closest('button[data-axis]'); if (!b) return; userMoved('axis'); cut.axis = b.dataset.axis; applyCut(); });
  el.pos.addEventListener('input', () => { userMoved('pos'); cut.pos = +el.pos.value / 1000; applyCut(); });
  el.flip.addEventListener('click', () => { cut.flip = !cut.flip; userMoved('flip'); applyCut(); });
  el.cap.addEventListener('change', () => {
    cut.cap = el.cap.checked;
    try { localStorage.setItem(CAP_KEY, cut.cap ? '1' : '0'); } catch { /* özel pencere vb.: yalnızca bu oturum için */ }
    el.cap.blur();
    userMoved('cap');
    applyCut();
  });

  // --- çalışma modları için kesit ve açma API'si (kesit atlası, sections.js) ---
  // get(): o anki ayarlar; set({ axis, at, flip, cap }): verilen alanlar (cap burada kalıcı yazılmaz); save() / restore():
  // kullanıcının kendi kesitini sakla ve geri koy; mark(ids): kesit yüzlerini vurgula; onUser(f): kullanıcı denetimlere
  // dokununca f(kind) çağrılır, kind 'axis' | 'pos' | 'flip' | 'cap' (geri çağırmayı kaldıran işlev döner)
  let saved = null;
  const cutApi = {
    get: () => ({ axis: cut.axis, pos: cut.pos, at: cut.at, flip: cut.flip, cap: cut.cap }),
    set(o) {
      for (const k of ['axis', 'at', 'flip', 'cap', 'pos']) if (o[k] !== undefined) cut[k] = o[k];
      applyCut();
    },
    save() { saved = { ...cutApi.get(), explode: state.isolate ? 0 : explode }; },
    // izole bir görünümden gelinmişse açma geri konmaz (açılan küme o izolasyondu ve artık yok)
    restore() {
      if (!saved) return;
      const s = saved; saved = null;
      Object.assign(cut, { axis: s.axis, pos: s.pos, at: s.at, flip: s.flip, cap: s.cap, mark: null });
      el.pos.value = String(Math.round(s.pos * 1000));
      applyCut();
      setExplode(s.explode);
    },
    saved: () => !!saved,
    mark(ids) { cut.mark = ids && ids.size ? ids : null; stage.requestRender(); },
    onUser(f) { userHooks.add(f); return () => userHooks.delete(f); },
  };
  // açma oranı (0..1); izolasyon durumu da o ana göre kaydedilir: hemen ardından gelen refresh() açmayı sıfırlamasın
  function setExplode(v) {
    explode = Math.max(0, Math.min(1, v || 0));
    el.explode.value = String(Math.round(explode * 100)); label();
    wasIso = !!state.isolate;
    applyExplode();
    if (cut.axis) applyCut();
  }

  return {
    cut: cutApi,
    getExplode: () => explode,
    setExplode,
    // durum değişince (izole, görünürlük, mod) patlatma kümesini ve kesit sınırlarını yenile. İzole görünümden çıkılınca
    // açma sıfırlanır: yoksa bütün sistem beden merkezinden dağılırdı.
    refresh() {
      const iso = !!state.isolate;
      if (wasIso && !iso && explode) { explode = 0; el.explode.value = '0'; label(); applyExplode(); }
      else if (explode) applyExplode();
      wasIso = iso;
      if (cut.axis) applyCut();
    },
  };
}
