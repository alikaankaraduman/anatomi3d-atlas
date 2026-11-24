// Kişisel bağlantı ("sana özel not"): saf mantık, DOM'a ve depolamaya dokunmaz (Node da içe aktarabilir:
// tools/_qawork/welcome-test.mjs). Bağlantı, sitenin normal adresi ve bir parçadır:
//   #g=<yük>.<imza>   yük = UTF-8 JSON'un base64url hâli, imza = yükün METNİ (base64url karakterleri, ASCII baytları)
//                      üzerinde ECDSA P-256 / SHA-256 imzası, ham 64 bayt, base64url (86 karakter).
// Parça (#...) sunucuya hiç gitmez; metin yalnız bağlantının içinde ve onu açan cihazda (localStorage) durur.
//
// İmza: bağlantıyı yalnız bu yayının ÖZEL anahtarına sahip olan kişi yapabilir. Uygulamada yalnız AÇIK anahtar vardır
// (PUBLIC_KEY, aşağıda) ve kart yalnız crypto.subtle.verify başarılı olunca gösterilir. İmzasız, başka anahtarla
// imzalanmış, değiştirilmiş ya da eski (imzasız, sürüm 1 biçimli) bağlantılar herhangi bir bozuk bağlantı gibi
// reddedilir: hep aynı kısa ileti (INVALID), imzadan söz edilmez. crypto.subtle olmayan yerde (güvensiz bağlam)
// bağlantılar yok sayılır. Bağlantı oluşturan kod tarayıcı paketinde yoktur (tools/welcome-sign.mjs, yalnız Node).
//
// JSON: { v: 1, to, from?, msg?, date?, color?, title?, since?, feed?, fk?, ask? }. Okuma katıdır: çözmeden önce boyut sınırı, bilinen alanlar
// tür ve uzunluk denetimiyle, bilinmeyen alanlar yok sayılır, __proto__ / constructor / prototype anahtarı olan bağlantı
// geçersizdir. Metinler düz metindir; ekrana yalnız textContent ya da esc() ile yazılır, asla HTML olarak değil.

// Bu yayının AÇIK anahtarı (ECDSA P-256, JWK). Özel anahtar hiçbir depoda değildir (sahibinin bilgisayarında,
// app/private/welcome-key.json). Bu kodu kendi yayını için kullanan biri kendi kişisel bağlantılarını yapmak isterse
// kendi ECDSA P-256 anahtar çiftini üretir ve bu sabiti kendi açık anahtarıyla değiştirir.
export const PUBLIC_KEY = Object.freeze({
  kty: 'EC', crv: 'P-256',
  x: 'ru3r2p9vZIN5YbLt0YJhMGVSr5GEfIfsSZgm38VgRl0',
  y: 'PAw9mydfiI3cDo4KV_KvXooQqIyAh8_Klame4xn2sgs',
});

export const VERSION = 1;
export const STORE_KEY = 'anatomi3d.welcome.v1';
export const STORE_VERSION = 2;    // { v: 2, link: '<yük>.<imza>', saved } (sürüm 1: imzasız veri, artık okunmaz)
// Her geçersiz bağlantı için aynı ileti (neden geçersiz olduğu söylenmez)
export const INVALID = 'Kişisel bağlantı açılamadı.';
// uzunluklar karakter (kod noktası) sayısıdır: bir emoji bir karakter sayılır
export const LIMITS = Object.freeze({ to: 40, from: 40, msg: 1500, title: 30 });
// base64url yükünün en çok uzunluğu (çözmeden önce denetlenir). En kötü durum: 1500 karakterlik not, her biri 4 bayt
// ya da JSON'da kaçışlı tırnak; ad alanları ve öteki alanlarla birlikte ~6500 bayt, base64 ile ~8700 karakter.
export const PAYLOAD_MAX = 9200;
export const SIG_LEN = 86;         // 64 bayt base64url
export const LINK_MAX = PAYLOAD_MAX + 1 + SIG_LEN;

