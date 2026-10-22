import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCdLiquidMetalBackdrop, liquidBackdropSize } from './CdLiquidMetalBackdrop.js';

test('background field pixels are bounded independently from sharp CD artwork', () => {
  for (const [w, h] of [[1920, 1080], [3840, 2160], [390, 844]]) {
    const size = liquidBackdropSize(w, h);
    assert.ok(size.width * size.height <= 640_000);
    assert.ok(Math.abs(size.width / size.height - w / h) < 0.004);
  }
});

test('CD background reuses the supplied renderer and refreshes around 30 Hz', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const geometry = new THREE.PlaneGeometry(2, 2);
  const draws = [];
  let target;
  const renderer = { setRenderTarget(value) { target = value; }, render(scene) { draws.push({ target, material: scene.children[0].material }); } };
  const backdrop = createCdLiquidMetalBackdrop(renderer, new THREE.Camera(), geometry, () => ({}));
  try {
    backdrop.resize(1920, 1080);
    for (let frame = 0; frame < 120; frame++) backdrop.update(1 / 60);
    assert.ok(draws.length >= 59 && draws.length <= 61, `background draws: ${draws.length}`);
    assert.ok(target.width * target.height <= 640_000);
    assert.equal(backdrop.texture, target.texture);
    // Every elapsed interval is consumed once, including the first forced draw.
    const time = draws.at(-1).material.uniforms.uTime.value;
    assert.ok(time > 1.96 && time <= 2.000001);
    let disposed = false;
    draws.at(-1).material.addEventListener('dispose', () => { disposed = true; });
    backdrop.dispose();
    assert.equal(disposed, true);
  } finally {
    geometry.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
