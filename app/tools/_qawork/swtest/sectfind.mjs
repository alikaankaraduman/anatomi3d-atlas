// Kesit testinde "Yapıyı bul": sorulan yapının kesit yüzündeki noktasına (sections.json ask[].pts) gerçek fare tıklaması
// gönderir; cevabın doğru sayılması beklenir. Önce geliştirme sunucusu ya da yayın adresi ve başsız Edge (README.md).
// Kullanım: node sectfind.mjs [adres] [soru sayısı]; SEX=f kadın modelde başlar, FLIP=1 her 4 soruda bir soru açıkken
// bedeni değiştirir (soru yalnız öbür bedende ya da noktaları bedene göre değişen bir yapıdaysa yenisi gelmeli)
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/', N = +(process.argv[3] || 30);
const c = await connect();
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);
await c.send('Page.navigate', { url: ORIGIN + '#m=sect:test' });
for (let i = 0; i < 120; i++) { await c.sleep(1000); if (await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).every(Boolean) && A.state.primary?.type === 'sect'; })()`).catch(() => false)) break; }
await c.sleep(2500);
const setSex = async x => { await c.evalJs(`(() => { document.querySelector('#sex [data-sex="${x}"]')?.click(); return 1; })()`); for (let i = 0; i < 60; i++) { await c.sleep(1000); if (await c.evalJs(`(() => { const A = window.__anatomi; return A.state.sex === '${x}' && Object.values(A.model.loaded).every(Boolean); })()`)) break; } await c.sleep(2500); };
if (process.env.SEX === 'f') await setSex('f');
await c.evalJs(`(async () => { window.__sx = await (await fetch('data/sections.json')).json(); document.querySelector('#info [data-ym="find"]')?.click(); return 1; })()`);
await c.sleep(2500);
const out = [];
for (let k = 0; k < N; k++) {
  if (process.env.FLIP && k % 4 === 3) await setSex(await c.evalJs(`window.__anatomi.state.sex === 'm' ? 'f' : 'm'`));
  const q = await c.evalJs(`(() => { const A = window.__anatomi, info = document.getElementById('info');
    const name = info.querySelector('h1.name')?.textContent?.trim(), lev = info.querySelector('.field .v')?.textContent?.trim();
    const L = window.__sx.regions.flatMap(r => r.levels).find(l => l.title_de === lev); if (!L) return { name, lev, none: 'level' };
    const a = L.ask.find(x => x.la === name); if (!a) return { name, lev, none: 'ask' };
    const pts = A.state.sex === 'f' && a.ptsF ? a.ptsF : a.pts, V = A.stage.camera.position.clone(), rect = A.stage.canvas.getBoundingClientRect();
    const res = [];
    for (const p of pts) { V.set(p[0], p[1], p[2]).project(A.stage.camera); res.push({ x: rect.left + (V.x + 1) / 2 * rect.width, y: rect.top + (1 - V.y) / 2 * rect.height, z: V.z }); }
    const ok = res.filter(p => p.x > rect.left + 4 && p.x < rect.right - 4 && p.y > rect.top + 4 && p.y < rect.bottom - 4 && p.z < 1);
    return { name, lev, p: ok[0] || null, n: pts.length };
  })()`);
  if (q.none || !q.p) { out.push({ ...q, skipped: true }); }
  else {
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: q.p.x, y: q.p.y, button: 'left', clickCount: 1 });
    await c.sleep(1000);
    const r = await c.evalJs(`(() => { const i = document.getElementById('info'), t = document.getElementById('toast'); return { ok: !!i.querySelector('.qres.ok'), bad: !!i.querySelector('.qres.bad'), res: i.querySelector('.qres')?.textContent || '', toast: t && !t.hidden ? t.textContent : '' }; })()`);
    out.push({ name: q.name, lev: q.lev, sex: await c.evalJs('window.__anatomi.state.sex'), ...r });
  }
  await c.evalJs(`(() => { [...document.querySelectorAll('#info [data-ya="next"]')].pop()?.click(); return 1; })()`);
  await c.sleep(2200);
}
const sum = { ok: out.filter(o => o.ok).length, bad: out.filter(o => o.bad).length, skipped: out.filter(o => o.skipped).length, none: out.filter(o => !o.ok && !o.bad && !o.skipped).length };
console.log(JSON.stringify({ sum, notOk: out.filter(o => !o.ok), errors: c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10) }, null, 1));
c.close();
