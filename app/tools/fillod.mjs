// Odile Fillod'un gercek boyutlu klitoris modeli (V2, 2016; Odile Fillod ve Philippe Cosentino, Cite des sciences et de
// l'industrie FabLab; CC BY-NC-SA). Ikili STL, mm; data/fillod/Clitoris.stl (Wikimedia Commons'taki dosyayla ayni bayt).
// convert.mjs icin THREE sahnesi uretir: STL'deki iki kapali govde (klitoris ve bulbuslar) parcalara bolunur, her parca
// tools/fillod-fit.json donusumuyle modelin kadin pelvisine (cm) yerlestirilir.
//
// Parcalar (STL koordinatlarinda; ucgen agirlik merkezine gore; kesik yuzeyler acik kalir, cift yuzlu cizilir):
//  - Glans clitoridis: acidan (genu) sonraki uc bolum, capin 4.8 mm'den 2.9 mm'ye birden indigi boyundan otesi
//    (eksen: aci (0, 36, 8) -> uc (0, 25.7, 24.2); boyun eksen boyunca 8.8 mm'de, eksenden 6.5 mm icinde).
//  - Crura clitoridis: iki kolun birlestigi catalin gerisi (y < 12, ya da |x| > 4.5 ve y < 17); taraf x isaretinden.
//  - Corpus clitoridis: klitoris govdesinin geri kalani (aci dahil).
//  - Bulbi vestibuli: bulbus govdesi, iki yan lobun orta hatta birlestigi yerin gerisi (y <= 6); taraf x isaretinden.
//  - Commissura bulborum vestibuli: iki bulbusun onde orta hatta birlestigi bant (y > 6).
import fs from 'node:fs';
import { THREE } from './fbxnode.mjs';

export function readSTL(file) {
  const b = fs.readFileSync(file); const n = b.readUInt32LE(80);
  if (b.length !== 84 + 50 * n) throw new Error(`${file}: ikili STL degil`);
  const P = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) P[i * 9 + k] = b.readFloatLE(o + k * 4); }
  return { P, n };
}

const CHAIN = ['Genital systems', 'Female genital system', 'Female external genitalia'];
const KNEE = [0, 36, 8], TIP = [-0.1, 25.7, 24.2], NECK = 8.8, GLANS_R = 6.5;

export function loadFillod() {
  const { P, n } = readSTL('../data/fillod/Clitoris.stl');
  // kose kaynagi ve bilesenler (birlesim-bul)
  const key = (x, y, z) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
  const map = new Map(), V = [], T = new Uint32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; const kk = key(x, y, z); let id = map.get(kk); if (id === undefined) { id = V.length / 3; map.set(kk, id); V.push(x, y, z); } T[i] = id; }
  const nv = V.length / 3, parent = new Int32Array(nv).map((_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < n; i++) { const a = find(T[i * 3]); parent[find(T[i * 3 + 1])] = a; parent[find(T[i * 3 + 2])] = a; }
  const size = new Map(); for (let v = 0; v < nv; v++) { const r = find(v); size.set(r, (size.get(r) || 0) + 1); }
  const roots = [...size.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  if (roots.length !== 2) throw new Error('Fillod STL: 2 govde bekleniyordu, ' + roots.length + ' bulundu');
  // bulbus govdesi: daha cok koseli olan (y araligi -26..12); klitoris: crura uclari |x| ~ 40
  const ext = r => { let mx = 0; for (let v = 0; v < nv; v++) if (find(v) === r) mx = Math.max(mx, Math.abs(V[v * 3])); return mx; };
  const clitRoot = ext(roots[0]) > ext(roots[1]) ? roots[0] : roots[1];
  const ax = [TIP[0] - KNEE[0], TIP[1] - KNEE[1], TIP[2] - KNEE[2]]; const L = Math.hypot(...ax); const u = ax.map(v => v / L);
  const partOf = (x, y, z, clit) => {
    if (clit) {
      const w = [x - KNEE[0], y - KNEE[1], z - KNEE[2]]; const t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
      const perp = Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]);
      if (t > NECK && perp < GLANS_R) return ['Clitoris', 'Glans of clitoris', '', 'Glans of clitoris'];
      if (y < 12 || (Math.abs(x) > 4.5 && y < 17)) return ['Clitoris', 'Crus of clitoris', x > 0 ? 'p' : 'n', 'Clitoris'];
      return ['Clitoris', 'Body of clitoris', '', 'Clitoris'];
    }
    if (y > 6) return ['Vulva', 'Commissure of bulbs of vestibule', '', 'Bulb of vestibule'];
    return ['Vulva', 'Bulb of vestibule', x > 0 ? 'p' : 'n', 'Bulb of vestibule'];
  };
  // yerlestirme
  const F = JSON.parse(fs.readFileSync(new URL('./fillod-fit.json', import.meta.url), 'utf8'));
  const R = new THREE.Matrix4().fromArray(F.R), J = new THREE.Vector3(...F.J), v = new THREE.Vector3();
  const place = id => v.set(V[id * 3] - F.j0[0], V[id * 3 + 1] - F.j0[1], V[id * 3 + 2] - F.j0[2]).multiplyScalar(F.s).applyMatrix4(R).add(J).clone();
  // STL'nin +x yani modelde hangi tarafa dusuyor: sol crus ucunun (STL +x) modeldeki x'i pozitifse sol (l; model x+ = sol)
  const probe = new THREE.Vector3(40, -25, 3.6).sub(new THREE.Vector3(...F.j0)).multiplyScalar(F.s).applyMatrix4(R).add(J);
  const sideMap = probe.x > 0 ? { p: 'l', n: 'r', '': '' } : { p: 'r', n: 'l', '': '' };
  const merged = new Map();
  for (let i = 0; i < n; i++) {
    const a = T[i * 3], b = T[i * 3 + 1], c = T[i * 3 + 2];
    const cx = (V[a * 3] + V[b * 3] + V[c * 3]) / 3, cy = (V[a * 3 + 1] + V[b * 3 + 1] + V[c * 3 + 1]) / 3, cz = (V[a * 3 + 2] + V[b * 3 + 2] + V[c * 3 + 2]) / 3;
    const [grp, name, sg, mat] = partOf(cx, cy, cz, find(a) === clitRoot);
    const side = sideMap[sg]; const k = grp + '|' + name + '|' + side;
    let e = merged.get(k); if (!e) merged.set(k, e = { path: [...CHAIN, grp], name, side, mat, P: [], I: [], ids: new Map() });
    for (const id of [a, b, c]) { let j = e.ids.get(id); if (j === undefined) { j = e.P.length / 3; e.ids.set(id, j); const p = place(id); e.P.push(p.x, p.y, p.z); } e.I.push(j); }
  }
  const root = new THREE.Group(); root.name = 'Fillod';
  const groupAt = path => { let node = root; for (const nm of path) { let ch = node.children.find(o => !o.isMesh && o.name === nm); if (!ch) { ch = new THREE.Group(); ch.name = nm; node.add(ch); } node = ch; } return node; };
  // R yansima icermez (donme matrisi), ucgen yonu korunur
  for (const e of merged.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(e.P, 3)); g.setIndex(e.I);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: e.mat })); mesh.name = e.name + (e.side ? '.' + e.side : '');
    groupAt(e.path).add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}
