// Kişisel bağlantı ("sana özel not"): karşılama kartı (#welcome) ve Hakkında penceresindeki girişler ("Sana özel not",
// en sonda küçük "Kişisel bağlantın var mı?" yapıştırma alanı). Mantık (imza denetimi, çözme, renk paleti)
// src/welcome.js'tedir. Uygulamada bağlantı OLUŞTURAN kod yoktur: bağlantıyı yalnız yayının özel anahtarına sahip olan
// kişi yapar (özel depodaki komut satırı aracı); uygulama yalnız açık anahtarla imzayı denetler.
// Bağlantı: sitenin adresi + #g=<yük>.<imza>. İmzası doğrulanan bir bağlantı açılınca kart gösterilir; kişi "Başla"ya
// basınca (önce değil) imzalı bağlantı bu cihazda saklanır (localStorage anatomi3d.welcome.v1) ve her okunuşta imzası
// yeniden denetlenir: vurgu rengi (CSS değişkenleri --accent / --accent-ink), isteğe bağlı uygulama adı (sayfa başlığı
// ve apple-mobile-web-app-title, böylece "Ana Ekrana Ekle" o adı önerir) ve kartın Hakkında'dan yeniden açılması.
// Geçersiz (imzasız, başka anahtarla imzalı, değiştirilmiş, eski biçimli) bağlantılar hep aynı kısa iletiyle yok sayılır.
// Bağlantı açmayan bir ziyaretçi için hiçbir şey değişmez: depolamaya yazılmaz, soru sorulmaz.
// Bütün metinler textContent ile yazılır (HTML olarak asla). Pencere index.html'de durur; main.js'teki Geri tuşu
// katmanı (topLayer) onu da kapatır. Satır içi betik ya da olay özniteliği yoktur (Pages derlemesinin sıkı CSP'si).
// Açılış şeridi: saklanan not bir gün sayacı (since) ya da mesaj kaynağı (feed + fk) taşıyorsa uygulama her açılışta
// 30 saniye üstte küçük bir şerit gösterir: "Birlikte N. gün" ve bağlantı sahibinin en son yazdığı mesaj (GitHub Gist'ten
// şifreli okunur, src/welcome.js openFeed; ağ yoksa son okunan mesaj, localStorage anatomi3d.welcome.feed).
// Mektup: bağlantıyla gelen yeni not, kart yerine tam ekran bir zarfla açılır; zarfa dokununca kapak açılır, kâğıt
// çıkar ve not kâğıtta okunur. Bağlantıda "ask" varsa kâğıdın altında Evet / Hayır çıkar (Hayır her basışta küçülür,
// sonunda kaybolur; Evet kalp yağmuru ve "Başla"). Hakkında'dan yeniden açılan not eski kart görünümündedir.
// İmza denetimi eşzamansızdır (crypto.subtle.verify); sonuçlar sıra numarasıyla eşlenir, eskimiş bir denetim yok sayılır.
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

// Cihazda saklanan ve imzası DOĞRULANMIŞ kişisel not (yoksa, bozuksa ya da denetim henüz bitmediyse null).
// Yalnız okur; doğrulama setupWelcome içinde açılışta yapılır.
let verified = null;
export function storedWelcome() { return verified?.data || null; }
const readStored = () => { try { return W.parseStored(localStorage.getItem(W.STORE_KEY)); } catch { return null; } };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (text, act, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.dataset.a = act; return b; };

