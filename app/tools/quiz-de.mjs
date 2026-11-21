// Testlerin Almanca metinleri (public/data/quiz-de.json): Türkçe soru bankalarıyla eşleşme, yapı ve sezgisel denetim.
// Kullanım (app/ içinde):
//   node tools/quiz-de.mjs list      bankalar ve soru sayıları
//   node tools/quiz-de.mjs check     quiz-de.json denetimi: kapsam, yapı (hata) ve sezgisel uyarılar; hata varsa çıkış 1
//   node tools/quiz-de.mjs check -v  uyarıları da tek tek yazar
//
// Dosya biçimi:
//   { "v": 1, "lang": "de",
//     "items": { "<anahtar>": { "q": "soru", "o": ["doğru şık", "çeldirici", ...], "e": "açıklama", "s": "<parmak izi>" } },
//     "texts": { "<kimlik>": "kısa metin" } }
// - items: bilgi soruları. Kimlik = Türkçe soru metninin özeti (src/progress.js factId, 'f:...'); "o" Türkçe "options"
//   ile aynı uzunlukta ve aynı sırada (ilk şık doğru), "e" Türkçe "explain" karşılığı (Türkçesi boşsa boş).
//   "s": kaydın hangi Türkçe şıklar ve açıklama için yazıldığının parmak izi (src/testlang.js factSig); uygulama
//   parmak izi tutmayan kaydı kullanmaz (Türkçe şıklar ya da açıklama değişmişse eski Almanca gösterilmez).
//   Anahtar: aynı soru metni birden çok bankada farklı şıklarla geçebilir; ilk geçtiği yerin kaydı "<kimlik>",
//   ötekilerin kaydı "<kimlik>~<parmak izi>" anahtarıyla durur.
// - texts: testte cevaptan sonra gösterilen kısa metinler (kesit atlası: ask[].tr ve ask[].tip). Kimlik = kaynaktaki
//   metnin özeti. İpuçlarının (tip) bir kısmı kaynakta zaten Almanca ya da Latincedir; onların kaydı aynı metindir.
// İlerleme kimliği de Türkçe metnin özeti olduğu için dil değişince ilerleme ortak kalır. Türkçe bir metin değişirse
// özeti değişir, Almancası bulunamaz ve uygulama o metni Türkçe gösterir; bu betik eksikleri bildirir.
//
// Kaynak: Türkçe bankalar public/data/*.json içindedir (veri derleyicileri üretir); Almanca metinler yalnız
// public/data/quiz-de.json dosyasında durur ve derleyiciler ona dokunmaz.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { factId } from '../src/progress.js';
import { factSig, tipLang } from '../src/testlang.js';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(APP, 'public', 'data');
export const DE_FILE = join(DATA, 'quiz-de.json');
// soru taşımayan ya da çeviri dosyasının kendisi
const SKIP = new Set(['meta.json', 'holes.json', 'aanki.json', 'quiz-de.json']);
export { factId, factSig, tipLang };

const validQ = f => f && typeof f.q === 'string' && Array.isArray(f.options) && f.options.length >= 2 && f.options.every(o => typeof o === 'string');

