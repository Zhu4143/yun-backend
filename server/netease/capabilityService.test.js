import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createNeteaseCapabilityService,
  NETEASE_STREAM_LEVELS,
  NeteaseCapabilityError,
  normalizeNeteaseSongRecord,
} from './capabilityService.js'

const rawSong = {
  id: 123,
  name: '真实歌曲',
  ar: [{ name: '真实歌手' }],
  al: { name: '真实专辑', picUrl: 'http://img.example/cover.jpg' },
  dt: 245000,
}

function response(body) {
  return { body }
}

function createFixtureService(overrides = {}, { loggedIn = true } = {}) {
  const calls = []
  const api = new Proxy({
    recommend_songs: async (query) => { calls.push(['recommend_songs', query]); return response({ data: { dailySongs: [rawSong] } }) },
    recommend_resource: async (query) => { calls.push(['recommend_resource', query]); return response({ recommend: [{ id: 9, name: '每日歌单', picUrl: 'https://img.example/list.jpg', trackCount: 20 }] }) },
    personal_fm: async (query) => { calls.push(['personal_fm', query]); return response({ data: [rawSong] }) },
    record_recent_song: async (query) => { calls.push(['record_recent_song', query]); return response({ data: { list: [{ data: rawSong, playTime: 1000 }], total: 7 } }) },
    record_recent_album: async () => response({ data: { list: [{ data: { id: 3, name: '专辑' } }] } }),
    record_recent_playlist: async () => response({ data: { list: [{ data: { id: 4, name: '歌单' } }] } }),
    record_recent_dj: async () => response({ data: { list: [{ data: { id: 5, name: '播客' } }] } }),
    record_recent_voice: async () => response({ data: { list: [{ data: { id: 6, name: '声音' } }] } }),
    user_record: async (query) => { calls.push(['user_record', query]); return response({ weekData: [{ song: rawSong, playCount: 8, score: 99 }], allData: [] }) },
    dj_sublist: async (query) => { calls.push(['dj_sublist', query]); return response({ djRadios: [{ id: 21, name: '订阅播客', picUrl: 'https://img.example/dj.jpg', programCount: 3 }], count: 1 }) },
    user_dj: async (query) => { calls.push(['user_dj', query]); return response({ programs: [{ id: 31, name: '我创建的节目', mainSong: rawSong }], count: 1 }) },
    dj_program: async (query) => { calls.push(['dj_program', query]); return response({ programs: [{ id: 32, name: '一期节目', mainSong: rawSong }], count: 1 }) },
    user_cloud: async (query) => { calls.push(['user_cloud', query]); return response({ data: [{ songId: 123, fileName: '真实歌曲.flac', simpleSong: rawSong }], count: 1 }) },
    search_suggest: async (query) => { calls.push(['search_suggest', query]); return response({ result: { order: ['songs'], songs: [rawSong], artists: [{ id: 8, name: '真实歌手' }] } }) },
    song_detail: async (query) => { calls.push(['song_detail', query]); return response({ songs: [rawSong] }) },
    check_music: async (query) => { calls.push(['check_music', query]); return response({ success: true, message: 'ok' }) },
    song_url_v1: async (query) => { calls.push(['song_url_v1', query]); return response({ data: [{ id: 123, url: 'https://audio.example/song.flac', level: query.level, encodeType: 'flac' }] }) },
    likelist: async (query) => { calls.push(['likelist', query]); return response({ ids: [123, 456] }) },
    user_subcount: async () => response({ artistCount: 2, newAlbumCount: 3, createdPlaylistCount: 4, subPlaylistCount: 5, djRadioCount: 6 }),
    album_sublist: async () => response({ data: [{ id: 71, name: '收藏专辑', artist: { name: '歌手' }, picUrl: 'https://img.example/a.jpg' }], count: 1 }),
    artist_sublist: async () => response({ data: [{ id: 81, name: '收藏歌手', picUrl: 'https://img.example/b.jpg', musicSize: 10 }], count: 1 }),
    vip_info_v2: async (query) => { calls.push(['vip_info_v2', query]); return response({ data: { redVipLevel: 7, musicPackage: { vipCode: 220 } } }) },
    playlist_detail: async (query) => { calls.push(['playlist_detail', query]); return response({ playlist: { id: 91, name: '详情歌单', tracks: [rawSong], trackIds: [{ id: 123 }] } }) },
    ...overrides,
  }, {
    get(target, property) {
      return target[property]
    },
  })
  const service = createNeteaseCapabilityService({
    api,
    getCookie: () => 'MUSIC_U=test',
    getLoginInfo: async () => loggedIn ? { loggedIn: true, userId: 42 } : { loggedIn: false },
  })
  return { service, calls }
}

test('canonical song normalization is shared and PlayerCore-ready', () => {
  assert.deepEqual(normalizeNeteaseSongRecord(rawSong), {
    ...rawSong,
    id: '123',
    providerId: '123',
    source: 'netease',
    title: '真实歌曲',
    name: '真实歌曲',
    artist: '真实歌手',
    album: '真实专辑',
    fileUrl: '/api/netease/audio?id=123',
    coverUrl: 'https://img.example/cover.jpg?param=240y240',
    duration: 245000,
  })
})

test('recommend_songs contract returns only canonical daily songs', async () => {
  const { service, calls } = createFixtureService()
  const result = await service.dailySongs()
  assert.equal(result.songs[0].providerId, '123')
  assert.equal(result.songs[0].fileUrl, '/api/netease/audio?id=123')
  assert.equal(calls[0][0], 'recommend_songs')
})

