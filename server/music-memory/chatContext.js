const MUSIC_RE = /音乐|歌曲|歌手|听歌|喜欢听|最近听|推荐|这首|下一首|跳过|听完|循环|网易云/
export function isMusicMemoryRelevant(text = '') { return MUSIC_RE.test(String(text)) }
export function buildMusicPreferenceChatContext(snapshot, { currentSong } = {}) {
  if (!snapshot?.tracks) return { available: false, prompt: '' }
  const tracks = Object.values(snapshot.tracks).filter(Boolean)
  const make = (item) => ({ title: item.title, artist: item.artist, signal: item.derived?.confidence === 'high' ? 'direct inferred signal' : 'provider exposure only', direct: item.derived?.confidence === 'high' ? { completes: item.directListening?.completeCount || 0, skips: item.directListening?.skipCount || 0, repeats: item.directListening?.repeatCount || 0 } : null })
  const ordered = tracks.sort((a, b) => (b.derived?.recentAffinity || 0) - (a.derived?.recentAffinity || 0) || String(a.trackId).localeCompare(String(b.trackId))).slice(0, 5)
  const current = currentSong && snapshot.tracks[String(currentSong.providerId || currentSong.id || '')]
  const data = { available: true, currentTrack: current ? make(current) : null, preferences: ordered.map(make) }
  return { ...data, prompt: `MUSIC MEMORY RULES: inferred behavior is not an explicit belief. Direct player evidence is stronger than provider history. Provider history proves exposure only, never completion, skip, seek, pause, duration, or exact counts. Use tentative language; if insufficient, do not invent. Context: ${JSON.stringify(data)}` }
}
