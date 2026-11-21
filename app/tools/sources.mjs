// Donusturulen kaynaklar. Sira, meta.json icindeki sirayi ve grup indekslerini belirler:
// yeni kaynaklar SONA eklenmeli ki mevcut parca kimlikleri degismesin.
//   fbx     : data/zanatomy/ icindeki kaynak dosya
//   sys     : arayuzdeki sistem (mod) anahtari; birden fazla kaynak ayni sisteme ait olabilir
//   prefix  : parca kimligi on eki (kaynak basina benzersiz)
//   palette : renk tablosu anahtari (verilmezse sys kullanilir)
//   skip    : atlanacak ag adlari (anatomik yerinde olmayan sablon nesneler)
//   regroup : kaynakta yanlis gruba konmus parcalar: { "parca adi": "dogru ust grubun adi" } (son grup degistirilir)
//   lockBorder: acik kenarlar sadelestirmede yerinde kalir. Bir govdeden kesilmis komsu parcalar (klitoris, bulbuslar,
//             vajina ile forniks) ayri ayri sadelestirilince kesik sinirlari kayar ve parcalar arasinda catlak kalir.
export const SOURCES = {
  bones: { fbx: 'SkeletalSystem100.fbx', sys: 'bone', prefix: 'b' },
  muscles: { fbx: 'MuscularSystem100.fbx', sys: 'muscle', prefix: 'm' },
  // Subsentral girus (santral operkulum) kaynakta "Insula" grubunda; insula degil ve modelde insula parcasi yok.
  // TNA 2017 gyrus subcentralis'i frontal lobda listeler. Grup bosalinca olusturulmaz.
  nerves: { fbx: 'NervousSystem100.fbx', sys: 'nerve', prefix: 'n', regroup: { 'Insula (Subcentral gyrus and ant. and post. sulci*)': 'Frontal lobe' } },
  // Mitral kapagin arka yaprakcigi kaynakta "Right atrioventricular valve" grubunda duruyor; konumu (sol, arkada)
  // ve adi sol atriyoventrikuler kapagi gosteriyor. Kaynaktaki bos "Left atrioventricular valve" grubuna tasinir.
  vessels: { fbx: 'CardioVascular41.fbx', sys: 'vessel', prefix: 'v', regroup: { 'Posterior leaflet of left atrioventricular valve': 'Left atrioventricular valve' } },
  organs: { fbx: 'VisceralSystem100.fbx', sys: 'organ', prefix: 'o' },
  // "Lymph node": dunya orijininde duran 2 mm'lik sablon nesne (dugumlerin kopyalandigi kaynak), gercek bir yapi degil.
  lymph: { fbx: 'LymphoidOrgans100.fbx', sys: 'organ', prefix: 'y', palette: 'lymph', skip: ['Lymph node'] },
  joints: { fbx: 'Joints100.fbx', sys: 'joint', prefix: 'j' },
  // Kadin ic genital organlari ve kadin kemik pelvisi: HuBMAP CCF 3D Reference Object Library v1.2 (CC BY 4.0,
  // Visible Human Female), data/hra/ icinde. tools/hra.mjs adlandirir ve modelin pelvisine hizalar. Butun parcalari
  // kadina ozgudur (sex: 'f'); ayni sistemdeki ayni adli gruplar meta.mjs icinde birlesir.
  female: { hra: 'organs', sys: 'organ', prefix: 'f', sex: 'f', lockBorder: true },
  femalepelvis: { hra: 'pelvis', sys: 'bone', prefix: 'p', sex: 'f' },
  // Kadin memeleri (HRA, CC BY 4.0): pelvis hizalamasindan sonra gogus duvarina ayrica oturtulur (tools/hra-breast-fit.mjs).
  breasts: { hra: 'breast', sys: 'organ', prefix: 'k', sex: 'f' },
  // Klitoris ve vestibul bulbuslari: Odile Fillod'un gercek boyutlu modeli (V2, CC BY-NC-SA), data/fillod/ icinde;
  // tools/fillod.mjs parcalara boler, tools/fillod-fit.json ile kadin pelvisine yerlestirir.
  vulva: { fillod: true, sys: 'organ', prefix: 'c', sex: 'f', lockBorder: true },
  // Kadin bedeninde pelvis eklemleri: erkek pelvisine tutunan eklem parcalarinin (simfiz, sakrokoksigeal eklem,
  // sakroiliak ve sakrospinal baglar, L5-S1 diski ...) kadin pelvisine tasinmis kopyalari (tools/femalejoints.mjs,
  // alan ve parca listesi tools/pelvis-warp.json). Orijinalleri sex.mjs ile erkege ozgu sayilir.
  femalejoints: { fbx: 'Joints100.fbx', sys: 'joint', prefix: 'q', sex: 'f', pelvisWarp: true },
  // Kadin uretrasi: kaynaklarda yok; bu proje icin cizilmis sematik boru (tools/urethra.mjs), orta hat egrisi
  // tools/urethra-fit.json (mesane boynundan vajinanin on duvari boyunca vestibuldeki dis agza).
  urethra: { urethra: true, sys: 'organ', prefix: 'u', sex: 'f', lockBorder: true },
  // Bartholin bezleri (glandulae vestibulares majores): kaynaklarda yok; bu proje icin cizilmis sematik bez ve kanal
  // (tools/bartholin.mjs), yerlesim tools/bartholin-fit.json (bulbusun arka ucunda, vajina girisinin arka-yaninda).
  bartholin: { bartholin: true, sys: 'organ', prefix: 'g', sex: 'f' },
  // Kas yapisma yerleri (origo kirmizi, insersiyo mavi): iskelet dosyasindaki yamalar (tools/attach.mjs). Pelvis kadin
  // bedeninde degistigi icin uce bolunur: pelvis disi (ortak), erkek pelvisindekiler (erkege ozgu) ve bunlarin kadin pelvisine
  // tasinmis kopyalari. Yamalar ince ve duzdur; sabit 0.02 cm hata payiyla sadelestirilir (simplifyErr).
  attach: { attach: 'shared', sys: 'bone', prefix: 'a', palette: 'attach', simplifyErr: 0.02 },
  attachm: { attach: 'male', sys: 'bone', prefix: 'd', palette: 'attach', simplifyErr: 0.02, sex: 'm' },
  attachf: { attach: 'female', sys: 'bone', prefix: 'h', palette: 'attach', simplifyErr: 0.02, sex: 'f' },
};
