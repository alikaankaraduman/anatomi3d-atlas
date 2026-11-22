// Bacak hareketi verisi (sol bacak), adım 1: segmentler ve eklem ölçümü. Tasarım: data/work/motion/SPEC-LEG.md.
// Sayılar ağlardan ölçülür; ders kitabı değerleri yalnız karşılaştırma içindir. Ortak geometri: motion-geom.mjs (kolla aynı).
// Çalıştırma (app/ içinde): node tools/motion-leg-build.mjs [--dry]   (public/data/motion-leg.json yazar; --dry yazmaz)
// Koordinatlar: x sola (sol bacak +x), y yukarı, z öne; birim cm.
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import fs from 'node:fs';
import { loadScene } from './scene.mjs';
import { sub, add, mul, dot, cross, len, norm, DEG, angle, mean, f2, trimmedSphere, pca, longAxis, revFit, verts } from './motion-geom.mjs';

const fails = [];
const say = (s = '') => console.log(s);
const fail = s => { fails.push(s); say('  HATA: ' + s); };

const { meta, parts } = await loadScene({
  files: ['bones', 'joints', 'muscles'],
  keep: it => (it.s === 'bone' && it.sub !== 'attach' && it.x !== 'f') || (it.sd === 'l' && it.x !== 'f'),
});
const G = meta.groups;
const gpath = g => { const a = []; while (g >= 0) { a.unshift(G[g].n); g = G[g].p; } return a.join(' > '); };
for (const p of parts) p.path = gpath(p.g);

say('motion-leg-build: bacak hareketi verisi (sol bacak), adım 1');
// ---------- segmentler ----------
const SEGS = ['pelvis', 'femur', 'patella', 'tibia', 'talus', 'foot'];
const PARENT = { pelvis: null, femur: 'pelvis', patella: 'femur', tibia: 'femur', talus: 'tibia', foot: 'talus' };
const segOfLegBone = n => n === 'Femur' ? 'femur' : n === 'Patella' ? 'patella' : (n === 'Tibia' || n === 'Fibula') ? 'tibia' : n === 'Talus' ? 'talus'
  : /^(Calcaneus|Navicular bone|Cuboid bone|(Medial|Intermediate|Lateral) cuneiform bone)$/.test(n) || / metatarsal bone$/.test(n) || / of foot$/.test(n) ? 'foot' : null;
const legBones = parts.filter(p => p.sd === 'l' && p.s === 'bone' && p.sub !== 'attach' && segOfLegBone(p.n));
for (const b of legBones) b.seg = segOfLegBone(b.n);
const prep = p => { if (!p.bvh) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.P, 3)); g.setIndex(new THREE.BufferAttribute(p.I, 1)); p.bvh = new MeshBVH(g); } return p; };
const _v = new THREE.Vector3(), _hit = {};
const dist = (p, x) => { prep(p).bvh.closestPointToPoint(_v.set(x[0], x[1], x[2]), _hit); return _hit.distance; };
const B = n => { const b = parts.find(x => x.sd === 'l' && x.s === 'bone' && x.n === n); if (!b) throw new Error('kemik yok: ' + n); return b; };
say(`  sol bacak kemiği: ${legBones.length} (` + SEGS.slice(1).map(s => s + ' ' + legBones.filter(b => b.seg === s).length).join(', ') + ')');
const legJoints = parts.filter(p => p.sd === 'l' && p.s === 'joint' && /lower limb/i.test(p.path));
const legMuscles = parts.filter(p => p.sd === 'l' && p.s === 'muscle' && /lower limb|hip|thigh|leg|foot|gluteal/i.test(p.path));
say(`  sol bacak eklem parçası: ${legJoints.length}; bacak kası (yol adına göre, kaba): ${legMuscles.length}`);

