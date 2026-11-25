// Kullanıcılar: bu cihazdaki profiller. Sunucu yoktur; her profil yalnız oluşturulduğu cihazın tarayıcı depolamasında
// yaşar. Şifre profilleri bu cihazda birbirinden ayırır; veriler şifrelenmez ve hiçbir yere gönderilmez.
//
// Depolama (localStorage):
//  - 'anatomi3d.users.v1': { v: 1, users: [{ id, name, salt, hash, iter, created, lastLogin, lock }], current: id | null }
//    id rastgeledir (8 onaltılık karakter), addan türetilmez. salt ve hash base64, iter PBKDF2 tekrar sayısı.
//    lock = "Açılışta şifre sor". current kalıcıdır: profil "Çıkış yap"a kadar bu cihazda açık kalır.
//  - Öğrenme verisi kullanıcı başınadır: 'anatomi3d.progress.v1' -> 'anatomi3d.u.<id>.progress.v1' (ukey). Kimse giriş
//    yapmamışsa (Misafir) bugünkü anahtarlar değişmeden kullanılır. Cihaz ayarları (beden, sistemleri gerektiğinde
//    yükle, kesit dolgusu, ağaç görünümü) ortaktır ve ad alanına girmez.
//  - 'anatomi3d.users.tries.v1': { id: { n, until } } yanlış şifre sayacı (5 yanlıştan sonra 30 sn bekleme).
//  - sessionStorage 'anatomi3d.users.unlock.v1': şifreyle girişten sonraki tek yeniden yükleme için açık profil (okununca
//    silinir; "Açılışta şifre sor" açık profil bir sonraki açılışta yine şifre ister); 'anatomi3d.users.guest.v1': bu
//    sekmede "Misafir olarak devam et" seçildi (açılıştaki kullanıcı listesi bu oturumda yeniden gösterilmez).
// Kullanıcı değişince bekleyen yazmalar boşaltılır (beforeSwitch) ve sayfa yeniden yüklenir; modüller bellekteki
// durumlarını değiştirmek zorunda kalmaz. Bu dosya DOM'a dokunmaz (Node testi: tools/_qawork/users-test.mjs).
// Uygulamayla HİÇBİR kullanıcı gelmez: hesaplar kişilerin kendi cihazında oluşturulur.

export const REG_KEY = 'anatomi3d.users.v1';
const TRIES_KEY = 'anatomi3d.users.tries.v1';
const UNLOCK_KEY = 'anatomi3d.users.unlock.v1';
const GUEST_KEY = 'anatomi3d.users.guest.v1';
const BAD_KEY = 'anatomi3d.users.v1.bozuk';   // okunamayan kayıt, üstüne yazılmadan önce buraya kopyalanır
export const ITER = 200000;
export const MIN_PW = 4;
export const NAME_MAX = 40;
export const MAX_TRIES = 5;
export const WAIT_MS = 30000;
// Kullanıcı başına tutulan anahtarlar (yerel ve oturum depolaması)
export const DATA_KEYS = ['anatomi3d.progress.v1', 'anatomi3d.exam.v1', 'anatomi3d.examHistory.v1', 'anatomi3d.patho.v1'];   // 4.: patoloji vakaları (patho-store.js)
export const SESSION_KEYS = ['anatomi3d.examRun.v1'];
const HIST_MAX = 20;   // exam.js ile aynı
export const IMPORT_MAX = 2 * 1024 * 1024;   // içe aktarılan metin en çok 2 MB

