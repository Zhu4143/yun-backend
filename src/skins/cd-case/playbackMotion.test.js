import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackMotion, playbackLayout, discFlight, DISC_CLEARANCE } from './playbackMotion.js';

test('an incoming skin can receive an extracted disc, then return it through the normal pause sequence', () => {
  const motion = createPlaybackMotion();
  motion.presentDisc();
  assert.equal(motion.phase, 'playing');
  assert.equal(motion.amount, 1); assert.equal(motion.caseOpacity, 0);
  motion.setPlaying(false);
  assert.equal(motion.phase, 'revealing');
  for (let frame = 0; frame < 30; frame++) motion.step(1 / 60);
  assert.equal(motion.amount, 1);
  for (let frame = 0; frame < 480; frame++) motion.step(1 / 60);
  assert.equal(motion.phase, 'standby');
  assert.equal(motion.amount, 0); assert.equal(motion.boxOpen, 0);
});

const advance = (motion, seconds = 6, fps = 60) => {
  for (let frame = 0; frame < seconds * fps; frame++) motion.step(1 / fps);
};

test('a returning disc reaches the tray centre and original size before lowering through its rim', () => {
  for (let step = 0; step <= 1000; step++) {
    const amount = step / 1000;
    const flight = discFlight(amount);
    if (amount <= 0.14) assert.equal(flight.travel, 0, 'only lift/lower while directly over the spindle');
    else assert.ok(DISC_CLEARANCE * flight.travel + flight.lift >= DISC_CLEARANCE - 1e-8,
      'all sideways motion stays above the tray rim');
  }
  assert.deepEqual(discFlight(0), { travel: 0, lift: 0 });
  assert.deepEqual(discFlight(1), { travel: 1, lift: 0 });
});

test('the disc stays in its tray until the open box has completely disappeared', () => {
  for (const fps of [5, 15, 60, 144]) {
    const motion = createPlaybackMotion();
    motion.setPlaying(true);
    const phases = [];
    for (let frame = 0; frame < fps * 6; frame++) {
      motion.step(1 / fps);
      if (phases.at(-1) !== motion.phase) phases.push(motion.phase);
      if (motion.amount > 0) assert.equal(motion.caseOpacity, 0, 'no enlarged disc inside a visible box');
    }
    assert.deepEqual(phases, ['opening', 'hiding', 'entering', 'playing']);
  }
});

test('playback settles at one fixed pose and hides the box at low and high refresh rates', () => {
  for (const fps of [5, 15, 60, 144]) {
    const motion = createPlaybackMotion();
    motion.setPlaying(true);
    advance(motion, 6, fps);
    assert.equal(motion.phase, 'playing');
    assert.equal(motion.amount, 1);
    assert.equal(motion.caseOpacity, 0);
    advance(motion, 20, fps);
    assert.equal(motion.amount, 1);
    assert.equal(motion.caseOpacity, 0);
    motion.setPlaying(false);
    advance(motion, 6, fps);
    assert.equal(motion.phase, 'standby');
  }
});

test('pause reveals an empty open box, lands the disc, then closes the lid in that order', () => {
  const motion = createPlaybackMotion();
  motion.setPlaying(true);
  advance(motion);
  motion.setPlaying(false);
  advance(motion, 0.3);
  assert.equal(motion.phase, 'revealing');
  assert.equal(motion.amount, 1, 'disc stays in the playback position while the empty box appears');
  assert.equal(motion.boxOpen, 1);
  assert.ok(motion.caseOpacity > 0);
  const order = [];
  for (let frame = 0; frame < 360; frame++) {
    motion.step(1 / 60);
    if (order.at(-1) !== motion.phase) order.push(motion.phase);
    if (motion.phase === 'returning') {
      assert.equal(motion.boxOpen, 1);
      assert.equal(motion.caseOpacity, 1);
    }
    if (motion.phase === 'closing') assert.equal(motion.amount, 0, 'lid waits until the disc has landed');
  }
  assert.deepEqual(order, ['revealing', 'returning', 'closing', 'standby']);
  assert.equal(motion.boxOpen, 0);
});

