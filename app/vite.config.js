// Vite yapılandırması.
// base './': derlenmiş uygulama her yoldan çalışır (GitHub Pages alt yolu, Capacitor WebView, yerel klasör).
// anatomiSW: derlemenin sonunda (1) yayına çıkmaması gereken iç alanları dist'teki veri kopyalarından siler,
// (2) dist/lisanslar.txt dosyasını yazar, (3) dist/sw.js'e dosya listesini ve sürümü yazar (service worker, public/sw.js).
// ANATOMI_TARGET=pages ile derlenince (GitHub Pages) her .html dosyasına robots ve Content-Security-Policy meta etiketi de
// eklenir (pagesMeta); değişken yoksa derleme bundan hiç etkilenmez.
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { licensesText } from './tools/licenses.mjs';

const MARK = 'self.__BUILD__ = null;';

// Barındırıcının yapılandırma dosyaları: dist'te durur ama dosya olarak sunulmaz (Netlify 404 verir). Service worker
// listesine girerlerse kurulumdaki tek bir başarısız indirme bütün çevrimdışı kurulumu düşürür.
const HOST_FILES = new Set(['_headers', '_redirects']);

// Yalnız geliştirme için tutulan alanlar: public/data içindeki kaynak dosyalarda kalır, yayın kopyasından (dist) silinir.
// Hiçbiri uygulama kodunda okunmaz (src içinde kullanımları yoktur).
//  - source / date : verinin hangi iş klasöründen ve ne zaman derlendiği (data/work/... yolları)
//  - aanki.json topics[].note : konu eşleştirme notları (İngilizce çalışma notu)
//  - sections.json levels[].model_level : kesit seviyesinin modeldeki koordinat notu
// aanki.json'daki "source" kalır: Fachschaft'ın herkese açık wiki ve tablosuna yapılan kaynak göstermedir.
const BOOKKEEPING = ['brain', 'muscles', 'locomotor', 'situs', 'thorax', 'uro', 'head', 'vessels', 'lymph'];
const INTERNAL = {
  ...Object.fromEntries(BOOKKEEPING.map(k => [`data/${k}.json`, d => { delete d.source; delete d.date; }])),
  'data/aanki.json': d => { for (const t of d.topics || []) delete t.note; },
  'data/sections.json': d => { for (const r of d.regions || []) for (const l of r.levels || []) delete l.model_level; },
};

// GitHub Pages yanıt başlığı gönderemez (public/_headers orada okunmaz): Pages derlemesinde politika HTML'e meta etiketi
// olarak yazılır. Politika _headers'takinin sıkı hâlidir: Pages sayfaya betik eklemez, bu yüzden betikte 'unsafe-inline'
// ve form-action'da istisna gerekmez. frame-ancestors meta etiketinde geçersizdir, bu yüzden yoktur.
// noindex: adres yalnız paylaşıldığı yerden açılsın, arama motorları dizine eklemesin (açmak ayrı bir karardır).
const PAGES = process.env.ANATOMI_TARGET === 'pages';
const PAGES_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

