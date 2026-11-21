// Cinsiyete ozgu yapilar. Z-Anatomy modeli (BodyParts3D) bir erkek bedeninden uretilmis; kadin organlari ayri
// kaynaklardan gelir ve o kaynak sources.mjs icinde `sex: 'f'` ile isaretlenir. Burada modeldeki erkege ozgu
// parcalar Ingilizce adlariyla listelenir. meta.mjs her parcaya x: 'm' | 'f' yazar; alan yoksa parca her iki
// cinsiyette de gosterilir.
//
// Ilke: yalnizca tek cinsiyette bulunan yapi (penis, testis, prostat, testikuler damarlar) ya da bu modelde tek
// cinsiyetin bicimiyle modellenmis ve karsi cinsiyette karsiligi bulunmayan yapi (bu modeldeki uretra prostat ve
// penisten gecen erkek uretrasidir) isaretlenir. Iki cinsiyette de bulunan yapilar (pudendal damarlar ve sinir,
// genitofemoral sinirin genital dali, pelvis tabani kaslari) ortak kalir.
import fs from 'node:fs';

export const MALE = new Set([
  // Erkek ureme sistemi
  'Testis', 'Epididymis', 'Ductus deferens', 'Seminal gland', 'Ejaculatory duct', 'Prostate',
  'Corpus cavernosum of penis', 'Corpus spongiosum of penis', 'Glans penis',
  // Erkek uretrasi (prostat ve penis icinden gecer) ve erkek mesanesi (dolu, dogrudan rektuma yaslanir; kadin bedeninde
  // yerini HRA kadin mesanesi alir)
  'Urethra', 'Urinary bladder',
  // Erkek ureterleri erkek mesanesinde biter; kadin bedeninde alt uclari kadin mesanesine egilmis kopyalari gosterilir
  'Ureter',
  // Rektumu ve anal kanali da iceren ag erkekte prostata yaslanir; kadin bedeninde vajinaya yaklastirilmis kopyasi var
  'Sigmoid colon',
  // Erkek kemik pelvisi: kadin bedeninde yerini HRA kadin pelvisi alir (kaynak femalepelvis, ayni adlar)
  'Hip bone', 'Sacrum', 'Coccyx',
  // Erkege ozgu damarlar
  'Left testicular artery', 'Right testicular artery', 'Left testicular vein', 'Right testicular vein',
  'Dorsal artery of penis', 'Deep artery of penis', 'Deep dorsal vein of penis', 'Superficial dorsal veins of penis',
]);

// Erkek pelvisine tutunan eklem parcalari: kadin bedeninde kadin pelvisine tasinmis kopyalari gosterilir (kaynak
// femalejoints; liste tools/pelvis-warp.mjs ile secilir).
for (const n of JSON.parse(fs.readFileSync(new URL('./pelvis-warp.json', import.meta.url), 'utf8')).parts) MALE.add(n);

export const FEMALE = new Set([]);

export const sexOf = name => (MALE.has(name) ? 'm' : FEMALE.has(name) ? 'f' : '');
