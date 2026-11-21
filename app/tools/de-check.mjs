// Almanca adlar icin kural tabanli (mekanik) tutarlilik denetimi. Yapay zeka denetiminden bagimsiz ikinci bir ag.
// Her Ingilizce adda gecen yon / tur sozcugunun Almanca adda beklenen karsiliklardan biriyle bulunup
// bulunmadigina ve kodlarin korunup korunmadigina bakar. Supheli girdileri listeler; karar insana aittir.
// Kullanim: once `node tools/meta.mjs`, sonra `node tools/de-check.mjs [--all]`
import fs from 'node:fs';

const rows = fs.readFileSync('../data/work/names.tsv', 'utf8').split('\n').filter(Boolean).map(l => {
  const c = l.split('\t'); return { s: c[0], kind: c[1], en: c[2], la: c[3], ctx: c[4], de: c[6] ?? '' };
}).filter(r => r.de);

// [Ingilizce sozcuk deseni, Almanca adda (kucuk harfle) bulunmasi beklenen parcalardan en az biri]
// Latince kalan terimler (Ramus circumflexus, Diaphragma pelvis ...) icin Latince karsiliklar da kabul edilir.
const RULES = [
  [/\banterior\b/i, ['vorder', 'ventral', 'anterior', 'front', 'vorn']],
  [/\bposterior\b/i, ['hinter', 'dorsal', 'posterior', 'rück', 'seitenzähne']],
  [/\bsuperior\b/i, ['ober', 'superior', 'kranial', 'höher', 'scheitel']],
  [/\binferior\b/i, ['unter', 'inferior', 'kaudal', 'nieder']],
  [/\bmedial\b/i, ['medial', 'inner', 'innen']],
  [/\blateral\b/i, ['lateral', 'seitlich', 'äußer', 'außen', 'seiten']],
  [/\bsuperficial\b/i, ['oberflächlich', 'superficial']],
  [/\bdeep\b/i, ['tief', 'profund']],
  [/\bleft\b/i, ['link', 'sinist']],
  [/\bright\b/i, ['recht', 'dext']],
  [/\bascending\b/i, ['aufsteig', 'ascend']],
  [/\bdescending\b/i, ['absteig', 'descend']],
  [/\btransverse\b/i, ['quer', 'transvers']],
  [/\boblique\b/i, ['schräg', 'obliqu']],
  [/\bmiddle\b/i, ['mittler', 'mittel', 'medi']],
  [/\bproximal\b/i, ['proximal', 'grund']],
  [/\bdistal\b/i, ['distal', 'end']],
  [/\binternal\b/i, ['inner', 'intern', 'binnen']],
  [/\bexternal\b/i, ['äußer', 'extern', 'außen']],
  [/\bcommon\b/i, ['gemeinsam', 'commun', 'haupt']],
  [/\b(great|greater)\b/i, ['groß', 'major', 'magn']],
  [/\b(lesser|small)\b/i, ['klein', 'minor', 'parv']],
  [/\blong\b/i, ['lang', 'long']],
  [/\bshort\b/i, ['kurz', 'brev']],
  [/\b(artery|arteries|arterial)\b/i, ['arterie', 'schlagader', 'aorta', 'arteri', 'ader', 'ramus']],
  [/\b(vein|veins|venous)\b/i, ['vene', 'ader', 'ven', 'sinus']],
  [/\b(nerve|nerves)\b/i, ['nerv']],
  [/\b(ligament|ligaments)\b/i, ['band', 'bänder', 'ligament']],
  [/\b(node|nodes)\b/i, ['knoten']],
  [/\b(gland|glands)\b/i, ['drüse', 'glandula', 'hypophyse', 'thymus', 'prostata', 'pankreas', 'bauchspeichel', 'schilddrüse']],
  [/\b(duct|ducts)\b/i, ['gang', 'gänge', 'kanal', 'ductus', 'leiter']],
  [/\b(bronchus|bronchi)\b/i, ['bronch']],
  [/\blobe\b/i, ['lappen', 'lobus']],
  [/\b(joint|joints)\b/i, ['gelenk', 'fuge', 'symphyse', 'naht', 'verbindung', 'articulatio']],
  [/\b(branch|branches)\b/i, ['ast', 'äste', 'zweig', 'ramus', 'rami']],
  [/\bcapsules?\b/i, ['kapsel']],
  [/\b(disc|discs)\b/i, ['scheibe', 'diskus', 'discus']],
  [/\b(cartilage|cartilages)\b/i, ['knorpel']],
  [/\bmeniscus\b/i, ['menisk']],
  [/\bvalve\b/i, ['klappe']],
  [/\b(leaflet|cusp)\b/i, ['segel', 'tasche']],
  [/\btendon\b/i, ['sehne', 'tendo']],
  [/\b(bursa|bursae)\b/i, ['schleimbeutel', 'bursa']],
  [/\b(fascia|fasciae)\b/i, ['faszie', 'fascia', 'aponeurose']],
  [/\bsheaths?\b/i, ['scheide']],
  [/\b(gyrus|gyri)\b/i, ['windung', 'gyrus', 'gyri']],
  [/\b(sulcus|sulci)\b/i, ['furche', 'sulcus', 'sulci', 'rinne', 'spalte']],
  [/\bnucleus\b/i, ['kern', 'nucleus', 'nuclei']],
  [/\btract\b/i, ['bahn', 'trakt', 'strang', 'tractus', 'band']],
  [/\bheads?\b/i, ['kopf', 'köpfe', 'caput']],
  [/\bbelly\b/i, ['bauch', 'venter']],
  [/\brib\b/i, ['rippe']],
  [/\bphalanx\b/i, ['glied']],
];
// Ingilizce birakilmis sozcukler (Latince terimlerde gecmeyen, yalnizca Ingilizceye ozgu olanlar)
const ENGLISH = /\b(of|the|and|with|artery|vein|nerve|muscle|branch|branches|ligament|node|nodes|gland|duct|joint|left|right|upper|lower)\b/i;

