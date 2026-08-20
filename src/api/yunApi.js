function normalizeSong(song) {
  const coverPath = song.coverPath || ''

  return {
    ...song,
    title: song.title || song.filename || 'Unknown track',
    artist: song.artist || 'Unknown artist',
    coverUrl: coverPath,
  }
}

export async function fetchMusicLibrary() {
  const response = await fetch('/api/music/library', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to fetch music library')
  }

  const songs = Array.isArray(data.library?.songs) ? data.library.songs : []

  return {
    ...data.library,
    songs: songs.map(normalizeSong),
    count: data.library?.count ?? songs.length,
  }
}

export async function scanMusicLibrary() {
  const response = await fetch('/api/music/scan', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to scan music library')
  }

  const songs = Array.isArray(data.library?.songs) ? data.library.songs : []

  return {
    ...data.library,
    songs: songs.map(normalizeSong),
    count: data.library?.count ?? songs.length,
  }
}

export async function importMusicFiles(files) {
  const selected = Array.from(files || [])
  for (const file of selected) {
    const response = await fetch(`/api/music/import?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.error || `导入 ${file.name} 失败`)
  }
  return scanMusicLibrary()
}

export async function analyzeMusicLibraryTags({ limit = 80 } = {}) {
  const response = await fetch(`/api/music/analyze-tags?limit=${encodeURIComponent(limit)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'AI 曲库理解失败')
  }

  const songs = Array.isArray(data.library?.songs) ? data.library.songs : []

  return {
    analyzed: data.analyzed || 0,
    remaining: data.remaining || 0,
    library: {
      ...data.library,
      songs: songs.map(normalizeSong),
      count: data.library?.count ?? songs.length,
    },
  }
}

export async function fetchSongLyrics(songId) {
  if (!songId) {
    return { lines: [] }
  }

  const response = await fetch(`/api/music/lyrics/${encodeURIComponent(songId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data.ok) {
    return { lines: [] }
  }

  return {
    ...data.lyrics,
    lines: Array.isArray(data.lyrics?.lines) ? data.lyrics.lines : [],
  }
}
