// Bir Z-Anatomy FBX dosyasinin yapisini ozetler: isim son ekleri, malzemeler, grup agaci, benzersiz isimler.
// Kullanim: node tools/inspect.mjs <dosya.fbx> [--names] [--tree=4]
import { loadFBX, THREE } from './fbxnode.mjs';
import { isLabelLine, isAttach, origName } from './geom.mjs';

const file = process.argv[2];
const wantNames = process.argv.includes('--names');
const treeDepth = +(process.argv.find(a => a.startsWith('--tree='))?.slice(7) ?? 3);
const root = loadFBX(file);

const box = new THREE.Box3(); const bySuf = new Map(); let meshes = 0, verts = 0;
root.traverse(o => {
  if (o === root) return;
  const name = origName(o);
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  const key = (o.isMesh ? 'M:' : 'G:') + (m ? '.' + m[1].replace(/\d+/g, '#') : '(none)');
  if (!bySuf.has(key)) bySuf.set(key, { count: 0, verts: 0, samples: [], mats: {} });
  const e = bySuf.get(key); e.count++;
  if (e.samples.length < 5) e.samples.push(name);
  if (o.isMesh) {
    const n = o.geometry.attributes.position.count; e.verts += n; meshes++; verts += n;
    for (const mt of (Array.isArray(o.material) ? o.material : [o.material])) e.mats[mt.name] = (e.mats[mt.name] || 0) + 1;
    if (n) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
  }
});
console.log(`# ${file}\nmesh ${meshes}, kose ${verts}, kutu ${box.min.toArray().map(v => v.toFixed(1))} .. ${box.max.toArray().map(v => v.toFixed(1))}`);
for (const [k, e] of [...bySuf].sort((a, b) => b[1].verts - a[1].verts || b[1].count - a[1].count)) {
  const mats = Object.entries(e.mats).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n}:${c}`).join(', ');
  console.log(`${k.padEnd(12)} adet=${String(e.count).padEnd(5)} kose=${String(e.verts).padEnd(8)} orn: ${e.samples.join(' | ')}${mats ? '\n             malzeme: ' + mats : ''}`);
}

// gercek (secilebilir) mesh'ler
const reals = []; root.traverse(o => { if (o.isMesh && o.geometry.attributes.position.count > 0 && !isLabelLine(origName(o))) reals.push(o); });
const attach = reals.filter(o => isAttach(origName(o))).length;
console.log(`\ngercek mesh: ${reals.length} (yapisma yamasi desenine uyan: ${attach})`);

// malzeme birlesimleri
const combos = {};
for (const o of reals) { const k = (Array.isArray(o.material) ? o.material : [o.material]).map(m => m.name).join('+'); (combos[k] ??= []).push(origName(o)); }
console.log('\n## malzeme birlesimleri');
for (const [k, v] of Object.entries(combos).sort((a, b) => b[1].length - a[1].length)) console.log(`${k}  [${v.length}]  ${v.slice(0, 3).join(' | ')}`);

// grup agaci
console.log(`\n## grup agaci (.g), derinlik ${treeDepth}`);
const countReal = o => { let n = 0; o.traverse(c => { if (c !== o && c.isMesh && c.geometry.attributes.position.count > 0 && !isLabelLine(origName(c))) n++; }); return n; };
(function walk(o, d) {
  for (const c of o.children) {
    const n = origName(c);
    if (!c.isMesh && /\.g$/.test(n)) { if (d < treeDepth) console.log('  '.repeat(d) + n + ` (${countReal(c)})`); walk(c, d + 1); }
  }
})(root, 0);

if (wantNames) {
  const base = n => n.replace(/\.[rl]$/, '');
  const chainOf = o => { const c = []; for (let p = o.parent; p && p !== root; p = p.parent) c.unshift(origName(p)); return c; };
  const byTop = {};
  for (const o of reals) { const top = chainOf(o).filter(c => /\.g$/.test(c)).slice(0, 2).join(' > ') || '(kok)'; (byTop[top] ??= new Set()).add(base(origName(o))); }
  let total = new Set();
  for (const [t, s] of Object.entries(byTop)) { console.log(`\n## ${t} (${s.size})\n` + [...s].join(' | ')); for (const n of s) total.add(n); }
  console.log(`\nbenzersiz isim: ${total.size}`);
}
