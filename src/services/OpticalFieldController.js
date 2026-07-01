const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const lerp = (from, to, amount) => from + (to - from) * amount
const damp = (from, to, response, delta) => lerp(from, to, 1 - Math.exp(-response * delta))

// Stable public object shared by every future visual consumer. Keep its
// identity intact so shaders, React refs and CSS bridges can all retain it.
const opticalField = {
  intensity: 0,
  distortion: 0,
  flow: 0,
  blur: 0,
  chromatic: 0,
}

const DEFAULT_STATE = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  orbX: 0.5,
  orbY: 0.5,
  lightX: 0.5,
  lightY: 0.5,
  velocity: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  beat: 0,
  musicBass: 0,
  musicMid: 0,
  musicTreble: 0,
  musicEnergy: 0,
  voiceLevel: 0,
  voiceBass: 0,
  voiceMid: 0,
  voiceTreble: 0,
  voiceTargetLevel: 0,
  voiceTargetBass: 0,
  voiceTargetMid: 0,
  voiceTargetTreble: 0,
  listening: 0,
  voiceActive: false,
  dragX: 0,
  dragY: 0,
  zoom: 0,
  dragging: false,
  lastClientX: 0,
  lastClientY: 0,
  active: false,
}

class OpticalFieldController {
  constructor() {
    this.state = { ...DEFAULT_STATE }
    this.opticalField = opticalField
    this.consumerCount = 0
    this.root = null
    this.handlePointerMove = this.handlePointerMove.bind(this)
    this.handlePointerLeave = this.handlePointerLeave.bind(this)
  }

