// Kas yapisma yerleri (origo ve insersiyo): Z-Anatomy iskelet dosyasindaki yamalar. Adlari "<kas>.o[N]<r|l>" (origo) ve
// "<kas>.e[N]<r|l>" (insersiyo; e = son); N ayni kasin birden cok alanini numaralar (ornegin dort parmaga giden
// tendonlar). Her yama kemigin ustunde ~0.05 cm kalinliginda kapali ince bir kabuktur; bones kaynagi bunlari atlar.
// convert.mjs icin THREE sahnesi uretir:
//  - Kaynak verideki hatalar once duzeltilir (2026-11-19 incelemesi, Gray's / Prometheus ile karsilastirildi):
//    * SWAP: butun yamalarinda origo ile insersiyo ters etiketlenmis kaslar.
//    * CORR: tek tek yamalar ("<kas>|<o|e><N>", taraftan bagimsiz): yeni tur, yeni kas adi, atilacak yama ya da kemikten
//      uzak (havada duran) ucgenlerin atilmasi. Trapeziusun inen ve cikan parcasinin adlari kaynakta yer degistirmistir
//      (kas parcalari icin convert.mjs FIX tablosuna da bakin).
//    * Taraf yamanin adindan degil konumundan alinir (x > 0.3 sol, x < -0.3 sag; ortadakiler adindaki gibi): 30 parcanin
//      adindaki taraf yanlisti.
//  - Ayni kas, tur ve taraftaki yamalar tek parcada birlesir ("<kas> (origin).r"); tiklaninca kasin butun origo ya da
//    insersiyo alanlari birlikte parlar. Gruplar: Muscle attachments > Origins | Insertions.
//  - Her kose, yakindaki kemiklerin (yamanin ebeveyni ve 1 cm icindeki butun kemikler) en yakin ucgeninin dis normali boyunca
//    OFFSET cm disa itilir; kemik sadelestirmesi (en cok 0.03 cm) yamayi ortmesin. Hala bir kemigin icinde kalan kose
//    disari cikana kadar itilir.
//  - Kadin bedeninde pelvis (kalca kemigi, sakrum, koksiks) HRA kadin pelvisiyle degisir. Pelvise degen bir alani olan her
//    parca butunuyle which = 'male' (erkege ozgu) ve 'female' (kopyasi) kaynaklarina gider; 'shared' geri kalanidir. Kadin
//    kopyasinda pelvis yamalari tools/pelvis-warp.json alaniyla tasinir, her kose kadin kemiginin en yakin noktasina kendi
//    yuksekligiyle oturtulur, yer degistirme yama uzerinde yumusatilir (kabuk katlanmasin) ve iceride kalanlar disari itilir.
import fs from 'node:fs';
import { MeshBVH } from 'three-mesh-bvh';
import { THREE, loadFBX } from './fbxnode.mjs';
import { origName, extract, isAttach } from './geom.mjs';
import { makeField } from './femalejoints.mjs';
import { loadHRA } from './hra.mjs';

const RE = /^(.*?)\.([oe])(\d*)([rl])$/;
const PELVIS = /^(Hip bone|Sacrum|Coccyx)$/;
const OFFSET = 0.04, NEAR = 1.0, FAR = 0.3;
const DIRS = [new THREE.Vector3(0.577, 0.611, 0.542).normalize(), new THREE.Vector3(-0.49, -0.62, 0.61).normalize()];
const SWAP = new Set(['Serratus anterior muscle', 'Pectoralis minor muscle', 'Subclavius muscle', 'Thyrohyoid muscle', 'Transverse head of adductor hallucis',
  'Scalenus anterior muscle', 'Scalenus medius muscle', 'Scalenus posterior muscle', 'Longus capitis muscle', 'Rectus anterior capitis muscle',
  'Rectus lateralis capitis muscle', 'Rectus posterior major capitis muscle', 'Rectus posterior minor capitis muscle',
  'Obliquus superior capitis muscle', 'Obliquus inferior capitis muscle']);
