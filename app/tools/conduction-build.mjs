// Kalp modunun "İleti" sekmesi (ileti sistemi) için veri derleyicisi.
// Girdi: data/work/heart/content-conduction.verified.json (metinler, zamanlama, EKG, sinirler, sorular) ve
//        data/work/heart/geo-conduction.verified.json (noktalar, cm, dünya koordinatı: +x bedenin SOLU, +y yukarı, +z ön).
// Çıktı: public/data/conduction.json (uygulamanın kullandığı birleşik dosya; kaynaklar, denetim tablosu ve
//        işaret noktalarının çoğu atılır, yalnız karıncık ekseni kalır).
// Denetimler: model parça adları public/data/meta.json'a karşı, soruların dört ayrı şıkkı, adımların ve EKG bölümlerinin
// zaman aralıkları, noktaların biçimi. Hata varsa çıkış kodu 1 (dosya yine de yazılmaz).
// Çalıştırma (app/ içinde): node tools/conduction-build.mjs
import fs from 'node:fs';

const DIR = '../data/work/heart/';
const OUT = 'public/data/conduction.json';
const C = JSON.parse(fs.readFileSync(DIR + 'content-conduction.verified.json', 'utf8'));
const G = JSON.parse(fs.readFileSync(DIR + 'geo-conduction.verified.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const names = new Set(meta.items.map(i => i.n));

const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);

// Geometri düzeltmeleri (denetlenmiş dosyalara dokunulmaz). Sahne denetiminde açıkça yanlış yerde duran bir yapı burada
// düzeltilir: anahtar -> (noktalar) => yeni noktalar. Her satıra neyin neden taşındığı yazılır.
const PATCH = {};

// sayılar 2 haneye yuvarlanır (dosya küçük kalsın; 0,1 mm yeterli)
const r2 = v => Math.round(v * 100) / 100;
const isP = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const pts = (key, list, min = 2) => {
  if (!Array.isArray(list) || list.length < min || !list.every(isP)) { err(`geo.${key}: en az ${min} nokta [x,y,z] bekleniyordu`); return []; }
  return list.map(p => p.map(r2));
};
const pt = (key, p) => { if (!isP(p)) { err(`geo.${key}: nokta [x,y,z] değil`); return [0, 0, 0]; } return p.map(r2); };
// boş alanlar yazılmaz
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map(k => [k, o[k]]));

// --- geometri ---
let geo = {
  sa: { p: pt('sa.p', G.sa?.p), r: G.sa?.r || 0.3 },
  av: { p: pt('av.p', G.av?.p), r: G.av?.r || 0.25 },
  his: pts('his', G.his), rbb: pts('rbb', G.rbb), lbb: pts('lbb', G.lbb), lbb_ant: pts('lbb_ant', G.lbb_ant), lbb_post: pts('lbb_post', G.lbb_post),
  purkinje: (G.purkinje || []).map((l, i) => pts(`purkinje[${i}]`, l)),
  purkinje_names: G.purkinje_names || [],
  internodal: (G.internodal || []).map((l, i) => pts(`internodal[${i}]`, l)),
  internodal_names: G.internodal_names || [],
  bachmann: pts('bachmann', G.bachmann),
  koch: Object.fromEntries(['apex', 'cs', 'tv', 'todaro', 'eustachian', 'cfb'].filter(k => G.koch?.[k]).map(k => [k, pt('koch.' + k, G.koch[k])])),
  // karıncık ekseni: uyarının apeksten tabana yürüyüşü bunun boyunca çizilir
  axis: { apex: pt('landmarks.apex', G.landmarks?.apex), base: pt('landmarks.base', G.landmarks?.base) },
  arc: G.arc || {},
};
for (const [k, fn] of Object.entries(PATCH)) { geo[k] = fn(geo[k]); console.log('düzeltme:', k); }
if (!geo.purkinje.length) err('geo.purkinje boş');
if (geo.internodal.length !== 3) warn(`geo.internodal: 3 yol beklenirdi, ${geo.internodal.length} var`);
// dallar birbirine bağlı mı (uçlar 0,3 cm içinde)
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const join = (a, b, what) => { if (a && b && dist(a, b) > 0.3) warn(`${what}: uçlar ${dist(a, b).toFixed(2)} cm ayrı`); };
join(geo.av.p, geo.his[0], 'AV düğümü -> His');
join(geo.his.at(-1), geo.rbb[0], 'His -> sağ dal'); join(geo.his.at(-1), geo.lbb[0], 'His -> sol dal');
join(geo.lbb.at(-1), geo.lbb_ant[0], 'sol dal -> ön fasikül'); join(geo.lbb.at(-1), geo.lbb_post[0], 'sol dal -> arka fasikül');

