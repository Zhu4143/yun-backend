export const AVATAR_PHASE = Object.freeze({
  VINYL_IDLE: 'VINYL_IDLE',
  BREAKING: 'BREAKING',
  HUMAN_FORMING: 'HUMAN_FORMING',
  WAKE_MOTION: 'WAKE_MOTION',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  HUMAN_DISPERSING: 'HUMAN_DISPERSING',
  VINYL_REFORMING: 'VINYL_REFORMING',
})

export const AVATAR_GRID_SIZE_BY_QUALITY = Object.freeze({
  low: 100,
  medium: 150,
  high: 205,
})

export const PORTRAIT_MOTION_SIZE_BY_QUALITY = Object.freeze({
  low: Object.freeze({ width: 160, height: 120 }),
  medium: Object.freeze({ width: 256, height: 192 }),
  high: Object.freeze({ width: 320, height: 240 }),
})

export function getPortraitPointSize({ screenHeight, motionHeight, pixelRatio = 1 }) {
  return Math.max(1, screenHeight / motionHeight * pixelRatio * 1.75)
}

export const AVATAR_TRANSITION_MS = 3400
export const PORTRAIT_WORLD_SIZE = Object.freeze({ width: 3.8 * 4 / 3, height: 3.8 })

export function getAvatarCameraTarget({ portraitProgress = 0, voiceOrbVisible = false, pointer = {}, cameraDistance = 5.6 }) {
  const t = Math.max(0, Math.min(1, portraitProgress / 0.22))
  const vinylWeight = 1 - t * t * (3 - 2 * t)
  if (vinylWeight === 0) return { x: 0, y: 0, z: cameraDistance }
  return {
    x: (voiceOrbVisible ? 0 : (pointer.x || 0) * 0.08) * vinylWeight,
    y: (voiceOrbVisible ? 0 : (pointer.y || 0) * 0.055) * vinylWeight,
    z: cameraDistance + ((pointer.zoom || 0) + (voiceOrbVisible ? 1.35 : 0)) * vinylWeight,
  }
}

// Calibrate once per source clip, rather than resizing on every moving frame.
export function getPortraitFrameTransform(mask, width, height) {
  let left = width
  let right = -1
  let top = height
  for (let y = 0; y < Math.floor(height * 0.58); y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
    }
  }
  if (right < left) return { scale: 1, x: 0, y: 0 }
  const scale = width * 0.4375 / (right - left + 1)
  return { scale, x: width * 0.5 - (left + right + 1) * 0.5 * scale, y: height * 0.04 - top * scale }
}

export function retargetPortraitFrame(previous, current, next, blend) {
  for (let index = 0; index < current.length; index += 1) {
    previous[index] += (current[index] - previous[index]) * blend
    current[index] = next[index]
  }
}

export function resolveAvatarPhase({ active, speaking, thinking, listening, responseMode }) {
  const companion = responseMode === 'companion'
  if (!active && !companion) return AVATAR_PHASE.VINYL_IDLE
  if (speaking) return AVATAR_PHASE.SPEAKING
  if (thinking) return AVATAR_PHASE.THINKING
  if (listening || companion) return AVATAR_PHASE.LISTENING
  return AVATAR_PHASE.WAKE_MOTION
}

export function resolveAvatarRenderPhase({ phase, progress = 0, wakeMotionComplete = false }) {
  const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0))
  if (phase === AVATAR_PHASE.VINYL_IDLE) {
    if (normalizedProgress > 0.58) return AVATAR_PHASE.HUMAN_DISPERSING
    if (normalizedProgress > 0) return AVATAR_PHASE.VINYL_REFORMING
    return AVATAR_PHASE.VINYL_IDLE
  }
  // Audio has its own clock. A short reply must not wait for the decorative
  // wake clip; particle formation still follows normalizedProgress.
  if (phase === AVATAR_PHASE.SPEAKING) return AVATAR_PHASE.SPEAKING
  if (normalizedProgress < 0.24) return AVATAR_PHASE.BREAKING
  if (normalizedProgress < 0.98) return AVATAR_PHASE.HUMAN_FORMING
  if (phase === AVATAR_PHASE.WAKE_MOTION || !wakeMotionComplete) return AVATAR_PHASE.WAKE_MOTION
  return phase
}

