# Anatomi 3D: kullanım kılavuzu

Anatomi 3D, tarayıcıda çalışan ücretsiz bir 3B insan anatomisi atlasıdır. Altı sistemdeki yapıların her biri ayrı ayrı
tıklanabilir (erkek bedeninde 3367, kadın bedeninde 3391 yapı). Üst çubuktaki ♂/♀ seçiciyle erkek ya da kadın bedeni
gösterilir. Tıklanan yapı parlar; bilgi kartında kalın başlık olarak **Latince** adı, hemen altında **Almanca** adı,
ardından Türkçe ve İngilizce adı yazar. Yapı ağacı ve arama sonuçları da Latincedir. Menüler ve düğmeler Türkçedir.

**Adres:** https://alikaankaraduman.github.io/anatomi3d-atlas/ (hesap ve kurulum gerekmez; bilgisayarda ve telefonda
tarayıcıda açılır).

| Sistem | Tıklanabilir parça (erkek / kadın bedeni) | İçerik |
|---|---|---|
| Kemik | 732 / 732 | Kemikler, kıkırdaklar, dişler, kas yapışma yerleri (origo kırmızı, insersiyo mavi) |
| Kas | 683 / 683 | Kaslar, tendon kılıfları, bursalar, fasyalar |
| Sinir | 582 / 582 | Periferik sinirler, beyin, omurilik, göz ve kulak |
| Damar | 676 / 666 | Atardamarlar, toplardamarlar, kalp |
| Organ | 281 / 315 | Sindirim, solunum, boşaltım, üreme, meme (kadın bedeninde), iç salgı bezleri, lenf düğümleri |
| Eklem | 413 / 413 | Bağlar, diskler ve menisküsler, eklem kapsülleri |

## Telefonda ve çevrimdışı

Uygulama telefonda da çalışır ve ana ekrana eklenebilir (PWA).

- **Ana ekrana ekleme**: Android'de Chrome menüsü › "Uygulamayı yükle"; iPhone'da Safari › Paylaş › "Ana Ekrana
  Ekle". Uygulama bir HTTPS adresinde yayında olmalıdır (ör. GitHub Pages).
- **Çevrimdışı**: ilk açılıştan sonra uygulama ve veriler cihazdadır; modeller kullanıldıkça ya da ⓘ › "Çevrimdışı
  kullanım" › **Hepsini indir (≈32 MB)** ile gelir. Yeni sürüm çıkınca altta "Yeni sürüm hazır · Yenile" görünür.
  "Önbelleği temizle" cihazdaki kopyayı siler; uygulama bir kez çevrimiçi açılınca yeniden çevrimdışı açılır.
  (Android uygulamasında önbellek gerekmez: her şey uygulamanın içindedir.)
- **Sistemleri gerektiğinde yükle** (Araçlar): açıkken açılışta yalnız iskelet yüklenir, öteki sistemler ilk
  gerektiğinde gelir (mod, katman, arama, konu, çalışma modu). Telefonlarda varsayılan olarak açıktır; bellek ve veri
  tasarrufu sağlar. Henüz yüklenmemiş sistemin mod düğmesi soluk görünür.
- **Dokunmatik**: tek parmak döndürür, iki parmak yakınlaştırır ve kaydırır, dokunmak seçer, çift dokunuş odaklar.
  Kısayolların karşılıkları bilgi kartındadır (Odaklan, Gizle, İzole et, Bırak, Gizlenenleri göster). Dar ekranda
  alttaki bilgi paneli tutamağına dokunarak küçültülür. Sol panel (☰ ile açılan çekmece) kaydırılır: çalışma modları,
  Deneme sınavı, Yanlışlarım ve yapı ağacı aşağıdadır. Yatay telefonda bilgi paneli sağda dar bir yan paneldir;
  telefonda arama sonuçları üst çubuğun tüm genişliğinde açılır.
- **Bağlantılar**: görünüm adres çubuğunda tutulur; bağlantıyı paylaşmak ya da bir Anki kartına koymak aynı görünümü
  açar. Biçim: `#t=<Aanki konusu>` (ör. `#t=abp-01`), `#s=<yapı kimliği>`, `#m=heart:<bölüm>` (flow, valves,
  coronary, conduction, quiz), turlar için `#m=situs|thorax|uro|head|vessels|lymph:<sekme>` (ör. `#m=situs:arteries`),
  `#m=sect:<seviye>` ya da `#m=sect:test[:bölge]` (kesit atlası), `#m=exam` (deneme sınavı), `#m=brain:<bölüm[:görünüm[:sinir]]>` (ör. `#m=brain:nerves:skull:III`), `#m=loco:<bölüm[:anahtar]>`
  (ör. `#m=loco:joints:knie`, `#m=loco:nerves:radialis`). Tanınmayan bir bağlantı bir uyarı verir ve adres ekrandaki
  görünüme göre yeniden yazılır. Deneme sınavı açıkken tarayıcının Geri tuşu alttaki görünümü değiştirmez.

## Kişisel bağlantı (sana özel not)