const fem = B('Femur'), tib = B('Tibia'), fib = B('Fibula'), tal = B('Talus'), cal = B('Calcaneus'), nav = B('Navicular bone'), hip = B('Hip bone'), mt2 = B('Second metatarsal bone');
const LM = {};
// ---------- Hüfte: femur başı (asetabuluma 1 cm'den yakın köşeler) + asetabulum kontrolü ----------
{
  const fv = verts(fem), top = Math.max(...fv.map(x => x[1]));
  const near = fv.filter(x => x[1] > top - 10 && dist(hip, x) < 1.0);
  const f1 = trimmedSphere(near), f2s = trimmedSphere(fv.filter(x => x[1] > top - 10 && Math.abs(len(sub(x, f1.c)) - f1.r) < 0.15));
  LM.hip = f2s.c; LM.hipR = f2s.r;
  const ac = trimmedSphere(verts(hip).filter(x => Math.abs(len(sub(x, f2s.c)) - f2s.r) < 0.6));
  say(`  Hüfte: femur başı merkezi ${LM.hip.map(f2)} r ${f2(f2s.r)} (rms ${f2(f2s.rms)}, ${f2s.n} köşe); asetabulum merkezi ${ac.c.map(f2)} r ${f2(ac.r)}; fark ${f2(len(sub(ac.c, LM.hip)))} cm`);
  if (len(sub(ac.c, LM.hip)) > 0.5) fail('asetabulum ile femur başı merkezi 0,5 cm\'den fazla ayrı');
}
// ---------- Knie: distal femurun tibiaya bakan kondil yüzeyi (dönel yüzey), eksen epikondil çizgisine yakın ----------
const fAx = longAxis(fem), tAx = longAxis(tib);
{
  const fv = verts(fem), bot = Math.min(...fv.map(x => x[1])), d8 = fv.filter(x => x[1] < bot + 8);
  let me = d8[0], le = d8[0]; for (const x of d8) { if (x[0] < me[0]) me = x; if (x[0] > le[0]) le = x; }
  // mediyal kenar x küçük (sol bacakta mediyal = orta hatta yakın)
  const art = fv.filter(x => x[1] < bot + 5 && x[2] < (LM.hip[2] + 2) && dist(tib, x) < 1.5);
  const epi = norm(sub(le, me)), f = revFit(art, epi, 12), g = revFit(art, f.d, 1.5, 0.25, 20);
  const on = ref => add(mul(g.e1, g.c2[0]), add(mul(g.e2, g.c2[1]), mul(g.d, dot(ref, g.d))));
  LM.knee = on(mul(add(me, le), 0.5)); LM.kneeAxis = dot(g.d, [1, 0, 0]) < 0 ? mul(g.d, -1) : g.d; LM.kneeR = 0;
  say(`  Knie: eksen noktası ${LM.knee.map(f2)}, yön ${LM.kneeAxis.map(f2)} (epikondil çizgisiyle ${f2(angle(LM.kneeAxis, epi))}°, rms ${f2(g.rms)}, ${art.length} köşe)`);
}
// ---------- OSG: trochlea tali (tibiaya / malleollere 0,6 cm'den yakın talus köşeleri), malleol çizgisi ----------
{
  const tv = verts(tib), bv = verts(fib);
  const mm = tv.reduce((a, b) => (b[1] < a[1] ? b : a)), lm = bv.reduce((a, b) => (b[1] < a[1] ? b : a));
  const art = verts(tal).filter(x => dist(tib, x) < 0.6 || dist(fib, x) < 0.4);
  const mal = norm(sub(lm, mm)), f = revFit(art, mal, 12), g = revFit(art, f.d, 1.5, 0.25, 20);
  const on = ref => add(mul(g.e1, g.c2[0]), add(mul(g.e2, g.c2[1]), mul(g.d, dot(ref, g.d))));
  LM.ankle = on(mul(add(mm, lm), 0.5)); LM.ankleAxis = dot(g.d, [1, 0, 0]) < 0 ? mul(g.d, -1) : g.d; LM.malMed = mm; LM.malLat = lm;
  say(`  OSG: eksen noktası ${LM.ankle.map(f2)}, yön ${LM.ankleAxis.map(f2)} (malleol çizgisiyle ${f2(angle(LM.ankleAxis, mal))}°, rms ${f2(g.rms)}, ${art.length} köşe); malleol çizgisi yataydan ${f2(Math.asin(Math.abs(mal[1])) * DEG)}°, frontalden ${f2(Math.atan2(-mal[2], mal[0]) * DEG)}°`);
}
// ---------- USG: kalkaneusun arka-dış ucu -> talus başı (naviküler kemiğe 0,6 cm'den yakın talus köşeleri) ----------
{
  const cv = verts(cal), head = mean(verts(tal).filter(x => dist(nav, x) < 0.6));
  // ayak uzun ekseni: kalkaneusun en arka köşesi -> 2. metatarsal başı; USG ekseni ders kitabı yönelimiyle bu çerçevede
  // (yataydan 42° yukarı, ayak ekseninden 16° içe), talus başından geçer. Ağdan bulunan arka-dış nokta karşılaştırma için.
  const post = cv.reduce((a, b) => (b[2] < a[2] ? b : a));
  const toe = mean(verts(mt2).filter((x, i, a) => x[2] > Math.max(...a.map(y => y[2])) - 1));
  const fl = norm([toe[0] - post[0], 0, toe[2] - post[2]]), medDir = norm(cross([0, 1, 0], fl));   // sol ayakta içe = -x yönü
  const inward = dot(medDir, [-1, 0, 0]) > 0 ? medDir : mul(medDir, -1), U = 42 / DEG, M = 16 / DEG;
  const ax = norm(add(mul(add(mul(fl, Math.cos(M)), mul(inward, Math.sin(M))), Math.cos(U)), [0, Math.sin(U), 0]));
  say('  ayak uzun ekseni (kalkaneus arkası -> 2. metatarsal başı) sagittalden ' + f2(Math.atan2(fl[0], fl[2]) * DEG) + '° dışa');
  LM.subtalar = head; LM.subtalarAxis = ax; LM.calPost = post;
  const up = Math.asin(ax[1]) * DEG, med = Math.atan2(-ax[0], ax[2]) * DEG;   // ön-arka çizgiden içe (x azalan) sapma
  say(`  USG: eksen talus başı ${head.map(f2)} <- kalkaneus arka-dış ${post.map(f2)}; yataydan ${f2(up)}° yukarı, sagittalden ${f2(med)}° içe (ders kitabı ~42° / ~16°)`);
}
// ---------- dinlenme duruşu (Neutral-Null) ----------
{
  const fdir = norm(sub(LM.knee, LM.hip)), tdir = norm(sub(LM.ankle, LM.knee));
  const flex = Math.atan2(fdir[2], -fdir[1]) * DEG, abd = Math.atan2(fdir[0], -fdir[1]) * DEG;
  const knee = angle(fdir, tdir);
  const toe = mean(verts(mt2).filter((x, i, a) => x[2] > Math.max(...a.map(y => y[2])) - 1));
  const foot = norm(sub(toe, LM.calPost)), ank = 90 - angle(mul(tdir, -1), foot);
  LM.rest = { hipFlex: flex, hipAbd: abd, knee, footToTibia: angle(mul(tdir, -1), foot) };
  say(`  dinlenme: kalça fleksiyonu ${f2(flex)}°, abduksiyonu ${f2(abd)}° (femur başı -> diz ekseni), diz fleksiyonu ${f2(knee)}°, ayak ile tibia arası ${f2(LM.rest.footToTibia)}° (90'dan sapma ${f2(-ank)}°)`);
  say(`  uzunluklar: femur ${f2(len(sub(LM.knee, LM.hip)))} cm, tibia ${f2(len(sub(LM.ankle, LM.knee)))} cm; femur gövde ekseni ile mekanik eksen arası ${f2(angle(fAx.v, mul(fdir, -1)))}°`);
}
// ---------- eklem parçaları: değdikleri segmentler (0,3 cm içinde kemiği olan) ----------
const segIds = Object.fromEntries(SEGS.map(k => [k, legBones.filter(b => b.seg === k).map(b => b.id)]));
const pelvisB = [hip, ...parts.filter(x => x.s === 'bone' && (x.n === 'Sacrum' || x.n === 'Coccyx'))];
const jparts = [];
for (const j of legJoints) {
  const v = verts(j), step = Math.max(1, Math.floor(v.length / 60)), ch = new Set();
  for (let i = 0; i < v.length; i += step) {
    for (const b of legBones) if (dist(b, v[i]) < 0.3) ch.add(b.seg);
    if (pelvisB.some(b => dist(b, v[i]) < 0.3)) ch.add('pelvis');
  }
  const chain = SEGS.filter(k => ch.has(k));
  jparts.push({ n: j.n, id: j.id, kind: 'joint', chain: chain.length ? chain : ['pelvis'] });
}
say(`  eklem parçaları: tek segmentli ${jparts.filter(x => x.chain.length === 1).length}, çok segmentli ${jparts.filter(x => x.chain.length > 1).length}`);
// ---------- deri ağırlıkları (adım 3) ----------
// Kaslar: köşenin uzuv zinciri (pelvis üstü -> kalça -> diz -> ayak bileği -> 2. metatarsal başı) üzerindeki yeri s ile
// segment düzeyi bulunur; eklem çevresinde smoothstep kuşağı (kalça 4, diz 4, ayak bileği 2,5 cm yarı genişlik). Kas yalnız
// iki ucunun segmentleri arasında karışır (uç segmenti: uç köşelerinin en yakın kemiği). Konuma bağlı olduğu için dikişteki
// çift köşeler aynı ağırlığı alır. t = uzuvdaki yerin kasın iki ucu arasındaki oranı (kalınlaşma eğrisi). Eklem parçaları:
// değdikleri segmentlerin kemiklerine uzaklıkla (0,15 cm içi katı), kolun eklem parçalarıyla aynı kural.
const SI = Object.fromEntries(SEGS.map((k, i) => [k, i]));
const toeP = (() => { const v = verts(mt2); const zx = Math.max(...v.map(x => x[2])); return mean(v.filter(x => x[2] > zx - 1)); })();
const CH = [add(LM.hip, [0, 14, 0]), LM.hip, LM.knee, LM.ankle, toeP], CUM = [0];
for (let i = 1; i < CH.length; i++) CUM.push(CUM[i - 1] + len(sub(CH[i], CH[i - 1])));
const sOf = x => { let bd = Infinity, bs = 0; for (let i = 1; i < CH.length; i++) { const a = CH[i - 1], u = sub(CH[i], a), l2 = dot(u, u), t = Math.max(0, Math.min(1, dot(sub(x, a), u) / l2)), q = add(a, mul(u, t)), d = len(sub(x, q)); if (d < bd) { bd = d; bs = CUM[i - 1] + t * (CUM[i] - CUM[i - 1]); } } return bs; };
const JS = [{ s: CUM[1], h: 4 }, { s: CUM[2], h: 4 }, { s: CUM[3], h: 2.5 }];   // kalça, diz, ayak bileği
const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const LEVEL = { pelvis: 0, femur: 1, patella: 2, tibia: 2, talus: 3, foot: 3 };
const pelvisAll = parts.filter(x => x.s === 'bone' && x.sub !== 'attach' && !legBones.includes(x) && x.sd !== 'r' && x.n !== 'Femur');
function endSeg(x) {
  let best = null, bd = 3;
  for (const b of legBones) { const d = dist(b, x); if (d < bd) { bd = d; best = b.seg; } }
  if (best) return best;
  for (const b of pelvisAll) { if (Math.abs(b.P[1] - x[1]) > 60) continue; const d = dist(b, x); if (d < bd) { bd = d; best = 'pelvis'; } }
  if (best) return best;
  if (x[1] > LM.hip[1] - 5) return 'pelvis';
  bd = 8; for (const b of legBones) { const d = dist(b, x); if (d < bd) { bd = d; best = b.seg; } }   // kiriş kemiğe değmiyor (ör. Achilles'e katılan baş)
  return best;
}
// s ve uç segmentlerinden ağırlıklar: [[segIndex, w], ...]
// Kalça: pelvisten çıkan kaslarda pelvis -> femur geçişi kasın KENDİ boyunda (t), çünkü origo çoğu kez kalça merkezinin
// altındadır (Tuber ischiadicum, Ramus ossis pubis): uzuv eksenindeki kuşak bu kasları uylukla döndürürdü. İki segmentli
// kaslarda t 0,1 -> 0,9 (kolun geniş geçişi gibi), dizi de geçenlerde t 0,02 -> 0,5.
function weightsAt(s, a, b, segA, segB, t = 0) {
  let L = a; for (let j = a; j < b; j++) L += j === 0 ? smooth(b === 1 ? (t - 0.1) / 0.8 : (t - 0.02) / 0.48) : smooth((s - JS[j].s + JS[j].h) / (2 * JS[j].h));
  const lo = Math.floor(L), f = L - lo, name = k => (k === b ? segB : k === a ? segA : ['pelvis', 'femur', 'tibia', 'foot'][k]);
  return f < 1e-6 || lo >= b ? [[SI[name(Math.min(lo, b))], 1]] : [[SI[name(lo)], 1 - f], [SI[name(lo + 1)], f]];
}
const fnv1a = bytes => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const posSum = p => fnv1a(new Uint8Array(p.P.buffer, p.P.byteOffset, p.P.byteLength));
function q4(ws, out, o) {   // en büyük 4 ağırlık -> toplamı 255 olan 4 bayt
  const e = ws.filter(x => x[1] > 0).sort((p, q) => q[1] - p[1]).slice(0, 4), s = e.reduce((t, x) => t + x[1], 0);
  const q = e.map(([k, w]) => [k, Math.floor(w / s * 255), w / s * 255 % 1]); let rem = 255 - q.reduce((t, x) => t + x[1], 0);
  for (const x of [...q].sort((p, r) => r[2] - p[2])) { if (rem <= 0) break; x[1]++; rem--; }
  for (let j = 0; j < 4; j++) { out[o + j] = q[j] ? q[j][0] : 0; out[o + 4 + j] = q[j] ? q[j][1] : 0; }
}
// Düzeltme tablosu: kirişi ayrı parça olan kaslar (insersiyo ucu eklenir: boy okuması eklemi geçsin), kalça çevresinde
// iki ucu da aynı s'de kalan kaslar (near: ağırlık kemiğe uzaklıkla, eklem parçaları gibi)
const LEG_FIX = {
  'Medial head of gastrocnemius': { b: 'foot', ext: 'cal', why: 'kiriş Tendo calcaneus ayrı parça; insersiyo Tuber calcanei' },
  'Lateral head of gastrocnemius': { b: 'foot', ext: 'cal', why: 'kiriş Tendo calcaneus ayrı parça; insersiyo Tuber calcanei' },
  'Soleus muscle': { b: 'foot', ext: 'cal', why: 'kiriş Tendo calcaneus ayrı parça; insersiyo Tuber calcanei' },
  'Extensor digitorum longus': { b: 'foot', ext: 'toe', why: 'kirişler ayrı parça; insersiyo 2.-5. parmakların dorsal aponevrozu' },
  'Pectineus muscle': { a: 'pelvis', b: 'femur', near: true, why: 'Pecten ossis pubis -> Linea pectinea; iki uç kalça eklemi hizasında' },
  'Quadratus femoris muscle': { a: 'pelvis', b: 'femur', near: true, why: 'Tuber ischiadicum -> Crista intertrochanterica; yatay' },
  ...Object.fromEntries(['Superior gemellus muscle', 'Inferior gemellus muscle', 'Obturator internus', 'Obturator externus', 'Piriformis muscle'].map(n => [n, { a: 'pelvis', b: 'femur', near: true, why: 'kısa, yatay dış rotator: uzuv ekseni boyunca yeri anlamsız' }])),
};
const nearW = (x, segs) => segs.map(k => { const bs = k === 'pelvis' ? pelvisB : legBones.filter(b => b.seg === k), d = Math.min(...bs.map(b => dist(b, x))); return [SI[k], d < 0.15 ? 1e6 : 1 / (d * d + 0.01)]; });
const legMus = parts.filter(p => p.sd === 'l' && p.s === 'muscle' && p.path.startsWith('Muscular system of lower limb > Muscles of lower limb'));
const skinParts = [], chunks = []; let offset = 0;
for (const p of legMus) {
  const v = verts(p), S = v.map(sOf), order = S.map((s, i) => i).sort((i, j) => S[i] - S[j]), k = Math.max(3, Math.round(0.03 * v.length));
  const eA = mean(order.slice(0, k).map(i => v[i])), eB = mean(order.slice(-k).map(i => v[i]));
  const fx = LEG_FIX[p.n] || {};
  let segA = fx.a || endSeg(eA), segB = fx.b || endSeg(eB);
  if (!segA || !segB) { fail(`${p.n}: uç segmenti bulunamadı (${segA}, ${segB})`); continue; }
  let a = LEVEL[segA], b = LEVEL[segB];
  if (a > b) { [a, b] = [b, a]; [segA, segB] = [segB, segA]; }
  if (segA === 'talus') segA = 'foot'; if (segB === 'talus') segB = 'foot';
  const s0 = S[order[0]], s1 = S[order[order.length - 1]], span = Math.max(1e-6, s1 - s0);
  const buf = new Uint8Array(9 * v.length);
  const WA = x => (fx.near ? nearW(x, [segA, segB]) : weightsAt(sOf(x), a, b, segA, segB, (sOf(x) - s0) / span));
  for (let i = 0; i < v.length; i++) { q4(fx.near ? nearW(v[i], [segA, segB]) : weightsAt(S[i], a, b, segA, segB, (S[i] - s0) / span), buf, 9 * i); buf[9 * i + 8] = Math.round(255 * Math.max(0, Math.min(1, (S[i] - s0) / span))); }
  // orta çizgi: s'ye göre 12 dilimin ağırlık merkezi; uçlar uç köşelerinin merkezi
  const line = [];
  for (let j = 0; j < 12; j++) {
    let pt;
    if (j === 0) pt = eA; else if (j === 11) pt = eB;
    else { const lo = s0 + span * (j - 0.5) / 11, hi = s0 + span * (j + 0.5) / 11, sl = v.filter((x, i) => S[i] >= lo && S[i] < hi); pt = sl.length ? mean(sl) : add(eA, mul(sub(eB, eA), j / 11)); }
    const w = (() => { const ws = WA(pt), t = ws.reduce((q, y) => q + y[1], 0); return ws.map(([si, x]) => [SEGS[si], Math.round(x / t * 1000) / 1000]).filter(y => y[1] > 0); })();
    line.push({ p: pt.map(x => Math.round(x * 1000) / 1000), w });
  }
  if (fx.ext) line.push({ p: (fx.ext === 'cal' ? LM.calPost : toeP).map(x => Math.round(x * 1000) / 1000), w: [['foot', 1]] });
  let L0 = 0; for (let j = 1; j < line.length; j++) L0 += len(sub(line[j].p, line[j - 1].p));
  skinParts.push({ n: p.n, id: p.id, kind: 'muscle', verts: v.length, offset, sum: posSum(p), chain: SEGS.filter(x => LEVEL[x] >= a && LEVEL[x] <= b && (x !== 'patella' || segB === 'patella') && (x !== 'tibia' || segB !== 'patella') && x !== 'talus'), L0: Math.round(L0 * 1000) / 1000, line });
  chunks.push(buf); offset += buf.length;
}
say(`  kaslar: ${skinParts.length} / ${legMus.length}; ` + ['pelvis', 'femur', 'patella', 'tibia', 'foot'].map(x => x + '→' + skinParts.filter(m => m.chain[m.chain.length - 1] === x).length).join(', '));
for (const j of jparts) {
  const p = legJoints.find(x => x.id === j.id);
  j.verts = p.P.length / 3; j.offset = offset; j.sum = posSum(p);
  const buf = new Uint8Array(9 * j.verts), v = verts(p), cs = j.chain.map(k => [SI[k], k === 'pelvis' ? pelvisB : legBones.filter(b => b.seg === k)]);
  for (let i = 0; i < v.length; i++) {
    const ws = cs.map(([si, bs]) => { const d = Math.min(...bs.map(b => dist(b, v[i]))); return [si, d < 0.15 ? 1e6 : 1 / (d * d + 0.01)]; });
    q4(ws, buf, 9 * i);
  }
  chunks.push(buf); offset += buf.length;
}
const BIN = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));

