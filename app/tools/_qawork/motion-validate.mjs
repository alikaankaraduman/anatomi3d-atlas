// Kol hareketi kipinin EKRANSIZ doğrulaması (SPEC.md bölüm 2 sonu). Salt okur; uygulamayı değiştirmez.
// Kolu src/motion-kin.js ile motion.json'daki her hareketin sonuna (ve uç aralıklara) sokar, deri parçalarını
// motion-arm.bin ağırlıklarıyla CPU'da taşır ve yazdırır:
//   (0) dinlenme = birim; ikili kuaterniyon sürekliliği (karışan segment çiftlerinin bağıl dönmesi, yol boyunca sıçrama)
//   (a) eklem uyumu: içbükey yüzün dinlenmedeki temas köşelerinin karşı kemiğe işaretli uzaklığı, aralıklar boyunca
//   (b) skapulanın göğüs kafesine uzaklığı (gerçek kaburga + omur ağları; alt açı, spina kökü, mediyal kenar)
//   (c) uç duruşlarda parça başına kenar uzaması (yırtılma / çökme)
//   (d) her hareket için en çok kısalan kaslar ve ders kitabı ana kasları (kısalmayan her biri işaretli)
// Deri karışımı: İKİLİ KUATERNİYON (modülün blend kuralı; gölgelendirici de aynısını yapacak). Neden: ön kol kasları
// pronasyonda 170 dereceye kadar burulur, doğrusal karışım orada hacmi yok eder; (c) sonundaki karşılaştırma satırı
// bunu sayıyla gösterir.
// Çalıştırma: node tools/_qawork/motion-validate.mjs [--out=<dosya>] [--fit=cx,cy,cz,rx,ry,rz] [--tune=<json>] [--all]
//   --out   çıktının yazılacağı dosya (varsayılan data/work/motion/validate-1.txt; "-" = yazma)
//   --fit / --tune  thoraxFit ya da tune'u yalnız bu koşu için değiştirir (deneme)
//   --all   (c) içinde bütün eklem parçalarını da listeler
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene } from '../scene.mjs';
import * as K from '../../src/motion-kin.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(APP);
const argv = process.argv.slice(2), arg = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const OUT = arg('out') ?? '../data/work/motion/validate-1.txt';
const lines = [], say = (s = '') => { lines.push(s); console.log(s); };
const f1 = v => (v >= 0 ? '+' : '') + v.toFixed(1), r2 = v => v.toFixed(2), short = n => n.replace(/ muscle| of hand/g, '');

const data = JSON.parse(fs.readFileSync('public/data/motion.json', 'utf8'));
if (arg('fit')) { const v = arg('fit').split(',').map(Number); data.thoraxFit = { c: v.slice(0, 3), r: v.slice(3, 6) }; }
if (arg('tune')) data.tune = JSON.parse(arg('tune'));
const bin = fs.readFileSync(path.join('public', data.skin.file));
const skinIds = new Set(data.skin.parts.map(s => s.id));
const { parts } = await loadScene({ files: ['bones', 'joints', 'muscles'], keep: it => (it.id[0] === 'b' ? it.sub !== 'attach' : skinIds.has(it.id)) });
const byId = new Map(parts.map(p => [p.id, p]));
const model = K.createModel(data), o = K.createFk(model), rest = K.restPose(model);
const segIdx = Object.fromEntries(data.segments.map((s, i) => [s.key, i]));
const segParts = Object.fromEntries(data.segments.map(s => [s.key, s.ids.map(id => byId.get(id))]));
const pose = set => K.clampPose(model, { ...rest, ...set });
const setFk = q => K.fk(model, q, o);
const lbl = q => K.COORDS.filter(k => Math.abs(q[k] - rest[k]) > 1e-6).map(k => `${k} ${Math.round(q[k])}`).join(', ') || 'dinlenme';

say(`motion-validate  ${new Date().toISOString()}  motion.json v${data.v}, ${data.skin.parts.length} deri parçası, .bin ${bin.length} bayt`);
say(`dinlenme: ${JSON.stringify(rest)}`);
say(`thoraxFit c ${JSON.stringify(data.thoraxFit?.c)} r ${JSON.stringify(data.thoraxFit?.r)}; tune ${JSON.stringify(model.tune)}; aralıklar ${JSON.stringify(model.ranges)}`);
for (const w of model.warnings || []) say('  uyarı (motion-kin): ' + w);
for (const w of model.notes || []) say('  not (motion-kin): ' + w);

