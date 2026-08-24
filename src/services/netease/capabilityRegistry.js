export const NETEASE_TRANSPORT = Object.freeze({
  API: 'api',
  PLAYER: 'player',
  DESKTOP: 'desktop',
  UNAVAILABLE: 'unavailable',
})

export const NETEASE_SUPPORT_STATUS = Object.freeze({
  AVAILABLE: 'available',
  PACKAGE_AVAILABLE: 'package_available',
  UNKNOWN: 'unknown',
  UNAVAILABLE: 'unavailable',
})

const capability = (definition) => Object.freeze({
  requiresExplicitIntent: false,
  requiresConfirmation: false,
  ...definition,
  actions: Object.freeze([...definition.actions]),
})

// This registry is deliberately declarative. It contains no URL, selector,
// coordinate, or player implementation detail; the executor is the sole owner
// of transport selection.
export const NETEASE_CAPABILITIES = Object.freeze([
  capability({ id: 'netease.search.song', name: '歌曲搜索', description: 'Search NetEase for real song candidates.', domain: 'search', actions: ['search'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.search.lyrics', name: '歌词检索', description: 'Resolve a lyric fragment against real NetEase results.', domain: 'search', actions: ['resolve'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.search.suggest', name: '搜索建议', description: 'Read NetEase search suggestions as evidence; suggestions are never treated as playable tracks.', domain: 'search', actions: ['suggest'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),

  capability({ id: 'netease.recommend.daily', name: '每日推荐', description: 'Read real daily recommended songs from NetEase; playback remains owned by PlayerCore.', domain: 'recommendation', actions: ['list', 'play'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.recommend.personal_fm', name: '私人 FM', description: 'Read real Personal FM songs from NetEase; playback remains owned by PlayerCore.', domain: 'recommendation', actions: ['list', 'play'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.recommend.private_radar', name: '私人雷达', description: 'Client-branded recommendation area; API ownership is not verified.', domain: 'recommendation', actions: ['list', 'play'], transport: 'unavailable', access: 'read', risk: 'low', supportStatus: 'unknown' }),
  capability({ id: 'netease.recommend.private_roaming', name: '私人漫游', description: 'Client-branded recommendation area; API ownership is not verified.', domain: 'recommendation', actions: ['list', 'play'], transport: 'unavailable', access: 'read', risk: 'low', supportStatus: 'unknown' }),
  capability({ id: 'netease.recommend.similar', name: '相似歌曲', description: 'Retrieve real similar-song candidates through the existing NetEase recommendation endpoint; playback remains owned by PlayerCore.', domain: 'recommendation', actions: ['list', 'play'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.recommend.playlist', name: '推荐歌单', description: 'Read real daily recommended playlist resources from NetEase.', domain: 'recommendation', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.recommend.contextual', name: '上下文推荐', description: 'Retrieve NetEase candidates using Yun context as a light constraint.', domain: 'recommendation', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),

  capability({ id: 'netease.library.liked', name: '我喜欢的音乐', description: 'Read liked songs/status or explicitly add the current song.', domain: 'library', actions: ['list', 'status', 'add'], transport: 'api', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'netease.library.liked_remove', name: '取消喜欢', description: 'Remove songs from liked music; exported by the package but not wrapped by the project.', domain: 'library', actions: ['remove'], transport: 'api', access: 'write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'package_available' }),
  capability({ id: 'netease.library.recent', name: '网易云最近播放', description: 'Read NetEase account recent songs, albums, playlists, podcasts, or voice records; this is distinct from Yun memory.', domain: 'library', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.user_record', name: '网易云听歌排行', description: 'Read weekly or all-time NetEase user play records.', domain: 'library', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.podcasts', name: '我的播客', description: 'Read subscribed podcasts and programs; a resolved program is handed to PlayerCore for playback.', domain: 'library', actions: ['list', 'programs', 'play'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.collection', name: '我的收藏', description: 'Add a song to liked music or a named playlist.', domain: 'library', actions: ['add'], transport: 'api', access: 'write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'netease.library.cloud', name: '音乐网盘', description: 'Read cloud metadata and resolve an exact playable cloud track before handing it to PlayerCore.', domain: 'library', actions: ['list', 'play'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.playlists', name: '用户歌单', description: 'Read user playlists, enhanced details, and tracks; playback is a separate PlayerCore action.', domain: 'library', actions: ['list', 'tracks', 'detail'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.subscription_counts', name: '收藏计数', description: 'Read NetEase playlist, album, artist, and podcast subscription counts.', domain: 'library', actions: ['get'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.subscribed_albums', name: '收藏专辑', description: 'Read subscribed NetEase albums.', domain: 'library', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.subscribed_artists', name: '收藏歌手', description: 'Read subscribed NetEase artists.', domain: 'library', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.library.playlist_mutation', name: '歌单管理', description: 'Create, update, subscribe, or remove tracks from a playlist.', domain: 'library', actions: ['create', 'update', 'subscribe', 'add_track', 'remove_track'], transport: 'api', access: 'write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'package_available' }),
  capability({ id: 'netease.library.playlist_delete', name: '删除歌单', description: 'Permanently delete a NetEase playlist.', domain: 'library', actions: ['delete'], transport: 'api', access: 'write', risk: 'high', requiresExplicitIntent: true, requiresConfirmation: true, supportStatus: 'package_available' }),
  capability({ id: 'netease.library.downloads', name: '下载管理', description: 'NetEase desktop-client download state and files.', domain: 'library', actions: ['list', 'open'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read', risk: 'low', supportStatus: 'unavailable' }),
  capability({ id: 'netease.library.download_delete', name: '删除下载', description: 'Delete downloaded client files.', domain: 'library', actions: ['delete'], transport: 'unavailable', intendedTransport: 'desktop', access: 'write', risk: 'high', requiresExplicitIntent: true, requiresConfirmation: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.library.local', name: '本地音乐', description: 'NetEase desktop-client local music index.', domain: 'library', actions: ['list', 'open'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read', risk: 'low', supportStatus: 'unavailable' }),
  capability({ id: 'netease.library.history_clear', name: '清空历史', description: 'Clear account or client listening history.', domain: 'library', actions: ['clear'], transport: 'unavailable', access: 'write', risk: 'high', requiresExplicitIntent: true, requiresConfirmation: true, supportStatus: 'unavailable' }),

  capability({ id: 'netease.song.lyrics', name: '歌曲歌词', description: 'Read synchronized lyrics for a known NetEase song.', domain: 'song', actions: ['get'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.song.comments', name: '歌曲评论', description: 'Read public comments for a known NetEase song.', domain: 'song', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.song.detail', name: '歌曲详情', description: 'Read canonical song details for one or more NetEase IDs.', domain: 'song', actions: ['get'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.song.playability', name: '歌曲可播放性', description: 'Check NetEase copyright/playability without starting playback.', domain: 'song', actions: ['check'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.song.comment_mutation', name: '评论操作', description: 'Post, reply to, delete, like, or unlike a comment.', domain: 'song', actions: ['post', 'reply', 'delete', 'like', 'unlike'], transport: 'api', access: 'write', risk: 'high', requiresExplicitIntent: true, requiresConfirmation: true, supportStatus: 'package_available' }),
  capability({ id: 'netease.artist.songs', name: '歌手歌曲', description: 'Retrieve real songs from a NetEase artist catalog.', domain: 'artist', actions: ['list'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.account.status', name: '账号状态', description: 'Read login state and known account metadata.', domain: 'account', actions: ['get'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.account.membership', name: '会员信息', description: 'Read membership facts returned by NetEase without assuming stream entitlements.', domain: 'account', actions: ['get'], transport: 'api', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'netease.account.mutation', name: '账号操作', description: 'Modify account, bindings, or profile details.', domain: 'account', actions: ['update', 'bind', 'unbind'], transport: 'api', access: 'write', risk: 'high', requiresExplicitIntent: true, requiresConfirmation: true, supportStatus: 'package_available' }),

  capability({ id: 'yun.player.transport', name: '昀播放器控制', description: 'Play, pause, resume, toggle, previous, or next through PlayerCore.', domain: 'player', actions: ['play', 'pause', 'resume', 'toggle', 'previous', 'next'], transport: 'player', access: 'write', risk: 'low', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'yun.player.position', name: '播放进度', description: 'Seek through PlayerCore.', domain: 'player', actions: ['seek'], transport: 'player', access: 'write', risk: 'low', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'yun.player.queue', name: '播放队列', description: 'Play tracks and manage queue/up-next through PlayerCore.', domain: 'player', actions: ['play_track', 'play_from_queue', 'set', 'clear', 'set_queued_next', 'enqueue_up_next', 'clear_up_next', 'set_auto_up_next'], transport: 'player', access: 'read-write', risk: 'low', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'yun.player.settings', name: '播放器设置', description: 'Set Yun player volume or playback mode through PlayerCore.', domain: 'player', actions: ['set_volume', 'set_mode'], transport: 'player', access: 'write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'yun.player.crossfade', name: 'Crossfade 状态', description: 'Read PlayerCore playback diagnostics; orchestration remains internal.', domain: 'player', actions: ['get_state'], transport: 'player', access: 'read', risk: 'low', supportStatus: 'available' }),
  capability({ id: 'yun.player.stream_quality', name: '昀播放器单曲取流品质', description: 'Resolve one NetEase song_url_v1 stream for the current track, then hand the canonical track back to PlayerCore.', domain: 'player_stream', actions: ['resolve'], transport: 'api', access: 'read', risk: 'low', requiresExplicitIntent: true, supportStatus: 'available' }),

  capability({ id: 'netease.client.open', name: '打开网易云客户端', description: 'Open the NetEase desktop application without navigating internal pages.', domain: 'client', actions: ['open'], transport: 'desktop', access: 'write', risk: 'low', requiresExplicitIntent: true, supportStatus: 'available' }),
  capability({ id: 'netease.client.podcast.open', name: '打开播客页面', description: 'Navigate the desktop client to My Podcasts; no verified semantic control exists yet.', domain: 'client', actions: ['open'], transport: 'unavailable', intendedTransport: 'desktop', access: 'write', risk: 'low', requiresExplicitIntent: true, supportStatus: 'unavailable' }),

  capability({ id: 'netease.desktop.default_quality', name: '网易云客户端默认音质', description: 'Read or set the desktop client persistent default quality; song_url_v1 does not control this setting.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.effect', name: '客户端音效', description: 'Set AI tuning, 8D, 360, bass, rock, clear-vocal, or related client effects.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.eq', name: '客户端 EQ', description: 'Open or set the desktop client equalizer.', domain: 'audio', actions: ['get', 'open', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.device_adaptation', name: '设备适配', description: 'Read or set client device adaptation.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.output_device', name: '输出设备', description: 'Read or set the Windows/client audio output device.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.system_spatial', name: '系统空间音效', description: 'Read or set Windows spatial audio.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.audio.system_enhancement', name: '系统音频增强', description: 'Read or set Windows audio enhancements.', domain: 'audio', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),

  capability({ id: 'netease.client.autoplay', name: '启动自动播放', description: 'Read or set desktop-client startup autoplay.', domain: 'client_settings', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.client.remember_progress', name: '记住播放进度', description: 'Read or set desktop-client progress persistence.', domain: 'client_settings', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.client.cross_device_resume', name: '跨端续播', description: 'Read or set cross-device playback continuation.', domain: 'client_settings', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.client.fade', name: '客户端淡入淡出', description: 'Read or set desktop-client fade behavior; Yun crossfade is a separate PlayerCore concern.', domain: 'client_settings', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
  capability({ id: 'netease.client.volume_balance', name: '音量平衡', description: 'Read or set desktop-client volume balancing.', domain: 'client_settings', actions: ['get', 'set'], transport: 'unavailable', intendedTransport: 'desktop', access: 'read-write', risk: 'medium', requiresExplicitIntent: true, supportStatus: 'unavailable' }),
])

const capabilityById = new Map(NETEASE_CAPABILITIES.map((item) => [item.id, item]))

export function getCapability(id) {
  return capabilityById.get(String(id || '').trim()) || null
}

export function listCapabilities({ domain, transport, supportStatus, executableOnly = false } = {}) {
  return NETEASE_CAPABILITIES.filter((item) => {
    if (domain && item.domain !== domain) return false
    if (transport && item.transport !== transport) return false
    if (supportStatus && item.supportStatus !== supportStatus) return false
    if (executableOnly && !isExecutableCapability(item)) return false
    return true
  })
}

export function isExecutableCapability(item) {
  return Boolean(
    item
    && item.supportStatus === NETEASE_SUPPORT_STATUS.AVAILABLE
    && item.transport !== NETEASE_TRANSPORT.UNAVAILABLE,
  )
}
