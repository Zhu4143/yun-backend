export async function requestSongReaction({
  song,
  trigger = 'play',
  responseMode = 'normal',
  currentMood = '平静',
  personaMode = 'warm',
  recentChat = [],
  recentAiReplies = [],
}) {
  const response = await fetch('/api/song-reaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: song?.id || '',
      title: song?.title || '',
      artist: song?.artist || '',
      version: song?.version || '',
      moodTags: song?.moodTags || [],
      sceneTags: song?.sceneTags || [],
      energy: song?.energy ?? 50,
      memoryWeight: song?.memoryWeight ?? 50,
      vibeSummary: song?.vibeSummary || '',
      listenContext: song?.listenContext || '',
      currentMood,
      personaMode,
      trigger,
      responseMode,
      recentChat: recentChat.slice(-6),
      recentAiReplies: recentAiReplies.slice(-5),
    }),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '歌曲反应生成失败')
  }

  return data
}
