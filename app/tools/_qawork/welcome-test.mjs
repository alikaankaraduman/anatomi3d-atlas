// Node testi: src/welcome.js (kişisel bağlantı). Çalıştır: node tools/_qawork/welcome-test.mjs (app/ içinde)
// İçerik uydurmadır ("Deneme Kişi", "Deneme Veren", nötr deneme cümleleri).
import * as W from '../../src/welcome.js';

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('HATA:', msg); } };
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const bad = (payload, code, msg) => { const r = W.decode(payload); ok(!r.ok && (!code || r.code === code), `${msg} (beklenen ${code}, gelen ${r.ok ? 'geçerli' : r.code})`); };
const throwsCode = (fn, code, msg) => { try { fn(); ok(false, msg + ' (hata bekleniyordu)'); } catch (e) { ok(e.code === code, `${msg} (kod ${e.code})`); } };

// ---------- gidiş-dönüş ----------
const base = { to: 'Deneme Kişi', from: 'Deneme Veren', msg: 'Bu bir deneme cümlesidir.\nİkinci satır: çğıöşü ÇĞİÖŞÜ 🙂🫀\n\nSon satır.', date: '2026-11-21', color: 'mor', title: 'Deneme Atlas' };
const p = W.encode(base);
ok(/^[A-Za-z0-9_-]+$/.test(p), 'parça base64url');
const r = W.decode(p);
ok(r.ok, 'çözülür');
ok(r.ok && r.data.to === base.to && r.data.from === base.from && r.data.msg === base.msg && r.data.date === base.date && r.data.color === 'mor' && r.data.title === base.title, 'gidiş-dönüş aynı (Türkçe karakter, emoji, satır sonu)');
ok(W.same(r.data, base), 'same()');
ok(W.encode(r.data) === p, 'kanonik: yeniden kodlama aynı metni verir');
ok(W.encode({ title: base.title, color: 'mor', date: base.date, msg: base.msg, from: base.from, to: base.to }) === p, 'alan sırası önemsiz');
// yalnız ad
const r2 = W.decode(W.encode({ to: 'Deneme Kişi' }));
ok(r2.ok && Object.keys(r2.data).join() === 'to', 'yalnız ad: öteki alanlar yok');
// varsayılan renk yazılmaz, boş alanlar atılır
ok(W.decode(W.encode({ to: 'A', color: W.DEFAULT_COLOR, from: '  ', msg: '\n\n' })).data.color === undefined, 'varsayılan renk ve boş alanlar düşer');
// satır sonları ve temizlik
ok(W.decode(W.encode({ to: 'A', msg: 'bir\r\nbir\riki\u2028üç' })).data.msg === 'bir\nbir\niki\nüç', 'CRLF, CR ve U+2028 -> \\n');
ok(W.decode(W.encode({ to: 'A', msg: 'a\n\n\n\n\n\nb' })).data.msg === 'a\n\n\nb', 'en çok iki boş satır');
ok(W.decode(W.encode({ to: '  Deneme \n  Kişi\u200b\u202e ' })).data.to === 'Deneme Kişi', 'ad: satır sonu, boşluk, görünmeyen ve yön karakterleri temizlenir');
ok(W.decode(W.encode({ to: 'A', msg: 'aile: 👩\u200d⚕️' })).data.msg === 'aile: 👩\u200d⚕️', 'ZWJ emoji dizisi korunur');
ok(W.decode(W.encode({ to: 'A', msg: '<b>x</b> & "y"' })).data.msg === '<b>x</b> & "y"', 'HTML düz metin olarak kalır (gösterim textContent ile)');
ok(W.decode(W.encode({ to: 'e\u0301' })).data.to === 'é', 'NFC');

// ---------- uzunluk sınırları ----------
const rep = (ch, n) => ch.repeat(n);
for (const [k, lim] of Object.entries(W.LIMITS)) {
  const field = v => (k === 'to' ? { to: v } : { to: 'A', [k]: v });
  ok(W.decode(W.encode(field(rep('a', lim)))).ok, `${k}: ${lim} karakter geçerli`);
  throwsCode(() => W.encode(field(rep('a', lim + 1))), k, `${k}: ${lim + 1} karakter reddedilir (encode)`);
  bad(b64(JSON.stringify({ v: 1, ...field(rep('a', lim + 1)) })), k, `${k}: ${lim + 1} karakter reddedilir (decode)`);
  // emoji bir karakter sayılır
  ok(W.decode(W.encode(field(rep('🙂', lim)))).ok, `${k}: ${lim} emoji geçerli`);
  throwsCode(() => W.encode(field(rep('🙂', lim + 1))), k, `${k}: ${lim + 1} emoji reddedilir`);
}
// en uzun gerçekçi bağlantı sınırın altında
const longest = W.encode({ to: rep('🙂', 40), from: rep('🙂', 40), msg: rep('🙂', 600), date: '2026-01-01', color: 'pembe', title: rep('🙂', 30) });
ok(longest.length <= W.PAYLOAD_MAX, `en uzun emoji bağlantısı sınırda (${longest.length} <= ${W.PAYLOAD_MAX})`);
const quotes = W.encode({ to: rep('"', 40), from: rep('\\', 40), msg: rep('"', 600), title: rep('"', 30), date: '2026-01-01', color: 'pembe' });
ok(quotes.length <= W.PAYLOAD_MAX, `en uzun kaçışlı bağlantı sınırda (${quotes.length})`);
ok(W.decode(quotes).ok, 'kaçışlı karakterler gidiş-dönüş');

