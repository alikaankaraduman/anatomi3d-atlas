# Anatomi 3D telefonda (iOS ve Android)

Bu belge, uygulamayı telefonda kullanmak ve telefon uygulaması olarak derlemek için hazırlanan teknik temeli anlatır.
İki yol var: bugün ücretsiz olan **PWA** (ana ekrana eklenen web uygulaması, aşağıda) ve **mağaza uygulaması**
(Capacitor ile sarılmış aynı web uygulaması; 2026-11-21'den beri Android projesi hazır, iOS henüz yok; aşağıda
"Mağaza uygulaması (Capacitor)").

## Temel

- **Göreli yollar** (`app/vite.config.js`, `base: './'`): derlenmiş uygulama (`app/dist`) her klasörden çalışır:
  GitHub Pages alt yolu, Capacitor WebView'i, yerel bir klasör. Bütün veri ve model istekleri göreli
  (`data/...`, `models/...`, `sw.js`, `manifest.webmanifest`).
- **PWA (ana ekrana eklenebilen web uygulaması)**: `app/public/manifest.webmanifest` (ad, Türkçe, tam ekran, koyu
  tema renkleri), simgeler `app/public/icons/` (192 ve 512 PNG, maskelenebilir 512, iOS için 180 PNG;
  `node tools/icons.mjs` ile paketsiz üretilir), `index.html`'de iOS ve Android meta etiketleri,
  `viewport-fit=cover`.
- **Çevrimdışı çalışma** (`app/public/sw.js`, kütüphanesiz service worker; `app/src/pwa.js`): yalnız derlenmiş
  uygulamada etkin. İlk açılıştan sonra uygulama kabuğu ve bütün veri dosyaları cihazdadır; modeller kullanıldıkça
  ya da ⓘ › "Çevrimdışı kullanım" › **Hepsini indir (≈32 MB)** ile gelir. Her dosya içerik özetiyle saklanır:
  yeni bir sürüm eski veriyi asla göstermez, değişmeyen dosyalar yeniden indirilmez. Yeni sürüm hazır olunca altta
  **"Yeni sürüm hazır · Yenile"** çıkar. "Önbelleği temizle" bu cihazdaki kopyayı siler; uygulama bir kez çevrimiçi açılınca
  kabuk yeniden önbelleğe girer. Dosyalar sürümlü adresten indirilir ve içerik özeti denetlenir (CDN'deki eski bir
  kopya yeni sürüm diye saklanmaz); yeni sürüm bir sekmede etkinleşince öteki açık sekmeler de yenilenir.
- **Telefonda bellek tasarrufu**: Araçlar › **"Sistemleri gerektiğinde yükle"**. Açıkken açılışta yalnız iskelet
  yüklenir, öteki sistemler ilk gerektiğinde gelir (mod, Göster/Saydam katman, arama, Aanki konusu, çalışma modu).
  Telefonda ve belleği 4 GB ya da daha az olan cihazlarda varsayılan olarak açıktır. Çizim çözünürlüğü en çok 2x'tir.
- **Dokunmatik düzen**: çentik ve ev çubuğu boşlukları (safe area), dinamik ekran yüksekliği, dokunmatik ekranda en
  az 40 px düğmeler, alttaki bilgi panelini küçültme tutamağı, yatay telefonda sol panel çekmece. Tek parmak
  döndürür, iki parmak yakınlaştırır ve kaydırır, dokunmak seçer (iki parmaklı hareketten sonra yanlışlıkla seçim
  yapılmaz), çift dokunuş odaklar. Klavye kısayollarının karşılıkları kartta: Odaklan (F), Gizle (H), İzole et (I),
  Bırak (Esc), Gizlenenleri göster (Alt+H); izolasyondan "Çık" ile çıkılır.
- **Bağlantılar**: görünüm adres çubuğunda tutulur ve açılışta geri gelir: `#t=<Aanki konusu>`, `#s=<yapı>`,
  `#m=heart:<bölüm>`, `#m=brain:<bölüm[:görünüm[:sinir]]>`, `#m=loco:<bölüm[:anahtar]>`, turlar
  `#m=situs|thorax|uro|head|vessels|lymph:<sekme>` (ör. `#m=situs:arteries`), kesit atlası `#m=sect:<seviye>` ya da
  `#m=sect:test[:bölge]` (ör. `#m=sect:abd-coel`), deneme sınavı `#m=exam`. Örnek:
  `.../#m=loco:joints:knie`, `.../#t=abp-01`. Anki kartlarına bu bağlantılar konabilir.
