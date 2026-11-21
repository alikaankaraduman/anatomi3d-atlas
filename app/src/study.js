// Çalışma modlarının (kalp, beyin) ortak parçaları: renkli saydam malzeme, yapı adı dizini, ekrandaki etiketler,
// akış çizgileri (tüp ve üzerinde ilerleyen damlalar) ve yapı testi.
import * as THREE from 'three';
import { titleName, subtitleName, esc } from './text.js';
import { record, weak, stats, pickWeighted, structId, factId, onChange } from './progress.js';

// Yarı saydam renkli malzeme: kenarlarda belirgin, yüzeyde hafif (hayalet katmanın renkli hâli). alpha: yüzey, edge: kenar.
// Kesit düzlemi (section.js) bunu da keser: clipping ve clipping_planes parçaları bu yüzden var.
export function tint(color, alpha = 0.05, edge = 0.5) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uBase: { value: alpha }, uEdge: { value: edge } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uBase; uniform float uEdge;
      varying vec3 vN; varying vec3 vV;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uColor, uBase + uEdge * pow(f, 2.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  m.userData.ghost = true;
  return m;
}
export const solid = (color, emissive = 0.18) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, emissive: color, emissiveIntensity: emissive });
export const hex = c => '#' + c.toString(16).padStart(6, '0');

// Ad dizini, ilk kullanımda kurulur (model.list meta yüklenince dolar). recs: adlardan çizilebilir kayıtlar (ağı yüklenmiş,
// karşı cinsiyete ait olmayan); groupRecs: aynı adlı bütün grupların (ör. sağ ve sol A. carotis interna) parçaları.
export function nameIndex(model, state) {
  let byName = null;
  const index = () => {
    if (!byName) { byName = new Map(); for (const r of model.list) { if (!byName.has(r.n)) byName.set(r.n, []); byName.get(r.n).push(r); } }
    return byName;
  };
  const recs = names => names.flatMap(n => index().get(n) || []).filter(r => r.mesh && (!r.x || r.x === state.sex));
  const groupRecs = name => {
    const out = new Set();
    for (const g of model.groups) if (g.n === name) for (const r of model.groupItems(g.i)) if (r.mesh) out.add(r);
    return [...out];
  };
  return { recs, groupRecs };
}

export const centerOf = rs => { const b = new THREE.Box3(); for (const r of rs) b.union(r.box); return b.getCenter(new THREE.Vector3()); };
// Etiket yeri: verilen noktaya (yoksa yapıların ortasına) en yakın yüzey köşesi; kıvrık yapıda orta nokta boşlukta kalır.
export function anchorOf(rs, c = centerOf(rs)) {
  let bd = Infinity, x = c.x, y = c.y, z = c.z;
  for (const r of rs) {
    const P = r.geo.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) { const d = (P[i] - c.x) ** 2 + (P[i + 1] - c.y) ** 2 + (P[i + 2] - c.z) ** 2; if (d < bd) { bd = d; x = P[i]; y = P[i + 1]; z = P[i + 2]; } }
  }
  return new THREE.Vector3(x, y, z);
}
// Parçalarına ayırma açık mı (parçaların Mesh matrisinde öteleme var mı)? Yardımcı çizgiler ve etiketler o zaman gizlenir.
export const isExploded = rs => rs.some(r => { const e = r.mesh.matrixWorld.elements; return Math.abs(e[12]) + Math.abs(e[13]) + Math.abs(e[14]) > 1e-6; });

