// Kadin uretrasinin (sematik) orta hat egrisi -> tools/urethra-fit.json
// Kullanim: node tools/urethra-fit.mjs   (once female, femalepelvis, femalejoints ve vulva donusturulmus olmali)
//
// Modelin kaynaklarinda kadin uretrasi yok (Z-Anatomy erkek bedeni, HRA kadin organlari, Fillod klitorisi) ve ucretsiz,
// indirilebilir bir model de bulunamadi. Uretra bu proje icin ders kitabi tarifine gore cizilir: yaklasik 4 cm uzun,
// ~6 mm capli; mesane boynundan simfizin arkasindan asagi ve hafif one iner, one bakan hafif bir kavis yapar; arka duvari
// vajinanin on duvarina yapisiktir; dis agzi vestibulde, klitoris glansinin arkasinda ve vajina girisinin hemen onundedir.
// Egri olculen yuzeylerden kurulur (tools/urethra.mjs bu egri boyunca boru agini uretir):
//  - Baslangic: kadin mesanesinin boyun hunisinin ekseni. Mesanenin en alt noktasinin TOP_DY cm ustundeki kesitin
//    (x ve z yonundeki dis sinirlarin) orta noktasi; borunun ust ucu mesane duvarinin icinde kalir.
//  - Govde: borunun arka yuzu vajinanin on yuzunden GAP cm onde (vajinanin on yuzu: borunun genisligi icinde, o
//    yukseklikte en onde olan nokta). Mesane boynu vajinanin ~0.8 cm onunde durdugu icin bu bosluk mesaneden asagi
//    dogru yumusakca kapanir (HUG_TOP -> HUG_FULL arasinda).
//  - Dis agiz: vajinanin en alt noktasinin MEATUS_DY cm ustunde, vajina girisinin on kenarinin MEATUS_DZ cm onunde; x uc
//    orta hat tahmininin ortalamasi: klitoris glansinin ucu, vestibul bulbuslarinin o yukseklikteki ic kenarlarinin orta
//    noktasi ve vajina girisinin merkezi (kaynaklar orta hatta 0.4 cm kadar ayrisir; uretra vajina on duvarinin
//    orta hattinda, dis agiz girisin hemen onunde durur).
//    Ders kitabi araliklari: klitoris-uretra 1.6-4.5 cm (ortalama ~2.9), uretra-vajina girisi 0.5-1.5 cm.
//  - Egri Gauss ile yumusatilir ve yay uzunluguna gore STEP cm aralikla yeniden orneklenir.
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadScene } from './scene.mjs';

const R = 0.3;              // dis yaricap (tools/urethra.mjs ile ayni)
const GAP = 0.08;           // vajina on duvari ile boru arasinda kalan bosluk (cm)
const TOP_DY = 0.4;         // baslangic: mesanenin en alt noktasinin bu kadar ustu
const HUG_TOP = 83.9, HUG_FULL = 82.9;   // y: bu aralikta borunun vajinaya yaklasmasi tamamlanir
const MEATUS_DY = 0.25, MEATUS_DZ = 1.05;
const BEND = 0.9;           // dis agizdan once borunun one dondugu yukseklik araligi (cm)
const STEP = 0.1, SMOOTH = 0.15;

