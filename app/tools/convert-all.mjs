// Tum kaynaklari (ya da adi verilenleri) sirayla donusturur, sonra meta.json'u yeniden uretir.
// Kullanim: node tools/convert-all.mjs [bones muscles ...]
// Her kaynak ayri bir surecte calisir: buyuk FBX dosyalari icin bellek her seferinde bosalir.
import { spawnSync } from 'node:child_process';
import { SOURCES } from './sources.mjs';

const only = process.argv.slice(2);
const unknown = only.filter(n => !(n in SOURCES));
if (unknown.length) { console.error(`Bilinmeyen kaynak: ${unknown.join(', ')}. Secenekler: ${Object.keys(SOURCES).join(', ')}`); process.exit(1); }

for (const name of Object.keys(SOURCES)) {
  if (only.length && !only.includes(name)) continue;
  const r = spawnSync(process.execPath, ['tools/convert.mjs', name], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`"${name}" donusturulemedi.`); process.exit(r.status ?? 1); }
}
const m = spawnSync(process.execPath, ['tools/meta.mjs'], { stdio: 'inherit' });
if (m.status !== 0) process.exit(m.status ?? 1);   // null: surec oldurulmus ya da baslatilamamis
// kesitte dolu cizilecek acik parcalarin delikleri: modellerin kose sirasina bagli, her donusturmeden sonra yenilenir
const h = spawnSync(process.execPath, ['tools/holes.mjs'], { stdio: 'inherit' });
process.exit(h.status ?? 1);
