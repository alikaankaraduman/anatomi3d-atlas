// Gövde ve baş-boyun hareketi verisi (küçük sürüm: kemikler ve tek segmentli eklem parçaları katı hareket eder, kaslar çizilmez).
// Sayılar ağlardan ölçülür; ders kitabı değerleri (segment ROM payları, sınırlar) src/motion-kin-spine.js içindedir.
// Çalıştırma (app/ içinde): node tools/motion-spine-build.mjs [--dry]   (public/data/motion-spine.json yazar; --dry yazmaz)
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
import { sub, add, mul, dot, cross, len, norm, DEG, mean, f2, verts } from './motion-geom.mjs';
import * as K from '../src/motion-kin-spine.js';

const fails = [];
const say = (s = '') => console.log(s);
const fail = s => { fails.push(s); say('  HATA: ' + s); };
const { meta, parts } = await loadScene({ files: ['bones', 'femalepelvis', 'joints', 'femalejoints'], keep: it => (it.s === 'bone' && it.sub !== 'attach') || it.s === 'joint' });
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
  v: 1, note: 'motion-spine-build.mjs ile üretildi (küçük sürüm: kemikler katı, kaslar çizilmez); elle değiştirmeyin',
  segments: SEG.map((k, i) => ({ key: k, parent: i ? SEG[i - 1] : null, ids: i ? segIds[k] : [], label: i ? K.SHARE[k].label : null })),
  joints: { centre: provisional().joints.centre, axes: provisional().joints.axes, headPt: R4(headPt) },
  attach: { sternum: ATT.STERNUM, girdle: ATT.GIRDLE, larynx: ATT.LARYNX, ribs: 'Costa n -> Tn' },
  rest: Object.fromEntries(K.COORDS.map(k => [k, 0])),
  skin: { file: null, parts: jparts },
  movements: MOVES,
};
if (!process.argv.includes('--dry') && !fails.length) { const s = JSON.stringify(outJ); fs.writeFileSync('public/data/motion-spine.json', s); say(`  yazıldı: public/data/motion-spine.json (${(s.length / 1024).toFixed(1)} KB)`); }
say(fails.length ? `\n${fails.length} hata` : '\nhata yok');
process.exitCode = fails.length ? 1 : 0;
