// Node testi: src/users.js (kullanıcı profilleri). Çalıştır: node tools/_qawork/users-test.mjs (app/ içinde)
// localStorage ve sessionStorage taklit edilir; crypto.subtle Node 24'te hazırdır. Kullanıcılar uydurmadır, şifreler
// her çalıştırmada rastgele üretilir ve yazdırılmaz.
import { webcrypto } from 'node:crypto';

class Store {
  constructor() { this.m = new Map(); this.full = false; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.full) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const U = await import('../../src/users.js');
const LS = globalThis.localStorage, SS = globalThis.sessionStorage;
const pw = () => 'p' + Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(9))).toString('base64url');
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('HATA:', msg); } };
async function throwsCode(fn, code, msg) {
  try { await fn(); ok(false, msg + ' (hata bekleniyordu)'); } catch (e) { ok(e.code === code, `${msg} (kod ${e.code}, beklenen ${code}: ${e.message})`); }
}
// sayfanın yeniden yüklenmesi yerine
const reload = () => U._reinit();
const reg = () => JSON.parse(LS.getItem(U.REG_KEY));

// ---------- misafir ----------
reload();
ok(U.available().ok, 'available');
ok(U.activeId() === null && U.current() === null, 'başta misafir');
ok(U.ukey('anatomi3d.progress.v1') === 'anatomi3d.progress.v1', 'misafir anahtarı değişmez');
ok(!U.needsChooser(), 'kullanıcısız cihazda liste gösterilmez');
// misafir verisi
LS.setItem('anatomi3d.progress.v1', JSON.stringify({ 's:Femur': [1, 2, 0], 'f:abc': [3, 0, 3] }));
LS.setItem('anatomi3d.examHistory.v1', JSON.stringify([{ d: 1000, s: ['brain'], r: 3, n: 5, sec: 60, m: 'exam' }]));
LS.setItem('anatomi3d.sex', 'f');
ok(U.hasGuestData(), 'misafir verisi var');

// ---------- oluşturma ----------
const P1 = pw(), P2 = pw(), P3 = pw();
await throwsCode(() => U.create('Deneme Bir', 'abc'), 'pw', 'kısa şifre');
await throwsCode(() => U.create('   ', P1), 'name', 'boş ad');
await throwsCode(() => U.create('x'.repeat(41), P1), 'name', 'uzun ad');
const id1 = await U.create('  Deneme   Bir ', P1, { takeGuest: true });
ok(/^[0-9a-f]{8}$/.test(id1), 'id 8 onaltılık karakter');
let r = reg();
ok(r.v === 1 && r.users.length === 1 && r.current === id1, 'kayıt defteri');
const u1 = r.users[0];
ok(u1.name === 'Deneme Bir', 'ad temizlendi');
ok(u1.iter === 200000 && Buffer.from(u1.salt, 'base64').length === 16 && Buffer.from(u1.hash, 'base64').length === 32, 'PBKDF2 parametreleri');
ok(!JSON.stringify(r).includes(P1), 'şifre saklanmaz');
ok(!id1.includes('deneme'), 'id addan türetilmez');
// misafir verisi taşındı
ok(LS.getItem('anatomi3d.progress.v1') === null && JSON.parse(LS.getItem(`anatomi3d.u.${id1}.progress.v1`))['s:Femur'][1] === 2, 'misafir ilerlemesi aktarıldı');
ok(JSON.parse(LS.getItem(`anatomi3d.u.${id1}.examHistory.v1`)).length === 1 && LS.getItem('anatomi3d.examHistory.v1') === null, 'misafir sınav geçmişi aktarıldı');
ok(LS.getItem('anatomi3d.sex') === 'f', 'cihaz ayarı ortak kalır');
await throwsCode(() => U.create('deneme bir', P2), 'name', 'aynı ad (büyük/küçük harf)');

// yeniden yükleme: oluşturulan kullanıcı açık
reload();
ok(U.activeId() === id1, 'oluşturma sonrası açık kullanıcı');
ok(U.ukey('anatomi3d.progress.v1') === `anatomi3d.u.${id1}.progress.v1`, 'kullanıcı anahtarı');
ok(U.ukey('anatomi3d.examRun.v1') === `anatomi3d.u.${id1}.examRun.v1`, 'oturum anahtarı');
reload();
ok(U.activeId() === id1, 'açık kalır (current kalıcı)');