test('recommend_resource contract returns playlist resources, not invented songs', async () => {
  const { service } = createFixtureService()
  const result = await service.recommendedPlaylists()
  assert.deepEqual(result.playlists.map((item) => item.name), ['每日歌单'])
  assert.equal(result.playlists[0].source, 'netease')
})

test('personal_fm contract returns canonical songs', async () => {
  const { service } = createFixtureService()
  const result = await service.personalFm()
  assert.equal(result.songs[0].id, '123')
})

test('personal_fm empty provider response is classified as empty_result', async () => {
  const { service } = createFixtureService({ personal_fm: async () => response({ data: [] }) })
  await assert.rejects(
    () => service.personalFm(),
    (error) => error instanceof NeteaseCapabilityError
      && error.code === 'empty_result'
      && error.details?.method === 'personal_fm',
  )
})

test('personal_fm provider failures retain method and provider code evidence', async () => {
  const { service } = createFixtureService({ personal_fm: async () => response({ code: 500, msg: 'provider failed' }) })
  await assert.rejects(
    () => service.personalFm(),
    (error) => error instanceof NeteaseCapabilityError
      && error.code === 'provider_error'
      && error.details?.method === 'personal_fm'
      && error.details?.providerCode === 500,
  )
})

test('record_recent_song and user_record remain distinct provider histories', async () => {
  const { service, calls } = createFixtureService()
  const recent = await service.recent({ type: 'song', limit: 8 })
  const ranking = await service.userRecord({ type: 'week', limit: 8 })
  assert.equal(recent.total, 7)
  assert.equal(recent.items[0].playedAt, 1000)
  assert.equal(ranking.records[0].playCount, 8)
  assert.equal(calls.find(([name]) => name === 'record_recent_song')[1].limit, 8)
  assert.equal(calls.find(([name]) => name === 'user_record')[1].type, 1)
})

test('podcast list uses dj_sublist while created programs use user_dj', async () => {
  const { service, calls } = createFixtureService()
  const subscribed = await service.podcasts()
  const created = await service.podcasts({ source: 'created' })
  const programs = await service.podcastPrograms({ podcastId: 21 })
  assert.equal(subscribed.podcasts[0].name, '订阅播客')
  assert.equal(created.programs[0].name, '我创建的节目')
  assert.equal(programs.programs[0].song.providerId, '123')
  assert.ok(calls.some(([name]) => name === 'dj_sublist'))
  assert.ok(calls.some(([name]) => name === 'user_dj'))
  assert.ok(calls.some(([name]) => name === 'dj_program'))
})

test('user_cloud contract exposes canonical songs as candidates, not guaranteed playback', async () => {
  const { service } = createFixtureService()
  const result = await service.cloud()
  assert.equal(result.items[0].playableCandidate, true)
  assert.equal(result.songs[0].providerId, '123')
})

test('search_suggest songs pass through canonical normalization', async () => {
  const { service } = createFixtureService()
  const result = await service.searchSuggest({ keywords: '真实' })
  assert.equal(result.songs[0].id, '123')
  assert.deepEqual(result.order, ['songs'])
})

test('song_detail and check_music contracts preserve separate read semantics', async () => {
  const { service } = createFixtureService()
  const detail = await service.songDetails({ ids: ['123'] })
  const playable = await service.checkPlayable({ id: '123' })
  assert.equal(detail.songs[0].title, '真实歌曲')
  assert.deepEqual(playable, { providerId: '123', playable: true, message: 'ok' })
})

test('song_url_v1 stream quality is explicit and never invents unsupported levels', async () => {
  const { service, calls } = createFixtureService()
  const stream = await service.resolveStream({ id: '123', level: 'lossless' })
  assert.equal(stream.fileUrl, '/api/netease/audio?id=123&level=lossless')
  assert.equal(calls.find(([name]) => name === 'song_url_v1')[1].level, 'lossless')
  assert.ok(NETEASE_STREAM_LEVELS.includes('jymaster'))
  await assert.rejects(() => service.resolveStream({ id: '123', level: 'higher' }), (error) => error.code === 'unsupported')
})

test('song_url_v1 missing URL surfaces provider entitlement instead of claiming SVIP access', async () => {
  const { service } = createFixtureService({
    song_url_v1: async () => response({ data: [{ url: null, fee: 1, message: 'VIP required' }] }),
  })
  await assert.rejects(() => service.resolveStream({ id: '123', level: 'jymaster' }), (error) => error.code === 'vip_required')
})

test('P1 read contracts expose liked, subscription, membership and enhanced playlist facts', async () => {
  const { service } = createFixtureService()
  const [liked, counts, albums, artists, membership, playlist] = await Promise.all([
    service.likedStatus({ ids: ['123', '999'] }),
    service.subscriptionCounts(),
    service.subscribedAlbums(),
    service.subscribedArtists(),
    service.membership(),
    service.playlistDetail({ id: '91' }),
  ])
  assert.deepEqual(liked.statuses, [{ providerId: '123', liked: true }, { providerId: '999', liked: false }])
  assert.equal(counts.playlists, 9)
  assert.equal(albums.albums[0].name, '收藏专辑')
  assert.equal(artists.artists[0].name, '收藏歌手')
  assert.equal(membership.redVipLevel, 7)
  assert.equal(playlist.songs[0].providerId, '123')
})

test('personal endpoints return typed not_logged_in errors', async () => {
  const { service } = createFixtureService({}, { loggedIn: false })
  await assert.rejects(() => service.dailySongs(), (error) => error instanceof NeteaseCapabilityError && error.code === 'not_logged_in')
})