  acquire() {
    this.consumerCount += 1
    if (this.consumerCount > 1 || typeof window === 'undefined') return
    this.root = document.documentElement
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true })
    window.addEventListener('pointerleave', this.handlePointerLeave)
    window.addEventListener('blur', this.handlePointerLeave)
    this.writeCssVariables()
  }

  release() {
    this.consumerCount = Math.max(0, this.consumerCount - 1)
    if (this.consumerCount > 0 || typeof window === 'undefined') return
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerleave', this.handlePointerLeave)
    window.removeEventListener('blur', this.handlePointerLeave)
    this.root = null
  }

  handlePointerMove(event) {
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    this.state.targetX = clamp((event.clientX / width - 0.5) * 2, -1, 1)
    this.state.targetY = clamp(-(event.clientY / height - 0.5) * 2, -1, 1)
    this.state.active = true
  }

  handlePointerLeave() {
    this.state.targetX = 0
    this.state.targetY = 0
    this.state.dragging = false
    this.state.active = false
  }

  setAudioFrame({ bass = 0, mid = 0, treble = 0, energy = 0, beatStrength = 0 } = {}) {
    this.state.musicBass = bass
    this.state.musicMid = mid
    this.state.musicTreble = treble
    this.state.musicEnergy = energy
    this.state.beat = beatStrength
  }

  setVoiceActive(active) {
    this.state.voiceActive = Boolean(active)
    if (active) return
    this.state.voiceTargetLevel = 0
    this.state.voiceTargetBass = 0
    this.state.voiceTargetMid = 0
    this.state.voiceTargetTreble = 0
  }

  setVoiceFrame({ level = 0, bass = 0, mid = 0, treble = 0 } = {}) {
    this.state.voiceTargetLevel = clamp(level, 0, 1)
    this.state.voiceTargetBass = clamp(bass, 0, 1)
    this.state.voiceTargetMid = clamp(mid, 0, 1)
    this.state.voiceTargetTreble = clamp(treble, 0, 1)
  }

  tick(delta) {
    const safeDelta = clamp(delta || 0, 0, 0.1)
    const previousX = this.state.x
    const previousY = this.state.y
    const pointerEase = 1 - Math.exp(-safeDelta * 10.5)
    const orbEase = 1 - Math.exp(-safeDelta * 8.5)
    const lightEase = 1 - Math.exp(-safeDelta * 4.2)

    this.state.x = lerp(this.state.x, this.state.targetX, pointerEase)
    this.state.y = lerp(this.state.y, this.state.targetY, pointerEase)
    this.state.orbX = lerp(this.state.orbX, this.state.targetX * 0.5 + 0.5, orbEase)
    this.state.orbY = lerp(this.state.orbY, this.state.targetY * 0.5 + 0.5, orbEase)
    this.state.lightX = lerp(this.state.lightX, this.state.targetX * 0.22 + 0.34, lightEase)
    this.state.lightY = lerp(this.state.lightY, this.state.targetY * 0.18 + 0.68, lightEase)

    const smoothVoiceValue = (current, target) => {
      const response = target > current ? 24 : 2.7
      return damp(current, target, response, safeDelta)
    }
    this.state.voiceLevel = smoothVoiceValue(this.state.voiceLevel, this.state.voiceTargetLevel)
    this.state.voiceBass = smoothVoiceValue(this.state.voiceBass, this.state.voiceTargetBass)
    this.state.voiceMid = smoothVoiceValue(this.state.voiceMid, this.state.voiceTargetMid)
    this.state.voiceTreble = smoothVoiceValue(this.state.voiceTreble, this.state.voiceTargetTreble)
    this.state.listening = damp(this.state.listening, this.state.voiceActive ? 1 : 0, this.state.voiceActive ? 12 : 2.2, safeDelta)
    this.state.bass = Math.max(this.state.musicBass * 0.34, this.state.voiceBass)
    this.state.mid = Math.max(this.state.musicMid * 0.30, this.state.voiceMid)
    this.state.treble = Math.max(this.state.musicTreble * 0.26, this.state.voiceTreble)
    this.state.energy = Math.max(this.state.musicEnergy * 0.28, this.state.voiceLevel)

    // Phase 1: translate all raw sources into one normalized optical field.
    // Existing consumers still use their legacy channels until later phases.
    const fieldTargets = {
      intensity: clamp(Math.max(
        this.state.musicEnergy * 0.72,
        this.state.voiceLevel,
        this.state.listening * 0.08,
      ), 0, 1),
      distortion: clamp(
        this.state.musicBass * 0.58
          + this.state.voiceBass * 0.45
          + this.state.beat * 0.62,
        0,
        1,
      ),
      flow: clamp(
        this.state.musicMid * 0.50
          + this.state.voiceMid * 0.55
          + this.state.velocity * 0.06,
        0,
        1,
      ),
      blur: clamp(
        this.state.musicEnergy * 0.18
          + this.state.voiceLevel * 0.12
          + this.state.listening * 0.04,
        0,
        1,
      ),
      chromatic: clamp(
        this.state.musicTreble * 0.55
          + this.state.voiceTreble * 0.65
          + this.state.beat * 0.35,
        0,
        1,
      ),
    }
    const smoothField = (name, rise, fall) => {
      const current = this.opticalField[name]
      const target = fieldTargets[name]
      this.opticalField[name] = damp(current, target, target > current ? rise : fall, safeDelta)
    }
    smoothField('intensity', 13, 3.1)
    smoothField('distortion', 18, 4.2)
    smoothField('flow', 8.5, 2.4)
    smoothField('blur', 7.5, 2.1)
    smoothField('chromatic', 20, 4.8)

    const frameDistance = Math.hypot(this.state.x - previousX, this.state.y - previousY)
    const instantVelocity = frameDistance / Math.max(safeDelta, 1 / 240)
    this.state.velocity = damp(this.state.velocity, instantVelocity, 9, safeDelta)
    this.writeCssVariables()
    return this.state
  }

  writeCssVariables() {
    if (!this.root) return
    const style = this.root.style
    style.setProperty('--optical-pointer-x', this.state.x.toFixed(4))
    style.setProperty('--optical-pointer-y', this.state.y.toFixed(4))
    style.setProperty('--optical-orb-x', `${(this.state.orbX * 100).toFixed(2)}%`)
    style.setProperty('--optical-orb-y', `${((1 - this.state.orbY) * 100).toFixed(2)}%`)
    style.setProperty('--optical-light-x', `${(this.state.lightX * 100).toFixed(2)}%`)
    style.setProperty('--optical-light-y', `${((1 - this.state.lightY) * 100).toFixed(2)}%`)
    style.setProperty('--optical-velocity', Math.min(1, this.state.velocity * 0.12).toFixed(4))
    style.setProperty('--optical-energy', this.state.energy.toFixed(4))
    style.setProperty('--optical-beat', this.state.beat.toFixed(4))
    style.setProperty('--optical-voice-level', this.state.voiceLevel.toFixed(4))
    style.setProperty('--optical-listening', this.state.listening.toFixed(4))
    style.setProperty('--optical-intensity', this.opticalField.intensity.toFixed(4))
    style.setProperty('--optical-distortion', this.opticalField.distortion.toFixed(4))
    style.setProperty('--optical-flow', this.opticalField.flow.toFixed(4))
    style.setProperty('--optical-blur', this.opticalField.blur.toFixed(4))
    style.setProperty('--optical-chromatic', this.opticalField.chromatic.toFixed(4))
  }
}

export const opticalFieldController = new OpticalFieldController()
export { opticalField }