// ---------- ikinci kullanıcı, giriş ----------
const id2 = await U.create('Deneme İki', P2);
ok(LS.getItem(`anatomi3d.u.${id2}.progress.v1`) === null, 'ikinci kullanıcı boş başlar');
reload();
ok(U.activeId() === id2, 'ikinci kullanıcı açık');
U.signOut(); reload();
ok(U.activeId() === null, 'çıkış: misafir');
ok(!U.needsChooser(), 'çıkış yapılan sekmede liste yeniden gösterilmez');
SS.clear(); reload();
ok(U.needsChooser(), 'yeni açılışta kullanıcı listesi');
await throwsCode(() => U.signIn(id1, P2), 'wrong', 'yanlış şifre');
await U.signIn(id1, P1); reload();
ok(U.activeId() === id1, 'doğru şifre');

// ---------- deneme sınırı ----------
for (let i = 1; i < 5; i++) await throwsCode(() => U.signIn(id2, 'yanlis' + i), 'wrong', 'yanlış deneme ' + i);
await throwsCode(() => U.signIn(id2, 'yanlis5'), 'wait', '5. yanlış: bekleme');
await throwsCode(() => U.signIn(id2, P2), 'wait', 'beklerken doğru şifre de reddedilir');
ok(U.waitLeft(id2) > 25 && U.waitLeft(id2) <= 30, 'bekleme 30 sn');
// süreyi geçmişe al
const tries = JSON.parse(LS.getItem('anatomi3d.users.tries.v1')); tries[id2].until = Date.now() - 1; LS.setItem('anatomi3d.users.tries.v1', JSON.stringify(tries));
await U.signIn(id2, P2); reload();
ok(U.activeId() === id2 && U.waitLeft(id2) === 0, 'bekleme sonrası giriş, sayaç sıfır');

// ---------- şifre değiştir ----------
await throwsCode(() => U.changePassword(id2, P1, P3), 'wrong', 'eski şifre yanlış');
await throwsCode(() => U.changePassword(id2, P2, 'ab'), 'pw', 'yeni şifre kısa');
await U.changePassword(id2, P2, P3);
await throwsCode(() => U.signIn(id2, P2), 'wrong', 'eski şifre artık geçmez');
await U.signIn(id2, P3); reload();
ok(U.activeId() === id2, 'yeni şifre');

// ---------- açılışta şifre sor ----------
U.setLock(id2, true);
SS.clear(); reload();
ok(U.activeId() === null && U.pendingUnlock()?.id === id2 && U.needsChooser(), 'kilitli: açılışta şifre bekler, misafir anahtarları');
ok(U.ukey('anatomi3d.progress.v1') === 'anatomi3d.progress.v1', 'kilitliyken kullanıcı verisi okunmaz');
await U.signIn(id2, P3); reload();
ok(U.activeId() === id2, 'şifreden sonra açılır');
reload();
ok(U.activeId() === null && U.pendingUnlock()?.id === id2, 'sonraki açılışta yine şifre');
U.setLock(id2, false); reload();
ok(U.activeId() === id2, 'kilit kapalı: açık');

// ---------- dışa aktarma ----------
LS.setItem(`anatomi3d.u.${id2}.progress.v1`, JSON.stringify({ 's:Femur': [5, 0, 5], 'f:x1': [0, 1, 0] }));
LS.setItem(`anatomi3d.u.${id2}.exam.v1`, JSON.stringify({ subj: null, n: 10, t: 45, src: 'all', mode: 'study' }));
LS.setItem(`anatomi3d.u.${id2}.examHistory.v1`, JSON.stringify([{ d: 2000, s: ['loco'], r: 8, n: 10, sec: 300, m: 'study' }]));
const ex = U.exportData(id2);
const exText = JSON.stringify(ex);
ok(ex.app === 'anatomi3d' && ex.kind === 'profile' && ex.v === 1 && ex.name === 'Deneme İki' && typeof ex.exported === 'string', 'dışa aktarma başlığı');
ok(!/salt|hash|iter|pass|sifre|şifre/i.test(Object.keys(ex).join(' ')) && !exText.includes(P3) && !exText.includes(reg().users.find(u => u.id === id2).hash), 'dışa aktarmada şifre bilgisi yok');
ok(ex.progress['s:Femur'][0] === 5 && ex.history.length === 1 && ex.exam.mode === 'study', 'dışa aktarma içeriği');

