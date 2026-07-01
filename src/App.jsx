import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { lazy, Suspense } from 'react'
import { analyzeMusicLibraryTags, fetchMusicLibrary, scanMusicLibrary } from './api/yunApi'
import { searchNeteaseSongs } from './api/neteaseApi'
import { useLocalPlayer } from './hooks/useLocalPlayer'
import { useYunChat } from './hooks/useYunChat'
import { useYunMemory } from './hooks/useYunMemory'
import { useYunVoice } from './hooks/useYunVoice'
import FloatingLyrics from './components/FloatingLyrics'
import LyricForegroundFog from './components/LyricForegroundFog'
import VoicePickupGlass from './components/VoicePickupGlass'
import VictoryGestureWake from './components/VictoryGestureWake'
import './App.css'

const ParticleVinylBackground = lazy(() => import('./components/ParticleVinylBackground'))
const MOUNTAIN_SETTINGS_STORAGE_KEY = 'yun-particle-vinyl-mountain-settings'
const MOUNTAIN_SETTINGS_LOCK_KEY = 'yun-particle-vinyl-settings-locked'
const DEFAULT_MOUNTAIN_CONTROLS = { edge: 0.68, height: 0.36, peaks: 0.42, speed: 0.006 }

function getInitialMountainSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MOUNTAIN_SETTINGS_STORAGE_KEY) || 'null')
    if (stored?.mountainControls && Number.isFinite(stored.backgroundBrightness)) {
      const savedFogStrength = Number.isFinite(stored.topFogStrength) ? stored.topFogStrength : 16
      return {
        ...stored,
        topFogStrength: savedFogStrength > 0 && savedFogStrength <= 3 ? 16 : savedFogStrength,
        topBlurStrength: Number.isFinite(stored.topBlurStrength) ? stored.topBlurStrength : 8,
      }
    }
  } catch {
    // Ignore invalid local settings.
  }
  return { mountainControls: DEFAULT_MOUNTAIN_CONTROLS, backgroundBrightness: 0.72, topFogStrength: 16, topBlurStrength: 8 }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00'
  }

  const minutes = Math.floor(seconds / 60)
  const restSeconds = Math.floor(seconds % 60)

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

function getSongTags(song) {
  const tags = [...(song?.moodTags || []), ...(song?.sceneTags || [])]

  return tags.length ? tags.slice(0, 3) : ['calm', 'warm']
}

