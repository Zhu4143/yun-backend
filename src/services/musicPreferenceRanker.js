export const MIN_MEMORY_ADJUSTMENT = -8
export const MAX_MEMORY_ADJUSTMENT = 6
export const NEGATIVE_MIN_DIRECT_PLAYS = 3
export const NEGATIVE_SKIP_RATE = 0.66
function key(song) { return String(song?.providerId || song?.id || song?.title || '') }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)) }

// Memory only adjusts an already acceptable candidate set. Direct negative
// behavior wins over artist/provider exposure; no evidence is mutated here.
export function rankWithMusicPreferences({ candidates = [], currentSong, preferenceSnapshot } = {}) {
  const tracks = preferenceSnapshot?.tracks || {}; const artists = preferenceSnapshot?.artists || {}
  return [...candidates].filter((song) => key(song) !== key(currentSong)).map((song, index) => {
    const track = tracks[key(song)]; const artist = artists[song.artist || '']; const direct = track?.directListening
    const confidence = track?.derived?.confidence || 'low'; const factor = confidence === 'high' ? 1 : confidence === 'medium' ? 0.35 : 0.1
    const negative = direct?.playCount >= NEGATIVE_MIN_DIRECT_PLAYS && (track?.derived?.skipRate || 0) >= NEGATIVE_SKIP_RATE
    const trackScore = (track?.derived?.recentAffinity || 0) * 1.2 + (track?.derived?.longTermAffinity || 0) * 0.35
    const artistScore = negative ? 0 : (artist?.longTermAffinity || 0) * 0.08
    const adjustment = clamp((negative ? MIN_MEMORY_ADJUSTMENT : trackScore + artistScore) * factor, MIN_MEMORY_ADJUSTMENT, MAX_MEMORY_ADJUSTMENT)
    const baseScore = Number.isFinite(song?.baseScore) ? song.baseScore : -index
    return { song, baseScore, adjustment, finalScore: baseScore + adjustment, memory: { confidence, trackAffinity: track?.derived?.longTermAffinity || 0, artistAffinity: artist?.longTermAffinity || 0, skipPenalty: negative ? MIN_MEMORY_ADJUSTMENT : 0 } }
  }).sort((a, b) => b.finalScore - a.finalScore || key(a.song).localeCompare(key(b.song))).map((item) => ({ ...item.song, recommendationMemory: { baseScore: item.baseScore, memoryAdjustment: item.adjustment, finalScore: item.finalScore, ...item.memory } }))
}
