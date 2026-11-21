// Kalıcı ilerleme: her sorunun sonucu bu tarayıcıda saklanır (localStorage, 'anatomi3d.progress.v1').
// Kayıt biçimi: { id: [doğru, yanlış, seri] }; seri = son yanlıştan beri arka arkaya doğru sayısı.
// Kimlikler: yapı sorusu 's:' + sorulan yapının ilk parçasının İngilizce model adı (aynı yapı bütün testlerde tek kayıt),
// bilgi sorusu 'f:' + soru metninin özeti (factId).
// Tanımlar: zayıf (weak) = en az bir kez yanlış cevaplanmış ve son yanlıştan beri iki kez arka arkaya doğru
// cevaplanmamış; bilinen (known) = son cevap doğru ve zayıf değil.
// Depolama kapalıysa, doluysa ya da bozuksa (özel pencere vb.) ilerleme yalnızca bu oturum için bellekte tutulur.
// Kullanıcı başına: giriş yapılmışsa anahtar 'anatomi3d.u.<id>.progress.v1' olur (users.js ukey; Misafir: bugünkü
// anahtar). Kullanıcı değişince sayfa yeniden yüklenir; anahtar yüklenirken bir kez belirlenir.
import { ukey, beforeSwitch, alive } from './users.js';
const KEY = ukey('anatomi3d.progress.v1');
const WRITE_DELAY = 400;

const valid = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
// Saklanan metni oku: geçersiz kayıtlar atılır; okunamazsa null
function parse(raw) {
  try {
    const d = raw ? JSON.parse(raw) : {};
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    for (const k of Object.keys(d)) if (!valid(d[k])) delete d[k];
    return d;
  } catch { return null; }
}
let data = {};
try { data = parse(localStorage.getItem(KEY)) || {}; } catch { /* depolama kapalı: boş başla */ }
// Son yazmadan beri bu sekmede değişen kayıtlar: başka sekmenin verisiyle birleştirilirken bunlar korunur
const dirty = new Set();
const overlay = d => { for (const id of dirty) if (data[id]) d[id] = data[id]; return d; };

let timer = null;
function flush() {
  clearTimeout(timer); timer = null;
  if (!alive()) return;   // açık kullanıcı (başka sekmede) silindi: silinen anahtar yeniden yazılmaz
  try {
    // başka sekmenin bu arada yazdıkları kaybolmasın: saklanan veri okunur, bu sekmenin değişiklikleri üstüne yazılır
    const stored = parse(localStorage.getItem(KEY));
    if (stored) data = overlay(stored);
    localStorage.setItem(KEY, JSON.stringify(data)); dirty.clear();
  } catch { /* dolu ya da kapalı: bellekte kalır */ }
}
const save = () => { clearTimeout(timer); timer = setTimeout(flush, WRITE_DELAY); };
// kullanıcı değişmeden (sayfa yeniden yüklenmeden) önce bekleyen yazma boşaltılır
beforeSwitch(() => { if (timer) flush(); });
// sayfa kapanırken bekleyen yazma kaybolmasın
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) flush(); });
}

const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
// başka bir sekmede değişirse burada da güncellenir
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== KEY && e.key !== null) return;   // null: depolamanın tamamı silindi
  const d = parse(e.newValue); if (!d) return;
  data = overlay(d);   // henüz yazılmamış yerel cevaplar korunur
  emit();
});

export const seen = id => !!data[id];
export const weak = id => { const v = data[id]; return !!v && v[1] > 0 && v[2] < 2; };
export const known = id => { const v = data[id]; return !!v && v[2] > 0 && !weak(id); };
export function record(id, ok) {
  if (!id) return;
  const v = data[id] || (data[id] = [0, 0, 0]);
  if (ok) { v[0]++; v[2]++; } else { v[1]++; v[2] = 0; }
  dirty.add(id); save(); emit();
}
// ids: soru kimlikleri (tekrarlar bir kez sayılır)
export function stats(ids) {
  const s = { total: 0, seen: 0, known: 0, weak: 0 };
  for (const id of new Set(ids)) { s.total++; if (seen(id)) s.seen++; if (known(id)) s.known++; if (weak(id)) s.weak++; }
  return s;
}
export const weakIds = (prefix = '') => Object.keys(data).filter(id => id.startsWith(prefix) && weak(id));
export function reset() {
  clearTimeout(timer); timer = null; data = {}; dirty.clear();
  try { localStorage.setItem(KEY, '{}'); } catch { /* bellekte sıfırlandı */ }
  emit();
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Seçim ağırlığı: zayıf x3, hiç sorulmamış x2, bilinen x1
export const weight = id => (weak(id) ? 3 : !seen(id) ? 2 : 1);
// Ağırlıklı rastgele seçim; avoid (önceki soru) listede başka seçenek varsa seçilmez
export function pickWeighted(list, idOf, avoid = null) {
  const cand = list.length > 1 && avoid != null ? list.filter(x => x !== avoid) : list;
  if (!cand.length) return null;
  const w = cand.map(x => weight(idOf(x)));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r < 0) return cand[i]; }
  return cand[cand.length - 1];
}

// Kimlikler
export const structId = name => 's:' + name;
// Bilgi sorusunun kimliği: soru metninin FNV-1a özeti (metin değişmedikçe aynı)
export function factId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return 'f:' + (h >>> 0).toString(36);
}
