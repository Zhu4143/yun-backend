// Keep a fractional position: rounding scrollTop on every frame stalls slow scrolling.
export function createCommentAutoScroll(element, {
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  onEnd = () => {},
  pixelsPerSecond = 12,
  readingDelay = 2200,
} = {}) {
  const pauses = new Set()
  let frame = null, previous = null, elapsed = 0, position = element.scrollTop
  let destroyed = false, ended = false

  const schedule = () => {
    if (!destroyed && !ended && !pauses.size && frame === null) frame = requestFrame(tick)
  }
  const tick = timestamp => {
    frame = null
    if (destroyed || pauses.size || ended) return
    const timePassed = previous === null ? 0 : Math.max(0, timestamp - previous)
    const delta = Math.min(50, timePassed)
    previous = timestamp
    elapsed += timePassed
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    if (elapsed > readingDelay && max === 0) { ended = true; onEnd(); return }
    if (elapsed > readingDelay && max > 0) {
      const ease = Math.min(1, (elapsed - readingDelay) / 900)
      position = Math.min(max, position + pixelsPerSecond * ease * delta / 1000)
      element.scrollTop = position
      if (position >= max) { ended = true; onEnd(); return }
    }
    schedule()
  }

  schedule()
  return {
    setPaused(reason, paused) {
      if (destroyed || pauses.has(reason) === paused) return
      if (paused) {
        pauses.add(reason)
        if (frame !== null) cancelFrame(frame)
        frame = null
        previous = null
      } else {
        pauses.delete(reason)
        // Resume from the reader's position without catching up to a stale target.
        position = element.scrollTop
        previous = null
        elapsed = 0
        schedule()
      }
    },
    restartIfEnded() {
      if (!ended || destroyed) return
      ended = false
      position = 0
      element.scrollTop = 0
      elapsed = 0
      previous = null
      schedule()
    },
    destroy() {
      destroyed = true
      if (frame !== null) cancelFrame(frame)
      frame = null
    },
  }
}
