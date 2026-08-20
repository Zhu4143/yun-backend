import { normalizeNeteaseSong } from './neteaseApi'

export async function requestRadioPrefetch({
  currentSong = null,
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
  playbackMode = 'ai_recommend',
} = {}) {
  const response = await fetch('/api/radio-prefetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentSong,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
      playbackMode,
    }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.error || '下一首预取失败')
  }

  const normalizeSuggestion = (suggested) => {
    if (!suggested) return null
    const rawId = String(suggested.providerId || suggested.id || '')
    return suggested.source === 'netease' || rawId.startsWith('netease-')
      ? normalizeNeteaseSong(suggested)
      : suggested
  }
  const playbackPlan = data.playbackPlan
    ? {
      ...data.playbackPlan,
      track: normalizeSuggestion(data.playbackPlan.track),
      candidates: (Array.isArray(data.playbackPlan.candidates) ? data.playbackPlan.candidates : [])
        .map(normalizeSuggestion)
        .filter(Boolean),
    }
    : null
  if (playbackPlan?.transitionPlan && playbackPlan.track) {
    playbackPlan.track.transitionPlan = playbackPlan.transitionPlan
    playbackPlan.candidates = playbackPlan.candidates.map((song) => (
      String(song.providerId || song.id || '') === String(playbackPlan.transitionPlan.selectedTrackId || '')
        ? { ...song, transitionPlan: playbackPlan.transitionPlan }
        : song
    ))
  }
  return {
    ...data,
    candidates: (Array.isArray(data.candidates) ? data.candidates : []).map((candidate) => ({
      ...candidate,
      song: normalizeSuggestion(candidate?.song),
    })),
    playbackPlan,
  }
}