export function shouldHandleWakeMotionEnd({ clip, phase }) {
  return clip === 'wake' && phase === AVATAR_PHASE.WAKE_MOTION
}

export function lerpAngle(currentAngle, targetAngle, alpha = 0.08) {
  const current = Number(currentAngle) || 0
  const target = Number(targetAngle) || 0
  const blend = Math.max(0, Math.min(1, Number(alpha) || 0))
  const fullTurn = Math.PI * 2
  const shortestDelta = ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
  return current + shortestDelta * blend
}

export function getPortraitViewportFit({
  viewportWidth = 1280,
  viewportHeight = 720,
  cameraFov = 42,
  cameraDistance = 5.6,
  portraitDepth = 0.38,
  portraitWidth = PORTRAIT_WORLD_SIZE.width,
  portraitHeight = PORTRAIT_WORLD_SIZE.height,
  contentWidthRatio = 0.64,
  safeTopPx = 14,
  safeBottomPx = 0,
} = {}) {
  const height = Math.max(1, Number(viewportHeight) || 1)
  const width = Math.max(1, Number(viewportWidth) || 1)
  const depth = Math.max(0.1, Number(cameraDistance) - Number(portraitDepth))
  const viewWorldHeight = 2 * depth * Math.tan((Number(cameraFov) * Math.PI) / 360)
  const topInset = Math.max(0, Number(safeTopPx) || 0)
  const bottomInset = Math.max(0, Number(safeBottomPx) || 0)
  const availableHeight = Math.max(1, height - topInset - bottomInset)
  const availableWorldHeight = viewWorldHeight * Math.min(availableHeight / height, 0.94)
  const viewWorldWidth = viewWorldHeight * width / height
  const scaleByHeight = availableWorldHeight / Math.max(0.1, Number(portraitHeight) || 0.1)
  const scaleByWidth = viewWorldWidth * 0.98 / Math.max(0.1, Number(portraitWidth) * Number(contentWidthRatio))
  const scale = Math.max(0.01, Math.min(1, scaleByHeight, scaleByWidth))
  const offsetY = -viewWorldHeight / 2 + bottomInset * viewWorldHeight / height + portraitHeight * scale / 2
  const screenHeight = portraitHeight * scale / viewWorldHeight * height
  return { scale, offsetY, viewWorldHeight, screenHeight }
}

// Body gestures have their own clock; mouth movement stays on the TTS clock.
// A shuffled bag visits all three sources before reusing one, including when
// the mouth scan finds only one segment or has not completed yet.
export function createSpeakingMotionSequence(random = Math.random) {
  let bag = []
  let previousClip = ''
  const previousStarts = new Map()
  const roll = () => Math.max(0, Math.min(0.999999, Number(random()) || 0))
  return {
    next(durations) {
      const available = ['speaking', 'wake', 'listening'].filter((clip) => Number.isFinite(durations[clip]) && durations[clip] > 0.5)
      bag = bag.filter((clip) => available.includes(clip))
      if (!bag.length) {
        bag = [...available]
        for (let index = bag.length - 1; index > 0; index -= 1) {
          const other = Math.floor(roll() * (index + 1))
          ;[bag[index], bag[other]] = [bag[other], bag[index]]
        }
        if (bag.length > 1 && bag[0] === previousClip) [bag[0], bag[1]] = [bag[1], bag[0]]
      }
      const clip = bag.shift()
      if (!clip) return null
      const end = Number(durations[clip]) - 0.12
      const durationSeconds = Math.min(end, 2.4 + roll() * 1.4)
      const room = Math.max(0, end - durationSeconds)
      let startAt = roll() * room
      const previousStart = previousStarts.get(clip)
      if (room > 0.6 && previousStart !== undefined && Math.abs(startAt - previousStart) < 0.45) {
        startAt = (startAt + room * 0.5) % room
      }
      previousStarts.set(clip, startAt)
      previousClip = clip
      return { clip, startAt, durationSeconds }
    },
  }
}

