// levels.mjs: vertebral levels and landmarks along y, to translate a y value (cm) into a vertebral level and back.
// Usage: node tools/_sectionwork/levels.mjs [y ...]      (prints the table; with y values also their levels)
// Module: import { levels, levelOf, yOf } from './levels.mjs';
//   await levels()  -> { vert: [{ name, ylo, yhi, yc, zc }], discs: [{ name, ylo, yhi, yc }], land: [{ name, y, p }] }
//   await levelOf(y) -> "Th12 (lower third)" | "disc L1/L2" | "above C1" ...
//   await yOf('Th8') -> centre y of that vertebral body (also 'L1/L2' for a disc centre)
// Vertebral body: the vertebra's vertices within the disc column, i.e. within 0.9 x the disc radius of the line through
// the centroids of the discs above and below (for C2 and L5 / T1 likewise; the line is vertical where only one disc
// exists). C1 has no body: its anterior arch is used. Sacrum and coccyx: whole bone (male body). Discs: whole disc.
// Discs are tilted, so the y range of a body and of its neighbouring disc overlap by a few mm at the front or the back;
// levelOf uses the centres: a y between two body centres is in the body whose centre is nearer, unless it is within the
// disc's central half-thickness, then "disc".
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './slice.mjs';
import { centroidOf } from './where.mjs';

const NAMES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', ...Array.from({ length: 12 }, (_, i) => `Th${i + 1}`), 'L1', 'L2', 'L3', 'L4', 'L5'];
const meshName = v => v === 'C1' ? 'Atlas (C1)' : v === 'C2' ? 'Axis (C2)' : `Vertebra ${v.replace('Th', 'T')}`;
const discName = (a, b) => `Intervertebral disc ${a.replace('Th', 'T')}-${b.replace('Th', 'T')}`;
const r2 = v => Math.round(v * 100) / 100;

