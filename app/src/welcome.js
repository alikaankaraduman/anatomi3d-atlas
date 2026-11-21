// Kişisel bağlantı ("sana özel not"): saf mantık, DOM'a ve depolamaya dokunmaz (Node da içe aktarabilir:
// tools/_qawork/welcome-test.mjs). Bağlantı, sitenin normal adresi ve bir parçadır: #g=<UTF-8 JSON'un base64url hâli>.
// Parça (#...) sunucuya hiç gitmez; metin yalnız bağlantının içinde ve onu açan cihazda (localStorage) durur.
// JSON: { v: 1, to, from?, msg?, date?, color?, title? }. Okuma katıdır: çözmeden önce boyut sınırı, bilinen alanlar
// tür ve uzunluk denetimiyle, bilinmeyen alanlar yok sayılır, __proto__ / constructor / prototype anahtarı olan bağlantı
// geçersizdir. Metinler düz metindir; ekrana yalnız textContent ya da esc() ile yazılır, asla HTML olarak değil.

export const VERSION = 1;
export const STORE_KEY = 'anatomi3d.welcome.v1';
// uzunluklar karakter (kod noktası) sayısıdır: bir emoji bir karakter sayılır
export const LIMITS = Object.freeze({ to: 40, from: 40, msg: 600, title: 30 });
// base64url metninin en çok uzunluğu (çözmeden önce denetlenir). En kötü durum: 600 karakterlik not, her biri 4 bayt
// ya da JSON'da kaçışlı tırnak; ad alanları ve öteki alanlarla birlikte ~3200 bayt, base64 ile ~4300 karakter.
export const PAYLOAD_MAX = 4600;

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
const FIELDS = ['to', 'from', 'msg', 'date', 'color', 'title'];

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
// renk anahtarı (ör. ileride eklenen bir renk) yalnız rengi düşürür: renk süsten ibarettir.
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
  return { ok: true, data };
}

// Kanonik JSON: alanlar sabit sırayla, boş alanlar yok (aynı içerik her zaman aynı metni verir)
export function canonical(data) {
  const o = { v: VERSION };
  for (const k of FIELDS) if (data[k]) o[k] = data[k];
  return JSON.stringify(o);
}
export const same = (a, b) => !!a && !!b && canonical(a) === canonical(b);

// ---------- base64url ----------
function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  if (typeof s !== 'string' || !s || !/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  let bin;
  try { bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Veriyi bağlantı parçasına çevirir; geçersizse hata fırlatır (e.code: alan adı, e.message Türkçe)
export function encode(input) {
  const r = validate({ ...input, v: VERSION });
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
  return toB64url(new TextEncoder().encode(canonical(r.data)));
}

// Bağlantı parçasını çözer: { ok: true, data } ya da { ok: false, code, error }. Hiçbir zaman hata fırlatmaz.
export function decode(payload) {
  if (typeof payload !== 'string' || !payload) return fail('empty', 'Bağlantı boş.');
  if (payload.length > PAYLOAD_MAX) return fail('size', 'Bağlantı çok uzun.');
  const bytes = fromB64url(payload);
  if (!bytes) return fail('base64', 'Bağlantı bozuk (eksik ya da yanlış kopyalanmış olabilir).');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('utf8', 'Bağlantı bozuk (eksik ya da yanlış kopyalanmış olabilir).'); }
  let o, bad = false;
  try {
    o = JSON.parse(text, (k, v) => { if (BAD_KEYS.has(k)) bad = true; return v; });
  } catch { return fail('json', 'Bağlantı bozuk (eksik ya da yanlış kopyalanmış olabilir).'); }
  if (bad) return fail('shape', 'Bağlantının içeriği okunamadı.');
  return validate(o);
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
// Yapıştırılan metinden parça: tam adres, "#g=...", "g=..." ya da yalnız base64url metni
export function payloadFromText(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  const i = s.indexOf('#');
  if (i >= 0) return payloadFromHash(s.slice(i));
  if (s.startsWith('g=')) return s.slice(2).split('&')[0];
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return null;
}

// Sitenin adresi (var olan parça atılır) + #g=...
export function buildLink(base, data) {
  return String(base).split('#')[0] + '#g=' + encode(data);
}

// Cihazda saklanan kayıt: { v: 1, data, saved } (data yeniden denetlenir; bozuk kayıt = kayıt yok)
export function parseStored(text) {
  if (typeof text !== 'string' || !text || text.length > 20000) return null;
  try {
    let bad = false;
    const o = JSON.parse(text, (k, v) => { if (BAD_KEYS.has(k)) bad = true; return v; });
    if (bad || !o || typeof o !== 'object' || o.v !== VERSION || !o.data || typeof o.data !== 'object') return null;
    const r = validate({ ...o.data, v: VERSION });
    return r.ok ? r.data : null;
  } catch { return null; }
}
export function storedText(data) {
  const d = JSON.parse(canonical(data)); delete d.v;
  return JSON.stringify({ v: VERSION, data: d, saved: new Date().toISOString().slice(0, 10) });
}

// Tarih metni: "21 Kasım 2026" (saat dilimi kaymasın diye UTC)
export function dateText(s) {
  if (!isDate(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  try { return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return s; }
}
