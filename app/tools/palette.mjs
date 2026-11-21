// Z-Anatomy FBX'lerinde renk bilgisi yok (hepsi gri); renkleri malzeme adina gore burada veriyoruz.
const BONE = {
  'Bone': '#e9dfc8', 'Bone-1': '#ece2cc', 'Bone-2': '#e2d5ba', 'Bone-3': '#efe6d3', 'Bone-4': '#ddd0b5',
  'Bone-5': '#e6dbc4', 'Bone-6': '#f0e5cb', 'Bone-7': '#dfd3ba', 'Bone-8': '#eaddc0',
  'Suture': '#cdbfa2', 'Cartilage': '#a9c6d6', 'Teeth': '#f6f3ea', 'Teeth-roots': '#e6d8b6', 'Dentine': '#e8d7a4',
  '__DEFAULT': '#d9cdb4',
};
const MUSCLE = {
  'Tendon': '#eae2d3', 'Ligament': '#e3dccb', 'Fascia': '#dcd2c6', 'Bursa': '#8db9dc', 'Articular capsule': '#b9cfdc', 'Cartilage': '#a9c6d6',
  'Abductor': '#b8463c', 'Adductor': '#a53b49', 'Extension': '#b44b35', 'Flexion': '#9d3834',
  'External rotation': '#bb574a', 'Internal rotator': '#a94444', 'Flexion fingers': '#a6423e',
  'Extensor extremities': '#bd5140', 'Extension hand/foot': '#b34d43', 'Flexion hand/foot': '#9b3a3f',
  'Biarticular': '#ac3e32', 'Levator': '#be5650', 'Depressor': '#aa494e', 'Orbicularis/Constrictor': '#b24f57',
  'Superficial': '#c36158', 'Ingestion': '#b4504a', 'Phonation': '#b85b52', 'Masticator': '#a53d39',
  'Trapezius': '#ae4337', 'Diaphragm': '#a9423b', '__DEFAULT': '#b04a40',
};
const NERVE = {
  'Nerve': '#f0c53a', 'Nerve-1': '#f3cf56', 'Nerve-2': '#e9b930', 'Nerve-3': '#f5d66c', 'Nerve-4': '#e6c14b',
  'Nerve-5': '#eec23f', 'Nerve-6': '#f7cf4a', 'Nerve-8': '#eabd36', 'Bone-4': '#f2cb4f', // XII. sinir bu dosyada Bone-4 ile isaretli
  'Frontal lobe': '#e9a79d', 'Parietal lobe': '#a8c7e8', 'Temporal lobe': '#b3daa5', 'Occipital lobe': '#e9d595',
  'Limbic lobe': '#c8a8e0', 'Insula': '#e2b78c', 'Interlobar sulci': '#b89a93', 'Brain-Inner': '#d8b6ad',
  'Brain': '#ddb8ab', 'Cerebellum': '#d9988c', 'White matter': '#f1ece1', 'Nucleus': '#b99a9b',
  'Nucleus (afferent fibers)': '#7da7d9', 'Nucleus (efferent fibers)': '#d97d7d', 'LCR': '#8dcfe8',
  'Cartilage': '#ced6dc', 'Fascia': '#d9d1c6', 'Eye': '#f2f0e9', 'Cornea': '#cde7f0', 'Iris': '#5b80a9',
  'Mucosa': '#e09f9f', 'Gland': '#d9a777', 'Ligament': '#e3dccb', 'Bone-1': '#e9dfc8', 'Artery': '#c14f49',
  'Orbicularis/Constrictor': '#c98078', 'Text': '#cccccc', '__DEFAULT': '#e8c95a',
};
// Damarlar: atardamar kirmizi, toplardamar mavi. Akciger dolasiminda kanin oksijen durumu ters oldugu icin
// akciger atardamarlari mavi-mor, akciger toplardamarlari acik kirmizi.
const VESSEL = {
  'Artery': '#c8322c', 'Vein': '#3d62b8', 'Pulmonary artery': '#6c62c9', 'Pulmonary vein': '#e0665a',
  'Trapezius': '#a63a30',      // kalp kasi (karincik, kulakcik, papiller kaslar)
  'Cartilage': '#eadfcc',      // yarimay kapakciklar
  'Ligament': '#efe5d5',       // atriyoventrikuler kapakciklar
  '__DEFAULT': '#b8433a',
};
const ORGAN = {
  'Mucosa': '#dc8f8d', 'Intestine': '#dba58f', 'Ligament': '#e6dcc8', 'Peritoneum': '#ead9a8', 'Fascia': '#dcd3c8',
  'Gland': '#d9a56f', 'Ductus': '#e2c796', 'Gallbladder': '#6f9d55', 'Nucleus': '#c99fa9', 'Cartilage': '#a9c6d6',
  'Organ': '#9a4638',          // bobrek, mesane, karaciger govdesi
  // kadin ic genital organlari (HRA)
  'Uterus': '#c06a72', 'Cervix': '#d48b92', 'Uterine tube': '#d99aa0', 'Ovary': '#e3c3b5', 'Vagina': '#c97f87',
  // meme (HRA): yag sari, bez loblari gul, kanallar ve sinusler koyulasan pembe, meme basi ve areola koyu ten
  'Breast fat': '#f0d9a6', 'Mammary lobe': '#e3a7a0', 'Lactiferous duct': '#d3877e', 'Lactiferous sinus': '#c4736b',
  'Nipple': '#b06a62', 'Areola': '#c88577', 'Areolar tubercle': '#a9625a',
  // klitoris ve bulbuslar (Fillod): erektil doku koyu gul, glans daha acik
  'Clitoris': '#c25f6c', 'Glans of clitoris': '#d07884', 'Bulb of vestibule': '#b35667',
  // kadin uretrasi (sematik): acik ten-turuncu; dis agiz halkasi mukoza renginde
  'Urethra': '#e0a77c',
  // karaciger segmentleri (I-VIII): kahverengi-kizil tonlar
  'Organ-1': '#8e3f33', 'Organ-2': '#a8553f', 'Organ-3': '#93493a', 'Organ-4': '#b25e47',
  'Organ-5': '#9c5140', 'Organ-6': '#ab4a3c', 'Organ-7': '#8a4135', 'Organ-8': '#b6654f',
  // solunum yollari ve segment bronslari (pastel, birbirinden ayirt edilsin diye)
  'Bronchi': '#d6dde3', 'Bronchi-1': '#e8a2a2', 'Bronchi-2': '#e8c8a0', 'Bronchi-3': '#e2df9b', 'Bronchi-4': '#a9d8a1',
  'Bronchi-5': '#a0d6cf', 'Bronchi-6': '#a1c0e8', 'Bronchi-7': '#baa7e6', 'Bronchi-8': '#e0a4d6',
  // akciger: taban rengi + segmentler
  'Lung-base': '#d8a3a4', 'Lung-1': '#e3aeb0', 'Lung-2': '#e0b9a4', 'Lung-3': '#dcc4a1', 'Lung-4': '#c9cfa6',
  'Lung-5': '#b1d0b1', 'Lung-6': '#aacfc8', 'Lung-7': '#abc4d9', 'Lung-8': '#b8b4de', 'Lung-9': '#d3aedb',
  '__DEFAULT': '#cf9a8c',
};
const LYMPH = {
  'Lymph-1': '#8fc06b', 'Lymph-2': '#7fb85f', 'Lymph-3': '#9cc978', 'Lymph-4': '#86bd72', 'Lymph-5': '#a4cc7c',
  'Lymph-6': '#78b166', 'Lymph-7': '#94c56f', 'Lymph-8': '#89ba62',
  'Organ': '#7c3b54',          // dalak
  'Gland': '#d9b0a2',          // timus
  '__DEFAULT': '#8fc06b',
};
// Eklemler: baglar kemigin fildisi renginden ayirt edilsin diye soguk mavi-gri (atlaslardaki alisilmis gosterim),
// kikirdak ve diskler daha koyu mavi, kapsuller acik mor.
const JOINT = {
  'Ligament': '#b9c6de', 'Cartilage': '#86b6cf', 'Articular capsule': '#c6b9df', 'Bone-1': '#e9dfc8',
  'Fat': '#ead58a', 'Suture': '#cdbfa2', '__DEFAULT': '#b9c6de',
};
// kas yapisma yerleri: atlaslardaki gibi origo kirmizi, insersiyo mavi
const ATTACH = { 'Origin': '#d8463c', 'Insertion': '#3d6fd8', '__DEFAULT': '#8a8a8a' };
const TABLES = { attach: ATTACH, bone: BONE, muscle: MUSCLE, nerve: NERVE, vessel: VESSEL, organ: ORGAN, lymph: LYMPH, joint: JOINT };

const srgb2lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

export function matKey(name) {
  // "Bone-3.001" -> "Bone-3", "Suture-7.001" -> "Suture", "Cartilage.003" -> "Cartilage"
  let k = name.replace(/\.\d+$/, '');
  if (/^Suture/.test(k)) k = 'Suture';
  return k;
}
export function colorFor(table, matName) {
  const t = TABLES[table]; const k = matKey(matName);
  const hex = t[k] ?? t.__DEFAULT;
  const n = parseInt(hex.slice(1), 16);
  // glTF COLOR_0 dogrusal (linear) uzaydadir
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.round(srgb2lin(c) * 255));
}
export const knownMat = (table, matName) => matKey(matName) in TABLES[table];
