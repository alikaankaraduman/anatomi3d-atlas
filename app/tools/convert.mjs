// Z-Anatomy FBX -> sikistirilmis GLB + meta JSON.
// Kullanim: node tools/convert.mjs <bones|muscles|nerves|vessels|organs|lymph|joints>
import fs from 'node:fs';
import { loadFBX } from './fbxnode.mjs';
import { loadHRA } from './hra.mjs';
import { loadFillod } from './fillod.mjs';
import { loadFemaleJoints } from './femalejoints.mjs';
import { loadUrethra } from './urethra.mjs';
import { loadBartholin } from './bartholin.mjs';
import { loadAttach } from './attach.mjs';
import { extract, weld, smoothNormals, clusterByPosition, orient, surfaceArea, signedVolume, isLabelLine, isAttach, origName } from './geom.mjs';
import { colorFor, knownMat } from './palette.mjs';
import { SOURCES } from './sources.mjs';
import { latin } from './ta2.mjs';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';

const srcName = process.argv[2]; const S = SOURCES[srcName];
if (!S) throw new Error(`Bilinmeyen kaynak "${srcName}". Secenekler: ${Object.keys(SOURCES).join(', ')}`);
const PAL = S.palette ?? S.sys;
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;

// --- isim yardimcilari ---
const FIX = new Map([
  ['Lat_Fis-ant-Horizont', 'Anterior horizontal ramus of lateral sulcus'],
  ['Lat_Fis-ant-Vertical', 'Anterior ascending ramus of lateral sulcus'],
  ['Lat_Fis-post', 'Posterior ramus of lateral sulcus'],
  ['Sulcus interm_prim-Jensen', 'Intermediate sulcus of Jensen'],
  ["Central canal'", 'Central canal (cranial part)'],
  // Kaynak FBX'te adi bozuk (soru isaretleri) gelen uc damar: ne olduklari kesin bilinmedigi icin
  // ust yapidan turetilmis notr bir ad veriyoruz.
  ['????????', 'Cardiac veins (unnamed in source)'],
  ['?x', 'Branch of artery of pterygoid canal (unnamed in source)'],
  ["Inferior vein of left ventricle (//Posterior '')", 'Inferior vein of left ventricle (posterior)'],
  // Beyin kabugu: Z-Anatomy adlari Destrieux atlasinin (aparc.a2009s) etiketlerinden turetilmis; bazilari baska bir yapiyi
  // ya da parcadan fazlasini adlandiriyor. tools/cortex-map.mjs ile cikarilan konum, oluk derinligi ve sinir komsulari
  // Destrieux komsuluklariyla karsilastirilarak duzeltildi (2026-11-19). Anahtar: ham ad (yildizlar dahil).
  ['Paracentral sulcus', 'Middle frontal sulcus'],                            // S_front_middle: on frontal dis yuzde, orta frontal girus icinde
  ['Inferior temporal sulcus', 'Anterior transverse collateral sulcus'],      // S_collat_transv_ant (orta guven): taban yuzunde, orta temporal girusa degmiyor
  ['Orbital gyri (Frontomarginal gyrus and sulcus*)', 'Frontomarginal gyrus and sulcus'],   // ayri parsel, orbital girus degil
  ['Insula (Subcentral gyrus and ant. and post. sulci*)', 'Subcentral gyrus and sulci'],    // santral operkulum, insula degil
  ['Circular sulcus of insula', 'Circular sulcus of insula (Superior part)'], // yalniz ust bolum; on ve alt bolum modelde yok
  ['Cingulate gyrus and sulcus (Posterior dorsal part)', 'Cingulate gyrus (Posterior dorsal part)'],   // Destrieux'da yalniz girus
  ['Lunate sulcus', 'Middle occipital sulcus and lunate sulcus'],              // S_oc_middle_and_Lunatus
  ['Transverse occipital sulcus', 'Superior and transverse occipital sulci'], // S_oc_sup_and_transversal
  ['Transverse temporal gyri', 'Anterior transverse temporal gyrus'],          // yalniz Heschl girusu
  // Trapezius: kaynakta "Ascending part" adli ag artkafadan omuza uzanan ust parca (y 141-157), "Descending part" adli ag
  // alt torakal omurlardan spina scapulae'ya cikan alt parca (y 112-141): adlar yer degistirmis. Esleme bir kez uygulanir.
  ['Ascending part of trapezius muscle', 'Descending part of trapezius muscle'],
  ['Descending part of trapezius muscle', 'Ascending part of trapezius muscle'],
]);
const sideOf = n => /\.r$/.test(n) ? 'r' : /\.l$/.test(n) ? 'l' : '';
const baseOf = n => n.replace(/\.[rl]$/, '').replace(/\.g$/, '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
const clean = b => (FIX.get(b) ?? b).replace(/^\((.*)\)$/, '$1').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

// --- alt katman: chain = ust gruplarin (temizlenmis) adlari, matNames = parcanin malzeme adlari ---
function subOf(chain, name, matNames) {
  const c = chain.join(' > ');
  switch (srcName) {
    case 'bones':
      if (/^Teeth/.test(chain[0] ?? '')) return 'tooth';
      if (/cartilage/i.test(c) || /cartilage/i.test(name)) return 'cartilage';
      return 'bone';
    case 'muscles':
      if (/tendon sheath/i.test(c)) return 'sheath';
      if (/bursae/i.test(c)) return 'bursa';
      if (/^Fasciae/.test(chain[0] ?? '')) return 'fascia';
      return 'muscle';
    case 'nerves':
      if (chain[1] === 'Meninges') return 'meninges';
      if (chain[1] === 'Spinal cord') return 'cord';
      if (chain[0] === 'Central nervous system') return 'brain';
      if (chain[0] === 'Sense organs') return 'sense';
      return 'nerve';
    case 'vessels':
      if (chain.includes('Heart')) return 'heart';
      if (chain[0] === 'Venous system') return 'vein';
      return 'artery';
    case 'organs': {
      const top = chain[0] ?? '';
      if (top === 'Respiratory system') return 'respiratory';
      if (top === 'Urinary system') return 'urinary';
      if (top === 'Genital systems') return 'genital';
      if (top === 'Endocrine glands') return 'endocrine';
      if (top === 'Abdominopelvic cavity' || top === 'Thoracic cavity') return 'membrane';
      return 'digestive';
    }
    case 'lymph':
      return 'lymph';
    case 'female':
      return chain.includes('Urinary system') ? 'urinary' : chain.includes('Digestive system') ? 'digestive' : 'genital';
    case 'femalepelvis':
      return 'bone';
    case 'breasts':
      return 'breast';
    case 'vulva':
      return 'genital';
    case 'urethra':
      return 'urinary';
    case 'bartholin':
      return 'genital';
    case 'attach':
    case 'attachm':
    case 'attachf':
      return 'attach';
    case 'joints':
    case 'femalejoints':
      if (matNames.some(m => /^Articular capsule/.test(m)) || /capsule/i.test(name)) return 'capsule';
      // Kaynakta bag malzemesiyle modellenmis diskler (distal radyoulnar eklem diski) disk katmanina gitsin;
      // "Anterior meniscotibial ligament (Lateral meniscus)" gibi adinda menisküs gecen gercek baglar bag olarak kalsin.
      if (/\b(disc|meniscus|labrum)\b/i.test(name) && !/ligament/i.test(name)) return 'disc';
      if (matNames.some(m => /^Ligament/.test(m))) return 'ligament';
      return 'disc';
  }
  throw new Error('alt katman tanimsiz: ' + srcName);
}

const t0 = Date.now();
// Z-Anatomy kaynaklari FBX; kadin organlari, memeler ve kadin pelvisi HRA GLB dosyalarindan (tools/hra.mjs), klitoris ve
// bulbuslar Fillod STL modelinden (tools/fillod.mjs) gelir; kadin uretrasi ve Bartholin bezleri sematiktir (tools/urethra.mjs, tools/bartholin.mjs).
const root = S.hra ? loadHRA(S.hra) : S.fillod ? loadFillod() : S.urethra ? loadUrethra() : S.bartholin ? loadBartholin() : S.attach ? loadAttach(S.attach) : S.pelvisWarp ? loadFemaleJoints(`../data/zanatomy/${S.fbx}`) : loadFBX(`../data/zanatomy/${S.fbx}`);
console.log(`[${srcName}] ${S.hra ? 'HRA' : S.fillod ? 'STL' : S.urethra || S.bartholin ? 'sematik ag' : S.attach ? 'FBX yamalari' : 'FBX'} okundu ${(Date.now() - t0) / 1000 | 0}s`);

// Iskelet dosyasindaki kas yapisma yamalari (.or/.er/...) simdilik disarida; kaynaga ozel sablon nesneler atlanir.
const SKIP = new Set(S.skip ?? []);
const isReal = o => o.isMesh && o.geometry.attributes.position.count > 0 && !isLabelLine(origName(o))
  && !(srcName === 'bones' && isAttach(origName(o))) && !SKIP.has(baseOf(origName(o)));
const reals = []; root.traverse(o => { if (isReal(o)) reals.push(o); });
reals.sort((a, b) => origName(a).localeCompare(origName(b)));
const hasRealChild = new Set(); for (const o of reals) for (let p = o.parent; p && p !== root; p = p.parent) if (isReal(p)) hasRealChild.add(p);

// Ust grup zinciri (etiket gruplari .t/.s atlanir).
function chainOf(o) {
  const chain = [];
  for (let p = o.parent; p && p !== root; p = p.parent) {
    const pn = origName(p);
    if (/\.[ts]$/.test(pn) && !p.isMesh) continue;
    chain.unshift(baseOf(pn));
  }
  return chain;
}
// Alt yapilari olan bir parca kendi adiyla bir grup acar ("Pons" grubu: sag pons + pons ici yapilar).
// Ayni adli karsi taraf parcasinin (alt yapisi olmasa bile) ayni gruba girmesi icin bu yollar onceden toplanir;
// yoksa sol pons grubun disinda tek basina kalir ve gruba yapilan secme/gizleme onu kapsamaz.
const selfKey = p => '/' + p.join('/');
const selfKeys = new Set([...hasRealChild].map(o => selfKey([...chainOf(o), baseOf(origName(o))])));

// --- grup agaci ---
const groups = []; const gIndex = new Map();
function groupFor(pathBases) {
  let parent = -1, key = '';
  for (const b of pathBases) {
    key += '/' + b;
    let gi = gIndex.get(key);
    if (gi === undefined) { gi = groups.length; groups.push({ n: clean(b), p: parent }); gIndex.set(key, gi); }
    parent = gi;
  }
  return parent;
}

const doc = new Document(); const buffer = doc.createBuffer(); const scene = doc.createScene('anatomy');
const material = doc.createMaterial('base').setRoughnessFactor(0.7).setMetallicFactor(0);
const items = []; let trisIn = 0, trisOut = 0, vertsOut = 0, nClosed = 0, retried = 0; const unknownMats = new Set(); const rootLevel = []; const unsimplified = [];

for (let i = 0; i < reals.length; i++) {
  const o = reals[i]; const raw = origName(o);
  const base = baseOf(raw);
  let chain = chainOf(o);
  if (S.regroup?.[base] && chain.length) chain = [...chain.slice(0, -1), S.regroup[base]];   // kaynaktaki gruplama hatasi
  const path = selfKeys.has(selfKey([...chain, base])) ? [...chain, base] : chain;
  const g = groupFor(path);
  if (!chain.length) rootLevel.push(raw);

  // geometri
  const e = extract(o);
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) if (!knownMat(PAL, m.name)) unknownMats.add(m.name);
  const w = weld(e, 'posmat');
  const { cluster, count } = clusterByPosition(w.P);
  // kapali aglarda yonu dogrula (disa baksin) -> tek yuzlu cizim mumkun olur
  const topo = orient(w.P, w.idx, cluster, count);
  const N = smoothNormals(w.P, w.idx, cluster, count);
  trisIn += w.idx.length / 3;
  // boyuta gore uyarlanan mutlak hata (cm)
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let k = 0; k < w.P.length; k += 3) {
    const x = w.P[k], y = w.P[k + 1], z = w.P[k + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const diag = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
  // Sadelestirme: yapi ekrani doldurdugunda bile fark edilmeyecek kadar kucuk bir hata payi.
  // - Normal agirlikli: ince levhalarin (bag, labrum, zar) iki yuzu birbirine katlanmaz, ters normal lekeleri olusmaz.
  //   Normaller tam cozunurlukte hesaplanip korunur.
  // - Sekil korumali: ince yollar ve sinirler birkac yassi parcaya donusmesin diye yuzey alani (kapali aglarda hacim de)
  //   belirgin azalirsa hata payi yarilanarak yeniden denenir; hicbiri tutmazsa ag sadelestirilmez.
  // (Uzak gorunum icin ikinci, daha kaba bir detay seviyesi denendi ve cikarildi: kare suresi ucgen
  // sayisina degil cizim cagrisi sayisina bagli oldugundan kazanc saglamadi, kucuk kemikleri kabalastirdi.)
  let idx = w.idx; let simplifyTries = 0;
  if (idx.length / 3 > 400) {
    const NW = 0.1;
    const area0 = surfaceArea(w.P, w.idx), vol0 = topo.closed ? Math.abs(signedVolume(w.P, w.idx)) : 0;
    let err = S.simplifyErr ?? Math.min(0.03, Math.max(0.003, 0.0012 * diag));
    for (let attempt = 0; attempt < 8; attempt++, err /= 2) {
      simplifyTries++;
      const [res] = MeshoptSimplifier.simplifyWithAttributes(w.idx, w.P, 3, N, 3, [NW, NW, NW], null, 0, err, S.lockBorder ? ['ErrorAbsolute', 'LockBorder'] : ['ErrorAbsolute']);
      if (res.length < 12) continue;
      if (surfaceArea(w.P, res) < 0.92 * area0) continue;
      if (vol0 && Math.abs(signedVolume(w.P, res)) < 0.85 * vol0) continue;
      idx = res; break;
    }
    if (idx === w.idx) unsimplified.push(raw);
    else if (simplifyTries > 1) retried++;
  }
  // sadelestirme delik acmaz ama ince yerlerde birkac manifold-disi kenar birakabilir; bu, tek yuzlu cizime engel degil
  const closed = topo.closed && orient(w.P, idx, cluster, count, false, 0.03).closed;
  if (closed) nClosed++;

  // kullanilan koseleri sikistir, kose onbellegi / getirme sirasi icin yeniden sirala
  const remap = new Int32Array(w.P.length / 3).fill(-1); let nv = 0;
  for (let k = 0; k < idx.length; k++) if (remap[idx[k]] < 0) remap[idx[k]] = nv++;
  const I = new Uint32Array(idx.length); for (let k = 0; k < idx.length; k++) I[k] = remap[idx[k]];
  const [vmap] = MeshoptEncoder.reorderMesh(I, true, false);
  const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), C = new Uint8Array(nv * 4);
  const palette = mats.map(m => colorFor(PAL, m.name));
  for (let v = 0; v < remap.length; v++) {
    if (remap[v] < 0) continue; const r = vmap[remap[v]];
    P.set(w.P.subarray(v * 3, v * 3 + 3), r * 3); Nn.set(N.subarray(v * 3, v * 3 + 3), r * 3);
    const col = palette[w.M[v]] ?? palette[0];
    C[r * 4] = col[0]; C[r * 4 + 1] = col[1]; C[r * 4 + 2] = col[2]; C[r * 4 + 3] = 255;
  }
  trisOut += I.length / 3; vertsOut += nv;

  const id = S.prefix + i;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Nn).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(C).setNormalized(true).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? I : Uint16Array.from(I)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));

  const item = { id, n: clean(base), g, sub: subOf(chain, base, mats.map(m => m.name)) };
  if (!closed) item.o = 1;   // acik yuzey: cift yuzlu cizilmeli
  const sd = sideOf(raw); if (sd) item.sd = sd;
  const la = latin(base); if (la) item.la = la;
  items.push(item);
  if (i % 100 === 99) console.log(`  ${i + 1}/${reals.length}`);
}

