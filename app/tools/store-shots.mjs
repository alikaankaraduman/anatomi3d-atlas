// Mağaza ekran görüntüleri (Google Play, App Store): başsız Edge'i CDP ile sürer, seçilen görünümleri mağazaların
// istediği piksel boyutlarında çeker. Paket gerekmez (Node 22+ yerleşik WebSocket; küçük istemci: _qawork/swtest/cdp.mjs).
//
// Kullanım (app/ içinde):
//   1. Edge'i ayrı bir profil klasörüyle başlat (geçici, proje dışında bir klasör):
//      "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --remote-debugging-port=9333
//        --user-data-dir=<profil> --no-first-run --disable-extensions --enable-unsafe-swiftshader --window-size=1280,800 about:blank
//   2. node tools/store-shots.mjs [adres] [takımlar] [görünümler]
//      adres      varsayılan http://localhost:5180/ (geliştirme sunucusu) ya da yayındaki adres
//      takımlar   virgülle: play-phone,play-tab7,play-tab10,play-feature,ios-iphone,ios-ipad (varsayılan: hepsi)
//      görünümler virgülle: start,card,heart,tour,sect,quiz,exam (varsayılan: hepsi; play-feature yalnız kendi görünümünü çeker)
//   3. Bitince o profilin Edge süreçlerini kapat.
// Çıktı: <depo kökü>/docs/store/screens/<takım>/<sıra>-<görünüm>.png (24 bit PNG, alfa kanalı yok: mağazalar istemez).
//
// Boyutlar (2026-11-21'de mağaza yardım sayfalarından):
//   Google Play telefon 9:16, her kenar 320-3840 px, 2-8 adet; tablet (7 ve 10 inç) 16:9 ya da 9:16, kenar 1080-7680 px,
//   en az 4 adet önerilir; tanıtım görseli 1024x500 (alfasız). App Store 6,9" iPhone 1320x2868, 13" iPad 2064x2752; 1-10 adet.
import { connect } from './_qawork/swtest/cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'store', 'screens');
const ORIGIN = (process.argv[2] || 'http://localhost:5180/').replace(/#.*$/, '');

// CSS boyutu x ölçek = mağazanın istediği piksel boyutu.
const SETS = {
  'play-phone':   { w: 360,  h: 640,  dpr: 3, mobile: true,  note: '1080x1920 (9:16) Google Play telefon' },
  'play-tab7':    { w: 960,  h: 540,  dpr: 2, mobile: true,  note: '1920x1080 (16:9) Google Play 7 inç tablet' },
  'play-tab10':   { w: 1280, h: 720,  dpr: 2, mobile: true,  note: '2560x1440 (16:9) Google Play 10 inç tablet' },
  'play-feature': { w: 1024, h: 500,  dpr: 1, mobile: false, note: '1024x500 Google Play tanıtım görseli', only: ['feature'] },
  'ios-iphone':   { w: 440,  h: 956,  dpr: 3, mobile: true,  note: '1320x2868 App Store 6,9 inç iPhone' },
  'ios-ipad':     { w: 1032, h: 1376, dpr: 2, mobile: true,  note: '2064x2752 App Store 13 inç iPad (dikey)' },
};

// Sayfa yüklendi mi: yükleme ekranı gitti, istenen sistemler yüklendi, model istekleri bitti.
const READY = `(() => {
  const A = window.__anatomi; const L = document.getElementById('loading');
  if (!A || !A.model || !L || !L.hidden) return false;
  const ld = Object.values(A.model.loaded); return ld.length >= 6 && ld.every(Boolean);
})()`;

// Ekran görüntüsünde istenmeyen geçici öğeler: ipucu balonları, bildirim, imleç ipucu, barındırıcı rozeti ve küçük ekranda
// modelin ortasını örten "İzole görünüm · Çık" çubuğu (yalnız görüntüden gizlenir, uygulamada durur).
const CLEAN = `(() => {
  for (const id of ['toast', 'tooltip']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  const h = document.getElementById('hints'); if (h) h.style.display = 'none';
  const n = document.getElementById('nl-badge-frame'); if (n) n.style.display = 'none';
  const ib = document.getElementById('isolate-bar'); if (ib) ib.style.visibility = 'hidden';
  return 1;
})()`;

// Bir yapıyı adına göre seçen derin bağlantı (#s=<id>).
const byName = names => `(() => { const A = window.__anatomi; const want = ${JSON.stringify(names)};
  for (const w of want) { const it = [...A.model.items.values()].find(x => x.n === w); if (it) { location.hash = '#s=' + it.id; return it.id; } }
  return null; })()`;

const VIEWS = {
  start: { hash: '', wait: 1500 },
  card:  { js: byName(['Short head of biceps brachii', 'Liver', 'Femur']), wait: 4000 },
  heart: { hash: '#m=heart:flow', wait: 5000 },
  tour:  { hash: '#m=situs:arteries', wait: 5000 },
  sect:  { hash: '#m=sect:thx-heart', wait: 6000 },
  // Test: bilgi paneli soruya kaydırılır (alt panelde sekmeler soruyu aşağı itiyor).
  quiz:  { hash: '#m=situs:quiz', wait: 5000, js2: `(() => { const i = document.getElementById('info'); const q = i && i.querySelector('.qprog, .htext'); if (q) i.scrollTop += q.getBoundingClientRect().top - i.getBoundingClientRect().top - 8; return !!q; })()`, wait2: 800 },
  exam:  { hash: '#m=exam', wait: 3000, js2: `(() => { const d = document.querySelector('dialog[open]'); const b = d && [...d.querySelectorAll('button')].find(x => /başla/i.test(x.textContent)); if (b) b.click(); return !!b; })()`, wait2: 2500 },
  // Tanıtım görseli: arayüz gizlenir, sol yarıda ad ve tek satır tanım.
  feature: { hash: '#m=heart:flow', wait: 6000, js2: `(() => {
    const st = document.createElement('style');
    st.textContent = '#topbar,#left,#right,#hints,#isolate-bar,#exam-back,#toast,#tooltip,#labels,#sheet-btn{display:none!important} #view{transform:translateX(230px)}';
    document.head.appendChild(st);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:56px;top:50%;transform:translateY(-50%);z-index:99;color:#dfe2e8;font-family:Segoe UI,system-ui,sans-serif;pointer-events:none';
    d.innerHTML = '<div style="font-size:64px;font-weight:700;letter-spacing:-1px">Anatomi <span style="color:#19c8f5">3D</span></div>'
      + '<div style="font-size:24px;color:#b9bec9;margin-top:6px">Tıp öğrencileri için 3B anatomi atlası</div>'
      + '<div style="font-size:18px;color:#979daa;margin-top:14px">Ücretsiz · reklamsız · çevrimdışı</div>';
    document.body.appendChild(d);
    window.dispatchEvent(new Event('resize'));
    return 1; })()`, wait2: 2500 },
};

const want = (arg, all) => (arg ? arg.split(',').filter(Boolean) : all);
const sets = want(process.argv[3], Object.keys(SETS));
const views = want(process.argv[4], Object.keys(VIEWS).filter(v => v !== 'feature'));

const c = await connect();
// Gecikmeli yükleme kapalı: her ekran görüntüsünde bütün sistemler yüklü olsun (telefon öykünmesinde varsayılan açıktır).
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('anatomi3d.lazy', '0'); } catch {}" });