// ---------- yardımcılar: birleşik yüzey + işaretli uzaklık ----------
const tv = new THREE.Vector3(), hit = {}, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
const ray = new THREE.Ray(), RAYDIR = [new THREE.Vector3(0.36, 0.48, 0.8), new THREE.Vector3(-0.6, 0.64, -0.48), new THREE.Vector3(0.28, -0.96, 0)];
function surf(list) {
  let nv = 0, ni = 0; for (const p of list) { nv += p.P.length / 3; ni += p.I.length; }
  const P = new Float32Array(nv * 3), I = new Uint32Array(ni), own = []; let vo = 0, io = 0;
  for (const p of list) { P.set(p.P, vo * 3); for (let k = 0; k < p.I.length; k++) I[io + k] = p.I[k] + vo; own.push([vo, p.n]); vo += p.P.length / 3; io += p.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1));
  const bvh = new MeshBVH(g), J = g.index.array;   // MeshBVH indis dizisini yerinde yeniden sıralar: yüzleri ondan oku
  // x noktasının yüzeye işaretli uzaklığı (en yakın yüzün normaline göre; içerisi eksi); want: o yüzün parçası da
  return (x, want) => {
    bvh.closestPointToPoint(tv.set(x[0], x[1], x[2]), hit);
    const f = hit.faceIndex, i0 = J[3 * f], i1 = J[3 * f + 1], i2 = J[3 * f + 2];
    A.fromArray(P, 3 * i0); B.fromArray(P, 3 * i1); C.fromArray(P, 3 * i2);
    N.copy(B).sub(A).cross(C.sub(A));
    let d = hit.distance;
    // normal "içeride" diyorsa ışın paritesiyle doğrula (ince çıkıntıların kenarında en yakın yüzün normali yanıltır)
    if (N.dot(tv.sub(hit.point)) < 0) {
      let odd = 0;
      for (const dir of RAYDIR) { ray.origin.set(x[0], x[1], x[2]); ray.direction.copy(dir); if (bvh.raycast(ray, THREE.DoubleSide).length % 2 === 1) odd++; }
      if (odd >= 2) d = -d;
    }
    if (!want) return d;
    let name = own[0][1]; for (const [v0, n] of own) if (i0 >= v0) name = n;
    return [d, name];
  };
}
// katı 4x4 (sütun sıralı) dönüşümün tersi
const inv = m => { const q = new Float64Array(16); q[0] = m[0]; q[1] = m[4]; q[2] = m[8]; q[4] = m[1]; q[5] = m[5]; q[6] = m[9]; q[8] = m[2]; q[9] = m[6]; q[10] = m[10];
  q[12] = -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]); q[13] = -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]); q[14] = -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]); q[15] = 1; return q; };
const vertsOf = list => { const v = []; for (const p of list) for (let i = 0; i < p.P.length; i += 3) v.push([p.P[i], p.P[i + 1], p.P[i + 2]]); return v; };
const named = (re, sd) => parts.filter(p => p.id[0] === 'b' && re.test(p.n) && (sd === undefined || (p.sd || '') === sd));

// ---------- deri parçaları ----------
const triArea = (P, a, b, c) => { const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; };
const pairSet = new Map();   // bir köşede birlikte geçen segment çiftleri -> köşe sayısı
const skins = data.skin.parts.map(s => {
  const p = byId.get(s.id), n = s.verts;
  if (!p || p.P.length / 3 !== n) throw new Error('parça yok ya da köşe sayısı farklı: ' + s.n);
  const cl = { n, P: new Float64Array(p.P), I: new Uint8Array(4 * n), W: new Float64Array(4 * n), out: new Float64Array(3 * n) };
  for (let v = 0; v < n; v++) {
    const act = [];
    for (let j = 0; j < 4; j++) { const ix = bin[s.offset + 9 * v + j], w = bin[s.offset + 9 * v + 4 + j]; cl.I[4 * v + j] = ix; cl.W[4 * v + j] = w / 255; if (w > 0) act.push(ix); }
    for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) { const k = Math.min(act[a], act[b]) + '-' + Math.max(act[a], act[b]); pairSet.set(k, (pairSet.get(k) || 0) + 1); }
  }
  const E = new Set(), I = p.I; for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; if (a !== b) E.add(a < b ? a * 131072 + b : b * 131072 + a); }
  const edges = new Uint32Array(E.size * 2); let q = 0; for (const e of E) { edges[q++] = Math.floor(e / 131072); edges[q++] = e % 131072; }
  const rl = new Float64Array(E.size); for (let e = 0; e < E.size; e++) { const a = edges[2 * e] * 3, b = edges[2 * e + 1] * 3; rl[e] = Math.hypot(p.P[a] - p.P[b], p.P[a + 1] - p.P[b + 1], p.P[a + 2] - p.P[b + 2]); }
  return { s, p, cl, edges, rl, tris: I.length / 3, line: s.line ? K.compileLine(model, s.line) : null, ends: s.ends ? K.compileLine(model, s.ends) : null };
});
function stretch(sk, dq = true) {
  const P = K.skinLine(o, sk.cl, sk.cl.out, dq), r = new Float64Array(sk.rl.length); let long = 0, shrt = 0, cnt = 0;
  for (let e = 0; e < r.length; e++) { if (!(sk.rl[e] > 1e-6)) { r[e] = 1; continue; } const a = sk.edges[2 * e] * 3, b = sk.edges[2 * e + 1] * 3; r[e] = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]) / sk.rl[e]; cnt++; if (r[e] > 2) long++; if (r[e] < 0.5) shrt++; }
  const s = Float64Array.from(r).sort(), q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  let flat = 0; const I = sk.p.I, R0 = sk.p.P;
  for (let t = 0; t < I.length; t += 3) { const a0 = triArea(R0, I[t] * 3, I[t + 1] * 3, I[t + 2] * 3); if (a0 > 1e-8 && triArea(P, I[t] * 3, I[t + 1] * 3, I[t + 2] * 3) / a0 < 0.05) flat++; }
  return { p1: q(0.01), p99: q(0.99), max: s[s.length - 1], long: long / Math.max(1, cnt), shrt: shrt / Math.max(1, cnt), flat: flat / Math.max(1, sk.tris) };
}
const lens = () => skins.map(sk => (sk.line ? [K.lineLength(o, sk.line), sk.ends ? K.lineLength(o, sk.ends) : NaN] : null));
const KEY = {};   // sonuç özeti için anahtar sayılar

