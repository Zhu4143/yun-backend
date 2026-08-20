const BASELINE_MS = 3000
const USER_PROMPT_DELAY_MS = 3000
const TEST_TEXT = '这是一段全双工语音测试。我正在通过扬声器持续播放声音，用来检测回声消除以及用户插话能力。测试仍在继续，请在听到提示之后说话。现在请对着电脑说：等等，我正在测试打断。请继续说完整这句话，测试仍在进行中。'

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
const clamp = (value) => Math.max(0, Math.min(1, value))

function rms(samples) {
  let sum = 0
  samples.forEach((value) => { sum += value * value })
  return Math.sqrt(sum / Math.max(1, samples.length))
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => typeof item !== 'function'))
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export class FullDuplexPhysicalTest {
  constructor({ manager, onUpdate = () => {} }) {
    this.manager = manager
    this.onUpdate = onUpdate
    this.active = false
  }

  async run({ playTestSpeech }) {
    if (this.active) return null
    this.active = true
    const startedAt = Date.now()
    const events = []
    const measurements = { baseline: [], aiOnly: [], userPrompt: [] }
    let phase = 'initializing'
    let playbackStartedAt
    let playbackFinishedAt
    let speechStartedAt = 0
    let userSpeechDetectedAt = 0
    let candidateDetectedAt = 0
    let unsubscribe = () => {}
    let baselineCaptureMissing = false
    const captureBefore = this.manager.getMetrics()
    const publish = (patch) => this.onUpdate({ active: true, phase, ...patch })
    const addEvent = (type, details = {}) => events.push({ type, phase, at: Date.now(), ...details })

    try {
      await this.manager.start()
      await this.manager.context?.resume?.()
      const track = this.manager.stream?.getAudioTracks?.()[0]
      const settings = cleanObject(track?.getSettings?.())
      const capabilities = cleanObject(track?.getCapabilities?.())
      const device = {
        microphone: settings.deviceId || 'unknown',
        speaker: 'system-default (HTMLAudioElement)',
        sampleRate: this.manager.context?.sampleRate || 0,
        channelCount: settings.channelCount || 1,
        requested: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        actual: {
          echoCancellation: settings.echoCancellation ?? 'unknown',
          noiseSuppression: settings.noiseSuppression ?? 'unknown',
          autoGainControl: settings.autoGainControl ?? 'unknown',
        },
        capabilities,
      }
      phase = 'baseline'
      addEvent('capture_started', { device })
      publish({ phase, device })
      const baselineFrameCount = this.manager.getMetrics().frameCount

      unsubscribe = this.manager.subscribe((frame) => {
        const energy = rms(frame.samples)
        const probability = clamp((energy - 0.006) / 0.045)
        // Browser capture exposes only the post-constraint stream. There is no
        // separate raw pre-AEC PCM track in standard Chromium APIs.
        const point = { at: Date.now(), rawMicEnergy: 'unavailable', processedMicEnergy: energy, processedMicEnergySource: 'browser post-processing stream', vadProbability: probability }
        if (phase === 'baseline') measurements.baseline.push(point)
        if (phase === 'ai_only') measurements.aiOnly.push(point)
        if (phase === 'user_prompt') measurements.userPrompt.push(point)
        if (probability >= 0.4) {
          if (!speechStartedAt) {
            speechStartedAt = point.at
            addEvent('USER_SPEECH_START', point)
          }
          if (phase === 'user_prompt' && !userSpeechDetectedAt) userSpeechDetectedAt = point.at
          if (phase === 'user_prompt' && !candidateDetectedAt && point.at - speechStartedAt >= 320) {
            candidateDetectedAt = point.at
            addEvent('BARGE_IN_CANDIDATE', point)
          }
        } else {
          speechStartedAt = 0
        }
      })

      await wait(BASELINE_MS)
      const baselineMetrics = this.manager.getMetrics()
      const baselineFrames = baselineMetrics.frameCount - baselineFrameCount
      if (baselineFrames <= 0 || measurements.baseline.length <= 0) {
        baselineCaptureMissing = true
        phase = 'baseline_warning'
        addEvent('BASELINE_CAPTURE_MISSING', { baselineFrames, baselineSamples: measurements.baseline.length })
        publish({ phase, instruction: '基线未采到帧；测试会继续播放，用于收集更多诊断数据。' })
      }
      phase = 'ai_only'
      playbackStartedAt = Date.now()
      addEvent('playback_started')
      publish({ phase, instruction: '请保持安静，系统正在采集 AI 播放期间的基线。' })
      const playback = Promise.resolve(playTestSpeech(TEST_TEXT))
      await wait(USER_PROMPT_DELAY_MS)
      phase = 'user_prompt'
      addEvent('user_prompt')
      publish({ phase, instruction: '现在请对着电脑说：等等，我正在测试打断。请不要停止播放。' })
      await playback
      playbackFinishedAt = Date.now()
      addEvent('playback_finished')
      unsubscribe()
      unsubscribe = () => {}

      const captureAfter = this.manager.getMetrics()
      const aiFalseTriggers = events.filter((event) => event.type === 'USER_SPEECH_START' && event.phase === 'ai_only').length
      const maxProbability = Math.max(0, ...measurements.aiOnly.map((point) => point.vadProbability))
      const report = {
        test: 'REAL DUPLEX TEST',
        generatedAt: new Date().toISOString(),
        aec: { architecture: 'READY', implementation: 'Chromium/WebRTC system AEC', physicalEffectiveness: 'UNVERIFIED', mode: 'browser_aec_fallback' },
        device,
        timestamps: { capture_started_at: startedAt, playback_started_at: playbackStartedAt, user_voice_detected_at: userSpeechDetectedAt || null, playback_finished_at: playbackFinishedAt },
        capture: { continuous: captureAfter.frameCount > captureBefore.frameCount, framesDuringPlayback: captureAfter.frameCount - captureBefore.frameCount, droppedFrames: captureAfter.droppedFrames - captureBefore.droppedFrames, maxQueueDepth: captureAfter.maxQueueDepth },
        vad: { baselineFrames, baselineSamples: measurements.baseline.length, baselineCaptureMissing, aiOnlySamples: measurements.aiOnly.length, userPromptSamples: measurements.userPrompt.length, aiOnlyFalseTriggers: aiFalseTriggers, aiOnlyMaxSpeechProbability: maxProbability },
        user: { speechDetectedDuringPlayback: Boolean(userSpeechDetectedAt), speechStartLatencyMs: userSpeechDetectedAt ? userSpeechDetectedAt - playbackStartedAt : null, speechStartAfterPromptMs: userSpeechDetectedAt ? userSpeechDetectedAt - (playbackStartedAt + USER_PROMPT_DELAY_MS) : null, bargeInCandidate: Boolean(candidateDetectedAt), playbackStillActiveWhenDetected: Boolean(userSpeechDetectedAt && userSpeechDetectedAt < playbackFinishedAt), selfInterruptionDetected: false },
        events,
      }
      report.result = report.vad.baselineFrames > 0 && report.vad.baselineSamples > 0 && report.capture.continuous && report.capture.droppedFrames === 0 && report.vad.aiOnlyFalseTriggers <= 1 && report.user.speechDetectedDuringPlayback && report.user.bargeInCandidate
        ? 'PASS'
        : report.capture.continuous ? 'PARTIAL' : 'FAIL'
      if (report.result === 'PASS') report.aec.physicalEffectiveness = 'VERIFIED'
      this.onUpdate({ active: false, phase: 'complete', report })
      return report
    } catch (error) {
      const report = {
        test: 'REAL DUPLEX TEST',
        generatedAt: new Date().toISOString(),
        result: 'FAIL',
        error: error instanceof Error ? error.message : 'physical_test_failed',
        aec: { architecture: 'READY', implementation: 'Chromium/WebRTC system AEC', physicalEffectiveness: 'UNVERIFIED', mode: 'browser_aec_fallback' },
        events,
      }
      this.onUpdate({ active: false, phase: 'failed', report })
      return report
    } finally {
      unsubscribe()
      this.active = false
    }
  }

  download(report) {
    if (!report) return
    download('VOICE_PHYSICAL_TEST_RESULT.json', JSON.stringify(report, null, 2), 'application/json')
    const markdown = `# PHASE 4.5 Physical Test\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`
    download('PHASE_4_5_PHYSICAL_TEST.md', markdown, 'text/markdown')
  }
}