function makeSceneCoverDataUrl(startColor, middleColor, endColor) {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${startColor}"/>
          <stop offset="52%" stop-color="${middleColor}"/>
          <stop offset="100%" stop-color="${endColor}"/>
        </linearGradient>
        <radialGradient id="r" cx="34%" cy="24%" r="62%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.66)"/>
          <stop offset="58%" stop-color="rgba(255,255,255,0.08)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="320" height="520" fill="url(#g)"/>
      <circle cx="104" cy="118" r="124" fill="url(#r)"/>
      <path d="M0 382 C76 328 136 330 210 380 C250 406 284 402 320 370 L320 520 L0 520 Z" fill="rgba(255,255,255,0.22)"/>
      <path d="M28 76 C86 44 128 54 176 94 C212 124 246 132 292 104" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="10" stroke-linecap="round"/>
    </svg>`,
  )}`
}

const sceneTestCovers = [
  makeSceneCoverDataUrl('#ffd37a', '#ff7aa8', '#8367ff'),
  makeSceneCoverDataUrl('#ffdca8', '#596b9f', '#201a33'),
  makeSceneCoverDataUrl('#25304a', '#8a8fd8', '#ffd09b'),
  makeSceneCoverDataUrl('#f5e1c1', '#b8d0d0', '#6e8d72'),
  makeSceneCoverDataUrl('#d9f1ff', '#91b8e8', '#fff1b7'),
  makeSceneCoverDataUrl('#fff1cf', '#b8c47a', '#7a9a68'),
]

const sceneLibraryCovers = [
  { id: 'd777f3a75dc2f628', coverUrl: '/covers/d777f3a75dc2f628.jpg' },
  { id: '167673e0651a5a51', coverUrl: '/covers/167673e0651a5a51.jpg' },
  { id: 'a85516e20cbf9a13', coverUrl: '/covers/a85516e20cbf9a13.jpg' },
  { id: 'b94932eb32a76352', coverUrl: '/covers/b94932eb32a76352.jpg' },
  { id: '1ae48f85554dfc03', coverUrl: '/covers/1ae48f85554dfc03.png' },
  { id: '92a794054bb1724c', coverUrl: '/covers/92a794054bb1724c.png' },
]

const RESPONSE_MODE_KEY = 'yun_response_mode'
const PERSONA_MODE_KEY = 'yun_persona_mode'
const DEFAULT_SONG_THEME = {
  '--song-primary': 'hsl(210 34% 42%)',
  '--song-secondary': 'hsl(196 62% 68%)',
  '--lyric-current-bg': 'linear-gradient(90deg, hsl(210 34% 42%), hsl(196 62% 68%))',
  '--lyric-current-text': 'hsl(210 34% 58%)',
  '--lyric-past-text': 'rgba(218, 235, 248, 0.62)',
  '--lyric-next-text': 'rgba(231, 239, 246, 0.38)',
  '--lyric-distant-text': 'rgba(231, 239, 246, 0.16)',
  '--lyric-glow': 'rgba(138, 205, 235, 0.3)',
  '--song-background-tint': 'rgba(138, 205, 235, 0.18)',
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

function rgbToHsl([r, g, b]) {
  const nextR = r / 255
  const nextG = g / 255
  const nextB = b / 255
  const max = Math.max(nextR, nextG, nextB)
  const min = Math.min(nextR, nextG, nextB)
  const lightness = (max + min) / 2
  const delta = max - min

  if (!delta) return { h: 0, s: 0, l: lightness * 100 }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue = max === nextR
    ? ((nextG - nextB) / delta) % 6
    : max === nextG
      ? (nextB - nextR) / delta + 2
      : (nextR - nextG) / delta + 4

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation * 100,
    l: lightness * 100,
  }
}

function hslToRgb({ h, s, l }) {
  const saturation = s / 100
  const lightness = l / 100
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lightness - c / 2
  const [r, g, b] = h < 60
    ? [c, x, 0]
    : h < 120
      ? [x, c, 0]
      : h < 180
        ? [0, c, x]
        : h < 240
          ? [0, x, c]
          : h < 300
            ? [x, 0, c]
            : [c, 0, x]

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function relativeLuminance([r, g, b]) {
  const toLinear = (value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return toLinear(r) * 0.2126 + toLinear(g) * 0.7152 + toLinear(b) * 0.0722
}

function contrastRatio(rgbA, rgbB) {
  const a = relativeLuminance(rgbA)
  const b = relativeLuminance(rgbB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function isMuddyDominantColor({ h, s, l }) {
  const isSkinOrBrown = h >= 12 && h <= 48 && s >= 12 && s <= 44 && l >= 28 && l <= 72
  const isGrayBrown = h >= 20 && h <= 62 && s < 24 && l >= 24 && l <= 68
  return isSkinOrBrown || isGrayBrown
}

function isUsableCoverColor({ s, l }) {
  return s >= 12 && l >= 12 && l <= 88
}

function tuneHueForSpecialCases(hsl) {
  const next = { ...hsl }
  if (next.h >= 48 && next.h <= 68 && next.l > 58) {
    next.h = 38
    next.s = Math.max(next.s, 52)
    next.l = Math.min(next.l, 48)
  } else if (next.h <= 8 || next.h >= 350) {
    next.h = next.h >= 350 ? 354 : 4
    next.s = Math.min(next.s, 66)
    next.l = Math.min(next.l, 48)
  } else if (next.h >= 82 && next.h <= 145) {
    next.h = next.h < 116 ? 152 : 164
    next.s = Math.min(Math.max(next.s, 46), 68)
    next.l = Math.min(next.l, 44)
  } else if (next.h >= 24 && next.h <= 46 && next.s < 42) {
    next.h = 34
    next.s = Math.max(next.s, 48)
  }
  return next
}

function tuneThemeColor(color, role) {
  const hsl = tuneHueForSpecialCases(rgbToHsl(color))
  if (role === 'secondary') {
    return {
      h: hsl.h,
      s: clampNumber(hsl.s, 35, 70),
      l: clampNumber(hsl.l < 45 ? hsl.l + 22 : hsl.l, 55, 75),
    }
  }

  return {
    h: hsl.h,
    s: clampNumber(hsl.s, 45, 75),
    l: clampNumber(hsl.l, 35, 58),
  }
}

function hslCss({ h, s, l }, alpha) {
  return alpha == null
    ? `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
    : `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${alpha})`
}

function makeSongThemeFromColors(colors) {
  const ranked = colors
    .map((color) => ({ ...color, hsl: rgbToHsl(color.rgb) }))
    .filter((color) => isUsableCoverColor(color.hsl))

  if (!ranked.length) return DEFAULT_SONG_THEME

  const [first, second] = ranked
  const primarySource = first && isMuddyDominantColor(first.hsl) && second ? second : first
  const secondarySource = ranked.find((color) => Math.abs(color.hsl.h - primarySource.hsl.h) > 18) || second || first
  const primary = tuneThemeColor(primarySource.rgb, 'primary')
  const secondary = tuneThemeColor(secondarySource.rgb, 'secondary')
  const primaryRgb = hslToRgb(primary)
  const currentText = contrastRatio(primaryRgb, [255, 255, 255]) >= 4.5
    ? 'rgba(255, 255, 255, 0.96)'
    : 'rgba(34, 25, 16, 0.94)'

  return {
    '--song-primary': hslCss(primary),
    '--song-secondary': hslCss(secondary),
    '--lyric-current-bg': `linear-gradient(90deg, ${hslCss(primary)}, ${hslCss(secondary, 0.88)})`,
    '--lyric-current-text': currentText === 'rgba(255, 255, 255, 0.96)' ? hslCss({ ...primary, l: Math.max(primary.l, 52) }) : hslCss({ ...primary, l: Math.min(primary.l, 42) }),
    '--lyric-past-text': hslCss(secondary, 0.58),
    '--lyric-next-text': hslCss({ ...secondary, s: Math.max(secondary.s - 20, 18), l: Math.min(secondary.l + 8, 82) }, 0.38),
    '--lyric-distant-text': hslCss({ ...secondary, s: Math.max(secondary.s - 28, 14), l: Math.min(secondary.l + 12, 86) }, 0.16),
    '--lyric-glow': hslCss(secondary, 0.3),
    '--song-background-tint': hslCss(primary, 0.18),
  }
}

function quantizeCoverColors(image) {
  const canvas = document.createElement('canvas')
  const size = 56
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  const buckets = new Map()

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 80) continue
    const rgb = [data[index], data[index + 1], data[index + 2]]
    const hsl = rgbToHsl(rgb)
    if (!isUsableCoverColor(hsl)) continue
    const key = `${Math.round(hsl.h / 18)}-${Math.round(hsl.s / 14)}-${Math.round(hsl.l / 12)}`
    const bucket = buckets.get(key) || { rgb: [0, 0, 0], count: 0, saturation: 0 }
    bucket.rgb[0] += rgb[0]
    bucket.rgb[1] += rgb[1]
    bucket.rgb[2] += rgb[2]
    bucket.count += 1
    bucket.saturation += hsl.s
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .map((bucket) => ({
      rgb: bucket.rgb.map((value) => value / bucket.count),
      score: bucket.count * (0.72 + bucket.saturation / bucket.count / 120),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
}

function useSongTheme(coverUrl) {
  const [theme, setTheme] = useState(DEFAULT_SONG_THEME)

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const colors = quantizeCoverColors(image)
        if (!cancelled) setTheme(makeSongThemeFromColors(colors))
      } catch {
        if (!cancelled) setTheme(DEFAULT_SONG_THEME)
      }
    }
    image.onerror = () => {
      if (!cancelled) setTheme(DEFAULT_SONG_THEME)
    }
    image.src = coverUrl || sceneTestCovers[0]

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  return theme
}

const responseModes = [
  { id: 'normal', label: '普通' },
  { id: 'podcast', label: '播客' },
  { id: 'companion', label: '陪伴' },
  { id: 'silent', label: '专注' },
]

const personaModes = [
  { id: 'warm', label: '昀' },
  { id: 'zhudongyu', label: '东宇' },
]

const voiceOptions = [
  { id: 'S_5U82YXa42', label: 'soft voice', description: '柔和陪伴' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小荷女声', description: '清亮自然' },
]

const playbackModeOptions = [
  { id: 'shuffle', label: '随机播放' },
  { id: 'loop_one', label: '单曲循环' },
  { id: 'sequence', label: '顺序播放' },
  { id: 'ai_recommend', label: 'AI推荐播放' },
  { id: 'companion_continue', label: '陪伴续播' },
]

const playbackModeLabels = playbackModeOptions.reduce((labels, mode) => ({
  ...labels,
  [mode.id]: mode.label,
}), {})

const memoryModeOptions = [
  { id: 'off', label: '安静模式' },
  { id: 'smart', label: '自然记得' },
  { id: 'deep', label: '认真陪你' },
]

const COVER_SWEEP_DURATION = 2100
const COVER_SWEEP_LINE_WIDTH = 2
const COVER_SWEEP_GLOW_WIDTH = 34
const COVER_SWEEP_START_LINE = {
  from: { x: 158, y: 635 },
  to: { x: 171, y: 895 },
}
const COVER_SWEEP_END_LINE = {
  from: { x: 1181, y: 617 },
  to: { x: 1194, y: 805 },
}

function AnimatedBackground({ active = false, coverUrl = '', trackKey = '', preloadCoverUrls = [], getFrequencyData, mountainControls, backgroundBrightness, topFogStrength, topBlurStrength, viewLocked, voiceOrbVisible }) {
  return (
    <div className="bg-image">
      <Suspense fallback={null}>
        <ParticleVinylBackground
          active={active}
          coverUrl={coverUrl}
          trackKey={trackKey}
          preloadCoverUrls={preloadCoverUrls}
          getFrequencyData={getFrequencyData}
          mountainControls={mountainControls}
          backgroundBrightness={backgroundBrightness}
          topFogStrength={topFogStrength}
          topBlurStrength={topBlurStrength}
          viewLocked={viewLocked}
          voiceOrbVisible={voiceOrbVisible}
        />
      </Suspense>
    </div>
  )
}

function getInitialResponseMode() {
  const savedMode = localStorage.getItem(RESPONSE_MODE_KEY)

  return responseModes.some((mode) => mode.id === savedMode) ? savedMode : 'companion'
}

function getInitialPersonaMode() {
  const savedMode = localStorage.getItem(PERSONA_MODE_KEY)

  return personaModes.some((mode) => mode.id === savedMode) ? savedMode : 'warm'
}

function getSongCoverUrl(song, fallbackCover) {
  return song?.coverUrl || song?.cover || song?.artwork || song?.image || fallbackCover
}

function getPlayerTitleStyle(title) {
  const length = String(title || '').trim().length

  if (length > 34) {
    return { '--player-title-size': '18px', '--player-title-lines': 3 }
  }

  if (length > 22) {
    return { '--player-title-size': '20px', '--player-title-lines': 3 }
  }

  if (length > 14) {
    return { '--player-title-size': '23px', '--player-title-lines': 2 }
  }

  if (length > 8) {
    return { '--player-title-size': '26px', '--player-title-lines': 2 }
  }

  return { '--player-title-size': '28px', '--player-title-lines': 1 }
}

function shouldIgnorePlaybackShortcut(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const tagName = target.tagName.toLowerCase()
  if (['input', 'textarea', 'select', 'button'].includes(tagName)) return true

  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}

function App() {
  const [activePanel, setActivePanel] = useState(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySource, setLibrarySource] = useState('local')
  const [libraryTracks, setLibraryTracks] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [libraryStatus, setLibraryStatus] = useState('idle')
  const [libraryError, setLibraryError] = useState('')
  const [libraryListReady, setLibraryListReady] = useState(false)
  const [libraryEdgeOpen, setLibraryEdgeOpen] = useState(false)
  const [topControlsOpen, setTopControlsOpen] = useState(false)
  const [neteaseResults, setNeteaseResults] = useState([])
  const [neteaseStatus, setNeteaseStatus] = useState('idle')
  const [neteaseError, setNeteaseError] = useState('')
  const [isAnalyzingLibrary, setIsAnalyzingLibrary] = useState(false)
  const [panelContentVisible, setPanelContentVisible] = useState(true)
  const [pendingMorph, setPendingMorph] = useState(null)
  const [morphLayer, setMorphLayer] = useState(null)
  const [pressedPanel, setPressedPanel] = useState(null)
  const [sceneCoverPage, setSceneCoverPage] = useState(0)
  const [chatDraft, setChatDraft] = useState('')
  const [responseMode, setResponseModeState] = useState(getInitialResponseMode)
  const [personaMode, setPersonaModeState] = useState(getInitialPersonaMode)
  const [uiMode, setUiMode] = useState('normal')
  const [mountainPanelOpen, setMountainPanelOpen] = useState(false)
  const [initialMountainSettings] = useState(getInitialMountainSettings)
  const [mountainControls, setMountainControls] = useState(initialMountainSettings.mountainControls)
  const [backgroundBrightness, setBackgroundBrightness] = useState(initialMountainSettings.backgroundBrightness)
  const [topFogStrength, setTopFogStrength] = useState(initialMountainSettings.topFogStrength)
  const [topBlurStrength, setTopBlurStrength] = useState(initialMountainSettings.topBlurStrength)
  const [mountainSettingsLocked, setMountainSettingsLocked] = useState(() => window.localStorage.getItem(MOUNTAIN_SETTINGS_LOCK_KEY) === 'true')
  const [viewLocked, setViewLocked] = useState(() => window.localStorage.getItem('yun-particle-vinyl-view-locked') === 'true')
  const [voiceInputActive, setVoiceInputActive] = useState(false)
  const [gestureCameraEnabled, setGestureCameraEnabled] = useState(false)
  const [gestureCameraStatus, setGestureCameraStatus] = useState('off')
  const [immersivePlayerVisible, setImmersivePlayerVisible] = useState(false)
  const immersivePlayerTimerRef = useRef(null)
  const libraryEdgeTimerRef = useRef(null)
  const topControlsTimerRef = useRef(null)

  const revealImmersivePlayer = useCallback(() => {
    if (uiMode !== 'immersive') return
    setImmersivePlayerVisible(true)
    window.clearTimeout(immersivePlayerTimerRef.current)
    immersivePlayerTimerRef.current = window.setTimeout(() => {
      setImmersivePlayerVisible(false)
    }, 6000)
  }, [uiMode])

  useEffect(() => {
    if (!immersivePlayerVisible || uiMode !== 'immersive') return undefined
    const keepOpen = () => revealImmersivePlayer()
    window.addEventListener('pointerdown', keepOpen)
    window.addEventListener('keydown', keepOpen)
    return () => {
      window.removeEventListener('pointerdown', keepOpen)
      window.removeEventListener('keydown', keepOpen)
    }
  }, [immersivePlayerVisible, revealImmersivePlayer, uiMode])

  useEffect(() => () => window.clearTimeout(immersivePlayerTimerRef.current), [])
  const spaceHoldTimerRef = useRef(0)
  const spaceHoldTriggeredRef = useRef(false)
  const spacePressActiveRef = useRef(false)
  const voiceTriggerRef = useRef(null)
  const memoryTriggerRef = useRef(null)
  const libraryTriggerRef = useRef(null)
  const playModeTriggerRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const autoNextReactionRef = useRef('')
  const sceneCoverOverlayRef = useRef(null)
  const sceneCoverSlotRefs = useRef([])
  const coverSweepFrameRef = useRef(0)

  const {
    audioRef,
    currentSong,
    isPlaying,
    currentTime,
    duration,
    playbackMode,
    lastAutoNextSong,
    playSong,
    pausePlayback,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    setPlaybackMode,
    readAudioFrequencyData,
  } = useLocalPlayer(libraryTracks)
  const yunVoice = useYunVoice({ musicAudioRef: audioRef })
  const voiceSettings = yunVoice.settings
  const yunMemory = useYunMemory()
  const {
    messages: chatMessages,
    isThinking: chatIsThinking,
    sendMessage: sendChatMessage,
    reactToSongChange,
  } = useYunChat({
    currentSong,
    libraryTracks,
    player: {
      audioRef,
      currentSong,
      playSong,
      pausePlayback,
      togglePlayPause,
      playNext,
      playPrevious,
      seekTo,
    },
    voice: yunVoice,
    responseMode,
    personaMode,
    musicSource: librarySource,
    memory: yunMemory,
  })
  const selectedVoiceOption = voiceOptions.find((option) => option.id === voiceSettings.voice)
  const selectedVoiceLabel = selectedVoiceOption?.label || 'custom voice'

  const setResponseMode = useCallback((mode) => {
    if (!responseModes.some((item) => item.id === mode)) return

    setResponseModeState(mode)
    localStorage.setItem(RESPONSE_MODE_KEY, mode)
  }, [])

  const setPersonaMode = useCallback((mode) => {
    if (!personaModes.some((item) => item.id === mode)) return

    setPersonaModeState(mode)
    localStorage.setItem(PERSONA_MODE_KEY, mode)
  }, [])

  const selectPlaybackMode = useCallback((mode) => {
    setPlaybackMode(mode)
    setActivePanel(null)
  }, [setPlaybackMode])

  const stopVoiceInput = useCallback(() => {
    setVoiceInputActive(false)
  }, [])

  const openLibraryFromEdge = useCallback(() => {
    window.clearTimeout(libraryEdgeTimerRef.current)
    if (activePanel && activePanel !== 'library') return
    if (activePanel === 'library') {
      setLibraryEdgeOpen(true)
      return
    }
    setLibraryListReady(false)
    setPanelContentVisible(true)
    setPendingMorph(null)
    setMorphLayer(null)
    setLibraryEdgeOpen(true)
    setActivePanel('library')
  }, [activePanel])

  const keepEdgeLibraryOpen = useCallback(() => {
    window.clearTimeout(libraryEdgeTimerRef.current)
  }, [])

  const scheduleEdgeLibraryClose = useCallback(() => {
    if (!libraryEdgeOpen) return
    window.clearTimeout(libraryEdgeTimerRef.current)
    libraryEdgeTimerRef.current = window.setTimeout(() => {
      setLibraryEdgeOpen(false)
      setActivePanel((panel) => (panel === 'library' ? null : panel))
      setPanelContentVisible(true)
    }, 860)
  }, [libraryEdgeOpen])

  useEffect(() => () => window.clearTimeout(libraryEdgeTimerRef.current), [])

  useEffect(() => {
    const detectRightEdge = (event) => {
      if (window.innerWidth - event.clientX <= 14) openLibraryFromEdge()
    }
    window.addEventListener('pointermove', detectRightEdge, { passive: true })
    return () => window.removeEventListener('pointermove', detectRightEdge)
  }, [openLibraryFromEdge])

  const openTopControls = useCallback(() => {
    window.clearTimeout(topControlsTimerRef.current)
    topControlsTimerRef.current = null
    setTopControlsOpen(true)
  }, [])

  const keepTopControlsOpen = useCallback(() => {
    window.clearTimeout(topControlsTimerRef.current)
    topControlsTimerRef.current = null
  }, [])

  const scheduleTopControlsClose = useCallback(() => {
    if (!topControlsOpen || topControlsTimerRef.current) return
    topControlsTimerRef.current = window.setTimeout(() => {
      topControlsTimerRef.current = null
      setTopControlsOpen(false)
    }, 680)
  }, [topControlsOpen])

  useEffect(() => () => window.clearTimeout(topControlsTimerRef.current), [])

  useEffect(() => {
    const detectTopEdge = (event) => {
      if (event.clientY <= 12) {
        openTopControls()
        return
      }
      if (!topControlsOpen) return

      const topTrigger = document.querySelector('.top-controls-edge-trigger')
      const topCard = document.querySelector('.top-controls-card.is-open')
      const triggerRect = topTrigger?.getBoundingClientRect()
      const cardRect = topCard?.getBoundingClientRect()
      const isInside = [triggerRect, cardRect].some((rect) => rect
        && event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom)

      if (isInside) keepTopControlsOpen()
      else scheduleTopControlsClose()
    }
    window.addEventListener('pointermove', detectTopEdge, { passive: true })
    return () => window.removeEventListener('pointermove', detectTopEdge)
  }, [keepTopControlsOpen, openTopControls, scheduleTopControlsClose, topControlsOpen])

  const wakeVoiceInput = useCallback(() => {
    setVoiceInputActive(true)
  }, [])

  const playSongWithPodcastReaction = useCallback(async (song, trigger = 'user_play') => {
    const result = await playSong(song)

    if (result?.ok) {
      reactToSongChange(result.song || song, trigger)
    }

    return result
  }, [playSong, reactToSongChange])

  const playNextWithPodcastReaction = useCallback(async () => {
    const result = await playNext()

    if (result?.ok && result.song) {
      reactToSongChange(result.song, 'user_next')
    }

    return result
  }, [playNext, reactToSongChange])

  const playPreviousWithPodcastReaction = useCallback(async () => {
    const result = await playPrevious()

    if (result?.ok && result.song) {
      reactToSongChange(result.song, 'user_prev')
    }

    return result
  }, [playPrevious, reactToSongChange])

  const visibleLibraryTracks = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()

    if (!query) {
      return libraryTracks
    }

    return libraryTracks.filter((track) =>
      `${track.title} ${track.artist}`.toLowerCase().includes(query),
    )
  }, [libraryQuery, libraryTracks])
  // Keep the actual song data independent from the drawer reveal animation.
  // Edge pointer movement may retrigger the reveal state, but must never blank
  // an already rendered list.
  const drawerTracks = librarySource === 'netease' ? neteaseResults : visibleLibraryTracks

  const searchOnlineMusic = useCallback(async () => {
    const keywords = libraryQuery.trim()

    if (!keywords || neteaseStatus === 'loading') {
      return
    }

    setLibrarySource('netease')
    setNeteaseStatus('loading')
    setNeteaseError('')
    setNeteaseResults([])

    try {
      const songs = await searchNeteaseSongs(keywords, { limit: 12 })
      setNeteaseResults(songs)
      setNeteaseStatus('ready')
      if (!songs.length) {
        setNeteaseError('没有找到当前可播放的网易云歌曲')
      }
    } catch (error) {
      setNeteaseStatus('error')
      setNeteaseError(error instanceof Error ? error.message : '网易云搜索失败')
    }
  }, [libraryQuery, neteaseStatus])

  const loadMusicLibrary = useCallback(async () => {
    setLibraryStatus('loading')
    setLibraryError('')

    try {
      const library = await fetchMusicLibrary()
      setLibraryTracks(library.songs)
      setLibraryCount(library.count ?? library.songs.length)
      setLibraryStatus('ready')
    } catch (error) {
      setLibraryTracks([])
      setLibraryCount(0)
      setLibraryStatus('error')
      setLibraryError(error instanceof Error ? error.message : '曲库读取失败')
    }
  }, [])

  const refreshMusicLibrary = useCallback(async () => {
    setLibraryStatus('loading')
    setLibraryError('')

    try {
      const library = await scanMusicLibrary()
      setLibraryTracks(library.songs)
      setLibraryCount(library.count ?? library.songs.length)
      setLibraryStatus('ready')
    } catch (error) {
      setLibraryStatus('error')
      setLibraryError(error instanceof Error ? error.message : '曲库扫描失败')
    }
  }, [])

  const analyzeMusicLibrary = useCallback(async () => {
    if (isAnalyzingLibrary) return

    setIsAnalyzingLibrary(true)
    setLibraryError('')

    try {
      const result = await analyzeMusicLibraryTags({ limit: 80 })
      setLibraryTracks(result.library.songs)
      setLibraryCount(result.library.count ?? result.library.songs.length)
      setLibraryStatus('ready')
    } catch (error) {
      setLibraryStatus('error')
      setLibraryError(error instanceof Error ? error.message : 'AI 曲库理解失败')
    } finally {
      setIsAnalyzingLibrary(false)
    }
  }, [isAnalyzingLibrary])

  useEffect(() => {
    if (activePanel !== 'library') {
      return undefined
    }

    const readyTimer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        setLibraryListReady(true)
      })
    }, 520)

    return () => {
      window.clearTimeout(readyTimer)
    }
  }, [activePanel])

  const triggerRefs = useMemo(() => ({
    library: libraryTriggerRef,
    voice: voiceTriggerRef,
    memory: memoryTriggerRef,
    playMode: playModeTriggerRef,
  }), [])

  const panelSelectors = useMemo(() => ({
    library: '.local-library-drawer',
    voice: '.voice-popover',
    memory: '.memory-settings-panel',
    playMode: '.ai-mode-expanded',
  }), [])

  const panelRadii = useMemo(() => ({
    library: 28,
    voice: 30,
    memory: 32,
    playMode: 999,
  }), [])

  useEffect(() => {
    const timer = window.setTimeout(loadMusicLibrary, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loadMusicLibrary])

  useEffect(() => {
    const messagesElement = chatMessagesRef.current

    if (!messagesElement) {
      return
    }

    messagesElement.scrollTo({
      top: messagesElement.scrollHeight,
      behavior: 'smooth',
    })
  }, [chatMessages, chatIsThinking])

  useEffect(() => {
    if (responseMode !== 'podcast' || !lastAutoNextSong?.song) {
      return
    }

    if (autoNextReactionRef.current === lastAutoNextSong.id) {
      return
    }

    autoNextReactionRef.current = lastAutoNextSong.id

    reactToSongChange(lastAutoNextSong.song, 'auto_next')
  }, [lastAutoNextSong, reactToSongChange, responseMode])

  const getRect = useCallback((element) => {
    const rect = element.getBoundingClientRect()

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const pressPanel = useCallback((panel) => {
    setPressedPanel(panel)
    window.setTimeout(() => setPressedPanel(null), 150)
  }, [])

  const openPanel = (panel) => {
    pressPanel(panel)
    if (panel === 'library') {
      setLibraryListReady(false)
    }
    setPanelContentVisible(false)
    setActivePanel(panel)
    setPendingMorph({ panel, direction: 'open' })
  }

  const closePanel = useCallback((panel = activePanel) => {
    if (!panel) {
      return
    }
    if (panel === 'library') {
      setLibraryEdgeOpen(false)
      window.clearTimeout(libraryEdgeTimerRef.current)
      if (libraryEdgeOpen) {
        setActivePanel(null)
        setPanelContentVisible(true)
        return
      }
    }

    const trigger = triggerRefs[panel]?.current
    const panelElement = document.querySelector(panelSelectors[panel])

    if (!trigger || !panelElement) {
      setActivePanel(null)
      return
    }

    setPanelContentVisible(false)

    setMorphLayer({
      panel,
      phase: 'from',
      from: getRect(panelElement),
      to: getRect(trigger),
      fromRadius: panelRadii[panel],
      toRadius: 999,
    })

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setMorphLayer((layer) => (layer ? { ...layer, phase: 'to' } : layer))
      })
    })

    window.setTimeout(() => {
      setActivePanel(null)
      setMorphLayer(null)
      setPanelContentVisible(true)
    }, 430)
  }, [activePanel, getRect, libraryEdgeOpen, panelRadii, panelSelectors, triggerRefs])

  const togglePanel = (panel) => {
    if (activePanel === panel) {
      pressPanel(panel)
      closePanel(panel)
      return
    }

    openPanel(panel)
  }

  useLayoutEffect(() => {
    if (!pendingMorph || pendingMorph.direction !== 'open' || activePanel !== pendingMorph.panel) {
      return undefined
    }

    const panel = pendingMorph.panel
    const trigger = triggerRefs[panel]?.current
    const panelElement = document.querySelector(panelSelectors[panel])

    if (!trigger || !panelElement) {
      const fallbackTimer = window.setTimeout(() => {
        setPanelContentVisible(true)
        setPendingMorph(null)
      }, 0)

      return () => {
        window.clearTimeout(fallbackTimer)
      }
    }

    const openTimer = window.setTimeout(() => {
      setPanelContentVisible(true)
    }, 275)

    const finishTimer = window.setTimeout(() => {
      setMorphLayer(null)
      setPendingMorph(null)
    }, 430)

    const kickoffTimer = window.setTimeout(() => {
      setMorphLayer({
        panel,
        phase: 'from',
        from: getRect(trigger),
        to: getRect(panelElement),
        fromRadius: 999,
        toRadius: panelRadii[panel],
      })

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setMorphLayer((layer) => (layer ? { ...layer, phase: 'to' } : layer))
        })
      })
    }, 0)

    return () => {
      window.clearTimeout(kickoffTimer)
      window.clearTimeout(openTimer)
      window.clearTimeout(finishTimer)
    }
  }, [activePanel, getRect, panelRadii, panelSelectors, pendingMorph, triggerRefs])

  useEffect(() => {
    if (!activePanel) {
      return undefined
    }

    if (activePanel === 'voice' || activePanel === 'memory') {
      return undefined
    }

    const handlePointerDown = (event) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const clickedInsideLayer = target.closest(
        [
          '.local-library-drawer',
          '.memory-settings-panel',
          '.voice-popover',
          '.ai-mode-expanded',
          '.library-trigger',
          '.ai-play-button',
          '.floating-actions',
        ].join(', '),
      )

      if (clickedInsideLayer) {
        return
      }

      closePanel(activePanel)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [activePanel, closePanel])

  const morphRect = morphLayer?.phase === 'to' ? morphLayer.to : morphLayer?.from
  const morphRadius = morphLayer?.phase === 'to' ? morphLayer.toRadius : morphLayer?.fromRadius
  const displayedSong = currentSong || {
    title: 'golden hour',
    artist: 'kudasai',
    coverUrl: '',
  }
  const getSceneCoverItemsForPage = useCallback((page) => {
    const pageStart = page * sceneTestCovers.length
    const libraryPageTracks = libraryTracks.slice(pageStart, pageStart + sceneTestCovers.length)

    return sceneTestCovers.map((fallbackCover, index) => {
      const sceneCover = sceneLibraryCovers[index]
      const track = libraryPageTracks[index] || libraryTracks.find((song) => song.id === sceneCover?.id) || null

      return {
        track,
        coverUrl: getSongCoverUrl(track, sceneCover?.coverUrl || fallbackCover),
      }
    })
  }, [libraryTracks])
  const [sceneCoverItems, setSceneCoverItems] = useState(() => getSceneCoverItemsForPage(0))
  const [coverSweep, setCoverSweep] = useState(null)
  const isCoverSweeping = Boolean(coverSweep)
  useEffect(() => {
    if (!isCoverSweeping) {
      const frame = window.requestAnimationFrame(() => {
        setSceneCoverItems(getSceneCoverItemsForPage(sceneCoverPage))
      })

      return () => {
        window.cancelAnimationFrame(frame)
      }
    }

    return undefined
  }, [getSceneCoverItemsForPage, isCoverSweeping, sceneCoverPage])
  useEffect(() => () => {
    if (coverSweepFrameRef.current) {
      cancelAnimationFrame(coverSweepFrameRef.current)
    }
  }, [])
  const startCoverSweep = useCallback((nextCovers, nextPage) => {
    if (coverSweepFrameRef.current) {
      cancelAnimationFrame(coverSweepFrameRef.current)
      coverSweepFrameRef.current = 0
    }

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion || !sceneCoverOverlayRef.current) {
      setSceneCoverItems(nextCovers)
      setSceneCoverPage(nextPage)
      setCoverSweep(null)
      return
    }

    let startTime = 0
    const easeInOutCubic = (value) => (
      value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2
    )
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const interpolatePoint = (from, to, progress) => ({
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    })
    const getLineXAtY = (line, y) => {
      const lineHeight = line.to.y - line.from.y
      if (Math.abs(lineHeight) < 0.001) {
        return line.from.x
      }

      const yProgress = (y - line.from.y) / lineHeight
      return line.from.x + (line.to.x - line.from.x) * yProgress
    }
    const buildCardClipPath = (node, line) => {
      if (!node) {
        return 'polygon(0 0, 0 0, 0 100%, 0 100%)'
      }

      const rect = node.getBoundingClientRect()
      const topX = clamp(getLineXAtY(line, rect.top) - rect.left, 0, rect.width)
      const bottomX = clamp(getLineXAtY(line, rect.bottom) - rect.left, 0, rect.width)
      const topPercent = (topX / rect.width) * 100
      const bottomPercent = (bottomX / rect.width) * 100

      return `polygon(0 0, ${topPercent}% 0, ${bottomPercent}% 100%, 0 100%)`
    }
    const readSweepFrame = (progress) => {
      const overlayRect = sceneCoverOverlayRef.current.getBoundingClientRect()
      const cardRects = sceneCoverSlotRefs.current
        .slice(0, sceneTestCovers.length)
        .map((node) => node?.getBoundingClientRect())
        .filter(Boolean)

      if (!cardRects.length) {
        return null
      }

      const left = Math.min(...cardRects.map((rect) => rect.left))
      const right = Math.max(...cardRects.map((rect) => rect.right))
      const line = {
        from: interpolatePoint(COVER_SWEEP_START_LINE.from, COVER_SWEEP_END_LINE.from, progress),
        to: interpolatePoint(COVER_SWEEP_START_LINE.to, COVER_SWEEP_END_LINE.to, progress),
      }
      const lineDx = line.to.x - line.from.x
      const lineDy = line.to.y - line.from.y
      const lineLength = Math.hypot(lineDx, lineDy)
      const lineAngle = Math.atan2(lineDy, lineDx) * 180 / Math.PI - 90

      return {
        nextCovers,
        clipPaths: sceneCoverSlotRefs.current
          .slice(0, sceneTestCovers.length)
          .map((node) => buildCardClipPath(node, line)),
        lineStyle: {
          '--sweep-x': `${line.from.x - overlayRect.left}px`,
          '--sweep-top': `${line.from.y - overlayRect.top}px`,
          '--sweep-height': `${lineLength}px`,
          '--sweep-angle': `${lineAngle}deg`,
          '--sweep-line-width': `${COVER_SWEEP_LINE_WIDTH}px`,
          '--sweep-glow-width': `${COVER_SWEEP_GLOW_WIDTH}px`,
        },
        bounds: { left, right },
      }
    }
    const firstRects = sceneCoverSlotRefs.current
      .slice(0, sceneTestCovers.length)
      .map((node) => node?.getBoundingClientRect())
      .filter(Boolean)

    if (!firstRects.length) {
      setSceneCoverItems(nextCovers)
      setSceneCoverPage(nextPage)
      setCoverSweep(null)
      return
    }
    const animate = (time) => {
      if (!startTime) {
        startTime = time
      }

      const elapsed = time - startTime
      const eased = easeInOutCubic(clamp(elapsed / COVER_SWEEP_DURATION, 0, 1))
      const frame = readSweepFrame(eased)

      if (frame) {
        setCoverSweep(frame)
      }

      if (elapsed < COVER_SWEEP_DURATION) {
        coverSweepFrameRef.current = requestAnimationFrame(animate)
        return
      }

      coverSweepFrameRef.current = 0
      setSceneCoverItems(nextCovers)
      setSceneCoverPage(nextPage)
      setCoverSweep(null)
    }

    const initialFrame = readSweepFrame(0)
    if (initialFrame) {
      setCoverSweep(initialFrame)
    }
    coverSweepFrameRef.current = requestAnimationFrame(animate)
  }, [])
  const refreshSceneCovers = () => {
    if (libraryTracks.length <= sceneTestCovers.length || isCoverSweeping) {
      return
    }

    const maxPage = Math.ceil(libraryTracks.length / sceneTestCovers.length)
    const nextPage = (sceneCoverPage + 1) % maxPage
    startCoverSweep(getSceneCoverItemsForPage(nextPage), nextPage)
  }
  const submitChatMessage = () => {
    const text = chatDraft.trim()

    if (!text || chatIsThinking) {
      return
    }

    setChatDraft('')
    sendChatMessage(text)
  }

  useEffect(() => {
    const clearSpaceHold = () => {
      if (spaceHoldTimerRef.current) {
        window.clearTimeout(spaceHoldTimerRef.current)
        spaceHoldTimerRef.current = 0
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setVoiceInputActive(false)
        return
      }
      if (event.code !== 'Space' && event.key !== ' ') return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (shouldIgnorePlaybackShortcut(event.target)) return
      event.preventDefault()
      if (event.repeat || spacePressActiveRef.current) return

      spacePressActiveRef.current = true
      spaceHoldTriggeredRef.current = false
      spaceHoldTimerRef.current = window.setTimeout(() => {
        spaceHoldTimerRef.current = 0
        spaceHoldTriggeredRef.current = true
        setVoiceInputActive((current) => !current)
      }, 2000)
    }
    const handleKeyUp = (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      if (!spacePressActiveRef.current) return
      event.preventDefault()
      clearSpaceHold()
      if (!spaceHoldTriggeredRef.current) togglePlayPause()
      spacePressActiveRef.current = false
      spaceHoldTriggeredRef.current = false
    }
    const handleWindowBlur = () => {
      clearSpaceHold()
      spacePressActiveRef.current = false
      spaceHoldTriggeredRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      clearSpaceHold()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [togglePlayPause])

  const displayedTags = getSongTags(currentSong)
  const memoryStripTracks = useMemo(() => {
    const tracks = []
    const seenIds = new Set()

    const pushTrack = (track) => {
      if (!track) return

      const key = track.id || `${track.title}-${track.artist}`
      if (seenIds.has(key)) return

      seenIds.add(key)
      tracks.push(track)
    }

    pushTrack(currentSong)
    libraryTracks.forEach(pushTrack)

    return tracks.slice(0, 4)
  }, [currentSong, libraryTracks])
  const backgroundPreloadCoverUrls = useMemo(() => memoryStripTracks
    .slice(1, 4)
    .map((track) => getSongCoverUrl(track, ''))
    .filter(Boolean), [memoryStripTracks])
  const progressPercent = duration ? Math.min(100, (currentTime / duration) * 100) : 0
  const backgroundCoverUrl = getSongCoverUrl(currentSong, sceneCoverItems[0]?.coverUrl || sceneTestCovers[0])
  const songThemeStyle = useSongTheme(backgroundCoverUrl)
  const morphStyle = morphLayer
    ? {
        left: `${morphRect.left}px`,
        top: `${morphRect.top}px`,
        width: `${morphRect.width}px`,
        height: `${morphRect.height}px`,
        borderRadius: `${morphRadius}px`,
      }
    : undefined

  return (
    <main
      className={`app${uiMode === 'immersive' ? ' immersive-mode' : ' normal-mode'}${activePanel === 'library' ? ' library-open' : ''}${activePanel === 'memory' ? ' memory-settings-open' : ''}${activePanel === 'voice' ? ' voice-open' : ''}${activePanel === 'playMode' ? ' play-mode-open' : ''}${panelContentVisible ? '' : ' panel-content-hidden'}${morphLayer ? ' is-morphing' : ''}`}
      style={songThemeStyle}
    >
      <AnimatedBackground
        active={isPlaying}
        coverUrl={backgroundCoverUrl}
        trackKey={currentSong?.id || currentSong?.url || currentSong?.path || `${currentSong?.title || ''}-${currentSong?.artist || ''}`}
        preloadCoverUrls={backgroundPreloadCoverUrls}
        getFrequencyData={readAudioFrequencyData}
        mountainControls={mountainControls}
        backgroundBrightness={backgroundBrightness}
        topFogStrength={topFogStrength}
        topBlurStrength={topBlurStrength}
        viewLocked={viewLocked}
        voiceOrbVisible={voiceInputActive}
      />
      <div
        className={`yun-awakening-optics${voiceInputActive ? ' is-active' : ''}`}
        aria-hidden="true"
      />
      <div
        className={`yun-speaking-optics${yunVoice.isSpeaking ? ' is-active' : ''}`}
        aria-hidden="true"
      >
        <span className="yun-speaking-optics__side yun-speaking-optics__side--left" />
        <span className="yun-speaking-optics__side yun-speaking-optics__side--right" />
        <span className="yun-speaking-optics__tint" />
      </div>
      <div
        className={`library-edge-trigger${libraryEdgeOpen ? ' is-active' : ''}`}
        aria-hidden="true"
        onPointerEnter={openLibraryFromEdge}
        onPointerMove={keepEdgeLibraryOpen}
        onPointerLeave={scheduleEdgeLibraryClose}
      ><span /></div>
      <div
        className={`top-controls-edge-trigger${topControlsOpen ? ' is-active' : ''}`}
        aria-hidden="true"
        onPointerEnter={openTopControls}
        onPointerMove={keepTopControlsOpen}
        onPointerLeave={scheduleTopControlsClose}
      />
      <FloatingLyrics currentSong={currentSong} currentTime={currentTime} active={isPlaying} />
      <LyricForegroundFog />
      <div className={`scene-cover-overlay${isCoverSweeping ? ' is-sweeping' : ''}`} ref={sceneCoverOverlayRef}>
        <div className="scene-cover-stage">
          {sceneCoverItems.map((item, index) => (
            <div
              className={`scene-cover-slot scene-cover-slot--${index + 1}${item.track?.id === currentSong?.id ? ' is-active' : ''}`}
              key={`scene-cover-${index + 1}`}
              ref={(node) => {
                sceneCoverSlotRefs.current[index] = node
              }}
              role="button"
              tabIndex={item.track ? 0 : -1}
              aria-label={item.track ? `播放 ${item.track.title}` : '默认封面'}
              onClick={() => {
                if (item.track) {
                  playSongWithPodcastReaction(item.track)
                }
              }}
              onKeyDown={(event) => {
                if (item.track && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  playSongWithPodcastReaction(item.track)
                }
              }}
            >
              <img className="scene-cover-image scene-cover-image--current" src={item.coverUrl} alt="" draggable="false" />
              {coverSweep?.nextCovers?.[index] && (
                <img
                  className="scene-cover-image scene-cover-image--next"
                  src={coverSweep.nextCovers[index].coverUrl}
                  alt=""
                  draggable="false"
                  style={{
                    clipPath: coverSweep.clipPaths[index],
                  }}
                />
              )}
              {item.track && (
                <div className="scene-cover-meta">
                  <span className="scene-cover-title">{item.track.title}</span>
                  <span className="scene-cover-artist">{item.track.artist}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {coverSweep && <div className="scene-cover-sweep-line" aria-hidden="true" style={coverSweep.lineStyle} />}
      </div>
      <div
        className={`immersive-player-handle${immersivePlayerVisible ? ' is-expanded' : ''}`}
        aria-hidden="true"
        onPointerEnter={revealImmersivePlayer}
        onPointerMove={revealImmersivePlayer}
      >
        <span />
      </div>

      <LiquidGlass
        displacementScale={40}
        blurAmount={0.01}
        saturation={160}
        aberrationIntensity={3}
        elasticity={0.35}
        cornerRadius={40}
        padding="32px 40px"
        className="status-card"
      >
        <div className="status-meta">
          <p className="sub">YUN IS LISTENING</p>
          <span>now companion mode</span>
        </div>
        <h1 className="status-title">
          {displayedSong.title} · {displayedTags.slice(0, 2).join(' / ')}
        </h1>
        <p className="status-description">
          {displayedSong.artist} 正在慢慢铺开，这首歌的光很安静。
          <br />
          我会把声音放轻一点，陪你慢慢说。
        </p>
        <div className="status-tags">
          {displayedTags.map((tag) => (
            <span className="status-tag" key={tag}>{tag}</span>
          ))}
        </div>
        <p className="sub">YUN IS LISTENING</p>
        <h1>我正在听着，你慢慢说。</h1>
        <p>这首歌的光很安静，像傍晚留在木桌上的温度。</p>
      </LiquidGlass>

      <div
        className={`top-controls-card${topControlsOpen ? ' is-open' : ''}`}
        onPointerEnter={keepTopControlsOpen}
        onPointerMove={keepTopControlsOpen}
        onPointerLeave={scheduleTopControlsClose}
      >
        <div className="top-controls-content">
          <div className="mode-switch">
            <div className="mode-options">
              {responseModes.map((mode) => (
                <button
                  className={`mode-option${responseMode === mode.id ? ' active' : ''}`}
                  type="button"
                  key={mode.id}
                  aria-pressed={responseMode === mode.id}
                  onClick={() => setResponseMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="persona-switch">
            <div className="persona-options">
              {personaModes.map((mode) => (
                <button
                  className={`persona-option${personaMode === mode.id ? ' active' : ''}`}
                  type="button"
                  key={mode.id}
                  aria-pressed={personaMode === mode.id}
                  onClick={() => setPersonaMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="floating-actions">
            <button
              className={`action-button immersive-toggle${uiMode === 'immersive' ? ' is-active' : ''}`}
              type="button"
              aria-label={uiMode === 'immersive' ? '切换到普通模式' : '切换到沉浸模式'}
              aria-pressed={uiMode === 'immersive'}
              onClick={() => setUiMode((mode) => {
                setImmersivePlayerVisible(false)
                window.clearTimeout(immersivePlayerTimerRef.current)
                return mode === 'immersive' ? 'normal' : 'immersive'
              })}
            >
              {uiMode === 'immersive' ? '普通' : '沉浸'}
            </button>
            <button className={`action-button${pressedPanel === 'voice' ? ' is-pressed' : ''}`} type="button" aria-label="声音" aria-expanded={activePanel === 'voice'} ref={voiceTriggerRef} onClick={() => togglePanel('voice')}>声</button>
            <button className={`action-button${pressedPanel === 'memory' ? ' is-pressed' : ''}`} type="button" aria-label="设置" aria-expanded={activePanel === 'memory'} ref={memoryTriggerRef} onClick={() => togglePanel('memory')}>设</button>
            <button className={`action-button${mountainPanelOpen ? ' is-pressed' : ''}`} type="button" aria-label="山脉调节" aria-expanded={mountainPanelOpen} onClick={() => setMountainPanelOpen((open) => !open)}>山</button>
            <button
              className={`action-button gesture-camera-toggle${gestureCameraStatus === 'active' || gestureCameraStatus === 'starting' ? ' is-on' : ''}${gestureCameraStatus === 'error' ? ' is-error' : ''}`}
              type="button"
              aria-pressed={gestureCameraEnabled}
              aria-label={gestureCameraEnabled ? '关闭手势摄像头' : '开启手势摄像头'}
              onClick={() => {
                if (gestureCameraEnabled) setGestureCameraStatus('off')
                setGestureCameraEnabled((enabled) => !enabled)
              }}
            >
              {gestureCameraStatus === 'starting' ? '启动中' : gestureCameraStatus === 'active' ? '手势开' : gestureCameraStatus === 'error' ? '摄像头错误' : '手势'}
            </button>
          </div>
        </div>
      </div>

      {(mountainPanelOpen || activePanel === 'voice' || activePanel === 'memory') && (
        <button
          className="settings-panel-backdrop"
          type="button"
          aria-label="收起设置面板"
          onClick={() => {
            setMountainPanelOpen(false)
            if (activePanel === 'voice' || activePanel === 'memory') closePanel(activePanel)
          }}
        />
      )}

      <div
        className={`mountain-tuning-panel${mountainPanelOpen ? ' is-open' : ''}`}
      >
        <div className="mountain-tuning-header">
          <p className="sub">MOUNTAIN</p>
          <button
            className="memory-settings-close"
            type="button"
            aria-label="关闭山脉调节"
            onClick={() => setMountainPanelOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">外轮廓</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${(mountainControls.edge / 1.1) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${(mountainControls.edge / 1.1) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="1.1"
              step="0.01"
              value={mountainControls.edge}
              disabled={mountainSettingsLocked}
              aria-label="山脉外轮廓强度"
              onChange={(event) => setMountainControls((controls) => ({ ...controls, edge: Number(event.target.value) }))}
            />
          </div>
          <span className="voice-value">{mountainControls.edge.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">高度</span>
          <div className="voice-slider voice-slider--volume">
            <span className="voice-slider-fill" style={{ width: `${(mountainControls.height / 0.7) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${(mountainControls.height / 0.7) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="0.7"
              step="0.01"
              value={mountainControls.height}
              disabled={mountainSettingsLocked}
              aria-label="山脉高度"
              onChange={(event) => setMountainControls((controls) => ({ ...controls, height: Number(event.target.value) }))}
            />
          </div>
          <span className="voice-value">{mountainControls.height.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">峰形</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${mountainControls.peaks * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${mountainControls.peaks * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={mountainControls.peaks}
              disabled={mountainSettingsLocked}
              aria-label="山峰起伏峰形"
              onChange={(event) => setMountainControls((controls) => ({ ...controls, peaks: Number(event.target.value) }))}
            />
          </div>
          <span className="voice-value">{mountainControls.peaks.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">波纹速度</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${(mountainControls.speed / 0.1) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${(mountainControls.speed / 0.1) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="0.1"
              step="0.001"
              value={mountainControls.speed}
              disabled={mountainSettingsLocked}
              aria-label="旋转波纹速度"
              onChange={(event) => setMountainControls((controls) => ({ ...controls, speed: Number(event.target.value) }))}
            />
          </div>
          <span className="voice-value">{mountainControls.speed.toFixed(3)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">锁定视角</span>
          <button
            type="button"
            className={`memory-toggle${viewLocked ? ' is-on' : ''}`}
            role="switch"
            aria-checked={viewLocked}
            aria-label={viewLocked ? '视角已锁定' : '视角未锁定'}
            onClick={() => setViewLocked((locked) => {
              const nextLocked = !locked
              window.localStorage.setItem('yun-particle-vinyl-view-locked', String(nextLocked))
              return nextLocked
            })}
          />
          <span className="voice-value">{viewLocked ? '已锁' : '可调'}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">背景亮度</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${((backgroundBrightness - 0.16) / 1.29) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${((backgroundBrightness - 0.16) / 1.29) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0.16"
              max="1.45"
              step="0.01"
              value={backgroundBrightness}
              disabled={mountainSettingsLocked}
              aria-label="背景亮度"
              onChange={(event) => setBackgroundBrightness(Number(event.target.value))}
            />
          </div>
          <span className="voice-value">{backgroundBrightness.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">玻璃雾化</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${(topFogStrength / 20) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${(topFogStrength / 20) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="20"
              step="0.25"
              value={topFogStrength}
              aria-label="玻璃雾化强度"
              onChange={(event) => {
                const nextStrength = Number(event.target.value)
                setTopFogStrength(nextStrength)
                window.localStorage.setItem(MOUNTAIN_SETTINGS_STORAGE_KEY, JSON.stringify({
                  mountainControls,
                  backgroundBrightness,
                  topFogStrength: nextStrength,
                  topBlurStrength,
                }))
              }}
            />
          </div>
          <span className="voice-value">{topFogStrength.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">玻璃模糊</span>
          <div className="voice-slider">
            <span className="voice-slider-fill" style={{ width: `${(topBlurStrength / 20) * 100}%` }} />
            <span className="voice-slider-thumb" style={{ left: `${(topBlurStrength / 20) * 100}%` }} />
            <input
              className="voice-slider-input"
              type="range"
              min="0"
              max="20"
              step="0.25"
              value={topBlurStrength}
              aria-label="玻璃模糊强度"
              onChange={(event) => {
                const nextStrength = Number(event.target.value)
                setTopBlurStrength(nextStrength)
                window.localStorage.setItem(MOUNTAIN_SETTINGS_STORAGE_KEY, JSON.stringify({
                  mountainControls,
                  backgroundBrightness,
                  topFogStrength,
                  topBlurStrength: nextStrength,
                }))
              }}
            />
          </div>
          <span className="voice-value">{topBlurStrength.toFixed(2)}</span>
        </div>
        <div className="mountain-tuning-row">
          <span className="voice-row-label">锁定参数</span>
          <button
            type="button"
            className={`memory-toggle${mountainSettingsLocked ? ' is-on' : ''}`}
            role="switch"
            aria-checked={mountainSettingsLocked}
            aria-label={mountainSettingsLocked ? '山体参数已锁定' : '山体参数未锁定'}
            onClick={() => {
              const nextLocked = !mountainSettingsLocked
              if (nextLocked) {
                window.localStorage.setItem(MOUNTAIN_SETTINGS_STORAGE_KEY, JSON.stringify({ mountainControls, backgroundBrightness, topFogStrength, topBlurStrength }))
              }
              window.localStorage.setItem(MOUNTAIN_SETTINGS_LOCK_KEY, String(nextLocked))
              setMountainSettingsLocked(nextLocked)
            }}
          />
          <span className="voice-value">{mountainSettingsLocked ? '已锁' : '可调'}</span>
        </div>
      </div>

      <VoicePickupGlass
        headless
        active={voiceInputActive}
        onSilenceTimeout={stopVoiceInput}
      />
      <VictoryGestureWake
        enabled={gestureCameraEnabled}
        disabled={voiceInputActive}
        onWake={wakeVoiceInput}
        onCameraStateChange={setGestureCameraStatus}
      />

      <div
        className={`voice-popover glass-popover glass-level-3${activePanel === 'voice' ? ' is-open' : ''}`}
        style={{
          position: 'absolute',
          top: 'var(--voice-popover-top)',
          left: 'var(--voice-popover-left)',
          width: 'var(--voice-popover-width)',
        }}
      >
        <div className="voice-popover-header">
          <p className="sub">VOICE</p>
          <h2>声音与朗读</h2>
        </div>
        <div className="voice-layout">
          <div className="voice-stack">
            <div className="voice-row">
              <span className="voice-row-label">自动朗读</span>
              <button
                className={`voice-toggle${voiceSettings.enabled ? ' is-on' : ''}`}
                type="button"
                aria-pressed={voiceSettings.enabled}
                onClick={() => yunVoice.updateSettings({ enabled: !voiceSettings.enabled })}
              >
                {voiceSettings.enabled ? '开' : '关'}
              </button>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">音色</span>
              <span className="voice-value">{selectedVoiceLabel}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">语速</span>
              <div className="voice-slider">
                <span
                  className="voice-slider-fill"
                  style={{ width: `${((voiceSettings.speed - 0.7) / 0.7) * 100}%` }}
                />
                <span
                  className="voice-slider-thumb"
                  style={{ left: `${((voiceSettings.speed - 0.7) / 0.7) * 100}%` }}
                />
                <input
                  className="voice-slider-input"
                  type="range"
                  min="0.7"
                  max="1.4"
                  step="0.1"
                  value={voiceSettings.speed}
                  aria-label="语速"
                  onChange={(event) => yunVoice.updateSettings({ speed: Number(event.target.value) })}
                />
              </div>
              <span className="voice-value">{voiceSettings.speed.toFixed(1)}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">音量</span>
              <div className="voice-slider voice-slider--volume">
                <span
                  className="voice-slider-fill"
                  style={{ width: `${((voiceSettings.volume - 0.4) / 1.1) * 100}%` }}
                />
                <span
                  className="voice-slider-thumb"
                  style={{ left: `${((voiceSettings.volume - 0.4) / 1.1) * 100}%` }}
                />
                <input
                  className="voice-slider-input"
                  type="range"
                  min="0.4"
                  max="1.5"
                  step="0.1"
                  value={voiceSettings.volume}
                  aria-label="朗读音量"
                  onChange={(event) => yunVoice.updateSettings({ volume: Number(event.target.value) })}
                />
              </div>
              <span className="voice-value">{voiceSettings.volume.toFixed(1)}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">音乐压低</span>
              <button
                className="voice-toggle is-on"
                type="button"
                aria-pressed="true"
                aria-label="音乐压低：始终开启"
              >
                常开
              </button>
            </div>
          </div>
          <div className="voice-picker" aria-label="选择音色">
            <span className="voice-picker-title">选择音色</span>
            <div className="voice-option-list">
              {voiceOptions.map((option) => (
                <button
                  className={`voice-option${voiceSettings.voice === option.id ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={voiceSettings.voice === option.id}
                  onClick={() => yunVoice.updateSettings({ voice: option.id })}
                  key={option.id}
                >
                  <span>{option.label}</span>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
            <label className="voice-custom">
              <span>自定义 ID</span>
              <input
                type="text"
                value={voiceSettings.voice}
                spellCheck="false"
                onChange={(event) => yunVoice.updateSettings({ voice: event.target.value.trim() })}
                placeholder="S_xxx 或 speaker"
              />
            </label>
          </div>
        </div>
        <button
          className="voice-preview-button"
          type="button"
          aria-label="试听声音"
          disabled={yunVoice.isPreviewing}
          onClick={yunVoice.previewVoice}
        >
          {yunVoice.isPreviewing ? '试听中…' : yunVoice.previewFailed ? '试听失败' : '试听声音'}
        </button>
      </div>

      <div
        className={`memory-settings-panel${activePanel === 'memory' ? ' is-open' : ''}`}
      >
        <div className="memory-settings-content">
          <div className="memory-settings-header">
            <h2>记忆设置</h2>
            <button
              className="memory-settings-close"
              type="button"
              aria-label="关闭记忆设置"
              onClick={() => closePanel('memory')}
            >
              ×
            </button>
          </div>

          <div className="memory-settings-row">
            <span>允许使用本地记忆</span>
            <button
              className={`memory-toggle${yunMemory.memoryEnabled ? ' is-on' : ''}`}
              type="button"
              aria-label={`允许使用本地记忆：${yunMemory.memoryEnabled ? '开' : '关'}`}
              aria-pressed={yunMemory.memoryEnabled}
              onClick={() => yunMemory.setMemoryEnabled(!yunMemory.memoryEnabled)}
            />
          </div>

          <p className="memory-settings-status">{yunMemory.summary}</p>

          <div className="memory-mode-options" aria-label="记忆模式">
            {memoryModeOptions.map((mode) => (
              <button
                className={`memory-mode-button${yunMemory.memoryMode === mode.id ? ' active' : ''}`}
                type="button"
                key={mode.id}
                aria-pressed={yunMemory.memoryMode === mode.id}
                onClick={() => yunMemory.setMemoryMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="memory-mode-description">
            {yunMemory.memoryModeCopy[yunMemory.memoryMode] || yunMemory.memoryModeCopy.smart}
          </p>

          <div className="memory-manage-actions">
            <button type="button" onClick={yunMemory.openLongTermMemory}>查看你的记忆</button>
            <button type="button" onClick={yunMemory.resetDefaultMemory}>重载默认</button>
            <button type="button" onClick={yunMemory.clearRecentMemory}>清空近期</button>
          </div>

          <div className="memory-settings-row memory-settings-row--footer">
            <span>允许 AI 控制播放形式</span>
            <span className="memory-toggle is-on" aria-label="允许 AI 控制播放形式：开" />
          </div>
        </div>
      </div>

      <LiquidGlass
        displacementScale={40}
        blurAmount={0.01}
        saturation={160}
        aberrationIntensity={3}
        elasticity={0.35}
        cornerRadius={32}
        padding="22px"
        className="chat-panel"
      >
        <div className="chat-content">
          <div className="chat-header">
            <p className="sub">YUN COMPANION</p>
            <span>soft voice</span>
          </div>
          <div className="chat-messages" ref={chatMessagesRef}>
            {chatMessages.map((message) => (
              <div
                className={`chat-bubble ${message.role === 'user' ? 'chat-bubble--me' : 'chat-bubble--yun'}`}
                key={message.id}
              >
                <span>{message.role === 'user' ? '我' : personaMode === 'zhudongyu' ? '东宇' : '昀'}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {chatIsThinking && (
              <div className="chat-bubble chat-bubble--yun chat-bubble--thinking">
                <span>{personaMode === 'zhudongyu' ? '东宇' : '昀'}</span>
                <p>{personaMode === 'zhudongyu' ? '东宇正在想……' : '昀正在想……'}</p>
              </div>
            )}
          </div>
          <div className="chat-input">
            <textarea
              aria-label="和昀聊天"
              placeholder="慢慢说，我在这里"
              rows={1}
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submitChatMessage()
                }
              }}
            />
            <button
              type="button"
              aria-label="发送给昀"
              onClick={submitChatMessage}
              disabled={!chatDraft.trim() || chatIsThinking}
            />
          </div>
        </div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={40}
        blurAmount={0.01}
        saturation={160}
        aberrationIntensity={3}
        elasticity={0.35}
        cornerRadius={34}
        padding="16px 18px"
        className="memory-strip"
      >
        <div className="memory-list">
          {memoryStripTracks.map((track, index) => {
            const tags = getSongTags(track)
            const coverUrl = getSongCoverUrl(track, sceneTestCovers[index % sceneTestCovers.length])
            const isActive = track.id && currentSong?.id === track.id

            return (
              <article
                className={`memory-card${isActive ? ' active' : ''}`}
                key={track.id || `${track.title}-${track.artist}-${index}`}
                role="button"
                tabIndex={0}
                onClick={() => playSongWithPodcastReaction(track, 'memory_strip')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    playSongWithPodcastReaction(track, 'memory_strip')
                  }
                }}
              >
                <div
                  className="memory-cover"
                  style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
                />
                <div>
                  <h3>{track.title}</h3>
                  <p>{tags.slice(0, 2).join(' / ') || track.artist}</p>
                </div>
              </article>
            )
          })}
        </div>
      </LiquidGlass>

      <div
        className={`player-card${immersivePlayerVisible ? ' is-immersive-visible' : ''}`}
        onPointerEnter={revealImmersivePlayer}
        onPointerMove={revealImmersivePlayer}
        onPointerDown={revealImmersivePlayer}
      >
        <div className="player-content">
          <div className="player-meta">
            <div
              className="cover"
              style={displayedSong.coverUrl ? { backgroundImage: `url(${displayedSong.coverUrl})` } : undefined}
            />
            <div className="track-info" style={getPlayerTitleStyle(displayedSong.title)}>
              <p className="sub">NOW PLAYING</p>
              <h2>{displayedSong.title}</h2>
              <p>{displayedSong.artist}</p>
            </div>
            <button
              className={`library-trigger${pressedPanel === 'library' ? ' is-pressed' : ''}`}
              type="button"
              aria-label="打开本地曲库"
              aria-expanded={activePanel === 'library'}
              ref={libraryTriggerRef}
              onClick={() => {
                setLibraryEdgeOpen(false)
                togglePanel('library')
              }}
            >
              曲库
            </button>
          </div>

          <div className="player-controls" aria-label="播放控制">
            <button className="control-button control-button--ghost" aria-label="Like">♡</button>
            <button className="control-button control-button--ghost" aria-label="More">...</button>
            <button className="control-button" type="button" aria-label="Previous" onClick={playPreviousWithPodcastReaction}>‹</button>
            <button
              className="control-button control-button--primary"
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlayPause}
            >
              {isPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button className="control-button" type="button" aria-label="Next" onClick={playNextWithPodcastReaction}>›</button>
            <button className="control-button control-button--ghost" aria-label="Repeat">↻</button>
          </div>

          <div className="player-progress" aria-label="Playback progress">
            <div
              className="progress-track"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                if (!duration) return
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = (event.clientX - rect.left) / rect.width
                seekTo(duration * ratio)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') seekTo(currentTime - 5)
                if (event.key === 'ArrowRight') seekTo(currentTime + 5)
              }}
            >
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              <div className="progress-thumb" style={{ left: `${progressPercent}%` }} />
            </div>
            <p className="time-code">{formatTime(currentTime)} / {formatTime(duration)}</p>
          </div>
          <button
            className={`ai-play-button${pressedPanel === 'playMode' ? ' is-pressed' : ''}`}
            type="button"
            aria-label={playbackModeLabels[playbackMode] || 'AI推荐播放'}
            aria-expanded={activePanel === 'playMode'}
            ref={playModeTriggerRef}
            onClick={() => togglePanel('playMode')}
          >
            {playbackModeLabels[playbackMode] || 'AI推荐播放'}
          </button>
          <LiquidGlass
            displacementScale={40}
            blurAmount={0.01}
            saturation={160}
            aberrationIntensity={3}
            elasticity={0.35}
            cornerRadius={999}
            padding="0"
            className="scene-cover-refresh"
          >
            <button
              className="scene-cover-refresh-button"
              type="button"
              aria-label="换一组歌曲封面"
              onClick={refreshSceneCovers}
              disabled={libraryTracks.length <= sceneTestCovers.length || isCoverSweeping}
            >
              ↻
            </button>
          </LiquidGlass>
        </div>
      </div>

      <div
        className={`local-library-drawer${activePanel === 'library' ? ' is-open' : ''}${libraryListReady ? ' is-content-ready' : ''}`}
        onPointerEnter={keepEdgeLibraryOpen}
        onPointerMove={keepEdgeLibraryOpen}
        onPointerLeave={scheduleEdgeLibraryClose}
      >
        <div className="library-content">
          <div className="library-header">
            <div>
              <h2>{librarySource === 'netease' ? '网易云' : '本地曲库'}</h2>
              <p className="library-live-count">
                {librarySource === 'netease'
                  ? neteaseStatus === 'loading'
                    ? '正在搜索网易云…'
                    : `在线结果 ${neteaseResults.length} 首`
                  : libraryStatus === 'loading'
                    ? '正在读取曲库…'
                    : `曲库共 ${libraryCount} 首`}
              </p>
            </div>
            <div className="library-header-actions">
              <button
                className="library-scan-button library-scan-button-live"
                type="button"
                aria-label="扫描本地曲库"
                disabled={libraryStatus === 'loading' || isAnalyzingLibrary}
                onClick={refreshMusicLibrary}
              >
                {libraryStatus === 'loading' ? '处理中' : '扫描'}
              </button>
              <button
                className="library-scan-button library-scan-button-live"
                type="button"
                aria-label="AI 理解曲库"
                disabled={libraryStatus === 'loading' || isAnalyzingLibrary || libraryCount === 0}
                onClick={analyzeMusicLibrary}
              >
                {isAnalyzingLibrary ? '理解中' : 'AI理解'}
              </button>
              <button
                className="library-scan-button library-scan-button-live"
                type="button"
                aria-label="搜索网易云"
                disabled={!libraryQuery.trim() || neteaseStatus === 'loading'}
                onClick={searchOnlineMusic}
              >
                {neteaseStatus === 'loading' ? '搜索中' : '网易云'}
              </button>
              <button
                className="library-close-button"
                type="button"
                aria-label="关闭本地曲库"
                onClick={() => closePanel('library')}
              >
                ×
              </button>
            </div>
          </div>

          <div className="library-source-tabs" aria-label="选择音乐来源">
            <button
              className={`library-source-tab${librarySource === 'local' ? ' is-active' : ''}`}
              type="button"
              aria-pressed={librarySource === 'local'}
              onClick={() => setLibrarySource('local')}
            >
              本地
            </button>
            <button
              className={`library-source-tab${librarySource === 'netease' ? ' is-active' : ''}`}
              type="button"
              aria-pressed={librarySource === 'netease'}
              onClick={() => setLibrarySource('netease')}
            >
              网易云
            </button>
          </div>

          <label className="library-search">
            <span>搜索</span>
            <input
              type="search"
              placeholder={librarySource === 'netease' ? '搜索网易云歌名或歌手' : '搜索歌名或歌手'}
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && librarySource === 'netease') {
                  event.preventDefault()
                  searchOnlineMusic()
                }
              }}
            />
          </label>

          <div className="library-preview-list">
            {librarySource === 'local' && libraryStatus === 'error' && (
              <div className="library-empty-state">{libraryError}</div>
            )}
            {librarySource === 'netease' && neteaseStatus === 'error' && (
              <div className="library-empty-state">{neteaseError}</div>
            )}
            {!libraryListReady && (
              <div className="library-empty-state">曲库准备中…</div>
            )}
            {librarySource === 'local' && libraryStatus !== 'error' && libraryListReady && visibleLibraryTracks.length === 0 && (
              <div className="library-empty-state">
                {libraryStatus === 'loading' ? '正在读取旧项目曲库…' : '没有找到匹配歌曲'}
              </div>
            )}
            {librarySource === 'netease' && neteaseStatus !== 'error' && libraryListReady && neteaseResults.length === 0 && (
              <div className="library-empty-state">
                {neteaseStatus === 'loading'
                  ? '正在连接网易云…'
                  : neteaseError || '输入关键词后点网易云搜索'}
              </div>
            )}
            {drawerTracks.slice(0, 4).map((track) => (
              <article className="library-track" key={track.id || `${track.title}-${track.artist}`}>
                <button
                  className="library-play-button"
                  type="button"
                  aria-label={`播放 ${track.title}`}
                  onClick={() => playSongWithPodcastReaction(track)}
                >
                  ▶
                </button>
                <div
                  className={`library-cover ${track.cover || ''}`}
                  style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                />
                <div className="library-track-info">
                  <h3>{track.title}</h3>
                  <p>{track.artist}</p>
                </div>
              </article>
            ))}
          </div>

          <div
            className="library-scroll-list"
            aria-label="全部歌曲列表"
            onPointerEnter={keepEdgeLibraryOpen}
            onPointerMove={keepEdgeLibraryOpen}
          >
            {drawerTracks.map((track) => (
              <article className="library-scroll-track" key={`scroll-${track.id || `${track.title}-${track.artist}`}`}>
                <button
                  className="library-play-button"
                  type="button"
                  aria-label={`播放 ${track.title}`}
                  onClick={() => playSongWithPodcastReaction(track)}
                >
                  ▶
                </button>
                <div
                  className={`library-cover ${track.cover || ''}`}
                  style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                />
                <div className="library-track-info">
                  <h3>{track.title}</h3>
                  <p>{track.artist}</p>
                </div>
              </article>
            ))}
          </div>

          <button className="library-all-button" type="button">
            <span className="library-all-count">
              {librarySource === 'netease'
                ? `在线结果（${neteaseResults.length}）`
                : `查看全部歌曲（${libraryCount}）`}
            </span>
          </button>
        </div>
      </div>

      <LiquidGlass
        displacementScale={40}
        blurAmount={0.01}
        saturation={160}
        aberrationIntensity={3}
        elasticity={0.35}
        cornerRadius={999}
        padding="6px"
        className={`ai-mode-expanded${activePanel === 'playMode' ? ' is-open' : ''}`}
      >
        <div className="ai-mode-options">
          {playbackModeOptions.map((mode) => (
            <button
              className={`ai-mode-option${playbackMode === mode.id ? ' active' : ''}`}
              type="button"
              key={mode.id}
              aria-pressed={playbackMode === mode.id}
              onClick={() => selectPlaybackMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </LiquidGlass>

      <div className="ai-popover glass-popover glass-level-3">
        <div className="ai-popover-compact">
          <div className="ai-popover-header">
            <p className="sub">SMART QUEUE</p>
            <h2>AI推荐播放</h2>
          </div>
          <div className="ai-reason-card">
            <p>根据 calm / warm 和你的聊天状态，续播更安静的歌。</p>
          </div>
          <div className="ai-queue">
            <div className="ai-queue-item">
              <span>1</span>
              <p>night walk</p>
            </div>
            <div className="ai-queue-item">
              <span>2</span>
              <p>rainy room</p>
            </div>
            <div className="ai-queue-item">
              <span>3</span>
              <p>silent tea</p>
            </div>
          </div>
          <div className="ai-preference-chips">
            <span>更安静</span>
            <span>更温暖</span>
            <span>少说话</span>
          </div>
          <button className="ai-popover-action" aria-label="重新推荐">重新推荐</button>
        </div>
        <div className="ai-popover-header">
          <p className="sub">SMART QUEUE</p>
          <h2>AI推荐播放</h2>
          <p>根据当前歌曲情绪和你的聊天状态，自动续播更适合的歌。</p>
        </div>
        <div className="ai-reason-card">
          <span>推荐理由</span>
          <p>你现在听的是 golden hour，情绪偏 calm / warm。</p>
          <p>我会优先推荐安静、温暖、低打扰的歌曲。</p>
        </div>
        <div className="ai-queue">
          <div className="ai-queue-item">
            <span>1</span>
            <p>night walk · focus</p>
          </div>
          <div className="ai-queue-item">
            <span>2</span>
            <p>rainy room · lonely</p>
          </div>
          <div className="ai-queue-item">
            <span>3</span>
            <p>silent tea · warm</p>
          </div>
        </div>
        <div className="ai-preference-chips">
          <span>更安静</span>
          <span>更温暖</span>
          <span>少说话</span>
          <span>多陪伴</span>
        </div>
        <button className="ai-popover-action" aria-label="重新推荐">重新推荐</button>
      </div>
      {morphLayer && (
        <div
          className={`liquid-morph-layer ${morphLayer.phase === 'to' ? 'is-to' : 'is-from'}`}
          style={morphStyle}
        />
      )}
    </main>
  )
}

export default App
