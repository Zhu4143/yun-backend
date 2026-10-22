const MEDIA_EVENTS = ['timeupdate', 'seeking', 'seeked', 'play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata', 'durationchange', 'ratechange']

// Paint only the rail, from the media clock on every display frame. React's
// timeupdate state still owns the accessible range and the elapsed-time label.
export function createTimelinePainter({ node, readMedia, readPosition, visible = () => true,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let media = null, frame = null, disposed = false, lastRatio = null
  const bindMedia = () => {
    const next = readMedia()
    if (next === media) return
    MEDIA_EVENTS.forEach(event => media?.removeEventListener(event, refresh))
    media = next
    MEDIA_EVENTS.forEach(event => media?.addEventListener(event, refresh))
  }
  const paint = () => {
    const fallback = readPosition()
    const time = media && Number.isFinite(media.currentTime) ? media.currentTime : fallback.time
    const duration = media && Number.isFinite(media.duration) && media.duration > 0 ? media.duration : fallback.duration
    const ratio = Number.isFinite(time) && Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0
    if (ratio === lastRatio) return
    node.style.setProperty('--range-ratio', String(ratio))
    node.style.setProperty('--range-progress', `${ratio * 100}%`)
    lastRatio = ratio
  }
  const stop = () => { if (frame !== null) cancelFrame(frame); frame = null }
  const schedule = () => {
    if (media && !media.paused && !media.ended) {
      if (frame === null) frame = requestFrame(tick)
    } else stop()
  }
  const tick = () => {
    frame = null
    if (disposed || !visible()) return
    bindMedia()
    paint()
    schedule()
  }
  const refresh = () => {
    if (disposed) return
    bindMedia()
    if (!visible()) { stop(); return }
    paint()
    schedule()
  }
  refresh()
  return {
    refresh,
    dispose() {
      disposed = true
      stop()
      MEDIA_EVENTS.forEach(event => media?.removeEventListener(event, refresh))
    },
  }
}
