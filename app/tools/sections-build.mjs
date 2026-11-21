// Kesit atlası derleyicisi: data/work/sections/content-<bölge>.verified.json (içerik, araştırma ve doğrulama ajanları) ve
// geo-<seviye>.json (kesicinin o düzlemdeki sonucu, tools/_sectionwork/slice.mjs) -> public/data/sections.json.
// Uygulamadaki mod (src/sections.js) yalnız bu dosyayı okur.
//
// Seviye başına yazılanlar: key, axis, pos, sex, scope, başlıklar, level_de, model_level, intro_tr, sorulacak yapılar
// (ask: her biri model adları n ve etiket noktaları pts: cm cinsinden 3B noktalar, eşli yapıda taraf başına bir nokta),
// bilgi soruları (facts), frame (kastedilen adanın / adaların kesit sınırının merkezi c ve yarı boyu h; kamera için) ve
// uzuv seviyelerinde (scope arm-l / leg-l) only: o adanın bütün parçalarının kimlikleri (sahne yalnız onları gösterir).
//
// Kastedilen ada: adı scope olan adaların hepsi (kalça düzeyinde iki "trunk" adası vardır, her yanda bir) ve near alanı
// scope'u gösteren "other" adalar (kadın pelvis organları gövdeden 0,4-0,9 cm ayrı ada olur). Kalçaların yanında sarkan
// eller kol adasıdır, gövde seviyesine girmez.
//
// Denetimler: adlar meta.json'da ve geo dosyasında dolu (fill) ve en az 0,1 cm² kesitle kastedilen adada olmalı; olmayan
// adlar atlanır ve listelenir; hiç adı kalmayan yapı düşer. Bilgi sorularının dört ayrı şıkkı; show adları meta.json'da.
// Görünürlük: uygulama küçük kesit yüzlerini büyüklerin üstüne çizer (section.js: kapak dikdörtgeninin alanına göre büyükten
// küçüğe). Etiket noktası, yapının kendi kesit yüzünün en üstte olduğu bir yerde olmalı: daha küçük bir başka dolu parçanın
// kesitinin içindeyse (insideCut) yapının kesitinde boş bir yer aranır; yoksa yapı tıklanamaz, seviyeden çıkarılır ve
// listelenir. Hatalarda çıkış kodu 1.
// Eşli yapının iki yanı ayrı model parçasıysa (sd boş, adda Left / Right) yan addan çıkar: her yana bir nokta. Buna karşın
// sağ ve sol yarısı ya da lobları ayrı parça olan tek yapının (patches.json single: Pons, karaciğer gibi) yalnız en büyük
// parçası etiketlenir.
// Cinsiyetsiz seviyeler iki bedende de gösterilir; etiket noktaları erkek geo dosyasından gelir. Kadın bedeni de kesilir:
// yapının kadında kesiti yoksa yapıya x: 'm' yazılır (uygulama kadın bedeninde onu göstermez ve sormaz); erkek noktaları
// kadın kesitinde yapının üstte olduğu yere düşmüyorsa ptsF (kadın noktaları) yazılır.
// Düzeltme tablosu data/work/sections/patches.json (doğrulanmış içerik dosyaları değiştirilmez): order (bölgede seviye
// sırası, BT yığını gibi kranialden kaudale), single (yarıları ayrı parça olan tek yapılar: bir etiket), near
// (yapının etiket noktası ipuçları: her ipucu için yapının kesitinde ona en yakın boş nokta), ask (yapı alanları, ör.
// Latince ad), level (intro_tr_add: giriş metnine ek), facts (bilgi sorularının q ve options çevirileri, sıra aynı).
// Kamera çerçevesi: uzuvda adanın parçaları; aksiyal gövde kesitinde yapıların etiket noktalarının kutusu 3 cm genişletilip
// adanın sınırıyla kırpılır (omuzlar ve kollar çerçeveyi büyütüp yapıları küçültmesin); sagittal ve koronalde noktaların
// kutusu biraz genişletilmiş.
//
// Çalıştırma (app/ içinde): node tools/sections-build.mjs
import fs from 'node:fs';
import { slice, insideCut } from './_sectionwork/slice.mjs';

