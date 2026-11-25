// Gövde ve baş-boyun hareketi verisi. Adım 1 (küçük sürüm): kemikler ve tek segmentli eklem parçaları katı hareket eder.
// Adım 2 (2026-11-25): gövde ve boyun kaslarının deri ağırlıkları (public/models/motion-spine.bin, kol ve bacakla aynı 9 bayt /
// köşe biçimi: 4 segment, 4 ağırlık / 255, t / 255) ve kas çizgileri (orta çizgi; dönmede yan ayırmak için lif çizgileri).
// Sayılar ağlardan ölçülür; ders kitabı değerleri (segment ROM payları, sınırlar) src/motion-kin-spine.js içindedir.
// Çalıştırma (app/ içinde): node tools/motion-spine-build.mjs [--dry]   (public/data/motion-spine.json ve public/models/motion-spine.bin
// yazar; --dry yazmaz)
// Koordinatlar: x sola, y yukarı, z öne; birim cm.
//
// Dönme merkezleri (bir hareket segmentinde üstteki omur alttakine göre bu nokta çevresinde döner):
//   - Diski olan segmentler (C2/C3 .. L5/S1): Nucleus pulposus ağının ağırlık merkezi. Gerekçe: Kapandji (Funktionelle Anatomie
//     der Gelenke, Bd. 3: Rumpf und Wirbelsäule) nucleus pulposus'u iki omur cismi arasındaki "bilye" (Kugelgelenk gibi) olarak
//     anlatır; White & Panjabi (Clinical Biomechanics of the Spine, 1990) ani dönme eksenlerini fleksiyon / ekstansiyonda diskin
//     ve alttaki omur cisminin üst bölümünde, lomberde diskin arka yarısında verir: çekirdek bu bölgenin ortasındadır.
//   - C1/C2 (Art. atlantoaxialis mediana, Zapfengelenk): dens axis'in tepe bölümünün (en üst 1,2 cm) ağırlık merkezi; atlas
//     dens çevresinde döner.
//   - C0/C1 (Art. atlantooccipitalis, Eigelenk): atlasın Os occipitale'ye 0,5 cm'den yakın üst eklem yüzlerinin ortası (iki
//     kondilin arasındaki enine eksen).
// Bağlı parçalar: her kaburga ve kıkırdağı kendi torakal omuruyla (Costa n -> Tn); sternum, kıkırdak uçlarının kayması en
// küçük olan torakal omurla; omuz kuşağı ve iki kol, SC eklemi ve skapula-kaburga temasının kayması en küçük olan T1-T4
// omuruyla; hyoid ve gırtlak kıkırdakları birlikte, yüksekliklerine en yakın boyun omuruyla (ölçülür, raporda).
// Kafatası, mandibula, dişler, kulak kemikçikleri, burun kıkırdakları: baş segmenti. Sacrum, coccyx, kalça kemikleri ve
// bacaklar: pelvis (durağan).
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import fs from 'node:fs';
import { loadScene } from './scene.mjs';
import { sub, add, mul, dot, cross, len, norm, DEG, mean, f2, verts, pca } from './motion-geom.mjs';
import * as K from '../src/motion-kin-spine.js';

