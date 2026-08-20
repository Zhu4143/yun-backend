export async function sendMossMessage(payload, signal) {
  const response = await fetch('/api/moss/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok && !data.message) throw new Error(`MOSS API request failed: ${response.status}`)
  return data
}

export async function fetchMossRuntime() {
  const response = await fetch('/api/moss/runtime')
  if (!response.ok) throw new Error(`MOSS runtime request failed: ${response.status}`)
  return response.json()
}

export async function configureMossModel(payload) {
  const response = await fetch('/api/moss/model-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `模型配置失败：${response.status}`)
  return data
}
