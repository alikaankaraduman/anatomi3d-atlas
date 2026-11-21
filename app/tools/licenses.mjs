// dist/lisanslar.txt metnini üretir (vite.config.js derlemenin sonunda yazar; Hakkında penceresinden bağlantılıdır).
//  1. bölüm: 3B model dosyalarının kaynakları ve lisansları (hangi .glb dosyası hangi kaynaktan).
//  2. bölüm: uygulama paketinin içindeki açık kaynak kütüphanelerin lisans metinleri. MIT lisansı telif ve izin notunun
//     her kopyayla dağıtılmasını ister; küçültme (minify) lisans yorumlarını sildiği için metinler buraya konur.
// Kaynak listesi değişirse (tools/sources.mjs) 1. bölüm, yeni bir kütüphane pakete girerse BUNDLED güncellenir;
// aynı bilgiler README.md "Veri kaynağı ve lisans" bölümünde ve index.html Hakkında penceresinde de durur.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODELS = `1. 3B MODELLER
==============

models/ klasöründeki .glb dosyaları özgün dosyalar değil, aşağıdaki kaynaklardan yapılmış UYARLAMALARDIR:
dönüştürüldü, sadeleştirildi, yeniden adlandırıldı ve gruplandı; bazı parçalar taşındı ya da yeniden biçimlendirildi.