const err = (code, msg, extra) => Object.assign(new Error(msg), { code }, extra);
const LS = () => globalThis.localStorage;
const SS = () => globalThis.sessionStorage;
const lsGet = k => { try { return LS().getItem(k); } catch { return null; } };
const ssGet = k => { try { return SS().getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { SS().setItem(k, v); } catch { /* oturum depolaması yok */ } };
const ssDel = k => { try { SS().removeItem(k); } catch { /* yok */ } };
// yazma başarısızsa (dolu, kapalı) Türkçe hata
function lsSet(k, v) {
  try { LS().setItem(k, v); } catch { throw err('storage', 'Cihazın depolaması dolu ya da kapalı; kaydedilemedi.'); }
}
const lsDel = k => { try { LS().removeItem(k); } catch { /* yok */ } };

// ---------- ortam ----------
// Okunabiliyor mu (kapalı depolamada erişim hata verir). Dolu depolama okunur; yazma o zaman 'storage' hatası verir.
function storageOk() {
  try { LS().getItem(REG_KEY); return true; } catch { return false; }
}
const subtle = () => globalThis.crypto?.subtle;
// { ok, reason }: reason 'nocrypto' (güvenli olmayan bağlantı: WebCrypto yok) ya da 'nostorage'
export function available() {
  if (!subtle() || !globalThis.crypto?.getRandomValues) return { ok: false, reason: 'nocrypto' };
  if (!storageOk()) return { ok: false, reason: 'nostorage' };
  return { ok: true, reason: null };
}

// ---------- kayıt defteri ----------
const ID_RE = /^[0-9a-f]{8}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function validUser(u) {
  return u && typeof u === 'object' && ID_RE.test(u.id) && typeof u.name === 'string' && u.name.length > 0 && u.name.length <= NAME_MAX &&
    typeof u.salt === 'string' && B64_RE.test(u.salt) && typeof u.hash === 'string' && B64_RE.test(u.hash) &&
    Number.isInteger(u.iter) && u.iter >= 1000 && u.iter <= 10000000;
}
let corruptRaw = null;   // okunamayan kayıt metni (silinmez)
let skipped = [];        // okunabilen kayıttaki geçersiz ya da tekrarlanan girdiler: gösterilmez ama yazarken korunur
let skippedRaw = null;   // böyle girdi varken okunan metin (ilk yazmadan önce yedeklenir)
// Kayıt defterini oku. Yoksa boş; bozuksa boş sayılır, metne dokunulmaz (corrupt() true). Tek tek okunamayan
// girdiler (ör. tuzu eksik) atılmaz: skipped'da tutulur, writeReg onları aynen geri yazar (verileri sahipsiz kalmaz).
function readReg() {
  const raw = lsGet(REG_KEY);
  corruptRaw = null; skipped = []; skippedRaw = null;
  if (raw == null) return { v: 1, users: [], current: null };
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.users)) throw 0;
    const ids = new Set(), users = [];
    for (const u of d.users) {
      if (!validUser(u) || ids.has(u.id)) { skipped.push(u); continue; }
      ids.add(u.id);
      users.push({
        id: u.id, name: u.name, salt: u.salt, hash: u.hash, iter: u.iter,
        created: Number.isFinite(u.created) ? u.created : 0, lastLogin: Number.isFinite(u.lastLogin) ? u.lastLogin : 0, lock: u.lock === true,
      });
    }
    if (skipped.length) skippedRaw = raw;
    return { v: 1, users, current: ids.has(d.current) ? d.current : null };
  } catch {
    corruptRaw = raw;
    return { v: 1, users: [], current: null };
  }
}
function writeReg(reg) {
  // bozuk kaydın (ya da okunamayan girdisi olan kaydın) üstüne yazmadan önce kopyası saklanır
  const orig = corruptRaw ?? skippedRaw;
  if (orig != null && lsGet(BAD_KEY) == null) { try { LS().setItem(BAD_KEY, orig); } catch { /* yer yok */ } }
  lsSet(REG_KEY, JSON.stringify({ v: 1, users: [...reg.users, ...skipped], current: reg.current }));
  corruptRaw = null; skippedRaw = null;
}
export const corrupt = () => { readReg(); return corruptRaw != null; };
// okunamayan (gösterilmeyen ama silinmeyen) girdi sayısı
export const damaged = () => { readReg(); return skipped.length; };
const skippedIds = () => new Set(skipped.map(u => u && typeof u === 'object' ? u.id : null).filter(id => typeof id === 'string'));

// ---------- bu sayfanın açık kullanıcısı (yüklenirken bir kez belirlenir) ----------
let active = null;          // id ya da null (Misafir)
let locked = null;          // "Açılışta şifre sor": şifre bekleyen profilin id'si
let ready = false;
function init() {
  if (ready) return; ready = true;
  if (!available().ok) return;   // profiller kapalı: Misafir
  const reg = readReg();
  const unlock = ssGet(UNLOCK_KEY); ssDel(UNLOCK_KEY);   // tek kullanımlık
  const u = reg.users.find(x => x.id === reg.current);
  if (!u) return;
  if (u.lock && unlock !== u.id) { locked = u.id; return; }
  active = u.id;
}
// Testler için: modül durumunu depolamadan yeniden kur (sayfanın yeniden yüklenmesi yerine)
export function _reinit() { ready = false; active = null; locked = null; init(); }