const O = 'origin', I = 'insertion';
const CORR = {
  // trapezius: occipital ve klavikula yamalari inen parcanin, spina scapulae ve akromion yamalari insersiyodur
  'Ascending part of trapezius muscle|e': { base: 'Descending part of trapezius muscle', kind: O },
  'Ascending part of trapezius muscle|o': { base: 'Descending part of trapezius muscle', kind: I },
  'Descending part of trapezius muscle|o': { base: 'Ascending part of trapezius muscle', kind: I },
  'Transverse part of trapezius muscle|o': { kind: I },
  'Latissimus dorsi muscle|e': { kind: O },                     // angulus inferior scapulae: degisken origo lifleri; humerus yamasi yok
  'Sternocostal head of pectoralis major muscle|e': { kind: O }, 'Sternocostal head of pectoralis major muscle|e1': { kind: O },
  'Sternocostal head of pectoralis major muscle|e2': { kind: O },
  'Rectus abdominis muscle|o': { kind: I },                     // 5.-7. kostal kikirdaklar ve ksifoid
  'Rectus abdominis muscle|e': { dropFar: true, split: true },  // linea alba boyunca havada duran serit: yalniz kemige degen uclar kalir
  'External abdominal oblique muscle|o4': { kind: I }, 'External abdominal oblique muscle|o5': { kind: I, dropFar: true },
  'Internal abdominal oblique muscle|o': { kind: I }, 'Internal abdominal oblique muscle|o1': { kind: I },
  'Internal abdominal oblique muscle|o2': { kind: I }, 'Internal abdominal oblique muscle|o4': { kind: I },
  'Short head of biceps femoris|e': { kind: O },                // linea aspera
  'Adductor pollicis|e': { kind: O },                           // kapitatum: oblik basin origosu
  'Extensor hallucis longus|e': { base: 'Extensor hallucis brevis' },   // proksimal falanks tabani EHB insersiyosudur
  'Extensor carpi ulnaris|e': { drop: true },                   // triquetrum uzerinde; gercek insersiyo 5. metakarp tabani
  'Lateral pterygoid muscle|o': { base: 'Medial pterygoid muscle' }, 'Lateral pterygoid muscle|o1': { base: 'Medial pterygoid muscle' },  // tuber maxillae: medial pterygoidin yuzeyel basi
  'Procerus muscle|e': { kind: O },                             // os nasale origodur; insersiyo glabella derisidir
  'Procerus muscle|o': { drop: true },
  'Trochanteric insertion|e': { base: 'Obturator internus and gemelli' },
};
for (const n of ['', '1', '2', '3', '4']) CORR[`Long plantar ligament|o${n}`] = { drop: true };   // bag; 1. metatarsal yamasi da yanlis
const baseName = s => s.trim().replace(/^\((.*)\)$/, '$1').trim();

