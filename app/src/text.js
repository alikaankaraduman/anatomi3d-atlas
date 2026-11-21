// Arayüz metinleri ve isim yardımcıları.

// files: public/models/ altındaki GLB dosyaları (uzantısız). Bir sistem birden fazla dosyadan oluşabilir.
export const SYSTEMS = {
  bone: { label: 'Kemik', title: 'İskelet sistemi', files: ['bones', 'femalepelvis', 'attach', 'attachm', 'attachf'] },
  muscle: { label: 'Kas', title: 'Kas sistemi', files: ['muscles'] },
  nerve: { label: 'Sinir', title: 'Sinir sistemi', files: ['nerves'] },
  vessel: { label: 'Damar', title: 'Dolaşım sistemi', files: ['vessels'] },
  organ: { label: 'Organ', title: 'İç organlar', files: ['organs', 'lymph', 'female', 'breasts', 'vulva', 'urethra', 'bartholin'] },
  joint: { label: 'Eklem', title: 'Eklemler ve bağlar', files: ['joints', 'femalejoints'] },
};
export const SYS_ORDER = ['bone', 'muscle', 'nerve', 'vessel', 'organ', 'joint'];

// Yükleme sırası: önce iskelet (ekran hemen dolsun), sonra en sık kullanılanlar.
export const LOAD_ORDER = ['bone', 'muscle', 'joint', 'vessel', 'organ', 'nerve'];

export const SUBS = {
  bone: [['bone', 'Kemikler'], ['cartilage', 'Kıkırdaklar'], ['tooth', 'Dişler'], ['attach', 'Kas yapışmaları']],
  muscle: [['muscle', 'Kaslar'], ['sheath', 'Tendon kılıfları'], ['bursa', 'Bursalar'], ['fascia', 'Fasyalar']],
  nerve: [['nerve', 'Periferik sinirler'], ['brain', 'Beyin'], ['cord', 'Omurilik'], ['meninges', 'Beyin zarları'], ['sense', 'Duyu organları']],
  vessel: [['artery', 'Atardamarlar'], ['vein', 'Toplardamarlar'], ['heart', 'Kalp']],
  organ: [['digestive', 'Sindirim'], ['respiratory', 'Solunum'], ['urinary', 'Boşaltım'], ['genital', 'Üreme'], ['breast', 'Meme'], ['endocrine', 'İç salgı bezleri'], ['lymph', 'Lenf'], ['membrane', 'Zarlar']],
  joint: [['ligament', 'Bağlar'], ['disc', 'Disk ve kıkırdaklar'], ['capsule', 'Eklem kapsülleri']],
};
export const SUB_LABEL = Object.fromEntries(Object.values(SUBS).flat());

// Başlangıçta kapalı alt katmanlar: altlarındaki yapıları örttükleri için.
export const SUB_DEFAULT_OFF = new Set(['sheath', 'bursa', 'fascia', 'meninges', 'membrane', 'capsule', 'attach']);

export const SIDE = { r: 'Sağ', l: 'Sol' };

// Beden seçimi. Model (BodyParts3D) erkek bedeninden üretilmiştir; kadına özgü organlar ayrı kaynaktan gelir.
export const SEX = { m: { label: 'Erkek', sign: '♂' }, f: { label: 'Kadın', sign: '♀' } };

// Mod seçildiğinde katmanların varsayılan görünümü (yazılmayanlar gizlidir).
const PRESET = {
  bone: { bone: 'show' },
  muscle: { bone: 'show', muscle: 'show' },
  nerve: { bone: 'ghost', nerve: 'show' },
  vessel: { bone: 'ghost', vessel: 'show' },
  organ: { bone: 'ghost', organ: 'show' },
  joint: { bone: 'show', joint: 'show' },
};
export const presetFor = mode => Object.fromEntries(SYS_ORDER.map(s => [s, PRESET[mode]?.[s] ?? 'hide']));

export const LAYER_STATES = [['show', 'Göster'], ['ghost', 'Saydam'], ['hide', 'Gizle']];

// Yapı adları her yerde (bilgi kartı, ağaç, arama, ipucu balonu) Latince gösterilir; Latincesi olmayan birkaç
// yapıda sırasıyla Almanca, Türkçe, İngilizce. Başlığın altında Almanca (kullanıcı anatomiyi Almanca okuyor).
// Menüler ve düğmeler Türkçedir.
export const titleName = o => o.la || o.de || o.tr || o.n;
export const subtitleName = o => (o.de && o.de !== titleName(o) ? o.de : '');
// Fareyle üzerine gelince başlığın yanında gösterilen diğer adlar (Almanca, Türkçe); başlıkla aynı olan atlanır.
export const otherNames = o => [...new Set([o.de, o.tr].filter(s => s && s !== titleName(o)))];

