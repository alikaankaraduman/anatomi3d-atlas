// Test dili: testlerde (çalışma modlarının Test sekmeleri, Aanki konu testi, genel "Yanlışlarım" tekrarı, kesit testi,
// deneme sınavı) görünen her şeyin dili. Kullanıcı Almanca okuduğu (RWTH Aachen, Fachschaft'ın Almanca Anki destesi) için
// varsayılan Almanca; test panelindeki ve sınav penceresindeki "DE | TR" düğmesi Türkçeye döndürür. Testlerin dışı
// (menüler, mod sekmeleri, çalışma metinleri, Hakkında) Türkçe kalır.
//  - Seçim kullanıcı başınadır (users.js ukey('anatomi3d.testLang.v1')); depolama yoksa yalnız bellekte.
//  - T(anahtar, ...değerler): test arayüzünün metinleri, iki dilde tek tabloda ({0}, {1}: değerler; değerler HTML olarak
//    eklenir, veri metni veren çağıran esc() uygular).
//  - Almanca bilgi soruları ve kısa metinler public/data/quiz-de.json içindedir (biçim: tools/quiz-de.mjs). Dosya bir kez,
//    ilk gerektiğinde indirilir (göreli adres: alt yolda ve uygulama kabuğunda çalışır); indirilemezse Türkçe metinler
//    gösterilir ve en erken RETRY_MS sonra bir sonraki çağrıda yeniden denenir (döngü yok).
//  - factText(f) / shortText(tr): o anki dilde metin; Almancası yoksa ya da geçersizse o soru Türkçe kalır. Şıkların
//    sırası iki dilde aynıdır: kaydedilmiş cevap indisleri dil değişince de geçerlidir.
//  - İlerleme kimliği hiç değişmez: record(factId(f.q)) her zaman Türkçe metinle (progress.js).
// İçe aktarılırken DOM'a dokunmaz (Node testleri: tools/_qawork/testlang-test.mjs).
import { ukey } from './users.js';
import { factId } from './progress.js';

export const LANGS = ['de', 'tr'];
export const DEFAULT_LANG = 'de';
const KEY = ukey('anatomi3d.testLang.v1');
const DE_URL = 'data/quiz-de.json';
const RETRY_MS = 30000;

let lang = DEFAULT_LANG;
try { const v = localStorage.getItem(KEY); if (LANGS.includes(v)) lang = v; } catch { /* depolama yok: varsayılan */ }