- **Lisans ve uyarı**: ⓘ penceresinde bütün kaynaklar ve lisansları, metinlerin yapay zekâ ile yazılıp denetlendiği
  (anatomi uzmanınca değil), tıbbi uyarı (yalnız öğrenme için) ve gizlilik notu (uygulama veri toplamaz; barındırıcı her sitede olduğu gibi
  bağlantı kayıtları tutar). Paketlenen kütüphanelerin lisans metinleri ve hangi model dosyasının hangi kaynaktan
  geldiği, yayınla birlikte giden `lisanslar.txt` dosyasındadır (derlemede `tools/licenses.mjs` üretir).
- **Capacitor hazırlığı**: `app/capacitor.config.json` (`appName` "Anatomi 3D", `webDir` "dist"). 2026-11-21'de
  Capacitor kuruldu ve Android projesi üretildi: aşağıda "Mağaza uygulaması (Capacitor)".

## Ücretsiz yol: PWA olarak kurmak

Uygulama GitHub Pages'te yayında: **https://alikaankaraduman.github.io/anatomi3d-atlas/**. Service worker yalnız
HTTPS'te ya da `localhost`'ta çalıştığı için telefonda yayındaki adres kullanılır.

- **Android (Chrome)**: adresi açın › sağ üstteki ⋮ menüsü › **"Uygulamayı yükle"** ya da **"Ana ekrana ekle"**.
  Uygulama kendi penceresinde, adres çubuğu olmadan açılır.
- **iPhone / iPad (Safari)**: adresi Safari'de açın › **Paylaş** düğmesi › **"Ana Ekrana Ekle"** › Ekle.
  (iOS'ta başka tarayıcılar da Paylaş menüsünden ekleyebilir; en güvenilir yol Safari'dir.)
- Bir kez internetle açın; ardından ⓘ › "Çevrimdışı kullanım" › "Hepsini indir" ile her şeyi cihaza alın.
  iOS, uzun süre açılmayan web uygulamalarının verisini silebilir; o zaman yeniden indirmek gerekir.

## Statik bir barındırıcıya yayınlamak

`app/` içinde `npm run build` her şeyi `app/dist` klasörüne yazar (yaklaşık 33 MB; sunucu tarafı kod yoktur). Bu klasör
herhangi bir statik barındırıcıya, kökten ya da bir alt yoldan yüklenebilir (`base: './'`).

- **Yanıt başlıkları**: `app/public/_headers` (derlemeyle `dist/_headers` olur; Netlify ve Cloudflare Pages biçimi):
  noindex, Content-Security-Policy, çerçeve ve yönlendiren kuralları, önbellek süreleri, lisans dosyasının ve uygulama
  bildiriminin içerik türü. Dosya `dist`'in içinde olduğu için sürükle-bırak yüklemede de geçerlidir; service worker
  listesine girmez (`vite.config.js` `HOST_FILES`). Service worker yanıtları başlıklarıyla birlikte saklar: bir başlık
  değişikliği kurulu telefonlara ancak içeriği değişen yeni bir sürümle ulaşır. `app/netlify.toml` yalnız yayın
  klasörünü ve derleme komutunu söyler.
