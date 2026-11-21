// Kullanıcılar penceresi (#users) ve sol paneldeki / telefon çekmecesindeki giriş düğmesi (#user-btn).
// Profiller yalnız bu cihazdadır (src/users.js). Kullanıcı değişince bekleyen yazmalar boşaltılır ve sayfa yeniden
// yüklenir. Pencere index.html'de durur; main.js'teki Geri tuşu katmanı (topLayer, açık dialog) onu da kapatır.
// Bütün adlar esc() ile yazılır. Açılışta: kullanıcı varsa ve kimse açık değilse liste ("Misafir olarak devam et"),
// "Açılışta şifre sor" açık profil için şifre sorulur; kullanıcısı olmayan cihaz bu pencereyi kendiliğinden görmez.
import * as users from './users.js';
import { esc } from './text.js';

const $ = s => document.querySelector(s);
const native = () => !!window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:';
const day = t => (t ? new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const HONEST = 'Şifre, bu cihazdaki profilleri birbirinden ayırır. Veriler şifrelenmez, yalnız bu cihazda kalır ve hiçbir yere gönderilmez; bir telefonda oluşturulan profil başka bir cihazda yoktur (taşımak için Dışa aktar / İçe aktar). Başka bir yerde kullandığın şifreyi kullanma. Unutulan şifre kurtarılamaz: profil, adı yazılarak silinebilir.';

export function setupUsers({ notify } = {}) {
  const dlg = $('#users'), btn = $('#user-btn');
  if (!dlg || !btn) return { open() {} };
  const me = users.current();
  let view = 'main', target = null, msg = '', busy = false, imp = null, exportText = '';
  let start = null;   // 'chooser' | 'unlock': açılışta gösterildi

  // ---------- giriş düğmesi ----------
  const shown = me ? me.name : 'Misafir';
  btn.querySelector('.u-name').textContent = shown;
  btn.querySelector('.u-av').textContent = me ? [...me.name][0].toLocaleUpperCase('tr') : '?';
  btn.classList.toggle('guest', !me);
  btn.title = `Kullanıcı: ${shown}. Kullanıcılar ve profiller (yalnız bu cihazda)`;
  const owner = $('#progress-owner');
  if (owner) owner.textContent = `Test ilerlemesi bu cihazda saklanır (${shown}).`;
  btn.addEventListener('click', () => { btn.blur(); open(); });

  // ---------- görünümler ----------
  // ac: autocomplete değeri (şifre yöneticisi doğru alanı tanısın: current-password / new-password / username)
  const field = (label, name, type = 'password', extra = '', ac = 'off') =>
    `<label class="us-field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="${ac}"${type === 'password' ? '' : ' spellcheck="false"'} ${extra}></label>`;
  // şifre yöneticisi için görünmeyen kullanıcı adı alanı (profil adı)
  const userField = name => `<input type="text" name="username" autocomplete="username" value="${esc(name)}" readonly hidden tabindex="-1" aria-hidden="true">`;
  const err = () => (msg ? `<p class="us-msg" role="alert">${esc(msg)}</p>` : '');
  const back = (label = 'Geri') => `<button type="button" data-a="main">${label}</button>`;
  const submit = label => `<button type="submit" class="pri" data-l="${esc(label)}"${busy ? ' disabled' : ''}>${busy ? 'Bekle…' : esc(label)}</button>`;
  const userOf = id => users.list().find(u => u.id === id);

  function mainView() {
    const av = users.available(), list = users.list(), cur = users.current(), pend = users.pendingUnlock();
    let h = '';
    if (!av.ok) {
      h += `<p class="us-note warn">${av.reason === 'nocrypto'
        ? 'Bu sayfa güvenli bağlantıyla (https) açılmadığı için tarayıcı şifre işlemlerini sunmuyor; kullanıcı profilleri burada kapalı. Uygulama Misafir olarak çalışır.'
        : 'Tarayıcı depolaması kapalı (ör. özel pencere ya da site verisi engeli); kullanıcı profilleri kullanılamıyor. Uygulama Misafir olarak çalışır, ilerleme yalnız bu oturumda kalır.'}</p>`;
      return h + `<p class="us-note">${HONEST}</p>`;
    }
    if (users.corrupt()) h += '<p class="us-note warn">Bu cihazdaki kullanıcı listesi okunamadı (bozuk kayıt); kullanıcı yokmuş gibi devam ediliyor. Kayıt silinmedi; yeni bir kullanıcı oluşturulursa eski kayıt yedeklenip yerine yenisi yazılır.</p>';
    else { const nd = users.damaged(); if (nd) h += `<p class="us-note warn">Kullanıcı listesinde okunamayan ${nd} kayıt var; gösterilmiyor ama silinmedi, verileri de yerinde duruyor.</p>`; }
    if (start === 'unlock' && pend) h += `<p class="us-lead">${esc(pend.name)} için açılışta şifre soruluyor.</p>`;
    else if (start === 'chooser') h += '<p class="us-lead">Kim çalışıyor?</p>';
    if (cur) {
      h += `<div class="us-me"><div class="us-me-name"><span class="u-av" aria-hidden="true">${esc([...cur.name][0].toLocaleUpperCase('tr'))}</span><div><b>${esc(cur.name)}</b><small>Açık kullanıcı · ilerleme ve sınav geçmişi bu profilde</small></div></div>
        <div class="us-grid">
          <button type="button" data-a="signout">Çıkış yap</button>
          <button type="button" data-a="password">Şifreyi değiştir</button>
          <button type="button" data-a="export">Dışa aktar</button>
          <button type="button" data-a="import">İçe aktar</button>
        </div>
        <label class="us-check"><input type="checkbox" data-a="lock"${cur.lock ? ' checked' : ''}>Açılışta şifre sor</label>
        <button type="button" class="us-danger-link" data-a="delete" data-id="${cur.id}">Kullanıcıyı sil</button></div>`;
    } else if (!start) {
      h += '<p class="us-note">Şu an <b>Misafir</b>: ilerleme bu cihazda kullanıcısız saklanır.</p>';
    }
    const others = list.filter(u => u.id !== cur?.id);
    if (others.length) {
      h += `<h3>${cur ? 'Bu cihazdaki öteki kullanıcılar' : 'Bu cihazdaki kullanıcılar'}</h3><ul class="us-list">`;
      for (const u of others) {
        h += `<li><span class="u-av" aria-hidden="true">${esc([...u.name][0].toLocaleUpperCase('tr'))}</span><span class="us-who"><b>${esc(u.name)}</b>${u.lastLogin ? `<small>son giriş ${esc(day(u.lastLogin))}</small>` : ''}</span>
          <button type="button" class="pri" data-a="signin" data-id="${u.id}">Giriş yap</button>
          <button type="button" class="us-del" data-a="delete" data-id="${u.id}" title="${esc(u.name)} kullanıcısını sil" aria-label="${esc(u.name)} kullanıcısını sil">Sil</button></li>`;
      }
      h += '</ul>';
    }
    h += '<div class="us-row">';
    h += '<button type="button" data-a="create">Yeni kullanıcı</button>';
    if (!cur) h += '<button type="button" data-a="import">İçe aktar</button>';
    if (start) h += '<button type="button" data-a="guest">Misafir olarak devam et</button>';
    h += '</div>';
    return h + err() + `<p class="us-note small">${HONEST}</p>`;
  }

  function signinView() {
    const u = userOf(target); if (!u) { view = 'main'; return mainView(); }
    return `<form data-f="signin"><p class="us-lead">${esc(u.name)} olarak giriş</p>
      ${userField(u.name)}${field('Şifre', 'pw', 'password', 'required', 'current-password')}${err()}
      <div class="us-row">${submit('Giriş yap')}${back()}</div>
      <button type="button" class="us-link" data-a="forgot" data-id="${u.id}">Şifremi unuttum</button></form>`;
  }
  function createView() {
    const first = users.list().length === 0, guest = !users.current() && users.hasGuestData();
    return `<form data-f="create"><p class="us-lead">Yeni kullanıcı</p>
      ${field('Ad', 'name', 'text', `required maxlength="${users.NAME_MAX}"`, 'username')}
      ${field('Şifre', 'pw', 'password', 'required', 'new-password')}
      ${field('Şifre (tekrar)', 'pw2', 'password', 'required', 'new-password')}
      <p class="us-note small">En az ${users.MIN_PW} karakter. Başka bir yerde kullandığın şifreyi kullanma. Unutulursa kurtarılamaz.</p>
      ${guest ? `<label class="us-check"><input type="checkbox" name="take"${first ? ' checked' : ''}>Bu cihazdaki mevcut ilerlemeyi bu kullanıcıya aktar (Misafir'den kaldırılır)</label>` : ''}
      ${err()}<div class="us-row">${submit('Oluştur ve giriş yap')}${back()}</div>
      <p class="us-note small">Profil yalnız bu cihazda oluşturulur; başka cihazda yoktur.</p></form>`;
  }
  function passwordView() {
    return `<form data-f="password"><p class="us-lead">Şifreyi değiştir</p>
      ${userField(users.current()?.name || '')}${field('Şu anki şifre', 'old', 'password', 'required', 'current-password')}
      ${field('Yeni şifre', 'pw', 'password', 'required', 'new-password')}
      ${field('Yeni şifre (tekrar)', 'pw2', 'password', 'required', 'new-password')}
      ${err()}<div class="us-row">${submit('Değiştir')}${back()}</div></form>`;
  }
  function deleteView(forgot) {
    const u = userOf(target); if (!u) { view = 'main'; return mainView(); }
    return `<form data-f="delete"><p class="us-lead">${esc(u.name)} kullanıcısını sil</p>
      ${forgot ? '<p class="us-note">Şifre kurtarılamaz: hiçbir yerde kopyası yok. Tek yol profili silip yeniden oluşturmaktır (bu cihazın site verisini silebilen herkes bunu zaten yapabilir).</p>' : ''}
      <p class="us-note warn">Profil, ilerlemesi ve sınav geçmişi bu cihazdan kalıcı olarak silinir; geri alınamaz. İstersen önce Dışa aktar ile yedekle.</p>
      ${field('Onay için kullanıcının adını yaz', 'confirm', 'text', 'required')}
      ${err()}<div class="us-row"><button type="submit" class="danger">Kalıcı olarak sil</button>${back('Vazgeç')}</div></form>`;
  }
  function exportView() {
    const cur = users.current();
    const n = Object.keys(users.exportData().progress).length;
    let h = `<p class="us-lead">Dışa aktar: ${esc(cur ? cur.name : 'Misafir')}</p>
      <p class="us-note">Dosyada ad, tarih, ${n} soru kaydı, sınav ayarları ve sınav geçmişi bulunur; şifre ya da şifre özeti yoktur. Başka bir cihazda İçe aktar ile yeni profil olarak eklenebilir ya da bir profille birleştirilebilir.</p>`;
    if (native() || exportText) {
      exportText ||= JSON.stringify(users.exportData());
      h += `${native() ? '<p class="us-note small">Uygulama sürümünde dosya indirilemiyor: metni kopyalayıp öteki cihazda İçe aktar alanına yapıştır (ya da web sürümünde dosya olarak dışa aktar).</p>' : ''}
        <textarea class="us-text" readonly rows="6" aria-label="Profil metni">${esc(exportText)}</textarea>
        <div class="us-row"><button type="button" class="pri" data-a="copy">Kopyala</button>${back()}</div>`;
    } else {
      h += `<div class="us-row"><button type="button" class="pri" data-a="download">Dosyayı indir</button><button type="button" data-a="showtext">Metin olarak göster</button>${back()}</div>`;
    }
    return h + err();
  }
  function importView() {
    const cur = users.current();
    if (!imp) {
      return `<form data-f="parse"><p class="us-lead">İçe aktar</p>
        <p class="us-note">Dışa aktarılmış bir profil dosyası (.json) seç ya da metnini yapıştır.</p>
        <label class="us-field"><span>Dosya</span><input name="file" type="file" accept=".json,application/json"></label>
        <label class="us-field"><span>ya da metin</span><textarea name="text" class="us-text" rows="4" spellcheck="false"></textarea></label>
        ${err()}<div class="us-row">${submit('Denetle')}${back()}</div></form>`;
    }
    const n = Object.keys(imp.progress).length;
    let h = `<p class="us-lead">İçe aktar: ${esc(imp.name)}</p>
      <p class="us-note">${n} soru kaydı, ${imp.history.length} sınav${imp.exported ? `, dışa aktarma ${esc(day(Date.parse(imp.exported)))}` : ''}.</p>
      <form data-f="impnew"><h3>Yeni kullanıcı olarak ekle</h3>
      ${field('Ad', 'name', 'text', `required maxlength="${users.NAME_MAX}" value="${esc(imp.name)}"`, 'username')}
      ${field('Şifre', 'pw', 'password', 'required', 'new-password')}
      ${field('Şifre (tekrar)', 'pw2', 'password', 'required', 'new-password')}
      <div class="us-row">${submit('Ekle ve giriş yap')}</div></form>`;
    if (cur) h += `<h3>${esc(cur.name)} profiliyle birleştir</h3><p class="us-note small">Her soruda daha çok cevaplanmış kayıt kalır; sınav geçmişleri tekrarsız birleşir.</p>
      <div class="us-row"><button type="button" data-a="merge"${busy ? ' disabled' : ''}>Birleştir</button></div>`;
    return h + err() + `<div class="us-row">${back()}</div>`;
  }

  function render() {
    const body = view === 'signin' ? signinView() : view === 'create' ? createView() : view === 'password' ? passwordView()
      : view === 'delete' ? deleteView(false) : view === 'forgot' ? deleteView(true) : view === 'export' ? exportView()
      : view === 'import' ? importView() : mainView();
    dlg.innerHTML = `<div class="us-head"><h2 id="users-title">Kullanıcılar</h2><button type="button" class="us-x" data-a="close" aria-label="Kapat" title="Kapat (Esc)">×</button></div><div class="us-body">${body}</div>`;
  }
  // görünüm değişince ilk alana odaklan
  function go(v, id = target) {
    view = v; target = id; msg = ''; busy = false;
    if (v !== 'export') exportText = '';
    if (v !== 'import') imp = null;
    render();
    (dlg.querySelector('.us-body input:not([type=checkbox]):not([type=file]):not([hidden]), .us-body textarea:not([readonly])') || dlg.querySelector('.us-body button'))?.focus();
  }
  function open(mode = null) {
    start = mode;
    if (!dlg.open) dlg.showModal();
    if (mode === 'unlock') { const p = users.pendingUnlock(); if (p) return go('signin', p.id); }
    go('main', null);
  }
  // kullanıcı değişti: bekleyen yazmalar, sonra yeniden yükleme (bütün modüller yeni kullanıcının anahtarlarıyla açılır)
  function switchNow() { users.flushAll(); location.reload(); }
  // Hata: form yeniden kurulmaz (ad, kutucuklar, metin ve "ilerlemeyi aktar" seçimi kalır); yalnız ileti yazılır ve
  // şifre alanları boşaltılır. Hatalı alana odaklanılır.
  const fail = (e, form = null) => {
    busy = false; msg = e?.message || String(e);
    const body = dlg.querySelector('.us-body');
    if (!body) { render(); return; }
    for (const b of body.querySelectorAll('button[type=submit]')) { b.disabled = false; if (b.dataset.l) b.textContent = b.dataset.l; }
    for (const b of body.querySelectorAll('[data-a=merge]')) b.disabled = false;
    const p = document.createElement('p'); p.className = 'us-msg'; p.setAttribute('role', 'alert'); p.textContent = msg;
    body.querySelector('.us-msg')?.remove();
    const row = form?.querySelector(':scope > .us-row');
    if (row) row.before(p);
    else { const note = body.querySelector(':scope > .us-note.small:last-child'); if (note) note.before(p); else body.append(p); }
    const scope = form || body;
    scope.querySelectorAll('input[type=password]').forEach(i => { i.value = ''; });
    const el = e?.code === 'name' ? scope.querySelector('input[name=name]') : e?.code === 'confirm' ? scope.querySelector('input[name=confirm]')
      : scope.querySelector('input[type=password]') || scope.querySelector('input:not([type=checkbox]):not([type=file]):not([hidden]), textarea:not([readonly])');
    if (el) { el.focus(); if (e?.code === 'name' || e?.code === 'confirm') el.select?.(); }
  };
  const setBusy = () => { busy = true; msg = ''; const b = dlg.querySelector('button[type=submit]'); if (b) { b.disabled = true; b.textContent = 'Bekle…'; } };

  dlg.addEventListener('close', () => {
    // açılış listesi Esc, Geri ya da × ile kapanırsa bu oturum misafir olarak sürer
    if (start) users.continueAsGuest();
    start = null; view = 'main'; imp = null; exportText = ''; msg = ''; busy = false;
    dlg.replaceChildren();   // yazılan şifreler kapalı pencerenin DOM'unda kalmasın (açılınca yeniden kurulur)
  });
  dlg.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a || busy) return;
    const act = a.dataset.a, id = a.dataset.id || null;
    if (act === 'close') { dlg.close(); return; }
    if (act === 'lock') return;   // change olayında
    if (['main', 'signin', 'create', 'password', 'delete', 'forgot', 'export', 'import'].includes(act)) { go(act, id ?? (act === 'password' ? users.activeId() : target)); return; }
    if (act === 'guest') {
      // kilitli profilde (açılışta şifre) çıkış yapılmaz, yalnız bu oturum misafir
      if (users.current()) { try { users.signOut(); switchNow(); } catch (e2) { fail(e2); } return; }
      users.continueAsGuest(); start = null; dlg.close(); return;
    }
    if (act === 'signout') { try { users.signOut(); switchNow(); } catch (e2) { fail(e2); } return; }
    if (act === 'download') { download(); return; }
    if (act === 'showtext') { exportText = JSON.stringify(users.exportData()); render(); dlg.querySelector('.us-text')?.select(); return; }
    if (act === 'copy') { copyText(); return; }
    if (act === 'merge') {
      try { const n = users.importMerge(imp); notify?.(`Birleştirildi: ${n} soru kaydı alındı`); switchNow(); } catch (e2) { fail(e2); }
    }
  });
  dlg.addEventListener('change', e => {
    if (e.target.dataset?.a !== 'lock') return;
    try { users.setLock(users.activeId(), e.target.checked); notify?.(e.target.checked ? 'Açılışta şifre sorulacak' : 'Açılışta şifre sorulmayacak'); } catch (e2) { e.target.checked = !e.target.checked; fail(e2); }
  });
  dlg.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const f = e.target, kind = f.dataset.f, v = n => f.elements[n]?.value ?? '';
    try {
      if (kind === 'signin') { setBusy(); await users.signIn(target, v('pw')); switchNow(); return; }
      if (kind === 'create' || kind === 'impnew') {
        if (v('pw') !== v('pw2')) throw new Error('Şifreler aynı değil.');
        setBusy();
        if (kind === 'create') await users.create(v('name'), v('pw'), { takeGuest: !!f.elements.take?.checked });
        else await users.importNew(imp, v('name'), v('pw'));
        switchNow(); return;
      }
      if (kind === 'password') {
        if (v('pw') !== v('pw2')) throw new Error('Yeni şifreler aynı değil.');
        setBusy(); await users.changePassword(users.activeId(), v('old'), v('pw'));
        notify?.('Şifre değiştirildi'); go('main', null); return;
      }
      if (kind === 'delete') {
        const wasMe = target === users.activeId();
        users.remove(target, v('confirm'));
        if (wasMe) { switchNow(); return; }
        notify?.('Kullanıcı silindi'); go('main', null); return;
      }
      if (kind === 'parse') {
        const file = f.elements.file?.files?.[0];
        let text = v('text').trim();
        if (file) {
          if (file.size > users.IMPORT_MAX) throw new Error('Dosya çok büyük (en çok 2 MB).');
          text = await file.text();
        }
        if (!text) throw new Error('Bir dosya seç ya da metni yapıştır.');
        imp = users.parseImport(text); msg = ''; render();
        dlg.querySelector('.us-body input[name=pw]')?.focus();
      }
    } catch (e2) { fail(e2, f); }
  });

  function fileName() {
    const cur = users.current();
    const slug = (cur ? cur.name : 'misafir').toLocaleLowerCase('tr').normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profil';
    return `anatomi3d-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  }
  function download() {
    try {
      const blob = new Blob([JSON.stringify(users.exportData(), null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = fileName(); a.hidden = true;
      dlg.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify?.('Profil dosyası indirildi');
    } catch (e) { fail(e); }
  }
  async function copyText() {
    const ta = dlg.querySelector('.us-text'); if (!ta) return;
    try { await navigator.clipboard.writeText(ta.value); notify?.('Kopyalandı'); return; } catch { /* izin yok: seçip eski yolla dene */ }
    ta.focus(); ta.select();
    try { document.execCommand('copy'); notify?.('Kopyalandı'); } catch { msg = 'Kopyalanamadı: metni seçip elle kopyala.'; render(); }
  }

  // Başka sekmede açık kullanıcı silinirse bu sekme ona yazmaya devam etmesin: misafir olarak yeniden aç
  window.addEventListener('storage', e => {
    if (e.key !== users.REG_KEY && e.key !== null) return;
    const id = users.activeId();
    if (id && !users.list().some(u => u.id === id)) { location.reload(); return; }
    if (dlg.open && !busy && view === 'main') render();
  });

  // açılış: şifre bekleyen profil ya da kullanıcı listesi
  if (users.pendingUnlock()) open('unlock');
  else if (users.needsChooser()) open('chooser');

  // Geri tuşu (main.js topLayer): alt görünümden (Yeni kullanıcı, Şifreyi değiştir, Sil, İçe aktar…) önce listeye
  // döner; true dönerse pencere açık kalır. Listedeyken false: pencere kapanır.
  function backNav() {
    if (!dlg.open || busy || view === 'main') return false;
    go('main', null);
    return true;
  }

  return { open, render, back: backNav };
}