const listeners = new Set();
function emit() { for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } } }
export const getLang = () => lang;
export const isDe = () => lang === 'de';
export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* yalnız bu oturum */ }
  if (l === 'de') loadDe();
  emit();
}
// dil değişince ya da Almanca dosya gelince çağrılır; dönen işlev kaydı kaldırır
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- arayüz metinleri ----------
// Her anahtar iki dilde de vardır (testlang-test.mjs denetler). Değer metin ({0} yer tutucu) ya da işlev olabilir.
const STR = {
  de: {
    'lang.title': 'Testsprache: Deutsch oder Türkisch',
    'lang.de': 'Deutsch', 'lang.tr': 'Türkisch',
    'mode.name': 'Was ist das?', 'mode.find': 'Struktur finden', 'mode.facts': 'Wissen',
    'q.name': 'Welche Struktur leuchtet?',
    'q.find': 'Klicke diese Struktur in der 3D-Ansicht an:',
    'res.ok': 'Richtig!',
    'res.bad': 'Falsch; die richtige Antwort ist grün.',
    'res.badFind': 'Falsch: {0}. Die richtige Struktur leuchtet jetzt.',
    'all': 'Alle',
    'next': 'Nächste Frage ▶', 'skip': 'Überspringen',
    'focus': 'Zur Struktur', 'focus.title': 'Kamera auf die gefragte Struktur richten',
    'noQ.view': 'In dieser Ansicht gibt es keine Fragen.',
    'weak.btn': 'Meine Fehler ({0})',
    'weak.on': 'Zurück zu allen Fragen',
    'weak.off': 'Nur Fragen, die du falsch beantwortet und seitdem noch nicht zweimal in Folge richtig beantwortet hast',
    'prog': 'Gewusst {0} / {1} · falsch {2}',
    'prog.title': 'In diesem Browser gespeicherter Fortschritt: gewusste und zu wiederholende Fragen dieses Fragenpools',
    'score': 'Richtig {0} / {1}',
    'weak.empty': 'Hier gibt es keine Fehler zu wiederholen, super! Schalte „Meine Fehler“ aus, um zu allen Fragen zurückzukehren.',
    // Aanki konu testi ve genel tekrar
    'quiz.few': 'In dieser Ansicht gibt es nicht genug Strukturen für Fragen (Strukturen von Systemen, die unter „Katmanlar“ ausgeblendet sind, werden nicht gefragt).',
    'quiz.review': 'Wiederholung', 'quiz.count': n => `${n} ${n === 1 ? 'Struktur' : 'Strukturen'}`,
    'quiz.back': 'Zurück zum Thema', 'quiz.back.title': 'Zurück zur Themenkarte',
    'quiz.exit': 'Test beenden', 'quiz.exit.title': 'Isolierte Ansicht verlassen (Esc)',
    'review.title': 'Meine Fehler', 'review.place': 'Strukturen, die du in Tests falsch beantwortet hast',
    'sys.bone': 'Skelettsystem', 'sys.muscle': 'Muskelsystem', 'sys.nerve': 'Nervensystem', 'sys.vessel': 'Kreislaufsystem', 'sys.organ': 'Innere Organe', 'sys.joint': 'Gelenke und Bänder',
    // kategoriler ve bölgeler
    'cat.csf': 'Liquor', 'cat.cn': 'Hirnnerven', 'cat.art': 'Arterien',
    'cat.nerve': 'Nerven', 'cat.passage': 'Durchtrittsstellen', 'cat.joint': 'Gelenke', 'cat.muscle': 'Muskeln',
    'reg.arm': 'Arm', 'reg.leg': 'Bein', 'reg.other': 'Rumpf, Kopf',
    // kesit testi
    'sx.find': 'Struktur finden', 'sx.name': 'Was ist das?', 'sx.level': 'Welche Höhe?', 'sx.facts': 'Wissen',
    'sx.noQ': 'In dieser Auswahl gibt es keine Fragen.',
    'sx.level.k': 'Schnittebene',
    'sx.q.find': 'Klicke diese Struktur auf der Schnittfläche an:',
    'sx.badFind': 'Falsch: {0}. Die richtige Struktur ist jetzt hervorgehoben.',
    'sx.q.name': 'Welche Struktur ist im Schnitt mit dem Ring markiert?',
    'sx.q.level': 'Auf welcher Höhe liegt dieser Schnitt?',
    'sx.allRegions': 'Alle Regionen',
    'sx.view': 'Zum Schnitt', 'sx.view.title': 'Kamera senkrecht auf den Schnitt richten und die Ebene einpassen',
    'sx.back': 'Ebene zurücksetzen', 'sx.back.title': 'Schnittebene an ihre Höhe zurücksetzen',
    'sx.clickHint': 'Klickst du auf die Schnittfläche, erscheint der Name der Struktur.',
    'sx.picked': 'Angeklickte Struktur',
    'sx.offLevel': 'Bring die Schnittebene zuerst auf ihre Höhe zurück',
    'sx.clickCap': 'Klicke auf eine Struktur der Schnittfläche',
    'sreg.head': 'Kopf und Hals', 'sreg.thorax': 'Thorax', 'sreg.abdomen': 'Abdomen', 'sreg.pelvis': 'Becken', 'sreg.limbs': 'Extremitäten',
    // deneme sınavı
    'ex.title': 'Probeklausur', 'ex.close': 'Schließen', 'ex.closeEsc': 'Schließen (Esc)',
    'ex.loading': 'Fragenpools werden geladen…',
    'ex.intro': 'Ein gemischter Test mit Zeitlimit aus den Wissensfragen aller Lernmodi. Die Antworten fließen in „Meine Fehler“ ein.',
    'ex.resume': 'Unterbrochene Klausur: {0} / {1} beantwortet', 'ex.resumeLeft': ', Restzeit {0}',
    'ex.continue': 'Fortsetzen', 'ex.discard': 'Verwerfen',
    'ex.failed': 'Konnte nicht geladen werden: {0}. Du kannst die Klausur mit den übrigen Themen schreiben; beim nächsten Öffnen wird es erneut versucht.',
    'ex.subjects': 'Themen', 'ex.none': 'Keine',
    'ex.count': 'Anzahl der Fragen', 'ex.countAvail': n => `(in der Auswahl gibt es ${n} ${n === 1 ? 'Frage' : 'Fragen'})`,
    'ex.time': 'Zeit pro Frage', 'ex.timeNote': '(ein gemeinsamer Countdown)',
    'ex.untimed': 'Ohne Zeitlimit', 'ex.sec': '{0} s',
    'ex.questions': 'Fragen', 'ex.src.all': 'Alle Fragen', 'ex.src.weak': 'Nur meine Fehler und neue Fragen',
    'ex.note.weak': (a, b) => `In den gewählten Themen: ${a} Fehler und ${b} ${b === 1 ? 'neue Frage' : 'neue Fragen'}; die Fehler kommen zuerst.`,
    'ex.note.all': n => `In den gewählten Themen: ${n} ${n === 1 ? 'Frage' : 'Fragen'}.`,
    'ex.mode': 'Modus', 'ex.m.exam': 'Prüfung', 'ex.m.study': 'Lernen',
    'ex.note.exam': 'Die Ergebnisse siehst du am Ende; bis zur Abgabe kannst du deine Antworten ändern.',
    'ex.note.study': 'Nach jeder Antwort siehst du die Lösung und die Erklärung; die Antwort lässt sich nicht mehr ändern.',
    'ex.sum': (n, t) => `${n} ${n === 1 ? 'Frage' : 'Fragen'} · ${t}`, 'ex.sumUntimed': 'ohne Zeitlimit', 'ex.sumNone': 'Keine Fragen in der Auswahl',
    'ex.lastResult': 'Letztes Ergebnis', 'ex.start': 'Starten',
    'ex.hist': 'Letzte Klausuren', 'ex.trend': '{0} Prozentpunkte (Schnitt der bisherigen Klausuren: {1} %)', 'ex.nSubj': '{0} Themen',
    'ex.q': 'Frage', 'ex.qn': 'Frage {0}', 'ex.answered': 'beantwortet', 'ex.flagged': 'markiert',
    'ex.confirmFinish': (n, fl = '') => `${n} ${n === 1 ? 'Frage' : 'Fragen'} offen${fl}. Offene Fragen zählen als falsch. Trotzdem abgeben?`,
    'ex.confirmFlag': ', {0} markiert',
    'ex.finish': 'Abgeben', 'ex.finish.title': 'Klausur abgeben', 'ex.keepOn': 'Weitermachen',
    'ex.confirmLeave': 'Klausur verlassen? {0} kein Ergebnis.',
    'ex.leaveStudy': 'Deine Antworten sind gespeichert; es entsteht', 'ex.leaveExam': 'Deine Antworten werden nicht gespeichert; es entsteht',
    'ex.leave': 'Verlassen', 'ex.leave.title': 'Klausur verlassen (Esc)',
    'ex.timeLeft': 'Restzeit', 'ex.untimedShort': 'ohne Limit',
    'ex.prev': '◀ Zurück', 'ex.next': 'Weiter ▶', 'ex.flag': '⚑ Markieren', 'ex.flag.title': 'Zum späteren Nachsehen markieren',
    'ex.flagmark': '⚑ markiert',
    'ex.map': 'Fragenübersicht · {0}/{1} beantwortet', 'ex.mapFlag': ' · {0} markiert',
    'ex.keys': 'Tastatur: 1-4 / A-D Antwort · Enter weiter · ← → blättern · Esc verlassen',
    'ex.pct': '{0} %',
    'ex.result': 'Ergebnis', 'ex.dur': 'Zeit {0}', 'ex.modeName': 'Modus {0}', 'ex.timeout': 'Zeit abgelaufen', 'ex.empty': '{0} offen',
    'ex.f.wrong': 'Falsche ({0})', 'ex.f.flag': 'Markierte ({0})', 'ex.f.all': 'Alle ({0})',
    'ex.st.ok': 'Richtig', 'ex.st.bad': 'Falsch', 'ex.st.skip': 'Offen',
    'ex.given': 'Deine Antwort: {0}', 'ex.givenNone': 'keine', 'ex.right': 'Richtige Antwort: {0}',
    'ex.show': 'In 3D zeigen', 'ex.show.title': 'Die Strukturen der Frage in der 3D-Ansicht auswählen und zeigen',
    'ex.noWrong': 'Keine falschen oder offenen Fragen, Glückwunsch!', 'ex.noFlag': 'Du hast keine Frage markiert.',
    'ex.retry': 'Fehler wiederholen', 'ex.retry.title': 'Neue Klausur aus den falschen und offenen Fragen', 'ex.new': 'Neue Klausur',
    'ex.back': 'Zurück zum Ergebnis',
    'subj.brain': 'Gehirn und Nervensystem', 'subj.loco': 'Bewegungsapparat', 'subj.muscles': 'Muskeln', 'subj.heart': 'Herz',
    'subj.situs': 'Bauchsitus', 'subj.thorax': 'Thorax und Atmung', 'subj.uro': 'Urogenitalsystem und Becken', 'subj.head': 'Kopf und Hals',
    'subj.vessels': 'Gefäße der Extremitäten', 'subj.lymph': 'Lymphsystem', 'subj.sect': 'Schnittanatomie', 'subj.patho': 'Topographische Pathologie',
    // veride title_de'si olmayan tur sekmeleri (sınavın alt konusu, sahne düğmesinin title'ı)
    'tab.liver': 'Leber, Gallenwege und Pankreas',
    // genel tekrar ve sınavdaki "In 3D zeigen" bildirimleri
    'note.noParts': 'Die Strukturen dieser Frage sind im Modell nicht vorhanden.',
    // düğme testlerin dışındadır ve Türkçe kalır ("Yanlışlarım"): Almanca bildirim onu ekrandaki adıyla anar
    'note.moreSect': n => `Im Schnitttest gibt es noch ${n} Fehler: Drück dafür noch einmal auf „Yanlışlarım“.`,
    'note.moreFacts': n => `Bei den Wissensfragen gibt es noch ${n} Fehler: Drück für die Probeklausur noch einmal auf „Yanlışlarım“.`,
  },
  tr: {
    'lang.title': 'Test dili: Almanca ya da Türkçe',
    'lang.de': 'Almanca', 'lang.tr': 'Türkçe',
    'mode.name': 'Bu yapı ne?', 'mode.find': 'Yapıyı bul', 'mode.facts': 'Bilgi',
    'q.name': 'Parlayan yapı hangisi?',
    'q.find': 'Şu yapıyı 3B görünümde tıkla:',
    'res.ok': 'Doğru!',
    'res.bad': 'Yanlış; doğru şık yeşil.',
    'res.badFind': 'Yanlış: {0}. Doğrusu şimdi parlıyor.',
    'all': 'Hepsi',
    'next': 'Sonraki soru ▶', 'skip': 'Geç',
    'focus': 'Yapıya odaklan', 'focus.title': 'Kamerayı sorulan yapıya getir',
    'noQ.view': 'Bu görünümde soru yok.',
    'weak.btn': 'Yanlışlarım ({0})',
    'weak.on': 'Bütün sorulara dön',
    'weak.off': 'Yalnız yanlış cevapladığın ve henüz iki kez arka arkaya doğru bilmediğin sorular',
    'prog': 'Bilinen {0} / {1} · yanlış {2}',
    'prog.title': 'Bu tarayıcıda saklanan ilerleme: bu soru havuzunda bilinen ve tekrar edilecek sorular',
    'score': 'Doğru {0} / {1}',
    'weak.empty': 'Burada tekrar edilecek yanlışın yok, güzel! Bütün sorulara dönmek için «Yanlışlarım» düğmesini kapat.',
    'quiz.few': 'Bu görünümde soru sorulacak kadar yapı yok (Katmanlar ile gizlenen sistemlerin yapıları soru olmaz).',
    'quiz.review': 'Tekrar', 'quiz.count': '{0} yapı',
    'quiz.back': 'Konuya dön', 'quiz.back.title': 'Konu kartına dön',
    'quiz.exit': 'Testten çık', 'quiz.exit.title': 'İzole görünümden çık (Esc)',
    'review.title': 'Yanlışlarım', 'review.place': 'Testlerde yanlış cevapladığın yapılar',
    'sys.bone': 'İskelet sistemi', 'sys.muscle': 'Kas sistemi', 'sys.nerve': 'Sinir sistemi', 'sys.vessel': 'Dolaşım sistemi', 'sys.organ': 'İç organlar', 'sys.joint': 'Eklemler ve bağlar',
    'cat.csf': 'BOS', 'cat.cn': 'Sinirler', 'cat.art': 'Arterler',
    'cat.nerve': 'Sinir', 'cat.passage': 'Geçit', 'cat.joint': 'Eklem', 'cat.muscle': 'Kas',
    'reg.arm': 'Kol', 'reg.leg': 'Bacak', 'reg.other': 'Gövde, baş',
    'sx.find': 'Yapıyı bul', 'sx.name': 'Bu ne?', 'sx.level': 'Hangi seviye?', 'sx.facts': 'Bilgi',
    'sx.noQ': 'Bu seçimde soru yok.',
    'sx.level.k': 'Seviye',
    'sx.q.find': 'Şu yapıyı kesit yüzünde tıkla:',
    'sx.badFind': 'Yanlış: {0}. Doğrusu şimdi vurgulu.',
    'sx.q.name': 'Kesit yüzünde halkayla işaretli yapı hangisi?',
    'sx.q.level': 'Bu kesit hangi seviyede?',
    'sx.allRegions': 'Bütün bölgeler',
    'sx.view': 'Kesite bak', 'sx.view.title': 'Kamerayı kesite dik ve seviyeyi çerçeveleyecek şekilde getir',
    'sx.back': 'Seviyeye dön', 'sx.back.title': 'Düzlemi seviyenin yerine geri koy',
    'sx.clickHint': 'Kesit yüzüne tıklayınca o yapının adı görünür.',
    'sx.picked': 'Tıklanan yapı',
    'sx.offLevel': 'Önce düzlemi seviyeye döndür',
    'sx.clickCap': 'Kesit yüzündeki yapıya tıkla',
    'sreg.head': 'Baş ve boyun', 'sreg.thorax': 'Göğüs', 'sreg.abdomen': 'Karın', 'sreg.pelvis': 'Pelvis', 'sreg.limbs': 'Ekstremiteler',
    'ex.title': 'Deneme sınavı', 'ex.close': 'Kapat', 'ex.closeEsc': 'Kapat (Esc)',
    'ex.loading': 'Soru bankaları yükleniyor…',
    'ex.intro': 'Bütün çalışma modlarının bilgi sorularından karışık, süreli bir test. Cevaplar Yanlışlarım listesine yazılır.',
    'ex.resume': 'Yarım kalan sınav: {0} / {1} cevaplı', 'ex.resumeLeft': ', kalan süre {0}',
    'ex.continue': 'Devam et', 'ex.discard': 'Sil',
    'ex.failed': 'Yüklenemedi: {0}. Sınav öteki konularla yapılabilir; pencereyi yeniden açınca tekrar denenir.',
    'ex.subjects': 'Konular', 'ex.none': 'Hiçbiri',
    'ex.count': 'Soru sayısı', 'ex.countAvail': '(seçimde {0} soru var)',
    'ex.time': 'Soru başına süre', 'ex.timeNote': '(tek toplam geri sayım)',
    'ex.untimed': 'Süresiz', 'ex.sec': '{0} sn',
    'ex.questions': 'Sorular', 'ex.src.all': 'Tüm sorular', 'ex.src.weak': 'Yalnız yanlışlarım ve yeni sorular',
    'ex.note.weak': 'Seçili konularda {0} yanlış ve {1} yeni soru; önce yanlışlar sorulur.',
    'ex.note.all': 'Seçili konularda {0} soru.',
    'ex.mode': 'Mod', 'ex.m.exam': 'Sınav', 'ex.m.study': 'Çalışma',
    'ex.note.exam': 'Sonuçlar sınavın sonunda gösterilir; cevabını bitirene kadar değiştirebilirsin.',
    'ex.note.study': 'Her cevaptan sonra doğrusu ve açıklaması gösterilir; cevap değiştirilemez.',
    'ex.sum': '{0} soru · {1}', 'ex.sumUntimed': 'süresiz', 'ex.sumNone': 'Seçimde soru yok',
    'ex.lastResult': 'Son sonuç', 'ex.start': 'Başla',
    'ex.hist': 'Son sınavlar', 'ex.trend': '{0} puan (önceki sınavların ortalaması %{1})', 'ex.nSubj': '{0} konu',
    'ex.q': 'Soru', 'ex.qn': 'Soru {0}', 'ex.answered': 'cevaplı', 'ex.flagged': 'işaretli',
    'ex.confirmFinish': '{0} soru boş{1}. Boş sorular yanlış sayılır. Yine de bitirilsin mi?',
    'ex.confirmFlag': ', {0} işaretli',
    'ex.finish': 'Bitir', 'ex.finish.title': 'Sınavı bitir', 'ex.keepOn': 'Devam et',
    'ex.confirmLeave': 'Sınavdan çıkılsın mı? {0} oluşmaz.',
    'ex.leaveStudy': 'Verdiğin cevaplar kaydedildi; sonuç', 'ex.leaveExam': 'Cevapların kaydedilmez, sonuç',
    'ex.leave': 'Çık', 'ex.leave.title': 'Sınavdan çık (Esc)',
    'ex.timeLeft': 'Kalan süre', 'ex.untimedShort': 'süresiz',
    'ex.prev': '◀ Önceki', 'ex.next': 'Sonraki ▶', 'ex.flag': '⚑ İşaretle', 'ex.flag.title': 'Sonra bakmak için işaretle',
    'ex.flagmark': '⚑ işaretli',
    'ex.map': 'Soru haritası · {0}/{1} cevaplı', 'ex.mapFlag': ' · {0} işaretli',
    'ex.keys': 'Klavye: 1-4 / A-D cevap · Enter sonraki · ← → gezin · Esc çık',
    'ex.pct': '%{0}',
    'ex.result': 'Sonuç', 'ex.dur': 'Süre {0}', 'ex.modeName': '{0} modu', 'ex.timeout': 'Süre doldu', 'ex.empty': '{0} boş',
    'ex.f.wrong': 'Yanlışlar ({0})', 'ex.f.flag': 'İşaretliler ({0})', 'ex.f.all': 'Tümü ({0})',
    'ex.st.ok': 'Doğru', 'ex.st.bad': 'Yanlış', 'ex.st.skip': 'Boş',
    'ex.given': 'Senin cevabın: {0}', 'ex.givenNone': 'boş', 'ex.right': 'Doğru cevap: {0}',
    'ex.show': "3B'de göster", 'ex.show.title': 'Sorunun yapılarını 3B görünümde seç ve göster',
    'ex.noWrong': 'Yanlış ya da boş soru yok, tebrikler!', 'ex.noFlag': 'İşaretlediğin soru yok.',
    'ex.retry': 'Yanlışları tekrar çöz', 'ex.retry.title': 'Yanlış ve boş sorulardan yeni bir sınav', 'ex.new': 'Yeni sınav',
    'ex.back': 'Sonuca dön',
    'subj.brain': 'Beyin ve sinir sistemi', 'subj.loco': 'Hareket sistemi', 'subj.muscles': 'Kaslar', 'subj.heart': 'Kalp',
    'subj.situs': 'Karın - Situs', 'subj.thorax': 'Göğüs ve solunum', 'subj.uro': 'Ürogenital ve pelvis', 'subj.head': 'Baş-boyun',
    'subj.vessels': 'Ekstremite damarları', 'subj.lymph': 'Lenf sistemi', 'subj.sect': 'Kesit anatomisi', 'subj.patho': 'Topografik patoloji',
    'tab.liver': 'Karaciğer, safra yolları, pankreas',
    'note.noParts': 'Bu sorunun yapıları modelde yok',
    'note.moreSect': n => `Kesit testinde ${n} yanlış daha var: onlar için Yanlışlarım'a bir daha bas`,
    'note.moreFacts': n => `Bilgi sorularında ${n} yanlış daha var: deneme sınavı için Yanlışlarım'a bir daha bas`,
  },
};
export const _STR = STR;   // testler için
export const has = key => Object.hasOwn(STR[lang], key);
// belirli bir dildeki metin (değersiz; yoksa undefined): ör. sınavın Almanca alt konu adları
export const Tin = (l, key) => STR[l]?.[key];
// T(anahtar, ...değerler): o anki dilde metin; bilinmeyen anahtar anahtarın kendisini döndürür (hata göze batsın)
export function T(key, ...args) {
  const v = STR[lang][key] ?? STR.tr[key];
  if (v == null) return key;
  if (typeof v === 'function') return v(...args);
  return args.length ? v.replace(/\{(\d)\}/g, (m, i) => (args[+i] ?? '')) : v;
}
// HTML lang özniteliği: o anki test dili
export const langAttr = () => ` lang="${lang}"`;

