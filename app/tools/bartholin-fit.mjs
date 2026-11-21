// Bartholin bezlerinin (glandulae vestibulares majores; sematik) yerlesimi -> tools/bartholin-fit.json
// Kullanim: node tools/bartholin-fit.mjs   (once butun kaynaklar donusturulmus olmali; kadin bedenindeki komsulari okur,
// kendi ciktisi bartholin.glb haric: eski bezler engel sayilirsa her calistirma bezi bir oncekinin disina iter)
//
// Kaynak modellerde Bartholin bezi yok. Ders kitabi tarifi (Gray's, Sobotta, Netter): iki yanda, vajina girisinin
// arka-yaninda, 0.5-1 cm capli yuvarlak-oval bez; vestibul bulbusunun arka ucuna degir (cogu zaman onunla ortulur);
// ~2 cm'lik kanali one-ice gider ve vestibule, himen ile labium minus arasindaki olukta, giristen saat 4-5 ve 7-8
// hizasinda acilir. tools/bartholin.mjs bu dosyadaki pozlarla bez (elipsoid) ve kanal (ince boru) agini uretir.
//
// Bez: yari eksenleri SEMI (cm) olan elipsoid; uzun ekseni bulbusun uzun eksenine (arka uca dogru) paraleldir. Merkez
// su maliyeti en kucuk yapacak bicimde aranir (Nelder-Mead, birkac baslangic):
//  - Bez yuzeyi bulbusun arka ucuna (bulbus ekseni boyunca son END_LEN cm) GAP_BULB cm'den degsin.
//  - Bez yuzeyi vajinadan en az GAP_VAG cm uzakta kalsin; merkezi giris duzeyinde (vajinanin en alt halkasi) dursun.
//  - Bez girisin arka-yaninda olsun: merkezinin giris halkasinin merkezine gore yonu arka orta hattan ANG_LO-ANG_HI
//    derece yana; kanal (bez yuzeyinden agza duz uzaklik) en az DUCT_MIN cm olsun. Ikisi de yumusak kosuldur; bulbusa
//    temas once gelir (sol bulbusun arka ucu sagdakinden ~0.4 cm onde ve vajinadan uzakta, sol bez bu yuzden daha yanda kalir).
//  - Bez, kadin bedeninde gorunen kapali parcalarin (kas, damar, sinir, kemik, organ) hicbirinin icine girmesin.
//    Acik yapraklar (fascia lata gibi) dikkate alinmaz; rapor bunlara temas edilip edilmedigini yazar.
// Kanal: bezin yuzeyinden vestibuldeki agzina giden ikinci derece Bezier egrisi (yaricap DUCT_R). Agiz: vajina girisi
// halkasinin merkezinden, arka orta hattan OPEN_DEG derece yana donmus yonde, halkanin OPEN_OUT cm disinda.
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene, label, bounds } from './scene.mjs';

const SEMI = [0.45, 0.32, 0.26];
const GAP_BULB = 0.03, GAP_VAG = 0.1, END_LEN = 0.6;
const DUCT_R = 0.06, OPEN_DEG = 45, OPEN_OUT = 0.15;
const ANG_LO = 35, ANG_HI = 70;   // bez merkezinin giris halkasi merkezine gore yonu: arka orta hattan yana (derece)
const DUCT_MIN = 0.9;              // kanalin en az uzunlugu (cm; ders kitabi ~2 cm, bu modelde bulbuslar vajinaya yakin)

