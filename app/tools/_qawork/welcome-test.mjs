// Node testi: src/welcome.js (kişisel bağlantı, imzalı biçim) ve tools/welcome-sign.mjs. Çalıştır (app/ içinde):
// node tools/_qawork/welcome-test.mjs. İçerik uydurmadır ("Deneme Kişi", "Deneme Veren", nötr deneme cümleleri).
// İmzalar her çalıştırmada burada üretilen ATILACAK bir anahtar çiftiyle yapılır; yayının gerçek anahtarı kullanılmaz.
import { readFileSync } from 'node:fs';
import * as W0 from '../../src/welcome.js';
import * as S from '../welcome-sign.mjs';
const { subtle } = globalThis.crypto;
const gen = async () => {
  const k = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await subtle.exportKey('jwk', k.publicKey);
  return { priv: k.privateKey, pub: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y } };
};
const K = await gen(), K2 = await gen();
// içerik kuralları: kodlama Node yardımcısıyla (tools/welcome-sign.mjs), çözme yalnız yük (imza aşağıda ayrıca sınanır)
const W = { ...W0, encode: d => S.encodePayload(d).payload, decode: p => W0.decodePayload(p),
  same: (a, b) => S.canonical(S.encodePayload(a).data) === S.canonical(S.encodePayload(b).data) };

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
const longest = W.encode({ to: rep('🙂', 40), from: rep('🙂', 40), msg: rep('🙂', W.LIMITS.msg), date: '2026-01-01', color: 'pembe', title: rep('🙂', 30) });
ok(longest.length <= W.PAYLOAD_MAX, `en uzun emoji bağlantısı sınırda (${longest.length} <= ${W.PAYLOAD_MAX})`);
const quotes = W.encode({ to: rep('"', 40), from: rep('\\', 40), msg: rep('"', W.LIMITS.msg), title: rep('"', 30), date: '2026-01-01', color: 'pembe' });
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
const sp0 = await S.signPayload(p, K.priv);
const link = S.buildLink('https://example.org/app/index.html?x=1#t=old', sp0);
ok(link === 'https://example.org/app/index.html?x=1#g=' + sp0, 'buildLink var olan parçayı atar');
ok(W.payloadFromText('  ' + link + '\n') === sp0, 'yapıştırma: tam adres');
ok(W.payloadFromText('#g=' + sp0) === sp0 && W.payloadFromText('g=' + sp0) === sp0 && W.payloadFromText(sp0) === sp0, 'yapıştırma: #g=, g= ve çıplak');
ok(W.payloadFromText(link.slice(0, 40) + '\n' + link.slice(40)) === sp0, 'yapıştırma: satıra bölünmüş adres');
ok(W.payloadFromText('merhaba dünya') === null && W.payloadFromText('https://example.org/') === null, 'yapıştırma: bağlantı değil');

// (cihaz kaydı: aşağıdaki imza bölümünde)
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
  bad(b64(JSON.stringify({ v: 1, to: 'A', msg: 'a' + '\ud800'.repeat(1600) })), 'size', 'çok sayıda kaçışlı eşsiz vekil: boyut sınırı');
  const lone = W.decode(b64('{"v":1,"to":"A\\ud800","msg":"x\\udc00y"}'));
  ok(lone.ok && lone.data.to === 'A' && lone.data.msg === 'xy', 'çözerken JSON kaçışlı eşsiz vekiller atılır');
}
// en kötü gerçek durum: her alan sınırında, 4 baytlık emoji ve kaçışlı tırnaklarla
{
  const big = W.encode({ to: '🙂'.repeat(40), from: '🫀'.repeat(40), msg: '🙂"'.repeat(300), date: '2026-11-21', color: 'mor', title: '🙂'.repeat(30) });
  ok(big.length <= W.PAYLOAD_MAX && W.decode(big).ok, `en kötü durum sınırın altında (${big.length} / ${W.PAYLOAD_MAX})`);
}

