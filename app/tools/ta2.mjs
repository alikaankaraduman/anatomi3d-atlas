// Terminologia Anatomica 2 tablosu (Z-Anatomy): Ingilizce ad -> Latince ad ve TA2 kimligi.
import fs from 'node:fs';

const BOM = String.fromCharCode(0xFEFF);
const rows = fs.readFileSync(new URL('../../data/zanatomy/TA2.csv', import.meta.url), 'utf8')
  .split(BOM).join('').split(/\r?\n/).filter(l => l.trim()).map(l => l.replace(/^"|"$/g, '').split(';'));
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
const byEn = new Map();
for (const r of rows.slice(1)) if (r[1] && r[2] && !byEn.has(norm(r[1]))) byEn.set(norm(r[1]), { id: r[0], la: r[2].trim() });

// Model adlari TA2 yazimindan biraz sapabilir: parantez, yildiz ve "muscle" eki icin birkac varyasyon denenir.
function find(name) {
  const c = [name, name.replace(/^\((.*)\)$/, '$1'), name.replace(/\s*\([^)]*\)\s*$/, ''), name.replace(/\*+/g, ''), name.replace(/ muscle$/, ''), name + ' muscle'].map(norm);
  for (const k of c) if (byEn.has(k)) return byEn.get(k);
  return null;
}
export const latin = name => find(name)?.la ?? '';
export const ta2id = name => find(name)?.id ?? '';
