const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

class LyricFlowController {
  constructor() {
    this.center = new Float32Array([0.34, 0.54])
    this.size = new Float32Array([0.28, 0.08])
    this.velocity = new Float32Array([0.34, 0])
    this.palette = new Float32Array([0.35, 0.42, 0.58, 0.58, 0.36, 0.46, 0.72, 0.58, 0.34])
    this.previousCenter = new Float32Array(this.center)
    this.revealStart = 0
    this.lastMeasureTime = 0
    this.reveal = 1
    this.settle = 1
    this.force = 0
    this.active = false
    this.visibility = 0
  }

  beginReveal(nowMs) {
    this.revealStart = nowMs
    this.lastMeasureTime = 0
    this.reveal = 0
    this.settle = 0
    this.force = 0.18
    this.velocity[0] = 0.34
    this.velocity[1] = 0
    this.active = true
    this.visibility = 1
  }

  updateRect(rect, viewportWidth, viewportHeight, nowMs) {
    if (!rect || viewportWidth <= 0 || viewportHeight <= 0) return
    const centerX = (rect.left + rect.width * 0.5) / viewportWidth
    const centerY = 1 - (rect.top + rect.height * 0.5) / viewportHeight
    if (this.lastMeasureTime > 0) {
      const deltaSeconds = Math.max((nowMs - this.lastMeasureTime) * 0.001, 1 / 240)
      const velocityX = (centerX - this.previousCenter[0]) / deltaSeconds
      const velocityY = (centerY - this.previousCenter[1]) / deltaSeconds
      this.velocity[0] += (clamp(velocityX, -1.2, 1.2) - this.velocity[0]) * 0.28
      this.velocity[1] += (clamp(velocityY, -1.2, 1.2) - this.velocity[1]) * 0.28
    }
    this.center[0] = centerX
    this.center[1] = centerY
    this.previousCenter[0] = centerX
    this.previousCenter[1] = centerY
    this.size[0] = clamp(rect.width / viewportWidth, 0.08, 0.72)
    this.size[1] = clamp(rect.height / viewportHeight, 0.035, 0.18)
    this.lastMeasureTime = nowMs
    this.updateEnvelope(nowMs)
  }

  updateEnvelope(nowMs) {
    if (!this.active) return
    const elapsed = Math.max(0, nowMs - this.revealStart)
    this.reveal = clamp(elapsed / 780, 0, 1)
    this.settle = clamp((elapsed - 780) / 1200, 0, 1)
    const thrust = Math.sin(Math.min(this.reveal, 1) * Math.PI)
    const returnFlow = 1 - this.settle
    this.force = clamp(thrust * 0.92 + returnFlow * 0.16, 0, 1)
    if (elapsed > 2100) {
      this.force = 0
      this.reveal = 1
      this.settle = 1
      this.active = false
      this.velocity[0] *= 0.82
      this.velocity[1] *= 0.82
    }
  }

  setPalette(palette) {
    for (let index = 0; index < 9; index += 1) this.palette[index] = palette[index]
  }

  deactivate() {
    this.active = false
    this.visibility = 0
    this.force = 0
    this.reveal = 1
    this.settle = 1
  }
}

export const lyricFlowController = new LyricFlowController()
