// Turkce adlar icin kural tabanli (mekanik) tutarlilik denetimi. Yapay zeka denetiminden bagimsiz ikinci bir ag.
// Her Ingilizce adda gecen yon / tur sozcugunun Turkce adda beklenen karsiliklardan biriyle bulunup
// bulunmadigina ve sayi / kodlarin korunup korunmadigina bakar. Supheli girdileri listeler; karar insana aittir.
// Kullanim: once `node tools/meta.mjs`, sonra `node tools/tr-check.mjs [--all]`
import fs from 'node:fs';

const rows = fs.readFileSync('../data/work/names.tsv', 'utf8').split('\n').filter(Boolean).map(l => {
  const [s, kind, en, la, ctx, tr] = l.split('\t'); return { s, kind, en, la, ctx, tr };
}).filter(r => r.tr);

const low = s => s.toLocaleLowerCase('tr');
// [Ingilizce sozcuk deseni, Turkce adda bulunmasi beklenen parcalardan en az biri]
const RULES = [
  [/\banterior\b/i, ['ön', 'anterior']],
  [/\bposterior\b/i, ['arka', 'posterior']],
  [/\bsuperior\b/i, ['üst', 'superior', 'süperior']],
  [/\binferior\b/i, ['alt', 'inferior']],
  [/\bmedial\b/i, ['medial', 'iç']],
  [/\blateral\b/i, ['lateral', 'dış', 'yan']],
  [/\bsuperficial\b/i, ['yüzeyel']],
  [/\bdeep\b/i, ['derin']],
  [/\bleft\b/i, ['sol']],
  [/\bright\b/i, ['sağ']],
  [/\bascending\b/i, ['çıkan', 'asendan']],
  [/\bdescending\b/i, ['inen', 'desendan']],
  [/\btransverse\b/i, ['transvers', 'enine']],
  [/\boblique\b/i, ['oblik', 'eğik']],
  [/\bmiddle\b/i, ['orta']],
  [/\bproximal\b/i, ['proksimal']],
  [/\bdistal\b/i, ['distal']],
  [/\binternal\b/i, ['iç', 'internal', 'internus']],
  [/\bexternal\b/i, ['dış', 'eksternal', 'externus']],
  [/\bcommon\b/i, ['ortak', 'ana']],
  [/\b(great|greater)\b/i, ['büyük', 'major']],
  [/\b(lesser|small)\b/i, ['küçük', 'minor', 'ince']],
  [/\blong\b/i, ['uzun', 'longus']],
  [/\bshort\b/i, ['kısa', 'brevis']],
  [/\baccessory\b/i, ['aksesuar', 'yardımcı']],
  [/\b(artery|arteries|arterial)\b/i, ['arter', 'atardamar', 'aort']],
  [/\b(vein|veins|venous)\b/i, ['ven', 'toplardamar', 'vena']],
  [/\b(nerve|nerves)\b/i, ['sinir']],
  [/\b(ligament|ligaments)\b/i, ['bağ', 'ligament']],
  [/\b(muscle|muscles)\b/i, ['kas']],
  [/\b(node|nodes)\b/i, ['düğüm']],
  [/\b(gland|glands)\b/i, ['bez']],
  [/\b(duct|ducts)\b/i, ['kanal', 'duktus', 'yol']],
  [/\b(bronchus|bronchi)\b/i, ['bronş']],
  [/\b(lobe)\b/i, ['lob']],
  [/\b(joint|joints)\b/i, ['eklem']],
  [/\b(branch|branches)\b/i, ['dal']],
  [/\btrunk\b/i, ['trunkus', 'gövde', 'kök', 'zincir']],
  [/\bplexus\b/i, ['pleksus', 'ağ']],
  [/\b(bursa|bursae)\b/i, ['bursa']],
  [/\b(fascia|fasciae)\b/i, ['fasya']],
  [/\bsheath(s)?\b/i, ['kılıf']],
  [/\bcapsule(s)?\b/i, ['kapsül']],
  [/\b(disc|discs)\b/i, ['disk']],
  // Türkçede ek alınca sondaki k yumuşar (kıkırdak -> kıkırdağı), bu yüzden kökün ortak kısmı aranır.
  [/\b(cartilage|cartilages)\b/i, ['kıkırda']],
  [/\b(meniscus)\b/i, ['menisk']],
  [/\b(membrane)\b/i, ['zar', 'membran']],
  [/\b(valve)\b/i, ['kapa']],
  [/\b(leaflet|cusp)\b/i, ['yapra']],
  [/\b(sinus|sinuses)\b/i, ['sinüs']],
  [/\b(segment|segmental)\b/i, ['segment']],
  [/\bhead\b/i, ['baş', 'kafa']],
  [/\bneck\b/i, ['boyun', 'boyn']],
  [/\b(tendon)\b/i, ['tendon', 'kiriş']],
  [/\bnucleus\b/i, ['çekirde', 'nükleus', 'nucleus']],
  [/\b(gyrus|gyri)\b/i, ['girus']],
  [/\b(sulcus|sulci)\b/i, ['sulkus', 'oluk', 'yarık']],
];
// Kas ozel adlari Latince birakildigi icin yon sozcukleri de Latince kalabilir (tibialis anterior, serratus posterior ...).
const LATIN_NAME = /(tensor|fasciae|tibialis|serratus|scalenus|rectus|obliquus|gemellus|pterygoid|rhomboid|levator|flexor|extensor|abductor|adductor|vastus|gluteus|pectoralis|teres|peron|fibularis|longus|brevis|capitis|colli|digit|pollicis|hallucis|interosse|lumbrical|constrictor|sphincter)/i;

