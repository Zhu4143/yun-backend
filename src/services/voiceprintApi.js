const VOICEPRINT_URL = import.meta.env.VITE_YUN_VOICEPRINT_URL || 'http://127.0.0.1:17891'

async function request(path, options = {}) {
  const response = await fetch(`${VOICEPRINT_URL}${path}`, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || body.error || '本地声纹服务暂时不可用')
  return body
}

export function getVoiceprintProfile() {
  return request('/health')
}

export function enrollVoiceprint(samples) {
  const form = new FormData()
  samples.forEach((sample, index) => form.append('files', sample, `yun-voice-${index + 1}.wav`))
  return request('/enroll', { method: 'POST', body: form })
}

export function verifyVoiceprint(sample) {
  const form = new FormData()
  form.append('file', sample, 'yun-wake.wav')
  return request('/verify', { method: 'POST', body: form })
}

export function removeVoiceprint() {
  return request('/profile', { method: 'DELETE' })
}

export function createWavBlob(channels, sampleRate) {
  const length = channels.reduce((total, channel) => total + channel.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const writeText = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  })
  return new Blob([buffer], { type: 'audio/wav' })
}