// ---------- (0) dinlenme ve ikili kuaterniyon yarıküresi ----------
say('\n===== (0) dinlenme duruşu ve ikili kuaterniyon sürekliliği =====');
setFk(rest);
{ let dev = 0, dl = 0, dm = 0;
  for (const sk of skins) { const P = K.skinLine(o, sk.cl); for (let k = 0; k < P.length; k++) dev = Math.max(dev, Math.abs(P[k] - sk.p.P[k])); if (sk.line) dl = Math.max(dl, Math.abs(K.lineLength(o, sk.line) - sk.s.L0)); }
  for (let k = 0; k < o.mats.length; k++) dm = Math.max(dm, Math.abs(o.mats[k] - (k % 16 % 5 === 0 ? 1 : 0)));
  say(`  matrislerin birimden sapması ${dm.toExponential(1)}; deri köşelerinin sapması ${dev.toExponential(1)} cm; |çizgi boyu - L0| en çok ${dl.toFixed(3)} cm`);
  KEY.rest = Math.max(dm, dev); }
{ // İkili kuaterniyonların işareti fk içinde zincir boyunca seçilir (duruşun sürekli işlevi) ve karışımda köşe başına
  // işaret çevrilmez. Burada ölçülen: (1) rastgele (tohumlu) 30000 izinli duruşta birlikte karışan her segment çiftinin
  // gerçek kuaterniyonlarının İŞARETLİ iç çarpımı (cos(bağıl dönme / 2); -1'e yaklaşırsa karışım yozlaşır);
  // (2) 300 rastgele duruş çifti arasında 200 adımlı yolda bir adımda kuaterniyonun en büyük değişimi (işaret sıçrarsa 2 olur).
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const wide = { plane: [-180, 180], elev: [0, 180], rot: [-70, 95], girdleElev: [-10, 40], girdleProt: [-25, 25], elbow: [-10, 150], forearm: [-85, 85], wristFlex: [-60, 60], wristDev: [-25, 35] };
  const rndPose = snap => { const q = {}; for (const k of K.COORDS) q[k] = wide[k][0] + (snap ? Math.round(rnd()) : rnd()) * (wide[k][1] - wide[k][0]); return K.clampPose(model, q); };
  const pairs = [...pairSet.keys()].map(k => k.split('-').map(Number)), mn = pairs.map(() => 1), at = pairs.map(() => null);
  for (let it = 0; it < 30000; it++) {
    const c = rndPose(it % 3 === 0); setFk(c);
    pairs.forEach(([a, b], i) => { const Q = o.dq, d = Q[8 * a] * Q[8 * b] + Q[8 * a + 1] * Q[8 * b + 1] + Q[8 * a + 2] * Q[8 * b + 2] + Q[8 * a + 3] * Q[8 * b + 3]; if (d < mn[i]) { mn[i] = d; at[i] = { ...c }; } });
  }
  say('  birlikte karışan segment çiftleri (köşe sayısı; en küçük işaretli q1.q2; en büyük bağıl dönme):');
  let worst = 0;
  pairs.forEach(([a, b], i) => { const ang = 2 * Math.acos(Math.max(-1, Math.min(1, mn[i]))) * 180 / Math.PI, nm = data.segments[a].key + ' + ' + data.segments[b].key; worst = Math.max(worst, ang);
    say(`    ${nm.padEnd(22)} ${String(pairSet.get(a + '-' + b)).padStart(6)} köşe  q.q ${mn[i].toFixed(3).padStart(6)}  ${ang.toFixed(0).padStart(4)} derece${ang > 150 ? '  (180 üstü: karışım uzun yoldan gider ama sıçramaz) @ ' + lbl(at[i]) : ''}`); });
  KEY.dqMaxAngle = worst;
  let jump = 0, jumpAt = '', vj = 0; const prev = new Float64Array(o.dq.length), n = o.dq.length / 8;
  // aynı yollarda skapula + humerus karışan köşelerin (en riskli çift) bir adımdaki en büyük yer değiştirmesi
  const iS = segIdx.scapula, iH = segIdx.humerus, probe = [];
  for (const sk of skins) for (let v = 0; v < sk.cl.n && probe.length < 400; v += 7) { const I = sk.cl.I, Wt = sk.cl.W; let hs = 0, hh = 0; for (let j = 0; j < 4; j++) { if (Wt[4 * v + j] > 0.2 && I[4 * v + j] === iS) hs = 1; if (Wt[4 * v + j] > 0.2 && I[4 * v + j] === iH) hh = 1; } if (hs && hh) probe.push([sk, v]); }
  const pp = new Float64Array(3 * probe.length), tmp = [0, 0, 0];
  for (let it = 0; it < 300; it++) {
    const A0 = rndPose(it % 2 === 0), B0 = rndPose(it % 3 === 0);
    for (let st = 0; st <= 200; st++) {
      const c = K.lerpPose(model, A0, B0, st / 200); setFk(c);
      for (let i = 0; i < n; i++) { const d = Math.hypot(o.dq[8 * i] - prev[8 * i], o.dq[8 * i + 1] - prev[8 * i + 1], o.dq[8 * i + 2] - prev[8 * i + 2], o.dq[8 * i + 3] - prev[8 * i + 3]); if (st > 0 && d > jump) { jump = d; jumpAt = data.segments[i].key + ' @ ' + lbl(c); } }
      probe.forEach(([sk, v], i) => { const w = []; for (let j = 0; j < 4; j++) if (sk.cl.W[4 * v + j] > 0) w.push([sk.cl.I[4 * v + j], sk.cl.W[4 * v + j]]); K.skinPoint(o, [sk.cl.P[3 * v], sk.cl.P[3 * v + 1], sk.cl.P[3 * v + 2]], w, tmp); if (st > 0) vj = Math.max(vj, Math.hypot(tmp[0] - pp[3 * i], tmp[1] - pp[3 * i + 1], tmp[2] - pp[3 * i + 2])); pp[3 * i] = tmp[0]; pp[3 * i + 1] = tmp[1]; pp[3 * i + 2] = tmp[2]; });
      prev.set(o.dq);
    }
  }
  say(`  süreklilik: 300 yol x 200 adım; bir adımda kuaterniyonun en büyük değişimi ${jump.toFixed(3)} (${jumpAt}); skapula + humerus karışan ${probe.length} köşede bir adımda en büyük yer değiştirme ${vj.toFixed(2)} cm`);
  KEY.dqJump = jump; KEY.vJump = vj; }

