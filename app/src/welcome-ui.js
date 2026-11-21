// Kişisel bağlantı ("sana özel not"): karşılama kartı (#welcome), bağlantı oluşturma penceresi (#welcome-make) ve
// Hakkında penceresindeki girişler. Mantık (kodlama, çözme, denetim, renk paleti) src/welcome.js'tedir.
// Bağlantı: sitenin adresi + #g=<base64url>. Geçerli bir bağlantı açılınca kart gösterilir; kişi "Başla"ya basınca
// (önce değil) kişiselleştirme bu cihazda saklanır (localStorage anatomi3d.welcome.v1): vurgu rengi (CSS değişkenleri --accent / --accent-ink), isteğe bağlı
// uygulama adı (sayfa başlığı ve apple-mobile-web-app-title, böylece "Ana Ekrana Ekle" o adı önerir) ve kartın Hakkında'dan
// yeniden açılması. Bağlantı açmayan bir ziyaretçi için hiçbir şey değişmez: depolamaya yazılmaz, soru sorulmaz.
// Bütün metinler textContent ile yazılır (HTML olarak asla). Pencereler index.html'de durur; main.js'teki Geri tuşu
// katmanı (topLayer) onları da kapatır. Satır içi betik ya da olay özniteliği yoktur (Pages derlemesinin sıkı CSP'si).
//
// iOS: ana ekrana eklenen web uygulamasının depolaması Safari'ninkinden ayrıdır; Safari'de saklanan not ana ekrandaki
// uygulamada yoktur (macOS Safari'nin "Dock'a Ekle" uygulaması için de aynısı geçerli). Bu yüzden (a) kart iOS / iPadOS
// ve macOS Safari'de (tam ekran değilken) ana ekrana / Dock'a bu sayfadan eklemeyi söyler, (b) yalnız bu Safari
// sekmelerinde bağlantı adreste kalır (main.js syncHash, hashParam() ile birleştirir) ki bu sayfadan yapılan yer imi onu
// taşısın; Safari bağlantılı bir web manifesti varsa başlangıç adresini manifestten aldığı için orada ve yalnız kişisel
// bağlantıyla açılan sayfada <link rel="manifest"> kaldırılır (o zaman o anki adres kullanılır). Bu, gerçek bir iPhone /
// iPad / Mac'te SINANAMADI. (c) Her durumda işleyen yol: Hakkında › "Kişisel bağlantın var mı?" alanına bağlantı
// yapıştırılır. Öteki tarayıcılarda, kurulu uygulamada (tam ekran) ve Android kabuğunda parça okunur ve
// history.replaceState ile adresten silinir (paylaşılan bir derin bağlantı notu taşımasın).
import * as W from './welcome.js';

const $ = s => document.querySelector(s);
const native = () => !!window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:';
const mq = q => { try { return matchMedia(q).matches; } catch { return false; } };
const standalone = () => navigator.standalone === true || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)');
const inApp = () => native() || standalone();
const ua = () => navigator.userAgent || '';
// iPadOS 13+ masaüstü Safari gibi tanıtır: Macintosh + dokunmatik
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
const isIOSSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo/.test(ua());
// macOS Safari (Dosya › "Dock'a Ekle"): dokunmatik olmayan Macintosh, Version/..Safari, Chromium / Firefox / Opera değil.
// Dock'taki web uygulaması Safari'nin yerel depolamasını görmez (WebKit belgelerine göre yalnız çerezler kopyalanır)
// ve başlangıç adresini manifestten alır; bu yüzden iOS ile aynı yol izlenir. Gerçek bir Mac'te SINANAMADI.
const isMacSafari = () => /Macintosh/.test(ua()) && !(navigator.maxTouchPoints > 1) && /Version\/[\d.]+.*Safari\//.test(ua())
  && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR|Opera/.test(ua());
// Bağlantı yalnız Apple Safari'de (ana ekran / Dock yer imi onu taşısın diye) ve yalnız tarayıcı sekmesinde adreste
// kalır. Öteki tarayıcılarda hemen silinir: kişi bir yapıyı ya da konuyu paylaşmak için adresi kopyalarsa not gitmesin.
const keepFragment = () => !inApp() && (isIOS() || isMacSafari());

