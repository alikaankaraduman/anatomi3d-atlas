// Çevrimdışı kullanım ve güncelleme (PWA). Service worker (public/sw.js) yalnız derlenmiş uygulamada kaydedilir;
// geliştirme sunucusunda (npm run dev) kayıt yapılmaz, "Çevrimdışı kullanım" bölümü bunu söyler.
//
//  - Güncelleme: yeni bir sürüm beklemeye geçince altta "Yeni sürüm hazır" ve "Yenile" çıkar. Yenile, bekleyen
//    service worker'a skip-waiting gönderir; denetim ona geçince sayfa bir kez yeniden yüklenir.
//  - İlk ziyaret: service worker sayfayı denetlemeye başlamadan önce yüklenen modeller ve veri dosyaları ona bildirilir
//    (PerformanceObserver, workerStart 0 olan istekler), böylece bir kez açılan her şey çevrimdışı da açılır.
//  - Hakkında penceresindeki "Çevrimdışı kullanım": önbellek durumu, bütün modelleri ve verileri indirme (ilerlemeyle),
//    önbelleği temizleme.
const $ = s => document.querySelector(s);
const MB = n => (n / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

// Uygulama kabuğunda aynı kökenli bir belge bağlantısı (target=_blank olsa da) WebView'de uygulamanın yerine açılır ve
// Android'in Geri tuşu uygulamayı kapatır, iOS'ta geri düğmesi yoktur: bu bağlantılar #doc penceresinde gösterilir.
// Başka sunuculara giden bağlantılara dokunulmaz (Capacitor onları sistem tarayıcısına gönderir).
// Çerçeve her açılışta YENİDEN kurulur ve kapanınca silinir: var olan bir çerçevenin adresini değiştirmek sayfanın ortak
// geçmişine kayıt ekler (yalnız yeni eklenen çerçevenin ilk yüklemesi eklemez); o kayıtlar Geri tuşunu çerçevenin içinde
// oyalar ve geçmişi büyütürdü. Çerçeve korumalıdır (sandbox: betik çalıştıramaz, üst sayfayı değiştiremez); belgedeki
// "Uygulamaya dön" gibi üst sayfaya giden bağlantılar yüklenince kaldırılır (pencerenin kendi Kapat düğmesi var).
function nativeDocs() {
  const dlg = $('#doc'), box = dlg?.querySelector('.doc-frame');
  if (!dlg || !box) return;
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented) return;
    const u = new URL(a.getAttribute('href'), location.href);
    if (u.origin !== location.origin || !/\.(txt|html)$/i.test(u.pathname) || u.pathname === new URL('index.html', location.href).pathname) return;
    e.preventDefault();
    if (/\.txt$/i.test(u.pathname)) {
      // Düz metin çerçevede gösterilmez: WebView koyu temada metin belgesini açık renk yazıyla çizer, çerçevenin zemini
      // de beyaz kalır (Android emülatöründe ölçüldü: beyaz zemine beyaz yazı). Metin okunur ve uygulamanın kendi
      // renkleriyle bir <pre> içinde gösterilir.
      const pre = document.createElement('pre');
      pre.className = 'doc-text'; pre.tabIndex = 0; pre.textContent = 'Yükleniyor…';
      box.replaceChildren(pre);
      fetch(u.href).then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(t => { pre.textContent = t; }).catch(() => { pre.textContent = 'Belge açılamadı.'; });
      if (!dlg.open) dlg.showModal();
      return;
    }
    const frame = document.createElement('iframe');
    frame.title = 'Belge';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.addEventListener('load', () => {
      try { frame.contentDocument?.querySelectorAll('a[target="_top"], a[target="_parent"]').forEach(x => x.remove()); } catch { /* erişilemezse bağlantı zaten çalışmaz */ }
    });
    frame.src = u.href;
    box.replaceChildren(frame);
    if (!dlg.open) dlg.showModal();
  });
  dlg.addEventListener('close', () => box.replaceChildren());
}

// Android'in Geri tuşu (yalnız uygulama kabuğunda). Capacitor çekirdeği Geri tuşunu işlemez; @capacitor/app eklentisi
// kuruluysa tuş buraya gelir. Sayfa geçmişinde geri gidilebiliyorsa (main.js'teki katman koruması: açık bir pencere,
// çalışma modu, seçim...) geri gidilir, yani en üstteki katman kapanır; gidilemiyorsa uygulama arka plana alınır.
// Eklenti yüklenemezse hiçbir şey bozulmaz (eklentinin kendi varsayılanı: gidilebiliyorsa geri git).
function nativeBack() {
  import('@capacitor/app').then(({ App }) => App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back(); else App.minimizeApp();
  })).catch(err => console.warn('Geri tuşu eklentisi yüklenemedi:', err));
}

