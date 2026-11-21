// Yayın doğrulaması: verilen adresteki her dosyayı indirir ve içerik özetini yerel derlemenin (dist/sw.js içindeki
// liste) özetiyle karşılaştırır; ayrıca başlıkları ve sunulmaması gereken dosyaları denetler.
// Kullanım: node verify-deploy.mjs <adres>     (ör. https://<site>/)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, '..', '..', '..', 'dist');
const ORIGIN = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(ORIGIN)) { console.error('adres gerekli'); process.exit(2); }

const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
const B = JSON.parse(sw.match(/self\.__BUILD__ = (\{.*?\});/s)[1]);
const names = Object.keys(B.files);
const out = { origin: ORIGIN, version: B.version, files: names.length, ok: 0, bad: [], bytes: 0, types: {} };

const queue = [...names];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const p = queue.shift();
    try {
      const r = await fetch(ORIGIN + p + '?v=' + B.files[p][0], { cache: 'no-store' });
      const buf = Buffer.from(await r.arrayBuffer());
      const h = createHash('sha256').update(buf).digest('hex').slice(0, 12);
      out.bytes += buf.length;
      const ext = p.slice(p.lastIndexOf('.'));
      out.types[ext] = r.headers.get('content-type');
      if (r.status === 200 && h === B.files[p][0] && buf.length === B.files[p][1]) out.ok++;
      else if (r.status === 200 && p === 'index.html' && Array.isArray(B.entry) && B.entry.length && B.entry.every(a => buf.toString('utf8').includes(a))) {
        // barındırıcı sayfaya ek yapmış (ör. Netlify rozeti): service worker da bunu kabul eder (sw.js, sameBuildPage)
        out.ok++;
        const local = readFileSync(join(dist, 'index.html'), 'utf8').split('\n').map(l => l.trim());
        out.hostModifiedIndex = { bytes: buf.length, expected: B.files[p][1], added: buf.toString('utf8').split('\n').map(l => l.trim()).filter(l => l && !local.includes(l)).map(l => l.slice(0, 160)) };
      }
      else if (r.status === 200 && p.endsWith('.html') && p !== 'index.html') {
        // öteki HTML belgeleri: barındırıcı yalnız ekleme yapmışsa (yerel dosyanın her satırı duruyorsa) kabul edilir
        const remote = buf.toString('utf8').split('\n').map(l => l.trim());
        const local = readFileSync(join(dist, p), 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        if (local.every(l => remote.includes(l))) { out.ok++; (out.hostModifiedPages = out.hostModifiedPages || []).push(p + ' (+' + (buf.length - B.files[p][1]) + ' bayt)'); }
        else out.bad.push(`${p}: barındırıcı ekinden başka fark var (${buf.length} bayt, beklenen ${B.files[p][1]})`);
      }
      else out.bad.push(`${p}: durum ${r.status}, özet ${h} (beklenen ${B.files[p][0]}), ${buf.length} bayt (beklenen ${B.files[p][1]})`);
    } catch (e) { out.bad.push(p + ': ' + String(e).slice(0, 120)); }
  }
}));

// sw.js'in kendisi listede yoktur: bayt bayt karşılaştırılır
const swRemote = Buffer.from(await (await fetch(ORIGIN + 'sw.js', { cache: 'no-store' })).arrayBuffer());
out.swSame = swRemote.equals(readFileSync(join(dist, 'sw.js')));

const head = async p => { const r = await fetch(ORIGIN + p, { cache: 'no-store', redirect: 'manual' }); await r.arrayBuffer(); return r; };
const pick = (r, list) => Object.fromEntries(list.map(k => [k, r.headers.get(k)]).filter(([, v]) => v !== null));
const SEC = ['x-robots-tag', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cache-control', 'strict-transport-security', 'content-type'];
const root = await head('');
out.root = { status: root.status, ...pick(root, SEC) };
const asset = names.find(n => n.startsWith('assets/') && n.endsWith('.js'));
out.asset = { path: asset, ...pick(await head(asset), ['cache-control', 'content-type', 'content-encoding', 'x-robots-tag']) };
out.sw = pick(await head('sw.js'), ['cache-control', 'content-type', 'x-robots-tag']);
out.model = pick(await head('models/bones.glb'), ['cache-control', 'content-type', 'content-encoding', 'x-robots-tag']);
out.manifest = pick(await head('manifest.webmanifest'), ['content-type', 'cache-control']);
out.hidden = {};
for (const p of ['_headers', '_redirects', 'netlify.toml', '.netlify/state.json', 'package.json', 'src/main.js', 'foo/bar']) out.hidden[p] = (await head(p)).status;
out.mb = +(out.bytes / 1048576).toFixed(1);
delete out.bytes;
console.log(JSON.stringify(out, null, 1));
process.exit(out.bad.length || !out.swSame ? 1 : 0);
