// Bir sistemin modeli inemezse (ör. bağlantı koptu) o sisteme bağlı mod sessiz kalmamalı: kas modeli engellenir,
// "gerektiğinde yükle" açıkken (düşük bellek taklidi) hareket sistemi moduna girilir, bildirim beklenir.
// Önce geliştirme sunucusu ve başsız Edge (README.md). Kullanım: node loadfail.mjs [adres]
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/';
const c = await connect();
await c.send('Page.enable', {}); await c.send('Network.enable', {});
await c.send('Network.setBlockedURLs', { urls: ['*muscles.glb*'] });
await c.send('Network.setCacheDisabled', { cacheDisabled: true });
const inj = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2, configurable: true });" });
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);
await c.send('Page.navigate', { url: ORIGIN });
for (let i = 0; i < 90; i++) { await c.sleep(1000); if (await c.evalJs(`!!window.__anatomi?.model.loaded.bone`).catch(() => false)) break; }
await c.sleep(1500);
await c.evalJs(`(() => { location.hash = '#m=loco:'; return 1; })()`);
const seen = new Set();
for (let i = 0; i < 40; i++) {
  await c.sleep(500);
  const t = await c.evalJs(`(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; })()`);
  if (t) seen.add(t);
  if ([...seen].some(x => /yüklenemedi/.test(x))) break;
}
const st = await c.evalJs(`(() => { const A = window.__anatomi; return JSON.stringify({ failed: [...A.model.failed], prim: A.state.primary?.type || null }); })()`);
console.log(JSON.stringify({ toasts: [...seen], st }));
await c.send('Network.setBlockedURLs', { urls: [] });
await c.send('Network.setCacheDisabled', { cacheDisabled: false });
await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
c.close();
