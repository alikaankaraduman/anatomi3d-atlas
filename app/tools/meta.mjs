// Tum kaynaklarin meta dosyalarini birlestirir, Latince grup adlarini ve ceviri sozluklerini ekler
// -> public/data/meta.json
//
// Her dil icin sozluk katmanlari (sonraki oncekini ezer), <dil> = tr | de:
//   tools/<dil>/*.mjs          elle yazilmis ya da kuralla uretilmis temel sozlukler (export default { "English": "..." })
//   tools/<dil>/gen/*.json     toplu cevrilmis sozlukler       ({ "English": "..." })
//   tools/<dil>/fixes/*.json   inceleme sonrasi duzeltmeler    ({ "English": "..." })
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SOURCES } from './sources.mjs';
import { latin } from './ta2.mjs';
import { sexOf } from './sex.mjs';
import { boundaryRatios } from './openness.mjs';

const LANGS = ['tr', 'de'];

const items = []; const groups = []; const skipped = [];
// Ayni sistemdeki kaynaklar ayni ad yolundaki gruplari paylasir (kadin organlari "Genital systems" altina, kadin
// pelvisi erkek pelvisinin gruplarina katilir). Anahtar: sistem + kokten itibaren grup adlari.
const pathKey = []; const keyIndex = new Map();
for (const [name, S] of Object.entries(SOURCES)) {
  const file = `../data/work/meta_${name}.json`;
  if (!fs.existsSync(file)) { skipped.push(name); continue; }
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = [];   // kaynak icindeki grup indisi -> birlesik indis (gruplar ebeveynden sonra gelir)
  for (const [li, g] of m.groups.entries()) {
    const parent = g.p < 0 ? -1 : map[g.p];
    const key = (parent < 0 ? S.sys : pathKey[parent]) + '/' + g.n;
    if (keyIndex.has(key)) { map[li] = keyIndex.get(key); continue; }
    const la = latin(g.n);
    map[li] = groups.length; keyIndex.set(key, groups.length); pathKey.push(key);
    groups.push({ n: g.n, p: parent, s: S.sys, ...(la ? { la } : {}) });
  }
  // x: cinsiyete ozgu parca ('m' | 'f'); kaynak duzeyinde (sex) ya da sex.mjs listesinden
  for (const it of m.items) { const x = S.sex || sexOf(it.n); items.push({ ...it, g: it.g < 0 ? -1 : map[it.g], s: S.sys, ...(x ? { x } : {}) }); }
}
if (skipped.length) console.log('UYARI: donusturulmemis kaynaklar atlandi:', skipped.join(', '));
// Kaynakta es kopyalardan birinin yan eki (.l / .r) eksik olabilir (2026-11-20: Cochlear nerve, Iliocostalis colli,
// Ulnopisiform ligament ...; geometriyle dogrulandi). Ayni sistemde ve ayni cinsiyet
// kumesinde ayni adi tasiyan tam iki kayittan biri etiketli, oburu etiketsizse etiketsiz olan karsi yanin kopyasidir.
{
  const by = new Map();
  for (const it of items) { const k = it.s + '|' + (it.x || '') + '|' + it.n; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
  let fixed = 0;
  for (const rs of by.values()) {
    if (rs.length !== 2) continue;
    const [p, q] = rs[0].sd ? rs : [rs[1], rs[0]];
    if (p.sd && !q.sd) { q.sd = p.sd === 'l' ? 'r' : 'l'; fixed++; }
  }
  if (fixed) console.log('yan etiketi tamamlanan es kopya:', fixed);
}

const pathOf = gi => { const p = []; for (let i = gi; i >= 0; i = groups[i].p) p.unshift(groups[i].n); return p; };
const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort() : []);