// "DE | TR" düğmesi (test panellerinin puan satırında ve sınav penceresinde). data-tlang tıklamasını main.js (panel) ve
// exam.js (pencere) işler.
export function langSwitch(cls = '') {
  return `<span class="seg tiny tlang${cls ? ' ' + cls : ''}" role="group" aria-label="${T('lang.title')}" title="${T('lang.title')}">${LANGS.map(l =>
    `<button type="button" data-tlang="${l}" class="${l === lang ? 'active' : ''}" aria-pressed="${l === lang}" title="${T('lang.' + l)}" lang="${l}">${l.toUpperCase()}</button>`).join('')}</span>`;
}

// ---------- Almanca veri ----------
let de = null;            // { items, texts } (geçerli dosya yüklendiyse)
let loading = null;       // süren indirme
let failedAt = 0;         // son başarısız indirme zamanı (ms)
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
function accept(j) {
  if (!isObj(j) || !isObj(j.items)) throw new Error('quiz-de.json biçimi geçersiz');
  de = { items: j.items, texts: isObj(j.texts) ? j.texts : {} };
}
// Almanca dosyayı indir (bir kez). Başarısızsa RETRY_MS geçmeden yeniden denenmez; reddedilen söz dışarı sızmaz.
export function loadDe() {
  if (de) return Promise.resolve(true);
  if (loading) return loading;
  if (failedAt && Date.now() - failedAt < RETRY_MS) return Promise.resolve(false);
  if (typeof fetch !== 'function') return Promise.resolve(false);
  let p;
  try { p = fetch(DE_URL); } catch (e) { failedAt = Date.now(); return Promise.resolve(false); }
  loading = Promise.resolve(p)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { accept(j); loading = null; failedAt = 0; if (lang === 'de') emit(); return true; })
    .catch(e => { loading = null; failedAt = Date.now(); console.warn('Almanca test metinleri yüklenemedi:', e?.message || e); return false; });
  return loading;
}
export const deLoaded = () => !!de;
// testler için: veriyi doğrudan ver (null: yüklenmemiş duruma dön)
export function _setDe(j) { de = null; loading = null; failedAt = 0; if (j) accept(j); }

