// Sikistirilmamis GLB okuyucu (HRA modelleri gibi): her ag icin dunya koordinatlarinda konumlar ve ucgen indisleri.
// Sikistirma eklentisi (Draco, meshopt) ya da seyrek erisimci desteklenmez; karsilasilirsa hata verir.
import fs from 'node:fs';
import { Matrix4, Vector3, Quaternion } from 'three';

export function readGLB(file) {
  const b = fs.readFileSync(file);
  if (b.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: GLB degil`);
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.toString('utf8', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(b.toString('utf8', off + 8, off + 8 + len));
    else if (type === 'BIN\0') bin = b.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const bad = (json.extensionsUsed || []).filter(e => /draco|meshopt|quantization/i.test(e));
  if (bad.length) throw new Error(`${file}: desteklenmeyen eklenti ${bad.join(', ')}`);
  return { json, bin };
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(json, bin, i) {
  const a = json.accessors[i]; if (a.sparse) throw new Error('seyrek erisimci desteklenmiyor');
  const bv = json.bufferViews[a.bufferView]; const [Arr, bytes] = COMP[a.componentType]; const n = SIZE[a.type];
  const stride = bv.byteStride || n * bytes; const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](base + k * stride + c * bytes, true);
  void Arr;
  return out;
}

// [{ name, path: [ust dugum adlari], material, P: Float32Array (dunya), idx: Uint32Array }]
export function readGLBMeshes(file) {
  const { json, bin } = readGLB(file);
  const out = [];
  const local = n => {
    const m = new Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new Vector3(...(n.translation || [0, 0, 0])), new Quaternion(...(n.rotation || [0, 0, 0, 1])), new Vector3(...(n.scale || [1, 1, 1])));
    return m;
  };
  const visit = (ni, parentM, path) => {
    const n = json.nodes[ni]; const M = parentM.clone().multiply(local(n)); const flip = M.determinant() < 0;
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh];
      for (const [pi, p] of mesh.primitives.entries()) {
        if (p.mode !== undefined && p.mode !== 4) continue;   // yalniz ucgenler
        const pos = accessor(json, bin, p.attributes.POSITION); const nv = pos.length / 3;
        const P = new Float32Array(pos.length); const v = new Vector3();
        for (let k = 0; k < nv; k++) { v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).applyMatrix4(M); P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z; }
        const idx = p.indices !== undefined ? Uint32Array.from(accessor(json, bin, p.indices)) : Uint32Array.from({ length: nv }, (_, k) => k);
        if (flip) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
        out.push({ name: (n.name ?? mesh.name ?? 'mesh') + (mesh.primitives.length > 1 ? `#${pi}` : ''), path, material: json.materials?.[p.material]?.name ?? '', P, idx });
      }
    }
    for (const c of n.children || []) visit(c, M, [...path, n.name ?? '']);
  };
  for (const ni of json.scenes[json.scene ?? 0].nodes) visit(ni, new Matrix4(), []);
  return out;
}
