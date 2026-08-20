export const DEFAULT_VOICE_CONFIG = Object.freeze({
  engine: Object.freeze({
    // Native sidecar owns microphone + speaker PCM and performs WebRTC APM.
    // The browser path is deliberately a recovery mode, not the default.
    mode: 'native_webrtc_apm',
    fallback: 'browser_aec_fallback',
    healthUrl: 'http://127.0.0.1:17894/health',
  }),
  wakeWord: Object.freeze({
    enabled: true,
    keywords: Object.freeze(['小昀', '小云', '老赢', '角蝇']),
    threshold: 0.45,
  }),
  vad: Object.freeze({
    speechStartMs: 180,
    endpointSilenceMs: 900,
  }),
  aec: Object.freeze({
    enabled: true,
    fallbackMode: 'browser_aec_fallback',
  }),
  bargeIn: Object.freeze({
    enabled: true,
    candidateSpeechMs: 180,
    confirmationMs: 320,
    duckingVolume: 0.28,
  }),
  session: Object.freeze({
    idleTimeoutMs: 30_000,
  }),
  playback: Object.freeze({
    maxQueuedChunks: 6,
  }),
  diagnostics: Object.freeze({
    enabled: import.meta.env.DEV,
  }),
})

export function createVoiceConfig(overrides = {}) {
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...overrides,
    engine: { ...DEFAULT_VOICE_CONFIG.engine, ...overrides.engine },
    wakeWord: { ...DEFAULT_VOICE_CONFIG.wakeWord, ...overrides.wakeWord },
    vad: { ...DEFAULT_VOICE_CONFIG.vad, ...overrides.vad },
    aec: { ...DEFAULT_VOICE_CONFIG.aec, ...overrides.aec },
    bargeIn: { ...DEFAULT_VOICE_CONFIG.bargeIn, ...overrides.bargeIn },
    session: { ...DEFAULT_VOICE_CONFIG.session, ...overrides.session },
    playback: { ...DEFAULT_VOICE_CONFIG.playback, ...overrides.playback },
    diagnostics: { ...DEFAULT_VOICE_CONFIG.diagnostics, ...overrides.diagnostics },
  }
}
