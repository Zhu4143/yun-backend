import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForPlaybackRecovery } from './playbackHandoff.js';

function observer(states, extra = {}) {
  let elapsed = 0;
  let index = 0;
  return {
    trackKey: 'selected',
    readState: () => states[Math.min(index, states.length - 1)],
    now: () => elapsed,
    wait: async ms => { elapsed += ms; index++; },
    timeoutMs: 1000,
    ...extra,
  };
}
const playing = (currentTime, id = 'selected') => ({ isPlaying: true, currentTime, currentTrack: { id } });

test('an interrupted handoff follows recovery only after the selected song advances', async () => {
  const states = [{ isPlaying: false }, playing(0), playing(0), playing(0.25)];
  assert.equal(await waitForPlaybackRecovery(observer(states)), true);
});

test('a stale playing flag or another song cannot complete the selected handoff', async () => {
  assert.equal(await waitForPlaybackRecovery(observer([playing(12)])), false);
  assert.equal(await waitForPlaybackRecovery(observer([playing(0, 'other'), playing(1, 'other')])), false);
  assert.equal(await waitForPlaybackRecovery(observer([playing(NaN)])), false);
});

test('progress must be consecutive for the same playing song', async () => {
  assert.equal(await waitForPlaybackRecovery(observer([playing(4), playing(5, 'other'), playing(4)])), false);
  assert.equal(await waitForPlaybackRecovery(observer([playing(4), { ...playing(5), isPlaying: false }, playing(4)])), false);
});

test('closing or reopening invalidates an old recovery before its later success', async () => {
  let current = true;
  const options = observer([playing(0), playing(1)], { isCurrent: () => current });
  options.wait = async () => { current = false; };
  assert.equal(await waitForPlaybackRecovery(options), false);
});

test('a missing playback observer never turns an interruption into success', async () => {
  assert.equal(await waitForPlaybackRecovery({ trackKey: 'selected' }), false);
});
