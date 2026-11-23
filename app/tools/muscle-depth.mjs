// Kas katmanı derinliği (atlasın "Kas katmanı" soyma aracı için): her kasın dıştan kaçıncı katmanda olduğu.
// Çıktı: public/data/muscle-depth.json { v, method, max, d: { kimlik: katman (1 = yüzeyel … max) } }.
// Çalışma anı yalnız filtreler (main.js state.peel, model.apply); hesap burada bir kez yapılır: npm run depth.
//
// Yöntem (soğan soyma): her kas parçasından en çok SAMPLES köşe örneklenir; her köşeden yüzey normalinin çevresindeki
// yönlere (NDIRS yönlü Fibonacci küresinden; saklanan: kosinüsü >= COS_MIN, sayılan: >= CONE, yani normalden ~53°) ışın
// atılır. Tek bir birleşik BVH'de bütün kaslar (alt katman 'muscle') ve iskelet (bones.glb: kemik, kıkırdak, diş) vardır.
// Bir ışın bir kemiğe çarparsa o yön hiç açılmaz (kemik soyulmaz); yoksa ışının deldiği öteki kasların kümesi saklanır.
// Soyma turları yalnız küme işlemidir: k. turda, şimdiye dek soyulmuş kaslar S iken bir köşe "açık"tır, eğer bir yönünün
// kas kümesi S'nin alt kümesiyse. Açık köşelerin açılabilir köşelere (kemiğin her yönden örtmediği köşeler) payı THRESH'e
// ulaşan kaslar k. katmandır ve S'ye eklenir. Hiçbir kas eşiği geçemezse en açık olanlar (en yüksek payın yarısı ve
// üstü) alınır; her kas bir katmana düşer, MAXL'den sonraki katmanlar sonuncuda birleşir. Açık (çift yüzlü) parçalarda
// iki yarım küre de denenir. Ayarlar 2026-11-23'te bilinen kaslarla seçildi (deltoideus, trapezius, biceps 1; supinator,
// subscapularis, brachialis, soleus, rhomboidei, pectoralis minor 2; transversus abdominis 4; rotatores 5; multifidus 4-6).
// Sınırlar: deri ve deri altı yoktur (en dış kaslar 1. katmandır); eklem bağları ve organlar engel sayılmaz; ders
// kitabının katman sayımı değil, bu modelin geometrisidir.
import fs from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MeshBVH } from 'three-mesh-bvh';
import v8 from 'node:v8';
// DEPTH_CACHE=<dosya>: ışın sonuçları oraya yazılır ve varsa oradan okunur (yalnız soyma ayarlarını denerken; ~5 dk kazandırır)
const CACHE = process.env.DEPTH_CACHE;

const SAMPLES = 72, COS_MIN = 0.2, THRESH = +(process.env.DEPTH_THRESH || 0.4), MAXL = +(process.env.DEPTH_MAXL || 6), NDIRS = 96, EPS = 0.04;
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
const info = new Map(meta.items.map(r => [r.id, r]));

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// parçalar: { id, bone, P (dünya), N (dünya, birim), I }
const parts = [];
for (const [file, bone] of [['muscles.glb', false], ['bones.glb', true]]) {
  const doc = await io.read(`public/models/${file}`);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const id = node.getName(), r = info.get(id); if (!r) continue;
    if (!bone && r.sub !== 'muscle') continue;               // tendon kılıfı, bursa, fasya engel ve hedef değil
    if (bone && (r.sub === 'attach' || r.x === 'f')) continue;
    const M = new THREE.Matrix4().fromArray(node.getWorldMatrix()), NM = new THREE.Matrix3().getNormalMatrix(M);
    const prim = mesh.listPrimitives()[0];
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), n = pos.getCount();
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), v = new THREE.Vector3(), e = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, e); v.fromArray(e).applyMatrix4(M); v.toArray(P, i * 3);
      if (nor) { nor.getElement(i, e); v.fromArray(e).applyMatrix3(NM).normalize(); v.toArray(N, i * 3); }
    }
    const I = Uint32Array.from(prim.getIndices().getArray());
    if (!nor) {   // normali olmayan ağ: üçgenlerden hesapla
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeVertexNormals(); N.set(g.attributes.normal.array);
    }
    parts.push({ id, bone, open: !!r.o, P, N, I });
  }
}
const muscles = parts.filter(p => !p.bone);
console.log(`kas ${muscles.length}, kemik ${parts.length - muscles.length}`);

