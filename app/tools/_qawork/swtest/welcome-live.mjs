// Kişisel karşılama bağlantısının yayındaki sitede çalıştığını denetler (uydurma içerikle; kişisel hiçbir şey yok).
// Kullanım: node welcome-live.mjs <adres>     (önce başsız Edge açık olmalı: README.md)
import { connect } from './cdp.mjs';
import { buildLink, STORE_KEY } from '../../../src/welcome.js';
const ORIGIN = process.argv[2];
const link = buildLink(ORIGIN, { to: 'Deneme Kişi', from: 'Deneme Veren', msg: 'Bu bir deneme notudur.\nİkinci satır: çğıöşü.', date: '2026-01-01', title: 'Deneme Atlası' });
const c = await connect();
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' | ' + e.blockedURI));" });
await c.send('Page.navigate', { url: link });
const out = { linkLength: link.length };
for (let i = 0; i < 60; i++) { if (await c.evalJs("!!(document.getElementById('welcome') && document.getElementById('welcome').open)").catch(() => false)) { out.cardAfterS = i; break; } await c.sleep(1000); }
out.card = await c.evalJs("(() => { const d = document.getElementById('welcome'); return d ? { open: d.open, text: d.innerText.replace(/\\s+/g, ' ').slice(0, 260), stored: localStorage.getItem(" + JSON.stringify(STORE_KEY) + ") !== null, title: document.title } : null; })()").catch(e => String(e).slice(0, 200));
out.started = await c.evalJs("(async () => { const d = document.getElementById('welcome'); const b = [...d.querySelectorAll('button')].find(x => /Başla/.test(x.textContent)); if (!b) return 'Başla düğmesi yok'; b.click(); await new Promise(z => setTimeout(z, 1500)); return { open: d.open, stored: localStorage.getItem(" + JSON.stringify(STORE_KEY) + ") !== null, title: document.title, hashHasG: /(^|[#&])g=/.test(location.hash), appTitleMeta: (document.querySelector('meta[name=\"apple-mobile-web-app-title\"]') || {}).content }; })()").catch(e => String(e).slice(0, 200));
out.csp = await c.evalJs('[...new Set(window.__csp)]');
out.errors = c.errors().slice(0, 8);
await c.evalJs("localStorage.removeItem(" + JSON.stringify(STORE_KEY) + "); 1").catch(() => {});
console.log(JSON.stringify(out, null, 1));
c.close();