// Bütün bankalardaki bilgi sorularını ve kısa metinleri toplar (deneme sınavındaki okuma kurallarıyla: exam.js).
// facts: [{ id, file, sub, q, options, explain }], texts: [{ id, file, sub, tr, la, de }]; aynı metin bir kez alınır.
export function collect(dataDir = DATA) {
  const facts = [], texts = [], errors = [];
  const seenF = new Map(), seenT = new Map();
  const addFact = (f, file, sub) => {
    if (!validQ(f)) { errors.push(`${file} (${sub}): geçersiz soru: ${JSON.stringify(f).slice(0, 80)}`); return; }
    const id = factId(f.q), explain = typeof f.explain === 'string' ? f.explain : '';
    const sig = factSig({ options: f.options, explain });
    const prev = seenF.get(id);
    if (prev && prev.q !== f.q) { errors.push(`özet çakışması ${id}: "${f.q.slice(0, 50)}" / "${prev.q.slice(0, 50)}"`); return; }
    if (prev && prev.sigs.has(sig)) return;   // aynı soru, aynı şıklar ve açıklama: bir kez
    // aynı soru metni başka şıklarla (başka banka): ayrı kayıt, anahtarı "<kimlik>~<parmak izi>"
    const key = prev ? id + '~' + sig : id;
    if (prev) prev.sigs.add(sig); else seenF.set(id, { q: f.q, sigs: new Set([sig]) });
    facts.push({ id, sig, key, file, sub, q: f.q, options: f.options, explain });
  };
  // kind: 'ask' (ask[].tr: Türkçe tanıma metni) ya da 'tip' (ask[].tip: kısa ipucu; Türkçe, Almanca ya da Latince)
  const addText = (text, kind, a, file, sub) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const id = factId(text);
    if (seenT.has(id)) { if (seenT.get(id) !== text) errors.push(`özet çakışması ${id} (metin)`); return; }
    seenT.set(id, text);
    texts.push({ id, kind, file, sub, tr: text, la: a.la || '', de: a.de || '' });
  };
  for (const file of readdirSync(dataDir).filter(f => f.endsWith('.json') && !SKIP.has(f)).sort()) {
    const d = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    for (const f of Array.isArray(d.quiz) ? d.quiz : []) addFact(f, file, f.cat || '');
    for (const t of Array.isArray(d.tabs) ? d.tabs : []) for (const f of t.quiz || []) addFact(f, file, t.key);
    for (const r of Array.isArray(d.regions) ? d.regions : []) for (const l of r.levels || []) {
      for (const f of l.facts || []) addFact(f, file, r.key);
      for (const a of l.ask || []) { addText(a.tr, 'ask', a, file, r.key); addText(a.tip, 'tip', a, file, r.key); }
    }
  }
  return { facts, texts, errors };
}

// ---------- denetim ----------
const TR_LETTERS = /[ğĞşŞıİ]/;
// Almanca metinde olmaması gereken Türkçe sözcükler (Almancada sözcük olarak geçmeyenler)
const TR_WORDS = /(?<![\p{L}\p{N}])(?:ve|ile|için|hangi|hangisi|hangisidir|değil|değildir|olan|olarak|bir|bu|şu|nedir|neresidir|arasında|yalnız|yalnızca|çünkü|ancak|veya|ya da|gibi|kadar|sonra|önce|doğru|yanlış)(?![\p{L}\p{N}])/iu;
const norm = s => s.replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
// sayılar: 12 / 1,5 / 1.5 (ondalık ayırıcı farkı sayılmaz)
const numbers = s => (norm(s).match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.'));
// omur ve segment seviyeleri: C5, Th12 (T12), L1, S2
const levels = s => (norm(s).match(/(?<![\p{L}\p{N}])(?:C|Th|T|L|S|Co)\s?\d{1,2}(?![\p{L}\d])/g) || []).map(x => x.replace(/\s/g, '').replace(/^T(?=\d)/, 'Th'));
// Latince kısaltmalı terimler: "N. radialis", "Lig. inguinale" (Türkçe ek atılır: "N. radialis'in" -> "N. radialis")
const ABBR = /(?<![\p{L}\p{N}])(Mm|Nn|Aa|Vv|Rr|Ligg|Gll|Nll|Lig|Art|Proc|For|Gl|Nl|Tr|M|N|A|V|R)\.\s?([A-Za-z]{3,})/gu;
const abbrTerms = s => [...norm(s).matchAll(ABBR)].map(m => (m[1] + '. ' + m[2]).toLowerCase());
const missing = (a, b) => { const left = [...b]; return a.filter(x => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; }); };

