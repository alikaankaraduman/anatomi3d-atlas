// Canlı site ilk açılış denetimi: service worker kuruluyor mu, önbellekler doluyor mu, barındırıcının sayfaya eklediği
// öğeler (ör. Netlify rozeti) ne yapıyor, hangi konsol hataları ve güvenlik ihlalleri çıkıyor.
// Kullanım: node live.mjs <adres> [genişlik yükseklik]
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2];
const W = Number(process.argv[3] || 0), H = Number(process.argv[4] || 0);
const c = await connect();
await c.send('Network.enable');
if (W && H) await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 700 });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push([e.violatedDirective, e.blockedURI, (e.sourceFile || '').slice(-60) + ':' + e.lineNumber, (e.sample || '').slice(0, 60)].join(' | ')));" });
await c.send('Page.navigate', { url: ORIGIN });
await c.sleep(5000);
const out = { origin: ORIGIN, viewport: W ? W + 'x' + H : 'varsayılan' };
out.swReady = await c.evalJs("Promise.race([navigator.serviceWorker.ready.then(r => 'ready:' + (r.active && r.active.state)), new Promise(r => setTimeout(() => r('zaman aşımı (45 sn): service worker etkinleşmedi'), 45000))])").catch(e => String(e).slice(0, 200));
for (let i = 0; i < 90; i++) { const ok = await c.evalJs("(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()").catch(() => false); if (ok) { out.readyAfterS = i; break; } await c.sleep(1000); }
await c.sleep(2500);
out.state = await c.evalJs("(async () => { const reg = await navigator.serviceWorker.getRegistration(); const sizes = {}; for (const k of await caches.keys()) sizes[k] = (await (await caches.open(k)).keys()).length; const shell = (await caches.keys()).find(k => k.includes('shell')); let index = null; if (shell) { const ks = await (await caches.open(shell)).keys(); index = ks.some(r => new URL(r.url).pathname.endsWith('/index.html')); } return { sw: reg ? { active: reg.active && reg.active.state, installing: !!reg.installing, waiting: !!reg.waiting } : null, controller: !!navigator.serviceWorker.controller, caches: sizes, indexHtmlCached: index }; })()").catch(e => String(e).slice(0, 300));
out.hostInjected = await c.evalJs("(() => { const f = document.getElementById('nl-badge-frame') || document.getElementById('nl-hud-frame'); const s = [...document.scripts].map(x => x.getAttribute('src')).filter(Boolean); const r = f ? f.getBoundingClientRect() : null; const cs = f ? getComputedStyle(f) : null; return { scripts: s, badgeFrame: f ? { id: f.id, title: f.title, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], clipPath: cs.clipPath, ready: f.dataset.nlReady || null, zIndex: cs.zIndex } : null, comments: [...document.childNodes, ...document.documentElement.childNodes, ...document.head.childNodes].filter(n => n.nodeType === 8).map(n => n.textContent.trim().slice(0, 80)) }; })()").catch(e => String(e).slice(0, 300));
out.csp = await c.evalJs('[...new Set(window.__csp)]');
const resp = c.events.filter(e => e.method === 'Network.responseReceived').map(e => e.params.response);
const origin = new URL(ORIGIN).origin;
out.requests = resp.length;
out.badStatus = resp.filter(r => r.status >= 400).map(r => r.status + ' ' + r.url.slice(0, 110));
out.offOrigin = [...new Set(resp.map(r => r.url).filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')).map(u => u.slice(0, 110)))];
out.netlifyPaths = [...new Set(resp.map(r => r.url).filter(u => u.includes('/.netlify/')).map(u => u.slice(origin.length, origin.length + 90)))];
out.errors = c.errors().slice(0, 14);
await c.shot(here('live' + (W ? '-' + W : '') + '.png'));
console.log(JSON.stringify(out, null, 1));
c.close();
