import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPortraitSpeechMouth, capturePortraitMouth, createPortraitMouthAtlas, createPortraitSpeechClock, samplePortraitVideoScan } from './portraitSpeech.js'
import { readVoicePlaybackMeter } from '../voice/audio/voiceMeter.js'

function portrait(mouthRows) {
  const width = 256
  const height = 192
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set([235, 195, 170, 255], pixel * 4)
  for (let y = 90 - Math.floor(mouthRows / 2); y < 90 + Math.ceil(mouthRows / 2); y += 1) {
    for (let x = 123; x < 133; x += 1) rgba.set([90, 35, 22, 255], (y * width + x) * 4)
  }
  return { rgba, width, height }
}

test('source mouth atlas preserves real closed, middle and open video pixels', () => {
  const frames = [1, 3, 6].map((rows) => {
    const frame = portrait(rows)
    return capturePortraitMouth(frame.rgba, frame.width, frame.height)
  })
  const atlas = createPortraitMouthAtlas(frames)
  assert.equal(atlas.closed, frames[0])
  assert.equal(atlas.middle, frames[1])
  assert.equal(atlas.opened, frames[2])
})

test('idle, listening and completed playback preserve the original facial pixels', () => {
  const atlas = createPortraitMouthAtlas([1, 3, 6].map((rows) => {
    const frame = portrait(rows)
    return capturePortraitMouth(frame.rgba, frame.width, frame.height)
  }))
  for (const [openness, options] of [[0, undefined], [0, { active: false }], [0.9, { active: false }]]) {
    const frame = portrait(3)
    const before = frame.rgba.slice()
    assert.equal(applyPortraitSpeechMouth(frame.rgba, frame.width, frame.height, atlas, openness, options), false)
    assert.deepEqual(frame.rgba, before, 'inactive TTS must not paste another clip over a natural smile')
  }
})

test('actual playback opens the mouth during a closed-mouth body gesture and silence closes an open gesture', () => {
  const atlas = createPortraitMouthAtlas([1, 3, 6].map((rows) => {
    const frame = portrait(rows)
    return capturePortraitMouth(frame.rgba, frame.width, frame.height)
  }))
  const silent = portrait(6)
  const spoken = portrait(1)
  applyPortraitSpeechMouth(silent.rgba, silent.width, silent.height, atlas, 0, { active: true })
  applyPortraitSpeechMouth(spoken.rgba, spoken.width, spoken.height, atlas, 1, { active: true })
  const mouthEdge = (88 * spoken.width + 128) * 4
  assert.ok(spoken.rgba[mouthEdge] < 130, 'open mouth contains source cavity pixels')
  assert.ok(silent.rgba[mouthEdge] > 200, 'silence restores source skin above closed lip')
  assert.deepEqual(Array.from(spoken.rgba.slice(0, 4)), [235, 195, 170, 255])
  assert.deepEqual(Array.from(silent.rgba.slice(0, 4)), [235, 195, 170, 255])
  assert.equal(spoken.rgba[mouthEdge + 3], 255, 'mouth compositing does not punch transparent face holes')
})

test('speech follows a tilted mouth and never places a floating mouth when tracking is lost', () => {
  const atlas = createPortraitMouthAtlas([1, 3, 6].map((rows) => {
    const frame = portrait(rows)
    return capturePortraitMouth(frame.rgba, frame.width, frame.height)
  }))
  const tilted = portrait(0)
  for (let x = 123; x < 133; x += 1) {
    const y = Math.round(92 + (x - 128) * 0.45)
    tilted.rgba.set([90, 35, 22, 255], (y * tilted.width + x) * 4)
  }
  applyPortraitSpeechMouth(tilted.rgba, tilted.width, tilted.height, atlas, 1, { active: true })
  assert.ok(tilted.rgba[(88 * tilted.width + 124) * 4] < 160, 'open cavity follows the tilted lip axis')
  const lost = portrait(0)
  const before = lost.rgba.slice()
  assert.equal(applyPortraitSpeechMouth(lost.rgba, lost.width, lost.height, atlas, 1, { active: true }), false)
  assert.deepEqual(lost.rgba, before, 'unknown mouth position leaves original video untouched')
})

