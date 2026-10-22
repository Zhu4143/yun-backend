export const COVER_FADE_MS = 1800
const DEFAULT_COVER = '/artwork/coast.webp'
const MAX_LAYERS = 3

/** Blend above the current presentation. Fully opaque layers can safely retire
 * everything beneath them, even when another song arrives during a fade. */
export function createCoverCrossfade(host, { environment = window } = {}) {
  const frames = []
  const motion = environment.matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false, request = 0, requestedSource = null
  let loading = null, pending = null

  function stop(frame) {
    environment.cancelAnimationFrame(frame.raf)
    environment.clearTimeout(frame.timer)
    frame.image.removeEventListener('transitionend', frame.onEnd)
  }

  function remove(frame) {
    stop(frame)
    frame.image.remove()
  }

  function settle(frame) {
    const index = frames.indexOf(frame)
    if (disposed || index < 0) return
    stop(frame)
    for (const previous of frames.splice(0, index)) remove(previous)
    if (pending && frames.length < MAX_LAYERS) {
      const next = pending
      pending = null
      append(next)
    }
  }

  function append(next) {
    if (disposed || frames.at(-1)?.source === next.source) return
    if (frames.length >= MAX_LAYERS) {
      pending = next // Keep only the latest decoded cover while layers settle.
      return
    }
    const frame = { ...next, raf: 0, timer: 0, onEnd: null }
    frame.onEnd = event => {
      if (event.target === frame.image && event.propertyName === 'opacity') settle(frame)
    }
    frame.image.style.opacity = '0'
    frame.image.addEventListener('transitionend', frame.onEnd)
    frames.push(frame)
    host.append(frame.image)
    if (motion.matches) {
      frame.image.style.opacity = '1'
      settle(frame)
      return
    }
    // Establish the transparent starting style before the compositor fades it.
    frame.image.getBoundingClientRect()
    frame.raf = environment.requestAnimationFrame(() => {
      if (disposed || !frames.includes(frame)) return
      frame.image.style.opacity = '1'
      frame.timer = environment.setTimeout(() => settle(frame), COVER_FADE_MS + 100)
    })
  }

  function cancelLoad() {
    if (!loading) return
    loading.onload = loading.onerror = null
    loading.removeAttribute('src')
    loading = null
  }

  function setCover(source) {
    const nextSource = source || DEFAULT_COVER
    if (disposed || requestedSource === nextSource) return
    requestedSource = nextSource
    const epoch = ++request
    cancelLoad()
    pending = null
    const image = host.ownerDocument.createElement('img')
    loading = image
    image.alt = ''
    image.decoding = 'async'
    image.draggable = false
    let imageSource = nextSource
    image.onload = async () => {
      try { await image.decode() } catch { /* Loaded images can still be painted if decode is unavailable. */ }
      if (disposed || epoch !== request) return
      image.onload = image.onerror = null
      if (loading === image) loading = null
      append({ image, source: imageSource })
    }
    image.onerror = () => {
      if (disposed || epoch !== request) return
      if (imageSource !== DEFAULT_COVER) {
        imageSource = DEFAULT_COVER
        image.src = imageSource
      } else {
        // Retain the current background when both the cover and fallback fail.
        image.onload = image.onerror = null
        if (loading === image) loading = null
      }
    }
    image.src = imageSource
  }

  function reduceMotion() {
    if (!motion.matches) return
    if (pending) {
      const next = pending
      pending = null
      for (const frame of frames.splice(0)) remove(frame)
      append(next)
    } else if (frames.length) {
      const newest = frames.at(-1)
      newest.image.style.opacity = '1'
      settle(newest)
    }
  }
  motion.addEventListener('change', reduceMotion)

  return {
    setCover,
    dispose() {
      disposed = true
      request++
      cancelLoad()
      pending = null
      for (const frame of frames.splice(0)) remove(frame)
      motion.removeEventListener('change', reduceMotion)
    },
  }
}
