// Kesitte dolu çizilecek açık parçaların delik kapakları -> public/data/holes.json
//
// Açık (çift yüzlü çizilen) bir parça, kesitte dolu çizilebilmesi için sınır halkaları üçgenlerle kapatılarak kapalı
// bir yüzeye tamamlanır (src/section.js). Burada yalnızca kapak üçgenleri hesaplanır:
//  - Aynı köşelerden aynı yönde iki kez geçen üçgenlerin (ör. ön çapraz bağın bütün üçgenleri) yalnızca biri sayılır;
//    yoksa tek-çift kuralında birbirini siler, sıfır olmayan kuralda sınırı bozar. Uygulama da aynısını yapar (d).
//  - Sınır, konuma göre birleştirilmiş köşelerde hesaplanır. Yüzü tutarlı yönlenmiş parçada (her kenarın iki yöndeki
//    kullanım farkı en çok 1) sınır, üçgenlerin kullandığı yönün tersine yönlü kenarlardır; her köşede giren ve çıkan
//    sınır kenarı sayısı eşittir. Kapak üçgenleri bu yönü izler, ağla birlikte yönlü kapalı bir yüzey olur ve kesitte
//    sıfır olmayan kuralla çizilir (m: 1): aynı parçanın birbirine giren bileşenleri (gövdeye giren dal) dolu kalır.
//    Yönü tutarsız parçalarda sınır tek sayıda kullanılan kenarlardır ve tek-çift kuralı kullanılır.
//  - Sınır kenarları yürünerek kapalı halkalara, tekrar eden köşelerde de basit halkalara ayrılır (iki deliğin
//    değdiği köşede iki ayrı halka çıkar).
//  - Her halka en küçük alanlı üçgenlemeyle kapatılır (dinamik programlama, O(n^3)): düzlemsel olmayan ya da yarık
//    biçimli halkada (omurilik ak maddesinin arka septum yaprağı, falx cerebri'nin kenarı) kapak halkanın iki yanını
//    birbirine diker, tek köşeden açılan bir yelpaze gibi parçanın dışına taşmaz.
//  - Aynı açıklığın iki kenarı (kalın bir duvarın dış ve iç yüzünün bittiği halkalar: kulakçıkların atriyoventriküler
//    kenarı; ince bir katmandaki deliğin üst ve alt kenarı: areoladaki meme başı deliği) iki ayrı kapakla kapatılırsa
//    iki kapağın arası dolu çizilir (kulakçık deliğinin üstünde bir kapak). Böyle karşılıklı halka çiftleri (normalleri
//    zıt, merkezleri birbirinin içinde, iki yüzey de halkalardan aynı yana uzanıyor) aralarında en küçük alanlı bir
//    şeritle dikilir: şerit duvarın eksik ucu ya da deliğin duvarı olur. Yüzeyleri zıt yanlara uzanan çiftler (kısa bir
//    borunun iki ucu, uterus isthmus'u) iki kapakla kapatılır.
//  - Kalp odacıklarının duvarı çift katlıdır (dış yüz epikard, iç yüz endokard). Karıncıklarda dış yüzün kenarı septum
//    boyunca biter, iç yüz septumu kesintisiz geçer; kenarın kapağı boşluğu ortadan keser ve kapakla septumdaki iç yüz
//    arasında kalan boşluk (sarım sayısı ters işaretli) dolu çizilirdi. Bu parçalar yalnızca duvarın işaretiyle aynı
//    işaretli sarımda dolu çizilir (s: 1 / -1; duvarın işareti ağın yüzeyinin iki yanındaki kendi sarım sayısından):
//    duvar dolu, boşluk ve septum boş kalır.
// Dolu çizilmeyenler (holes.json'a girmez, kesitte içleri boş görünür):
//  - Kemiği, kası, tendonu ya da omuriliği saran tek katlı zarlar: kas fasyaları (alt katman fascia), eklem kapsülleri
//    (alt katman capsule ve adında "capsul" geçenler), tendon kılıfları (alt katman sheath; uygulama kapalı kılıfları da
//    boş çizer), spinal dura. Kapatılınca sardıkları yapının üstünde zar rengi bir dolgu oluşurdu (kalça kapsülü femur
//    başını ve boynunu, ortak fleksör kılıfı fleksör tendonlarını boyardı).
//  - Kemikteki kas tutunma yerlerinden açık yaprak olanlar (alt katman attach, sınır uzunluğu / sqrt(alan) > 2).
//  - Tek halkalı, neredeyse düz yamalar (en küçük kapak alanı yüzey alanının %90'ından büyük, ör. mesane trigonu) ve
//    kapaklarıyla birlikte hacim kapatmayan düz halkalar (dış üretra ağzı): dolgu ya yalnızca ince bir şerit olurdu ya
//    da hiç olmazdı.
// Kayıt: kimlik -> {
//   nv: köşe sayısı, p: ilk köşenin konumu (eski bir dosyayı yeni modelle karıştırmamak için; uygulama ikisini de
//       karşılaştırır),
//   m: 1 sıfır olmayan kural / 0 tek-çift kuralı,
//   s: varsa yalnızca bu işaretli sarım dolu (1: arka yüzler fazla, -1: ön yüzler fazla),
//   d: 1 ise uygulama aynı yönde tekrarlanan üçgenleri atar,
//   t: kapak ve şerit üçgenleri, düz dizi [a, b, c, ...] (köşeler GLB'deki sırayla, uygulamadaki geometriyle aynı) }.
// Modeller yeniden dönüştürülünce yeniden çalıştırılmalıdır (convert-all.mjs en sonda çalıştırır).
// Kullanım: node tools/holes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { clusterByPosition, surfaceArea } from './geom.mjs';

