// Deneme sınavı: uygulamanın bütün bilgi sorusu bankalarından (beyin, hareket sistemi, kaslar, çalışma turları, kesit
// atlası) karışık, süreli, çoktan seçmeli bir test. Çalışma modlarının "Test" sekmelerindeki bilgi soruları burada tek
// bir sınavda toplanır.
//  - Bankalar yalnız sınav penceresi açılınca indirilir (bir kez; yüklenemeyen dosya bir sonraki açılışta yeniden denenir).
//    Soru biçimi bütün dosyalarda aynıdır: { q, options (ilk şık doğru; gösterilirken karıştırılır), explain, cat?, show? }.
//  - Başlangıç: konular (dosya ve tur başına bir konu), soru sayısı, soru başına süre (tek toplam geri sayım), soru
//    kaynağı (tümü ya da yalnız yanlış ve yeni sorular, progress.js) ve mod (Sınav: sonuçta geri bildirim; Çalışma: her
//    cevaptan sonra). Son ayarlar ve son 20 sonuç localStorage'da tutulur.
//  - Sınav, 3B görünümün üstünde modal bir <dialog>'dur: altındaki görünüm ve açık çalışma modu olduğu gibi kalır, sınav
//    sürerken tıklanamaz ve uygulamanın kısayolları çalışmaz (main.js kısayolları açık bir dialog varken susar).
//  - Her cevap çalışma modlarındaki testlerle aynı kimlikle kaydedilir: record(factId(soru metni), doğru mu). Sınav
//    modunda bitişte (cevap sonuna kadar değişebilir), Çalışma modunda cevap verilince. Boş soru kaydedilmez.
import { esc } from './text.js';
import { record, weak, seen, factId } from './progress.js';
import { shuffle } from './study.js';
import { ukey } from './users.js';

// Ayarlar, geçmiş ve süren sınav kullanıcı başınadır (users.js ukey: giriş yapılmışsa 'anatomi3d.u.<id>.…'; Misafir:
// bugünkü anahtarlar). Kullanıcı değişince sayfa yeniden yüklenir.
const SET_KEY = ukey('anatomi3d.exam.v1');
const HIST_KEY = ukey('anatomi3d.examHistory.v1');
const HIST_MAX = 20;
const RUN_KEY = ukey('anatomi3d.examRun.v1');   // süren sınav (sessionStorage): sayfa yenilenir ya da sekme atılırsa devam edilebilsin
const COUNTS = [10, 20, 40, 60];
const TIMES = [[0, 'Süresiz'], [45, '45 sn'], [60, '60 sn'], [90, '90 sn']];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Bankalar. Yeni bir banka: buraya bir satır (anahtar, Türkçe ad, dosya, okuyucu) ya da main.js TOURS içinde `exam`
// adı olan yeni bir tur. Okuyucu her soruya alt konu (sub) ekler; sonuçta konu çubuğunun altında gösterilir.
const SUB_BRAIN = { csf: 'BOS', cn: 'Kraniyal sinirler', art: 'Arterler' };
const SUB_LOCO = { nerve: 'Sinirler', passage: 'Geçitler', joint: 'Eklemler' };
function baseBanks(tours) {
  return [
    { key: 'brain', title: 'Beyin ve sinir sistemi', url: 'data/brain.json', read: d => (d.quiz || []).map(f => [f, SUB_BRAIN[f.cat] || null]) },
    { key: 'loco', title: 'Hareket sistemi', url: 'data/locomotor.json', read: d => (d.quiz || []).map(f => [f, SUB_LOCO[f.cat] || null]) },
    { key: 'muscles', title: 'Kaslar', url: 'data/muscles.json', read: d => (d.quiz || []).map(f => [f, null]) },
    // kalp modunun İleti sekmesi (ileti sistemi ve kalbin sinirleri): bilgi soruları
    { key: 'heart', title: 'Kalp', url: 'data/conduction.json', read: d => (d.quiz || []).map(f => [f, null]) },
    ...tours.filter(t => t.exam).map(t => ({
      key: t.key, title: t.exam, url: t.dataUrl,
      read: d => (d.tabs || []).flatMap(tab => (tab.quiz || []).map(f => [f, tab.title_tr || tab.key])),
    })),
    // kesit atlası: ikiz pelvis seviyeleri (kadın / erkek) aynı soruları taşır; aynı metin bir kez alınır
    { key: 'sect', title: 'Kesit anatomisi', url: 'data/sections.json', optional: true,
      read: d => (d.regions || []).flatMap(r => (r.levels || []).flatMap(l => (l.facts || []).map(f => [f, r.title_tr || r.key]))) },
  ];
}
const validQ = f => f && typeof f.q === 'string' && Array.isArray(f.options) && f.options.length >= 2 && f.options.every(o => typeof o === 'string');

// localStorage yardımcıları: okunamazsa varsayılan, yazılamazsa sessizce geç (özel pencere, dolu depolama)
const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yalnız bu oturum */ } };
const fmt = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

