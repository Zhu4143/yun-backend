export class YunPlayerAdapter {
  constructor(playerCore) {
    this.playerCore = playerCore
  }

  async execute(capability, action, args = {}) {
    const player = this.playerCore
    if (!player) throw new Error('player_core_unavailable')

    if (capability === 'yun.player.transport') {
      if (action === 'play' || action === 'resume') return player.play()
      if (action === 'pause') return player.pause()
      if (action === 'toggle') return player.togglePlay()
      if (action === 'next') return player.next(args.options)
      if (action === 'previous') return player.previous()
    }
    if (capability === 'yun.player.position' && action === 'seek') {
      player.seek(args.seconds)
      return { ok: true }
    }
    if (capability === 'yun.player.queue') {
      if (action === 'play_track') return player.playTrack(args.track, args.options)
      if (action === 'play_from_queue') return player.playTrackFromQueue(args.track, args.queue, args.options)
      if (action === 'set') { player.setPlaybackQueue(args.queue); return { ok: true } }
      if (action === 'clear') { player.clearPlaybackQueue(); return { ok: true } }
      if (action === 'set_queued_next') { player.setQueuedNextTrack(args.track); return { ok: true } }
      if (action === 'enqueue_up_next') { player.enqueueUpNext(args.track); return { ok: true } }
      if (action === 'clear_up_next') { player.clearUpNext(); return { ok: true } }
      if (action === 'set_auto_up_next') { player.setAutoUpNext(args.tracks, args.options); return { ok: true } }
    }
    if (capability === 'yun.player.settings') {
      if (action === 'set_volume') { player.setVolume(args.value); return { ok: true } }
      if (action === 'set_mode') { player.setPlaybackMode(args.mode); return { ok: true } }
    }
    if (capability === 'yun.player.crossfade' && action === 'get_state') {
      return player.getPlaybackDiagnostics()
    }
    throw new Error(`unsupported_player_operation:${capability}:${action}`)
  }

  async getState() {
    const state = this.playerCore?.getState?.()
    if (!state) throw new Error('player_core_unavailable')
    return {
      playback: {
        currentTrack: state.currentTrack,
        isPlaying: state.isPlaying,
        progress: {
          currentTime: state.currentTime,
          duration: state.duration,
        },
        queue: state.queue,
        volume: state.volume,
        playbackMode: state.playbackMode,
      },
    }
  }
}
