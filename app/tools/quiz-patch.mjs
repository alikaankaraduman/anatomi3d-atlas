// Kör yanıtlama denetiminin düzeltmelerini soru bankalarına uygular (data/work/audit/fixes/<banka>-<n>.json;
// düzeltme dosyaları ve denetimin kendisi depoda olmayan çalışma klasöründedir).
//   node tools/quiz-patch.mjs [--dry]   public/data/brain.json'ı yerinde yamalar (o dosyanın derleyicisi depoda yok)
// locomotor.json ve muscles.json için tools/locomotor-build.mjs derlemenin sonunda applyFixes() çağırır; böylece
// yeniden derleme düzeltmeleri silmez.
// Düzeltme: { i, old_q, kind, q, options (doğru şık İLK), explain, reason, source }. Eşleşme old_q metniyledir (i ipucu).
import fs from 'node:fs';

const DIR = '../data/work/audit/fixes/';

export function loadFixes(bank) {
  if (!fs.existsSync(DIR)) return [];
  const mine = f => f.startsWith(bank + '-') && f.endsWith('.json') && /^[0-9]+$/.test(f.slice(bank.length + 1, -5));
  return fs.readdirSync(DIR).filter(mine).sort()
    .flatMap(f => (JSON.parse(fs.readFileSync(DIR + f, 'utf8')).fixes || []).map(x => ({ ...x, file: f })));
}

const okFix = x => typeof x.q === 'string' && x.q.trim() && typeof x.explain === 'string' && x.explain.trim()
  && Array.isArray(x.options) && x.options.length === 4 && x.options.every(o => typeof o === 'string' && o.trim())
  && new Set(x.options.map(o => o.trim())).size === 4;
const same = (q, x) => q.q === x.q && q.explain === x.explain && q.options.length === 4 && q.options.every((o, i) => o === x.options[i].trim());

// quiz dizisini yerinde değiştirir. Dönen: { applied, already, skipped } (açıklama satırları)
export function applyFixes(bank, quiz, log = console.log) {
  const fixes = loadFixes(bank), applied = [], already = [], skipped = [];
  for (const x of fixes) {
    const tag = `${x.file} #${x.i}`;
    if (!okFix(x)) { skipped.push(`${tag}: düzeltme geçersiz (dört ayrı şık, soru ve açıklama gerekli)`); continue; }
    if (quiz.some(k => same(k, x))) { already.push(tag); continue; }
    const q = quiz[x.i]?.q === x.old_q ? quiz[x.i] : quiz.find(k => k.q === x.old_q);
    if (!q) { skipped.push(`${tag}: soru bulunamadı`); continue; }
    if (quiz.some(k => k !== q && k.q === x.q)) { skipped.push(`${tag}: yeni metin başka bir soruyla aynı`); continue; }
    q.q = x.q; q.options = x.options.map(o => o.trim()); q.explain = x.explain;
    applied.push(`${tag} [${x.kind || '?'}]`);
  }
  if (fixes.length) log(`${bank}: denetim düzeltmeleri: ${applied.length} uygulandı, ${already.length} zaten uygulanmış` + (skipped.length ? `, ${skipped.length} atlandı:\n  ` + skipped.join('\n  ') : ''));
  return { applied, already, skipped };
}

if ((process.argv[1] || '').split('\\').join('/').endsWith('tools/quiz-patch.mjs')) {
  const dry = process.argv.includes('--dry');
  const f = 'public/data/brain.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!loadFixes('brain').length) console.log('brain: düzeltme dosyası yok');
  const r = applyFixes('brain', j.quiz);
  const bad = j.quiz.filter(q => !q.q || !q.explain || new Set(q.options).size !== 4);
  if (bad.length) { console.error(`brain: ${bad.length} soru geçersiz kaldı, yazılmadı`); process.exit(1); }
  if (dry) console.log('(--dry: dosya yazılmadı)');
  else if (r.applied.length) { fs.writeFileSync(f, JSON.stringify(j) + '\n'); console.log('yazıldı:', f); }
  if (r.skipped.length) process.exitCode = 1;
}