// N soruyu konulara böl: konu büyüklüğüyle orantılı, her konuya en az bir (N konu sayısından azsa rastgele konular,
// büyüklükle ağırlıklı), hiçbir konu elindekinden fazla vermez (en büyük kalan yöntemi)
export function allocate(sizes, N) {
  const total = sizes.reduce((a, b) => a + b, 0);
  N = Math.min(N, total);
  const a = sizes.map(() => 0);
  if (!N) return a;
  const idx = sizes.map((s, i) => i).filter(i => sizes[i] > 0);
  if (N < idx.length) {
    const left = [...idx];
    for (let k = 0; k < N; k++) {
      let r = Math.random() * left.reduce((s, i) => s + sizes[i], 0), j = 0;
      while (j < left.length - 1 && (r -= sizes[left[j]]) >= 0) j++;
      a[left[j]] = 1; left.splice(j, 1);
    }
    return a;
  }
  const exact = sizes.map(s => (N * s) / total);
  for (const i of idx) a[i] = Math.min(sizes[i], Math.max(1, Math.floor(exact[i])));
  let sum = a.reduce((x, y) => x + y, 0);
  while (sum > N) {   // en-az-bir kuralı fazla verdiyse: payını en çok aşandan bir eksilt
    let b = -1; for (const i of idx) if (a[i] > 1 && (b < 0 || a[i] - exact[i] > a[b] - exact[b])) b = i;
    a[b]--; sum--;
  }
  while (sum < N) {   // eksik kaldıysa: payının en gerisinde kalan ve sorusu artan konuya bir ekle
    let b = -1; for (const i of idx) if (a[i] < sizes[i] && (b < 0 || exact[i] - a[i] > exact[b] - a[b])) b = i;
    a[b]++; sum++;
  }
  return a;
}

