// Hareket sistemi modunun verisini derler: data/work/locomotor/ altındaki ajan çıktılarından
//   public/data/locomotor.json  (sinirler, geçitler, eklemler, hazır noktalar, bilgi soruları)
//   public/data/muscles.json    (kas kartları: Ursprung, Ansatz, Innervation, Funktion)
// Her içerik dosyasının denetlenmiş hâli (*.verified.json) kullanılır; yoksa taslağı (uyarıyla). Model adları meta.json'a
// karşı denetlenir. Çalıştırma (app/ içinde): node tools/locomotor-build.mjs
import fs from 'node:fs';
import { applyFixes } from './quiz-patch.mjs';

const W = '../data/work/locomotor/', OUT = 'public/data/';
const meta = JSON.parse(fs.readFileSync(OUT + 'meta.json', 'utf8'));
const names = new Set(meta.items.map(i => i.n));
const warn = [];
const read = base => {
  for (const f of [`${base}.verified.json`, `${base}.json`]) {
    if (fs.existsSync(W + f)) { if (!f.includes('.verified')) warn.push(`${base}: denetlenmiş dosya yok, taslak kullanıldı`); return JSON.parse(fs.readFileSync(W + f, 'utf8')); }
  }
  warn.push(`${base}: dosya yok`); return null;
};
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map(k => [k, o[k]]));
const bad = new Set();
const ok = (where, list) => (list || []).filter(n => { if (names.has(n)) return true; bad.add(`${where}: ${n}`); return false; });
const r2 = p => p.map(v => Math.round(v * 100) / 100);
const quiz = [];
const addQuiz = (list, cat, where) => {
  for (const q of list || []) {
    if (!Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options).size !== 4) { warn.push(`${where}: şıkları bozuk soru atlandı: ${String(q.q).slice(0, 50)}`); continue; }
    const show = ok(`${where}.quiz`, q.show);
    quiz.push({ q: q.q, options: q.options, explain: q.explain, cat, ...(show.length ? { show } : {}) });
  }
};

// --- sinirler
const N = read('content-nerves');
const nerves = (N?.nerves || []).map(n => ({
  ...pick(n, ['key', 'region', 'la', 'de', 'short_tr', 'roots', 'origin_de', 'course_tr', 'sensory_tr', 'autonom_de', 'reflex_de', 'tip', 'notInModel']),
  n: ok(`nerve.${n.key}`, n.n),
  muscle_groups: (n.muscle_groups || []).map(g => ({ ...pick(g, ['label_de', 'note_tr']), n: ok(`nerve.${n.key}.muscles`, g.n) })).filter(g => g.n.length),
  sites: (n.sites || []).map(s => ({
    ...pick(s, ['key', 'la', 'de', 'where_tr', 'cause_de', 'lesion_de', 'lesion_tr', 'spared_tr', 'sensory_loss_tr', 'signs_de']),
    lost: ok(`nerve.${n.key}@${s.key}.lost`, s.lost), landmarks: ok(`nerve.${n.key}@${s.key}.landmarks`, s.landmarks),
  })),
}));
for (const n of nerves) {                                      // tutarlılık: felçli kaslar sinirin kasları arasında olmalı
  const all = new Set(n.muscle_groups.flatMap(g => g.n));
  for (const s of n.sites) for (const x of s.lost) if (!all.has(x)) warn.push(`nerve.${n.key}@${s.key}: felçli listesinde sinirin kasları arasında olmayan kas: ${x}`);
}
addQuiz(N?.quiz, 'nerve', 'nerves');
const plexus = {};
for (const [k, v] of Object.entries(N?.plexus || {})) plexus[k] = { ...pick(v, ['la', 'de', 'roots', 'tr', 'lesions_tr', 'tip', 'notInModel']), n: ok(`plexus.${k}`, v.n) };
const kennmuskeln = (N?.kennmuskeln || []).map(k => ({ ...pick(k, ['seg', 'muscle_de', 'reflex_de']), n: ok('kennmuskeln', k.n) }));

// --- geçitler
const P = read('content-passages');
const passages = (P?.passages || []).map(p => ({
  ...pick(p, ['key', 'region', 'la', 'de', 'short_tr', 'order_tr', 'tip', 'clinic', 'sex_tr', 'notInModel']),
  bounds: (p.bounds || []).map(b => ({ ...pick(b, ['role_de', 'role_tr', 'la']), n: ok(`passage.${p.key}.bounds`, b.n) })),
  contents: (p.contents || []).map(c => ({ ...pick(c, ['key', 'la', 'de', 'kind', 'note_tr']), n: ok(`passage.${p.key}.contents`, c.n) })),
  context: ok(`passage.${p.key}.context`, p.context),
}));
addQuiz(P?.quiz, 'passage', 'passages');

