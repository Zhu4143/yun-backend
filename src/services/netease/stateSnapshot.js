function unavailableField(source, updatedAt) {
  return { available: false, value: null, source, updatedAt }
}

function stateField(value, source, updatedAt) {
  if (value === undefined || value === null) return unavailableField(source, updatedAt)
  return { available: true, value, source, updatedAt }
}

async function readAdapterState(adapter) {
  if (!adapter?.getState) return null
  try {
    return await adapter.getState()
  } catch {
    return null
  }
}

export async function getNeteaseStateSnapshot({ apiAdapter = null, playerAdapter = null, desktopAdapter = null, now = () => new Date() } = {}) {
  const updatedAt = now().toISOString()
  const [apiState, playerState, desktopState] = await Promise.all([
    readAdapterState(apiAdapter),
    readAdapterState(playerAdapter),
    readAdapterState(desktopAdapter),
  ])

  return {
    account: {
      loggedIn: stateField(apiState?.account?.loggedIn, 'api', updatedAt),
      membership: stateField(apiState?.account?.membership, 'api', updatedAt),
    },
    playback: {
      currentTrack: stateField(playerState?.playback?.currentTrack, 'player', updatedAt),
      isPlaying: stateField(playerState?.playback?.isPlaying, 'player', updatedAt),
      progress: stateField(playerState?.playback?.progress, 'player', updatedAt),
      queue: stateField(playerState?.playback?.queue, 'player', updatedAt),
    },
    audio: {
      quality: stateField(desktopState?.audio?.quality, 'desktop', updatedAt),
      currentStreamQuality: stateField(playerState?.playback?.currentTrack?.streamLevel, 'player', updatedAt),
      soundEffect: stateField(desktopState?.audio?.soundEffect, 'desktop', updatedAt),
      volume: stateField(playerState?.playback?.volume, 'player', updatedAt),
      outputDevice: stateField(desktopState?.audio?.outputDevice, 'desktop', updatedAt),
    },
    library: {
      likedStatus: stateField(apiState?.library?.likedStatus, 'api', updatedAt),
      currentPlaylist: stateField(apiState?.library?.currentPlaylist, 'api', updatedAt),
      playlists: stateField(apiState?.library?.playlists, 'api', updatedAt),
      playlistsCount: stateField(apiState?.library?.playlistsCount, 'api', updatedAt),
      recentCount: stateField(apiState?.library?.recentCount, 'api', updatedAt),
      cloudCount: stateField(apiState?.library?.cloudCount, 'api', updatedAt),
      podcastCount: stateField(apiState?.library?.podcastCount, 'api', updatedAt),
      likedCount: stateField(apiState?.library?.likedCount, 'api', updatedAt),
      subscriptionCounts: stateField(apiState?.library?.subscriptionCounts, 'api', updatedAt),
    },
    recommendation: {
      dailySongsAvailable: stateField(apiState?.recommendation?.dailySongs, 'api', updatedAt),
      dailyPlaylistsAvailable: stateField(apiState?.recommendation?.dailyPlaylists, 'api', updatedAt),
      personalFmAvailable: stateField(apiState?.recommendation?.personalFm, 'api', updatedAt),
    },
  }
}
