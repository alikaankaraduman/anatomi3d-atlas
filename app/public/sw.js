// Anatomi 3D service worker (kütüphanesiz). Yalnız derlenmiş uygulamada kaydedilir (src/pwa.js, import.meta.env.PROD).
//
// Dosya listesi ve sürüm derlemede yazılır (vite.config.js, anatomiSW): her dosya için içerik özeti ve boyut.
// Önbellek anahtarı dosya yolu + "?v=<özet>"tir; böylece yeni bir derleme hiçbir zaman eski veriyi sunmaz, değişmeyen
// dosyalar ise yeniden indirilmez (önceki sürümün önbelleğinden kopyalanır).
//  - Uygulama kabuğu (index.html, assets/*, data/*.json, simgeler, manifest): kurulumda önbelleğe alınır,
//    sürüme bağlı önbellekte durur (anatomi3d-shell-<sürüm>); eski sürümlerinki etkinleşmede silinir.
//  - Modeller (models/*.glb): önce önbellek; ilk kullanımda ya da "Hepsini indir" ile gelir. Tek bir kalıcı önbellekte
//    durur (anatomi3d-models); listede artık olmayan özetler etkinleşmede silinir.
//  - Sayfa açılışı (navigate; yalnız uygulama adresi, doğrudan açılan .json/.glb değil): önbellekteki index.html;
//    yoksa ağdan alınıp yeniden önbelleğe konur; ağ da yoksa kısa bir çevrimdışı sayfası.
//  - Ağdan gelen her dosya sürümlü adresten istenir ve içerik özeti denetlenir (fetchAndPut). Tek istisna index.html:
//    barındırıcı sayfaya ek yapmışsa özet yerine sürümün giriş dosyalarına başvurup başvurmadığına bakılır.
//  - Yeni sürüm bekler (waiting): sayfa "Yeni sürüm hazır" gösterir, "Yenile" ile skip-waiting mesajı gelir.
self.__BUILD__ = null;
const B = self.__BUILD__ || { version: 'dev', files: {} };
const PREFIX = 'anatomi3d-';
const SHELL = PREFIX + 'shell-' + B.version;
const MODELS = PREFIX + 'models';
const scope = new URL(self.registration.scope);

// kapsam içindeki göreli yol (ör. 'models/bones.glb'); kapsam dışı ya da başka köken: null
function relPath(url) {
  const u = new URL(url);
  if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return null;
  try { return decodeURIComponent(u.pathname.slice(scope.pathname.length)); } catch { return null; }
}
const isModel = p => p.startsWith('models/');
const keyOf = p => new URL(p + '?v=' + B.files[p][0], scope).href;
const cacheFor = p => (isModel(p) ? MODELS : SHELL);
const PRECACHE = Object.keys(B.files).filter(p => !isModel(p));

// Dosyayı önbelleğe koy ve yanıtı döndür. Aynı özetle başka bir önbellekte (önceki sürüm) varsa oradan kopyalanır.
// İstek sürümlü adrese gider ("?v=<özet>"): statik sunucular sorguyu yok sayar, CDN önbellekleri ise onu ayrı bir
// adres sayar, böylece kenar sunucudaki eski bir kopya yeni sürüm diye gelmez. Gövdenin özeti yine de denetlenir;
// tutmazsa (yayın sırasında karışık sürüm) önbelleğe yazılmaz. Yanıt gövdeden yeniden kurulur: yönlendirilmiş bir
// yanıt (ör. /index.html -> /) sayfa açılışına (navigate) verilemez.
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
// index.html için ikinci bir ölçüt: bazı barındırıcılar HTML'e yolda kendi öğelerini ekler (Netlify ücretsiz planda bir
// yorum satırı ve rozet betiği), o zaman bayt özeti tutmaz ve bütün kurulum düşerdi. Sayfa bu sürümün adında özet
// taşıyan giriş dosyalarına (B.entry: assets/index-<özet>.js/.css) başvuruyorsa bu sürüme aittir ve kabul edilir;
// başka bir sürümün sayfası (yayın sırasında karışık sürüm) başka adlara başvurur ve yine reddedilir.
// Öteki HTML belgeleri (gizlilik.html) için de bayt özeti aranmaz: barındırıcı ekini her HTML sayfasına yapar, bu
// belgeler de hiçbir giriş dosyasına başvurmaz; eski bir kopyaları zararsızdır (düz metin sayfası).
const sameBuildPage = (p, body) => p.endsWith('.html') && (p !== 'index.html' || (Array.isArray(B.entry) && B.entry.length > 0
  && (html => B.entry.every(a => html.includes(a)))(new TextDecoder().decode(body))));
