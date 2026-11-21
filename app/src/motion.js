// Kol hareketi modu (anahtar: move): sol kolun kemikleri ve tek kemiğe bağlı eklem parçaları, motion-kin.js'in segment
// matrisleriyle katı cisim olarak hareket eder (klavikula ve skapula ritimle eşlik eder). Az gerilen kaslar deri
// ağırlıklarıyla (models/motion-arm.bin) CPU'da bükülerek çizilir ve boy değişimine göre renklenir; eklemi saran, perde gibi
// gerilen kaslar (STRETCHY) çizilmez. Panel bütün kasların boy değişimini motion.json'daki orta çizgilerden listeler.
// Birden çok segmente tutunan eklem parçaları (bağlar, kapsüller) kol dinlenme duruşundan ayrılınca gizlenir, çünkü
// katı olarak taşınırlarsa eklemden kopmuş görünürler. Veri: public/data/motion.json (tools/motion-build.mjs üretir).
import * as THREE from 'three';
import * as K from './motion-kin.js';
import { esc } from './text.js';

// Sürgüler: [koordinat, etiket, alt, üst, pozitif terim, negatif terim]
const GROUPS = [
  ['Schultergürtel', [['girdleElev', 'Elevation / Depression', -10, 40, 'Elevation', 'Depression'], ['girdleProt', 'Protraktion / Retraktion', -16, 25, 'Protraktion', 'Retraktion']], ['gElev', 'gDep', 'gProt', 'gRetr']],
  ['Schulter', [['elev', 'Elevation (kolu kaldırma)', 0, 180, '', ''], ['plane', 'Ebene: 0 = yana, 90 = öne, −90 = geriye', -100, 135, '', ''], ['rot', 'Innen- / Außenrotation', -70, 95, 'Innenrotation', 'Außenrotation']], ['abd', 'ante', 'retro', 'add', 'ar', 'ir']],
  ['Ellenbogen', [['elbow', 'Flexion / Extension', -10, 150, 'Flexion', 'Extension']], ['flex', 'ext']],
  ['Unterarm', [['forearm', 'Pronation / Supination', -85, 85, 'Pronation', 'Supination']], ['pro', 'sup']],
  ['Hand', [['wristFlex', 'Palmarflexion / Dorsalextension', -60, 60, 'Palmarflexion', 'Dorsalextension'], ['wristDev', 'Ulnar- / Radialabduktion', -25, 35, 'Ulnarabduktion', 'Radialabduktion']], ['palmar', 'dorsal', 'radial', 'ulnar']],
];
const SLIDERS = Object.fromEntries(GROUPS.flatMap(g => g[1]).map(s => [s[0], s]));
// Deri ağırlıklarıyla bükülünce eklem çevresinde perde gibi gerilen kaslar (validate-2.txt bölüm c: iki katını aşan kenar
// payı % 5'ten çok ya da en uzun kenar 7 katından çok). Daha iyi bir bükme yöntemi gelene kadar ÇİZİLMEZLER.
const STRETCHY = new Set(['Teres major muscle', 'Pectoralis minor muscle', 'Rhomboid minor muscle', 'Rhomboid major muscle', 'Latissimus dorsi muscle',
  'Scapular spinal part of deltoid muscle', 'Acromial part of deltoid muscle', 'Clavicular part of deltoid muscle', 'Long head of triceps brachii', 'Supinator',
  'Sternocostal head of pectoralis major muscle', 'Abdominal part of pectoralis major muscle', 'Coracobrachialis muscle', 'Anconeus muscle', 'Teres minor muscle',
  'Extensor indicis', 'Humeral head of extensor carpi ulnaris', 'Levator scapulae', 'Medial head of triceps brachii', 'Abductor pollicis longus',
  'Supraspinatus muscle', 'Serratus anterior muscle', 'Extensor carpi radialis brevis', 'Infraspinatus muscle', 'Extensor digiti minimi']);
const fnv = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
const PLANE_MIN = -100, PLANE_MAX = 135;   // gövdenin içinden geçen duruşlar (düzlem 180 çevresi) kapalı

