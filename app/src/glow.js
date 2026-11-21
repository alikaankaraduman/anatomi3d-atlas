// Seçili / üzerine gelinen yapılar için parlama (halo).
// Yöntem: seçili parçaları küçük bir maskeye çiz -> bulanıklaştır -> ekrana toplayarak (additive) bindir.
// Ana sahne doğrudan ekrana çizildiği için kenar yumuşatma (MSAA) korunur ve maliyet düşüktür.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tex; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tex, vUv) * 0.2270270270;
  c += texture2D(tex, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tex, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tex, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(tex, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tBlur; uniform sampler2D tMask;
uniform vec3 uSel; uniform vec3 uHov;
uniform float uSelK; uniform float uHovK; uniform float uInner;
varying vec2 vUv;
void main() {
  vec4 b = texture2D(tBlur, vUv); vec4 m = texture2D(tMask, vUv);
  // ince yapılarda (sinirler) da görünür kalsın diye düşük değerleri güçlendir
  float s = 1.0 - pow(1.0 - clamp(b.r, 0.0, 1.0), 3.0);
  float h = 1.0 - pow(1.0 - clamp(b.g, 0.0, 1.0), 3.0);
  s *= 1.0 - (1.0 - uInner) * m.r;      // halo dışarıda güçlü, içeride hafif
  h *= 1.0 - m.g;
  gl_FragColor = vec4(uSel * s * uSelK + uHov * h * uHovK, 1.0);
}`;

export class Glow {
  constructor(stage) {
    this.stage = stage;
    this.scene = new THREE.Scene();
    // forceSinglePass: saydam + çift yüzlü malzemeler three.js'te varsayılan olarak iki geçişte çizilir; derinlik testi
    // kapalı ve karışım toplamsal olduğu için tek geçiş aynı maskeyi verir, büyük grup seçiminde çağrı sayısı yarıya iner.
    const mk = color => new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending, toneMapped: false, forceSinglePass: true,
    });
    this.matSel = mk(0xff0000);
    this.matHov = mk(0x00ff00);
    const rt = () => new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    // maske tam çözünürlükte ve kenar yumuşatmalı: silüet ana çizimle birebir örtüşsün
    this.mask = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.a = rt(); this.b = rt();
    this.blur = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR_FRAG, uniforms: { tex: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        tBlur: { value: this.b.texture }, tMask: { value: this.mask.texture },
        uSel: { value: new THREE.Color(0x19c8f5) }, uHov: { value: new THREE.Color(0xffffff) },
        uSelK: { value: 1.0 }, uHovK: { value: 0.55 }, uInner: { value: 0.12 },
      },
    });
    this.quad = new FullScreenQuad(this.blur);
    this.sel = new Map(); this.hov = new Map();   // mesh -> proxy
    this.flashStart = -1e9;
    this.texel = new THREE.Vector2(1, 1);
    stage.onResize((w, h, pr) => {
      const W = Math.max(2, Math.round(w * pr / 2)), H = Math.max(2, Math.round(h * pr / 2));
      this.mask.setSize(Math.max(2, Math.round(w * pr)), Math.max(2, Math.round(h * pr))); this.a.setSize(W, H); this.b.setSize(W, H);
      this.texel.set(1 / W, 1 / H);
    });
    stage.setAfterRender(now => this.render(now));
    stage.onFrame(now => now - this.flashStart < 900 && this.sel.size > 0);
  }

  _sync(map, meshes, material) {
    const want = new Set(meshes);
    for (const [m, p] of map) if (!want.has(m)) { this.scene.remove(p); map.delete(m); }
    for (const m of want) {
      if (map.has(m)) continue;
      const p = new THREE.Mesh(m.geometry, material);
      p.matrixAutoUpdate = false; p.matrix.copy(m.matrixWorld); p.matrixWorld.copy(m.matrixWorld);
      this.scene.add(p); map.set(m, p);
    }
  }
  setSelected(meshes, flash = true) {
    this._sync(this.sel, meshes, this.matSel);
    if (flash && meshes.length) this.flashStart = performance.now();
    this.stage.requestRender();
  }
  setHovered(meshes) { this._sync(this.hov, meshes, this.matHov); this.stage.requestRender(); }
  // parçalarına ayırma görünümünde kaynak Mesh'lerin matrisi değişir: parıltı kopyaları da onları izlesin
  syncMatrices() {
    for (const map of [this.sel, this.hov]) for (const [m, p] of map) { p.matrix.copy(m.matrixWorld); p.matrixWorld.copy(m.matrixWorld); }
    this.stage.requestRender();
  }

  render(now) {
    if (!this.sel.size && !this.hov.size) return;
    const { renderer, camera } = this.stage;
    const t = (now - this.flashStart) / 900;
    // seçim anında kısa bir parlama darbesi, sonra sabit ışıma
    this.comp.uniforms.uSelK.value = 1.0 + (t < 1 ? 1.4 * Math.exp(-4.5 * t) : 0);

    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(this.scene, camera);

    this.quad.material = this.blur;
    const pass = (src, dst, x, y) => {
      this.blur.uniforms.tex.value = src.texture; this.blur.uniforms.uDir.value.set(x * this.texel.x, y * this.texel.y);
      renderer.setRenderTarget(dst); this.quad.render(renderer);
    };
    pass(this.mask, this.a, 1, 0); pass(this.a, this.b, 0, 1);
    pass(this.b, this.a, 2.2, 0); pass(this.a, this.b, 0, 2.2);

    renderer.setRenderTarget(null);
    const ac = renderer.autoClear; renderer.autoClear = false;
    this.quad.material = this.comp; this.quad.render(renderer);
    renderer.autoClear = ac;
  }
}