const FLAT_PATCH = 0.9;      // tek halkalı yamada en küçük kapak alanı / yüzey alanı bunu geçerse dolu çizilmez
const FLAT_VOLUME = 1e-4;    // kapaklı ağın hacmi / alan^1.5 bunun altındaysa düz halka sayılır, dolu çizilmez
const SHEET_RATIO = 2;       // tutunma yeri: sınır uzunluğu / sqrt(alan) bunu geçerse açık yaprak sayılır
const FACING_DOT = -0.5;     // karşılıklı halka çifti: birim normallerin iç çarpımı bunun altında
const SAME_SIDE = -0.05;     // iki yüzeyin halkalardan uzanma yönlerinin (normal boyunca) çarpımı bunun üstünde
const SIDE_CONF = 0.3;       // tek işaretli dolgu: duvarın işaretinden bu kadar emin değilse parça boş kalır
const sheet = it => it.sub === 'fascia' || it.sub === 'capsule' || it.sub === 'sheath' || /capsul/i.test(it.n) ||
  (it.sub === 'meninges' && /dura|arachn/i.test(it.n));
const heartWall = it => it.sub === 'heart' && /^(left|right) (atrium|ventricle)$/i.test(it.n);

const triArea = (X, a, b, c) => {
  const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
  const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
};

// Aynı köşelerden aynı yönde geçen tekrarlanmış üçgenler atılır (döndürmeye göre kanonik anahtar; ters yönlü çiftler
// kalır: iki kuralda da birbirini götürür). Uygulamadaki section.js dedupe() ile aynı.
export function dedupe(I) {
  const seen = new Set(); const out = []; let dropped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const key = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key); out.push(a, b, c);
  }
  return { I: dropped ? Uint32Array.from(out) : I, dropped };
}