// Doğal anatomik sıralama (ağaç ve listeler):
//  - Latince sıra sayıları ve Romen rakamları sayı gibi sıralanır: Costa secunda, Costa decima'dan önce gelir;
//    Vertebra thoracica IX, Vertebra thoracica X'dan önce.
//  - Omur düzeyleri kafadan kuyruğa: C7-T1, T12-L1, L5-S1.
//  - Sonu parantez içinde Romen rakamıyla biten adlar (kafa çiftleri, karaciğer segmentleri, "(BIII)", "(BI+BII)" gibi
//    bronş segmentleri) önce numarasına göre sıralanır.
//  - Sıralı dizilerin sözcükleri dizideki sırayla dizilir ve dizinin ilk sözcüğünün alfabetik yerinde durur:
//    Vertebrae cervicales, thoracicae, lumbales; Os sacrum, Os coccygis; Costae verae, spuriae; Dens incisivus, caninus,
//    premolaris, molaris.
//  - Başı aynı adlarda sözcük sayıdan önce gelir: Ventriculus lateralis, Ventriculus tertius, Ventriculus quartus.
const ORDINAL = { prim: 1, secund: 2, terti: 3, quart: 4, quint: 5, sext: 6, septim: 7, octav: 8, non: 9, decim: 10, undecim: 11, duodecim: 12 };
const ORDINAL_RE = /^(prim|secund|terti|quart|quint|sext|septim|octav|non|decim|undecim|duodecim)(us|a|um|i|ae|o|is)$/i;
const LEVEL_RE = /^(C|Th|T|L|S|Co)(\d{1,2})$/;
const REGION = { C: 100, Th: 200, T: 200, L: 300, S: 400, Co: 500 };
const romanValue = s => {
  const v = { I: 1, V: 5, X: 10 }; let n = 0;
  for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; n += a < b ? -a : a; }
  return n;
};
const SEQUENCE = {};
const sequence = (anchor, steps) => steps.forEach((words, i) => { for (const w of words.split(' ')) SEQUENCE[w] = anchor + (i + 1); });
sequence('cervicalis', [
  'cervicalis cervicales cervicale cervicalia cervicalium cervicis',
  'thoracicus thoracica thoracicum thoracici thoracicae thoracis',
  'abdominalis abdominales abdominale abdominis',
  'lumbalis lumbales lumbale lumbalia lumborum',
  'sacralis sacrales sacrale sacralia sacrum sacri',
  'pelvicus pelvica pelvicum pelvis',
  'coccygeus coccygea coccygeum coccygei coccygis',
]);
sequence('verae', ['verae', 'spuriae', 'fluctuantes']);
sequence('incisivus', ['incisivus incisivi', 'caninus canini', 'premolaris premolares', 'molaris molares']);
// Sondaki numara: "(VII)", bronş segmentlerinde harfli "(BIII)" ve birleşik "(BI+BII)". Ön ek I, V, X olamaz
// (yoksa "(VII)" V + II diye okunur).
const TAIL_RE = /\(([A-HJ-UWYZ]?)([IVX]+)(?:\+[A-HJ-UWYZ]?[IVX]+)?\)$/;
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const tokenCache = new Map();
function sortTokens(name) {
  let toks = tokenCache.get(name);
  if (toks) return toks;
  toks = name.split(/[\s\-–]+/).filter(Boolean).map(t => {
    const bare = t.replace(/^\(|\)$/g, '');
    let m;
    if (/^[IVX]+$/.test(bare)) return romanValue(bare);
    if ((m = bare.match(ORDINAL_RE))) return ORDINAL[m[1].toLowerCase()];
    if ((m = bare.match(LEVEL_RE))) return REGION[m[1]] + Number(m[2]);
    return SEQUENCE[bare.toLowerCase()] || bare;
  });
  const tail = TAIL_RE.exec(name);
  if (tail && toks.length) { toks.pop(); toks.unshift(romanValue(tail[2])); }
  // Omurgada baş ad sıralamaya katılmaz, yalnız bölge sayılır: Vertebrae cervicales, thoracicae, lumbales, Os sacrum, Os coccygis.
  if (toks.length > 1 && /^(os|ossa|vertebra|vertebrae)$/i.test(toks[0]) && String(toks[1]).startsWith('cervicalis')) toks.shift();
  tokenCache.set(name, toks);
  return toks;
}
// Aramada ad uzunluğu karşılaştırılırken (katlanmış, küçük harfli ad) numaralar, sıra sözcükleri ve dizi sözcükleri
// tek karakter sayılır: "costa nona" ile "costa duodecima" eşit uzunlukta olur, eşitliği doğal sıra çözer.
export const sortLength = folded => folded.split(' ').map(t =>
  (/^b?[ivx]+$|^\d+$|^(c|th|t|l|s|co)\d{1,2}$/.test(t) || ORDINAL_RE.test(t) || SEQUENCE[t]) ? '#' : t).join(' ').length;
export function compareNames(a, b) {
  const x = sortTokens(a), y = sortTokens(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i], q = y[i];
    if (p === q) continue;
    const pn = typeof p === 'number', qn = typeof q === 'number';
    if (pn && qn) return p - q;
    if (pn !== qn) return pn ? 1 : -1;
    const c = collator.compare(p, q);
    if (c) return c;
  }
  return x.length - y.length || collator.compare(a, b);
}

// Arama için: küçük harf, Türkçe karakterleri sadeleştir, noktalama at.
const MAP = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u', 'ß': 'ss' };
export function fold(s) {
  return (s || '')
    .replace(/[ıİşŞğĞüÜöÖçÇâîûß]/g, c => MAP[c])
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
