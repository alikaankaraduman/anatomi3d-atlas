// Kişisel bağlantı oluşturma yardımcıları: YALNIZ Node (tarayıcı paketine girmez; uygulama yalnız denetler,
// src/welcome.js verifyLink). Kanonik JSON, base64url yük ve ECDSA P-256 / SHA-256 imzası.
// Özel anahtar bu dosyada ya da herhangi bir depoda değildir: imzalayan çağıran tarafından verilir (yayının sahibi onu
// kendi bilgisayarındaki git dışı bir dosyadan okuyan bir araç kullanır; sınamalar her çalıştırmada atılacak bir
// anahtar üretir). Bu dosyanın kendisi herkese açık olabilir: anahtar olmadan bununla geçerli bir bağlantı yapılamaz.
import { FIELDS, VERSION, validate, toB64url } from '../src/welcome.js';

const { subtle } = globalThis.crypto;

// Kanonik JSON: alanlar sabit sırayla, boş alanlar yok (aynı içerik her zaman aynı metni verir)
export function canonical(data) {
  const o = { v: VERSION };
  for (const k of FIELDS) if (data[k]) o[k] = data[k];
  return JSON.stringify(o);
}

// Veriyi denetler (uygulamayla aynı kurallar) ve base64url yüke çevirir; geçersizse hata fırlatır
// (e.code: alan adı, e.message Türkçe ve ayrıntılı)
export function encodePayload(input) {
  const r = validate({ ...input, v: VERSION });
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
  return { payload: toB64url(new TextEncoder().encode(canonical(r.data))), data: r.data };
}

// JWK (d alanı olan) -> imzalama anahtarı. Anahtar dışa aktarılamaz olarak içe alınır.
export function importPrivate(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') throw new Error('Anahtar dosyası geçerli bir ECDSA P-256 özel anahtarı değil.');
  return subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: false }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Yük metnini imzalar: "<yük>.<imza>"
export async function signPayload(payload, privateKey) {
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(payload)));
  return payload + '.' + toB64url(sig);
}

// Sitenin adresi (var olan parça atılır) + #g=<yük>.<imza>
export function buildLink(base, signed) {
  return String(base).split('#')[0] + '#g=' + signed;
}

// Bir veriyi tek adımda imzalı bağlantıya çevirir
export async function makeLink(base, data, privateKey) {
  const { payload, data: clean } = encodePayload(data);
  const signed = await signPayload(payload, privateKey);
  return { link: buildLink(base, signed), signed, data: clean };
}
