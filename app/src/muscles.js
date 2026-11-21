// Kas kartları (data/muscles.json): her model kas adı için Ursprung, Ansatz, Innervation ve Funktion. Yapı kartında
// (ui.js) ve hareket sistemi modunda (locomotor.js) kullanılır. Veri data/work/locomotor/muscles-*.verified.json
// dosyalarından derlenir (ajanların yazıp denetlediği dört bölge: upper, lower, trunk, headneck).
import { esc } from './text.js';

// Dönüş: { muscles: ad -> kart, wholes: bütün kasın Latince adı -> { whole_la, batch, group_de, parts: [adlar] }, groups, quiz }
export async function loadMuscles() {
  const r = await fetch('data/muscles.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const wholes = new Map();
  for (const [name, c] of Object.entries(j.muscles)) {
    const k = c.whole_la || name;
    if (!wholes.has(k)) wholes.set(k, { whole_la: k, batch: c.batch, group_de: c.group_de, parts: [] });
    wholes.get(k).parts.push(name);
  }
  return { ...j, wholes };
}

const uniq = a => [...new Set(a.filter(Boolean))];
// Bir kasın (bir ya da birkaç başının) kart satırları: [anahtar, başlık, HTML]. Başların değeri aynıysa tek satır,
// farklıysa baş baş yazılır.
export function cardRows(cards) {
  const per = f => {
    const vals = cards.map(c => c[f]);
    if (uniq(vals).length <= 1) return esc(vals.find(Boolean) || '');
    return cards.filter(c => c[f]).map(c => `${c.part_la ? `<b lang="la">${esc(c.part_la)}</b>: ` : ''}${esc(c[f])}`).join('<br>');
  };
  const mc = cards.some(c => !c.nonMuscle) ? cards.filter(c => !c.nonMuscle) : cards;   // tendon gibi kas olmayan parçanın "siniri" yazılmaz
  const nerve = uniq(mc.map(c => (c.nerve_la ? `${c.nerve_la}${c.seg ? ` (${c.seg})` : ''}` : ''))).map(esc).join('<br>');
  const fde = uniq(cards.map(c => c.f_de)).map(esc).join('<br>'), ftr = uniq(cards.map(c => c.f_tr)).map(esc).join(' ');
  return [
    ['o', 'Ursprung', per('o')], ['i', 'Ansatz', per('i')], ['n', 'Innervation', nerve],
    ['f', 'Funktion', fde + (ftr ? `${fde ? '<br>' : ''}<small lang="tr">${ftr}</small>` : '')],
  ].filter(r => r[2]);
}
// Kart tablosu. hidden: gizli satır anahtarları (kendini sınama: satır "göster" düğmesiyle açılır)
export function cardHTML(cards, { hidden = null } = {}) {
  const rows = cardRows(cards);
  if (!rows.length) return '';
  const tips = uniq(cards.map(c => c.tip)), kenn = uniq(cards.map(c => c.kenn)), notes = uniq(cards.map(c => c.note));
  return `<table class="cnfacts mcard" lang="de">${rows.map(([k, t, v]) => `<tr><td>${t}</td><td>${hidden?.has(k) ? `<button class="reveal" data-mrow="${k}">göster</button>` : v}</td></tr>`).join('')}</table>
    ${kenn.length ? `<div class="chips"><span class="chip">Kennmuskel ${esc(kenn.join(', '))}</span></div>` : ''}
    ${!hidden?.size ? tips.map(t => `<div class="tip">${esc(t)}</div>`).join('') : ''}
    ${notes.map(t => `<p class="htext dim small">${esc(t)}</p>`).join('')}`;
}
