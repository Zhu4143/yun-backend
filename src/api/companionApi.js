export async function sendCompanionMessage({
  userText,
  chatHistory = [],
  currentSong = null,
  responseMode = 'companion',
  persona = 'warm',
  companionMemory = {},
  userMemory = null,
  memoryEnabled = true,
  recentAiReplies = [],
  questionCountWindow = 0,
  localTime = new Date().toLocaleString('zh-CN'),
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
}) {
  const response = await fetch('/api/companion-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userText,
      chatHistory: chatHistory.slice(-8),
      currentSong,
      responseMode,
      persona,
      companionMemory,
      userMemory,
      memoryEnabled,
      recentAiReplies,
      questionCountWindow,
      localTime,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
    }),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '陪伴聊天暂时失败')
  }

  return data
}
