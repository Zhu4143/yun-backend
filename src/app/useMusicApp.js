import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { analyzeMusicLibraryTags, fetchMusicLibrary, importMusicFiles, scanMusicLibrary } from '../api/yunApi.js'
import { fetchNeteaseMePage, fetchNeteasePlaylistTracks, searchNeteaseSongs } from '../api/neteaseApi.js'
import { requestRadioPrefetch } from '../api/radioApi.js'
import { transcribeAudio } from '../api/asrApi.js'
import { useLocalPlayer } from '../hooks/useLocalPlayer.js'
import { useYunChat } from '../hooks/useYunChat.js'
import { useYunMemory } from '../hooks/useYunMemory.js'
import { useYunVoice } from '../hooks/useYunVoice.js'
import { useYunAgent } from '../hooks/useYunAgent.js'
import { useYunWakeWord } from '../hooks/useYunWakeWord.js'
import { useVoiceSessionController } from '../hooks/useVoiceSessionController.js'
import { useCowAgentYunBridge } from '../hooks/useCowAgentYunBridge.js'
import { createYunLegacyPlayerAdapter } from '../player/adapters/yunLegacyPlayerAdapter.js'
import { usePlayer } from '../player/react/usePlayer.js'
import { usesAutomaticNextQueue } from '../player/playback/playbackOrchestration.js'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'
import { createWavBlob } from '../services/voiceprintApi.js'
import { createCaptureOperationQueue } from './voiceCaptureLifecycle.js'
import { createAccountReadAuthority, shouldIgnorePlaybackShortcut, shouldPlayVoice } from './musicAppPolicy.js'
import { isValidPlaylist, loadPaginatedCollection } from '../boot/playlistLoader.js'
import { createContinuousVoiceCall, isCompanionCallEnd, normalizeCompanionTranscript } from './continuousVoiceCall.js'

const RESPONSE_MODE_KEY = 'yun_response_mode'
const RESPONSE_MODES = ['normal', 'podcast', 'companion', 'silent']

function readStoredJson(key, fallback = null) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') || fallback } catch { return fallback }
}

function trackKey(track) {
  return String(track?.providerId || track?.id || track?.fileUrl || '').replace(/^netease-/, '')
}

