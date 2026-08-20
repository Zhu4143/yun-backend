export class BrowserAecFallback {
  constructor() {
    this.mode = 'browser_aec_fallback'
  }

  process(micFrame, referenceFrame) {
    // Chromium/WebRTC applies echo cancellation in getUserMedia when supported.
    // The browser does not expose its internal AEC reference or residual PCM.
    return { samples: micFrame, referenceFrameAvailable: Boolean(referenceFrame), mode: this.mode }
  }
}

export class SpeakerReferenceBuffer {
  constructor({ maxFrames = 96 } = {}) {
    this.maxFrames = maxFrames
    this.frames = []
  }

  push(samples, timestamp = performance.now()) {
    if (this.frames.length >= this.maxFrames) this.frames.shift()
    this.frames.push({ samples, timestamp })
  }

  nearest(timestamp) {
    return this.frames.reduce((best, frame) => (
      !best || Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? frame : best
    ), null)
  }

  clear() {
    this.frames = []
  }
}

let sharedSpeakerReferenceBuffer = null

export function getSharedSpeakerReferenceBuffer() {
  if (!sharedSpeakerReferenceBuffer) sharedSpeakerReferenceBuffer = new SpeakerReferenceBuffer()
  return sharedSpeakerReferenceBuffer
}