test('play can interrupt a return or lid close without jumping to an endpoint', () => {
  const motion = createPlaybackMotion();
  motion.setPlaying(true);
  advance(motion);
  motion.setPlaying(false);
  while (motion.phase !== 'returning') motion.step(1 / 60);
  advance(motion, 0.3);
  assert.ok(motion.amount > 0 && motion.amount < 1);
  const before = motion.amount;
  motion.setPlaying(true);
  assert.equal(motion.amount, before);
  advance(motion);
  assert.equal(motion.phase, 'playing');
  motion.setPlaying(false);
  for (let i = 0; i < 360 && !(motion.phase === 'closing' && motion.boxOpen < 0.8); i++) motion.step(1 / 60);
  const lid = motion.boxOpen;
  motion.setPlaying(true);
  assert.equal(motion.boxOpen, lid);
  advance(motion);
  assert.equal(motion.phase, 'playing');
});

test('old disc exits upward while the new disc enters from the right with a short overlap', () => {
  const motion = createPlaybackMotion();
  assert.ok(motion.startSwap());
  assert.equal(motion.outgoing, 0);
  assert.equal(motion.incoming, 0);
  assert.equal(motion.startSwap(), false, 'queue the newest texture instead of restarting the live exchange');
  advance(motion, 0.4);
  assert.ok(motion.outgoing > 0 && motion.outgoing < 1);
  assert.ok(motion.incoming > 0 && motion.incoming < 1);
  motion.setPlaying(false);
  advance(motion);
  assert.equal(motion.swapping, false);
  assert.equal(motion.phase, 'standby');
});

test('reduced motion skips the large movement and restores standby immediately', () => {
  const motion = createPlaybackMotion({ reduced: true });
  motion.setPlaying(true);
  motion.step(1 / 60);
  assert.equal(motion.phase, 'playing');
  assert.equal(motion.startSwap(), false);
  motion.setPlaying(false);
  motion.step(1 / 60);
  assert.equal(motion.phase, 'standby');
});

test('concealed library handoff parks a closed box, then uses the normal opening/extraction', () => {
  const motion = createPlaybackMotion();
  motion.setPlaying(true); advance(motion); motion.startSwap(); advance(motion, 0.2);
  motion.park();
  assert.equal(motion.phase, 'standby');
  assert.equal(motion.amount, 0);
  assert.equal(motion.caseOpacity, 1);
  assert.equal(motion.boxOpen, 0);
  assert.equal(motion.swapping, false);
  motion.setPlaying(true);
  assert.equal(motion.phase, 'opening');
  advance(motion);
  assert.equal(motion.phase, 'playing');
});

test('the complete disc fits the right playback area and leaves room for the player', () => {
  for (const [width, height] of [[1651, 871], [1280, 720], [1920, 1080], [700, 480]]) {
    const layout = playbackLayout(width, height);
    const radius = layout.diameter / 2;
    assert.ok(layout.x - radius >= width * 0.5, 'keep the disc in the right half');
    assert.ok(layout.x + radius <= width, 'show the entire outer edge');
    assert.ok(layout.y - radius >= 28);
    assert.ok(layout.y + radius <= height - 160, 'keep the player area clear');
    assert.ok(layout.diameter <= 0.4 * width);
  }
});

test('narrow screens show the entire disc centred above the player', () => {
  for (const [width, height] of [[390, 844], [600, 300], [699, 900]]) {
    const layout = playbackLayout(width, height);
    const radius = layout.diameter / 2;
    assert.equal(layout.x, width / 2);
    assert.ok(layout.x - radius >= 0 && layout.x + radius <= width);
    assert.ok(layout.y - radius >= (width <= 640 ? 40 : 28));
    assert.ok(layout.y + radius <= height - (width <= 640 ? 195 : 160));
  }
});
