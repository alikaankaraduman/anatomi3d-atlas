// Bacak hareketi kinematiği denetimi (src/motion-kin-leg.js + public/data/motion-leg.json). Çalıştırma (app/ içinde):
//   node tools/_qawork/motion-leg-test.mjs
import fs from 'node:fs';
import * as K from '../../src/motion-kin-leg.js';
const data = JSON.parse(fs.readFileSync('public/data/motion-leg.json', 'utf8'));
const M = K.createModel(data), o = K.createFk(M);
let n = 0, bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log('HATA: ' + msg); } };
const P = q => { K.fk(M, K.clampPose(M, { ...M.rest, ...q }, {}), o); return { knee: [...o.pts.knee], ankle: [...o.pts.ankle], toe: [...o.pts.toe], mats: Float64Array.from(o.mats) }; };
const tp = (m, i, p) => { const k = 16 * i; return [m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12], m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13], m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14]]; };
const r = P({});
for (let i = 0; i < 16 * 6; i++) ok(Math.abs(r.mats[i] - (i % 16 % 5 === 0 ? 1 : 0)) < 1e-9, 'dinlenmede birim değil: ' + i);
ok(Math.hypot(...r.knee.map((v, i) => v - M.J.knee[i])) < 1e-9, 'dinlenmede diz yerinde değil');
const d = (a, b, k) => a[k] - b[k];
const f = P({ hipFlex: 60 }); ok(d(f.knee, r.knee, 2) > 15, 'kalça fleksiyonunda diz öne gitmiyor');
const ab = P({ hipAbd: 30 }); ok(d(ab.knee, r.knee, 0) > 10, 'abduksiyonda diz dışa (+x) gitmiyor');
const kf = P({ knee: 90 }); ok(d(kf.ankle, r.ankle, 2) < -20, 'diz fleksiyonunda ayak bileği arkaya gitmiyor');
const df = P({ ankle: 20 }); ok(d(df.toe, r.toe, 1) > 1, 'dorsalekstansiyonda ayak ucu yukarı gitmiyor');
const pf = P({ ankle: -40 }); ok(d(pf.toe, r.toe, 1) < -2, 'plantarfleksiyonda ayak ucu aşağı gitmiyor');
// supinasyon: 5. metatarsal (dış kenar) yukarı, 1. metatarsal (iç kenar) aşağı
const lat = [M.J.ankle[0] + 3, M.J.ankle[1] - 5, M.J.ankle[2] + 10], med = [M.J.ankle[0] - 3, M.J.ankle[1] - 5, M.J.ankle[2] + 10];
const su = P({ subtalar: -25 }); ok(tp(su.mats, 5, lat)[1] - lat[1] > tp(su.mats, 5, med)[1] - med[1] + 0.5, 'supinasyonda dış kenar iç kenardan yukarı kalkmıyor');
const ir = P({ hipFlex: 90, knee: 90, hipRot: 30 }), ir0 = P({ hipFlex: 90, knee: 90, hipRot: 0 });
ok(d(ir.ankle, ir0.ankle, 0) > 3, 'kalça iç rotasyonunda (kalça ve diz 90) ayak dışa (+x) gitmiyor');
ok(Math.hypot(...f.knee.map((v, i) => v - M.J.knee[i])) > 0 && Math.abs(Math.hypot(...f.knee.map((v, i) => v - M.J.hip[i])) - M.lenFemur) < 1e-6, 'femur boyu korunmuyor');
// ikili kuaterniyon ile matris aynı noktayı versin (her segment, uç duruşlar)
for (const q of [{ hipFlex: 125, knee: 140, ankle: -45, subtalar: -30 }, { hipFlex: -15, hipAbd: 40, hipRot: -45, ankle: 20, subtalar: 15 }, { hipAbd: -25, hipRot: 35 }]) {
  const s = P(q);
  for (let i = 1; i < 6; i++) { const p = [M.J.ankle[0], M.J.ankle[1] + 10 * i, M.J.ankle[2] + 3]; const a = tp(s.mats, i, p), b = K.skinPoint(o, p, [[i, 1]]); ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6, 'ikili kuaterniyon matristen farklı: segment ' + i); }
}
// sınırlar ve tutamaçlar
ok(K.clampPose(M, { hipFlex: 130, knee: 0 }).hipFlex === 90, 'diz gergin iken kalça fleksiyonu 90 ile sınırlı değil');
const ray = { origin: { x: M.J.hip[0], y: M.J.hip[1] - 20, z: M.J.hip[2] + 100 }, direction: { x: 0, y: 0, z: -1 } };
const sk = K.solveKnee(M, M.rest, ray).pose; ok(sk.hipFlex > 20 && sk.hipFlex < 90, 'diz tutamacı öne çekince kalça bükülmüyor: ' + sk.hipFlex.toFixed(1));
K.fk(M, { ...M.rest, knee: 70 }, o); const tgt = [...o.pts.ankle];
const sf = K.solveFoot(M, M.rest, { origin: { x: tgt[0] + 50, y: tgt[1], z: tgt[2] }, direction: { x: -1, y: 0, z: 0 } }).pose; ok(Math.abs(sf.knee - 70) < 1.5, 'ayak tutamacı diz açısını bulmuyor: ' + sf.knee.toFixed(1));
const rd = K.readout(M, { ...M.rest, hipFlex: -10, ankle: -20, subtalar: -10 }); ok(rd.hip.flex.de === 'Extension' && rd.ankle.de === 'Plantarflexion' && rd.subtalar.de === 'Supination', 'okuma terimleri yanlış');
for (const m of data.movements) { const a = K.clampPose(M, { ...M.rest, ...m.from }), b = K.clampPose(M, { ...a, ...m.set }); ok(K.poseDistance(M, a, b) > 9, 'hareket neredeyse hiç oynamıyor: ' + m.key); }
console.log(`${n - bad} denetim geçti, ${bad} hata`);
process.exitCode = bad ? 1 : 0;
