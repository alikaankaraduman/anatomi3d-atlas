// Patoloji vakalarının kalıcı sonuçları ve aralıklı tekrar (Leitner kutuları). Kullanıcı başına (users.js ukey),
// localStorage 'anatomi3d.patho.v1' (giriş yapılmışsa 'anatomi3d.u.<id>.patho.v1').
// Kayıt: { c: { <vaka anahtarı>: { b: kutu 0-5, d: sonraki tekrar (ms), r: doğru, w: yanlış, lr: 3B doğru, lw: 3B yanlış,
//          t: son cevap (ms) } }, x: [ { t, n, ok, loc, ms, keys } ] (son 20 Testat) }
// Bir vaka cevabı: soru doğru VE (3B görevi doğru ya da atlandı) ise "doğru" sayılır: kutu bir artar, değilse kutu 0'a
// iner. Sonraki tekrar: kutu 0 -> 1 gün, 1 -> 3, 2 -> 7, 3 -> 16, 4 -> 35, 5 -> 90 gün sonra, yerel gün başına göre (akşam
// yanlış cevaplanan vaka ertesi sabah gelir). Tekrar zamanı gelmemiş vakaya verilen doğru cevap sayılır ama kutuyu
// büyütmez (aynı gün tekrar tekrar cevaplayarak 90 güne atlanmasın); yanlış cevap her zaman kutuyu 0'a indirir. Hiç cevaplanmamış vaka
// tekrar listesine girmez. Depolama kapalıysa sonuçlar yalnız bu oturumda bellekte tutulur.
import { ukey, beforeSwitch, alive } from './users.js';
import { record as recordProgress } from './progress.js';

const KEY = ukey('anatomi3d.patho.v1');
export const INTERVAL = [1, 3, 7, 16, 35, 90];
const num = v => Number.isFinite(v) ? v : 0;

function parse(raw) {
  try {
    const d = raw ? JSON.parse(raw) : {};
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { c: {}, x: [] };
    const c = {}, x = Array.isArray(d.x) ? d.x.filter(e => e && Number.isFinite(e.t)).slice(-20) : [];
    for (const [k, v] of Object.entries(d.c || {})) if (v && typeof v === 'object') c[k] = { b: Math.max(0, Math.min(5, num(v.b))), d: num(v.d), r: num(v.r), w: num(v.w), lr: num(v.lr), lw: num(v.lw), t: num(v.t), ...(v.k === 0 || v.k === 1 ? { k: v.k } : {}) };
    return { c, x };
  } catch { return null; }
}
let data = { c: {}, x: [] };
try { data = parse(localStorage.getItem(KEY)) || data; } catch { /* depolama kapalı */ }
const dirty = new Set();
let dirtyX = false, timer = null;
function flush() {
  clearTimeout(timer); timer = null;
  if (!alive()) return;
  try {
    const st = parse(localStorage.getItem(KEY));   // başka sekmenin yazdıkları korunur, bu sekmenin değişiklikleri üstüne
    if (st) { for (const k of dirty) if (data.c[k]) st.c[k] = data.c[k]; if (dirtyX) st.x = data.x; data = st; }
    localStorage.setItem(KEY, JSON.stringify(data)); dirty.clear(); dirtyX = false;
  } catch { /* bellekte kalır */ }
}
const save = () => { clearTimeout(timer); timer = setTimeout(flush, 400); };
beforeSwitch(() => { if (timer) flush(); });
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) flush(); });
  window.addEventListener('storage', e => {
    if (e.key !== KEY && e.key !== null) return;
    const d = parse(e.newValue); if (!d) return;
    for (const k of dirty) if (data.c[k]) d.c[k] = data.c[k];
    if (dirtyX) d.x = data.x;
    data = d;
  });
}

export const get = key => data.c[key] || null;
// mc: soru doğru mu; loc: 3B görevi true / false / null (atlandı ya da yok)
export function answer(key, mc, loc, now = Date.now()) {
  const v = data.c[key] || (data.c[key] = { b: 0, d: 0, r: 0, w: 0, lr: 0, lw: 0, t: 0 });
  if (mc) v.r++; else v.w++;
  if (loc === true) v.lr++; else if (loc === false) v.lw++;
  const ok = mc && loc !== false, early = v.r + v.w > 1 && v.d > now;
  if (!(ok && early)) {
    v.b = ok ? Math.min(5, v.b + 1) : 0;   // ilk cevap doğruysa kutu 1
    const t = new Date(now); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + INTERVAL[v.b]); v.d = t.getTime();
  }
  v.t = now; v.k = ok ? 1 : 0;   // son cevabın sonucu: erken doğru cevapta kutu değişmese de vaka 'doğru' sayılır
  dirty.add(key); save();
  recordProgress('p:' + key, ok);   // genel ilerleme (zayıf / bilinen) sayımları için de
  return v;
}
// tekrar zamanı gelmiş vakalar, en eski tarih önce
export const due = (keys, now = Date.now()) => keys.filter(k => data.c[k] && data.c[k].d <= now).sort((a, b) => data.c[a].d - data.c[b].d);
export const status = key => { const v = data.c[key]; return !v ? null : (v.k ?? (v.b > 0 ? 1 : 0)) ? 'ok' : 'bad'; };
export function testat(entry) { data.x.push(entry); data.x = data.x.slice(-20); dirtyX = true; save(); }
export const testats = () => data.x.slice();
export function summary(keys, now = Date.now()) {
  let seen = 0, okN = 0, dueN = 0;
  for (const k of keys) { const v = data.c[k]; if (!v) continue; seen++; if (status(k) === 'ok') okN++; if (v.d <= now) dueN++; }
  return { total: keys.length, seen, ok: okN, due: dueN };
}
export const nextDue = (keys, now = Date.now()) => { let m = Infinity; for (const k of keys) { const v = data.c[k]; if (v && v.d > now) m = Math.min(m, v.d); } return m; };
export function resetAll() { data = { c: {}, x: [] }; dirty.clear(); dirtyX = false; try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* bellekte */ } }