const fails = [];
const say = (s = '') => console.log(s);
const fail = s => { fails.push(s); say('  HATA: ' + s); };
// Çizilen kaslar (adım 2) ve kas başına seçenekler: fib = dönme okuması için lif çizgileri (aşağıda), bulge: false = şişme yok
// (yassı tabakalar: orta çizgi tabakanın dışında kalır). İki yan ayrı parçadır (anahtar ad + '.l' / '.r').
const MUS = {
  // autochthone Rückenmuskeln: M. erector spinae, transversospinale Gruppe, Mm. interspinales / intertransversarii, Splenius, Suboccipitales
  'Iliocostalis lumborum muscle': {}, 'Iliocostalis thoracis muscle': {}, 'Iliocostalis colli muscle': {},
  'Longissimus thoracis muscle': {}, 'Longissimus colli muscle': {}, 'Longissimus capitis muscle': {},
  'Spinalis thoracis muscle': {}, 'Spinalis colli muscle': {}, 'Spinalis capitis muscle': {},
  'Multifidus lumborum muscle': { fib: 'multifidus' }, 'Multifidus thoracis muscle': { fib: 'multifidus' }, 'Multifidus colli muscle': { fib: 'multifidus' },
  'Rotatores': { fib: 'rotatores' }, 'Semispinalis thoracis muscle': { fib: 'semispinalis' }, 'Semispinalis colli muscle': { fib: 'semispinalis' },
  'Interspinales lumborum muscles': {}, 'Interspinales thoracis muscles': {}, 'Interspinales colli muscles': {},
  'Dorsal parts of lateral intertransversarii lumborum muscles': {}, 'Ventral parts of lateral intertransversarii lumborum muscles': {},
  'Splenius capitis muscle': {}, 'Splenius colli muscle': {},
  'Rectus posterior major capitis muscle': {}, 'Rectus posterior minor capitis muscle': {}, 'Obliquus superior capitis muscle': {}, 'Obliquus inferior capitis muscle': {},
  // Hals und Nacken
  'Sternocleidomastoid muscle': {}, 'Scalenus anterior muscle': {}, 'Scalenus medius muscle': {}, 'Scalenus posterior muscle': {},
  'Longus colli muscle': {}, 'Longus capitis muscle': {}, 'Rectus anterior capitis muscle': {}, 'Rectus lateralis capitis muscle': {},
  'Descending part of trapezius muscle': {}, 'Transverse part of trapezius muscle': { bulge: false }, 'Ascending part of trapezius muscle': { bulge: false }, 'Levator scapulae': {},
  // Bauchwand, M. quadratus lumborum, M. iliopsoas (Iliacus und Leistenband liegen ganz im Becken: durağan)
  'Rectus abdominis muscle': {}, 'Linea alba': { bulge: false }, 'Pyramidalis muscle': {},
  'External abdominal oblique muscle': { fib: 'eo', bulge: false }, 'Internal abdominal oblique muscle': { fib: 'io', bulge: false }, 'Transversus abdominis muscle': { bulge: false },
  'Inguinal ligament': { bulge: false }, 'Quadratus lumborum muscle': {}, 'Psoas major': {}, 'Iliacus muscle': {},
};
const { meta, parts } = await loadScene({ files: ['bones', 'femalepelvis', 'joints', 'femalejoints', 'muscles'], keep: it => (it.s === 'bone' && it.sub !== 'attach') || it.s === 'joint' || (it.s === 'muscle' && !it.x && MUS[it.n] !== undefined) });
const G = meta.groups;
const gpath = g => { const a = []; while (g >= 0) { a.unshift(G[g].n); g = G[g].p; } return a.join(' > '); };
for (const p of parts) p.path = gpath(p.g);
const bones = parts.filter(p => p.s === 'bone'), joints = parts.filter(p => p.s === 'joint');
say(`motion-spine-build: gövde ve baş-boyun (küçük sürüm); kemik ${bones.length}, eklem parçası ${joints.length}`);
const prep = p => { if (!p.bvh) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.P, 3)); g.setIndex(new THREE.BufferAttribute(p.I, 1)); p.bvh = new MeshBVH(g); } return p; };
const _v = new THREE.Vector3(), _hit = {};
const dist = (p, x) => { prep(p).bvh.closestPointToPoint(_v.set(x[0], x[1], x[2]), _hit); return _hit.distance; };
const bbox = p => { if (!p.bb) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < p.P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.P[i + a]); mx[a] = Math.max(mx[a], p.P[i + a]); } p.bb = { mn, mx }; } return p.bb; };
const inBox = (p, x, m) => { const b = bbox(p); return x[0] > b.mn[0] - m && x[0] < b.mx[0] + m && x[1] > b.mn[1] - m && x[1] < b.mx[1] + m && x[2] > b.mn[2] - m && x[2] < b.mx[2] + m; };
const B = n => { const b = bones.find(x => x.n === n && x.x !== 'f'); if (!b) throw new Error('kemik yok: ' + n); return b; };
const centroid = p => mean(verts(p));

// ---------- kemik -> segment ----------
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const vertKey = n => n === 'Atlas (C1)' ? 'C1' : n === 'Axis (C2)' ? 'C2' : (/^Vertebra ([CTL]\d+)$/.exec(n) || [])[1] || null;
function baseSeg(p) {
  const n = p.n, v = vertKey(n); if (v) return v;
  let m = /^(\w+) rib$/i.exec(n); if (m && ORD.includes(m[1].toLowerCase())) return 'T' + (ORD.indexOf(m[1].toLowerCase()) + 1);
  m = /^Costal cartilage of (\w+) rib$/i.exec(n); if (m && ORD.includes(m[1].toLowerCase())) return 'T' + (ORD.indexOf(m[1].toLowerCase()) + 1);
  if (/^(Manubrium of sternum|Body of sternum|Xiphoid process)$/.test(n)) return 'STERNUM';
  if (p.path.startsWith('Bones of upper limb')) return 'GIRDLE';
  if (n === 'Hyoid bone' || p.path.startsWith('Laryngeal cartilages')) return 'LARYNX';
  if (p.path.startsWith('Cranium') || p.path.startsWith('Teeth') || p.path.startsWith('Auditory ossicles') || p.path.startsWith('Nasal cartilages') || n === 'Mandible') return 'head';
  if (n === 'Sacrum' || n === 'Coccyx' || p.path.startsWith('Bones of lower limb')) return 'pelvis';
  return null;
}
for (const b of bones) { b.seg = baseSeg(b); if (!b.seg) fail('segmenti bilinmeyen kemik: ' + b.n + ' (' + b.path + ')'); }