// --- içerik ---
const STEP_KEYS = ['sa', 'atria', 'av', 'his', 'branches', 'purkinje', 'ventricles', 'repol'];
const STRUCT_KEYS = ['sa', 'av', 'his', 'rbb', 'lbb', 'lbb_ant', 'lbb_post', 'purkinje', 'bachmann', 'internodal', 'koch'];
const ECG_KEYS = ['P', 'PQ', 'QRS', 'ST', 'T'];
const okT = (where, t) => { if (!Array.isArray(t) || t.length !== 2 || !(t[0] >= 0 && t[1] > t[0] && t[1] <= 800)) { err(`${where}: t_ms [başlangıç, bitiş] 0-800 içinde olmalı`); return [0, 1]; } return t; };

const steps = (C.steps || []).map(s => {
  if (!STEP_KEYS.includes(s.key)) warn(`steps: bilinmeyen anahtar ${s.key}`);
  return { ...pick(s, ['key', 'la', 'de', 'tr', 'where_de', 'rate_de', 'velocity_de', 'ecg', 'supply_de', 'tip', 'clinic_tr']), t_ms: okT('steps.' + s.key, s.t_ms) };
});
for (const k of STEP_KEYS.slice(0, 7)) if (!steps.some(s => s.key === k)) err(`steps: ${k} eksik`);
const structures = (C.structures || []).map(s => pick(s, ['key', 'la', 'de', 'tr', 'landmarks_de']));
for (const k of STRUCT_KEYS) if (!structures.some(s => s.key === k)) err(`structures: ${k} eksik`);
const ecg = { segments: (C.ecg?.segments || []).map(s => ({ ...pick(s, ['key', 'de', 'tr', 'norm_de']), t_ms: okT('ecg.' + s.key, s.t_ms) })) };
for (const k of ECG_KEYS) if (!ecg.segments.some(s => s.key === k)) err(`ecg: ${k} eksik`);
// Metin düzeltmesi: repolarizasyon adımı ST başında başlar (metni ST platosunu da anlatır), ama "ecg" alanı tek değer
// alıyordu ("T-Welle"). Adım ST'yi kapsıyorsa panelde ikisi birden yazılır (içerik denetimi, satır 28).
{
  const rp = steps.find(s => s.key === 'repol'), stS = ecg.segments.find(s => s.key === 'ST');
  if (rp && stS && rp.t_ms[0] <= stS.t_ms[0] && rp.ecg === 'T-Welle') { rp.ecg = 'ST-Strecke und T-Welle'; console.log('düzeltme: repol.ecg'); }
}
for (let i = 1; i < ecg.segments.length; i++) if (ecg.segments[i].t_ms[0] !== ecg.segments[i - 1].t_ms[1]) warn(`ecg: ${ecg.segments[i - 1].key} ile ${ecg.segments[i].key} arası boşluk ya da örtüşme`);

const badNames = [];
const known = (where, list) => (list || []).filter(n => { if (names.has(n)) return true; badNames.push(`${where}: ${n}`); return false; });
const innervation = (C.innervation || []).map(x => ({ ...pick(x, ['key', 'la', 'de', 'tr']), n: known('innervation.' + x.key, x.n) }));
const quiz = (C.quiz || []).map((q, i) => {
  if (typeof q.q !== 'string' || !q.q.trim()) err(`quiz ${i + 1}: soru metni yok`);
  if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options.map(o => String(o).trim().toLowerCase())).size !== 4) err(`quiz ${i + 1}: dört ayrı şık yok`);
  return pick({ ...q, show: known(`quiz ${i + 1}`, q.show) }, ['q', 'options', 'explain', 'show']);
});
for (const b of badNames) err('bilinmeyen model adı: ' + b);
for (const k of Object.values(G.parts || {})) if (!names.has(k)) err('geo.parts: bilinmeyen model adı ' + k);

const out = {
  title_tr: C.title_tr, intro_tr: C.intro_tr, steps, structures, ecg, innervation,
  extras: (C.extras || []).map(e => pick(e, ['title_de', 'tr'])),
  clinic: (C.clinic || []).map(e => pick(e, ['de', 'tr'])),
  notInModel: C.notInModel || [],
  quiz, geo,
};

console.log(`Adımlar ${steps.length}, yapılar ${structures.length}, EKG bölümleri ${ecg.segments.length}, sinir maddeleri ${innervation.length} (parçalı ${innervation.filter(x => x.n.length).length}), soru ${quiz.length}`);
console.log(`Geometri: His ${geo.his.length}, sağ dal ${geo.rbb.length}, sol dal ${geo.lbb.length}, ön/arka fasikül ${geo.lbb_ant.length}/${geo.lbb_post.length}, Purkinje ${geo.purkinje.length} çizgi, internodal ${geo.internodal.length}, Bachmann ${geo.bachmann.length} nokta`);
for (const w of warns) console.log('UYARI:', w);
if (errors.length) { for (const e of errors) console.error('HATA:', e); console.error(`${errors.length} hata: ${OUT} yazılmadı`); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT} yazıldı (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
