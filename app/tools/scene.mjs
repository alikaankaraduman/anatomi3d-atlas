// Donusturulmus modelleri Node'da okur (public/models/*.glb + public/data/meta.json): her parca icin dunya
// koordinatlarinda (cm) konumlar ve ucgen indisleri. Yerlesim ve carpisma olcumleri icin (tools/collide.mjs).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

// files: okunacak model dosyalari (uzantisiz; verilmezse public/models altindaki hepsi)
// keep : meta kaydina gore parca secimi (it => boolean)
export async function loadScene({ files, keep } = {}) {
  await MeshoptDecoder.ready;
  const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
  const byId = new Map(meta.items.map(it => [it.id, it]));
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const names = files ?? fs.readdirSync('public/models').filter(f => f.endsWith('.glb')).map(f => f.replace(/\.glb$/, ''));
  const parts = []; const e = [0, 0, 0];
  for (const f of names) {
    const doc = await io.read(`public/models/${f}.glb`);
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue;
      const it = byId.get(node.getName()); if (!it || (keep && !keep(it))) continue;
      const M = node.getWorldMatrix(); const prim = mesh.listPrimitives()[0];
      const pos = prim.getAttribute('POSITION'); const n = pos.getCount(); const P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos.getElement(i, e);   // normalize edilmis tamsayilar burada kayan noktaya cevrilir
        P[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
        P[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
        P[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
      }
      parts.push({ ...it, file: f, P, I: Uint32Array.from(prim.getIndices().getArray()) });
    }
  }
  return { meta, parts };
}

export const label = p => p.n + (p.sd ? '.' + p.sd : '') + (p.x ? ` [${p.x}]` : '');
export function bounds(P) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) { const v = P[k + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  return { mn, mx };
}