// ---------- içe aktarma denetimi ----------
const imp = U.parseImport(exText);
ok(imp.name === 'Deneme İki' && imp.progress['f:x1'][1] === 1, 'geçerli dosya');
const bad = (text, msg) => throwsCode(() => U.parseImport(text), 'import', msg);
await bad('x'.repeat(U.IMPORT_MAX + 1), 'çok büyük');
await bad('{bozuk', 'JSON değil');
await bad('[]', 'dizi');
await bad(JSON.stringify({ ...ex, app: 'baska' }), 'yanlış uygulama');
await bad(JSON.stringify({ ...ex, extra: 1 }), 'beklenmeyen alan');
await bad(JSON.stringify({ ...ex, progress: [] }), 'ilerleme dizi');
await bad(JSON.stringify({ ...ex, progress: { 's:A': [1, 2] } }), 'kayıt uzunluğu');
await bad(JSON.stringify({ ...ex, progress: { 's:A': [1, -2, 0] } }), 'negatif sayı');
await bad(JSON.stringify({ ...ex, progress: { 's:A': ['1', 2, 0] } }), 'metin sayı');
await bad(JSON.stringify({ ...ex, history: [{ d: 1 }] }), 'geçmiş biçimi');
await bad(JSON.stringify({ ...ex, exam: { evil: 1 } }), 'sınav ayarı alanı');
await bad(JSON.stringify({ ...ex, name: 42 }), 'ad sayı');
// patoloji kaydı (patho-store.js biçimi): dışa aktarılır, sıkı denetlenir, birleştirmede yeni cevap kazanır
{
  const pc = { b: 2, d: 5000, r: 3, w: 1, lr: 1, lw: 0, t: 4000, k: 1 }, px = { t: 3000, n: 10, ok: 7, loc: 5, locN: 8, ms: 600000, keys: ['radialis-sulcus'] };
  LS.setItem(`anatomi3d.u.${id2}.patho.v1`, JSON.stringify({ c: { 'radialis-sulcus': pc, 'bozuk': { b: 9 } }, x: [px] }));
  const ex2 = U.exportData(id2);
  ok(ex2.patho && ex2.patho.c['radialis-sulcus'].k === 1 && !ex2.patho.c.bozuk && ex2.patho.x.length === 1, 'patoloji kaydı dışa aktarılır (bozuk kayıt atılır)');
  const imp2 = U.parseImport(JSON.stringify(ex2));
  ok(imp2.patho && imp2.patho.c['radialis-sulcus'].b === 2 && imp2.patho.x[0].keys[0] === 'radialis-sulcus', 'patoloji kaydı içe aktarılır');
  ok(U.parseImport(exText).patho === null, 'patoloji alanı olmayan eski dosya kabul edilir');
  await bad(JSON.stringify({ ...ex2, patho: { c: { a: { b: 7, d: 0, r: 0, w: 0, lr: 0, lw: 0, t: 0 } }, x: [] } }), 'patoloji kutu sınırı');
  await bad(JSON.stringify({ ...ex2, patho: { c: {}, x: [{ t: 1 }] } }), 'patoloji Testat biçimi');
  await bad(JSON.stringify({ ...ex2, patho: { c: { a: { ...pc, k: 5 } }, x: [] } }), 'patoloji son sonuç değeri');
  const m = U.mergePatho({ c: { 'radialis-sulcus': { ...pc, t: 9000, b: 0, k: 0 }, x1: { ...pc } }, x: [px] }, imp2.patho);
  ok(m.c['radialis-sulcus'].t === 9000 && m.c['radialis-sulcus'].k === 0 && m.c.x1 && m.x.length === 1, 'patoloji birleştirme: daha yeni cevap kalır, Testat tekrarsız');
}
await bad(exText.replace('"progress":{', '"progress":{"__proto__":[1,1,1],'), '__proto__ anahtarı');
await bad(exText.replace('"progress":{', '"progress":{"constructor":[1,1,1],'), 'constructor anahtarı');
await bad(exText.replace('"app":', '"__proto__":{"polluted":1},"app":'), 'üst düzey __proto__');
await bad(exText.replace('"exam":{', '"exam":{"prototype":1,'), 'prototype anahtarı');
ok(({}).polluted === undefined && Object.prototype.polluted === undefined, 'prototip kirlenmedi');