// ---------- dönme merkezleri ----------
const SEG = K.SEGMENTS, C = {};
for (const [label, k] of K.ROM) {
  if (k === 'head' || k === 'C1') continue;
  const [up, lo] = label.split('/'), np = joints.find(j => j.n === `Nucleus pulposus ${up}-${lo}` && j.x !== 'f');
  if (!np) { fail('nucleus pulposus yok: ' + label); continue; }
  C[k] = centroid(np);
}
{
  const ax = B('Axis (C2)'), at = B('Atlas (C1)'), occ = B('Occipital bone');
  const av = verts(ax), top = Math.max(...av.map(x => x[1])), dens = av.filter(x => x[1] >= top - 1.2);
  C.C1 = mean(dens);
  const atc = centroid(at); let fac = [];
  for (const th of [0.5, 0.8, 1.2]) { fac = verts(at).filter(x => x[1] > atc[1] && dist(occ, x) < th); if (fac.length >= 20) break; }
  C.head = mean(fac);
  const l = fac.filter(x => x[0] > C.head[0]), r = fac.filter(x => x[0] <= C.head[0]);
  say(`  C0/C1: atlas üst eklem yüzleri ${fac.length} köşe (sol ${l.length}, sağ ${r.length}), orta ${C.head.map(f2)}; yüzler arası ${l.length && r.length ? f2(len(sub(mean(l), mean(r)))) : '-'} cm`);
  say(`  C1/C2: dens tepesi (${dens.length} köşe) ${C.C1.map(f2)}; atlas ağırlık merkezinden ${f2(len(sub(C.C1, atc)))} cm`);
}
// her merkez iki omur cismi arasında mı? (diskli segmentlerde: üst ve alt omura uzaklık)
const vb = k => bones.find(b => b.seg === k && vertKey(b.n) === k);
for (const [label, k] of K.ROM) {
  if (!C[k] || k === 'head' || k === 'C1') continue;
  const i = SEG.indexOf(k), below = SEG[i - 1], dUp = dist(vb(k), C[k]), dLo = below === 'pelvis' ? dist(B('Sacrum'), C[k]) : dist(vb(below), C[k]);
  if (dUp > 1.5 || dLo > 1.5) fail(`${label}: merkez omurlardan uzak (${f2(dUp)} / ${f2(dLo)} cm)`);
}
// eksenler: y = bir üstteki merkeze, x = sola, z = öne
const AX = {};
for (let i = 1; i < SEG.length; i++) {
  const k = SEG[i], up = SEG[i + 1];
  // C1 ve baş: C0/C1 merkezi dens tepesiyle neredeyse aynı yükseklikte; boyuna eksen C2/C3 merkezinden dens tepesine (axis + dens çizgisi)
  const y = k === 'C1' || k === 'head' ? norm(sub(C.C1, C.C2)) : norm(sub(C[up], C[k])), x = norm(sub([1, 0, 0], mul(y, y[0]))), z = cross(x, y);
  AX[k] = { x, y, z };
}
say('  segment eksenlerinin dikeyden sagittal eğimi (+ öne): ' + SEG.slice(1).map(k => `${K.SHARE[k].label} ${Math.round(Math.atan2(AX[k].y[2], AX[k].y[1]) * DEG)}`).join(', '));
const headBones = bones.filter(b => b.seg === 'head'), headPt = headBones.flatMap(verts).reduce((a, b) => (b[1] > a[1] ? b : a));
say(`  baş tutamacı (kafatasının en üst noktası) ${headPt.map(f2)}; C0/C1'e uzaklık ${f2(len(sub(headPt, C.head)))} cm`);

// ---------- kuşak, sternum, gırtlak: hangi omur? (ölçü: test duruşlarında temas noktalarının kayması) ----------
const R4 = a => a.map(v => Math.round(v * 1e4) / 1e4);
const provisional = () => ({ segments: SEG.map(k => ({ key: k })), joints: { centre: Object.fromEntries(Object.entries(C).map(([k, v]) => [k, R4(v)])), axes: Object.fromEntries(Object.entries(AX).map(([k, a]) => [k, { x: R4(a.x), y: R4(a.y), z: R4(a.z) }])), headPt: R4(headPt) } });
const KM = K.createModel(provisional()), o = K.createFk(KM);
const TEST = [{ tFlex: 35 }, { tFlex: -25 }, { tLat: 20 }, { tLat: -20 }, { tRot: 40 }, { tRot: -40 }, { cFlex: 45, tFlex: 35, lFlex: 50 }];
const tp = (k, p) => { const m = o.m[k]; return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; };
// pairs: [[nokta, kendi segmenti]], aday segment c: kayma = | M_own p - M_c p |
function slip(pairs, c) { let s = 0, n = 0, mx = 0; for (const q of TEST) { K.fk(KM, q, o); for (const [p, own] of pairs) { const d = len(sub(tp(own, p), tp(c, p))); s += d * d; n++; mx = Math.max(mx, d); } } return { rms: Math.sqrt(s / Math.max(1, n)), mx }; }
const sternum = bones.filter(b => b.seg === 'STERNUM'), contacts = (p, others, th) => { const v = verts(p), st = Math.max(1, Math.floor(v.length / 400)), out = []; for (let i = 0; i < v.length; i += st) if (others.some(b => dist(b, v[i]) < th)) out.push(v[i]); return out; };
const ATT = {};
{
  const pairs = [];
  for (const b of bones.filter(b => /^Costal cartilage of/.test(b.n))) { const k = b.seg; for (const p of contacts(b, sternum, 0.5)) pairs.push([p, k]); }
  const rows = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map(c => [c, slip(pairs, c)]);
  rows.sort((a, b) => a[1].rms - b[1].rms); ATT.STERNUM = rows[0][0];
  say(`  sternum: kıkırdak-sternum teması ${pairs.length} nokta; kayma (rms / en çok, cm): ` + rows.map(([c, r]) => `${c} ${f2(r.rms)} / ${f2(r.mx)}`).join(', ') + ` -> ${ATT.STERNUM}`);
}
{
  const pairs = [], clav = bones.filter(b => b.n === 'Clavicle'), scap = bones.filter(b => b.n === 'Scapula');
  for (const c of clav) for (const p of contacts(c, sternum.filter(s => s.n === 'Manubrium of sternum'), 0.6)) pairs.push([p, ATT.STERNUM]);
  const ribs = bones.filter(b => /^(Second|Third|Fourth|Fifth|Sixth|Seventh) rib$/.test(b.n));
  for (const s of scap) for (const p of contacts(s, ribs, 2.0)) { let best = null, bd = Infinity; for (const r of ribs) { const d = dist(r, p); if (d < bd) { bd = d; best = r; } } pairs.push([p, best.seg]); }
  const rows = ['T1', 'T2', 'T3', 'T4'].map(c => [c, slip(pairs, c)]);
  rows.sort((a, b) => a[1].rms - b[1].rms); ATT.GIRDLE = rows[0][0];
  say(`  omuz kuşağı + kollar: SC ve skapula-kaburga teması ${pairs.length} nokta; kayma: ` + rows.map(([c, r]) => `${c} ${f2(r.rms)} / ${f2(r.mx)}`).join(', ') + ` -> ${ATT.GIRDLE}`);
}
{
  const lx = bones.filter(b => b.seg === 'LARYNX'), y = mean(lx.map(centroid))[1];
  const cand = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(k => [k, Math.abs(centroid(vb(k))[1] - y)]).sort((a, b) => a[1] - b[1]);
  ATT.LARYNX = cand[0][0];
  say(`  hyoid + gırtlak kıkırdakları (${lx.map(b => b.n).join(', ')}): ağırlık merkezi y ${f2(y)} -> ${ATT.LARYNX} (yükseklik farkı ${f2(cand[0][1])} cm)`);
}
for (const b of bones) if (ATT[b.seg]) b.seg = ATT[b.seg];
const segIds = Object.fromEntries(SEG.map(k => [k, bones.filter(b => b.seg === k && b.x !== 'f').map(b => b.id)]));
say('  segment kemikleri: ' + SEG.slice(1).map(k => `${k} ${segIds[k].length}`).join(', '));
for (const k of SEG.slice(1)) if (!segIds[k].length) fail('kemiksiz segment: ' + k);

