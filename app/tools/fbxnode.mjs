// Three.js FBXLoader'i Node icinde calistirmak icin minimal ortam + yukleme yardimcisi.
import fs from 'node:fs';
import * as THREE from 'three';

// FBX icinde doku referansi varsa ImageLoader document ister; sahte bir tane veriyoruz.
if (typeof globalThis.document === 'undefined') {
  const fakeEl = () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    style: {}, set src(v) {}, get src() { return ''; },
  });
  globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };
}
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

export function loadFBX(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new FBXLoader();
  const root = loader.parse(ab, '');
  root.updateMatrixWorld(true);
  return root;
}
export { THREE };
