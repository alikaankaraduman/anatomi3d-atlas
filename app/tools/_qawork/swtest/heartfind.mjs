// Bir çalışma modunun testinde "Yapıyı bul": sorulan yapının, önünde yalnız saydam parçalar olan (yoksa en öndeki) bir
// noktasına gerçek fare tıklaması (CDP Input) gönderir; doğru sayılmalı. Önce geliştirme sunucusu ve başsız Edge (README.md).
// Kullanım: node heartfind.mjs [adres] [mod:sekme]   (varsayılan heart:quiz; ör. brain:quiz, loco:quiz)
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/', SPEC = process.argv[3] || 'heart:quiz', MODE = SPEC.split(':')[0];
const c = await connect();
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);   // yeni belge: yalnız karma değişirse sayfa yenilenmez
await c.send('Page.navigate', { url: ORIGIN + '#m=' + SPEC });
for (let i = 0; i < 120; i++) { await c.sleep(1000); if (await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).every(Boolean) && A.state.primary?.type === '${MODE}'; })()`).catch(() => false)) break; }
await c.sleep(3000);
await c.evalJs(`(() => { document.querySelector('#info [data-zm="find"]')?.click(); return 1; })()`);
await c.sleep(1500);
const out = [];
for (let k = 0; k < 24; k++) {
  // sorulan yapı: vurgulanmayan, panel başlığındaki ad; kayıtlar adıyla bulunur (model.list n) ve ekran merkezi hesaplanır
  const q = await c.evalJs(`(() => { const A = window.__anatomi, info = document.getElementById('info');
    const name = info.querySelector('h1.name')?.textContent?.trim() || '';
    const THREE_V = A.stage.camera.position.constructor;
    // testler "M." / "N." kısaltır, model adları açık yazar
    const ab = s => s.replace(/\\bMusculi\\b/g, 'Mm.').replace(/\\bMusculus\\b/g, 'M.').replace(/\\bNervi\\b/g, 'Nn.').replace(/\\bNervus\\b/g, 'N.').replace(/\\bArteria\\b/g, 'A.');
    const hits = A.model.list.filter(r => r.mesh && (!A.state.isolate || A.state.isolate.has(r.id)) && ab(r.la || r.de || r.tr || r.n) === ab(name));
    if (!hits.length) return { name, none: 'name' };
    const want = new Set(hits.map(r => r.n)), rect = A.stage.canvas.getBoundingClientRect(), V = new THREE_V();
    let behind = null, front = null;
    for (const r of hits) { const P = r.mesh.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 150));
      for (let i = 0; i < P.count && !behind; i += step) {
        V.fromBufferAttribute(P, i).applyMatrix4(r.mesh.matrixWorld).project(A.stage.camera);
        // tam piksel (tarayıcı tıklamayı piksele yuvarlar) ve dört komşusu aynı sonucu vermeli: ince sinirlerin kenarında
        // alt piksel farkı ışını ıskalatır, o nokta sınama için güvenilmez
        const x = Math.round(rect.left + (V.x + 1) / 2 * rect.width), y = Math.round(rect.top + (1 - V.y) / 2 * rect.height);
        if (x < rect.left + 5 || y < rect.top + 5 || x > rect.right - 5 || y > rect.bottom - 5) continue;
        const at = (px, py) => { const hs = A.model.hitsAt(px, py); const k = hs.findIndex(h => want.has(h.rec.n)); return k >= 0 && hs.slice(0, k).every(h => h.soft) ? { k, over: hs.slice(0, k).map(h => h.rec.n) } : null; };
        const g = at(x, y); if (!g || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => at(x + dx, y + dy))) continue;
        if (g.k > 0) behind = { x, y, ...g }; else if (!front) front = { x, y, k: 0 };
      } }
    const p = behind || front; if (!p) return { name, none: 'point', parts: hits.length };
    return { name, ...p, n: [...want] };
  })()`);
  if (q.none) { out.push({ q: q.name, skipped: q.none, parts: q.parts }); await c.evalJs(`(() => { document.querySelector('#info [data-za="next"]')?.click(); return 1; })()`); await c.sleep(1000); continue; }
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', clickCount: 1 });
  await c.sleep(900);
  const r = await c.evalJs(`(() => { const i = document.getElementById('info'); return { ok: !!i.querySelector('.qres.ok, .ok .qres, p.ok, .qok'), bad: !!i.querySelector('.qres.bad, p.bad, .qbad'), txt: i.querySelector('.qres')?.textContent || '' }; })()`);
  out.push({ q: q.name, k: q.k, over: q.over, ...r });
  await c.evalJs(`(() => { document.querySelector('#info [data-za="next"]')?.click(); return 1; })()`);
  await c.sleep(1200);
}
console.log(JSON.stringify({ out, errors: c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10) }, null, 1));
c.close();
