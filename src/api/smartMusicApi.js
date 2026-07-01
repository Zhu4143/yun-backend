export async function requestSmartMusicCommand({
  message,
  chatHistory = [],
  currentSong = null,
  responseMode = 'companion',
  persona = 'warm',
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
}) {
  const response = await fetch('/api/smart-music-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      chatHistory: chatHistory.slice(-6),
      currentSong,
      responseMode,
      persona,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
    }),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '智能音乐指令暂时失败')
  }

  return data
}
