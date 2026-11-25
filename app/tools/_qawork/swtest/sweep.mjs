// Yayın sınaması: verilen adreste (yerel başlık sunucusu ya da yayındaki site) bütün çalışma modlarını derin
// bağlantılarla dolaşır; Content-Security-Policy ihlallerini, konsol hatalarını ve başarısız istekleri toplar.
// Kullanım: node sweep.mjs <adres> [all]     ("all": Hakkında > "Hepsini indir" ile bütün modelleri önbelleğe alır)
// Önce başsız Edge açık olmalı (README.md).
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2] || 'http://localhost:4190/';
const ALL = process.argv[3] === 'all';
const c = await connect();
await c.send('Network.enable');
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; window.__xss = 0; document.addEventListener('securitypolicyviolation', e => window.__csp.push([e.violatedDirective, e.blockedURI, (e.sourceFile || '') + ':' + e.lineNumber, (e.sample || '').slice(0, 80)].join(' | ')));" });
const out = { origin: ORIGIN, steps: [] };
const ready = async (max = 120) => { for (let i = 0; i < max; i++) { const ok = await c.evalJs("(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()").catch(() => false); if (ok) return i; await c.sleep(1000); } return -1; };
const snap = "(() => { const A = window.__anatomi; const p = document.querySelector('#right .panel:not([hidden]) h2, #info h2, #right h2'); return { hash: decodeURIComponent(location.hash), csp: window.__csp.length, xss: window.__xss, sex: A && A.state.sex, dialog: !!document.querySelector('dialog[open]'), title: p ? p.textContent.trim().slice(0, 60) : null }; })()";

await c.send('Page.navigate', { url: ORIGIN });
await c.sleep(3000);
out.readyAfterS = await ready();
out.start = await c.evalJs(snap);

const PROBE = '<img src=x onerror=window.__xss=1>';
const HASHES = ['#t=abp-01', '#m=heart:flow', '#m=heart:valves', '#m=heart:conduction', '#m=brain', '#m=loco', '#m=sect:head-sag', '#m=sect:thx-heart',
  '#m=situs:arteries', '#m=situs:quiz', '#m=thorax:lung', '#m=uro:male', '#m=uro:female', '#m=head:ear', '#m=vessels:armart', '#m=lymph:organs',
  '#m=patho:mca-links', '#m=patho:fremdkoerperaspiration-rechts', '#m=patho:brown-sequard', '#m=patho:erb-obere-plexuslaesion', '#m=move:', '#m=move:leg.hFlex', '#m=move:spine.cRot',
  '#m=constructor', '#m=' + PROBE, '#m=patho:' + PROBE, '#m=move:' + PROBE, '#t=' + PROBE, '#s=' + PROBE, '#m=situs:' + PROBE, '#m=sect:' + PROBE, '#m=heart:' + PROBE, '#m=exam'];
for (const h of HASHES) {
  await c.evalJs('location.hash = ' + JSON.stringify(h) + '; 1');
  await c.sleep(2600);
  await ready(60);
  const s = await c.evalJs(snap).catch(e => ({ error: String(e).slice(0, 200) }));
  if (s.dialog) await c.evalJs("(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return 1; })()");
  out.steps.push({ set: h, ...s });
}

// arama: sıradan bir sorgu ve bir HTML sondası
out.search = await c.evalJs("(async () => { const i = document.getElementById('search'), r = document.getElementById('results'); const type = async v => { i.focus(); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(z => setTimeout(z, 700)); return { hidden: r.hidden, n: r.children.length, text: r.textContent.trim().slice(0, 80) }; }; const a = await type('femur'); const b = await type(" + JSON.stringify(PROBE) + "); const html = r.innerHTML.includes('<img'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return { femur: a, probe: b, probeRenderedAsHtml: html, xss: window.__xss }; })()").catch(e => String(e).slice(0, 300));

// kadın beden + Hakkında penceresi
out.female = await c.evalJs("(async () => { const A = window.__anatomi; A.actions.setSex('f'); await new Promise(z => setTimeout(z, 4000)); return { sex: A.state.sex, loaded: A.model.loaded }; })()").catch(e => String(e).slice(0, 300));
await ready(90);
out.about = await c.evalJs("(async () => { document.getElementById('about-btn').click(); await new Promise(z => setTimeout(z, 1200)); const d = document.getElementById('about'); const o = document.getElementById('offline'); return { open: d.open, offline: o ? o.innerText.trim().slice(0, 300) : null, links: [...d.querySelectorAll('a[href]')].map(a => a.getAttribute('href') + ' rel=' + (a.rel || '-') + ' target=' + (a.target || '-')) }; })()").catch(e => String(e).slice(0, 300));
if (ALL) {
  out.downloadAll = await c.evalJs("(async () => { const b = [...document.querySelectorAll('#offline button')].find(x => x.textContent.includes('Hepsini indir')); if (!b) return 'düğme yok'; b.click(); const count = async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; }; let last = -1, same = 0; for (let i = 0; i < 150 && same < 4; i++) { await new Promise(z => setTimeout(z, 2000)); const n = await count(); same = n === last ? same + 1 : 0; last = n; } return { cached: last, text: document.getElementById('offline').innerText.trim().slice(0, 300) }; })()").catch(e => String(e).slice(0, 300));
}
out.sw = await c.evalJs("(async () => { if (!('serviceWorker' in navigator)) return 'yok'; const reg = await navigator.serviceWorker.getRegistration(); const sizes = {}; for (const k of await caches.keys()) sizes[k] = (await (await caches.open(k)).keys()).length; return { scope: reg && reg.scope, active: reg && reg.active && reg.active.state, controller: !!navigator.serviceWorker.controller, caches: sizes }; })()").catch(e => String(e).slice(0, 300));
out.final = await c.evalJs(snap);
out.cspViolations = await c.evalJs('[...new Set(window.__csp)]');
await c.shot(here('sweep.png'));

// ağ: belge başlıkları, 400 ve üstü yanıtlar, başarısız istekler, kaynak dışı istekler
const origin = new URL(ORIGIN).origin;
const resp = c.events.filter(e => e.method === 'Network.responseReceived').map(e => e.params);
const doc = resp.find(r => r.type === 'Document');
const pick = ['content-security-policy', 'x-robots-tag', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cache-control', 'strict-transport-security', 'content-type', 'server'];
out.documentHeaders = doc ? Object.fromEntries(Object.entries(doc.response.headers).map(([k, v]) => [k.toLowerCase(), v]).filter(([k]) => pick.includes(k))) : null;
out.requests = resp.length;
out.badStatus = resp.filter(r => r.response.status >= 400).map(r => r.response.status + ' ' + r.response.url).slice(0, 20);
out.offOrigin = [...new Set(resp.map(r => r.response.url).filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')).map(u => u.slice(0, 120)))].slice(0, 20);
out.failed = c.events.filter(e => e.method === 'Network.loadingFailed' && !e.params.canceled).map(e => e.params.errorText + ' ' + (e.params.blockedReason || '')).slice(0, 20);
out.errors = c.errors().slice(0, 25);
console.log(JSON.stringify(out, null, 1));
c.close();