export function createMotion({ stage, model, state, refresh, defer, viewLayers, endStudy, tools, glow }) {
  let D = null, KM = null, out = null, out2 = null, failed = false;
  let active = false, enterSeq = 0;
  const pose = {};
  let segRecs = [], multi = [], moved = [], lines = [], byName = new Map();
  let mv = null, baseLen = [];           // etkin hareket ve boyların karşılaştırıldığı başlangıç
  let anim = null, drag = null, away = false, lastLive = 0;
  let skinBuf = null, skins = null, hiddenNames = [];   // bükülen kas ağları (bir kez kurulur)

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
    const u8 = skinBuf ? new Uint8Array(skinBuf) : null;
    for (const p of D.skin.parts) {
      if (p.kind !== 'muscle') continue;
      const r = model.items.get(p.id), g = r?.geo;
      if (STRETCHY.has(p.n) || !u8 || !g) { hiddenNames.push(r?.la || p.n); continue; }
      const pos = g.attributes.position, nor = g.attributes.normal, nv = pos.count;
      if (nv !== p.verts || fnv(pos.array) !== p.sum || p.offset + 9 * nv > u8.length) { console.warn('Kol hareketi: kas ağı veriyle uyuşmuyor, çizilmedi:', p.n); hiddenNames.push(r.la || p.n); continue; }
      const P = new Float64Array(3 * nv), I = new Uint8Array(4 * nv), W = new Float64Array(4 * nv), N0 = new Float32Array(3 * nv);
      for (let i = 0; i < nv; i++) {
        const o = p.offset + 9 * i;
        for (let j = 0; j < 4; j++) { I[4 * i + j] = u8[o + j]; W[4 * i + j] = u8[o + 4 + j] / 255; }
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z; N0[3 * i] = nx; N0[3 * i + 1] = ny; N0[3 * i + 2] = nz;
      }
      const geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(new Float32Array(pos.array), 3), na = new THREE.BufferAttribute(N0.slice(), 3);
      pa.setUsage(THREE.DynamicDrawUsage); na.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa); geo.setAttribute('normal', na); geo.setAttribute('color', g.attributes.color); geo.setIndex(g.index);
      const mesh = new THREE.Mesh(geo, (r.o ? model.mat.solidOpen : model.mat.solid).clone());
      mesh.frustumCulled = false; mesh.raycast = () => {}; mroot.add(mesh);
      skins.push({ mesh, pa, na, P0: pos.array, N0, a: { n: nv, P, I, W, out: null }, li: byName.get(p.n), rest: true });
    }
  }
  function updateSkins() {
    if (!skins) return;
    for (const s of skins) {
      const pa = s.pa.array, na = s.na.array;
      if (!away) { if (!s.rest) { pa.set(s.P0); na.set(s.N0); s.rest = true; s.pa.needsUpdate = s.na.needsUpdate = true; } }
      else {
        // motion-kin'in karışım kuralı (skinLine ile aynı sonuç, ama köşe başına ayırma yapmadan): ağırlıklı ikili
        // kuaterniyonlar olduğu gibi toplanır, gerçek kısmın boyuna bölünür. Tek segmente bağlı köşe doğrudan matrisle taşınır.
        const P = s.a.P, I = s.a.I, W = s.a.W, N = s.N0, Q = out.dq, Mx = out.mats, nv = s.a.n;
        for (let v = 0; v < nv; v++) {
          const i = 3 * v, j = 4 * v, px = P[i], py = P[i + 1], pz = P[i + 2], nx = N[i], ny = N[i + 1], nz = N[i + 2];
          if (W[j] === 1) {
            const m = 16 * I[j];
            pa[i] = Mx[m] * px + Mx[m + 4] * py + Mx[m + 8] * pz + Mx[m + 12]; pa[i + 1] = Mx[m + 1] * px + Mx[m + 5] * py + Mx[m + 9] * pz + Mx[m + 13]; pa[i + 2] = Mx[m + 2] * px + Mx[m + 6] * py + Mx[m + 10] * pz + Mx[m + 14];
            na[i] = Mx[m] * nx + Mx[m + 4] * ny + Mx[m + 8] * nz; na[i + 1] = Mx[m + 1] * nx + Mx[m + 5] * ny + Mx[m + 9] * nz; na[i + 2] = Mx[m + 2] * nx + Mx[m + 6] * ny + Mx[m + 10] * nz;
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
        s.rest = false; s.pa.needsUpdate = s.na.needsUpdate = true;
      }
      // renk: kısalan sıcak, uzayan soğuk; % 2 içinde nötr, % 25'te tam
      const L0 = s.li === undefined ? 0 : baseLen[s.li], d = L0 > 0 ? (K.lineLength(out, lines[s.li].cl) - L0) / L0 : 0;
      const k = Math.abs(d) < 0.02 ? 0 : Math.min(1, Math.abs(d) / 0.25), c = s.mesh.material.color;
      const e = s.mesh.material.emissive;      // kas zaten kırmızı: çarpan tek başına görünmez, hafif ışıma eklenir
      if (d < 0) { c.setRGB(1, 1 - 0.2 * k, 1 - 0.5 * k); e.setRGB(0.5 * k, 0.24 * k, 0); } else { c.setRGB(1 - 0.6 * k, 1 - 0.3 * k, 1); e.setRGB(0, 0.16 * k, 0.5 * k); }
    }
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
      return { n: p.n, la: r?.la || p.n, de: r?.de || '', cl: K.compileLine(KM, p.line) };
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
  function setBase(q) { baseLen = lengthsAt(q || neutral()); if (active) { K.fk(KM, pose, out); updateSkins(); stage.requestRender(); } }

  // Hareketin başı ve sonu: öbür koordinatlar şimdiki duruştan kalır; rotasyon dirsek bükülüyken görünür
  function movePoses(m) {
    const from = { ...(m.from || (m.set.elev !== undefined ? { plane: m.set.plane, elev: 0 } : {})) };
    if ((m.key === 'ar' || m.key === 'ir') && pose.elbow < 45) from.elbow = 90;
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
  const pct = d => (d > 0 ? '+' : '−') + Math.abs(d * 100).toFixed(0) + ' %';
  const mrow = (l, d) => `<li><span lang="la">${esc(l.la)}</span>${l.de ? `<small lang="de">${esc(l.de)}</small>` : ''}<b class="${d < 0 ? 'mv-sh' : 'mv-lo'}">${pct(d)}</b></li>`;
  function listsHTML() {
    const ch = lines.map((l, i) => ({ l, d: baseLen[i] > 0 ? (K.lineLength(out, l.cl) - baseLen[i]) / baseLen[i] : 0 }));
    const sh = ch.filter(x => x.d <= -0.02).sort((a, b) => a.d - b.d).slice(0, 6), lo = ch.filter(x => x.d >= 0.02).sort((a, b) => b.d - a.d).slice(0, 4);
    let h = `<p class="mv-base">Boylar şuna göre: ${mv ? '<b lang="de">' + esc(mv.de) + '</b> hareketinin başlangıcı' : 'nötr duruş (Neutral-Null)'}</p>`;
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
      <div id="mv-lists">${listsHTML()}</div>
      <p class="htext mv-note">Geometrik bir modeldir, fizik değildir: kas boyu, origo ile insersiyo arasındaki orta çizgiden hesaplanır ve eklemi saran kaslarda yanılabilir. Çizilen kaslar kısalınca turuncuya, uzayınca maviye döner (başlangıca göre); kalınlaşma henüz yok. Bağlar ve eklem kapsülleri, kol model duruşundan ayrılınca gizlenir.</p>
      ${skins?.length ? `<details class="mv-note"><summary>Henüz çizilmeyen kaslar (${hiddenNames.length})</summary><p lang="la">${hiddenNames.map(esc).join(', ')}</p><p>Bu kaslar eklemi sardıkları için bugünkü yöntemle bükülünce perde gibi geriliyor; boy değişimleri yine listelerde.</p></details>` : '<p class="htext mv-note">Kas ağları yüklenemedi: kaslar çizilmiyor, boy değişimleri listelerde.</p>'}
      <div class="btns"><button data-mva="exit" title="Kol hareketi modundan çık (Esc)">Moddan çık</button></div>`;
  }
  // Sürükleme ve oynatma sırasında panel yeniden kurulmaz: yalnız değişen düğümler yazılır
  function live(force) {
    const now = performance.now(); if (!force && now - lastLive < 80) return; lastLive = now;
    const rd = document.getElementById('mv-read'); if (!rd) return;
    rd.innerHTML = readHTML();
    const ls = document.getElementById('mv-lists'); if (ls) ls.innerHTML = listsHTML();
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
    active = true; root.visible = true; anim = null; away = false; mv = null;
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
    active = false; enterSeq++; anim = null; drag = null; stage.controls.enabled = true;
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
    onPick: () => active,                 // modda tıklama yapı seçmez (mod açık kalır)
    isActive: () => active, hideTips: () => active && !!drag,
    cancelPending: () => { if (!active) enterSeq++; },
    spec: () => (mv ? mv.key : ''),
    // deneme ve denetim için: duruşu oku / yaz
    pose: () => ({ ...pose }),
    setPose(q) { if (!active) return; anim = null; Object.assign(pose, q); applyPose(); live(true); },
    // denetim: bir kasın hızlı karışımını motion-kin skinLine ile karşılaştır (en büyük fark, cm)
    skinCheck() { let m = 0; for (const x of skins || []) { x.a.out = new Float64Array(3 * x.a.n); const A = K.skinLine(out, x.a), p = x.pa.array; for (let i = 0; i < A.length; i++) m = Math.max(m, Math.abs(A[i] - p[i])); x.a.out = null; } return { parts: skins?.length || 0, verts: (skins || []).reduce((t, x) => t + x.a.n, 0), maxDiff: m }; },
    handles: () => { const rect = stage.canvas.getBoundingClientRect(); return { elbow: screenOf(hElbow, rect), hand: screenOf(hHand, rect) }; },
  };
}
