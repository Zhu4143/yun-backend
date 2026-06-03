const YUN_API_BASE_URL = 'http://localhost:3000'

function normalizeSong(song) {
  const coverPath = song.coverPath || ''

  return {
    ...song,
    title: song.title || song.filename || 'Unknown track',
    artist: song.artist || 'Unknown artist',
    coverUrl: coverPath.startsWith('http')
      ? coverPath
      : coverPath
        ? `${YUN_API_BASE_URL}${coverPath}`
        : '',
  }
}

export async function fetchMusicLibrary() {
  const response = await fetch('/api/music/scan', {
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
