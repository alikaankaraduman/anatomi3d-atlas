// Konu testi: bir Aanki konusunun yapılarıyla aktif hatırlama. İki soru türü:
//  - "Bu yapı ne?": bir yapı parlar, dört şıktan adı seçilir;
//  - "Yapıyı bul": adı verilen yapı 3B görünümde tıklanır.
// Sorular konunun izole görünümünde, o an görünen yapılardan gelir (Katmanlar ile gizlenen sistem soru olmaz). Aynı adlı
// sağ ve sol yapı tek soru sayılır; çeldiriciler önce aynı sistemden, sonra konunun diğer yapılarından seçilir. Test
// izole görünümle yaşar: izolasyondan çıkılınca biter (sync), "Konuya dön" konu kartına döner.
// Sonuçlar kalıcı ilerlemeye yazılır (progress.js); "Yanlışlarım" düğmesi soruları zayıf yapılara indirir. Aynı motor
// genel tekrarda da çalışır (start(null, { title: 'Yanlışlarım', back: false })): konu kartı olmadan, verilen başlıkla.
import { SYSTEMS, titleName, subtitleName, esc } from './text.js';
import { record, weak, stats, pickWeighted, structId, onChange } from './progress.js';
import { quizBar, WEAK_EMPTY } from './study.js';

