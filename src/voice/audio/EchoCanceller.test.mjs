import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserAecFallback, SpeakerReferenceBuffer } from './EchoCanceller.js'

test('speaker reference buffer keeps bounded real PCM frame references', () => {
  const buffer = new SpeakerReferenceBuffer({ maxFrames: 2 })
  buffer.push(new Float32Array([0.1]), 10)
  buffer.push(new Float32Array([0.2]), 20)
  buffer.push(new Float32Array([0.3]), 30)
  assert.equal(buffer.frames.length, 2)
  assert.ok(Math.abs(buffer.nearest(28).samples[0] - 0.3) < 0.000_001)
})

test('browser AEC fallback preserves microphone PCM and declares its mode', () => {
  const mic = new Float32Array([0.1, -0.2])
  const result = new BrowserAecFallback().process(mic, new Float32Array([0.3]))
  assert.equal(result.mode, 'browser_aec_fallback')
  assert.equal(result.samples, mic)
  assert.equal(result.referenceFrameAvailable, true)
})