// Meta etiketleri <meta charset> satırının hemen ardına girer: CSP meta etiketi yalnız kendisinden sonra gelen öğeleri
// kapsar. Sayfada zaten olan etiket (gizlilik.html'deki robots) yinelenmez.
function pagesMeta(html, file) {
  const m = html.match(/<meta\s+charset=[^>]*>/i);
  if (!m) throw new Error(`${file}: <meta charset> yok, meta etiketleri eklenemedi`);
  const tags = [];
  if (!/<meta\s+name=["']robots["']/i.test(html)) tags.push('<meta name="robots" content="noindex">');
  if (!/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(html)) tags.push(`<meta http-equiv="Content-Security-Policy" content="${PAGES_CSP}">`);
  const at = m.index + m[0].length;
  return html.slice(0, at) + tags.map(t => '\n' + t).join('') + html.slice(at);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Her dosyanın içerik özeti (sha256'nın ilk 12 hanesi) ve boyutu. Service worker önbellek anahtarına özeti ekler
// (ör. data/meta.json?v=ab12…): yeni derlemede değişen dosya yeniden indirilir, değişmeyen eski önbellekten alınır.
// Modeller (models/*.glb) ilk açılışta önbelleğe alınmaz, kullanıldıkça ya da "Hepsini indir" ile gelir.
function anatomiSW() {
  let outDir = 'dist', root = process.cwd();
  return {
    name: 'anatomi-sw',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); root = c.root; },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) { this.warn('dist/sw.js yok: service worker listesi yazılmadı'); return; }
      // lisans metni dist'e dokunmadan önce hesaplanır: bir paket eksikse derleme yarım bir dist bırakmadan durur
      let licences;
      try { licences = licensesText(root); } catch (e) { this.error('lisanslar.txt üretilemedi (node_modules eksik olabilir): ' + e.message); return; }
      // (1) iç alanlar: dist kopyasından silinir (kaynak dosya değişmez)
      for (const [rel, strip] of Object.entries(INTERNAL)) {
        const p = join(outDir, rel);
        if (!existsSync(p)) { this.warn(`${rel} yok: iç alanlar silinemedi`); continue; }
        const d = JSON.parse(readFileSync(p, 'utf8'));
        strip(d);
        writeFileSync(p, JSON.stringify(d));
      }
      // (2) model kaynakları ve paketlenen kütüphanelerin lisans metinleri
      writeFileSync(join(outDir, 'lisanslar.txt'), licences);
      // (2b) GitHub Pages hedefi: her .html dosyasına politika meta etiketleri (listeden önce: özetler son hâle uysun)
      if (PAGES) {
        let n = 0;
        for (const p of walk(outDir).filter(f => f.endsWith('.html'))) {
          try { writeFileSync(p, pagesMeta(readFileSync(p, 'utf8'), relative(outDir, p))); n++; } catch (e) { this.error(e.message); return; }
        }
        console.log(`[anatomi-sw] GitHub Pages hedefi: ${n} HTML dosyasına robots ve CSP meta etiketi eklendi`);
      }
      // (3) service worker dosya listesi
      const files = {};
      for (const p of walk(outDir).sort()) {
        const rel = relative(outDir, p).split(sep).join('/');
        if (rel === 'sw.js' || rel.endsWith('.map') || HOST_FILES.has(rel)) continue;
        const buf = readFileSync(p);
        files[rel] = [createHash('sha256').update(buf).digest('hex').slice(0, 12), buf.length];
      }
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 10);
      // tarih yazılmaz: sw.js'in baytları yalnız dosya özetlerine bağlı kalsın (değişmeyen bir yeniden derleme
      // "Yeni sürüm hazır" göstermesin)
      // index.html'in başvurduğu, adında özet taşıyan giriş dosyaları: service worker, barındırıcının yolda değiştirdiği
      // bir index.html'in yine de bu sürüme ait olduğunu bunlardan anlar (public/sw.js, sameBuildPage)
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const entry = Object.keys(files).filter(f => f.startsWith('assets/') && html.includes(f));
      if (!entry.length) this.warn('index.html hiçbir assets/ dosyasına başvurmuyor: barındırıcının değiştirdiği sayfa kabul edilemez');
      const build = { version, files, entry };
      const src = readFileSync(swPath, 'utf8');
      if (!src.includes(MARK)) { this.error('public/sw.js içinde "' + MARK + '" satırı yok'); return; }
      writeFileSync(swPath, src.replace(MARK, `self.__BUILD__ = ${JSON.stringify(build)};`));
      const mb = Object.values(files).reduce((a, [, n]) => a + n, 0) / 1048576;
      console.log(`[anatomi-sw] sürüm ${version}: ${Object.keys(files).length} dosya, ${mb.toFixed(1)} MB`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [anatomiSW()],
});
