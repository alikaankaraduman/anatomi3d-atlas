// Açık (çift yüzlü çizilen) parçaların ne kadar açık olduğu: sınır kenarlarının toplam uzunluğu / √(yüzey alanı).
// Küçük delikli kapalı yüzey ~0-0.5 (beyin girusları, köprü, akciğer lopları, karaciğer), uçları açık tüp ~0.5-3
// (damar, bronş, üreter), levha ve kesik yüzey > 3 (fasya, uterus gövdesi). meta.mjs bu oranla neredeyse kapalı açık
// parçaları işaretler (c: 1): kesitte dolu çizilebilirler; delikten kaçan ışınlar yalnızca deliğin izdüşümünde küçük
// bir hata bırakır. Kenarlar konuma göre birleştirilmiş köşelerle sayılır (malzeme sınırındaki ikiz köşeler sınır sayılmaz).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { clusterByPosition, surfaceArea } from './geom.mjs';

// ids: bakılacak parça kimlikleri (Set). Dönüş: kimlik -> oran
export async function boundaryRatios(ids) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const out = new Map(); const e = [0, 0, 0];
  for (const f of fs.readdirSync('public/models').filter(f => f.endsWith('.glb'))) {
    const doc = await io.read(`public/models/${f}`);
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh || !ids.has(node.getName())) continue;
      const M = node.getWorldMatrix(); const prim = mesh.listPrimitives()[0];
      const pos = prim.getAttribute('POSITION'); const n = pos.getCount(); const P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos.getElement(i, e);
        P[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
        P[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
        P[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
      }
      const I = prim.getIndices().getArray();
      const { cluster, count } = clusterByPosition(P);
      const first = new Int32Array(count).fill(-1);
      for (let i = 0; i < n; i++) if (first[cluster[i]] < 0) first[cluster[i]] = i;
      const edges = new Map();
      for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = cluster[I[t + k]], b = cluster[I[t + (k + 1) % 3]]; if (a === b) continue;
        const key = a < b ? a * count + b : b * count + a; edges.set(key, (edges.get(key) || 0) + 1);
      }
      let len = 0;
      for (const [key, c] of edges) {
        if (c !== 1) continue;
        const pa = first[Math.floor(key / count)] * 3, pb = first[key % count] * 3;
        len += Math.hypot(P[pa] - P[pb], P[pa + 1] - P[pb + 1], P[pa + 2] - P[pb + 2]);
      }
      out.set(node.getName(), len / Math.sqrt(Math.max(surfaceArea(P, I), 1e-9)));
    }
  }
  return out;
}
