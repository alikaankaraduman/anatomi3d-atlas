// where.mjs: bounding box and centroid of every part whose name matches, so a plane can be put through a structure.
// Usage: node tools/_sectionwork/where.mjs "<part name or a fragment>" [--exact]
// Matches the English name (n) case-insensitively: an exact name first, else every name containing the fragment;
// also matches the Latin (la) and German (de) names and the id. Centroid = mean of the mesh's welded vertices weighted
// by area (surface centroid); bbox in cm, world coordinates (+x = body's left, +y = cranial, +z = anterior).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, fills } from './slice.mjs';

// surface-area-weighted centroid of a part
export function centroidOf(part) {
  const { P, I } = part; let w = 0; const c = [0, 0, 0];
  for (let k = 0; k < I.length; k += 3) {
    const a = 3 * I[k], b = 3 * I[k + 1], d = 3 * I[k + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    for (let q = 0; q < 3; q++) c[q] += ar * (P[a + q] + P[b + q] + P[d + q]) / 3; w += ar;
  }
  return c.map(v => v / w);
}

export async function where(q, { exact = false } = {}) {
  const db = await load({ quiet: true }); const ql = q.toLowerCase();
  let hits = db.meta.items.filter(i => i.n.toLowerCase() === ql || i.id === q);
  if (!hits.length && !exact) hits = db.meta.items.filter(i => [i.n, i.la, i.de].some(s => s && s.toLowerCase().includes(ql)));
  return hits.filter(i => db.parts.has(i.id)).map(i => {
    const p = db.parts.get(i.id);
    return { id: i.id, n: i.n, la: i.la, de: i.de, s: i.s, sub: i.sub, sd: i.sd || '', x: i.x || '', fill: fills(i, db),
      open: !!i.o, mn: p.mn.map(r2), mx: p.mx.map(r2), c: centroidOf(p).map(r2) };
  });
}
const r2 = v => Math.round(v * 100) / 100;

// CLI in a function, not top-level await: the dynamic import of a sibling tool would deadlock on this module
async function main() {
  const q = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ');
  if (!q) { console.log('usage: node tools/_sectionwork/where.mjs "<part name or fragment>" [--exact]'); process.exit(1); }
  const r = await where(q, { exact: process.argv.includes('--exact') });
  if (!r.length) { console.log('no match'); process.exit(1); }
  let lv = null; try { lv = (await import('./levels.mjs')).levelOf; } catch { }
  const f = a => `(${a.map(v => v.toFixed(1)).join(', ')})`;
  for (const p of r) {
    console.log(`${p.id.padEnd(6)} ${p.n}${p.sd ? ` [${p.sd}]` : ''}${p.x ? ` {${p.x}}` : ''}  ${p.la || ''} / ${p.de || ''}  ${p.s}/${p.sub}${p.open ? ' open' : ''} fill=${p.fill ? 'yes' : 'no'}`);
    console.log(`       bbox min ${f(p.mn)} max ${f(p.mx)}  centroid ${f(p.c)}` +
      (lv ? `  y: ${await lv(p.mn[1])} .. ${await lv(p.mx[1])}, centroid ${await lv(p.c[1])}` : ''));
  }
  if (r.length > 40) console.log(`${r.length} matches`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
