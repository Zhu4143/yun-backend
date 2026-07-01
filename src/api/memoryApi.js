export async function fetchYunMemory() {
  const response = await fetch('/api/yun-memory')
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '读取昀的记忆失败')
  }

  return data.memory || {}
}

export async function resetYunMemory() {
  const response = await fetch('/api/yun-memory/reset', {
    method: 'POST',
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '重置昀的记忆失败')
  }

  return data.memory || {}
}

export async function fetchYunSettings() {
  const response = await fetch('/api/yun-settings')
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '读取记忆设置失败')
  }

  return data
}

export async function saveYunSettings({ memoryMode }) {
  const response = await fetch('/api/yun-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memoryMode }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '保存记忆设置失败')
  }

  return data
}

export async function fetchDefaultUserMemory() {
  const response = await fetch('/user_memory.json', { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('默认记忆加载失败')
  }

  return response.json()
}
