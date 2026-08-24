import {
  addSongToNeteaseCollection,
  checkNeteaseSongPlayable,
  fetchNeteaseAiRecommendations,
  fetchNeteaseArtistSongs,
  fetchNeteaseCloud,
  fetchNeteaseDailySongs,
  fetchNeteaseLyrics,
  fetchNeteaseLikedStatus,
  fetchNeteaseMe,
  fetchNeteaseMembership,
  fetchNeteasePersonalFm,
  fetchNeteasePlaylistDetail,
  fetchNeteasePlaylistTracks,
  fetchNeteasePodcastPrograms,
  fetchNeteasePodcasts,
  fetchNeteaseRecentHistory,
  fetchNeteaseRecommendedPlaylists,
  fetchNeteaseSearchSuggestions,
  fetchNeteaseSongComments,
  fetchNeteaseSongDetails,
  fetchNeteaseStateSummary,
  fetchNeteaseSubscribedAlbums,
  fetchNeteaseSubscribedArtists,
  fetchNeteaseSubscriptionCounts,
  fetchNeteaseUserRecord,
  NeteaseApiError,
  resolveNeteaseStreamQuality,
  resolveNeteaseSongFromLyrics,
  searchNeteaseSongs,
} from '../../api/neteaseApi.js'

const defaultOperations = {
  addSongToCollection: addSongToNeteaseCollection,
  checkSongPlayable: checkNeteaseSongPlayable,
  fetchArtistSongs: fetchNeteaseArtistSongs,
  fetchCloud: fetchNeteaseCloud,
  fetchDailySongs: fetchNeteaseDailySongs,
  fetchLyrics: fetchNeteaseLyrics,
  fetchLikedStatus: fetchNeteaseLikedStatus,
  fetchMe: fetchNeteaseMe,
  fetchMembership: fetchNeteaseMembership,
  fetchPersonalFm: fetchNeteasePersonalFm,
  fetchPlaylistDetail: fetchNeteasePlaylistDetail,
  fetchPlaylistTracks: fetchNeteasePlaylistTracks,
  fetchPodcastPrograms: fetchNeteasePodcastPrograms,
  fetchPodcasts: fetchNeteasePodcasts,
  fetchRecentHistory: fetchNeteaseRecentHistory,
  fetchRecommendedPlaylists: fetchNeteaseRecommendedPlaylists,
  fetchRecommendations: fetchNeteaseAiRecommendations,
  fetchSearchSuggestions: fetchNeteaseSearchSuggestions,
  fetchSongComments: fetchNeteaseSongComments,
  fetchSongDetails: fetchNeteaseSongDetails,
  fetchStateSummary: fetchNeteaseStateSummary,
  fetchSubscribedAlbums: fetchNeteaseSubscribedAlbums,
  fetchSubscribedArtists: fetchNeteaseSubscribedArtists,
  fetchSubscriptionCounts: fetchNeteaseSubscriptionCounts,
  fetchUserRecord: fetchNeteaseUserRecord,
  resolveLyrics: resolveNeteaseSongFromLyrics,
  resolveStreamQuality: resolveNeteaseStreamQuality,
  searchSongs: searchNeteaseSongs,
}

function compactText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function notFound(message) {
  return new NeteaseApiError('not_found', message)
}

export class NeteaseApiAdapter {
  constructor(operations = {}) {
    this.operations = { ...defaultOperations, ...operations }
  }

