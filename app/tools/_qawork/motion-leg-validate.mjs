// Bacak hareketi: ders kitabı tablosu (ekransız). Her hareketin başı ve sonu arasında kas boylarının değişimi (orta
// çizgiden, uygulamadaki gibi); ders kitabı ana kaslarından kaçı modelde de % 2'den fazla kısalıyor.
// Çalıştırma (app/ içinde): node tools/_qawork/motion-leg-validate.mjs [--all]
import fs from 'node:fs';
import * as K from '../../src/motion-kin-leg.js';
const data = JSON.parse(fs.readFileSync('public/data/motion-leg.json', 'utf8'));
const M = K.createModel(data), o = K.createFk(M);
const mus = data.skin.parts.filter(p => p.kind === 'muscle' && p.line?.length > 1).map(p => ({ n: p.n, cl: K.compileLine(M, p.line) }));
const L = q => { K.fk(M, K.clampPose(M, q, {}), o); return mus.map(m => K.lineLength(o, m.cl)); };
let ok = 0, all = 0;
for (const m of data.movements) {
  const a = K.clampPose(M, { ...M.rest, ...m.from }), b = K.clampPose(M, { ...a, ...m.set });
  const la = L(a), lb = L(b), d = mus.map((x, i) => (lb[i] - la[i]) / la[i]);
  const rows = m.textbook.map(n => { const i = mus.findIndex(x => x.n === n); return i < 0 ? `    –     ${n} (modelde yok)` : `  ${d[i] <= -0.02 ? 'kısa' : d[i] >= 0.02 ? 'UZUN' : 'nötr'} ${(d[i] * 100).toFixed(1).padStart(6)} %  ${n}`; });
  const y = m.textbook.filter(n => { const i = mus.findIndex(x => x.n === n); return i >= 0 && d[i] <= -0.02; }).length, t = m.textbook.filter(n => mus.some(x => x.n === n)).length;
  ok += y; all += t;
  console.log(`${m.key} ${m.de}: ${y} / ${t} ders kitabı kası kısalıyor`);
  if (process.argv.includes('--all') || y < t) console.log(rows.join('\n'));
}
console.log(`\ntoplam: ${ok} / ${all}`);