// ---------- imza ----------
const vk = (signed, key = K.pub) => W.verifyLink(signed, key);
const rejected = async (signed, msg, key) => { const v = await vk(signed, key); ok(!v.ok && v.error === W.INVALID && !('data' in v), msg + (v.ok ? ' (kabul edildi)' : '')); };
{
  const { link: L, signed } = await S.makeLink('https://example.org/', base, K.priv);
  ok(L === 'https://example.org/#g=' + signed, 'makeLink adresi');
  const [pl, sg] = signed.split('.');
  ok(sg.length === W.SIG_LEN && /^[A-Za-z0-9_-]+$/.test(sg), 'imza 86 karakter base64url');
  const v = await vk(W.payloadFromHash(new URL(L).hash));
  ok(v.ok && W.sameLink(v.signed, signed) && v.data.to === base.to && v.data.msg === base.msg && v.data.color === 'mor', 'gidiş-dönüş: imzalı bağlantı doğrulanır ve çözülür');
  ok((await vk(signed)).ok, 'doğrulama tekrarlanabilir');
  // yayının açık anahtarı bu atılacak anahtarla yapılmış bağlantıyı kabul etmez
  await rejected(signed, 'yayının açık anahtarı atılacak anahtarın imzasını reddeder', W.PUBLIC_KEY);
  ok(W.PUBLIC_KEY.kty === 'EC' && W.PUBLIC_KEY.crv === 'P-256' && !('d' in W.PUBLIC_KEY), 'PUBLIC_KEY yalnız açık anahtar');
  // değiştirilmiş yük: çeşitli konumlarda bir karakter
  const swap = (str, i) => str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1);
  let allBad = true;
  for (const i of [0, 1, Math.floor(pl.length / 2), pl.length - 2, pl.length - 1]) if ((await vk(swap(pl, i) + '.' + sg)).ok) allBad = false;
  ok(allBad, 'yükte tek karakter değişince reddedilir (son karakter dahil)');
  await rejected(S.encodePayload({ ...base, to: 'Başka Kişi' }).payload + '.' + sg, 'başka yük + eski imza');
  allBad = true;
  for (const i of [0, 10, 42, 84, 85]) if ((await vk(pl + '.' + swap(sg, i))).ok) allBad = false;
  ok(allBad, 'imzada tek karakter değişince reddedilir (son karakter dahil)');
  // son karakterin kullanılmayan bitleri: aynı baytlara çözülen kanonik olmayan imza da reddedilir
  const last = sg[85], idx = 'AQgw'.indexOf(last);
  if (idx >= 0) await rejected(pl + '.' + sg.slice(0, 85) + 'BRhx'[idx], 'kanonik olmayan imza (kullanılmayan bitler)');
  // başka anahtarla imza
  const other = await S.signPayload(pl, K2.priv);
  await rejected(other, 'başka anahtarın imzası');
  ok((await vk(other, K2.pub)).ok, 'başka anahtar kendi açık anahtarıyla doğrulanır');
  // imzasız, eski biçim ve bozuk biçimler
  await rejected(pl, 'imzasız yük (eski biçim, sürüm 1 bağlantısı)');
  await rejected(pl + '.', 'boş imza');
  await rejected('.' + sg, 'boş yük');
  await rejected(pl + '.' + sg + '.' + sg, 'iki nokta');
  await rejected(pl + '.' + sg.slice(0, 80), 'kısa imza');
  await rejected(pl + '.' + sg + 'AA', 'uzun imza');
  await rejected(pl.slice(0, -5) + '.' + sg, 'kesik yük');
  await rejected(signed.slice(0, 40), 'kesik bağlantı');
  await rejected(signed.slice(0, -1), 'son karakteri eksik bağlantı');
  await rejected('', 'boş'); await rejected(null, 'null'); await rejected(42, 'sayı');
  await rejected(pl + '.$' + sg.slice(1), 'imzada base64url dışı karakter');
  await rejected('A'.repeat(W.PAYLOAD_MAX + 1) + '.' + sg, 'çok uzun yük (doğrulamadan önce)');
  await rejected('A'.repeat(W.LINK_MAX + 10), 'çok uzun metin');
  ok(W.splitSigned('A'.repeat(W.PAYLOAD_MAX + 1) + '.' + sg) === null, 'splitSigned boyut sınırı');
  // geçerli imza ama kurala aykırı içerik: uygulama yine açmaz
  await rejected(await S.signPayload(b64(JSON.stringify({ v: 1, to: 'A'.repeat(41) })), K.priv), 'imzalı ama sınırı aşan yük');
  await rejected(await S.signPayload(b64('{"v":1,"to":"A","__proto__":{}}'), K.priv), 'imzalı ama prototip anahtarlı yük');
  await rejected(await S.signPayload(b64(JSON.stringify({ v: 2, to: 'A' })), K.priv), 'imzalı ama başka sürüm');
  // en büyük geçerli bağlantı imzalanır ve doğrulanır
  const bigS = await S.makeLink('https://example.org/', { to: '🙂'.repeat(40), from: '🫀'.repeat(40), msg: '🙂"'.repeat(300), date: '2026-11-21', color: 'mor', title: '🙂'.repeat(30) }, K.priv);
  ok(bigS.signed.length <= W.LINK_MAX && (await vk(bigS.signed)).ok, `en büyük imzalı bağlantı (${bigS.signed.length} / ${W.LINK_MAX})`);
  // aynı içerik için iki imza farklı olabilir; sameLink yükü karşılaştırır
  const again = await S.signPayload(pl, K.priv);
  ok(W.sameLink(again, signed) && !W.sameLink('eyJ2IjoxfQ.' + sg, signed), 'sameLink yükü karşılaştırır');
  ok(S.encodePayload({ title: base.title, color: 'mor', date: base.date, msg: base.msg, from: base.from, to: base.to }).payload === pl, 'kanonik yük');
  throwsCode(() => S.encodePayload({ to: 'A', date: '2026-02-30' }), 'date', 'yapıcı da aynı kuralla reddeder');

  // ---------- cihaz kaydı (imzalı metin; her okunuşta yeniden doğrulanır) ----------
  const st = W.storedText(signed);
  ok(W.parseStored(st) === signed, 'kayıt gidiş-dönüş (imzalı metin)');
  ok((await vk(W.parseStored(st))).ok, 'kayıttaki bağlantı doğrulanır');
  const edited = JSON.parse(st); edited.link = S.encodePayload({ ...base, to: 'Başka Kişi' }).payload + '.' + sg;
  const ep = W.parseStored(JSON.stringify(edited));
  ok(ep !== null && !(await vk(ep)).ok, 'elle değiştirilmiş kayıt biçimce okunur ama imzası tutmaz');
  ok(W.parseStored(JSON.stringify({ v: 1, data: { to: 'Deneme Kişi' }, saved: '2026-11-21' })) === null, 'eski (sürüm 1, imzasız) kayıt = yok');
  ok(W.parseStored(JSON.stringify({ v: 2, link: pl })) === null, 'imzasız kayıt = yok');
  ok(W.parseStored('{bozuk') === null && W.parseStored(null) === null && W.parseStored('{"v":2}') === null, 'bozuk kayıt = yok');
  ok(W.parseStored('{"v":2,"link":"' + signed + '","__proto__":{}}') === null, 'kayıtta prototip anahtarı');
  ok(W.parseStored('x'.repeat(20001)) === null, 'çok büyük kayıt');
}

