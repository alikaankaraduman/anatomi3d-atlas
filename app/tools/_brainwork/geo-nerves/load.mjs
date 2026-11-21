// Node-only loader for the geo-nerves research scripts (NOT for the browser).
// Reads meta.json and decodes the meshopt GLBs like tools/openness.mjs; for each wanted node id returns world-space
// positions P (Float32Array) and indices I (Uint32Array), taking the primitive with the most indices among the node's
// own mesh and its child meshes (the app does the same in model.js).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export function loadMeta() {
  return JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
}

const FILES = { bone: ['bones', 'femalepelvis', 'attach', 'attachm', 'attachf'], muscle: ['muscles'], nerve: ['nerves'], vessel: ['vessels'],
  organ: ['organs', 'lymph', 'female', 'breasts', 'vulva', 'urethra', 'bartholin'], joint: ['joints', 'femalejoints'] };

// ids: Set of part ids; systems: which systems' files to scan. Returns Map id -> { P, I }
export async function loadParts(ids, systems) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const out = new Map(); const e = [0, 0, 0];
  const files = [...new Set(systems.flatMap(s => FILES[s]))];
  for (const f of files) {
    const path = `public/models/${f}.glb`; if (!fs.existsSync(path)) continue;
    const doc = await io.read(path);
    for (const node of doc.getRoot().listNodes()) {
      const name = node.getName(); if (!ids.has(name) || out.has(name)) continue;
      const cands = [];
      const add = n => { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) if (p.getIndices()) cands.push({ n, p }); };
      add(node); for (const c of node.listChildren()) add(c);
      if (!cands.length) continue;
      cands.sort((a, b) => b.p.getIndices().getCount() - a.p.getIndices().getCount());
      const { n, p } = cands[0];
      const M = n.getWorldMatrix(); const pos = p.getAttribute('POSITION'); const cnt = pos.getCount(); const P = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        pos.getElement(i, e);
        P[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
        P[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
        P[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
      }
      out.set(name, { P, I: Uint32Array.from(p.getIndices().getArray()), file: f });
    }
  }
  return out;
}