// --- eklemler
const J = read('content-joints');
const joints = (J?.joints || []).map(j => ({
  ...pick(j, ['key', 'la', 'de', 'type_de', 'type_tr', 'freiheitsgrade', 'partner_tr', 'clinic', 'tip', 'notInModel']),
  bones: ok(`joint.${j.key}.bones`, j.bones),
  ligaments: (j.ligaments || []).map(l => ({ ...pick(l, ['la', 'de', 'course_tr', 'function_tr', 'test_de']), n: ok(`joint.${j.key}.ligaments`, l.n) })),
  extras: (j.extras || []).map(x => ({ ...pick(x, ['la', 'de', 'tr']), n: ok(`joint.${j.key}.extras`, x.n) })),
  movements: (j.movements || []).map(x => ({ ...pick(x, ['de', 'tr', 'range_de', 'note_tr']), muscles: ok(`joint.${j.key}.movements`, x.muscles) })),
}));
addQuiz(J?.quiz, 'joint', 'joints');

// --- hazır noktalar (tools/_locowork/geo-*/geo.mjs çıktıları)
const geo = { sites: {}, passages: {} };
const GN = fs.existsSync(W + 'geo-nerves.json') ? JSON.parse(fs.readFileSync(W + 'geo-nerves.json', 'utf8')) : null;
if (!GN) warn.push('geo-nerves.json yok: lezyon yerleri sinirin yer işaretlerine en yakın köşesinden kestirilir');
for (const [k, v] of Object.entries(GN?.sites || {})) if (Array.isArray(v.p)) geo.sites[k] = { p: r2(v.p), ...(Array.isArray(v.out) ? { out: r2(v.out) } : {}), ...(v.ok === false ? { ok: false } : {}) };
const GP = fs.existsSync(W + 'geo-passages.json') ? JSON.parse(fs.readFileSync(W + 'geo-passages.json', 'utf8')) : null;
if (!GP) warn.push('geo-passages.json yok: geçit etiketleri sınırların ortasına en yakın köşeden kestirilir');
for (const [k, v] of Object.entries(GP || {})) {
  if (!v || !Array.isArray(v.center)) continue;
  geo.passages[k] = {
    center: r2(v.center), ...(Array.isArray(v.dir) ? { dir: r2(v.dir) } : {}), ...(v.box?.min ? { box: { min: r2(v.box.min), max: r2(v.box.max) } } : {}),
    contents: Object.fromEntries(Object.entries(v.contents || {}).filter(([, c]) => Array.isArray(c.p)).map(([ck, c]) => [ck, { p: r2(c.p), ...(c.passes === false ? { passes: false } : {}) }])),
    bounds: (v.bounds || []).filter(b => Array.isArray(b.p)).map(b => ({ i: b.i, p: r2(b.p) })),
  };
}
for (const n of nerves) for (const s of n.sites) if (GN && !geo.sites[`${n.key}@${s.key}`]) warn.push(`geo: lezyon yeri noktası yok: ${n.key}@${s.key}`);
for (const p of passages) if (GP && !geo.passages[p.key]) warn.push(`geo: geçit noktaları yok: ${p.key}`);

// --- kas kartları
const muscles = {}, groups = {}, mquiz = [];
const mnames = new Set(meta.items.filter(i => i.s === 'muscle' && i.sub === 'muscle').map(i => i.n));
for (const b of ['upper', 'lower', 'trunk', 'headneck']) {
  const M = read(`muscles-${b}`); if (!M) continue;
  for (const [name, c] of Object.entries(M.muscles || {})) {
    if (!mnames.has(name)) { bad.add(`muscles.${b}: ${name}`); continue; }
    muscles[name] = { ...pick(c, ['whole_la', 'part_la', 'group_de', 'o', 'i', 'nerve_la', 'seg', 'f_de', 'f_tr', 'tip', 'kenn', 'note']), nerve_n: ok(`muscles.${b}.${name}.nerve_n`, c.nerve_n), batch: b };
  }
  const used = new Set(Object.values(M.muscles || {}).map(c => c.group_de));
  groups[b] = [...new Set([...(M.groups || []).filter(g => used.has(g)), ...used])].filter(Boolean);
  const before = quiz.length; addQuiz(M.quiz, 'muscle', `muscles.${b}`); mquiz.push(...quiz.splice(before));
}
const missing = [...mnames].filter(n => !muscles[n]);
if (missing.length) warn.push(`kas kartı olmayan ${missing.length} kas: ${missing.slice(0, 8).join('; ')}${missing.length > 8 ? ' …' : ''}`);

