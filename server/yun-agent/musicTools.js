// Declarative music tools. They never touch browser playback directly: the
// agent returns a validated action plan and the renderer executes it through
// the existing PlayerCore boundary.

function action(type, payload = {}) {
  return { type, payload }
}

function findTrack(library, trackId) {
  return (Array.isArray(library) ? library : []).find((track) => String(track.id) === String(trackId)) || null
}

export function createMusicTools() {
  return [
    { name: 'music_get_state', description: 'Read the current playback state.', parameters: {}, handler: async (_, context) => action('music.get_state', { playback: context.playback || {} }) },
    { name: 'music_next', description: 'Skip to the next track.', parameters: {}, handler: async () => action('music.next') },
    { name: 'music_previous', description: 'Return to the previous track.', parameters: {}, handler: async () => action('music.previous') },
    { name: 'music_pause', description: 'Pause music playback.', parameters: {}, handler: async () => action('music.pause') },
    { name: 'music_resume', description: 'Resume music playback.', parameters: {}, handler: async () => action('music.resume') },
    { name: 'music_seek', description: 'Seek the current track to an absolute second.', parameters: { seconds: 'number' }, handler: async ({ seconds }) => action('music.seek', { seconds }) },
    { name: 'music_set_mode', description: 'Set playback mode: sequence, shuffle, loop_one, ai_recommend, or companion_continue.', parameters: { mode: 'string' }, handler: async ({ mode }) => action('music.set_mode', { mode }) },
    { name: 'music_set_response_mode', description: 'Set response mode: companion, podcast, silent, or normal.', parameters: { mode: 'string' }, handler: async ({ mode }) => action('music.set_response_mode', { mode }) },
    { name: 'music_add_to_collection', description: 'Add the current playing song to the user\'s NetEase liked collection.', parameters: {}, requiresOnline: true, handler: async () => action('music.add_to_collection', { target: 'liked' }) },
    { name: 'music_play_netease_playlist', description: 'Play one of the user\'s NetEase playlists by its exact name.', parameters: { playlistName: 'string' }, requiresOnline: true, handler: async ({ playlistName }) => action('music.play_netease_playlist', { playlistName: playlistName.slice(0, 80) }) },
    { name: 'music_play_track', description: 'Play a track from the supplied local library by id.', parameters: { trackId: 'string' }, handler: async ({ trackId }, context) => {
      const track = findTrack(context.library, trackId)
      if (!track) throw new Error('track_not_found')
      return action('music.play_track', { track })
    } },
    { name: 'music_search_netease', description: 'Search NetEase Cloud Music and play the best matching result.', parameters: { query: 'string' }, requiresOnline: true, handler: async ({ query }) => action('music.search_netease', { query: query.slice(0, 80) }) },
    { name: 'music_prepare_queue', description: 'Search NetEase Cloud Music and add matching tracks to the up-next queue without changing the current song.', parameters: { query: 'string' }, requiresOnline: true, handler: async ({ query }) => action('music.prepare_queue', { query: query.slice(0, 80) }) },
    { name: 'music_recommend', description: 'Ask the renderer to fetch and play a NetEase recommendation.', parameters: {}, requiresOnline: true, handler: async () => action('music.recommend') },
    { name: 'music_analyze_section', description: 'Find a section in the current song and seek to it.', parameters: { target: 'string' }, handler: async ({ target }) => action('music.analyze_section', { target }) },
    { name: 'music_read_comments', description: 'Read a few popular NetEase comments for the currently playing song aloud. This only reads public comments and does not post anything.', parameters: {}, requiresOnline: true, handler: async () => action('music.read_comments', { limit: 3 }) },
    { name: 'tts_speak', description: 'Speak a short response using Yun TTS.', parameters: { text: 'string' }, handler: async ({ text }) => action('tts.speak', { text: text.slice(0, 240) }) },
  ]
}