function uniqueTracks(tracks) {
  const seen = new Set()
  return tracks.filter((track) => {
    const key = trackKey(track)
    if (!track?.fileUrl || !key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : typeof error === 'string' && error.trim() ? error : fallback
}

// Manual capture shares the existing single microphone owner. Nothing starts
// until start() is invoked; stop() submits, while stop({ cancel: true }) aborts.
function useManualVoiceInput({ controller, sendMessage, stopSpeaking, onFailure }) {
  const [starting, setStarting] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState('')
  const [manager] = useState(getSharedAudioCaptureManager)
  const [captureOperations] = useState(createCaptureOperationQueue)
  const captureRef = useRef(null)
  const epochRef = useRef(0)
  const requestRef = useRef(null)
  const finishRef = useRef(null)
  const sendRef = useRef(sendMessage)
  const failureRef = useRef(onFailure)

  useLayoutEffect(() => { sendRef.current = sendMessage }, [sendMessage])
  useLayoutEffect(() => { failureRef.current = onFailure }, [onFailure])

  const releaseCapture = useCallback(async (capture) => {
    if (!capture) return captureOperations.idle()
    capture.unsubscribe?.()
    window.clearTimeout(capture.timer)
    // AudioContext.close() is asynchronous. Serialize ownership changes so an
    // older close cannot clear the stream created by a rapid second start.
    await captureOperations.run(() => manager.setOwner('none')).catch(() => {})
  }, [captureOperations, manager])

  useLayoutEffect(() => controller.registerSessionCancellation(() => {
    epochRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    const capture = captureRef.current
    captureRef.current = null
    setListening(false)
    setStarting(false)
    setTranscribing(false)
    void releaseCapture(capture)
  }), [controller, releaseCapture])

  const finishCapture = useCallback(async () => {
    const capture = captureRef.current
    if (!capture) return false
    captureRef.current = null
    setListening(false)
    controller.userSpeechEnded()
    const hasSpeech = capture.speechAt > 0 && capture.chunks.length > 0
    if (hasSpeech) {
      setTranscribing(true)
      controller.transcriptionStarted()
    }
    await releaseCapture(capture)
    if (capture.epoch !== epochRef.current) return false
    if (!hasSpeech) {
      setError('没有听到声音，请再试一次。')
      controller.endSession('no_speech')
      failureRef.current?.('no_speech')
      return false
    }
    const abort = new AbortController()
    requestRef.current = abort
    try {
      const result = await transcribeAudio(createWavBlob(capture.chunks, capture.sampleRate), { signal: abort.signal })
      if (capture.epoch !== epochRef.current || abort.signal.aborted) return false
      const text = String(result.text || result.transcript || '').trim()
      if (!text) {
        setError('没有识别到文字，请再试一次。')
        controller.endSession('empty_transcript')
        failureRef.current?.('empty_transcript')
        return false
      }
      setTranscribing(false)
      return await sendRef.current(text, { inputMode: 'voice' })
    } catch (nextError) {
      if (capture.epoch === epochRef.current && !abort.signal.aborted) {
        setError(errorMessage(nextError, '语音识别失败，请检查声音设置。'))
        controller.endSession('transcription_failed')
        failureRef.current?.('transcription_failed')
      }
      return false
    } finally {
      if (requestRef.current === abort) requestRef.current = null
      if (capture.epoch === epochRef.current) setTranscribing(false)
    }
  }, [controller, releaseCapture])

  useLayoutEffect(() => { finishRef.current = finishCapture }, [finishCapture])

  const stop = useCallback(({ cancel = false } = {}) => {
    if (!cancel && captureRef.current) return finishCapture()
    epochRef.current += 1
    const capture = captureRef.current
    captureRef.current = null
    requestRef.current?.abort()
    requestRef.current = null
    setListening(false)
    setStarting(false)
    setTranscribing(false)
    controller.endSession('voice_input_cancelled')
    return releaseCapture(capture).then(() => false)
  }, [controller, finishCapture, releaseCapture])

  const start = useCallback(async () => {
    await stop({ cancel: true })
    const epoch = ++epochRef.current
    setStarting(true)
    setError('')
    stopSpeaking()
    controller.beginSession()
    controller.userSpeechStarted()
    const capture = { epoch, chunks: [], sampleRate: 16000, speechAt: 0, startedAt: Date.now(), timer: 0, unsubscribe: null }
    captureRef.current = capture
    try {
      await captureOperations.run(async () => {
        await manager.setOwner('browser')
        await manager.start()
      })
      if (captureRef.current !== capture || epoch !== epochRef.current) {
        return false
      }
      capture.startedAt = Date.now()
      capture.unsubscribe = manager.subscribe((frame) => {
        if (captureRef.current !== capture) return
        capture.chunks.push(frame.samples)
        capture.sampleRate = frame.sampleRate
        let sum = 0
        for (const sample of frame.samples) sum += sample * sample
        const rms = Math.sqrt(sum / Math.max(1, frame.samples.length))
        const now = Date.now()
        if (rms > 0.012) capture.speechAt = now
        const silenceEnded = capture.speechAt && now - capture.speechAt > 1200
        const noSpeech = !capture.speechAt && now - capture.startedAt > 7000
        if (silenceEnded || noSpeech) void finishRef.current?.()
      })
      capture.timer = window.setTimeout(() => { void finishRef.current?.() }, 20000)
      setListening(true)
      setStarting(false)
      return true
    } catch (nextError) {
      if (captureRef.current === capture) {
        captureRef.current = null
        await releaseCapture(capture)
        if (epoch === epochRef.current) {
          setError(errorMessage(nextError, '无法使用麦克风，请检查浏览器权限。'))
          setListening(false)
          setStarting(false)
          controller.endSession('capture_failed')
          failureRef.current?.('capture_failed')
        }
      }
      return false
    }
  }, [captureOperations, controller, manager, releaseCapture, stop, stopSpeaking])

  useEffect(() => () => {
    epochRef.current += 1
    requestRef.current?.abort()
    const capture = captureRef.current
    captureRef.current = null
    void releaseCapture(capture)
  }, [releaseCapture])

  return { starting, listening, transcribing, error, start, stop, supported: Boolean(navigator.mediaDevices?.getUserMedia) }
}

/** Headless production UI boundary. No canvas, animation, avatar or gesture imports. */
export function useMusicApp({ bootData = {}, bootState = null } = {}) {
  const bootLibrary = bootData.LOAD_LIBRARY
  const bootAccount = bootData.LOAD_PLAYLISTS?.account || bootData.INIT_MUSIC_PROVIDER || null
  const [songs, setSongs] = useState(() => bootLibrary?.songs || [])
  const [libraryStatus, setLibraryStatus] = useState(bootLibrary ? 'ready' : 'idle')
  const [libraryError, setLibraryError] = useState('')
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState(() => bootData.BACKEND_HEALTH?.compatibilityNotice || '')
  const [composerDraft, setComposerDraft] = useState('')
  const libraryEpoch = useRef(0)
  const importBusy = useRef(false)
  const [accountInfo, setAccountInfo] = useState(bootAccount)
  const [accountStatus, setAccountStatus] = useState(bootAccount ? 'ready' : 'idle')
  const [accountError, setAccountError] = useState('')
  const [playlistSongs, setPlaylistSongs] = useState([])
  const [playlistStatus, setPlaylistStatus] = useState('idle')
  const [activePlaylist, setActivePlaylist] = useState(null)
  const [accountAuthority] = useState(createAccountReadAuthority)
  const accountRequestRef = useRef(null)
  const playlistRequestRef = useRef(null)
  const playlistEpoch = useRef(0)
  const [searchResults, setSearchResults] = useState([])
  const [searchStatus, setSearchStatus] = useState('idle')
  const [searchError, setSearchError] = useState('')
  const searchEpoch = useRef(0)
  const [responseMode, setResponseModeState] = useState(() => {
    const stored = window.localStorage.getItem(RESPONSE_MODE_KEY)
    return RESPONSE_MODES.includes(stored) ? stored : 'normal'
  })
  const setResponseMode = useCallback((mode) => {
    if (!RESPONSE_MODES.includes(mode)) return
    setResponseModeState(mode)
    window.localStorage.setItem(RESPONSE_MODE_KEY, mode)
  }, [])

  const [restoreState] = useState(() => bootData.RESTORE_PLAYER || readStoredJson('yun_player_session_v1'))
  const localPlayer = useLocalPlayer(songs, { restoreState, onPlaybackError: setNotice })
  const [playerCore] = useState(() => bootData.INIT_PLAYER_CORE || createYunLegacyPlayerAdapter())
  const playerState = usePlayer(playerCore)
  useLayoutEffect(() => {
    playerCore.updateLegacy(localPlayer)
    playerCore.flush()
  }, [localPlayer, playerCore])
  useEffect(() => () => playerCore.dispose(), [playerCore])
  const currentSong = playerState.currentTrack
  const { controller: voiceController, snapshot: voiceSnapshot } = useVoiceSessionController()
  const rawVoice = useYunVoice({ musicAudioRef: localPlayer.audioRef, musicDuckingController: localPlayer.musicDuckingController })
  // Ordinary replies respect automatic reading; an explicitly forced action
  // such as a deliberate companion transition retains its speech contract.
  const automaticVoice = useMemo(() => ({
    ...rawVoice,
    speakText: (text, options) => shouldPlayVoice(rawVoice.settings, options) ? rawVoice.speakText(text, options) : Promise.resolve(true),
  }), [rawVoice])
  // LOAD_MEMORY is nonblocking. Keep this hook's seed fixed so a late boot
  // result cannot cancel its own fallback read without applying that result.
  const [memorySeed] = useState(() => ({ settings: bootData.LOAD_SETTINGS, memory: bootData.LOAD_MEMORY }))
  const rawMemory = useYunMemory(memorySeed)
  const agent = useYunAgent({ player: playerCore, playerState, setResponseMode, voice: automaticVoice, libraryTracks: songs, currentSong })
  const chat = useYunChat({ currentSong, libraryTracks: songs, player: playerCore, setResponseMode, voice: automaticVoice,
    responseMode, playbackMode: playerState.playbackMode, personaMode: 'warm',
    musicSource: currentSong?.source === 'netease' ? 'netease' : 'local', memory: rawMemory, agent })
  const chatSendRef = useRef(chat.sendMessage)
  const chatCancelRef = useRef(chat.cancelActiveRequest)
  useLayoutEffect(() => {
    chatSendRef.current = chat.sendMessage
    chatCancelRef.current = chat.cancelActiveRequest
  }, [chat.sendMessage, chat.cancelActiveRequest])
  useLayoutEffect(() => voiceController.registerSessionCancellation((reason) => chatCancelRef.current(reason)), [voiceController])

  const sendMessage = useCallback((text, options = {}) => {
    if (!String(text || '').trim() && !options.imageFile) return Promise.resolve(false)
    voiceController.cancelResponse(undefined, 'new_user_turn')
    const responseId = voiceController.startResponse()
    const abortController = voiceController.createAbortController(responseId)
    return chatSendRef.current(text, { ...options, responseId, abortController })
  }, [voiceController])
  const [continuous, setContinuous] = useState(false)
  const [nativeEnabled, setNativeEnabledState] = useState(false)
  const [nativeChanging, setNativeChanging] = useState(false)
  const [nativeStatus, setNativeStatus] = useState('已关闭')
  const [continuousCall] = useState(createContinuousVoiceCall)
  const callControlsRef = useRef(null)
  const sendVoiceMessage = useCallback((text, options) => {
    const transcript = normalizeCompanionTranscript(text)
    if (continuousCall.isActive() && isCompanionCallEnd(transcript)) {
      callControlsRef.current?.stop('spoken_end')
      setNotice('连续语音陪聊已结束')
      return Promise.resolve(true)
    }
    return sendMessage(transcript, options)
  }, [continuousCall, sendMessage])
  const onVoiceFailure = useCallback((reason) => callControlsRef.current?.stop(reason), [])
  const manualVoiceInput = useManualVoiceInput({ controller: voiceController, sendMessage: sendVoiceMessage,
    stopSpeaking: rawVoice.stopSpeaking, onFailure: onVoiceFailure })
  const { start: startManualVoice, stop: stopManualVoice, starting: voiceStarting, listening: voiceListening, transcribing: voiceTranscribing } = manualVoiceInput
  const stopContinuous = useCallback((reason = 'manual_stop') => {
    const wasActive = continuousCall.isActive()
    continuousCall.stop()
    setContinuous(false)
    if (wasActive) {
      void stopManualVoice({ cancel: true })
      voiceController.endSession(reason)
    }
  }, [continuousCall, stopManualVoice, voiceController])
  const startContinuous = useCallback(async () => {
    const token = continuousCall.start()
    setContinuous(true)
    const started = await startManualVoice()
    if (!started && continuousCall.isCurrent(token)) stopContinuous('capture_failed')
    return started
  }, [continuousCall, startManualVoice, stopContinuous])
  useLayoutEffect(() => { callControlsRef.current = { stop: stopContinuous } }, [stopContinuous])
  useLayoutEffect(() => voiceController.registerSessionCancellation((reason) => {
    if (!['memory_disabled', 'component_unmounted', 'user_stop'].includes(reason)) return
    continuousCall.stop()
    setContinuous(false)
  }), [continuousCall, voiceController])
  useEffect(() => {
    const busy = voiceStarting || voiceListening || voiceTranscribing
      || chat.isThinking || rawVoice.isPreparingSpeech || rawVoice.isSpeaking
    continuousCall.resumeAfter({ busy, lastSpeechEndedAt: rawVoice.lastSpeechEndedAt }, (token) => {
      void startManualVoice().then((started) => {
        if (!started && continuousCall.isCurrent(token)) stopContinuous('capture_failed')
      })
    })
    return continuousCall.clearResume
  }, [continuous, continuousCall, startManualVoice, voiceStarting, voiceListening,
    voiceTranscribing, chat.isThinking, rawVoice.isPreparingSpeech, rawVoice.isSpeaking, rawVoice.lastSpeechEndedAt, stopContinuous])
  useEffect(() => () => continuousCall.stop(), [continuousCall])
  const stopVoiceInput = useCallback((options = {}) => {
    if (options.cancel) {
      continuousCall.stop()
      setContinuous(false)
    }
    return stopManualVoice(options)
  }, [continuousCall, stopManualVoice])
  const voiceInput = { ...manualVoiceInput, stop: stopVoiceInput, continuous, startContinuous, stopContinuous }
  const wake = useYunWakeWord({
    suspended: nativeEnabled || continuous || voiceInput.starting || voiceInput.listening || voiceInput.transcribing || rawVoice.isSpeaking || rawVoice.isPreparingSpeech || chat.isThinking,
    onWake: startManualVoice,
  })
  const setBrowserWake = wake.setEnabled
  const setNativeEnabled = useCallback(async enabled => {
    setNativeChanging(true)
    try {
      await stopVoiceInput({ cancel: true })
      if (enabled) {
        setBrowserWake(false)
        setNativeStatus('正在连接桌面语音')
        setNativeEnabledState(true)
      } else {
        setNativeEnabledState(false)
        await fetch('/api/native-voice/stop', { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {})
        await getSharedAudioCaptureManager().setOwner('none')
        setNativeStatus('已关闭')
      }
    } finally { setNativeChanging(false) }
  }, [setBrowserWake, stopVoiceInput])
  const memory = useMemo(() => ({
    ...rawMemory,
    setMemoryEnabled: (enabled) => {
      if (!enabled) voiceController.cancelResponse(undefined, 'memory_disabled')
      return rawMemory.setMemoryEnabled(enabled)
    },
    setMemoryMode: (mode) => {
      if (mode === 'off') voiceController.cancelResponse(undefined, 'memory_disabled')
      return rawMemory.setMemoryMode(mode)
    },
  }), [rawMemory, voiceController])

  useEffect(() => {
    let responseId = voiceController.getSnapshot().responseId
    if (rawVoice.isPreparingSpeech && !responseId) responseId = voiceController.startResponse()
    if (rawVoice.isSpeaking) voiceController.outputStarted(responseId)
    if (!chat.isThinking && !rawVoice.isSpeaking && !rawVoice.isPreparingSpeech && responseId) {
      const timer = window.setTimeout(() => voiceController.outputEnded(responseId), 250)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [chat.isThinking, rawVoice.isPreparingSpeech, rawVoice.isSpeaking, voiceController, voiceSnapshot.responseId])
  useCowAgentYunBridge({ player: playerCore, voice: automaticVoice, currentSong, playHistory: chat.playHistory,
    recentRecommendations: chat.recentRecommendations, onRemoteTurn: chat.appendRemoteTurn,
    onRemoteOutcome: ({ reply }) => chat.appendRemoteTurn({ reply }) })

  const refreshLibrary = useCallback(async ({ scan = false } = {}) => {
    const epoch = ++libraryEpoch.current
    setLibraryStatus('loading')
    setLibraryError('')
    try {
      const result = await (scan ? scanMusicLibrary() : fetchMusicLibrary())
      if (epoch !== libraryEpoch.current) return []
      setSongs(result.songs)
      setLibraryStatus('ready')
      return result.songs
    } catch (error) {
      if (epoch === libraryEpoch.current) {
        setLibraryStatus('error')
        setLibraryError(errorMessage(error, '曲库读取失败'))
      }
      return []
    }
  }, [])
  const importFiles = useCallback(async (files) => {
    if (!files?.length || importBusy.current) return []
    importBusy.current = true
    setImporting(true)
    const epoch = ++libraryEpoch.current
    setLibraryStatus('loading')
    setLibraryError('')
    try {
      const result = await importMusicFiles(files)
      if (epoch === libraryEpoch.current) {
        setSongs(result.songs)
        setLibraryStatus('ready')
        setNotice('歌曲已导入本地曲库')
      }
      return result.songs
    } catch (error) {
      if (epoch === libraryEpoch.current) {
        setLibraryStatus('error')
        setLibraryError(errorMessage(error, '歌曲导入失败'))
      }
      return []
    } finally {
      importBusy.current = false
      setImporting(false)
    }
  }, [])
  const analyzeLibrary = useCallback(async () => {
    const epoch = ++libraryEpoch.current
    setLibraryStatus('loading')
    setLibraryError('')
    try {
      const result = await analyzeMusicLibraryTags({ limit: 80 })
      if (epoch === libraryEpoch.current) {
        setSongs(result.library.songs)
        setLibraryStatus('ready')
      }
      return result.library.songs
    } catch (error) {
      if (epoch === libraryEpoch.current) {
        setLibraryStatus('error')
        setLibraryError(errorMessage(error, 'AI 曲库理解失败'))
      }
      return []
    }
  }, [])
  const refreshAccount = useCallback(async () => {
    const epoch = accountAuthority.beginRefresh()
    accountRequestRef.current?.abort()
    const request = new AbortController()
    accountRequestRef.current = request
    setAccountStatus('loading')
    setAccountError('')
    try {
      const firstPage = await fetchNeteaseMePage({ offset: 0, limit: 80, signal: request.signal })
      const collection = firstPage.loggedIn ? await loadPaginatedCollection({
        initialPage: firstPage, pageSize: 80, validateItem: isValidPlaylist, signal: request.signal,
        fetchPage: ({ offset, limit, signal }) => fetchNeteaseMePage({ offset, limit, signal }),
      }) : { items: [] }
      const result = { ...firstPage, playlists: collection.items, items: collection.items }
      if (accountAuthority.isCurrent(epoch)) {
        setAccountInfo(result)
        setAccountStatus('ready')
        if (!result.loggedIn) {
          playlistRequestRef.current?.abort()
          playlistEpoch.current += 1
          setPlaylistSongs([])
          setActivePlaylist(null)
          setPlaylistStatus('idle')
        }
      }
      return result
    } catch (error) {
      if (accountAuthority.isCurrent(epoch)) {
        setAccountStatus('error')
        setAccountError(errorMessage(error, '网易云账户读取失败'))
      }
      return null
    } finally {
      if (accountRequestRef.current === request) accountRequestRef.current = null
    }
  }, [accountAuthority])
  const clearAccount = useCallback(() => {
    accountAuthority.clear()
    accountRequestRef.current?.abort()
    playlistRequestRef.current?.abort()
    playlistEpoch.current += 1
    setAccountInfo({ loggedIn: false, playlists: [] })
    setAccountStatus('ready')
    setAccountError('')
    setPlaylistSongs([])
    setActivePlaylist(null)
    setPlaylistStatus('idle')
  }, [accountAuthority])
  const loadPlaylist = useCallback(async (playlist) => {
    const id = typeof playlist === 'object' ? playlist?.id : playlist
    if (!id) return []
    const epoch = ++playlistEpoch.current
    playlistRequestRef.current?.abort()
    const request = new AbortController()
    playlistRequestRef.current = request
    setActivePlaylist(typeof playlist === 'object' ? playlist : { id })
    setPlaylistSongs([])
    setPlaylistStatus('loading')
    setAccountError('')
    try {
      const tracks = await fetchNeteasePlaylistTracks(id, { signal: request.signal })
      if (epoch !== playlistEpoch.current) return []
      setPlaylistSongs(tracks)
      setPlaylistStatus('ready')
      return tracks
    } catch (error) {
      if (epoch === playlistEpoch.current) {
        setPlaylistStatus('error')
        setAccountError(errorMessage(error, '歌单读取失败'))
      }
      return []
    } finally {
      if (playlistRequestRef.current === request) playlistRequestRef.current = null
    }
  }, [])
  const runSearch = useCallback(async (query, source = 'all') => {
    const epoch = ++searchEpoch.current
    const keywords = String(query || '').trim()
    const local = keywords ? songs.filter((song) => `${song.title} ${song.artist} ${song.album || ''}`.toLowerCase().includes(keywords.toLowerCase())) : []
    setSearchError('')
    if (!keywords || source === 'local') {
      setSearchResults(local)
      setSearchStatus(keywords ? 'ready' : 'idle')
      return local
    }
    setSearchResults(source === 'all' ? local : [])
    setSearchStatus('loading')
    try {
      const online = await searchNeteaseSongs(keywords, { limit: 30 })
      if (epoch !== searchEpoch.current) return []
      const result = uniqueTracks([...(source === 'all' ? local : []), ...online])
      setSearchResults(result)
      setSearchStatus('ready')
      return result
    } catch (error) {
      if (epoch === searchEpoch.current) {
        setSearchStatus('error')
        setSearchError(errorMessage(error, '在线搜索暂不可用'))
      }
      return source === 'all' ? local : []
    }
  }, [songs])

  useEffect(() => {
    if (bootLibrary) return undefined
    const timer = window.setTimeout(() => { void refreshLibrary() }, 0)
    return () => window.clearTimeout(timer)
  }, [bootLibrary, refreshLibrary])
  useEffect(() => {
    if (!bootAccount || !accountAuthority.acceptsBoot()) return undefined
    const timer = window.setTimeout(() => {
      if (!accountAuthority.acceptsBoot()) return
      setAccountInfo(bootAccount)
      setAccountStatus('ready')
      setAccountError('')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [accountAuthority, bootAccount])
  useEffect(() => {
    const onLogin = () => { void refreshAccount() }
    window.addEventListener('yun:login-submit', onLogin)
    return () => window.removeEventListener('yun:login-submit', onLogin)
  }, [refreshAccount])
  useEffect(() => () => {
    libraryEpoch.current += 1
    accountAuthority.invalidate()
    accountRequestRef.current?.abort()
    playlistRequestRef.current?.abort()
    playlistEpoch.current += 1
    searchEpoch.current += 1
  }, [accountAuthority])
  const playTrack = useCallback(async (track, queue = null) => {
    // An explicit full queue wins. Without one, retain the originating online
    // playlist/search collection so Next follows the same list the user chose.
    const inferredQueue = queue || (track?.source === 'netease'
      ? [playlistSongs, searchResults].find((tracks) => tracks.some((candidate) => trackKey(candidate) === trackKey(track)))
      : null)
    try {
      const result = inferredQueue?.length
        ? await playerCore.playTrackFromQueue(track, inferredQueue)
        : (playerCore.clearPlaybackQueue(), await playerCore.playTrack(track))
      if (result?.ok) {
        chat.rememberPlayedSong(result.song || track)
        void chat.reactToSongChange(result.song || track, 'user_play')
      } else setNotice(errorMessage(result?.error, '歌曲暂时无法播放'))
      return result
    } catch (error) {
      setNotice(errorMessage(error, '歌曲暂时无法播放'))
      return { ok: false, error }
    }
  }, [chat, playerCore, playlistSongs, searchResults])
  const next = useCallback(async () => {
    try {
      const result = await playerCore.next()
      if (result?.ok && result.song) {
        chat.rememberPlayedSong(result.song)
        void chat.reactToSongChange(result.song, 'user_next')
      }
      return result
    } catch (error) {
      setNotice(errorMessage(error, '下一首暂时无法播放'))
      return { ok: false, error }
    }
  }, [chat, playerCore])
  const previous = useCallback(async () => {
    try {
      const result = await playerCore.previous()
      if (result?.ok && result.song) {
        chat.rememberPlayedSong(result.song)
        void chat.reactToSongChange(result.song, 'user_prev')
      }
      return result
    } catch (error) {
      setNotice(errorMessage(error, '上一首暂时无法播放'))
      return { ok: false, error }
    }
  }, [chat, playerCore])
  const autoReactionId = useRef('')
  useEffect(() => {
    const event = localPlayer.lastAutoNextSong
    if (!event?.song || event.id === autoReactionId.current) return
    autoReactionId.current = event.id
    chat.rememberPlayedSong(event.song)
    if (responseMode === 'podcast' || playerState.playbackMode === 'companion_continue') {
      void chat.reactToSongChange(event.song, playerState.playbackMode === 'companion_continue' ? 'companion_transition' : 'auto_next', event.previousSong)
    }
  }, [chat, localPlayer.lastAutoNextSong, playerState.playbackMode, responseMode])

  const radioRequestRef = useRef(null)
  const radioHistory = useRef([])
  const [radioRetry, setRadioRetry] = useState(0)
  const radioContextRef = useRef(null)
  useLayoutEffect(() => {
    radioContextRef.current = { songs, playHistory: chat.playHistory, recentRecommendations: chat.recentRecommendations }
  }, [songs, chat.playHistory, chat.recentRecommendations])
  useEffect(() => {
    const mode = playerState.playbackMode
    const song = playerState.currentTrack
    const minimum = mode === 'ai_recommend' || mode === 'companion_continue' ? 3 : 1
    if (!song || !usesAutomaticNextQueue(mode) || playerState.autoUpNext.length >= minimum) return undefined
    if (mode !== 'ai_recommend' && !playerState.isPlaying) return undefined
    const request = { songKey: trackKey(song), mode, active: true }
    radioRequestRef.current = request
    let retryTimer = 0
    const context = radioContextRef.current
    requestRadioPrefetch({ currentSong: song, playHistory: context.playHistory,
      recentRecommendations: [...context.recentRecommendations, ...radioHistory.current], playbackMode: mode })
      .then((result) => {
        const current = playerCore.getState()
        if (!request.active || radioRequestRef.current !== request || trackKey(current.currentTrack) !== request.songKey || current.playbackMode !== mode) return
        const exclusions = [current.currentTrack, ...current.upNext, ...context.playHistory]
        const excluded = new Set(exclusions.map(trackKey))
        const candidates = uniqueTracks((result.playbackPlan?.candidates || []).map((suggestion) => (
          context.songs.find((candidate) => trackKey(candidate) === trackKey(suggestion)) || suggestion
        ))).filter((track) => !excluded.has(trackKey(track)))
        const existingKeys = new Set(current.autoUpNext.map(trackKey))
        const fresh = candidates.filter((track) => !existingKeys.has(trackKey(track)))
        if (fresh.length) {
          playerCore.setAutoUpNext(fresh, { excludeSongIds: [...excluded], maxItems: 6 })
          playerCore.setQueuedNextTrack(null)
          radioHistory.current = uniqueTracks([...fresh, ...radioHistory.current]).slice(0, 60)
        } else retryTimer = window.setTimeout(() => setRadioRetry((value) => value + 1), 15000)
      }).catch(() => {
        if (request.active) retryTimer = window.setTimeout(() => setRadioRetry((value) => value + 1), 15000)
      })
    return () => {
      request.active = false
      window.clearTimeout(retryTimer)
    }
  }, [playerCore, playerState.autoUpNext.length, playerState.currentTrack, playerState.isPlaying, playerState.playbackMode, radioRetry])

  const saveRef = useRef({ key: '', at: 0 })
  useEffect(() => {
    if (!currentSong?.fileUrl) return
    const now = Date.now()
    if (saveRef.current.key === trackKey(currentSong) && now - saveRef.current.at < 2000) return
    saveRef.current = { key: trackKey(currentSong), at: now }
    try {
      window.localStorage.setItem('yun_player_session_v1', JSON.stringify({ version: 1, updatedAt: now,
        currentTrack: currentSong, currentTrackId: currentSong.id, position: playerState.currentTime,
        duration: playerState.duration, queue: playerState.queue.filter((track) => track?.fileUrl).slice(0, 200) }))
    } catch { /* Storage pressure must not interrupt playback. */ }
  }, [currentSong, playerState.currentTime, playerState.duration, playerState.queue])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') void stopVoiceInput({ cancel: true })
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (shouldIgnorePlaybackShortcut(event)) return
      event.preventDefault()
      void playerCore.togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playerCore, stopVoiceInput])

  const recommendations = useMemo(() => uniqueTracks([
    ...playerState.autoUpNext,
    ...chat.recentRecommendations.map((item) => item?.song || item),
    ...songs,
  ]).slice(0, 24), [chat.recentRecommendations, playerState.autoUpNext, songs])

  return {
    library: { songs, status: libraryStatus, error: libraryError, importing, refresh: refreshLibrary, importFiles, analyze: analyzeLibrary },
    account: { info: accountInfo, playlists: accountInfo?.playlists || accountInfo?.items || [], status: accountStatus,
      error: accountError, refresh: refreshAccount, clear: clearAccount, loadPlaylist, playlistSongs, playlistStatus, activePlaylist },
    search: { results: searchResults, status: searchStatus, error: searchError, run: runSearch },
    localPlayer, playerCore, playerState, recommendations, chat, responseMode, setResponseMode,
    voice: rawVoice, memory, voiceSession: voiceController,
    voiceInput: { ...voiceInput, nativeEnabled, nativeChanging, nativeStatus, setNativeStatus, setNativeEnabled,
      wakeEnabled: wake.enabled, setWakeEnabled: wake.setEnabled, wakeStatus: wake.status },
    composer: { draft: composerDraft, setDraft: setComposerDraft },
    sendMessage, notice, setNotice, playTrack, next, previous, bootState,
  }
}

export default useMusicApp
