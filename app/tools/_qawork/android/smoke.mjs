// Android emülatöründe açılış sınaması (GitHub Actions'ta çalışır; .github/workflows/android.yml, "emulator-smoke").
// Hata ayıklama APK'sı kurulup açıldıktan sonra WebView'in DevTools kapısına bağlanır (adb forward tcp:9333) ve
// uygulamanın gerçek Android WebView içinde çalıştığını denetler: açılış, yerel kabuk algısı, service worker'ın
// kaydedilmemesi, sistemlerin yüklenmesi, Android Geri tuşu (pencere ve çalışma modu kapanır, uygulama açık kalır;
// hiçbir şey açık değilken uygulama arka plana gider), uygulama içi belge penceresi, cihazdaki kullanıcı profili
// (uydurma kullanıcı, rastgele şifre; sonunda silinir). Sonuç JSON olarak yazılır; çekirdek denetimler başarısızsa çıkış 1.
import { connect } from '../swtest/cdp.mjs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const PKG = 'app.anatomi3d.atlas';
const OUT = process.argv[2] || 'smoke-out';
fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => { try { return execFileSync('adb', a, { encoding: 'utf8', timeout: 30000 }); } catch (e) { return 'ADB HATASI: ' + String(e.message).slice(0, 200); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const resumed = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter(l => /ResumedActivity/.test(l)).join(' | ').includes(PKG);
const back = async () => { adb('shell', 'input', 'keyevent', '4'); await sleep(2500); };

const out = { checks: {}, notes: [] };
const check = (name, ok, detail) => { out.checks[name] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) }; console.error((ok ? 'TAMAM  ' : 'HATA   ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 300) : '')); };

const c = await connect();
const js = (expr, fallback = null) => c.evalJs(expr).catch(e => { out.notes.push('js: ' + String(e).slice(0, 160)); return fallback; });
const waitFor = async (expr, seconds) => { for (let i = 0; i < seconds; i++) { if (await c.evalJs(expr).catch(() => false)) return i; await sleep(1000); } return -1; };
// iki görüntü: DevTools'un sayfa görüntüsü (WebView'de yazılımla çizilir, WebGL tuvalini içermeyebilir) ve cihaz
// ekranının gerçek görüntüsü (adb screencap: ekranda ne varsa o)
const shot = async name => {
  try { await c.shot(OUT + '/' + name + '.png'); } catch (e) { out.notes.push('görüntü alınamadı: ' + name); }
  try { fs.writeFileSync(OUT + '/' + name + '-ekran.png', execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1048576, timeout: 30000 })); } catch (e) { out.notes.push('ekran görüntüsü alınamadı: ' + name); }
};
// 3B çizim gerçekten oluyor mu: bir kare çizdirip tuvalin piksellerini oku (arka plandan farklı pikselleri say)
const drawn = () => js(`(() => { const A = window.__anatomi, r = A.stage.renderer, gl = r.getContext();
  r.render(A.stage.scene, A.stage.camera);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4 * w * h);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const b0 = px[0], b1 = px[1], b2 = px[2]; let diff = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 7) { n++; if (Math.abs(px[i] - b0) + Math.abs(px[i + 1] - b1) + Math.abs(px[i + 2] - b2) > 30) diff++; }
  return { w, h, sampled: n, differing: diff, share: +(diff / n).toFixed(4), glError: gl.getError(), lost: gl.isContextLost(), calls: r.info.render.calls, triangles: r.info.render.triangles,
    multiDraw: !!gl.getExtension('WEBGL_multi_draw'), renderer: (gl.getExtension('WEBGL_debug_renderer_info') ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) }; })()`, null);
// dokunma: öğenin ortasına gerçek (güvenilir) bir dokunuş; sayfa bunu kullanıcı etkileşimi sayar
const tap = async sel => {
  const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  if (!p) return false;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
  return true;
};

// 1) açılış
const started = await waitFor('!!window.__anatomi', 150);
out.env = await js("({ href: location.href, native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()), ua: navigator.userAgent, webgl2: !!document.createElement('canvas').getContext('webgl2'), secure: isSecureContext, subtle: !!(window.crypto && crypto.subtle), w: innerWidth, h: innerHeight, dpr: devicePixelRatio })", {});
check('uygulama açıldı', started >= 0, { saniye: started });
check('adres https://localhost', /^https:\/\/localhost\//.test(out.env.href || ''), out.env.href);
check('yerel kabuk algılandı', out.env.native === true);
check('WebGL2 var', out.env.webgl2 === true, out.env.ua);
// Telefonda sistemler gerektikçe yüklenir ("Sistemleri gerektiğinde yükle" ayarı); açılışta yalnız iskelet gelir.
// Her sistemin katmanı açılarak modelinin bu WebView'de okunup çözüldüğü tek tek denetlenir, sonra katman gizlenir.
const times = { bone: await waitFor('!!(window.__anatomi && window.__anatomi.model.loaded.bone)', 180) };
for (const s of ['muscle', 'nerve', 'vessel', 'organ', 'joint']) {
  await js(`window.__anatomi.actions.setLayer(${JSON.stringify(s)}, 'show'); 1`);
  times[s] = await waitFor(`!!window.__anatomi.model.loaded[${JSON.stringify(s)}]`, 240);
  await js(`window.__anatomi.actions.setLayer(${JSON.stringify(s)}, 'hide'); 1`);
}
out.loaded = await js('window.__anatomi ? window.__anatomi.model.loaded : null');
check('bütün sistemler yüklendi', Object.values(times).every(t => t >= 0), { saniye: times, loaded: out.loaded });
check('service worker kayıtlı değil', (await js("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0", -1)) === 0);
out.offlineText = await js("(document.getElementById('off-status') || {}).textContent || ''", '');
await sleep(3000);
out.draw = await drawn();
check('3B çizim: tuvalde model görünüyor', !!out.draw && out.draw.differing > 200 && out.draw.triangles > 1000 && !out.draw.lost && out.draw.glError === 0, out.draw);
await shot('01-acilis');

// 2) Geri tuşu: Hakkında penceresi
try {
  const opened = await tap('#about-btn');
  const isOpen = await js("document.getElementById('about').open", false);
  await shot('02-hakkinda');
  await back();
  const stillOpen = await js("document.getElementById('about').open", null);
  check('Geri: Hakkında penceresi kapandı, uygulama açık kaldı', opened && isOpen && stillOpen === false && resumed(), { opened, isOpen, stillOpen, resumed: resumed() });
} catch (e) { check('Geri: Hakkında penceresi kapandı, uygulama açık kaldı', false, String(e).slice(0, 200)); }

// 3) Geri tuşu: çalışma modu
try {
  // arayüzdeki düğmenin yaptığı çağrı (adres elle değiştirilmez: o, sayfa geçmişine fazladan kayıt eklerdi)
  await js("window.__anatomi.actions.heartMode('flow'); 1");
  const inMode = await waitFor("decodeURIComponent(location.hash).startsWith('#m=heart') && !!document.querySelector('#info')", 120);
  await sleep(4000);
  await shot('03-kalp');
  await back();
  const hash = await js('decodeURIComponent(location.hash)', '?');
  check('Geri: çalışma modu kapandı, uygulama açık kaldı', inMode >= 0 && !hash.startsWith('#m=heart') && resumed(), { hash, resumed: resumed() });
} catch (e) { check('Geri: çalışma modu kapandı, uygulama açık kaldı', false, String(e).slice(0, 200)); }

// 4) uygulama içi belge penceresi: lisanslar.txt (düz metin, uygulamanın kendi renkleriyle) ve gizlilik.html (çerçeve)
//    uygulamanın yerine açılmamalı, okunabilmeli; Geri önce belgeyi, sonra Hakkında penceresini kapatmalı
try {
  await tap('#about-btn');
  const linkTapped = await tap('#about a[href$="lisanslar.txt"]');
  await sleep(2500);
  const doc = await js("(() => { const d = document.getElementById('doc'); const p = d && d.querySelector('.doc-text'); const cs = p ? getComputedStyle(p) : null; return { open: !!(d && d.open), textLen: p ? p.textContent.length : 0, starts: p ? p.textContent.slice(0, 24) : null, color: cs && cs.color, bg: cs && cs.backgroundColor, frames: d ? d.querySelectorAll('iframe').length : -1, href: location.href, anatomi: !!window.__anatomi }; })()", {});
  await shot('04-belge');
  await back();
  const afterDoc = await js("({ doc: document.getElementById('doc').open, about: document.getElementById('about').open })", {});
  check('lisanslar.txt uygulama içinde okunuyor', linkTapped && doc.open && doc.textLen > 5000 && !!doc.color && doc.color !== doc.bg && doc.anatomi, doc);
  // gizlilik.html: korumalı çerçevede, kendi koyu renkleriyle; "Uygulamaya dön" bağlantısı kaldırılmış olmalı
  const privTapped = await tap('#about a[href$="gizlilik.html"]');
  await sleep(2500);
  const priv = await js("(() => { const d = document.getElementById('doc'); const f = d && d.querySelector('iframe'); let inner = null; try { const b = f.contentDocument.body; const cs = f.contentWindow.getComputedStyle(b); inner = { textLen: b.innerText.length, color: cs.color, bg: cs.backgroundColor, topLinks: f.contentDocument.querySelectorAll('a[target=\"_top\"]').length, title: f.contentDocument.title }; } catch (e) { inner = String(e).slice(0, 120); } return { open: !!(d && d.open), src: f ? f.src : null, sandbox: f ? f.getAttribute('sandbox') : null, inner, appStill: location.href }; })()", {});
  await shot('04b-gizlilik');
  await back();
  const afterPriv = await js("({ doc: document.getElementById('doc').open, about: document.getElementById('about').open })", {});
  await back();
  const afterAbout = await js("document.getElementById('about').open", null);
  check('gizlilik.html uygulama içinde okunuyor', privTapped && priv.open && /gizlilik\.html/.test(priv.src || '') && priv.inner && priv.inner.textLen > 500 && priv.inner.color !== priv.inner.bg && priv.inner.topLinks === 0, priv);
  check('Geri: önce belge, sonra Hakkında kapandı', afterDoc.doc === false && afterDoc.about === true && afterPriv.doc === false && afterPriv.about === true && afterAbout === false && resumed(), { afterDoc, afterPriv, afterAbout, resumed: resumed() });
} catch (e) { check('lisanslar.txt uygulama içinde okunuyor', false, String(e).slice(0, 200)); }

// 5) hiçbir şey açık değilken Geri: uygulama arka plana gider (kapanmaz, çökmez); sonra yeniden öne gelir
try {
  await js("(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return 1; })()");
  await sleep(1500);
  const nav = "({ len: history.length, state: JSON.stringify(history.state), hash: decodeURIComponent(location.hash) })";
  const before = await js(nav, {});
  let n = 0; const trail = [];
  while (resumed() && n < 4) { await back(); n++; trail.push(await js(nav, {})); }
  check('hiçbir şey açık değilken Geri: uygulama arka plana gitti', !resumed(), { geriSayisi: n, once: before, sonra: trail });
  out.notes.push('arka plandayken süreç: ' + (adb('shell', 'pidof', PKG).trim() || 'yok'));
  adb('shell', 'am', 'start', '-n', PKG + '/.MainActivity');
  await sleep(4000);
  check('arka plandan dönünce uygulama açık', resumed() && (await js('!!window.__anatomi', false)) === true);
} catch (e) { check('hiçbir şey açık değilken Geri: uygulama arka plana gitti', false, String(e).slice(0, 200)); }

// 6) cihazdaki kullanıcı profili (uydurma kullanıcı; şifre burada üretilir, hiçbir yere yazılmaz). Arayüz kullanıcı
//    değişince sayfayı yeniden yükler; burada da öyle yapılır (etkin kullanıcı açılışta belirlenir).
try {
  const NAME = 'Deneme Kullanıcı', PW = randomBytes(9).toString('base64url');
  const reload = async () => { await js('location.reload(); 1'); await sleep(5000); await waitFor('!!window.__anatomi && !!window.__anatomi.users', 150); };
  const avail = await js('window.__anatomi.users.available()', null);
  const availOk = avail === true || !!(avail && avail.ok === true);
  const made = await js(`window.__anatomi.users.create(${JSON.stringify(NAME)}, ${JSON.stringify(PW)}, { takeGuest: false }).then(() => true).catch(e => String(e && e.message || e))`, 'hata');
  await reload();
  const cur = await js('(window.__anatomi.users.current() || {}).name || null');
  const reg = await js("(() => { const r = JSON.parse(localStorage.getItem('anatomi3d.users.v1') || 'null'); return r ? { n: r.users.length, iter: r.users[0] && r.users[0].iter, hasPw: JSON.stringify(r).includes(" + JSON.stringify(PW) + ") } : null; })()");
  const key = await js("Object.keys(localStorage).filter(k => k.startsWith('anatomi3d.u.')).length", -1);
  const wrong = await js("window.__anatomi.users.changePassword(window.__anatomi.users.activeId(), 'yanlis-sifre-0', 'baska-sifre-1').then(() => 'KABUL EDİLDİ').catch(() => 'reddedildi')", '?');
  const removed = await js(`(() => { const U = window.__anatomi.users; try { U.remove(U.activeId(), ${JSON.stringify(NAME)}); return true; } catch (e) { return String(e && e.message || e); } })()`);
  await reload();
  const left = await js('window.__anatomi.users.list().length', -1);
  check('kullanıcı profili: oluşturma, giriş, yanlış şifre, silme', availOk && made === true && cur === NAME && reg && reg.n === 1 && reg.hasPw === false && wrong === 'reddedildi' && removed === true && left === 0, { availOk, made, cur, reg, userKeys: key, wrong, removed, left });
  await shot('05-son');
} catch (e) { check('kullanıcı profili: oluşturma, giriş, yanlış şifre, silme', false, String(e).slice(0, 200)); }

out.errors = c.errors().slice(0, 30);
const core = ['uygulama açıldı', 'adres https://localhost', 'yerel kabuk algılandı', 'bütün sistemler yüklendi', 'service worker kayıtlı değil'];
out.coreOk = core.every(k => out.checks[k] && out.checks[k].ok);
out.allOk = Object.values(out.checks).every(x => x.ok);
console.log(JSON.stringify(out, null, 1));
c.close();
process.exit(out.coreOk ? 0 : 1);
