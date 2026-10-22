import assert from 'node:assert/strict';
import test from 'node:test';
import { CD_PIXEL_BUDGET, CD_SURFACE_PIXEL_BUDGET, advanceMotion, createRenderClock, initialRenderRatio, nextRenderRatio, renderRatios } from './frameBudget.js';

test('sharp artwork does not spend the four-sample glass pixel budget', () => {
  for (const [w, h, dpr] of [[390, 844, 3], [1000, 800, 1.5], [1920, 1080, 1], [3840, 2160, 2]]) {
    for (const scale of [1, 0.85, 0.6]) {
      const { surface, optics } = renderRatios(w, h, dpr, scale);
      assert.ok(surface >= optics);
      assert.ok(surface <= Math.min(dpr, 1.5));
      assert.ok(w * h * surface ** 2 <= CD_SURFACE_PIXEL_BUDGET + 1);
      assert.ok(w * h * optics ** 2 <= CD_PIXEL_BUDGET + 1);
      assert.ok(Math.abs(optics - initialRenderRatio(w, h, dpr) * scale) < 1e-9);
    }
  }
  const desktop = renderRatios(1920, 1080, 1);
  assert.equal(desktop.surface, 1);
  assert.ok(desktop.optics < 0.8);
});

test('refraction targets stay within the pixel budget on high-DPI displays', () => {
  for (const [w, h, dpr] of [[795, 428, 1.5], [1920, 892, 2], [3840, 1900, 2]]) {
    const ratio = initialRenderRatio(w, h, dpr);
    assert.ok(w * h * ratio ** 2 <= CD_PIXEL_BUDGET + 1);
    assert.ok(ratio <= dpr);
  }
});

test('high-refresh displays cap CD drawing at 60fps without losing motion time', () => {
  for (const refresh of [60, 144, 240]) {
    const clock = createRenderClock();
    let frames = 0;
    let elapsed = 0;
    for (let sample = 0; sample < refresh * 2; sample++) {
      const dt = clock.sample(sample * 1000 / refresh);
      if (dt === null) continue;
      frames++;
      elapsed += dt;
    }
    assert.ok(frames >= 119 && frames <= 121, `${refresh}Hz submitted ${frames} frames`);
    assert.ok(Math.abs(elapsed - 2) < 0.025);
    clock.reset();
    assert.equal(clock.sample(100000), 1 / 60);
  }
});

test('adaptive resolution handles severe slow frames and can go below DPR 1', () => {
  assert.ok(nextRenderRatio(1, Array(24).fill(0.15)) < 1);
  assert.equal(nextRenderRatio(0.75, Array(24).fill(0.15)), 0.75);
  assert.equal(nextRenderRatio(1, Array(24).fill(1 / 60)), 1);
  assert.equal(nextRenderRatio(1, Array(24).fill(1)), 1);
});

test('CD opening takes the same wall time at 60, 15 and 5 fps', () => {
  for (const fps of [60, 15, 5]) {
    let clock = 0;
    let largestStep = 0;
    for (let frame = 0; frame < fps * 3; frame++) {
      advanceMotion(1 / fps, dt => { clock += dt; largestStep = Math.max(largestStep, dt); });
    }
    assert.ok(Math.abs(clock - 3) < 0.00001);
    assert.ok(largestStep <= 1 / 60);
  }
});