// ---------- hareketler (ders kitabı kasları locomotor.json'dan) ----------
const loco = JSON.parse(fs.readFileSync('public/data/locomotor.json', 'utf8'));
const locoMove = (jk, de) => loco.joints.list.find(x => x.key === jk)?.movements.find(x => x.de.startsWith(de));
const MOVES = [
  ['hFlex', 'huefte', 'Flexion', 'Uyluğu öne kaldırma (kalça fleksiyonu, diz 90° bükük)', { hipFlex: 120 }, { hipFlex: 0, knee: 90 }],
  ['hExt', 'huefte', 'Extension', 'Uyluğu geriye götürme', { hipFlex: -15 }, { hipFlex: 0 }],
  ['hAbd', 'huefte', 'Abduktion', 'Uyluğu yana açma', { hipAbd: 40 }, { hipAbd: 0 }],
  ['hAdd', 'huefte', 'Adduktion', 'Uyluğu içe yaklaştırma', { hipAbd: -25 }, { hipAbd: 0 }],
  ['hAR', 'huefte', 'Außenrotation', 'Kalçada dış rotasyon (kalça ve diz 90° bükük)', { hipRot: -45 }, { hipRot: 0, hipFlex: 90, knee: 90 }],
  ['hIR', 'huefte', 'Innenrotation', 'Kalçada iç rotasyon (kalça ve diz 90° bükük)', { hipRot: 35 }, { hipRot: 0, hipFlex: 90, knee: 90 }],
  ['kFlex', 'knie', 'Flexion', 'Dizi bükme', { knee: 140 }, { knee: 0 }],
  ['kExt', 'knie', 'Extension', 'Dizi germe', { knee: 0 }, { knee: 90 }],
  ['dors', 'sprunggelenke', 'Dorsalextension', 'Ayak ucunu yukarı kaldırma (OSG)', { ankle: 20 }, { ankle: 0 }],
  ['plan', 'sprunggelenke', 'Plantarflexion', 'Ayak ucunu aşağı indirme (OSG)', { ankle: -45 }, { ankle: 0 }],
  ['sup', 'sprunggelenke', 'Supination', 'Tabanı içe çevirme (USG)', { subtalar: -30 }, { subtalar: 0 }],
  ['pron', 'sprunggelenke', 'Pronation', 'Tabanı dışa çevirme (USG)', { subtalar: 15 }, { subtalar: 0 }],
].map(([key, jk, de, tr, set, from]) => { const m = locoMove(jk, de); return { key, group: jk, de: m?.de || de, tr, set, from, textbook: m?.muscles || [] }; });
for (const m of MOVES) if (!m.textbook.length) fail('ders kitabı kası yok: ' + m.key);
const R4 = a => a.map(v => Math.round(v * 1e4) / 1e4), r2 = v => Math.round(v * 100) / 100;
const outJ = {
  v: 1, side: 'l', note: 'motion-leg-build.mjs ile üretildi (data/work/motion/SPEC-LEG.md); elle değiştirmeyin',
  segments: SEGS.map(k => ({ key: k, parent: PARENT[k], ids: k === 'pelvis' ? [] : segIds[k] })),
  joints: {
    hip: R4(LM.hip), hipR: r2(LM.hipR), knee: R4(LM.knee), kneeAxis: R4(LM.kneeAxis), ankle: R4(LM.ankle), ankleAxis: R4(LM.ankleAxis),
    subtalar: R4(LM.subtalar), subtalarAxis: R4(LM.subtalarAxis), calPost: R4(LM.calPost)
  },
  rest: { hipFlex: r2(LM.rest.hipFlex), hipAbd: r2(LM.rest.hipAbd), hipRot: 0, knee: r2(LM.rest.knee), ankle: r2(90 - LM.rest.footToTibia), subtalar: 0 },
  skin: { file: 'models/motion-leg.bin', bytesPerVertex: 9, bytes: BIN.length, parts: [...skinParts, ...jparts] },
  movements: MOVES,
};
if (!process.argv.includes('--dry') && !fails.length) { const s = JSON.stringify(outJ); fs.writeFileSync('public/data/motion-leg.json', s); fs.writeFileSync('public/models/motion-leg.bin', BIN); say('  yazıldı: public/models/motion-leg.bin (' + (BIN.length / 1024).toFixed(1) + ' KB)'); say(`  yazıldı: public/data/motion-leg.json (${(s.length / 1024).toFixed(1)} KB)`); }
say(fails.length ? `\n${fails.length} hata` : '\nhata yok');
process.exitCode = fails.length ? 1 : 0;
