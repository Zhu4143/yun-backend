const BAND_FREQUENCIES = Object.freeze({
  low: [70, 95, 125, 165, 210],
  mid: [280, 380, 520, 720, 980, 1320],
  high: [1750, 2250, 2900, 3700, 4700],
})

function frequencyMagnitude(samples, sampleRate, frequency) {
  const step = 2 * Math.PI * frequency / sampleRate
  let real = 0
  let imaginary = 0
  let windowTotal = 0
  const length = samples.length
  for (let index = 0; index < length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, length - 1))
    const sample = samples[index] * window
    const angle = step * index
    real += sample * Math.cos(angle)
    imaginary -= sample * Math.sin(angle)
    windowTotal += window
  }
  return Math.min(1, (2 * Math.hypot(real, imaginary)) / Math.max(1, windowTotal))
}

export function measureVoiceBands(samples, sampleRate = 16000) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { rms: 0, low: 0, mid: 0, high: 0 }
  }
  let sumSquares = 0
  let mean = 0
  for (let index = 0; index < samples.length; index += 1) mean += samples[index]
  mean /= samples.length
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean
    sumSquares += centered * centered
  }
  const rms = Math.sqrt(sumSquares / samples.length)
  const measureBand = (frequencies) => {
    const sum = frequencies.reduce((total, frequency) => total + frequencyMagnitude(samples, sampleRate, frequency), 0)
    return Math.min(1, Math.sqrt(sum / frequencies.length) * 2.6)
  }
  return {
    rms: Math.min(1, rms * 2.8),
    low: measureBand(BAND_FREQUENCIES.low),
    mid: measureBand(BAND_FREQUENCIES.mid),
    high: measureBand(BAND_FREQUENCIES.high),
  }
}

export function readAudioBufferMeter(audioBuffer, currentTime, windowSize = 1024) {
  if (!audioBuffer?.numberOfChannels || !audioBuffer.length || !Number.isFinite(currentTime)) {
    return { rms: 0, low: 0, mid: 0, high: 0 }
  }
  const sampleRate = audioBuffer.sampleRate
  const end = Math.max(0, Math.min(audioBuffer.length, Math.floor(currentTime * sampleRate)))
  const size = Math.min(windowSize, end)
  if (size < 32) return { rms: 0, low: 0, mid: 0, high: 0 }
  const start = end - size
  const samples = new Float32Array(size)
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index))
  for (let index = 0; index < size; index += 1) {
    let monoSample = 0
    channels.forEach((channel) => { monoSample += channel[start + index] || 0 })
    samples[index] = monoSample / channels.length
  }
  return measureVoiceBands(samples, sampleRate)
}

const speechReferenceLevels = new WeakMap()

function getSpeechReferenceLevel(audioBuffer) {
  if (speechReferenceLevels.has(audioBuffer)) return speechReferenceLevels.get(audioBuffer)
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index))
  const levels = []
  for (let start = 0; start < audioBuffer.length; start += 1024) {
    const end = Math.min(audioBuffer.length, start + 1024)
    let sum = 0
    for (let index = start; index < end; index += 1) {
      let mono = 0
      for (const channel of channels) mono += channel[index] || 0
      mono /= channels.length
      sum += mono * mono
    }
    levels.push(Math.sqrt(sum / (end - start)) * 2.8)
  }
  levels.sort((a, b) => a - b)
  const reference = Math.min(1, Math.max(0.008, levels[Math.floor((levels.length - 1) * 0.9)] || 0))
  speechReferenceLevels.set(audioBuffer, reference)
  return reference
}

export function readVoicePlaybackMeter(audioBuffer, currentTime, { playing = false, gain = 1 } = {}) {
  if (!playing || !audioBuffer || !Number.isFinite(currentTime) || currentTime < 0
    || currentTime >= audioBuffer.length / audioBuffer.sampleRate) {
    return { rms: 0, low: 0, mid: 0, high: 0, mouthOpen: 0, playing: false }
  }
  const meter = readAudioBufferMeter(audioBuffer, currentTime)
  const outputGain = Math.max(0, Math.min(1.5, Number(gain) || 0))
  // Normalize articulation against this utterance, before the speaker gain.
  // Quiet listening should still use the actual open-mouth source frames.
  const reference = getSpeechReferenceLevel(audioBuffer)
  const noiseFloor = Math.max(0.0015, reference * 0.08)
  const openness = outputGain > 0
    ? Math.max(0, Math.min(1, (meter.rms - noiseFloor) / (reference * 0.85))) : 0
  for (const band of ['rms', 'low', 'mid', 'high']) meter[band] = Math.min(1, meter[band] * outputGain)
  const fade = Math.min(1, outputGain / 0.08)
  return { ...meter, mouthOpen: openness * openness * (3 - 2 * openness) * fade, playing: true }
}