// --- Latince: kaynak tablodaki bicim hatalari temizlenir, sonra inceleme duzeltmeleri uygulanir ---
// Latincede aksan yoktur (kaynakta Fransizcadan kalma "latérales" gibi yazimlar var); TA2'nin "resmi olmayan terim"
// isareti olan dis parantez baslikta gereksizdir; bilinen bir yazim hatasi duzeltilir.
const normLa = s => {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\biymphoidei\b/g, 'lymphoidei').replace(/\s+/g, ' ').trim();
  const m = /^\(([^()]*)\)$/.exec(t); if (m) t = m[1].trim();
  return t;
};
const laFix = {};
for (const f of list('tools/la/fixes', '.json')) Object.assign(laFix, JSON.parse(fs.readFileSync('tools/la/fixes/' + f, 'utf8')));
let laFixed = 0;
for (const o of [...items, ...groups]) {
  if (o.la) o.la = normLa(o.la);
  if (laFix[o.n]) { if (laFix[o.n] !== o.la) laFixed++; o.la = laFix[o.n]; }
}
// Kas yapisma yerleri (tools/attach.mjs): "<kas> (origin|insertion)" parcalarinin adlari kasin adindan kurulur:
// Latince "Musculus tibialis anterior – origo", Almanca "Vorderer Schienbeinmuskel – Ursprung", Turkce "Tibialis anterior kasi – origo"
// (kasin adinda zaten parantez olabildigi icin tur tireyle ayrilir).
// Kas adlarinin Latincesinde TA'daki "Musculus" basi (kaynak tablo bazilarinda atar): "Supinator" -> "Musculus supinator";
// cogul adlar "Musculi" alir. Yalniz kas sistemindeki kas parcalari; Galea, Tarsus, Anulus gibi kas olmayanlar dokunulmaz.
const MUSC1 = /^(Abductor|Adductor|Extensor|Flexor|Levator|Obturator|Pronator|Psoas|Supinator|Tensor|Bucinator|Opponens|Sphincter|Constrictor|Depressor|Dilatator|Compressor|Corrugator)\b/;
const MUSCN = /^(Levatores|Interossei|Lumbricales|Rotatores)\b/;
const lower1 = s => s[0].toLowerCase() + s.slice(1);
for (const it of items) if (it.s === 'muscle' && it.sub === 'muscle' && it.la) { if (MUSCN.test(it.la)) it.la = 'Musculi ' + lower1(it.la); else if (MUSC1.test(it.la)) it.la = 'Musculus ' + lower1(it.la).replace(/^bucinator/, 'buccinator'); }
const ATT = /^(.+) \((origin|insertion)\)$/;
const ATT_WORD = { la: { origin: 'origo', insertion: 'insertio' }, tr: { origin: 'origo', insertion: 'insersiyo' }, de: { origin: 'Ursprung', insertion: 'Ansatz' } };
const laOfName = new Map(); for (const o of [...items, ...groups]) if (o.la && !ATT.test(o.n) && !laOfName.has(o.n)) laOfName.set(o.n, o.la);
const attBases = new Set();
for (const it of items) { const m = ATT.exec(it.n); if (!m) continue; attBases.add(m[1]); const b = laFix[m[1]] ?? laOfName.get(m[1]) ?? latin(m[1]); if (b) it.la = `${normLa(b)} – ${ATT_WORD.la[m[2]]}`; }
const laUnused = Object.keys(laFix).filter(k => !items.some(i => i.n === k) && !groups.some(g => g.n === k) && !attBases.has(k));

// --- sozlukler ---
async function loadDict(lang) {
  const dict = {}; const origin = {}; const conflicts = [];
  const put = (src, obj, override) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (k in dict && dict[k] !== v.trim() && !override) conflicts.push(`${k}: "${dict[k]}" (${origin[k]}) / "${v}" (${src})`);
      if (!(k in dict) || override) { dict[k] = v.trim(); origin[k] = src; }
    }
  };
  const dir = `tools/${lang}`;
  for (const f of list(dir, '.mjs')) put(f, (await import(pathToFileURL(`${dir}/${f}`).href)).default, false);
  for (const f of list(`${dir}/gen`, '.json')) put('gen/' + f, JSON.parse(fs.readFileSync(`${dir}/gen/${f}`, 'utf8')), false);
  for (const f of list(`${dir}/fixes`, '.json')) put('fixes/' + f, JSON.parse(fs.readFileSync(`${dir}/fixes/${f}`, 'utf8')), true);
  return { dict, conflicts };
}