const pub = u => u && { id: u.id, name: u.name, created: u.created, lastLogin: u.lastLogin, lock: u.lock };
const cmpName = (a, b) => a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' });
export function list() { return readReg().users.map(pub).sort(cmpName); }
export function current() { init(); return active ? pub(readReg().users.find(u => u.id === active)) || null : null; }
export function activeId() { init(); return active; }
// açılışta şifre bekleyen profil ("Açılışta şifre sor")
export function pendingUnlock() { init(); return locked ? pub(readReg().users.find(u => u.id === locked)) || null : null; }
// açılışta kullanıcı listesi gösterilsin mi: kullanıcı var, kimse açık değil ve bu sekmede misafir seçilmedi
export function needsChooser() {
  init();
  if (!available().ok || active || locked) return !!locked;
  return readReg().users.length > 0 && ssGet(GUEST_KEY) !== '1';
}
export function continueAsGuest() { ssSet(GUEST_KEY, '1'); }

// ---------- anahtar ad alanı ----------
// 'anatomi3d.progress.v1' -> 'anatomi3d.u.<id>.progress.v1' (açık kullanıcı varsa); Misafir: değişmez
export function userKey(base, id) { return id ? base.replace(/^anatomi3d\./, `anatomi3d.u.${id}.`) : base; }
export function ukey(base) { init(); return userKey(base, active); }
// Açık kullanıcı hâlâ var mı (progress.js yazmadan önce sorar). Başka sekmede silinen kullanıcının anahtarı, bu sekme
// yeniden yüklenirken bekleyen yazmayla geri gelmesin. Kayıt yoksa ya da okunamıyorsa "var" sayılır (veri atılmaz).
export function alive() {
  init();
  if (!active) return true;
  const raw = lsGet(REG_KEY); if (raw == null) return true;
  const reg = readReg();
  return corruptRaw != null || reg.users.some(u => u.id === active) || skippedIds().has(active);
}

// ---------- kullanıcı değişmeden önce ----------
const hooks = new Set();
export function beforeSwitch(fn) { hooks.add(fn); return () => hooks.delete(fn); }
export function flushAll() { for (const fn of hooks) { try { fn(); } catch (e) { console.error(e); } } }

// ---------- şifre ----------
const toB64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pw, salt, iter) {
  const key = await subtle().importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}
