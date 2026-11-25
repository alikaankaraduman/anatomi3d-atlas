// Beyin modu lomber ponksiyon adımı telefonda ("gerektiğinde yükle" açık): kas ve eklem sistemi istenip yüklenmeli,
// iğne noktaları sistemler yüklendikten sonra yeniden hesaplanmalı (deri noktası sırt kaslarından). Önce geliştirme
// sunucusu ve başsız Edge (README.md). Kullanım: node brainlp.mjs [adres]
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/';
const c = await connect();
await c.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 812 });
await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// düşük bellekli cihaz: uygulama sistemleri gerektiğinde yükler (main.js lazyDefault)
await c.send('Page.enable', {});
const inj = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2, configurable: true });" });
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);   // yeni belge: yalnız karma değişirse betik çalışmaz
await c.send('Page.navigate', { url: ORIGIN + '#m=brain:csf' });
const st = () => c.evalJs(`(() => { const A = window.__anatomi; return A ? { loaded: { ...A.model.loaded }, prim: A.state.primary?.type } : null; })()`).catch(() => null);
let s = null;
for (let i = 0; i < 120; i++) { await c.sleep(1000); s = await st(); if (s?.prim === 'brain') break; }
console.log('giriş:', JSON.stringify(s));
await c.sleep(2000);
// son adım lomber ponksiyon
await c.evalJs(`(() => { const li = [...document.querySelectorAll('#info [data-step]')]; li[li.length - 1]?.click(); return li.length; })()`);
const lpText = () => c.evalJs(`(() => { const i = document.getElementById('info'); return { txt: (i.querySelector('.htext.dim')?.textContent || ''), labels: [...document.querySelectorAll('#labels .lab, #labels > *')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 8), toast: document.getElementById('toast')?.hidden ? '' : document.getElementById('toast')?.textContent }; })()`);
console.log('hemen:', JSON.stringify(await st()), JSON.stringify(await lpText()));
for (let i = 0; i < 120; i++) { await c.sleep(1000); s = await st(); if (s.loaded.muscle && s.loaded.joint) break; }
await c.sleep(3000);
console.log('sonra:', JSON.stringify(s), JSON.stringify(await lpText()));
await c.shot(new URL('./brainlp.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
console.log('errors', JSON.stringify(c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10)));
await c.send('Emulation.clearDeviceMetricsOverride', {});
await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
c.close();
