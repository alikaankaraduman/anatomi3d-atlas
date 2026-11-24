// Topografik patoloji vakaları: data/work/patho/cases.json -> public/data/patho.json (uygulamanın Patoloji modu, src/patho.js).
// Vaka metinleri olduğu gibi kopyalanır; derleme yalnız denetler: her model adı meta.json'da var mı, sinir vakasının lezyon
// yeri locomotor.json'da (nerves.list[].sites ve geo.sites) var mı, beyin vakasının arteri brain.json'da var mı, felçli kas
// listesi lezyon yerinin "lost" listesiyle aynı mı, şıklar iki dilde aynı sayıda mı. Hata varsa dosya yazılmaz.
// Kranial sinir vakaları (system 'cranial', yazım kuralları data/work/patho/SPEC-cranial.md) kranial sinir ve kas adlarını da denetler.
// Çalıştırma (app/ içinde): node tools/patho-build.mjs
import fs from 'node:fs';

const SRC = '../data/work/patho/cases.json', OUT = 'public/data/patho.json';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const src = read(SRC);
for (const f of fs.readdirSync('../data/work/patho').filter(f => /^new-.*.json$/.test(f)).sort()) src.cases.push(...read('../data/work/patho/' + f));   // sonraki partiler (new-arm.json, new-leg.json …)
const meta = read('public/data/meta.json'), loco = read('public/data/locomotor.json'), brain = read('public/data/brain.json');
const names = new Set(meta.items.map(i => i.n));
const muscles = new Set(meta.items.filter(i => i.s === 'muscle' || i.n === 'Iris').map(i => i.n));
const PTS = '../data/work/patho/cranial-points.json', points = fs.existsSync(PTS) ? read(PTS) : {};
const warn = [];
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
    if (!Array.isArray(c.folge?.paralysed) || (!c.folge.paralysed.length && (site?.lost || []).length)) err(c, 'folge.paralysed boş');   // yalnız duyusal lezyonda (lost boş) boş olabilir
    need(c, c.folge?.paralysed, 'paralysed');
    if (site && !same(site.lost || [], c.folge?.paralysed || [])) err(c, 'paralysed, lezyon yerinin lost listesiyle aynı değil');
  } else if (c.system === 'brain') {
    if (!brain.arteries.list.some(a => a.key === c.struktur?.artery)) err(c, `arter yok: ${c.struktur?.artery}`);
    if (!c.folge?.territory?.length) err(c, 'folge.territory boş');
    if (c.struktur?.view && !['lateral', 'medial', 'deep', 'orbit'].includes(c.struktur.view)) err(c, `bilinmeyen bakış: ${c.struktur.view}`);
    need(c, c.folge?.territory, 'territory');
  } else if (c.system === 'cranial') {
    // kranial sinir vakası: struktur.cn (I–XII), sarı parçalar n, kırmızı parçalar lesion, lezyon noktası at {on, near};
    // felçli ve sağlam kaslar yalnız kas sisteminden; nokta (struktur.p) data/work/patho/cranial-points.json'dan gelir
    const cns = c.struktur?.cn || [];
    if (!cns.length) err(c, 'struktur.cn boş');
    for (const k of cns) if (!brain.nerves.list.some(n => n.num === k)) err(c, `kranial sinir yok: ${k}`);
    if (!(c.struktur?.n || []).length) err(c, 'struktur.n boş');
    need(c, c.struktur?.lesion, 'struktur.lesion');
    if (c.struktur?.at) {
      need(c, [c.struktur.at.on, c.struktur.at.near], 'struktur.at');
      if (points[c.key]) c.struktur.p = points[c.key]; else warn.push(`${c.key}: lezyon noktası henüz hesaplanmadı (cranial-points.json)`);
    }
    if (!Array.isArray(c.folge?.paralysed)) err(c, 'folge.paralysed dizi değil');
    for (const k of ['paralysed', 'kept']) for (const n of c.folge?.[k] || []) if (!muscles.has(n)) err(c, `${k}: kas değil ya da modelde yok: ${n}`);
  } else err(c, `bilinmeyen sistem: ${c.system}`);
  const f = c.frage || {};
  if (!f.q_de || !f.q_tr || !f.explain_de || !f.explain_tr) err(c, 'soru metinleri eksik');
  if ((f.options_de || []).length < 2 || f.options_de.length !== (f.options_tr || []).length) err(c, 'şıklar iki dilde aynı sayıda değil');
  if ((c.folge?.deficits_de || []).length !== (c.folge?.deficits_tr || []).length) err(c, 'deficits iki dilde aynı sayıda değil');
}
const keys = src.cases.map(c => c.key);
if (new Set(keys).size !== keys.length) errs.push('yinelenen vaka anahtarı');

if (warn.length) console.warn(warn.join('\n'));
if (errs.length) { console.error(errs.join('\n')); console.error(`${errs.length} hata; ${OUT} yazılmadı`); process.exit(1); }
// sıra: kol sinirleri, bacak sinirleri, kranial sinirler, beyin (panelde ◀ ▶ bu sırayla gezer); grup içinde dosyadaki sıra korunur
const rank = c => (c.system === 'brain' ? 3 : c.system === 'cranial' ? 2 : loco.nerves.list.find(n => n.key === c.struktur.site.split('@')[0])?.region === 'leg' ? 1 : 0);
src.cases = src.cases.map((c, i) => [rank(c), i, c]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]);
const out = { v: src.v, date: src.date, title_de: src.title_de, note: src.note, cases: src.cases };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT}: ${src.cases.length} vaka (${src.cases.filter(c => c.system === 'nerve').length} sinir, ${src.cases.filter(c => c.system === 'cranial').length} kranial, ${src.cases.filter(c => c.system === 'brain').length} beyin), ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