// Sınır halkaları (basit halkalar, köşe dizileri GLB köşe sırasıyla). P: dünya konumları, I: üçgen indisleri.
// oriented: yön tutarlıysa yönlü halkalar (kapak üçgenleri ağın yönünü sürdürür), değilse yönsüz (tek sayıda kullanılan
// kenarlar). cluster/count: konum kümeleri (şerit dikişi için).
export function boundaryLoops(P, I) {
  const n = P.length / 3;
  const { cluster, count } = clusterByPosition(P);
  const first = new Int32Array(count).fill(-1);
  for (let i = 0; i < n; i++) if (first[cluster[i]] < 0) first[cluster[i]] = i;
  // kenar (a < b) -> [a->b kullanımı, b->a kullanımı]
  const use = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = cluster[I[t + k]], b = cluster[I[t + (k + 1) % 3]]; if (a === b) continue;
    const key = a < b ? a * count + b : b * count + a;
    let u = use.get(key); if (!u) use.set(key, (u = [0, 0]));
    u[a < b ? 0 : 1]++;
  }
  let oriented = true;
  for (const u of use.values()) if (Math.abs(u[0] - u[1]) > 1) { oriented = false; break; }
  // sınır grafiği: yönlüde kapağın kullanacağı yön (ağdaki net yönün tersi), yönsüzde iki yön
  const adj = new Map(); let ne = 0;
  const add = (u, v, e) => { let l = adj.get(u); if (!l) adj.set(u, (l = [])); l.push([v, e]); };
  for (const [key, u] of use) {
    const a = Math.floor(key / count), b = key % count;
    if (oriented) {
      const net = u[0] - u[1]; if (!net) continue;
      if (net > 0) add(b, a, ne++); else add(a, b, ne++);
    } else {
      if (!((u[0] + u[1]) & 1)) continue;
      add(a, b, ne); add(b, a, ne); ne++;
    }
  }
  const used = new Uint8Array(ne), loops = []; let broken = 0;
  const next = u => { const l = adj.get(u); while (l && l.length) { const e = l.pop(); if (!used[e[1]]) { used[e[1]] = 1; return e[0]; } } return -1; };
  for (const s of adj.keys()) {
    // s'den yürü; yol üstünde tekrar eden köşede aradaki basit halkayı ayır ve o köşeden devam et
    const path = [s], pos = new Map([[s, 0]]);
    for (;;) {
      const u = path[path.length - 1], v = next(u);
      if (v < 0) { if (path.length > 1) broken++; break; }   // kapanmayan yürüyüş (olmamalı)
      const i = pos.get(v);
      if (i === undefined) { pos.set(v, path.length); path.push(v); continue; }
      const loop = path.slice(i);
      for (let j = i + 1; j < path.length; j++) pos.delete(path[j]);
      path.length = i + 1;
      if (loop.length >= 3) loops.push(loop.map(c => first[c]));
    }
  }
  return { loops, oriented, broken, cluster, count };
}

// Halkanın en küçük alanlı üçgenlemesi: W[i][j] = min_k W[i][k] + W[k][j] + alan(i, k, j). Üçgenler (l[i], l[k], l[j]),
// i < k < j: halkanın yönünü izler.
export function capLoop(P, loop) {
  const n = loop.length; const X = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { X[i * 3] = P[loop[i] * 3]; X[i * 3 + 1] = P[loop[i] * 3 + 1]; X[i * 3 + 2] = P[loop[i] * 3 + 2]; }
  const W = new Float64Array(n * n), K = new Int32Array(n * n);
  for (let len = 2; len < n; len++) for (let i = 0; i + len < n; i++) {
    const j = i + len; let best = Infinity, bk = i + 1;
    for (let k = i + 1; k < j; k++) {
      const w = W[i * n + k] + W[k * n + j] + triArea(X, i * 3, k * 3, j * 3);
      if (w < best) { best = w; bk = k; }
    }
    W[i * n + j] = best; K[i * n + j] = bk;
  }
  const tris = [], st = [0, n - 1];
  while (st.length) {
    const j = st.pop(), i = st.pop(); if (j - i < 2) continue;
    const k = K[i * n + j]; tris.push(loop[i], loop[k], loop[j]); st.push(i, k, k, j);
  }
  return { tris, area: W[n - 1] };
}

// Halkanın birim Newell normali (kapak yönünde), Newell alanı, köşelerinin ortalaması ve ortalama yarıçapı
export function loopGeom(P, loop) {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0; const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % n] * 3;
    nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
    ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
    nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    cx += P[a]; cy += P[a + 1]; cz += P[a + 2];
  }
  const l = Math.hypot(nx, ny, nz) || 1, c = [cx / n, cy / n, cz / n];
  let r = 0;
  for (const v of loop) r += Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]) / n;
  return { nrm: [nx / l, ny / l, nz / l], area: l / 2, c, r };
}

// Yüzeyin halkadan uzaklaştığı ortalama yön: her halka kenarında kenara bitişik ağ üçgeninin üçüncü köşesine doğru,
// kenara dik birim vektör; kenar uzunluğuyla ağırlıklı ortalama. third: yönlü küme kenarı -> üçüncü köşe.
function loopTangent(P, loop, cluster, count, third) {
  let sx = 0, sy = 0, sz = 0; const n = loop.length;
  for (let i = 0; i < n; i++) {
    const u = loop[i], v = loop[(i + 1) % n];
    let c = third.get(cluster[v] * count + cluster[u]); if (c === undefined) c = third.get(cluster[u] * count + cluster[v]);
    if (c === undefined) continue;
    const ex = P[v * 3] - P[u * 3], ey = P[v * 3 + 1] - P[u * 3 + 1], ez = P[v * 3 + 2] - P[u * 3 + 2];
    const el = Math.hypot(ex, ey, ez) || 1;
    let dx = P[c * 3] - (P[u * 3] + P[v * 3]) / 2, dy = P[c * 3 + 1] - (P[u * 3 + 1] + P[v * 3 + 1]) / 2, dz = P[c * 3 + 2] - (P[u * 3 + 2] + P[v * 3 + 2]) / 2;
    const pr = (dx * ex + dy * ey + dz * ez) / (el * el); dx -= pr * ex; dy -= pr * ey; dz -= pr * ez;
    const dl = Math.hypot(dx, dy, dz) || 1;
    sx += dx / dl * el; sy += dy / dl * el; sz += dz / dl * el;
  }
  const l = Math.hypot(sx, sy, sz) || 1; return [sx / l, sy / l, sz / l];
}