// Vurgu renkleri: anahtar bağlantıya yazılır, değerler yalnız buradadır (bağlantıdan renk kodu okunmaz).
// accent: düğmeler ve vurgular (--accent), ink: vurgu zemini üstündeki yazı (--accent-ink).
export const DEFAULT_COLOR = 'mavi';
export const PALETTE = Object.freeze(Object.assign(Object.create(null), {
  mavi: Object.freeze({ label: 'Mavi', accent: '#19c8f5', ink: '#06222b' }),
  yesil: Object.freeze({ label: 'Yeşil', accent: '#3ddc97', ink: '#062a1a' }),
  pembe: Object.freeze({ label: 'Pembe', accent: '#ff86c0', ink: '#3a0a22' }),
  mor: Object.freeze({ label: 'Mor', accent: '#b49cff', ink: '#1d1240' }),
  mercan: Object.freeze({ label: 'Mercan', accent: '#ff8a70', ink: '#3a1208' }),
  turuncu: Object.freeze({ label: 'Turuncu', accent: '#ffb347', ink: '#3a2200' }),
  sari: Object.freeze({ label: 'Sarı', accent: '#f4d35e', ink: '#2e2600' }),
}));
export const COLOR_KEYS = Object.freeze(Object.keys(PALETTE));
export const isColor = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(PALETTE, k);

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const FIELDS = Object.freeze(['to', 'from', 'msg', 'date', 'color', 'title', 'since', 'feed', 'fk', 'ask']);
// ask: "1" ise mektubun altında Evet / Hayır çıkar (cevap hiçbir yere gönderilmez)
// since: sayacın başlangıcı (YYYY-MM-DD ya da YYYY-MM-DDTHH:MM, cihazın yerel saatiyle). feed + fk: bağlantı sahibinin değiştirebildiği kısa mesajın kaynağı
// (bir GitHub Gist kimliği) ve o mesajın AES-GCM anahtarı (32 bayt, base64url). İkisi de imzalı yükün içindedir:
// mesaj yalnız bu bağlantıyı açan cihazda çözülür, kaynağı bağlantıyı yapan kişiden başkası yönlendiremez.
const FEED_RE = /^[0-9a-f]{20,40}$/;
const FK_RE = /^[A-Za-z0-9_-]{43}$/;

// Görünmeyen ve yön değiştiren karakterler (sıfır genişlikli boşluk, LRM/RLM, yön gömme/geçersiz kılma, BOM, sözcük
// birleştirici) atılır. ZWJ (U+200D) ve ZWNJ (U+200C) kalır: emoji dizileri ve bazı yazı sistemleri onlarla yazılır.
// Eşsiz vekil (lone surrogate, U+D800..DFFF) da atılır: JSON onu 6 baytlık \udXXX olarak yazar, bağlantı PAYLOAD_MAX'ı
// aşıp çözülemez olurdu (kod noktası olarak gezildiği için eşli vekiller tek bir karakterdir ve buraya düşmez).
const STRIP = c => (c >= 0 && c < 32 && c !== 10) || (c >= 127 && c <= 159) || c === 0x200b || c === 0x200e || c === 0x200f
  || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
  || (c >= 0xd800 && c <= 0xdfff);

export const cpLength = s => [...String(s ?? '')].length;

