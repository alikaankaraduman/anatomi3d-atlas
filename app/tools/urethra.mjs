// Kadin uretrasi (sematik; bu proje icin cizildi): tools/urethra-fit.json'daki orta hat egrisi boyunca kalin cidarli
// bir boru. convert.mjs icin THREE sahnesi uretir.
//  - Female urethra: dis yuzey, lumen yuzeyi ve mesane icinde kalan ust halka. Dis yaricap R (~6 mm cap); ust ucta
//    mesane boynunun hunisine sigsin diye R_TOP'tan, dis agza dogru R_MEATUS'a incelir. Lumen yaricapi R_IN.
//  - External orifice of female urethra (TA2 3432, Ostium externum urethrae femininae): dis agizdaki halka (borunun alt ucu). Ayni govdeden kesilir; kaynak lockBorder ile
//    sadelestirilir ki ortak kenar kaymasin.
// Halkalar egri boyunca paralel tasinan cerceveyle (donmeyen) dizilir; ilk cercevenin normali one (z+) bakar.
import fs from 'node:fs';
import { THREE } from './fbxnode.mjs';

const NS = 24;                                   // halka basina kose
const R_IN = 0.1, R_TOP = 0.25, R_MEATUS = 0.26; // cm
const TOP_LEN = 0.4, END_LEN = 0.6;              // yaricap gecis uzunluklari (cm)
const PATH = ['Urinary system', 'Female urethra'];

export function loadUrethra() {
  const F = JSON.parse(fs.readFileSync(new URL('./urethra-fit.json', import.meta.url), 'utf8'));
  const C = F.centre.map(c => new THREE.Vector3(...c)); const n = C.length;
  const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + C[i].distanceTo(C[i - 1])); const L = s[n - 1];
  const ss = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const rOut = si => { let r = F.R; r += (R_TOP - F.R) * (1 - ss(si / TOP_LEN)); r += (R_MEATUS - F.R) * ss((si - (L - END_LEN)) / END_LEN); return r; };
  // teget ve paralel tasinan cerceve
  const T = C.map((c, i) => C[Math.min(n - 1, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize());
  const N = [], B = [];
  let nv = new THREE.Vector3(0, 0, 1); nv.sub(T[0].clone().multiplyScalar(nv.dot(T[0]))).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]); nv = nv.clone().applyQuaternion(q); nv.sub(T[i].clone().multiplyScalar(nv.dot(T[i]))).normalize(); }
    N.push(nv.clone()); B.push(T[i].clone().cross(nv).normalize());
  }
  const ring = (i, r) => { const out = []; for (let k = 0; k < NS; k++) { const a = 2 * Math.PI * k / NS; out.push(C[i].clone().addScaledVector(N[i], r * Math.cos(a)).addScaledVector(B[i], r * Math.sin(a))); } return out; };
  const outer = C.map((_, i) => ring(i, rOut(s[i]))), inner = C.map((_, i) => ring(i, R_IN));
  // agler: kose dizisi + ucgenler (dis normal disari, lumen normali eksene dogru, uc halkalar egri disina)
  const mk = () => ({ P: [], I: [], add(v) { this.P.push(v.x, v.y, v.z); return this.P.length / 3 - 1; } });
  const body = mk(), orifice = mk();
  const O = outer.map(rg => rg.map(v => body.add(v))), Q = inner.map(rg => rg.map(v => body.add(v)));
  // (N, B, T) sag elli: aci artarken N -> B yonunde doner; T boyunca ilerleyen seritte (a, b, c) disa bakar
  const strip = (id, flip) => {
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < NS; k++) {
      const k1 = (k + 1) % NS, a = id[i][k], b = id[i][k1], c = id[i + 1][k], d = id[i + 1][k1];
      if (!flip) body.I.push(a, b, c, b, d, c); else body.I.push(a, c, b, b, c, d);
    }
  };
  strip(O, false); strip(Q, true);
  const cap = (m, o, q, toward) => {   // toward: +1 egri yonunde (alt uc), -1 ters yonde (ust uc)
    for (let k = 0; k < NS; k++) { const k1 = (k + 1) % NS; if (toward > 0) m.I.push(o[k], o[k1], q[k], o[k1], q[k1], q[k]); else m.I.push(o[k], q[k], o[k1], o[k1], q[k], q[k1]); }
  };
  cap(body, O[0], Q[0], -1);
  cap(orifice, outer[n - 1].map(v => orifice.add(v)), inner[n - 1].map(v => orifice.add(v)), +1);
  const root = new THREE.Group(); root.name = 'Urethra';
  let node = root; for (const nm of PATH) { const g = new THREE.Group(); g.name = nm; node.add(g); node = g; }
  for (const [m, name, mat] of [[body, 'Female urethra', 'Urethra'], [orifice, 'External orifice of female urethra', 'Mucosa']]) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.P, 3)); g.setIndex(m.I);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: mat })); mesh.name = name; node.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}