const ids = new WeakMap();
const idOf = f => { let id = ids.get(f); if (!id) { id = factId(f.q); ids.set(f, id); } return id; };
const str = s => typeof s === 'string' && s.trim() !== '';
// Türkçe şıkların ve açıklamanın parmak izi. Aynı soru metni birden çok bankada farklı şıklarla geçebilir (ör. situs ve
// uro); kimlik yalnız soru metninden geldiği için böyle bir metnin Almanca kaydı "s" alanında hangi şıklar için
// yazıldığını taşır ve öteki bankanın sorusu için "<kimlik>~<parmak izi>" anahtarlı ayrı bir kayıt bulunur.
export const factSig = f => factId([...f.options, typeof f.explain === 'string' ? f.explain : ''].join('\n')).slice(2);
const sigs = new WeakMap();
const sigOf = f => { let s = sigs.get(f); if (!s) { s = factSig(f); sigs.set(f, s); } return s; };
// Almanca kayıt bu soru için geçerli mi: soru ve bütün şıklar dolu metin, şık sayısı aynı; kayıt parmak izi taşıyorsa
// bu sorunun parmak izi olmalı; Türkçe açıklama varsa Almancası da olmalı (yarı Almanca yarı Türkçe soru gösterilmez)
function validEntry(e, f) {
  if (!isObj(e) || !str(e.q) || !Array.isArray(e.o) || e.o.length !== f.options.length || !e.o.every(str)) return false;
  if (e.s != null && e.s !== sigOf(f)) return false;
  if (e.e != null && typeof e.e !== 'string') return false;
  if (str(f.explain) && !str(e.e)) return false;
  return true;
}
const tr = f => ({ q: f.q, options: f.options, explain: f.explain || '', de: false });
// Bilgi sorusunun o anki dildeki metni: { q, options (Türkçe ile aynı sırada), explain, de }. f.qde: çalışırken üretilen
// sorunun Almanca soru metni (şıklar ve açıklama dilden bağımsız).
export function factText(f) {
  if (!f) return { q: '', options: [], explain: '', de: false };
  if (lang !== 'de') return tr(f);
  if (str(f.qde)) return { q: f.qde, options: f.options, explain: f.explain || '', de: true };
  // kaynağı zaten iki dilli soru (patoloji vakaları): Almanca metin sorunun kendisinde, şık sayısı aynı olmalı
  if (isObj(f.de) && str(f.de.q) && Array.isArray(f.de.options) && f.de.options.length === f.options.length && f.de.options.every(str)) return { q: f.de.q, options: f.de.options, explain: f.de.explain || '', de: true };
  if (!de) { loadDe(); return tr(f); }
  const id = idOf(f), v = de.items[id + '~' + sigOf(f)];
  const e = validEntry(v, f) ? v : de.items[id];
  if (!validEntry(e, f)) return tr(f);
  return { q: e.q, options: e.o, explain: str(f.explain) ? e.e : (e.e || ''), de: true };
}
// Kaynakta dili belirtilmemiş kısa metnin dili (kesit atlası ipuçları Almanca ya da Türkçe yazılmış): Türkçeye özgü harf
// sık Türkçe sözcük ya da ek varsa 'tr', Almancaya özgü harf ya da sık Almanca sözcük varsa 'de', ikisi de yoksa ''
// (HTML'de "dil bilinmiyor"; Latince terim ve kısaltmalardan oluşan ipuçları)
const TR_HINT = /[ğĞşŞıİçÇ]|'(?:[dt][ae]|n?[ıiuü]n|[ae]|[ıiuü])(?!\p{L})|(?<!\p{L})(?:ve|ile|bu|bir|en|için|sağ|sol|ön|arka|burada|gibi|dal)(?!\p{L})|\p{L}(?:inde|ında|unda|ünde)(?!\p{L})/iu;
const DE_HINT = /[äßÄ]|(?<!\p{L})(?:der|die|das|und|von|im|den|des|unter|zwischen|oberhalb|als|an)(?!\p{L})/iu;
export const tipLang = s => (TR_HINT.test(s || '') ? 'tr' : DE_HINT.test(s || '') ? 'de' : '');
// Kısa metin (kesit testi ask[].tr ve ask[].tip): { text, de }
export function shortText(t) {
  if (!str(t) || lang !== 'de') return { text: t || '', de: false };
  if (!de) { loadDe(); return { text: t, de: false }; }
  const v = de.texts[factId(t)];
  return str(v) ? { text: v, de: true } : { text: t, de: false };
}