// Bir Türkçe / Almanca metin çiftinin sezgisel karşılaştırması: { errors: [...], warnings: [...] }
export function comparePair(tr, de, { allowSame = false } = {}) {
  const errors = [], warnings = [];
  if (typeof de !== 'string' || !de.trim()) { if (tr.trim()) errors.push('Almanca metin boş'); return { errors, warnings }; }
  if (/\[DE\]/.test(de)) errors.push('yer tutucu ([DE]) kalmış');
  if (TR_LETTERS.test(de)) errors.push('Türkçe harf (ğ ş ı İ) var');
  const w = TR_WORDS.exec(de);
  if (w) errors.push(`Türkçe sözcük kalmış: "${w[0]}"`);
  if (!allowSame && norm(de) === norm(tr) && (TR_LETTERS.test(tr) || TR_WORDS.test(tr))) errors.push('çevrilmemiş (Türkçesiyle aynı)');
  const mn = missing(numbers(tr), numbers(de));
  if (mn.length) warnings.push(`sayı eksik ya da değişmiş: ${mn.join(', ')}`);
  const ml = missing(levels(tr), levels(de));
  if (ml.length) warnings.push(`seviye eksik ya da değişmiş: ${ml.join(', ')}`);
  const ma = missing([...new Set(abbrTerms(tr))], abbrTerms(de));
  if (ma.length) warnings.push(`Latince terim eksik ya da değişmiş: ${ma.join(', ')}`);
  const r = de.length / Math.max(1, tr.length);
  if (tr.length >= 25 && (r < 0.45 || r > 2.6)) warnings.push(`uzunluk oranı olağan dışı (${r.toFixed(2)})`);
  if (/\s{2,}|^\s|\s$/.test(de)) warnings.push('fazla boşluk');
  return { errors, warnings };
}

// Bir sorunun Almancası: yapı (hata) ve sezgisel karşılaştırma
export function checkItem(f, d) {
  const errors = [], warnings = [];
  if (!d || typeof d !== 'object') return { errors: ['Almancası yok'], warnings };
  if (typeof d.q !== 'string' || !Array.isArray(d.o) || d.o.some(x => typeof x !== 'string')) return { errors: ['biçim bozuk (q, o)'], warnings };
  if (d.o.length !== f.options.length) errors.push(`şık sayısı farklı (${d.o.length} / ${f.options.length})`);
  // f.sig verilmişse (dosya denetimi): kayıt bu Türkçe şıklar ve açıklama için yazılmış olmalı
  if (f.sig != null && d.s !== f.sig) errors.push('parmak izi (s) eksik ya da farklı: Türkçe şıklar ya da açıklama değişmiş olabilir');
  if (d.e != null && typeof d.e !== 'string') errors.push('e bir metin değil');
  const add = (where, r) => { for (const x of r.errors) errors.push(`${where}: ${x}`); for (const x of r.warnings) warnings.push(`${where}: ${x}`); };
  add('soru', comparePair(f.q, d.q));
  f.options.forEach((o, i) => { if (i < d.o.length) add(`şık ${i + 1}`, comparePair(o, d.o[i], { allowSame: true })); });
  if (f.explain.trim()) add('açıklama', comparePair(f.explain, d.e || ''));
  else if (d.e && d.e.trim()) warnings.push('açıklama: Türkçesi boş, Almancası dolu');
  const seen = new Set();
  for (const o of d.o) { const k = norm(o).toLowerCase(); if (seen.has(k)) errors.push(`aynı şık iki kez: "${o.slice(0, 40)}"`); seen.add(k); }
  return { errors, warnings };
}