export function getSpeakingActivitySegments(scores, {
  fps = 12,
  threshold = 0.12,
  mergeGapSeconds = 0.65,
  paddingSeconds = 0.12,
  minimumSeconds = 0.16,
} = {}) {
  if (!Array.isArray(scores) || scores.length === 0 || fps <= 0) return []
  const activeFrames = []
  for (let index = 0; index < scores.length; index += 1) {
    if (Number(scores[index]) >= threshold) activeFrames.push(index)
  }
  if (!activeFrames.length) return []

  const ranges = []
  let start = activeFrames[0]
  let end = start
  for (let index = 1; index < activeFrames.length; index += 1) {
    const next = activeFrames[index]
    if ((next - end - 1) / fps <= mergeGapSeconds) {
      end = next
      continue
    }
    ranges.push({ start, end })
    start = next
    end = next
  }
  ranges.push({ start, end })

  const duration = scores.length / fps
  const padded = ranges
    .map((range) => ({
      start: Math.max(0, range.start / fps - paddingSeconds),
      end: Math.min(duration, (range.end + 1) / fps + paddingSeconds),
    }))
    .filter((range) => range.end - range.start >= minimumSeconds)

  return padded
}

function getBorderColor(rgba, width, height) {
  const channels = [[], [], []]
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 48))
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) continue
      const offset = (y * width + x) * 4
      channels[0].push(rgba[offset])
      channels[1].push(rgba[offset + 1])
      channels[2].push(rgba[offset + 2])
    }
  }
  return channels.map((values) => {
    values.sort((left, right) => left - right)
    return values[Math.floor(values.length / 2)] || 0
  })
}

export function createForegroundMask(rgba, width, height, { tolerance = 16 } = {}) {
  const size = width * height
  if (!rgba || width < 1 || height < 1 || rgba.length < size * 4) return new Uint8Array(size)
  const background = getBorderColor(rgba, width, height)
  const backgroundCandidate = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    const offset = index * 4
    const dr = rgba[offset] - background[0]
    const dg = rgba[offset + 1] - background[1]
    const db = rgba[offset + 2] - background[2]
    const distance = Math.sqrt(dr * dr * 0.82 + dg * dg + db * db * 1.18)
    if (distance <= tolerance) backgroundCandidate[index] = 1
  }

  // Only remove the pale color when it connects to the frame border. This
  // keeps near-white shirt and headphone pixels inside the outlined subject.
  const backgroundMask = new Uint8Array(size)
  const queue = new Int32Array(size)
  let head = 0
  let tail = 0
  const addIfBackground = (index) => {
    if (backgroundCandidate[index] && !backgroundMask[index]) {
      backgroundMask[index] = 1
      queue[tail++] = index
    }
  }
  for (let x = 0; x < width; x += 1) {
    addIfBackground(x)
    addIfBackground((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    addIfBackground(y * width)
    addIfBackground(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) addIfBackground(index - 1)
    if (x < width - 1) addIfBackground(index + 1)
    if (y > 0) addIfBackground(index - width)
    if (y < height - 1) addIfBackground(index + width)
  }

  const mask = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    if (backgroundMask[index]) continue
    const offset = index * 4
    const distance = Math.sqrt(
      (rgba[offset] - background[0]) ** 2 * 0.82
      + (rgba[offset + 1] - background[1]) ** 2
      + (rgba[offset + 2] - background[2]) ** 2 * 1.18,
    )
    mask[index] = Math.max(64, Math.min(255, Math.round(64 + Math.max(0, distance - tolerance) * 8)))
  }
  return keepLargestForegroundComponent(mask, width, height, backgroundCandidate, queue, backgroundMask)
}

