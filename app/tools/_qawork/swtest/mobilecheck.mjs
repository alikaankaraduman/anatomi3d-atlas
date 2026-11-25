// Telefon genişliğinde (375x812, dokunmatik) bütün çalışma modlarını derin bağlantılarla açar; sayfada ya da bilgi
// panelinde yatay taşma ve konsol hatası arar, her mod için bir ekran görüntüsü yazar (mobile-<n>.png, bu klasörde).
// Önce geliştirme sunucusu ya da yayın adresi ve başsız Edge (README.md). Kullanım: node mobilecheck.mjs [adres]
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2] || 'http://localhost:5173/';
const HASHES = ['', '#m=heart:flow', '#m=brain:nerves', '#m=loco:passages', '#m=patho:mca-links', '#m=patho:erb-obere-plexuslaesion', '#m=patho:koniotomie-ligamentum-cricothyroideum',
  '#m=move:', '#m=move:leg.hFlex', '#m=move:spine.cRot', '#m=situs:arteries', '#m=sect:thx-heart', '#m=exam', '#t=abp-01'];
const c = await connect();
await c.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);   // yeni belge: aynı adreste yalnız karma değişirse sayfa yenilenmez
await c.send('Page.navigate', { url: ORIGIN });
for (let i = 0; i < 90; i++) { await c.sleep(1000); const ok = await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).every(Boolean) && Object.keys(A.model.loaded).length >= 6; })()`).catch(() => false); if (ok) break; }
const out = [];
for (const [i, h] of HASHES.entries()) {
  await c.evalJs(`(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); location.hash = ${JSON.stringify(h)}; return 1; })()`);
  await c.sleep(6000);
  const r = await c.evalJs(`(() => { const de = document.documentElement, info = document.getElementById('info');
    const wide = [...document.querySelectorAll('#info *, dialog[open] *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 30));
    return { hash: location.hash, pageOverflow: de.scrollWidth - innerWidth, infoOverflow: info ? info.scrollWidth - info.clientWidth : null, wide }; })()`).catch(e => ({ err: String(e) }));
  await c.shot(here(`mobile-${i}.png`));
  out.push(r);
}
console.log(JSON.stringify({ out, errors: c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10) }, null, 1));
await c.send('Emulation.clearDeviceMetricsOverride', {});
c.close();
