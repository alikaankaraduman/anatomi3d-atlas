// Sahne, kamera, ışıklar, kontroller ve "gerektiğinde çiz" döngüsü.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const HOME_TARGET = new THREE.Vector3(0, 88, 0);
const VIEW_DIRS = {
  front: [0, 0, 1], back: [0, 0, -1],
  right: [-1, 0, 0], left: [1, 0, 0],   // anatomik sağ = -X
  top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
};

export function createStage(canvas) {
  // şablon (stencil) tamponu dolu kesit yüzü için (section.js)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x26282d);

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 3000);
  camera.position.set(0, 92, 430);
  scene.add(camera);

  // Işıklar: gökyüzü/zemin dolgu ışığı + kamerayı izleyen ana ışık + arkadan kenar ışığı.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4c57, 1.35));
  const head = new THREE.DirectionalLight(0xffffff, 2.3);
  head.position.set(-0.55, 0.8, 1);
  head.target.position.set(0, 0, -1);
  camera.add(head, head.target);
  const rim = new THREE.DirectionalLight(0xbcd3ff, 0.7);
  rim.position.set(120, 260, -300);
  scene.add(rim);

  // Blender benzeri zemin ızgarası.
  const grid = new THREE.GridHelper(800, 80, 0x5a606c, 0x383b43);
  grid.material.transparent = true; grid.material.opacity = 0.55; grid.material.depthWrite = false;
  grid.position.y = -0.05;
  scene.add(grid);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true; controls.dampingFactor = 0.14;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.4; controls.maxDistance = 1600;
  controls.rotateSpeed = 0.85; controls.zoomSpeed = 1.15;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  controls.update();

  let dirty = true;
  const requestRender = () => { dirty = true; };
  controls.addEventListener('change', requestRender);

  const size = new THREE.Vector2(1, 1);
  let pixelRatio = renderer.getPixelRatio();
  const resizeHooks = [];
  // Her karede çağrılır: tarayıcı yakınlaştırması ya da başka bir ekrana taşıma piksel oranını değiştirirse
  // çizim tamponu da yeniden boyutlanır (yoksa görüntü bulanıklaşır ya da gereksiz yere büyük çizilir).
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === size.x && h === size.y && pr === pixelRatio) return;
    size.set(w, h);
    if (pr !== pixelRatio) { pixelRatio = pr; renderer.setPixelRatio(pr); }
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    for (const f of resizeHooks) f(w, h, pr);
    dirty = true;
    if (pendingFrame && usable()) { const p = pendingFrame; pendingFrame = null; frameBox(p.box, p.dir, 0, p.dist); }
  }
  new ResizeObserver(resize).observe(canvas);

  // --- kamera uçuşu ---
  // Kamera hedefin etrafında küresel koordinatlarla (uzaklık, yükseklik açısı, yön açısı) uçar: önden arkaya
  // geçerken vücudun içinden değil, yanından dolaşır.
  let fly = null;
  const _off = new THREE.Vector3();
  function flyTo(pos, target, ms = 480) {
    if (ms <= 0) { fly = null; camera.position.copy(pos); controls.target.copy(target); controls.update(); dirty = true; return; }
    const s0 = new THREE.Spherical().setFromVector3(_off.subVectors(camera.position, controls.target));
    const s1 = new THREE.Spherical().setFromVector3(_off.subVectors(pos, target));
    const TAU = Math.PI * 2;
    const dTheta = ((((s1.theta - s0.theta + Math.PI) % TAU) + TAU) % TAU) - Math.PI;   // en kısa yön, [-π, π)
    fly = { s0, s1, dTheta, t0: controls.target.clone(), t1: target.clone(), p1: pos.clone(), start: performance.now(), ms };
  }
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Panellerin kapladığı kenar boşlukları (CSS piksel): odaklama serbest alana göre yapılır.
  let insetsProvider = null;
  let pendingFrame = null;   // tuval henüz gerçek boyutunu almadıysa çerçevelemeyi ertele
  const usable = () => size.x >= 160 && size.y >= 160;
  const HOME_BOX = new THREE.Box3(new THREE.Vector3(-45, 0, -22), new THREE.Vector3(45, 172, 22));
  const _c = new THREE.Vector3();

  // Kutuyu, verilen bakış yönünden, panellerin örtmediği alana tam sığacak şekilde çerçevele.
  // dist: kamera uzaklığı verilirse kutuya sığdırma uzaklığının yerine geçer (odak yönü örtülüyken main.js clearView)
  function frameBox(box, dir, ms, dist) {
    if (!box || box.isEmpty()) return;
    const d = dir ? dir.clone().normalize() : camera.position.clone().sub(controls.target).normalize();
    if (!usable()) pendingFrame = { box: box.clone(), dir: d.clone(), dist };
    const p = framePlan(box, d, dist);
    flyTo(p.pos, p.target, ms);
  }
  // kamera konumu ve hedefi (uçmadan): frameBox ve odaklamanın bakış yönü seçimi kullanır
  function framePlan(box, d, distOverride) {
    const w = Math.max(size.x, 1), h = Math.max(size.y, 1);
    const insets = usable() && insetsProvider ? insetsProvider() : { l: 0, r: 0, t: 0, b: 0 };
    const freeW = Math.max(w - insets.l - insets.r, w * 0.42), freeH = Math.max(h - insets.t - insets.b, h * 0.5);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
    const up = new THREE.Vector3().crossVectors(d, right).normalize();
    // kutunun ekran eksenlerindeki yarı genişlik / yükseklik / derinliği
    const center = box.getCenter(new THREE.Vector3());
    let hw = 0, hh = 0, hd = 0;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      hw = Math.max(hw, Math.abs(_c.dot(right))); hh = Math.max(hh, Math.abs(_c.dot(up))); hd = Math.max(hd, Math.abs(_c.dot(d)));
    }
    hw = Math.max(hw, 0.2); hh = Math.max(hh, 0.2);
    const margin = 1.14;
    const fit = Math.max(Math.max(hh * margin / (tanV * freeH / h), hw * margin / (tanV * freeW / h)) + hd, 1.2);
    const dist = distOverride > 0 ? Math.max(distOverride, 0.5) : fit;
    // serbest alanın merkezi ekran merkezinden kaymışsa hedefi o kadar ötele
    const wpp = (2 * (distOverride > 0 ? Math.max(dist - hd, dist * 0.5) : dist - hd) * tanV) / h;
    const dx = (insets.l - insets.r) / 2, dy = (insets.t - insets.b) / 2;
    const target = center.clone().addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
    return { pos: target.clone().addScaledVector(d, dist), target };
  }
  const focusBox = box => frameBox(box);
  function setView(name, homeBox) {
    if (name === 'home') return frameBox(homeBox && !homeBox.isEmpty() ? homeBox : HOME_BOX, new THREE.Vector3(0, 0.02, 1));
    const v = VIEW_DIRS[name]; if (!v) return;
    const dist = camera.position.distanceTo(controls.target);
    const dir = new THREE.Vector3(...v).normalize();
    flyTo(controls.target.clone().addScaledVector(dir, dist), controls.target.clone());
  }

  // --- döngü ---
  const frameHooks = [];      // her karede çağrılır, true dönerse yeniden çizim gerekir
  let afterRender = null;     // ana çizimden sonra (parlama katmanı)
  const stats = { frames: 0, last: performance.now(), fps: 0, ms: 0 };

  function tick(now) {
    requestAnimationFrame(tick);
    resize();
    if (fly) {
      const k = Math.min(1, (now - fly.start) / fly.ms), e = ease(k);
      if (k >= 1) { camera.position.copy(fly.p1); controls.target.copy(fly.t1); fly = null; }
      else {
        controls.target.lerpVectors(fly.t0, fly.t1, e);
        const { s0, s1 } = fly;
        camera.position.setFromSphericalCoords(
          THREE.MathUtils.lerp(s0.radius, s1.radius, e), THREE.MathUtils.lerp(s0.phi, s1.phi, e), s0.theta + fly.dTheta * e,
        ).add(controls.target);
      }
      dirty = true;
    }
    controls.update();
    for (const f of frameHooks) if (f(now)) dirty = true;
    if (!dirty) return;
    dirty = false;

    const d = camera.position.distanceTo(controls.target);
    camera.near = THREE.MathUtils.clamp(d * 0.01, 0.02, 4);
    camera.far = d + 1800;
    camera.updateProjectionMatrix();

    const t = performance.now();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    if (afterRender) afterRender(now);
    stats.ms = performance.now() - t;
    stats.frames++;
    if (now - stats.last > 1000) { stats.fps = Math.round(stats.frames * 1000 / (now - stats.last)); stats.frames = 0; stats.last = now; }
  }
  requestAnimationFrame(tick);

  return {
    renderer, scene, camera, controls, canvas, size, stats,
    setInsetsProvider: f => { insetsProvider = f; },
    insets: () => (insetsProvider ? insetsProvider() : { l: 0, r: 0, t: 0, b: 0 }),
    requestRender, focusBox, setView, flyTo,
    frameBox: (box, dir, dist) => frameBox(box, dir, undefined, dist),
    framePlan: (box, dir) => framePlan(box, (dir || camera.position.clone().sub(controls.target)).clone().normalize()),
    onResize: f => { resizeHooks.push(f); f(size.x, size.y, renderer.getPixelRatio()); },
    onFrame: f => frameHooks.push(f),
    setAfterRender: f => { afterRender = f; },
    isFlying: () => !!fly,
  };
}
