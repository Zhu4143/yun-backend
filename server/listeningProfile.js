const DAY_PARTS = [
  ['深夜', 0, 5], ['清晨', 5, 9], ['上午', 9, 12], ['午后', 12, 18], ['夜晚', 18, 24],
]

export function dayPartFor(date = new Date()) {
  const hour = date.getHours()
  return DAY_PARTS.find(([, start, end]) => hour >= start && hour < end)?.[0] || '夜晚'
}

export function createListeningProfile() {
  return { version: 1, enabled: true, updatedAt: null, neteaseSyncedAt: null, plays: [], favorites: {}, byDayPart: {} }
}

function keyOf(song = {}) {
  return String(song.providerId || song.id || `${song.title || song.name || ''}-${song.artist || ''}`).replace(/^netease-/, '').trim()
}

function compactSong(song = {}) {
  const artists = Array.isArray(song.ar) ? song.ar : Array.isArray(song.artists) ? song.artists : []
  const artist = song.artist || artists.map((item) => item?.name).filter(Boolean).join(' / ') || '未知歌手'
  return { id: keyOf(song), title: song.title || song.name || '未知歌曲', artist, source: song.source || 'netease', moodTags: Array.isArray(song.moodTags) ? song.moodTags.slice(0, 4) : [], sceneTags: Array.isArray(song.sceneTags) ? song.sceneTags.slice(0, 4) : [] }
}

export function recordListeningEvent(profile, song, { playedAt = Date.now(), weight = 1, source = 'yun' } = {}) {
  const next = profile && typeof profile === 'object' ? profile : createListeningProfile()
  if (next.enabled === false || !keyOf(song)) return next
  const at = new Date(playedAt)
  const entry = { ...compactSong(song), playedAt: at.getTime(), dayPart: dayPartFor(at), weight: Math.max(0.1, Number(weight) || 1), source }
  next.plays = [entry, ...(Array.isArray(next.plays) ? next.plays : [])].slice(0, 1200)
  next.updatedAt = new Date().toISOString()
  return next
}

export function importNeteaseHistory(profile, { recent = [], weekly = [], all = [] } = {}) {
  const next = profile && typeof profile === 'object' ? profile : createListeningProfile()
  const existing = new Set((next.plays || []).map((item) => `${item.id}:${item.playedAt || 0}`))
  for (const item of recent) {
    const song = item?.data || item?.song || item
    const playedAt = Number(item?.playTime || item?.time || item?.playedAt || 0)
    if (!keyOf(song) || !playedAt || existing.has(`${keyOf(song)}:${playedAt}`)) continue
    recordListeningEvent(next, song, { playedAt, source: 'netease_recent' })
  }
  for (const item of [...weekly, ...all]) {
    const song = item?.song || item
    const id = keyOf(song)
    if (!id) continue
    next.favorites[id] = Math.max(Number(next.favorites[id] || 0), Number(item?.playCount || item?.score || 0))
  }
  next.neteaseSyncedAt = new Date().toISOString()
  return next
}

export function summarizeListeningProfile(profile, now = new Date()) {
  const plays = Array.isArray(profile?.plays) ? profile.plays : []
  const dayPart = dayPartFor(now)
  const artistScores = new Map()
  const tagScores = new Map()
  for (const play of plays) {
    const decay = Math.max(0.25, 1 - Math.max(0, now.getTime() - Number(play.playedAt || now.getTime())) / (1000 * 60 * 60 * 24 * 90))
    const score = (Number(play.weight) || 1) * decay * (play.dayPart === dayPart ? 1.8 : 1)
    artistScores.set(play.artist, (artistScores.get(play.artist) || 0) + score)
    for (const tag of [...(play.moodTags || []), ...(play.sceneTags || [])]) tagScores.set(tag, (tagScores.get(tag) || 0) + score)
  }
  return { enabled: profile?.enabled !== false, dayPart, syncedAt: profile?.neteaseSyncedAt || null, playCount: plays.length, favoriteArtists: [...artistScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name), favoriteTags: [...tagScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name) }
}

export function scoreSongForListeningProfile(song, profile, now = new Date()) {
  if (profile?.enabled === false) return 0
  const summary = summarizeListeningProfile(profile, now)
  const id = keyOf(song)
  let score = Math.min(36, Number(profile?.favorites?.[id] || 0) * 0.8)
  if (summary.favoriteArtists.includes(song.artist)) score += 24
  const tags = new Set([...(song.moodTags || []), ...(song.sceneTags || [])])
  score += summary.favoriteTags.reduce((total, tag) => total + (tags.has(tag) ? 8 : 0), 0)
  return score
}
