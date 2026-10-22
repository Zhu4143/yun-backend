function mouthGeometry(rgba, width, height) {
  const left = Math.floor(width * 0.465)
  const right = Math.ceil(width * 0.54)
  const top = Math.floor(height * 0.43)
  const bottom = Math.ceil(height * 0.515)
  let total = 0
  let xTotal = 0
  let yTotal = 0
  let darkPixels = 0
  let xx = 0
  let yy = 0
  let xy = 0
  let count = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4
      const red = rgba[offset]
      const green = rgba[offset + 1]
      const blue = rgba[offset + 2]
      // The source's lips are warmer and darker than nearby skin. Eyes and
      // hair are outside this small calibrated region.
      if (red - green < 18 || red - blue < 22 || green > 155) continue
      const weight = Math.min(80, red - green)
      total += weight
      xTotal += x * weight
      yTotal += y * weight
      xx += x * x * weight
      yy += y * y * weight
      xy += x * y * weight
      count += 1
      if (red * 0.299 + green * 0.587 + blue * 0.114 < 110) darkPixels += 1
    }
  }
  const x = total ? xTotal / total : width * 0.5
  const y = total ? yTotal / total : height * 0.475
  const varianceX = total ? xx / total - x * x : 0
  const varianceY = total ? yy / total - y * y : 0
  const covariance = total ? xy / total - x * y : 0
  const angle = Math.max(-0.6, Math.min(0.6, 0.5 * Math.atan2(2 * covariance, varianceX - varianceY)))
  return {
    x, y, angle,
    span: Math.max(2, Math.sqrt(Math.max(0, varianceX)) * Math.sqrt(12)),
    valid: count >= 3 && varianceX >= 1,
    score: darkPixels / Math.max(1, width),
  }
}

export function createPortraitSpeechClock(fps = 24) {
  let bodyTick = -1
  let publishedAt = -Infinity
  let wasPlaying = false
  let previousMouth = 0
  const intervalMs = 1000 / fps
  return {
    invalidate() { bodyTick = -1 },
    get active() { return wasPlaying || previousMouth > 0 },
    publish({ now, tick, playing, mouthOpen, busy }) {
      if (busy) return false
      const speechActive = playing || wasPlaying || previousMouth > 0
      if (speechActive && now - publishedAt < intervalMs - 0.01) return false
      if (!speechActive && tick === bodyTick) return false
      bodyTick = tick
      publishedAt = now
      wasPlaying = Boolean(playing)
      previousMouth = playing ? mouthOpen : 0
      return true
    },
  }
}

export function samplePortraitVideoScan(video, { sample, timeoutMs, signal, schedule = setTimeout, cancel = clearTimeout }) {
  return new Promise((resolve) => {
    let stopped = false
    let frameId = 0
    let fallbackId = 0
    let timeoutId = 0
    const finish = () => {
      if (stopped) return
      stopped = true
      if (frameId) video.cancelVideoFrameCallback?.(frameId)
      if (fallbackId) cancel(fallbackId)
      if (timeoutId) cancel(timeoutId)
      video.removeEventListener('ended', finish)
      signal?.removeEventListener('abort', finish)
      video.pause()
      resolve()
    }
    const capture = (_now, metadata) => {
      frameId = fallbackId = 0
      if (stopped) return
      try { sample(metadata?.mediaTime ?? video.currentTime) }
      catch { finish(); return }
      if (video.ended) finish()
      else next()
    }
    const next = () => {
      if (stopped) return
      if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(capture)
      else fallbackId = schedule(capture, 20)
    }
    video.addEventListener('ended', finish, { once: true })
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) { finish(); return }
    timeoutId = schedule(finish, timeoutMs)
    Promise.resolve().then(() => stopped ? undefined : video.play()).then(() => { if (!stopped) next() }, finish)
  })
}

