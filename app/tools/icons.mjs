// Uygulama simgeleri (PWA ve iOS): public/favicon.svg'deki şekiller (yuvarlak köşeli kare, kemik, mavi nokta) burada
// analitik olarak PNG'ye çizilir. Hiçbir paket gerekmez: kenarlar 4x4 alt örneklemeyle yumuşatılır, PNG node:zlib ile yazılır.
// Çalıştırma: node tools/icons.mjs  ->  public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x22, 0x25, 0x2b], BONE = [0xe9, 0xdf, 0xc8], ACC = [0x19, 0xc8, 0xf5];
// favicon.svg ile aynı şekiller, 32 birimlik tuvalde
const SHAPES = [
  { k: 'rr', x: 14, y: 8, w: 4, h: 16, r: 2, c: BONE },
  { k: 'c', x: 13, y: 8, r: 3, c: BONE }, { k: 'c', x: 19, y: 8, r: 3, c: BONE },
  { k: 'c', x: 13, y: 24, r: 3, c: BONE }, { k: 'c', x: 19, y: 24, r: 3, c: BONE },
  { k: 'c', x: 25, y: 7, r: 3, c: ACC },
];
const inRR = (px, py, x, y, w, h, r) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};
// size: piksel; bgRound: arka plan köşe yarıçapı (32 birimde; 0 = tam kare); scale: içeriğin ölçeği (merkeze göre)
function render(size, { bgRound = 7, scale = 1, transparent = true } = {}) {
  const px = Buffer.alloc(size * size * 4), S = 4;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
      const u = (i + (si + 0.5) / S) / size * 32, v = (j + (sj + 0.5) / S) / size * 32;
      let col = null;
      if (inRR(u, v, 0, 0, 32, 32, bgRound)) col = BG;
      // içerik merkez (16,16) etrafında ölçeklenir
      const cu = 16 + (u - 16) / scale, cv = 16 + (v - 16) / scale;
      for (const s of SHAPES) {
        const hit = s.k === 'c' ? (cu - s.x) ** 2 + (cv - s.y) ** 2 <= s.r * s.r : inRR(cu, cv, s.x, s.y, s.w, s.h, s.r);
        if (hit && col) col = s.c;
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
      else if (!transparent) { r += BG[0]; g += BG[1]; b += BG[2]; a += 255; }
    }
    const n = S * S, o = (j * size + i) * 4, al = a / n;
    // önceden çarpılmamış renk: kenarda yalnız örtülen alt örneklerin ortalaması
    const cov = a / 255 || 1;
    px[o] = Math.round(r / cov); px[o + 1] = Math.round(g / cov); px[o + 2] = Math.round(b / cov); px[o + 3] = Math.round(al);
  }
  return png(size, size, px);
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

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'icon-192.png': render(192),
  'icon-512.png': render(512),
  // maskelenebilir: tam kare arka plan, içerik güvenli alanın (çapın %80'i) içinde
  'maskable-512.png': render(512, { bgRound: 0, scale: 0.72, transparent: false }),
  // iOS köşeleri kendisi yuvarlar ve saydamlığı siyaha boyar: tam kare, saydamsız
  'apple-touch-icon.png': render(180, { bgRound: 0, scale: 0.82, transparent: false }),
};
for (const [name, buf] of Object.entries(files)) { writeFileSync(new URL(name, out), buf); console.log(name, buf.length, 'bayt'); }
