// Barındırıcının sayfaya eklediği rozet (Netlify "Powered by Netlify") uygulamanın hangi düğmelerinin üstüne biniyor?
// Verilen ekran boyutunda birkaç görünümü açar, rozetin görünen kutusuyla kesişen tıklanabilir öğeleri yazar ve
// ekran görüntüsü alır. Kullanım: node badge.mjs <adres> <genişlik> <yükseklik>
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2], W = Number(process.argv[3] || 375), H = Number(process.argv[4] || 812);
const c = await connect();
await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 700 });
await c.send('Emulation.setTouchEmulationEnabled', { enabled: W < 700 });
await c.send('Page.navigate', { url: ORIGIN });
await c.sleep(6000);
for (let i = 0; i < 60; i++) { const ok = await c.evalJs("(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()").catch(() => false); if (ok) break; await c.sleep(1000); }
const probe = `(() => {
  const f = document.getElementById('nl-badge-frame');
  if (!f) return { badge: null };
  const b = f.getBoundingClientRect();
  const m = /M ?([\\d.]+) ([\\d.]+) ?H ?([\\d.]+) ?V ?([\\d.]+)/.exec(getComputedStyle(f).clipPath || '');
  if (!m) return { badge: 'görünmüyor (kırpılmış)', frame: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
  const vis = { l: b.left + +m[1], t: b.top + +m[2], r: b.left + +m[3], b: b.top + +m[4] };
  const hit = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary, [role=tab], [role=button], .titem')) {
    if (el.closest('#nl-badge-frame')) continue;
    const q = el.getBoundingClientRect();
    if (!q.width || !q.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
    const ox = Math.min(q.right, vis.r) - Math.max(q.left, vis.l), oy = Math.min(q.bottom, vis.b) - Math.max(q.top, vis.t);
    if (ox <= 2 || oy <= 2) continue;
    // öğe o noktada gerçekten en üstte mi (rozet çerçevesi dışında)?
    f.style.pointerEvents = 'none';
    const top = document.elementFromPoint(Math.max(q.left, vis.l) + ox / 2, Math.max(q.top, vis.t) + oy / 2);
    f.style.pointerEvents = '';
    if (top && (top === el || el.contains(top) || top.contains(el))) hit.push({ what: (el.textContent || el.title || el.getAttribute('aria-label') || el.id || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40), covered: Math.round(100 * (ox * oy) / (q.width * q.height)) + '%' });
  }
  return { viewport: [innerWidth, innerHeight], badge: [Math.round(vis.l), Math.round(vis.t), Math.round(vis.r - vis.l), Math.round(vis.b - vis.t)], overlapped: hit.slice(0, 14) };
})()`;
const out = { origin: ORIGIN, size: W + 'x' + H, views: {} };
const view = async (name, js, wait = 3500) => { if (js) { await c.evalJs(js); await c.sleep(wait); } out.views[name] = await c.evalJs(probe).catch(e => String(e).slice(0, 200)); await c.shot(here('badge-' + W + '-' + name + '.png')); };
await view('start', null);
await view('card', "(() => { const A = window.__anatomi; const it = [...A.model.items.values()].find(x => x.n === 'Femur'); if (it) A.actions.selectItem ? A.actions.selectItem(it.id) : (location.hash = '#s=' + it.id); return 1; })()");
await view('tour', "location.hash = '#m=situs:arteries'; 1", 4500);
await view('quiz', "location.hash = '#m=situs:quiz'; 1", 4500);
await view('quiz-end', "(() => { for (const id of ['info','left','tree','aanki-tree']) { const e = document.getElementById(id); if (e) e.scrollTop = e.scrollHeight; } return 1; })()", 1200);
await view('sections', "location.hash = '#m=sect:thx-heart'; 1", 5000);
await view('exam', "location.hash = '#m=exam'; 1", 3000);
await c.evalJs("(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return 1; })()");
await view('drawer', "(() => { location.hash = ''; const b = document.getElementById('panel-btn'); if (b && getComputedStyle(b).display !== 'none') b.click(); return 1; })()", 2500);
await view('drawer-end', "(() => { for (const id of ['info','left','tree','aanki-tree']) { const e = document.getElementById(id); if (e) e.scrollTop = e.scrollHeight; } return 1; })()", 1200);
out.hostPad = await c.evalJs("getComputedStyle(document.documentElement).getPropertyValue('--host-pad')");
out.errors = c.errors().slice(0, 8);
console.log(JSON.stringify(out, null, 1));
c.close();
