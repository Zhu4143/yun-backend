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
    if (import.meta.env.DEV && now() - this.lastMetricLogAt >= 1000) {
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

  async start() {
    if (this.status === 'running') {
      await this.context?.resume?.()
      return this.getMetrics()
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone_unsupported')
    this.status = 'starting'
    this.emitMetrics()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('audio_context_unsupported')
    }
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(this.frameSize, 1, 1)
    const silentGain = context.createGain()
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
    this.emitMetrics()
    return this.getMetrics()
  }

  async stop(reason = 'stopped') {
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
