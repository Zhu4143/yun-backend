export async function requestSongReaction({
  song,
  trigger = 'play',
  responseMode = 'normal',
  currentMood = '平静',
  personaMode = 'warm',
  recentChat = [],
  recentAiReplies = [],
  previousSong = null,
  announcementLength = 'medium',
  responseId = '',
  signal,
}) {
  const response = await fetch('/api/song-reaction', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(responseId ? { 'X-Yun-Response-Id': responseId } : {}),
    },
    signal,
    body: JSON.stringify({
      responseId,
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
      previousSong: previousSong ? {
        title: previousSong.title || '',
        artist: previousSong.artist || '',
        moodTags: previousSong.moodTags || [],
        energy: previousSong.energy ?? 50,
      } : null,
      announcementLength,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (signal?.aborted) throw signal.reason || new DOMException('Song reaction cancelled', 'AbortError')

  if (!response.ok || data.error) {
    throw new Error(data.error || '歌曲反应生成失败')
  }

  return data
}