export function setupPWA({ notify }) {
  const el = { status: $('#off-status'), bar: $('#off-bar'), fill: $('#off-bar i'), all: $('#off-all'), clear: $('#off-clear') };
  const supported = 'serviceWorker' in navigator && 'caches' in window;
  // Capacitor gibi bir uygulama kabuğunda dosyalar zaten cihazdadır; service worker orada mağaza güncellemesinden
  // sonra eski sürümü sunmaya devam ederdi, bu yüzden kaydedilmez
  const native = !!window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:';
  if (native) { nativeDocs(); nativeBack(); }
  if (!import.meta.env.PROD || !supported || native) {
    // geliştirme sunucusu ya da uygulama kabuğu: aynı kökende daha önce kaydedilmiş bir service worker kalmasın
    if (supported) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    el.status.textContent = !supported
      ? 'Bu tarayıcı çevrimdışı kullanımı desteklemiyor (service worker yok ya da sayfa güvenli bağlantıyla açılmadı).'
      : native ? 'Uygulama sürümünde bütün dosyalar zaten cihazda; ayrıca indirmek gerekmez.'
      : 'Geliştirme sunucusunda çevrimdışı kullanım kapalı; derlenmiş uygulamada (npm run build) çalışır.';
    el.all.disabled = el.clear.disabled = true;
    return { refreshStatus() {} };
  }

  // Sayfanın tabanına göre göreli yol (base './': uygulama bir alt yolda da çalışır)
  const base = new URL('.', location.href);
  const relOf = url => {
    const u = new URL(url, location.href);
    return u.origin === base.origin && u.pathname.startsWith(base.pathname) ? decodeURIComponent(u.pathname.slice(base.pathname.length)) : null;
  };

  let reg = null;
  const ready = navigator.serviceWorker.register('sw.js', { scope: './' }).then(r => { reg = r; watch(r); return r; });
  let regFailed = false;
  ready.catch(err => {
    regFailed = true; el.all.disabled = el.clear.disabled = true;
    console.warn('Service worker kaydedilemedi:', err); el.status.textContent = 'Çevrimdışı kullanım bu tarayıcıda açılamadı (service worker kaydedilemedi). Uygulama çevrimiçi çalışmaya devam eder.';
  });

  // mesaj gönder, MessageChannel ile cevabı bekle. Kayıt başarısızsa ya da service worker etkinleşmezse beklemez.
  async function ask(msg) {
    const r = await Promise.race([
      ready.then(() => navigator.serviceWorker.ready),
      new Promise((_, rej) => setTimeout(() => rej(new Error('service worker hazır değil')), 20000)),
    ]);
    const sw = r.active; if (!sw) throw new Error('service worker etkin değil');
    return new Promise((res, rej) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => rej(new Error('zaman aşımı')), 180000);
      ch.port1.onmessage = e => { clearTimeout(t); if (e.data?.ok) res(e.data); else rej(new Error(e.data?.error || 'hata')); };
      sw.postMessage(msg, [ch.port2]);
    });
  }

  // ---------- ilk ziyaret: denetimden önce yüklenenleri bildir ----------
  const warm = new Set(); let warmTimer = 0;
  const flushWarm = () => { const paths = [...warm]; warm.clear(); if (paths.length) ask({ type: 'cache', paths }).catch(() => {}); };
  const noteEntry = e => {
    if (e.workerStart > 0) return;   // service worker üzerinden geldi: zaten önbellekte
    const p = relOf(e.name); if (!p || !/^(models\/.+\.glb|data\/.+\.json)$/.test(p)) return;
    warm.add(p); clearTimeout(warmTimer); warmTimer = setTimeout(() => ready.then(flushWarm, () => warm.clear()), 1500);   // kayıt başarısızsa sessizce bırak
  };
  try {
    for (const e of performance.getEntriesByType('resource')) noteEntry(e);
    new PerformanceObserver(list => list.getEntries().forEach(noteEntry)).observe({ type: 'resource', buffered: true });
  } catch { /* eski tarayıcı: modeller ilk kullanımda değil, bir sonraki açılışta önbelleğe girer */ }

  // ---------- güncelleme bildirimi ----------
  const bar = document.createElement('div');
  bar.id = 'update-bar'; bar.hidden = true; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Yeni sürüm hazır</span><button type="button">Yenile</button>';
  document.getElementById('app').appendChild(bar);
  const btn = bar.querySelector('button');
  let reloading = false, hadController = !!navigator.serviceWorker.controller;
  btn.addEventListener('click', () => {
    const w = reg?.waiting; if (!w) { location.reload(); return; }
    btn.disabled = true; btn.textContent = 'Yenileniyor…';
    w.postMessage({ type: 'skip-waiting' });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // ilk kurulumda (önceki denetleyici yokken, clients.claim) yeniden yükleme gerekmez. Sonraki her değişim yeni bir
    // sürümdür (bu sekmede ya da başka bir sekmede Yenile): eski kod yeni verilerle çalışmasın diye bu sekme de yenilenir.
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    reloading = true; location.reload();
  });
  const showUpdate = () => { if (navigator.serviceWorker.controller) bar.hidden = false; };
  function watch(r) {
    if (r.waiting) showUpdate();
    r.addEventListener('updatefound', () => {
      const w = r.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed') showUpdate(); });
    });
    // uygulama uzun süre açık kalırsa (telefonda arka plandan dönünce) yeni sürüm var mı diye bak
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
  }

  // ---------- Hakkında penceresi: Çevrimdışı kullanım ----------
  let busy = false;
  async function refreshStatus() {
    if (busy || regFailed) return null;
    try {
      const s = await ask({ type: 'status' });
      const all = s.files, done = all.filter(f => f.cached);
      const tot = all.reduce((a, f) => a + f.size, 0), have = done.reduce((a, f) => a + f.size, 0);
      const models = all.filter(f => f.p.startsWith('models/')), mDone = models.filter(f => f.cached).length;
      el.status.innerHTML = `Önbellekte ${MB(have)} / ${MB(tot)} MB · modeller ${mDone} / ${models.length}${done.length === all.length ? ' · <b>tamamı çevrimdışı açılır</b>' : ''}`
        + `<br><span class="dim">Sürüm ${s.version}</span>`;
      el.fill.style.width = (tot ? 100 * have / tot : 0).toFixed(1) + '%';
      el.bar.hidden = false;
      el.all.textContent = `Hepsini indir (≈${Math.round(tot / 1048576)} MB)`;
      el.all.disabled = done.length === all.length;
      return s;
    } catch (err) {
      el.status.textContent = 'Önbellek durumu okunamadı: ' + (err?.message || err);
      return null;
    }
  }
  async function downloadAll() {
    if (busy) return;
    const s = await refreshStatus(); if (!s) return;
    busy = true; el.all.disabled = el.clear.disabled = true;
    try { await navigator.storage?.persist?.(); } catch { /* izin verilmezse tarayıcı yer darlığında önbelleği silebilir */ }
    const tot = s.files.reduce((a, f) => a + f.size, 0);
    let have = s.files.filter(f => f.cached).reduce((a, f) => a + f.size, 0);
    // küçük dosyalar önce; her dosya ayrı mesajla, böylece ilerleme görünür
    const todo = s.files.filter(f => !f.cached).sort((a, b) => a.size - b.size);
    let failed = 0;
    for (const f of todo) {
      el.status.textContent = `İndiriliyor: ${f.p} (${MB(have)} / ${MB(tot)} MB)`;
      try { await ask({ type: 'cache', paths: [f.p] }); have += f.size; } catch (err) { failed++; console.warn('Önbelleğe alınamadı:', f.p, err); }
      el.fill.style.width = (100 * have / tot).toFixed(1) + '%';
    }
    busy = false; el.clear.disabled = false;
    await refreshStatus();
    notify(failed ? `${failed} dosya indirilemedi` : 'Bütün modeller ve veriler çevrimdışı kullanılabilir');
  }
  let armTimer = 0;
  async function clearAll() {
    if (busy) return;
    if (!el.clear.classList.contains('armed')) {   // iki adımlı: ilk tıklama onay ister
      el.clear.classList.add('armed'); el.clear.textContent = 'Emin misin? Tekrar tıkla';
      armTimer = setTimeout(() => { el.clear.classList.remove('armed'); el.clear.textContent = 'Önbelleği temizle'; }, 4000);
      return;
    }
    clearTimeout(armTimer); el.clear.classList.remove('armed'); el.clear.textContent = 'Önbelleği temizle';
    try { await ask({ type: 'clear' }); notify('Önbellek temizlendi; uygulama çevrimiçi açıldıkça yeniden dolar'); }
    catch (err) { notify('Önbellek temizlenemedi'); console.warn(err); }
    refreshStatus();
  }
  el.all.addEventListener('click', downloadAll);
  el.clear.addEventListener('click', clearAll);
  el.status.textContent = 'Önbellek durumu okunuyor…';
  return { refreshStatus };
}
