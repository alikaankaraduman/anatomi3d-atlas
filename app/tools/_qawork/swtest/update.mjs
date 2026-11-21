import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const c = await connect(); const out = {};
const bar = `(async () => { const reg = await navigator.serviceWorker.getRegistration(); const b = document.getElementById('update-bar'); const ks = await caches.keys();
  return { url: location.href, barExists: !!b, barHidden: b ? b.hidden : null, barText: b ? b.innerText : null, waiting: !!(reg && reg.waiting), installing: !!(reg && reg.installing), active: reg && reg.active && reg.active.scriptURL, controller: !!navigator.serviceWorker.controller, caches: ks,
    tours: Object.keys((window.__anatomi && window.__anatomi.tours) || {}), modes: [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(t => /Situs|Göğüs|Ürogenital|Baş-boyun/.test(t)).slice(0, 6) }; })()`;
await c.send('Page.navigate', { url: process.argv[2] || 'http://localhost:4180/' });
await c.sleep(6000);
out.afterLoad = await c.evalJs(bar);
for (let i = 0; i < 40 && !(out.afterWait && out.afterWait.waiting && out.afterWait.barHidden === false); i++) { await c.sleep(1500); out.afterWait = await c.evalJs(bar); }
await c.shot(here('update-before.png'));
out.click = await c.evalJs(`(() => { const b = document.querySelector('#update-bar button'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
await c.sleep(9000);
out.afterClick = await c.evalJs(bar).catch(e => String(e));
await c.sleep(4000);
out.final = await c.evalJs(bar).catch(e => String(e));
await c.shot(here('update-after.png'));
out.errors = c.errors().slice(0, 10);
console.log(JSON.stringify(out, null, 1)); c.close();