// ---------- yeni profil olarak içe aktar ----------
const P4 = pw();
await throwsCode(() => U.importNew(imp, 'Deneme İki', P4), 'name', 'aynı adla içe aktarma');
const id3 = await U.importNew(imp, 'Deneme Üç', P4); reload();
ok(U.activeId() === id3, 'içe aktarılan profil açık');
ok(JSON.parse(LS.getItem(`anatomi3d.u.${id3}.progress.v1`))['s:Femur'][0] === 5, 'içe aktarılan ilerleme');
ok(JSON.parse(LS.getItem(`anatomi3d.u.${id3}.examHistory.v1`)).length === 1, 'içe aktarılan geçmiş');

// ---------- birleştirme ----------
ok(JSON.stringify(U.mergeProgress({ a: [1, 1, 0] }, { a: [3, 0, 3] }).data.a) === '[3,0,3]', 'daha çok cevaplı kazanır');
ok(JSON.stringify(U.mergeProgress({ a: [2, 2, 0] }, { a: [3, 0, 3] }).data.a) === '[2,2,0]', 'daha az cevaplı kaybeder');
ok(JSON.stringify(U.mergeProgress({ a: [1, 1, 0] }, { a: [2, 0, 2] }).data.a) === '[1,1,0]', 'eşitlikte mevcut kalır');
const h1 = { d: 1, s: ['a'], r: 1, n: 2, sec: 5, m: 'exam' }, h2 = { d: 2, s: ['a'], r: 2, n: 2, sec: 5, m: 'exam' };
ok(U.mergeHistory([h2, h1], [h1, { ...h2 }]).length === 2, 'geçmiş tekrarsız birleşir');
ok(U.mergeHistory([], Array.from({ length: 30 }, (_, i) => ({ ...h1, d: i }))).length === 20, 'geçmiş en çok 20');
// açık kullanıcıya (id1) birleştir
await U.signIn(id1, P1); reload();
LS.setItem(`anatomi3d.u.${id1}.progress.v1`, JSON.stringify({ 's:Femur': [1, 2, 0], 'f:x1': [4, 4, 0], 'f:own': [1, 0, 1] }));
let flushed = 0; const off = U.beforeSwitch(() => flushed++);
const taken = U.importMerge(imp);
off();
const merged = JSON.parse(LS.getItem(`anatomi3d.u.${id1}.progress.v1`));
ok(flushed === 1, 'birleştirmeden önce bekleyen yazmalar boşaltılır');
ok(taken === 1 && merged['s:Femur'][0] === 5 && merged['f:x1'][0] === 4 && merged['f:own'][0] === 1, 'birleştirme kuralları');
const mh = JSON.parse(LS.getItem(`anatomi3d.u.${id1}.examHistory.v1`));
ok(mh.length === 2 && mh[0].d === 1000 && mh[1].d === 2000, 'geçmiş birleşti');
const before2 = LS.getItem(`anatomi3d.u.${id1}.progress.v1`);
const taken2 = U.importMerge(imp);
ok(JSON.parse(LS.getItem(`anatomi3d.u.${id1}.examHistory.v1`)).length === 2, 'ikinci birleştirme tekrar eklemez');
ok(taken2 === 0 && LS.getItem(`anatomi3d.u.${id1}.progress.v1`) === before2, 'ikinci birleştirme 0 kayıt alır, ilerleme değişmez');

// ---------- progress.js anahtarı ----------
const progress = await import('../../src/progress.js');
progress.record('s:Testus', false);
U.flushAll();
ok(JSON.parse(LS.getItem(`anatomi3d.u.${id1}.progress.v1`))['s:Testus'][1] === 1, 'progress.js açık kullanıcının anahtarına yazar');
ok(LS.getItem('anatomi3d.progress.v1') === null, 'misafir anahtarına yazılmaz');

// ---------- birleştirme sonrası yeniden yükleme: kilitli profil yeniden şifre istemez ----------
U.setLock(id1, true);
U.importMerge(imp); reload();
ok(U.activeId() === id1 && !U.pendingUnlock(), 'kilitli profilde birleştirmeden sonra açık kalır');
reload();
ok(U.activeId() === null && U.pendingUnlock()?.id === id1, 'sonraki açılışta yine şifre sorulur');
await U.signIn(id1, P1); reload();
U.setLock(id1, false);

// ---------- i/ı/İ/I aynı sayılır ----------
await throwsCode(() => U.create('DENEME BIR', pw()), 'name', 'DENEME BIR = Deneme Bir (noktasız I)');
await throwsCode(() => U.create('deneme bır', pw()), 'name', 'deneme bır = Deneme Bir');