// gün sayacı ve mesaj kaynağı (since, feed, fk; açılış şeridi)
{
  const fk = W.toB64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const feed = 'a'.repeat(32);
  const v = W.validate({ v: 1, to: 'Deneme', since: '2024-02-29', feed, fk });
  ok(v.ok && v.data.since === '2024-02-29' && v.data.feed === feed && v.data.fk === fk, 'since, feed ve fk geçerli');
  ok(!W.validate({ v: 1, to: 'A', since: '2023-02-29' }).ok, 'geçersiz sayaç tarihi reddedilir');
  ok(!W.validate({ v: 1, to: 'A', feed }).ok, 'anahtarsız feed reddedilir');
  ok(!W.validate({ v: 1, to: 'A', feed: 'XYZ', fk }).ok, 'biçimsiz feed reddedilir');
  ok(!W.validate({ v: 1, to: 'A', feed, fk: fk.slice(1) }).ok, 'kısa fk reddedilir');
  const { link: L2, signed: s2 } = await S.makeLink('https://example.org/', { to: 'Deneme', since: '2025-01-01', feed, fk }, K.priv);
  const v2 = await W.verifyLink(s2, K.pub);
  ok(v2.ok && v2.data.feed === feed && v2.data.fk === fk && v2.data.since === '2025-01-01' && L2.length < 600, 'feed ve sayaç imzalı bağlantıda gidip gelir');
  const now = new Date(2026, 10, 24, 23, 30);
  ok(W.daysSince('2026-11-24', now) === 0 && W.daysSince('2026-11-23', now) === 1 && W.daysSince('2025-11-24', now) === 365, 'daysSince');
  ok(W.daysSince('2026-11-25', now) === null && W.counterText('2026-11-25', now) === '', 'gelecekteki tarih sayılmaz');
  ok(W.counterText('2026-11-24', now) === 'Birlikte 1. gün' && W.counterText('2024-11-24', now) === 'Birlikte 731. gün', 'counterText');
  ok(W.isSince('2025-10-11T21:00') && !W.isSince('2025-10-11T24:00') && !W.isSince('2025-10-11 21:00') && !W.isSince('2025-02-30T10:00'), 'isSince');
  ok(W.validate({ v: 1, to: 'A', since: '2025-10-11T21:00' }).data.since === '2025-10-11T21:00', 'saatli since geçerli');
  ok(W.counterText('2026-11-24T21:00', new Date(2026, 10, 24, 23, 30)) === 'Birlikte 2 saat', 'saatli sayaç: aynı gün');
  ok(W.counterText('2026-10-11T21:00', new Date(2026, 10, 24, 12, 10)) === 'Birlikte 43 gün 15 saat', 'saatli sayaç: gün ve saat (' + W.counterText('2026-10-11T21:00', new Date(2026, 10, 24, 12, 10)) + ')');
  ok(W.counterText('2026-11-25T08:00', new Date(2026, 10, 24, 23, 30)) === '', 'saatli sayaç: gelecek');
  ok(W.validate({ v: 1, to: 'A', ask: '1' }).data.ask === '1' && !('ask' in W.validate({ v: 1, to: 'A', ask: 'evet' }).data), 'ask yalnız 1 olabilir');
  const sealed = await W.sealFeed('Merhaba\nikinci satır', fk, '2026-11-24T10:00:00.000Z');
  const o = await W.openFeed(sealed, fk);
  ok(o.ok && o.msg === 'Merhaba\nikinci satır' && o.at === '2026-11-24T10:00:00.000Z', 'mesaj şifrelenir ve çözülür');
  const other = W.toB64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  ok(!(await W.openFeed(sealed, other)).ok, 'başka anahtarla mesaj açılmaz');
  const j = JSON.parse(sealed); j.ct = j.ct.slice(0, -2) + (j.ct.endsWith('AA') ? 'BB' : 'AA');
  ok(!(await W.openFeed(JSON.stringify(j), fk)).ok, 'değiştirilmiş şifreli mesaj açılmaz');
  ok(!(await W.openFeed('çöp', fk)).ok && !(await W.openFeed(null, fk)).ok, 'bozuk içerik hata fırlatmaz');
  let threw = false; try { await W.sealFeed('x'.repeat(601), fk); } catch { threw = true; }
  ok(threw, '600 karakterden uzun mesaj yazılmaz');
  ok((await W.openFeed(await W.sealFeed('', fk), fk)).msg === '', 'boş mesaj (yalnız sayaç)');
  ok(W.feedFileFrom({ files: { 'm.json': { content: sealed, truncated: false } } }) === sealed && W.feedFileFrom({ files: {} }) === null && W.feedFileFrom({ files: { 'm.json': { content: 'x', truncated: true } } }) === null, 'feedFileFrom');
}
// kısa bağlantı (#k=<gist>.<anahtar>): şifreli Gist'ten imzalı metin; sahte fetch ile
{
  const { signed } = await S.makeLink('https://example.org/', { to: 'Deneme Kişi', msg: 'Kısa bağlantı denemesi.', ask: '1' }, K.priv);
  const key = W.toB64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const id = 'b'.repeat(32), short = id + '.' + key;
  const file = await W.sealShort(signed, key);
  const fake = (status, body, opts = {}) => async (url, init) => {
    if (opts.throws) throw new TypeError('Failed to fetch');
    ok(url === 'https://api.github.com/gists/' + id && init?.headers?.Accept, 'kısa bağlantı doğru Gist adresini ister');
    return { ok: status === 200, status, json: async () => body };
  };
  const good = await W.resolveShort(short, fake(200, { files: { [W.SHORT_FILE]: { content: file, truncated: false } } }));
  ok(good === signed && (await W.verifyLink(good, K.pub)).ok, 'kısa bağlantı imzalı metne çözülür ve imza denetlenir');
  ok(short.length === 55 && ('https://alikaankaraduman.github.io/anatomi3d-atlas/#k=' + short).length < 115, 'kısa bağlantı ~110 karakter');
  const wrongKey = W.toB64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  ok(await W.resolveShort(id + '.' + wrongKey, fake(200, { files: { [W.SHORT_FILE]: { content: file } } })) === null, 'yanlış anahtar: null');
  ok(await W.resolveShort(short, fake(404, { message: 'Not Found' })) === null, 'Gist yok (404): null');
  ok(await W.resolveShort(short, fake(200, { files: { [W.SHORT_FILE]: { content: '{bozuk' } } })) === null, 'bozuk içerik: null');
  ok(await W.resolveShort(short, fake(200, { files: {} })) === null, 'dosya yok: null');
  ok(await W.resolveShort(short, fake(200, { files: { [W.SHORT_FILE]: { content: file, truncated: true } } })) === null, 'kesik dosya: null');
  ok(await W.resolveShort(short, fake(0, null, { throws: true })) === null, 'çevrimdışı: null');
  const j = JSON.parse(file); j.ct = (j.ct[0] === 'A' ? 'B' : 'A') + j.ct.slice(1);
  ok(await W.resolveShort(short, fake(200, { files: { [W.SHORT_FILE]: { content: JSON.stringify(j) } } })) === null, 'değiştirilmiş şifreli metin: null');
  const notSigned = await W.sealShort('düz metin', key);
  ok(await W.resolveShort(short, fake(200, { files: { [W.SHORT_FILE]: { content: notSigned } } })) === null, 'imzalı biçimde olmayan içerik: null');
  ok(W.splitShort(short) && !W.splitShort(id + '.' + key.slice(1)) && !W.splitShort('XYZ.' + key) && !W.splitShort(short + '.x'), 'splitShort biçimi');
  ok(W.shortFromHash('#m=x&k=' + short) === short && W.shortFromText('https://example.org/#k=' + short) === short && W.shortFromText('k=' + short) === short && W.shortFromText(short) === short && W.shortFromText('#g=abc.def') === null, 'kısa bağlantı adres ve yapıştırmadan okunur');
  ok(W.hashWithout('k=' + short + '&m=brain') === 'm=brain' && W.hashWithout('g=a.b&k=' + short) === '', 'hashWithout g= ve k= atar');
}
// düz metin mesaj (mesaj.txt; GitHub'dan elle düzenlenir), şifreli m.json'un önüne geçer
{
  const at = '2026-11-26T09:15:00Z';
  const src = W.feedSource({ updated_at: at, files: { 'mesaj.txt': { content: '  Günaydın 💙\r\n\r\n\r\n\r\nikinci satır  \n', truncated: false }, 'm.json': { content: 'x' } } });
  ok(src?.kind === 'plain' && src.at === at, 'mesaj.txt varsa o kullanılır (tarih updated_at)');
  const m = W.plainFeed(src.text, src.at);
  ok(m.ok && m.msg === 'Günaydın 💙\n\n\nikinci satır' && m.at === at, 'düz metin temizlenir (satır sonları, boşluklar)');
  ok(W.feedSource({ files: { 'm.json': { content: 'şifreli' } } })?.kind === 'enc', 'mesaj.txt yoksa şifreli m.json');
  ok(W.feedSource({ files: { 'mesaj.txt': { content: 'x', truncated: true }, 'm.json': { content: 'şifreli' } } })?.kind === 'enc', 'kesik mesaj.txt yok sayılır');
  ok(W.feedSource({ files: {} }) === null && W.feedSource(null) === null, 'dosya yoksa null');
  const long = W.plainFeed('a'.repeat(700));
  ok(long.ok && [...long.msg].length === W.FEED_MSG_MAX && long.msg.endsWith('…'), 'uzun düz metin 600 karakterde kesilir');
  ok(W.plainFeed('x', 'dün').at === '' && !W.plainFeed(5).ok && !W.plainFeed('a'.repeat(20001)).ok, 'geçersiz tarih ve tür');
  ok(W.plainFeed('a\u200bb\u202ec').msg === 'abc', 'görünmeyen ve yön karakterleri atılır');
}
// crypto.subtle yok (güvensiz bağlam): bağlantılar yok sayılır
{
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  const v = await W.verifyLink('a.b');
  ok(!v.ok && v.code === 'nocrypto' && !W.cryptoReady(), 'crypto.subtle yokken bağlantı yok sayılır');
  Object.defineProperty(globalThis, 'crypto', desc);
}
// tarayıcı modüllerinde bağlantı yapan kod yok
{
  const src = readFileSync(new URL('../../src/welcome.js', import.meta.url), 'utf8') + readFileSync(new URL('../../src/welcome-ui.js', import.meta.url), 'utf8');
  ok(!/subtle\.sign\(|generateKey|buildLink|encodePayload|canonical\(|welcome-make|Birine özel/.test(src), 'src/ içinde bağlantı yapan kod yok');
}

// geliştirme sunucusu app/private/'ı (özel imza anahtarı) sunmaz: Vite yasak listesi ve varsayılan kalıplar.
// Yapılandırma içe aktarılır (vite paketi gerekir: npm ci); paket kurulu değilse dosyanın metnindeki liste denetlenir.
{
  let deny = null;
  try { deny = (await import('../../vite.config.js')).default?.server?.fs?.deny || []; }
  catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  if (!deny) {
    const m = /deny\s*:\s*\[([^\]]*)\]/.exec(readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8'));
    deny = m ? [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]) : [];
  }
  ok(deny.includes('**/private/**'), 'vite server.fs.deny app/private/ klasörünü yasaklar');
  ok(['.env', '.env.*', '*.{crt,pem}', '**/.git/**'].every(p => deny.includes(p)), 'vite varsayılan yasak kalıpları korunur');
}

console.log(`welcome-test: ${passes} geçti, ${fails} hata`);
process.exit(fails ? 1 : 0);
