import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { lazy, Suspense } from 'react'
import { analyzeMusicLibraryTags, fetchMusicLibrary, importMusicFiles, scanMusicLibrary } from './api/yunApi'
import { fetchNeteaseMe, fetchNeteasePlaylistTracks, searchNeteaseSongs } from './api/neteaseApi'
import { requestRadioPrefetch } from './api/radioApi'
import { configureYunProModel } from './api/yunModelApi'
import { useLocalPlayer } from './hooks/useLocalPlayer'
import { useYunChat } from './hooks/useYunChat'
import { useYunMemory } from './hooks/useYunMemory'
import { useYunVoice } from './hooks/useYunVoice'
import { useYunAgent } from './hooks/useYunAgent'
import { useCowAgentYunBridge } from './hooks/useCowAgentYunBridge'
import { useYunWakeWord } from './hooks/useYunWakeWord'
import { useAsrWakeWord } from './hooks/useAsrWakeWord'
import { useYunBargeIn } from './hooks/useYunBargeIn'
import { useVoiceSessionController } from './hooks/useVoiceSessionController'
import { usePersistentAudioCapture } from './hooks/usePersistentAudioCapture'
import { useFullDuplexPhysicalTest } from './hooks/useFullDuplexPhysicalTest'
import { createYunLegacyPlayerAdapter } from './player/adapters/yunLegacyPlayerAdapter'
import { PlayerProvider } from './player/react/PlayerProvider'
import { usePlayerObserver } from './telemetry/playerObserver'
import { useTtsObserver } from './telemetry/ttsObserver'
import FloatingLyrics from './components/FloatingLyrics'
import LyricForegroundFog from './components/LyricForegroundFog'
import VoicePickupGlass from './components/VoicePickupGlass'
import AsrSettingsPanel from './components/AsrSettingsPanel'
import VictoryGestureWake from './components/VictoryGestureWake'
import './App.css'

const ParticleVinylBackground = lazy(() => import('./components/ParticleVinylBackground'))
const MOUNTAIN_SETTINGS_STORAGE_KEY = 'yun-particle-vinyl-mountain-settings'
const MOUNTAIN_SETTINGS_LOCK_KEY = 'yun-particle-vinyl-settings-locked'
const VISUAL_QUALITY_STORAGE_KEY = 'yun-visual-quality'
const DEFAULT_MOUNTAIN_CONTROLS = { edge: 0.68, height: 0.36, peaks: 0.42, speed: 0.006 }
// Keep large NetEase playlists inexpensive. A row is 54px high with a 9px
// gap; the extra pixels prevent a blank edge from small layout differences.
const LIBRARY_SCROLL_ROW_HEIGHT = 65
const LIBRARY_SCROLL_OVERSCAN = 6

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