// ---------- yanlış türler ve şekiller ----------
throwsCode(() => W.encode({}), 'to', 'ad yok');
throwsCode(() => W.encode({ to: '   ' }), 'to', 'ad yalnız boşluk');
bad(b64(JSON.stringify({ v: 1, to: 5 })), 'to', 'ad sayı');
bad(b64(JSON.stringify({ v: 1, to: ['a'] })), 'to', 'ad dizi');
bad(b64(JSON.stringify({ v: 1, to: 'A', msg: { a: 1 } })), 'msg', 'not nesne');
bad(b64(JSON.stringify({ v: 1, to: 'A', from: true })), 'from', 'kimden mantıksal');
bad(b64(JSON.stringify({ v: 1, to: 'A', color: 3 })), 'color', 'renk sayı');
bad(b64(JSON.stringify({ v: 1, to: 'A', title: 7 })), 'title', 'başlık sayı');
bad(b64(JSON.stringify({ v: 1, to: 'A', date: 20261121 })), 'date', 'tarih sayı');
for (const d of ['2026-02-30', '2026-13-01', '2026-1-1', '21.11.2026', '1800-01-01', '2026-11-21T00:00']) bad(b64(JSON.stringify({ v: 1, to: 'A', date: d })), 'date', `tarih ${d}`);
ok(W.decode(b64(JSON.stringify({ v: 1, to: 'A', date: '2028-02-29' }))).ok, 'artık gün geçerli');
bad(b64(JSON.stringify({ v: 2, to: 'A' })), 'version', 'sürüm 2');
bad(b64(JSON.stringify({ v: '1', to: 'A' })), 'version', 'sürüm metin');
bad(b64(JSON.stringify({ to: 'A' })), 'version', 'sürüm yok');
bad(b64(JSON.stringify([1, 2])), 'shape', 'dizi');
bad(b64('"metin"'), 'shape', 'metin');
bad(b64('null'), 'shape', 'null');
// bilinmeyen alanlar yok sayılır
const ru = W.decode(b64(JSON.stringify({ v: 1, to: 'A', extra: '<script>', html: 1 })));
ok(ru.ok && !('extra' in ru.data) && !('html' in ru.data), 'bilinmeyen alanlar yok sayılır');
// bilinmeyen renk anahtarı: yalnız renk düşer
const rc = W.decode(b64(JSON.stringify({ v: 1, to: 'A', color: 'turkuaz' })));
ok(rc.ok && rc.data.color === undefined, 'bilinmeyen renk anahtarı düşer');
for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) ok(!W.isColor(k), `renk değil: ${k}`);
ok(W.COLOR_KEYS.every(W.isColor) && W.isColor(W.DEFAULT_COLOR), 'palet anahtarları');
ok(W.COLOR_KEYS.every(k => /^#[0-9a-f]{6}$/.test(W.PALETTE[k].accent) && /^#[0-9a-f]{6}$/.test(W.PALETTE[k].ink)), 'palet renk kodları');

// ---------- prototip anahtarları ----------
bad(b64('{"v":1,"to":"A","__proto__":{"x":1}}'), 'shape', '__proto__ üst düzeyde');
bad(b64('{"v":1,"to":"A","constructor":{"prototype":{}}}'), 'shape', 'constructor');
bad(b64('{"v":1,"to":"A","extra":{"__proto__":1}}'), 'shape', '__proto__ iç içe');
bad(b64('{"v":1,"to":"A","prototype":"x"}'), 'shape', 'prototype');
ok(({}).x === undefined && Object.prototype.polluted === undefined, 'Object.prototype temiz');
// validate doğrudan
ok(!W.validate(JSON.parse('{"v":1,"to":"A","__proto__":{}}')).ok, 'validate: own __proto__');

// ---------- boyut ve bozuk base64 ----------
bad('A'.repeat(W.PAYLOAD_MAX + 1), 'size', 'çok uzun parça (çözmeden önce)');
bad('', 'empty', 'boş');
bad(null, 'empty', 'null parça');
bad('abc$def', 'base64', 'base64url dışı karakter');
bad('abc+/def', 'base64', '+ ve / (base64url değil)');
bad('A', 'base64', 'uzunluk %4 == 1');
bad(p.slice(0, -7), null, 'kesik bağlantı');
bad(Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url'), 'utf8', 'geçersiz UTF-8');
bad(b64('{"v":1,"to":'), 'json', 'bozuk JSON');
bad(b64('{"v":1,"to":"A"} x'), 'json', 'JSON sonrası çöp');

// ---------- adres parçası ve yapıştırma ----------
ok(W.payloadFromHash('#g=' + p) === p, 'payloadFromHash');
ok(W.payloadFromHash('#t=abc&g=' + p + '&s=x') === p, 'payloadFromHash: derin bağlantıyla birlikte');
ok(W.payloadFromHash('#t=abc') === null && W.payloadFromHash('') === null, 'payloadFromHash: yok');
ok(W.hashWithout('#g=' + p + '&t=a%20b&m=heart:flow') === 't=a%20b&m=heart:flow', 'hashWithout öteki parçaları korur');
ok(W.hashWithout('#g=' + p) === '', 'hashWithout: yalnız g');
const link = W.buildLink('https://example.org/app/index.html?x=1#t=old', base);
ok(link === 'https://example.org/app/index.html?x=1#g=' + p, 'buildLink var olan parçayı atar');
ok(W.payloadFromText('  ' + link + '\n') === p, 'yapıştırma: tam adres');
ok(W.payloadFromText('#g=' + p) === p && W.payloadFromText('g=' + p) === p && W.payloadFromText(p) === p, 'yapıştırma: #g=, g= ve çıplak');
ok(W.payloadFromText(link.slice(0, 40) + '\n' + link.slice(40)) === p, 'yapıştırma: satıra bölünmüş adres');
ok(W.payloadFromText('merhaba dünya') === null && W.payloadFromText('https://example.org/') === null, 'yapıştırma: bağlantı değil');

// ---------- cihaz kaydı ----------
const st = W.storedText(r.data);
ok(W.same(W.parseStored(st), base), 'kayıt gidiş-dönüş');
ok(W.parseStored('{bozuk') === null && W.parseStored(null) === null && W.parseStored('{"v":1}') === null, 'bozuk kayıt = yok');
ok(W.parseStored('{"v":1,"data":{"to":"A","__proto__":{}}}') === null, 'kayıtta prototip anahtarı');
ok(W.parseStored(JSON.stringify({ v: 1, data: { to: rep('a', 41) } })) === null, 'kayıtta sınır aşımı');
ok(W.dateText('2026-11-21') === '21 Kasım 2026', 'tarih metni: ' + W.dateText('2026-11-21'));
ok(W.dateText('x') === '', 'geçersiz tarih metni boş');
ok(W.cpLength('a🙂b') === 3, 'cpLength');

// ---------- eşsiz vekiller (lone surrogates) ----------
// 600 eşsiz vekil JSON'da \udXXX (6 bayt) olur: atılmasaydı bağlantı PAYLOAD_MAX'ı aşar ve çözülemezdi
ok(W.cleanLine('a\ud800b\udc00c') === 'abc' && W.cleanText('x\udfff\ny') === 'x\ny', 'eşsiz vekiller atılır');
ok(W.cleanText('🙂\ud83d') === '🙂', 'eşli vekil (emoji) kalır, sondaki eşsiz vekil atılır');
{
  const sp = W.encode({ to: 'A', msg: 'b' + '\ud800'.repeat(600) });
  ok(sp.length <= W.PAYLOAD_MAX && W.decode(sp).ok && W.decode(sp).data.msg === 'b', 'eşsiz vekillerle yapılan bağlantı çözülür');
  let threw = false; try { W.encode({ to: '𐀀'.slice(0, 1) }); } catch (e) { threw = e.code === 'to'; }
  ok(threw, 'yalnız eşsiz vekilden oluşan ad boş sayılır');
  bad(b64(JSON.stringify({ v: 1, to: 'A', msg: 'a' + '\ud800'.repeat(700) })), 'size', 'çok sayıda kaçışlı eşsiz vekil: boyut sınırı');
  const lone = W.decode(b64('{"v":1,"to":"A\\ud800","msg":"x\\udc00y"}'));
  ok(lone.ok && lone.data.to === 'A' && lone.data.msg === 'xy', 'çözerken JSON kaçışlı eşsiz vekiller atılır');
}
// en kötü gerçek durum: her alan sınırında, 4 baytlık emoji ve kaçışlı tırnaklarla
{
  const big = W.encode({ to: '🙂'.repeat(40), from: '🫀'.repeat(40), msg: '🙂"'.repeat(300), date: '2026-11-21', color: 'mor', title: '🙂'.repeat(30) });
  ok(big.length <= W.PAYLOAD_MAX && W.decode(big).ok, `en kötü durum sınırın altında (${big.length} / ${W.PAYLOAD_MAX})`);
}

console.log(`welcome-test: ${passes} geçti, ${fails} hata`);
process.exit(fails ? 1 : 0);
