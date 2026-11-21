// FBX mesh'inden dunya koordinatlarinda geometri cikarma + kaynak (weld) yardimcilari.
import { THREE } from './fbxnode.mjs';

const Q = 1000; // 0.001 cm hassasiyetle kaynak

export function extract(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count;
  const m = mesh.matrixWorld;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const flip = m.determinant() < 0;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), M = new Uint8Array(n);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
  }
  if (g.groups.length) for (const gr of g.groups) for (let i = gr.start; i < gr.start + gr.count && i < n; i++) M[i] = gr.materialIndex;
  let idx;
  if (g.index) idx = Uint32Array.from(g.index.array);
  else { idx = new Uint32Array(n - (n % 3)); for (let i = 0; i < idx.length; i++) idx[i] = i; }
  if (flip) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return { P, N, M, idx, hasNormals: !!nor };
}

// mode: 'pos' | 'posmat' | 'posnor' | 'posnormat'
export function weld({ P, N, M, idx }, mode = 'posmat') {
  const useN = mode.includes('nor'), useM = mode.includes('mat');
  const map = new Map(); const remap = new Uint32Array(P.length / 3);
  const oP = [], oN = [], oM = [];
  for (let i = 0; i < remap.length; i++) {
    let key = Math.round(P[i * 3] * Q) + ',' + Math.round(P[i * 3 + 1] * Q) + ',' + Math.round(P[i * 3 + 2] * Q);
    if (useN) key += ',' + Math.round(N[i * 3] * 50) + ',' + Math.round(N[i * 3 + 1] * 50) + ',' + Math.round(N[i * 3 + 2] * 50);
    if (useM) key += ',' + M[i];
    let j = map.get(key);
    if (j === undefined) { j = oM.length; map.set(key, j); oP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); oN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); oM.push(M[i]); }
    remap[i] = j;
  }
  // dejenere ucgenleri at
  const out = [];
  for (let i = 0; i < idx.length; i += 3) { const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]]; if (a !== b && b !== c && a !== c) out.push(a, b, c); }
  return { P: new Float32Array(oP), N: new Float32Array(oN), M: Uint8Array.from(oM), idx: Uint32Array.from(out) };
}

// Koseleri konuma gore kumeler (malzeme dikislerinde cogaltilmis koseler ayni kumeye duser).
export function clusterByPosition(P) {
  const nV = P.length / 3; const cluster = new Uint32Array(nV); const map = new Map(); let count = 0;
  for (let i = 0; i < nV; i++) {
    const key = Math.round(P[i * 3] * Q) + ',' + Math.round(P[i * 3 + 1] * Q) + ',' + Math.round(P[i * 3 + 2] * Q);
    let j = map.get(key); if (j === undefined) { j = count++; map.set(key, j); } cluster[i] = j;
  }
  return { cluster, count };
}

// Alan agirlikli puruzsuz normaller (konum kumelerine gore: malzeme dikisleri normalde kirilma yaratmaz).
export function smoothNormals(P, idx, cluster, count) {
  const nV = P.length / 3; const acc = new Float64Array(count * 3);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // uzunluk = 2*alan
    for (const k of [idx[i], idx[i + 1], idx[i + 2]]) { const ci = cluster[k] * 3; acc[ci] += nx; acc[ci + 1] += ny; acc[ci + 2] += nz; }
  }
  const N = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) { const ci = cluster[i] * 3; const l = Math.hypot(acc[ci], acc[ci + 1], acc[ci + 2]) || 1; N[i * 3] = acc[ci] / l; N[i * 3 + 1] = acc[ci + 1] / l; N[i * 3 + 2] = acc[ci + 2] / l; }
  return N;
}

// Topoloji: ag kapali mi (her kenar tam iki ucgende, zit yonlerde)? Kapaliysa her bagli parcanin
// yonunu isaretli hacimle dogrular; ice bakan parcalarin ucgenlerini cevirir (idx yerinde degisir).
// Kapali aglar tek yuzlu (arka yuz ayiklamali) cizilebilir -> belirgin hiz kazanci.
// badTol: toplam kenar sayisina oranla izin verilen manifold-disi kenar orani (delik = sinir kenari hic kabul edilmez).
export function orient(P, idx, cluster, count, flip = true, badTol = 0.005) {
  const edges = new Map(); let degenerate = 0;
  const add = (u, v) => { const f = u < v; const key = f ? u * count + v : v * count + u; const cur = edges.get(key) || 0; edges.set(key, cur + (f ? 1 : 1000)); };
  const parent = new Uint32Array(count); for (let i = 0; i < count; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < idx.length; i += 3) {
    const a = cluster[idx[i]], b = cluster[idx[i + 1]], c = cluster[idx[i + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    add(a, b); add(b, c); add(c, a);
    const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra;
    const rc = find(c), r2 = find(a); if (rc !== r2) parent[rc] = r2;
  }
  let boundary = 0, bad = 0;
  for (const v of edges.values()) { if (v === 1001) continue; if (v === 1 || v === 1000) boundary++; else bad++; }
  const closed = boundary === 0 && edges.size > 0 && bad <= badTol * edges.size;
  let flipped = 0, components = 0;
  if (closed && flip) {
    const vol = new Map();
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const v = P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
      const r = find(cluster[idx[i]]); vol.set(r, (vol.get(r) || 0) + v);
    }
    components = vol.size;
    for (let i = 0; i < idx.length; i += 3) {
      if (vol.get(find(cluster[idx[i]])) < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; flipped++; }
    }
  }
  return { closed, boundary, bad, flipped, components, degenerate, edges: edges.size };
}

// Toplam yuzey alani (cm^2) ve isaretli hacim (cm^3): sadelestirmenin sekli bozup bozmadigini olcmek icin.
export function surfaceArea(P, idx) {
  let a = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const A = idx[i] * 3, B = idx[i + 1] * 3, C = idx[i + 2] * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2];
    const vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}
export function signedVolume(P, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

export const isLabelLine = n => /\.[ji]$/.test(n);
export const isAttach = n => /\.[oe]\d*[rl]?$/.test(n);
export const origName = o => o.userData.originalName ?? o.name;