async function fetchAndPut(p) {
  const key = keyOf(p), c = await caches.open(cacheFor(p));
  const old = await caches.match(key);
  if (old) { await c.put(key, old.clone()); return old; }
  // 'no-cache': tarayıcının HTTP önbelleği sunucuya sormadan eski bir kopya vermesin
  const res = await fetch(new Request(key, { cache: 'no-cache' }));
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  const body = await res.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', body)).slice(0, 12) !== B.files[p][0] && !sameBuildPage(p, body)) throw new Error(`${p}: sunucudaki dosya bu sürümle eşleşmiyor`);
  const clean = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  await c.put(key, clean.clone());
  return clean;
}
async function cached(p) { return !!(await caches.match(keyOf(p))); }

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // altışar altışar: kabuk ve veri yaklaşık 2,5 MB
    const list = [...PRECACHE];
    await Promise.all(Array.from({ length: 6 }, async () => { while (list.length) await fetchAndPut(list.shift()); }));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX + 'shell-') && k !== SHELL) await caches.delete(k);
    const want = new Set(Object.keys(B.files).filter(isModel).map(keyOf));
    const mc = await caches.open(MODELS);
    for (const req of await mc.keys()) if (!want.has(req.url)) await mc.delete(req);
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Anatomi 3D</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#26282d;color:#dfe2e8;font:15px system-ui,sans-serif;text-align:center">'
  + '<div><h1 style="font-size:20px">Anatomi 3D</h1><p>Çevrimdışısınız ve uygulama henüz bu cihaza kaydedilmedi.<br>İnternete bağlanınca bir kez açın.</p></div>';

async function navigate(req) {
  if (!B.files['index.html']) return fetch(req);
  const hit = await caches.match(keyOf('index.html'));
  if (hit) return hit;
  // önbellekte yok (kurulum yarım kaldı ya da "Önbelleği temizle"): ağdan alınıp yeniden önbelleğe konur
  try { return await fetchAndPut('index.html'); } catch { /* ağ yok ya da sunucudaki sürüm tutmuyor */ }
  try { return await fetch(req); }
  catch { return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
}
async function cacheFirst(p) {
  const hit = await caches.match(keyOf(p));
  if (hit) return hit;
  try { return await fetchAndPut(p); }
  catch { return fetch(new URL(p, scope).href); }   // önbelleğe yazılamadıysa (ör. depolama dolu) yalnız ağdan
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const p = relPath(req.url); if (p === null) return;
  if (req.mode === 'navigate') {
    // yalnız uygulamanın kendi adresi (kapsam kökü ya da index.html) uygulama kabuğunu alır. Başka bir yol
    // (ör. yanlış yazılmış /foo/bar) kabuğu almaz: kabuk oradan göreli dosyalarını bulamaz ve sayfa boş kalırdı.
    // Listedeki belgeler (lisanslar.txt, gizlilik.html) önbellekten açılır ki çevrimdışıyken de okunabilsin; doğrudan
    // açılan bir model ya da veri dosyası olduğu gibi ağdan gelir.
    if (p === '' || p === 'index.html') e.respondWith(navigate(req));
    else if (B.files[p] && (p.endsWith('.txt') || p.endsWith('.html'))) e.respondWith(cacheFirst(p).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  if (!B.files[p]) return;   // listede olmayan istekler (ör. geliştirme dosyaları) doğrudan ağa gider
  e.respondWith(cacheFirst(p));
});

// Sayfadan gelen mesajlar; yanıt MessageChannel portundan döner.
self.addEventListener('message', e => {
  const d = e.data || {}, reply = v => e.ports[0]?.postMessage(v);
  if (d.type === 'skip-waiting') { self.skipWaiting(); return; }
  e.waitUntil((async () => {
    try {
      if (d.type === 'status') {
        const files = await Promise.all(Object.entries(B.files).map(async ([p, [, size]]) => ({ p, size, cached: await cached(p) })));
        reply({ ok: true, version: B.version, files });
      } else if (d.type === 'cache') {
        // verilen yolları (yalnız listedekiler) önbelleğe al; zaten varsa dokunma
        let n = 0;
        for (const p of d.paths || []) if (B.files[p] && !(await cached(p))) { await fetchAndPut(p); n++; }
        reply({ ok: true, n });
      } else if (d.type === 'clear') {
        for (const k of await caches.keys()) if (k.startsWith(PREFIX)) await caches.delete(k);
        reply({ ok: true });
      } else reply({ ok: false, error: 'bilinmeyen mesaj' });
    } catch (err) { reply({ ok: false, error: String(err?.message || err) }); }
  })());
});
