import { resolveMusicStructureSeek } from '../api/musicIntelligenceApi.js'
import { NeteaseApiAdapter } from './netease/apiAdapter.js'
import { NeteaseCapabilityExecutor } from './netease/capabilityExecutor.js'
import { YunPlayerAdapter } from './netease/playerAdapter.js'
import { rankWithMusicPreferences } from './musicPreferenceRanker.js'

function compactText(value) {
  return String(value || '').toLowerCase().replace(/[\s，。！？、,.!?~…《》「」“”"']/g, '')
}

export async function executeYunAgentActions(actions, { player, setResponseMode, voice, context = {}, isCurrentRequest = () => true, preferenceLoader = async () => (await fetch('/api/music-memory/preferences')).json() } = {}) {
  const results = []
  // Migration boundary: server/yun-agent still emits its established
  // `music.*` action protocol so current behavior remains stable. This module
  // (owner: Yun Agent action protocol) translates those actions into capability
  // requests. Remove the switch once the server emits capability requests and
  // its action-protocol regression tests have migrated with it.
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: new NeteaseApiAdapter(),
    playerAdapter: new YunPlayerAdapter(player),
  })
  const execute = (capability, action, args = {}) => executor.execute({ capability, action, args })
  const valueOf = (result) => {
    if (!result?.ok) throw new Error(result?.error || 'capability_execution_failed')
    return result.value
  }
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!isCurrentRequest()) {
      results.push({ ok: false, cancelled: true })
      break
    }
    try {
      const payload = action?.payload || {}
      switch (action?.type) {
        case 'music.next': results.push(await execute('yun.player.transport', 'next')); break
        case 'music.previous': results.push(await execute('yun.player.transport', 'previous')); break
        case 'music.pause': results.push(await execute('yun.player.transport', 'pause')); break
        case 'music.resume': results.push(await execute('yun.player.transport', 'resume')); break
        case 'music.seek': results.push(await execute('yun.player.position', 'seek', { seconds: payload.seconds })); break
        case 'music.set_mode': results.push(await execute('yun.player.settings', 'set_mode', { mode: payload.mode })); break
        case 'music.set_response_mode': setResponseMode?.(payload.mode); results.push({ ok: true }); break
        case 'music.add_to_collection': {
          if (!context.currentSong) {
            results.push({ ok: false, error: 'no_current_song' })
            break
          }
          const capability = payload.target === 'liked' ? 'netease.library.liked' : 'netease.library.collection'
          const addedResult = await execute(capability, 'add', { song: context.currentSong, target: payload.target, playlistName: payload.playlistName })
          const added = valueOf(addedResult)
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          results.push({ ok: true, ...added })
          break
        }
        case 'music.play_netease_playlist': {
          const playlistName = String(payload.playlistName || '').trim()
          const account = valueOf(await execute('netease.account.status', 'get'))
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (!account?.loggedIn) {
            results.push({ ok: false, error: 'netease_login_required' })
            break
          }
          const expected = compactText(playlistName)
          // NetEase lets people rename the special liked-songs playlist (for
          // example, “哈基蚦喜欢的音乐”). Its stable identity is `liked`, not
          // the displayed name, so never require an exact title here.
          const requestsLikedSongs = /我喜欢的音乐|我的喜欢|我喜欢的歌|喜欢的歌/.test(playlistName)
          const playlist = requestsLikedSongs
            ? (account.playlists || []).find((item) => item?.liked)
            : (account.playlists || []).find((item) => expected && compactText(item.name) === expected)
          if (!playlist) {
            results.push({ ok: false, error: 'netease_playlist_not_found' })
            break
          }
          const tracks = valueOf(await execute('netease.library.playlists', 'tracks', { playlistId: playlist.id }))
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          const currentTrack = player.getState().currentTrack
          await execute('yun.player.settings', 'set_mode', { mode: 'sequence' })
          results.push(tracks[0]
            ? await execute('yun.player.queue', 'play_from_queue', { track: tracks[0], queue: tracks, options: { crossfade: Boolean(currentTrack) } })
            : { ok: false, error: 'netease_playlist_empty' })
          break
        }
        case 'music.play_track': results.push(await execute('yun.player.queue', 'play_track', { track: payload.track, options: { crossfade: Boolean(player.getState().currentTrack) } })); break
        case 'music.recommend': {
          let tracks = valueOf(await execute('netease.recommend.contextual', 'list', { context: { currentSong: context.currentSong, playHistory: context.playHistory || [], recentRecommendations: context.recentRecommendations || [] }, limit: payload.limit || 4 }))
          try { const result = await preferenceLoader(); tracks = rankWithMusicPreferences({ candidates: tracks, currentSong: context.currentSong, preferenceSnapshot: result?.snapshot || result }) } catch { /* cold-start/fetch failure preserves provider ordering */ }
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) await execute('yun.player.queue', 'set_auto_up_next', { tracks: tracks.slice(1), options: { replace: true } })
          results.push(tracks[0] ? await execute('yun.player.queue', 'play_from_queue', { track: tracks[0], queue: tracks, options: { crossfade: Boolean(player.getState().currentTrack) } }) : { ok: false, error: 'no_recommendation' })
          break
        }
        case 'music.search_netease': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 8))
          const tracks = valueOf(await execute('netease.search.song', 'search', { query: payload.query, limit }))
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) await execute('yun.player.queue', 'set_auto_up_next', { tracks: tracks.slice(1), options: { replace: true } })
          results.push(tracks[0] ? await execute('yun.player.queue', 'play_from_queue', { track: tracks[0], queue: tracks, options: { crossfade: Boolean(player.getState().currentTrack) } }) : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.prepare_queue': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 4))
          const tracks = valueOf(await execute('netease.search.song', 'search', { query: payload.query, limit }))
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          await execute('yun.player.queue', 'set_auto_up_next', { tracks, options: { replace: true } })
          results.push(tracks.length ? { ok: true, prepared: tracks.length } : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.analyze_section': {
          const resolved = await resolveMusicStructureSeek(context.currentSong, { target: payload.target, occurrence: 'first' })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (resolved?.ok) await execute('yun.player.position', 'seek', { seconds: resolved.positionSec })
          results.push(resolved)
          break
        }
        case 'music.read_comments': {
          if (!context.currentSong?.providerId && String(context.currentSong?.id || '').startsWith('netease-') === false) {
            results.push({ ok: false, error: 'current_song_is_not_netease' })
            break
          }
          const comments = valueOf(await execute('netease.song.comments', 'list', { songId: context.currentSong.providerId || context.currentSong.id, limit: payload.limit || 3 }))
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          const spokenText = comments.length
            ? `这首歌有${comments.length}条想读给你的热门评论。${comments.map((comment, index) => `第${index + 1}条，${comment.user}说：${comment.content}`).join('。')}`
            : '这首歌暂时没有读到可公开的评论。'
          await voice?.speakText?.(spokenText, { allowBargeIn: true })
          results.push({ ok: true, comments, spokenText })
          break
        }
        case 'tts.speak': results.push(await voice?.speakText?.(payload.text, { allowBargeIn: true })); break
        case 'music.get_state': {
          const state = await execute('yun.player.crossfade', 'get_state')
          results.push(state.ok ? { ok: true, diagnostics: state.value } : state)
          break
        }
        default: results.push({ ok: false, error: 'unknown_agent_action' })
      }
    } catch (error) {
      results.push({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