// --- derleme sırasında uygulanan düzeltmeler (inceleme bulguları; ajanların dosyaları değişmeden kalır)
const rm = (list, re) => (list || []).filter(n => !re.test(n));
for (const n of nerves) {
  // M. psoas major: doğrudan Plexus lumbalis dalları (kartı da öyle der); N. femoralis'in kasları arasında gösterilmez
  if (n.key === 'femoralis') { for (const g of n.muscle_groups) g.n = rm(g.n, /psoas/i); n.muscle_groups = n.muscle_groups.filter(g => g.n.length); for (const s of n.sites) s.lost = rm(s.lost, /psoas/i); }
  // M. teres major yalnız varyant olarak Nn. subscapulares'ten: felçli listesinde gösterilmez
  if (n.key === 'subscapularis') for (const s of n.sites) s.lost = rm(s.lost, /^Teres major/i);
}
for (const j of joints) for (const mv of j.movements) {
  if (j.key === 'knie' && /^Außenrotation/.test(mv.de || '')) mv.muscles = rm(mv.muscles, /tensor/i);
  if (j.key === 'wirbelsaeule' && /^Flexion/.test(mv.de || '')) mv.muscles = rm(mv.muscles, /sternocleidomastoid/i);
  if (j.key === 'fuss' && /Quergew/.test(mv.de || '')) mv.muscles = rm(mv.muscles, /oblique head/i);
}
for (const p of passages) if (p.key === 'leistenkanal') for (const b of p.bounds) if (/^Anulus inguinalis profundus/.test(b.la || '') && b.n.some(x => /epigastric/i.test(x))) b.la = 'Vasa epigastrica inferiora (Anulus inguinalis profundus liegt lateral davon)';
// kas kartları: kas olmayan satırlar (tendon, retinaculum, tractus, bağ, trochlea) kendi adlarıyla ayrı durur; çok parçalı
// kasta adı olmayan parçaya Latince adı verilir; iki Türkçe düzeltme
const laOf = new Map(meta.items.map(i => [i.n, i.la]));
for (const [name, c] of Object.entries(muscles)) {
  if (/tendon|retinaculum|tract\b|aponeurosis|ligament|trochlea/i.test(name)) { c.nonMuscle = true; c.whole_la = laOf.get(name) || name; delete c.part_la; }
  if (c.f_tr) c.f_tr = c.f_tr.replace('karşı koymaya (opozisyon) yardım eder', 'başparmağın diğer parmakların karşısına getirilmesine (opozisyon) yardım eder').replace('leğen kemiğini öne kaldırır', 'leğen kemiğinin ön kısmını yukarı çekerek pelvisi dikleştirir');
}
const byWhole = new Map();
for (const [name, c] of Object.entries(muscles)) { if (!byWhole.has(c.whole_la)) byWhole.set(c.whole_la, []); byWhole.get(c.whole_la).push([name, c]); }
for (const list of byWhole.values()) if (list.length > 1) for (const [name, c] of list) if (!c.part_la) c.part_la = laOf.get(name) || name;
// Kennmuskel: sinir dosyasındaki tablo kartlara işlenir (kartın kendi değeriyle birleşir, ör. L3/L4)
for (const k of kennmuskeln) for (const n of k.n) { const c = muscles[n]; if (!c) continue; c.kenn = [...new Set([...(c.kenn ? String(c.kenn).split('/') : []), k.seg])].sort().join('/'); }
// origo ve insersiyo yamaları: parçanın adıyla, kasın model grubunun adıyla ya da ortak tendonla adlandırılmış yamalar karta bağlanır
const groupPath = i => { const p = []; for (let g = i.g; g >= 0; g = meta.groups[g].p) p.push(meta.groups[g].n); return p; };
const mitems = meta.items.filter(i => i.s === 'muscle' && i.sub === 'muscle');
const SHARED = {
  'Common flexor tendon': /flexor carpi radialis|palmaris longus|flexor carpi ulnaris|flexor digitorum superficialis|pronator teres/i,
  'Common extensor tendon': /extensor carpi radialis brevis|^extensor digitorum( muscle)?$|extensor digiti minimi|extensor carpi ulnaris/i,
  'Obturator internus and gemelli': /obturator internus|gemellus/i,
  // Lig. patellae'nin insersiyosu (Tuberositas tibiae) quadriceps'in Ansatz'ıdır
  'Quadriceps femoris muscle': /rectus femoris|vastus/i, 'Patellar ligament': /rectus femoris|vastus/i, 'Triceps surae muscle': /gastrocnemius|soleus/i,
};
const unbound = [];
for (const P of new Set(meta.items.filter(i => i.sub === 'attach').map(i => i.n))) {
  const mm = /^(.*) \((origin|insertion)\)$/.exec(P); if (!mm) continue;
  if (P === 'Patellar ligament (origin)') continue;
  const X = mm[1], kind = mm[2] === 'origin' ? 'o' : 'i';
  let targets = muscles[X] ? [X] : [...new Set(mitems.filter(i => groupPath(i).includes(X)).map(i => i.n))];
  if (!targets.length && SHARED[X]) targets = Object.keys(muscles).filter(n => SHARED[X].test(n));
  if (!targets.length) { const x = X.replace(/ muscle$/, '').toLowerCase(); targets = Object.keys(muscles).filter(n => n.toLowerCase().includes(x)); }
  if (!targets.length) { unbound.push(P); continue; }
  for (const t of targets) if (muscles[t]) ((muscles[t].patch ||= { o: [], i: [] })[kind]).push(P);
}
if (unbound.length) warn.push(`${unbound.length} yapışma yaması hiçbir kasa bağlanamadı: ${unbound.slice(0, 10).join('; ')}`);
// aynı sorunun iki dosyada yinelenmesi (aynı doğru cevap ve aynı yapılar)
const qkey = q => q.options[0].toLowerCase() + '|' + (q.show || []).slice().sort().join(',');
const seenQ = new Set(quiz.map(qkey));
const mq = mquiz.filter(q => { const k = qkey(q); if (q.show?.length && seenQ.has(k)) return false; seenQ.add(k); return true; });
mquiz.length = 0; mquiz.push(...mq);