// Cihazda saklanan kişisel not (yoksa ya da bozuksa null). Yalnız okur.
export function storedWelcome() {
  try { return W.parseStored(localStorage.getItem(W.STORE_KEY)); } catch { return null; }
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (text, act, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.dataset.a = act; return b; };

// Kartın kendisi (karşılama ve oluşturma önizlemesi aynı görünür). Bütün metinler textContent.
function cardNode(d) {
  const c = el('div', 'wl-card');
  c.append(el('p', 'wl-kicker', 'Sana özel not'));
  c.append(el('h2', 'wl-to', `${d.to} için`));
  if (d.msg) c.append(el('p', 'wl-msg', d.msg));   // satır sonları CSS ile (white-space: pre-line)
  const sign = [d.from ? `${d.from}` : '', d.date ? W.dateText(d.date) : ''].filter(Boolean).join(' · ');
  if (sign) c.append(el('p', 'wl-sign', '— ' + sign));
  // not uygulamanın değil, bağlantıyı yapan kişinin metnidir (Kimden alanı da onun beyanıdır)
  c.append(el('p', 'wl-small wl-by', 'Bu not, bağlantıyı gönderen kişi tarafından yazıldı.'));
  return c;
}
const paint = (node, d) => {
  const p = d?.color && W.PALETTE[d.color];
  if (p) { node.style.setProperty('--accent', p.accent); node.style.setProperty('--accent-ink', p.ink); }
  else { node.style.removeProperty('--accent'); node.style.removeProperty('--accent-ink'); }
};

export function setupWelcome({ notify, onHash } = {}) {
  const card = $('#welcome'), maker = $('#welcome-make');
  const openBtn = $('#wl-open'), makeBtn = $('#wl-make-btn'), paste = $('#wl-paste');
  const metaTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const orig = { title: document.title, meta: metaTitle?.getAttribute('content') || document.title };
  let stored = storedWelcome();
  let keep = '';            // adreste tutulan 'g=...' (yalnız Apple Safari sekmesinde, geçerli bağlantıyla)
  let prevKeep = '';        // değiştirme sorusu açılırken adreste olan eski 'g=...' ("Eskisi kalsın" onu geri yazar)
  let manifest = null;      // iOS / macOS Safari'de kaldırılan <link rel="manifest"> (geri takmak için)
  let fresh = null;         // bağlantıyla gelen, kartta gösterilen ama henüz kabul edilmemiş not ("Başla" saklar)
  let view = 'card', pending = null, pendingFromHash = false, manage = false, armed = false, saveFailed = false;

  // ---------- görünüm: renk, başlık, Hakkında düğmesi ----------
  function look(d) {
    paint(document.documentElement, d);
    document.title = d?.title || orig.title;
    metaTitle?.setAttribute('content', d?.title || orig.meta);
    const row = openBtn?.closest('.wl-mine-row'); if (row) row.hidden = !d;
  }
  look(stored);
  if (makeBtn && native()) makeBtn.hidden = true;   // uygulama kabuğunun adresi (https://localhost) başka cihazda açılmaz

  // ---------- adres ----------
  // iOS ana ekran / macOS Dock yer imi bu sayfanın adresini alsın diye manifest bağlantısı kaldırılır (yalnız iOS ve
  // macOS Safari, yalnız kişisel bağlantıyla açılmış sekme: keep yalnız orada dolu). Gerçek cihazda sınanamadı;
  // işlemezse yapıştırma yolu kalır.
  function setManifest(on) {
    if (on && manifest) { document.head.appendChild(manifest); manifest = null; }
    else if (!on && !manifest) { const m = document.querySelector('link[rel="manifest"]'); if (m) { manifest = m; m.remove(); } }
  }
  function setKeep(k, sync = true) {
    keep = k;
    setManifest(!k);
    const rest = W.hashWithout(location.hash), h = [k, rest].filter(Boolean).join('&');
    if (h !== location.hash.replace(/^#/, '')) {
      try { history.replaceState(history.state, '', h ? '#' + h : location.pathname + location.search); } catch { /* file:// vb. */ }
    }
    if (sync) onHash?.();   // hashchange yolunda main.js bağlantıyı kendisi uygular (syncHash adresi erken yazmasın)
  }

  // ---------- kayıt ----------
  function save(d) {
    try { localStorage.setItem(W.STORE_KEY, W.storedText(d)); saveFailed = false; } catch { saveFailed = true; }
    stored = d; look(d);
  }
  function removeStored() {
    try { localStorage.removeItem(W.STORE_KEY); } catch { /* depolama kapalı */ }
    stored = null; look(null);
    if (keep) setKeep('');
  }

  // ---------- karşılama kartı ----------
  function renderCard() {
    card.replaceChildren();
    const x = button('×', 'close', 'wl-x'); x.setAttribute('aria-label', 'Kapat'); x.title = 'Kapat (Esc)';
    const body = el('div', 'wl-body');
    card.append(x, body);
    if (view === 'replace' && pending) {
      paint(card, null);
      body.append(el('p', 'wl-kicker', 'Kişisel bağlantı'));
      const p = el('p', 'wl-text');
      p.append('Bu cihazda zaten bir kişisel not var (', el('b', '', `${stored?.to || ''} için`), '). Bu bağlantıdaki notla (', el('b', '', `${pending.to} için`), ') değiştirilsin mi?');
      body.append(p);
      const row = el('div', 'wl-row');
      row.append(button('Değiştir', 'replace', 'pri'), button('Eskisi kalsın', 'keep-old'));
      body.append(row);
      return;
    }
    const d = manage ? stored : (fresh || stored); if (!d) return;
    paint(card, d);   // kabul edilene kadar yalnız kart boyanır; renk ve başlık "Başla" ile gelir
    body.append(cardNode(d));
    if (!manage && isIOSSafari() && !inApp()) {
      body.append(el('p', 'wl-hint', 'iPhone ya da iPad\'de ana ekrana eklemek istersen bunu tam bu sayfadan yap: Paylaş › "Ana Ekrana Ekle". Ana ekrandaki uygulama Safari\'nin kayıtlarını görmez; bu not ona yalnız bu sayfanın adresiyle taşınır. Not orada görünmezse uygulamada ⓘ › "Kişisel bağlantın var mı?" alanına bu bağlantıyı yapıştır.'));
    } else if (!manage && isMacSafari() && !inApp()) {
      body.append(el('p', 'wl-hint', 'Mac\'te Dock\'a eklemek istersen bunu tam bu sayfadan yap: Safari › Dosya › "Dock\'a Ekle". Dock\'taki uygulama Safari\'nin kayıtlarını görmez. Not orada görünmezse uygulamada ⓘ › "Kişisel bağlantın var mı?" alanına bu bağlantıyı yapıştır.'));
    }
    if (saveFailed) body.append(el('p', 'wl-hint', 'Bu cihazın tarayıcı depolaması kapalı: not yalnız bu açılışta görünür.'));
    const row = el('div', 'wl-row');
    row.append(button(manage ? 'Tamam' : 'Başla', 'start', 'pri'));
    body.append(row);
    if (manage) {
      if (!armed) body.append(button('Bu cihazdan kaldır', 'arm', 'wl-link-danger'));
      else {
        body.append(el('p', 'wl-hint warn', 'Not, renk ve uygulama adı bu cihazdan silinir. Bağlantı yeniden açılırsa geri gelir.'));
        const r2 = el('div', 'wl-row');
        r2.append(button('Kaldır', 'remove', 'danger'), button('Vazgeç', 'disarm'));
        body.append(r2);
      }
    }
  }
  function openCard(v, { asManager = false } = {}) {
    view = v; manage = asManager; armed = false;
    renderCard();
    if (!card.open) card.showModal();
    (card.querySelector('.wl-row .pri') || card.querySelector('button'))?.focus();
  }
  function decline() {
    pending = null;
    if (pendingFromHash) setKeep(prevKeep);   // eski notun bağlantısı adreste kalır (yalnız Apple Safari'de dolu)
    pendingFromHash = false; prevKeep = '';
  }
  card?.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'start' && fresh && !manage) {
      // kişiselleştirme yalnız burada saklanır ve uygulanır (×, Esc ya da Geri: hiçbir şey saklanmaz)
      const d = fresh; fresh = null; save(d);
      if (saveFailed) notify?.('Bu cihazın tarayıcı depolaması kapalı: not yalnız bu açılışta görünür.');
    }
    if (a === 'close' || a === 'start') { card.close(); return; }
    if (a === 'replace') {
      const d = pending; pending = null; pendingFromHash = false;
      if (d) save(d);
      openCard('card');
      return;
    }
    if (a === 'keep-old') { decline(); card.close(); return; }
    if (a === 'arm') { armed = true; renderCard(); card.querySelector('[data-a=disarm]')?.focus(); return; }
    if (a === 'disarm') { armed = false; renderCard(); card.querySelector('[data-a=arm]')?.focus(); return; }
    if (a === 'remove') { removeStored(); card.close(); notify?.('Kişisel not bu cihazdan kaldırıldı'); }
  });
  card?.addEventListener('close', () => {
    if (view === 'replace' && pending) decline();   // Esc, Geri ya da ×: eski not kalır
    fresh = null;                                   // kabul edilmeyen yeni not unutulur (adresteyse yeniden yüklemede gelir)
    view = 'card'; manage = false; armed = false;
    card.replaceChildren();
  });

  // ---------- bağlantıyı uygula (adres ya da yapıştırma) ----------
  // { ok, error }: geçersiz bağlantı yok sayılır (adresten gelende kısa bir uyarı)
  function handle(payload, source) {
    const r = W.decode(payload);
    if (!r.ok) return r;
    const d = r.data;
    if (stored && W.same(stored, d)) {
      // aynı not zaten bu cihazda: kart kendiliğinden yeniden açılmaz (yeniden yükleme); yapıştırınca gösterilir
      look(stored);
      if (source === 'paste') openCard('card', { asManager: true });
      return r;
    }
    if (stored) { pending = d; pendingFromHash = source === 'hash'; prevKeep = keep; openCard('replace'); return r; }
    fresh = d;          // "Başla"ya kadar depolamaya yazılmaz, renk ve başlık değişmez
    openCard('card');
    return r;
  }
  function fromHash(hash, sync = true) {
    const payload = W.payloadFromHash(hash);
    if (payload == null) { if (keep) setKeep('', sync); return; }
    if (keep === 'g=' + payload) return;
    const r = handle(payload, 'hash');
    if (!r.ok) { notify?.('Kişisel bağlantı açılamadı: ' + r.error); setKeep('', sync); return; }
    // Apple Safari sekmesinde bağlantı adreste kalır; öteki tarayıcılarda, kurulu uygulamada ve Android kabuğunda tüketilir
    setKeep(keepFragment() ? 'g=' + payload : '', sync);
  }

  // ---------- Hakkında: sana özel not, oluştur, yapıştır ----------
  openBtn?.addEventListener('click', () => { if (stored) openCard('card', { asManager: true }); });
  makeBtn?.addEventListener('click', () => openMaker());
  if (paste) {
    const input = paste.querySelector('input'), go = paste.querySelector('[data-a=apply]'), msg = paste.querySelector('.wl-paste-msg');
    const say = t => { msg.textContent = t || ''; msg.hidden = !t; };
    const apply = () => {
      const payload = W.payloadFromText(input.value);
      if (!payload) { say('Bu bir kişisel bağlantı değil: içinde "#g=" olan bağlantının tamamını yapıştır.'); input.focus(); return; }
      const r = handle(payload, 'paste');
      if (!r.ok) { say(r.error); input.focus(); return; }
      say(''); input.value = '';
    };
    go?.addEventListener('click', apply);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    input?.addEventListener('input', () => say(''));
  }

  // ---------- bağlantı oluşturma ----------
  const FIELDS = [
    ['to', 'Kime', 'text', 'Bağlantının kimin için olduğu (gerekli)'],
    ['from', 'Kimden', 'text', 'İsteğe bağlı'],
  ];
  let makerOut = '';
  function openMaker() {
    maker.replaceChildren();
    const head = el('div', 'wl-head');
    const h = el('h2', '', 'Birine özel bağlantı'); h.id = 'wl-make-title';
    const x = button('×', 'close', 'wl-x'); x.setAttribute('aria-label', 'Kapat'); x.title = 'Kapat (Esc)';
    head.append(h, x);
    const body = el('div', 'wl-body');
    body.append(el('p', 'wl-text', 'Bir kişi için kısa bir not yaz: bağlantıyı açan kişi uygulamayı önce bu kartla görür. Not, renk ve uygulama adı onun cihazında saklanır.'));
    const form = el('form', 'wl-form'); form.noValidate = true; form.autocomplete = 'off';
    const field = (name, label, type, hint) => {
      const l = el('label', 'wl-field'); l.append(el('span', '', label));
      const i = el('input'); i.name = name; i.type = type; i.spellcheck = false; i.autocomplete = 'off';
      if (hint) i.placeholder = hint;
      l.append(i); return l;
    };
    for (const [n, l, t, hint] of FIELDS) form.append(field(n, l, t, hint));
    const ml = el('label', 'wl-field'); const mh = el('span', 'wl-field-top');
    const counter = el('small', 'wl-count'); mh.append(el('span', '', 'Not'), counter); ml.append(mh);
    const ta = el('textarea'); ta.name = 'msg'; ta.rows = 5; ml.append(ta); form.append(ml);
    form.append(field('date', 'Tarih', 'date', ''));
    const fs = el('fieldset', 'wl-colors'); fs.append(el('legend', '', 'Renk'));
    for (const k of W.COLOR_KEYS) {
      const p = W.PALETTE[k], lab = el('label', 'wl-swatch'); lab.title = p.label;
      const r = el('input'); r.type = 'radio'; r.name = 'color'; r.value = k; r.checked = k === W.DEFAULT_COLOR;
      r.setAttribute('aria-label', p.label);
      const s = el('span'); s.style.background = p.accent;
      lab.append(r, s); fs.append(lab);
    }
    form.append(fs);
    const tl = field('title', 'Uygulama adı', 'text', orig.title);
    tl.append(el('small', 'wl-small', 'İsteğe bağlı: sayfanın başlığı olur ve ana ekrana eklerken önerilen ad.'));
    form.append(tl);
    body.append(form);
    body.append(el('p', 'wl-small', 'Yazdıkların hiçbir yerde saklanmaz ve hiçbir yere gönderilmez; bağlantı yalnız bu sayfada oluşturulur.'));
    body.append(el('h3', '', 'Önizleme'));
    const prev = el('div', 'wl-preview'); body.append(prev);
    body.append(el('h3', '', 'Bağlantı'));
    const status = el('p', 'wl-small wl-status'); status.setAttribute('aria-live', 'polite');
    const out = el('textarea', 'wl-out'); out.readOnly = true; out.rows = 3; out.setAttribute('aria-label', 'Oluşan bağlantı');
    const row = el('div', 'wl-row'); const copy = button('Kopyala', 'copy', 'pri'); const len = el('small', 'wl-len');
    row.append(copy, len);
    body.append(status, out, row);
    body.append(el('p', 'wl-small', 'Bağlantıyı açan kişi iPhone, iPad ya da Mac\'te Safari kullanıyorsa ana ekrana ya da Dock\'a eklemeyi bağlantıyla açılan sayfadan yapmalı; kart bunu ona söyler. Olmazsa ⓘ › "Kişisel bağlantın var mı?" alanına bağlantıyı yapıştırabilir.'));
    maker.append(head, body);

    const update = () => {
      const v = n => form.elements[n]?.value ?? '';
      const data = { to: v('to'), from: v('from'), msg: v('msg'), date: v('date'), color: form.querySelector('input[name=color]:checked')?.value || '', title: v('title') };
      const n = W.cpLength(W.cleanText(data.msg));
      counter.textContent = `${n} / ${W.LIMITS.msg}`;
      counter.classList.toggle('over', n > W.LIMITS.msg);
      prev.replaceChildren(cardNode({ ...data, to: W.cleanLine(data.to) || 'Kime', msg: W.cleanText(data.msg), from: W.cleanLine(data.from), date: W.isDate(data.date) ? data.date : '' }));
      paint(prev, W.isColor(data.color) ? data : null);
      try {
        if (!W.cleanLine(data.to)) throw Object.assign(new Error('Bağlantı için Kime alanını doldur.'), { soft: true });
        makerOut = W.buildLink(location.href, data);
        out.value = makerOut; copy.disabled = false; len.textContent = `${makerOut.length} karakter`;
        status.textContent = ''; status.classList.remove('err');
      } catch (e) {
        makerOut = ''; out.value = ''; copy.disabled = true; len.textContent = '';
        status.textContent = e.message; status.classList.toggle('err', !e.soft);
      }
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', e => e.preventDefault());
    update();
    if (!maker.open) maker.showModal();
    form.elements.to?.focus();
  }
  async function copyLink() {
    const out = maker.querySelector('.wl-out'); if (!out || !makerOut) return;
    try { await navigator.clipboard.writeText(makerOut); notify?.('Bağlantı kopyalandı'); return; } catch { /* izin yok: seçip eski yolla */ }
    out.focus(); out.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    if (done) notify?.('Bağlantı kopyalandı');
    else { const s = maker.querySelector('.wl-status'); if (s) { s.textContent = 'Kopyalanamadı: bağlantı seçili, elle kopyala.'; s.classList.add('err'); } }
  }
  maker?.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'close') maker.close();
    else if (a === 'copy') copyLink();
  });
  // yazılanlar kapalı pencerenin DOM'unda kalmasın
  maker?.addEventListener('close', () => { makerOut = ''; maker.replaceChildren(); });

  // ---------- açılış ----------
  if (card) fromHash(location.hash);

  // Geri tuşu (main.js topLayer): "Bu cihazdan kaldır" onayındaysa önce karta döner; true dönerse pencere açık kalır
  function back() {
    if (!card?.open || !armed) return false;
    armed = false; renderCard();
    return true;
  }

  return {
    hashParam: () => keep,                       // main.js syncHash adresin başına ekler
    onHashChange: hash => { try { fromHash(hash, false); } catch (err) { console.error(err); } },
    stored: () => stored,
    back,
  };
}