export function createQuiz({ stage, model, state, refresh, getTopic }) {
  let active = false;
  const q = { id: null, mode: 'name', cur: null, score: [0, 0], weakOnly: false, title: null, place: '', back: true, last: null };
  const sid = rs => structId(rs[0].n);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // soru havuzu: izole görünümün görünen yapıları, ada göre (iki taraf birlikte)
  function pool() {
    const by = new Map();
    for (const id of state.isolate || []) {
      const r = model.items.get(id); if (!r?.mesh || !r.vis || r.ghost) continue;
      if (!by.has(r.n)) by.set(r.n, []); by.get(r.n).push(r);
    }
    return [...by.values()];
  }
  function next(render = true) {
    const p = pool(), cand = q.weakOnly ? p.filter(rs => weak(sid(rs))) : p;
    if (p.length < 2 || !cand.length) { q.cur = null; if (render) refresh(); return; }
    // ağırlıklı seçim (zayıf x3, sorulmamış x2, bilinen x1); aynısı arka arkaya gelmesin
    const rs = pickWeighted(cand, sid, cand.find(x => x[0].n === q.last));
    q.last = rs[0].n;
    const same = shuffle(p.filter(x => x !== rs && x[0].s === rs[0].s)), other = shuffle(p.filter(x => x !== rs && x[0].s !== rs[0].s));
    q.cur = { rs, opts: shuffle([rs, ...[...same, ...other].slice(0, 3)]), answer: null };
    if (render) refresh();
  }
  // opts: { title, place, back } (genel tekrar: konu kimliği yok, başlık verilir, "Konuya dön" düğmesi çıkmaz)
  function start(id, { title = null, place = '', back = true } = {}) {
    if (!state.isolate) return;
    active = true; q.id = id; q.score = [0, 0]; q.cur = null; q.last = null; q.weakOnly = false;   // her test bütün sorularla başlar
    q.title = title; q.place = place; q.back = back && id != null;
    state.selected = new Set(); state.primary = { type: 'quiz', id };
    next();
  }
  // ilerleme dışarıdan değişirse (sıfırlama, başka sekme) "Yanlışlarım" açıkken bekleyen soru artık zayıf olmayabilir
  onChange(() => { if (active && q.weakOnly && q.cur && !q.cur.answer && !weak(sid(q.cur.rs))) next(false); });
  function sync() { if (active && state.primary?.type !== 'quiz') { active = false; q.cur = null; } }
  const showAsked = () => active && q.cur && (q.mode === 'name' || q.cur.answer);
  function highlight() { return showAsked() ? q.cur.rs.filter(r => r.vis).map(r => r.mesh) : []; }
  function onPick(id) {
    if (!active) return false;
    const r = model.items.get(id);
    if (q.mode === 'find' && q.cur && !q.cur.answer && r) {
      const ok = r.n === q.cur.rs[0].n;
      q.cur.answer = { ok, picked: titleName(r) }; q.score[1]++; if (ok) q.score[0]++; record(sid(q.cur.rs), ok);
      refresh();
    }
    return true;   // testte tıklama seçim yapmaz
  }
  const nameOf = rs => ({ la: titleName(rs[0]), de: subtitleName(rs[0]) });
  function panelHTML() {
    const t = q.id != null ? getTopic(q.id) : null, c = q.cur, p = pool(), st = stats(p.map(sid));
    const title = q.title || (t ? t.title : ''), place = q.title ? q.place : t ? t.place : '';
    let body;
    if (!c && q.weakOnly && p.length >= 2 && !st.weak) body = WEAK_EMPTY;
    else if (!c) body = '<p class="htext">Bu görünümde soru sorulacak kadar yapı yok (Katmanlar ile gizlenen sistemlerin yapıları soru olmaz).</p>';
    else if (q.mode === 'name') {
      body = `<p class="htext">Parlayan yapı hangisi? <small class="dim">(${esc(SYSTEMS[c.rs[0].s].title)})</small></p><div class="qopts">${c.opts.map((o, i) => {
        const x = nameOf(o), cls = c.answer ? (o === c.rs ? 'ok' : c.answer.pick === o ? 'bad' : '') : '';
        return `<button class="qopt ${cls}" data-opt="${i}"${c.answer ? ' disabled' : ''}><b lang="la">${esc(x.la)}</b>${x.de ? `<small lang="de">${esc(x.de)}</small>` : ''}</button>`;
      }).join('')}</div>${c.answer ? `<div class="qres ${c.answer.ok ? 'ok' : 'bad'}">${c.answer.ok ? 'Doğru!' : 'Yanlış; doğru şık yeşil.'}</div>` : ''}`;
    } else {
      const x = nameOf(c.rs);
      body = `<p class="htext">Şu yapıyı 3B görünümde tıkla:</p><h1 class="name" lang="la">${esc(x.la)}</h1>${x.de ? `<div class="name-de" lang="de">${esc(x.de)}</div>` : ''}
        ${c.answer ? `<div class="qres ${c.answer.ok ? 'ok' : 'bad'}">${c.answer.ok ? 'Doğru!' : `Yanlış: ${esc(c.answer.picked)}. Doğrusu şimdi parlıyor.`}</div>` : ''}`;
    }
    return `
      <div class="chips"><span class="chip aanki">${q.title ? 'Tekrar' : 'Aanki · Test'}</span><span class="chip">${p.length} yapı</span></div>
      <h1 class="name"${q.title ? '' : ' lang="de"'}>${esc(title)}</h1>
      ${place ? `<div class="name-de"${q.title ? '' : ' lang="de"'}>${esc(place)}</div>` : ''}
      <div class="seg tiny qmode"><button data-qm="name" class="${q.mode === 'name' ? 'active' : ''}">Bu yapı ne?</button><button data-qm="find" class="${q.mode === 'find' ? 'active' : ''}">Yapıyı bul</button></div>
      ${quizBar({ attr: 'data-qw', on: q.weakOnly, st, score: q.score })}
      ${body}
      <div class="btns">
        ${c && (q.mode === 'name' || c.answer) ? '<button data-qa="show" title="Kamerayı sorulan yapıya getir">Yapıya odaklan</button>' : ''}
        ${c && c.answer ? '<button data-qa="next">Sonraki soru ▶</button>' : c && q.mode === 'find' ? '<button data-qa="skip">Geç</button>' : ''}
        ${q.back ? '<button data-qa="back" title="Konu kartına dön">Konuya dön</button>' : ''}
        <button data-qa="exit" title="İzole görünümden çık (Esc)">Testten çık</button>
      </div>`;
  }
  function click(e) {
    const b = e.target.closest('[data-qm],[data-qa],[data-opt],[data-qw]'); if (!b) return;
    if (b.dataset.qw) { q.weakOnly = !q.weakOnly; next(); return; }
    if (b.dataset.qm) { q.mode = b.dataset.qm; next(); return; }
    if (b.dataset.opt) {
      const c = q.cur; if (!c || c.answer) return;
      const o = c.opts[+b.dataset.opt], ok = o === c.rs;
      c.answer = { ok, pick: o }; q.score[1]++; if (ok) q.score[0]++; record(sid(c.rs), ok);
      refresh(); return;
    }
    const a = b.dataset.qa;
    if (a === 'next' || a === 'skip') next();
    else if (a === 'show' && q.cur) stage.focusBox(model.boundsOf(q.cur.rs));
    else if (a === 'back' && q.back) { active = false; state.primary = { type: 'topic', id: q.id }; refresh(); }
    else if (a === 'exit') { state.isolate = null; refresh(); }
  }
  return { start, sync, highlight, onPick, panelHTML, click, isActive: () => active };
}