const { parts } = await loadScene({ files: ['female', 'femalepelvis', 'femalejoints', 'vulva'], keep: it => it.x === 'f' });
const bvhOf = list => {
  let nP = 0, nI = 0; for (const p of list) { nP += p.P.length; nI += p.I.length; }
  const P = new Float32Array(nP), I = new Uint32Array(nI); let o = 0, oi = 0;
  for (const p of list) { P.set(p.P, o); for (let k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + o / 3; o += p.P.length; oi += p.I.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); return new MeshBVH(g);
};
const pick = re => { const l = parts.filter(p => re.test(p.n)); if (!l.length) throw new Error('parca yok: ' + re); return l; };
const bladder = pick(/^Urinary bladder$/), vagParts = pick(/^(Vagina|Vaginal fornix)$/);
const vag = bvhOf(vagParts), bl = bvhOf(bladder);
const bone = bvhOf([...pick(/^Hip bone$/), ...pick(/^(Pubic symphysis|Interpubic disc|Inferior pubic ligament)$/)]);
const vulva = bvhOf(pick(/clitoris|Bulb of vestibule|Commissure of bulbs/));
const ray = new THREE.Ray(), hitPt = {};
const hitsAlong = (bv, o, d) => { ray.set(o, d); return bv.raycast(ray, THREE.DoubleSide).map(h => h.point); };
const lowest = list => { let m = null; for (const p of list) for (let k = 0; k < p.P.length; k += 3) if (!m || p.P[k + 1] < m[1]) m = [p.P[k], p.P[k + 1], p.P[k + 2]]; return m; };

// --- baslangic: mesane boynu hunisinin ekseni ---
const bLow = lowest(bladder);
const yS = bLow[1] + TOP_DY;
const zRange = x => { const h = hitsAlong(bl, new THREE.Vector3(x, yS, -5), new THREE.Vector3(0, 0, 1)); return h.length ? [Math.min(...h.map(p => p.z)), Math.max(...h.map(p => p.z))] : null; };
const xs = []; for (let x = bLow[0] - 1.5; x <= bLow[0] + 1.5; x += 0.01) if (zRange(x)) xs.push(x);
const xS = (xs[0] + xs[xs.length - 1]) / 2, zr = zRange(xS); const zS = (zr[0] + zr[1]) / 2;
const S = [xS, yS, zS];

// --- vajinanin on yuzu (borunun genisligi icinde en onde) ---
const need = (v, what) => { if (v === null || v === undefined || Number.isNaN(v)) throw new Error('urethra-fit: olculemedi: ' + what); return v; };
const vagAnt = (x, y) => {
  let m = null;
  for (const dx of [-R, -R / 2, 0, R / 2, R]) { const h = hitsAlong(vag, new THREE.Vector3(x + dx, y, 6), new THREE.Vector3(0, 0, -1)); if (h.length) { const z = Math.max(...h.map(p => p.z)); if (m === null || z > m) m = z; } }
  return m;
};

// --- dis agiz ---
const vLow = lowest(vagParts);
const yE = vLow[1] + MEATUS_DY;
const glans = pick(/^Glans of clitoris$/)[0]; let tip = null;   // glansin ucu: en alcak kose
for (let k = 0; k < glans.P.length; k += 3) if (!tip || glans.P[k + 1] < tip[1]) tip = [glans.P[k], glans.P[k + 1], glans.P[k + 2]];
const medial = side => {
  const p = pick(/^Bulb of vestibule$/).find(q => q.sd === side); if (!p) throw new Error('urethra-fit: bulbus yok: ' + side); let m = null;
  for (let k = 0; k < p.P.length; k += 3) { if (Math.abs(p.P[k + 1] - yE) > 0.2) continue; const x = p.P[k]; if (m === null || (side === 'l' ? x < m : x > m)) m = x; }
  return need(m, 'bulbusun ic kenari ' + side);
};
const bulbMid = (medial('l') + medial('r')) / 2;
let vagX = 0, nRing = 0; for (const p of vagParts) for (let k = 0; k < p.P.length; k += 3) if (p.P[k + 1] < vLow[1] + 0.15) { vagX += p.P[k]; nRing++; }
vagX /= nRing;
const xE = (tip[0] + bulbMid + vagX) / 3;
const introAnt = need(vagAnt(xE, vLow[1] + 0.2), 'vajina girisinin on kenari');
const E = [xE, yE, introAnt + MEATUS_DZ];

// --- ham egri: y'ye gore ---
const ss = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const xOf = y => xS + (xE - xS) * ss((yS - y) / (yS - yE));
const hug = y => { const a = vagAnt(xOf(y), y); return a === null ? null : a + R + GAP; };
const yB = yE + BEND, zB = need(hug(yB), 'vajina on duvari y ' + yB);
const raw = [];
for (let y = yS; y >= yE - 1e-9; y -= 0.02) {
  let z;
  if (y >= yB) { const wT = ss((y - HUG_FULL) / (HUG_TOP - HUG_FULL)); z = (1 - wT) * need(hug(y), 'vajina on duvari y ' + y.toFixed(2)) + wT * zS; }
  else { const t = (yB - y) / (yB - yE); const zl = zB + (E[2] - zB) * t; const h = hug(y); const w = ss(t); z = (1 - w) * (h ?? zl) + w * zl; }
  raw.push([xOf(y), y, z]);
}
raw[raw.length - 1] = E.slice();
// Gauss yumusatma (uclar sabit)
const smooth = raw.map((p, i) => {
  if (i === 0 || i === raw.length - 1) return p;
  const o = [0, 0, 0]; let ws = 0;
  for (let j = Math.max(0, i - 30); j <= Math.min(raw.length - 1, i + 30); j++) { const d = Math.abs(raw[j][1] - p[1]); const w = Math.exp(-(d * d) / (2 * SMOOTH * SMOOTH)); ws += w; for (let a = 0; a < 3; a++) o[a] += w * raw[j][a]; }
  return o.map(v => v / ws);
});
// yay uzunluguna gore yeniden ornekleme
const cum = [0]; for (let i = 1; i < smooth.length; i++) cum.push(cum[i - 1] + Math.hypot(...[0, 1, 2].map(a => smooth[i][a] - smooth[i - 1][a])));
const L = cum[cum.length - 1], n = Math.max(2, Math.round(L / STEP)); const centre = [];
for (let k = 0, j = 0; k <= n; k++) {
  const s = L * k / n; while (j < cum.length - 2 && cum[j + 1] < s) j++;
  const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
  centre.push([0, 1, 2].map(a => +(smooth[j][a] + t * (smooth[j + 1][a] - smooth[j][a])).toFixed(4)));
}

// --- rapor: borunun dis yuzeyi ile komsular arasindaki en kucuk bosluk (merkezden yuzeye uzaklik - R) ---
const v = new THREE.Vector3();
const clear = bv => { let m = Infinity, at = null; for (const c of centre) { v.set(...c); bv.closestPointToPoint(v, hitPt); const d = hitPt.distance - R; if (d < m) { m = d; at = c; } } return { min: +m.toFixed(3), at }; };
let firstOut = 0; for (let i = 0; i < centre.length; i++) if (centre[i][1] < bLow[1]) { firstOut = i; break; }
const out = {
  note: 'Kadin uretrasi (sematik) orta hat egrisi, cm, mesane boynundan dis agiza; tools/urethra-fit.mjs, ag tools/urethra.mjs',
  R, centre,
  report: {
    lengthCm: +L.toFixed(2), lengthBelowBladderCm: +(L * (1 - firstOut / n)).toFixed(2), start: S.map(a => +a.toFixed(3)), meatus: E.map(a => +a.toFixed(3)),
    bladderLowest: bLow.map(a => +a.toFixed(3)), glansTip: tip.map(a => +a.toFixed(3)),
    meatusX: { glansTip: +tip[0].toFixed(3), bulbMid: +bulbMid.toFixed(3), introitus: +vagX.toFixed(3) },
    clitorisToMeatusCm: +Math.hypot(...[0, 1, 2].map(a => tip[a] - E[a])).toFixed(2), meatusToIntroitusCm: +(E[2] - introAnt).toFixed(2),
    minGapVagina: clear(vag), minGapBone: clear(bone), minGapVulva: clear(vulva),
  },
};
fs.writeFileSync(new URL('./urethra-fit.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.report, null, 1), '\n-> tools/urethra-fit.json (' + centre.length + ' nokta)');