// ---------- (a) eklem uyumu ----------
say('\n===== (a) eklem uyumu: içbükey yüzün dinlenmedeki temas köşelerinin karşı kemiğe işaretli uzaklığı (cm) =====');
say('  Baş merkezi (GH), AC ve SC noktaları ile dirsek / ön kol / el bileği eksenleri kinematikte KURULUŞ gereği yerinde kalır (aralık 0);');
say('  burada ölçülen, kemik YÜZEYLERİNİN birbirine göre durumudur (küresel / silindirik olmayan yüzey, çıkıntıların çarpması).');
const midY = (data.joints.forearm.p[1] + data.joints.forearm.q[1]) / 2;
const thSC = named(/^(Manubrium of sternum|Costal cartilage of first rib|First rib)$/).filter(p => (p.sd || '') !== 'r');
const JP = [   // [ad, temas kümesinin segmenti, karşı yüzeyin segmenti (ya da göğüs parçaları), süzgeç]
  ['SC   klavikula ucu -> manubrium / 1. kaburga', 'clavicle', thSC, null],
  ['AC   akromiyon -> klavikula', 'scapula', 'clavicle', null],
  ['GH   glenoid -> humerus başı', 'scapula', 'humerus', null],
  ['humeroulnar   ulna çentiği -> troklea', 'ulna', 'humerus', null],
  ['humeroradial  radius başı -> kapitulum', 'radius', 'humerus', null],
  ['prox. radioulnar  ulna çentiği -> radius başı', 'ulna', 'radius', x => x[1] > midY],
  ['dist. radioulnar  radius çentiği -> ulna başı', 'radius', 'ulna', x => x[1] < midY],
  ['radiokarpal   radius alt yüzü -> proksimal sıra', 'radius', 'carpProx', x => x[1] < midY],
  ['mediokarpal   proksimal sıra -> distal sıra', 'carpProx', 'hand', null]
].map(([name, a, b, filt]) => {
  const sd = surf(typeof b === 'string' ? segParts[b] : b);
  let all = vertsOf(segParts[a]); if (filt) all = all.filter(filt);
  const d = all.map(x => sd(x)); let dmin = Infinity; for (const v of d) if (v < dmin) dmin = v;
  let set = all.filter((x, i) => d[i] <= Math.max(dmin, 0) + 0.25);
  if (set.length > 400) { const st = set.length / 400; set = Array.from({ length: 400 }, (_, i) => set[Math.floor(i * st)]); }
  return { name, a: segIdx[a], b: typeof b === 'string' ? segIdx[b] : 0, sd, set, n: set.length };
});
const t3 = [0, 0, 0], u3 = [0, 0, 0];
function gapOf(j) { const ma = o.mats.subarray(16 * j.a, 16 * j.a + 16), mb = inv(o.mats.subarray(16 * j.b, 16 * j.b + 16)); let sum = 0, mn = Infinity;
  for (const x of j.set) { K.transformPoint(ma, x, t3); K.transformPoint(mb, t3, u3); const d = j.sd(u3); sum += d; if (d < mn) mn = d; } return [sum / j.n, mn]; }