export function capturePortraitMouth(rgba, width, height) {
  const geometry = mouthGeometry(rgba, width, height)
  const patchWidth = Math.max(4, Math.ceil(width * 0.08))
  const patchHeight = Math.max(4, Math.ceil(height * 0.075))
  const left = Math.max(0, Math.min(width - patchWidth, Math.round(geometry.x - patchWidth / 2)))
  const top = Math.max(0, Math.min(height - patchHeight, Math.round(geometry.y - patchHeight / 2)))
  const pixels = new Uint8ClampedArray(patchWidth * patchHeight * 4)
  for (let y = 0; y < patchHeight; y += 1) {
    pixels.set(rgba.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + patchWidth) * 4), y * patchWidth * 4)
  }
  return { pixels, width: patchWidth, height: patchHeight, score: geometry.score,
    geometry: { ...geometry, cosine: Math.cos(geometry.angle), sine: Math.sin(geometry.angle),
      x: geometry.x - left, y: geometry.y - top } }
}

export function createPortraitMouthAtlas(frames) {
  if (!frames?.length) return null
  const closed = frames[0]
  const opened = frames.reduce((best, frame) => frame.score > best.score ? frame : best, closed)
  const middle = frames.reduce((best, frame) => Math.abs(frame.score - opened.score * 0.45) < Math.abs(best.score - opened.score * 0.45) ? frame : best, closed)
  return { closed, middle, opened }
}

export function applyPortraitSpeechMouth(rgba, width, height, atlas, mouthOpen = 0, { active = false } = {}) {
  // Closed lips are only an audio pause within TTS. Idle clips already have
  // their own facial expression; another clip's patch must not replace it.
  if (!active || !atlas?.closed || !atlas?.opened) return false
  const openness = Math.max(0, Math.min(1, Number(mouthOpen) || 0))
  const from = openness < 0.5 ? atlas.closed : atlas.middle
  const to = openness < 0.5 ? atlas.middle : atlas.opened
  const blend = openness < 0.5 ? openness * 2 : (openness - 0.5) * 2
  const center = mouthGeometry(rgba, width, height)
  if (!center.valid || !from.geometry?.valid || !to.geometry?.valid) return false
  const scale = Math.max(0.7, Math.min(1.4, center.span / atlas.closed.geometry.span))
  const radius = Math.ceil(Math.hypot(from.width * 0.46, from.height * 0.45) * scale) + 1
  const cosine = Math.cos(center.angle)
  const sine = Math.sin(center.angle)
  const sample = (patch, localX, localY, channel) => {
    const geometry = patch.geometry
    const c = geometry.cosine
    const s = geometry.sine
    const px = geometry.x + localX * c - localY * s
    const py = geometry.y + localX * s + localY * c
    const x0 = Math.floor(px), y0 = Math.floor(py)
    if (x0 < 0 || y0 < 0 || x0 + 1 >= patch.width || y0 + 1 >= patch.height) return null
    const fx = px - x0, fy = py - y0
    const at = (x, y) => patch.pixels[(y * patch.width + x) * 4 + channel]
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy)
      + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  }
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const targetX = Math.round(center.x) + dx
      const targetY = Math.round(center.y) + dy
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue
      const offsetX = targetX - center.x, offsetY = targetY - center.y
      const localX = (offsetX * cosine + offsetY * sine) / scale
      const localY = (-offsetX * sine + offsetY * cosine) / scale
      const normalizedX = localX / (from.width * 0.46)
      const normalizedY = localY / (from.height * 0.45)
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
      const feather = Math.max(0, Math.min(1, (1 - distance) / 0.28))
      if (!feather) continue
      const targetOffset = (targetY * width + targetX) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const a = sample(from, localX, localY, channel)
        const b = sample(to, localX, localY, channel)
        if (a === null || b === null) continue
        const mouthPixel = a + (b - a) * blend
        rgba[targetOffset + channel] += (mouthPixel - rgba[targetOffset + channel]) * feather
      }
    }
  }
  return true
}
