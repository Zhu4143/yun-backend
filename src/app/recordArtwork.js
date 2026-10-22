export const RECORD_BLEND_SECONDS = 2.4
const ease = value => value * value * (3 - 2 * value)

/** Two visible textures, plus only the newest ready replacement. A late load
 * never replaces a newer request, and an interrupted fade never jumps back. */
export function createRecordArtwork({ load, release, publish, onError, duration = RECORD_BLEND_SECONDS }) {
  let epoch = 0, disposed = false, requested = '', current = null, incoming = null, pending = null, progress = 0
  const emit = () => publish({ current, incoming, mix: incoming ? ease(progress) : 0 })
  const begin = candidate => { incoming = candidate; progress = 0; emit() }
  return {
    async set(source, key = source) {
      if (disposed || !source || requested === source) return
      requested = source
      const token = ++epoch
      if (pending) { release(pending.value); pending = null }
      try {
        const value = await load(source)
        if (disposed || token !== epoch) { release(value); return }
        const candidate = { source, key, value }
        if (!current) { current = candidate; emit() }
        else if (incoming) pending = candidate
        else begin(candidate)
      } catch (error) {
        if (disposed || token !== epoch) return
        requested = ''
        onError?.(error, Boolean(current))
      }
    },
    step(delta, reduced = false) {
      if (disposed || !incoming) return
      progress = reduced ? 1 : Math.min(1, progress + Math.max(0, delta) / duration)
      if (progress < 1) { emit(); return }
      const old = current
      current = incoming; incoming = null; progress = 0
      emit()
      release(old.value)
      if (pending) { const next = pending; pending = null; begin(next); if (reduced) this.step(0, true) }
    },
    dispose() {
      if (disposed) return
      disposed = true; epoch += 1
      for (const frame of [current, incoming, pending]) if (frame) release(frame.value)
      current = incoming = pending = null
    },
  }
}

export function advanceRecordSpin(state, playing, delta, reduced = false) {
  if (reduced) return { angle: state.angle, speed: 0 }
  const target = playing ? Math.PI / 10 : 0
  const decay = Math.exp(-3 * delta)
  return {
    speed: target + (state.speed - target) * decay,
    angle: state.angle + target * delta + (state.speed - target) * (1 - decay) / 3,
  }
}