- **GitHub Pages** başlık gönderemez. Bu yüzden Pages derlemesi `ANATOMI_TARGET=pages npm run build` ile yapılır:
  `vite.config.js` her `.html` dosyasına (`index.html`, `gizlilik.html`) `<meta name="robots" content="noindex">` ve
  sıkı Content-Security-Policy meta etiketini ekler (`script-src 'self' 'wasm-unsafe-eval'`, `form-action 'none'`),
  service worker listesi de bu son hâle göre yazılır. Değişken verilmezse derleme bundan hiç etkilenmez. Yayını
  `.github/workflows/pages.yml` yapar (`main`'e her gönderimde ya da elle): `npm ci`, Pages derlemesi, meta etiketi
  denetimi, `app/dist`'in Pages yapıtı olarak yüklenmesi ve yayın. Depo › Settings › Pages › Source: "GitHub Actions"
  bir kez seçilmelidir.
- **Netlify ücretsiz plan rozeti**: Netlify ücretsiz planda herkese açık sitelerin **her HTML sayfasına** yolda bir yorum
  satırı ve sağ alt köşede duran, ziyaretçinin kapatamadığı "Powered by Netlify" rozetinin betiğini
  (`/.netlify/scripts/hud`) ekler; taslak yayınlarda eklemez. Kodda alınan önlemler: (1) `index.html`'in baytları
  değişir; service worker bu yüzden sayfayı bayt özetiyle değil, sürümün giriş dosyalarına başvurmasıyla tanır
  (`public/sw.js` `sameBuildPage`, `vite.config.js` `entry`); yoksa çevrimdışı kurulum düşer. (2) Rozet satır içi
  betikle çalıştığı için `_headers` içindeki Content-Security-Policy'de betik için `'unsafe-inline'` ve
  `form-action https://app.netlify.com` vardır. (3) Rozet telefonda 181×48 piksellik bir alanı kaplar; altında kalan
  öğeler kaydırılabilsin diye paneller sona 56 piksel boşluk ekler (`src/main.js` `--host-pad`, `src/style.css`).
  Sayfaya ek yapmayan bir barındırıcıda (GitHub Pages, Cloudflare Pages) `_headers` içindeki sıkı kural kullanılabilir
  (dosyada yazılı).
- **Doğrulama betikleri** (`app/tools/_qawork/swtest/`; kurulum gerektirmez, bilgisayardaki Edge'i başsız kullanır):
  `verify-deploy.mjs` (yayındaki her dosyayı yerel derlemeyle karşılaştırır), `live.mjs` (ilk açılış: service worker,
  rozet, hatalar), `sweep.mjs` (bütün çalışma modları; güvenlik ihlali, konsol hatası, başarısız istek),
  `offline.mjs`, `update.mjs`, `pwa.mjs`, `badge.mjs` (rozet hangi düğmelerin üstüne biniyor), `serve.mjs` (`dist`'i
  `_headers` kurallarıyla yerelde sunar; `--inject` Netlify'ın ekini taklit eder). Adımlar aynı klasördeki README.md
  dosyasındadır.

## Mağaza uygulaması (Capacitor)

Capacitor (MIT lisanslı, ücretsiz) aynı web uygulamasını (`app/dist`) bir Android ve iOS uygulamasına sarar:
bütün dosyalar uygulamanın içinde gelir, internet ve service worker gerekmez. Uygulamanın gizlilik sayfası:
`app/public/gizlilik.html` (uygulama içinde ⓘ penceresinden açılır).

### Şu an var olanlar (2026-11-21)

- **Paketler**: `@capacitor/core` ve `@capacitor/android` 8.6.2, `@capacitor/cli` 8.6.2 (geliştirme) ve Android'in
  Geri tuşu için `@capacitor/app` 8.1.2 (hepsi MIT; 2026-11-21'de npm'den kuruldu). `@capacitor/ios` kurulmadı
  (Windows'ta işe yaramaz).
- **Android projesi** `app/android/` (`npx cap add android` üretti; Android Studio ile açılan sıradan bir Gradle
  projesi). Kimlik `app.anatomi3d.atlas`, ad "Anatomi 3D", en düşük Android 7.0 (API 24), hedef ve derleme API 36,
  sürüm **1.0.0** (sürüm kodu 1; nasıl artırılacağı `android/app/build.gradle`'daki açıklamada).
- **Kendi simgesi ve açılış ekranı**: `npm run android:res` (`app/tools/android-res.mjs`, paket gerektirmez; PWA
  simgelerindeki kemik ve mavi nokta şekilleri) Capacitor'ın varsayılan resimlerinin yerine şunları yazar:
  her yoğunlukta eski kare ve yuvarlak simge (48 dp), uyarlanabilir simgenin saydam ön katmanı (108 dp tuval, işaret
  ortadaki 66 dp güvenli dairenin içinde; arka plan rengi `#26282d`, `values/ic_launcher_background.xml`), Android
  13+ temalı simge katmanı ve var olan 11 `drawable*/splash.png` dosyası kendi boyutunda (koyu zemin, ortada
  işaret). Her PNG yazıldıktan sonra boyutu geri okunup denetlenir. Kullanılmayan varsayılan vektörler (yeşil ızgara,
  Android robotu) silindi.
- **Koyu açılış**: `res/values/styles.xml` ve `colors.xml`. Android 12+ sistem açılış ekranı koyu zemin ve uygulama
  simgesiyle; Android 11 ve öncesi `drawable/launch_splash.xml` (düz zemin + ortalanmış, gerilmeyen splash.png). Temalar
  koyu tabanlı (`Theme.AppCompat.NoActionBar`), pencere zemini, durum ve gezinme çubukları `#26282d`: açık sistem
  temasında da beyaz bir an görünmez. Android 15+ uygulamayı kenardan kenara çizer; orada `capacitor.config.json`
  `plugins.SystemBars` (`style: DARK` = koyu zemine açık simgeler, `insetsHandling: css`) ve sayfanın
  `viewport-fit=cover` + `env(safe-area-inset-*)` kuralları çubukların altında boşluk bırakır.
- **Yayın imzası**: `android/app/build.gradle` anahtar deposunun yolunu, adını ve parolalarını ortam
  değişkenlerinden (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)
  ya da depoya girmeyen `android/keystore.properties` dosyasından okur (örnek: `android/keystore.properties.example`).
  Hiçbir anahtar ya da parola dosyalara yazılmadı; `keystore.properties`, `*.jks`, `*.keystore` `android/.gitignore`'da.
  İmza yoksa yayın derlemesi imzasız çıkar. Küçültme (R8) kapalı: Capacitor eklentileri yansımayla yükler,
  derlenip denenmeden açmak çökme riski taşır; kazanç birkaç yüz KB olurdu (paketin büyüğü 33 MB'lık web dosyaları).
- **Yedekleme** (`android:allowBackup="true"`, bilerek): soru ilerlemesi, deneme sınavı geçmişi ve görünüm ayarları
  WebView'in localStorage'ındadır (`anatomi3d.progress.v…`, `anatomi3d.exam…`, `anatomi3d.sex`, `anatomi3d.lazy`,
  `anatomi3d.treeview`, `anatomi3d.cap`). Android'in kendi yedeklemesi bunları kullanıcının Google hesabına koyar ve
  yeni telefonda ya da yeniden kurulumda geri getirir; kapalı olsaydı telefon değişince bütün ilerleme kaybolurdu.
  Kişisel veri yoktur, yedek geliştiriciye ulaşmaz (Google Play "veri güvenliği" formunda toplama sayılmaz);
  kullanıcı Android ayarlarından yedeklemeyi kapatabilir. Modeller uygulamanın içinde olduğu için yedeğe girmez.
  Cihazdaki kullanıcı profilleri (ad, şifrenin tuzlanmış özeti, kişiye özel ilerleme: `anatomi3d.users.v1`,
  `anatomi3d.u.<kimlik>.…`) de aynı depodadır ve bu yedeğe girer; gizlilik sayfası bunu söyler.
- **npm betikleri** (`app/` klasöründe): `npm run android:sync` web uygulamasını derler ve `npx cap sync android` ile
  `android/app/src/main/assets/public` içine kopyalar (her web değişikliğinden sonra); `npm run android:res`
  simgeleri ve açılış görüntülerini yeniden çizer (yalnız şekil ya da renk değişince).
- **Depo**: `node_modules`, `dist`, Android derleme çıktıları ve imza anahtarları depoya girmez (`.gitignore`).
- **Bulutta derleme**: `.github/workflows/android.yml` (GitHub Actions; 21.11.2026'da sınandı). Üç iş:
  - *debug-apk*: `npm ci`, web derlemesi, `cap sync`, Java 21 (Temurin) ve Gradle ile hata ayıklama APK'sı (yaklaşık
    1,5 dakika; 28 MB; kimlik `app.anatomi3d.atlas`, sürüm 1.0.0, hedef API 36, tek izin internet). APK çalıştırmanın
    sayfasında "Artifacts" altında durur (14 gün); `v` ile başlayan bir etiket gönderilirse ayrıca deponun **Releases**
    sayfasına eklenir (telefondan doğrudan indirilebilir).
  - *emulator-smoke* (elle başlatılınca): APK'yı Android 15 emülatöründe açar ve gerçek WebView içinde sınar
    (`app/tools/_qawork/android/smoke.mjs`): açılış, altı sistemin yüklenmesi, 3B çizimin gerçekten oluşması (tuval
    pikselleri okunur), Android Geri tuşu (pencere, çalışma modu, belge penceresi; hiçbir şey açık değilken uygulama arka
    plana gider), lisans ve gizlilik belgelerinin uygulama içinde okunması, cihazdaki kullanıcı profili. 15 denetimin
    hepsi geçti; ekran görüntüsü: `docs/screens/android-emulator.png`.
  - *release-aab* (elle başlatılınca): imza sırları varsa imzalı yayın paketi (AAB). Sır olmadığı için henüz gerçek
    bir paket üretmedi.
  Başlatmak: depo sayfasında Actions › Android › "Run workflow", ya da komut satırında `gh workflow run android.yml`.
  Hata ayıklama APK'sı her derlemede farklı bir deneme anahtarıyla imzalanır: yeni derlemeyi kurmadan önce eskisi
  kaldırılmalıdır. Bir tam çalıştırma (emülatör sınamasıyla) yaklaşık 8 dakika sürer; herkese açık depoda Actions
  dakikaları ücretsizdir.

### Uygulama kabuğunda web uygulaması (kod okunarak; telefonda denenmedi)

- **Service worker**: `src/pwa.js` Capacitor'ın sayfaya eklediği `window.Capacitor.isNativePlatform()` ile kabuğu
  tanır ve kaydetmez (Android'de adres `https://localhost/`, `capacitor:` denetimi yalnız iOS'ta işe yarar). Doğru.
- **Göreli yollar**: bütün veri ve model istekleri göreli; `https://localhost/` kökünden sorunsuz.
- **Dış bağlantılar** (`target="_blank"`): Capacitor çoklu pencereyi açmaz; bağlantı aynı WebView'de açılmak istenir,
  Capacitor başka bir alan adını görünce **sistem tarayıcısına** gönderir. Doğru çalışır.
- **Aynı kökenli bağlantılar** (`lisanslar.txt`, mağaza için eklenen `gizlilik.html`): `https://localhost/...` uygulamanın
  kendisi sayıldığı için normalde uygulamanın yerine WebView'de açılırdı ve geri dönüş yolu olmazdı. Çözüldü
  (2026-11-21): kabukta (`Capacitor.isNativePlatform()`) aynı kökenli `.txt`/`.html` bağlantıları `src/pwa.js`
  `nativeDocs()` tarafından `#doc` penceresinde gösterilir; Geri ve "Kapat" pencereyi kapatır. Pencere her açılışta
  yeni, korumalı (sandbox) bir çerçeve kurar ve kapanınca siler: var olan bir çerçevenin adresini değiştirmek sayfa
  geçmişine kayıt ekler ve Geri tuşunu bozardı. Belgenin içindeki "← Uygulamaya dön" bağlantısı pencerede kaldırılır.
  Cihazda denenmedi.
- **Android geri tuşu**: Capacitor çekirdeği geri tuşunu dinlemez (eklentisiz hâlde tuş uygulamayı kapatır ve sayfaya
  hiçbir olay gelmez). Bu yüzden `@capacitor/app` eklentisi kuruldu ve `src/pwa.js` `nativeBack()` tuşu sayfaya bağlar:
  sayfa geçmişinde geri gidilebiliyorsa (açık bir pencere, çekmece, çalışma modu ya da seçim varken `main.js`'in
  koruma kaydı durur) `history.back()` çağrılır ve en üstteki katman kapanır; gidilemiyorsa uygulama arka plana
  alınır. Eklentinin JavaScript'i yalnız kabukta yüklenen küçük ayrı bir parçadadır. Cihazda denenmedi.
- **Content-Security-Policy**: `public/_headers` yalnız Netlify'da geçerlidir; uygulamada hiçbir güvenlik başlığı
  yoktur. Uygulama yalnız kendi dosyalarını yükler, dışarıdan betik ya da veri almaz; bu yüzden zorunlu değildir.
  İstenirse `index.html`'e bir `<meta http-equiv="Content-Security-Policy">` eklenebilir, ama (1) Capacitor köprüsü
  sayfaya satır içi bir betik eklediği için `script-src` içinde `'unsafe-inline'` gerekir, (2) aynı etiket web
  sürümünde de geçerli olur ve `_headers`'daki kuralla birlikte uygulanır (ikisinin kesişimi). Bu yüzden eklenmedi.
- **Güvenli alan**: sayfa `env(safe-area-inset-*)` kullanır. WebView 140+ ile kenardan kenara çizimde bu değerler
  gelir; daha eski WebView'de Capacitor WebView'i çubukların arasına sığdırır (değerler 0, zemin koyu). Ek CSS
  gerekmez; Capacitor ayrıca `--safe-area-inset-*` değişkenlerini de yazar.

### Android: APK ve yayın anahtarı

1. **Uygulama kimliği**: `app.anatomi3d.atlas` mağazaya ilk yüklemeden sonra **değiştirilemez**. Başka bir ad
   istenirse önce değiştirin: `capacitor.config.json` `appId`, `android/app/build.gradle` `applicationId`,
   `android/app/src/main/res/values/strings.xml` (`package_name`, `custom_url_scheme`); `namespace` ve Java paketi
   aynı kalabilir.
2. **APK (ücretsiz)**: depo › **Actions** › **Android** › **Run workflow** (kendi kopyanızda da çalışır;
   `app/public/models` depoda olmalı). Bitince çalıştırmanın sayfasında **Artifacts** › `anatomi3d-debug-apk` (zip
   içinde `app-debug.apk`, 14 gün saklanır). Telefonda dosyayı açın, "bilinmeyen kaynaklardan yükleme" iznini verin,
   kurun. Başka bir yol: Android Studio ile `npx cap open android`.
3. **Yayın anahtarı** (yalnız mağaza için): Java'daki `keytool` gerekir (Android Studio ile gelir; ayrı bir JDK da
   olur). Anahtar deposunu proje klasörünün dışında oluşturun:
   `keytool -genkeypair -v -keystore anatomi3d-release.jks -alias anatomi3d -keyalg RSA -keysize 2048 -validity 10000`
   Base64 metni (PowerShell):
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("anatomi3d-release.jks")) | Set-Content anatomi3d-release.b64.txt`
   Depo › Settings › Secrets and variables › Actions'a dört sır: `ANDROID_KEYSTORE_BASE64` (bu metin),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`anatomi3d`), `ANDROID_KEY_PASSWORD`. Sonra Run workflow:
   `anatomi3d-release-aab` çıkar (7 gün). Metin dosyasını sonra silin; `.jks` dosyasını ve parolaları iki ayrı yerde
   yedekleyin. Google Play App Signing açıkken bu "yükleme anahtarı"dır; kaybolursa Play Console'dan sıfırlatılabilir.

### iOS (henüz yok)

iOS projesi Windows'ta üretilemez ve derlenemez; `@capacitor/ios` bilerek kurulmadı.
1. Bir Mac (ya da GitHub Actions'ın macOS işçileri; herkese açık depoda ücretsiz) gerekir. `app/` klasöründe:
   `npm install @capacitor/ios` (indirir), `npm run build`, `npx cap add ios`, `npx cap sync ios`, `npx cap open ios`.
2. Simge: Xcode `Assets.xcassets/AppIcon` için tek bir 1024×1024 saydamsız PNG yeter (`tools/android-res.mjs`'deki
   çizici bunun için genişletilebilir); açılış ekranı `LaunchScreen.storyboard` zemini `#26282d`.
3. Kendi iPhone'unuza ücretsiz Apple kimliğiyle Xcode'dan kurulabilir (7 günde bir yeniden imza). TestFlight ve
   App Store için Apple Developer Program (yıllık 99 USD) zorunludur; GitHub Actions'ta imzalamak için sertifika
   ve profil sırları gerekir (bu iş akışı yalnız Android'i derler).
4. `capacitor.config.json`'da `ios` ayarları (zemin rengi, `contentInset: never`) hazır. Apple tıbbi ve "web
   sarmalayıcı" uygulamaları daha sıkı inceler (yönerge 4.2): çevrimdışı çalışma ve 3B etkileşim gerekçe olarak
   belirtilmeli.

### Lisansların sonuçları

- **Klitoris modeli (Fillod, CC BY-NC-SA)**, iç kulak (CC BY-NC-SA 4.0) ve böbrek (CC BY-NC 4.0) modelleri ticari
  olmayan kullanım şartı taşır: uygulama **ücretsiz ve reklamsız** kalmalıdır; ücretli satış, reklam ya da uygulama
  içi satın alma düşünülürse bu modeller çıkarılmalıdır.
- **BodyParts3D (CC BY-SA 2.1 JP) ve Z-Anatomy (CC BY-SA 4.0)** "aynı lisansla paylaş" şartı taşır: dönüştürülmüş
  modeller (`public/models/*.glb`) aynı lisansla paylaşılmalı ve atıflar uygulamada görünmelidir (ⓘ).
- HuBMAP modelleri CC BY 4.0: atıf yeterlidir (ⓘ'de var).
- Mağaza koşullarının CC BY-SA ile uyumu **belirsizdir**: özellikle App Store'un DRM ve kullanım kuralları, CC BY-SA
  4.0'ın "ek kısıtlama getirilemez" maddesiyle çatışıyor sayılır. Bu yüzden dönüştürülmüş modeller ve uygulamanın
  kaynağı mağaza dışında da aynı lisansla erişilebilir tutulmalıdır (örneğin herkese açık bir depo ve PWA adresi).

## Denenemeyenler

- Gerçek bir telefonda denenmedi. Testler uygulama içi tarayıcının (Chromium) telefon (375x812, dokunmatik
  öykünmesiyle) ve tablet (768x1024, dokunmatik öykünmesi olmadan) görünümlerinde yapıldı; gerçek çoklu dokunma
  hareketleri ancak bir telefonda sınanabilir (iki parmak seçimi engelleme mantığı yapay dokunma olaylarıyla denendi).
- Service worker gerçek bir tarayıcı motorunda sınandı (20.11.2026, masaüstü Edge 157, başsız kip, geçici profil;
  uygulama içi tarayıcı service worker kaydını reddettiği için orada denenemedi):
  - ilk açılışta kayıt ve etkinleşme, kabuk önbelleği ve 17 model dosyası;
  - önizleme sunucusu kapatılıp sayfa yenilendiğinde uygulamanın altı sistemle birlikte tümüyle önbellekten açılması;
  - yeni bir derlemeden sonra eski sürümün açılması, "Yeni sürüm hazır · Yenile" çubuğunun çıkması, Yenile'ye
    basınca yeni sürüme geçilmesi ve eski kabuk önbelleğinin silinmesi.
  Ayrıca Node'da sahte bir önbellekle birim sınamaları yapıldı (kurulum, önce önbellek, sürüm değişiminde yalnız
  değişen dosyanın inmesi, temizleme). **Android Chrome ve iOS Safari'de henüz denenmedi**: telefonda bir kez
  açıp "Hepsini indir"den sonra uçak kipinde yeniden açarak denenmeli.
- iOS Safari'de `navigator.deviceMemory` yoktur; orada varsayılan, dokunmatik küçük ekran kuralından gelir.
- **Android uygulaması yalnız bulutta derlendi ve yalnız emülatörde açıldı** (yukarıda "Bulutta derleme"): gerçek bir
  telefonda hiç açılmadı ve imzalı bir yayın paketi henüz yok. Actions sürümleri 2026-11'deki son ana sürümlerdir
  (checkout v7, setup-node v7, setup-java v6, setup-gradle v6, upload-artifact v7); setup-gradle `cache-provider: basic`
  ile çalışır: v6'nın varsayılan "enhanced" önbelleği MIT lisanslı değil.
- iOS projesi yok; hiçbir iOS adımı denenmedi.
