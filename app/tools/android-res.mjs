// Android uygulama kaynakları: başlatıcı simgeleri ve eski (Android 11 ve öncesi) açılış görüntüleri.
// Şekiller public/favicon.svg ile tools/icons.mjs'deki şekillerin aynısıdır (yuvarlak köşeli kare, kemik, mavi nokta);
// tarayıcı ve PNG kodlayıcı tools/icons.mjs'den alındı (o dosya bir şey dışa aktarmadığı ve çalıştırıldığında PWA
// simgelerini yazdığı için burada kopyası var; şekil ya da renk değişirse iki dosya birlikte değiştirilmeli).
// Paket gerekmez (Node 24). Çalıştırma, app/ klasöründe: npm run android:res  (ya da node tools/android-res.mjs)
// Yazdıkları (hepsi android/app/src/main/res/ altında, var olan Capacitor varsayılanlarının üstüne):
//   mipmap-<yoğunluk>/ic_launcher.png             eski simge (API 24-25): yuvarlak köşeli koyu kare, 48 dp
//   mipmap-<yoğunluk>/ic_launcher_round.png       yuvarlak eski simge, 48 dp
//   mipmap-<yoğunluk>/ic_launcher_foreground.png  uyarlanabilir simgenin ön katmanı (API 26+): 108 dp tuval, saydam,
//                                                 işaret ortadaki 66 dp güvenli dairenin içinde
//   mipmap-<yoğunluk>/ic_launcher_monochrome.png  Android 13+ temalı simge katmanı (yalnız alfa önemlidir)
//   drawable*/splash.png                          var olan her açılış görüntüsü kendi boyutunda: koyu zemin, ortada işaret
// Arka plan rengi (#26282d) values/ic_launcher_background.xml ve values/colors.xml'de; uyarlanabilir simgeyi
// mipmap-anydpi-v26/*.xml birleştirir. Her yazılan PNG'nin IHDR boyutu geri okunup denetlenir.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x26, 0x28, 0x2d], BONE = [0xe9, 0xdf, 0xc8], ACC = [0x19, 0xc8, 0xf5], WHITE = [255, 255, 255];
// favicon.svg ile aynı şekiller, 32 birimlik tuvalde
const SHAPES = [
  { k: 'rr', x: 14, y: 8, w: 4, h: 16, r: 2, c: BONE },
  { k: 'c', x: 13, y: 8, r: 3, c: BONE }, { k: 'c', x: 19, y: 8, r: 3, c: BONE },
  { k: 'c', x: 13, y: 24, r: 3, c: BONE }, { k: 'c', x: 19, y: 24, r: 3, c: BONE },
  { k: 'c', x: 25, y: 7, r: 3, c: ACC },
];
// İşaretin sınır kutusu x 10..28, y 4..27; merkezi (19, 15.5). Bu merkezden en uzak nokta 13.4 birim uzaktadır
// (mavi noktanın ve sol alt kemik ucunun dış kenarı), yani işaret 13.4 birim yarıçaplı bir daireye sığar.
const MARK_CX = 19, MARK_CY = 15.5, MARK_R = 13.4, MARK_H = 23;
const inRR = (px, py, x, y, w, h, r) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

