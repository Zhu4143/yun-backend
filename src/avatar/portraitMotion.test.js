import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AVATAR_PHASE,
  createForegroundMask,
  createNearestForegroundMap,
  createPortraitAnchors,
  removePortraitBackgroundSpill,
  getPortraitViewportFit,
  getAvatarCameraTarget,
  getPortraitFrameTransform,
  PORTRAIT_WORLD_SIZE,
  PORTRAIT_MOTION_SIZE_BY_QUALITY,
  AVATAR_GRID_SIZE_BY_QUALITY,
  getPortraitPointSize,
  retargetPortraitFrame,
  createSpeakingMotionSequence,
  getSpeakingActivitySegments,
  lerpAngle,
  shouldHandleWakeMotionEnd,
  resolveAvatarRenderPhase,
  resolveAvatarPhase,
  updatePortraitTargets,
} from './portraitMotion.js'

function imageData(width, height, background = [240, 240, 240]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data.set([...background, 255], index * 4)
  }
  return { data, width, height }
}

test('avatar phase follows active speech, thinking, and listening signals', () => {
  assert.equal(resolveAvatarPhase({ active: false, speaking: true }), AVATAR_PHASE.VINYL_IDLE)
  assert.equal(resolveAvatarPhase({ active: true, listening: true }), AVATAR_PHASE.LISTENING)
  assert.equal(resolveAvatarPhase({ active: true, listening: true, thinking: true }), AVATAR_PHASE.THINKING)
  assert.equal(resolveAvatarPhase({ active: true, speaking: true, thinking: true }), AVATAR_PHASE.SPEAKING)
})

test('companion mode keeps a listening portrait before and after speech without opening a call', () => {
  assert.equal(resolveAvatarPhase({ responseMode: 'companion', active: false }), AVATAR_PHASE.LISTENING)
  assert.equal(resolveAvatarPhase({ responseMode: 'companion', active: false, speaking: true }), AVATAR_PHASE.SPEAKING)
  assert.equal(resolveAvatarPhase({ responseMode: 'normal', active: false }), AVATAR_PHASE.VINYL_IDLE)
})

test('body variation works independently of zero or one detected mouth segment', () => {
  const sequence = createSpeakingMotionSequence(() => 0.5)
  const durations = { speaking: 6.048, wake: 6.048, listening: 6.048 }
  const motions = Array.from({ length: 3 }, () => sequence.next(durations))
  assert.equal(new Set(motions.map((motion) => motion.clip)).size, 3)
})

test('visual lifecycle passes through formation, wake motion, and vinyl return phases', () => {
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.LISTENING, progress: 0, wakeMotionComplete: false }), AVATAR_PHASE.BREAKING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.LISTENING, progress: 0.6, wakeMotionComplete: false }), AVATAR_PHASE.HUMAN_FORMING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.LISTENING, progress: 1, wakeMotionComplete: false }), AVATAR_PHASE.WAKE_MOTION)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.LISTENING, progress: 1, wakeMotionComplete: true }), AVATAR_PHASE.LISTENING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.VINYL_IDLE, progress: 0.8, wakeMotionComplete: true }), AVATAR_PHASE.HUMAN_DISPERSING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.VINYL_IDLE, progress: 0.3, wakeMotionComplete: true }), AVATAR_PHASE.VINYL_REFORMING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.VINYL_IDLE, progress: 0, wakeMotionComplete: true }), AVATAR_PHASE.VINYL_IDLE)
})

test('only the active wake clip completion can release the visual state into listening', () => {
  assert.equal(shouldHandleWakeMotionEnd({ clip: 'wake', phase: AVATAR_PHASE.WAKE_MOTION }), true)
  assert.equal(shouldHandleWakeMotionEnd({ clip: 'wake', phase: AVATAR_PHASE.HUMAN_FORMING }), false)
  assert.equal(shouldHandleWakeMotionEnd({ clip: 'listening', phase: AVATAR_PHASE.WAKE_MOTION }), false)
})