// Kartın kendisi. Bütün metinler textContent.
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
// ---------- mektup ----------
function envelopeNode(d) {
  const scene = el('div', 'wlx-scene');
  const env = el('button', 'wlx-env'); env.type = 'button'; env.dataset.a = 'envelope';
  env.setAttribute('aria-label', `${d.to} için mektup. Açmak için dokun.`);
  env.append(el('span', 'wlx-back'), el('span', 'wlx-peek'), el('span', 'wlx-front'), el('span', 'wlx-flap'), el('span', 'wlx-seal', '♥'));
  const to = el('p', 'wlx-to', `${d.to} için`);
  scene.append(to, env, el('p', 'wlx-hint', 'Açmak için zarfa dokun'));
  return scene;
}
function paperNode(d) {
  const paper = el('div', 'wlx-paper');
  paper.append(el('p', 'wlx-dear', `${d.to},`));
  if (d.msg) paper.append(el('p', 'wlx-msg', d.msg));
  const sign = [d.from || '', d.date ? W.dateText(d.date) : ''].filter(Boolean).join(' · ');
  if (sign) paper.append(el('p', 'wlx-sign', '— ' + sign));
  const row = el('div', 'wlx-row');
  if (d.ask) row.append(button('Evet', 'yes', 'wlx-yes'), button('Hayır', 'no', 'wlx-no'));
  else row.append(button('Başla', 'start', 'wlx-yes'));
  paper.append(row);
  return paper;
}
const NO_TEXT = ['Hayır', 'Emin misin?', 'Bir daha düşün', 'Gerçekten mi?', 'Son kararın mı?'];
function hearts(host) {
  const box = el('div', 'wlx-hearts'); box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 32; i++) {
    const h = el('span', 'wlx-heart', '♥');
    h.style.left = ((i * 37) % 100) + '%';
    h.style.animationDelay = ((i * 0.13) % 2.4).toFixed(2) + 's';
    h.style.animationDuration = (3.2 + (i % 5) * 0.45).toFixed(2) + 's';
    h.style.fontSize = (16 + (i * 7) % 26) + 'px';
    box.append(h);
  }
  host.append(box);
}

