import { useCallback, useEffect, useRef, useState } from 'react'

function getSongId(song) {
  return song?.id || `${song?.title || ''}-${song?.artist || ''}`
}

function getSafeDuration(audio) {
  return Number.isFinite(audio.duration) ? audio.duration : 0
}

export function useLocalPlayer(playlist) {
  const audioRef = useRef(null)
  const playlistRef = useRef([])
  const currentSongRef = useRef(null)
  const playbackModeRef = useRef('sequence')

  const [currentSong, setCurrentSong] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackMode, setPlaybackModeState] = useState('sequence')

  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

  const playSong = useCallback(async (song) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    if (!audioRef.current) {
      audioRef.current = new Audio()
    }

    const audio = audioRef.current
    const currentId = getSongId(currentSongRef.current)
    const nextId = getSongId(song)

    if (currentId !== nextId) {
      audio.pause()
      audio.src = song.fileUrl
      audio.currentTime = 0
      currentSongRef.current = song
      setCurrentSong(song)
      setCurrentTime(0)
      setDuration(0)
    }

    try {
      await audio.play()
      setIsPlaying(true)
      return { ok: true, song }
    } catch (error) {
      setIsPlaying(false)
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }
  }, [])

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current

    if (!currentSongRef.current) {
      const firstSong = playlistRef.current[0]
      return firstSong ? playSong(firstSong) : { ok: false, error: 'empty_library' }
    }

    if (!audio) {
      return { ok: false, error: 'missing_audio' }
    }

    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
        return { ok: true, song: currentSongRef.current }
      } catch (error) {
        setIsPlaying(false)
        return {
          ok: false,
          song: currentSongRef.current,
          error: error instanceof Error ? error.message : 'play_failed',
        }
      }
    }

    audio.pause()
    setIsPlaying(false)
    return { ok: true, song: currentSongRef.current }
  }, [playSong])

  const getCurrentIndex = useCallback(() => {
    const currentId = getSongId(currentSongRef.current)
    return playlistRef.current.findIndex((song) => getSongId(song) === currentId)
  }, [])

  const playNext = useCallback(async () => {
    const songs = playlistRef.current

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    if (playbackModeRef.current === 'loop_one' && currentSongRef.current) {
      return playSong(currentSongRef.current)
    }

    const currentIndex = getCurrentIndex()
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % songs.length

    return playSong(songs[nextIndex])
  }, [getCurrentIndex, playSong])

  const playPrevious = useCallback(async () => {
    const songs = playlistRef.current

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    const currentIndex = getCurrentIndex()
    const previousIndex =
      currentIndex < 0 ? 0 : (currentIndex - 1 + songs.length) % songs.length

    return playSong(songs[previousIndex])
  }, [getCurrentIndex, playSong])

  const seekTo = useCallback((time) => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const nextTime = Math.max(0, Math.min(time, getSafeDuration(audio)))
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const setPlaybackMode = useCallback((mode) => {
    if (!['sequence', 'loop_one', 'loop_all', 'shuffle'].includes(mode)) {
      return
    }

    playbackModeRef.current = mode
    setPlaybackModeState(mode)
  }, [])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return undefined
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0)
      setDuration(getSafeDuration(audio))
    }

    const handleLoadedMetadata = () => {
      setDuration(getSafeDuration(audio))
    }

    const handlePlay = () => {
      setIsPlaying(true)
    }

    const handlePause = () => {
      setIsPlaying(false)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      playNext()
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [playNext, currentSong])

  useEffect(() => () => {
    audioRef.current?.pause()
  }, [])

  return {
    audioRef,
    currentSong,
    isPlaying,
    currentTime,
    duration,
    playbackMode,
    playSong,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    setPlaybackMode,
  }
}