  async execute(capability, action, args = {}) {
    const handlers = {
      'netease.search.song:search': () => this.operations.searchSongs(args.query, { limit: args.limit }),
      'netease.search.lyrics:resolve': () => this.operations.resolveLyrics(args.query || args.lyrics),
      'netease.search.suggest:suggest': () => this.operations.fetchSearchSuggestions(args.query || args.keywords, { type: args.type }),
      'netease.song.lyrics:get': () => this.operations.fetchLyrics(args.songId || args.providerId),
      'netease.song.comments:list': () => this.operations.fetchSongComments(args.songId || args.providerId, { limit: args.limit }),
      'netease.song.detail:get': () => this.operations.fetchSongDetails(args.ids || args.songId || args.providerId),
      'netease.song.playability:check': () => this.operations.checkSongPlayable(args.songId || args.providerId, { br: args.br }),
      'yun.player.stream_quality:resolve': () => this.operations.resolveStreamQuality(args.song, args.level),
      'netease.account.status:get': () => this.operations.fetchMe(),
      'netease.account.membership:get': () => this.operations.fetchMembership(),
      'netease.library.playlists:list': async () => (await this.operations.fetchMe())?.playlists || [],
      'netease.library.playlists:tracks': () => this.operations.fetchPlaylistTracks(args.playlistId),
      'netease.library.playlists:detail': () => this.operations.fetchPlaylistDetail(args.playlistId),
      'netease.library.liked:list': async () => {
        const account = await this.operations.fetchMe()
        const liked = (account?.playlists || []).find((playlist) => playlist?.liked)
        return liked ? this.operations.fetchPlaylistTracks(liked.id) : []
      },
      'netease.library.liked:status': () => this.operations.fetchLikedStatus(args.ids || args.songId || args.providerId),
      'netease.library.liked:add': () => this.operations.addSongToCollection({ song: args.song, target: 'liked' }),
      'netease.library.collection:add': () => this.operations.addSongToCollection(args),
      'netease.library.recent:list': () => this.operations.fetchRecentHistory({ type: args.type, limit: args.limit }),
      'netease.library.user_record:list': () => this.operations.fetchUserRecord({ type: args.type, limit: args.limit }),
      'netease.library.podcasts:list': () => this.operations.fetchPodcasts({ source: args.source, limit: args.limit, offset: args.offset }),
      'netease.library.podcasts:programs': () => this.operations.fetchPodcastPrograms(args.podcastId, { limit: args.limit, offset: args.offset, asc: args.asc }),
      'netease.library.cloud:list': () => this.operations.fetchCloud({ limit: args.limit, offset: args.offset }),
      'netease.library.subscription_counts:get': () => this.operations.fetchSubscriptionCounts(),
      'netease.library.subscribed_albums:list': () => this.operations.fetchSubscribedAlbums({ limit: args.limit, offset: args.offset }),
      'netease.library.subscribed_artists:list': () => this.operations.fetchSubscribedArtists({ limit: args.limit, offset: args.offset }),
      'netease.artist.songs:list': () => this.operations.fetchArtistSongs(args.artist, { limit: args.limit }),
      'netease.recommend.daily:list': () => this.operations.fetchDailySongs(),
      'netease.recommend.daily:play': () => this.operations.fetchDailySongs(),
      'netease.recommend.personal_fm:list': () => this.operations.fetchPersonalFm(),
      'netease.recommend.personal_fm:play': () => this.operations.fetchPersonalFm(),
      'netease.recommend.playlist:list': () => this.operations.fetchRecommendedPlaylists(),
      'netease.recommend.similar:list': () => this.operations.fetchRecommendations({ ...args.context, currentSong: args.currentSong, limit: args.limit }),
      'netease.recommend.similar:play': () => this.operations.fetchRecommendations({ ...args.context, currentSong: args.currentSong, limit: args.limit }),
      'netease.recommend.contextual:list': () => this.operations.fetchRecommendations({ ...args.context, limit: args.limit }),
    }

    if (capability === 'netease.library.podcasts' && action === 'play') {
      const catalog = await this.operations.fetchPodcasts({ source: args.source, limit: args.limit })
      const expected = compactText(args.podcastName)
      const podcast = (catalog?.podcasts || []).find((item) => String(item.id) === String(args.podcastId || ''))
        || (catalog?.podcasts || []).find((item) => expected && compactText(item.name) === expected)
        || catalog?.podcasts?.[0]
      if (!podcast?.id) throw notFound('我的网易云订阅中没有可播放的播客')
      const data = await this.operations.fetchPodcastPrograms(podcast.id, { limit: args.limit || 20 })
      const track = data?.programs?.find((program) => program?.song?.providerId)?.song
      if (!track) throw notFound(`播客「${podcast.name}」没有返回可播放节目`)
      const status = await this.operations.checkSongPlayable(track.providerId)
      if (!status?.playable) throw notFound(status?.message || '这个播客节目当前不可播放')
      return track
    }

    if (capability === 'netease.library.cloud' && action === 'play') {
      const data = await this.operations.fetchCloud({ limit: args.limit || 100 })
      const expected = compactText(args.query)
      const track = (data?.songs || []).find((song) => expected && compactText(song.title) === expected)
      if (!track) throw notFound(`云盘中没有找到「${args.query || ''}」`)
      const status = await this.operations.checkSongPlayable(track.providerId)
      if (!status?.playable) throw notFound(status?.message || '这首云盘歌曲当前不能可靠播放')
      return track
    }

    const handler = handlers[`${capability}:${action}`]
    if (handler) return handler()
    throw new Error(`unsupported_api_operation:${capability}:${action}`)
  }

  async getState() {
    const summary = await this.operations.fetchStateSummary()
    return {
      account: {
        loggedIn: Boolean(summary?.account?.loggedIn),
        membership: summary?.account?.membership,
      },
      library: {
        playlistsCount: summary?.library?.playlistsCount,
        recentCount: summary?.library?.recentCount,
        cloudCount: summary?.library?.cloudCount,
        podcastCount: summary?.library?.podcastCount,
        likedCount: summary?.library?.likedCount,
        subscriptionCounts: summary?.library?.subscriptionCounts,
      },
      recommendation: summary?.recommendation,
    }
  }
}