// ---------- eklem parçaları: değdikleri segmentler (0,3 cm içinde kemiği olan) ----------
const SI = Object.fromEntries(SEG.map((k, i) => [k, i]));
const jparts = [];
for (const j of joints) {
  const v = verts(j), step = Math.max(1, Math.floor(v.length / 80)), ch = new Set();
  for (let i = 0; i < v.length; i += step) for (const b of bones) if (inBox(b, v[i], 0.3) && dist(b, v[i]) < 0.3) ch.add(b.seg);
  if (!ch.size) { let best = null, bd = 2; const c = mean(v); for (const b of bones) if (inBox(b, c, 2)) { const d = dist(b, c); if (d < bd) { bd = d; best = b.seg; } } if (best) ch.add(best); }
  const chain = SEG.filter(k => ch.has(k));
  jparts.push({ n: j.n, id: j.id, kind: 'joint', chain: chain.length ? chain : ['pelvis'] });
}
const nMulti = jparts.filter(x => x.chain.length > 1).length, nStill = jparts.filter(x => x.chain.length === 1 && x.chain[0] === 'pelvis').length;
say(`  eklem parçaları: ${jparts.length}; tek segmentli (hareketli) ${jparts.length - nMulti - nStill}, yalnız pelvis (durağan) ${nStill}, çok segmentli ${nMulti}`);
for (const n of ['Intervertebral disc C4-C5', 'Anterior longitudinal ligament', 'Articular capsule of temporomandibular joint', 'Radiate ligament of head of rib', 'Articular capsule of sternoclavicular joint', 'Iliolumbar ligament']) { const j = jparts.find(x => x.n === n); say(`    ${n}: ${j ? j.chain.join('+') : 'yok'}`); }