Uygulama, kendisine özel bir notla açılan bir bağlantıyı tanır (#g=...). Böyle bir bağlantıyı yalnız bu yayının
özel imza anahtarına sahip olan kişi oluşturabilir; uygulamada bağlantı oluşturan bir bölüm yoktur. Uygulama her
bağlantının imzasını denetler: imzasız, başka bir anahtarla imzalanmış ya da değiştirilmiş bir bağlantı açılmaz
(kısa bir "Kişisel bağlantı açılamadı." uyarısı çıkar, hiçbir şey saklanmaz).

- **Açılınca**: bağlantıyı açan kişi önce bu kartı görür. "Başla"ya basarsa not, renk ve uygulama adı onun
  cihazında saklanır (× ya da Geri ile kapatırsa hiçbir şey saklanmaz): kart ⓘ › "Sana özel not" ile yeniden açılır, oradan "Bu cihazdan kaldır" ile silinir. Cihazda
  henüz kullanıcı yoksa Kullanıcılar penceresi notun adıyla kullanıcı oluşturmayı önerir (şifreyi kişi kendisi
  belirler). Başka bir kişisel bağlantı açılırsa eskisinin yerine geçmeden önce sorulur.
- **iPhone / iPad / Mac**: ana ekrana ya da Dock'a eklenen uygulama Safari'nin kayıtlarını görmez. Eklemeyi
  bağlantıyla açılan sayfadan yap (kart bunu söyler; bağlantı yalnız Safari'de adreste kalır, öteki tarayıcılarda hemen
  adresten silinir). Not ana ekrandaki uygulamada görünmezse: ⓘ › "Kişisel bağlantın var mı?"
  alanına bağlantının tamamını yapıştır › Uygula.
- **Gizlilik**: notun metni bağlantının kendisinde (adresin # işaretinden sonrası, uygulama onu sunucuya göndermez) ve
  onu kabul eden cihazda durur. Bağlantı, gönderildiği uygulamada ve tarayıcı geçmişinde de durur; bağlantıyı alan herkes
  notu okuyabilir: bağlantıyı yalnız o kişiye gönder.

## Kullanım

| İşlem | Nasıl |
|---|---|
| Seçim modu | Üstteki **Kemik / Kas / Sinir / Damar / Organ / Eklem** düğmeleri veya `1` - `6` |
| Yapı seç | Tıklayın. `Ctrl` + tık ile birden fazla |
| Döndür / kaydır / yakınlaş | Sürükle / sağ tık ya da `Shift` + sürükle / tekerlek |
| Odaklan | `F` veya çift tık |
| Gizle / tümünü göster | `H` / `Alt+H` |
| İzole et | `I` |
| Seçimi bırak | `Esc` veya boşluğa tık |
| Ara | Üstteki arama kutusu (Türkçe, Latince, Almanca veya İngilizce; "sağ femur" gibi taraf da yazılabilir) |
| Hazır görünümler | Ön, Arka, Sağ, Sol, Üst, Tümü (üst çubukta; 1320 px'ten dar ekranda Araçlar'da) |

Her mod, ilgili sistemi görünür ve tıklanabilir yapar; gerekirse iskeleti röntgen gibi saydam gösterir.
Sol paneldeki **Katmanlar** bölümünden her sistemi ayrı ayrı *Göster / Saydam / Gizle* yapabilir, alt
katmanları (kıkırdaklar, fasyalar, kalp, lenf düğümleri, eklem kapsülleri vb.) açıp kapatabilirsiniz.
Böylece örneğin kasları ve damarları aynı anda görebilirsiniz. **Yapı ağacı** bir grubun tamamını
seçmenizi sağlar (ör. "Rotator manşet kasları"). Bilgi panelindeki *Bölüm* etiketleri de aynı işi görür.
Sol panel ekrana sığmadığında bütünüyle kaydırılır; yapı ağacı en az 300 px yüksekliktedir. Bir yapıya odaklanırken
(arama, ağaç, F) yapıyı bugünkü bakış yönünden opak bir yapı örtüyorsa kamera örtülmeyen bir yönden bakar (ör. leğen
kemiğinin arka yüzündeki Gluteus maximus origosu arkadan).

Derindeki bir yapıya ulaşmak için üstündekini seçip `H` ile (ya da bilgi kartındaki **Gizle** ile) gizleyin;
*Gizlenenleri göster* hepsini geri getirir.

**Patoloji vakaları** (Araçlar › Çalışma modları › **Patoloji**; 84 vaka): 28 periferik sinir lezyonu (17 kol,
11 bacak; Hareket modundaki her lezyon yeri için bir vaka), 5 pleksus ve kök lezyonu, 8 geçit vakası (sıkışma, fıtık,
tendon), 6 omurilik ve kauda vakası, 14 kranial sinir lezyonu (II–XII; baş-boyun görünümü, sol taraf) ve 23 beyin
vakası: arter tıkanmaları (göz vakası orbitada, Percheron ve Anton iki taraflı), beyin sapı sendromları (Weber,
Benedikt, Parinaud, INO, Dejerine) ve görme yolu (Meyer halkası); damar dışı lezyonlarda alan turuncu "Läsion". Her vaka bir klinik tablo (Almanca; Türkçesi "Türkçe" altında) ve
tek bir soruyla açılır; soru test dilinde (DE | TR) sorulur. Cevaptan sonra **3B görevi** gelir: modelde lezyon yerine
(beyin vakasında etkilenen bölgeye) tıklarsın; tek deneme, **Atla** ile geçilir. Sonra açıklama ve 3B tablo açılır:
sinir sarı, lezyon yeri kırmızı nokta, senin tıklaman yeşil (doğru) ya da mavi (yanlış), felçli kaslar mor, aynı sinirin
sağlam kalan kasları turuncu; omurilikte işlevi kesilen yollar mor; beyin vakasında tıkanan arter kırmızı, etkilenen
alan turuncu. **Tabloyu şimdi göster** cevaplamadan açar (sonuç kaydedilmez). Altta Mechanismus, Ausfälle, felçli
kaslar ya da etkilenen yapılar, modelin gösteremedikleri ve senin bu vakadaki kaydın yazar; **Hata bildir** herkese açık
GitHub deposunda hazır doldurulmuş bir hata kaydı açar (GitHub hesabı gerekir).
Üstteki sekmeler: **Vakalar** (liste; çözdüklerinde ✓ / ✗), **Tekrar** (konu başına çözülen / doğru / yanlış tablosu, **Yanlışlarımı çöz** düğmesi; aralıklı tekrar: yanlış cevaplanan vaka ertesi
gün, doğrular sırayla 3, 7, 16, 35 ve 90 gün sonra yeniden sorulur; sekmede bugün tekrar edilecek vaka sayısı) ve
**Testat** (seçtiğin konudan 10 rastgele vaka, vaka başına 90 saniye; cevaplar ve açıklamalar sonda, sonuç tablosunda
her vaka **Aç** ile açılır; son beş Testat listelenir). Sonuçlar kullanıcı profiline kaydedilir. Vakaları yapay zekâ
yazdı ve kaynaklarla denetledi; bir hekim bakmadı.

**Kas katmanı** (Araçlar › Kas katmanı; kas modunda boş bilgi kartında ve her kasın kartında da): **Üst katmanı
kaldır** dıştaki kas katmanını kaldırır, altındaki derin kaslar görünür ve tıklanabilir olur (ör. iki adımda
M. supinator, M. subscapularis, Mm. rotatores); **Geri getir** son kaldırılanı, **Hepsi** bütün katmanları geri getirir.
*Gizle / Saydam* kaldırılan kasların kaybolmasını ya da soluk bir gölge olarak kalmasını seçer (saydam kaslar,
arkalarında başka kas yoksa yine tıklanır). Bir kasın kartında kasın kaçıncı katmanda olduğu yazar; **Üstündekileri
kaldır** o kasın üstündeki bütün katmanları tek adımda kaldırır. Katmanlar modelin geometrisinden bir kez hesaplanmıştır
(her kasın yüzeyinden dışarı atılan ışınlarla "soğan soyma"; deri yoktur, bu yüzden en dıştaki kaslar 1. katmandır);
ders kitabının katman sayımıyla bire bir aynı değildir. Aramada "derin kaslar" ya da "kas katmanı" da bu araca götürür.
Çalışma modlarında ve testlerde kullanılmaz.

Kemik katmanındaki **Kas yapışmaları** alt katmanı (varsayılan kapalı) kasların başlangıç (origo, kırmızı) ve
sonlanma (insersiyo, mavi) yerlerini kemiklerin üzerinde gösterir; bir alana tıklamak kasın adını verir, kasın
adıyla arama yapınca origo ve insersiyo alanları da listelenir. Alanlar Z-Anatomy verisinden gelir; kaynakta ters
etiketlenmiş origo/insersiyolar (serratus anterior, pectoralis minor, rectus abdominis, oblikler, skalenler,
subokspital kaslar, trapezius vb.), yanlış taraflar ve birkaç yanlış kemik bu proje için ders kitaplarına göre
düzeltildi; latissimus dorsinin humerus insersiyosu kaynakta yoktur.

Sol paneldeki **Araçlar** bölümü:
- **Parçalarına ayır**: izole edilen yapıyı (izole yoksa seçim modundaki görünür yapıları) ortak merkezinden dışa
  açar. Örneğin beyni ağaçtan ya da aramadan seçip `I` ile izole edin, sonra kaydırıcıyı sürükleyin: korteks
  bölgeleri dışa açılır, derindeki çekirdekler, karıncıklar ve beyin sapı ortada kalır.
- **Kesit**: sagittal, koronal ya da aksiyal bir düzlemle görünür yapıları keser; kaydırıcı düzlemi taşır, ⇄ kesilen
  tarafı değiştirir. **Dolu** işaretliyken (varsayılan) kesilen yapıların kesit yüzü kendi renkleriyle dolu çizilir ve
  her yapının sınırı ince bir çizgiyle belirtilir (BT/MR atlasındaki gibi); kesit yüzüne tıklamak o yapıyı seçer.
  Modelde ağzı açık bırakılmış yapıların (mide, uterus, kalp odacıkları, mesane, bronşlar, damarlar) delikleri kesitte
  kapatılır, bunlar da dolu görünür; kalp odacıklarında duvar dolu, boşluk boş kalır. Başka yapıları saran tek katlı
  zarlar (kas fasyaları, eklem kapsülleri, tendon kılıfları, spinal dura) içi boş kalır; dolu çizilselerdi sardıkları
  kemiğin, tendonun ya da omuriliğin üstüne zar rengi boyanırdı.
  **Dolu** kapatılınca kesilen bütün yapıların içi (iç yüzeyler ve içindeki yapılar) görünür. Seçim tarayıcıda hatırlanır.
- **Kalp çalışma modu** (Araçlar › ♥; Aanki'deki kalp derslerinin kartında da düğmesi var): sınav için görsel tekrar.
  **Kanın yolu**: Vv. cavae'den aortaya on iki adım. Sağ kalp mavi, sol kalp kırmızı; odacıklar yarı saydam, içlerinden
  geçen akış çizgisinde kan damlaları ilerler. Her adımda yapı parlar, kısa bilgi ve akılda kalıcı bir ipucu gelir;
  "Oynat" adımları kendiliğinden ilerletir. **Kapaklar**: dört kapak ayrı renkte, göğüs iskeleti saydam; oskültasyon
  noktaları göğüs duvarında ("Anton Pulmann trinkt Milch um 22:45"), kesik çizgi kapağın gerçek yerinden dinleme
  noktasına gider. **Koronerler**: dallar ayrı renklerde, beslenme alanları ve enfarktüs yerleri. **İleti**: uyarı
  oluşturma ve iletme sistemi (Erregungsbildungs- und Erregungsleitungssystem). Modelde olmadığı için sinüs ve AV
  düğümü küçük küreler, His demeti, Tawara dalları, fasiküller ve Purkinje yelpazeleri renkli tüpler olarak saydam
  kalbin içine şematik çizilir (internodal yollar ve Bachmann demeti ince ve soluk, Koch üçgeni kesik çizgi). Bir kalp
  atımı (800 ms) yavaşlatılmış oynatılır (Yavaş yaklaşık 6 sn, Normal 3 sn): parlak uyarı yol boyunca ilerler,
  kulakçıklar sinüs düğümünden dışa, karıncıklar apeksten tabana doğru parlar, repolarizasyonda söner. Paneldeki küçük
  EKG (D II) aynı zaman ekseninden çizilir; imleç animasyonla yürür, o anki bölüm (P, PQ, QRS, ST, T) adıyla ve normal
  değeriyle gösterilir; eğriye tıklamak ya da sürüklemek animasyonu o ana getirir, listedeki bir adıma tıklamak o adıma
  atlar ve durdurur. "Sinirler" kutusu sempatik zinciri, N. vagus'u ve vagus çekirdeklerini renkli ekler (kutu kapanınca ya da moddan çıkınca sinir katmanı eski hâline döner). Sekme her açılışta oynatmaya başlar. **Test**:
  parlayan yapının adı (dört şık), adı verilen yapıyı 3B görünümde bulma ve ileti sisteminin bilgi soruları ("Bilgi");
  puan tutulur. Deneme sınavında bu sorular "Kalp" konusudur.
- **Beyin çalışma modu** (Araçlar › Beyin çalışma modu; Aanki'deki nöro derslerinin ve göz, kulak, kafatası derslerinin
  kartında da düğmesi var, ders uygun bölüm ve görünümle açılır): BOS, kranial sinirler ve beyin arterleri için görsel tekrar.
  **Kraniyal sinirleri hızlı görmek** için: Araçlar › Çalışma modları › **Kraniyal sinirler**, aramada "kraniyal sinirler" /
  "Hirnnerven" (ilk sonuç "görünüm") ya da bir kraniyal sinirin (dalının, kökünün) kartındaki **Kraniyal sinirler görünümü**
  düğmesi: bu mod Sinirler sekmesinde, Çıkış görünümünde ve o sinir seçili açılır. On iki sinir modelde vardır (sinir
  sistemi › Nervi craniales), ama normal atlasta incedirler ve opak beynin altında kalırlar; en kolay bu görünümde görülür.
  **BOS yolu**: 13 adım. Ventriküller yarı saydam mavi, plexus choroideus pembe; damlalar plexustan yan ventrikül, Foramen
  interventriculare, III. ventrikül, aquaeductus ve IV. ventrikülün içinden aperturalara, oradan subaraknoid aralıkta
  (modelde yok, şematik) sinus sagittalis superior'a ve sinüslerden V. jugularis interna'ya gider. Modelde olmayan delikler
  küçük noktalarla işaretli; ventrikül adımlarında kamera ventriküllere yaklaşır. Son adım lomber ponksiyon: L3/L4 ve
  L4/L5 iğne yerleri, geçilen bağlar, Jacoby çizgisi, konus ve kanal boyunca şematik dural kese (S2'ye kadar).
  **Sinirler**: on iki kranial sinir beyin sapı katına göre renk ailelerinde (uç ve ara beyin sarı, orta beyin yeşil, pons
  turuncu-kırmızı-mor, medulla mavi). Üç görünüm: beyinden çıkış yerleri, kafa tabanındaki delikler (kafatası saydam,
  kubbesi kesik; Lamina cribrosa'dan Foramen magnum'a on delik, etiketler hangi sinirin geçtiğini yazar) ve beyin sapındaki
  çekirdekler. Her sinirin kartında nitelik, çıkış yeri, kafatası deliği, çekirdekler, işlev, hasar belirtileri, dallar ve
  kodlamalar ("Onkel Otto orgelt …"). **Arterler**: alttan bakışta Willis halkası, arterler ayrı renklerde (modelde yanlış
  yerde duran A. communicans anterior ve ICA'ya değmeyen A. communicans posterior şematik tüple tamamlanır). Dış ve iç
  yüz görünümünde sol yarımküre ACA (yeşil), MCA (mavi) ve PCA (sarı) beslenme alanlarına göre boyalı, beyincik SCA,
  AICA ve PICA alanlarıyla. **Test**: yapının adı, yapıyı 3B görünümde bulma ve 90 bilgi sorusu (BOS, sinirler, arterler;
  konuya göre süzülebilir). Noktalar ve eğriler modelin kendi
  geometrisinden hesaplanır (her sekmenin ilk açılışında 0,2–0,8 saniye).
- **Kol hareketi modu** (Araçlar › Çalışma modları › Kol hareketi; bağlantı `#m=move:<hareket>`): sol kolun kemikleri
  eklem eksenlerinde hareket eder. Turuncu topu (dirsek) sürükle: omuz hareket eder, skapula ve klavikula eşlik eder. Mavi
  topu (el) sürükle: dirsek bükülür. Her hareketin sürgüsü ve ▶ düğmesi vardır; "Nötr duruş" Neutral-Null sıfırına, "Model
  duruşu" modelin kendi duruşuna döner. Panel açıları Neutral-Null olarak, omuzda glenohumeral ve skapula payıyla yazar;
  en çok kısalan ve uzayan kasları ve ders kitabındaki ana kasları listeler. Geometrik bir modeldir: kas boyu origo ile
  insersiyo arasındaki orta çizgiden hesaplanır, eklemi saran kaslarda yanılabilir. Kaslar kolla birlikte bükülür: kısalan turuncuya döner ve
  kalınlaşır, uzayan maviye döner. Eklemi saran bir kas, ağının bozulduğu duruşta (ör. tam abduksiyonda latissimus, tam
  dirsek fleksiyonunda anconeus) gizlenir; o an gizlenenler panelin sonunda adlarıyla yazılır. Bir kasa tıklayınca kas parlar, panelde adı, o anki boy
  değişimi ve kas kartı (Ursprung, Ansatz, Innervation, Funktion) görünür; aynı kasa yeniden tıklamak seçimi kaldırır. Bağlar ve kapsüller kol hareket edince gizlenir.
- **Gövde hareketi modu** (Araçlar › Çalışma modları › Gövde hareketi; bağlantı `#m=move:spine` ya da
  `#m=move:spine.<hareket>`, ör. `spine.cRot`): Boyun (HWS, baş eklemleri dahil), göğüs (BWS) ve bel (LWS)
  omurgası için Flexion / Extension, Lateralflexion ve Rotation sürgüleri ve ▶ düğmeleri; her bölgenin açısı hareket
  segmentlerine ders kitabı tablosuna göre dağıtılır (ör. HWS rotasyonunun yaklaşık yarısı C1/C2'de, bel rotasyonu çok az).
  Turuncu top (baş) sürüklenince boyun öne / arkaya ve yana eğilir. Kaburgalar kendi omurlarıyla, sternum, omuz kuşağı ve
  kollar göğüs kafesiyle birlikte döner; pelvis ve bacaklar sabittir. Gövde ve boyun kasları (iki yan) birlikte bükülür:
  sırt kasları (M. erector spinae, Mm. multifidi, rotatores, semispinales, interspinales, splenii, ense kasları), boyun
  kasları (M. sternocleidomastoideus, Mm. scaleni, Mm. longus colli / capitis, M. trapezius, M. levator scapulae), karın
  duvarı (M. rectus abdominis, Mm. obliqui, M. transversus abdominis, M. quadratus lumborum) ve M. psoas major. Kısalan kas
  turuncuya, uzayan maviye döner. Panel açıları Neutral-Null olarak yazar, en çok kısalan ve uzayan kasları (yanıyla) ve
  seçilen hareketin ders kitabındaki ana kaslarını listeler; her ana kasın modelde de kısalıp kısalmadığı yazılır
  (gleiche Seite: sağa harekette sağdaki kas, Gegenseite: soldaki). Bir kasa tıklayınca adı, boy değişimi ve kas kartı
  görünür. Ağı bozulan bir kas o duruşta gizlenir ve adı panelde yazılır (ders kitabı sınırlarındaki hareketlerde hiçbiri;
  yalnız çok uç birleşik bir boyun duruşunda M. trapezius'un inen parçası). Geometrik bir modeldir: kaslar en yakın omura
  göre bükülür, boy orta çizgiden (çok parçalı kaslarda lif çizgilerinden) okunur. Diskler ve uzun bağlar bükülmez,
  omurlar farklı hareket ettiği sürece gizlenir.
- **Hareket sistemi modu** (Araçlar › Hareket sistemi modu; BWA ve eklem derslerinin Aanki kartında ve her kasın bilgi
  kartında da düğmesi var): kol ve bacak için görsel tekrar; sol kol ya da sol bacak gösterilir. **Sinir**: 19 periferik
  sinir (N. radialis, medianus, ulnaris, femoralis, ischiadicus, fibularis …). Sinir sarı, innerve ettiği kaslar kırmızı,
  bölgenin öteki kasları saydam. Lezyon yeri seçilince (ör. Sulcus n. radialis) o yerden sonra dalını alan kaslar gri
  olur ve klinik tablo çıkar (Fallhand, Krallenhand, Schwurhand, Steppergang …): nedenleri, sağlam kalanlar, muayene
  bulguları. **Geçit**: 24 topografik geçit (Skalenuslücken, Achsellücken, Karpaltunnel, Guyon-Loge, Leistenkanal, Lacuna
  vasorum ve musculorum, Foramen supra- ve infrapiriforme, Fossa poplitea, Malleolenkanal …): sınırlar ayrı renklerde
  saydam, içinden geçenler türüne göre renkli (sinir sarı, arter kırmızı, ven mavi, tendon ten rengi), sıraları ve
  kodlamalarıyla. **Kas**: 246 kasın kartı (Ursprung, Ansatz, Innervation, Funktion, Kennmuskel): seçili kas opak,
  grubundaki öteki kaslar saydam; origo (kırmızı) ve insersiyo (mavi) yamaları ve siniri görünür. "Kendini sına" satırları
  gizler, tek tek açılır. Aynı kart atlasın her yerinde kasın bilgi kartında da çıkar. **Eklem**: dokuz eklem (omuz, dirsek,
  el, kalça, diz, ayak bileği, omurga, ayak kemerleri, ISG): kemikler saydam, bağlar ayrı renklerde ve numaralı; bir
  hareket seçilince ana kasları eklenir. **Test**: yapının adı, yapıyı 3B görünümde bulma (yalnız dışarıdan görünen
  kaslar sorulur), bilgi soruları (169 hazır soru ve kas kartlarından üretilen innervasyon soruları; konuya göre
  süzülebilir).
- **Situs çalışma modu** (Araçlar › Situs çalışma modu; GIT bloğunun Abdominalsitus, Gefäßversorgung Ober- ve Unterbauch,
  Leber & Gallenblase, Pankreas, Darm derslerinin Aanki kartında da düğmesi var): karın için görsel tekrar. Dört sekme:
  **Karın arterleri**, **Portal sistem**, **Periton ilişkileri**, **Karaciğer** (segmentler, safra yolları, pankreas) ve
  **Test**. Her grubun kendi rengi var; lejantta bir gruba tıklamak yalnız onu opak bırakır (öteki gruplar saydam).
  Yapılar listeden ya da 3B görünümde tıklanarak seçilir: parlar, metni (seviye, çıkışı, ipucu, klinik) ve etiketi öne
  çıkar. Çevredeki organlar saydam bağlamdır; tıklanınca adı "Tıklanan yapı" altında görünür. Ek bilgiler, klinik ve
  modelde olmayanlar açılır listelerdedir. Test: sahne seçilir (her içerik sekmesi bir sahne), "Bu yapı ne?", "Yapıyı
  bul" ve bilgi soruları. Bağlantı: `#m=situs:arteries:ams` gibi.
- **Öteki çalışma turları**, Situs ile aynı düzende (Araçlar › Çalışma modları; ilgili Aanki derslerinin kartında da
  düğmesi var):
  - **Göğüs** (`#m=thorax:<sekme>`): Gırtlak (arkadan), Akciğer ve bronş ağacı, Solunum aygıtı (diyafram, solunum kasları,
    plevra, göğüs duvarının damar ve sinirleri), Mediasten.
  - **Ürogenital** (`#m=uro:<sekme>`): Böbrek ve idrar yolları, Erkek üreme (erkek beden), Kadın üreme ve meme (kadın
    beden), Pelvis (taban, duvar, damarlar, sinirler). Erkek ve kadın sekmesi açılınca beden kendiliğinden değişir.
  - **Baş-boyun** (`#m=head:<sekme>`): Orbita, Kulak ve N. facialis (yalnız sol taraf, yandan), Ağız-yutak (yandan),
    Boyun.
  - **Damarlar** (Ekstremite damarları, `#m=vessels:<sekme>`): Kol arterleri, Kol venleri (aksiller lenf düğümleriyle),
    Bacak arterleri, Bacak venleri (kasık ve bacak lenf düğümleriyle). Yalnız sol kol ya da bacak gösterilir; kamera
    uzvun tamamını omuzdan ya da kalçadan parmaklara kadar alır.
  - **Lenf** (Lenf sistemi, `#m=lymph:<sekme>`): Lenf organları (timus, dalak, tonsiller, büyük venler ve lenf gövdeleri),
    Baş-boyun (yalnız sol taraf, yandan), Gövde (göğüs ve karın), Pelvis-bacak lenf düğümü grupları (kamera pelvis ve
    kasığa; diz ve baldırdaki düğümler seçilince kamera onlara döner).
  Lenf düğümleri küçük parçalardır: hiçbir zaman saydamlaşmaz, etiketleri düğümün üstüne değil yanına (ince bir çizgiyle)
  konur, opak bir damarın ya da bağın ardında kalan düğüm soluk bir "röntgen" silueti olarak görünür ve o noktaya tıklamak
  düğümü seçer. Ekranda birkaç piksel kalan küçük bir düğüm, tıklama 8 px yakınına düşerse de seçilir.
  Damar gruplarının rengi alışılmış kurala uyar: arterler kırmızıdan başlar ve mavi almaz, venler maviden başlar ve kırmızı
  almaz. Etiketlere (ve kalabalık sekmelerdeki renkli noktalara) tıklamak maddeyi seçer. Venlerde ve lenf yapılarında
  kartta "Drenajı" (akıntının gittiği yer), arterlerde "Çıkışı" yazar. Esc önce seçili maddeyi bırakır, ikinci Esc moddan
  çıkar.
  Başka yapıları örten büyük yapılar (akciğer lobları, göğüs ve karın duvarı kasları, orbita kemikleri) renkli ama yarı
  saydam çizilir, seçilince belirginleşir ama içi görünür kalır; ince damar ve sinirler hiçbir zaman saydamlaşmaz. Bir
  grubun maddeleri grup renginin açık-koyu tonlarıdır (karaciğer segmentleri ayrılır). Eşli yapıların etiketi tek
  taraftadır; kesit açıkken kesilen yandaki etiketler gizlenir. Listeden ekran dışında kalan bir yapı seçilince kamera
  ona döner. Test o anki sekmenin sahnesiyle açılır; "Yapıyı bul" başka bir organın içine gömülü yapıları (böbrek içi
  damarlar) sormaz.
  **Çalışma modları** bloğu Araçlar'da bütün modları iki sütunlu kısa düğmelerle toplar (Kalp, Beyin, Hareket, Situs,
  Göğüs, Ürogenital, Baş-boyun, Damarlar, Lenf, Kesit atlası; tam ad düğmenin ipucunda).

- **Kesit atlası** (Araçlar › Çalışma modları; Schnittbildtrainer, nöro görüntüleme ve IPO "Bildgebende Verfahren"
  derslerinin Aanki kartında da düğmesi var): uygulamanın kesit aracını bir BT / MR atlası gibi kullanır. Beş bölgede 29
  kanonik kesit seviyesi: baş-boyun 8 (median sagittal ve koronal kesit dahil), göğüs 5, karın 5, pelvis 3 (her beden için
  ayrı), ekstremite 5 (sol taraf). Aksiyal kesitler aşağıdan görülür (ekranda ventral yukarıda, bedenin solu sağda),
  sagittal kesit bedenin solundan, koronal kesit önden. Bütün sistemler opak ve "Dolu" kesitle çizilir; uzuv seviyeleri
  yalnız o uzvu gösterir. **Atlas** sekmesi: bölge düğmeleri, seviye listesi, **Önceki / Sonraki** (BT yığınında kaydırır
  gibi), seviyenin giriş metni ve tanınacak yapılar. Kesit yüzündeki etiketler Latince (seçilenin altında Almanca); dar
  ekranda numaradır. **Etiketler** düğmesi kendini sınamak için gizler, **Kesite bak** kamerayı kesite dik getirir.
  Bir yapı listeden, etiketinden ya da kesit yüzüne tıklanarak seçilir: kesit yüzü vurgulanır, tanıma metni ve ipucu
  görünür; başka bir kesit yüzüne tıklamak "Tıklanan yapı" altında adını gösterir. **Kesiti kaydır** düzlemi seviyeden
  3 cm'ye kadar oynatır (etiketler o sırada gizli; **Seviyeye dön**). **Test** sekmesi: bölge (Tümü ya da bir bölge) ve dört
  soru türü: **Yapıyı bul** (adı verilen yapıyı kesit yüzünde tıkla), **Bu ne?** (kesit yüzünde atan halkadaki yapının adı,
  dört şık), **Hangi seviye?** (başlıksız gösterilen kesitin seviyesi, dört şık), **Bilgi** (seviyenin bilgi soruları; cevaptan
  sonra ilgili yapılar parlar). Her soruda seviye değişebilir; cevaptan sonra açıklama, doğru yapı vurgulu ve etiketli,
  **Sonraki soru**. Pelvis sorularında beden değişirse o bedenin seviyelerinden yeni soru gelir. Moddan çıkınca kesit
  ayarların, katmanların ve parçalarına ayırma oranın geri gelir. Bağlantı: `#m=sect:thx-heart` (seviye),
  `#m=sect:test` ya da `#m=sect:test:pelvis`. Telefonda alt panel açıkken kesit üstte görünür kalır, etiketler numaraya
  döner ve yeni soruda panel soruya kayar. Cinsiyetsiz seviyeler iki bedende de gösterilir; kadın bedeninde kesiti olmayan
  yapı (L4'te Crista iliaca) orada sorulmaz. Sol paneldeki **Çevir** ya da eksen ve kaydırıcı düzlemi seviyeden çıkarır
  (etiketler gizlenir, **Seviyeye dön**); **Dolu** yalnız dolu yüzü açar kapar. Arama ya da ağaçtan bir yapı seçmek modu
  bitirir ve katman ayarların hemen geri gelir. Genel **Yanlışlarım** kesit testinin yanlışlarını da sayar: yanlış yapı
  yoksa ya da yapı tekrarı açıkken bir daha basınca kesit testi "Yanlışlarım" açık başlar.

**Aanki görünümü**: Yapı ağacının üstündeki **Aanki** düğmesi ağacı, Fachschaft Medizin Aachen'in Anki destesi Aanki'nin
düzenine çevirir: ÄBP öğrenme planının anatomi günleri ve 2.–7. dönemlerin anatomi dersleri (127 konu, Aanki wiki'si ve
"Aanki Arbeitsübersicht" tablosundan). Bir konuya tıklamak konunun yapılarını izole eder. Kalp, organ ve beyin
konularında göğüs kafesi gibi kemikler saydam başlar; zarlar, fasyalar ve eklem kapsülleri (konunun kendisi değilse)
saydam bağlam olarak görünür. Katmanlar paneli izole görünümde de çalışır; konudan çıkınca önceki katman ayarları geri
gelir. Konu kartında dersin yeri, tablodaki kart sayısı ve Anki'deki etiket yolu (yaklaşık) yazar; bir yapının kartında o
yapının geçtiği konular listelenir. Konular aramada da çıkar ("Kehlkopf", "Tag 34"). Konu kartındaki **Test** düğmesi o
konunun görünen yapılarıyla test açar: parlayan yapının adını dört şıktan seç ya da adı verilen yapıyı 3B görünümde bul;
puan tutulur, "Konuya dön" karta döner. Eşleştirme ders ve gün başlıklarına
göre yapıldı: destenin kartları okunmadı, tabloda henüz boş olan başlıklar (3. dönemin hareket sistemi dersleri) genel
bırakıldı. Anatomi 3D resmî bir uygulama değildir; Aanki, Fachschaft Medizin Aachen ve RWTH Aachen ile
bağlantısı yoktur.

**Test dili (Almanca / Türkçe)**: Testler varsayılan olarak Almancadır (Fachschaft'ın Almanca Anki destesindeki gibi):
bilgi soruları, şıklar, açıklamalar, kesit testinde cevaptan sonraki kısa metinler ve test panellerinin ve deneme sınavının
bütün yazıları (düğmeler, sonuçlar, sayaçlar, konu ve kategori adları). Puan satırındaki ve sınav penceresinin başlığındaki
**DE | TR** düğmesi Türkçeye (ve geri) geçirir; seçim kullanıcı başına saklanır. Dil sorunun ortasında değişebilir: aynı
soru, şıklar ekrandaki aynı sırada, verilen cevap, puan, süre ve kamera olduğu gibi kalır. İlerleme iki dilde ortaktır
("Gewusst" ile "Bilinen" aynı sayıdır). Almancası olmayan bir soru Türkçe gösterilir. Testlerin dışı (menüler, mod
sekmeleri, çalışma metinleri) Türkçe kalır. Almanca metinler yapay zekâ çevirisidir ve yapay zekâ denetçileriyle
kontrol edilmiştir, bir anatomi uzmanı tarafından değil.

**İlerleme ve Yanlışlarım**: Bütün testler (kalp, beyin, hareket sistemi, altı tur, kesit testi, Aanki konu testi ve deneme
sınavı) her sorunun sonucunu bu tarayıcıda saklar; sayfa yenilenince kaybolmaz. Aynı yapı bütün testlerde tek kayıttır. Yanlış cevaplanan soru, iki kez
arka arkaya doğru bilinene kadar "yanlış" sayılır. Testlerde puanın yanında o soru havuzundaki ilerleme yazar ("Bilinen X /
Y · yanlış Z"); **Yanlışlarım (N)** düğmesi soruları yalnız yanlışlara indirir. Normal sırada yanlışlar ve hiç sorulmamış
sorular daha sık gelir. Her konu testi bütün sorularla başlar. Aanki ağacında konu satırının arkasındaki yeşil dolgu ve
konu kartındaki "Bilinen X / Y" konu testinin sorduğu yapılardan bilinenleri gösterir (saydam gösterilen kılıflar ve
kemikler sayılmaz). Araçlar'daki **Yanlışlarım (N)** düğmesi, seçili bedende bulunan yanlış yapıları sayar, onları izole
eder ve onlarla test açar; gereken sistem henüz yükleniyorsa yüklenince açılır. Birden çok parçadan oluşan bir yapı (ör. bir
kalp kapağı, bir kas, bir kafa çifti siniri) kalp, beyin ve hareket sistemi testlerinde ilk parçasıyla kaydedilir; bu
tekrarda o parça kendi adıyla sorulur. **İlerlemeyi sıfırla** iki tıklama ister. Açık test panelleri sıfırlamadan ve başka
sekmedeki değişikliklerden sonra kendini günceller; iki sekmede aynı anda çözülen sorular birbirini silmez. Özel pencerede
ilerleme yalnızca o oturum için tutulur. Kesit testi de aynı depoya yazar (yapı, seviye ve bilgi soruları); Araçlar'daki
**Yanlışlarım (N)** sayısı kesit testinin yanlışlarını da içerir. Yalnız kesit testinde yanlış varsa düğme kesit testini
"Yanlışlarım" açık başlatır; ikisi de varsa yapı tekrarı açılır ve kesit yanlışları bir notla hatırlatılır.

**Kullanıcılar** (sol panelin / telefon çekmecesinin en üstündeki "Kullanıcı: Misafir" düğmesi): aynı cihazı paylaşanlar
için ad ve şifreli profiller. Her profilin kendi test ilerlemesi, Yanlışlarım'ı, Aanki ağacındaki dolulukları, deneme sınavı
ayarları ve geçmişi vardır; beden ve ekran ayarları ortaktır. Kimse giriş yapmamışsa uygulama **Misafir** olarak eskisi gibi
çalışır. İlk kullanıcı oluşturulurken bu cihazdaki misafir ilerlemesi ona aktarılabilir. Profil "Çıkış yap"a kadar açık
kalır; "Açılışta şifre sor" her açılışta şifre ister. Cihazda kullanıcı varken kimse açık değilse açılışta liste ve
"Misafir olarak devam et" çıkar. Pencerede ayrıca Şifreyi değiştir, Dışa aktar (JSON dosyası; uygulama sürümünde
kopyalanacak metin; şifre bilgisi içermez), İçe aktar (yeni profil olarak ya da açık profille birleştirerek: her soruda daha
çok cevaplanmış kayıt kalır, sınav geçmişleri tekrarsız birleşir) ve Kullanıcıyı sil var. **Önemli:** profiller yalnız
oluşturuldukları cihazdadır, sunucu yoktur. Şifre bu cihazdaki profilleri birbirinden ayırır; veriler şifrelenmez ve hiçbir
yere gönderilmez. 5 yanlış denemeden sonra 30 sn beklenir. Unutulan şifre kurtarılamaz: profil, adı yazılarak silinir.
Uygulamayla hiçbir kullanıcı gelmez. **İlerlemeyi sıfırla** yalnız açık kullanıcının (ya da Misafir'in) ilerlemesini siler.

**Deneme sınavı** (Araçlar'da "Deneme sınavı" düğmesi ya da `#m=exam` bağlantısı): bütün çalışma modlarının bilgi
sorularından (beyin, hareket sistemi, kaslar, kalp, Situs, göğüs, ürogenital, baş-boyun, ekstremite damarları, lenf sistemi, kesit
anatomisi ve topografik patoloji; 12 konu; patoloji konusunda her soru vakanın klinik tablosu ve sorusudur, 75 soru)
karışık, süreli bir test. Başlarken konuları seç (hepsi seçili gelir; "Tümü / Hiçbiri"), soru sayısını (10, 20, 40, 60),
soru başına süreyi (süresiz, 45, 60, 90 sn; tek toplam geri sayım), soru kaynağını (tüm sorular ya da yalnız yanlışların ve
hiç sorulmamış sorular, önce yanlışlar) ve modu seç: **Sınav** modunda sonuçlar sonda gösterilir ve cevap bitene kadar
değiştirilebilir; **Çalışma** modunda her cevaptan sonra doğrusu ve açıklaması çıkar. Sorular konulara büyüklükleriyle
orantılı dağıtılır (her konudan en az bir soru), tekrar etmez ve karışık sırada gelir. Sınav sırasında: 1-4 ya da A-D cevap,
Enter sonraki soru (bir düğme odaktaysa Enter o düğmeye basar), ← → gezinme, "İşaretle" sonra bakmak için, alttaki soru haritası (telefonda açılır kapanır) cevaplı ve
işaretli soruları gösterir; "Bitir" boş soru varsa onay ister, Esc çıkmadan önce sorar (odak "Devam et"te
olur; Enter sınavı silmez). Sayfa yenilenir ya da telefon sekmeyi kapatıp yeniden açarsa başlangıç ekranında "Yarım kalan
sınav" satırı çıkar: **Devam et** cevaplarla ve işaretlerle kalınan yerden sürdürür (süre bu arada da işler), **Sil** atar. Süre bitince sınav biter (ekran kilitliyken dolduysa geri dönünce; süre dolduktan sonra cevap alınmaz), boş
sorular yanlış sayılır; son dakikada sayaç kırmızıdır. Sonuç ekranında puan, süre, konu (ve alt konu) başına doğru sayısı ve
soruların listesi (Yanlışlar / İşaretliler / Tümü; verdiğin cevap, doğrusu, açıklama) var. **3B'de göster** sorunun
yapılarını 3B görünümde izole edip seçer (sonuca üstteki "Sonuca dön" ile listede kalınan yere dönülür; yatay telefonda alt
panel küçülür); **Yanlışları tekrar çöz** yanlış ve boş
sorulardan yeni bir sınav açar. Cevaplar çalışma modlarındaki testlerle aynı ilerleme kaydına yazılır (boş sorular hariç),
yani Test sekmelerindeki ve Araçlar'daki Yanlışlarım sayıları değişir. Araçlar'daki Yanlışlarım sayısı yalnız deneme sınavının
sorabileceği bilgi sorularını sayar (hareket sistemi testinin kas-sinir soruları kendi Test sekmesinde tekrar edilir); düğme
yalnız bilgi sorusu yanlışları kaldığında deneme sınavını "yalnız yanlışlarım" seçili açar (bu seçim yalnız o açılış içindir,
kayıtlı ayarı değiştirmez). Son ayarlar ve son 20 sınav (tarih, konular, puan, süre) bu
tarayıcıda, açık kullanıcının profilinde saklanır, başlangıç ekranında "Son sınavlar" altında eğilimle görünür. Sınav açıkken altındaki görünüm ve açık
çalışma modu olduğu gibi kalır. Soru dosyaları yalnız sınav açılınca indirilir ve çevrimdışı önbellekte de bulunur.

## Metinler, kaynaklar ve uyarı

Türkçe ve Almanca adlar, Latince düzeltmeler, çalışma modlarının metinleri, kas kartları, test ve deneme sınavı soruları
ve Aanki eşleştirmeleri bu uygulama için **yapay zekâ ile yazılmış ve yapay zekâ denetçileriyle kontrol edilmiştir**.
Bir anatomi uzmanı tarafından gözden geçirilmemiştir; hata olabilir. Şüphede ders kitabınız ve hocanız esastır.

Modellerin kaynakları ve lisansları uygulamadaki ⓘ penceresinde, yayınla gelen `lisanslar.txt` dosyasında ve
[NOTICE.md](../NOTICE.md) dosyasında yazar. Bazı parçalar (iç kulak, böbrek, klitoris ve vestibül bulbusları) yalnız
ticari olmayan amaçla kullanılabilir.

**Gizlilik:** uygulama hesap istemez, reklam, çerez ve izleme içermez, kişisel veri toplamaz. Ayarlar, test ilerlemesi,
kullanıcı profilleri ve indirilen modeller yalnız bu cihazda saklanır.

**Tıbbi uyarı:** Anatomi 3D yalnızca öğrenme ve tekrar içindir. Tıbbi tanı, tedavi, girişim planlaması ya da hasta
bakımı için kullanılamaz. Modeller tek bir erkek bedenine dayanır (kadın yapıları ayrı kaynaklardan uyarlanmıştır);
bireysel farklılıkları göstermez, bazı yapılar şematiktir ya da eksiktir.
