// Non-invasive observer over the `useLocalPlayer` return face.
//
// It wraps only the player methods to emit playback events, and watches the
// natural-end (`ended`) and auto-advance (`lastAutoNextSong`) transitions that
// cannot be seen through method calls. Every field it does not wrap passes
// through unchanged, so existing consumers keep working identically.
//
// End semantics:
//   playback.play_ended_natural = the audio element actually reached `ended`.
//   playback.auto_advanced      = the system advanced to the next track (always
//                                 emitted; its reason carries the cause).
// A natural end emits both `play_ended_natural` and `auto_advanced` (reason
// `natural_end`); an early skip emits only `auto_advanced` (reason
// `early_skip`).

import { useEffect, useRef } from 'react'
import emitter from './emitter.js'
import { autoAdvanceOutcome } from './logic.js'

function trackId(song) {
  if (!song) return ''
  return String(song.id || song.providerId || `${song.title || ''}-${song.artist || ''}` || '')
}

function trackSource(song) {
  if (!song) return 'none'
  return song.source === 'netease' ? 'netease' : 'local'
}

function safeEmit(telemetry, type, payload, opts) {
  try {
    telemetry.emit(type, payload, opts)
  } catch {
    // noop
  }
}

export function usePlayerObserver(player, telemetry = emitter) {
  const prevAutoNextRef = useRef({ autoNextId: null })
  const naturalEndPendingRef = useRef(false)

  // Definitive natural-end signal: the active audio element fires `ended` only
  // when the song plays to its real end. Early crossfade never fires it.
  useEffect(() => {
    const audio = player?.audioRef?.current
    if (!audio) return undefined
    const handleEnded = () => {
      const endedTrackId = trackId(player.currentSong)
      naturalEndPendingRef.current = true
      safeEmit(
        telemetry,
        'playback.play_ended_natural',
        { trackId: endedTrackId, reason: 'natural_end' },
        { domain: 'playback', actor: 'auto' },
      )
    }
    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [player, telemetry])

  // Auto-advance: `lastAutoNextSong` updates once useLocalPlayer's natural-end
  // or early-skip handler resolves.
  useEffect(() => {
    if (!player) return
    const autoNext = player.lastAutoNextSong
    const autoNextId = autoNext ? `${autoNext.id}-${trackId(autoNext.song)}` : null

    if (autoNextId && autoNextId !== prevAutoNextRef.current.autoNextId) {
      const advancedTrackId = autoNext.song ? trackId(autoNext.song) : String(autoNext.id || '')
      const outcome = autoAdvanceOutcome({
        naturalEndPending: naturalEndPendingRef.current,
        playbackMode: player.playbackMode,
      })
      naturalEndPendingRef.current = false

      // The auto-advance itself is always recorded, regardless of whether the
      // previous song finished or was skipped early. Its `reason` carries the
      // cause; natural completion is reported separately by play_ended_natural.
      safeEmit(
        telemetry,
        'playback.auto_advanced',
        { trackId: advancedTrackId, reason: outcome.reason },
        { domain: 'playback', actor: 'auto' },
      )
      if (outcome.recommendAccepted) {
        safeEmit(
          telemetry,
          'recommendation.accepted',
          { trackId: advancedTrackId, mode: player.playbackMode, reason: outcome.reason },
          { domain: 'recommendation', actor: 'auto' },
        )
      }
    }

    prevAutoNextRef.current = { autoNextId }
  }, [player, telemetry])

  if (!player) return player

  const asEvent = (type, payload, opts) => [type, payload, opts]
  const failed = (tool, error) => asEvent('tool.failed', { tool, error }, { domain: 'tool', actor: 'system' })

  const wrap = (methodName, makeEvent, makeFailureEvent) => (...args) => {
    // Any explicit playback action invalidates a pending natural-end flag so a
    // stale `ended` (e.g. after the queue ran out) never suppresses a later
    // genuine early skip.
    naturalEndPendingRef.current = false

    if (makeEvent) {
      const event = makeEvent(args, player)
      if (event) safeEmit(telemetry, ...event)
    }

    let result
    try {
      result = player[methodName](...args)
    } catch (error) {
      if (makeFailureEvent) {
        const event = makeFailureEvent(error instanceof Error ? error.message : String(error))
        if (event) safeEmit(telemetry, ...event)
      }
      throw error
    }

    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => {
          if (makeFailureEvent && value && value.ok === false) {
            const event = makeFailureEvent(value.error || 'playback_failed')
            if (event) safeEmit(telemetry, ...event)
          }
          return value
        },
        (error) => {
          if (makeFailureEvent) {
            const event = makeFailureEvent(error instanceof Error ? error.message : String(error))
            if (event) safeEmit(telemetry, ...event)
          }
          throw error
        },
      )
    }

    return result
  }

  return {
    ...player,
    playNext: wrap('playNext', (args, p) => (
      args[0]?.auto === true
        ? null
        : asEvent(
          'playback.skip_manual',
          { trackId: trackId(p.currentSong), reason: 'user_next' },
          { domain: 'playback', actor: 'user', source: args[0]?.fromRadioQueue ? 'radio_queue' : 'control' },
        )
    ), (error) => failed('play_next', error)),
    playPrevious: wrap('playPrevious', () => asEvent(
      'playback.previous',
      { reason: 'user_previous' },
      { domain: 'playback', actor: 'user' },
    ), (error) => failed('play_previous', error)),
    pausePlayback: wrap('pausePlayback', (args, p) => asEvent(
      'playback.pause',
      { trackId: trackId(p.currentSong), reason: 'user_pause' },
      { domain: 'playback', actor: 'user' },
    )),
    togglePlayPause: wrap('togglePlayPause', (args, p) => asEvent(
      p.isPlaying ? 'playback.pause' : 'playback.resume',
      { trackId: trackId(p.currentSong), reason: p.isPlaying ? 'user_pause' : 'user_resume' },
      { domain: 'playback', actor: 'user' },
    ), (error) => failed('toggle_play', error)),
    seekTo: wrap('seekTo', (args, p) => asEvent(
      'playback.seek',
      { positionSec: Number(args[0]) || 0, trackId: trackId(p.currentSong) },
      { domain: 'playback', actor: 'user' },
    )),
    playSong: wrap('playSong', (args) => asEvent(
      'playback.play_started',
      { trackId: trackId(args[0]), trackSource: trackSource(args[0]) },
      { domain: 'playback', actor: 'user', source: (args[1] && args[1].source) || 'user' },
    ), (error) => failed('play_song', error)),
    playSongFromQueue: wrap('playSongFromQueue', (args) => asEvent(
      'playback.play_started',
      { trackId: trackId(args[0]), trackSource: trackSource(args[0]), queueLength: Array.isArray(args[1]) ? args[1].length : 0 },
      { domain: 'playback', actor: 'user', source: 'queue' },
    ), (error) => failed('play_from_queue', error)),
    setPlaybackMode: wrap('setPlaybackMode', (args) => asEvent(
      'playback.mode_changed',
      { mode: args[0] },
      { domain: 'playback', actor: 'user' },
    )),
  }
}