// Bütün dosyanın denetimi
export function checkAll(de, { facts, texts }) {
  const errors = [], warnings = [];
  if (!de || de.v !== 1 || de.lang !== 'de' || typeof de.items !== 'object' || !de.items) return { errors: ['dosya biçimi bozuk (v, lang, items)'], warnings, stats: {} };
  const tx = de.texts && typeof de.texts === 'object' ? de.texts : {};
  let okF = 0, okT = 0;
  for (const f of facts) {
    const r = checkItem(f, de.items[f.key]);
    if (!r.errors.length) okF++;
    for (const x of r.errors) errors.push(`${f.key} [${f.file} ${f.sub}] ${x} | ${f.q.slice(0, 60)}`);
    for (const x of r.warnings) warnings.push(`${f.key} [${f.file} ${f.sub}] ${x} | ${f.q.slice(0, 60)}`);
  }
  for (const t of texts) {
    const d = tx[t.id];
    if (typeof d !== 'string' || !d.trim()) { errors.push(`${t.id} [${t.file} ${t.sub}] metnin Almancası yok | ${t.tr.slice(0, 60)}`); continue; }
    // ipucu kaynakta zaten Almanca ya da Latince ise kaydı aynı metin olabilir; Türkçe ipucu çevrilmiş olmalı
    const r = comparePair(t.tr, d, { allowSame: t.kind === 'tip' && tipLang(t.tr) !== 'tr' });
    if (t.kind === 'tip' && tipLang(t.tr) === 'tr' && d.trim() === t.tr.trim()) r.errors.push('Türkçe ipucu çevrilmemiş');
    if (!r.errors.length) okT++;
    for (const x of r.errors) errors.push(`${t.id} [${t.file} ${t.sub}] metin: ${x} | ${t.tr.slice(0, 60)}`);
    for (const x of r.warnings) warnings.push(`${t.id} [${t.file} ${t.sub}] metin: ${x} | ${t.tr.slice(0, 60)}`);
  }
  const ids = new Set(facts.map(f => f.key)), tids = new Set(texts.map(t => t.id));
  const orphanItems = Object.keys(de.items).filter(k => !ids.has(k)), orphanTexts = Object.keys(tx).filter(k => !tids.has(k));
  if (orphanItems.length) warnings.push(`${orphanItems.length} Almanca sorunun Türkçesi artık yok (ör. ${orphanItems.slice(0, 3).join(', ')})`);
  if (orphanTexts.length) warnings.push(`${orphanTexts.length} Almanca metnin Türkçesi artık yok (ör. ${orphanTexts.slice(0, 3).join(', ')})`);
  return { errors, warnings, stats: { facts: facts.length, factsOk: okF, texts: texts.length, textsOk: okT, orphanItems: orphanItems.length, orphanTexts: orphanTexts.length } };
}

// ---------- komut satırı ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] || 'check';
  const c = collect();
  if (c.errors.length) { console.error(c.errors.join('\n')); process.exit(1); }
  if (cmd === 'list') {
    const by = new Map();
    for (const f of c.facts) { const k = `${f.file} ${f.sub}`; by.set(k, (by.get(k) || 0) + 1); }
    for (const [k, n] of by) console.log(String(n).padStart(5), k);
    const variants = c.facts.filter(f => f.key !== f.id).length, tips = c.texts.filter(t => t.kind === 'tip').length;
    console.log(`${c.facts.length} bilgi sorusu (${variants} tanesi aynı metnin başka şıklı hâli), ${c.texts.length} kısa metin (${tips} ipucu)`);
  } else if (cmd === 'check') {
    if (!existsSync(DE_FILE)) { console.error('public/data/quiz-de.json yok'); process.exit(1); }
    const r = checkAll(JSON.parse(readFileSync(DE_FILE, 'utf8')), c);
    for (const e of r.errors.slice(0, 60)) console.error('HATA  ' + e);
    if (r.errors.length > 60) console.error(`... ve ${r.errors.length - 60} hata daha`);
    if (process.argv.includes('-v')) for (const w of r.warnings) console.log('uyarı ' + w);
    console.log(`quiz-de: ${r.stats.factsOk}/${r.stats.facts} soru, ${r.stats.textsOk}/${r.stats.texts} metin tamam; ${r.errors.length} hata, ${r.warnings.length} uyarı`);
    process.exit(r.errors.length ? 1 : 0);
  } else { console.error('Kullanım: node tools/quiz-de.mjs list | check [-v]'); process.exit(2); }
}
