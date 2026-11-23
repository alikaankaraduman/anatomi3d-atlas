// Topografik patoloji vakaları: data/work/patho/cases.json -> public/data/patho.json (uygulamanın Patoloji modu, src/patho.js).
// Vaka metinleri olduğu gibi kopyalanır; derleme yalnız denetler: her model adı meta.json'da var mı, sinir vakasının lezyon
// yeri locomotor.json'da (nerves.list[].sites ve geo.sites) var mı, beyin vakasının arteri brain.json'da var mı, felçli kas
// listesi lezyon yerinin "lost" listesiyle aynı mı, şıklar iki dilde aynı sayıda mı. Hata varsa dosya yazılmaz.
// Çalıştırma (app/ içinde): node tools/patho-build.mjs
import fs from 'node:fs';

const SRC = '../data/work/patho/cases.json', OUT = 'public/data/patho.json';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const src = read(SRC), meta = read('public/data/meta.json'), loco = read('public/data/locomotor.json'), brain = read('public/data/brain.json');
const names = new Set(meta.items.map(i => i.n));
const errs = [];
const err = (c, s) => errs.push(`${c.key}: ${s}`);
const need = (c, list, what) => { for (const n of list || []) if (!names.has(n)) err(c, `${what}: modelde yok: ${n}`); };
const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

for (const c of src.cases) {
  for (const k of ['key', 'system', 'title_de', 'befund_de', 'befund_tr', 'mechanismus_de', 'mechanismus_tr']) if (!c[k]) err(c, `${k} boş`);
  need(c, c.struktur?.n, 'struktur.n');
  if (c.system === 'nerve') {
    const [nk, sk] = (c.struktur?.site || '').split('@');
    const nv = loco.nerves.list.find(n => n.key === nk), site = nv?.sites?.find(s => s.key === sk);
    if (!site) err(c, `lezyon yeri yok: ${c.struktur?.site}`);
    if (!loco.geo?.sites?.[c.struktur?.site]?.p) err(c, `geo.sites noktası yok: ${c.struktur?.site}`);
    if (!c.folge?.paralysed?.length) err(c, 'folge.paralysed boş');
    need(c, c.folge?.paralysed, 'paralysed');
    if (site && !same(site.lost || [], c.folge?.paralysed || [])) err(c, 'paralysed, lezyon yerinin lost listesiyle aynı değil');
  } else if (c.system === 'brain') {
    if (!brain.arteries.list.some(a => a.key === c.struktur?.artery)) err(c, `arter yok: ${c.struktur?.artery}`);
    if (!c.folge?.territory?.length) err(c, 'folge.territory boş');
    need(c, c.folge?.territory, 'territory');
  } else err(c, `bilinmeyen sistem: ${c.system}`);
  const f = c.frage || {};
  if (!f.q_de || !f.q_tr || !f.explain_de || !f.explain_tr) err(c, 'soru metinleri eksik');
  if ((f.options_de || []).length < 2 || f.options_de.length !== (f.options_tr || []).length) err(c, 'şıklar iki dilde aynı sayıda değil');
  if ((c.folge?.deficits_de || []).length !== (c.folge?.deficits_tr || []).length) err(c, 'deficits iki dilde aynı sayıda değil');
}
const keys = src.cases.map(c => c.key);
if (new Set(keys).size !== keys.length) errs.push('yinelenen vaka anahtarı');

if (errs.length) { console.error(errs.join('\n')); console.error(`${errs.length} hata; ${OUT} yazılmadı`); process.exit(1); }
const out = { v: src.v, date: src.date, title_de: src.title_de, note: src.note, cases: src.cases };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT}: ${src.cases.length} vaka (${src.cases.filter(c => c.system === 'nerve').length} sinir, ${src.cases.filter(c => c.system === 'brain').length} beyin), ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