const sweepA = [];
for (let e = 0; e <= 180; e += 15) sweepA.push({ plane: 0, elev: e });
for (let e = 0; e <= 170; e += 17) sweepA.push({ plane: 90, elev: e });
for (let e = 30; e <= 180; e += 30) sweepA.push({ plane: 30, elev: e });
sweepA.push({ plane: -90, elev: 20 }, { plane: -90, elev: 40 }, { plane: 140, elev: 40 }, { plane: 180, elev: 40 });
for (const r of [-60, -30, 30, 60, 95]) sweepA.push({ rot: r });
sweepA.push({ plane: 0, elev: 90, rot: 70 }, { plane: 0, elev: 90, rot: -70 }, { plane: 90, elev: 90, rot: 70 }, { plane: 90, elev: 90, rot: -70 });
for (const g of [-10, 20, 40]) sweepA.push({ girdleElev: g });
for (const g of [-25, -12, 12, 25]) sweepA.push({ girdleProt: g });
sweepA.push({ plane: 0, elev: 170, girdleElev: 40 }, { plane: 90, elev: 170, girdleProt: 25 }, { plane: 0, elev: 120, girdleProt: -25 });
for (let e = -10; e <= 150; e += 20) sweepA.push({ elbow: e });
for (let f = -85; f <= 85; f += 17) sweepA.push({ forearm: f }, { elbow: 90, forearm: f });
for (let w = -60; w <= 60; w += 20) sweepA.push({ wristFlex: w });
for (const w of [-25, -12, 12, 24, 35]) sweepA.push({ wristDev: w });
sweepA.push({ wristFlex: 60, wristDev: 35 }, { wristFlex: -60, wristDev: -25 }, { elbow: 150, forearm: 85, wristFlex: 60 });
setFk(rest); const gap0 = JP.map(gapOf);
const gst = JP.map((j, i) => ({ lo: 0, hi: 0, loAt: '', hiAt: '', pen: gap0[i][1], penAt: 'dinlenme' }));
for (const s of sweepA) { const q = pose(s); setFk(q); JP.forEach((j, i) => { const [m, mn] = gapOf(j), d = m - gap0[i][0], g = gst[i]; if (d < g.lo) { g.lo = d; g.loAt = lbl(q); } if (d > g.hi) { g.hi = d; g.hiAt = lbl(q); } if (mn < g.pen) { g.pen = mn; g.penAt = lbl(q); } }); }
say(`  ${sweepA.length} duruş. Sütunlar: köşe sayısı | dinlenmede ortalama aralık (en küçük) | ortalama aralığın değişimi en az .. en çok | en küçük işaretli uzaklık (eksi = iç içe)`);
KEY.gap = { v: 0 }; KEY.pen = { v: 0 };
JP.forEach((j, i) => { const g = gst[i], w = Math.abs(g.lo) > g.hi ? [g.lo, g.loAt] : [g.hi, g.hiAt];
  if (Math.abs(w[0]) > Math.abs(KEY.gap.v)) KEY.gap = { v: w[0], name: j.name, at: w[1] };
  if (g.pen < KEY.pen.v) KEY.pen = { v: g.pen, name: j.name, at: g.penAt };
  say(`  ${j.name.padEnd(50)} ${String(j.n).padStart(4)} | ${r2(gap0[i][0])} (${r2(gap0[i][1])}) | ${f1(g.lo * 10) + ' mm'} @ ${g.loAt || '-'} .. ${f1(g.hi * 10) + ' mm'} @ ${g.hiAt || '-'} | ${r2(g.pen)} @ ${g.penAt}`); });