// w, h: piksel. unit: bir şekil biriminin piksel karşılığı; işaretin merkezi tuvalin ortasına gelir.
// bg: 'none' (saydam), 'full' (her yer zemin rengi), 'rr' (yuvarlak köşeli kare, köşe yarıçapı tuvalin 7/32'si),
// 'circle'. mono: true ise şekiller beyaz çizilir (temalı simge için).
function render(w, h, { unit, bg = 'none', mono = false }) {
  const px = Buffer.alloc(w * h * 4), S = 4;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
      const x = i + (si + 0.5) / S, y = j + (sj + 0.5) / S;
      let col = null;
      if (bg === 'full') col = BG;
      else if (bg === 'rr') { if (inRR(x / w * 32, y / h * 32, 0, 0, 32, 32, 7)) col = BG; }
      else if (bg === 'circle') { if ((x - w / 2) ** 2 + (y - h / 2) ** 2 <= (Math.min(w, h) / 2) ** 2) col = BG; }
      // şekil koordinatları: tuvalin ortası işaretin merkezine denk gelir
      const u = MARK_CX + (x - w / 2) / unit, v = MARK_CY + (y - h / 2) / unit;
      // saydam zeminde şekiller tek başına çizilir; zeminli simgede yalnız zeminin içinde
      const inside = bg === 'none' || col;
      for (const s of SHAPES) {
        const hit = s.k === 'c' ? (u - s.x) ** 2 + (v - s.y) ** 2 <= s.r * s.r : inRR(u, v, s.x, s.y, s.w, s.h, s.r);
        if (hit && inside) col = mono ? WHITE : s.c;
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const o = (j * w + i) * 4, cov = a / 255 || 1;
    // önceden çarpılmamış renk: kenarda yalnız örtülen alt örneklerin ortalaması
    px[o] = Math.round(r / cov); px[o + 1] = Math.round(g / cov); px[o + 2] = Math.round(b / cov); px[o + 3] = Math.round(a / (S * S));
  }
  return png(w, h, px);
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// PNG imzasını ve IHDR'deki genişlik/yüksekliği okur
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const RES = new URL('../android/app/src/main/res/', import.meta.url);
if (!existsSync(RES)) { console.error('android/app/src/main/res yok: önce "npx cap add android" çalıştırılmalı.'); process.exit(1); }
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const written = [];
function put(rel, buf, w, h) {
  const url = new URL(rel, RES);
  writeFileSync(url, buf);
  const back = pngSize(readFileSync(url));
  if (!back || back[0] !== w || back[1] !== h) throw new Error(`${rel}: geri okunan boyut ${back} beklenen ${w}x${h} değil`);
  written.push(`${rel} ${w}x${h} ${buf.length} bayt`);
}

for (const [d, k] of Object.entries(DENSITY)) {
  const icon = Math.round(48 * k), fg = Math.round(108 * k);
  // eski kare simge: zemin bütün tuvali doldurur (PWA'daki icon-192 gibi), işaret %90 boyda
  put(`mipmap-${d}/ic_launcher.png`, render(icon, icon, { unit: icon / 32 * 0.9, bg: 'rr' }), icon, icon);
  // yuvarlak simge: işaret dairenin içinde kenardan pay bırakır (13.4 birim -> yarıçapın %70'i)
  put(`mipmap-${d}/ic_launcher_round.png`, render(icon, icon, { unit: icon / 2 * 0.7 / MARK_R, bg: 'circle' }), icon, icon);
  // uyarlanabilir ön katman: 108 dp tuvalde güvenli bölge ortadaki 66 dp çaplı dairedir; işaret 31 dp yarıçapa sığar
  const fgUnit = 31 * k / MARK_R;
  put(`mipmap-${d}/ic_launcher_foreground.png`, render(fg, fg, { unit: fgUnit }), fg, fg);
  put(`mipmap-${d}/ic_launcher_monochrome.png`, render(fg, fg, { unit: fgUnit, mono: true }), fg, fg);
}

// Eski açılış görüntüleri: var olan her drawable*/splash.png kendi boyutunda yeniden çizilir. İşaret 80 dp yüksekliğindedir;
// klasör adında yoğunluk yoksa (drawable/) mdpi sayılır.
for (const dir of readdirSync(RES, { withFileTypes: true })) {
  if (!dir.isDirectory() || !dir.name.startsWith('drawable')) continue;
  const rel = `${dir.name}/splash.png`;
  if (!existsSync(new URL(rel, RES))) continue;
  const size = pngSize(readFileSync(new URL(rel, RES)));
  if (!size) throw new Error(`${rel}: PNG okunamadı`);
  const d = Object.keys(DENSITY).find(x => dir.name.split('-').includes(x)) || 'mdpi';
  const unit = 80 * DENSITY[d] / MARK_H;
  put(rel, render(size[0], size[1], { unit, bg: 'full' }), size[0], size[1]);
}

for (const line of written) console.log(line);
console.log(`${written.length} PNG yazıldı ve IHDR boyutları denetlendi.`);
