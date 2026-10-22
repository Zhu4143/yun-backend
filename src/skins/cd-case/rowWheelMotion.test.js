import assert from 'node:assert/strict';
import test from 'node:test';
import { createRowWheelMotion, wheelPixels } from './rowWheelMotion.js';

test('wheel and touchpad units retain direction and use the dominant axis', () => {
  assert.equal(wheelPixels({ deltaY: 100 }, 800), 100);
  assert.equal(wheelPixels({ deltaY: -3, deltaMode: 1 }, 800), -48);
  assert.equal(wheelPixels({ deltaY: 1, deltaMode: 2 }, 800), 800);
  assert.equal(wheelPixels({ deltaX: -80, deltaY: 4 }, 800), -80);
  assert.equal(wheelPixels({ deltaY: Infinity }, 800), 0);
});

test('only the targeted row moves and larger wheel input produces proportionally faster travel', () => {
  const slow = createRowWheelMotion(); const fast = createRowWheelMotion();
  slow.push(1, 40); fast.push(1, 160);
  assert.equal(slow.step(0, 1 / 60), 0);
  assert.equal(slow.step(2, 1 / 60), 0);
  assert.equal(slow.step(3, 1 / 60), 0);
  assert.equal(fast.step(1, 1 / 60), slow.step(1, 1 / 60) * 4);
});

test('wheel travel is conserved across frame rates and settles without drifting', () => {
  for (const fps of [15, 60, 144]) {
    const wheel = createRowWheelMotion(); wheel.push(2, 420);
    let distance = 0;
    for (let frame = 0; frame < fps * 2; frame++) distance += wheel.step(2, 1 / fps);
    assert.ok(Math.abs(distance - 420) < 1e-8);
    assert.equal(wheel.moving(2), false);
    assert.equal(wheel.step(2, 1 / fps), 0);
  }
});

test('reversing, clearing and reduced motion never leave an old row spinning', () => {
  const wheel = createRowWheelMotion(); wheel.push(0, 100); wheel.push(0, -4);
  assert.equal(wheel.step(0, 1 / 60, true), -4, 'a small reversal cancels the previous catch-up immediately');
  wheel.push(1, 400); wheel.push(3, 300); wheel.reset();
  assert.equal(wheel.step(1, 1 / 60), 0);
  assert.equal(wheel.step(3, 1 / 60), 0);
});