// İki halka arasında en küçük alanlı şerit: A ileri, B geri yürünür (ikisi de kendi kapak yönünde), böylece her halka
// kenarı şeritte kendi kapağındaki yönde bir kez geçer ve ağla birlikte yönlü kapalı yüzey kalır. B'nin bütün başlangıç
// köşeleri denenir: C[i][j] = min(C[i-1][j] + alan(a[i-1], a[i], b[j]), C[i][j-1] + alan(b[j], b[j-1], a[i])).
export function stripLoops(P, A, B) {
  const n = A.length, m = B.length, W = m + 1;
  const C = new Float64Array((n + 1) * W), F = new Uint8Array((n + 1) * W);
  const area = (p, q, r) => triArea(P, p * 3, q * 3, r * 3);
  let best = { area: Infinity, tris: [] };
  for (let k = 0; k < m; k++) {
    const a = i => A[i % n], b = j => B[((k - j) % m + m) % m];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      if (!i && !j) { C[0] = 0; continue; }
      let c = Infinity, f = 0;
      if (i > 0) { const w = C[(i - 1) * W + j] + area(a(i - 1), a(i), b(j)); if (w < c) { c = w; f = 1; } }
      if (j > 0) { const w = C[i * W + j - 1] + area(b(j), b(j - 1), a(i)); if (w < c) { c = w; f = 2; } }
      C[i * W + j] = c; F[i * W + j] = f;
    }
    if (C[n * W + m] >= best.area) continue;
    const tris = []; let i = n, j = m;
    while (i || j) {
      if (F[i * W + j] === 1) { tris.push(a(i - 1), a(i), b(j)); i--; } else { tris.push(b(j), b(j - 1), a(i)); j--; }
    }
    best = { area: C[n * W + m], tris };
  }
  return best;
}

// Halkaları kapatır: karşılıklı halka çiftleri (yukarıda) şeritle, kalanlar kendi en küçük alanlı kapağıyla. Bir halka en
// çok bir şeride girer; adaylardan alanı küçük olan önce seçilir. Şerit, iki kapaktan büyükse seçilmez (sol karıncığın
// aort halkası ile dış kenarı). b: boundaryLoops sonucu, discs: halkaların capLoop sonuçları.
export function closeLoops(P, I, b, discs) {
  const { loops, oriented, cluster, count } = b;
  const t = [], used = new Set(); let strips = 0;
  if (oriented && loops.length > 1) {
    const G = loops.map(l => loopGeom(P, l));
    const third = new Map();
    for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) {
      const key = cluster[I[i + k]] * count + cluster[I[i + (k + 1) % 3]];
      if (!third.has(key)) third.set(key, I[i + (k + 2) % 3]);
    }
    let tg = null; const cand = [];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
      const gi = G[i], gj = G[j];
      if (dot(gi.nrm, gj.nrm) >= FACING_DOT) continue;
      const [L, S] = gi.area >= gj.area ? [gi, gj] : [gj, gi];
      const d = [S.c[0] - L.c[0], S.c[1] - L.c[1], S.c[2] - L.c[2]], along = dot(d, L.nrm);
      if (Math.hypot(d[0] - along * L.nrm[0], d[1] - along * L.nrm[1], d[2] - along * L.nrm[2]) > L.r) continue;
      tg ??= loops.map(l => loopTangent(P, l, cluster, count, third));
      if (dot(tg[i], gi.nrm) * dot(tg[j], gi.nrm) <= SAME_SIDE) continue;
      const st = stripLoops(P, loops[i], loops[j]);
      if (st.area < discs[i].area + discs[j].area) cand.push({ i, j, st });
    }
    cand.sort((p, q) => p.st.area - q.st.area);
    for (const c of cand) {
      if (used.has(c.i) || used.has(c.j)) continue;
      used.add(c.i); used.add(c.j); strips++;
      for (const v of c.st.tris) t.push(v);
    }
  }
  loops.forEach((l, i) => { if (!used.has(i)) for (const v of discs[i].tris) t.push(v); });
  return { t, strips };
}