// Ekrandaki etiketler (#labels): 3B bir noktaya bağlı küçük HTML etiketleri, her karede yeniden yerleştirilir.
// items: [{ text, p (etiketin yeri), cls ('on': etkin), at (isteğe bağlı: gösterilen gerçek nokta; etiketten oraya ince
// çizgi ve nokta), align: 'end' (etiketin sağ kenarı p'de: sola doğru sütun) }]
// Yerleşim: etiketler panellerin örtmediği alanda kalır; birbirinin üstüne binen etiket dikeyde kaydırılır (önce etkin
// olanlar yerleşir), kaydırılan etiketten kendi noktasına çizgi çekilir. hide(true): parçalarına ayırma gibi durumlarda
// gizli kalır, yeni etiket listesi de gizli başlar.
const SVG = 'http://www.w3.org/2000/svg';
export function createLabels(stage, el = document.querySelector('#labels')) {
  let list = [], svg = null, off = false;
  const v = new THREE.Vector3();
  const screen = (p, rect, cam) => {
    v.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.1) return null;
    v.applyMatrix4(cam.projectionMatrix);
    return [rect.left + (v.x * 0.5 + 0.5) * rect.width, rect.top + (-v.y * 0.5 + 0.5) * rect.height];
  };
  const lineOf = l => {
    if (!l.line) {
      l.line = document.createElementNS(SVG, 'line'); l.dot = document.createElementNS(SVG, 'circle'); l.dot.setAttribute('r', '2.6');
      if (l.on) { l.line.setAttribute('class', 'on'); l.dot.setAttribute('class', 'on'); }
      svg.append(l.line, l.dot);
    }
    return l;
  };
  return {
    set(items) {
      el.innerHTML = '';
      svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'lbl-lines'); el.appendChild(svg);
      list = items.map(({ text, p, cls = '', at = null, align = '', nudge = false }) => {
        const d = document.createElement('div'); d.className = 'lbl ' + cls; d.innerHTML = text; el.appendChild(d);
        return { el: d, p, at, nudge, end: align === 'end', on: /\bon\b/.test(cls), line: null, dot: null, w: 0, h: 0 };
      });
      el.hidden = off || !list.length;
    },
    place() {
      if (!list.length || el.hidden) return;
      const rect = stage.canvas.getBoundingClientRect(), cam = stage.camera, ins = stage.insets?.() || { l: 0, r: 0, t: 0, b: 0 };
      const L = rect.left + ins.l + 4, R = rect.right - ins.r - 4, T = rect.top + ins.t + 2, B = rect.bottom - ins.b - 2;
      cam.updateMatrixWorld();
      const placed = [], clip = stage.clipPlane || null;
      const overlaps = q => placed.some(o => q[0] < o[2] && q[2] > o[0] && q[1] < o[3] && q[3] > o[1]);
      for (const l of [...list.filter(x => x.on), ...list.filter(x => !x.on)]) {
        // kesit düzleminin kestiği (görünmeyen) yandaki etiket gizlenir: çizgili etiketlerde yapının kendi noktası (at) sayılır (section.js stage.clipPlane'i ayarlar)
        const s = clip && clip.distanceToPoint(l.at || l.p) < 0 ? null : screen(l.p, rect, cam);
        if (!s) { l.el.style.display = 'none'; if (l.line) l.line.style.display = l.dot.style.display = 'none'; continue; }
        l.el.style.display = '';
        if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        let x = s[0], y = s[1];
        // nudge: küçük yapı (lenf düğümü): etiket yapının üstüne değil, tuvalin ortasından dışa doğru yanına konur ve ince
        // bir çizgiyle bağlanır (çizgi yapıya değmeden biter, uç noktası çizilmez); yapı görünür ve tıklanır kalır
        if (l.nudge) { x += (s[0] < (L + R) / 2 ? -1 : 1) * (l.w / 2 + 9); y -= 9; }
        if (l.w) {
          const x0 = () => x - (l.end ? l.w : l.w / 2);
          if (x0() < L) x += L - x0(); else if (x0() + l.w > R) x -= x0() + l.w - R;
          y = Math.min(Math.max(y, T + l.h / 2), B - l.h / 2);
          const box = yy => [x0(), yy - l.h / 2, x0() + l.w, yy + l.h / 2];
          let yy = y;
          for (let k = 1; overlaps(box(yy)) && k <= 30; k++) yy = Math.min(Math.max(y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (l.h + 2), T + l.h / 2), B - l.h / 2);
          y = yy; placed.push(box(y));
        }
        l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${l.end ? '-100%' : '-50%'}, -50%)`;
        // çizgi: gerçek noktaya (at) ya da etiket kendi noktasından kaydırıldıysa oraya
        let t = l.at ? screen(l.at, rect, cam) : Math.hypot(x - s[0], y - s[1]) > 3 ? s : null;
        if (t && l.nudge) { const dx = x - t[0], dy = y - t[1], d = Math.hypot(dx, dy); t = d > 6 ? [t[0] + dx * 5 / d, t[1] + dy * 5 / d] : null; }
        if (t) {
          lineOf(l); l.line.style.display = ''; l.dot.style.display = l.nudge ? 'none' : '';
          l.line.setAttribute('x1', x.toFixed(1)); l.line.setAttribute('y1', y.toFixed(1)); l.line.setAttribute('x2', t[0].toFixed(1)); l.line.setAttribute('y2', t[1].toFixed(1));
          l.dot.setAttribute('cx', t[0].toFixed(1)); l.dot.setAttribute('cy', t[1].toFixed(1));
        } else if (l.line) l.line.style.display = l.dot.style.display = 'none';
      }
    },
    hide(on) { off = on; el.hidden = on || !list.length; },
  };
}

// Akış çizgileri: noktalardan geçen CatmullRom eğrileri boyunca bir tüp ve üzerinde ilerleyen damlalar.
// curves: [{ pts: Vector3[], color, tube (yarıçap), dot (damla yarıçapı), gap (damla aralığı, cm), seg (tüp bölümü),
// speed (cm/s), opacity }]
export function flowLines(curves) {
  const group = new THREE.Group(); const items = []; const spheres = new Map();
  for (const cv of curves) {
    if (!cv.pts || cv.pts.length < 2) continue;
    const { tube = 0.13, dot = 0.32, gap = 2.2, seg = 96, opacity = 1 } = cv;
    const curve = new THREE.CatmullRomCurve3(cv.pts, false, 'centripetal');
    const len = curve.getLength();
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, tube, 8, false),
      new THREE.MeshBasicMaterial({ color: cv.color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })));
    if (!spheres.has(dot)) spheres.set(dot, new THREE.SphereGeometry(dot, 12, 8));
    const n = Math.max(4, Math.round(len / gap));
    const dots = new THREE.InstancedMesh(spheres.get(dot), new THREE.MeshBasicMaterial({ color: new THREE.Color(cv.color).lerp(new THREE.Color(0xffffff), 0.25) }), n);
    dots.frustumCulled = false; group.add(dots);
    items.push({ curve, dots, n, len, speed: cv.speed });
  }
  return { group, items };
}
const _M = new THREE.Matrix4(), _v = new THREE.Vector3();
export function animateFlow(flow, now, speed = 4.5) {
  for (const it of flow.items) {
    const off = (now / 1000 * (it.speed || speed) / it.len) % 1;
    for (let i = 0; i < it.n; i++) { it.curve.getPointAt((off + i / it.n) % 1, _v); _M.makeTranslation(_v.x, _v.y, _v.z); it.dots.setMatrixAt(i, _M); }
    it.dots.instanceMatrix.needsUpdate = true;
  }
}

// Test başlığı altındaki satır: "Yanlışlarım (N)" düğmesi (attr: tıklama özniteliği), havuzun kalıcı ilerlemesi ve oturum
// puanı. st: progress.stats(havuz), score: [doğru, toplam]
export const quizBar = ({ attr, on, st, score }) => `<div class="qbar">
  <button class="qweak${on ? ' on' : ''}" ${attr}="1" aria-pressed="${on}" title="${on ? 'Bütün sorulara dön' : 'Yalnız yanlış cevapladığın ve henüz iki kez arka arkaya doğru bilmediğin sorular'}">Yanlışlarım (${st.weak})</button>
  <span class="qprog" title="Bu tarayıcıda saklanan ilerleme: bu soru havuzunda bilinen ve tekrar edilecek sorular">Bilinen ${st.known} / ${st.total} · yanlış ${st.weak}</span>
  <span class="score">Doğru ${score[0]} / ${score[1]}</span></div>`;
export const WEAK_EMPTY = '<p class="htext">Burada tekrar edilecek yanlışın yok, güzel! Bütün sorulara dönmek için «Yanlışlarım» düğmesini kapat.</p>';

export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Yapı testi. Soru türleri: "Bu yapı ne?" (yapı parlar, dört şıktan adı seçilir), "Yapıyı bul" (adı verilen yapı 3B
// görünümde tıklanır) ve bilgi soruları verilmişse "Bilgi" (metin sorusu, dört şık, kısa açıklama).
// items: [{ n: [adlar: yapının bütün parçaları], la?, de?, cat }]: aynı kategoridekiler birbirine çeldirici olur; parçaları
// örtüşen iki madde (bütün ve onun parçası) birbirine çeldirici olmaz.
// facts: [{ q, options: [doğru, ...], explain, cat, show? }]; cats: [[cat, başlık]] bilgi sorularını konuya göre süzmek için.
// visible(r): yapı o an çizilen görünümde mi (görünmeyen yapı sorulmaz, parlatılmaz, ona odaklanılmaz).
// findable(q): "Yapıyı bul" sorusu olabilir mi (ör. dışarıdan görünmeyen derin kas sorulmaz).
export function createStudyQuiz({ recs, items, facts = null, cats = null, refresh, stage, model, visible = () => true, findable = () => true, factOk = () => true }) {
  // weakOnly: "Yanlışlarım" açık, yalnız zayıf sorular sorulur (progress.js)
  const z = { mode: 'name', cur: null, score: [0, 0], cat: 'all', last: null, weakOnly: false };
  const shown = names => recs(names).filter(visible);
  const qName = q => { const r = recs(q.n)[0]; return { la: q.la || (r ? titleName(r) : q.n[0]), de: q.de !== undefined ? q.de : r ? subtitleName(r) : '' }; };
  const overlap = (a, c) => a.n.some(x => c.n.includes(x));
  // kalıcı ilerleme kimlikleri: yapı sorusu ilk parçanın model adıyla, bilgi sorusu metninin özetiyle
  const fids = new WeakMap();
  const fid = f => { if (!fids.has(f)) fids.set(f, factId(f.q)); return fids.get(f); };
  const sid = q => structId(q.n[0]);
  // o anki mod ve süzgeçlerle soru havuzu (Yanlışlarım süzgeci olmadan)
  const pool = () => z.mode === 'facts'
    ? (facts || []).filter(f => (z.cat === 'all' || f.cat === z.cat) && factOk(f))
    : items.filter(q => shown(q.n).length && (z.mode !== 'find' || findable(q)));
  const idOf = x => (z.mode === 'facts' ? fid(x) : sid(x));
  // ağırlıklı seçim (zayıf x3, sorulmamış x2, bilinen x1); aynı soru arka arkaya gelmesin
  const pickOne = list => { const x = pickWeighted(list, idOf, z.last); z.last = x; return x; };
  function next(render = true) {
    const p = pool(), cand = z.weakOnly ? p.filter(x => weak(idOf(x))) : p;
    if (z.mode === 'facts') {
      const f = cand.length ? pickOne(cand) : null;
      z.cur = f ? { f, order: shuffle(f.options.map((_, i) => i)), answer: null } : null;
    } else {
      if (p.length < 2 || !cand.length) z.cur = null;
      else {
        const q = pickOne(cand), ok = x => x !== q && !overlap(x, q);
        const same = shuffle(p.filter(x => ok(x) && x.cat === q.cat)), other = shuffle(p.filter(x => ok(x) && x.cat !== q.cat));
        z.cur = { q, opts: shuffle([q, ...[...same, ...other].slice(0, 3)]), answer: null };
      }
    }
    if (render) refresh();
  }
  // İlerleme dışarıdan değişirse (sıfırlama, başka sekme) "Yanlışlarım" açıkken bekleyen soru artık zayıf olmayabilir:
  // yenisi seçilir (çizim, ana yenilemeyle gelir)
  onChange(() => { const c = z.cur; if (z.weakOnly && c && !c.answer && !weak(z.mode === 'facts' ? fid(c.f) : sid(c.q))) next(false); });
  const score = (ok, id) => { z.score[1]++; if (ok) z.score[0]++; record(id, ok); };
  const res = (ok, bad) => `<div class="qres ${ok ? 'ok' : 'bad'}">${ok ? 'Doğru!' : bad}</div>`;
  // parlayan / odaklanılacak yapılar: "Bu yapı ne?" sorusunda sorulan yapı, "Yapıyı bul" sorusunda cevaptan sonra doğrusu,
  // bilgi sorusunda cevaptan sonra sorunun ilgili yapıları (show); yalnız görünenler
  const asked = () => {
    const c = z.cur; if (!c) return [];
    if (z.mode === 'facts') return c.answer && c.f.show ? shown(c.f.show) : [];
    return z.mode === 'name' || c.answer ? shown(c.q.n) : [];
  };
  return {
    ensure() { if (!z.cur || (z.cur.q && !shown(z.cur.q.n).length)) next(false); },
    clear() { z.cur = null; },
    // soru türünü dışarıdan ayarla (ör. başka bir sahneye geçilince tür korunsun)
    setMode(k) { if (k !== z.mode && (k !== 'facts' || facts?.length)) { z.mode = k; z.cur = null; } },
    asked,
    // o anki soru: tür, sorulan madde (bilgi sorusunda null), cevaplandı mı (modun görünümü soruya göre kurması için)
    state() { return { mode: z.mode, q: z.cur?.q || null, answered: !!z.cur?.answer }; },
    // açık bekleyen "Yapıyı bul" sorusu (yoksa null)
    findQuestion() { return z.mode === 'find' && z.cur?.q && !z.cur.answer ? z.cur.q : null; },
    // "Yapıyı bul" cevabını kaydet (doğruluğu çağıran belirler); r: tıklanan yapı
    answer(ok, r) { const c = z.cur; if (!c?.q || c.answer) return; c.answer = { ok, picked: titleName(r) }; score(ok, sid(c.q)); },
    // 3B görünümde tıklanan yapı "Yapıyı bul" sorusunun cevabı sayılır; true: panel yenilenmeli
    pick(r) {
      const q = this.findQuestion(); if (!q) return false;
      this.answer(q.n.includes(r.n), r);
      return true;
    },
    html() {
      const c = z.cur;
      const modes = [['name', 'Bu yapı ne?'], ['find', 'Yapıyı bul'], ...(facts?.length ? [['facts', 'Bilgi']] : [])];
      let body = '';
      const ids = pool().map(idOf), st = stats(ids);
      if (!c) body = z.weakOnly && ids.length && !st.weak ? WEAK_EMPTY : '<p class="htext">Bu görünümde soru yok.</p>';
      else if (z.mode === 'facts') {
        const f = c.f, a = c.answer;
        body = `<p class="htext qtext">${esc(f.q)}</p><div class="qopts">${c.order.map(i => {
          const cls = a ? (i === 0 ? 'ok' : a.pick === i ? 'bad' : '') : '';
          return `<button class="qopt ${cls}" data-zo="${i}"${a ? ' disabled' : ''}><b>${esc(f.options[i])}</b></button>`;
        }).join('')}</div>${a ? res(a.ok, 'Yanlış; doğru şık yeşil.') + (f.explain ? `<div class="tip">${esc(f.explain)}</div>` : '') : ''}`;
      } else if (z.mode === 'name') {
        body = `<p class="htext">Parlayan yapı hangisi?</p><div class="qopts">${c.opts.map((o, i) => {
          const x = qName(o); const cls = c.answer ? (o === c.q ? 'ok' : c.answer.pick === o ? 'bad' : '') : '';
          return `<button class="qopt ${cls}" data-zo="${i}"${c.answer ? ' disabled' : ''}><b lang="la">${esc(x.la)}</b>${x.de ? `<small lang="de">${esc(x.de)}</small>` : ''}</button>`;
        }).join('')}</div>${c.answer ? res(c.answer.ok, 'Yanlış; doğru şık yeşil.') : ''}`;
      } else {
        const x = qName(c.q);
        body = `<p class="htext">Şu yapıyı 3B görünümde tıkla:</p><h1 class="name" lang="la">${esc(x.la)}</h1>${x.de ? `<div class="name-de" lang="de">${esc(x.de)}</div>` : ''}
          ${c.answer ? res(c.answer.ok, `Yanlış: ${esc(c.answer.picked)}. Doğrusu şimdi parlıyor.`) : ''}`;
      }
      const catSeg = z.mode === 'facts' && cats?.length > 1
        ? `<div class="seg tiny qcat"><button data-zc="all" class="${z.cat === 'all' ? 'active' : ''}">Hepsi</button>${cats.map(([k, t]) => `<button data-zc="${k}" class="${z.cat === k ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>` : '';
      return `
        <div class="seg tiny qmode">${modes.map(([k, t]) => `<button data-zm="${k}" class="${z.mode === k ? 'active' : ''}">${t}</button>`).join('')}</div>
        ${catSeg}
        ${quizBar({ attr: 'data-zw', on: z.weakOnly, st, score: z.score })}
        ${asked().length ? '<button class="qnext" data-za="show" title="Kamerayı sorulan yapıya getir">Yapıya odaklan</button>' : ''}
        ${body}
        ${c && c.answer ? '<button class="qnext" data-za="next">Sonraki soru ▶</button>' : c && z.mode !== 'name' ? '<button class="qnext" data-za="next">Geç</button>' : ''}`;
    },
    // panel tıklaması: test düğmelerinden biriyse işler ve true döner
    click(e) {
      const t = e.target.closest('[data-zm],[data-zo],[data-za],[data-zc],[data-zw]'); if (!t) return false;
      if (t.dataset.zw) { z.weakOnly = !z.weakOnly; next(); return true; }
      if (t.dataset.zm) { if (t.dataset.zm !== z.mode) { z.mode = t.dataset.zm; next(); } return true; }
      if (t.dataset.zc) { if (t.dataset.zc !== z.cat) { z.cat = t.dataset.zc; next(); } return true; }
      if (t.dataset.zo) {
        const c = z.cur; if (!c || c.answer) return true;
        const i = +t.dataset.zo;
        if (z.mode === 'facts') { c.answer = { ok: i === 0, pick: i }; score(i === 0, fid(c.f)); }
        else { const o = c.opts[i]; c.answer = { ok: o === c.q, pick: o }; score(o === c.q, sid(c.q)); }
        refresh(); return true;
      }
      if (t.dataset.za === 'next') next();
      else if (t.dataset.za === 'show') { const rs = asked(); if (rs.length) stage.focusBox(model.boundsOf(rs)); }
      return true;
    },
  };
}
