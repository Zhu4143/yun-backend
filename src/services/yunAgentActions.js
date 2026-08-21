import { addSongToNeteaseCollection, fetchNeteaseAiRecommendations, fetchNeteaseMe, fetchNeteasePlaylistTracks, fetchNeteaseSongComments, searchNeteaseSongs } from '../api/neteaseApi.js'
import { resolveMusicStructureSeek } from '../api/musicIntelligenceApi.js'

function compactText(value) {
  return String(value || '').toLowerCase().replace(/[\s，。！？、,.!?~…《》「」“”"']/g, '')
}

export async function executeYunAgentActions(actions, { player, setResponseMode, voice, context = {}, isCurrentRequest = () => true } = {}) {
  const results = []
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!isCurrentRequest()) {
      results.push({ ok: false, cancelled: true })
      break
    }
    try {
      const payload = action?.payload || {}
      switch (action?.type) {
        case 'music.next': results.push(await player.next()); break
        case 'music.previous': results.push(await player.previous()); break
        case 'music.pause': results.push(await player.pause()); break
        case 'music.resume': results.push(await player.play()); break
        case 'music.seek': player.seek(payload.seconds); results.push({ ok: true }); break
        case 'music.set_mode': player.setPlaybackMode(payload.mode); results.push({ ok: true }); break
        case 'music.set_response_mode': setResponseMode?.(payload.mode); results.push({ ok: true }); break
        case 'music.add_to_collection': {
          if (!context.currentSong) {
            results.push({ ok: false, error: 'no_current_song' })
            break
          }
          const added = await addSongToNeteaseCollection({ song: context.currentSong, target: payload.target, playlistName: payload.playlistName })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          results.push({ ok: true, ...added })
          break
        }
        case 'music.play_netease_playlist': {
          const playlistName = String(payload.playlistName || '').trim()
          const account = await fetchNeteaseMe()
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
          const tracks = await fetchNeteasePlaylistTracks(playlist.id)
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          const currentTrack = player.getState().currentTrack
          player.setPlaybackMode('sequence')
          results.push(tracks[0]
            ? await player.playTrackFromQueue(tracks[0], tracks, { crossfade: Boolean(currentTrack) })
            : { ok: false, error: 'netease_playlist_empty' })
          break
        }
        case 'music.play_track': results.push(await player.playTrack(payload.track, { crossfade: Boolean(player.getState().currentTrack) })); break
        case 'music.recommend': {
          const tracks = await fetchNeteaseAiRecommendations({ currentSong: context.currentSong, playHistory: context.playHistory || [], recentRecommendations: context.recentRecommendations || [], limit: payload.limit || 4 })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) player.setAutoUpNext(tracks.slice(1), { replace: true })
          results.push(tracks[0] ? await player.playTrackFromQueue(tracks[0], tracks, { crossfade: Boolean(player.getState().currentTrack) }) : { ok: false, error: 'no_recommendation' })
          break
        }
        case 'music.search_netease': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 8))
          const tracks = await searchNeteaseSongs(payload.query, { limit })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) player.setAutoUpNext(tracks.slice(1), { replace: true })
          results.push(tracks[0] ? await player.playTrackFromQueue(tracks[0], tracks, { crossfade: Boolean(player.getState().currentTrack) }) : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.prepare_queue': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 4))
          const tracks = await searchNeteaseSongs(payload.query, { limit })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          player.setAutoUpNext(tracks, { replace: true })
          results.push(tracks.length ? { ok: true, prepared: tracks.length } : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.analyze_section': {
          const resolved = await resolveMusicStructureSeek(context.currentSong, { target: payload.target, occurrence: 'first' })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (resolved?.ok) player.seek(resolved.positionSec)
          results.push(resolved)
          break
        }
        case 'music.read_comments': {
          if (!context.currentSong?.providerId && String(context.currentSong?.id || '').startsWith('netease-') === false) {
            results.push({ ok: false, error: 'current_song_is_not_netease' })
            break
          }
          const comments = await fetchNeteaseSongComments(context.currentSong.providerId || context.currentSong.id, { limit: payload.limit || 3 })
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
        case 'music.get_state': results.push({ ok: true, diagnostics: player.getPlaybackDiagnostics() }); break
        default: results.push({ ok: false, error: 'unknown_agent_action' })
      }
    } catch (error) {
      results.push({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