// Üçgen listesinin o noktadan görünen katı açısı / 4π (genelleştirilmiş sarım sayısı)
function gwn(P, I, o) {
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const Ax = P[a] - o[0], Ay = P[a + 1] - o[1], Az = P[a + 2] - o[2];
    const Bx = P[b] - o[0], By = P[b + 1] - o[1], Bz = P[b + 2] - o[2];
    const Cx = P[c] - o[0], Cy = P[c + 1] - o[1], Cz = P[c + 2] - o[2];
    const la = Math.hypot(Ax, Ay, Az), lb = Math.hypot(Bx, By, Bz), lc = Math.hypot(Cx, Cy, Cz);
    const det = Ax * (By * Cz - Bz * Cy) - Ay * (Bx * Cz - Bz * Cx) + Az * (Bx * Cy - By * Cx);
    const dd = la * lb * lc + (Ax * Bx + Ay * By + Az * Bz) * lc + (Bx * Cx + By * Cy + Bz * Cz) * la + (Cx * Ax + Cy * Ay + Cz * Az) * lb;
    s += 2 * Math.atan2(det, dd);
  }
  return s / (4 * Math.PI);
}

// Ağın dolu yanı: örnek üçgenlerin ortasından normalin iki yanına DELTA kadar açılan noktalarda ağın kendi sarım sayısı
// toplanır. Dışa bakan yüzlü kalın duvarda iç yan ~1, dış yan ~0; içe bakan yüzlüde iç yan 0, dış yan ~-1. Tek katlı
// açık yaprakta iki yan ±0.5 olup birbirini götürür. Dönüş: işaret ve güven (alanla ağırlıklı ortalama, 0..1).
export function solidSide(P, I, samples = 256, DELTA = 0.01) {
  const T = I.length / 3, step = Math.max(1, Math.floor(T / samples));
  let s = 0, wsum = 0;
  for (let t = 0; t < T; t += step) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!l) continue;
    const o = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    const d = [nx / l * DELTA, ny / l * DELTA, nz / l * DELTA];
    const g = gwn(P, I, [o[0] - d[0], o[1] - d[1], o[2] - d[2]]) + gwn(P, I, [o[0] + d[0], o[1] + d[1], o[2] + d[2]]);
    s += g * l / 2; wsum += l / 2;
  }
  return { sign: s < 0 ? -1 : 1, conf: wsum ? Math.abs(s) / wsum : 0 };
}

// Ağ + kapaklar kapalı yüzeyinin işaretli hacmi (ilk köşeye göre: büyük koordinatlarda yuvarlama hatası azalır)
function closedVolume(P, I, t) {
  const o = [P[0], P[1], P[2]]; let v = 0;
  const add = (a, b, c) => {
    a *= 3; b *= 3; c *= 3;
    const ax = P[a] - o[0], ay = P[a + 1] - o[1], az = P[a + 2] - o[2], bx = P[b] - o[0], by = P[b + 1] - o[1], bz = P[b + 2] - o[2];
    const cx = P[c] - o[0], cy = P[c + 1] - o[1], cz = P[c + 2] - o[2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  };
  for (let i = 0; i < I.length; i += 3) add(I[i], I[i + 1], I[i + 2]);
  for (let i = 0; i < t.length; i += 3) add(t[i], t[i + 1], t[i + 2]);
  return v / 6;
}

const boundaryLength = (P, loops) => {
  let s = 0;
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i] * 3, b = l[(i + 1) % l.length] * 3;
    s += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
  }
  return s;
};