let CACHE = null;
export async function levels() {
  if (CACHE) return CACHE;
  const db = await load({ quiet: true });
  const byName = (n, sd) => db.meta.items.filter(i => i.n === n && (!sd || i.sd === sd) && i.x !== 'f' && db.parts.has(i.id)).map(i => db.parts.get(i.id));
  const one = (n, sd) => byName(n, sd)[0];
  const verts = p => { const a = []; for (let k = 0; k < p.P.length; k += 3) a.push([p.P[k], p.P[k + 1], p.P[k + 2]]); return a; };
  // discs
  const discs = [];
  const order = [...NAMES, 'S1'];
  for (let i = 1; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1]; const p = one(discName(a, b)); if (!p) continue;
    const c = centroidOf(p); const V = verts(p);
    discs.push({ name: `${a}/${b}`, upper: a, lower: b, ylo: r2(p.mn[1]), yhi: r2(p.mx[1]), yc: r2(c[1]), c, V });
  }
  const discAbove = v => discs.find(d => d.lower === v), discBelow = v => discs.find(d => d.upper === v);
  const vert = [];
  for (const v of NAMES) {
    const p = one(meshName(v)); if (!p) continue;
    const V = verts(p); let sel;
    if (v === 'C1') {   // anterior arch: the most anterior 25 % of the atlas
      const z0 = p.mn[2] + 0.75 * (p.mx[2] - p.mn[2]); sel = V.filter(q => q[2] >= z0);
    } else {
      const up = discAbove(v), dn = discBelow(v);
      const A = (dn || up).c, B = up && dn ? up.c : [A[0], A[1] + 1, A[2]];
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; const L = Math.hypot(...d); const u = d.map(x => x / L);
      const ref = dn || up; let r = 0;
      { const rs = ref.V.map(q => { const w = [q[0] - ref.c[0], q[1] - ref.c[1], q[2] - ref.c[2]]; const t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
          return Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]); }).sort((a, b) => a - b); r = rs[Math.floor(rs.length * 0.9)]; }
      sel = V.filter(q => { const w = [q[0] - A[0], q[1] - A[1], q[2] - A[2]]; const t = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
        return Math.hypot(w[0] - t * u[0], w[1] - t * u[1], w[2] - t * u[2]) <= 0.9 * r; });
      if (v === 'C2') sel = sel.filter(q => q[1] <= dn.c[1] + 2.0);   // without the dens
    }
    let lo = Infinity, hi = -Infinity, zs = 0; for (const q of sel) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); zs += q[2]; }
    vert.push({ name: v, ylo: r2(lo), yhi: r2(hi), yc: r2((lo + hi) / 2), zc: r2(zs / sel.length), n: sel.length });
  }
  for (const n of ['Sacrum', 'Coccyx']) { const p = one(n); if (p) vert.push({ name: n === 'Sacrum' ? 'S' : 'Co', ylo: r2(p.mn[1]), yhi: r2(p.mx[1]), yc: r2((p.mn[1] + p.mx[1]) / 2), zc: null }); }
  // landmarks
  const land = [];
  const man = one('Manubrium of sternum'), bod = one('Body of sternum'), xi = one('Xiphoid process');
  if (man && bod) {   // junction: lowest manubrium vertices vs highest body vertices (anterior surface)
    const y = (man.mn[1] + bod.mx[1]) / 2; land.push({ name: 'Angulus sterni (manubriosternal junction)', y: r2(y) });
  }
  if (man) land.push({ name: 'Incisura jugularis (manubrium top)', y: r2(man.mx[1]) });
  if (xi) land.push({ name: 'Processus xiphoideus (top .. tip)', y: r2(xi.mx[1]), y2: r2(xi.mn[1]) });
  for (const sd of ['l', 'r']) {
    const hip = one('Hip bone', sd); if (hip) land.push({ name: `Crista iliaca top (${sd})`, y: r2(hip.mx[1]) });
  }
  for (const sd of ['l', 'r']) {
    const f = one('Femur', sd); if (!f) continue;
    // femoral head: sphere fit to the vertices within 3 cm of the highest point of the femur
    const V = verts(f); let top = V[0]; for (const q of V) if (q[1] > top[1]) top = q;
    const S = V.filter(q => Math.hypot(q[0] - top[0], q[1] - top[1], q[2] - top[2]) < 3.0);
    const c = sphereFit(S); land.push({ name: `Caput femoris centre (${sd})`, y: r2(c[1]), p: c.slice(0, 3).map(r2), r: r2(c[3]) });
  }
  const sy = one('Pubic symphysis'); if (sy) land.push({ name: 'Symphysis pubica (top .. bottom)', y: r2(sy.mx[1]), y2: r2(sy.mn[1]) });
  land.push({ name: 'Umbilicus', y: null, note: 'not modelled (no skin / umbilical ring part)' });
  for (const d of discs) { delete d.V; delete d.c; }
  CACHE = { vert, discs, land };
  return CACHE;
}

function sphereFit(S) {   // algebraic least squares: x^2+y^2+z^2 = 2ax+2by+2cz+d
  const M = Array.from({ length: 4 }, () => [0, 0, 0, 0]), R = [0, 0, 0, 0];
  for (const [x, y, z] of S) { const row = [2 * x, 2 * y, 2 * z, 1], f = x * x + y * y + z * z;
    for (let i = 0; i < 4; i++) { R[i] += row[i] * f; for (let j = 0; j < 4; j++) M[i][j] += row[i] * row[j]; } }
  for (let i = 0; i < 4; i++) { let p = i; for (let k = i + 1; k < 4; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]]; [R[i], R[p]] = [R[p], R[i]];
    for (let k = 0; k < 4; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = 0; j < 4; j++) M[k][j] -= f * M[i][j]; R[k] -= f * R[i]; } }
  const a = R[0] / M[0][0], b = R[1] / M[1][1], c = R[2] / M[2][2], d = R[3] / M[3][3];
  return [a, b, c, Math.sqrt(d + a * a + b * b + c * c)];
}

