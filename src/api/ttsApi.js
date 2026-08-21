import { fetchLocalApi } from './requestApi'

export async function synthesizeSpeech({
  text,
  voice = 'zh_female_xiaohe_uranus_bigtts',
  speed = 1,
  volume = 1,
}) {
  const response = await fetchLocalApi('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice,
      speed,
      volume,
    }),
  }, {
    timeoutMs: 30000,
    unavailableMessage: '语音服务暂时不可用，已保留文字回复',
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'TTS failed')
  }

  return response.blob()
}
