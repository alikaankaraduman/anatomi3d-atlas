// Node testi: src/testlang.js (test dili: Almanca / Türkçe). Çalıştır: node tools/_qawork/testlang-test.mjs (app/ içinde)
// localStorage taklit edilir; Almanca veri _setDe ile doğrudan verilir (ağ yok). Denetlenenler: arayüz tablosu iki dilde
// eksiksiz, varsayılan dil ve saklama, factText geri dönüş kuralları (kayıt yok, şık sayısı yanlış, dil 'tr', dosya
// yüklenmemiş, açıklama eksik), şık sırası, üretilen sorular (qde), shortText, factId'nin progress.js ile aynı olması,
// indirme hatası (döngü yok, reddedilen söz yok) ve gerçek quiz-de.json dosyasının biçimi.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class Store {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();
// ağ çağrısı sayacı: testlang yalnız fetch ile indirir
let fetches = 0, fetchMode = 'fail';
globalThis.fetch = async url => {
  fetches++;
  if (fetchMode === 'fail') return { ok: false, status: 404, json: async () => ({}) };
  if (fetchMode === 'throw') throw new TypeError('network');
  return { ok: true, status: 200, json: async () => fetchMode };
};
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
const warn = console.warn; console.warn = () => {};   // beklenen indirme uyarıları susturulur

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = await import('../../src/testlang.js');
const P = await import('../../src/progress.js');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('HATA:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const tick = () => new Promise(r => setTimeout(r, 0));

// --- tablo ---
const S = L._STR;
const kd = Object.keys(S.de), kt = Object.keys(S.tr);
ok(kd.length > 50, 'tabloda yeterli anahtar var');
for (const k of kd) ok(Object.hasOwn(S.tr, k), `Türkçe tabloda eksik: ${k}`);
for (const k of kt) ok(Object.hasOwn(S.de, k), `Almanca tabloda eksik: ${k}`);
for (const l of ['de', 'tr']) for (const [k, v] of Object.entries(S[l])) {
  ok(typeof v === 'function' || (typeof v === 'string' && v.trim() !== ''), `${l}.${k} boş`);
  if (typeof v === 'string') {
    ok(!/[<>]/.test(v), `${l}.${k} HTML içermemeli`);
    const ph = s => (s.match(/\{\d\}/g) || []).sort().join();
    if (typeof S.de[k] === 'string' && typeof S.tr[k] === 'string') ok(ph(S.de[k]) === ph(S.tr[k]), `${k}: yer tutucular iki dilde aynı`);
  }
}
// Almanca tablo gerçek ümlautlar kullanır (ae/oe/ue yazımı değil) ve Türkçe karakter taşımaz (ı ş ğ İ)
ok(Object.values(S.de).filter(v => typeof v === 'string').every(v => !/[ışğİŞĞ]/.test(v.replace(/Türkisch/g, ''))), 'Almanca tabloda Türkçe harf yok');
ok(/ä|ö|ü|ß/.test(Object.values(S.de).join(' ')), 'Almanca tabloda ümlaut var');
// bağlayıcı sözcükler
const must = { 'mode.name': 'Was ist das?', 'mode.find': 'Struktur finden', 'mode.facts': 'Wissen', 'q.name': 'Welche Struktur leuchtet?',
  'q.find': 'Klicke diese Struktur in der 3D-Ansicht an:', 'res.ok': 'Richtig!', 'res.bad': 'Falsch; die richtige Antwort ist grün.',
  'next': 'Nächste Frage ▶', 'skip': 'Überspringen', 'focus': 'Zur Struktur', 'all': 'Alle', 'quiz.exit': 'Test beenden',
  'quiz.back': 'Zurück zum Thema', 'quiz.review': 'Wiederholung', 'ex.title': 'Probeklausur', 'ex.count': 'Anzahl der Fragen',
  'ex.time': 'Zeit pro Frage', 'ex.untimed': 'Ohne Zeitlimit', 'ex.m.exam': 'Prüfung', 'ex.m.study': 'Lernen', 'ex.start': 'Starten',
  'ex.finish': 'Abgeben', 'ex.result': 'Ergebnis', 'ex.show': 'In 3D zeigen', 'sx.level.k': 'Schnittebene', 'sx.view': 'Zum Schnitt',
  'sx.q.name': 'Welche Struktur ist im Schnitt mit dem Ring markiert?', 'sx.q.level': 'Auf welcher Höhe liegt dieser Schnitt?',
  'subj.brain': 'Gehirn und Nervensystem', 'subj.sect': 'Schnittanatomie', 'cat.passage': 'Durchtrittsstellen', 'cat.csf': 'Liquor' };
for (const [k, v] of Object.entries(must)) eq(S.de[k], v, `Almanca ${k}`);

// --- varsayılan dil, T, saklama ---
eq(L.getLang(), 'de', 'yeni profil Almanca başlar');
eq(L.T('weak.btn', 3), 'Meine Fehler (3)', 'T yer tutucu');
eq(L.T('prog', 1, 5, 2), 'Gewusst 1 / 5 · falsch 2', 'T Gewusst satırı');
eq(L.T('res.badFind', 'X'), 'Falsch: X. Die richtige Struktur leuchtet jetzt.', 'T Yapıyı bul hatası');
eq(L.T('yok.boyle.anahtar'), 'yok.boyle.anahtar', 'bilinmeyen anahtar kendisini döndürür');
let calls = 0; const off = L.onLang(() => calls++);
L.setLang('xx'); eq(L.getLang(), 'de', 'geçersiz dil yok sayılır'); eq(calls, 0, 'geçersiz dilde bildirim yok');
L.setLang('de'); eq(calls, 0, 'aynı dilde bildirim yok');
fetchMode = 'fail'; const f0 = fetches;
L.setLang('tr'); eq(L.getLang(), 'tr', 'Türkçeye geçildi'); eq(calls, 1, 'dil değişimi bildirildi');
eq(localStorage.getItem('anatomi3d.testLang.v1'), 'tr', 'seçim saklandı (Misafir anahtarı)');
eq(fetches, f0, 'Türkçeye geçiş indirme başlatmaz');
eq(L.T('weak.btn', 3), 'Yanlışlarım (3)', 'Türkçe T');
eq(L.T('prog', 1, 5, 2), 'Bilinen 1 / 5 · yanlış 2', 'Türkçe Bilinen satırı');
ok(L.langSwitch().includes('data-tlang="tr" class="active" aria-pressed="true"'), 'düğme: TR basılı');
ok(L.langSwitch().includes('data-tlang="de" class="" aria-pressed="false"'), 'düğme: DE basılı değil');
ok(L.langSwitch().includes('title="Test dili: Almanca ya da Türkçe"'), 'düğme başlığı o anki test dilinde');
// yeniden yükleme: saklanan seçim okunur (modülü yeni bir sorguyla yeniden içe aktar)
const L2 = await import('../../src/testlang.js?reload=1');
eq(L2.getLang(), 'tr', 'seçim yeniden yüklemede kalır');
localStorage.setItem('anatomi3d.testLang.v1', 'fr');
const L3 = await import('../../src/testlang.js?reload=2');
eq(L3.getLang(), 'de', 'bozuk kayıt varsayılana döner');
// depolama yoksa bellekte çalışır
const saved = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const L4 = await import('../../src/testlang.js?reload=3');
eq(L4.getLang(), 'de', 'depolama kapalı: varsayılan');
L4.setLang('tr'); eq(L4.getLang(), 'tr', 'depolama kapalı: bellekte değişir');
globalThis.localStorage = saved;

// --- factText ---
const f = { q: 'Soru metni bir?', options: ['doğru', 'yanlış a', 'yanlış b', 'yanlış c'], explain: 'Açıklama.' };
const g = { q: 'İkinci soru?', options: ['d', 'y1', 'y2', 'y3'], explain: 'A2' };
const h = { q: 'Üçüncü soru?', options: ['d', 'y1', 'y2', 'y3'], explain: 'A3' };
const k = { q: 'Açıklamasız soru?', options: ['d', 'y1', 'y2'], explain: '' };
const m = { q: 'Açıklama eksik?', options: ['d', 'y1'], explain: 'Türkçe açıklama' };
const DE = { v: 1, lang: 'de', items: {
  [P.factId(f.q)]: { q: 'Frage eins?', o: ['richtig', 'falsch a', 'falsch b', 'falsch c'], e: 'Erklärung.' },
  [P.factId(g.q)]: { q: 'Frage zwei?', o: ['r', 'f1', 'f2'], e: 'E2' },          // şık sayısı yanlış
  [P.factId(k.q)]: { q: 'Ohne Erklärung?', o: ['r', 'f1', 'f2'], e: '' },
  [P.factId(m.q)]: { q: 'Erklärung fehlt?', o: ['r', 'f1'] },                    // Türkçe açıklama var, Almancası yok
}, texts: { [P.factId('Kısa metin.')]: 'Kurzer Text.' } };

L.setLang('de');
L._setDe(null); fetchMode = 'fail';
let r = L.factText(f);
eq([r.q, r.de], [f.q, false], 'dosya yüklenmemiş: Türkçe');
L._setDe(DE);
r = L.factText(f);
eq([r.q, r.options, r.explain, r.de], ['Frage eins?', ['richtig', 'falsch a', 'falsch b', 'falsch c'], 'Erklärung.', true], 'Almanca kayıt kullanıldı');
eq(r.options.length, f.options.length, 'şık sayısı aynı');
// şık sırası: aynı indis iki dilde aynı şıkkı gösterir (0 doğru)
const order = [2, 0, 3, 1];
L.setLang('tr'); const tr = L.factText(f); L.setLang('de'); const de = L.factText(f);
eq(order.map(i => [tr.options[i], de.options[i]]), [['yanlış b', 'falsch b'], ['doğru', 'richtig'], ['yanlış c', 'falsch c'], ['yanlış a', 'falsch a']], 'şık sırası dilden bağımsız');
eq(L.factText(g).q, g.q, 'şık sayısı yanlış: Türkçe');
eq(L.factText(h).q, h.q, 'kayıt yok: Türkçe');
eq([L.factText(k).q, L.factText(k).explain], ['Ohne Erklärung?', ''], 'açıklamasız soru Almanca');
eq(L.factText(m).q, m.q, 'Almanca açıklama eksik: bütün soru Türkçe');
L.setLang('tr'); eq(L.factText(f).q, f.q, "dil 'tr': Türkçe"); eq(L.factText(f).de, false, "dil 'tr': de=false"); L.setLang('de');
// geçersiz kayıt biçimleri
const bad = [{ q: '', o: ['a', 'b', 'c', 'd'], e: 'x' }, { q: 'x', o: 'abcd', e: 'x' }, { q: 'x', o: ['a', '', 'c', 'd'], e: 'x' }, { q: 'x', o: ['a', 2, 'c', 'd'], e: 'x' }, { q: 'x', o: ['a', 'b', 'c', 'd'], e: 5 }, 'metin', null];
for (const b of bad) { L._setDe({ items: { [P.factId(f.q)]: b } }); eq(L.factText(f).q, f.q, `geçersiz kayıt ${JSON.stringify(b)}: Türkçe`); }
L._setDe(DE);
// üretilen soru (hareket sistemi): qde
const gen = { q: 'M. biceps brachii hangi sinirle innerve edilir?', qde: 'M. biceps brachii: Innervation durch welchen Nerv?', options: ['N. musculocutaneus', 'N. radialis'], explain: 'M. biceps brachii: N. musculocutaneus.' };
eq(L.factText(gen).q, gen.qde, 'üretilen soru Almanca'); eq(L.factText(gen).options, gen.options, 'üretilen sorunun şıkları aynı');
L._setDe(null); eq(L.factText(gen).q, gen.qde, 'üretilen soru dosyasız da Almanca'); L._setDe(DE);
L.setLang('tr'); eq(L.factText(gen).q, gen.q, 'üretilen soru Türkçede Türkçe'); L.setLang('de');
// ilerleme kimliği Türkçe metinden: factText kimliği değiştirmez
const pf = { ...f }; L.factText(pf); eq(P.factId(pf.q), P.factId(f.q), 'factText soruyu değiştirmez');
eq(L.factText(null).de, false, 'null soru çökmez');

// --- shortText ---
eq(L.shortText('Kısa metin.'), { text: 'Kurzer Text.', de: true }, 'shortText Almanca');
eq(L.shortText('Başka metin.'), { text: 'Başka metin.', de: false }, 'shortText kayıt yok: Türkçe');
eq(L.shortText(''), { text: '', de: false }, 'shortText boş');
L.setLang('tr'); eq(L.shortText('Kısa metin.'), { text: 'Kısa metin.', de: false }, 'shortText Türkçe'); L.setLang('de');
L._setDe({ items: {}, texts: { [P.factId('Kısa metin.')]: 5 } }); eq(L.shortText('Kısa metin.').de, false, 'shortText geçersiz değer: Türkçe');

// --- aynı soru metni, farklı şıklar (iki bankada): parmak izi "s" ve "<kimlik>~<parmak izi>" anahtarı ---
const c1 = { q: 'Ortak soru?', options: ['d1', 'a1', 'b1'], explain: 'E1' };
const c2 = { q: 'Ortak soru?', options: ['d2', 'a2', 'b2'], explain: 'E2' };
const c3 = { q: 'Ortak soru?', options: ['d1', 'a1', 'b1'], explain: 'başka açıklama' };
const s1 = L.factSig(c1), s2 = L.factSig(c2), cid = P.factId(c1.q);
ok(s1 !== s2 && s1 !== L.factSig(c3), 'parmak izi şıklara ve açıklamaya bağlı');
eq(s1, P.factId([...c1.options, c1.explain].join(String.fromCharCode(10))).slice(2), 'parmak izi: factId(şıklar + açıklama, satır sonuyla) "f:" olmadan');
eq(L.factSig({ q: 'x', options: ['a', 'b'] }), L.factSig({ q: 'y', options: ['a', 'b'], explain: '' }), 'açıklama yoksa boş açıklama');
L._setDe({ items: {
  [cid]: { q: 'Gemeinsame Frage 1?', o: ['r1', 'x1', 'y1'], e: 'D1', s: s1 },
  [cid + '~' + s2]: { q: 'Gemeinsame Frage 2?', o: ['r2', 'x2', 'y2'], e: 'D2', s: s2 },
} });
eq([L.factText(c1).q, L.factText(c1).options[1]], ['Gemeinsame Frage 1?', 'x1'], 'ilk bankanın sorusu kendi kaydını alır');
eq([L.factText(c2).q, L.factText(c2).options[1], L.factText(c2).explain], ['Gemeinsame Frage 2?', 'x2', 'D2'], 'öteki bankanın sorusu ~parmak izi kaydını alır');
eq([L.factText(c3).q, L.factText(c3).de], [c3.q, false], 'parmak izi tutmayan kayıt reddedilir: Türkçe');
L._setDe({ items: { [cid]: { q: 'Gemeinsame Frage 1?', o: ['r1', 'x1', 'y1'], e: 'D1', s: s1 } } });
eq(L.factText(c2).de, false, 'yalnız öteki bankanın kaydı varsa Türkçe (yanlış şıklar gösterilmez)');
L._setDe({ items: { [cid + '~' + s2]: { q: 'Falsch', o: ['r', 'x'], e: 'D' }, [cid]: { q: 'Gemeinsame Frage?', o: ['r', 'x', 'y'], e: 'D' } } });
eq(L.factText(c2).q, 'Gemeinsame Frage?', 'geçersiz ~kayıt: ana kayda düşer');
L._setDe({ items: { [cid]: { q: 'Ohne s?', o: ['r', 'x', 'y'], e: 'D' } } });
eq(L.factText(c1).q, 'Ohne s?', 's alanı olmayan eski kayıt kabul edilir');
L._setDe(DE);

// --- çoğul (Almanca tekil / çoğul) ve sınav eğilimi ---
eq(L.T('ex.confirmFinish', 1, ''), '1 Frage offen. Offene Fragen zählen als falsch. Trotzdem abgeben?', 'tekil: 1 Frage offen');
eq(L.T('ex.confirmFinish', 3, L.T('ex.confirmFlag', 1)), '3 Fragen offen, 1 markiert. Offene Fragen zählen als falsch. Trotzdem abgeben?', 'çoğul: 3 Fragen offen');
eq(L.T('ex.countAvail', 1), '(in der Auswahl gibt es 1 Frage)', 'tekil countAvail');
eq(L.T('ex.countAvail', 7), '(in der Auswahl gibt es 7 Fragen)', 'çoğul countAvail');
eq(L.T('ex.note.weak', 1, 1), 'In den gewählten Themen: 1 Fehler und 1 neue Frage; die Fehler kommen zuerst.', 'tekil note.weak');
eq(L.T('ex.note.weak', 2, 5), 'In den gewählten Themen: 2 Fehler und 5 neue Fragen; die Fehler kommen zuerst.', 'çoğul note.weak');
eq(L.T('ex.note.all', 1), 'In den gewählten Themen: 1 Frage.', 'tekil note.all');
eq(L.T('ex.sum', 1, '1:00'), '1 Frage · 1:00', 'tekil sum'); eq(L.T('ex.sum', 20, '5:00'), '20 Fragen · 5:00', 'çoğul sum');
eq(L.T('quiz.count', 1), '1 Struktur', 'tekil quiz.count'); eq(L.T('quiz.count', 12), '12 Strukturen', 'çoğul quiz.count');
eq(L.T('ex.trend', '±0', 70), '±0 Prozentpunkte (Schnitt der bisherigen Klausuren: 70 %)', 'eğilim farkı 0');
L.setLang('tr');
eq(L.T('ex.confirmFinish', 1, ''), '1 soru boş. Boş sorular yanlış sayılır. Yine de bitirilsin mi?', 'Türkçe confirmFinish');
eq(L.T('quiz.count', 1), '1 yapı', 'Türkçe quiz.count');
eq(L.T('note.noParts'), 'Bu sorunun yapıları modelde yok', 'Türkçe bildirim');
L.setLang('de');
eq(L.T('note.noParts'), 'Die Strukturen dieser Frage sind im Modell nicht vorhanden.', 'Almanca bildirim');
eq(L.Tin('de', 'tab.liver'), 'Leber, Gallenwege und Pankreas', 'title_de eksik sekme için Almanca ad');
// Almanca tabloda «» yok (Almanca tırnak „…“)
ok(Object.values(S.de).filter(v => typeof v === 'string').every(v => !/[«»]/.test(v)), 'Almanca tabloda «» yok');

// --- kesit ipuçları: Almancası texts içinde, yoksa kaynak metin ve kestirilen dili ---
L._setDe({ items: {}, texts: { [P.factId('Papez devresinin durağı')]: 'Station des Papez-Kreises' } });
eq(L.shortText('Papez devresinin durağı'), { text: 'Station des Papez-Kreises', de: true }, 'ipucu Almancası');
eq(L.shortText('Ventralinde N. phrenicus'), { text: 'Ventralinde N. phrenicus', de: false }, 'ipucu Almancası yok: kaynak');
eq(['Ventralinde N. phrenicus', 'Papez devresinin durağı', 'Pyramidenbahn burada', "Huntington'da atrofi", 'Ön lob = Adeno, arka lob = Neuro', "Th4'te aort kavsi"].map(L.tipLang), ['tr', 'tr', 'tr', 'tr', 'tr', 'tr'], 'Türkçe ipuçları');
eq(['IVAN: von innen Vene, Arterie, Nerv.', 'Hinteres Scheidengewölbe grenzt an den Douglas-Raum.', 'Tiefster Lendenwirbel, Sitz der Spondylolisthesis L5/S1.'].map(L.tipLang), ['de', 'de', 'de'], 'Almanca ipuçları');
eq(['N. III', 'Intumescentia cervicalis'].map(L.tipLang), ['', ''], 'dili belirsiz (Latince) ipuçları');
L._setDe(DE);

// --- factId progress.js ile aynı (tools/quiz-de.mjs de aynısını kullanır) ---
const Q = await import('../../tools/quiz-de.mjs');
ok(Q.factId === P.factId, 'quiz-de.mjs factId progress.js ile aynı işlev');
eq(P.factId('Dalağın uzun ekseni hangi kaburga boyunca uzanır?'), 'f:102l05v', 'bilinen özet (quiz-de.json ilk kayıt)');

// --- indirme: hata döngü yapmaz, reddedilen söz sızmaz, başarı bildirir ---
L._setDe(null); fetchMode = 'fail';
let before = fetches;
let res = await L.loadDe(); eq(res, false, 'başarısız indirme false döner'); eq(fetches - before, 1, 'bir istek');
for (let i = 0; i < 20; i++) { L.factText(f); L.shortText('Kısa metin.'); }
await L.loadDe(); await tick();
eq(fetches - before, 1, 'başarısızlıktan sonra bekleme süresi içinde yeniden istek yok');
L._setDe(null); fetchMode = 'throw'; before = fetches;
res = await L.loadDe(); eq(res, false, 'ağ hatası false döner');
L._setDe(null); fetchMode = { v: 1, items: 'bozuk' }; res = await L.loadDe(); eq(res, false, 'bozuk dosya reddedilir'); ok(!L.deLoaded(), 'bozuk dosya yüklenmedi');
L._setDe(null); fetchMode = DE; calls = 0;
const p1 = L.loadDe(), p2 = L.loadDe(); ok(p1 === p2, 'eşzamanlı çağrılar tek indirme'); res = await p1;
eq(res, true, 'indirme başarılı'); ok(L.deLoaded(), 'yüklendi'); eq(calls, 1, 'yükleme dili Almancayken bildirildi');
before = fetches; await L.loadDe(); eq(fetches, before, 'yüklüyken yeniden indirilmez');
L._setDe(null); L.setLang('tr'); calls = 0; await L.loadDe(); eq(calls, 0, 'Türkçeyken yükleme yeniden çizim istemez'); L.setLang('de');
off();
await tick();
eq(unhandled, 0, 'işlenmemiş söz reddi yok');

// --- gerçek dosya biçimi (içerik coordinator'ın; burada yalnız uygulamanın okuyabildiği biçim) ---
const real = JSON.parse(readFileSync(join(APP, 'public', 'data', 'quiz-de.json'), 'utf8'));
ok(real && typeof real.items === 'object' && !Array.isArray(real.items), 'quiz-de.json items nesne');
L._setDe(real);
const facts = [];
for (const file of readdirSync(join(APP, 'public', 'data')).filter(x => x.endsWith('.json') && !['meta.json', 'holes.json', 'aanki.json', 'quiz-de.json'].includes(x))) {
  const d = JSON.parse(readFileSync(join(APP, 'public', 'data', file), 'utf8'));
  for (const q of d.quiz || []) facts.push(q);
  for (const t of d.tabs || []) for (const q of t.quiz || []) facts.push(q);
  for (const rg of d.regions || []) for (const lv of rg.levels || []) for (const q of lv.facts || []) facts.push(q);
}
const used = facts.filter(q => L.factText(q).de).length;
// aynı metin farklı şıklarla: "s" alanı olmayan kayıt öteki bankanın şıklarını gösterir (veri tarafında düzeltilir)
const bySig = new Map(); for (const q of facts) { const id = P.factId(q.q); (bySig.get(id) || bySig.set(id, new Set()).get(id)).add(L.factSig(q)); }
const amb = [...bySig].filter(([id, s]) => s.size > 1 && !(real.items[id] && real.items[id].s));
console.log(`gerçek dosya: ${amb.length} soru metni birden çok şık takımıyla geçiyor ve kaydında "s" yok`);
ok(facts.length > 900, `bankalarda ${facts.length} soru`);
console.log(`gerçek dosya: ${used} / ${facts.length} soru Almanca gösterilebilir`);

console.warn = warn;
console.log(`testlang: ${passes} geçti, ${fails} hata`);
process.exit(fails ? 1 : 0);