// birleşik geometri + üçgen -> parça
let nv = 0, nt = 0; for (const p of parts) { nv += p.P.length / 3; nt += p.I.length / 3; }
const AP = new Float32Array(nv * 3), AI = new Uint32Array(nt * 3), vertPart = new Int32Array(nv);   // köşe -> parça (MeshBVH üçgen sırasını değiştirir, köşeleri değil: parça köşeden bulunur)
{
  let vo = 0, to = 0;
  parts.forEach((p, pi) => {
    AP.set(p.P, vo * 3);
    for (let k = 0; k < p.I.length; k++) AI[to * 3 + k] = p.I[k] + vo;
    vertPart.fill(pi, vo, vo + p.P.length / 3);
    vo += p.P.length / 3; to += p.I.length / 3;
  });
}
const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(AP, 3)); geo.setIndex(new THREE.BufferAttribute(AI, 1));
console.log(`üçgen ${nt}, BVH kuruluyor`);
const bvh = new MeshBVH(geo);

// eşit dağılmış yönler (Fibonacci küresi)
const DIRS = [];
for (let i = 0; i < NDIRS; i++) {
  const y = 1 - (2 * (i + 0.5)) / NDIRS, rr = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  DIRS.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
}
const pIndex = new Map(parts.map((p, i) => [p, i]));
const ray = new THREE.Ray();
// kas -> örnek noktalar -> açık olabilecek yönlerin engel kümeleri (kas sırası; kemik çarpan yön yok)
const t0 = Date.now();
const cached = CACHE && fs.existsSync(CACHE) ? v8.deserialize(fs.readFileSync(CACHE)) : null;
const samples = cached || muscles.map((p, mi) => {
  const self = pIndex.get(p), n = p.P.length / 3, step = Math.max(1, Math.floor(n / SAMPLES)), pts = [];
  for (let i = 0; i < n; i += step) {
    const o = new THREE.Vector3().fromArray(p.P, i * 3), nn = new THREE.Vector3().fromArray(p.N, i * 3);
    const sets = [];
    for (const d of DIRS) {
      const c = d.dot(nn);
      if (!p.open && c < COS_MIN) continue;
      if (p.open && Math.abs(c) < COS_MIN) continue;
      ray.origin.copy(o).addScaledVector(d, EPS); ray.direction.copy(d);
      const hits = bvh.raycast(ray, THREE.DoubleSide);
      let blocked = false; const set = new Set();
      for (const h of hits) {
        const pi = vertPart[h.face.a]; if (pi === self) continue;
        if (parts[pi].bone) { blocked = true; break; }
        set.add(pi);
      }
      if (!blocked) sets.push([Math.abs(c), ...set]);   // ilk öğe: normal ile yönün kosinüsü (koni ayarı sonradan)
    }
    pts.push(sets);
  }
  if (mi % 50 === 0) console.log(`  ${mi}/${muscles.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return pts;
});

if (CACHE && !cached) fs.writeFileSync(CACHE, v8.serialize(samples));
// yalnız normalin çevresindeki CONE kosinüsünden dik yönler sayılır (yatık ışınlar iki kas arasından kolayca sızar)
const CONE = +(process.env.DEPTH_CONE || 0.6);
const samplesC = samples.map(pts => pts.map(sets => sets.filter(s => s[0] >= CONE).map(s => s.slice(1))));

// soyma turları. Birim: aynı adlı sol ve sağ parça (açık köşe payları ortalanır), böylece iki taraf hep aynı katmandadır
// (sınırdaki bir kasın iki yanı ışın gürültüsüyle ayrı katmanlara düşmesin).
const units = [...Map.groupBy(muscles.map((p, mi) => mi), mi => info.get(muscles[mi].id).n).values()];
const peeled = new Set(), rank = new Map(), layers = [];
// Pay (MODE=vert, varsayılan): bir yönü açık köşeler / açılabilir köşeler. MODE=dir (denendi, daha kötü: çok kas son
// katmana yığılır): açık yönler / kemiğe çarpmayan yönler.
const MODE = process.env.DEPTH_MODE || 'vert';
// Serbest kol ve bacak (kol, ön kol, el; uyluk, bacak, ayak) ayrı değerlendirilir: modelde kollar gövdeye, bacaklar
// birbirine yakın durur; bir kol kasının iç yüzünden çıkan ışın gövde kaslarına, bir uyluk kasınınki öteki bacağa
// çarpar. Bu yüzden serbest bir ekstremite kasını yalnız aynı taraftaki aynı ekstremitenin serbest kısmının kasları örter
// (bölge: data/muscles.json group_de; omuz ve kalça kasları, gövde, baş-boyun kasları her şeyle örtülür). Kemikler her
// zaman örter. DEPTH_LIMBS=0 bunu kapatır.
const MJ = JSON.parse(fs.readFileSync('public/data/muscles.json', 'utf8')).muscles;
const FREE = /^(Oberarm|Unterarm|Hand|Oberschenkel|Unterschenkel|Fuß)/;
const limbOf = p => { const c = MJ[info.get(p.id).n], sd = info.get(p.id).sd; return c && sd && FREE.test(c.group_de || '') ? c.batch + sd : null; };
const ignoreOf = muscles.map(p => {
  const L = limbOf(p), out = new Set();
  if (!L || process.env.DEPTH_LIMBS === '0') return out;
  for (const q of muscles) if (limbOf(q) !== L) out.add(pIndex.get(q));
  return out;
});
const exposure = mi => {
  const ig = ignoreOf[mi], gone = x => peeled.has(x) || ig.has(x);
  let open = 0, can = 0;
  for (const sets of samplesC[mi]) {
    if (!sets.length) continue;
    if (MODE === 'vert') { can++; if (sets.some(s => s.every(gone))) open++; continue; }
    can += sets.length; for (const s of sets) if (s.every(gone)) open++;
  }
  return can ? open / can : 1;
};
let rest = units;
while (rest.length) {
  const ex = rest.map(u => [u, u.reduce((t, mi) => t + exposure(mi), 0) / u.length]);
  let take = ex.filter(([, e]) => e >= THRESH);
  if (!take.length) { const top = Math.max(...ex.map(x => x[1])); take = top > 0 ? ex.filter(([, e]) => e >= top * 0.5) : ex; }
  const k = layers.length + 1, ids = [], got = new Set(take.map(x => x[0]));
  for (const [u] of take) for (const mi of u) { rank.set(mi, k); ids.push(muscles[mi].id); }
  for (const [u] of take) for (const mi of u) peeled.add(pIndex.get(muscles[mi]));
  layers.push(ids);
  rest = rest.filter(u => !got.has(u));
}
// uzun kuyruk (birkaç kemik arası kas) son katmanda birleşir
while (layers.length > MAXL) { const last = layers.pop(); layers[layers.length - 1].push(...last); }
const d = {}; layers.forEach((ids, i) => { for (const id of ids) d[id] = i + 1; });
layers.forEach((ids, i) => console.log(`katman ${i + 1}: ${ids.length} parça${i >= 2 ? ': ' + [...new Set(ids.map(id => info.get(id).n))].join(', ').slice(0, 900) : ''}`));
const out = { v: 1, method: `soğan soyma: ${SAMPLES} köşe, ${NDIRS} yön, koni ${CONE}, eşik ${THRESH} (${MODE}), en çok ${MAXL} katman`, max: layers.length, d };
fs.writeFileSync('public/data/muscle-depth.json', JSON.stringify(out));
// denetim: bilinen derin kaslar
for (const name of ['Supinator', 'Subscapularis', 'Rotatores', 'Multifidus', 'Biceps brachii', 'Deltoid', 'Trapezius', 'Brachialis', 'Soleus', 'Gastrocnemius', 'Tibialis posterior', 'Pectoralis minor', 'Pectoralis major', 'Transversus abdominis', 'Internal oblique', 'Flexor digitorum profundus', 'Vastus intermedius', 'Adductor magnus', 'Psoas', 'Gluteus minimus', 'Piriformis', 'Diaphragm', 'Intercostal', 'Semispinalis', 'Longissimus', 'Splenius', 'Levator scapulae', 'Rhomboid'])
  console.log(name.padEnd(28), meta.items.filter(r => r.s === 'muscle' && r.n.toLowerCase().includes(name.toLowerCase()) && d[r.id]).map(r => `${r.n.replace(/ muscle/i, '')}${r.sd ? '/' + r.sd : ''}=${d[r.id]}`).slice(0, 8).join('; '));