const issues = [];
for (const r of rows) {
  const en = r.en; const de = r.de.toLowerCase();
  const problems = [];
  for (const [re, any] of RULES) {
    if (!re.test(en)) continue;
    if (any.some(t => de.includes(t))) continue;
    problems.push(`"${en.match(re)[0]}" karsiligi yok (beklenen: ${any.slice(0, 4).join(' / ')})`);
  }
  // omur duzeyleri ve Roma rakamli kodlar korunmali (Almancada gogus omurlari Th ile yazilir)
  const codes = en.match(/\b(?:[CTLS]\d{1,2}|B?[IVX]{1,4}(?:\+B?[IVX]{1,4})?)\b/g) || [];
  for (const c of codes) {
    if (/^[IVX]+$/.test(c) && !/\(/.test(en)) continue;
    const alt = c.replace(/^T(\d)/, 'Th$1');
    if (!r.de.includes(c) && !r.de.includes(alt)) problems.push(`"${c}" kodu yok`);
  }
  if (ENGLISH.test(r.de)) problems.push('Ingilizce sozcuk kalmis: ' + r.de.match(ENGLISH)[0]);
  if (/\s{2,}|^\s|\s$/.test(r.de)) problems.push('fazladan bosluk');
  if (/^[a-zäöü]/.test(r.de)) problems.push('kucuk harfle basliyor');
  if (/\b(A|V|N|M|Lig|Lnn|Rr?)\.\s/.test(r.de)) problems.push('kisaltma');
  if (/(ae|oe|ue)[a-z]*/.test(de) && !/(ue[rn]|uel|ae[rn]|oe[sn])/.test(de) && /\b\w*(muskel|knoche|ruecke|fuss|groesse|aeuss)\w*/.test(de)) problems.push('umlaut yerine ae/oe/ue olabilir');
  if (problems.length) issues.push({ ...r, problems });
}

const bySys = {}; for (const i of issues) bySys[i.s] = (bySys[i.s] || 0) + 1;
console.log(`${rows.length} Almanca ad denetlendi, ${issues.length} supheli girdi`, JSON.stringify(bySys));
const limit = process.argv.includes('--all') ? Infinity : 100;
for (const i of issues.slice(0, limit)) console.log(`[${i.s}] ${i.en}  |  ${i.la}\n      => ${i.de}\n      ${i.problems.join('; ')}`);
if (issues.length > limit) console.log(`... ${issues.length - limit} girdi daha (--all ile tumunu goster)`);
fs.writeFileSync('../data/work/de_check.tsv', issues.map(i => [i.s, i.en, i.la, i.de, i.problems.join('; ')].join('\t')).join('\n'));