Z-Anatomy - The libre 3D atlas of anatomy (Gauthier Kervyn ve katkıda bulunanlar)
  Lisans : CC BY-SA 4.0  https://creativecommons.org/licenses/by-sa/4.0/
  Kaynak : https://www.z-anatomy.com
  Dayandığı özgün model: BodyParts3D, The Database Center for Life Science, CC BY-SA 2.1 Japan
           https://creativecommons.org/licenses/by-sa/2.1/jp/
           https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
  Z-Anatomy'nin bildirdiğine göre içine şu modeller de alınmış ve uyarlanmıştır (ayrıntılar kaynak sayfalarından):
    - "Brainder" (Z-Anatomy'nin adlandırması): "Brain for Blender", Anderson Winkler, CC BY-SA 3.0
      https://brainder.org/brain-for-blender  https://creativecommons.org/licenses/by-sa/3.0/
    - "White matter", University of Washington (ayrı bir lisans bildirilmemiş; Z-Anatomy kapsamında CC BY-SA 4.0)
    - "Cranial Nerves and Foramina", University of Dundee, CAHID (hazırlayan: Sophia Lappe), CC BY 4.0
    - "Anatomy of the Inner Ear", University of Dundee School of Medicine, CC BY-NC-SA 4.0
      (W. Robert J. Funnell, Sam Daniel ve Daren Nicolson'ın McGill University'deki "3D Ear" modelinden türetilmiştir)
    - "Kidney", Lissie Cowley, CC BY-NC 4.0
  Dosyalar: bones.glb, muscles.glb, nerves.glb, vessels.glb, organs.glb, lymph.glb, joints.glb,
            attach.glb, attachm.glb, attachf.glb (kas yapışma yerleri), femalejoints.glb (kadın pelvisine
            uyarlanmış eklem kopyaları); female.glb içindeki sigmoid kolon (rektum ve anal kanal dahil)
            ve üreterler
  Bu uyarlamalar da CC BY-SA 4.0 ile paylaşılır. İSTİSNA, yalnız ticari olmayan amaçla kullanılabilir:
    - iç kulak parçaları (koklea ve vestibül; nerves.glb içinde): CC BY-NC-SA 4.0
      https://creativecommons.org/licenses/by-nc-sa/4.0/
    - böbrek parçaları (organs.glb ve vessels.glb içinde): CC BY-NC 4.0
      https://creativecommons.org/licenses/by-nc/4.0/

HuBMAP CCF 3D Reference Object Library v1.2 (Kristen Browne, NIAID 3D Printing and Biovisualization;
Visible Human Female, U.S. National Library of Medicine)
  Lisans : CC BY 4.0  https://creativecommons.org/licenses/by/4.0/
  Kaynak : https://humanatlas.io/3d-reference-library
  Dosyalar: female.glb (kadın iç genital organları, vajina, mesane), femalepelvis.glb (kadın pelvisi)
  Değişiklik: sadeleştirildi, bu modelin pelvisine hizalandı; tubalar, overler ve mesane en çok 1,25 cm kaydırıldı.

HuBMAP Human Reference Atlas, 3D Reference Organ: Breast (mammary gland), Female left / right, v1.1 (Heidi Schlehlein)
  Lisans : CC BY 4.0  https://creativecommons.org/licenses/by/4.0/
  Kaynak : https://doi.org/10.48539/HBM533.BNJL.834  https://doi.org/10.48539/HBM235.CHRK.259
  Dosya  : breasts.glb
  Değişiklik: sadeleştirildi, 1,2 kat büyütüldü, döndürülüp kaydırılarak göğüs duvarına oturtuldu, tabanı göğüs
              duvarına göre büküldü.

Klitoris modeli V2 (2016), Odile Fillod ve Philippe Cosentino, Cité des sciences et de l'industrie
(Carrefour numérique² FabLab)
  Lisans : CC BY-NC-SA (yalnız ticari olmayan kullanım; uyarlama da aynı koşullarla paylaşılır)
           Kaynağında sürüm belirtilmemiş; güncel metin: https://creativecommons.org/licenses/by-nc-sa/4.0/
  Dosya  : vulva.glb (klitoris ve vestibül bulbusları)
  Değişiklik: parçalara bölündü, gerçek boyutuyla bu modelin kadın pelvisine yerleştirildi.

Bu uygulama için çizilenler (şematik): urethra.glb (kadın üretrası), bartholin.glb (Bartholin bezleri).

Ticari olmayan lisanslı parçalar (iç kulak, böbrek, klitoris) nedeniyle Anatomi 3D ücretsiz ve reklamsız dağıtılır.
`;

// [başlık, node_modules içindeki paket, lisans dosyası, sürüm yazılsın mı, yalnız şu satırdan önceki bölüm]
const BUNDLED = [
  ['three.js', 'three', 'LICENSE', true],
  ['three-mesh-bvh', 'three-mesh-bvh', 'LICENSE', true],
  ['meshoptimizer (çözücü: three.js ile gelen meshopt_decoder.module.js)', 'meshoptimizer', 'LICENSE.md', false],
  ['Vite (pakete eklenen modül ön yükleme yardımcı kodu)', 'vite', 'LICENSE.md', true, '# Licenses of bundled dependencies'],
  // src/pwa.js nativeBack: yalnız mağaza uygulamasının kabuğunda yüklenen ayrı bir parça (dinamik import) içindedir;
  // eklentinin yerel (Android) kısmı da APK/AAB içine girer
  ['Capacitor core (yalnız uygulama kabuğunda yüklenen parçada)', '@capacitor/core', 'LICENSE', true],
  ['Capacitor App eklentisi (Android Geri tuşu; JavaScript kısmı yalnız uygulama kabuğunda yüklenen parçada, yerel kısmı mağaza paketinde)', '@capacitor/app', 'LICENSE', true],
];

export function licensesText(root) {
  const line = '-'.repeat(78);
  const out = [
    'Anatomi 3D - kaynaklar ve lisanslar',
    '',
    'Anatomi 3D ücretsiz, reklamsız bir anatomi atlasıdır. Bu dosya, uygulamayla birlikte dağıtılan 3B modellerin',
    'kaynaklarını (1. bölüm) ve uygulama paketinin içindeki açık kaynak yazılımların lisans metinlerini (2. bölüm)',
    'içerir. Kaynakların açıklamalı dökümü uygulamadaki "Hakkında" (i) penceresindedir.',
    '', '',
    MODELS, '',
    '2. YAZILIM', '==========', '',
    'Uygulama paketinin (assets/*.js) içinde aşağıdaki açık kaynak yazılımlar bulunur. Lisans metinleri özgün dilindedir.',
    '',
  ];
  for (const [title, pkg, file, withVersion, until] of BUNDLED) {
    const dir = join(root, 'node_modules', pkg);
    let text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    if (until && text.includes(until)) text = text.slice(0, text.indexOf(until));
    const version = withVersion ? ' ' + JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version : '';
    out.push(line, title + version, line, '', text.trim(), '', '');
  }
  out.push(...nativeShell(root, line));
  return out.join('\n');
}

// 3. bölüm: mağaza uygulamasının (Capacitor Android kabuğu) APK/AAB içine giren yerel kütüphaneler. Sürümler
// android/variables.gradle'dan okunur; yeni bir Capacitor eklentisi ya da yerel bağımlılık eklenirse burası güncellenir.
function nativeShell(root, line) {
  let vars = '';
  try { vars = readFileSync(join(root, 'android', 'variables.gradle'), 'utf8'); } catch { /* android klasörü yoksa sürümsüz */ }
  const v = k => (vars.match(new RegExp(k + "\\s*=\\s*'([^']+)'")) || [])[1] || '';
  const capDir = join(root, 'node_modules', '@capacitor', 'android');
  const capVersion = JSON.parse(readFileSync(join(capDir, 'package.json'), 'utf8')).version;
  const mit = readFileSync(join(capDir, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  // Apache-2.0 metni yerelde bir paketten okunur (yeni indirme yok); bulunamazsa resmi adresi yazılır
  let apache = 'Apache License 2.0 metni: https://www.apache.org/licenses/LICENSE-2.0.txt';
  try {
    const t = readFileSync(join(root, 'node_modules', 'detect-libc', 'LICENSE'), 'utf8').replace(/\r\n/g, '\n');
    if (t.includes('Apache License') && t.includes('END OF TERMS AND CONDITIONS')) apache = t.slice(0, t.indexOf('END OF TERMS AND CONDITIONS') + 27).trim();
  } catch { /* adres kalır */ }
  const ax = [
    ['androidx.appcompat:appcompat', v('androidxAppCompatVersion')],
    ['androidx.activity:activity', v('androidxActivityVersion')],
    ['androidx.core:core', v('androidxCoreVersion')],
    ['androidx.core:core-splashscreen', v('coreSplashScreenVersion')],
    ['androidx.coordinatorlayout:coordinatorlayout', v('androidxCoordinatorLayoutVersion')],
    ['androidx.fragment:fragment', v('androidxFragmentVersion')],
    ['androidx.webkit:webkit', v('androidxWebkitVersion')],
  ];
  return [
    '', '3. MOBİL UYGULAMA KABUĞU (yalnız Google Play / App Store sürümü)', '=================================================================', '',
    'Mağaza uygulaması aynı web uygulamasını bir Android WebView içinde çalıştırır. Uygulama paketinde (APK/AAB) ayrıca',
    'şu açık kaynak yazılımlar bulunur. Web sürümünde bunlar yoktur.', '',
    line, 'Capacitor Android ' + capVersion + ' (yerel kabuk ve JavaScript köprüsü native-bridge.js)', line, '', mit, '', '',
    line, 'Apache License 2.0 ile lisanslı bileşenler', line, '',
    'Apache Cordova Android ' + (v('cordovaAndroidVersion') || '') + ' (org.apache.cordova:framework, Capacitor\'ın Cordova uyumluluk katmanı)',
    '  Apache Cordova - Copyright The Apache Software Foundation.',
    '  This product includes software developed at The Apache Software Foundation (http://www.apache.org/).',
    'Android Jetpack (AndroidX) kütüphaneleri - Copyright The Android Open Source Project:',
    ...ax.map(([n, ver]) => '  ' + n + (ver ? ' ' + ver : '')),
    '  ve bunların paket içine giren AndroidX / Kotlin standart kütüphanesi bağımlılıkları (Apache License 2.0).',
    '', apache, '',
  ];
}
