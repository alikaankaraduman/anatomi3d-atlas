// Modelleri yükler, parça kayıtlarını tutar, görünürlük/malzeme durumunu uygular ve tıklama tespiti yapar.
//
// Çizim iki yoldan yapılır:
//  - Toplu (BatchedMesh): bir sistemin sıradan durumdaki tüm parçaları tek çizim çağrısıyla çizilir.
//    Kare süresi çizim çağrısı sayısına bağlı olduğundan (çağrı başına yaklaşık 10 mikrosaniye) asıl kazanç buradadır.
//  - Tekil (Mesh): üzerine gelinen ve seçili parçalar kendi malzemeleriyle ayrı çizilir.
// Tekil Mesh nesneleri görünmez olsalar da tıklama tespiti için her zaman kullanılır.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { SYSTEMS, SYS_ORDER } from './text.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
// Sıkıştırılmış modellerin çözülmesi arka plan iş parçacıklarında yapılır: büyük dosyalar (kaslar 10 MB) yüklenirken
// ekran donmaz.
MeshoptDecoder.useWorkers(2);

// Tüm parçalar dünya koordinatında durduğu için sınır küresiyle ucuz bir ön eleme yapılır: ışın küreyi kesmiyorsa
// ya da küre "far" sınırının ötesindeyse BVH'ye hiç girilmez. BVH ilk ihtiyaçta kurulur (ayrıca boşta önceden kurulur).
// Parçalarına ayırma görünümünde Mesh'in matrisi bir ötelemedir; küre o yüzden dünya matrisine taşınır.
const _sphere = new THREE.Sphere();
function lazyRaycast(raycaster, intersects) {
  const geo = this.geometry, s = _sphere.copy(geo.boundingSphere).applyMatrix4(this.matrixWorld), ray = raycaster.ray;
  if (!ray.intersectsSphere(s)) return;
  if (ray.origin.distanceTo(s.center) - s.radius > raycaster.far) return;
  if (!geo.boundsTree) geo.computeBoundsTree();
  acceleratedRaycast.call(this, raycaster, intersects);
}

const isIdentity = m => m.elements.every((v, i) => v === (i % 5 === 0 ? 1 : 0));

// Uzun bir yükleme döngüsü ana iş parçacığını kilitlemesin: ~10 ms'de bir tarayıcıya nefes aldır.
let sliceStart = 0;
async function breathe() {
  if (performance.now() - sliceStart < 10) return;
  await new Promise(r => setTimeout(r, 0));
  sliceStart = performance.now();
}