function normalizeVoiceTranscript(transcript) {
  const text = String(transcript || '')
    .trim()
    // Native KWS keeps pre-roll so ASR commonly returns the wake phrase too.
    // Remove it before either the fast local command router or DeepSeek sees
    // the actual user request.
    .replace(/^(?:小昀|小云|晓云|小韵|小芸|小允|老赢|角蝇)[，,、\s]*/i, '')
  const compact = text.replace(/[\s，。！？、,.!?~…]/g, '')

  // Chromium may emit a complete short phrase twice in one final recognition result.
  // This only cleans the transcript before it is sent to the intent model; it never decides an action.
  if (compact.length >= 2 && compact.length % 2 === 0) {
    const half = compact.slice(0, compact.length / 2)
    if (half === compact.slice(compact.length / 2)) return half
  }

  // ASR can yield only punctuation from room noise, a speaker tail, or a
  // dropped frame. Such a result is never a command and must not wake a chat.
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

function isCompanionCallEnd(text) {
  const compact = String(text || '').replace(/[\s，。！？、,.!?~…]/g, '')
  return /^(没事了|不用了|先这样|挂了吧|结束对话)(小昀|小云|晓云|小韵)?$/.test(compact)
}

function isLikelyTtsEcho(transcript, recentSpokenText) {
  const compact = (value) => String(value || '').toLowerCase().replace(/[\s，。！？、,.!?~…]/g, '')
  const heard = compact(transcript)
  const spoken = compact(recentSpokenText)

  return heard.length >= 2 && spoken.length >= 2 && (spoken.includes(heard) || heard.includes(spoken))
}

function isWakeAcknowledgementEcho(transcript, acknowledgement) {
  const compact = (value) => String(value || '').toLowerCase().replace(/[\s，。！？、,.!?~…]/g, '')
  const heard = compact(transcript)
  const spoken = compact(acknowledgement)

  // Wake acknowledgements can be just one syllable (such as “嗯？”), so the
  // general TTS matcher intentionally does not cover all of them. Keep this
  // comparison exact: “我听着，帮我放歌” must still be treated as a command.
  return Boolean(heard && spoken && heard === spoken)
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
// Browser echo cancellation has already removed most speaker bleed. Keep this
// short so a person can answer naturally as soon as Yun finishes speaking.
const COMPANION_ECHO_GUARD_MS = 900
const WAKE_ACK_ECHO_GUARD_MS = 80
const TTS_ECHO_FINGERPRINT_MS = 5000
const MAX_VOICE_RETRY_ATTEMPTS = 3
const WAKE_ACKNOWLEDGEMENTS = ['嗯？', '哼？', '怎么了？', '叫我？', '我听着。', '嗯，怎么啦？', '在呢。']
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

const voiceOptions = [
  { id: 'S_5U82YXa42', label: 'soft voice', description: '温柔陪伴女声（豆包）' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小荷女声', description: '清亮自然女声（豆包）' },
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

function getWallpaperRuntime() {
  const params = new URLSearchParams(window.location.search)
  const wallpaperMode = params.get('wallpaper') === '1' || params.get('wallpaper') === 'true'
  const qualityParam = params.get('quality') || window.localStorage.getItem(VISUAL_QUALITY_STORAGE_KEY)
  const constrainedDevice = Number(navigator.hardwareConcurrency || 8) <= 4
  const quality = ['low', 'medium', 'high'].includes(qualityParam)
    ? qualityParam
    : constrainedDevice ? 'low' : 'medium'

  return { wallpaperMode, quality }
}

function AnimatedBackground({ active = false, coverUrl = '', trackKey = '', preloadCoverUrls = [], getFrequencyData, mountainControls, backgroundBrightness, topFogStrength, topBlurStrength, viewLocked, voiceOrbVisible, voiceOrbLevel = 0, onReady, quality = 'high' }) {
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
          voiceOrbLevel={voiceOrbLevel}
          onReady={onReady}
          quality={quality}
        />
      </Suspense>
    </div>
  )
}

function getInitialResponseMode() {
  const savedMode = localStorage.getItem(RESPONSE_MODE_KEY)

  return responseModes.some((mode) => mode.id === savedMode) ? savedMode : 'companion'
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

function App({ onVisualReady }) {
  const [{ wallpaperMode, quality: initialVisualQuality }] = useState(getWallpaperRuntime)
  const [visualQuality, setVisualQuality] = useState(initialVisualQuality)
  // Let React paint the controls before the two WebGL renderers begin shader
  // compilation. Without this gap, a cold start can look like a frozen black
  // window even though the rest of the interface is already ready.
  const [visualBooted, setVisualBooted] = useState(false)

  const updateVisualQuality = useCallback((quality) => {
    if (!['low', 'medium', 'high'].includes(quality)) return
    setVisualQuality(quality)
    window.localStorage.setItem(VISUAL_QUALITY_STORAGE_KEY, quality)
    const url = new URL(window.location.href)
    url.searchParams.set('quality', quality)
    window.history.replaceState({}, '', url)
  }, [])
  const [activePanel, setActivePanel] = useState(null)
  const [proModelSetupVisible, setProModelSetupVisible] = useState(true)
  const [proModelForm, setProModelForm] = useState({ apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' })
  const [proModelStatus, setProModelStatus] = useState('')
  const [isApplyingProModel, setIsApplyingProModel] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySource, setLibrarySource] = useState('local')
  const [libraryTracks, setLibraryTracks] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [libraryStatus, setLibraryStatus] = useState('idle')
  const [libraryError, setLibraryError] = useState('')
  const [libraryListReady, setLibraryListReady] = useState(false)
  const [libraryEdgeOpen, setLibraryEdgeOpen] = useState(false)
  const [chatDockOpen, setChatDockOpen] = useState(false)
  const [topControlsOpen, setTopControlsOpen] = useState(false)
  const [isWebFullscreen, setIsWebFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const [neteaseResults, setNeteaseResults] = useState([])
  const [neteaseStatus, setNeteaseStatus] = useState('idle')
  const [neteaseError, setNeteaseError] = useState('')
  const [neteaseMe, setNeteaseMe] = useState(null)
  const [neteaseAccountStatus, setNeteaseAccountStatus] = useState('idle')
  const [neteaseLibraryView, setNeteaseLibraryView] = useState('songs')
  const [activeNeteasePlaylist, setActiveNeteasePlaylist] = useState(null)
  const [libraryScrollTop, setLibraryScrollTop] = useState(0)
  const [isImportingMusic, setIsImportingMusic] = useState(false)
  const musicImportInputRef = useRef(null)
  const libraryScrollListRef = useRef(null)
  const neteaseRequestRef = useRef(0)
  const [isAnalyzingLibrary, setIsAnalyzingLibrary] = useState(false)
  const [panelContentVisible, setPanelContentVisible] = useState(true)
  const [pendingMorph, setPendingMorph] = useState(null)
  const [morphLayer, setMorphLayer] = useState(null)
  const [pressedPanel, setPressedPanel] = useState(null)
  const [chatDraft, setChatDraft] = useState('')
  const [chatImageFile, setChatImageFile] = useState(null)
  const [responseMode, setResponseModeState] = useState(getInitialResponseMode)
  const applyResponseMode = useCallback((mode) => {
    if (!responseModes.some((item) => item.id === mode)) return false
    setResponseModeState(mode)
    localStorage.setItem(RESPONSE_MODE_KEY, mode)
    return true
  }, [])
  const personaMode = 'warm'
  const [uiMode, setUiMode] = useState('immersive')
  const [mountainPanelOpen, setMountainPanelOpen] = useState(false)
  const [initialMountainSettings] = useState(getInitialMountainSettings)
  const [mountainControls, setMountainControls] = useState(initialMountainSettings.mountainControls)
  const [backgroundBrightness, setBackgroundBrightness] = useState(initialMountainSettings.backgroundBrightness)
  const [topFogStrength, setTopFogStrength] = useState(initialMountainSettings.topFogStrength)
  const [topBlurStrength, setTopBlurStrength] = useState(initialMountainSettings.topBlurStrength)
  const [mountainSettingsLocked, setMountainSettingsLocked] = useState(() => window.localStorage.getItem(MOUNTAIN_SETTINGS_LOCK_KEY) === 'true')
  const [viewLocked, setViewLocked] = useState(() => window.localStorage.getItem('yun-particle-vinyl-view-locked') === 'true')
  const [voiceInputActive, setVoiceInputActive] = useState(false)
  const [nativeCommandListening, setNativeCommandListening] = useState(false)
  const [nativeCommandTranscribing, setNativeCommandTranscribing] = useState(false)
  const [voiceVisualActive, setVoiceVisualActive] = useState(false)
  const [voiceVisualActivityAt, setVoiceVisualActivityAt] = useState(0)
  const [nativeVoiceLevel, setNativeVoiceLevel] = useState(0)
  const [companionCallActive, setCompanionCallActive] = useState(false)
  const [voiceCallStatus, setVoiceCallStatus] = useState('idle')
  const [voiceResumeDelayMs, setVoiceResumeDelayMs] = useState(320)
  const [wakeAcknowledging, setWakeAcknowledging] = useState(false)
  const wasSpeakingRef = useRef(false)
  const bargeInRef = useRef(false)
  const echoGuardUntilRef = useRef(0)
  const nextSpeechEchoGuardMsRef = useRef(null)
  const voiceRetryAttemptsRef = useRef(0)
  const previousWakeAcknowledgementRef = useRef(-1)
  const wakeAcknowledgementInFlightRef = useRef(false)
  const wakeAcknowledgementEchoRef = useRef({ text: '', expiresAt: 0 })
  const [gestureCameraEnabled, setGestureCameraEnabled] = useState(false)
  const [gestureCameraStatus, setGestureCameraStatus] = useState('off')
  const [volumeControlOpen, setVolumeControlOpen] = useState(false)
  const [immersivePlayerVisible, setImmersivePlayerVisible] = useState(false)
  const immersivePlayerTimerRef = useRef(null)
  const libraryEdgeTimerRef = useRef(null)
  const chatDockTimerRef = useRef(null)
  const topControlsTimerRef = useRef(null)
  const speakingOpticsRef = useRef(null)

  // Native wake events arrive over a separate websocket.  If that connection
  // drops halfway through a turn, the normal final/error event never reaches
  // React. Keep one small, authoritative reset so the wake affordance can
  // never trap the rest of the player UI.
  const resetNativeWakeUi = useCallback((status = 'idle') => {
    setNativeCommandListening(false)
    setNativeCommandTranscribing(false)
    setVoiceInputActive(false)
    setVoiceVisualActive(false)
    setNativeVoiceLevel(0)
    setCompanionCallActive(false)
    setWakeAcknowledging(false)
    setVoiceCallStatus(status)
  }, [])

  useEffect(() => {
    let timer = 0
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setVisualBooted(true), 120)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [])

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

  useEffect(() => {
    const syncFullscreenState = () => setIsWebFullscreen(Boolean(document.fullscreenElement))

    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  const toggleWebFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }

      await document.documentElement.requestFullscreen()
    } catch (error) {
      console.warn('Unable to change fullscreen state.', error)
    }
  }, [])

  const spaceHoldTimerRef = useRef(0)
  const spaceHoldTriggeredRef = useRef(false)
  const spacePressActiveRef = useRef(false)
  const voiceTriggerRef = useRef(null)
  const memoryTriggerRef = useRef(null)
  const libraryTriggerRef = useRef(null)
  const playModeTriggerRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const chatImageInputRef = useRef(null)
  const autoNextReactionRef = useRef('')
  const radioPrefetchRef = useRef('')
  const radioPrefetchingRef = useRef(false)
  const radioPrefetchRetryTimerRef = useRef(0)
  const [radioPrefetchRetryNonce, setRadioPrefetchRetryNonce] = useState(0)
  // This is deliberately separate from chat recommendations. A radio batch
  // has already been shown/planned, so it must be excluded from the next
  // prefetch even before the listener reaches those tracks.
  const [radioRecommendationHistory, setRadioRecommendationHistory] = useState([])

  const startCompanionCall = useCallback(({ listenImmediately = true } = {}) => {
    voiceRetryAttemptsRef.current = 0
    setVoiceResumeDelayMs(120)
    setVoiceCallStatus('listening')
    setCompanionCallActive(true)
    setVoiceVisualActive(true)
    setVoiceVisualActivityAt(Date.now())
    setVoiceInputActive(listenImmediately)
  }, [])

  const legacyPlayer = usePlayerObserver(useLocalPlayer(libraryTracks))
  const {
    audioRef,
    currentSong,
    isPlaying,
    currentTime,
    playbackMode,
    lastAutoNextSong,
    upNextTracks,
    autoUpNextTracks,
    playSong,
    playSongFromQueue,
    pausePlayback,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    musicDuckingController,
    setPlaybackMode,
    readAudioFrequencyData,
    setQueuedNextSong,
    enqueueUpNext,
    removeUpNext,
    clearUpNext,
    setAutoUpNext,
    removeAutoUpNext,
    clearAutoUpNext,
    clearPlaybackQueue,
  } = legacyPlayer
  const [playerCore] = useState(() => createYunLegacyPlayerAdapter())
  const playerState = playerCore.updateLegacy(legacyPlayer)
  useLayoutEffect(() => {
    playerCore.flush()
  })
  useEffect(() => () => playerCore.dispose(), [playerCore])
  // Headless voice lifecycle authority. It deliberately does not own UI,
  // microphone hardware, or the existing conversation/MCP routes.
  const voiceSession = useVoiceSessionController()
  const voiceController = voiceSession.controller
  const handleVoiceCaptureStart = useCallback(() => {
    voiceController.userSpeechStarted()
    setVoiceCallStatus('listening')
  }, [voiceController])
  const handleVoiceCaptureStop = useCallback(() => {
    voiceController.userSpeechEnded()
  }, [voiceController])
  const yunVoice = useTtsObserver(useYunVoice({ musicAudioRef: audioRef, musicDuckingController }))
  const voiceSettings = yunVoice.settings
  const yunVoiceIsActive = yunVoice.isPreparingSpeech || yunVoice.isSpeaking
  const nativeVoiceOrbVisible = nativeCommandListening && !nativeCommandTranscribing && !yunVoiceIsActive
  // The central liquid-glass orb belongs exclusively to the listening turn.
  // During Yun's reply, leave that space clear and use the existing outer
  // speaking ribbon instead.
  const voiceVisualVisible = nativeVoiceOrbVisible || (companionCallActive && voiceVisualActive && !yunVoiceIsActive)
  const voiceOrbLevel = nativeVoiceOrbVisible ? nativeVoiceLevel : 0

  useEffect(() => {
    const optics = speakingOpticsRef.current
    if (!optics || !yunVoice.isSpeaking) return undefined

    let frameId = 0
    let smoothedLevel = 0

    const updateMusicPulse = () => {
      const frequencyData = isPlaying ? readAudioFrequencyData() : null
      let bassEnergy = 0

      if (frequencyData?.length) {
        // The first few FFT bins carry the kick and bass movement that reads
        // as a musical pulse, rather than the harsher motion of high notes.
        const bassBinCount = Math.max(6, Math.floor(frequencyData.length * 0.055))
        for (let index = 1; index < bassBinCount; index += 1) {
          bassEnergy += frequencyData[index] / 255
        }
        bassEnergy /= Math.max(1, bassBinCount - 1)
      }

      // Fast attacks make each kick visibly brighten the field; the slower
      // release leaves a short luminous tail instead of a metronomic blink.
      const targetLevel = Math.max(0, Math.min(1, (bassEnergy - 0.035) / 0.24))
      const smoothing = targetLevel > smoothedLevel ? 0.54 : 0.105
      smoothedLevel += (targetLevel - smoothedLevel) * smoothing
      const pulse = smoothedLevel
      optics.style.setProperty('--speaking-pulse', pulse.toFixed(3))
      optics.style.setProperty('--speaking-glow-blur', `${22 + pulse * 38}px`)
      optics.style.setProperty('--speaking-glow-spread', `${3 + pulse * 9}px`)
      optics.style.setProperty('--speaking-inner-glow', `${13 + pulse * 20}px`)
      optics.style.setProperty('--speaking-band-blur', `${2.4 - pulse * 0.9}px`)
      optics.style.setProperty('--speaking-band-saturation', (1.28 + pulse * 0.78).toFixed(3))
      optics.style.setProperty('--speaking-band-brightness', (0.58 + pulse * 1.05).toFixed(3))
      optics.style.setProperty('--speaking-ring-opacity', (0.32 + pulse * 0.68).toFixed(3))
      optics.style.setProperty('--speaking-tint-opacity', (0.12 + pulse * 0.48).toFixed(3))
      optics.style.setProperty('--speaking-tint-saturation', (1.02 + pulse * 0.16).toFixed(3))
      optics.style.setProperty('--speaking-tint-brightness', (0.99 + pulse * 0.06).toFixed(3))
      frameId = window.requestAnimationFrame(updateMusicPulse)
    }

    updateMusicPulse()
    return () => {
      window.cancelAnimationFrame(frameId)
      ;[
        '--speaking-pulse',
        '--speaking-glow-blur',
        '--speaking-glow-spread',
        '--speaking-inner-glow',
        '--speaking-band-blur',
        '--speaking-band-saturation',
        '--speaking-band-brightness',
        '--speaking-ring-opacity',
        '--speaking-tint-opacity',
        '--speaking-tint-saturation',
        '--speaking-tint-brightness',
      ].forEach((property) => optics.style.removeProperty(property))
    }
  }, [isPlaying, readAudioFrequencyData, yunVoice.isSpeaking])

  const wakeVoiceInput = useCallback(async (source = 'browser', inlineCommand = '') => {
    if (wakeAcknowledgementInFlightRef.current) return

    voiceController.wakeDetected()
    const previousIndex = previousWakeAcknowledgementRef.current
    let nextIndex = Math.floor(Math.random() * WAKE_ACKNOWLEDGEMENTS.length)
    if (WAKE_ACKNOWLEDGEMENTS.length > 1 && nextIndex === previousIndex) {
      nextIndex = (nextIndex + 1) % WAKE_ACKNOWLEDGEMENTS.length
    }
    previousWakeAcknowledgementRef.current = nextIndex
    const acknowledgement = WAKE_ACKNOWLEDGEMENTS[nextIndex]
    // The native engine owns a continuous microphone stream and its own
    // pre-roll. Its AEC receives the acknowledgement render reference, so the
    // user can still speak immediately after this short cue.
    if (source === 'native') {
      // Native owns this command turn end-to-end; do not arm the browser
      // companion-call loop or it will reopen a competing microphone stream
      // after transcription completes.
      setCompanionCallActive(false)
      setVoiceInputActive(false)
      setVoiceVisualActive(true)
      setNativeCommandListening(true)
      setNativeCommandTranscribing(false)
      setVoiceCallStatus('正在听')
      // Native ASR keeps listening while this cue plays. AEC usually removes
      // it, but retain an exact, per-wake fingerprint as a final safety net.
      wakeAcknowledgementEchoRef.current = {
        text: acknowledgement,
        expiresAt: Date.now() + TTS_ECHO_FINGERPRINT_MS,
      }
      // The acknowledgement is played through the native full-duplex engine,
      // whose render reference is fed to AEC.  Do not await generation here:
      // the user must be able to continue directly with a command, and can
      // interrupt this short cue at any time.
      void yunVoice.speakText(acknowledgement, { force: true, allowBargeIn: false }).catch(() => {})
      return
    }

    // Browser fallback recognizes a complete speech segment, so the wake word
    // and command may already be present in the same transcript. Hand that
    // command straight to the normal DeepSeek path instead of opening a new
    // recorder after the user's words have already passed.
    if (inlineCommand) {
      setCompanionCallActive(false)
      setVoiceInputActive(false)
      setVoiceVisualActive(false)
      setNativeCommandListening(false)
      setWakeAcknowledging(false)
      window.dispatchEvent(new CustomEvent('yun-browser-inline-command', {
        detail: { text: inlineCommand },
      }))
      return
    }

    wakeAcknowledgementInFlightRef.current = true
    // Begin browser capture on the wake event itself. The acknowledgement is a
    // parallel cue only; it must never gate the user's next spoken words.
    startCompanionCall({ listenImmediately: true })
    setNativeCommandListening(false)
    setWakeAcknowledging(true)
    setVoiceCallStatus('聆听中')

    try {
      // The acknowledgement itself is already fingerprint-filtered below. Use a
      // very short guard so the user can speak naturally as soon as it ends.
      nextSpeechEchoGuardMsRef.current = WAKE_ACK_ECHO_GUARD_MS
      wakeAcknowledgementEchoRef.current = {
        text: acknowledgement,
        expiresAt: Date.now() + TTS_ECHO_FINGERPRINT_MS,
      }
      await yunVoice.speakText(acknowledgement, {
        force: true,
        allowBargeIn: false,
      })
    } finally {
      wakeAcknowledgementInFlightRef.current = false
      setWakeAcknowledging(false)
    }
  }, [startCompanionCall, voiceController, yunVoice])
  const handleBargeInCandidate = useCallback(({ rms, aecMode }) => {
    // PHASE 4 only proves that post-AEC capture can see a candidate while
    // playback is active. The cancellation action is intentionally deferred
    // to the dedicated barge-in phase.
    console.debug('[BARGE-IN] candidate detected', { rms, aecMode })
    setVoiceCallStatus('检测到讲话')
  }, [])
  const handleNativeBargeIn = useCallback(() => {
    if (!yunVoice.isSpeaking || voiceInputActive) return
    // The native engine has already opened an ASR turn from the first user
    // frame. Stop only Yun's output; never pause the user's music.
    yunVoice.stopSpeaking()
    setCompanionCallActive(false)
    setVoiceInputActive(false)
    setNativeCommandListening(true)
    setNativeCommandTranscribing(false)
    setVoiceVisualActive(false)
    setVoiceCallStatus('正在听你说')
  }, [voiceInputActive, yunVoice])
  const bargeIn = useYunBargeIn({
    enabled: yunVoice.isSpeaking && yunVoice.isSpeechInterruptible && !voiceInputActive,
    onCandidate: handleBargeInCandidate,
  })

  useEffect(() => {
    if (wasSpeakingRef.current && !yunVoice.isSpeaking && !bargeInRef.current) {
      const guardMs = nextSpeechEchoGuardMsRef.current ?? COMPANION_ECHO_GUARD_MS
      echoGuardUntilRef.current = Date.now() + guardMs
      nextSpeechEchoGuardMsRef.current = null
    }
    if (!yunVoice.isSpeaking) bargeInRef.current = false
    wasSpeakingRef.current = yunVoice.isSpeaking
  }, [yunVoice.isSpeaking])

  useEffect(() => {
    let responseId = voiceController.getSnapshot().responseId
    if (yunVoice.isPreparingSpeech && !responseId) {
      responseId = voiceController.startResponse()
    }
    if (yunVoice.isSpeaking) voiceController.outputStarted(responseId)
    if (!yunVoice.isPreparingSpeech && !yunVoice.isSpeaking && responseId) {
      voiceController.outputEnded(responseId)
    }
  }, [voiceController, yunVoice.isPreparingSpeech, yunVoice.isSpeaking])

  const asrWakeWord = useAsrWakeWord({
    // The shared capture stream stays alive while Yun speaks. This only skips
    // wake-word compute during an explicit command turn, never microphone I/O.
    suspended: voiceInputActive,
    onWake: wakeVoiceInput,
  })
  const wakeWord = useYunWakeWord({
    // Never open two independent microphone recognizers at once. Local/remote
    // ASR takes precedence whenever the user enables it.
    suspended: voiceInputActive || yunVoiceIsActive || asrWakeWord.enabled || asrWakeWord.nativeActive,
    onWake: wakeVoiceInput,
    // Wake by the spoken name alone. Anyone nearby can call Yun; no voice
    // print enrollment or speaker verification is required.
    voiceprintEnabled: false,
  })
  const audioCapture = usePersistentAudioCapture({
    // Native engine already owns the physical mic while it is healthy. Do not
    // open Chromium capture in parallel and steal/duplicate the same input.
    enabled: (!asrWakeWord.nativeActive && asrWakeWord.enabled) || companionCallActive || yunVoiceIsActive,
  })
  const duplexPhysicalTest = useFullDuplexPhysicalTest({ manager: audioCapture.manager })
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.yunVoiceDiagnostics = audioCapture.metrics
    return () => { delete window.yunVoiceDiagnostics }
  }, [audioCapture.metrics])
  const [asrSettingsOpen, setAsrSettingsOpen] = useState(false)
  const yunMemory = useYunMemory()
  const yunAgent = useYunAgent({
    player: legacyPlayer,
    voice: yunVoice,
    libraryTracks,
    currentSong,
  })
  const {
    messages: chatMessages,
    isThinking: chatIsThinking,
    playHistory,
    recentRecommendations,
    sendMessage: sendChatMessage,
    reactToSongChange,
    prefetchSongReaction,
    rememberPlayedSong,
    resolveSkillCandidate,
    appendRemoteTurn,
  } = useYunChat({
    currentSong,
    libraryTracks,
    player: {
      audioRef,
      currentSong,
      playSong,
      playSongFromQueue,
      clearPlaybackQueue,
      pausePlayback,
      togglePlayPause,
      playNext,
      playPrevious,
      seekTo,
      setPlaybackMode,
      setResponseMode: applyResponseMode,
      setQueuedNextSong,
      setAutoUpNext,
    },
    voice: yunVoice,
    responseMode,
    personaMode,
    musicSource: librarySource,
    memory: yunMemory,
    agent: yunAgent,
  })
  useCowAgentYunBridge({
    player: legacyPlayer,
    voice: yunVoice,
    currentSong,
    playHistory,
    recentRecommendations,
    onRemoteTurn: appendRemoteTurn,
    onRemoteOutcome: ({ reply }) => appendRemoteTurn({ reply }),
  })
  const selectedVoiceOption = voiceOptions.find((option) => option.id === voiceSettings.voice)
  const selectedVoiceLabel = selectedVoiceOption?.label || 'custom voice'

  const setResponseMode = applyResponseMode

  const selectPlaybackMode = useCallback((mode) => {
    setPlaybackMode(mode)
    setActivePanel(null)
  }, [setPlaybackMode])

  const handleVoiceRecognitionError = useCallback((error) => {
    const labels = {
      'not-allowed': '麦克风权限被拒绝',
      'service-not-allowed': '语音识别服务不可用',
      unsupported: '当前环境不支持语音识别',
      network: '语音识别网络异常',
      'audio-capture': '麦克风暂不可用',
      'start-failed': '语音识别启动失败',
      'no-speech': '没有识别到语音',
    }
    setVoiceCallStatus(labels[error] || '语音识别异常')
  }, [])

  const handleVoiceSilenceTimeout = useCallback((event = {}) => {
    const reason = event?.reason || 'silence'
    const error = event?.error || ''
    const fatal = ['not-allowed', 'service-not-allowed', 'unsupported', 'microphone-denied'].includes(error || reason)
    const retryable = ['network', 'audio-capture', 'start-failed', 'recognition-failed', 'recognition-error'].includes(error || reason)

    setVoiceInputActive(false)
    if (fatal) {
      setCompanionCallActive(false)
      return
    }

    if (retryable) {
      const attempts = voiceRetryAttemptsRef.current + 1
      voiceRetryAttemptsRef.current = attempts
      if (attempts >= MAX_VOICE_RETRY_ATTEMPTS) {
        setVoiceCallStatus('语音连接失败，请手动重新开始')
        setCompanionCallActive(false)
        return
      }
      setVoiceCallStatus(`连接重试 ${attempts}/${MAX_VOICE_RETRY_ATTEMPTS}`)
      setVoiceResumeDelayMs(Math.min(4000, 800 * attempts))
      return
    }

    // Silence is expected in a phone-like companion call. Wait a little, then
    // reopen the next recognition turn without consuming the error budget.
    setVoiceCallStatus('等待你说话')
    setVoiceResumeDelayMs(650)
  }, [])

  const handleVoiceTranscript = useCallback((transcript) => {
    const text = normalizeVoiceTranscript(transcript)
    setVoiceInputActive(false)
    setChatDraft('')
    voiceRetryAttemptsRef.current = 0
    setVoiceResumeDelayMs(320)
    const wakeAcknowledgementEcho = wakeAcknowledgementEchoRef.current
    const isWakeAcknowledgementEchoed = Date.now() < wakeAcknowledgementEcho.expiresAt
      && isWakeAcknowledgementEcho(text, wakeAcknowledgementEcho.text)
    const isWithinEchoWindow = Date.now() < echoGuardUntilRef.current
    const isRecentTtsEcho = Date.now() - yunVoice.lastSpeechEndedAt < TTS_ECHO_FINGERPRINT_MS
      && isLikelyTtsEcho(text, yunVoice.recentSpokenText)
    if (isWakeAcknowledgementEchoed || (isWithinEchoWindow && isLikelyTtsEcho(text, yunVoice.recentSpokenText)) || isRecentTtsEcho) {
      // The microphone can still hear the last syllables from Yun's speaker
      // output. Also reject a matching TTS phrase that arrives after the
      // timing guard, which is common with laptop speakers.
      setVoiceCallStatus('已过滤回声')
      setVoiceResumeDelayMs(900)
      return 'echo'
    }
    if (isCompanionCallEnd(text)) {
      setCompanionCallActive(false)
      yunVoice.stopSpeaking()
      return
    }
    if (!text) return
    setVoiceCallStatus(chatIsThinking ? '已听到，优先处理这句' : '理解中')
    voiceController.startResponse()
    sendChatMessage(text)
    return 'submitted'
  }, [chatIsThinking, sendChatMessage, voiceController, yunVoice])

  const handleVoiceInterimTranscript = useCallback((transcript) => {
    setChatDraft(transcript)
    setVoiceVisualActive(true)
    setVoiceVisualActivityAt(Date.now())
  }, [])

  useEffect(() => {
    const handleNativeTranscript = (event) => {
      const text = String(event.detail?.text || '').trim()
      const isInlineBrowserCommand = event.type === 'yun-browser-inline-command'
      // Ignore a late final event from a previous native session. Without this
      // gate, a stale punctuation-only ASR result could enter chat after the
      // wake UI had already returned to idle.
      if (!isInlineBrowserCommand && !nativeCommandListening && !nativeCommandTranscribing) return
      resetNativeWakeUi('idle')
      if (text) {
        const result = handleVoiceTranscript(text)
        // The native stream is continuous. If the final transcript was only
        // Yun's own acknowledgement, keep this listening turn open for the
        // user's actual command instead of forcing another wake-up.
        if (result === 'echo') {
          setNativeCommandListening(true)
          setNativeCommandTranscribing(false)
          setVoiceVisualActive(true)
          setVoiceCallStatus('正在听')
        }
      }
      else {
        setVoiceCallStatus(event.detail?.reason === 'command_timeout' ? '没有听清，请重新唤醒' : '没有听清，请再说一次')
      }
    }
    const handleNativeTranscribing = () => {
      setNativeCommandTranscribing(true)
      // The full-screen awakening field is only an input affordance. Once
      // audio has been handed to ASR it must disappear, even if the backend
      // recognizer is slow or fails to answer.
      setVoiceVisualActive(false)
      setVoiceCallStatus('正在转写')
    }
    const handleNativeAsrError = (event) => {
      resetNativeWakeUi('语音转写失败，请再试一次')
      console.error('[NATIVE ASR] transcription failed', event.detail)
    }
    const handleNativeVoiceLevel = (event) => setNativeVoiceLevel(Number(event.detail?.level || 0))
    window.addEventListener('yun-native-asr-final', handleNativeTranscript)
    window.addEventListener('yun-browser-inline-command', handleNativeTranscript)
    window.addEventListener('yun-native-asr-transcribing', handleNativeTranscribing)
    window.addEventListener('yun-native-asr-error', handleNativeAsrError)
    window.addEventListener('yun-native-barge-in', handleNativeBargeIn)
    window.addEventListener('yun-native-voice-level', handleNativeVoiceLevel)
    return () => {
      window.removeEventListener('yun-native-asr-final', handleNativeTranscript)
      window.removeEventListener('yun-browser-inline-command', handleNativeTranscript)
      window.removeEventListener('yun-native-asr-transcribing', handleNativeTranscribing)
      window.removeEventListener('yun-native-asr-error', handleNativeAsrError)
      window.removeEventListener('yun-native-barge-in', handleNativeBargeIn)
      window.removeEventListener('yun-native-voice-level', handleNativeVoiceLevel)
    }
  }, [handleNativeBargeIn, handleVoiceTranscript, nativeCommandListening, nativeCommandTranscribing, resetNativeWakeUi])

  useEffect(() => {
    if (!nativeCommandListening || nativeCommandTranscribing) return undefined

    // The sidecar normally sends an asr_partial event before it calls the
    // recognizer. If that event never arrives (for example, a dropped native
    // websocket), do not leave the command UI stuck in “listening” forever.
    const timeout = window.setTimeout(() => {
      resetNativeWakeUi('没有听清，请重新唤醒')
    }, 7500)
    return () => window.clearTimeout(timeout)
  }, [nativeCommandListening, nativeCommandTranscribing, resetNativeWakeUi])

  useEffect(() => {
    if (!nativeCommandTranscribing) return undefined

    // ASR is normally local and fast, but a model/service failure must not
    // leave the companion call in a permanent “正在转写” state.
    const timeout = window.setTimeout(() => {
      resetNativeWakeUi('语音转写超时，请重新唤醒')
    }, 9000)
    return () => window.clearTimeout(timeout)
  }, [nativeCommandTranscribing, resetNativeWakeUi])

  useEffect(() => {
    if (!nativeCommandListening || nativeCommandTranscribing) return undefined

    // Never let the large wake ring become a permanent wallpaper. Listening
    // can continue in the native engine, but after this short visual window
    // the UI returns to its calm background until ASR has a concrete result.
    const visualTimeout = window.setTimeout(() => {
      setVoiceVisualActive(false)
    }, 5200)
    return () => window.clearTimeout(visualTimeout)
  }, [nativeCommandListening, nativeCommandTranscribing])

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return
      if (!nativeCommandListening && !nativeCommandTranscribing && !voiceVisualActive) return
      event.preventDefault()
      resetNativeWakeUi('已退出语音唤醒')
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [nativeCommandListening, nativeCommandTranscribing, resetNativeWakeUi, voiceVisualActive])

  useEffect(() => {
    if (!companionCallActive || !voiceInputActive || nativeCommandListening || nativeCommandTranscribing || wakeAcknowledging || chatIsThinking || yunVoiceIsActive) {
      return undefined
    }

    // A companion turn is short and intentional: if the user does not begin
    // replying within two seconds, end the call and return to wake-word mode.
    const idleTimer = window.setTimeout(() => {
      setVoiceInputActive(false)
      setVoiceVisualActive(false)
      setVoiceCallStatus('idle')
      setCompanionCallActive(false)
    }, 2000)
    return () => window.clearTimeout(idleTimer)
  }, [chatIsThinking, companionCallActive, nativeCommandListening, nativeCommandTranscribing, voiceInputActive, voiceVisualActivityAt, wakeAcknowledging, yunVoiceIsActive])

  useEffect(() => {
    if (!companionCallActive || nativeCommandListening || nativeCommandTranscribing || wakeAcknowledging || voiceInputActive || chatIsThinking || yunVoiceIsActive) {
      return undefined
    }

    // Web Speech naturally ends after a quiet gap. Keep the companion call
    // alive by reopening the next listening turn instead of ending the session.
    const echoDelay = Math.max(0, echoGuardUntilRef.current - Date.now())
    const resumeTimer = window.setTimeout(() => {
      setVoiceResumeDelayMs(120)
      setVoiceInputActive(true)
    }, Math.max(voiceResumeDelayMs, 120, echoDelay))
    return () => window.clearTimeout(resumeTimer)
  }, [chatIsThinking, companionCallActive, nativeCommandListening, nativeCommandTranscribing, voiceInputActive, voiceResumeDelayMs, wakeAcknowledging, yunVoiceIsActive])

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

  useEffect(() => () => window.clearTimeout(libraryEdgeTimerRef.current), [])

  const openChatDock = useCallback(() => {
    window.clearTimeout(chatDockTimerRef.current)
    setChatDockOpen(true)
  }, [])

  const keepChatDockOpen = useCallback(() => {
    window.clearTimeout(chatDockTimerRef.current)
  }, [])

  const scheduleChatDockClose = useCallback(() => {
    window.clearTimeout(chatDockTimerRef.current)
    chatDockTimerRef.current = window.setTimeout(() => {
      setChatDockOpen(false)
    }, 760)
  }, [])

  useEffect(() => () => window.clearTimeout(chatDockTimerRef.current), [])

  useEffect(() => {
    const detectLeftBottomCorner = (event) => {
      if (event.clientX <= 170 && window.innerHeight - event.clientY <= 210) {
        openChatDock()
        return
      }

      if (!chatDockOpen) return

      const chatPanel = document.querySelector('.chat-panel.is-open')
      const panelRect = chatPanel?.getBoundingClientRect()
      const activeInside = chatPanel?.contains(document.activeElement)
      const pointerInsidePanel = panelRect
        && event.clientX >= panelRect.left
        && event.clientX <= panelRect.right
        && event.clientY >= panelRect.top
        && event.clientY <= panelRect.bottom

      if (activeInside || pointerInsidePanel) {
        keepChatDockOpen()
        return
      }

      scheduleChatDockClose()
    }
    window.addEventListener('pointermove', detectLeftBottomCorner, { passive: true })
    return () => window.removeEventListener('pointermove', detectLeftBottomCorner)
  }, [chatDockOpen, keepChatDockOpen, openChatDock, scheduleChatDockClose])

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
    // A settings panel is visually attached to this shell. Do not collapse
    // the shell while the pointer moves from its button into that panel.
    if (activePanel === 'voice' || activePanel === 'memory' || mountainPanelOpen) return
    if (!topControlsOpen || topControlsTimerRef.current) return
    topControlsTimerRef.current = window.setTimeout(() => {
      topControlsTimerRef.current = null
      setTopControlsOpen(false)
    }, 680)
  }, [activePanel, mountainPanelOpen, topControlsOpen])

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

  const playSongWithPodcastReaction = useCallback(async (song, trigger = 'user_play') => {
    const result = song?.source === 'netease'
      ? await playSongFromQueue(song, neteaseResults)
      : (clearPlaybackQueue(), await playSong(song))

    if (result?.ok) {
      reactToSongChange(result.song || song, trigger)
    }

    return result
  }, [clearPlaybackQueue, neteaseResults, playSong, playSongFromQueue, reactToSongChange])

  const playNextWithPodcastReaction = useCallback(async () => {
    const result = await playerCore.next()

    if (result?.ok && result.song) {
      reactToSongChange(result.song, 'user_next')
    }

    return result
  }, [playerCore, reactToSongChange])

  const playPreviousWithPodcastReaction = useCallback(async () => {
    const result = await playerCore.previous()

    if (result?.ok && result.song) {
      reactToSongChange(result.song, 'user_prev')
    }

    return result
  }, [playerCore, reactToSongChange])

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
  const virtualTrackRange = useMemo(() => {
    const viewportHeight = libraryScrollListRef.current?.clientHeight || 286
    const start = Math.max(0, Math.floor(libraryScrollTop / LIBRARY_SCROLL_ROW_HEIGHT) - LIBRARY_SCROLL_OVERSCAN)
    const end = Math.min(
      drawerTracks.length,
      Math.ceil((libraryScrollTop + viewportHeight) / LIBRARY_SCROLL_ROW_HEIGHT) + LIBRARY_SCROLL_OVERSCAN,
    )
    return { start, end: Math.max(start, end) }
  }, [drawerTracks.length, libraryScrollTop])
  const virtualDrawerTracks = drawerTracks.slice(virtualTrackRange.start, virtualTrackRange.end)
  const waitingTracks = upNextTracks
  const aiCandidateTracks = autoUpNextTracks
  const clearWaitingTracks = useCallback(() => {
    clearUpNext()
  }, [clearUpNext])

  const searchOnlineMusic = useCallback(async () => {
    const keywords = libraryQuery.trim()

    if (!keywords || neteaseStatus === 'loading') {
      return
    }

    setLibrarySource('netease')
    setNeteaseLibraryView('songs')
    setActiveNeteasePlaylist(null)
    setNeteaseStatus('loading')
    setNeteaseError('')
    setNeteaseResults([])
    const requestId = ++neteaseRequestRef.current

    try {
      const songs = await searchNeteaseSongs(keywords, { limit: 12 })
      if (requestId !== neteaseRequestRef.current) return
      setNeteaseResults(songs)
      setNeteaseStatus('ready')
      if (!songs.length) {
        setNeteaseError('没有找到当前可播放的网易云歌曲')
      }
    } catch (error) {
      if (requestId !== neteaseRequestRef.current) return
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

  const loadNeteaseAccount = useCallback(async () => {
    if (neteaseAccountStatus === 'loading') return
    setNeteaseAccountStatus('loading')
    try {
      const account = await fetchNeteaseMe()
      setNeteaseMe(account)
      setNeteaseAccountStatus('ready')
    } catch {
      setNeteaseMe(null)
      setNeteaseAccountStatus('error')
    }
  }, [neteaseAccountStatus])

  useEffect(() => {
    if (activePanel !== 'library' || neteaseAccountStatus !== 'idle') return undefined
    const timer = window.setTimeout(loadNeteaseAccount, 0)
    return () => window.clearTimeout(timer)
  }, [activePanel, loadNeteaseAccount, neteaseAccountStatus])

  useEffect(() => {
    const syncNeteaseAccount = (event) => {
      if (event.detail?.provider !== 'netease') return
      setNeteaseMe(null)
      setNeteaseAccountStatus('idle')
    }
    window.addEventListener('yun:login-submit', syncNeteaseAccount)
    return () => window.removeEventListener('yun:login-submit', syncNeteaseAccount)
  }, [])

  const openNeteasePlaylist = useCallback(async (playlist) => {
    setLibrarySource('netease')
    setNeteaseLibraryView('songs')
    setActiveNeteasePlaylist(playlist)
    setNeteaseStatus('loading')
    setNeteaseError('')
    const requestId = ++neteaseRequestRef.current
    try {
      const songs = await fetchNeteasePlaylistTracks(playlist.id)
      if (requestId !== neteaseRequestRef.current) return
      setNeteaseResults(songs)
      setNeteaseStatus('ready')
      setNeteaseError(songs.length ? '' : `${playlist.name}暂时没有歌曲`)
    } catch (error) {
      if (requestId !== neteaseRequestRef.current) return
      setNeteaseStatus('error')
      setNeteaseError(error instanceof Error ? error.message : '网易云歌单读取失败')
    }
  }, [])

  const openNeteasePlaylists = useCallback(() => {
    ++neteaseRequestRef.current
    setLibrarySource('netease')
    setNeteaseLibraryView('playlists')
    setActiveNeteasePlaylist(null)
    setNeteaseError('')
  }, [])

  const handleLibraryScroll = useCallback((event) => {
    setLibraryScrollTop(event.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    setLibraryScrollTop(0)
    if (libraryScrollListRef.current) libraryScrollListRef.current.scrollTop = 0
  }, [librarySource, neteaseLibraryView, activeNeteasePlaylist?.id])

  const likedNeteasePlaylist = neteaseMe?.playlists?.find((playlist) => playlist.liked)

  const importSelectedMusic = useCallback(async (event) => {
    const files = event.target.files
    if (!files?.length || isImportingMusic) return
    setIsImportingMusic(true)
    setLibraryStatus('loading')
    setLibraryError('')
    try {
      const library = await importMusicFiles(files)
      setLibraryTracks(library.songs)
      setLibraryCount(library.count ?? library.songs.length)
      setLibrarySource('local')
      setLibraryStatus('ready')
    } catch (error) {
      setLibraryStatus('error')
      setLibraryError(error instanceof Error ? error.message : '导入歌曲失败')
    } finally {
      setIsImportingMusic(false)
      event.target.value = ''
    }
  }, [isImportingMusic])

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
    // The library is only rendered after the drawer is opened. Reading and
    // normalizing its JSON on the first event-loop turn competes with initial
    // layout and WebGL setup, so leave the first screen responsive first.
    const timer = window.setTimeout(loadMusicLibrary, 520)

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
    if (!lastAutoNextSong?.song) return
    rememberPlayedSong(lastAutoNextSong.song)
  }, [lastAutoNextSong, rememberPlayedSong])

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

  useEffect(() => {
    const keepsAiQueueFull = playbackMode === 'ai_recommend'
    const supportsRadioPrefetch = responseMode === 'podcast' || keepsAiQueueFull || playbackMode === 'companion_continue'
    const songKey = currentSong?.id || currentSong?.fileUrl || ''
    const minimumQueue = keepsAiQueueFull || playbackMode === 'companion_continue' ? 3 : 1
    const shouldTopUp = autoUpNextTracks.length < minimumQueue

    // AI recommendation mode owns a standing three-track safety buffer. It
    // starts filling as soon as there is a current song, rather than waiting
    // for playback progress, so a completed queue never leaves an empty slot.
    if (!supportsRadioPrefetch || !songKey || !shouldTopUp || (!keepsAiQueueFull && !isPlaying) || radioPrefetchingRef.current) {
      return undefined
    }

    const prefetchKey = `${songKey}:${autoUpNextTracks.length}`
    if (radioPrefetchRef.current === prefetchKey) return undefined
    radioPrefetchRef.current = prefetchKey
    radioPrefetchingRef.current = true
    let cancelled = false
    let receivedCandidates = false
    const retry = () => {
      if (cancelled || !keepsAiQueueFull) return
      window.clearTimeout(radioPrefetchRetryTimerRef.current)
      radioPrefetchRetryTimerRef.current = window.setTimeout(() => {
        setRadioPrefetchRetryNonce((value) => value + 1)
      }, 700)
    }

    const recommendationExclusions = [
      ...recentRecommendations,
      ...radioRecommendationHistory,
    ]
    requestRadioPrefetch({ currentSong, playHistory, recentRecommendations: recommendationExclusions, playbackMode })
      .then((response) => {
        if (cancelled) return
        const candidates = Array.isArray(response?.playbackPlan?.candidates)
          ? response.playbackPlan.candidates
          : []
        const tracks = candidates
          .map((suggested) => suggested?.id ? libraryTracks.find((item) => item.id === suggested.id) || suggested : null)
          .filter((track) => track?.fileUrl)
        if (tracks.length) {
          receivedCandidates = true
          const playedIds = [
            currentSong?.id,
            currentSong?.providerId,
            ...playHistory.flatMap((song) => [song?.id, song?.providerId]),
            ...recentRecommendations.flatMap((item) => [item?.song?.id, item?.song?.providerId, item?.id, item?.providerId]),
          ].filter(Boolean)
          setAutoUpNext(tracks, { excludeSongIds: playedIds, maxItems: 6 })
          setRadioRecommendationHistory((current) => {
            const planned = tracks.map((song) => ({
              id: song.id,
              providerId: song.providerId,
              title: song.title,
              artist: song.artist,
            }))
            const next = [...planned, ...current]
            return next
              .filter((song, index, items) => items.findIndex((item) => String(item.providerId || item.id || '') === String(song.providerId || song.id || '')) === index)
              .slice(0, 72)
          })
          // Auto-up-next owns this recommendation batch. Keeping the same
          // first item in the legacy one-track slot would replay it after the
          // visible queue has been consumed.
          setQueuedNextSong(null)
          if (responseMode === 'podcast') prefetchSongReaction(tracks[0], 'auto_next')
        } else {
          retry()
        }
      })
      .catch(() => {
        retry()
      }).finally(() => {
        radioPrefetchingRef.current = false
        // The state update above can render while this request is still marked
        // busy. Trigger one fast post-request pass after it becomes idle so a
        // queue with fewer than three candidates is topped up immediately.
        radioPrefetchRef.current = ''
        if (!cancelled && receivedCandidates) {
          window.setTimeout(() => setRadioPrefetchRetryNonce((value) => value + 1), 120)
        }
      })

    return () => {
      cancelled = true
    }
  }, [autoUpNextTracks.length, currentSong, isPlaying, libraryTracks, playbackMode, playHistory, prefetchSongReaction, radioPrefetchRetryNonce, radioRecommendationHistory, recentRecommendations, responseMode, setAutoUpNext, setQueuedNextSong])

  useEffect(() => () => window.clearTimeout(radioPrefetchRetryTimerRef.current), [])

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
  const displayedSong = playerState.currentTrack || {
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
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSceneCoverItems(getSceneCoverItemsForPage(0))
    })

    return () => window.cancelAnimationFrame(frame)
  }, [getSceneCoverItemsForPage])
  const submitChatMessage = () => {
    const text = chatDraft.trim()

    if (!text && !chatImageFile) {
      return
    }

    setChatDraft('')
    const imageFile = chatImageFile
    setChatImageFile(null)
    if (chatImageInputRef.current) {
      chatImageInputRef.current.value = ''
    }
    sendChatMessage(text, imageFile ? { imageFile } : undefined)
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

  useEffect(() => {
    if (!currentSong?.id || !isPlaying) return
    void fetch('/api/yun/listening-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', song: currentSong, playedAt: Date.now() }),
    }).catch(() => {})
  }, [currentSong?.id, isPlaying])
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
  const progressPercent = playerState.duration ? Math.min(100, (playerState.currentTime / playerState.duration) * 100) : 0
  const backgroundCoverUrl = getSongCoverUrl(currentSong, sceneCoverItems[0]?.coverUrl || sceneTestCovers[0])
  const songThemeStyle = useSongTheme(backgroundCoverUrl)
  const volumePercent = Math.round((Number.isFinite(playerState.volume) ? playerState.volume : 1) * 100)
  const morphStyle = morphLayer
    ? {
        left: `${morphRect.left}px`,
        top: `${morphRect.top}px`,
        width: `${morphRect.width}px`,
        height: `${morphRect.height}px`,
        borderRadius: `${morphRadius}px`,
      }
    : undefined

  const applyProModelConfig = useCallback(async (event) => {
    event.preventDefault()
    if (!proModelForm.apiKey.trim() || isApplyingProModel) return
    setIsApplyingProModel(true)
    setProModelStatus('正在验证 Pro 模型连接…')
    try {
      await configureYunProModel(proModelForm)
      setProModelForm((form) => ({ ...form, apiKey: '' }))
      setProModelStatus('')
      setProModelSetupVisible(false)
    } catch (error) {
      setProModelStatus(error instanceof Error ? error.message : 'Pro 模型连接失败，请重试。')
    } finally {
      setIsApplyingProModel(false)
    }
  }, [isApplyingProModel, proModelForm])

  return (
    <PlayerProvider core={playerCore}>
    <main
      className={`app${uiMode === 'immersive' ? ' immersive-mode' : ' normal-mode'}${wallpaperMode ? ' wallpaper-mode' : ''}${isWebFullscreen ? ' web-fullscreen' : ''} quality-${visualQuality}${activePanel === 'library' ? ' library-open' : ''}${activePanel === 'memory' ? ' memory-settings-open' : ''}${activePanel === 'voice' ? ' voice-open' : ''}${activePanel === 'playMode' ? ' play-mode-open' : ''}${panelContentVisible ? '' : ' panel-content-hidden'}${morphLayer ? ' is-morphing' : ''}`}
      style={songThemeStyle}
    >
      {visualBooted && (
        <AnimatedBackground
          active={playerState.isPlaying}
          coverUrl={backgroundCoverUrl}
          trackKey={playerState.currentTrack?.id || playerState.currentTrack?.url || playerState.currentTrack?.path || `${playerState.currentTrack?.title || ''}-${playerState.currentTrack?.artist || ''}`}
          preloadCoverUrls={backgroundPreloadCoverUrls}
          getFrequencyData={readAudioFrequencyData}
          mountainControls={mountainControls}
          backgroundBrightness={backgroundBrightness}
          topFogStrength={topFogStrength}
          topBlurStrength={topBlurStrength}
          viewLocked={viewLocked}
          voiceOrbVisible={voiceVisualVisible}
          voiceOrbLevel={voiceOrbLevel}
          onReady={onVisualReady}
          quality={visualQuality}
        />
      )}
      <div
        className={`yun-awakening-optics${voiceVisualVisible ? ' is-active' : ''}`}
        aria-hidden="true"
      />
      <div
        ref={speakingOpticsRef}
        className={`yun-speaking-optics${yunVoice.isSpeaking ? ' is-active' : ''}`}
        aria-hidden="true"
      >
        <span className="yun-speaking-optics__ring" />
        <span className="yun-speaking-optics__tint" />
      </div>
      <div
        className={`library-edge-trigger${libraryEdgeOpen ? ' is-active' : ''}`}
        aria-hidden="true"
        onPointerEnter={openLibraryFromEdge}
        onPointerMove={keepEdgeLibraryOpen}
      ><span /></div>
      <div
        className={`top-controls-edge-trigger${topControlsOpen ? ' is-active' : ''}`}
        aria-hidden="true"
        onPointerEnter={openTopControls}
        onPointerMove={keepTopControlsOpen}
        onPointerLeave={scheduleTopControlsClose}
      />
      <FloatingLyrics currentSong={currentSong} currentTime={currentTime} active={isPlaying} />
      {visualQuality === 'high' && <LyricForegroundFog quality={visualQuality} />}
      <div className="scene-cover-overlay">
        <div className="scene-cover-stage">
          {sceneCoverItems.map((item, index) => (
            <div
              className={`scene-cover-slot scene-cover-slot--${index + 1}${item.track?.id === currentSong?.id ? ' is-active' : ''}`}
              key={`scene-cover-${index + 1}`}
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
              {item.track && (
                <div className="scene-cover-meta">
                  <span className="scene-cover-title">{item.track.title}</span>
                  <span className="scene-cover-artist">{item.track.artist}</span>
                </div>
              )}
            </div>
          ))}
        </div>
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
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
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
            <button
              className={`action-button fullscreen-toggle${isWebFullscreen ? ' is-active' : ''}`}
              type="button"
              aria-label={isWebFullscreen ? '退出全屏' : '全屏打开网页'}
              aria-pressed={isWebFullscreen}
              onClick={toggleWebFullscreen}
            >
              {isWebFullscreen ? '退出全屏' : '全屏'}
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
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
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
        onCaptureStart={handleVoiceCaptureStart}
        onCaptureStop={handleVoiceCaptureStop}
        onSilenceTimeout={handleVoiceSilenceTimeout}
        onTranscript={handleVoiceTranscript}
        onInterimTranscript={handleVoiceInterimTranscript}
        onRecognitionError={handleVoiceRecognitionError}
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
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
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
              <span className="voice-row-label">浏览器备用唤醒</span>
              <button
                className={`voice-toggle${wakeWord.enabled ? ' is-on' : ''}`}
                type="button"
                aria-pressed={wakeWord.enabled}
                aria-label={wakeWord.enabled ? '关闭浏览器备用唤醒' : '开启浏览器备用唤醒'}
                onClick={() => {
                  const next = !wakeWord.enabled
                  wakeWord.setEnabled(next)
                  if (next) asrWakeWord.setEnabled(false)
                }}
              >
                {wakeWord.enabled ? '开' : '关'}
              </button>
              <span className="voice-value">{({ listening: '备用模式：等“小昀”', paused: '暂停', verifying: '唤醒中', woken: '已唤醒', denied: '麦克风未授权', unsupported: '环境不支持', error: '重试中', off: '关闭' })[wakeWord.status] || '启动中'}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">主唤醒：本机“小昀”</span>
              <button
                className={`voice-toggle${asrWakeWord.enabled ? ' is-on' : ''}`}
                type="button"
                aria-pressed={asrWakeWord.enabled}
                aria-label={asrWakeWord.enabled ? '关闭本地关键词唤醒' : '开启本地关键词唤醒'}
                onClick={() => {
                  const next = !asrWakeWord.enabled
                  asrWakeWord.setEnabled(next)
                  if (next) wakeWord.setEnabled(false)
                }}
              >
                {asrWakeWord.enabled ? '开' : '关'}
              </button>
              <span className="voice-value-asr-wrap">
              <span className="voice-value">{({ 'native-listening': '原生引擎正在等“小昀”', listening: '正在等“小昀”', paused: '暂停', recognizing: '识别中', woken: '已唤醒', 'not-detected': '未听清“小昀”', denied: '麦克风未授权', unsupported: '环境不支持', unconfigured: '识别服务未就绪', off: '关闭' })[asrWakeWord.status] || '启动中'}</span>
                <button
                  className="voice-value-asr-set"
                  type="button"
                  onClick={() => setAsrSettingsOpen((open) => !open)}
                >
                  设置
                </button>
              </span>
            </div>
            {asrSettingsOpen && (
              <AsrSettingsPanel
                className="voice-asr-settings"
                onConfiguredChange={() => asrWakeWord.refreshConfig()}
              />
            )}
            <div className="voice-row">
              <span className="voice-row-label">说话可打断</span>
              <span className="voice-value">{({ listening: '侦听中', candidate: '检测到讲话', denied: '未授权', unsupported: '不支持', off: '待命' })[bargeIn.status] || '待命'}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">全双工物理测试</span>
              <button
                className="voice-toggle"
                type="button"
                disabled={duplexPhysicalTest.active}
                onClick={() => duplexPhysicalTest.start((text) => yunVoice.speakText(text, { force: true, allowBargeIn: false }))}
              >
                {duplexPhysicalTest.active ? '测试中' : '开始'}
              </button>
              {duplexPhysicalTest.report && (
                <button className="voice-value-asr-set" type="button" onClick={duplexPhysicalTest.download}>下载结果</button>
              )}
              <span className="voice-value">{({ baseline: '安静 3 秒', baseline_warning: '基线异常，继续测试', ai_only: '播放基线', user_prompt: '请说“等等，我正在测试打断”', complete: duplexPhysicalTest.report?.result || '完成', idle: '待命' })[duplexPhysicalTest.phase] || duplexPhysicalTest.phase}</span>
            </div>
            <div className="voice-row">
              <span className="voice-row-label">陪伴通话</span>
              <button
                className={`voice-toggle${companionCallActive ? ' is-on' : ''}`}
                type="button"
                aria-pressed={companionCallActive}
                onClick={() => {
                  if (companionCallActive) {
                    setVoiceInputActive(false)
                    setVoiceVisualActive(false)
                    setVoiceCallStatus('idle')
                    yunVoice.stopSpeaking()
                    setCompanionCallActive(false)
                    return
                  }
                  startCompanionCall()
                }}
              >
                {companionCallActive ? '通话中' : '开始'}
              </button>
              <span className="voice-value">{companionCallActive ? ({ listening: '正在听', '等待你说话': '等待你说话', '理解中': '正在理解', '回应中': '小昀正在回应' }[voiceCallStatus] || voiceCallStatus) : (voiceCallStatus === 'idle' ? '唤醒后自动开启' : voiceCallStatus)}</span>
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
                placeholder="输入豆包音色 ID"
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
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
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

          <div className="memory-settings-row memory-settings-row--section">
            <span>视觉画质</span>
            <span className="voice-value">{visualQuality === 'low' ? '流畅' : visualQuality === 'high' ? '高画质' : '推荐'}</span>
          </div>
          <div className="memory-mode-options" aria-label="视觉画质">
            {[
              { id: 'low', label: '流畅' },
              { id: 'medium', label: '推荐' },
              { id: 'high', label: '高画质' },
            ].map((option) => (
              <button
                className={`memory-mode-button${visualQuality === option.id ? ' active' : ''}`}
                type="button"
                key={option.id}
                aria-pressed={visualQuality === option.id}
                onClick={() => updateVisualQuality(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="memory-mode-description">
            {visualQuality === 'low'
              ? '优先保持流畅，减少动态光场与渲染像素。'
              : visualQuality === 'high'
                ? '开启完整歌词雾化与更高渲染精度，显卡占用更高。'
                : '平衡画面和流畅度，适合作为日常默认。'}
          </p>

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

          {proModelSetupVisible && (
            <form className="pro-model-config" onSubmit={applyProModelConfig}>
              <div className="memory-settings-row memory-settings-row--section">
                <span>连接 Pro 模型</span>
                <span className="voice-value">DeepSeek</span>
              </div>
              <p>仅发送到本机服务进行验证；验证成功后会保存到本机 .env（已被 Git 忽略），不会写入前端或浏览器存储。</p>
              <label>
                Base URL
                <input
                  value={proModelForm.baseUrl}
                  onChange={(event) => setProModelForm((form) => ({ ...form, baseUrl: event.target.value }))}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Pro 模型名
                <input
                  value={proModelForm.model}
                  onChange={(event) => setProModelForm((form) => ({ ...form, model: event.target.value }))}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="pro-model-config-key">
                API Key
                <input
                  type="password"
                  value={proModelForm.apiKey}
                  onChange={(event) => setProModelForm((form) => ({ ...form, apiKey: event.target.value }))}
                  placeholder="仅在提交时使用"
                  autoComplete="off"
                  required
                />
              </label>
              <button type="submit" disabled={isApplyingProModel}>
                {isApplyingProModel ? '验证中…' : '验证并保存启用'}
              </button>
              {proModelStatus && <small role="status">{proModelStatus}</small>}
            </form>
          )}

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
        className={`chat-panel${chatDockOpen ? ' is-open' : ''}${voiceInputActive ? ' is-listening' : ''}`}
        onMouseEnter={keepChatDockOpen}
        onMouseLeave={scheduleChatDockClose}
        onFocus={openChatDock}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) scheduleChatDockClose()
        }}
      >
        <div className="chat-content">
          <div className="chat-header">
            <p className="sub">YUN COMPANION</p>
            <span>{voiceInputActive ? 'listening' : selectedVoiceLabel}</span>
          </div>
          <div className="chat-messages" ref={chatMessagesRef}>
            {chatMessages.map((message) => (
              <div
                className={`chat-bubble ${message.role === 'user' ? 'chat-bubble--me' : 'chat-bubble--yun'}`}
                key={message.id}
              >
                <span>{message.role === 'user' ? '我' : '昀'}</span>
                <p>{message.content}</p>
                {message.skillCandidate && (
                  <div className="chat-skill-candidate">
                    {message.skillCandidate.status === 'proposed' ? (
                      <>
                        <small>这类操作已经成功完成 {message.skillCandidate.successCount} 次。要保存成快捷 Skill 吗？</small>
                        <div>
                          <button type="button" onClick={() => resolveSkillCandidate(message.skillCandidate.id, 'approved')}>保存快捷方式</button>
                          <button type="button" onClick={() => resolveSkillCandidate(message.skillCandidate.id, 'rejected')}>暂不保存</button>
                        </div>
                      </>
                    ) : (
                      <small>{message.skillCandidate.status === 'approved' ? '已保存为本地快捷 Skill。' : '未保存这条候选 Skill。'}</small>
                    )}
                  </div>
                )}
              </div>
            ))}
            {chatIsThinking && (
              <div className="chat-bubble chat-bubble--yun chat-bubble--thinking">
                <span>昀</span>
                <p>昀正在想……</p>
              </div>
            )}
          </div>
          {chatImageFile && (
            <div className="chat-image-chip">
              <span>{chatImageFile.name}</span>
              <button
                type="button"
                aria-label="移除图片"
                onClick={() => {
                  setChatImageFile(null)
                  if (chatImageInputRef.current) {
                    chatImageInputRef.current.value = ''
                  }
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className="chat-input">
            <button
              className="chat-voice-button"
              type="button"
              aria-label={voiceInputActive ? '停止语音输入' : '语音输入'}
              aria-pressed={voiceInputActive}
              onClick={() => setVoiceInputActive((current) => !current)}
            />
            <button
              className="chat-image-button"
              type="button"
              aria-label="上传图片给昀"
              onClick={() => chatImageInputRef.current?.click()}
              disabled={chatIsThinking}
            />
            <input
              ref={chatImageInputRef}
              className="chat-image-input"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                setChatImageFile(file)
              }}
            />
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
              className="chat-send-button"
              type="button"
              aria-label="发送给昀"
              onClick={submitChatMessage}
              disabled={(!chatDraft.trim() && !chatImageFile) || chatIsThinking}
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
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
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
          </div>

          <div className="player-controls" aria-label="播放控制">
            <button className="control-button" type="button" aria-label="Previous" onClick={playPreviousWithPodcastReaction}>‹</button>
            <button
              className="control-button control-button--primary"
              type="button"
              aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
              onClick={() => playerCore.togglePlay()}
            >
              {playerState.isPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button className="control-button" type="button" aria-label="Next" onClick={playNextWithPodcastReaction}>›</button>
            <button className="control-button" aria-label="Repeat">↻</button>
          </div>

          <div className="player-progress" aria-label="Playback progress">
            <div
              className="progress-track"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                if (!playerState.duration) return
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = (event.clientX - rect.left) / rect.width
                playerCore.seek(playerState.duration * ratio)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') playerCore.seek(playerState.currentTime - 5)
                if (event.key === 'ArrowRight') playerCore.seek(playerState.currentTime + 5)
              }}
            >
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              <div className="progress-thumb" style={{ left: `${progressPercent}%` }} />
            </div>
            <p className="time-code">{formatTime(playerState.currentTime)} / {formatTime(playerState.duration)}</p>
          </div>
          <div className={`player-volume${volumeControlOpen ? ' is-open' : ''}`}>
            <button
              className="control-button volume-button"
              type="button"
              aria-label={`音量 ${volumePercent}%`}
              aria-expanded={volumeControlOpen}
              onClick={() => {
                setVolumeControlOpen(true)
                playerCore.setVolume(playerState.volume <= 0.01 ? 0.72 : 0)
              }}
            >
              <svg className="volume-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path className="volume-icon__speaker" d="M4 9.5h4.2L13 5.4v13.2l-4.8-4.1H4z" />
                {playerState.volume <= 0.01 ? (
                  <>
                    <path className="volume-icon__mute" d="M17 9l4 4" />
                    <path className="volume-icon__mute" d="M21 9l-4 4" />
                  </>
                ) : (
                  <>
                    <path className="volume-icon__wave volume-icon__wave--one" d="M16 9.4c.9 1.2.9 4 0 5.2" />
                    {playerState.volume >= 0.5 && <path className="volume-icon__wave volume-icon__wave--two" d="M18.4 7.2c1.9 2.4 1.9 7.2 0 9.6" />}
                  </>
                )}
              </svg>
            </button>
            <label className="volume-slider" aria-label="播放音量" onPointerDown={() => setVolumeControlOpen(true)}>
              <span className="volume-slider-track">
                <span className="volume-slider-fill" style={{ width: `${volumePercent}%` }} />
                <span className="volume-slider-thumb" style={{ left: `${volumePercent}%` }} />
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={volumePercent}
                onChange={(event) => playerCore.setVolume(Number(event.target.value) / 100)}
                onFocus={() => setVolumeControlOpen(true)}
              />
              <span className="volume-value">{volumePercent}%</span>
            </label>
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
        </div>
      </div>

      <div
        className={`local-library-drawer${activePanel === 'library' ? ' is-open' : ''}${libraryListReady ? ' is-content-ready' : ''}`}
        onPointerEnter={keepEdgeLibraryOpen}
        onPointerMove={keepEdgeLibraryOpen}
      >
        <span className="glass-edge-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight" aria-hidden="true" />
        <span className="glass-specular-highlight glass-specular-highlight--opposite" aria-hidden="true" />
        <div className="library-content">
          <div className="library-header">
            <div>
              <h2>{librarySource === 'netease' ? '网易云' : '本地曲库'}</h2>
              <p className="library-live-count">
                {librarySource === 'netease'
                  ? neteaseStatus === 'loading'
                    ? '正在读取网易云…'
                    : neteaseLibraryView === 'playlists'
                      ? `我的歌单 ${neteaseMe?.playlists?.length || 0} 个`
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
                {neteaseStatus === 'loading' ? '搜索中' : '搜索'}
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

          <div className="library-account-strip">
            {neteaseMe?.loggedIn ? (
              <>
                <div className="library-account-profile">
                  {neteaseMe.avatar ? <img src={neteaseMe.avatar} alt="" /> : <span className="library-account-avatar">云</span>}
                  <div>
                    <strong>{neteaseMe.nickname}</strong>
                    <small>{neteaseMe.vipType > 0 ? `VIP ${neteaseMe.vipType}` : '网易云用户'}</small>
                  </div>
                </div>
                <div className="library-account-nav" aria-label="网易云曲库导航">
                  <button
                    type="button"
                    className="library-nav-button library-nav-button-liked"
                    aria-label="打开我喜欢的音乐"
                    title="我喜欢的音乐"
                    disabled={!likedNeteasePlaylist}
                    onClick={() => likedNeteasePlaylist && openNeteasePlaylist(likedNeteasePlaylist)}
                  >
                    <span aria-hidden="true">♥</span>
                  </button>
                  <button
                    type="button"
                    className={`library-nav-button${neteaseLibraryView === 'playlists' ? ' is-active' : ''}`}
                    aria-label="打开我的歌单"
                    title="我的歌单"
                    onClick={openNeteasePlaylists}
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                </div>
              </>
            ) : (
              <span className="library-account-empty">
                {neteaseAccountStatus === 'loading'
                  ? '正在读取网易云账户…'
                  : neteaseAccountStatus === 'error'
                    ? '账户信息读取失败'
                    : '登录网易云后显示个人歌单'}
                {neteaseAccountStatus === 'error' && (
                  <button type="button" onClick={loadNeteaseAccount}>重试</button>
                )}
              </span>
            )}
            <button type="button" className="library-import-button" disabled={isImportingMusic} onClick={() => musicImportInputRef.current?.click()}>
              {isImportingMusic ? '导入中' : '导入歌曲'}
            </button>
            <input ref={musicImportInputRef} className="library-import-input" type="file" accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg" multiple onChange={importSelectedMusic} />
          </div>

          <div className="library-source-tabs" aria-label="选择音乐来源">
            <button
              className={`library-source-tab${librarySource === 'local' ? ' is-active' : ''}`}
              type="button"
              aria-pressed={librarySource === 'local'}
              onClick={() => {
                setLibrarySource('local')
                clearPlaybackQueue()
              }}
            >
              本地
            </button>
            <button
              className={`library-source-tab${librarySource === 'netease' ? ' is-active' : ''}`}
              type="button"
              aria-pressed={librarySource === 'netease'}
              onClick={openNeteasePlaylists}
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

          <section className="library-up-next" aria-label="待播放歌单">
            <div className="library-up-next-header">
              <div>
                <span>待播放</span>
                <small>{waitingTracks.length} 首</small>
              </div>
              <button type="button" disabled={!waitingTracks.length} onClick={clearWaitingTracks}>清空</button>
            </div>
            {waitingTracks.length ? (
              <div className="library-up-next-list">
                {waitingTracks.slice(0, 3).map((track, index) => (
                  <article className="library-up-next-track" key={`up-next-manual-${track.id || `${track.title}-${track.artist}`}`}>
                    <span className="library-up-next-index">{index + 1}</span>
                    <span className="library-up-next-cover" style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined} aria-hidden="true" />
                    <span className="library-up-next-info">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                    <button type="button" aria-label={`从待播放移除 ${track.title}`} onClick={() => removeUpNext(track)}>×</button>
                  </article>
                ))}
                {waitingTracks.length > 3 && <p className="library-up-next-more">还有 {waitingTracks.length - 3} 首等待播放</p>}
              </div>
            ) : (
              <p className="library-up-next-empty">点击歌曲右侧的 ＋ 加入待播放</p>
            )}
          </section>

          {aiCandidateTracks.length > 0 && (
            <section className="library-up-next library-ai-candidates" aria-label="AI 续播候选">
              <div className="library-up-next-header">
                <div>
                  <span>AI 续播候选</span>
                  <small>{aiCandidateTracks.length} 首</small>
                </div>
                <button type="button" onClick={clearAutoUpNext}>换一批</button>
              </div>
              <div className="library-up-next-list">
                {aiCandidateTracks.slice(0, 3).map((track, index) => (
                  <article className="library-up-next-track" key={`ai-candidate-${track.id || `${track.title}-${track.artist}`}`}>
                    <span className="library-up-next-index">{index + 1}</span>
                    <span className="library-up-next-cover" style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined} aria-hidden="true" />
                    <span className="library-up-next-info">
                      <strong>{track.title}</strong>
                      <small>{track.artist} · 昀已规划</small>
                    </span>
                    <button type="button" aria-label={`从 AI 候选移除 ${track.title}`} onClick={() => removeAutoUpNext(track)}>×</button>
                  </article>
                ))}
              </div>
            </section>
          )}

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
              <article className="library-track" key={track.id || `${track.title}-${track.artist}`} role="button" tabIndex={0} onClick={() => playSongWithPodcastReaction(track)} onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  playSongWithPodcastReaction(track)
                }
              }}>
                <span className="library-play-button" aria-hidden="true">▶</span>
                <div
                  className={`library-cover ${track.cover || ''}`}
                  style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                />
                <div className="library-track-info">
                  <h3>{track.title}</h3>
                  <p>{track.artist}</p>
                </div>
                <button
                  className="library-queue-add"
                  type="button"
                  aria-label={`加入待播放 ${track.title}`}
                  title="加入待播放"
                  onClick={(event) => {
                    event.stopPropagation()
                    enqueueUpNext(track)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  +
                </button>
              </article>
            ))}
          </div>

          <div
            className="library-scroll-list"
            aria-label="全部歌曲列表"
            ref={libraryScrollListRef}
            onScroll={handleLibraryScroll}
            onPointerEnter={keepEdgeLibraryOpen}
            onPointerMove={keepEdgeLibraryOpen}
          >
            {librarySource === 'netease' && neteaseLibraryView === 'playlists' ? (
              (neteaseMe?.playlists || []).map((playlist) => (
                <button className="library-playlist-row" type="button" key={playlist.id} onClick={() => openNeteasePlaylist(playlist)}>
                  <span className="library-playlist-cover" style={playlist.coverUrl ? { backgroundImage: `url(${playlist.coverUrl})` } : undefined} aria-hidden="true" />
                  <span className="library-playlist-info">
                    <strong>{playlist.liked ? '我喜欢的音乐' : playlist.name}</strong>
                    <small>{playlist.trackCount} 首</small>
                  </span>
                  <span className="library-playlist-arrow" aria-hidden="true">›</span>
                </button>
              ))
            ) : (
              <div className="library-virtual-list" style={{ height: `${drawerTracks.length * LIBRARY_SCROLL_ROW_HEIGHT}px` }}>
                {virtualDrawerTracks.map((track, index) => {
                  const rowIndex = virtualTrackRange.start + index
                  return (
                    <article className="library-scroll-track library-virtual-row" style={{ transform: `translateY(${rowIndex * LIBRARY_SCROLL_ROW_HEIGHT}px)` }} key={`scroll-${track.id || `${track.title}-${track.artist}`}`} role="button" tabIndex={0} onClick={() => playSongWithPodcastReaction(track)} onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        playSongWithPodcastReaction(track)
                      }
                    }}>
                      <span className="library-play-button" aria-hidden="true">▶</span>
                      <div
                        className={`library-cover ${track.cover || ''}`}
                        style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                      />
                      <div className="library-track-info">
                        <h3>{track.title}</h3>
                        <p>{track.artist}</p>
                      </div>
                      <button
                        className="library-queue-add"
                        type="button"
                        aria-label={`加入待播放 ${track.title}`}
                        title="加入待播放"
                        onClick={(event) => {
                          event.stopPropagation()
                          enqueueUpNext(track)
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        +
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <button className="library-all-button" type="button">
            <span className="library-all-count">
              {librarySource === 'netease'
                ? neteaseLibraryView === 'playlists'
                  ? `我的歌单（${neteaseMe?.playlists?.length || 0}）`
                  : `${activeNeteasePlaylist?.name || '在线结果'}（${neteaseResults.length}）`
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
    </PlayerProvider>
  )
}

export default App