// ---------- (b) skapula - göğüs kafesi ----------
say('\n===== (b) skapulanın göğüs kafesine uzaklığı: gerçek kaburga (sol 1-10) ve omur ağlarına işaretli uzaklık (cm) =====');
const ribSd = surf([...named(/^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth) rib$/, 'l'), ...named(/^Vertebra (T|C)/)]);
const SJ = data.joints.scapula, scaV = vertsOf(segParts.scapula), mbP = SJ.mb || [];
const d0 = { ai: ribSd(SJ.ai), ts: ribSd(SJ.ts), mb: mbP.map(x => ribSd(x)) };
const sweepB = [['dinlenme', {}]];
for (const pl of [0, 30, 90]) for (let e = 30; e <= (pl === 90 ? 150 : 180); e += 30) sweepB.push([`plane ${pl} elev ${e}`, { plane: pl, elev: e }]);
sweepB.push(['plane 90 elev 170', { plane: 90, elev: 170 }], ['retro 40', { plane: -90, elev: 40 }], ['add (plane 140) 40', { plane: 140, elev: 40 }]);
for (const g of [-10, 20, 40]) sweepB.push([`girdleElev ${g}`, { girdleElev: g }]);
for (const g of [-25, -12, 12, 25]) sweepB.push([`girdleProt ${g}`, { girdleProt: g }]);
sweepB.push(['abd 170 + girdleElev 40', { plane: 0, elev: 170, girdleElev: 40 }], ['abd 90 + girdleElev 40', { plane: 0, elev: 90, girdleElev: 40 }], ['ante 170 + girdleProt 25', { plane: 90, elev: 170, girdleProt: 25 }], ['abd 120 + girdleProt -25', { plane: 0, elev: 120, girdleProt: -25 }]);
say(`  dinlenmede: alt açı ${r2(d0.ai)}, spina kökü ${r2(d0.ts)}, mediyal kenar ${d0.mb.map(r2).join(' / ')} (arada serratus anterior ve subscapularis var)`);
say('  duruş                         | alt açı Δ | spina kökü Δ | med. kenar Δ (en çok) | bütün skapula köşelerinde en küçük (parça); içeride köşe | düzeltme: kl. retr, kl. elev, sk. ER, sk. tilt, kuşak UR, kuşak tilt');
KEY.scapOff = { v: 0 }; KEY.scapPen = { v: Infinity }; KEY.scapOffArm = { v: 0 };
for (const [name, s] of sweepB) { const q = pose(s); setFk(q); const m = o.mats.subarray(16 * segIdx.scapula, 16 * segIdx.scapula + 16);
  const P = x => K.transformPoint(m, x, [0, 0, 0]), dai = ribSd(P(SJ.ai)) - d0.ai, dts = ribSd(P(SJ.ts)) - d0.ts;
  let dmb = 0; mbP.forEach((x, i) => { const d = ribSd(P(x)) - d0.mb[i]; if (Math.abs(d) > Math.abs(dmb)) dmb = d; });
  let mn = Infinity, who = '', neg = 0; for (const x of scaV) { K.transformPoint(m, x, t3); const d = ribSd(t3); if (d < 0) neg++; if (d < mn) { mn = d; who = ribSd(t3, true)[1]; } }
  const w = [dai, dts, dmb].reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0), armOnly = !('girdleElev' in s) && !('girdleProt' in s);
  if (Math.abs(w) > Math.abs(KEY.scapOff.v)) KEY.scapOff = { v: w, at: name };
  if (armOnly && Math.abs(w) > Math.abs(KEY.scapOffArm.v)) KEY.scapOffArm = { v: w, at: name };
  if (mn < KEY.scapPen.v) KEY.scapPen = { v: mn, at: name, who };
  say(`  ${name.padEnd(29)} | ${f1(dai).padStart(9)} | ${f1(dts).padStart(12)} | ${f1(dmb).padStart(21)} | ${r2(mn).padStart(6)} (${who}); ${String(neg).padStart(3)} | ${Array.from(o.corr).map(v => v.toFixed(0)).join(', ')}`); }

// ---------- (c) kenar uzaması ----------
say('\n===== (c) uç duruşlarda kenar uzaması (duruş / dinlenme), parça başına en kötü duruş =====');
const endPoses = [];
for (const mv of data.movements) { endPoses.push([mv.key, K.applySet(model, rest, mv.set)]); if (mv.from) endPoses.push([mv.key + ':başlangıç', K.applySet(model, rest, mv.from)]); }
endPoses.push(['dirsek 150 + pronasyon 85', pose({ elbow: 150, forearm: 85 })], ['abd 90 + iç rot 70', pose({ plane: 0, elev: 90, rot: 70 })], ['abd 90 + dış rot 70', pose({ plane: 0, elev: 90, rot: -70 })],
  ['ante 90 + protraksiyon 25', pose({ plane: 90, elev: 90, girdleProt: 25 })], ['abd 170 + elevasyon 40', pose({ plane: 0, elev: 170, girdleElev: 40 })], ['palmar 60 + ulnar 35 + pronasyon', pose({ wristFlex: 60, wristDev: 35, forearm: 85 })]);
say(`  ${endPoses.length} duruş: ${endPoses.map(e => e[0]).join(', ')}`);
say('  Ölçüler: p99 = kenarların %99 u bundan kısa; >2x = boyu iki katını aşan kenar payı; <0,5x = yarıdan kısa kenar payı; çöken = alanı %5 in altına düşen üçgen payı.');
say('  Hüküm: GERİLME = >2x payı %2 den çok ya da p99 > 2 (boy değişimi eklem kuşağında yoğunlaşıyor; ağ kopmaz, üçgenler uzar); PERDE = en uzun kenar 8 katını aşıyor (birkaç üçgen iki kemik arasında geriliyor);');
say('         ÇÖKME = çöken payı %1 den çok ya da <0,5x payı %5 den çok.');
const W = skins.map(() => ({ p99: 1, max: 1, long: 0, shrt: 0, flat: 0, at: '', lin: { long: 0, shrt: 0, flat: 0 } }));
for (const [name, q] of endPoses) { setFk(q); skins.forEach((sk, i) => { const x = stretch(sk), w = W[i];
  if (x.long > w.long || (x.long === w.long && x.p99 > w.p99)) w.at = name;
  w.p99 = Math.max(w.p99, x.p99); w.max = Math.max(w.max, x.max); w.long = Math.max(w.long, x.long); w.shrt = Math.max(w.shrt, x.shrt); w.flat = Math.max(w.flat, x.flat);
  const y = stretch(sk, false); w.lin.long = Math.max(w.lin.long, y.long); w.lin.shrt = Math.max(w.lin.shrt, y.shrt); w.lin.flat = Math.max(w.lin.flat, y.flat); }); }
