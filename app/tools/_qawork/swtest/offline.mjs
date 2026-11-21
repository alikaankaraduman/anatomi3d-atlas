// Çevrimdışı ve yol sınaması. Kullanım: node offline.mjs <adres> pre|post
//  pre  (sunucu açık): yanlış bir alt yol (/foo/bar) uygulama kabuğunu ALMAMALI (sunucunun 404'ü gelmeli)
//  post (sunucu kapalı ya da ad çözümlemesi kesik): kök adres önbellekten açılmalı, bütün sistemler yüklenmeli,
//       lisanslar.txt önbellekten okunabilmeli
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2] || 'http://localhost:4190/';
const phase = process.argv[3] || 'post';
const c = await connect();
const out = { origin: ORIGIN, phase };
const page = "(() => ({ url: location.href, anatomi: !!window.__anatomi, text: (document.body ? document.body.innerText : '').trim().slice(0, 70), title: document.title }))()";
const go = async (url, wait = 3500) => { try { await c.send('Page.navigate', { url }); } catch (e) { return { navigateError: String(e).slice(0, 160) }; } await c.sleep(wait); return c.evalJs(page).catch(e => ({ evalError: String(e).slice(0, 160) })); };
const ready = async (max = 90) => { for (let i = 0; i < max; i++) { const ok = await c.evalJs("(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()").catch(() => false); if (ok) return i; await c.sleep(1000); } return -1; };
if (phase === 'pre') {
  out.wrongPath = await go(ORIGIN + 'foo/bar');
  out.root = await go(ORIGIN);
  out.rootReadyAfterS = await ready();
} else {
  out.root = await go(ORIGIN, 5000);
  out.rootReadyAfterS = await ready();
  out.state = await c.evalJs("(async () => { const A = window.__anatomi; const reg = await navigator.serviceWorker.getRegistration(); const sizes = {}; for (const k of await caches.keys()) sizes[k] = (await (await caches.open(k)).keys()).length; return { loaded: A ? A.model.loaded : null, controller: !!navigator.serviceWorker.controller, active: reg && reg.active && reg.active.state, caches: sizes, online: navigator.onLine }; })()").catch(e => String(e).slice(0, 200));
  // çevrimdışıyken bir çalışma modu ve bir veri dosyası
  out.mode = await c.evalJs("(async () => { location.hash = '#m=situs:arteries'; await new Promise(z => setTimeout(z, 3500)); const r = await fetch('data/sections.json').then(x => x.ok + ' ' + x.status).catch(e => 'HATA ' + e); return { hash: location.hash, sections: r }; })()").catch(e => String(e).slice(0, 200));
  await c.shot(here('offline.png'));
  out.licences = await go(ORIGIN + 'lisanslar.txt');
  out.privacy = await go(ORIGIN + 'gizlilik.html');
  out.wrongPath = await go(ORIGIN + 'foo/bar');
  out.backToRoot = await go(ORIGIN);
}
out.errors = c.errors().slice(0, 12);
console.log(JSON.stringify(out, null, 1));
c.close();