// ---------- dolu depolamada çıkış: hata verir, durum değişmez ----------
LS.full = true;
await throwsCode(() => U.signOut(), 'storage', 'dolu depolamada çıkış hata verir (arayüz iletiyi gösterir)');
LS.full = false;
ok(reg().current === id1, 'başarısız çıkış kaydı bozmaz');

// ---------- silme ----------
SS.setItem(`anatomi3d.u.${id3}.examRun.v1`, '{}');
await throwsCode(() => U.remove(id3, 'Deneme'), 'confirm', 'yanlış ad ile silme');
U.remove(id3, ' deneme üç ');
ok(!reg().users.some(u => u.id === id3), 'kullanıcı silindi');
ok(![...LS.m.keys(), ...SS.m.keys()].some(k => k.includes(id3)), 'kullanıcının verisi silindi');
// açık kullanıcı silinirken bekleyen yazma (arayüz sırası: önce remove, sonra flushAll) silinen anahtarı geri getirmez
progress.record('s:QA_DEL', true);
U.remove(id1, 'deneme bır');   // onayda da i/ı farkı yok sayılır
U.flushAll();
ok(LS.getItem(`anatomi3d.u.${id1}.progress.v1`) === null && ![...LS.m.keys()].some(k => k.includes(id1)), 'silinen açık kullanıcının anahtarı geri gelmez');
reload();
ok(U.activeId() === null && reg().current === null, 'açık kullanıcı silinince misafir');

// ---------- misafir verisini taşıma: bekleyen yazma önce kaydedilir ----------
LS.setItem('anatomi3d.progress.v1', JSON.stringify({ 's:Femur': [1, 0, 1] }));
const gprog = await import('../../src/progress.js?misafir');   // misafir anahtarıyla yüklenen ayrı örnek
gprog.record('s:QA_G2', false);
const idG = await U.create('Deneme Dört', pw(), { takeGuest: true });
U.flushAll();   // arayüz sırası: create, sonra switchNow -> flushAll
const gData = JSON.parse(LS.getItem(`anatomi3d.u.${idG}.progress.v1`));
ok(gData['s:QA_G2']?.[1] === 1 && gData['s:Femur'][0] === 1, 'bekleyen misafir cevabı da taşındı');
ok(LS.getItem('anatomi3d.progress.v1') === null, 'taşımadan sonra misafir anahtarı geri gelmez');

// ---------- başka sekmede silinen açık kullanıcı: bu sekmenin bekleyen yazması anahtarı geri getirmez ----------
reload();
const uprog = await import('../../src/progress.js?sekme');   // idG'nin anahtarıyla yüklenen örnek (öteki sekme)
uprog.record('s:QA_TAB', true);
const rg = reg(); rg.users = rg.users.filter(u => u.id !== idG); rg.current = null;
LS.setItem(U.REG_KEY, JSON.stringify(rg));
for (const k of [...LS.m.keys()]) if (k.startsWith(`anatomi3d.u.${idG}.`)) LS.removeItem(k);
ok(!U.alive(), 'silinen kullanıcı için alive() false');
U.flushAll();
ok(![...LS.m.keys()].some(k => k.includes(idG)), 'öteki sekmede silinen kullanıcının anahtarı yeniden yazılmaz');
reload();
ok(U.activeId() === null, 'silinen kullanıcıdan sonra misafir');

// ---------- dolu depolamada misafir taşıma: yarım profil kalmaz, misafir verisi yerinde ----------
LS.setItem('anatomi3d.progress.v1', JSON.stringify({ 's:Femur': [2, 0, 2] }));
LS.setItem('anatomi3d.examHistory.v1', JSON.stringify([{ d: 3000, s: ['brain'], r: 1, n: 2, sec: 9, m: 'exam' }]));
const guestBefore = LS.getItem('anatomi3d.progress.v1'), regBefore = LS.getItem(U.REG_KEY), keysBefore = LS.m.size;
// ilk yazma (ilerleme kopyası) başarılı, ikinci yazma (geçmiş kopyası) dolu
const realSet = LS.setItem.bind(LS); let writes = 0;
LS.setItem = (k, v) => { if (++writes >= 2) throw new Error('QuotaExceededError'); realSet(k, v); };
await throwsCode(() => U.create('Deneme Beş', pw(), { takeGuest: true }), 'storage', 'dolu depolamada taşıma hata verir');
LS.setItem = realSet;
ok(LS.getItem(U.REG_KEY) === regBefore && LS.m.size === keysBefore && LS.getItem('anatomi3d.progress.v1') === guestBefore, 'yarım profil yok, misafir verisi yerinde');
// kayıt yazılamazsa (kopyalar başarılı) da aynı
writes = 0;
LS.setItem = (k, v) => { if (k === U.REG_KEY) throw new Error('QuotaExceededError'); realSet(k, v); };
await throwsCode(() => U.create('Deneme Beş', pw(), { takeGuest: true }), 'storage', 'kayıt yazılamazsa hata');
LS.setItem = realSet;
ok(LS.getItem(U.REG_KEY) === regBefore && LS.m.size === keysBefore && LS.getItem('anatomi3d.progress.v1') === guestBefore, 'kayıt yazılamayınca kopyalar geri alınır, misafir verisi yerinde');
LS.removeItem('anatomi3d.progress.v1'); LS.removeItem('anatomi3d.examHistory.v1');