// kör yanıtlama denetiminin düzeltmeleri (data/work/audit/fixes/<banka>-<n>.json; tools/quiz-patch.mjs): derlemenin en sonunda
for (const r of [applyFixes('locomotor', quiz), applyFixes('muscles', mquiz)]) for (const x of r.skipped) warn.push('denetim düzeltmesi atlandı: ' + x);

const loco = { v: 1, source: 'data/work/locomotor (tools/locomotor-build.mjs)', nerves: { list: nerves, plexus, kennmuskeln, ...(N?.kennmuskeln_note_tr ? { kennNote: N.kennmuskeln_note_tr } : {}), notInModel: N?.notInModel || [] },
  passages: { list: passages, notInModel: P?.notInModel || [] }, joints: { list: joints, notInModel: J?.notInModel || [] }, geo, quiz };
fs.writeFileSync(OUT + 'locomotor.json', JSON.stringify(loco) + '\n');
fs.writeFileSync(OUT + 'muscles.json', JSON.stringify({ v: 1, source: 'data/work/locomotor/muscles-*.verified.json (tools/locomotor-build.mjs)', muscles, groups, quiz: mquiz }) + '\n');
const kb = f => (fs.statSync(OUT + f).size / 1024).toFixed(0) + ' KB';
console.log(`locomotor.json ${kb('locomotor.json')}: ${nerves.length} sinir (${nerves.reduce((a, n) => a + n.sites.length, 0)} lezyon yeri, ${Object.keys(geo.sites).length} nokta), ${passages.length} geçit (${Object.keys(geo.passages).length} noktalı), ${joints.length} eklem, ${quiz.length} soru`);
console.log(`muscles.json ${kb('muscles.json')}: ${Object.keys(muscles).length} / ${mnames.size} kas kartı, ${mquiz.length} soru`);
if (bad.size) { console.log(`\nMODELDE OLMAYAN ADLAR (${bad.size}; atlandı):\n` + [...bad].join('\n')); process.exitCode = 1; }
if (warn.length) console.log(`\nUyarılar (${warn.length}):\n` + warn.join('\n'));