test('portrait rotation crosses the vinyl full-turn boundary by the short arc', () => {
  const current = Math.PI * 2 - 0.05
  const next = lerpAngle(current, 0, 0.08)
  assert.ok(Math.abs(next - current) < 0.01, `rotation step ${next - current} should stay small`)
  assert.ok(Math.abs(Math.atan2(Math.sin(next), Math.cos(next))) < 0.05)
  const acrossPi = lerpAngle(3.05, -3.05, 0.08)
  assert.ok(Math.abs(acrossPi - 3.05) < 0.02, `rotation step ${acrossPi - 3.05} should cross the Euler boundary by the short arc`)
})

test('portrait viewport fit anchors the bust to the screen bottom without clipping its head', () => {
  for (const { width, height } of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const fit = getPortraitViewportFit({ viewportWidth: width, viewportHeight: height })
    const worldTop = fit.offsetY + (3.8 * fit.scale) / 2
    const worldBottom = fit.offsetY - (3.8 * fit.scale) / 2
    const screenTop = ((fit.viewWorldHeight / 2 - worldTop) / fit.viewWorldHeight) * height
    const screenBottom = ((fit.viewWorldHeight / 2 - worldBottom) / fit.viewWorldHeight) * height
    assert.ok(screenTop >= 14 - 0.001, `top ${screenTop}px escaped the safe area`)
    assert.ok(Math.abs(screenBottom - height) < 0.001, `bottom ${screenBottom}px does not meet the screen bottom`)
  }
})

test('portrait camera stays fixed across wheel zoom, pointer motion and voice UI changes', () => {
  for (const zoom of [-4.4, 0, 4.2]) {
    for (const voiceOrbVisible of [false, true]) {
      assert.deepEqual(getAvatarCameraTarget({ portraitProgress: 1, voiceOrbVisible, pointer: { x: 1, y: -1, zoom } }), { x: 0, y: 0, z: 5.6 })
    }
  }
  assert.equal(getAvatarCameraTarget({ portraitProgress: 0, pointer: { zoom: 2 } }).z, 7.6)
})

test('portrait framing preserves video aspect ratio and bounds its screen footprint', () => {
  assert.equal(PORTRAIT_WORLD_SIZE.width / PORTRAIT_WORLD_SIZE.height, 4 / 3)
  for (const [width, height] of [[1280, 720], [666, 871], [390, 844]]) {
    const fit = getPortraitViewportFit({ viewportWidth: width, viewportHeight: height })
    assert.ok(PORTRAIT_WORLD_SIZE.height * fit.scale / fit.viewWorldHeight <= 0.94 + 1e-6)
    const portraitPixels = PORTRAIT_WORLD_SIZE.width * 0.64 * fit.scale / fit.viewWorldHeight * height
    assert.ok(portraitPixels <= width * 0.98 + 1e-6)
  }
})

test('portrait dots keep their spacing ratio on larger screens and at every canvas pixel ratio', () => {
  for (const [quality, motion] of Object.entries(PORTRAIT_MOTION_SIZE_BY_QUALITY)) {
    assert.ok(motion.width * motion.height * 0.45 < AVATAR_GRID_SIZE_BY_QUALITY[quality] ** 2)
    for (const pixelRatio of [0.58, 1, 1.12]) {
      const small = getPortraitPointSize({ screenHeight: 640, motionHeight: motion.height, pixelRatio })
      const large = getPortraitPointSize({ screenHeight: 1280, motionHeight: motion.height, pixelRatio })
      assert.ok(Math.abs(large / small - 2) < 1e-6)
      assert.ok(Math.abs(large / (1280 / motion.height * pixelRatio) - 1.75) < 1e-6)
    }
  }
})

