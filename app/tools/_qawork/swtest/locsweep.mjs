// Patoloji 3B görevi taramasını başsız Edge'de çalıştırır (uygulama içi tarayıcı gizliyken requestAnimationFrame durur,
// kamera uçmaz). Önce geliştirme sunucusu (npm run dev, 5173) ve başsız Edge (README.md, port CDP_PORT ya da 9333).
// Kullanım: node locsweep.mjs [adres]   (varsayılan http://localhost:5173/)
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/';
const c = await connect();
await c.send('Page.navigate', { url: ORIGIN });
for (let i = 0; i < 90; i++) { await c.sleep(1000); const ok = await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).every(Boolean) && Object.keys(A.model.loaded).length >= 6; })()`).catch(() => false); if (ok) break; }
if (process.env.SEX) { await c.evalJs(`window.__anatomi.actions.setSex('${process.env.SEX}')`); await c.sleep(8000); }   // SEX=f: kadın modeli
await c.evalJs(`(async () => { window.__locSweep = null; const m = await import('/tools/_qawork/patho-loc-sweep.js?raw&t=' + Date.now()); eval(m.default); return 1; })()`);
let res = null;
for (let i = 0; i < 900 && !res; i++) { await c.sleep(2000); res = await c.evalJs('window.__locSweep').catch(() => null); }
console.log(JSON.stringify({ ...res, errors: c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10) }, null, 1));
c.close();
