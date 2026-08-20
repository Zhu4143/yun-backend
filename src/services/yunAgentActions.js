import { addSongToNeteaseCollection, fetchNeteaseAiRecommendations, fetchNeteaseMe, fetchNeteasePlaylistTracks, searchNeteaseSongs } from '../api/neteaseApi.js'
import { resolveMusicStructureSeek } from '../api/musicIntelligenceApi.js'

function compactText(value) {
  return String(value || '').toLowerCase().replace(/[\s，。！？、,.!?~…《》「」“”"']/g, '')
}

export async function executeYunAgentActions(actions, { player, voice, context = {}, isCurrentRequest = () => true } = {}) {
  const results = []
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!isCurrentRequest()) {
      results.push({ ok: false, cancelled: true })
      break
    }
    try {
      const payload = action?.payload || {}
      switch (action?.type) {
        case 'music.next': results.push(await player?.playNext?.()); break
        case 'music.previous': results.push(await player?.playPrevious?.()); break
        case 'music.pause': results.push(player?.pausePlayback?.() || { ok: false }); break
        case 'music.resume': results.push(await player?.togglePlayPause?.()); break
        case 'music.seek': player?.seekTo?.(payload.seconds); results.push({ ok: true }); break
        case 'music.set_mode': player?.setPlaybackMode?.(payload.mode); results.push({ ok: true }); break
        case 'music.set_response_mode': player?.setResponseMode?.(payload.mode); results.push({ ok: true }); break
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
          player?.setPlaybackMode?.('sequence')
          results.push(tracks[0]
            ? await player?.playSongFromQueue?.(tracks[0], tracks, { crossfade: Boolean(player?.currentSong) })
            : { ok: false, error: 'netease_playlist_empty' })
          break
        }
        case 'music.play_track': results.push(await player?.playSong?.(payload.track, { crossfade: Boolean(player?.currentSong) })); break
        case 'music.recommend': {
          const tracks = await fetchNeteaseAiRecommendations({ currentSong: context.currentSong, playHistory: context.playHistory || [], recentRecommendations: context.recentRecommendations || [], limit: payload.limit || 4 })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) player?.setAutoUpNext?.(tracks.slice(1), { replace: true })
          results.push(tracks[0] ? await player?.playSongFromQueue?.(tracks[0], tracks, { crossfade: Boolean(player?.currentSong) }) : { ok: false, error: 'no_recommendation' })
          break
        }
        case 'music.search_netease': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 8))
          const tracks = await searchNeteaseSongs(payload.query, { limit })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (payload.queue) player?.setAutoUpNext?.(tracks.slice(1), { replace: true })
          results.push(tracks[0] ? await player?.playSongFromQueue?.(tracks[0], tracks, { crossfade: Boolean(player?.currentSong) }) : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.prepare_queue': {
          const limit = Math.max(1, Math.min(8, Number(payload.limit) || 4))
          const tracks = await searchNeteaseSongs(payload.query, { limit })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          player?.setAutoUpNext?.(tracks, { replace: true })
          results.push(tracks.length ? { ok: true, prepared: tracks.length } : { ok: false, error: 'no_search_result' })
          break
        }
        case 'music.analyze_section': {
          const resolved = await resolveMusicStructureSeek(context.currentSong, { target: payload.target, occurrence: 'first' })
          if (!isCurrentRequest()) {
            results.push({ ok: false, cancelled: true })
            break
          }
          if (resolved?.ok) player?.seekTo?.(resolved.positionSec)
          results.push(resolved)
          break
        }
        case 'tts.speak': results.push(await voice?.speakText?.(payload.text, { allowBargeIn: true })); break
        case 'music.get_state': results.push({ ok: true, diagnostics: player?.getPlaybackDiagnostics?.() || null }); break
        default: results.push({ ok: false, error: 'unknown_agent_action' })
      }
    } catch (error) {
      results.push({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
