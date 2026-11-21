// Yayındaki sitenin kendi içinde tutarlı olduğunu denetler (yerel derlemeyle karşılaştırmadan): sitedeki sw.js'in
// dosya listesindeki her dosyayı indirir ve listedeki özet ve boyutla karşılaştırır. Bulutta derlenen siteler (GitHub
// Pages) için kullanılır: orada derleme başka bir makinede yapıldığından yerel dist ile bayt bayt aynı olması beklenmez.
// HTML dosyalarında barındırıcının eki (ör. Netlify rozeti) özet farkı yaratabilir; onlar ayrıca bildirilir.
// Kullanım: node verify-live.mjs <adres>
import { createHash } from 'node:crypto';
const ORIGIN = (process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(ORIGIN)) { console.error('adres gerekli'); process.exit(2); }
const sw = await (await fetch(ORIGIN + 'sw.js', { cache: 'no-store' })).text();
const m = sw.match(/self\.__BUILD__ = (\{.*?\});/s);
if (!m) { console.error('sw.js içinde dosya listesi yok'); process.exit(1); }
const B = JSON.parse(m[1]);
const names = Object.keys(B.files);
const out = { origin: ORIGIN, version: B.version, files: names.length, entry: B.entry, ok: 0, htmlDiffers: [], bad: [], bytes: 0 };
const queue = [...names];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const p = queue.shift();
    try {
      const r = await fetch(ORIGIN + p + '?v=' + B.files[p][0], { cache: 'no-store' });
      const buf = Buffer.from(await r.arrayBuffer());
      out.bytes += buf.length;
      const h = createHash('sha256').update(buf).digest('hex').slice(0, 12);
      if (r.status === 200 && h === B.files[p][0] && buf.length === B.files[p][1]) out.ok++;
      else if (r.status === 200 && p.endsWith('.html')) out.htmlDiffers.push(p + ' (' + (buf.length - B.files[p][1]) + ' bayt fark)');
      else out.bad.push(`${p}: durum ${r.status}, ${buf.length} bayt (beklenen ${B.files[p][1]})`);
    } catch (e) { out.bad.push(p + ': ' + String(e).slice(0, 100)); }
  }
}));
const head = async p => { const r = await fetch(ORIGIN + p, { cache: 'no-store', redirect: 'manual' }); const t = await r.text(); return { status: r.status, type: r.headers.get('content-type'), text: t }; };
const idx = await head('');
out.root = { status: idx.status, type: idx.type, robots: /<meta name="robots" content="noindex">/.test(idx.text), cspMeta: /http-equiv="Content-Security-Policy"/.test(idx.text), hostScript: /netlify|\.netlify\/scripts/.test(idx.text) };
out.types = { manifest: (await head('manifest.webmanifest')).type, licences: (await head('lisanslar.txt')).type, model: (await head('models/bones.glb')).type };
out.hidden = {};
for (const p of ['package.json', 'src/main.js', '.git/config', 'foo/bar']) out.hidden[p] = (await head(p)).status;
out.mb = +(out.bytes / 1048576).toFixed(1); delete out.bytes;
console.log(JSON.stringify(out, null, 1));
process.exit(out.bad.length ? 1 : 0);
