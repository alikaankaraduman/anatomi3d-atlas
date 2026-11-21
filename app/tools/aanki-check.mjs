// Aanki eşleştirmesini doğrular: her konunun kurallarını (grup ve yapı adları) meta.json'a göre çözer, sistem başına
// yapı sayısını ve bulunamayan adları yazar. Bulunamayan ad varsa çıkış kodu 1.
// Kullanım: node tools/aanki-check.mjs [kural dosyası]   (verilmezse public/data/aanki.json)
//           node tools/aanki-check.mjs dosya.json --list <konu-id>   (konunun yapılarını da listeler)
//
// Kural biçimi (src/aanki.js aynı biçimi çalışma anında çözer):
//   groups:  grup adları (meta.json'daki İngilizce ad, tam eşleşme); grubun bütün alt yapıları. Aynı ad birden çok
//            yerde varsa hepsi alınır; "sistem:Ad" (ör. "muscle:Fasciae of upper limb") ya da "Üst > Alt" yolu daraltır.
//   items:   yapı adları (İngilizce ad, tam eşleşme); her iki taraf ve iki cinsiyet. "sistem:Ad" de olur.
//   exclude: aynı biçimde grup ya da yapı adları; birleşimden çıkarılır.
import fs from 'node:fs';
import { makeResolver } from '../src/aanki.js';

const args = process.argv.slice(2);
const file = args[0] && !args[0].startsWith('--') ? args[0] : 'public/data/aanki.json';
const listId = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const topics = data.topics ?? data;
const resolve = makeResolver(meta);

let bad = 0;
for (const t of topics) {
  const { items, missing } = resolve(t);
  const by = {};
  for (const it of items) by[it.s] = (by[it.s] || 0) + 1;
  const sys = Object.entries(by).map(([s, n]) => `${s} ${n}`).join(', ');
  console.log(`${t.id.padEnd(16)} ${String(items.length).padStart(4)}  ${sys}${missing.length ? '   BULUNAMADI: ' + missing.join(' | ') : ''}`);
  if (missing.length) bad++;
  if (listId === t.id) {
    const names = [...new Set(items.map(i => `[${i.s}] ${i.n}`))].sort();
    console.log(names.map(n => '    ' + n).join('\n'));
  }
}
console.log(`\n${topics.length} konu, bulunamayan adı olan ${bad}`);
process.exit(bad ? 1 : 0);
