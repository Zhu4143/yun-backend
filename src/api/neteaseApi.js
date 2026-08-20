export function normalizeNeteaseSong(song) {
  const providerId = String(song.providerId || song.id || '').replace(/^netease-/, '').trim()
  const title = song.title || song.name || 'Unknown track'
  const artist = song.artist || 'Unknown artist'
  const rawCoverUrl = String(song.coverUrl || '').trim()
  // NetEase's image CDN can be rendered by an <img>, but it does not
  // consistently permit canvas/WebGL reads. Route it through our same-origin
  // proxy so the particle record and palette sampler receive usable pixels.
  // A CSS background can display some NetEase image hosts directly, while a
  // WebGL texture cannot safely read the same image without CORS approval.
  // Route every remote NetEase cover through our same-origin proxy so the
  // small player cover and the particle record always use identical pixels.
  const coverUrl = /^https?:\/\//i.test(rawCoverUrl)
    ? `/api/netease/cover?url=${encodeURIComponent(rawCoverUrl)}`
    : rawCoverUrl

  return {
    ...song,
    id: `netease-${providerId}`,
    providerId,
    source: 'netease',
    title,
    name: title,
    artist,
    album: song.album || '',
    fileUrl: `/api/netease/audio?id=${encodeURIComponent(providerId)}`,
    coverUrl,
    moodTags: ['online'],
    sceneTags: ['netease'],
    energy: 50,
    memoryWeight: 40,
  }
}

export async function searchNeteaseSongs(keywords, { limit = 12 } = {}) {
  const query = String(keywords || '').trim()
  if (!query) {
    return []
  }

  const response = await fetch(`/api/netease/search?keywords=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || '网易云搜索失败')
  }

  return (Array.isArray(data.songs) ? data.songs : [])
    .map(normalizeNeteaseSong)
    .filter((song) => song.providerId)
}

export async function resolveNeteaseSongCandidate({ transcript, interpretation, candidates }) {
  const response = await fetch('/api/netease/resolve-voice-song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: String(transcript || '').trim(),
      interpretation: String(interpretation || '').trim(),
      candidates: (Array.isArray(candidates) ? candidates : []).slice(0, 8).map((song, index) => ({
        index,
        providerId: String(song.providerId || '').trim(),
        title: String(song.title || '').trim(),
        artist: String(song.artist || '').trim(),
        album: String(song.album || '').trim(),
      })),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '歌曲候选理解失败')
  return String(data.providerId || '').trim()
}

export async function resolveNeteaseSongFromLyrics(lyrics) {
  const response = await fetch('/api/netease/resolve-lyric-song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyrics: String(lyrics || '').trim() }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '歌词识曲失败')
  return {
    ...data,
    song: data.song ? normalizeNeteaseSong(data.song) : null,
    candidates: (Array.isArray(data.candidates) ? data.candidates : []).map(normalizeNeteaseSong),
  }
}

export async function fetchNeteaseLyrics(songId) {
  const providerId = String(songId || '').replace(/^netease-/, '')
  if (!providerId) {
    return { lines: [] }
  }

  const response = await fetch(`/api/netease/lyric?id=${encodeURIComponent(providerId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.ok === false) {
    return { lines: [] }
  }

  return {
    ...data.lyrics,
    lines: Array.isArray(data.lyrics?.lines) ? data.lyrics.lines : [],
  }
}

export async function fetchNeteaseMe() {
  const response = await fetch('/api/netease/me', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '网易云账户信息读取失败')
  return data
}

export async function fetchNeteasePlaylistTracks(playlistId) {
  const response = await fetch(`/api/netease/playlist/tracks?id=${encodeURIComponent(playlistId)}`, { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '网易云歌单读取失败')
  return (Array.isArray(data.songs) ? data.songs : []).map(normalizeNeteaseSong).filter((song) => song.providerId)
}

export async function addSongToNeteaseCollection({ song, target = 'liked', playlistId = '', playlistName = '' } = {}) {
  const response = await fetch('/api/netease/collection/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song, target, playlistId, playlistName }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || '添加到网易云失败')
    error.code = data.code || ''
    throw error
  }
  return data
}

export async function fetchNeteaseArtistSongs(artist, { limit = 2000 } = {}) {
  const name = String(artist || '').trim()
  if (!name) return { artist: null, total: 0, playableCount: 0, songs: [] }
  const response = await fetch(`/api/netease/artist/songs?artist=${encodeURIComponent(name)}&limit=${encodeURIComponent(limit)}`, {
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '网易云歌手曲库读取失败')
  const songs = (Array.isArray(data.songs) ? data.songs : [])
    .map(normalizeNeteaseSong)
    .filter((song) => song.providerId)
  return {
    artist: data.artist || { name },
    total: Number(data.total || songs.length),
    playableCount: Number(data.playableCount || songs.length),
    songs,
  }
}

export async function fetchNeteaseAiRecommendations({
  currentSong = null,
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
  limit = 8,
} = {}) {
  const response = await fetch('/api/netease/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentSong,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
      limit,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '网易云 AI 推荐失败')
  return (Array.isArray(data.songs) ? data.songs : [])
    .map(normalizeNeteaseSong)
    .filter((song) => song.providerId)
}
