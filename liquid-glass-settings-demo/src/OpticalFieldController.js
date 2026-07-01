const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const damp = (from, to, response, delta) => from + (to - from) * (1 - Math.exp(-response * delta))

export const opticalField = {
  intensity: 0.18,
  distortion: 0.16,
  flow: 0.12,
  blur: 0.04,
  chromatic: 0.14,
}

class OpticalFieldController {
  constructor() {
    this.target = { ...opticalField }
    this.lastTime = performance.now()
    this.frame = 0
  }

  setPointer(clientX, clientY) {
    const x = clientX / Math.max(1, innerWidth)
    const y = clientY / Math.max(1, innerHeight)
    const edge = clamp(Math.hypot(x - 0.5, y - 0.5) * 1.35)
    this.target.intensity = 0.16 + (1 - y) * 0.26
    this.target.distortion = 0.12 + edge * 0.30
    this.target.flow = 0.10 + Math.abs(x - 0.5) * 0.42
    this.target.blur = 0.025 + edge * 0.055
    this.target.chromatic = 0.12 + x * 0.30
  }

  start() {
    if (this.frame) return
    const tick = (time) => {
      const delta = Math.min(0.1, (time - this.lastTime) / 1000)
      this.lastTime = time
      opticalField.intensity = damp(opticalField.intensity, this.target.intensity, 4.2, delta)
      opticalField.distortion = damp(opticalField.distortion, this.target.distortion, 3.6, delta)
      opticalField.flow = damp(opticalField.flow, this.target.flow, 2.8, delta)
      opticalField.blur = damp(opticalField.blur, this.target.blur, 2.2, delta)
      opticalField.chromatic = damp(opticalField.chromatic, this.target.chromatic, 3.4, delta)

      const root = document.documentElement.style
      Object.entries(opticalField).forEach(([key, value]) => {
        root.setProperty(`--optical-${key}`, value.toFixed(4))
      })
      root.setProperty('--optical-time', (time / 1000).toFixed(3))
      this.frame = requestAnimationFrame(tick)
    }
    addEventListener('pointermove', (event) => this.setPointer(event.clientX, event.clientY), { passive: true })
    this.frame = requestAnimationFrame(tick)
  }
}

export const opticalFieldController = new OpticalFieldController()
