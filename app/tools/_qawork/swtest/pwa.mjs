// PWA denetimi: tarayıcının uygulama bildirimini (manifest) okuyup okuyamadığını ve kurulabilirlik hatalarını yazar.
// Kullanım: node pwa.mjs [adres]    (adres verilirse önce oraya gidilir)
import { connect } from './cdp.mjs';
const c = await connect();
const url = process.argv[2];
if (url) { await c.send('Page.navigate', { url }); await c.sleep(6000); }
const out = { url: await c.evalJs('location.href') };
const m = await c.send('Page.getAppManifest').catch(e => ({ error: String(e).slice(0, 200) }));
out.manifestUrl = m.url; out.manifestErrors = m.errors;
try { const d = JSON.parse(m.data || '{}'); out.manifest = { name: d.name, start_url: d.start_url, scope: d.scope, display: d.display, icons: (d.icons || []).length }; } catch { out.manifestRaw = String(m.data).slice(0, 200); }
out.installabilityErrors = (await c.send('Page.getInstallabilityErrors').catch(e => ({ error: String(e).slice(0, 200) }))).installabilityErrors;
out.sw = await c.evalJs("(async () => { const reg = await navigator.serviceWorker.getRegistration(); return reg ? { scope: reg.scope, active: reg.active && reg.active.state } : null; })()").catch(e => String(e).slice(0, 200));
out.secure = await c.evalJs('({ isSecureContext, protocol: location.protocol, standalone: matchMedia("(display-mode: standalone)").matches })');
console.log(JSON.stringify(out, null, 1));
c.close();
