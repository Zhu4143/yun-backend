import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordSkinMotion, alignedRecordLayout, PARTICLE_DISC_RADIUS, PARTICLE_CAMERA_FOV } from './recordSkinMotion.js';

function finish(motion, fps = 60) {
  let seconds = 0, commits = [];
  while (motion.state.active && seconds < 20) {
    const event = motion.step(1 / fps);
    if (event.commit) commits.push(event.commit);
    seconds += 1 / fps;
  }
  assert.equal(motion.state.active, false);
  return { seconds, commits };
}

test('both renderers share a centred circle and matching camera projection on desktop and narrow screens', () => {
  for (const [w, h, zoom] of [[1920, 1080, 4.2], [1031, 871, 0], [390, 844, -4.4]]) {
    const pose = alignedRecordLayout(w, h, zoom);
    const projected = PARTICLE_DISC_RADIUS * h / (pose.cameraZ * Math.tan(PARTICLE_CAMERA_FOV * Math.PI / 360));
    assert.equal(pose.x, w / 2); assert.equal(pose.y, h / 2);
    assert.ok(Math.abs(projected - pose.diameter) < 1e-8);
    assert.ok(pose.diameter <= Math.min(w, h) * 0.92 + 1e-8);
  }
});

test('alignment completes before either material begins fading, regardless of frame rate', () => {
  const times = [];
  for (const fps of [15, 60, 144]) {
    const motion = createRecordSkinMotion();
    motion.start('cd-case', 'particle'); motion.markReady('particle');
    let blended = false;
    while (motion.state.phase !== 'settling') {
      motion.step(1 / fps);
      if (motion.state.mix > 0 && motion.state.phase === 'blending') {
        assert.equal(motion.state.cdAlign, 1);
        assert.equal(motion.state.particleAlign, 1); blended = true;
      }
    }
    assert.equal(blended, true);
    times.push(finish(motion, fps).seconds);
  }
  assert.ok(Math.max(...times) - Math.min(...times) < 0.1);
});

test('a boxed CD disappears before its disc moves or scales, and can return without a jump', () => {
  const motion = createRecordSkinMotion();
  motion.start('cd-case', 'particle', { boxed: true }); motion.markReady('particle');
  for (let i = 0; i < 180 && motion.state.mix === 0; i++) {
    motion.step(1 / 60);
    if (motion.state.caseVisibility > 0) assert.equal(motion.state.cdAlign, 0);
  }
  const before = { mix: motion.state.mix, cd: motion.state.cdAlign, particle: motion.state.particleAlign };
  motion.reverse();
  assert.deepEqual({ mix: motion.state.mix, cd: motion.state.cdAlign, particle: motion.state.particleAlign }, before);
  finish(motion);
  assert.equal(motion.state.cdAlign, 0); assert.equal(motion.state.caseVisibility, 1);
});

test('a cold renderer cannot fade in a blank frame, and missing readiness recovers the source', () => {
  const motion = createRecordSkinMotion();
  motion.start('particle', 'cd-case');
  for (let i = 0; i < 180; i++) motion.step(1 / 60);
  assert.equal(motion.state.mix, 0); assert.equal(motion.state.active, true);
  finish(motion);
  assert.equal(motion.state.destination, 'particle'); assert.equal(motion.state.mix, 0);
});

test('crossfade reversal keeps its presented values and ultimately commits the requested mode', () => {
  const motion = createRecordSkinMotion();
  motion.start('particle', 'cd-case'); motion.markReady('cd-case');
  while (motion.state.mix < 0.6) motion.step(1 / 60);
  const before = motion.state.mix;
  motion.reverse(); assert.equal(motion.state.mix, before);
  const result = finish(motion);
  assert.equal(motion.state.destination, 'particle');
  assert.ok(result.commits.includes('particle'));
});

test('reduced motion keeps a short opacity handoff and does not wait for spatial travel', () => {
  const motion = createRecordSkinMotion();
  motion.start('particle', 'cd-case', { reduced: true }); motion.markReady('cd-case');
  assert.ok(finish(motion).seconds < 0.6);
});