// tours: main.js TOURS ({ key, dataUrl, exam: konu adı }); onShow(names): parçaları 3B görünümde göster;
// onToggle(): pencere açıldı ya da kapandı (adres çubuğu #m=exam için)
export function createExam({ tours = [], onShow, onToggle, onData } = {}) {
  const BANKS = baseBanks(tours);
  const data = new Map();   // banka anahtarı -> { title, qs: [...] }
  const failed = new Map(); // banka anahtarı -> hata metni
  let loading = null;
  let loadedOnce = false;   // bankalar en az bir kez indirildi (bankIds için)
  // Bankaları indir (yalnız eksik olanlar). Her soru: { id, q, options, explain, show, subj, sub }
  function fetchBanks() {
    const need = BANKS.filter(b => !data.has(b.key));
    if (!need.length) return Promise.resolve();
    return loading ||= Promise.all(need.map(b => fetch(b.url)
      .then(r => { if (b.optional && r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        failed.delete(b.key);
        if (!d) { data.set(b.key, { title: b.title, qs: [] }); return; }   // isteğe bağlı dosya yok
        data.set(b.key, { title: b.title, qs: b.read(d).filter(([f]) => validQ(f)).map(([f, sub]) => ({ id: factId(f.q), q: f.q, options: f.options, explain: f.explain || '', show: Array.isArray(f.show) ? f.show : null, subj: b.key, sub })) });
      })
      .catch(e => { console.warn('Sınav bankası yüklenemedi:', b.url, e); failed.set(b.key, b.title); })))
      .then(() => {
        loading = null; loadedOnce = true;
        // aynı metin iki bankada varsa ilki kalır (bir sınavda aynı soru iki kez gelmesin)
        const ids = new Set();
        for (const b of BANKS) { const d = data.get(b.key); if (d) d.qs = d.qs.filter(x => !ids.has(x.id) && ids.add(x.id)); }
        idSet = null;
        onData?.();
      });
  }
  // Sınavın sorabileceği soru kimlikleri (main.js "Yanlışlarım" sayısı yalnız bunları sayar). Bankalar henüz
  // indirilmediyse null döner ve indirmeyi başlatır (bitince onData).
  let idSet = null;
  function bankIds() {
    if (!loadedOnce) { fetchBanks(); return null; }
    return (idSet ||= new Set([...data.values()].flatMap(d => d.qs.map(x => x.id))));
  }
  const subjects = () => BANKS.filter(b => data.get(b.key)?.qs.length).map(b => ({ key: b.key, title: b.title, qs: data.get(b.key).qs }));
  const titleOf = k => BANKS.find(b => b.key === k)?.title || k;

  // ayarlar (son kullanılan) ve geçmiş
  const def = { subj: null, n: 20, t: 60, src: 'all', mode: 'exam' };
  const saved = load(SET_KEY, {});
  const S = {
    subj: Array.isArray(saved.subj) ? saved.subj : null,   // null: hepsi
    n: COUNTS.includes(saved.n) ? saved.n : def.n,
    t: TIMES.some(([v]) => v === saved.t) ? saved.t : def.t,
    src: saved.src === 'weak' ? 'weak' : 'all',
    mode: saved.mode === 'study' ? 'study' : 'exam',
  };
  // kaynak (src) yalnız kullanıcı düğmesine basınca kaydedilir: "Yanlışlarım"dan açılış ('weak') o açılışa özeldir
  let savedSrc = S.src;
  const saveSettings = () => store(SET_KEY, { ...S, src: savedSrc });
  const history = () => { const h = load(HIST_KEY, []); return Array.isArray(h) ? h.filter(x => x && Number.isFinite(x.r) && Number.isFinite(x.n) && x.n > 0) : []; };

  // ---------- pencere ----------
  const dlg = document.createElement('dialog');
  dlg.id = 'exam'; dlg.setAttribute('aria-label', 'Deneme sınavı'); dlg.tabIndex = -1;
  document.body.appendChild(dlg);
  // "3B'de göster"den sonra sonuca geri dönüş düğmesi (sayfa açık kaldıkça)
  const back = document.createElement('div');
  back.id = 'exam-back'; back.hidden = true;
  back.innerHTML = '<button data-a="reopen">Sonuca dön</button><button data-a="drop" aria-label="Kapat" title="Kapat">×</button>';
  // #app içinde: #app (position: fixed) kendi yığın bağlamıdır; dışarıda kalırsa hap arama listesinin (#topbar, z 10) üstüne çizilir
  (document.getElementById('app') || document.body).appendChild(back);
  back.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'reopen' && last) {
      view = 'result'; show();
      const b = dlg.querySelector('.ex-body'); if (b) b.scrollTop = resultScroll;   // listede kalınan yer
    }
    else if (a === 'drop') back.hidden = true;
  });

  let view = 'start';      // 'loading' | 'start' | 'run' | 'result'
  let run = null;          // süren sınav
  let last = null;         // son biten sınav (sonuç ekranı)
  let confirmKind = null;  // 'finish' | 'leave' (sınav sürerken satır içi onay)
  let filter = 'wrong';
  let resultScroll = 0;    // "3B'de göster" anında sonuç listesinin kaydırma konumu
  // soru haritası: masaüstünde açık, telefonda ve alçak (yatay telefon) ekranda kapalı başlar
  const SMALL = '(max-width: 760px), (max-height: 500px)';
  let navOpen = !matchMedia(SMALL).matches;
  let tick = null;
  let closing = false;

  function show() {
    back.hidden = true;
    render();
    if (!dlg.open) { dlg.showModal(); onToggle?.(); }
    dlg.focus({ preventScroll: true });
  }
  function hide() {
    if (dlg.open) { closing = true; dlg.close(); }   // close olayı eşzamansız gelir: bayrağı o sıfırlar
    stopTick();
    back.hidden = !last;
    onToggle?.();
  }
  // tarayıcı pencereyi kendisi kapatırsa (ör. iki kez Esc) sınav kaybolmasın: yeniden aç
  dlg.addEventListener('close', () => {
    if (closing) { closing = false; return; }
    if (view === 'run' && run) { dlg.showModal(); confirmKind = 'leave'; render(); }
    else { stopTick(); back.hidden = !last; onToggle?.(); }
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); escape(); });

  // dışarıdan açılış: opts.src ('weak') kaynağı yalnız bu açılış için seçer (kaydedilmez)
  async function open(opts = {}) {
    S.src = opts.src === 'weak' || opts.src === 'all' ? opts.src : savedSrc;
    if (run && view === 'run') { show(); return; }   // süren sınav varsa ona dön
    view = 'loading'; show();
    await fetchBanks();
    if (view !== 'loading') return;   // bu arada kapatıldı
    view = 'start'; if (dlg.open) render();
  }

  // ---------- soru seçimi ----------
  // konu başına aday sorular: "yalnız yanlışlarım ve yeni sorular" seçiliyse yalnız zayıf ya da hiç sorulmamış
  // sorular, önce zayıflar; yoksa hepsi rastgele sırada
  function candidates(qs) {
    if (S.src !== 'weak') return shuffle([...qs]);
    return [...shuffle(qs.filter(x => weak(x.id))), ...shuffle(qs.filter(x => !weak(x.id) && !seen(x.id)))];
  }
  const chosen = () => subjects().filter(s => !S.subj || S.subj.includes(s.key));
  function draw() {
    const subs = chosen().map(s => ({ s, c: candidates(s.qs) })).filter(x => x.c.length);
    const k = allocate(subs.map(x => x.c.length), S.n);
    return shuffle(subs.flatMap((x, i) => x.c.slice(0, k[i])));
  }
  function begin(qs, { mode = S.mode, t = S.t } = {}) {
    if (!qs.length) return;
    run = {
      qs: qs.map(x => ({ x, order: shuffle(x.options.map((_, i) => i)), ans: null, flag: false })),
      cur: 0, mode, per: t, limit: t ? t * qs.length : 0, start: Date.now(), end: null, timeout: false,
    };
    view = 'run'; confirmKind = null; filter = 'wrong';
    navOpen = !matchMedia(SMALL).matches;
    render(); startTick();
  }
  // süren sınavı sessionStorage'a yaz (soru kimlikleri, şık sırası, cevaplar); bitince / çıkınca sil
  function saveRun() {
    try {
      if (run) sessionStorage.setItem(RUN_KEY, JSON.stringify({ qs: run.qs.map(q => [q.x.id, q.order, q.ans, q.flag ? 1 : 0]), cur: run.cur, mode: run.mode, per: run.per, limit: run.limit, start: run.start }));
      else sessionStorage.removeItem(RUN_KEY);
    } catch { /* depolama yok: yenilemede sınav kaybolur */ }
  }
  let pending = (() => { try { return JSON.parse(sessionStorage.getItem(RUN_KEY)); } catch { return null; } })();
  // kaydedilmiş sınavı bankalardaki sorulara bağla (bir soru artık yoksa null)
  function pendingRun() {
    if (!pending || !Array.isArray(pending.qs) || !pending.qs.length) return null;
    const byId = new Map(subjects().flatMap(s => s.qs.map(x => [x.id, x])));
    const qs = pending.qs.map(([id, order, ans, flag]) => {
      const x = byId.get(id);
      return x && Array.isArray(order) && order.length === x.options.length ? { x, order, ans: Number.isInteger(ans) ? ans : null, flag: !!flag } : null;
    });
    if (qs.some(q => !q)) return null;
    const P = pending;
    return { qs, cur: Math.min(Math.max(0, P.cur | 0), qs.length - 1), mode: P.mode === 'study' ? 'study' : 'exam', per: +P.per || 0, limit: +P.limit || 0, start: +P.start || Date.now(), end: null, timeout: false };
  }
  function dropPending() { pending = null; try { sessionStorage.removeItem(RUN_KEY); } catch { /* yok */ } }
  function resume() {
    const r = pendingRun();
    if (!r) { dropPending(); render(); return; }
    pending = null;
    run = r; view = 'run'; confirmKind = null; filter = 'wrong'; navOpen = !matchMedia(SMALL).matches;
    if (expired()) return;   // süre bu arada dolduysa doğrudan sonuç
    render(); startTick();
  }

  // ---------- geri sayım ----------
  const left = () => run.limit - (Date.now() - run.start) / 1000;
  // süre bittiyse sınavı bitir (aralık sayacı arka planda yavaşlar: cevap ve gezinme önce buna bakar)
  function expired() { if (run && view === 'run' && run.limit && left() <= 0) { finish(true); return true; } return false; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expired(); });
  function startTick() {
    stopTick();
    if (!run?.limit) return;
    tick = setInterval(() => {
      if (!run || view !== 'run') { stopTick(); return; }
      const s = left();
      if (s <= 0) { finish(true); return; }
      const el = dlg.querySelector('.ex-time');
      if (el) { el.textContent = fmt(s); el.classList.toggle('warn', s <= 60); }
    }, 250);
  }
  function stopTick() { clearInterval(tick); tick = null; }

  // ---------- cevap, gezinme, bitiş ----------
  const curQ = () => run.qs[run.cur];
  function answer(pos) {
    if (expired()) return;
    const q = curQ(); if (!q || pos >= q.order.length) return;
    if (run.mode === 'study' && q.ans != null) return;   // Çalışma modunda cevap kilitlenir
    q.ans = q.order[pos];
    if (run.mode === 'study') record(q.x.id, q.ans === 0);
    confirmKind = null; render();
    if (run.mode === 'study') revealFeedback();
  }
  // Çalışma modu: geri bildirim ve açıklama alçak ekranda görünür alanın altında kalmasın (soru gövdesini kaydır)
  function revealFeedback() {
    const b = dlg.querySelector('.ex-body'), res = b?.querySelector('.qres'); if (!res) return;
    const el = b.querySelector('.tip') || res, br = b.getBoundingClientRect();
    const over = el.getBoundingClientRect().bottom + 8 - br.bottom;
    if (over > 0) b.scrollTop += Math.min(over, res.getBoundingClientRect().top - br.top - 8);
  }
  function go(i) { if (!run || expired()) return; run.cur = Math.max(0, Math.min(run.qs.length - 1, i)); confirmKind = null; render(); }
  function finish(timeout = false) {
    if (!run) return;
    stopTick(); dropPending();
    run.end = Date.now(); run.timeout = timeout;
    // Sınav modunda kayıt bitişte (cevaplar o ana kadar değişebilir); boş soru kaydedilmez
    if (run.mode === 'exam') for (const q of run.qs) if (q.ans != null) record(q.x.id, q.ans === 0);
    const right = run.qs.filter(q => q.ans === 0).length;
    const sec = timeout ? run.limit : (run.end - run.start) / 1000;
    last = { ...run, right, sec };
    const h = history();
    h.push({ d: run.end, s: [...new Set(run.qs.map(q => q.x.subj))], r: right, n: run.qs.length, sec: Math.round(sec), m: run.mode });
    store(HIST_KEY, h.slice(-HIST_MAX));
    run = null; view = 'result'; confirmKind = null;
    filter = last.qs.some(q => q.ans !== 0) ? 'wrong' : 'all';
    if (!dlg.open) show(); else render();
  }
  function escape() {
    if (view === 'run') { confirmKind = confirmKind ? null : 'leave'; render(); return; }
    if (view === 'loading') view = 'start';
    hide();
  }

  // ---------- çizim ----------
  const seg = (key, list, cur) => `<div class="seg ex-seg">${list.map(([v, t, dis]) => `<button data-set="${key}" data-v="${v}" class="${String(v) === String(cur) ? 'active' : ''}"${dis ? ' disabled' : ''}>${t}</button>`).join('')}</div>`;
  function startHTML() {
    const subs = subjects();
    const sel = new Set(chosen().map(s => s.key));
    const pool = subs.filter(s => sel.has(s.key)).flatMap(s => s.qs);
    const nWeak = pool.filter(x => weak(x.id)).length, nNew = pool.filter(x => !seen(x.id)).length;
    const avail = S.src === 'weak' ? nWeak + pool.filter(x => !weak(x.id) && !seen(x.id)).length : pool.length;
    const n = Math.min(S.n, avail);
    const err = [...failed.values()];
    const h = history();
    const pr = pendingRun();
    const prHTML = pr ? `<div class="ex-resume" role="status"><span>Yarım kalan sınav: ${pr.qs.filter(q => q.ans != null).length} / ${pr.qs.length} cevaplı${pr.limit ? `, kalan süre ${fmt(pr.limit - (Date.now() - pr.start) / 1000)}` : ''}.</span><button class="ex-primary" data-a="resume">Devam et</button><button data-a="discard">Sil</button></div>` : '';
    return `
      <header class="ex-head"><h2>Deneme sınavı</h2><button class="ex-x" data-a="close" aria-label="Kapat" title="Kapat (Esc)">×</button></header>
      <div class="ex-body">
        <p class="ex-intro">Bütün çalışma modlarının bilgi sorularından karışık, süreli bir test. Cevaplar Yanlışlarım listesine yazılır.</p>
        ${prHTML}
        ${err.length ? `<div class="ex-err" role="alert">Yüklenemedi: ${esc(err.join(', '))}. Sınav öteki konularla yapılabilir; pencereyi yeniden açınca tekrar denenir.</div>` : ''}
        <section><div class="ex-lbl">Konular <span class="ex-links"><button data-a="all">Tümü</button> / <button data-a="none">Hiçbiri</button></span></div>
          <div class="ex-chips">${subs.map(s => `<button class="ex-chip${sel.has(s.key) ? ' on' : ''}" data-subj="${s.key}" aria-pressed="${sel.has(s.key)}">${esc(s.title)} <small>${s.qs.length}</small></button>`).join('')}</div></section>
        <section><div class="ex-lbl">Soru sayısı${avail < S.n ? ` <small>(seçimde ${avail} soru var)</small>` : ''}</div>${seg('n', COUNTS.map(c => [c, c]), S.n)}</section>
        <section><div class="ex-lbl">Soru başına süre <small>(tek toplam geri sayım)</small></div>${seg('t', TIMES, S.t)}</section>
        <section><div class="ex-lbl">Sorular</div>${seg('src', [['all', 'Tüm sorular'], ['weak', 'Yalnız yanlışlarım ve yeni sorular']], S.src)}
          <div class="ex-note">${S.src === 'weak' ? `Seçili konularda ${nWeak} yanlış ve ${nNew} yeni soru; önce yanlışlar sorulur.` : `Seçili konularda ${pool.length} soru.`}</div></section>
        <section><div class="ex-lbl">Mod</div>${seg('mode', [['exam', 'Sınav'], ['study', 'Çalışma']], S.mode)}
          <div class="ex-note">${S.mode === 'exam' ? 'Sonuçlar sınavın sonunda gösterilir; cevabını bitirene kadar değiştirebilirsin.' : 'Her cevaptan sonra doğrusu ve açıklaması gösterilir; cevap değiştirilemez.'}</div></section>
        ${historyHTML(h)}
      </div>
      <footer class="ex-foot">
        <span class="ex-sum">${n ? `${n} soru · ${S.t ? fmt(n * S.t) : 'süresiz'}` : 'Seçimde soru yok'}</span>
        ${last ? '<button data-a="result">Son sonuç</button>' : ''}
        <button class="ex-primary" data-a="start"${n ? '' : ' disabled'}>Başla</button>
      </footer>`;
  }
  function historyHTML(h) {
    if (!h.length) return '';
    const pc = x => Math.round((100 * x.r) / x.n);
    const ps = h.map(pc);
    // eğilim: küçük çizgi grafiği (eskiden yeniye) ve son sonucun öncekilerin ortalamasına göre farkı
    const W = 120, H = 28, step = ps.length > 1 ? W / (ps.length - 1) : 0;
    const pts = ps.map((p, i) => `${(i * step).toFixed(1)},${(H - 2 - (p / 100) * (H - 4)).toFixed(1)}`).join(' ');
    const prev = ps.slice(0, -1), avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
    const d = avg == null ? '' : Math.round(ps[ps.length - 1] - avg);
    const trend = avg == null ? '' : `<span class="ex-trend ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}${d === 0 ? '' : d} puan (öncekilerin ortalaması %${Math.round(avg)})</span>`;
    const short = s => s.length > 2 ? `${s.length} konu` : s.map(titleOf).join(', ');
    const dt = t => { try { return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    return `<section class="ex-hist"><div class="ex-lbl">Son sınavlar ${trend}</div>
      ${ps.length > 1 ? `<svg class="ex-spark" viewBox="-2 0 ${W + 4} ${H}" aria-hidden="true"><polyline points="${pts}"/></svg>` : ''}
      <ul>${h.slice().reverse().map(x => `<li><span>${esc(dt(x.d))}</span><span class="ex-hs">${esc(short(x.s || []))}${x.m === 'study' ? ' · Çalışma' : ''}</span><b>${x.r}/${x.n} · %${pc(x)}</b><span class="dim">${fmt(x.sec || 0)}</span></li>`).join('')}</ul></section>`;
  }
  function runHTML() {
    const R = run, q = curQ(), n = R.qs.length, x = q.x, study = R.mode === 'study';
    const locked = study && q.ans != null;
    const answered = R.qs.filter(z => z.ans != null).length, flagged = R.qs.filter(z => z.flag).length;
    const s = R.limit ? left() : 0;
    const opts = q.order.map((oi, pos) => {
      let cls = q.ans === oi ? ' sel' : '';
      if (locked) cls = oi === 0 ? ' ok' : q.ans === oi ? ' bad' : ' dimmed';
      return `<button class="ex-opt${cls}" data-opt="${pos}"${locked ? ' disabled' : ''} aria-pressed="${q.ans === oi}"><b class="ex-key">${LETTERS[pos]}</b><span>${esc(x.options[oi])}</span></button>`;
    }).join('');
    const fb = locked ? `<div class="qres ${q.ans === 0 ? 'ok' : 'bad'}">${q.ans === 0 ? 'Doğru!' : 'Yanlış; doğru şık yeşil.'}</div>${x.explain ? `<div class="tip">${esc(x.explain)}</div>` : ''}` : '';
    const dots = R.qs.map((z, i) => {
      const c = [i === R.cur ? 'cur' : '', z.ans != null ? 'done' : '', z.flag ? 'flag' : '', study && z.ans != null ? (z.ans === 0 ? 'ok' : 'bad') : ''].filter(Boolean).join(' ');
      return `<button class="ex-dot ${c}" data-go="${i}" aria-label="Soru ${i + 1}${z.ans != null ? ', cevaplı' : ''}${z.flag ? ', işaretli' : ''}"${i === R.cur ? ' aria-current="true"' : ''}>${i + 1}</button>`;
    }).join('');
    const empty = n - answered;
    const conf = confirmKind === 'finish'
      ? `<div class="ex-confirm" role="alert"><span>${empty} soru boş${flagged ? `, ${flagged} işaretli` : ''}. Boş sorular yanlış sayılır. Yine de bitirilsin mi?</span><button class="ex-primary" data-a="finish-yes">Bitir</button><button data-a="cancel">Devam et</button></div>`
      : confirmKind === 'leave'
        ? `<div class="ex-confirm" role="alert"><span>Sınavdan çıkılsın mı? ${study ? 'Verdiğin cevaplar kaydedildi; sonuç' : 'Cevapların kaydedilmez, sonuç'} oluşmaz.</span><button class="ex-danger" data-a="leave-yes">Çık</button><button data-a="cancel">Devam et</button></div>` : '';
    const lastQ = R.cur === n - 1;
    return `
      <header class="ex-head ex-runhead">
        <span class="ex-count" title="Soru">${R.cur + 1} / ${n}</span>
        ${R.limit ? `<span class="ex-time${s <= 60 ? ' warn' : ''}" title="Kalan süre" role="timer">${fmt(s)}</span>` : '<span class="ex-time off" title="Süresiz">süresiz</span>'}
        <span class="ex-modechip">${study ? 'Çalışma' : 'Sınav'}</span>
        <button class="ex-finish" data-a="finish" title="Sınavı bitir">Bitir</button>
        <button class="ex-x" data-a="close" aria-label="Sınavdan çık" title="Sınavdan çık (Esc)">×</button>
      </header>
      <div class="ex-bar" aria-hidden="true"><i style="width:${(100 * answered) / n}%"></i></div>
      <div class="ex-body">
        <div class="ex-qchip"><span class="chip">${esc(titleOf(x.subj))}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}${q.flag ? '<span class="ex-flagmark" title="İşaretli">⚑ işaretli</span>' : ''}</div>
        <p class="ex-q">${esc(x.q)}</p>
        <div class="ex-opts">${opts}</div>
        ${fb}
      </div>
      ${conf}
      <footer class="ex-foot ex-runfoot">
        <div class="ex-navbtns">
          <button data-a="prev"${R.cur ? '' : ' disabled'}>◀ Önceki</button>
          <button data-a="flag" class="${q.flag ? 'on' : ''}" aria-pressed="${q.flag}" title="Sonra bakmak için işaretle">⚑ İşaretle</button>
          ${lastQ ? '<button data-a="finish" class="ex-primary">Bitir</button>' : `<button data-a="next" class="${q.ans != null ? 'ex-primary' : ''}">Sonraki ▶</button>`}
        </div>
        <details class="ex-nav"${navOpen ? ' open' : ''}><summary>Soru haritası · ${answered}/${n} cevaplı${flagged ? ` · ${flagged} işaretli` : ''}</summary><div class="ex-dots">${dots}</div></details>
        <div class="ex-keys">Klavye: 1-4 / A-D cevap · Enter sonraki · ← → gezin · Esc çık</div>
      </footer>`;
  }
  function resultHTML() {
    const L = last, n = L.qs.length;
    const pct = Math.round((100 * L.right) / n);
    // konu ve alt konu başına doğru / sorulan
    const by = new Map();
    for (const q of L.qs) {
      const k = q.x.subj; if (!by.has(k)) by.set(k, { r: 0, n: 0, subs: new Map() });
      const b = by.get(k); b.n++; if (q.ans === 0) b.r++;
      if (q.x.sub) { const s = b.subs.get(q.x.sub) || { r: 0, n: 0 }; s.n++; if (q.ans === 0) s.r++; b.subs.set(q.x.sub, s); }
    }
    const bars = [...by].map(([k, b]) => `<div class="ex-sbar"><div class="ex-sname"><span>${esc(titleOf(k))}</span><b>${b.r} / ${b.n}</b></div>
      <div class="ex-track"><i style="width:${(100 * b.r) / b.n}%"></i></div>
      ${b.subs.size > 1 ? `<div class="ex-subs">${[...b.subs].map(([t, s]) => `<span>${esc(t)} ${s.r}/${s.n}</span>`).join('')}</div>` : ''}</div>`).join('');
    const wrong = L.qs.filter(q => q.ans !== 0), flagged = L.qs.filter(q => q.flag);
    const list = (filter === 'wrong' ? wrong : filter === 'flag' ? flagged : L.qs);
    const items = list.map(q => {
      const i = L.qs.indexOf(q), x = q.x, st = q.ans == null ? 'skip' : q.ans === 0 ? 'ok' : 'bad';
      return `<li class="ex-ri ${st}"><div class="ex-rih"><span class="ex-rin">${i + 1}</span><span class="chip">${esc(titleOf(x.subj))}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}${q.flag ? '<span class="ex-flagmark">⚑</span>' : ''}<span class="ex-rst">${st === 'ok' ? 'Doğru' : st === 'bad' ? 'Yanlış' : 'Boş'}</span></div>
        <p class="ex-q small">${esc(x.q)}</p>
        ${st !== 'ok' ? `<div class="ex-given">Senin cevabın: ${q.ans == null ? '<i>boş</i>' : esc(x.options[q.ans])}</div>` : ''}
        <div class="ex-right">Doğru cevap: ${esc(x.options[0])}</div>
        ${x.explain ? `<div class="tip">${esc(x.explain)}</div>` : ''}
        ${x.show?.length ? `<button class="ex-show" data-show="${i}" title="Sorunun yapılarını 3B görünümde seç ve göster">3B'de göster</button>` : ''}</li>`;
    }).join('');
    return `
      <header class="ex-head"><h2>Sonuç</h2><button class="ex-x" data-a="close" aria-label="Kapat" title="Kapat (Esc)">×</button></header>
      <div class="ex-body">
        <div class="ex-score ${pct >= 60 ? 'ok' : 'bad'}"><b>${L.right} / ${n}</b><span>%${pct}</span>
          <small>Süre ${fmt(L.sec)}${L.limit ? ` / ${fmt(L.limit)}` : ''} · ${L.mode === 'study' ? 'Çalışma' : 'Sınav'} modu${L.timeout ? ' · <b class="ex-to">Süre doldu</b>' : ''}${L.qs.some(q => q.ans == null) ? ` · ${L.qs.filter(q => q.ans == null).length} boş` : ''}</small></div>
        <div class="ex-sbars">${bars}</div>
        <div class="seg ex-seg ex-filter">
          <button data-f="wrong" class="${filter === 'wrong' ? 'active' : ''}">Yanlışlar (${wrong.length})</button>
          <button data-f="flag" class="${filter === 'flag' ? 'active' : ''}">İşaretliler (${flagged.length})</button>
          <button data-f="all" class="${filter === 'all' ? 'active' : ''}">Tümü (${n})</button></div>
        ${items ? `<ol class="ex-list">${items}</ol>` : `<p class="ex-note">${filter === 'wrong' ? 'Yanlış ya da boş soru yok, tebrikler!' : 'İşaretlediğin soru yok.'}</p>`}
      </div>
      <footer class="ex-foot">
        <button data-a="retry"${wrong.length ? '' : ' disabled'} title="Yanlış ve boş sorulardan yeni bir sınav">Yanlışları tekrar çöz</button>
        <button class="ex-primary" data-a="new">Yeni sınav</button>
      </footer>`;
  }
  function render() {
    const scroll = view === 'run' ? 0 : dlg.querySelector('.ex-body')?.scrollTop || 0;
    const keepScroll = dlg.dataset.view === view && view !== 'run';
    dlg.dataset.view = view;
    dlg.innerHTML = view === 'loading'
      ? '<header class="ex-head"><h2>Deneme sınavı</h2><button class="ex-x" data-a="close" aria-label="Kapat">×</button></header><div class="ex-body ex-loading"><span class="spin"></span> Soru bankaları yükleniyor…</div>'
      : view === 'start' ? startHTML() : view === 'run' ? runHTML() : resultHTML();
    if (keepScroll) { const b = dlg.querySelector('.ex-body'); if (b) b.scrollTop = scroll; }
    if (dlg.open && !dlg.contains(document.activeElement)) dlg.focus({ preventScroll: true });
    // onay satırında odak güvenli düğmede ("Devam et"): Esc ardından Enter sınavı silmesin
    if (confirmKind) dlg.querySelector('.ex-confirm [data-a="cancel"]')?.focus({ preventScroll: true });
    if (view === 'run') saveRun();
  }

  // ---------- olaylar ----------
  dlg.addEventListener('toggle', e => { if (e.target.matches?.('.ex-nav')) navOpen = e.target.open; }, true);
  dlg.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    if (expired()) return;
    const d = t.dataset;
    if (d.set) {
      const v = d.set === 'n' || d.set === 't' ? +d.v : d.v;
      S[d.set] = v; if (d.set === 'src') savedSrc = v;
      saveSettings(); render(); return;
    }
    if (d.subj) {
      const all = subjects().map(s => s.key), cur = new Set(S.subj || all);
      if (cur.has(d.subj)) cur.delete(d.subj); else cur.add(d.subj);
      S.subj = cur.size === all.length ? null : [...cur]; saveSettings(); render(); return;
    }
    if (d.opt != null) { answer(+d.opt); return; }
    if (d.go != null) { go(+d.go); return; }
    if (d.f) { filter = d.f; render(); dlg.querySelector('.ex-filter')?.scrollIntoView({ block: 'nearest' }); return; }
    if (d.show != null) {
      const q = last?.qs[+d.show]; if (!q?.x.show) return;
      resultScroll = dlg.querySelector('.ex-body')?.scrollTop || 0;
      hide(); onShow?.(q.x.show);
      return;
    }
    switch (d.a) {
      case 'close': escape(); break;
      case 'all': S.subj = null; saveSettings(); render(); break;
      case 'none': S.subj = []; saveSettings(); render(); break;
      case 'start': begin(draw()); break;
      case 'result': if (last) { view = 'result'; render(); } break;
      case 'prev': go(run.cur - 1); break;
      case 'next': go(run.cur + 1); break;
      case 'flag': curQ().flag = !curQ().flag; render(); break;
      case 'finish': if (run.qs.some(q => q.ans == null)) { confirmKind = 'finish'; render(); } else finish(); break;
      case 'finish-yes': finish(); break;
      case 'cancel': confirmKind = null; render(); break;
      case 'resume': resume(); break;
      case 'discard': dropPending(); render(); break;
      case 'leave-yes': stopTick(); run = null; dropPending(); view = 'start'; confirmKind = null; hide(); break;
      case 'retry': if (last) begin(shuffle(last.qs.filter(q => q.ans !== 0).map(q => q.x)), { mode: last.mode, t: last.per }); break;
      case 'new': view = 'start'; render(); break;
    }
  });
  // Klavye: pencere açıkken (yakalama evresinde) işlenir; uygulamanın kısayolları zaten açık bir dialog varken susar
  document.addEventListener('keydown', e => {
    if (!dlg.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); escape(); return; }
    if (view !== 'run' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (confirmKind) return;   // onay satırı açıkken yalnız onun düğmeleri (Tab / Enter)
    if (expired()) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    const pos = /^[1-9]$/.test(e.key) ? +e.key - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
    if (pos >= 0 && pos < curQ().order.length) { e.preventDefault(); answer(pos); return; }
    if (e.key === 'Enter') {
      if (e.target.closest?.('button, summary')) return;   // odaktaki düğme Enter'ı kendisi işler (şık, Önceki, nokta...)
      e.preventDefault();
      if (run.cur < run.qs.length - 1) go(run.cur + 1);
      else if (run.qs.some(q => q.ans == null)) { confirmKind = 'finish'; render(); } else finish();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(run.cur + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(run.cur - 1); }
  }, true);

  return {
    open, close: () => { if (view === 'run') escape(); else hide(); },
    isOpen: () => dlg.open,
    get run() { return run; }, get last() { return last; }, get view() { return view; },
    settings: S, subjects, finish, data, bankIds,
  };
}