test('different source clip head sizes align to the same scale, center and top', () => {
  for (const [left, right, top] of [[38, 87, 3], [35, 88, 4], [35, 90, 3]]) {
    const mask = new Uint8Array(128 * 96)
    for (let y = top; y < 55; y += 1) {
      for (let x = left; x <= right; x += 1) mask[y * 128 + x] = 255
    }
    const transform = getPortraitFrameTransform(mask, 128, 96)
    assert.ok(Math.abs((right - left + 1) * transform.scale - 56) < 1e-6)
    assert.ok(Math.abs((left + right + 1) / 2 * transform.scale + transform.x - 64) < 1e-6)
    assert.ok(Math.abs(top * transform.scale + transform.y - 3.84) < 1e-6)
  }
})

test('a new video frame continues from the currently displayed blend without a jump', () => {
  const previous = new Float32Array([0, 10, 20])
  const current = new Float32Array([10, 20, 30])
  const next = new Float32Array([30, 40, 50])
  retargetPortraitFrame(previous, current, next, 0.4)
  assert.deepEqual(Array.from(previous), [4, 14, 24])
  assert.deepEqual(Array.from(current), [30, 40, 50])
})

test('speech randomizes order, start and duration without repeating adjacent clips or overrunning a video', () => {
  let seed = 1234
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const sequence = createSpeakingMotionSequence(random)
  const durations = { speaking: 6.048, wake: 5.6, listening: 6.1 }
  const motions = Array.from({ length: 90 }, () => sequence.next(durations))
  motions.forEach((motion, index) => {
    if (index) assert.notEqual(motion.clip, motions[index - 1].clip)
    assert.ok(motion.startAt >= 0)
    assert.ok(motion.startAt + motion.durationSeconds <= durations[motion.clip] - 0.119)
    assert.ok(motion.durationSeconds >= 2.4 && motion.durationSeconds <= 3.8)
    if (index % 3 === 0) assert.equal(new Set(motions.slice(index, index + 3).map((item) => item.clip)).size, 3)
  })
  assert.ok(new Set(motions.map((motion) => motion.durationSeconds.toFixed(1))).size > 8)
  assert.ok(new Set(motions.map((motion) => motion.startAt.toFixed(1))).size > 8)
  assert.notDeepEqual(motions.slice(0, 3).map((motion) => motion.clip), motions.slice(3, 6).map((motion) => motion.clip))
})

test('motion selection tolerates loading clips and avoids reusing the same section on a later speech turn', () => {
  const sequence = createSpeakingMotionSequence(() => 0)
  assert.equal(sequence.next({ speaking: NaN }), null)
  const first = sequence.next({ speaking: 6 })
  const next = sequence.next({ speaking: 6 })
  assert.notEqual(first.startAt, next.startAt)
  const short = sequence.next({ listening: 1 })
  assert.ok(short.startAt + short.durationSeconds < 1)
})

test('actual TTS playback takes priority over a pending wake motion', () => {
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.SPEAKING, progress: 1, wakeMotionComplete: false }), AVATAR_PHASE.SPEAKING)
  assert.equal(resolveAvatarRenderPhase({ phase: AVATAR_PHASE.SPEAKING, progress: 0.6, wakeMotionComplete: false }), AVATAR_PHASE.SPEAKING)
})

test('border connected background is removed while an enclosed subject remains', () => {
  const frame = imageData(9, 7)
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 3; x <= 6; x += 1) frame.data.set([90, 48, 32, 255], (y * 9 + x) * 4)
  }
  const mask = createForegroundMask(frame.data, frame.width, frame.height, { tolerance: 12 })
  assert.equal(mask[0], 0)
  assert.equal(mask[3 * 9 + 4], 255)
  assert.equal(mask.filter((value) => value > 0).length, 16)
})