function keepLargestForegroundComponent(mask, width, height, visited, queue, largest) {
  const size = width * height
  visited.fill(0)
  largest.fill(0)
  let largestSize = 0

  for (let start = 0; start < size; start += 1) {
    if (mask[start] === 0 || visited[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      if (x > 0 && mask[index - 1] > 0 && !visited[index - 1]) {
        visited[index - 1] = 1
        queue[tail++] = index - 1
      }
      if (x < width - 1 && mask[index + 1] > 0 && !visited[index + 1]) {
        visited[index + 1] = 1
        queue[tail++] = index + 1
      }
      if (y > 0 && mask[index - width] > 0 && !visited[index - width]) {
        visited[index - width] = 1
        queue[tail++] = index - width
      }
      if (y < height - 1 && mask[index + width] > 0 && !visited[index + width]) {
        visited[index + width] = 1
        queue[tail++] = index + width
      }
    }

    if (tail <= largestSize) continue
    largest.fill(0)
    for (let index = 0; index < tail; index += 1) largest[queue[index]] = 1
    largestSize = tail
  }

  for (let index = 0; index < size; index += 1) mask[index] = largest[index] ? mask[index] : 0
  return mask
}

function considerNearest(index, candidateIndex, width, nearest, distances) {
  if (candidateIndex < 0) return
  const x = index % width
  const y = Math.floor(index / width)
  const candidateX = candidateIndex % width
  const candidateY = Math.floor(candidateIndex / width)
  const dx = x - candidateX
  const dy = y - candidateY
  const distance = dx * dx + dy * dy
  if (distance < distances[index]) {
    distances[index] = distance
    nearest[index] = candidateIndex
  }
}

export function createNearestForegroundMap(mask, width, height) {
  const size = width * height
  const nearest = new Int32Array(size)
  nearest.fill(-1)
  const distances = new Int32Array(size)
  distances.fill(0x7fffffff)
  for (let index = 0; index < size; index += 1) {
    if (mask[index] > 0) {
      nearest[index] = index
      distances[index] = 0
    }
  }

  // A pair of chamfer sweeps is enough at the small motion-map resolution and
  // keeps this per-frame pass linear instead of searching every foreground pixel.
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        considerNearest(index, x > 0 ? nearest[index - 1] : -1, width, nearest, distances)
        considerNearest(index, y > 0 && x > 0 ? nearest[index - width - 1] : -1, width, nearest, distances)
        considerNearest(index, y > 0 ? nearest[index - width] : -1, width, nearest, distances)
        considerNearest(index, y > 0 && x < width - 1 ? nearest[index - width + 1] : -1, width, nearest, distances)
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x
        considerNearest(index, x < width - 1 ? nearest[index + 1] : -1, width, nearest, distances)
        considerNearest(index, y < height - 1 && x > 0 ? nearest[index + width - 1] : -1, width, nearest, distances)
        considerNearest(index, y < height - 1 ? nearest[index + width] : -1, width, nearest, distances)
        considerNearest(index, y < height - 1 && x < width - 1 ? nearest[index + width + 1] : -1, width, nearest, distances)
      }
    }
  }
  return nearest
}

export function createPortraitAnchors(mask, width, height, pointCount) {
  const foreground = []
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] > 0) foreground.push(index)
  }
  const anchors = new Float32Array(pointCount * 2)
  if (!foreground.length) return anchors
  const goldenRatio = 0.618033988749895
  for (let point = 0; point < pointCount; point += 1) {
    const sample = Math.floor(((point * goldenRatio + 0.271828) % 1) * foreground.length)
    const sourceIndex = foreground[sample]
    anchors[point * 2] = ((sourceIndex % width) + 0.5) / width
    anchors[point * 2 + 1] = (Math.floor(sourceIndex / width) + 0.5) / height
  }
  return anchors
}

