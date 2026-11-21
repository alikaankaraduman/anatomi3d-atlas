// Bartholin bezleri (glandulae vestibulares majores; sematik, bu proje icin cizildi): tools/bartholin-fit.json'daki
// pozlarla her yanda bir elipsoid (bez) ve ondan vestibuldeki agzina giden ince bir boru (kanal). Bez ve kanali tek
// parcadir ("Greater vestibular gland"); TA kanal icin ayri terim vermez. Iki kapali kabuk ust uste biner: kanalin ic
// ucu bezin icinde kapanir. convert.mjs icin THREE sahnesi uretir.
import fs from 'node:fs';
import { THREE } from './fbxnode.mjs';

const NU = 28, NV = 16;      // elipsoid: boylam ve enlem bolumleri
const NSD = 10, NSEG = 18;   // kanal: halka basina kose, egri boyunca bolum
const PATH = ['Genital systems', 'Female genital system', 'Female external genitalia', 'Vulva'];

function ellipsoid(m, G) {
  const c = new THREE.Vector3(...G.centre), [u, v, w] = G.axes.map(a => new THREE.Vector3(...a)), [A, B, C] = G.semi;
  const at = (x, y, z) => m.add(c.clone().addScaledVector(u, A * x).addScaledVector(v, B * y).addScaledVector(w, C * z));
  // (u, v, w) sag elli; birim kurenin disa bakan ucgenleri disa bakar. Kutuplar yerel z ekseninde, tek kose.
  const id = [];
  for (let i = 0; i <= NV; i++) {
    const th = Math.PI * i / NV;
    if (i === 0 || i === NV) { const p = at(0, 0, Math.cos(th)); id.push(Array(NU).fill(p)); continue; }
    const row = []; for (let j = 0; j < NU; j++) { const ph = 2 * Math.PI * j / NU; row.push(at(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th))); }
    id.push(row);
  }
  for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) {
    const j1 = (j + 1) % NU, a = id[i][j], b = id[i][j1], cc = id[i + 1][j], d = id[i + 1][j1];
    if (a !== b) m.I.push(a, cc, b);
    if (cc !== d) m.I.push(b, cc, d);
  }
}

function duct(m, D) {
  const P0 = new THREE.Vector3(...D.from), P1 = new THREE.Vector3(...D.ctrl), P2 = new THREE.Vector3(...D.to);
  const C = []; for (let i = 0; i <= NSEG; i++) { const t = i / NSEG; C.push(P0.clone().multiplyScalar((1 - t) ** 2).addScaledVector(P1, 2 * t * (1 - t)).addScaledVector(P2, t * t)); }
  const n = C.length, T = C.map((c, i) => C[Math.min(n - 1, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize());
  let nv = new THREE.Vector3(0, 1, 0); if (Math.abs(nv.dot(T[0])) > 0.9) nv.set(1, 0, 0); nv.sub(T[0].clone().multiplyScalar(nv.dot(T[0]))).normalize();
  const ids = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) { nv.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i])); nv.sub(T[i].clone().multiplyScalar(nv.dot(T[i]))).normalize(); }
    const b = T[i].clone().cross(nv).normalize(); const row = [];
    for (let k = 0; k < NSD; k++) { const a = 2 * Math.PI * k / NSD; row.push(m.add(C[i].clone().addScaledVector(nv, D.r * Math.cos(a)).addScaledVector(b, D.r * Math.sin(a)))); }
    ids.push(row);
  }
  // yan yuzey disa (bkz. tools/urethra.mjs), uc kapaklar egrinin disina bakar
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < NSD; k++) { const k1 = (k + 1) % NSD, a = ids[i][k], b = ids[i][k1], c = ids[i + 1][k], d = ids[i + 1][k1]; m.I.push(a, b, c, b, d, c); }
  const c0 = m.add(C[0]), c1 = m.add(C[n - 1]);
  for (let k = 0; k < NSD; k++) { const k1 = (k + 1) % NSD; m.I.push(c0, ids[0][k1], ids[0][k]); m.I.push(c1, ids[n - 1][k], ids[n - 1][k1]); }
}

export function loadBartholin() {
  const F = JSON.parse(fs.readFileSync(new URL('./bartholin-fit.json', import.meta.url), 'utf8'));
  const root = new THREE.Group(); root.name = 'Bartholin';
  let node = root; for (const nm of PATH) { const g = new THREE.Group(); g.name = nm; node.add(g); node = g; }
  for (const sd of ['l', 'r']) {
    const m = { P: [], I: [], add(p) { this.P.push(p.x, p.y, p.z); return this.P.length / 3 - 1; } };
    ellipsoid(m, F[sd]); duct(m, F[sd].duct);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.P, 3)); g.setIndex(m.I);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: 'Gland' })); mesh.name = 'Greater vestibular gland.' + sd;
    node.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}