// yukarıdan yağan çiçekler (emoji, CSS ile düşer ve sallanır)
const FLOWERS = ['🌸', '🌷', '🌹', '🌼', '💮', '🌺'];
function flowers(host) {
  const box = el('div', 'wlx-flowers'); box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 28; i++) {
    const f = el('span', 'wlx-flower', FLOWERS[i % FLOWERS.length]);
    f.style.left = ((i * 29 + 7) % 100) + '%';
    f.style.animationDelay = ((i * 0.23) % 4).toFixed(2) + 's';
    f.style.animationDuration = (5 + (i % 6) * 0.7).toFixed(2) + 's';
    f.style.fontSize = (18 + (i * 5) % 16) + 'px';
    box.append(f);
  }
  host.append(box);
}
// sağdan ve soldan havai fişek: alt köşelerden çıkan roketler patlayıp renkli kıvılcımlara dağılır (canvas)
function fireworks(host, accent) {
  const cv = el('canvas', 'wlx-fireworks'); cv.setAttribute('aria-hidden', 'true');
  host.append(cv);
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const COLORS = [accent, '#ff5d8f', '#ffd166', '#7bdff2', '#b9fbc0', '#cdb4ff', '#ffffff'];
  let w = 0, h = 0, dpr = 1;
  const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size();
  const rockets = [], sparks = [];
  let side = 0, last = 0, t0 = performance.now();
  const launch = () => {
    const left = side++ % 2 === 0;
    const x = left ? w * (0.04 + Math.random() * 0.1) : w * (0.86 + Math.random() * 0.1);
    const tx = left ? w * (0.15 + Math.random() * 0.3) : w * (0.55 + Math.random() * 0.3);
    const ty = h * (0.12 + Math.random() * 0.3);
    const frames = 55 + Math.random() * 20;
    rockets.push({ x, y: h + 10, vx: (tx - x) / frames, vy: (ty - h - 10) / frames, n: frames, c: COLORS[(Math.random() * COLORS.length) | 0] });
  };
  const burst = (x, y, c) => {
    const n = 70 + ((Math.random() * 30) | 0), c2 = COLORS[(Math.random() * COLORS.length) | 0];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = 2 + Math.random() * 3.2;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, fade: 0.008 + Math.random() * 0.01, c: i % 3 ? c : c2 });
    }
  };
  const tick = now => {
    if (!cv.isConnected) return;
    if (cv.clientWidth !== w || cv.clientHeight !== h) size();
    if (now - last > 650 && now - t0 < 20000) { last = now; launch(); }
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const q = rockets[i]; q.x += q.vx; q.y += q.vy; q.n--;
      ctx.fillStyle = q.c; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, 7); ctx.fill();
      if (q.n <= 0) { burst(q.x, q.y, q.c); rockets.splice(i, 1); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const k = sparks[i]; k.vx *= 0.985; k.vy = k.vy * 0.985 + 0.045; k.x += k.vx; k.y += k.vy; k.life -= k.fade;
      if (k.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = k.life; ctx.fillStyle = k.c; ctx.beginPath(); ctx.arc(k.x, k.y, 1.8, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (now - t0 < 20000 || rockets.length || sparks.length) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(tick);
}

const paint = (node, d) => {
  const p = d?.color && W.PALETTE[d.color];
  if (p) { node.style.setProperty('--accent', p.accent); node.style.setProperty('--accent-ink', p.ink); }
  else { node.style.removeProperty('--accent'); node.style.removeProperty('--accent-ink'); }
};

export function setupWelcome({ notify, onHash } = {}) {
  const card = $('#welcome');
  const openBtn = $('#wl-open'), paste = $('#wl-paste');
  const metaTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const orig = { title: document.title, meta: metaTitle?.getAttribute('content') || document.title };
  // stored / fresh / pending: { data, signed } (imzası doğrulanmış)
  let stored = null;
  let keep = '';            // adreste tutulan 'g=...' (yalnız Apple Safari sekmesinde, geçerli bağlantıyla)
  let prevKeep = '';        // değiştirme sorusu açılırken adreste olan eski 'g=...' ("Eskisi kalsın" onu geri yazar)
  let manifest = null;      // iOS / macOS Safari'de kaldırılan <link rel="manifest"> (geri takmak için)
  let fresh = null;         // bağlantıyla gelen, kartta gösterilen ama henüz kabul edilmemiş not ("Başla" saklar)
  let view = 'card', pending = null, pendingFromHash = false, manage = false, armed = false, saveFailed = false;
  let seq = 0;              // son başlatılan bağlantı denetimi (eskimiş sonuçlar yok sayılır)

  // ---------- görünüm: renk, başlık, Hakkında düğmesi ----------
  function look(d) {
    paint(document.documentElement, d);
    document.title = d?.title || orig.title;
    metaTitle?.setAttribute('content', d?.title || orig.meta);
    const row = openBtn?.closest('.wl-mine-row'); if (row) row.hidden = !d;
  }

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
  function save(rec) {
    try { localStorage.setItem(W.STORE_KEY, W.storedText(rec.signed)); saveFailed = false; } catch { saveFailed = true; }
    stored = rec; verified = rec; look(rec.data);
  }
  function removeStored() {
    try { localStorage.removeItem(W.STORE_KEY); } catch { /* depolama kapalı */ }
    stored = null; verified = null; look(null);
    if (keep) setKeep('');
  }

  // ---------- karşılama kartı ----------
  let noCount = 0;
  function renderLetter(d, stage) {
    card.replaceChildren();
    card.classList.add('wl-letter');
    paint(card, d);
    if (stage === 'envelope') { card.append(envelopeNode(d)); return; }
    if (stage === 'paper') { noCount = 0; card.append(paperNode(d)); return; }
    // evet: kalpler, kısa yazı, (Apple'da) ana ekran ipucu ve Başla
    const accent = (d.color && W.PALETTE[d.color]?.accent) || W.PALETTE[W.DEFAULT_COLOR].accent;
    if (!mq('(prefers-reduced-motion: reduce)')) { fireworks(card, accent); flowers(card); }
    hearts(card);
    const done = el('div', 'wlx-paper wlx-done');
    done.append(el('p', 'wlx-big', '♥'), el('p', 'wlx-dear', 'Evet!'));
    if (isIOSSafari() && !inApp()) done.append(el('p', 'wl-hint', 'Bunu ana ekranına eklemek için tam bu sayfadan: Paylaş › "Ana Ekrana Ekle". Ana ekrandaki uygulama, her açılışta seni bekleyen küçük notları gösterir.'));
    else if (isMacSafari() && !inApp()) done.append(el('p', 'wl-hint', 'Mac\'te Dock\'a eklemek için tam bu sayfadan: Safari › Dosya › "Dock\'a Ekle".'));
    if (saveFailed) done.append(el('p', 'wl-hint', 'Bu cihazın tarayıcı depolaması kapalı: not yalnız bu açılışta görünür.'));
    const row = el('div', 'wlx-row'); row.append(button('Başla', 'start', 'wlx-yes'));
    done.append(row);
    card.append(done);
  }
  function renderCard() {
    card.classList.remove('wl-letter');
    if (view === 'card' && !manage && fresh) { renderLetter(fresh.data, 'envelope'); return; }
    card.replaceChildren();
    const x = button('×', 'close', 'wl-x'); x.setAttribute('aria-label', 'Kapat'); x.title = 'Kapat (Esc)';
    const body = el('div', 'wl-body');
    card.append(x, body);
    if (view === 'replace' && pending) {
      paint(card, null);
      body.append(el('p', 'wl-kicker', 'Kişisel bağlantı'));
      const p = el('p', 'wl-text');
      p.append('Bu cihazda zaten bir kişisel not var (', el('b', '', `${stored?.data.to || ''} için`), '). Bu bağlantıdaki notla (', el('b', '', `${pending.data.to} için`), ') değiştirilsin mi?');
      body.append(p);
      const row = el('div', 'wl-row');
      row.append(button('Değiştir', 'replace', 'pri'), button('Eskisi kalsın', 'keep-old'));
      body.append(row);
      return;
    }
    const d = (manage ? stored : (fresh || stored))?.data; if (!d) return;
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
      const rec = fresh; fresh = null; save(rec);
      if (keep && !keepFragment()) setKeep('');   // kabul edildi: bağlantı artık adreste durmaz (Apple Safari dışında)
      setTimeout(() => startBanner(rec.data), 400);
      if (saveFailed) notify?.('Bu cihazın tarayıcı depolaması kapalı: not yalnız bu açılışta görünür.');
    }
    if (a === 'close' || a === 'start') { card.close(); return; }
    if (a === 'envelope' && fresh) {
      const scene = card.querySelector('.wlx-scene');
      if (!scene || scene.classList.contains('open')) return;
      scene.classList.add('open');
      const reduce = mq('(prefers-reduced-motion: reduce)');
      setTimeout(() => { if (fresh && card.open) { renderLetter(fresh.data, 'paper'); card.querySelector('.wlx-row button')?.focus({ preventScroll: true }); } }, reduce ? 0 : 1250);
      return;
    }
    if (a === 'no') {
      noCount++;
      const no = card.querySelector('.wlx-no'), yes = card.querySelector('.wlx-yes');
      if (yes) yes.style.transform = `scale(${(1 + noCount * 0.18).toFixed(2)})`;
      if (no) {
        if (noCount >= NO_TEXT.length) no.remove();
        else { no.textContent = NO_TEXT[noCount]; no.style.transform = `scale(${Math.max(0.55, 1 - noCount * 0.1).toFixed(2)})`; }
      }
      return;
    }
    if (a === 'yes' && fresh) { renderLetter(fresh.data, 'yes'); card.querySelector('.wlx-yes')?.focus({ preventScroll: true }); return; }
    if (a === 'replace') {
      // yeni not mektup akışıyla açılır (zarf, Evet / Hayır, şerit); kaydı "Başla" yapar, kapatılırsa eski not kalır
      const rec = pending; pending = null; pendingFromHash = false;
      if (rec) fresh = rec;
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
    card.replaceChildren(); card.classList.remove('wl-letter');
  });

  // ---------- bağlantıyı uygula (adres ya da yapıştırma) ----------
  // İmzası doğrulanmış bağlantı için kartı açar. Dönüş: { ok } ya da { ok: false, code } (geçersiz: W.INVALID).
  function show(r, source) {
    const rec = { data: r.data, signed: r.signed };
    if (stored && W.sameLink(stored.signed, rec.signed)) {
      // aynı not zaten bu cihazda: kart kendiliğinden yeniden açılmaz (yeniden yükleme); yapıştırınca gösterilir
      look(stored.data);
      if (source === 'paste') openCard('card', { asManager: true });
      return;
    }
    if (stored) { pending = rec; pendingFromHash = source === 'hash'; prevKeep = keep; openCard('replace'); return; }
    fresh = rec;          // "Başla"ya kadar depolamaya yazılmaz, renk ve başlık değişmez
    openCard('card');
  }
  async function fromHash(hash, sync = true) {
    // kısa bağlantı (#k=<gist>.<anahtar>): imzalı metin şifreli Gist'ten alınır, sonra uzun bağlantıyla aynı yol
    const short = W.payloadFromHash(hash) == null ? W.shortFromHash(hash) : null;
    if (short != null) {
      if (keep === 'k=' + short && (fresh || pending || stored)) return;
      const my = ++seq;
      const s = W.splitShort(short) && W.cryptoReady() ? await W.resolveShort(short) : null;
      if (my !== seq) return;
      const r = s ? await W.verifyLink(s) : { ok: false };
      if (my !== seq) return;
      if (!r.ok) { notify?.(W.INVALID); setKeep('', sync); return; }
      show(r, 'hash');
      setKeep(keepFragment() || fresh || pending ? 'k=' + short : '', sync);
      return;
    }
    const signed = W.payloadFromHash(hash);
    if (signed == null) { seq++; if (keep) setKeep('', sync); return; }
    // adresin yeniden yazılması (syncHash) aynı bağlantıyı yeniden açmasın; ama kapatılmış, kabul edilmemiş bir not
    // aynı bağlantı yeniden açılınca yeniden gösterilir
    if (keep === 'g=' + signed && (fresh || pending || (stored && W.sameLink(stored.signed, signed)))) return;
    const my = ++seq;
    const r = await W.verifyLink(signed);
    if (my !== seq) return;   // bu arada başka bir bağlantı geldi
    // Geçersiz bağlantı: hep aynı kısa uyarı. crypto.subtle yoksa (güvensiz bağlam) bağlantı sessizce yok sayılır.
    if (!r.ok) { if (r.code !== 'nocrypto') notify?.(W.INVALID); setKeep('', sync); return; }
    show(r, 'hash');
    // Apple Safari sekmesinde bağlantı adreste kalır. Öteki tarayıcılarda, kurulu uygulamada ve Android kabuğunda
    // "Başla"ya (ya da "Eskisi kalsın"a) kadar kalır, sonra tüketilir: kabul edilmemiş not Geri / Esc ya da sekmenin
    // yeniden yüklenmesiyle kaybolmasın (yeniden yüklemede mektup yeniden açılır)
    setKeep(keepFragment() || fresh || pending ? 'g=' + signed : '', sync);
  }

  // ---------- Hakkında: sana özel not, yapıştır ----------
  openBtn?.addEventListener('click', () => { if (stored) openCard('card', { asManager: true }); });
  if (paste) {
    const input = paste.querySelector('input'), go = paste.querySelector('[data-a=apply]'), msg = paste.querySelector('.wl-paste-msg');
    const say = t => { msg.textContent = t || ''; msg.hidden = !t; };
    let busy = false;
    const apply = async () => {
      if (busy) return;
      const short = W.shortFromText(input.value);
      let signed = short ? null : W.payloadFromText(input.value);
      if (short) { busy = true; try { signed = await W.resolveShort(short); } finally { busy = false; } if (!signed) { say(W.INVALID); input.focus(); return; } }
      if (!signed) { say('Bağlantının tamamını yapıştır (içinde "#g=" olan adres).'); input.focus(); return; }
      busy = true;
      try {
        await ready;
        const r = await W.verifyLink(signed);
        if (!r.ok) { say(W.INVALID); input.focus(); return; }
        seq++;   // bekleyen bir adres denetimi bu yapıştırmanın kartını ezmesin
        say(''); input.value = '';
        show(r, 'paste');
      } finally { busy = false; }
    };
    go?.addEventListener('click', apply);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    input?.addEventListener('input', () => say(''));
  }

  // ---------- açılış ----------
  // Saklanan not (varsa) önce imzasıyla yeniden denetlenir; elle değiştirilmiş ya da eski biçimli kayıt yok sayılır
  // (silinmez, yazılmaz). Ardından adresteki bağlantı (varsa) denetlenir.
  const startHash = location.hash;   // main.js adresi denetim bitmeden yeniden yazabilir: açılıştaki parça şimdi alınır
  const ready = (async () => {
    const text = readStored();
    if (text) {
      const r = await W.verifyLink(text);
      if (r.ok) { stored = { data: r.data, signed: r.signed }; verified = stored; look(stored.data); }
    }
  })().catch(err => console.error(err));
  // adresteki bağlantı önce işlenir; kart açılmadıysa (yeni not yoksa) saklanan notun şeridi gösterilir
  if (card) ready.then(() => fromHash(startHash)).then(() => { if (stored && !card.open) startBanner(stored.data); }).catch(err => console.error(err));

  // ---------- açılış şeridi: gün sayacı ve mesaj (30 sn) ----------
  const FEED_CACHE = 'anatomi3d.welcome.feed', BANNER_MS = 30000;
  let bannerRun = 0;
  async function loadFeed(d) {
    if (!d.feed || !W.cryptoReady()) return null;
    let text = null;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(W.feedUrl(d.feed), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) text = W.feedFileFrom(await res.json());
    } catch { /* ağ yok: son okunan mesaj */ }
    if (text) {
      const m = await W.openFeed(text, d.fk);
      if (m.ok) { try { localStorage.setItem(FEED_CACHE, JSON.stringify({ feed: d.feed, text })); } catch { /* depolama kapalı */ } return m; }
    }
    try {
      const c = JSON.parse(localStorage.getItem(FEED_CACHE) || 'null');
      if (c?.feed === d.feed && typeof c.text === 'string') { const m = await W.openFeed(c.text, d.fk); if (m.ok) return m; }
    } catch { /* bozuk önbellek */ }
    return null;
  }
  async function startBanner(d) {
    if (!d || (!d.since && !d.feed)) return;
    // açılışta açık bir modal pencere (ör. kullanıcı şifresi) varsa şerit onun altında tıklanamaz kalırdı: kapanınca göster
    const modal = [...document.querySelectorAll('dialog[open]')].find(x => x !== card);
    if (modal) { modal.addEventListener('close', () => startBanner(d), { once: true }); return; }
    const run = ++bannerRun;
    const counter = W.counterText(d.since);
    const feed = loadFeed(d);
    let msg = null;
    if (!counter) { msg = await feed; if (run !== bannerRun || !msg?.msg) return; }
    $('#wl-banner')?.remove();
    const b = el('div', 'wl-banner'); b.id = 'wl-banner'; b.setAttribute('role', 'status');
    paint(b, d);
    const x = button('×', 'close', 'wl-x'); x.setAttribute('aria-label', 'Kapat'); x.title = 'Kapat';
    const body = el('div', 'wl-banner-body');
    if (counter) body.append(el('p', 'wl-banner-count', counter));
    const text = el('p', 'wl-banner-msg'); text.hidden = true;
    const sign = el('p', 'wl-banner-sign'); sign.hidden = true;
    body.append(text, sign);
    const bar = el('div', 'wl-banner-bar'); bar.style.animationDuration = BANNER_MS + 'ms';
    b.append(x, body, bar);
    const fill = m => {
      if (!m?.msg || !b.isConnected) return;
      text.textContent = m.msg; text.hidden = false;
      const who = [d.from || '', m.at ? W.dateText(m.at.slice(0, 10)) : ''].filter(Boolean).join(' · ');
      if (who) { sign.textContent = '— ' + who; sign.hidden = false; }
    };
    fill(msg);
    document.body.append(b);
    requestAnimationFrame(() => b.classList.add('on'));
    const close = () => { b.classList.remove('on'); setTimeout(() => b.remove(), 400); };
    x.addEventListener('click', close);
    setTimeout(close, BANNER_MS);
    if (!msg) feed.then(m => { if (run === bannerRun) fill(m); });
  }

  // Geri tuşu (main.js topLayer): "Bu cihazdan kaldır" onayındaysa önce karta döner; true dönerse pencere açık kalır
  function back() {
    if (!card?.open || !armed) return false;
    armed = false; renderCard();
    return true;
  }

  return {
    hashParam: () => keep,                       // main.js syncHash adresin başına ekler
    onHashChange: hash => { ready.then(() => fromHash(hash, false)).catch(err => console.error(err)); },
    stored: () => stored?.data || null,
    ready,
    back,
  };
}
