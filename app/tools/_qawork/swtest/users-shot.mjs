// Kullanıcı penceresinin görünümü ve güvenlik başlıkları altında çalışması (yalnız YEREL adreste çalıştırın: uydurma bir
// deneme kullanıcısı oluşturur, sonunda siler). Kullanım: node users-shot.mjs http://localhost:4190/ [genişlik yükseklik]
import { connect } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const here = f => fileURLToPath(new URL('./' + f, import.meta.url));
const ORIGIN = process.argv[2] || 'http://localhost:4190/';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(ORIGIN)) { console.error('yalnız yerel adres'); process.exit(2); }
const W = Number(process.argv[3] || 0), H = Number(process.argv[4] || 0);
const tag = W ? '-' + W : '';
const NAME = 'Deneme Kullanıcı', PW = randomBytes(9).toString('base64url');
const c = await connect();
if (W && H) { await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 700 }); await c.send('Emulation.setTouchEmulationEnabled', { enabled: W < 700 }); }
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push([e.violatedDirective, e.blockedURI, (e.sample || '').slice(0, 60)].join(' | ')));" });
const ready = async () => { for (let i = 0; i < 90; i++) { const ok = await c.evalJs("(() => { const A = window.__anatomi; return !!A && !!A.users && Object.values(A.model.loaded).length >= 6 && Object.values(A.model.loaded).every(Boolean); })()").catch(() => false); if (ok) return i; await c.sleep(1000); } return -1; };
const go = async () => { await c.send('Page.navigate', { url: ORIGIN }); await c.sleep(3500); return ready(); };
const openDialog = "(async () => { const p = document.getElementById('panel-btn'); const b = document.getElementById('user-btn'); if (b.getBoundingClientRect().width === 0 && p) { p.click(); await new Promise(z => setTimeout(z, 500)); } b.click(); await new Promise(z => setTimeout(z, 700)); const d = document.getElementById('users'); return { open: d.open, text: d.innerText.replace(/\\s+/g, ' ').slice(0, 900), w: Math.round(d.getBoundingClientRect().width), scrollW: document.documentElement.scrollWidth, innerW: innerWidth, inputs: [...d.querySelectorAll('input')].map(i => i.type + ':' + (i.autocomplete || '-') + ':' + getComputedStyle(i).fontSize) }; })()";
const out = { origin: ORIGIN, size: W ? W + 'x' + H : 'varsayılan' };
out.ready1 = await go();
out.keysBefore = await c.evalJs("Object.keys(localStorage).filter(k => k.startsWith('anatomi3d')).sort()");
out.guest = await c.evalJs(openDialog);
await c.shot(here('users' + tag + '-1-misafir.png'));
// yeni kullanıcı formu (varsa "Yeni kullanıcı" düğmesi)
out.newForm = await c.evalJs("(async () => { const d = document.getElementById('users'); const b = [...d.querySelectorAll('button')].find(x => /Yeni kullanıcı/.test(x.textContent)); if (b) { b.click(); await new Promise(z => setTimeout(z, 500)); } return { clicked: !!b, text: d.innerText.replace(/\\s+/g, ' ').slice(0, 900), inputs: [...d.querySelectorAll('input')].map(i => i.type + ':' + (i.autocomplete || '-') + ':' + getComputedStyle(i).fontSize) }; })()");
await c.shot(here('users' + tag + '-2-yeni.png'));
// modül üzerinden uydurma kullanıcı (şifre bu betikte üretilir, hiçbir yere yazılmaz)
out.create = await c.evalJs("(async () => { const U = window.__anatomi.users; try { const r = await U.create(" + JSON.stringify(NAME) + ", " + JSON.stringify(PW) + ", { takeGuest: false }); return { ok: true, id: !!(r && (r.id || r)), current: U.current() && U.current().name, keys: Object.keys(localStorage).filter(k => k.startsWith('anatomi3d')).sort() }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()");
out.ready2 = await go();   // kullanıcı değişince sayfa yeniden yüklenir; emin olmak için yeniden aç
out.signedIn = await c.evalJs(openDialog);
await c.shot(here('users' + tag + '-3-kullanici.png'));
out.reg = await c.evalJs("(() => { const r = JSON.parse(localStorage.getItem('anatomi3d.users.v1') || 'null'); return r ? { v: r.v, n: r.users.length, fields: Object.keys(r.users[0] || {}).sort(), iter: r.users[0] && r.users[0].iter, saltLen: r.users[0] && String(r.users[0].salt).length, hashLen: r.users[0] && String(r.users[0].hash).length, hasPlainPw: JSON.stringify(r).includes(" + JSON.stringify(PW) + "), current: !!r.current } : null; })()");
out.wrongPw = await c.evalJs("(async () => { const U = window.__anatomi.users; const id = U.activeId(); try { await U.changePassword(id, 'yanlis-sifre', 'baska-sifre-1'); return 'KABUL EDİLDİ (hata)'; } catch (e) { return 'reddedildi: ' + String(e && e.message || e).slice(0, 80); } })()");
// temizlik: kullanıcıyı sil, misafire dön
out.cleanup = await c.evalJs("(async () => { const U = window.__anatomi.users; const id = U.activeId(); try { if (id) U.remove(id, " + JSON.stringify(NAME) + "); } catch (e) { return 'silinemedi: ' + String(e && e.message || e); } return 'silindi'; })()");
await c.sleep(2500); await ready();
out.keysAfter = await c.evalJs("Object.keys(localStorage).filter(k => k.startsWith('anatomi3d')).sort()");
out.usersLeft = await c.evalJs("window.__anatomi.users.list().length");
out.csp = await c.evalJs('[...new Set(window.__csp)]');
out.errors = c.errors().slice(0, 10);
console.log(JSON.stringify(out, null, 1));
c.close();
