export const NETEASE_API_ERROR_CODES = Object.freeze([
  'unsupported',
  'unauthorized',
  'not_logged_in',
  'vip_required',
  'not_found',
  'network_error',
  'provider_error',
  'empty_result',
  'ambiguous',
])

export const NETEASE_STREAM_LEVELS = Object.freeze([
  'standard',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'sky',
  'jymaster',
])

const RECENT_METHODS = Object.freeze({
  song: 'record_recent_song',
  album: 'record_recent_album',
  playlist: 'record_recent_playlist',
  podcast: 'record_recent_dj',
  voice: 'record_recent_voice',
})

export class NeteaseCapabilityError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'NeteaseCapabilityError'
    this.code = NETEASE_API_ERROR_CODES.includes(code) ? code : 'provider_error'
    this.details = details
  }
}

function numberValue(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stringValue(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function providerBody(response) {
  return response?.body || response || {}
}

export function normalizeNeteaseCoverUrl(song = {}) {
  const rawUrl = song.album?.picUrl
    || song.album?.blurPicUrl
    || song.al?.picUrl
    || song.coverImgUrl
    || song.picUrl
    || song.blurPicUrl
    || ''
  const cleanUrl = stringValue(rawUrl).replace(/^http:\/\//i, 'https://')
  if (!cleanUrl) return ''
  return cleanUrl.includes('?') ? cleanUrl : `${cleanUrl}?param=240y240`
}

export function normalizeNeteaseSongRecord(song = {}) {
  const providerId = stringValue(song.providerId || song.id || song.songId).replace(/^netease-/, '')
  const title = stringValue(song.title || song.name || song.songName || song.fileName, '未知歌曲')
  const artists = list(song.ar || song.artists)
  const artist = stringValue(
    song.artist || artists.map((item) => item?.name).filter(Boolean).join(' / '),
    '未知歌手',
  )
  const album = stringValue(song.album?.name || song.al?.name || song.album)
  return {
    ...song,
    id: providerId,
    providerId,
    source: 'netease',
    title,
    name: title,
    artist,
    album,
    fileUrl: providerId ? `/api/netease/audio?id=${encodeURIComponent(providerId)}` : '',
    coverUrl: normalizeNeteaseCoverUrl(song),
    duration: numberValue(song.duration ?? song.dt),
  }
}

export function normalizeNeteasePlaylistRecord(playlist = {}) {
  return {
    id: stringValue(playlist.id),
    name: stringValue(playlist.name, '未命名歌单'),
    coverUrl: normalizeNeteaseCoverUrl(playlist),
    trackCount: numberValue(playlist.trackCount),
    playCount: numberValue(playlist.playCount),
    description: stringValue(playlist.description || playlist.copywriter),
    creator: stringValue(playlist.creator?.nickname),
    liked: numberValue(playlist.specialType) === 5 || /喜欢的音乐/.test(stringValue(playlist.name)),
    source: 'netease',
  }
}

export function normalizeNeteasePodcastRecord(podcast = {}) {
  return {
    id: stringValue(podcast.id),
    name: stringValue(podcast.name, '未命名播客'),
    coverUrl: normalizeNeteaseCoverUrl(podcast),
    description: stringValue(podcast.desc || podcast.description),
    creator: stringValue(podcast.dj?.nickname || podcast.creator?.nickname),
    programCount: numberValue(podcast.programCount),
    subscribedCount: numberValue(podcast.subCount),
    source: 'netease',
  }
}

export function normalizeNeteasePodcastProgram(program = {}) {
  const song = normalizeNeteaseSongRecord(program.mainSong || program.song || {})
  return {
    id: stringValue(program.id),
    name: stringValue(program.name, '未命名节目'),
    description: stringValue(program.description),
    coverUrl: normalizeNeteaseCoverUrl(program) || song.coverUrl,
    duration: numberValue(program.duration || song.duration),
    publishedAt: numberValue(program.createTime),
    serialNumber: numberValue(program.serialNum),
    song: song.providerId ? song : null,
    playableCandidate: Boolean(song.providerId),
    source: 'netease',
  }
}

export function normalizeNeteaseCloudRecord(item = {}) {
  const rawSong = item.simpleSong || item.song || {
    id: item.songId,
    name: item.songName || item.fileName,
    artist: item.artist,
    album: item.album,
  }
  const song = normalizeNeteaseSongRecord(rawSong)
  return {
    id: stringValue(item.songId || song.providerId),
    fileName: stringValue(item.fileName),
    fileSize: numberValue(item.fileSize),
    addedAt: numberValue(item.addTime),
    song: song.providerId ? song : null,
    playableCandidate: Boolean(song.providerId),
    source: 'netease',
  }
}

function normalizeRecentItem(item, type) {
  const raw = item?.data || item?.resource || item
  if (type === 'song') {
    const song = normalizeNeteaseSongRecord(raw?.song || raw)
    return {
      song,
      playedAt: numberValue(item?.playTime || item?.lastPlayTime),
      source: 'netease',
    }
  }
  if (type === 'podcast') {
    return {
      podcast: normalizeNeteasePodcastRecord(raw?.djRadio || raw?.radio || raw),
      playedAt: numberValue(item?.playTime || item?.lastPlayTime),
      source: 'netease',
    }
  }
  return {
    id: stringValue(raw?.id),
    name: stringValue(raw?.name),
    coverUrl: normalizeNeteaseCoverUrl(raw),
    playedAt: numberValue(item?.playTime || item?.lastPlayTime),
    type,
    source: 'netease',
  }
}

function classifyMessage(message = '') {
  const text = String(message).toLowerCase()
  if (/not.?login|need.?login|登录|cookie/.test(text)) return 'not_logged_in'
  if (/unauthor|forbidden|无权|未授权/.test(text)) return 'unauthorized'
  if (/vip|svip|会员|付费|权限不足/.test(text)) return 'vip_required'
  if (/not.?found|不存在|没有找到|暂无版权/.test(text)) return 'not_found'
  if (/timeout|timed out|fetch|network|socket|econn|enotfound|网络/.test(text)) return 'network_error'
  return 'provider_error'
}

export function normalizeNeteaseCapabilityError(error) {
  if (error instanceof NeteaseCapabilityError) return error
  const code = NETEASE_API_ERROR_CODES.includes(error?.code) ? error.code : classifyMessage(error?.message)
  return new NeteaseCapabilityError(code, error instanceof Error ? error.message : '网易云服务调用失败')
}

export function neteaseErrorHttpStatus(code) {
  if (code === 'not_logged_in' || code === 'unauthorized') return 401
  if (code === 'vip_required') return 403
  if (code === 'not_found') return 404
  if (code === 'unsupported') return 501
  if (code === 'ambiguous') return 409
  return 502
}

function safeLimit(value, fallback = 30, maximum = 200) {
  return Math.max(1, Math.min(numberValue(value, fallback), maximum))
}

function withRequestContext(query, getCookie) {
  return { ...query, cookie: getCookie(), timestamp: Date.now() }
}

export function createNeteaseCapabilityService({ api, getCookie = () => '', getLoginInfo = async () => ({ loggedIn: false }) } = {}) {
  if (!api) throw new Error('netease_api_required')

  async function requireLogin() {
    const account = await getLoginInfo()
    if (!account?.loggedIn) throw new NeteaseCapabilityError('not_logged_in', '请先登录网易云')
    return account
  }

  async function call(method, query = {}) {
    if (typeof api[method] !== 'function') {
      throw new NeteaseCapabilityError('unsupported', `NeteaseCloudMusicApi method unavailable: ${method}`)
    }
    try {
      const body = providerBody(await api[method](withRequestContext(query, getCookie)))
      const providerCode = numberValue(body.code)
      if (providerCode && providerCode !== 200) {
        const message = stringValue(body.message || body.msg, `网易云接口返回 ${providerCode}`)
        const code = providerCode === 301 ? 'not_logged_in'
          : providerCode === 401 || providerCode === 403 ? 'unauthorized'
            : classifyMessage(message)
        throw new NeteaseCapabilityError(code, message, { method, providerCode })
      }
      return body
    } catch (error) {
      const normalized = normalizeNeteaseCapabilityError(error)
      throw new NeteaseCapabilityError(normalized.code, normalized.message, {
        method,
        ...(normalized.details && typeof normalized.details === 'object' ? normalized.details : {}),
      })
    }
  }

  async function dailySongs() {
    await requireLogin()
    const body = await call('recommend_songs')
    const songs = list(body.data?.dailySongs || body.recommend).map(normalizeNeteaseSongRecord).filter((song) => song.providerId)
    return { songs, total: songs.length }
  }

  async function recommendedPlaylists() {
    await requireLogin()
    const body = await call('recommend_resource')
    const playlists = list(body.recommend || body.data).map(normalizeNeteasePlaylistRecord).filter((item) => item.id)
    return { playlists, total: playlists.length }
  }

  async function personalFm() {
    await requireLogin()
    const body = await call('personal_fm')
    const songs = list(body.data).map(normalizeNeteaseSongRecord).filter((song) => song.providerId)
    if (!songs.length) {
      throw new NeteaseCapabilityError('empty_result', '网易云私人 FM 没有返回歌曲', { method: 'personal_fm' })
    }
    return { songs, total: songs.length }
  }

  async function recent({ type = 'song', limit = 30 } = {}) {
    await requireLogin()
    const normalizedType = stringValue(type, 'song').toLowerCase()
    const method = RECENT_METHODS[normalizedType]
    if (!method) throw new NeteaseCapabilityError('unsupported', `不支持的最近播放类型: ${normalizedType}`)
    const body = await call(method, { limit: safeLimit(limit, 30, 100) })
    const rows = list(body.data?.list || body.list || body.data)
    const items = rows.map((item) => normalizeRecentItem(item, normalizedType))
    return {
      type: normalizedType,
      items,
      songs: normalizedType === 'song' ? items.map((item) => item.song).filter((song) => song?.providerId) : [],
      total: numberValue(body.data?.total ?? body.total, items.length),
    }
  }

  async function userRecord({ type = 'week', limit = 30 } = {}) {
    const account = await requireLogin()
    const normalizedType = type === 'all' || Number(type) === 0 ? 'all' : 'week'
    const body = await call('user_record', { uid: account.userId, type: normalizedType === 'week' ? 1 : 0 })
    const rows = list(normalizedType === 'week' ? body.weekData : body.allData).slice(0, safeLimit(limit, 30, 100))
    const records = rows.map((item) => ({
      song: normalizeNeteaseSongRecord(item.song || item),
      playCount: numberValue(item.playCount),
      score: numberValue(item.score),
      source: 'netease',
    })).filter((item) => item.song.providerId)
    return { type: normalizedType, records, songs: records.map((item) => item.song), total: records.length }
  }

  async function podcasts({ source = 'subscribed', limit = 30, offset = 0 } = {}) {
    const account = await requireLogin()
    const normalizedSource = source === 'created' ? 'created' : 'subscribed'
    if (normalizedSource === 'created') {
      const body = await call('user_dj', { uid: account.userId, limit: safeLimit(limit), offset: numberValue(offset) })
      const programs = list(body.programs).map(normalizeNeteasePodcastProgram).filter((item) => item.id)
      return { source: normalizedSource, podcasts: [], programs, total: numberValue(body.count, programs.length), more: Boolean(body.more) }
    }
    const body = await call('dj_sublist', { limit: safeLimit(limit), offset: numberValue(offset) })
    const rows = list(body.djRadios || body.data)
    const podcastRows = Array.isArray(body.data?.djRadios) ? body.data.djRadios : rows
    const podcastList = podcastRows.map(normalizeNeteasePodcastRecord).filter((item) => item.id)
    return { source: normalizedSource, podcasts: podcastList, programs: [], total: numberValue(body.count, podcastList.length), more: Boolean(body.hasMore || body.more) }
  }

  async function podcastPrograms({ podcastId, limit = 30, offset = 0, asc = false } = {}) {
    await requireLogin()
    const id = stringValue(podcastId)
    if (!id) throw new NeteaseCapabilityError('not_found', '缺少播客 id')
    const body = await call('dj_program', { rid: id, limit: safeLimit(limit), offset: numberValue(offset), asc })
    const programs = list(body.programs).map(normalizeNeteasePodcastProgram).filter((item) => item.id)
    return { podcastId: id, programs, total: numberValue(body.count, programs.length), more: Boolean(body.more) }
  }

  async function cloud({ limit = 30, offset = 0 } = {}) {
    await requireLogin()
    const body = await call('user_cloud', { limit: safeLimit(limit, 30, 200), offset: numberValue(offset) })
    const items = list(body.data).map(normalizeNeteaseCloudRecord).filter((item) => item.id)
    return { items, songs: items.map((item) => item.song).filter(Boolean), total: numberValue(body.count, items.length), more: Boolean(body.hasMore) }
  }

  async function searchSuggest({ keywords, type = 'web' } = {}) {
    const query = stringValue(keywords)
    if (!query) throw new NeteaseCapabilityError('not_found', '缺少搜索关键词')
    const body = await call('search_suggest', { keywords: query, type: type === 'mobile' ? 'mobile' : 'web' })
    const result = body.result || {}
    return {
      query,
      order: list(result.order),
      songs: list(result.songs).map(normalizeNeteaseSongRecord).filter((song) => song.providerId),
      albums: list(result.albums).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name), artist: stringValue(item.artist?.name), coverUrl: normalizeNeteaseCoverUrl(item) })),
      artists: list(result.artists).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name), coverUrl: normalizeNeteaseCoverUrl(item) })),
      playlists: list(result.playlists).map(normalizeNeteasePlaylistRecord).filter((item) => item.id),
    }
  }

  async function songDetails({ ids } = {}) {
    const normalizedIds = list(Array.isArray(ids) ? ids : String(ids || '').split(','))
      .map((id) => stringValue(id).replace(/^netease-/, ''))
      .filter(Boolean)
      .slice(0, 1000)
    if (!normalizedIds.length) throw new NeteaseCapabilityError('not_found', '缺少歌曲 id')
    const body = await call('song_detail', { ids: normalizedIds.join(',') })
    const songs = list(body.songs).map(normalizeNeteaseSongRecord).filter((song) => song.providerId)
    return { songs, total: songs.length }
  }

  async function checkPlayable({ id, br = 999000 } = {}) {
    const providerId = stringValue(id).replace(/^netease-/, '')
    if (!providerId) throw new NeteaseCapabilityError('not_found', '缺少歌曲 id')
    const body = await call('check_music', { id: providerId, br: numberValue(br, 999000) })
    return { providerId, playable: body.success === true, message: stringValue(body.message) }
  }

  async function resolveStream({ id, level = 'exhigh' } = {}) {
    const providerId = stringValue(id).replace(/^netease-/, '')
    if (!providerId) throw new NeteaseCapabilityError('not_found', '缺少歌曲 id')
    if (!NETEASE_STREAM_LEVELS.includes(level)) {
      throw new NeteaseCapabilityError('unsupported', `不支持的取流品质: ${level}`, { supportedLevels: NETEASE_STREAM_LEVELS })
    }
    const body = await call('song_url_v1', { id: providerId, level })
    const stream = list(body.data)[0] || {}
    if (!stream.url) {
      const code = stream.fee > 0 || /vip|会员|付费/i.test(stringValue(stream.message)) ? 'vip_required' : 'not_found'
      throw new NeteaseCapabilityError(code, stringValue(stream.message, `网易云未返回 ${level} 音质地址`), { providerCode: stream.code })
    }
    return {
      providerId,
      requestedLevel: level,
      level: stringValue(stream.level, level),
      encodeType: stringValue(stream.encodeType || stream.type),
      size: numberValue(stream.size),
      time: numberValue(stream.time),
      fileUrl: `/api/netease/audio?id=${encodeURIComponent(providerId)}&level=${encodeURIComponent(level)}`,
    }
  }

  async function likedStatus({ ids } = {}) {
    const account = await requireLogin()
    const requested = list(Array.isArray(ids) ? ids : String(ids || '').split(','))
      .map((id) => stringValue(id).replace(/^netease-/, ''))
      .filter(Boolean)
    const body = await call('likelist', { uid: account.userId })
    const likedIds = new Set(list(body.ids).map(String))
    return { statuses: requested.map((providerId) => ({ providerId, liked: likedIds.has(providerId) })), likedCount: likedIds.size }
  }

  async function subscriptionCounts() {
    await requireLogin()
    const body = await call('user_subcount')
    return {
      artists: numberValue(body.artistCount),
      albums: numberValue(body.newAlbumCount ?? body.albumCount),
      playlists: numberValue(body.createdPlaylistCount) + numberValue(body.subPlaylistCount),
      createdPlaylists: numberValue(body.createdPlaylistCount),
      subscribedPlaylists: numberValue(body.subPlaylistCount),
      podcasts: numberValue(body.djRadioCount),
    }
  }

  async function subscribedAlbums({ limit = 25, offset = 0 } = {}) {
    await requireLogin()
    const body = await call('album_sublist', { limit: safeLimit(limit), offset: numberValue(offset) })
    const albums = list(body.data).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name), artist: stringValue(item.artist?.name), coverUrl: normalizeNeteaseCoverUrl(item), size: numberValue(item.size) })).filter((item) => item.id)
    return { albums, total: numberValue(body.count, albums.length), more: Boolean(body.hasMore) }
  }

  async function subscribedArtists({ limit = 25, offset = 0 } = {}) {
    await requireLogin()
    const body = await call('artist_sublist', { limit: safeLimit(limit), offset: numberValue(offset) })
    const artists = list(body.data).map((item) => ({ id: stringValue(item.id), name: stringValue(item.name), coverUrl: normalizeNeteaseCoverUrl(item), albumCount: numberValue(item.albumSize), songCount: numberValue(item.musicSize) })).filter((item) => item.id)
    return { artists, total: numberValue(body.count, artists.length), more: Boolean(body.hasMore) }
  }

  async function membership() {
    const account = await requireLogin()
    const body = await call('vip_info_v2', { uid: account.userId })
    const data = body.data || body
    return {
      userId: stringValue(account.userId),
      redVipLevel: numberValue(data.redVipLevel),
      redVipAnnualCount: numberValue(data.redVipAnnualCount),
      musicPackage: data.musicPackage || null,
      associator: data.associator || null,
    }
  }

  async function playlistDetail({ id } = {}) {
    const playlistId = stringValue(id)
    if (!playlistId) throw new NeteaseCapabilityError('not_found', '缺少歌单 id')
    const body = await call('playlist_detail', { id: playlistId, s: 8 })
    const playlist = body.playlist || {}
    const songs = list(playlist.tracks).map(normalizeNeteaseSongRecord).filter((song) => song.providerId)
    return { playlist: normalizeNeteasePlaylistRecord(playlist), songs, trackIds: list(playlist.trackIds).map((item) => stringValue(item?.id)).filter(Boolean) }
  }

  async function stateSummary() {
    const account = await getLoginInfo()
    if (!account?.loggedIn) {
      return {
        account: { loggedIn: false, membership: null },
        library: { playlistsCount: null, recentCount: null, cloudCount: null, podcastCount: null, likedCount: null, subscriptionCounts: null },
        recommendation: { dailySongs: false, dailyPlaylists: false, personalFm: false },
      }
    }
    const settled = await Promise.allSettled([
      membership(),
      subscriptionCounts(),
      recent({ limit: 1 }),
      cloud({ limit: 1 }),
      podcasts({ limit: 1 }),
      likedStatus({ ids: [] }),
    ])
    const value = (index) => settled[index].status === 'fulfilled' ? settled[index].value : null
    const counts = value(1)
    return {
      account: { loggedIn: true, membership: value(0) },
      library: {
        playlistsCount: counts?.playlists ?? null,
        recentCount: value(2)?.total ?? null,
        cloudCount: value(3)?.total ?? null,
        podcastCount: value(4)?.total ?? null,
        likedCount: value(5)?.likedCount ?? null,
        subscriptionCounts: counts,
      },
      recommendation: { dailySongs: true, dailyPlaylists: true, personalFm: true },
    }
  }

  return {
    dailySongs,
    recommendedPlaylists,
    personalFm,
    recent,
    userRecord,
    podcasts,
    podcastPrograms,
    cloud,
    searchSuggest,
    songDetails,
    checkPlayable,
    resolveStream,
    likedStatus,
    subscriptionCounts,
    subscribedAlbums,
    subscribedArtists,
    membership,
    playlistDetail,
    stateSummary,
  }
}
