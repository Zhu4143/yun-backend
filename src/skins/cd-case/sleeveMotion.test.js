import assert from 'node:assert/strict';
import test from 'node:test';
import { createSleeveMotion } from './sleeveMotion.js';

const advance = (motion, seconds = 2, fps = 60, canExtract = true) => {
  for (let i = 0; i < seconds * fps; i++) motion.step(1 / fps, canExtract);
};

test('slide reaches either stop without overshooting at different frame rates', () => {
  for (const fps of [5, 15, 60, 144]) {
    const motion = createSleeveMotion();
    assert.equal(motion.phase, 'shelved');
    motion.setExtracted(true);
    for (let i = 0; i < fps * 2; i++) {
      motion.step(1 / fps);
      assert.ok(motion.position >= 0 && motion.position <= 1);
    }
    assert.equal(motion.phase, 'extracted');
    motion.setExtracted(false);
    advance(motion, 2, fps);
    assert.ok(motion.home);
  }
});

test('reversing a slide preserves its live position and velocity', () => {
  const motion = createSleeveMotion();
  motion.setExtracted(true);
  advance(motion, 0.2);
  const before = motion.position;
  motion.setExtracted(false);
  assert.equal(motion.position, before);
  motion.step(1 / 60);
  assert.ok(motion.position > before, 'outward momentum is retained for the reversal');
  advance(motion);
  assert.ok(motion.home);
});

test('a swap parks the disc and restores the latest user choice after closing', () => {
  const motion = createSleeveMotion();
  motion.setExtracted(true);
  advance(motion);
  motion.beginSwap();
  advance(motion);
  assert.ok(motion.home);
  assert.equal(motion.extracted, true);
  motion.setExtracted(false);
  motion.finishSwap();
  advance(motion);
  assert.ok(motion.home, 'a newer retract request takes priority');
  motion.setExtracted(true);
  motion.beginSwap();
  motion.finishSwap();
  advance(motion);
  assert.equal(motion.phase, 'extracted');
});

test('an open lid holds extraction until closed; reduced motion settles immediately', () => {
  const motion = createSleeveMotion({ reduced: true });
  motion.setExtracted(true);
  motion.step(1 / 60, false);
  assert.ok(motion.home);
  motion.step(1 / 60, true);
  assert.equal(motion.phase, 'extracted');
  motion.beginSwap();
  motion.step(1 / 60);
  assert.ok(motion.home);
});