async function waitReady(maxSec = 120) {
  for (let i = 0; i < maxSec; i++) { if (await c.evalJs(READY).catch(() => false)) return true; await c.sleep(1000); }
  return false;
}

const report = [];
for (const name of sets) {
  const S = SETS[name]; if (!S) { console.error('bilinmeyen takım: ' + name); continue; }
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true });
  await c.send('Emulation.setDeviceMetricsOverride', { width: S.w, height: S.h, deviceScaleFactor: S.dpr, mobile: S.mobile, screenWidth: S.w, screenHeight: S.h });
  await c.send('Emulation.setTouchEmulationEnabled', S.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  const list = S.only || views;
  for (const v of list) {
    const V = VIEWS[v]; if (!V) { console.error('bilinmeyen görünüm: ' + v); continue; }
    // Her görünüm temiz bir açılışla başlar (önceki modun durumu taşınmasın). Yalnız # farklı bir adrese gitmek sayfayı
    // yeniden yüklemez (aynı belge içinde gezinme), bu yüzden önce boş sayfaya gidilir.
    await c.send('Page.navigate', { url: 'about:blank' });
    await c.sleep(300);
    await c.send('Page.navigate', { url: ORIGIN + (V.hash || '') });
    await c.sleep(2500);
    const ok = await waitReady();
    if (V.js) { await c.evalJs(V.js); }
    await c.sleep(V.wait || 2000);
    if (V.js2) { await c.evalJs(V.js2); await c.sleep(V.wait2 || 1500); }
    await c.evalJs(CLEAN);
    await c.sleep(400);
    const file = path.join(dir, String(Object.keys(VIEWS).indexOf(v) + 1).padStart(2, '0') + '-' + v + '.png');
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(file, buf);
    // PNG başlığı: genişlik, yükseklik, renk tipi (2 = RGB, alfa yok; 6 = RGBA)
    const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20), ct = buf[25];
    const line = `${name}/${path.basename(file)} ${W}x${H} renk tipi ${ct}${ct === 2 ? '' : ' (ALFA VAR)'}${ok ? '' : ' (YÜKLEME BİTMEDİ)'} ${Math.round(buf.length / 1024)} KB`;
    report.push(line); console.log(line);
  }
}
const errs = c.errors();
if (errs.length) console.log('sayfa hataları:\n' + errs.slice(0, 10).join('\n'));
await c.send('Emulation.clearDeviceMetricsOverride');
c.close();
