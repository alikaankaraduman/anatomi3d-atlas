// Test akışları taraması (başsız Edge): her modun Test bölümünü derin bağlantıyla açar, çoktan seçmeli sorularda bir
// şık seçip "sonraki"ye basar (6 soru), yapı bulma sorusunda atlar; konsol hatalarını ve ilerlemenin kaydedilip
// kaydedilmediğini yazar. Önce geliştirme sunucusu ya da yayın adresi ve başsız Edge (README.md).
// Kullanım: node quizflow.mjs [adres]
import { connect } from './cdp.mjs';
const ORIGIN = process.argv[2] || 'http://localhost:5173/';
const FLOWS = ['#m=brain:quiz', '#m=loco:quiz', '#m=heart:conduction', '#m=situs:quiz', '#m=thorax:quiz', '#m=uro:quiz', '#m=head:quiz', '#m=vessels:quiz', '#m=lymph:quiz', '#m=sect:thx-heart', '#t=abp-01'];
const c = await connect();
await c.send('Page.navigate', { url: 'about:blank' }); await c.sleep(500);   // yeni belge: aynı adreste yalnız karma değişirse sayfa yenilenmez
await c.send('Page.navigate', { url: ORIGIN });
for (let i = 0; i < 90; i++) { await c.sleep(1000); if (await c.evalJs(`(() => { const A = window.__anatomi; return !!A && Object.values(A.model.loaded).every(Boolean) && Object.keys(A.model.loaded).length >= 6; })()`).catch(() => false)) break; }
const out = [];
for (const h of FLOWS) {
  const before = await c.evalJs(`(() => { try { return Object.keys(JSON.parse(localStorage.getItem('anatomi3d.progress.v1') || '{}')).length; } catch { return -1; } })()`);
  await c.evalJs(`(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); location.hash = ${JSON.stringify(h)}; return 1; })()`);
  await c.sleep(6000);
  // kesit ve Aanki konusu: Test düğmesine geç
  await c.evalJs(`(() => { const b = [...document.querySelectorAll('#info button')].find(x => /^(Test|Kesit testi|Konuyu test et|Teste başla)/i.test(x.textContent.trim())); b?.click(); return !!b; })()`);
  await c.sleep(2500);
  let answered = 0, structure = 0;
  for (let k = 0; k < 6; k++) {
    const r = await c.evalJs(`(() => { const o = [...document.querySelectorAll('#info .qopt:not([disabled]), dialog[open] .qopt:not([disabled])')];
      if (o.length) { o[Math.floor(o.length / 2)].click(); return 'opt'; }
      const skip = [...document.querySelectorAll('#info button')].find(x => /Atla|Geç|Weiter|Überspringen|Cevabı göster|Lösung/i.test(x.textContent)); if (skip) { skip.click(); return 'skip'; } return 'none'; })()`);
    if (r === 'opt') answered++; else if (r === 'skip') structure++;
    await c.sleep(700);
    await c.evalJs(`(() => { const n = [...document.querySelectorAll('#info button, dialog[open] button')].find(x => /Sonraki|Weiter|Nächste|›|▶/.test(x.textContent) && !x.disabled); n?.click(); return !!n; })()`);
    await c.sleep(900);
  }
  const after = await c.evalJs(`(() => { try { return Object.keys(JSON.parse(localStorage.getItem('anatomi3d.progress.v1') || '{}')).length; } catch { return -1; } })()`);
  out.push({ flow: h, answered, structure, recorded: after - before });
}
console.log(JSON.stringify({ out, errors: c.errors().filter(e => !/setPointerCapture/.test(e)).slice(0, 10) }, null, 1));
c.close();
