// Küçük statik sunucu: app/dist klasörünü, içindeki _headers dosyasının kurallarıyla (Netlify biçimi) sunar.
// Amaç: yayın başlıklarını (Content-Security-Policy vb.) yayından önce yerelde sınamak; hiçbir paket gerekmez.
// Netlify gibi _headers ve _redirects dosyalarının kendisini sunmaz (404).
// Kullanım: node serve.mjs [port] [--inject]   (varsayılan port 4190)
//   --inject: Netlify'ın ücretsiz planda yayındaki sayfaya yaptığı eki taklit eder (bir yorum satırı ve rozet betiği
//             etiketi; index.html'in baytları değişir). Rozet betiğinin kendisi, varsa
//             data/work/publish/hud.js kopyasından sunulur (yalnız yerel sınama için indirilmiş kopya).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, extname, sep } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = join(here, '..', '..', '..');
const root = join(app, 'dist');
const args = process.argv.slice(2);
const INJECT = args.includes('--inject');
const port = Number(args.find(a => /^\d+$/.test(a)) || 4190);
const HUD = join(app, '..', 'data', 'work', 'publish', 'hud.js');
const SITE = '00000000-0000-4000-8000-000000000000';

// _headers: girintisiz satır = yol kuralı ("/*", "/assets/*", "/sw.js"); altındaki girintili "Ad: değer" satırları o
// kuralın başlıkları; "#" ile başlayan satırlar yorum
function rules() {
  const file = join(root, '_headers');
  if (!existsSync(file)) return [];
  const out = []; let cur = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (raw[0] !== ' ' && raw[0] !== '\t') { cur = { for: line, values: {} }; out.push(cur); continue; }
    const i = line.indexOf(':');
    if (cur && i > 0) cur.values[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const match = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};
const HIDDEN = new Set(['/_headers', '/_redirects']);
const inject = html => html
  .replace('<head>', '<head>\n<!-- This site is hosted on Netlify (yerel taklit: serve.mjs --inject). -->')
  .replace('</body>', `<script async src="/.netlify/scripts/hud?variant=public" data-nf-variant="public" data-netlify-site-id="${SITE}" data-app-host="app.netlify.com" data-account-tier="free"></script>\n</body>`);

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const headers = { 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const r of rules()) if (match(r.for, path)) Object.assign(headers, r.values);
  if (INJECT && path === '/.netlify/scripts/hud' && existsSync(HUD)) {
    res.writeHead(200, { ...headers, 'Content-Type': TYPES['.js'] }); res.end(readFileSync(HUD)); return;
  }
  const file = normalize(join(root, path));
  if (HIDDEN.has(path) || !file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return;
  }
  let body = readFileSync(file);
  if (INJECT && path.endsWith('.html')) body = Buffer.from(inject(body.toString('utf8')));   // Netlify eki HER HTML sayfasına yapar
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...headers }); res.end(body);
}).listen(port, () => console.log('dist + _headers' + (INJECT ? ' + barındırıcı eki taklidi' : '') + ': http://localhost:' + port + '/'));
