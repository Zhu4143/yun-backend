import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseTurnMotion } from './caseTurnMotion.js';

test('a paused replacement stays hidden behind the turning case at different frame rates', () => {
  for (const fps of [5, 15, 60, 144]) {
    const turn = createCaseTurnMotion();
    turn.begin();
    assert.equal(turn.commit(), false, 'the old print is still facing the viewer');
    let commitFacing = 1;
    let finished = false;
    for (let frame = 0; frame < fps * 3; frame++) {
      turn.step(1 / fps);
      if (turn.canCommit && commitFacing === 1) {
        commitFacing = Math.cos(turn.yaw);
        assert.equal(turn.commit(), true);
      }
      if (!turn.active) { finished = true; break; }
    }
    assert.ok(commitFacing < -0.8);
    assert.ok(finished);
    assert.equal(turn.yaw, 0, 'one complete revolution returns to the same orientation');
  }
});

test('slow artwork or an uncommitted frame cannot let a turning case reveal its front', () => {
  const turn = createCaseTurnMotion();
  turn.begin();
  turn.step(20);
  assert.equal(turn.active, true);
  assert.equal(turn.progress, 0.5);
  assert.ok(Math.cos(turn.yaw) < -0.99);
  turn.step(20);
  assert.equal(turn.progress, 0.5);
  turn.commit();
  turn.step(1);
  assert.equal(turn.active, false);
});

test('camera-facing and oblique prints cannot commit even inside the turn interval', () => {
  const turn = createCaseTurnMotion();
  turn.begin(); turn.step(0.8);
  for (const facing of [1, 0, -0.5, -0.7, -0.89]) assert.equal(turn.canReplace(facing), false);
  assert.equal(turn.canReplace(-0.95), true);
});

test('latest artwork can replace an earlier request during the same hidden interval', () => {
  const turn = createCaseTurnMotion();
  turn.begin();
  turn.step(0.8);
  const behind = turn.yaw;
  turn.commit();
  turn.begin();
  assert.equal(turn.yaw, behind, 'a new request does not restart the visible spin');
  assert.equal(turn.commit(), true);
  turn.step(0.8);
  assert.equal(turn.active, false);
});

test('concealed cancellation and reduced motion do not leave playback waiting', () => {
  const turn = createCaseTurnMotion();
  turn.begin(); turn.step(0.3); turn.cancel();
  assert.equal(turn.active, false);
  assert.equal(turn.yaw, 0);
  const reduced = createCaseTurnMotion({ reduced: true });
  reduced.begin();
  assert.equal(reduced.yaw, 0);
  assert.equal(reduced.commit(), true);
  assert.equal(reduced.active, false);
});