const issues = [];
for (const r of rows) {
  const en = r.en; const tr = low(r.tr);
  const problems = [];
  for (const [re, any] of RULES) {
    if (!re.test(en)) continue;
    if (any.some(t => tr.includes(t))) continue;
    const word = en.match(re)[0];
    // yerlesik istisnalar: tendon kilifi ve bursa adlarinda "kas" sozcugu dusurulur; kesici dislerde medial = orta, lateral = yan
    if (/^muscle/i.test(word) && /(tendon sheath|bursa)/i.test(en)) continue;
    if (/incisor/i.test(en) && /^(medial|lateral)$/i.test(word)) continue;
    // kas adlarinda Latince yon sozcugu kabul: Turkce ad Ingilizce/Latince sozcugu aynen iceriyorsa sorun yok
    if (LATIN_NAME.test(en) && tr.includes(word.toLowerCase())) continue;
    problems.push(`"${word}" karsiligi yok (beklenen: ${any.join(' / ')})`);
  }
  // sayilar, omur duzeyleri ve Roma rakamli kodlar korunmali
  const codes = en.match(/\b(?:[CTLS]\d{1,2}|B?[IVX]{1,4}(?:\+B?[IVX]{1,4})?|M\d)\b/g) || [];
  for (const c of codes) {
    if (/^[IVX]+$/.test(c) && !/\(/.test(en)) continue;      // "I" gibi tek harfler yalnizca parantez icinde kod sayilir
    if (!r.tr.includes(c)) problems.push(`"${c}" kodu yok`);
  }
  // ceviri kalintilari
  if (/\b(of|the|and|with)\b/i.test(r.tr)) problems.push('cevrilmemis Ingilizce sozcuk');
  if (/\s{2,}|^\s|\s$/.test(r.tr)) problems.push('fazladan bosluk');
  if (/[a-zçğıöşü]/.test(r.tr[0])) problems.push('kucuk harfle basliyor');
  if (problems.length) issues.push({ ...r, problems });
}

const bySys = {}; for (const i of issues) bySys[i.s] = (bySys[i.s] || 0) + 1;
console.log(`${rows.length} Turkce ad denetlendi, ${issues.length} supheli girdi`, JSON.stringify(bySys));
const limit = process.argv.includes('--all') ? Infinity : 80;
for (const i of issues.slice(0, limit)) console.log(`[${i.s}] ${i.en}  =>  ${i.tr}\n      ${i.problems.join('; ')}`);
if (issues.length > limit) console.log(`... ${issues.length - limit} girdi daha (--all ile tumunu goster)`);
fs.writeFileSync('../data/work/tr_check.tsv', issues.map(i => [i.s, i.en, i.la, i.tr, i.problems.join('; ')].join('\t')).join('\n'));