// Recover dark outline colors from nearby opaque foreground rather than
// displaying the pale studio background mixed into anti-aliased hair pixels.
// Only exterior pixels matching a background/core mixture are corrected;
// light fabric and the face retain their original colors.
export function removePortraitBackgroundSpill(rgb, mask, width, height) {
  const background = getBorderColor(rgb, width, height)
  const backgroundLuma = background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114
  const corrected = rgb.slice()
  const exteriorRadius = Math.max(1, Math.round(width * 3 / 128))
  const coreRadius = Math.max(2, Math.round(width * 5 / 128))
  const edgeDistances = new Uint16Array(width * height)
  const opaqueCore = new Uint8Array(width * height)
  const lightPixels = new Uint8Array(width * height)
  const lightCore = new Uint8Array(width * height)
  // Two bounded distance sweeps locate the exterior band in linear time;
  // a neighborhood search for every pale sweater pixel grows too expensive
  // at the higher motion-map resolution.
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    edgeDistances[pixel] = mask[pixel] ? exteriorRadius + 1 : 0
    const offset = pixel * 4
    const luma = rgb[offset] * 0.299 + rgb[offset + 1] * 0.587 + rgb[offset + 2] * 0.114
    if (mask[pixel] && luma >= backgroundLuma - 20) lightPixels[pixel] = 1
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    if (x > 0) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel - 1] + 1)
    if (y > 0) {
      edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel - width] + 1)
      if (x > 0) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel - width - 1] + 1)
      if (x < width - 1) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel - width + 1] + 1)
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const pixel = y * width + x
    if (x < width - 1) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel + 1] + 1)
    if (y < height - 1) {
      edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel + width] + 1)
      if (x > 0) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel + width - 1] + 1)
      if (x < width - 1) edgeDistances[pixel] = Math.min(edgeDistances[pixel], edgeDistances[pixel + width + 1] + 1)
    }
    if (x > 0 && x < width - 1 && y > 0 && y < height - 1 && mask[pixel] && mask[pixel - 1] && mask[pixel + 1] && mask[pixel - width] && mask[pixel + width]) {
      const offset = pixel * 4
      const luma = rgb[offset] * 0.299 + rgb[offset + 1] * 0.587 + rgb[offset + 2] * 0.114
      if (backgroundLuma - luma >= 75) opaqueCore[pixel] = 1
      // The calibrated bust starts below 58% of the map. Restrict garment
      // protection to that region so bright ears/face or codec halos beside
      // the head cannot protect the white fringe around the hair.
      if (y >= height * 0.58 && edgeDistances[pixel] > Math.max(1, Math.round(width / 128))
        && lightPixels[pixel] && lightPixels[pixel - 1] && lightPixels[pixel + 1] && lightPixels[pixel - width] && lightPixels[pixel + width]) lightCore[pixel] = 1
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x
      if (!mask[pixel] || edgeDistances[pixel] > exteriorRadius) continue
      const offset = pixel * 4
      const delta = [rgb[offset] - background[0], rgb[offset + 1] - background[1], rgb[offset + 2] - background[2]]
      const backgroundDistance = Math.hypot(...delta)
      if (backgroundDistance > 110) continue
      if (y >= height * 0.66 && delta[0] * 0.299 + delta[1] * 0.587 + delta[2] * 0.114 >= 0) continue
      let bestCore = -1
      let bestScore = Infinity
      let darkDistance = Infinity
      let lightDistance = Infinity
      for (let dy = -coreRadius; dy <= coreRadius; dy += 1) {
        for (let dx = -coreRadius; dx <= coreRadius; dx += 1) {
          const nx = x + dx, ny = y + dy
          if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue
          const core = ny * width + nx
          const distance = dx * dx + dy * dy
          if (lightCore[core]) lightDistance = Math.min(lightDistance, distance)
          if (!opaqueCore[core]) continue
          const coreOffset = core * 4
          const dr = rgb[coreOffset] - background[0], dg = rgb[coreOffset + 1] - background[1], db = rgb[coreOffset + 2] - background[2]
          const opacity = (delta[0] * dr + delta[1] * dg + delta[2] * db) / (dr * dr + dg * dg + db * db)
          // The calibrated clips put hair in the upper two-thirds. Codec
          // ringing there can be brighter than the backdrop; do not apply
          // this overshoot allowance to the light garment below the head.
          const minimumOpacity = y < height * 0.66 && backgroundDistance <= 45 ? -0.3 : 0.01
          if (opacity < minimumOpacity || opacity > 0.9) continue
          const residual = Math.hypot(delta[0] - opacity * dr, delta[1] - opacity * dg, delta[2] - opacity * db)
          if (residual > 14) continue
          const score = distance + residual * 0.25
          if (score < bestScore) {
            bestCore = coreOffset
            bestScore = score
            darkDistance = distance
          }
        }
      }
      // Pale shoulder fabric/headphones can share the backdrop's color. If
      // their own opaque light surface is nearby, preserve it;
      // otherwise despilling turns the shoulder into a dark, apparent cutout.
      const lightSurfaceMargin = Math.max(1, width * 2 / 128)
      if (bestCore >= 0 && Math.sqrt(lightDistance) > Math.sqrt(darkDistance) + lightSurfaceMargin) corrected.set(rgb.subarray(bestCore, bestCore + 3), offset)
    }
  }
  return corrected
}