// Saydam ("hayalet") katman: kenarlarda belirgin, yüzeyde neredeyse görünmez röntgen görünümü.
// Hem tekil Mesh hem BatchedMesh ile kullanılır; toplu ağdaki örnek matrisi (parçalarına ayırma) ve kesit düzlemi uygulanır.
function ghostMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    uniforms: { uBase: { value: 0.035 }, uEdge: { value: 0.42 }, uPow: { value: 2.4 } },
    vertexShader: /* glsl */`
      attribute vec4 color;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      #include <batching_pars_vertex>
      #include <clipping_planes_pars_vertex>
      void main() {
        #include <batching_vertex>
        vec4 mvPosition = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;   // parçalarına ayırma ötelemesi
          n = mat3(batchingMatrix) * n;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        vN = normalMatrix * n; vV = -mvPosition.xyz; vC = color.rgb;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uBase; uniform float uEdge; uniform float uPow;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = uBase + uEdge * pow(f, uPow);
        gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Sıkıştırılmış dosyadan gelen (araya serpiştirilmiş, dolgulu) özniteliği aynı türde bağımsız bir diziye kopyalar.
function plainAttribute(attr) {
  const { itemSize, normalized, count } = attr;
  const inter = attr.isInterleavedBufferAttribute;
  const src = inter ? attr.data.array : attr.array;
  const stride = inter ? attr.data.stride : itemSize;
  const offset = inter ? attr.offset : 0;
  const out = new src.constructor(count * itemSize);
  for (let i = 0; i < count; i++) for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = src[i * stride + offset + c];
  return new THREE.BufferAttribute(out, itemSize, normalized);
}

// Opak toplu çizimlerde sıra: dış katmanlar önce çizilirse arkada kalan pikseller derinlik testinde elenir.
const BATCH_ORDER = { muscle: -6, joint: -5, bone: -4, vessel: -3, nerve: -2, organ: -1 };
const IDENTITY = new THREE.Matrix4();

export class Model {
  constructor(stage, glow, { batching = true } = {}) {
    this.stage = stage; this.glow = glow; this.batching = batching;
    this.items = new Map();        // id -> kayıt
    this.list = [];                // tüm kayıtlar
    this.groups = [];              // { n, tr, p, s, kids:[], items:[] }
    this.roots = {}; this.rootItems = {}; this.loaded = {}; this.layerRoot = {}; this.batches = {};
    this.failed = new Set();       // modeli yüklenemeyen sistemler
    for (const s of SYS_ORDER) {
      this.roots[s] = []; this.rootItems[s] = []; this.loaded[s] = false; this.batches[s] = [];
      const g = new THREE.Group(); g.name = s; stage.scene.add(g); this.layerRoot[s] = g;
    }

    const std = (extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.56, metalness: 0, ...extra });
    this.mat = {
      // Kapalı ağlar tek yüzlü çizilir (arka yüzler ayıklanır); açık yüzeyler (fasya, damar, kesik uçlu tüpler) çift yüzlü.
      solid: std({ side: THREE.FrontSide }),
      solidOpen: std({ side: THREE.DoubleSide }),
      ghost: ghostMaterial(),
      hover: std({ side: THREE.DoubleSide, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.16 }),
      selected: std({ side: THREE.DoubleSide, roughness: 0.4, color: 0xa6e2ff, emissive: 0x0878b0, emissiveIntensity: 0.5 }),
      // toplu çizim için ayrı örnekler (aynı ayarlar)
      batchSolid: std({ side: THREE.FrontSide }),
      batchSolidOpen: std({ side: THREE.DoubleSide }),
      batchGhost: ghostMaterial(),
    };
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.pickables = [];           // seçim modundaki görünür parçalar
    this.pickSoft = [];            // izole görünümde saydam çizilen parçalar: ancak arkalarında bir şey yoksa tıklanır
    this.pickSet = new Set();
    this.overrides = new Map();    // kimlik -> malzeme (isGhostMat ve _present'e bakın)
    this.capHit = null;            // dolu kesit yüzü için tıklama (section.js atar): ışın -> { rec, distance, point } | null
    this.occluders = [];           // diğer sistemlerin görünür ve opak parçaları: arkalarındaki yapı seçilemez
    this._ndc = new THREE.Vector2();
    this._bvhJob = null;
  }

  // Boşta kalan zamanda BVH'leri önceden kur: ilk fareyle gezinmede ışının geçtiği onlarca parçanın BVH'si aynı
  // anda kurulup ekranı dondurmasın. Önce seçim modundaki, sonra görünür parçalar (tıklamayı engelleyebilecekler).
  prebuildBVH(mode) {
    this._bvhMode = mode;
    if (this._bvhJob) return;
    const idle = window.requestIdleCallback ? cb => requestIdleCallback(cb, { timeout: 1500 }) : cb => setTimeout(cb, 40);
    const step = deadline => {
      this._bvhJob = null;
      const t0 = performance.now();
      const hasTime = () => (deadline?.timeRemaining && !deadline.didTimeout ? deadline.timeRemaining() > 3 : performance.now() - t0 < 8);
      const wanted = r => r.geo && !r.geo.boundsTree && (r.s === this._bvhMode || r.vis);
      let more = false;
      for (const pass of [r => r.s === this._bvhMode, () => true]) {
        for (const r of this.list) {
          if (!wanted(r) || !pass(r)) continue;
          if (!hasTime()) { more = true; break; }
          r.geo.computeBoundsTree();
        }
        if (more) break;
      }
      if (more) this._bvhJob = idle(step);
    };
    this._bvhJob = idle(step);
  }

  async loadMeta() {
    const meta = await (await fetch('data/meta.json')).json();
    this.groups = meta.groups.map((g, i) => ({ ...g, i, kids: [], items: [] }));
    for (const g of this.groups) (g.p >= 0 ? this.groups[g.p].kids : this.roots[g.s]).push(g.i);
    for (const it of meta.items) {
      const rec = { ...it, mesh: null, geo: null, box: null, sphere: null, batch: null, inst: -1, inBatch: false, vis: false, ghost: false };
      this.items.set(it.id, rec); this.list.push(rec);
      if (it.g >= 0) this.groups[it.g].items.push(rec); else this.rootItems[it.s].push(rec);
    }
    // karşı taraf eşleşmesi
    const key = it => it.s + '|' + it.n + '|' + (it.x || '');   // kadın ve erkek kalça kemiği ayrı çiftlerdir
    const bySide = new Map();
    for (const it of this.list) if (it.sd) bySide.set(key(it) + '|' + it.sd, it);
    for (const it of this.list) if (it.sd) it.twin = bySide.get(key(it) + '|' + (it.sd === 'r' ? 'l' : 'r')) || null;
    // Cinsiyete özgü parçalar (x: 'm' | 'f'): veride hangileri var? Kadın/erkek seçici yalnızca ikisi de varsa görünür.
    this.sexes = new Set(this.list.map(r => r.x).filter(Boolean));
    return meta;
  }

  async loadSystem(sys, onProgress) {
    const files = SYSTEMS[sys].files; const frac = files.map(() => 0);
    await Promise.all(files.map((f, i) => this._loadFile(sys, f, p => { frac[i] = p; onProgress?.(frac.reduce((a, b) => a + b, 0) / files.length); })));
    if (this.batching) await this._buildBatches(sys);
    this.loaded[sys] = true;
  }

  async _loadFile(sys, file, onProgress) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`models/${file}.glb`, e => onProgress?.(e.total ? e.loaded / e.total : 0));
    gltf.scene.updateMatrixWorld(true);
    const root = this.layerRoot[sys]; const v = new THREE.Vector3();
    sliceStart = performance.now();
    for (const node of gltf.scene.children) {
      await breathe();
      const rec = this.items.get(node.name); if (!rec) continue;
      // düğüm tek ağ ya da (isteğe bağlı ikinci detay seviyesi varsa) ağ grubu olabilir: en ayrıntılısını al
      const parts = (node.isMesh ? [node] : node.children.filter(c => c.isMesh)).sort((a, b) => b.geometry.index.count - a.geometry.index.count);
      if (!parts.length) continue;
      const src = parts[0].geometry; const m0 = parts[0];
      // Nicemlenmiş konumları dünya koordinatında düz float değerlere çevir; böylece tüm parçalar birim
      // dönüşümle durur: tıklama, sınır kutuları ve toplu çizim doğrudan çalışır.
      const sp = src.attributes.position; const arr = new Float32Array(sp.count * 3);
      for (let i = 0; i < sp.count; i++) { v.fromBufferAttribute(sp, i).applyMatrix4(m0.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      geo.setAttribute('normal', plainAttribute(src.attributes.normal));
      geo.setAttribute('color', plainAttribute(src.attributes.color));
      geo.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.solidFor(rec));
      mesh.name = rec.id; mesh.userData.id = rec.id;
      mesh.matrixAutoUpdate = false; mesh.raycast = lazyRaycast; mesh.visible = false;
      root.add(mesh);
      rec.mesh = mesh; rec.geo = geo; rec.box = geo.boundingBox; rec.sphere = geo.boundingSphere;
    }
  }

  // Bir sistemin parçalarını iki toplu ağda birleştirir: kapalı ağlar (tek yüzlü) ve açık yüzeyler (çift yüzlü).
  // Kopyalama arada tarayıcıya nefes aldırarak yapılır; parçalar toplu ağa ancak ağ tamamlanınca tek seferde bağlanır,
  // böylece yarım kalmış bir toplu ağ hiçbir zaman çizime girmez.
  async _buildBatches(sys) {
    const recs = this.list.filter(r => r.s === sys && r.mesh);
    for (const open of [false, true]) {
      const set = recs.filter(r => !!r.o === open); if (!set.length) continue;
      let nv = 0, ni = 0; for (const r of set) { nv += r.geo.attributes.position.count; ni += r.geo.index.count; }
      const bm = new THREE.BatchedMesh(set.length, nv, ni, open ? this.mat.batchSolidOpen : this.mat.batchSolid);
      bm.name = `batch:${sys}:${open ? 'open' : 'closed'}`;
      bm.userData.open = open; bm.userData.order = BATCH_ORDER[sys] ?? 0;
      bm.frustumCulled = false;            // parça bazında ayıklama BatchedMesh içinde yapılır
      bm.perObjectFrustumCulled = true; bm.sortObjects = true;
      bm.matrixAutoUpdate = false; bm.raycast = () => {};
      const inst = [];
      sliceStart = performance.now();
      for (const r of set) {
        await breathe();
        const id = bm.addInstance(bm.addGeometry(r.geo));
        bm.setMatrixAt(id, IDENTITY); bm.setVisibleAt(id, false);
        inst.push(id);
      }
      set.forEach((r, k) => { r.inst = inst[k]; r.batch = bm; r.inBatch = false; });
      this.layerRoot[sys].add(bm); this.batches[sys].push(bm);
    }
  }

  // --- gruplar ---
  groupItems(gi, out = []) {
    const g = this.groups[gi];
    for (const it of g.items) out.push(it);
    for (const k of g.kids) this.groupItems(k, out);
    return out;
  }
  groupPath(gi) { const p = []; for (let i = gi; i >= 0; i = this.groups[i].p) p.unshift(this.groups[i]); return p; }

  boundsOf(recs) {
    const box = new THREE.Box3();
    // parçalarına ayırma görünümünde kayan parçaların kutusu da kayar
    for (const r of recs) if (r.box) box.union(r.mesh && !isIdentity(r.mesh.matrixWorld) ? r.box.clone().applyMatrix4(r.mesh.matrixWorld) : r.box);
    return box;
  }
  visibleBounds() { return this.boundsOf(this.list.filter(r => r.vis)); }

  solidFor(r) { return r.o ? this.mat.solidOpen : this.mat.solid; }

  // Bir parçayı verilen durumda göster: sıradan durumdaysa toplu ağdaki örneği, değilse kendi Mesh'i görünür.
  // kind: 'layer' (katman görünümü) | 'hover' | 'selected'
  // Bir parçanın kendi malzemesi (overrides: kimlik -> malzeme; ör. kalp modunda kapaklar ve koroner dallar renkli,
  // odacıklar yarı saydam): sıradan durumda toplu ağ yerine kendi Mesh'iyle çizilir. Saydam olanlar userData.ghost taşır.
  isGhostMat(m) { return m === this.mat.ghost || !!m?.userData?.ghost; }
  _present(r, vis, kind, ghost) {
    // Seçili parça seçim malzemesiyle çizilir; üzerine gelinen parça kendi (ör. saydam renkli) malzemesini korur,
    // vurgu çevresindeki parıltıdır. Özel malzeme kesit düzlemini izler (sekme değişince eski düzlem kalmasın).
    const ov = kind !== 'selected' ? this.overrides.get(r.id) : null;
    if (ov && (ov.clippingPlanes?.[0] ?? null) !== (this.clipPlane ?? null)) { ov.clippingPlanes = this.clipPlane ? [this.clipPlane] : null; ov.needsUpdate = true; }
    // izole görünümde bağlam olarak saydam çizilen parça (state.isoGhost) toplu ağdan çizilemez: toplu ağ opak malzemede
    const viaBatch = vis && kind === 'layer' && r.batch !== null && !ov && (!ghost || r.batch.material === this.mat.batchGhost);
    if (r.batch && r.inBatch !== viaBatch) { r.batch.setVisibleAt(r.inst, viaBatch); r.inBatch = viaBatch; }
    const m = r.mesh;
    m.visible = vis && !viaBatch;
    // Mesh görünmese de malzemesi atanır: tıklama tespiti yüz yönünü (tek/çift yüz) malzemeden okur.
    m.material = kind === 'selected' ? this.mat.selected : ov || (kind === 'hover' ? this.mat.hover : ghost ? this.mat.ghost : this.solidFor(r));
    m.renderOrder = this.isGhostMat(m.material) ? 2 : 0;
    r.vis = vis; r.ghost = ghost;
  }

  // --- durum uygulama ---
  apply(state) {
    const sel = state.selected, pick = [], soft = [], occ = [], selMeshes = [];
    for (const s of SYS_ORDER) {
      const ghost = state.layer[s] === 'ghost';   // izole görünümde de katman durumu geçerli
      for (const bm of this.batches[s]) {
        bm.material = ghost ? this.mat.batchGhost : bm.userData.open ? this.mat.batchSolidOpen : this.mat.batchSolid;
        bm.renderOrder = ghost ? 2 : bm.userData.order;
      }
    }
    for (const r of this.list) {
      if (!r.mesh) continue;
      const isSel = sel.has(r.id);
      let vis = false, ghost = false;
      if (r.x && r.x !== state.sex) {
        // karşı cinsiyetin parçası: çizilmez, seçilemez (seçimden de çıkarılmış olur)
      } else if (state.isolate) {
        // izole görünüm; isoGhost: yanında saydam bağlam olarak gösterilen parçalar (ör. kalp modunda göğüs iskeleti)
        // katman durumu burada da geçerli: konunun içinde bir sistem gizlenebilir ya da saydam yapılabilir
        const ls = state.layer[r.s], inIso = state.isolate.has(r.id);
        vis = (inIso && ls !== 'hide') || !!state.isoGhost?.has(r.id);
        ghost = vis && (!inIso || ls === 'ghost');
      } else if (!state.hidden.has(r.id)) {
        const ls = state.layer[r.s];
        vis = ls !== 'hide' && state.sub[r.sub] !== false;
        ghost = vis && ls === 'ghost';
        if (isSel && !vis) vis = true;      // seçili yapı her zaman görünür
      }
      // Kas katmanı soyma (state.peelOn, main.js): dıştan peel.n katmandaki kaslar gizlenir ya da saydam çizilir;
      // saydam olanlar ikinci sırada tıklanır (içlerindeki derin kaslar önce gelir) ve hiçbir şeyi örtmez. Seçili kas kalır.
      let peeled = false;
      if (vis && state.peelOn && r.sub === 'muscle' && !isSel && (this.depth?.d[r.id] || 99) <= state.peel.n) {
        peeled = true;
        if (state.peel.ghost) ghost = true; else vis = false;
      }
      const kind = isSel ? 'selected' : state.hover === r.id ? 'hover' : 'layer';
      this._present(r, vis, kind, ghost);
      if (vis && isSel) selMeshes.push(r.mesh);
      if (vis) {
        // izole görünümde (ör. bir Aanki konusu) görünen her yapı tıklanabilir; değilse yalnızca seçim modunun sistemi
        // izole görünümde saydam çizilenler (saydam katman, saydam özel malzeme, bağlam) ikinci sırada tıklanır:
        // içlerindeki yapılar önce gelir, arkalarında bir şey yoksa kendileri seçilir
        // userData.noPick taşıyan özel malzeme (çalışma modlarında neredeyse görünmez bağlam, kesilip gizlenen kafatası
        // kubbesi): çizilir ama tıklanmaz ve üzerine gelinmez
        if (peeled) { if (state.isolate || r.s === state.mode) soft.push(r.mesh); }
        else if (state.isolate) { const ovm = this.overrides.get(r.id); if (!ovm?.userData?.noPick) (ghost || this.isGhostMat(ovm) ? soft : pick).push(r.mesh); }
        else if (r.s === state.mode) pick.push(r.mesh);
        else if (!this.isGhostMat(r.mesh.material)) occ.push(r.mesh);   // gerçekten opak çizilenler (seçili saydam parça da)
      }
    }
    this.pickables = pick;
    this.pickSoft = soft;
    this.occluders = occ;
    this.pickSet = new Set([...pick, ...soft]);
    this.prebuildBVH(state.mode);
    return selMeshes;
  }

  // Yalnızca üzerine gelinen parçanın durumunu değiştir (tüm listeyi dolaşmadan).
  setHover(state, prevId, nextId) {
    for (const id of [prevId, nextId]) {
      const r = id && this.items.get(id); if (!r?.mesh || !r.vis) continue;
      if (state.selected.has(id)) continue;
      this._present(r, true, id === nextId ? 'hover' : 'layer', r.ghost);
    }
    this.stage.requestRender();
  }

  // --- tıklama ---
  _cast(x, y) {
    const { canvas, camera } = this.stage; const rect = canvas.getBoundingClientRect();
    this._ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, camera);
    // Dolu kesit yüzü düzlemin üzerinde, her şeyin önündedir: imleç bir kesit yüzündeyse o yapı seçilir (başka bir
    // sistemin opak parçasınınsa engellenir).
    const cap = this.capHit?.(this.raycaster.ray);
    if (cap) return this.pickSet.has(cap.rec.mesh) ? { object: cap.rec.mesh, distance: cap.distance, point: cap.point } : null;
    // kesit açıkken düzlemin kestiği (çizilmeyen) taraftaki isabetler sayılmaz; her ağın bütün isabetlerine bakılır
    const clip = this.clipPlane, seen = h => !clip || clip.distanceToPoint(h.point) >= -1e-4;
    if (clip) this.raycaster.firstHitOnly = false;
    let hit = this.raycaster.intersectObjects(this.pickables, false).find(seen);
    if (!hit && this.pickSoft?.length) hit = this.raycaster.intersectObjects(this.pickSoft, false).find(seen);
    if (!hit) { this.raycaster.firstHitOnly = true; return null; }
    // Başka bir sistemin opak bir parçası (ör. kas modunda kemik) önündeyse imleç aslında onun üzerindedir:
    // arkadaki görünmeyen yapı seçilmesin. Yalnızca kameradan isabete kadar olan aralık denetlenir.
    if (this.occluders.length) {
      this.raycaster.far = hit.distance - 1e-3;
      const blocked = this.raycaster.intersectObjects(this.occluders, false).some(seen);
      this.raycaster.far = Infinity;
      if (blocked) { this.raycaster.firstHitOnly = true; return null; }
    }
    this.raycaster.firstHitOnly = true;
    return hit;
  }
  // Bir ekran noktasındaki bütün isabetler, yakından uzağa (tıklanabilir ve saydam tıklanabilir parçalar; kesitin görünen
  // yanı). soft: saydam çizilen parça. Çalışma modlarının testinde "Yapıyı bul" cevabını değerlendirmek için.
  hitsAt(x, y) {
    const { canvas, camera } = this.stage; const rect = canvas.getBoundingClientRect();
    this._ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, camera);
    const clip = this.clipPlane, seen = h => !clip || clip.distanceToPoint(h.point) >= -1e-4;
    this.raycaster.firstHitOnly = false;
    const hits = this.raycaster.intersectObjects([...this.pickables, ...(this.pickSoft || [])], false).filter(seen);
    this.raycaster.firstHitOnly = true;
    return hits.map(h => ({ rec: this.items.get(h.object.userData.id), distance: h.distance, soft: this.isGhostMat(h.object.material) })).filter(h => h.rec);
  }
  // fuzzy: tam isabet yoksa imlecin çevresine de bak (ince sinir ve damarları yakalamak için)
  pick(x, y, fuzzy = 0) {
    let hit = this._cast(x, y);
    if (!hit && fuzzy > 0) {
      for (const r of [fuzzy * 0.5, fuzzy]) {
        let best = null;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2; const h = this._cast(x + Math.cos(a) * r, y + Math.sin(a) * r);
          if (h && (!best || h.distance < best.distance)) best = h;
        }
        if (best) { hit = best; break; }
      }
    }
    return hit ? this.items.get(hit.object.userData.id) : null;
  }
}
