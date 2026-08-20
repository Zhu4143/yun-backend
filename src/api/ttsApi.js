export async function synthesizeSpeech({
  text,
  voice = 'zh_female_xiaohe_uranus_bigtts',
  speed = 1,
  volume = 1,
}) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice,
      speed,
      volume,
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'TTS failed')
  }

  return response.blob()
}