const files = fs.readdirSync('public/models').filter(f => f.endsWith('.glb') && f !== 'bartholin.glb').map(f => f.slice(0, -4));
const { parts } = await loadScene({ files, keep: it => it.x !== 'm' });
const region = { mn: [-4, 78.8, -3.6], mx: [4, 82.6, 1.2] };
const inRegion = p => { const b = bounds(p.P); return [0, 1, 2].every(a => b.mx[a] > region.mn[a] && b.mn[a] < region.mx[a]); };
const near = parts.filter(inRegion);
if (near.some(p => p.n === 'Greater vestibular gland')) throw new Error('bartholin-fit: kendi ciktisi sahnede');
const geomOf = list => {
  let nP = 0, nI = 0; for (const p of list) { nP += p.P.length; nI += p.I.length; }
  const P = new Float32Array(nP), I = new Uint32Array(nI); let o = 0, oi = 0;
  for (const p of list) { P.set(p.P, o); for (let k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + o / 3; o += p.P.length; oi += p.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); return g;
};
const bvhOf = list => new MeshBVH(geomOf(list));
// kapali mi: konuma gore kaynastirilmis kenarlarin hepsi iki ucgende kullaniliyorsa
const isClosed = p => {
  const key = i => `${p.P[i * 3].toFixed(4)},${p.P[i * 3 + 1].toFixed(4)},${p.P[i * 3 + 2].toFixed(4)}`;
  const id = new Map(), vid = i => { const k = key(i); let v = id.get(k); if (v === undefined) { v = id.size; id.set(k, v); } return v; };
  const E = new Map();
  for (let t = 0; t < p.I.length; t += 3) for (let k = 0; k < 3; k++) { const a = vid(p.I[t + k]), b = vid(p.I[t + (k + 1) % 3]); if (a === b) continue; const e = a < b ? a + ',' + b : b + ',' + a; E.set(e, (E.get(e) || 0) + 1); }
  for (const c of E.values()) if (c === 1) return false; return true;
};
const VAG = /^(Vagina|Vaginal fornix)$/, VULVA = /clitoris|Bulb of vestibule|Commissure of bulbs/;
const vagParts = near.filter(p => VAG.test(p.n)), vulvaParts = near.filter(p => VULVA.test(p.n));
if (!vagParts.length || !vulvaParts.length) throw new Error('bartholin-fit: vajina ya da klitoris/bulbus yok (female ve vulva donusturulmeli)');
// engeller: vajina ve vulva birlesik kabuk olarak, digerleri kapaliysa tek tek
const obst = [{ name: 'Vagina + Vaginal fornix', bvh: bvhOf(vagParts) }, { name: 'Clitoris + bulbs', bvh: bvhOf(vulvaParts) }];
const open = [];
for (const p of near) { if (VAG.test(p.n) || VULVA.test(p.n)) continue; if (isClosed(p)) obst.push({ name: label(p), bvh: bvhOf([p]) }); else open.push({ name: label(p), bvh: bvhOf([p]) }); }
const DIRS = [new THREE.Vector3(0.577, 0.611, 0.542).normalize(), new THREE.Vector3(-0.49, -0.62, 0.61).normalize()];
const ray = new THREE.Ray(), hit = {}, tmp = new THREE.Vector3();
const inside = (bv, p) => DIRS.every(d => { ray.set(tmp.copy(p), d); return bv.raycast(ray, THREE.DoubleSide).length % 2 === 1; });

// vajina girisi: vajinanin en alt 0.15 cm'lik halkasi
let yMin = Infinity; for (const p of vagParts) for (let k = 1; k < p.P.length; k += 3) yMin = Math.min(yMin, p.P[k]);
const ring = []; for (const p of vagParts) for (let k = 0; k < p.P.length; k += 3) if (p.P[k + 1] < yMin + 0.15) ring.push(new THREE.Vector3(p.P[k], p.P[k + 1], p.P[k + 2]));
const ringC = ring.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / ring.length);
const vagB = obst[0].bvh, bulbAll = obst[1].bvh;

// birim kure ornekleri (Fibonacci)
const NS = 160, sph = []; for (let i = 0; i < NS; i++) { const y = 1 - 2 * (i + 0.5) / NS, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5)); sph.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))); }

