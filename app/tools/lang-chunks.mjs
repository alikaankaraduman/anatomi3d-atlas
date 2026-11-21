// Bir dil icin ceviri ve inceleme is listeleri uretir. Her calistirma kendi klasorune yazar ve hicbir seyi silmez:
//   data/work/<dil>/<calistirma>/new_<sistem>_<nn>.tsv   o dilde karsiligi olmayan adlar (en, la, kind, context[, hint])
//   data/work/<dil>/<calistirma>/old_<sistem>_<nn>.tsv   mevcut adlar, incelenmek uzere (--review) (en, la, kind, context, <dil>)
//   data/work/<dil>/<calistirma>/draft/                  taslaklar
//   data/work/<dil>/<calistirma>/manifest.json
// Ciktilar app/tools/<dil>/gen/ (yeni adlar) ve app/tools/<dil>/fixes/ (duzeltmeler) altina <calistirma>_ on ekiyle yazilir.
// Calistirma adi "r" + tarih-saat oldugu icin dosya adi sirasi = zaman sirasi: meta.mjs duzeltmeleri bu sirayla uygular,
// boylece sonraki inceleme oncekinin uzerine yazar. Eski taslaklar ve ciktilar asla silinmez ya da ezilmez.
// Kullanim: once `node tools/meta.mjs`, sonra `node tools/lang-chunks.mjs --lang=de [--new=140] [--old=175] [--review] [--run=ad]`
import fs from 'node:fs';
import path from 'node:path';

const opt = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const lang = opt('lang');
const COL = { tr: 5, de: 6 };
if (!(lang in COL)) { console.error('Kullanim: node tools/lang-chunks.mjs --lang=tr|de'); process.exit(1); }
const NEW_SIZE = +opt('new', 140), OLD_SIZE = +opt('old', 175);
const REVIEW = process.argv.includes('--review');
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');   // 20261119-0412
const run = opt('run', 'r' + stamp);
if (!/^[A-Za-z0-9_-]+$/.test(run)) { console.error('Gecersiz calistirma adi: ' + run); process.exit(1); }
const ROOT = path.resolve('..').replace(/\\/g, '/');   // depo koku (app/ klasorunden calistirilir)
const dir = `../data/work/${lang}/${run}`;
if (fs.existsSync(dir)) { console.error(`${dir} zaten var; baska bir --run adi verin.`); process.exit(1); }
fs.mkdirSync(`${dir}/draft`, { recursive: true });
fs.mkdirSync(`tools/${lang}/gen`, { recursive: true }); fs.mkdirSync(`tools/${lang}/fixes`, { recursive: true });

// Almanca icin Wikidata ipuclari (TA2 kimligi uzerinden eslesen etiket ve takma adlar)
const hintFile = `../data/wikidata/${lang}_hints.json`;
const hints = fs.existsSync(hintFile) ? JSON.parse(fs.readFileSync(hintFile, 'utf8')) : null;
const hintOf = en => { const h = hints?.[en]; return h ? [h.de, ...(h.alt || [])].filter(Boolean).join(' | ') : ''; };

const rows = fs.readFileSync('../data/work/names.tsv', 'utf8').split('\n').filter(Boolean).map(l => {
  const c = l.split('\t'); return { s: c[0], kind: c[1], en: c[2], la: c[3], ctx: c[4], cur: c[COL[lang]] ?? '' };
});
const bySys = list => { const m = new Map(); for (const r of list) { if (!m.has(r.s)) m.set(r.s, []); m.get(r.s).push(r); } return m; };
const order = (a, b) => a.ctx.localeCompare(b.ctx) || a.en.localeCompare(b.en);
// esit boyutlu parcalara bol (son parca cok kucuk kalmasin)
const split = (list, size) => { const n = Math.max(1, Math.ceil(list.length / size)); const per = Math.ceil(list.length / n); const out = []; for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per)); return out; };
const abs = p => `${ROOT}/${p}`;
const nn = i => String(i + 1).padStart(2, '0');
const outFile = (kind, id) => abs(`app/tools/${lang}/${kind}/${run}_${id}.json`);

const manifest = { lang, run, newChunks: [], oldChunks: [] };
for (const [s, list] of bySys(rows.filter(r => !r.cur))) {
  split(list.sort(order), NEW_SIZE).forEach((chunk, i) => {
    const id = `new_${s}_${nn(i)}`;
    const head = ['en', 'la', 'kind', 'context', ...(hints ? [`hint_${lang}`] : [])];
    fs.writeFileSync(`${dir}/${id}.tsv`, head.join('\t') + '\n' + chunk.map(r => [r.en, r.la, r.kind, r.ctx, ...(hints ? [hintOf(r.en)] : [])].join('\t')).join('\n') + '\n');
    manifest.newChunks.push({ id, system: s, count: chunk.length, file: abs(`data/work/${lang}/${run}/${id}.tsv`), draft: abs(`data/work/${lang}/${run}/draft/${id}.json`), out: outFile('gen', id) });
  });
}
if (REVIEW) for (const [s, list] of bySys(rows.filter(r => r.cur))) {
  split(list.sort(order), OLD_SIZE).forEach((chunk, i) => {
    const id = `old_${s}_${nn(i)}`;
    fs.writeFileSync(`${dir}/${id}.tsv`, ['en', 'la', 'kind', 'context', lang].join('\t') + '\n' + chunk.map(r => [r.en, r.la, r.kind, r.ctx, r.cur].join('\t')).join('\n') + '\n');
    manifest.oldChunks.push({ id, system: s, count: chunk.length, file: abs(`data/work/${lang}/${run}/${id}.tsv`), out: outFile('fixes', id) });
  });
}
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
const sum = l => l.reduce((a, c) => a + c.count, 0);
console.log(`[${lang}] calistirma ${run} -> ${dir}`);
console.log(`[${lang}] cevrilecek: ${manifest.newChunks.length} parca, ${sum(manifest.newChunks)} ad -> ${manifest.newChunks.map(c => c.id + ':' + c.count).join(', ')}`);
if (REVIEW) console.log(`[${lang}] incelenecek: ${manifest.oldChunks.length} parca, ${sum(manifest.oldChunks)} ad -> ${manifest.oldChunks.map(c => c.id + ':' + c.count).join(', ')}`);
if (hints) console.log(`ipucu olan ad: ${rows.filter(r => !r.cur && hintOf(r.en)).length}`);
