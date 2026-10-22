// 云语音识别(ASR)前端 API 封装。
// 只与本地后端 /api/asr/* 通信,密钥永不进入浏览器。

// Both Vite's proxy and the packaged app serve /api on the current origin.
// A separate backend is used only when explicitly configured for that build.
const BACKEND_URL = import.meta.env.VITE_YUN_BACKEND_URL || ''

async function request(path, options = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `语音识别服务请求失败(${response.status})`)
    error.code = body.code
    throw error
  }
  return body
}

export function getAsrStatus() {
  return request('/api/asr/status')
}

export function saveAsrConfig({ apiKey, baseUrl = '', model = '' }) {
  return request('/api/asr/config', {
    method: 'POST',
    body: JSON.stringify({ apiKey, baseUrl, model }),
  })
}

export function clearAsrConfig() {
  return request('/api/asr/config', { method: 'DELETE' })
}

// 上传音频转写为文字。file 可以是 Blob/File。
export function transcribeAudio(file, { language = 'zh', signal } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('language', language)
  return request('/api/asr/transcribe', { method: 'POST', body: form, signal })
}

export function detectWakeWord(file, { signal } = {}) {
  const form = new FormData()
  form.append('file', file, 'wake.wav')
  return request('/api/asr/wake-detect', { method: 'POST', body: form, signal })
}