const DIR = '../data/work/sections';
const OUT = 'public/data/sections.json';
const REGIONS = ['head', 'thorax', 'abdomen', 'pelvis', 'limbs'];
const MIN_AREA = 0.1;      // cm²: daha küçük kesit tıklanamaz sayılır
const LIMB = new Set(['arm-l', 'arm-r', 'leg-l', 'leg-r']);

const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const names = new Set(meta.items.map(i => i.n));
const r3 = v => Math.round(v * 1000) / 1000;
const errors = [], warns = [], dropped = [], moved = [], femNote = [];
const P = JSON.parse(fs.readFileSync(`${DIR}/patches.json`, 'utf8'));
const NEAR_MAX = 2.5;      // cm: ipucu noktası yapının kesitinden bundan uzaksa hata
// parçanın yanı: sd, yoksa İngilizce addan (Left / Right ayrı parçalar), yoksa ''
const sideOf = p => p.sd || (/\bleft\b/i.test(p.n) ? 'l' : /\bright\b/i.test(p.n) ? 'r' : '');

// düzlemdeki (u, v) noktası -> 3B (cm); düzlem içi eksenler: x -> [y, z], y -> [x, z], z -> [x, y]
function to3(axis, pos, u, v) {
  return axis === 'x' ? [pos, u, v] : axis === 'y' ? [u, pos, v] : [u, v, pos];
}
const rectArea = p => (p.bb2[2] - p.bb2[0]) * (p.bb2[3] - p.bb2[1]);

// Etiket noktasını örten (uygulamada üstüne çizilen) parça var mı: kendi parçalarından olmayan, kapak dikdörtgeni daha
// küçük, dolu çizilen ve noktayı içeren bir parça
function coveredBy(p, u, v, axis, drawn, own) {
  const a = rectArea(p);
  for (const q of drawn) {
    if (q === p || own.has(q.n) || rectArea(q) >= a) continue;
    if (u < q.bb2[0] || u > q.bb2[2] || v < q.bb2[1] || v > q.bb2[3]) continue;
    if (insideCut(q, u, v, axis)) return q;
  }
  return null;
}
// Parçanın kesitinde örtülmemiş en "ortadaki" nokta: ızgarada serbest hücreler, serbest olmayan hücrelere en uzak olanı
function grid(p, axis, drawn, own) {
  const [u0, v0, u1, v1] = p.bb2, N = 56;
  const du = (u1 - u0) / N, dv = (v1 - v0) / N;
  const free = [], blocked = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const u = u0 + i * du, v = v0 + j * dv;
    if (insideCut(p, u, v, axis) && !coveredBy(p, u, v, axis, drawn, own)) free.push([u, v]); else blocked.push([u, v]);
  }
  return { free, blocked };
}
function freeSpot(p, axis, drawn, own) {
  const { free, blocked } = grid(p, axis, drawn, own);
  if (!free.length) return null;
  let best = null, bd = -1;
  for (const [u, v] of free) {
    let d = Infinity;
    for (const [a, b] of blocked) { const e = (a - u) ** 2 + (b - v) ** 2; if (e < d) d = e; if (d <= bd) break; }
    if (d > bd) { bd = d; best = [u, v]; }
  }
  return { u: best[0], v: best[1], clear: Math.sqrt(bd) };
}