// "Th12 (lower third)", "disc L1/L2", "S (sacrum)", "above C1", "below coccyx"
export async function levelOf(y) {
  const { vert, discs } = await levels();
  const V = vert.filter(v => v.name !== 'Co' && v.name !== 'S');
  for (const d of discs) {   // central part of the disc (between the two body ranges)
    const up = V.find(v => v.name === d.upper), dn = V.find(v => v.name === d.lower) || vert.find(v => v.name === 'S');
    const lo = dn.name === 'S' ? Math.min(dn.yhi, d.yc) : dn.yhi, hi = up.ylo;
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    if (y >= (a + d.yc) / 2 - 0.05 && y <= (b + d.yc) / 2 + 0.05 && y >= d.ylo && y <= d.yhi) return `disc ${d.name}`;
  }
  let best = null, bd = Infinity;
  for (const v of vert) { const d = y < v.ylo ? v.ylo - y : y > v.yhi ? y - v.yhi : 0; if (d < bd || (d === bd && best && Math.abs(y - v.yc) < Math.abs(y - best.yc))) { bd = d; best = v; } }
  if (bd > 0.6) { if (y > vert[0].yhi) return `above C1 (+${(y - vert[0].yhi).toFixed(1)} cm)`;
    const co = vert.find(v => v.name === 'Co'); if (co && y < co.ylo) return `below coccyx (-${(co.ylo - y).toFixed(1)} cm)`; }
  if (best.name === 'S') return `S (sacrum, ${((best.yhi - y) / (best.yhi - best.ylo) * 100).toFixed(0)} % from the top)`;
  if (best.name === 'Co') return 'Co (coccyx)';
  const f = (best.yhi - y) / (best.yhi - best.ylo);
  return `${best.name} (${f < 0 ? 'above upper end plate' : f > 1 ? 'below lower end plate' : f < 1 / 3 ? 'upper third' : f < 2 / 3 ? 'middle third' : 'lower third'})`;
}

// y of a vertebral body centre ('Th8'), a disc centre ('L1/L2') or a landmark name fragment
export async function yOf(name) {
  const { vert, discs, land } = await levels();
  const v = vert.find(v => v.name === name.replace(/^T(\d)/, 'Th$1')); if (v) return v.yc;
  const d = discs.find(d => d.name === name.replace(/T(\d)/g, 'Th$1')); if (d) return d.yc;
  const l = land.find(l => l.name.toLowerCase().includes(name.toLowerCase())); return l ? l.y : null;
}

// CLI in a function, not top-level await: the dynamic import of a sibling tool would deadlock on this module
async function main() {
  const { vert, discs, land } = await levels();
  console.log('Vertebral bodies (y cm; body = part of the vertebra inside the disc column)');
  console.log('level  y low   y high  centre  z centre');
  for (const v of vert) {
    console.log(`${v.name.padEnd(5)} ${v.ylo.toFixed(2).padStart(7)} ${v.yhi.toFixed(2).padStart(7)} ${v.yc.toFixed(2).padStart(7)} ${v.zc == null ? '' : v.zc.toFixed(2).padStart(7)}`);
    const d = discs.find(d => d.upper === v.name); if (d) console.log(`  disc ${d.name.padEnd(6)} ${d.ylo.toFixed(2).padStart(7)} ${d.yhi.toFixed(2).padStart(7)} ${d.yc.toFixed(2).padStart(7)}  (whole disc)`);
  }
  console.log('\nLandmarks');
  for (const l of land) console.log(`${l.name.padEnd(42)} ${l.y == null ? l.note : `y ${l.y}${l.y2 != null ? ` .. ${l.y2}` : ''}${l.p ? `  p (${l.p.join(', ')}) r ${l.r}` : ''}  -> ${await levelOf(l.y)}${l.y2 != null ? ` .. ${await levelOf(l.y2)}` : ''}`}`);
  for (const a of process.argv.slice(2)) if (!isNaN(+a)) console.log(`y ${a} -> ${await levelOf(+a)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