const report = {};
for (const lang of LANGS) {
  const { dict, conflicts } = await loadDict(lang);
  const used = new Set(); const missing = new Map(); let nItems = 0, nGroups = 0;
  for (const it of items) {
    let t = dict[it.n];
    if (!t) { const m = ATT.exec(it.n); if (m && dict[m[1]]) { t = `${dict[m[1]]} – ${ATT_WORD[lang][m[2]]}`; used.add(m[1]); } }
    if (t) { it[lang] = t; nItems++; used.add(it.n); } else if (!missing.has(it.n)) missing.set(it.n, { s: it.s, kind: 'item' });
  }
  for (const g of groups) {
    const t = dict[g.n];
    if (t) { g[lang] = t; nGroups++; used.add(g.n); } else if (!missing.has(g.n)) missing.set(g.n, { s: g.s, kind: 'group' });
  }
  report[lang] = { dict, conflicts, missing, nItems, nGroups, unused: Object.keys(dict).filter(k => !used.has(k)) };
}

// Neredeyse kapalı açık parçalar (c: 1): kesitte dolu çizilebilir (src/section.js). Damarlar uçları açık tüptür,
// dışarıda kalır. Oran ve eşik için tools/openness.mjs.
const OPEN_CAP_MAX = 0.7;
const openIds = new Set(items.filter(i => i.o && i.s !== 'vessel').map(i => i.id));
const openRatio = await boundaryRatios(openIds);
for (const it of items) if (openIds.has(it.id) && openRatio.get(it.id) < OPEN_CAP_MAX) it.c = 1;
console.log(`Kesitte dolu cizilebilen acik parca: ${items.filter(i => i.c).length}/${openIds.size}`);

fs.mkdirSync('public/data', { recursive: true });
const sexCount = { m: items.filter(i => i.x === 'm').length, f: items.filter(i => i.x === 'f').length };
console.log(`Cinsiyete ozgu parca: erkek ${sexCount.m}, kadin ${sexCount.f}`);
fs.writeFileSync('public/data/meta.json', JSON.stringify({ v: 3, langs: LANGS, items, groups }));

// --- isim listesi (sekmeyle ayrilmis): sistem, tur, Ingilizce, Latince, baglam, tr, de ---
const uniq = new Map();
for (const it of items) if (!uniq.has(it.n)) uniq.set(it.n, { s: it.s, kind: 'item', la: it.la ?? '', ctx: pathOf(it.g).join(' > ') });
for (const g of groups) if (!uniq.has(g.n)) uniq.set(g.n, { s: g.s, kind: 'group', la: g.la ?? '', ctx: pathOf(g.p).join(' > ') });
fs.writeFileSync('../data/work/names.tsv', [...uniq].map(([n, v]) => [v.s, v.kind, n, v.la, v.ctx, ...LANGS.map(l => report[l].dict[n] ?? '')].join('\t')).join('\n'));

const size = fs.statSync('public/data/meta.json').size;
const withLa = items.filter(i => i.la).length, gWithLa = groups.filter(g => g.la).length;
console.log(`meta.json: ${items.length} parca, ${groups.length} grup, ${uniq.size} benzersiz isim, ${(size / 1024).toFixed(0)} KB`);
console.log(`Latince: parca ${withLa}/${items.length}, grup ${gWithLa}/${groups.length}, duzeltme ${laFixed}`);
if (laUnused.length) console.log(`     UYARI: Latince duzeltmelerde modelde olmayan ${laUnused.length} anahtar: ${laUnused.slice(0, 15).join(' | ')}`);
for (const lang of LANGS) {
  const r = report[lang];
  console.log(`[${lang}] parca ${r.nItems}/${items.length}, grup ${r.nGroups}/${groups.length}, eksik isim ${r.missing.size}`);
  if (r.missing.size) { const by = {}; for (const v of r.missing.values()) by[v.s + '/' + v.kind] = (by[v.s + '/' + v.kind] || 0) + 1; console.log(`     eksikler: ${JSON.stringify(by)}`); }
  if (r.conflicts.length) console.log(`     UYARI: ${r.conflicts.length} cakisan ceviri (ilk gelen korundu):\n       ` + r.conflicts.slice(0, 15).join('\n       '));
  if (r.unused.length) console.log(`     UYARI: sozlukte olup modelde olmayan ${r.unused.length} anahtar: ${r.unused.slice(0, 20).join(' | ')}`);
}
