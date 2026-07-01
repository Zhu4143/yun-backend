function normalizeNeteaseSong(song) {
  const providerId = String(song.id || song.providerId || '').trim()
  const title = song.title || song.name || 'Unknown track'
  const artist = song.artist || 'Unknown artist'

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
    coverUrl: song.coverUrl || '',
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
