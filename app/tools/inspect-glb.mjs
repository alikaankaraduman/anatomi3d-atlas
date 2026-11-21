// Bir GLB dosyasini cozmeden ozetler: kullanilan eklentiler, dugum agaci, ag adlari, kose/ucgen sayilari,
// malzemeler ve dunya koordinatlarinda sinirlar (erisimci min/max + dugum donusumleri).
// Kullanim: node tools/inspect-glb.mjs <dosya.glb> [...]
import fs from 'node:fs';
import { Matrix4, Vector3, Quaternion, Box3 } from 'three';

function readGLB(file) {
  const b = fs.readFileSync(file);
  if (b.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: GLB degil`);
  const len = b.readUInt32LE(12);
  if (b.toString('utf8', 16, 20) !== 'JSON') throw new Error(`${file}: ilk parca JSON degil`);
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}

for (const file of process.argv.slice(2)) {
  const j = readGLB(file);
  console.log(`\n# ${file}`);
  console.log(`  asset: ${JSON.stringify(j.asset)}; eklentiler: ${(j.extensionsUsed || []).join(', ') || '-'}`);
  console.log(`  dugum ${j.nodes?.length || 0}, ag ${j.meshes?.length || 0}, malzeme ${(j.materials || []).map(m => m.name).join(' | ') || '-'}`);
  const world = new Box3();
  const local = (n) => {
    const m = new Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new Vector3(...(n.translation || [0, 0, 0])), new Quaternion(...(n.rotation || [0, 0, 0, 1])), new Vector3(...(n.scale || [1, 1, 1])));
    return m;
  };
  const visit = (ni, parentM, depth) => {
    const n = j.nodes[ni]; const M = parentM.clone().multiply(local(n));
    let line = `  ${'  '.repeat(depth)}- ${n.name ?? '(adsiz)'}`;
    if (n.mesh !== undefined) {
      const mesh = j.meshes[n.mesh]; let verts = 0, tris = 0; const box = new Box3();
      for (const p of mesh.primitives) {
        const acc = j.accessors[p.attributes.POSITION]; verts += acc.count;
        tris += p.indices !== undefined ? j.accessors[p.indices].count / 3 : acc.count / 3;
        if (acc.min && acc.max) {
          for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) box.expandByPoint(new Vector3(x, y, z).applyMatrix4(M));
        }
      }
      world.union(box);
      const mats = [...new Set(mesh.primitives.map(p => j.materials?.[p.material]?.name ?? '-'))].join('+');
      const f = v => v.toArray().map(x => +x.toFixed(4)).join(', ');
      line += `  [ag "${mesh.name ?? ''}", kose ${verts}, ucgen ${tris}, malzeme ${mats}] min (${f(box.min)}) max (${f(box.max)})`;
    }
    console.log(line);
    for (const c of n.children || []) visit(c, M, depth + 1);
  };
  const scene = j.scenes?.[j.scene ?? 0];
  for (const ni of scene?.nodes || []) visit(ni, new Matrix4(), 0);
  const s = new Vector3(); world.getSize(s);
  console.log(`  dunya sinirlari: min (${world.min.toArray().map(v => +v.toFixed(4))}) max (${world.max.toArray().map(v => +v.toFixed(4))}) boyut (${s.toArray().map(v => +v.toFixed(4))})`);
}
