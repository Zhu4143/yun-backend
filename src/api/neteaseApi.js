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
    fileUrl: song.fileUrl || `/api/netease/audio?id=${encodeURIComponent(providerId)}`,
    coverUrl,
    duration: Number(song.duration) || 0,
    moodTags: ['online'],
    sceneTags: ['netease'],
    energy: 50,
    memoryWeight: 40,
  }
}

export function normalizeNeteaseSongs(songs) {
  return (Array.isArray(songs) ? songs : [])
    .map(normalizeNeteaseSong)
    .filter((song) => song.providerId)
}

export class NeteaseApiError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'NeteaseApiError'
    this.code = code || 'provider_error'
    this.details = details
  }
}

async function requestNeteaseJson(path, options = {}, fallbackMessage = '网易云服务调用失败') {
  let response
  try {
    response = await fetch(path, options)
  } catch (error) {
    throw new NeteaseApiError('network_error', error instanceof Error ? error.message : fallbackMessage)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    throw new NeteaseApiError(data.code || (response.status === 401 ? 'not_logged_in' : 'provider_error'), data.error || fallbackMessage, data.details)
  }
  return data
}

function queryString(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  return query.toString()
}

export async function searchNeteaseSongs(keywords, { limit = 12 } = {}) {
  const query = String(keywords || '').trim()
  if (!query) {
    return []
  }

  const data = await requestNeteaseJson(`/api/netease/search?keywords=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  }, '网易云搜索失败')

  return normalizeNeteaseSongs(data.songs)
}

export async function resolveNeteaseSongCandidate({ transcript, interpretation, candidates }) {
  const data = await requestNeteaseJson('/api/netease/resolve-voice-song', {
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
  }, '歌曲候选理解失败')
  return String(data.providerId || '').trim()
}

export async function resolveNeteaseSongFromLyrics(lyrics) {
  const data = await requestNeteaseJson('/api/netease/resolve-lyric-song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyrics: String(lyrics || '').trim() }),
  }, '歌词识曲失败')
  return {
    ...data,
    song: data.song ? normalizeNeteaseSong(data.song) : null,
    candidates: normalizeNeteaseSongs(data.candidates),
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
  return normalizeNeteaseSongs(data.songs)
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
  const songs = normalizeNeteaseSongs(data.songs)
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
  const data = await requestNeteaseJson('/api/netease/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentSong,
      playHistory: playHistory.slice(-10),
      rejectedTracks: rejectedTracks.slice(-10),
      recentRecommendations: recentRecommendations.slice(-10),
      limit,
    }),
  }, '网易云 AI 推荐失败')
  return normalizeNeteaseSongs(data.songs)
}

export async function fetchNeteaseSongComments(songId, { limit = 3 } = {}) {
  const providerId = String(songId || '').replace(/^netease-/, '').trim()
  if (!providerId) throw new Error('当前没有可读取评论的网易云歌曲')
  const response = await fetch(`/api/netease/comments?id=${encodeURIComponent(providerId)}&limit=${encodeURIComponent(Math.max(1, Math.min(12, limit)))}`, { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '网易云评论读取失败')
  return Array.isArray(data.comments) ? data.comments : []
}

export async function fetchNeteaseDailySongs() {
  const data = await requestNeteaseJson('/api/netease/recommend/daily-songs', { cache: 'no-store' }, '网易云每日推荐读取失败')
  return normalizeNeteaseSongs(data.songs)
}

export async function fetchNeteaseRecommendedPlaylists() {
  const data = await requestNeteaseJson('/api/netease/recommend/playlists', { cache: 'no-store' }, '网易云推荐歌单读取失败')
  return Array.isArray(data.playlists) ? data.playlists : []
}

export async function fetchNeteasePersonalFm() {
  const data = await requestNeteaseJson('/api/netease/recommend/personal-fm', { cache: 'no-store' }, '网易云私人 FM 读取失败')
  const songs = normalizeNeteaseSongs(data.songs)
  if (!songs.length) throw new NeteaseApiError('empty_result', '网易云私人 FM 没有返回歌曲', data.details)
  return songs
}

export async function fetchNeteaseRecentHistory({ type = 'song', limit = 30 } = {}) {
  const data = await requestNeteaseJson(`/api/netease/history/recent?${queryString({ type, limit })}`, { cache: 'no-store' }, '网易云最近播放读取失败')
  return {
    ...data,
    songs: normalizeNeteaseSongs(data.songs),
    items: (Array.isArray(data.items) ? data.items : []).map((item) => item?.song ? { ...item, song: normalizeNeteaseSong(item.song) } : item),
  }
}

export async function fetchNeteaseUserRecord({ type = 'week', limit = 30 } = {}) {
  const data = await requestNeteaseJson(`/api/netease/history/user-record?${queryString({ type, limit })}`, { cache: 'no-store' }, '网易云听歌排行读取失败')
  return {
    ...data,
    songs: normalizeNeteaseSongs(data.songs),
    records: (Array.isArray(data.records) ? data.records : []).map((item) => ({ ...item, song: normalizeNeteaseSong(item.song || {}) })).filter((item) => item.song.providerId),
  }
}

export async function fetchNeteasePodcasts({ source = 'subscribed', limit = 30, offset = 0 } = {}) {
  return requestNeteaseJson(`/api/netease/podcasts?${queryString({ source, limit, offset })}`, { cache: 'no-store' }, '网易云播客读取失败')
}

export async function fetchNeteasePodcastPrograms(podcastId, { limit = 30, offset = 0, asc = false } = {}) {
  const data = await requestNeteaseJson(`/api/netease/podcast/programs?${queryString({ id: podcastId, limit, offset, asc })}`, { cache: 'no-store' }, '网易云播客节目读取失败')
  return {
    ...data,
    programs: (Array.isArray(data.programs) ? data.programs : []).map((program) => ({
      ...program,
      song: program.song ? normalizeNeteaseSong(program.song) : null,
    })),
  }
}

export async function fetchNeteaseCloud({ limit = 30, offset = 0 } = {}) {
  const data = await requestNeteaseJson(`/api/netease/cloud?${queryString({ limit, offset })}`, { cache: 'no-store' }, '网易云音乐云盘读取失败')
  return {
    ...data,
    songs: normalizeNeteaseSongs(data.songs),
    items: (Array.isArray(data.items) ? data.items : []).map((item) => ({ ...item, song: item.song ? normalizeNeteaseSong(item.song) : null })),
  }
}

export async function fetchNeteaseSearchSuggestions(keywords, { type = 'web' } = {}) {
  const data = await requestNeteaseJson(`/api/netease/search/suggest?${queryString({ keywords, type })}`, { cache: 'no-store' }, '网易云搜索建议读取失败')
  return { ...data, songs: normalizeNeteaseSongs(data.songs) }
}

export async function fetchNeteaseSongDetails(ids) {
  const value = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || '').replace(/^netease-/, '')).filter(Boolean).join(',')
  const data = await requestNeteaseJson(`/api/netease/song/detail?${queryString({ ids: value })}`, { cache: 'no-store' }, '网易云歌曲详情读取失败')
  return normalizeNeteaseSongs(data.songs)
}

export async function checkNeteaseSongPlayable(songId, { br = 999000 } = {}) {
  const id = String(songId || '').replace(/^netease-/, '')
  return requestNeteaseJson(`/api/netease/song/playability?${queryString({ id, br })}`, { cache: 'no-store' }, '网易云歌曲可播放性检查失败')
}

export async function resolveNeteaseStreamQuality(song, level = 'exhigh') {
  if (!song?.providerId && song?.source !== 'netease' && !String(song?.id || '').startsWith('netease-')) {
    throw new NeteaseApiError('unsupported', '当前歌曲不是网易云资源，不能使用 song_url_v1 切换取流品质')
  }
  const normalizedSong = normalizeNeteaseSong(song || {})
  const data = await requestNeteaseJson(`/api/netease/song/stream?${queryString({ id: normalizedSong.providerId, level })}`, { cache: 'no-store' }, '网易云指定音质取流失败')
  return {
    ...normalizedSong,
    fileUrl: data.fileUrl,
    streamLevel: data.level,
    requestedStreamLevel: data.requestedLevel,
    streamEncodeType: data.encodeType,
  }
}

export async function fetchNeteaseLikedStatus(ids) {
  const value = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || '').replace(/^netease-/, '')).filter(Boolean).join(',')
  return requestNeteaseJson(`/api/netease/library/liked-status?${queryString({ ids: value })}`, { cache: 'no-store' }, '网易云喜欢状态读取失败')
}

export async function fetchNeteaseSubscriptionCounts() {
  return requestNeteaseJson('/api/netease/library/subscription-counts', { cache: 'no-store' }, '网易云收藏计数读取失败')
}

export async function fetchNeteaseSubscribedAlbums({ limit = 25, offset = 0 } = {}) {
  return requestNeteaseJson(`/api/netease/library/subscribed-albums?${queryString({ limit, offset })}`, { cache: 'no-store' }, '网易云收藏专辑读取失败')
}

export async function fetchNeteaseSubscribedArtists({ limit = 25, offset = 0 } = {}) {
  return requestNeteaseJson(`/api/netease/library/subscribed-artists?${queryString({ limit, offset })}`, { cache: 'no-store' }, '网易云收藏歌手读取失败')
}

export async function fetchNeteaseMembership() {
  return requestNeteaseJson('/api/netease/account/membership', { cache: 'no-store' }, '网易云会员信息读取失败')
}

export async function fetchNeteasePlaylistDetail(playlistId) {
  const data = await requestNeteaseJson(`/api/netease/playlist/detail?${queryString({ id: playlistId })}`, { cache: 'no-store' }, '网易云歌单详情读取失败')
  return { ...data, songs: normalizeNeteaseSongs(data.songs) }
}

export async function fetchNeteaseStateSummary() {
  return requestNeteaseJson('/api/netease/state-summary', { cache: 'no-store' }, '网易云状态摘要读取失败')
}