const verdict = w => [(w.long > 0.02 || w.p99 > 2) ? 'GERİLME' : '', w.max > 8 ? 'PERDE' : '', (w.flat > 0.01 || w.shrt > 0.05) ? 'ÇÖKME' : ''].filter(Boolean).join(' + ') || 'tamam';
const pc = v => (100 * v).toFixed(1).padStart(5) + '%';
const row = (sk, w) => `    ${verdict(w).padEnd(25)} ${sk.s.n.padEnd(54)} p99 ${r2(w.p99).padStart(5)}  en büyük ${w.max.toFixed(1).padStart(5)}  >2x ${pc(w.long)}  <0,5x ${pc(w.shrt)}  çöken ${pc(w.flat)}  @ ${w.at}`;
KEY.tear = []; KEY.collapse = []; KEY.band = [];
for (const kind of ['muscle', 'joint']) {
  const idx = skins.map((sk, i) => i).filter(i => skins[i].s.kind === kind).sort((a, b) => W[b].long - W[a].long || W[b].p99 - W[a].p99);
  const bad = idx.filter(i => verdict(W[i]) !== 'tamam');
  say(`  -- ${kind === 'muscle' ? 'kaslar' : 'eklem parçaları'}: ${idx.length} parça, ${idx.length - bad.length} tamam, ${bad.length} dikkat --`);
  for (const i of (kind === 'muscle' || argv.includes('--all') ? idx : bad)) say(row(skins[i], W[i]));
  for (const i of bad) { const v = verdict(W[i]), e = { n: skins[i].s.n, kind, long: W[i].long, max: W[i].max, at: W[i].at }; if (v.includes('GERİLME')) KEY.tear.push(e); if (v.includes('ÇÖKME')) KEY.collapse.push(e); if (v.includes('PERDE')) KEY.band.push(e); }
}
{ const lim = k => (k === 'flat' ? 0.01 : 0.05), tot = k => skins.reduce((a, sk, i) => a + (W[i][k] > lim(k) ? 1 : 0), 0), totL = k => skins.reduce((a, sk, i) => a + (W[i].lin[k] > lim(k) ? 1 : 0), 0);
  say(`  karışım karşılaştırması (aynı ağırlıklar, aynı duruşlar): çöken üçgen payı %1 i aşan parça: ikili kuaterniyon ${tot('flat')}, doğrusal ${totL('flat')}; yarıdan kısa kenar payı %5 i aşan parça: ikili kuaterniyon ${tot('shrt')}, doğrusal ${totL('shrt')}`); }