// betik olarak çalıştırılınca (içe aktarılınca yalnızca yukarıdaki işlevler)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await MeshoptDecoder.ready;
  const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8'));
  const byId = new Map(meta.items.map(it => [it.id, it]));
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const name = it => it.n + (it.sd ? '.' + it.sd : '');
  const out = {};
  const stat = { open: 0, filled: 0, nz: 0, dup: 0, noHoles: 0, loops: 0, strips: 0, stripParts: [], tris: 0, maxLoop: 0,
    broken: [], sheet: [], attach: [], flat: [], side: [], vol: [] };
  for (const f of fs.readdirSync('public/models').filter(f => f.endsWith('.glb'))) {
    const doc = await io.read(`public/models/${f}`);
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); const it = mesh && byId.get(node.getName());
      if (!it || !it.o) continue;
      stat.open++;
      if (sheet(it)) { stat.sheet.push(name(it)); continue; }
      const M = node.getWorldMatrix(); const prim = mesh.listPrimitives()[0];
      const pos = prim.getAttribute('POSITION'); const nv = pos.getCount(); const P = new Float32Array(nv * 3); const e = [0, 0, 0];
      for (let i = 0; i < nv; i++) {
        pos.getElement(i, e);
        P[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
        P[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
        P[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
      }
      const { I, dropped } = dedupe(prim.getIndices().getArray());
      const b = boundaryLoops(P, I);
      const { loops, oriented, broken } = b;
      if (broken) stat.broken.push(`${name(it)} (${broken})`);
      const area = surfaceArea(P, I);
      if (it.sub === 'attach' && loops.length && boundaryLength(P, loops) / Math.sqrt(area) > SHEET_RATIO) { stat.attach.push(name(it)); continue; }
      const discs = loops.map(l => capLoop(P, l));
      const cap = discs.reduce((s, d) => s + d.area, 0);
      for (const l of loops) stat.maxLoop = Math.max(stat.maxLoop, l.length);
      if (loops.length === 1 && cap > FLAT_PATCH * area) { stat.flat.push(name(it)); continue; }
      const { t, strips } = closeLoops(P, I, b, discs);
      if (oriented && loops.length) {
        const vr = Math.abs(closedVolume(P, I, t)) / area ** 1.5;
        stat.vol.push([vr, name(it)]);
        if (vr < FLAT_VOLUME) { stat.flat.push(name(it)); continue; }
      }
      const rec = { nv, p: [0, 1, 2].map(k => Math.round(P[k] * 1000) / 1000), m: oriented ? 1 : 0 };
      if (heartWall(it)) {
        const { sign, conf } = oriented ? solidSide(P, I) : { sign: 1, conf: 0 };
        stat.side.push(`${name(it)} ${sign > 0 ? '+' : '-'}${conf.toFixed(2)}`);
        if (conf < SIDE_CONF) { stat.flat.push(name(it)); continue; }
        rec.s = sign;
      }
      if (dropped) { rec.d = 1; stat.dup++; }
      rec.t = t;
      out[it.id] = rec;
      stat.filled++; if (oriented) stat.nz++; if (!loops.length) stat.noHoles++;
      stat.loops += loops.length; stat.tris += t.length / 3;
      if (strips) { stat.strips += strips; stat.stripParts.push(`${name(it)} ${strips}`); }
    }
  }
  fs.writeFileSync('public/data/holes.json', JSON.stringify({ v: 2, parts: out }));
  const kb = fs.statSync('public/data/holes.json').size / 1024;
  console.log(`holes.json: acik parca ${stat.open}, dolu cizilecek ${stat.filled} (sifir olmayan kural ${stat.nz}, tek-cift ${stat.filled - stat.nz}; ` +
    `${stat.noHoles} deliksiz, ${stat.dup} tekrarli ucgenli; ${stat.loops} halka, en uzunu ${stat.maxLoop} kose, ${stat.tris} kapak ucgeni, ${kb.toFixed(0)} KB)`);
  console.log(`  serit: ${stat.strips} halka cifti, ${stat.stripParts.length} parca: ${stat.stripParts.join(', ')}`);
  console.log(`  tek isaretli: ${stat.side.join(', ')}`);
  console.log(`  bos kalan: zar ${stat.sheet.length}, tutunma yapragi ${stat.attach.length}: ${stat.attach.join(', ')}; duz ${stat.flat.length}: ${stat.flat.join(', ')}`);
  if (process.env.HOLES_VOL) console.log('  en kucuk hacim / alan^1.5: ' + stat.vol.sort((a, b) => a[0] - b[0]).slice(0, +process.env.HOLES_VOL).map(([v, n]) => `${n} ${v.toExponential(1)}`).join(', '));
  if (stat.broken.length) console.log(`  UYARI kapanmayan sinir yuruyusu: ${stat.broken.join(', ')}`);
}