await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync('public/models', { recursive: true }); fs.mkdirSync('../data/work', { recursive: true });
const glb = await io.writeBinary(doc);
fs.writeFileSync(`public/models/${srcName}.glb`, glb);
fs.writeFileSync(`../data/work/meta_${srcName}.json`, JSON.stringify({ src: srcName, sys: S.sys, items, groups }));
console.log(`[${srcName}] ${items.length} parca, ${groups.length} grup, ucgen ${trisIn} -> ${trisOut} (%${(100 * trisOut / trisIn).toFixed(0)}), kose ${vertsOut}, kapali ag ${nClosed}/${items.length}, Latince ${items.filter(i => i.la).length}/${items.length}, GLB ${(glb.byteLength / 1e6).toFixed(2)} MB, sure ${(Date.now() - t0) / 1000 | 0}s`);
if (unknownMats.size) console.log('  paletsiz malzemeler:', [...unknownMats].join(', '));
if (rootLevel.length) console.log(`  grupsuz (kok duzeyinde) parca ${rootLevel.length}:`, rootLevel.slice(0, 12).join(' | '));
console.log(`  sekli korumak icin daha ince sadelestirilen ${retried}, hic sadelestirilmeyen ${unsimplified.length}${unsimplified.length ? ': ' + unsimplified.slice(0, 10).join(' | ') : ''}`);
const subs = {}; for (const it of items) subs[it.sub] = (subs[it.sub] || 0) + 1; console.log('  alt katmanlar:', subs);
