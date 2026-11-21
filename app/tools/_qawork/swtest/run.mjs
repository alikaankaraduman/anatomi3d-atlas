import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const phase = process.argv[2] || 'first', ORIGIN = process.argv[3] || 'http://localhost:4180/';
const c = await connect();
const out = { phase };
const state = `(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const ks = await caches.keys(); const sizes = {};
  for (const k of ks) sizes[k] = (await (await caches.open(k)).keys()).length;
  const A = window.__anatomi;
  return { url: location.href, title: document.title, sw: reg ? { scope: reg.scope, active: reg.active && reg.active.state, waiting: !!reg.waiting, installing: !!reg.installing } : null,
    controller: !!navigator.serviceWorker.controller, caches: sizes, anatomi: !!A, loaded: A ? A.model.loaded : null,
    canvas: !!document.querySelector('canvas'), notice: [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /Yeni sürüm|Çevrimdışı|çevrimdışı/.test(e.textContent)).map(e => e.textContent.trim()).slice(0, 6) };
})()`;
const waitLoaded = async (max = 120) => { for (let i = 0; i < max; i++) { const ok = await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()`).catch(() => false); if (ok) return i; await c.sleep(1000); } return -1; };
if (phase === 'first') {
  await c.send('Page.navigate', { url: ORIGIN });
  await c.sleep(4000);
  out.ready = await c.evalJs(`Promise.race([navigator.serviceWorker.ready.then(r => 'ready:' + (r.active && r.active.state)), new Promise(r => setTimeout(() => r('timeout'), 30000))])`);
  out.loadedAfterS = await waitLoaded();
  await c.sleep(3000);
  out.state = await c.evalJs(state);
  await c.shot(here('first.png'));
} else if (phase === 'reload') {
  await c.send('Page.reload', {});
  await c.sleep(5000);
  out.loadedAfterS = await waitLoaded(90);
  out.state = await c.evalJs(state);
  await c.shot(here((process.argv[4] || 'reload') + '.png'));
} else if (phase === 'state') {
  out.state = await c.evalJs(state);
  await c.shot(here('state.png'));
} else if (phase === 'eval') {
  out.value = await c.evalJs(process.argv[4]);
}
out.errors = c.errors().slice(0, 12);
console.log(JSON.stringify(out, null, 1));
c.close();