// Yapının etiket noktaları (düzlem içi [u, v]); cand: yapının kastedilen adadaki dolu parçaları; hints: ipuçları
function pointsOf(tag, cand, axis, drawn, own, hints) {
  if (hints) {
    const out = [];
    for (const [hu, hv] of hints) {
      let best = null, bd = Infinity;
      for (const p of cand) for (const [u, v] of grid(p, axis, drawn, own).free) {
        const d = Math.hypot(u - hu, v - hv); if (d < bd) { bd = d; best = [u, v]; }
      }
      if (!best || bd > NEAR_MAX) { errors.push(`${tag}: ipucu [${hu}, ${hv}] yapının kesitinden uzak (${best ? bd.toFixed(2) + ' cm' : 'boş yer yok'})`); continue; }
      moved.push(`${tag}: ipucu [${hu}, ${hv}] -> [${best.map(x => x.toFixed(2))}] (${bd.toFixed(2)} cm)`);
      out.push(best);
    }
    return out;
  }
  // taraf başına en büyük kesitli parça (eşli yapıda iki nokta)
  const bySide = new Map();
  for (const p of cand) { const s = sideOf(p); if (!bySide.has(s) || bySide.get(s).area < p.area) bySide.set(s, p); }
  if (bySide.has('') && (bySide.has('l') || bySide.has('r'))) {   // tarafsız parça ve taraflı parçalar birlikte: en büyük iki yan yeter
    const mid = bySide.get(''); if ([...bySide.values()].some(p => p !== mid && p.area > mid.area)) bySide.delete('');
  }
  // tek yapı (patches.json single): sağ ve sol yarısı ya da lobları ayrı parça olsa da yalnız en büyük kesitli parça etiketlenir
  if (P.single?.includes(tag) && bySide.size > 1) {
    const big = [...bySide.values()].sort((p, q) => q.area - p.area)[0];
    for (const [k, p] of [...bySide]) if (p !== big) bySide.delete(k);
    moved.push(`${tag}: tek yapı, bir etiket (${big.n})`);
  }
  const pts = [];
  for (const [, p] of [...bySide.entries()].sort()) {
    let [u, v] = p.c2;
    const cov = coveredBy(p, u, v, axis, drawn, own);
    if (cov) {
      const f = freeSpot(p, axis, drawn, own);
      if (!f) { moved.push(`${tag} ${p.n}${p.sd ? ' ' + p.sd : ''}: tamamen örtülü (${cov.n})`); continue; }
      moved.push(`${tag} ${p.n}${p.sd ? ' ' + p.sd : ''}: c2 ${cov.n} altında, boş yere taşındı (açıklık ${f.clear.toFixed(2)} cm)`);
      u = f.u; v = f.v;
    }
    pts.push([u, v]);
  }
  return pts;
}
// nokta yapının kendi kesitinde ve üstte mi (kadın kesitinde erkek noktalarını sınamak için)
const pointOk = (cand, u, v, axis, drawn, own) => cand.some(p => insideCut(p, u, v, axis) && !coveredBy(p, u, v, axis, drawn, own));

function checkFact(lk, f, i) {
  const where = `${lk} facts[${i}]`;
  if (!f.q || !Array.isArray(f.options) || f.options.length !== 4) { errors.push(`${where}: dört şık yok`); return null; }
  if (new Set(f.options.map(o => String(o).trim())).size !== 4) { errors.push(`${where}: şıklar ayrı değil`); return null; }
  const show = (f.show || []).filter(n => { if (names.has(n)) return true; warns.push(`${where}: show adı modelde yok: ${n}`); return false; });
  return { q: f.q, options: f.options, explain: f.explain || '', ...(show.length ? { show } : {}) };
}