// Tek satırlık metin (ad, uygulama adı): satır sonları boşluk olur, boşluklar tekleşir
export function cleanLine(s) {
  return [...String(s ?? '').normalize('NFC').replace(/[\r\n\t\u2028\u2029]+/g, ' ')]
    .filter(ch => !STRIP(ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim();
}
// Not: satır sonları kalır (\r\n ve \r -> \n), satır içi sekme boşluk olur, satır sonundaki boşluklar atılır,
// art arda en çok iki boş satır kalır
export function cleanText(s) {
  const t = [...String(s ?? '').normalize('NFC').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ')]
    .filter(ch => !STRIP(ch.codePointAt(0))).join('');
  return t.split('\n').map(l => l.replace(/[^\S\n]+$/g, '')).join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

// YYYY-MM-DD, takvimde gerçekten olan bir gün (1900..2200)
export function isDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const fail = (code, message) => ({ ok: false, code, error: message });

// Bir nesneyi denetler ve temiz kopyasını döner: { ok: true, data } ya da { ok: false, code, error } (Türkçe ileti).
// Bilinen alanlarda yanlış tür ya da uzunluk bağlantıyı geçersiz kılar; bilinmeyen alanlar yok sayılır. Bilinmeyen bir
// renk anahtarı (ör. ileride eklenen bir renk) yalnız rengi düşürür: renk süsten ibarettir. Bağlantıyı yapan araç
// (sahibinin özel depodaki komut satırı aracı) da aynı denetimi kullanır; ayrıntılı iletiler yalnız orada görünür, uygulamada INVALID.
export function validate(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('shape', 'Bağlantının içeriği okunamadı.');
  for (const k of Object.keys(o)) if (BAD_KEYS.has(k)) return fail('shape', 'Bağlantının içeriği okunamadı.');
  const own = k => Object.prototype.hasOwnProperty.call(o, k);
  if (own('v') && o.v !== VERSION) return fail('version', 'Bu bağlantı uygulamanın başka bir sürümü için yapılmış.');
  if (!own('v')) return fail('version', 'Bağlantının içeriği okunamadı.');
  for (const k of FIELDS) {
    if (own(k) && o[k] != null && typeof o[k] !== 'string') return fail(k, 'Bağlantının içeriği okunamadı.');
  }
  const str = k => (own(k) && typeof o[k] === 'string' ? o[k] : '');
  const data = {};
  const to = cleanLine(str('to'));
  if (!to) return fail('to', 'Kime alanı boş.');
  if (cpLength(to) > LIMITS.to) return fail('to', `Kime en çok ${LIMITS.to} karakter olabilir.`);
  data.to = to;
  const from = cleanLine(str('from'));
  if (cpLength(from) > LIMITS.from) return fail('from', `Kimden en çok ${LIMITS.from} karakter olabilir.`);
  if (from) data.from = from;
  const msg = cleanText(str('msg'));
  if (cpLength(msg) > LIMITS.msg) return fail('msg', `Not en çok ${LIMITS.msg} karakter olabilir.`);
  if (msg) data.msg = msg;
  const date = str('date').trim();
  if (date && !isDate(date)) return fail('date', 'Tarih geçerli değil.');
  if (date) data.date = date;
  const color = str('color');
  if (isColor(color) && color !== DEFAULT_COLOR) data.color = color;
  const title = cleanLine(str('title'));
  if (cpLength(title) > LIMITS.title) return fail('title', `Uygulama adı en çok ${LIMITS.title} karakter olabilir.`);
  if (title) data.title = title;
  const since = str('since').trim();
  if (since && !isSince(since)) return fail('since', 'Sayaç tarihi geçerli değil.');
  if (since) data.since = since;
  const feed = str('feed'), fk = str('fk');
  if ((feed || fk) && !(FEED_RE.test(feed) && FK_RE.test(fk))) return fail('feed', 'Mesaj kaynağı geçerli değil.');
  if (feed) { data.feed = feed; data.fk = fk; }
  if (str('ask') === '1') data.ask = '1';
  return { ok: true, data };
}

// ---------- base64url ----------
const B64URL = /^[A-Za-z0-9_-]+$/;
export function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s) {
  if (typeof s !== 'string' || !s || !B64URL.test(s) || s.length % 4 === 1) return null;
  let bin;
  try { bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const ascii = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };

// Yükü (imza denetlendikten SONRA) çözer: { ok: true, data } ya da { ok: false, code, error }. Hata fırlatmaz.
export function decodePayload(payload) {
  if (typeof payload !== 'string' || !payload) return fail('empty', 'Bağlantı boş.');
  if (payload.length > PAYLOAD_MAX) return fail('size', 'Bağlantı çok uzun.');
  const bytes = fromB64url(payload);
  if (!bytes) return fail('base64', 'Bağlantı bozuk.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('utf8', 'Bağlantı bozuk.'); }
  let o, bad = false;
  try {
    o = JSON.parse(text, (k, v) => { if (BAD_KEYS.has(k)) bad = true; return v; });
  } catch { return fail('json', 'Bağlantı bozuk.'); }
  if (bad) return fail('shape', 'Bağlantının içeriği okunamadı.');
  return validate(o);
}

// "<yük>.<imza>" metnini parçalar (yalnız biçim: boyut, alfabe, imzanın tam 64 bayt ve kanonik base64url olması;
// son karakterin kullanılmayan bitleri değiştirilmiş bir imza aynı baytlara çözülmesin diye). Değilse null.
export function splitSigned(s) {
  if (typeof s !== 'string' || !s || s.length > LINK_MAX) return null;
  const i = s.indexOf('.');
  if (i <= 0 || i !== s.lastIndexOf('.')) return null;
  const payload = s.slice(0, i), sig = s.slice(i + 1);
  if (payload.length > PAYLOAD_MAX || !B64URL.test(payload) || sig.length !== SIG_LEN) return null;
  const sigBytes = fromB64url(sig);
  if (!sigBytes || sigBytes.length !== 64 || toB64url(sigBytes) !== sig) return null;
  return { payload, sig, sigBytes };
}

const keyCache = new Map();
function importKey(subtle, jwk) {
  const id = jwk.x + '.' + jwk.y;
  if (!keyCache.has(id)) {
    keyCache.set(id, subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
  }
  return keyCache.get(id);
}
export const cryptoReady = () => !!globalThis.crypto?.subtle;

// İmzalı bağlantı metnini ("<yük>.<imza>") denetler ve çözer. Hiçbir zaman hata fırlatmaz.
// { ok: true, data, payload, signed } ya da { ok: false, code, error: INVALID }; crypto.subtle yoksa code 'nocrypto'.
// key: yalnız sınamalar için (varsayılan bu yayının açık anahtarı).
export async function verifyLink(signed, key = PUBLIC_KEY) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fail('nocrypto', INVALID);
  const parts = splitSigned(signed);
  if (!parts) return fail('invalid', INVALID);
  let good = false;
  try {
    good = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importKey(subtle, key), parts.sigBytes, ascii(parts.payload));
  } catch { good = false; }
  if (!good) return fail('invalid', INVALID);
  const r = decodePayload(parts.payload);
  if (!r.ok) return fail('invalid', INVALID);
  return { ok: true, data: r.data, payload: parts.payload, signed };
}

// Adres parçasından g değerini çıkarır ("#g=...&t=..." ya da "#t=...&g=..."); yoksa null
export function payloadFromHash(hash) {
  const parts = String(hash ?? '').replace(/^#/, '').split('&');
  for (const p of parts) if (p.startsWith('g=')) return p.slice(2);
  return null;
}
// Adres parçasından g'yi atar, öteki parçaları olduğu gibi bırakır (kodlamalarına dokunmadan)
export function hashWithout(hash) {
  return String(hash ?? '').replace(/^#/, '').split('&').filter(p => p && !p.startsWith('g=')).join('&');
}
// Yapıştırılan metinden parça: tam adres, "#g=...", "g=..." ya da yalnız "<yük>.<imza>" metni
export function payloadFromText(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  const i = s.indexOf('#');
  if (i >= 0) return payloadFromHash(s.slice(i));
  if (s.startsWith('g=')) return s.slice(2).split('&')[0];
  if (/^[A-Za-z0-9_.-]+$/.test(s) && s.includes('.') && !/^https?:/i.test(s)) return s;
  return null;
}

// Cihazda saklanan kayıt: { v: 2, link: '<yük>.<imza>', saved }. Burada yalnız biçim denetlenir ve imzalı metin
// döner; imza okunduğu her seferde verifyLink ile yeniden denetlenir (depolamayı elle değiştirmek not uyduramaz).
// Bozuk ya da eski (sürüm 1, imzasız) kayıt = kayıt yok.
export function parseStored(text) {
  if (typeof text !== 'string' || !text || text.length > 20000) return null;
  try {
    let bad = false;
    const o = JSON.parse(text, (k, v) => { if (BAD_KEYS.has(k)) bad = true; return v; });
    if (bad || !o || typeof o !== 'object' || o.v !== STORE_VERSION || typeof o.link !== 'string') return null;
    return splitSigned(o.link) ? o.link : null;
  } catch { return null; }
}
export function storedText(signed) {
  return JSON.stringify({ v: STORE_VERSION, link: signed, saved: new Date().toISOString().slice(0, 10) });
}
// İki bağlantı aynı notu mu taşıyor (yük metni aynı; imza aynı içerik için farklı olabilir)
export const sameLink = (a, b) => !!a && !!b && String(a).split('.')[0] === String(b).split('.')[0];

// Tarih metni: "21 Kasım 2026" (saat dilimi kaymasın diye UTC)
export function dateText(s) {
  if (!isDate(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  try { return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return s; }
}

// ---------- gün sayacı ----------
// "YYYY-MM-DD" ya da "YYYY-MM-DDTHH:MM" (00:00..23:59)
export function isSince(s) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(typeof s === 'string' ? s : '');
  return !!m && isDate(m[1]) && (m[2] === undefined || (+m[2] < 24 && +m[3] < 60));
}
// since gününden bugüne (yerel takvim) kaç gün geçti; since bugünse 0, gelecekteyse ya da geçersizse null
export function daysSince(since, now = new Date()) {
  if (!isSince(since)) return null;
  const [y, m, d] = since.slice(0, 10).split('-').map(Number);
  const n = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
  return n >= 0 ? n : null;
}
// Saatli başlangıçtan geçen süre: { days, hours } (yerel saat), gelecekteyse ya da saatsizse null
export function sinceParts(since, now = new Date()) {
  if (!isSince(since) || since.length !== 16) return null;
  const [y, mo, d] = since.slice(0, 10).split('-').map(Number), h = +since.slice(11, 13), mi = +since.slice(14, 16);
  const ms = now - new Date(y, mo - 1, d, h, mi);
  if (!(ms >= 0)) return null;
  return { days: Math.floor(ms / 86400000), hours: Math.floor((ms % 86400000) / 3600000) };
}
// Saatsiz: "Birlikte 412. gün" (since günü 1. gündür). Saatli: "Birlikte 44 gün 15 saat" (başlangıç anından beri)
export function counterText(since, now = new Date()) {
  if (isSince(since) && since.length === 16) {
    const t = sinceParts(since, now);
    if (!t) return '';
    const days = t.days ? `${t.days.toLocaleString('tr-TR')} gün ` : '';
    return `Birlikte ${days}${t.hours} saat`;
  }
  const n = daysSince(since, now);
  return n == null ? '' : `Birlikte ${(n + 1).toLocaleString('tr-TR')}. gün`;
}

// ---------- mesaj kaynağı (Gist) ----------
// Gist'te tek dosya: FEED_FILE = { v: 1, iv, ct } (base64url). ct = AES-256-GCM(fk, iv, UTF-8 JSON { msg, at }).
// Mesajı yalnız fk'yi bilen yazabilir ve okuyabilir; şifreli metin herkese açık olsa da okunamaz.
export const FEED_FILE = 'm.json';
export const FEED_MSG_MAX = 600;
export const feedUrl = id => `https://api.github.com/gists/${id}`;
const aesKey = (subtle, fk, use) => {
  const raw = fromB64url(fk);
  if (!raw || raw.length !== 32) throw new Error('fk');
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [use]);
};
// Yazan taraf (sahibinin paneli, Node): { msg, at } -> FEED_FILE içeriği (metin)
export async function sealFeed(msg, fk, at = new Date().toISOString()) {
  const subtle = globalThis.crypto.subtle;
  const text = cleanText(msg);
  if (cpLength(text) > FEED_MSG_MAX) throw new Error(`Mesaj en çok ${FEED_MSG_MAX} karakter olabilir.`);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(subtle, fk, 'encrypt'), new TextEncoder().encode(JSON.stringify({ msg: text, at }))));
  return JSON.stringify({ v: 1, iv: toB64url(iv), ct: toB64url(ct) });
}
// Okuyan taraf: FEED_FILE içeriği -> { ok: true, msg, at } ya da { ok: false }. Hata fırlatmaz.
export async function openFeed(fileText, fk) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof fileText !== 'string' || fileText.length > 8000) return { ok: false };
    const o = JSON.parse(fileText);
    if (!o || o.v !== 1) return { ok: false };
    const iv = fromB64url(o.iv), ct = fromB64url(o.ct);
    if (!iv || iv.length !== 12 || !ct) return { ok: false };
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(subtle, fk, 'decrypt'), ct);
    const m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    const msg = cleanText(typeof m?.msg === 'string' ? m.msg : '');
    if (cpLength(msg) > FEED_MSG_MAX) return { ok: false };
    const at = typeof m?.at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(m.at) ? m.at : '';
    return { ok: true, msg, at };
  } catch { return { ok: false }; }
}
// GitHub API yanıtından (JSON metni değil, nesne) FEED_FILE içeriği ya da null
export function feedFileFrom(gist) {
  const f = gist?.files?.[FEED_FILE];
  return f && !f.truncated && typeof f.content === 'string' ? f.content : null;
}
