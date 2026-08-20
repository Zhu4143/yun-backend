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
  const body = JSON.stringify({
    message,
    chatHistory: chatHistory.slice(-6),
    currentSong,
    responseMode,
    persona,
    playHistory: playHistory.slice(-10),
    rejectedTracks: rejectedTracks.slice(-10),
    recentRecommendations: recentRecommendations.slice(-10),
  })
  let lastError

  // A brief model-gateway hiccup should not discard a user's correction.
  // Retry once, then let the router choose its normal safe fallback.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('/api/smart-music-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || '智能音乐指令暂时失败')
      return data
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 250))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('智能音乐指令暂时失败')
}