test('detached foreground artifacts are removed so backdrop noise cannot expand the portrait bounds', () => {
  const frame = imageData(16, 12)
  for (let y = 2; y <= 9; y += 1) {
    for (let x = 5; x <= 10; x += 1) frame.data.set([90, 48, 32, 255], (y * 16 + x) * 4)
  }
  // Simulate a compressed-background patch that exceeds the color-key tolerance.
  for (let y = 4; y <= 6; y += 1) {
    for (let x = 0; x <= 1; x += 1) frame.data.set([215, 210, 204, 255], (y * 16 + x) * 4)
  }

  const mask = createForegroundMask(frame.data, frame.width, frame.height, { tolerance: 6 })
  assert.ok(mask[5 * 16 + 7] > 0, 'the main portrait component should remain')
  assert.equal(mask[5 * 16], 0, 'a disconnected backdrop patch should not stretch the particle field')
  assert.equal(mask[5 * 16 + 15], 0, 'the outside frame should remain background')
})

test('diagonal backdrop gaps do not key out an enclosed light shirt region', () => {
  const frame = imageData(7, 7)
  for (let x = 2; x <= 4; x += 1) {
    frame.data.set([90, 48, 32, 255], (1 * 7 + x) * 4)
    frame.data.set([90, 48, 32, 255], (5 * 7 + x) * 4)
  }
  for (let y = 2; y <= 4; y += 1) {
    frame.data.set([90, 48, 32, 255], (y * 7 + 1) * 4)
    frame.data.set([90, 48, 32, 255], (y * 7 + 5) * 4)
  }
  const mask = createForegroundMask(frame.data, frame.width, frame.height, { tolerance: 16 })
  assert.ok(mask[3 * 7 + 3] > 0, 'light fabric inside the silhouette should stay in the particle field')
})

test('low-contrast shirt pixels stay visible without restoring a torso-shaped patch of backdrop', () => {
  const frame = imageData(48, 36, [229, 223, 218])
  for (let y = 18; y <= 35; y += 1) {
    for (let x = 22; x <= 25; x += 1) frame.data.set([239, 233, 228, 255], (y * 48 + x) * 4)
  }
  const mask = createForegroundMask(frame.data, frame.width, frame.height, { tolerance: 6 })
  assert.ok(mask[26 * 48 + 24] > 0, 'low-contrast fabric in the lower bust should remain a particle target')
  assert.equal(mask[26 * 48 + 16], 0, 'background inside the old torso envelope should remain transparent')
  assert.equal(mask[35 * 48 + 46], 0, 'pixels outside the bust should remain transparent')
})

test('nearest foreground lookup maps background pixels to the closest subject pixel', () => {
  const mask = new Uint8Array(25)
  mask[2 * 5 + 3] = 255
  const nearest = createNearestForegroundMap(mask, 5, 5)
  assert.equal(nearest[2 * 5 + 4], 2 * 5 + 3)
  assert.equal(nearest[0], 2 * 5 + 3)
})

test('portrait anchors are deterministic and targets track the nearest pixel in a later frame', () => {
  const first = new Uint8Array(12 * 8)
  const second = new Uint8Array(12 * 8)
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 3; x <= 6; x += 1) first[y * 12 + x] = 255
    for (let x = 4; x <= 7; x += 1) second[y * 12 + x] = 255
  }
  const anchorsA = createPortraitAnchors(first, 12, 8, 20)
  const anchorsB = createPortraitAnchors(first, 12, 8, 20)
  assert.deepEqual(anchorsA, anchorsB)
  const currentUvs = anchorsA.slice()
  const colors = new Float32Array(20 * 3)
  const rgb = new Uint8ClampedArray(12 * 8 * 4)
  for (let index = 0; index < 12 * 8; index += 1) rgb.set([200, 100, 50, 255], index * 4)
  updatePortraitTargets({ mask: second, rgb, width: 12, height: 8, uvs: currentUvs, colors })
  for (let index = 0; index < 20; index += 1) {
    const x = Math.min(11, Math.floor(currentUvs[index * 2] * 12))
    const y = Math.min(7, Math.floor(currentUvs[index * 2 + 1] * 8))
    assert.ok(second[y * 12 + x] > 0)
    const color = Array.from(colors.slice(index * 3, index * 3 + 3))
    const toLinear = (value) => ((value / 255 + 0.055) / 1.055) ** 2.4
    assert.ok(Math.abs(color[0] - toLinear(200)) < 0.00001)
    assert.ok(Math.abs(color[1] - toLinear(100)) < 0.00001)
    assert.ok(Math.abs(color[2] - toLinear(50)) < 0.00001)
  }
})