// ---------- deri ağırlıkları (adım 2: gövde ve boyun kasları) ----------
// Her köşeye sürekli bir "düzey" L verilir (segment sırası: pelvis 0, L5 1 ... T1 17, C7 18 ... C1 24, baş 25). L, köşenin her
// segmentin kemiklerine (omur + kaburgaları + kıkırdakları; T4: sternum, omuz kuşağı ve kollar; C5: hyoid ve gırtlak; baş:
// kafatası; pelvis: sacrum, kalça kemikleri, bacaklar) uzaklığıyla ağırlıklı ortalamadır: w = yumuşak kesme(d - dmin) / (d^2 + 0,01),
// 0,15 cm'den yakın kemik katı bağlar (yumuşak kesme: dmin + 2 cm'den sonra azalır, dmin + 5 cm'de sıfır). Ağırlık iki komşu
// segment arasında: floor(L) ve floor(L) + 1, kesir doğrudan (SMOOTH_MIX 0; 1 = smoothstep). Böylece omurga boyunca uzanan bir kas
// her yükseklikte o düzeydeki omurla gider ve iki komşu omur arasında yumuşak geçer; kaburgaya, kafatasına, sternuma ya da pelvise
// değen uç kendi kemiğinin segmentinde kalır (kaburgalar kendi omurunda, pelvis durağan); kemikten uzak karın duvarı ortası kaburga,
// omur ve pelvisin arasındaki düzeyi alır. Seçim ekransız ölçüyle (tools/_qawork/motion-spine-hide.mjs, 20 duruş): smoothstep 5,
// doğrusal 3 gizlenen kas (yapılandırmasız 28 / 23); katı bağsız sürekli ağırlıklar (1 / (d^2 + 0,0025) ya da + 0,01) 6-11, katı
// sınır 0,3 cm 11, kesme 1-3 / 3-8 cm 5. Denemek için: SP_MIX, SP_EPS, SP_RIGID, SP_T0, SP_T1 ortam değişkenleri.
const E = process.env, TAPER = [+(E.SP_T0 ?? 2), +(E.SP_T1 ?? 5)], RIGID = +(E.SP_RIGID ?? 0.15), EPS = +(E.SP_EPS ?? 0.01), SMOOTH_MIX = +(E.SP_MIX ?? 0);
const segBones = SEG.map(k => bones.filter(b => b.seg === k && b.x !== 'f'));
const SB = segBones.map(bs => {
  let n = 0, m = 0; for (const b of bs) { n += b.P.length; m += b.I.length; }
  const P = new Float32Array(n), I = new Uint32Array(m); let po = 0, io = 0;
  for (const b of bs) { P.set(b.P, po); for (let j = 0; j < b.I.length; j++) I[io + j] = b.I[j] + po / 3; po += b.P.length; io += b.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1));
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
  return { bvh: n ? new MeshBVH(g) : null, mn, mx };
});
const _sp = new THREE.Vector3(), _st = {}, _d = new Float64Array(SEG.length), _lb = new Float64Array(SEG.length), _ord = SEG.map((k, i) => i);
const smooth3 = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// x -> sürekli düzey L
function levelAt(x) {
  for (let i = 0; i < SEG.length; i++) { const b = SB[i]; let s = 0; for (let a = 0; a < 3; a++) { const e = Math.max(b.mn[a] - x[a], 0, x[a] - b.mx[a]); s += e * e; } _lb[i] = b.bvh ? Math.sqrt(s) : Infinity; _d[i] = Infinity; }
  _ord.sort((a, b) => _lb[a] - _lb[b]);
  let dmin = Infinity;
  for (const i of _ord) {
    if (_lb[i] > dmin + TAPER[1]) break;
    const r = SB[i].bvh.closestPointToPoint(_sp.set(x[0], x[1], x[2]), _st, 0, dmin + TAPER[1]);
    if (r) { _d[i] = r.distance; if (r.distance < dmin) dmin = r.distance; }
  }
  let sw = 0, sl = 0;
  for (let i = 0; i < SEG.length; i++) {
    const d = _d[i]; if (!(d < Infinity)) continue;
    const tp = 1 - smooth3((d - dmin - TAPER[0]) / (TAPER[1] - TAPER[0])); if (tp <= 0) continue;
    const w = d < RIGID ? 1e6 : tp / (d * d + EPS); sw += w; sl += w * i;
  }
  return { L: sw > 0 ? sl / sw : 0, dmin };
}
// L -> [[segment sırası, ağırlık], ...] (en çok iki komşu segment)
function weightsOfLevel(L) {
  const lo = Math.min(SEG.length - 1, Math.max(0, Math.floor(L))), f = L - lo;
  if (lo >= SEG.length - 1 || f < 1e-6) return [[lo, 1]];
  const s = SMOOTH_MIX * smooth3(f) + (1 - SMOOTH_MIX) * f;
  return s < 1e-6 ? [[lo, 1]] : s > 1 - 1e-6 ? [[lo + 1, 1]] : [[lo, 1 - s], [lo + 1, s]];
}
const wNamed = ws => ws.map(([i, w]) => [SEG[i], Math.round(w * 1000) / 1000]).filter(y => y[1] > 0);
const fnv1a = bytes => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const posSum = p => fnv1a(new Uint8Array(p.P.buffer, p.P.byteOffset, p.P.byteLength));
function q4(ws, out, o) {   // en büyük 4 ağırlık -> toplamı 255 olan 4 bayt (bacakla aynı)
  const e = ws.filter(x => x[1] > 0).sort((p, q) => q[1] - p[1]).slice(0, 4), s = e.reduce((t, x) => t + x[1], 0);
  const q = e.map(([k, w]) => [k, Math.floor(w / s * 255), w / s * 255 % 1]); let rem = 255 - q.reduce((t, x) => t + x[1], 0);
  for (const x of [...q].sort((p, r) => r[2] - p[2])) { if (rem <= 0) break; x[1]++; rem--; }
  for (let j = 0; j < 4; j++) { out[o + j] = q[j] ? q[j][0] : 0; out[o + 4 + j] = q[j] ? q[j][1] : 0; }
}
// Omur işaretleri (lif çizgileri için): Proc. spinosus ucu (orta hatta en arkadaki köşe), lamina kökü (orta hatta kanalın
// arkasındaki ilk köşeler), Proc. transversus uçları (en yandaki 5 köşenin ortası; x > 0 sol)
const MARK = {};
for (const k of SEG.slice(1, -1)) {
  const b = vb(k); if (!b) continue;
  const v = verts(b), c = centroid(b), mid = v.filter(x => Math.abs(x[0] - c[0]) < 0.5);
  const sp = mid.reduce((a, x) => (x[2] < a[2] ? x : a), mid[0]);
  const zs = mid.map(x => x[2]).sort((a, b) => b - a); let gap = 0, zb = zs[zs.length - 1];
  for (let i = 1; i < zs.length; i++) if (zs[i - 1] - zs[i] > gap) { gap = zs[i - 1] - zs[i]; zb = zs[i]; }
  const lam = mean(mid.filter(x => x[2] <= zb && x[2] > zb - 0.4));
  const byX = [...v].sort((a, b) => b[0] - a[0]);
  MARK[k] = { sp, lam, tp: { l: mean(byX.slice(0, 5)), r: mean(byX.slice(-5)) } };
}
// Lif çizgileri (boy okuması; bükme orta çizgiyle): dönmede iki yanı ayırmak için. Transversospinal kaslar Proc. transversus'tan
// birkaç düzey yukarıdaki Proc. spinosus'a (Rotatores: lamina köküne, bir ve iki düzey; Multifidus: üç düzey; Semispinalis: beş
// düzey) çekilir; okuma liflerin ortalamasıdır. Karın kasları: M. obliquus externus kaburgalardaki origodan aşağı-içe (45°) linea
// alba'ya, M. obliquus internus crista iliaca'dan yukarı-içe (45°) linea alba'ya ve arka lifleri alt kaburgalara.
const FIB = { rotatores: [[1, 'lam'], [2, 'lam']], multifidus: [[3, 'sp']], semispinalis: [[5, 'sp']] };
function fibresOf(p, v, sideK) {
  const kind = MUS[p.n].fib, ys = v.map(x => x[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), out = [];
  const pt = (x, w) => ({ p: x.map(q => Math.round(q * 1000) / 1000), w });
  if (FIB[kind]) {
    const inR = k => { const c = centroid(vb(k))[1]; return c >= y0 - 1 && c <= y1 + 1; };
    for (let i = 1; i < SEG.length - 2; i++) for (const [st, to] of FIB[kind]) {
      const a = SEG[i], b = SEG[i + st]; if (!MARK[a] || !MARK[b] || i + st > SEG.length - 2 || !inR(a) || !inR(b)) continue;
      out.push([pt(MARK[a].tp[sideK], [[a, 1]]), pt(MARK[b][to], [[b, 1]])]);
    }
    return out;
  }
  // linea alba'ya yakın nokta (verilen yükseklikte, bu kasın en içteki köşesi)
  const sx = sideK === 'l' ? 1 : -1;
  const medialAt = y => { let best = null; for (const x of v) { if (Math.abs(x[1] - y) > 1.5 || x[2] < 0) continue; if (!best || sx * x[0] < sx * best[0]) best = x; } return best; };
  const soft = x => pt(x, wNamed(weightsOfLevel(levelAt(x).L)));
  const at45 = (o, dir) => { let best = null, be = Infinity; for (let y = o[1]; dir < 0 ? y > y0 : y < y1; y += dir * 0.5) { const m = medialAt(y); if (!m) continue; const e = Math.abs(Math.abs(y - o[1]) - Math.hypot(m[0] - o[0], m[2] - o[2])); if (e < be) { be = e; best = m; } } return best; };
  if (kind === 'eo') {
    for (const n of [6, 8, 10]) {
      const rib = bones.find(b => b.n === ORD[n - 1][0].toUpperCase() + ORD[n - 1].slice(1) + ' rib' && b.sd === sideK && b.x !== 'f'); if (!rib) continue;
      const c = v.filter(x => sx * x[0] > 4 && dist(rib, x) < 0.8); if (c.length < 5) continue;
      const o = mean(c), m = at45(o, -1); if (m) out.push([pt(o, [['T' + n, 1]]), soft(m)]);
    }
  } else if (kind === 'io') {
    const hip = bones.find(b => b.n === 'Hip bone' && b.sd === sideK && b.x !== 'f');
    const c = v.filter(x => dist(hip, x) < 1.0 && sx * x[0] > 5).sort((a, b) => b[2] - a[2]);
    for (const q of [[0, 0.33], [0.33, 0.66]]) { const s = c.slice(Math.floor(q[0] * c.length), Math.floor(q[1] * c.length)); if (s.length < 5) continue; const o = mean(s), m = at45(o, 1); if (m) out.push([pt(o, [['pelvis', 1]]), soft(m)]); }
    // arka lifler: crista iliaca'nın arka bölümü -> 11. / 12. kaburganın alt kenarı
    const ribs = bones.filter(b => /^(Eleventh|Twelfth) rib$/.test(b.n) && b.sd === sideK && b.x !== 'f');
    const rc = v.filter(x => ribs.some(r => dist(r, x) < 1.0)), back = c.slice(Math.floor(0.66 * c.length));
    if (rc.length >= 5 && back.length >= 5) { const r = mean(rc), seg = ribs.map(b => [b.seg, Math.min(...rc.map(x => dist(b, x)))]).sort((a, b) => a[1] - b[1])[0][0]; out.push([pt(mean(back), [['pelvis', 1]]), pt(r, [[seg, 1]])]); }
  }
  return out;
}
const musParts = parts.filter(p => p.s === 'muscle').sort((a, b) => a.n.localeCompare(b.n) || String(a.sd).localeCompare(String(b.sd)));
for (const n of Object.keys(MUS)) { const k = musParts.filter(p => p.n === n).length; if (k !== (n === 'Linea alba' ? 1 : 2)) fail(`kas parçası sayısı beklenmiyor: ${n} (${k})`); }
const skinParts = [], chunks = []; let offset = 0;
for (const p of musParts) {
  const v = verts(p), nv = v.length, f = pca(v);
  let ax = f.axes[0].v; if (ax[1] < 0) ax = mul(ax, -1);
  const S = v.map(x => dot(sub(x, f.c), ax)), s0 = Math.min(...S), s1 = Math.max(...S), span = Math.max(1e-6, s1 - s0);
  const buf = new Uint8Array(9 * nv), Ls = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { const L = levelAt(v[i]).L; Ls[i] = L; q4(weightsOfLevel(L), buf, 9 * i); buf[9 * i + 8] = Math.round(255 * (S[i] - s0) / span); }
  // orta çizgi: eksen boyunca 12 dilimin ağırlık merkezi (uçlar: uç %3 köşelerin merkezi); örnek ağırlıkları köşelerle aynı kuraldan
  const order = S.map((s, i) => i).sort((i, j) => S[i] - S[j]), k3 = Math.max(3, Math.round(0.03 * nv));
  const eA = mean(order.slice(0, k3).map(i => v[i])), eB = mean(order.slice(-k3).map(i => v[i])), line = [];
  for (let j = 0; j < 12; j++) {
    let q;
    if (j === 0) q = eA; else if (j === 11) q = eB;
    else { const lo = s0 + span * (j - 0.5) / 11, hi = s0 + span * (j + 0.5) / 11, sl = v.filter((x, i) => S[i] >= lo && S[i] < hi); q = sl.length ? mean(sl) : add(eA, mul(sub(eB, eA), j / 11)); }
    line.push({ p: q.map(x => Math.round(x * 1000) / 1000), w: wNamed(weightsOfLevel(levelAt(q).L)) });
  }
  let L0 = 0; for (let j = 1; j < line.length; j++) L0 += len(sub(line[j].p, line[j - 1].p));
  const sideK = p.sd || null, opt = MUS[p.n], rec = { n: p.n, sd: sideK, key: sideK ? p.n + '.' + sideK : p.n, id: p.id, kind: 'muscle', verts: nv, offset, sum: posSum(p), L0: Math.round(L0 * 1000) / 1000, line };
  rec.chain = SEG.filter((k, i) => Ls.some(L => Math.floor(L) === i || Math.ceil(L) === i));
  if (opt.bulge === false) rec.bulge = 0;
  if (opt.fib) { rec.fib = fibresOf(p, v, sideK); if (rec.fib.length < 2) fail(`${rec.key}: lif çizgisi az (${rec.fib.length})`); }
  skinParts.push(rec); chunks.push(buf); offset += buf.length;
  const lmin = Math.min(...Ls), lmax = Math.max(...Ls);
  if (!sideK || sideK === 'l') say(`    ${p.n}: ${nv} köşe, düzey ${f2(lmin)} (${SEG[Math.floor(lmin)]}) .. ${f2(lmax)} (${SEG[Math.min(SEG.length - 1, Math.ceil(lmax))]})${rec.fib ? `, ${rec.fib.length} lif` : ''}`);
}
const BIN = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
say(`  kaslar: ${skinParts.length} parça, ${skinParts.reduce((t, p) => t + p.verts, 0)} köşe; .bin ${(BIN.length / 1024).toFixed(1)} KB`);

// ---------- hareketler ve ders kitabı kasları ----------
// Liste: muscles.json "f_de" (Funktion) satırlarından; her kasın satırında hareket adı geçmeli (aşağıda denetlenir).
// Yan: beidseitig (iki yan birlikte), gleiche Seite (hareket yönündeki yan), Gegenseite (karşı yan).
const mus = JSON.parse(fs.readFileSync('public/data/muscles.json', 'utf8')).muscles, items = new Map(meta.items.filter(i => i.s === 'muscle').map(i => [i.n, i]));
const bi = 'beidseitig', gl = 'gleiche Seite', ge = 'Gegenseite';
const TB = {
  cFlex: [['Longus colli muscle', bi], ['Longus capitis muscle', bi], ['Rectus anterior capitis muscle', bi], ['Scalenus anterior muscle', bi]],
  cExt: [['Splenius capitis muscle', bi], ['Splenius colli muscle', bi], ['Semispinalis colli muscle', bi], ['Longissimus capitis muscle', bi], ['Descending part of trapezius muscle', bi], ['Rectus posterior major capitis muscle', bi], ['Obliquus superior capitis muscle', bi], ['Sternocleidomastoid muscle', bi]],
  cLat: [['Sternocleidomastoid muscle', gl], ['Scalenus anterior muscle', gl], ['Scalenus medius muscle', gl], ['Splenius capitis muscle', gl], ['Levator scapulae', gl], ['Descending part of trapezius muscle', gl], ['Longissimus capitis muscle', gl], ['Rectus lateralis capitis muscle', gl]],
  cRot: [['Sternocleidomastoid muscle', ge], ['Descending part of trapezius muscle', ge], ['Semispinalis colli muscle', ge], ['Splenius capitis muscle', gl], ['Splenius colli muscle', gl], ['Obliquus inferior capitis muscle', gl], ['Rectus posterior major capitis muscle', gl], ['Longissimus capitis muscle', gl]],
  tFlex: [['Rectus abdominis muscle', bi], ['External abdominal oblique muscle', bi], ['Internal abdominal oblique muscle', bi]],
  tExt: [['Iliocostalis thoracis muscle', bi], ['Longissimus thoracis muscle', bi], ['Spinalis thoracis muscle', bi], ['Semispinalis thoracis muscle', bi], ['Multifidus thoracis muscle', bi], ['Rotatores', bi]],
  tLat: [['External abdominal oblique muscle', gl], ['Internal abdominal oblique muscle', gl], ['Iliocostalis thoracis muscle', gl], ['Longissimus thoracis muscle', gl], ['Multifidus thoracis muscle', gl]],
  tRot: [['External abdominal oblique muscle', ge], ['Internal abdominal oblique muscle', gl], ['Multifidus thoracis muscle', ge], ['Rotatores', ge], ['Semispinalis thoracis muscle', ge]],
  lFlex: [['Rectus abdominis muscle', bi], ['External abdominal oblique muscle', bi], ['Internal abdominal oblique muscle', bi], ['Psoas major', bi]],
  lExt: [['Iliocostalis lumborum muscle', bi], ['Longissimus thoracis muscle', bi], ['Multifidus lumborum muscle', bi]],
  lLat: [['Quadratus lumborum muscle', gl], ['External abdominal oblique muscle', gl], ['Internal abdominal oblique muscle', gl], ['Iliocostalis lumborum muscle', gl]],   // Psoas major: kartında yan yazılı değil (yalnız 'einseitig'), listelenmedi
  lRot: [['External abdominal oblique muscle', ge], ['Internal abdominal oblique muscle', gl], ['Multifidus lumborum muscle', ge]],
};
const KW = { Flex: /Flexion|Vorbeugen|Vorneigen|Aufrichten des Rumpfes/, Ext: /Extension|Reklination|Aufrichtung/, Lat: /Lateralflexion|Neigung/, Rot: /Rotation|Drehung/ };
const MOVES = [
  ['cFlex', 'c', 'Flexion (Inklination)', 'Başı ve boynu öne eğme (HWS fleksiyonu)', { cFlex: 45 }, { cFlex: 0 }],
  ['cExt', 'c', 'Extension (Reklination)', 'Başı ve boynu geriye eğme (HWS ekstansiyonu)', { cFlex: -45 }, { cFlex: 0 }],
  ['cLat', 'c', 'Lateralflexion rechts', 'Başı sağa yatırma (HWS lateral fleksiyonu)', { cLat: 45 }, { cLat: 0 }],
  ['cRot', 'c', 'Rotation rechts', 'Başı sağa döndürme (yarısı C1/C2 eklemlerinde)', { cRot: 80 }, { cRot: 0 }],
  ['tFlex', 't', 'Flexion', 'Göğüs omurgasını öne bükme (BWS)', { tFlex: 35 }, { tFlex: 0 }],
  ['tExt', 't', 'Extension', 'Göğüs omurgasını geriye bükme (BWS)', { tFlex: -25 }, { tFlex: 0 }],
  ['tLat', 't', 'Lateralflexion rechts', 'Göğüs omurgasını sağa eğme (BWS)', { tLat: 20 }, { tLat: 0 }],
  ['tRot', 't', 'Rotation rechts', 'Göğüs omurgasını sağa döndürme (BWS)', { tRot: 40 }, { tRot: 0 }],
  ['lFlex', 'l', 'Flexion', 'Bel omurgasını öne bükme (LWS)', { lFlex: 50 }, { lFlex: 0 }],
  ['lExt', 'l', 'Extension', 'Bel omurgasını geriye bükme (LWS)', { lFlex: -30 }, { lFlex: 0 }],
  ['lLat', 'l', 'Lateralflexion rechts', 'Bel omurgasını sağa eğme (LWS)', { lLat: 20 }, { lLat: 0 }],
  ['lRot', 'l', 'Rotation rechts', 'Bel omurgasını sağa döndürme (LWS; çok az: faset eklemleri sagittal)', { lRot: 10 }, { lRot: 0 }],
].map(([key, group, de, tr, set, from]) => {
  const kind = key.slice(1), textbook = TB[key].map(([n, side]) => {
    const it = items.get(n), f = mus[n]?.f_de || '';
    if (!it) fail(`${key}: kas modelde yok: ${n}`);
    else if (!KW[kind].test(f)) fail(`${key}: ${n} kas kartının Funktion satırında hareket geçmiyor: ${f}`);
    else if (side === ge && !/Gegenseite/.test(f)) fail(`${key}: ${n}: "Gegenseite" kas kartında yok`);
    else if (side === gl && !/gleichen Seite/.test(f)) fail(`${key}: ${n}: "gleiche Seite" kas kartında yok`);
    return { n, la: it?.la || n, de: it?.de || '', side };
  });
  for (const [k, v] of Object.entries(set)) if (v < K.RANGES[k][0] || v > K.RANGES[k][1]) fail(`${key}: hedef sınırın dışında`);
  return { key, group, de, tr, set, from, textbook };
});
say(`  hareketler: ${MOVES.length}; ders kitabı kası ${MOVES.reduce((t, m) => t + m.textbook.length, 0)} satır (muscles.json Funktion satırıyla denetlendi)`);

const outJ = {
  v: 2, note: 'motion-spine-build.mjs ile üretildi (adım 2: kemikler katı, gövde ve boyun kasları deri ağırlıklarıyla); elle değiştirmeyin',
  segments: SEG.map((k, i) => ({ key: k, parent: i ? SEG[i - 1] : null, ids: i ? segIds[k] : [], label: i ? K.SHARE[k].label : null })),
  joints: { centre: provisional().joints.centre, axes: provisional().joints.axes, headPt: R4(headPt) },
  attach: { sternum: ATT.STERNUM, girdle: ATT.GIRDLE, larynx: ATT.LARYNX, ribs: 'Costa n -> Tn' },
  rest: Object.fromEntries(K.COORDS.map(k => [k, 0])),
  skin: { file: 'models/motion-spine.bin', bytesPerVertex: 9, bytes: BIN.length, level: { taper: TAPER, rigid: RIGID, eps: EPS, smoothMix: SMOOTH_MIX }, parts: [...skinParts, ...jparts] },
  movements: MOVES,
};
if (!process.argv.includes('--dry') && !fails.length) { const s = JSON.stringify(outJ); fs.writeFileSync('public/data/motion-spine.json', s); fs.writeFileSync('public/models/motion-spine.bin', BIN); say('  yazıldı: public/models/motion-spine.bin (' + (BIN.length / 1024).toFixed(1) + ' KB)'); say(`  yazıldı: public/data/motion-spine.json (${(s.length / 1024).toFixed(1)} KB)`); }
say(fails.length ? `\n${fails.length} hata` : '\nhata yok');
process.exitCode = fails.length ? 1 : 0;
