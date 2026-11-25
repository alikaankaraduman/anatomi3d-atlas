# Service worker ve yayın sınamaları (başsız Edge, kurulum gerektirmez)

Uygulama içi tarayıcı service worker kaydını reddettiği için çevrimdışı açılış, güncelleme bildirimi ve yayın
başlıkları bilgisayardaki Edge ile sınanır. Hiçbir şey indirilmez; geçici bir profil klasörü kullanılır.

## Hazırlık

1. `app/` içinde `npm run build`.
2. Yerel sınama için derlemeyi yayın başlıklarıyla sun (ayrı bir kabukta): `node tools/_qawork/swtest/serve.mjs 4190`.
   `dist/_headers` kurallarını (Content-Security-Policy, noindex, önbellek) Netlify gibi uygular; `_headers` dosyasının
   kendisini sunmaz. Yayındaki siteyi sınarken bu adım gerekmez.
3. Edge'i başlat (profil klasörünü kendin seç; aynı profil = aynı kurulu service worker):
   `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --remote-debugging-port=9333 --user-data-dir=<profil klasörü> --no-first-run --disable-extensions --enable-unsafe-swiftshader --window-size=1280,800 about:blank`

## Betikler (bu klasörde, `<adres>` sonunda `/` ile; ör. `http://localhost:4190/` ya da yayındaki adres)

- `node verify-deploy.mjs <adres>`: Edge gerekmez. Listedeki her dosyayı indirir, içerik özetini yerel derlemeyle
  karşılaştırır, başlıkları ve sunulmaması gereken dosyaları (`_headers`, kaynak dosyalar) yazar. Çıkış kodu 0 = aynı.
- `node sweep.mjs <adres> [all]`: bütün çalışma modlarını derin bağlantılarla dolaşır, arama ve Hakkında penceresini
  dener; Content-Security-Policy ihlallerini, konsol hatalarını, başarısız ve başka adrese giden istekleri toplar.
  `all`: "Hepsini indir" ile bütün modelleri önbelleğe alır (33 MB indirir).
- `node pwa.mjs [adres]`: tarayıcının uygulama bildirimini okuyup okuyamadığını ve kurulabilirlik hatalarını yazar.
- `node update.mjs <adres>`: eski sürümü kurulu bir profilde "Yeni sürüm hazır" çubuğunu, Yenile'yi ve yeni sürüme
  geçişi sınar (önce eski derlemeyle bir kez aç, sonra yeni derlemeyi sun ya da yayınla).
- `node offline.mjs <adres> pre`: yanlış bir alt yolun (`/foo/bar`) uygulama kabuğunu almadığını denetler.
- `node offline.mjs <adres> post`: çevrimdışı açılış. Yerelde: sunucuyu durdur, sonra çalıştır. Yayındaki sitede:
  Edge'i kapat ve aynı profille, sitenin adını ulaşılmaz kılan şu ek seçenekle yeniden başlat:
  `--host-resolver-rules="MAP <site adı> 127.0.0.1"`; uygulama, bir çalışma modu ve `lisanslar.txt` önbellekten açılmalı.
- `node run.mjs first|reload|state|eval [adres] [...]`: tek tek adımlar (ilk açılış, yeniden yükleme, durum, sayfada JS).
- `node locsweep.mjs [adres]` (`SEX=f`: kadın model): patoloji vakalarının hepsinde 3B lezyon bulma görevini
  (`../patho-loc-sweep.js`) çalıştırır; doğru noktaya tıklamanın doğru sayılmasını ve vakanın açılmasını denetler.
- `node mobilecheck.mjs [adres]`: 375x812 dokunmatik görünümde 14 modu açar; yatay taşma ve konsol hatası arar,
  her mod için `mobile-<n>.png` yazar.
- `node quizflow.mjs [adres]`: modların ve turların testlerinde çoktan seçmeli soruları cevaplar (her birinde 6 soru);
  ilerlemenin kaydedildiğini ve konsol hatası olmadığını denetler.
- `node heartfind.mjs [adres]`: kalp testinde "Yapıyı bul": sorulan yapıya, önünde yalnız saydam parçalar olan bir
  noktadan gerçek fare tıklaması; doğru sayılmalı.
- `node sectfind.mjs [adres] [n]` (`SEX=f`; `FLIP=1`: her 4 soruda bir beden değiştirir): kesit testinde "Yapıyı bul":
  sorulan yapının kesit yüzündeki noktasına gerçek tıklama.
- `node brainlp.mjs [adres]`: düşük bellekli telefon taklidiyle (sistemler gerektiğinde yüklenir) beyin modunun lomber
  ponksiyon adımı; kas ve eklem sistemi istenmeli, iğne noktaları yüklemeden sonra yeniden hesaplanmalı.
- `node loadfail.mjs [adres]`: kas modeli engellenir, hareket sistemi moduna girilir; "… yüklenemedi" bildirimi beklenir.

Bu betikler sayfayı önce `about:blank` ile boşaltır: aynı adreste yalnız karma değişirse sayfa yenilenmez ve önceki
sınamanın durumu (engellenen dosya, taklit edilen bellek) sürer.

`cdp.mjs` küçük bir Chrome DevTools Protocol istemcisidir (Node 22+ yerleşik WebSocket). Bitince o profilin Edge
süreçlerini ve yerel sunucuyu kapat.