test('speaking detection joins short pauses and skips long closed mouth gaps', () => {
  const scores = Array.from({ length: 72 }, () => 0)
  for (let index = 8; index <= 15; index += 1) scores[index] = 0.3
  for (let index = 19; index <= 24; index += 1) scores[index] = 0.26
  for (let index = 43; index <= 50; index += 1) scores[index] = 0.32
  const segments = getSpeakingActivitySegments(scores, { fps: 12, threshold: 0.12, mergeGapSeconds: 0.4, paddingSeconds: 0.08 })
  assert.equal(segments.length, 2)
  assert.ok(segments[0].end < segments[1].start)
  assert.ok(segments[0].start < 8 / 12)
  assert.ok(segments[1].end > 50 / 12)
})

test('portrait loops restore revealed bottom rows without permanently drifting their anchors', () => {
  const width = 12, height = 8, pointCount = 120
  const full = new Uint8Array(width * height)
  const shortened = new Uint8Array(width * height)
  for (let y = 1; y < height; y += 1) for (let x = 3; x <= 8; x += 1) {
    full[y * width + x] = 255
    if (y < 6) shortened[y * width + x] = 255
  }
  const anchors = createPortraitAnchors(full, width, height, pointCount)
  const original = anchors.slice(), uvs = anchors.slice(), colors = new Float32Array(pointCount * 3)
  const rgb = imageData(width, height).data
  const assertCovered = (mask) => {
    const covered = new Set()
    for (let point = 0; point < pointCount; point += 1) covered.add(Math.floor(uvs[point * 2 + 1] * height) * width + Math.floor(uvs[point * 2] * width))
    for (let pixel = 0; pixel < mask.length; pixel += 1) if (mask[pixel]) assert.ok(covered.has(pixel), `revealed pixel ${pixel} has no particle`)
  }
  for (let cycle = 0; cycle < 100; cycle += 1) {
    updatePortraitTargets({ mask: shortened, rgb, width, height, anchors, uvs, colors })
    assertCovered(shortened)
    updatePortraitTargets({ mask: full, rgb, width, height, anchors, uvs, colors })
    assertCovered(full)
  }
  assert.deepEqual(anchors, original)
  const expanded = full.slice()
  for (let y = 1; y < height; y += 1) expanded[y * width + 9] = 255
  updatePortraitTargets({ mask: expanded, rgb, width, height, anchors, uvs, colors })
  assertCovered(expanded)
})

test('moving contours keep face and shoulder coverage throughout GPU frame interpolation', () => {
  const width = 32, height = 24, pointCount = 900
  const base = new Uint8Array(width * height)
  for (let y = 2; y < height; y += 1) for (let x = 5; x < 26; x += 1) base[y * width + x] = 255
  const anchors = createPortraitAnchors(base, width, height, pointCount)
  const uvs = anchors.slice(), colors = new Float32Array(pointCount * 3)
  const rgb = imageData(width, height).data
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    rgb.set(x < 11 ? [50, 25, 15, 255] : [240, 220, 205, 255], (y * width + x) * 4)
  }
  updatePortraitTargets({ mask: base, rgb, width, height, anchors, uvs, colors })
  for (let frame = 0; frame < 40; frame += 1) {
    const mask = base.slice()
    for (let y = 12; y < height; y += 1) mask[y * width + (frame % 2 ? 4 : 26)] = 255
    const before = uvs.slice()
    updatePortraitTargets({ mask, rgb, width, height, anchors, uvs, colors })
    for (const blend of [0.25, 0.5, 0.75]) {
      const coverage = new Set()
      for (let point = 0; point < pointCount; point += 1) {
        const x = Math.floor((before[point * 2] * (1 - blend) + uvs[point * 2] * blend) * width)
        const y = Math.floor((before[point * 2 + 1] * (1 - blend) + uvs[point * 2 + 1] * blend) * height)
        coverage.add(y * width + x)
        const travel = Math.hypot((uvs[point * 2] - before[point * 2]) * width, (uvs[point * 2 + 1] - before[point * 2 + 1]) * height)
        assert.ok(travel <= 4, 'a contour repair must use local surplus instead of sending hair particles across the face')
      }
      for (let y = 3; y < height - 1; y += 1) for (let x = 6; x < 25; x += 1) {
        assert.ok(coverage.has(y * width + x), `interpolated face/shoulder pixel ${x},${y} lost its stationary particle`)
      }
    }
  }
})