const out = { v: 1, regions: [] };
let nLevels = 0, nAsk = 0, nFacts = 0;
for (const reg of REGIONS) {
  const C = JSON.parse(fs.readFileSync(`${DIR}/content-${reg}.verified.json`, 'utf8'));
  const R = { key: reg, title_tr: C.title_tr, levels: [] };
  const ord = P.order?.[reg];
  if (ord) {
    for (const k of ord) if (!C.levels.some(l => l.key === k)) errors.push(`patches order: ${reg} bölgesinde ${k} yok`);
    const ix = k => { const i = ord.indexOf(k); return i < 0 ? 1e9 : i; };
    C.levels.sort((a, b) => ix(a.key) - ix(b.key));
  }
  for (const L0 of C.levels) {
    // düzeltme tablosu (patches.json)
    const L = { ...L0 }, lp = P.level?.[L.key];
    if (lp?.intro_tr_add) L.intro_tr = `${L.intro_tr || ''} ${lp.intro_tr_add}`.trim();
    L.ask = L0.ask.map(a => (P.ask?.[`${L.key}/${a.key}`] ? { ...a, ...P.ask[`${L.key}/${a.key}`] } : a));
    const fp = P.facts?.[L.key];
    if (fp) {
      if (fp.length !== (L0.facts || []).length) errors.push(`patches facts: ${L.key} soru sayısı tutmuyor (${fp.length} / ${(L0.facts || []).length})`);
      L.facts = (L0.facts || []).map((f, i) => (fp[i] ? { ...f, q: fp[i].q, options: fp[i].options } : f));
    }
    const gfile = `${DIR}/geo-${L.key}.json`;
    if (!fs.existsSync(gfile)) { errors.push(`${L.key}: ${gfile} yok`); continue; }
    const G = JSON.parse(fs.readFileSync(gfile, 'utf8'));
    if (G.axis !== L.axis || Math.abs(G.pos - L.pos) > 1e-6) errors.push(`${L.key}: geo düzlemi (${G.axis} ${G.pos}) içerikle (${L.axis} ${L.pos}) tutmuyor`);
    // kastedilen adalar
    const meant = new Set(G.islands.filter(I => I.name === L.scope || (I.name === 'other' && String(I.near || '').split('#')[0] === L.scope)).map(I => I.id));
    if (!meant.size) { errors.push(`${L.key}: ${L.scope} adası yok`); continue; }
    // kesit çizgileri (insideCut için) yeniden kesilir; ada ve etiket noktası geo dosyasından
    const split = L.axis === 'y' && !L.sex;   // pelvis aksiyal seviyeleri --nosplit ile kesildi
    const S = await slice(L.axis, L.pos, { sex: L.sex || 'm', split });
    const byId = new Map(S.parts.map(p => [p.id, p]));
    const geoParts = G.parts.map(gp => {
      const sp = byId.get(gp.id);
      if (!sp) { warns.push(`${L.key}: ${gp.id} (${gp.n}) yeniden kesitte yok`); return null; }
      return Object.assign(sp, { island: gp.island, islandId: gp.islandId, c2: gp.c2, clear: gp.clear });
    }).filter(Boolean);
    const inScope = p => meant.has(p.islandId);
    const limb = LIMB.has(L.scope);
    // uygulamanın çizdiği dolu kesitler: uzuv seviyesinde yalnız adanın parçaları
    const drawn = geoParts.filter(p => p.fill && (!limb || inScope(p)));
    // cinsiyetsiz seviye kadın bedeninde de gösterilir: kadın kesiti (aynı kastedilen ada kuralı)
    let F = null;
    if (!L.sex) {
      const SF = await slice(L.axis, L.pos, { sex: 'f', split });
      const meantF = new Set(SF.islands.filter(I => I.name === L.scope || (I.name === 'other' && String(I.near || '').split('#')[0] === L.scope)).map(I => I.id));
      const inF = p => meantF.has(p.islandId);
      F = { parts: SF.parts, inF, drawn: SF.parts.filter(p => p.fill && (!limb || inF(p))) };
    }

    const ask = [];
    for (const A of L.ask) {
      const keep = [];
      for (const n of A.n || []) {
        if (!names.has(n)) { errors.push(`${L.key}/${A.key}: model adı yok: ${n}`); continue; }
        const ok = geoParts.some(p => p.n === n && p.fill && p.area >= MIN_AREA && inScope(p));
        if (!ok) { warns.push(`${L.key}/${A.key}: kesitte dolu ve ≥${MIN_AREA} cm² değil, atlandı: ${n}`); continue; }
        keep.push(n);
      }
      if (!keep.length) { dropped.push(`${L.key}/${A.key} (${A.la}): kesitte parçası yok`); continue; }
      const own = new Set(keep), tag = `${L.key}/${A.key}`;
      const cand = geoParts.filter(p => own.has(p.n) && p.fill && p.area >= MIN_AREA && inScope(p));
      const hints = P.near?.[tag] || null;
      const pts = pointsOf(tag, cand, L.axis, drawn, own, hints).map(([u, v]) => to3(L.axis, L.pos, u, v).map(r3));
      if (!pts.length) { dropped.push(`${tag} (${A.la}): kesiti başka yapıların altında, tıklanamaz`); continue; }
      // kadın bedeni: kesit var mı, erkek noktaları orada da yapının üstünde mi
      let sexOnly = null, ptsF = null;
      if (F) {
        const candF = F.parts.filter(p => own.has(p.n) && p.fill && p.area >= MIN_AREA && F.inF(p));
        const uv3 = p3 => (L.axis === 'x' ? [p3[1], p3[2]] : L.axis === 'y' ? [p3[0], p3[2]] : [p3[0], p3[1]]);
        if (!candF.length) { sexOnly = 'm'; femNote.push(`${tag} (${A.la}): kadın bedeninde kesiti yok, yalnız erkekte`); }
        else if (!pts.every(p3 => { const [u, v] = uv3(p3); return pointOk(candF, u, v, L.axis, F.drawn, own); })) {
          ptsF = pointsOf(tag + ' (kadın)', candF, L.axis, F.drawn, own, hints).map(([u, v]) => to3(L.axis, L.pos, u, v).map(r3));
          if (!ptsF.length) { sexOnly = 'm'; ptsF = null; femNote.push(`${tag} (${A.la}): kadın kesitinde örtülü, yalnız erkekte`); }
          else femNote.push(`${tag}: kadın bedeni için ayrı noktalar (${ptsF.length})`);
        }
      }
      ask.push({ key: A.key, la: A.la, de: A.de || '', n: keep, pts, ...(ptsF ? { ptsF } : {}), ...(sexOnly ? { x: sexOnly } : {}), tr: A.tr || '', ...(A.tip ? { tip: A.tip } : {}) });
    }
    const keys = new Set();
    for (const a of ask) { if (keys.has(a.key)) errors.push(`${L.key}: yapı anahtarı iki kez: ${a.key}`); keys.add(a.key); }
    const facts = (L.facts || []).map((f, i) => checkFact(L.key, f, i)).filter(Boolean);
    // Uzuv seviyesi: kesici kol / bacak adasını gövdeden kabaca ayırır (orta kolda M. latissimus dorsi ve karın fasyası
    // kol adasına düşer); yalnız yapıların etiket noktalarının kutusu (2 cm genişletilmiş) içinde merkezlenen ve ondan
    // çok büyük olmayan parçalar alınır.
    const uv = p3 => (L.axis === 'x' ? [p3[1], p3[2]] : L.axis === 'y' ? [p3[0], p3[2]] : [p3[0], p3[1]]);
    const P2 = ask.flatMap(a => a.pts.map(uv));
    const pb = [Math.min(...P2.map(p => p[0])), Math.min(...P2.map(p => p[1])), Math.max(...P2.map(p => p[0])), Math.max(...P2.map(p => p[1]))];
    const grow = (b, p) => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[2]); b[3] = Math.max(b[3], p[3]); };
    let only = null, bb = [Infinity, Infinity, -Infinity, -Infinity];
    if (limb) {
      const B = [pb[0] - 2, pb[1] - 2, pb[2] + 2, pb[3] + 2], bw = B[2] - B[0], bh = B[3] - B[1];
      only = geoParts.filter(p => {
        if (!inScope(p)) return false;
        const cu = (p.bb2[0] + p.bb2[2]) / 2, cv = (p.bb2[1] + p.bb2[3]) / 2;
        return cu >= B[0] && cu <= B[2] && cv >= B[1] && cv <= B[3] && p.bb2[2] - p.bb2[0] <= 1.3 * bw && p.bb2[3] - p.bb2[1] <= 1.3 * bh;
      });
      const out = geoParts.filter(p => inScope(p) && !only.includes(p) && p.area >= 1);
      if (out.length) warns.push(`${L.key}: uzuv adasından çıkarılanlar: ${out.map(p => p.n).join(', ')}`);
      for (const p of only) if (p.fill) grow(bb, p.bb2);
    } else if (L.axis === 'y') {
      // aksiyal gövde kesiti: yapıların noktalarının kutusu 3 cm genişletilir ve kastedilen adaların sınırıyla kırpılır
      // (omuzlar ve kollar çerçeveyi büyütüp sorulan yapıları ekranda küçük bir yere toplamasın)
      const ib = [Infinity, Infinity, -Infinity, -Infinity];
      for (const I of G.islands) if (meant.has(I.id)) grow(ib, I.bb2);
      bb = [Math.max(ib[0], pb[0] - 3), Math.max(ib[1], pb[1] - 3), Math.min(ib[2], pb[2] + 3), Math.min(ib[3], pb[3] + 3)];
    } else {
      // sagittal ve koronal kesitte ada bütün gövdedir: yapıların etiket noktaları (biraz genişletilmiş)
      const pu = (pb[2] - pb[0]) * 0.15 + 2, pv = (pb[3] - pb[1]) * 0.15 + 2;
      bb = [pb[0] - pu, pb[1] - pv, pb[2] + pu, pb[3] + pv];
    }
    // kamera çerçevesi: merkez c ve yarı boy h (cm, 3B; düzlemin ekseninde 0)
    const c = to3(L.axis, L.pos, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2).map(r3);
    const h = to3(L.axis, 0, (bb[2] - bb[0]) / 2, (bb[3] - bb[1]) / 2).map(r3);
    const lv = {
      key: L.key, axis: L.axis, pos: L.pos, ...(L.sex ? { sex: L.sex } : {}), scope: L.scope,
      title_de: L.title_de, title_tr: L.title_tr, level_de: L.level_de || '', ...(L.model_level ? { model_level: L.model_level } : {}),
      intro_tr: L.intro_tr || '', frame: { c, h }, ask, facts,
      ...(only ? { only: only.map(p => p.id) } : {}),
    };
    R.levels.push(lv);
    nLevels++; nAsk += ask.length; nFacts += facts.length;
    console.log(`${L.key.padEnd(14)} ${L.axis} ${String(L.pos).padStart(6)} ${(L.sex || '-')} ${L.scope.padEnd(6)} yapı ${String(ask.length).padStart(2)}/${L.ask.length}  soru ${facts.length}${limb ? `  only ${lv.only.length}` : ''}`);
  }
  out.regions.push(R);
}
// seviye anahtarları tekil olmalı
const all = out.regions.flatMap(r => r.levels.map(l => l.key));
for (const k of all) if (all.indexOf(k) !== all.lastIndexOf(k)) errors.push(`seviye anahtarı iki kez: ${k}`);

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
if (moved.length) console.log(`\nETİKET NOKTASI TAŞINAN (${moved.length}):\n  ` + moved.join('\n  '));
if (dropped.length) console.log(`\nÇIKARILAN YAPILAR (${dropped.length}):\n  ` + dropped.join('\n  '));
if (femNote.length) console.log(`\nKADIN BEDENİ (${femNote.length}):\n  ` + femNote.join('\n  '));
if (warns.length) console.log(`\nUYARILAR (${warns.length}):\n  ` + warns.join('\n  '));
if (errors.length) console.log(`\nHATALAR (${errors.length}):\n  ` + errors.join('\n  '));
console.log(`\n${OUT}: ${out.regions.length} bölge, ${nLevels} seviye, ${nAsk} yapı, ${nFacts} bilgi sorusu, ${kb} KB`);
process.exit(errors.length ? 1 : 0);
