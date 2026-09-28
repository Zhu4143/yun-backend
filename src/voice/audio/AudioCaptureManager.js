const DEFAULT_FRAME_SIZE = 1024
const DEFAULT_MAX_QUEUE_FRAMES = 96

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class AudioCaptureManager {
  constructor({ frameSize = DEFAULT_FRAME_SIZE, maxQueueFrames = DEFAULT_MAX_QUEUE_FRAMES } = {}) {
    this.frameSize = frameSize
    this.maxQueueFrames = maxQueueFrames
    this.stream = null
    this.context = null
    this.source = null
    this.processor = null
    this.silentGain = null
    this.subscribers = new Set()
    this.metricSubscribers = new Set()
    this.frames = []
    this.draining = false
    this.startedAt = 0
    this.frameCount = 0
    this.droppedFrames = 0
    this.maxQueueDepth = 0
    this.status = 'idle'
    this.captureOwner = 'none'
    this.startPromise = null
    this.lastMetricLogAt = 0
  }

  subscribe(callback) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  subscribeMetrics(callback) {
    this.metricSubscribers.add(callback)
    callback(this.getMetrics())
    return () => this.metricSubscribers.delete(callback)
  }

  getMetrics() {
    const elapsedSeconds = Math.max(0.001, (now() - this.startedAt) / 1000)
    return {
      status: this.status,
      captureOwner: this.captureOwner,
      frameCount: this.frameCount,
      droppedFrames: this.droppedFrames,
      queueDepth: this.frames.length,
      maxQueueDepth: this.maxQueueDepth,
      captureFps: this.frameCount / elapsedSeconds,
      sampleRate: this.context?.sampleRate || 0,
      startedAt: this.startedAt,
    }
  }

  emitMetrics() {
    const metrics = this.getMetrics()
    if (import.meta.env?.DEV && now() - this.lastMetricLogAt >= 1000) {
      this.lastMetricLogAt = now()
      console.debug('[CAPTURE]', metrics)
    }
    this.metricSubscribers.forEach((callback) => callback(metrics))
  }

  enqueue(frame) {
    if (this.frames.length >= this.maxQueueFrames) {
      this.frames.shift()
      this.droppedFrames += 1
    }
    this.frames.push({ samples: frame, timestamp: now(), sampleRate: this.context?.sampleRate || 0 })
    this.frameCount += 1
    this.maxQueueDepth = Math.max(this.maxQueueDepth, this.frames.length)
    if (!this.draining) {
      this.draining = true
      window.setTimeout(() => this.drain(), 0)
    }
  }

  drain() {
    this.draining = false
    const batch = this.frames.splice(0, this.frames.length)
    batch.forEach((frame) => this.subscribers.forEach((callback) => callback(frame)))
    this.emitMetrics()
  }

  async setOwner(owner) {
    if (!['none', 'native', 'browser'].includes(owner)) throw new Error(`invalid_microphone_owner:${owner}`)
    if (owner === 'native') {
      this.captureOwner = 'native'
      if (this.status === 'running' || this.startPromise) await this.stop('native-owned')
      else this.status = 'native-owned'
      this.emitMetrics()
      return this.getMetrics()
    }
    if (owner === 'none') {
      const hadBrowserCapture = this.captureOwner === 'browser' || this.status === 'running' || this.startPromise
      this.captureOwner = 'none'
      if (hadBrowserCapture) await this.stop('owner-released')
      else this.status = 'idle'
      this.emitMetrics()
      return this.getMetrics()
    }
    if (this.captureOwner === 'native') throw new Error('microphone_owned_by_native')
    this.captureOwner = 'browser'
    this.emitMetrics()
    return this.getMetrics()
  }

  start() {
    if (this.captureOwner === 'native') return Promise.reject(new Error('microphone_owned_by_native'))
    if (this.status === 'running') {
      return Promise.resolve(this.context?.resume?.()).then(() => this.getMetrics())
    }
    if (this.startPromise) return this.startPromise
    if (this.captureOwner === 'none') this.captureOwner = 'browser'
    const starting = this.startBrowserCapture()
    const tracked = starting.finally(() => {
      if (this.startPromise === tracked) this.startPromise = null
    })
    this.startPromise = tracked
    return tracked
  }

  async startBrowserCapture() {
    this.status = 'starting'
    this.emitMetrics()
    let stream
    let context
    let source
    let processor
    let silentGain
    try {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('microphone_unsupported')
      stream = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (this.captureOwner !== 'browser') throw new Error('microphone_owner_changed')
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) throw new Error('audio_context_unsupported')
      context = new AudioContext()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(this.frameSize, 1, 1)
      silentGain = context.createGain()
      silentGain.gain.value = 0
      processor.onaudioprocess = (event) => {
        // Keep the real-time callback intentionally tiny: copy, queue, return.
        this.enqueue(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(context.destination)
      this.stream = stream
      this.context = context
      this.source = source
      this.processor = processor
      this.silentGain = silentGain
      this.frames = []
      this.frameCount = 0
      this.droppedFrames = 0
      this.maxQueueDepth = 0
      this.startedAt = now()
      this.status = 'running'
      await context.resume?.()
      if (this.captureOwner !== 'browser') throw new Error('microphone_owner_changed')
      this.emitMetrics()
      return this.getMetrics()
    } catch (error) {
      processor?.disconnect?.()
      source?.disconnect?.()
      silentGain?.disconnect?.()
      stream?.getTracks().forEach((track) => track.stop())
      if (context?.state !== 'closed') await context?.close?.().catch(() => {})
      if (this.stream === stream) {
        this.stream = null
        this.context = null
        this.source = null
        this.processor = null
        this.silentGain = null
        this.frames = []
      }
      this.status = this.captureOwner === 'native' ? 'native-owned' : 'error'
      this.emitMetrics()
      throw error
    }
  }

  async stop(reason = 'stopped') {
    const starting = this.startPromise
    if (starting) await starting.catch(() => {})
    this.status = reason
    this.processor?.disconnect?.()
    this.source?.disconnect?.()
    this.silentGain?.disconnect?.()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context?.state !== 'closed') await this.context?.close?.()
    this.stream = null
    this.context = null
    this.source = null
    this.processor = null
    this.silentGain = null
    this.frames = []
    this.emitMetrics()
  }
}

let sharedCaptureManager = null

export function getSharedAudioCaptureManager() {
  if (!sharedCaptureManager) sharedCaptureManager = new AudioCaptureManager()
  return sharedCaptureManager
}