test('background-mixed hair edges use opaque hair colors without darkening pale clothing or enclosed highlights', () => {
  const width = 24, height = 24
  const frame = imageData(width, height, [233, 227, 222])
  for (let y = 2; y <= 10; y += 1) for (let x = 6; x <= 17; x += 1) {
    frame.data.set([85, 45, 28, 255], (y * width + x) * 4)
  }
  // A pixel containing 15% hair and 85% studio background.
  frame.data.set([211, 200, 193, 255], (6 * width + 6) * 4)
  frame.data.set([240, 231, 225, 255], (4 * width + 6) * 4)
  frame.data.set([248, 240, 232, 255], (8 * width + 6) * 4)
  frame.data.set([235, 231, 226, 255], (6 * width + 12) * 4)
  for (let y = 11; y < height; y += 1) for (let x = 4; x <= 19; x += 1) {
    frame.data.set([245, 239, 232, 255], (y * width + x) * 4)
  }
  const mask = createForegroundMask(frame.data, width, height, { tolerance: 6 })
  const corrected = removePortraitBackgroundSpill(frame.data, mask, width, height)
  assert.deepEqual(Array.from(corrected.slice((6 * width + 6) * 4, (6 * width + 6) * 4 + 3)), [85, 45, 28])
  assert.deepEqual(Array.from(corrected.slice((4 * width + 6) * 4, (4 * width + 6) * 4 + 3)), [85, 45, 28])
  assert.deepEqual(Array.from(corrected.slice((8 * width + 6) * 4, (8 * width + 6) * 4 + 3)), [85, 45, 28])
  for (const [x, y] of [[12, 6], [4, 18], [19, 23], [12, 18]]) {
    const offset = (y * width + x) * 4
    assert.deepEqual(corrected.slice(offset, offset + 4), frame.data.slice(offset, offset + 4))
  }
  assert.deepEqual(Array.from(frame.data.slice((6 * width + 6) * 4, (6 * width + 6) * 4 + 3)), [211, 200, 193])
})

test('despilling preserves the pale shoulder touching hair above the old lower-body cutoff', () => {
  const width = 128, height = 96
  const frame = imageData(width, height, [233, 227, 222])
  for (let y = 8; y <= 56; y += 1) for (let x = 39; x <= 76; x += 1) {
    frame.data.set([85, 45, 28, 255], (y * width + x) * 4)
  }
  for (let y = 57; y < height; y += 1) for (let x = 30; x <= 85; x += 1) {
    frame.data.set([245, 239, 232, 255], (y * width + x) * 4)
  }
  // Studio-colored fabric at the open shoulder edge is backed by a broad
  // light garment surface, unlike an isolated overshoot along the dark hair.
  for (let x = 35; x <= 38; x += 1) frame.data.set([240, 232, 226, 255], (57 * width + x) * 4)
  const mask = createForegroundMask(frame.data, width, height, { tolerance: 6 })
  const corrected = removePortraitBackgroundSpill(frame.data, mask, width, height)
  for (let x = 35; x <= 38; x += 1) {
    const offset = (57 * width + x) * 4
    assert.ok(mask[57 * width + x] > 0)
    assert.deepEqual(corrected.slice(offset, offset + 4), frame.data.slice(offset, offset + 4), 'shoulder must not be repainted with nearby hair color')
  }
})