export function updatePortraitTargets({ mask, rgb, width, height, uvs, colors, anchors = uvs }) {
  if (!mask?.length || !uvs?.length || !colors?.length) return false
  const nearest = createNearestForegroundMap(mask, width, height)
  const pointCount = Math.min(Math.floor(uvs.length / 2), Math.floor(colors.length / 3))
  const mappedPixels = new Int32Array(pointCount)
  const coverage = new Uint32Array(width * height)
  for (let point = 0; point < pointCount; point += 1) {
    // Retain the last spatial assignment. Rebuilding from the initial anchors
    // makes surplus IDs jump between hair, face and fabric every video frame;
    // GPU interpolation then carries dark colors across the face and opens holes.
    const initialized = uvs[point * 2] > 0 && uvs[point * 2 + 1] > 0
    const source = initialized ? uvs : anchors
    const x = Math.max(0, Math.min(width - 1, Math.floor(source[point * 2] * width)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(source[point * 2 + 1] * height)))
    const mappedIndex = nearest[y * width + x]
    mappedPixels[point] = mappedIndex
    if (mappedIndex >= 0) coverage[mappedIndex] += 1
  }
  // Keep one stationary point at every covered pixel. Only surplus points may
  // move, and they are taken from the nearest available neighborhood, so newly
  // exposed shoulders/bottom rows do not borrow particles across the whole face.
  const uncovered = []
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] && !coverage[pixel]) uncovered.push(pixel)
  }
  const surplusHeads = new Int32Array(mask.length).fill(-1)
  const surplusNext = new Int32Array(pointCount).fill(-1)
  const retained = new Uint8Array(mask.length)
  let surplusCount = 0
  for (let point = 0; point < pointCount; point += 1) {
    const pixel = mappedPixels[point]
    if (pixel < 0) continue
    if (!retained[pixel]) retained[pixel] = 1
    else {
      surplusNext[point] = surplusHeads[pixel]
      surplusHeads[pixel] = point
      surplusCount += 1
    }
  }
  for (const pixel of uncovered) {
    if (!surplusCount) break
    const x = pixel % width, y = Math.floor(pixel / width)
    let donor = -1
    for (let radius = 1; donor < 0 && radius < Math.max(width, height); radius += 1) {
      let bestDistance = Infinity
      const consider = (nx, ny) => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return
        const candidate = ny * width + nx
        const distance = (nx - x) ** 2 + (ny - y) ** 2
        if (surplusHeads[candidate] >= 0 && distance < bestDistance) {
          donor = candidate
          bestDistance = distance
        }
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        consider(x + dx, y - radius)
        consider(x + dx, y + radius)
      }
      for (let dy = -radius + 1; dy < radius; dy += 1) {
        consider(x - radius, y + dy)
        consider(x + radius, y + dy)
      }
    }
    if (donor < 0) break
    const point = surplusHeads[donor]
    surplusHeads[donor] = surplusNext[point]
    mappedPixels[point] = pixel
    surplusCount -= 1
  }
  for (let point = 0; point < pointCount; point += 1) {
    const mappedIndex = mappedPixels[point]
    if (mappedIndex < 0) continue
    const mappedX = mappedIndex % width
    const mappedY = Math.floor(mappedIndex / width)
    uvs[point * 2] = (mappedX + 0.5) / width
    uvs[point * 2 + 1] = (mappedY + 0.5) / height
    const sourceOffset = mappedIndex * 4
    const targetOffset = point * 3
    for (let channel = 0; channel < 3; channel += 1) {
      const normalized = rgb[sourceOffset + channel] / 255
      colors[targetOffset + channel] = normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    }
  }
  return true
}