// ---------- okunamayan tek girdi (ör. tuzu eksik) atılmaz ----------
{
  const r0 = reg();
  const broken = { id: 'abcd0123', name: 'Deneme Üç', hash: 'AAAA', iter: 200000 };   // tuz yok
  r0.users.push(broken); r0.current = 'abcd0123';
  const raw0 = JSON.stringify(r0);
  LS.setItem(U.REG_KEY, raw0); LS.removeItem('anatomi3d.users.v1.bozuk');
  LS.setItem('anatomi3d.u.abcd0123.progress.v1', '{"s:A":[1,0,1]}');
  reload();
  ok(U.activeId() === null && !U.list().some(u => u.id === 'abcd0123') && U.damaged() === 1 && !U.corrupt(), 'okunamayan girdi gösterilmez, sayılır');
  await U.signIn(id2, P3);
  const r1 = reg();
  ok(r1.users.some(u => u.id === 'abcd0123' && u.name === 'Deneme Üç'), 'yazınca okunamayan girdi korunur');
  ok(LS.getItem('anatomi3d.users.v1.bozuk') === raw0, 'okunamayan girdili kayıt yedeklendi');
  ok(LS.getItem('anatomi3d.u.abcd0123.progress.v1') !== null, 'okunamayan girdinin verisi yerinde');
  LS.setItem(U.REG_KEY, JSON.stringify({ ...r1, users: r1.users.filter(u => u.id !== 'abcd0123') }));
  LS.removeItem('anatomi3d.u.abcd0123.progress.v1'); LS.removeItem('anatomi3d.users.v1.bozuk');
}

// ---------- bozuk kayıt, dolu depolama ----------
LS.setItem(U.REG_KEY, '{bozuk');
reload();
ok(U.activeId() === null && U.list().length === 0 && U.corrupt(), 'bozuk kayıt: kullanıcı yok sayılır');
ok(LS.getItem(U.REG_KEY) === '{bozuk', 'bozuk kayıt silinmez');
const id5 = await U.create('Deneme Beş', pw());
ok(LS.getItem('anatomi3d.users.v1.bozuk') === '{bozuk' && reg().users.length === 1, 'bozuk kayıt üstüne yazılmadan saklandı');
U.remove(id5, 'Deneme Beş');
const id6 = await U.create('Deneme Yedi', pw()); reload();
LS.full = true;
reload();
ok(U.activeId() === id6, 'dolu depolamada açık kullanıcı açık kalır (okuma yeter)');
await throwsCode(() => U.create('Deneme Altı', pw()), 'storage', 'dolu depolama');
LS.full = false;
U.remove(id6, 'Deneme Yedi'); reload();
ok(U.activeId() === null, 'silindikten sonra misafir');
// kapalı depolama: erişim hata verir, uygulama misafir olarak açılır
const realLS = globalThis.localStorage;
Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
reload();
ok(U.activeId() === null && !U.available().ok && U.ukey('anatomi3d.progress.v1') === 'anatomi3d.progress.v1', 'kapalı depolama: misafir');
Object.defineProperty(globalThis, 'localStorage', { value: realLS, configurable: true, writable: true });
// crypto yok
const realCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
reload();
ok(!U.available().ok && U.available().reason === 'nocrypto' && U.activeId() === null, 'crypto.subtle yok: profiller kapalı');
Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });

console.log(`${passes} denetim geçti, ${fails} hata`);
process.exit(fails ? 1 : 0);