function fitSide(sd) {
  const bulb = parts.find(p => p.n === 'Bulb of vestibule' && p.sd === sd); if (!bulb) throw new Error('bartholin-fit: bulbus yok: ' + sd);
  const V = []; for (let k = 0; k < bulb.P.length; k += 3) V.push(new THREE.Vector3(bulb.P[k], bulb.P[k + 1], bulb.P[k + 2]));
  const c = V.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / V.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const ax = ['x', 'y', 'z'];
  for (const v of V) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (v[ax[i]] - c[ax[i]]) * (v[ax[j]] - c[ax[j]]) / V.length;
  let e = new THREE.Vector3(0, -0.5, -1).normalize();
  for (let it = 0; it < 80; it++) e = new THREE.Vector3(C[0][0] * e.x + C[0][1] * e.y + C[0][2] * e.z, C[1][0] * e.x + C[1][1] * e.y + C[1][2] * e.z, C[2][0] * e.x + C[2][1] * e.y + C[2][2] * e.z).normalize();
  if (e.z > 0) e.negate();                                          // arka uca dogru
  const tOf = v => v.clone().sub(c).dot(e); const tMax = Math.max(...V.map(tOf));
  const endPts = V.filter(v => tOf(v) > tMax - END_LEN); const endC = endPts.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / endPts.length);
  const bulbB = bvhOf([bulb]);
  // bez ekseni: u = bulbus ekseni, v = yatay ve u'ya dik, w = u x v
  const u = e.clone(), v = new THREE.Vector3(0, 1, 0).cross(u).normalize(), w = u.clone().cross(v).normalize();
  // kanal: agiz vajina girisinin arka-yaninda
  const side = sd === 'l' ? 1 : -1, th = OPEN_DEG * Math.PI / 180;
  const dir = new THREE.Vector3(side * Math.sin(th), 0, -Math.cos(th));
  let rr = 0; for (const q of ring) rr = Math.max(rr, q.clone().sub(ringC).setY(0).dot(dir));
  const open3 = ringC.clone().addScaledVector(dir, rr + OPEN_OUT); open3.y = yMin + 0.05;
  const surf = ctr => sph.map(s => ctr.clone().addScaledVector(u, s.x * SEMI[0]).addScaledVector(v, s.y * SEMI[1]).addScaledVector(w, s.z * SEMI[2]));
  const cost = (x, detail = false) => {
    const ctr = new THREE.Vector3(...x); const S = surf(ctr); let E = 0;
    // arka uca temas
    let dEnd = Infinity; for (const p of S) { bulbB.closestPointToPoint(p, hit); if (tOf(hit.point) > tMax - END_LEN) dEnd = Math.min(dEnd, inside(bulbAll, p) ? -hit.distance : hit.distance); }
    E += 60 * (dEnd - GAP_BULB) ** 2;
    // engellerin icine girme
    let pen = 0, nIn = 0; const insideOf = [];
    for (const o of obst) { let n = 0; for (const p of S.concat([ctr])) { if (!inside(o.bvh, p)) continue; o.bvh.closestPointToPoint(p, hit); pen += hit.distance ** 2; n++; } if (n) { nIn += n; insideOf.push([o.name, n]); } }
    E += 400 * pen + 2 * nIn;
    // vajinadan uzaklik ve giris duzeyi
    let dV = Infinity; for (const p of S) { vagB.closestPointToPoint(p, hit); dV = Math.min(dV, hit.distance); }
    E += 30 * Math.max(0, GAP_VAG - dV) ** 2;
    E += 1.5 * (ctr.y - (yMin + 0.05)) ** 2;
    // arka-yan konum ve kanal uzunlugu
    const ang = Math.atan2(side * (ctr.x - ringC.x), -(ctr.z - ringC.z)) * 180 / Math.PI;
    E += 1.0 * (Math.max(0, ang - ANG_HI) / 30) ** 2 + 1.0 * (Math.max(0, ANG_LO - ang) / 30) ** 2;
    const dl = open3.clone().sub(ctr); const loc = new THREE.Vector3(dl.dot(u) / SEMI[0], dl.dot(v) / SEMI[1], dl.dot(w) / SEMI[2]);
    const ductStraight = dl.length() * (1 - 1 / loc.length());
    E += 4 * Math.max(0, DUCT_MIN - ductStraight) ** 2;
    return detail ? { E, dEnd, dV, insideOf, ang, ductStraight } : E;
  };
  const nm = (x0, step, iters) => {
    const dim = 3; let Sx = [x0.slice()]; for (let i = 0; i < dim; i++) { const x = x0.slice(); x[i] += step; Sx.push(x); }
    let F = Sx.map(x => cost(x));
    for (let it = 0; it < iters; it++) {
      const ord = F.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]).map(q => q[1]); Sx = ord.map(i => Sx[i]); F = ord.map(i => F[i]);
      const cen = [0, 0, 0]; for (let i = 0; i < dim; i++) for (let d = 0; d < dim; d++) cen[d] += Sx[i][d] / dim;
      const xr = cen.map((q, d) => 2 * q - Sx[dim][d]), fr = cost(xr);
      if (fr < F[0]) { const xe = cen.map((q, d) => 3 * q - 2 * Sx[dim][d]), fe = cost(xe); if (fe < fr) { Sx[dim] = xe; F[dim] = fe; } else { Sx[dim] = xr; F[dim] = fr; } }
      else if (fr < F[dim - 1]) { Sx[dim] = xr; F[dim] = fr; }
      else { const xc = cen.map((q, d) => 0.5 * (q + Sx[dim][d])), fc = cost(xc); if (fc < F[dim]) { Sx[dim] = xc; F[dim] = fc; } else for (let i = 1; i <= dim; i++) { Sx[i] = Sx[i].map((q, d) => 0.5 * (q + Sx[0][d])); F[i] = cost(Sx[i]); } }
    }
    const i = F.indexOf(Math.min(...F)); return { x: Sx[i], f: F[i] };
  };
  // baslangiclar: bulbus arka ucunun merkezinden vajinaya, geriye ve asagiya dogru
  const toVag = ringC.clone().sub(endC).setY(0).normalize();
  let best = null;
  for (const [a, b, cc] of [[0.5, -0.4, 0], [0.8, -0.2, 0.2], [0.3, -0.7, 0.2], [0.6, -0.5, -0.3], [0.2, -0.3, 0.4]]) {
    const x0 = endC.clone().addScaledVector(toVag, a).add(new THREE.Vector3(0, cc, b)).toArray();
    const r = nm(x0, 0.25, 160); if (!best || r.f < best.f) best = r;
  }
  const fin = nm(best.x, 0.06, 200); const ctr = new THREE.Vector3(...fin.x); const D = cost(fin.x, true);
  // bez yuzeyinde agza bakan nokta (merkezden agza isin; elipsoid kesisimi), 0.1 cm iceriden baslar
  const dl = open3.clone().sub(ctr); const loc = new THREE.Vector3(dl.dot(u) / SEMI[0], dl.dot(v) / SEMI[1], dl.dot(w) / SEMI[2]); const k = 1 / loc.length();
  const exitP = ctr.clone().addScaledVector(dl, k);
  const start = ctr.clone().addScaledVector(dl, Math.max(0, k - 0.1 / dl.length()));
  // kontrol noktasi: duz cizgi; vajina ya da bulbus icine girerse vajinadan uzaga it
  const bez = (P0, P1, P2, t) => P0.clone().multiplyScalar((1 - t) ** 2).addScaledVector(P1, 2 * t * (1 - t)).addScaledVector(P2, t * t);
  const away = exitP.clone().add(open3).multiplyScalar(0.5).sub(ringC).setY(0).normalize();
  let ctrl = null, ductHits = null;
  for (let push = 0; push <= 1.0001; push += 0.05) {
    const P1 = exitP.clone().add(open3).multiplyScalar(0.5).addScaledVector(away, push);
    const hits = []; for (let i = 0; i <= 40; i++) { const t = i / 40; const p = bez(start, P1, open3, t); if (t > 0.15 && obst.some(o => inside(o.bvh, p))) hits.push(+t.toFixed(3)); for (const o of obst.slice(0, 2)) { o.bvh.closestPointToPoint(p, hit); if (t > 0.15 && t < 0.95 && hit.distance < DUCT_R + 0.02) hits.push(+t.toFixed(3)); } }
    if (!hits.length || push > 0.999) { ctrl = P1; ductHits = hits; break; }
  }
  const pts = []; let len = 0; for (let i = 0; i <= 24; i++) { const p = bez(start, ctrl, open3, i / 24); if (i) len += p.distanceTo(pts[pts.length - 1]); pts.push(p); }
  // acik yapraklara temas (yalniz rapor)
  const S = surf(ctr); const openTouch = [];
  for (const o of open) { let m = Infinity; for (const p of S.concat(pts)) { o.bvh.closestPointToPoint(p, hit); m = Math.min(m, hit.distance); } if (m < 0.05) openTouch.push([o.name, +m.toFixed(3)]); }
  // en yakin kapali komsular (bez yuzeyinden)
  const gaps = obst.map(o => { let m = Infinity; for (const p of S) { o.bvh.closestPointToPoint(p, hit); m = Math.min(m, inside(o.bvh, p) ? -hit.distance : hit.distance); } return [o.name, +m.toFixed(3)]; }).sort((a, b) => a[1] - b[1]).slice(0, 6);
  const r3 = q => q.toArray().map(a => +a.toFixed(4));
  return {
    centre: r3(ctr), axes: [r3(u), r3(v), r3(w)], semi: SEMI,
    duct: { from: r3(start), ctrl: r3(ctrl), to: r3(open3), r: DUCT_R },
    report: { bulbEndContactCm: +D.dEnd.toFixed(3), vaginaGapCm: +D.dV.toFixed(3), angleFromPosteriorDeg: +D.ang.toFixed(1), insideOf: D.insideOf, nearestClosed: gaps, openSheetsTouched: openTouch,
      ductLengthCm: +len.toFixed(2), ductCloseOrInside: ductHits, openingCm: r3(open3), clockDeg: OPEN_DEG, bulbPosteriorEnd: r3(endC) },
  };
}
const out = { note: 'Bartholin bezleri (sematik): elipsoid merkezi, eksenleri, yari eksenleri ve kanal Bezier egrisi (cm); tools/bartholin-fit.mjs, ag tools/bartholin.mjs', introitus: { centre: ringC.toArray().map(a => +a.toFixed(3)), lowestY: +yMin.toFixed(3) }, l: fitSide('l'), r: fitSide('r') };
fs.writeFileSync(new URL('./bartholin-fit.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ introitus: out.introitus, l: { centre: out.l.centre, ...out.l.report }, r: { centre: out.r.centre, ...out.r.report } }, null, 1), '\n-> tools/bartholin-fit.json');