// ---------- (d) hareket başına kısalan kaslar ve ders kitabı ----------
say('\n===== (d) hareket başına boy değişimi (hareketin başından sonuna, orta çizgi) ve ders kitabı ana kasları =====');
say('  İşaretler: KISALIR = sonda en az %2 kısa; (yolda) = sonda değil ama yol üzerinde en az %2 kısalıyor; nötr ! = %2 içinde; UZAR !! = sonda %2 den çok uzun.');
say('  Sütunlar: orta çizgi sonda % | yol boyunca en kısa % @ yolun kesri | düz çizgi (origo - insersiyo) sonda %');
KEY.tb = []; let tbAll = 0, tbOk = 0, tbMid = 0, tbStr = 0, tbEither = 0; const fails = [];
for (const mv of data.movements) {
  const start = K.applySet(model, rest, mv.from || {}), end = K.applySet(model, rest, mv.set);
  setFk(start); const La = lens(), Lmin = La.map(x => (x ? x[0] : 0)), at = La.map(() => 0);
  for (let q = 1; q <= 16; q++) { setFk(K.lerpPose(model, start, end, q / 16)); lens().forEach((x, i) => { if (x && x[0] < Lmin[i]) { Lmin[i] = x[0]; at[i] = q / 16; } }); }
  setFk(end); const Lb = lens();
  const rows = skins.map((sk, i) => (sk.line ? { n: sk.s.n, line: (Lb[i][0] / La[i][0] - 1) * 100, str: (Lb[i][1] / La[i][1] - 1) * 100, min: (Lmin[i] / La[i][0] - 1) * 100, at: at[i] } : null)).filter(Boolean);
  const sorted = [...rows].sort((a, b) => a.line - b.line), tb = new Set(mv.textbook || []);
  say(`\n  == ${mv.key}: ${mv.de}   ${lbl(start)} -> ${lbl(end)} ==`);
  say('    en çok kısalan: ' + sorted.slice(0, 6).map(r => `${tb.has(r.n) ? '*' : ''}${short(r.n)} ${f1(r.line)}`).join(', '));
  say('    en çok uzayan : ' + sorted.slice(-4).reverse().map(r => `${short(r.n)} ${f1(r.line)}`).join(', '));
  if (!tb.size) { say('    ders kitabı listesi yok'); continue; }
  let ok = 0, mid = 0; const miss = [...tb].filter(n => !rows.some(r => r.n === n));
  for (const r of rows.filter(r => tb.has(r.n))) { const st = r.line < -2 ? 'KISALIR ' : r.min < -2 ? '(yolda) ' : r.line > 2 ? 'UZAR !! ' : 'nötr  ! ';
    if (r.str < -2) tbStr++; if (r.str < -2 || r.line < -2) tbEither++;
    if (st === 'KISALIR ') ok++; else { if (st === '(yolda) ') mid++; fails.push(`${mv.key.padEnd(7)} ${st} ${r.n}  (son ${f1(r.line)} %, yolda ${f1(r.min)} % @ ${r.at.toFixed(2)}, düz çizgi ${f1(r.str)} %)`); }
    say(`    ${st} ${r.n.padEnd(54)} ${f1(r.line).padStart(6)} | ${f1(r.min).padStart(6)} @ ${r.at.toFixed(2)} | ${f1(r.str).padStart(6)}`); }
  for (const n of miss) say(`    YOK  !!  ${n} (deri parçaları arasında yok)`);
  const rank = sorted.slice(0, 6).filter(r => tb.has(r.n)).length;
  say(`    özet: ${ok} / ${tb.size - miss.length} ders kitabı kası sonda kısalıyor${mid ? `, ${mid} yalnız yolda` : ''}; ilk 6 kısalan arasında ${rank} ders kitabı kası`);
  KEY.tb.push(`${mv.key} ${ok}/${tb.size - miss.length}${mid ? '(+' + mid + ')' : ''}`); tbAll += tb.size - miss.length; tbOk += ok; tbMid += mid;
}

// ---------- özet ----------
say('\n===== ÖZET =====');
say(`  dinlenme sapması ${KEY.rest.toExponential(1)}; ikili kuaterniyon: karışan çiftlerde en büyük bağıl dönme ${KEY.dqMaxAngle.toFixed(0)} derece, bir adımda en büyük kuaterniyon değişimi ${KEY.dqJump.toFixed(3)} (sıçrama = 2), köşe yer değiştirmesi ${KEY.vJump.toFixed(2)} cm`);
say(`  (a) ortalama eklem aralığında en büyük değişim: ${f1(KEY.gap.v * 10)} mm, ${KEY.gap.name} @ ${KEY.gap.at}`);
say(`      en derin iç içe geçme: ${r2(-KEY.pen.v)} cm, ${KEY.pen.name} @ ${KEY.pen.at}`);
say(`  (b) skapula işaret noktalarının kaburgalara uzaklığında en büyük değişim: ${f1(KEY.scapOff.v)} cm @ ${KEY.scapOff.at}; yalnız kol yükseltmesinde ${f1(KEY.scapOffArm.v)} cm @ ${KEY.scapOffArm.at}`);
say(`      skapulanın kaburga / omura en küçük işaretli uzaklığı: ${r2(KEY.scapPen.v)} cm (${KEY.scapPen.who}) @ ${KEY.scapPen.at}`);
const names = a => a.map(e => `${short(e.n)} (${(100 * e.long).toFixed(0)}%, ${e.max.toFixed(0)}x)`).join(', ') || 'yok';
say(`  (c) GERİLME: kas ${KEY.tear.filter(e => e.kind === 'muscle').length} / 67, eklem parçası ${KEY.tear.filter(e => e.kind === 'joint').length} / 73; PERDE (en uzun kenar > 8x): ${KEY.band.length}; ÇÖKME: ${KEY.collapse.length}   (ad (>2x kenar payı, en uzun kenar))`);
say(`      gerilen kaslar: ${names(KEY.tear.filter(e => e.kind === 'muscle'))}`);
say(`      gerilen eklem parçaları: ${names(KEY.tear.filter(e => e.kind === 'joint'))}`);
say(`      çöken: ${names(KEY.collapse)}`);
say(`      perde: ${names(KEY.band)}`);
say(`  (d) ders kitabı: ${tbOk} / ${tbAll} sonda kısalıyor, ${tbMid} yalnız yolda, ${tbAll - tbOk - tbMid} kısalmıyor.  Hareket başına: ${KEY.tb.join(', ')}`);
say(`      karşılaştırma: düz çizgiyle (origo - insersiyo) ${tbStr} / ${tbAll}; iki ölçüden biriyle ${tbEither} / ${tbAll}`);
say('      kısalmayan ders kitabı kasları (orta çizgi):');
for (const f of fails) say('        ' + f);
if (OUT !== '-') { fs.writeFileSync(OUT, lines.join('\n') + '\n'); console.log('\nyazıldı: ' + path.resolve(OUT)); }
