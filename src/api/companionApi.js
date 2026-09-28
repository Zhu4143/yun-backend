import { fetchLocalApi } from './requestApi.js'

export async function sendCompanionMessage({
  userText,
  chatHistory = [],
  currentSong = null,
  responseMode = 'companion',
  persona = 'warm',
  companionMemory = {},
  userMemory = null,
  memoryEnabled = true,
  memoryMode = 'smart',
  recentAiReplies = [],
  questionCountWindow = 0,
  localTime = new Date().toLocaleString('zh-CN'),
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
  responseId = '',
  signal,
}) {
  // Do not automatically retry this POST: the model may already be processing
  // the turn, and retrying could create a duplicate companion reply.
  const response = await fetchLocalApi('/api/companion-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(responseId ? { 'X-Yun-Response-Id': responseId } : {}),
    },
    signal,
    body: JSON.stringify({
      responseId,
      userText,
      chatHistory: chatHistory.slice(-8),
      currentSong,
      responseMode,
      persona,
      companionMemory,
      userMemory,
      memoryEnabled,
      memoryMode,
      recentAiReplies,
      questionCountWindow,
      localTime,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
    }),
  }, {
    timeoutMs: 75000,
    unavailableMessage: '昀的本地服务刚刚重连，请再试一次',
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '陪伴聊天暂时失败')
  }

  return data
}
