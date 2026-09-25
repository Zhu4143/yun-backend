import test from 'node:test'
import assert from 'node:assert/strict'
import { nextMetalBeatPulse } from './metalBeatPulse.js'

test('a bass onset brightens the metal highlight and decays when music stops', () => {
  const silence = new Uint8Array(512)
  const kick = new Uint8Array(512)
  kick.fill(220, 1, 17)
  const quiet = nextMetalBeatPulse({ baseline: 0, pulse: 0 }, silence, 1 / 60)
  const hit = nextMetalBeatPulse(quiet, kick, 1 / 60)
  const after = nextMetalBeatPulse(hit, silence, 0.5)
  assert.equal(quiet.pulse, 0)
  assert.ok(hit.pulse > 0.5)
  assert.ok(after.pulse < hit.pulse * 0.1)
})