async function makeHash(pw) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: toB64(await derive(pw, salt, ITER)), iter: ITER };
}
async function check(u, pw) {
  const got = await derive(pw, fromB64(u.salt), u.iter), want = fromB64(u.hash);
  if (got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
function checkPw(pw) {
  if (typeof pw !== 'string' || [...pw].length < MIN_PW) throw err('pw', `Şifre en az ${MIN_PW} karakter olmalı.`);
  if (pw.length > 256) throw err('pw', 'Şifre çok uzun.');
}

// yanlış şifre sayacı
function readTries() { try { const d = JSON.parse(lsGet(TRIES_KEY)); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; } }
function writeTries(t) { try { if (Object.keys(t).length) LS().setItem(TRIES_KEY, JSON.stringify(t)); else LS().removeItem(TRIES_KEY); } catch { /* yalnız bellek */ } }
// beklenecek saniye (0: bekleme yok)
export function waitLeft(id) {
  const t = readTries()[id];
  const ms = t && Number.isFinite(t.until) ? t.until - Date.now() : 0;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}
async function verify(u, pw) {
  const w = waitLeft(u.id);
  if (w) throw err('wait', `Çok fazla yanlış deneme. ${w} saniye bekle.`, { seconds: w });
  const ok = typeof pw === 'string' && pw.length <= 256 && await check(u, pw);
  const t = readTries();
  if (ok) { if (t[u.id]) { delete t[u.id]; writeTries(t); } return; }
  const n = (Number.isInteger(t[u.id]?.n) ? t[u.id].n : 0) + 1;
  if (n >= MAX_TRIES) {
    t[u.id] = { n: 0, until: Date.now() + WAIT_MS }; writeTries(t);
    throw err('wait', `Şifre yanlış. ${MAX_TRIES} yanlış denemeden sonra ${WAIT_MS / 1000} saniye bekle.`, { seconds: WAIT_MS / 1000 });
  }
  t[u.id] = { n, until: 0 }; writeTries(t);
  throw err('wrong', `Şifre yanlış (kalan deneme: ${MAX_TRIES - n}).`, { left: MAX_TRIES - n });
}

// ---------- ad ----------
// görünmez ve yön değiştiren karakterler (denetim karakterleri, sıfır genişlikli boşluk, yön işaretleri, BOM) atılır
const INVIS = c => c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
export const cleanName = s => [...String(s ?? '').normalize('NFC')].filter(ch => !INVIS(ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim();
// karşılaştırma anahtarı: büyük/küçük harf ve i/ı/İ/I farkı yok sayılır ('IŞIK' = 'ışık' = 'isik')
const nameKey = s => cleanName(s).toLocaleLowerCase('tr').replace(/ı/g, 'i');
function checkName(name, reg, exceptId = null) {
  if (!name) throw err('name', 'Bir ad yaz.');
  if ([...name].length > NAME_MAX) throw err('name', `Ad en çok ${NAME_MAX} karakter olabilir.`);
  if (reg.users.some(u => u.id !== exceptId && nameKey(u.name) === nameKey(name))) throw err('name', 'Bu adla bir kullanıcı bu cihazda zaten var.');
}
function newId(reg) {
  for (;;) {
    const id = [...globalThis.crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (!reg.users.some(u => u.id === id) && !skippedIds().has(id)) return id;   // okunamayan girdinin verisiyle çakışmasın
  }
}
function need() {
  const a = available();
  if (!a.ok) throw err(a.reason, a.reason === 'nocrypto' ? 'Bu bağlantıda kullanıcı profilleri kullanılamıyor (güvenli bağlantı gerekli).' : 'Tarayıcı depolaması kapalı; kullanıcı profilleri kullanılamıyor.');
}
const findUser = (reg, id) => { const u = reg.users.find(x => x.id === id); if (!u) throw err('nouser', 'Kullanıcı bulunamadı.'); return u; };

// ---------- veriler ----------
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const validRec = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isInteger(x) && x >= 0 && x <= 1e7);
function readJSON(k) { try { return JSON.parse(lsGet(k)); } catch { return null; } }
// Misafirin bu cihazda ilerlemesi ya da sınav geçmişi var mı
export function hasGuestData() {
  const p = readJSON(DATA_KEYS[0]), h = readJSON(DATA_KEYS[2]);
  return (isObj(p) && Object.keys(p).length > 0) || (Array.isArray(h) && h.length > 0);
}
// Misafir verisini kullanıcıya taşıma iki adımdır: önce kopyala (hata verebilir), kullanıcı kaydı yazıldıktan sonra
// misafirden sil. Böylece depolama dolarsa misafir verisi yerinde kalır, yarım profil oluşmaz.
function copyGuest(id) {
  for (const k of DATA_KEYS) { const v = lsGet(k); if (v != null) lsSet(userKey(k, id), v); }
  for (const k of SESSION_KEYS) { const v = ssGet(k); if (v != null) ssSet(userKey(k, id), v); }
}
function clearGuest() {
  for (const k of DATA_KEYS) lsDel(k);
  for (const k of SESSION_KEYS) ssDel(k);
}
function dropData(id) {
  const pre = `anatomi3d.u.${id}.`;
  for (const store of [LS, SS]) {
    try {
      const s = store(), ks = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(pre)) ks.push(k); }
      for (const k of ks) s.removeItem(k);
    } catch { /* depolama yok */ }
  }
}

// ---------- işlemler ----------
// Yeni kullanıcı; oluşturulan kullanıcı açık kullanıcı olur (sayfa yeniden yüklenmeli). opts.takeGuest: misafir verisini taşı
export async function create(name, pw, opts = {}) {
  need();
  name = cleanName(name); checkPw(pw);
  let reg = readReg(); checkName(name, reg);
  const h = await makeHash(pw);
  // misafirin bekleyen yazmaları taşımadan önce kaydedilsin (yoksa son cevap taşınmaz, misafir anahtarı geri gelir)
  if (opts.takeGuest) flushAll();
  reg = readReg(); checkName(name, reg);   // hash sürerken başka sekme aynı adı eklediyse
  const now = Date.now(), id = newId(reg);
  if (opts.takeGuest) {
    try { copyGuest(id); } catch (e) { dropData(id); throw e; }
  }
  reg.users.push({ id, name, ...h, created: now, lastLogin: now, lock: false });
  reg.current = id;
  try { writeReg(reg); } catch (e) { dropData(id); throw e; }
  if (opts.takeGuest) clearGuest();
  ssSet(UNLOCK_KEY, id); ssDel(GUEST_KEY);
  return id;
}
export async function signIn(id, pw) {
  need();
  const u = findUser(readReg(), id);
  await verify(u, pw);
  const reg = readReg(), v = findUser(reg, id);
  v.lastLogin = Date.now(); reg.current = id; writeReg(reg);
  ssSet(UNLOCK_KEY, id); ssDel(GUEST_KEY);
  return pub(v);
}
export function signOut() {
  const reg = readReg();
  if (reg.current != null && corruptRaw == null) { reg.current = null; writeReg(reg); }
  ssDel(UNLOCK_KEY); ssSet(GUEST_KEY, '1');
}
export async function changePassword(id, oldPw, newPw) {
  need(); checkPw(newPw);
  await verify(findUser(readReg(), id), oldPw);
  const h = await makeHash(newPw);
  const reg = readReg(), u = findUser(reg, id);
  Object.assign(u, h); writeReg(reg);
}
export function setLock(id, on) {
  const reg = readReg(), u = findUser(reg, id);
  u.lock = !!on; writeReg(reg);
}
// Silme şifre istemez (unutulan şifre için tek yol); onay olarak profilin adı yazılmalı
export function remove(id, typedName) {
  // açık kullanıcı siliniyorsa bekleyen yazmalar silmeden ÖNCE boşaltılır (sonra boşaltılırsa silinen anahtar geri gelir)
  if (id === active) flushAll();
  const reg = readReg(), u = findUser(reg, id);
  if (nameKey(typedName) !== nameKey(u.name)) throw err('confirm', 'Yazılan ad kullanıcının adıyla aynı değil.');
  skipped = skipped.filter(x => !(x && typeof x === 'object' && x.id === id));
  reg.users = reg.users.filter(x => x.id !== id);
  if (reg.current === id) reg.current = null;
  writeReg(reg);
  dropData(id);
  const t = readTries(); if (t[id]) { delete t[id]; writeTries(t); }
  if (active === id) ssSet(GUEST_KEY, '1');
}

// ---------- dışa aktarma ----------
// Şifre, tuz ve özet DIŞA AKTARILMAZ
export function exportData(id = active) {
  const reg = readReg(), u = id ? findUser(reg, id) : null;
  const p = readJSON(userKey(DATA_KEYS[0], id)), e = readJSON(userKey(DATA_KEYS[1], id)), h = readJSON(userKey(DATA_KEYS[2], id)), pa = cleanPatho(readJSON(userKey(DATA_KEYS[3], id)), true);
  const progress = {};
  if (isObj(p)) for (const [k, v] of Object.entries(p)) if (validKey(k) && validRec(v)) progress[k] = v;
  return {
    app: 'anatomi3d', kind: 'profile', v: 1,
    name: u ? u.name : 'Misafir',
    exported: new Date().toISOString(),
    progress,
    exam: cleanExam(e),
    history: Array.isArray(h) ? h.filter(validHist).slice(-HIST_MAX) : [],
    ...(pa ? { patho: pa } : {}),
  };
}

// ---------- içe aktarma (sıkı denetim) ----------
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const validKey = k => typeof k === 'string' && k.length > 0 && k.length <= 300 && !BAD_KEYS.has(k);
const validHist = x => isObj(x) && Number.isFinite(x.d) && Array.isArray(x.s) && x.s.length <= 50 && x.s.every(s => typeof s === 'string' && s.length <= 60) &&
  Number.isInteger(x.r) && Number.isInteger(x.n) && x.n > 0 && x.r >= 0 && x.r <= x.n && x.n <= 10000 && Number.isFinite(x.sec) && x.sec >= 0 && (x.m === 'exam' || x.m === 'study');
function cleanExam(e) {
  if (!isObj(e)) return null;
  const o = {};
  if (e.subj === null || (Array.isArray(e.subj) && e.subj.length <= 50 && e.subj.every(s => typeof s === 'string' && s.length <= 60))) o.subj = e.subj;
  if (Number.isFinite(e.n)) o.n = e.n;
  if (Number.isFinite(e.t)) o.t = e.t;
  if (e.src === 'all' || e.src === 'weak') o.src = e.src;
  if (e.mode === 'exam' || e.mode === 'study') o.mode = e.mode;
  return o;
}
const TOP = new Set(['app', 'kind', 'v', 'name', 'exported', 'progress', 'exam', 'history', 'patho']);
// patoloji kaydı (patho-store.js biçimi): { c: { <vaka>: {b, d, r, w, lr, lw, t} }, x: [Testat sonuçları] }; lenient: geçersizi
// atla (dışa aktarma), değilse geçersizde null (içe aktarma hata verir)
const num = (v, max = 1e15) => Number.isFinite(v) && v >= 0 && v <= max;
const validPCase = v => isObj(v) && Number.isInteger(v.b) && v.b >= 0 && v.b <= 5 && ['d', 'r', 'w', 'lr', 'lw', 't'].every(k => num(v[k])) && (v.k == null || v.k === 0 || v.k === 1);
const validPTest = x => isObj(x) && ['t', 'n', 'ok', 'loc', 'ms'].every(k => num(x[k])) && (x.locN == null || num(x.locN)) && Array.isArray(x.keys) && x.keys.length <= 50 && x.keys.every(k => typeof k === 'string' && k.length <= 100);
function cleanPatho(pa, lenient = false) {
  if (!isObj(pa) || !isObj(pa.c) || (pa.x != null && !Array.isArray(pa.x))) return null;
  const c = {}, ks = Object.keys(pa.c);
  if (ks.length > 5000) return null;
  for (const k of ks) { if (validKey(k) && validPCase(pa.c[k])) { const v = pa.c[k]; c[k] = { b: v.b, d: v.d, r: v.r, w: v.w, lr: v.lr, lw: v.lw, t: v.t, ...(v.k != null ? { k: v.k } : {}) }; } else if (!lenient) return null; }
  const x = [];
  for (const e of (pa.x || []).slice(-20)) { if (validPTest(e)) x.push({ t: e.t, n: e.n, ok: e.ok, loc: e.loc, locN: e.locN ?? 0, ms: e.ms, keys: e.keys.slice() }); else if (!lenient) return null; }
  return { c, x };
}
// birleştirme: vaka başına son cevabı daha yeni olan kayıt; Testat sonuçları tarihe göre tekrarsız, son 20'si
export function mergePatho(cur, imp) {
  const c0 = cleanPatho(cur, true) || { c: {}, x: [] }, out = { c: { ...c0.c }, x: [] };
  for (const [k, v] of Object.entries(imp.c)) if (!out.c[k] || v.t > out.c[k].t) out.c[k] = v;
  const seen = new Set();
  for (const e of [...c0.x, ...imp.x].sort((a, b) => a.t - b.t)) if (!seen.has(e.t)) { seen.add(e.t); out.x.push(e); }
  out.x = out.x.slice(-20);
  return out;
}
const bad = msg => err('import', msg);
// Metni denetle; geçerliyse temiz bir kopya döner, değilse Türkçe hata fırlatır
export function parseImport(text) {
  if (typeof text !== 'string') throw bad('Dosya okunamadı.');
  if (text.length > IMPORT_MAX) throw bad('Dosya çok büyük (en çok 2 MB).');
  let d;
  try {
    d = JSON.parse(text, (k, v) => { if (BAD_KEYS.has(k)) throw bad('Dosyada izin verilmeyen bir alan var.'); return v; });
  } catch (e) { throw e.code === 'import' ? e : bad('Dosya geçerli bir JSON değil.'); }
  if (!isObj(d) || d.app !== 'anatomi3d' || d.kind !== 'profile' || d.v !== 1) throw bad('Bu bir Anatomi 3D profil dosyası değil.');
  for (const k of Object.keys(d)) if (!TOP.has(k)) throw bad('Dosyada beklenmeyen bir alan var: ' + k.slice(0, 30));
  if (typeof d.name !== 'string' || !cleanName(d.name) || d.name.length > 200) throw bad('Dosyadaki ad geçersiz.');
  if (d.exported != null && (typeof d.exported !== 'string' || d.exported.length > 40)) throw bad('Dosyadaki tarih geçersiz.');
  if (!isObj(d.progress)) throw bad('Dosyada ilerleme kaydı yok.');
  const pk = Object.keys(d.progress);
  if (pk.length > 100000) throw bad('Dosyada çok fazla kayıt var.');
  const progress = {};
  for (const k of pk) {
    if (!validKey(k) || !validRec(d.progress[k])) throw bad('İlerleme kaydı geçersiz.');
    progress[k] = d.progress[k].slice();
  }
  if (d.exam != null && !isObj(d.exam)) throw bad('Sınav ayarları geçersiz.');
  if (d.exam) for (const k of Object.keys(d.exam)) if (!['subj', 'n', 't', 'src', 'mode'].includes(k)) throw bad('Sınav ayarları geçersiz.');
  if (d.history != null && (!Array.isArray(d.history) || d.history.length > 200 || !d.history.every(validHist))) throw bad('Sınav geçmişi geçersiz.');
  const patho = d.patho == null ? null : cleanPatho(d.patho);
  if (d.patho != null && !patho) throw bad('Patoloji kaydı geçersiz.');
  return {
    name: cleanName(d.name).slice(0, NAME_MAX), exported: typeof d.exported === 'string' ? d.exported : null,
    progress, exam: cleanExam(d.exam),
    history: (d.history || []).map(x => ({ d: x.d, s: x.s.slice(), r: x.r, n: x.n, sec: x.sec, m: x.m })),
    patho,
  };
}

// Birleştirme kuralları: soru başına daha çok cevabı olan kayıt kazanır (eşitlikte mevcut kalır); sınav geçmişleri
// tekrarsız birleşir (tarih, doğru, soru sayısı, mod aynıysa aynı sınav), tarihe göre sıralanır, son 20'si kalır;
// sınav ayarları yalnız mevcut yoksa alınır.
export function mergeProgress(cur, imp) {
  const out = {}; let taken = 0;
  if (isObj(cur)) for (const [k, v] of Object.entries(cur)) if (validKey(k) && validRec(v)) out[k] = v;
  for (const [k, v] of Object.entries(imp)) {
    const c = out[k];
    if (!c || v[0] + v[1] > c[0] + c[1]) { out[k] = v.slice(); taken++; }
  }
  return { data: out, taken };
}
export function mergeHistory(cur, imp) {
  const all = [...(Array.isArray(cur) ? cur.filter(validHist) : []), ...imp];
  const seenK = new Set(), out = [];
  for (const x of all) { const k = `${x.d}|${x.r}|${x.n}|${x.m}`; if (!seenK.has(k)) { seenK.add(k); out.push(x); } }
  return out.sort((a, b) => a.d - b.d).slice(-HIST_MAX);
}
function writeData(id, imp, merge) {
  const kp = userKey(DATA_KEYS[0], id), ke = userKey(DATA_KEYS[1], id), kh = userKey(DATA_KEYS[2], id);
  const m = mergeProgress(merge ? readJSON(kp) : null, imp.progress);
  lsSet(kp, JSON.stringify(m.data));
  const e = merge ? readJSON(ke) : null;
  if (imp.exam && !isObj(e)) lsSet(ke, JSON.stringify(imp.exam));
  lsSet(kh, JSON.stringify(mergeHistory(merge ? readJSON(kh) : [], imp.history)));
  if (imp.patho) { const kpa = userKey(DATA_KEYS[3], id); lsSet(kpa, JSON.stringify(merge ? mergePatho(readJSON(kpa), imp.patho) : imp.patho)); }
  return m.taken;
}
// İçe aktarılan profili yeni kullanıcı olarak ekle (ad ve şifre sorulur); yeni kullanıcı açık kullanıcı olur
export async function importNew(imp, name, pw) {
  const id = await create(name, pw);
  try { writeData(id, imp, false); } catch (e) {
    // veri yazılamadıysa yarım profil kalmasın
    const reg = readReg(); reg.users = reg.users.filter(u => u.id !== id); if (reg.current === id) reg.current = null;
    try { writeReg(reg); } catch { /* yok */ }
    dropData(id); ssDel(UNLOCK_KEY);
    throw e;
  }
  return id;
}
// Açık kullanıcıya birleştir (önce bekleyen yazmalar boşaltılır); dönen değer: alınan soru kaydı sayısı
export function importMerge(imp, id = active) {
  need();
  if (!id) throw err('nouser', 'Birleştirmek için önce bir kullanıcıyla giriş yap.');
  findUser(readReg(), id);
  flushAll();
  const n = writeData(id, imp, true);
  // birleştirmeden sonra sayfa yeniden yüklenir: "Açılışta şifre sor" açık profil yeniden şifre istemesin
  if (id === active) ssSet(UNLOCK_KEY, id);
  return n;
}
