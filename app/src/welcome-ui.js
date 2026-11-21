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
  function renderCard() {
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
      if (saveFailed) notify?.('Bu cihazın tarayıcı depolaması kapalı: not yalnız bu açılışta görünür.');
    }
    if (a === 'close' || a === 'start') { card.close(); return; }
    if (a === 'replace') {
      const rec = pending; pending = null; pendingFromHash = false;
      if (rec) save(rec);
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
    const signed = W.payloadFromHash(hash);
    if (signed == null) { seq++; if (keep) setKeep('', sync); return; }
    if (keep === 'g=' + signed) return;
    const my = ++seq;
    const r = await W.verifyLink(signed);
    if (my !== seq) return;   // bu arada başka bir bağlantı geldi
    // Geçersiz bağlantı: hep aynı kısa uyarı. crypto.subtle yoksa (güvensiz bağlam) bağlantı sessizce yok sayılır.
    if (!r.ok) { if (r.code !== 'nocrypto') notify?.(W.INVALID); setKeep('', sync); return; }
    show(r, 'hash');
    // Apple Safari sekmesinde bağlantı adreste kalır; öteki tarayıcılarda, kurulu uygulamada ve Android kabuğunda tüketilir
    setKeep(keepFragment() ? 'g=' + signed : '', sync);
  }

  // ---------- Hakkında: sana özel not, yapıştır ----------
  openBtn?.addEventListener('click', () => { if (stored) openCard('card', { asManager: true }); });
  if (paste) {
    const input = paste.querySelector('input'), go = paste.querySelector('[data-a=apply]'), msg = paste.querySelector('.wl-paste-msg');
    const say = t => { msg.textContent = t || ''; msg.hidden = !t; };
    let busy = false;
    const apply = async () => {
      if (busy) return;
      const signed = W.payloadFromText(input.value);
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
  if (card) ready.then(() => fromHash(startHash)).catch(err => console.error(err));

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