function bvhOf(P, idx) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return new MeshBVH(g);
}
function weld(P, idx) {
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const map = new Map(), V = [], J = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const k = idx[i] * 3; const kk = key(P[k], P[k + 1], P[k + 2]); let id = map.get(kk); if (id === undefined) { id = V.length / 3; map.set(kk, id); V.push(P[k], P[k + 1], P[k + 2]); } J[i] = id; }
  return { P: Float32Array.from(V), idx: J };
}
const signedVolume = (P, idx) => { let s = 0; for (let t = 0; t < idx.length; t += 3) { const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3; s += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return s / 6; };
// en yakin ucgenin normali (BVH dizini yeniden siraladigi icin ucgen BVH'nin kendi dizininden okunur)
function faceNormal(bv, fi, out) {
  const I3 = bv.geometry.index.array, A = bv.geometry.attributes.position.array, t = fi * 3;
  const a = I3[t] * 3, b = I3[t + 1] * 3, c = I3[t + 2] * 3;
  const ux = A[b] - A[a], uy = A[b + 1] - A[a + 1], uz = A[b + 2] - A[a + 2], vx = A[c] - A[a], vy = A[c + 1] - A[a + 1], vz = A[c + 2] - A[a + 2];
  return out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
}
const ray = new THREE.Ray();
const insideOf = (bv, p) => DIRS.every(d => { ray.set(p, d); return bv.raycast(ray, THREE.DoubleSide).length % 2 === 1; });

export function loadAttach(which) {
  const root0 = loadFBX('../data/zanatomy/SkeletalSystem100.fbx'); root0.updateMatrixWorld(true);
  const patches = [], info = new Map();
  root0.traverse(o => {
    if (!o.isMesh) return;
    if (isAttach(origName(o))) patches.push(o);
    else if (o.geometry.attributes.position.count) info.set(o, { o, box: new THREE.Box3().setFromObject(o), name: origName(o).replace(/\.[rlg]$/, '').replace(/\.+$/, '').trim() });
  });
  // kemiklerin BVH'si ve dis yon isareti (kapali agin isaretli hacmi) ilk ihtiyacta kurulur
  const ready = b => { if (!b.bvh) { const e = extract(b.o); const w = weld(e.P, e.idx); b.bvh = bvhOf(w.P, w.idx); b.sign = signedVolume(w.P, w.idx) < 0 ? -1 : 1; } return b; };
  const v = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3(), hit = {};
  const stats = { patches: 0, dropped: 0, droppedTris: 0, sideFixed: 0, pushed: 0, stuck: 0 };

  // 1) duzeltme, taraf, en yakin kemik, disa itme; parca listesi (her yama ya da bolunmus yama parcasi)
  const pieces = [];
  for (const o of patches) {
    const m = RE.exec(origName(o).trim()); let base = baseName(m[1]); const key = `${base}|${m[2]}${m[3]}`;
    const c = CORR[key] ?? {}; if (c.drop) { stats.dropped++; continue; }
    let kind = (m[2] === 'o') !== SWAP.has(base) ? O : I; if (c.kind) kind = c.kind; if (c.base) base = c.base;
    const ex = extract(o); const w = weld(ex.P, ex.idx); const P = w.P, nv = P.length / 3;
    let cx = 0; for (let k = 0; k < P.length; k += 3) cx += P[k]; cx /= nv;
    const side = cx > 0.3 ? 'l' : cx < -0.3 ? 'r' : m[4]; if (side !== m[4]) stats.sideFixed++;
    // aday kemikler: ebeveyn + 1 cm icindekiler
    const pb = new THREE.Box3(); for (let k = 0; k < P.length; k += 3) pb.expandByPoint(v.set(P[k], P[k + 1], P[k + 2])); pb.expandByScalar(NEAR);
    const parent = info.get(o.parent); const cand = parent ? [parent] : [];
    for (const b of info.values()) if (b !== parent && b.box.intersectsBox(pb)) cand.push(b);
    cand.forEach(ready);
    const A = new Float32Array(P.length), H = new Float32Array(nv), B = new Int32Array(nv);
    for (let i = 0; i < nv; i++) {
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); let best = Infinity, bi = 0;
      for (let j = 0; j < cand.length; j++) { cand[j].bvh.closestPointToPoint(v, hit); if (hit.distance < best) { best = hit.distance; bi = j; faceNormal(cand[j].bvh, hit.faceIndex, n).multiplyScalar(cand[j].sign); } }
      A[i * 3] = n.x; A[i * 3 + 1] = n.y; A[i * 3 + 2] = n.z; H[i] = best; B[i] = bi;
    }
    // havada duran ucgenler (yalniz CORR'da isaretli yamalarda): en az bir kosesi kemikten FAR'dan uzak olanlar atilir
    let idx = w.idx;
    if (c.dropFar) { const keep = []; for (let t = 0; t < idx.length; t += 3) { if (Math.max(H[idx[t]], H[idx[t + 1]], H[idx[t + 2]]) <= FAR) keep.push(idx[t], idx[t + 1], idx[t + 2]); else stats.droppedTris++; } idx = Uint32Array.from(keep); }
    // disa it; hala bir kemigin icinde kalani disari cikana kadar it
    const P0 = Float32Array.from(P);
    for (let i = 0; i < nv; i++) {
      const k = i * 3; v.set(P[k] + A[k] * OFFSET, P[k + 1] + A[k + 1] * OFFSET, P[k + 2] + A[k + 2] * OFFSET); n.set(A[k], A[k + 1], A[k + 2]);
      let st = 0; while (st < 10 && cand.some(b => b.box.containsPoint(v) && insideOf(b.bvh, v))) { v.addScaledVector(n, 0.03); st++; }
      if (st) { stats.pushed++; if (st === 10) stats.stuck++; else v.addScaledVector(n, OFFSET); }
      P[k] = v.x; P[k + 1] = v.y; P[k + 2] = v.z;
    }
    // parcalara bol: rektus abdominisin serit ucu pubiste origo, ust ucu insersiyo; digerleri tek parca
    const pel = i => PELVIS.test(cand[B[i]]?.name ?? '');
    const triPel = t => pel(idx[t]) || pel(idx[t + 1]) || pel(idx[t + 2]);
    const parts = c.split ? [[O, t => triPel(t)], [I, t => !triPel(t)]] : [[kind, () => true]];
    for (const [k2, take] of parts) {
      const map = new Map(), PP = [], PS = [], AA = [], HH = [], PL = [], J = [];
      for (let t = 0; t < idx.length; t += 3) {
        if (!take(t)) continue;
        for (const i of [idx[t], idx[t + 1], idx[t + 2]]) {
          let j = map.get(i); if (j === undefined) { j = PP.length / 3; map.set(i, j); PP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); PS.push(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]); AA.push(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]); HH.push(H[i]); PL.push(pel(i)); }
          J.push(j);
        }
      }
      if (J.length) pieces.push({ base, kind: k2, side, P: Float32Array.from(PP), P0: Float32Array.from(PS), A: Float32Array.from(AA), H: Float32Array.from(HH), pelvic: PL, idx: J, anyPelvic: PL.some(Boolean) });
    }
    stats.patches++;
  }
  // 2) parca duzeyinde pelvis karari: bir alani pelviste olan kas-tur-taraf butunuyle erkek/kadin kaynagina gider
  const keyOf = p => `${p.base}|${p.kind}|${p.side}`;
  const pelvicKey = new Set(pieces.filter(p => p.anyPelvic).map(keyOf));
  const sel = pieces.filter(p => (which === 'shared') !== pelvicKey.has(keyOf(p)));
  if (!sel.length) throw new Error('kas yapisma yamasi yok: ' + which);

  // 3) kadin kopyasi: pelvis koseleri alanla tasinir, kadin kemigine oturtulur, yer degistirme yumusatilir, icerdekiler itilir
  if (which === 'female') {
    const field = makeField(JSON.parse(fs.readFileSync(new URL('./pelvis-warp.json', import.meta.url), 'utf8')));
    const fr = loadHRA('pelvis'); fr.updateMatrixWorld(true); const fparts = [];
    fr.traverse(o => { if (o.isMesh && PELVIS.test(origName(o).replace(/\.[rl]$/, '').trim())) fparts.push(extract(o)); });
    let nP = 0, nI = 0; for (const e of fparts) { nP += e.P.length; nI += e.idx.length; }
    const FP = new Float32Array(nP), FI = new Uint32Array(nI); let o2 = 0, oi = 0;
    for (const e of fparts) { FP.set(e.P, o2); for (let k = 0; k < e.idx.length; k++) FI[oi + k] = e.idx[k] + o2 / 3; o2 += e.P.length; oi += e.idx.length; }
    const female = bvhOf(FP, FI);
    for (const p of sel) {
      if (!p.anyPelvic) continue;
      const nv = p.P.length / 3, D = new Float32Array(p.P.length), NF = new Float32Array(p.P.length), W = new Float32Array(p.P.length);
      for (let i = 0; i < nv; i++) {
        const k = i * 3; if (!p.pelvic[i]) continue;   // pelvis disi koseler (ortak kemik) yerinde kalir
        const d = field(p.P0[k], p.P0[k + 1], p.P0[k + 2]); v.set(p.P0[k] + d[0], p.P0[k + 1] + d[1], p.P0[k + 2] + d[2]);
        female.closestPointToPoint(v, hit); faceNormal(female, hit.faceIndex, n); if (n.x * p.A[k] + n.y * p.A[k + 1] + n.z * p.A[k + 2] < 0) n.negate();
        const up = Math.min(p.H[i], 0.12) + OFFSET; q.copy(hit.point).addScaledVector(n, up);
        W[k] = v.x; W[k + 1] = v.y; W[k + 2] = v.z; D[k] = q.x - v.x; D[k + 1] = q.y - v.y; D[k + 2] = q.z - v.z; NF[k] = n.x; NF[k + 1] = n.y; NF[k + 2] = n.z;
      }
      // yer degistirmeyi komsular arasinda yumusat (yalniz pelvis koseleri), kabuk katlanmasin
      const nb = Array.from({ length: nv }, () => new Set());
      for (let t = 0; t < p.idx.length; t += 3) { const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
      for (let it = 0; it < 4; it++) {
        const D2 = Float32Array.from(D);
        for (let i = 0; i < nv; i++) { if (!p.pelvic[i]) continue; let sx = 0, sy = 0, sz = 0, cnt = 0; for (const j of nb[i]) if (p.pelvic[j]) { sx += D[j * 3]; sy += D[j * 3 + 1]; sz += D[j * 3 + 2]; cnt++; } if (cnt) { D2[i * 3] = 0.5 * D[i * 3] + 0.5 * sx / cnt; D2[i * 3 + 1] = 0.5 * D[i * 3 + 1] + 0.5 * sy / cnt; D2[i * 3 + 2] = 0.5 * D[i * 3 + 2] + 0.5 * sz / cnt; } }
        D.set(D2);
      }
      for (let i = 0; i < nv; i++) {
        const k = i * 3; if (!p.pelvic[i]) continue;
        v.set(W[k] + D[k], W[k + 1] + D[k + 1], W[k + 2] + D[k + 2]); n.set(NF[k], NF[k + 1], NF[k + 2]);
        let st = 0; while (st < 12 && insideOf(female, v)) { v.addScaledVector(n, 0.03); st++; }
        if (st === 12) { female.closestPointToPoint(v, hit); faceNormal(female, hit.faceIndex, n); if (n.x * NF[k] + n.y * NF[k + 1] + n.z * NF[k + 2] < 0) n.negate(); v.copy(hit.point).addScaledVector(n, OFFSET); stats.stuck++; }
        else if (st) { v.addScaledVector(n, OFFSET); stats.pushed++; }
        p.P[k] = v.x; p.P[k + 1] = v.y; p.P[k + 2] = v.z;
      }
    }
  }
  console.log(`  ${which}: yama ${stats.patches}, atilan yama ${stats.dropped}, havada atilan ucgen ${stats.droppedTris}, tarafi duzeltilen ${stats.sideFixed}, disari itilen kose ${stats.pushed}, cikamayan ${stats.stuck}`);

  // 4) birlestir ve sahneyi kur
  const merged = new Map();
  for (const p of sel) {
    const k = keyOf(p); let e = merged.get(k); if (!e) merged.set(k, e = { base: p.base, kind: p.kind, side: p.side, P: [], I: [] });
    const off = e.P.length / 3; for (let i = 0; i < p.P.length; i++) e.P.push(p.P[i]); for (const j of p.idx) e.I.push(j + off);
  }
  const root = new THREE.Group(); root.name = 'Attachments';
  const top = new THREE.Group(); top.name = 'Muscle attachments'; root.add(top);
  const grp = {}; for (const [k, nm] of [[O, 'Origins'], [I, 'Insertions']]) { grp[k] = new THREE.Group(); grp[k].name = nm; top.add(grp[k]); }
  for (const e of merged.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(e.P, 3)); g.setIndex(e.I);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: e.kind === O ? 'Origin' : 'Insertion' }));
    mesh.name = `${e.base} (${e.kind}).${e.side}`; grp[e.kind].add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}