test('source and destination lip anchors retain subpixel position across translation and scale', () => {
  const atlas = createPortraitMouthAtlas([1, 3, 6].map((rows) => {
    const frame = portrait(rows)
    return capturePortraitMouth(frame.rgba, frame.width, frame.height)
  }))
  for (const [cx, cy, span] of [[126, 88, 8], [132, 95, 14], [124, 93, 10]]) {
    const frame = portrait(0)
    for (let x = cx - span / 2; x < cx + span / 2; x += 1) frame.rgba.set([90, 35, 22, 255], (cy * frame.width + x) * 4)
    assert.equal(applyPortraitSpeechMouth(frame.rgba, frame.width, frame.height, atlas, 1, { active: true }), true)
    assert.ok(frame.rgba[((cy - 2) * frame.width + cx) * 4] < 160, 'open mouth stays on the moving lip')
    assert.equal(frame.rgba[((cy - 2) * frame.width + cx) * 4 + 3], 255)
  }
})

test('TTS playhead drives mouth through leading silence, syllable, pause, muted output and completion', () => {
  const sampleRate = 16000
  const samples = Float32Array.from({ length: 16000 }, (_, index) => index >= 4000 && index < 8000
    ? 0.25 * Math.sin(2 * Math.PI * 220 * index / sampleRate) : 0)
  const decoded = { sampleRate, numberOfChannels: 1, length: samples.length, getChannelData: () => samples }
  assert.equal(readVoicePlaybackMeter(decoded, 0.125, { playing: true }).mouthOpen, 0)
  assert.ok(readVoicePlaybackMeter(decoded, 0.375, { playing: true }).mouthOpen > 0.95)
  assert.equal(readVoicePlaybackMeter(decoded, 0.75, { playing: true }).mouthOpen, 0)
  assert.equal(readVoicePlaybackMeter(decoded, 0.375, { playing: true, gain: 0 }).mouthOpen, 0)
  assert.equal(readVoicePlaybackMeter(decoded, 0.375, { playing: false }).mouthOpen, 0)
  assert.equal(readVoicePlaybackMeter(decoded, 1, { playing: true }).playing, false)
})

test('voice clock updates a frozen video at 24fps, drops busy work and closes after TTS ends', () => {
  const clock = createPortraitSpeechClock()
  const input = { tick: 7, playing: true, mouthOpen: 0.7, busy: false }
  assert.equal(clock.publish({ ...input, now: 0 }), true)
  assert.equal(clock.publish({ ...input, now: 20, tick: 8 }), false, 'body changes do not exceed the speech frame limit')
  assert.equal(clock.publish({ ...input, now: 42, busy: true }), false)
  assert.equal(clock.publish({ ...input, now: 43 }), true, 'busy frame was dropped, so newest state can retry')
  assert.equal(clock.publish({ ...input, now: 86, playing: false, mouthOpen: 0 }), true, 'end publishes closed lips despite a frozen body tick')
  assert.equal(clock.active, false)
  assert.equal(clock.publish({ ...input, now: 130, playing: false, mouthOpen: 0 }), false)
  assert.equal(clock.publish({ ...input, now: 131, tick: 8, playing: false, mouthOpen: 0 }), true, 'idle returns to body frames only')
})

test('video scan clears its fallback and timeout on abort, and RVFC and timeout on natural end', async () => {
  for (const modern of [false, true]) {
    const timers = new Map()
    let timerId = 0
    let frameId = 0
    const frames = new Map()
    const video = new EventTarget()
    video.currentTime = 0
    video.ended = false
    video.pause = () => {}
    video.play = async () => {}
    if (modern) {
      video.requestVideoFrameCallback = (callback) => { frames.set(++frameId, callback); return frameId }
      video.cancelVideoFrameCallback = (id) => frames.delete(id)
    }
    const controller = new AbortController()
    let samples = 0
    const done = samplePortraitVideoScan(video, {
      sample: () => { samples += 1 }, timeoutMs: 4000, signal: controller.signal,
      schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
      cancel: (id) => timers.delete(id),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (modern) {
      assert.equal(frames.size, 1)
      video.dispatchEvent(new Event('ended'))
    } else {
      assert.equal(timers.size, 2)
      controller.abort()
    }
    await done
    assert.equal(timers.size, 0)
    assert.equal(frames.size, 0)
    assert.equal(samples, 0, 'no stale scan callback after cleanup')
  }
})
