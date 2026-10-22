import test from 'node:test'
import assert from 'node:assert/strict'
import { measureVoiceBands, readAudioBufferMeter, readVoicePlaybackMeter } from './voiceMeter.js'

function sineWave(frequency, amplitude = 0.5, length = 2048, sampleRate = 16000) {
  return Float32Array.from({ length }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate))
}

test('audible soft speech opens the mouth at ordinary listening volume and pauses close it', () => {
  const samples = Float32Array.from({ length: 16000 }, (_, index) => index >= 4000 && index < 12000
    ? 0.03 * Math.sin(2 * Math.PI * 220 * index / 16000) : 0)
  const audio = { sampleRate: 16000, numberOfChannels: 1, length: samples.length, getChannelData: () => samples }
  const normal = readVoicePlaybackMeter(audio, 0.5, { playing: true, gain: 1 })
  const quiet = readVoicePlaybackMeter(audio, 0.5, { playing: true, gain: 0.4 })
  assert.ok(quiet.mouthOpen > 0.8, 'quiet audible speech must expose the open-mouth source pose')
  assert.equal(quiet.mouthOpen, normal.mouthOpen, 'ordinary output volume must not shrink the mouth pose')
  assert.equal(readVoicePlaybackMeter(audio, 0.9, { playing: true, gain: 0.4 }).mouthOpen, 0)
  assert.equal(readVoicePlaybackMeter(audio, 0.5, { playing: true, gain: 0 }).mouthOpen, 0)
  assert.ok(readVoicePlaybackMeter(audio, 0.5, { playing: true, gain: 0.01 }).mouthOpen < quiet.mouthOpen)
})

test('voice meter reports silence as zero', () => {
  const meter = measureVoiceBands(new Float32Array(1024), 16000)
  assert.equal(meter.rms, 0)
  assert.equal(meter.low, 0)
  assert.equal(meter.mid, 0)
  assert.equal(meter.high, 0)
})

test('voice meter puts a low tone in the bass band and a high tone in the treble band', () => {
  const bass = measureVoiceBands(sineWave(100), 16000)
  const treble = measureVoiceBands(sineWave(3200), 16000)
  assert.ok(bass.low > bass.mid * 3)
  assert.ok(treble.high > treble.low * 3)
  assert.ok(bass.rms > 0.9 && bass.rms <= 1)
})

test('read-only playback meter samples the audio buffer at the active playhead', () => {
  const samples = sineWave(100, 0.5, 2048, 16000)
  const audioBuffer = {
    sampleRate: 16000,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  }
  assert.equal(readAudioBufferMeter(audioBuffer, 0).rms, 0)
  const meter = readAudioBufferMeter(audioBuffer, 0.128)
  assert.ok(meter.rms > 0.9)
  assert.ok(meter.low > meter.mid * 3)
})
