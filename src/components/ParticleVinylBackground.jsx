import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { opticalFieldController } from '../services/OpticalFieldController'
import FlowFieldBackground from './FlowFieldBackground'
import './ParticleVinylBackground.css'

const FALLBACK_COVER = '/scene.png'
// Dense enough that the deformed mountain surface reads as continuous rather
// than as separated rows of dots. 340² stays reasonable for a desktop GPU
// while providing about 71% more samples than the previous 260² grid.
const GRID_SIZE_BY_QUALITY = {
  // "推荐" is the default on most desktop machines.  It must leave enough
  // frame budget for typing, clicks, audio start and image decoding instead
  // of behaving like the old high-quality showcase renderer.
  low: 132,
  medium: 180,
  high: 300,
}
const SPECTRUM_BINS = 48
const RIM_TRAIL_INNER_RADIUS = 2.84
const RIM_TRAIL_OUTER_RADIUS = 3.62
const CAMERA_POSITION = [0, 0, 5.6]
const CAMERA_FOV = 42
const DEFAULT_BACKGROUND_COLORS = {
  base: [8, 3, 2],
  primary: [118, 73, 42],
  secondary: [74, 90, 126],
  accent: [232, 181, 96],
}
const BACKGROUND_PALETTE_CACHE = new Map()
const FIXED_VIEW_STORAGE_KEY = 'yun-particle-vinyl-fixed-view'

function getInitialPointerState() {
  const fallback = { dragX: 0, dragY: 0, zoom: 0 }
  try {
    const stored = JSON.parse(window.localStorage.getItem(FIXED_VIEW_STORAGE_KEY) || 'null')
    if (stored && [stored.dragX, stored.dragY, stored.zoom].every(Number.isFinite)) {
      return {
        ...fallback,
        dragX: THREE.MathUtils.clamp(stored.dragX, -2.7, 2.7),
        dragY: THREE.MathUtils.clamp(stored.dragY, -2.7, 2.7),
        zoom: THREE.MathUtils.clamp(stored.zoom, -4.4, 4.2),
      }
    }
  } catch {
    // Ignore invalid saved view data and use the neutral fallback.
  }
  return fallback
}

Object.assign(opticalFieldController.state, getInitialPointerState())

function makeAudioSampler(getFrequencyData, active) {
  const smoothed = { bass: 0, mid: 0, treble: 0, energy: 0 }
  const bins = new Float32Array(SPECTRUM_BINS)
  const nextBins = new Float32Array(SPECTRUM_BINS)
  const previousBeatBins = new Float32Array(SPECTRUM_BINS)
  let beatFluxMean = 0.018
  let beatFluxDeviation = 0.012
  let beatEnvelope = 0
  let beatCooldown = 0

  return {
    read() {
      const raw = active && typeof getFrequencyData === 'function' ? getFrequencyData() : null
      const data = raw?.length ? raw : null

      if (!data) {
        smoothed.bass *= 0.94
        smoothed.mid *= 0.94
        smoothed.treble *= 0.94
        smoothed.energy *= 0.94
        for (let index = 0; index < bins.length; index += 1) bins[index] *= 0.94
        beatCooldown = Math.max(0, beatCooldown - 1)
        return { ...smoothed, bins, beatStrength: 0 }
      }

      let bass = 0
      let mid = 0
      let treble = 0
      let energy = 0
      const length = Math.max(1, data.length)

      for (let index = 0; index < length; index += 1) {
        const value = (data[index] || 0) / 255
        energy += value
        if (index < length * 0.12) bass += value
        else if (index < length * 0.5) mid += value
        else treble += value
      }

      bass /= Math.max(1, Math.floor(length * 0.12))
      mid /= Math.max(1, Math.floor(length * 0.38))
      treble /= Math.max(1, Math.floor(length * 0.5))
      energy /= length

      smoothed.bass += (bass - smoothed.bass) * 0.14
      smoothed.mid += (mid - smoothed.mid) * 0.11
      smoothed.treble += (treble - smoothed.treble) * 0.16
      smoothed.energy += (energy - smoothed.energy) * 0.13

      for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
        const start = Math.floor((bin / SPECTRUM_BINS) * length)
        const end = Math.max(start + 1, Math.floor(((bin + 1) / SPECTRUM_BINS) * length))
        let total = 0
        for (let index = start; index < end; index += 1) total += (data[index] || 0) / 255
        nextBins[bin] = Math.pow(total / (end - start), 0.68)
      }

      let beatFlux = 0
      let kickEnergy = 0
      let lowMidPunch = 0
      const beatBinCount = Math.min(18, SPECTRUM_BINS)
      const kickBinCount = Math.min(7, beatBinCount)

      for (let bin = 0; bin < beatBinCount; bin += 1) {
        const weight = bin < kickBinCount ? 1.42 : 0.74
        const positiveRise = Math.max(0, nextBins[bin] - previousBeatBins[bin] * 0.92)
        beatFlux += positiveRise * weight
        if (bin < kickBinCount) kickEnergy += nextBins[bin]
        else lowMidPunch += nextBins[bin]
      }

      kickEnergy /= kickBinCount
      lowMidPunch /= Math.max(1, beatBinCount - kickBinCount)
      beatFlux /= beatBinCount
      const fluxGap = Math.abs(beatFlux - beatFluxMean)
      const beatThreshold = beatFluxMean + Math.max(0.02, beatFluxDeviation * 2.35)
      const transientStrength = Math.max(0, beatFlux - beatThreshold)
      const hasKickBody = kickEnergy > Math.max(0.13, smoothed.bass * 0.82)
      const hasTransient = transientStrength > 0.006 && beatFlux > beatEnvelope * 1.08
      const rhythmicHit = beatCooldown <= 0 && hasKickBody && hasTransient
      const beatStrength = rhythmicHit
        ? THREE.MathUtils.clamp(
          transientStrength * 10.5 + Math.max(0, kickEnergy - smoothed.bass * 0.72) * 1.35 + lowMidPunch * 0.22,
          0,
          1,
        )
        : 0

      beatCooldown = rhythmicHit ? 10 : Math.max(0, beatCooldown - 1)
      beatEnvelope = Math.max(beatFlux, beatEnvelope * 0.86)
      beatFluxMean += (beatFlux - beatFluxMean) * 0.028
      beatFluxDeviation += (fluxGap - beatFluxDeviation) * 0.045

      for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
        previousBeatBins[bin] += (nextBins[bin] - previousBeatBins[bin]) * 0.42
      }

      for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
        const prev = nextBins[(bin - 1 + SPECTRUM_BINS) % SPECTRUM_BINS]
        const next = nextBins[(bin + 1) % SPECTRUM_BINS]
        const liquid = nextBins[bin] * 0.76 + prev * 0.12 + next * 0.12
        bins[bin] += (liquid - bins[bin]) * 0.28
      }

      const seamBlend = (bins[0] + bins[1] + bins[SPECTRUM_BINS - 1] + bins[SPECTRUM_BINS - 2]) * 0.25
      bins[0] = bins[0] * 0.68 + seamBlend * 0.32
      bins[1] = bins[1] * 0.82 + seamBlend * 0.18
      bins[SPECTRUM_BINS - 1] = bins[SPECTRUM_BINS - 1] * 0.68 + seamBlend * 0.32
      bins[SPECTRUM_BINS - 2] = bins[SPECTRUM_BINS - 2] * 0.82 + seamBlend * 0.18

      return { ...smoothed, bins, beatStrength }
    },
  }
}

function createSpectrumTexture() {
  const data = new Uint8Array(SPECTRUM_BINS * 4)
  const texture = new THREE.DataTexture(data, SPECTRUM_BINS, 1, THREE.RGBAFormat)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function createPlaceholderTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 512, 512)
  gradient.addColorStop(0, '#f7d6a1')
  gradient.addColorStop(0.48, '#6fa7b0')
  gradient.addColorStop(1, '#18131f')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.beginPath()
  ctx.arc(182, 166, 170, 0, Math.PI * 2)
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function colorToRgb(color) {
  return `${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}`
}

function scaleColor(color, amount) {
  return color.map((value) => Math.max(0, Math.min(255, value * amount)))
}

function loadCoverBackgroundPalette(source) {
  if (BACKGROUND_PALETTE_CACHE.has(source)) return BACKGROUND_PALETTE_CACHE.get(source)
  const palettePromise = new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 32
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const buckets = [
          { total: [0, 0, 0], count: 0 },
          { total: [0, 0, 0], count: 0 },
          { total: [0, 0, 0], count: 0 },
        ]
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3] / 255
          if (alpha < 0.2) continue
          const red = data[index]
          const green = data[index + 1]
          const blue = data[index + 2]
          const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255
          const bucket = luminance > 0.62 ? buckets[2] : luminance > 0.32 ? buckets[1] : buckets[0]
          bucket.total[0] += red
          bucket.total[1] += green
          bucket.total[2] += blue
          bucket.count += 1
        }
        const readBucket = (bucket, fallback) => bucket.count
          ? bucket.total.map((value) => value / bucket.count)
          : fallback
        resolve({
          colors: {
            base: scaleColor(readBucket(buckets[0], DEFAULT_BACKGROUND_COLORS.base), 0.42),
            primary: readBucket(buckets[1], DEFAULT_BACKGROUND_COLORS.primary),
            secondary: readBucket(buckets[0], DEFAULT_BACKGROUND_COLORS.secondary),
            accent: readBucket(buckets[2], DEFAULT_BACKGROUND_COLORS.accent),
          },
          source,
        })
      } catch {
        resolve({ colors: DEFAULT_BACKGROUND_COLORS, source })
      }
    }
    image.onerror = () => resolve({ colors: DEFAULT_BACKGROUND_COLORS, source })
    image.src = source
  })
  BACKGROUND_PALETTE_CACHE.set(source, palettePromise)
  return palettePromise
}

function useCoverBackgroundColors(coverUrl, preloadCoverUrls) {
  const resolvedCoverUrl = coverUrl || FALLBACK_COVER
  const [palette, setPalette] = useState({
    colors: DEFAULT_BACKGROUND_COLORS,
    source: resolvedCoverUrl === FALLBACK_COVER ? FALLBACK_COVER : '',
  })

  useEffect(() => {
    let cancelled = false
    loadCoverBackgroundPalette(resolvedCoverUrl).then((nextPalette) => {
      if (!cancelled) setPalette(nextPalette)
    })
    return () => { cancelled = true }
  }, [resolvedCoverUrl])

  useEffect(() => {
    const preload = () => {
      for (const source of preloadCoverUrls) {
        if (source && source !== resolvedCoverUrl) loadCoverBackgroundPalette(source)
      }
    }
    const idleId = typeof window.requestIdleCallback === 'function'
      // Covers are nice-to-have decoration. Do not force their network and
      // canvas work into the first audio playback window.
      ? window.requestIdleCallback(preload)
      : window.setTimeout(preload, 1800)
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
    }
  }, [preloadCoverUrls, resolvedCoverUrl])

  return palette
}

function useCoverTexture(coverUrl) {
  const textureRef = useRef(null)
  const fallbackTexture = useMemo(() => createPlaceholderTexture(), [])

  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      coverUrl || FALLBACK_COVER,
      (texture) => {
        if (cancelled) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        textureRef.current = texture
      },
      undefined,
      () => {
        textureRef.current = fallbackTexture
      },
    )

    return () => {
      cancelled = true
    }
  }, [coverUrl, fallbackTexture])

  return textureRef
}

function ParticleVinylDisc({ active, coverUrl, getFrequencyData, pointerRef, mountainControls, voiceOrbVisible, portraitTransition, quality }) {
  const materialRef = useRef(null)
  const rimTrailMaterialRef = useRef(null)
  const pointsRef = useRef(null)
  const groupRef = useRef(null)
  const samplerRef = useRef(null)
  const spinRef = useRef(0)
  const coverPulseRef = useRef(0)
  const recordShakeRef = useRef({ power: 0, phase: 0 })
  const coverRippleAgeRef = useRef(1)
  const songTransitionRef = useRef(1)
  const hasLoadedCoverRef = useRef(false)
  const spectrumTextureRef = useRef(null)
  const voiceSummonAgeRef = useRef(0)
  const previousVoiceOrbVisibleRef = useRef(false)
  const entryTransitionUntilRef = useRef(0)
  const summonEffectRef = useRef(0)
  const songEffectRef = useRef(0)
  const coverTextureRef = useCoverTexture(coverUrl)

  const rimTrailGeometry = useMemo(() => (
    new THREE.RingGeometry(RIM_TRAIL_INNER_RADIUS, RIM_TRAIL_OUTER_RADIUS, 112, 1)
  ), [])

  const rimTrailMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPlaying: { value: 0 },
      uEnergy: { value: 0 },
      uCoverTex: { value: createPlaceholderTexture() },
    },
    vertexShader: `
      varying vec2 vLocalPosition;

      void main() {
        vLocalPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uCoverTex;
      uniform float uTime;
      uniform float uPlaying;
      uniform float uEnergy;
      varying vec2 vLocalPosition;

      const float TAU = 6.28318530718;

      float directedTrail(float phase, float head, float length, float softness) {
        float distanceBehind = fract(head - phase);
        float body = 1.0 - smoothstep(0.0, length, distanceBehind);
        return pow(max(body, 0.0), softness);
      }

      vec3 boostSaturation(vec3 color, float amount) {
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        return max(vec3(0.0), mix(vec3(luminance), color, amount));
      }

      void main() {
        float radius = length(vLocalPosition);
        float radialDistance = clamp(
          (radius - ${RIM_TRAIL_INNER_RADIUS.toFixed(2)})
            / ${(RIM_TRAIL_OUTER_RADIUS - RIM_TRAIL_INNER_RADIUS).toFixed(2)},
          0.0,
          1.0
        );
        float angle = atan(vLocalPosition.y, vLocalPosition.x);
        float phase = fract(angle / TAU + 0.5);
        float rotatingHead = fract(uTime * 0.041);
        float trail = directedTrail(phase, rotatingHead, 0.34, 2.2);
        trail += directedTrail(phase, fract(rotatingHead + 0.37), 0.23, 2.6) * 0.58;
        trail += directedTrail(phase, fract(rotatingHead + 0.71), 0.17, 3.0) * 0.34;

        float innerGlow = exp(-pow((radialDistance - 0.10) * 8.5, 2.0));
        float smokeBody = smoothstep(0.0, 0.16, radialDistance)
          * (1.0 - smoothstep(0.48, 1.0, radialDistance));
        float smokeNoise = 0.72
          + sin(angle * 7.0 - uTime * 0.54 + radialDistance * 15.0) * 0.16
          + sin(angle * 13.0 + uTime * 0.31 - radialDistance * 9.0) * 0.12;
        smokeNoise = clamp(smokeNoise, 0.25, 1.0);

        vec2 paletteUv = vec2(cos(angle), sin(angle)) * 0.31 + 0.5;
        vec3 coverTint = texture2D(uCoverTex, paletteUv).rgb;
        float tintPeak = max(max(coverTint.r, coverTint.g), coverTint.b);
        coverTint = mix(vec3(0.12, 0.62, 1.0), coverTint / max(tintPeak, 0.12), 0.84);
        coverTint = boostSaturation(coverTint, 1.42);
        vec3 distanceTint = mix(coverTint, vec3(0.02, 0.68, 1.0), smoothstep(0.08, 0.55, radialDistance));
        distanceTint = mix(distanceTint, vec3(0.78, 0.12, 1.0), smoothstep(0.55, 1.0, radialDistance));
        distanceTint = boostSaturation(distanceTint, 1.28);

        float mist = innerGlow * (0.17 + trail * 0.31)
          + smokeBody * smokeNoise * (0.055 + trail * 0.25);
        float alpha = mist * uPlaying * (0.72 + uEnergy * 0.18);
        gl_FragColor = vec4(distanceTint * (0.62 + innerGlow * 0.34), alpha);
      }
    `,
  }), [])

  useEffect(() => {
    const lockEntryView = () => {
      entryTransitionUntilRef.current = performance.now() + 1900
      Object.assign(pointerRef.current, { x: 0, y: 0, dragX: 0, dragY: 0 })
    }
    window.addEventListener('yun:vinyl-transition-start', lockEntryView)
    return () => window.removeEventListener('yun:vinyl-transition-start', lockEntryView)
  }, [pointerRef])

  const geometry = useMemo(() => {
    const gridSize = GRID_SIZE_BY_QUALITY[quality] || GRID_SIZE_BY_QUALITY.medium
    const pointCount = gridSize * gridSize
    const positions = new Float32Array(pointCount * 3)
    const uvs = new Float32Array(pointCount * 2)
    let point = 0
    let uv = 0

    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const u = x / (gridSize - 1)
        const v = y / (gridSize - 1)
        positions[point] = u * 2 - 1
        positions[point + 1] = v * 2 - 1
        positions[point + 2] = 0
        uvs[uv] = u
        uvs[uv + 1] = v
        point += 3
        uv += 2
      }
    }

    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    nextGeometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2))
    nextGeometry.computeBoundingSphere()
    return nextGeometry
  }, [quality])

  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uEnergy: { value: 0 },
      uPlaying: { value: 0 },
      uMountainEdge: { value: 0.68 },
      uMountainHeight: { value: 0.36 },
      uMountainPeaks: { value: 0.42 },
      uSweepSpeed: { value: 0.006 },
      uCoverPulse: { value: 0 },
      uCoverRippleAge: { value: 1 },
      uSongTransition: { value: 1 },
      uCoverTex: { value: createPlaceholderTexture() },
      uPreviousCoverTex: { value: createPlaceholderTexture() },
      uSpectrumTex: { value: createSpectrumTexture() },
      uVoiceSummonAge: { value: 0 },
      uSummonEffect: { value: 0 },
      uSongEffect: { value: 0 },
      uPortraitTransition: { value: 0 },
    },
    vertexShader: `
      attribute vec2 aUv;
      uniform sampler2D uSpectrumTex;
      uniform float uTime;
      uniform float uBass;
      uniform float uMid;
      uniform float uTreble;
      uniform float uEnergy;
      uniform float uPlaying;
      uniform float uMountainEdge;
      uniform float uMountainHeight;
      uniform float uMountainPeaks;
      uniform float uSweepSpeed;
      uniform float uCoverPulse;
      uniform float uCoverRippleAge;
      uniform float uSongTransition;
      uniform float uVoiceSummonAge;
      uniform float uSummonEffect;
      uniform float uSongEffect;
      uniform float uPortraitTransition;
      varying vec2 vUv;
      varying vec2 vTintUv;
      varying float vRadius;
      varying float vAlpha;
      varying float vCoverMask;
      varying float vGroove;
      varying float vMountain;
      varying float vMountainBand;
      varying float vCoverRipple;
      varying float vBeatSweep;
      varying float vViewFacing;
      varying float vBaseGlow;
      varying float vNoiseGlow;
      varying float vAudioGlow;
      varying float vTerrainSweep;
      varying float vFresnel;
      varying float vSpecularFacing;
      varying float vParticleSeed;
      varying vec2 vStudioLight;
      varying vec3 vViewPosition;

      mat2 rotate2d(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      float circularDistance(float a, float b) {
        float delta = abs(fract(a) - fract(b));
        return min(delta, 1.0 - delta);
      }

      float broadCircularWeight(float phase, float center, float width) {
        return 1.0 - smoothstep(width * 0.42, width, circularDistance(phase, center));
      }

      void main() {
        vec2 centered = aUv * 2.0 - 1.0;
        float radius = length(centered);
        float angle = atan(centered.y, centered.x);
        float recordR = 0.965;
        float coverR = 0.42;
        float inside = 1.0 - smoothstep(recordR, recordR + 0.012, radius);
        float coverMask = smoothstep(coverR + 0.016, coverR - 0.016, radius);
        float vinylMask = inside * (1.0 - smoothstep(coverR - 0.01, coverR + 0.02, radius));

        float groove = sin(radius * 420.0 - uTime * 1.4) * 0.5 + 0.5;
        float fine = sin(radius * 980.0 + angle * 11.0) * 0.5 + 0.5;
        float fullPhase = fract((angle + 3.14159265) / 6.2831853 + 0.01);
        float mountainPhase = fract(fullPhase - uTime * 0.0045);
        float angularOffset = uTime * 0.0024 + sin(uTime * 0.017) * 0.012;
        float driftingPhase = fract(mountainPhase + angularOffset);
        float spectrumPhase = 0.5 - 0.5 * cos(driftingPhase * 6.2831853);
        float spectrum = texture2D(uSpectrumTex, vec2(spectrumPhase, 0.5)).r;
        float neighborA = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase - 0.028, 0.0, 1.0), 0.5)).r;
        float neighborB = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase + 0.028, 0.0, 1.0), 0.5)).r;
        float neighborC = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase - 0.056, 0.0, 1.0), 0.5)).r;
        float neighborD = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase + 0.056, 0.0, 1.0), 0.5)).r;
        float barLevel = mix(
          spectrum * 0.58 + (neighborA + neighborB) * 0.14 + (neighborC + neighborD) * 0.04,
          spectrum * 0.86 + (neighborA + neighborB) * 0.06 + (neighborC + neighborD) * 0.01,
          uMountainPeaks
        );
        float lowTurn = smoothstep(0.0, 0.065, circularDistance(driftingPhase, 0.0));
        float highTurn = smoothstep(0.0, 0.065, circularDistance(driftingPhase, 0.5));
        float lowEdgeLevel = texture2D(uSpectrumTex, vec2(0.018, 0.5)).r;
        float highEdgeLevel = texture2D(uSpectrumTex, vec2(0.982, 0.5)).r;
        barLevel = mix(lowEdgeLevel, barLevel, lowTurn);
        barLevel = mix(highEdgeLevel, barLevel, highTurn);
        barLevel = clamp(barLevel, 0.0, 1.0);

        float largeTerrain = sin(mountainPhase * 6.2831853 + 0.35) * 0.34;
        largeTerrain += sin(mountainPhase * 6.2831853 * 2.0 - 1.05) * 0.52;
        largeTerrain += sin(mountainPhase * 6.2831853 * 3.0 + 1.72) * 0.31;
        float mediumTerrain = sin(mountainPhase * 6.2831853 * 5.0 - 0.55) * 0.23;
        mediumTerrain += sin(mountainPhase * 6.2831853 * 7.0 + 2.35) * 0.16;
        mediumTerrain += sin(mountainPhase * 6.2831853 * 9.0 - 1.68) * 0.11;
        float fineTerrain = sin(mountainPhase * 6.2831853 * 13.0 + 0.42) * 0.075;
        fineTerrain += sin(mountainPhase * 6.2831853 * 17.0 - 2.08) * 0.052;
        fineTerrain += sin(mountainPhase * 6.2831853 * 23.0 + 1.12) * 0.035;
        float baseSignedTerrain = largeTerrain * 0.15 + mediumTerrain * 0.12 + fineTerrain * 0.08;

        float flowA = sin((mountainPhase + uTime * 0.0028) * 6.2831853 * 2.0 + 0.7);
        float flowB = sin((mountainPhase - uTime * 0.0019) * 6.2831853 * 4.0 + 2.1);
        float flowC = sin((mountainPhase + uTime * 0.0012) * 6.2831853 * 7.0 - 0.9);
        float slowSignedTerrain = flowA * 0.022 + flowB * 0.015 + flowC * 0.009;

        float bassPhase = fract(mountainPhase + angularOffset * 0.47);
        float bassSpread = 0.28;
        bassSpread += broadCircularWeight(bassPhase, 0.08, 0.28) * 0.24;
        bassSpread += broadCircularWeight(bassPhase, 0.39, 0.34) * 0.19;
        bassSpread += broadCircularWeight(bassPhase, 0.71, 0.30) * 0.22;
        bassSpread += broadCircularWeight(bassPhase, 0.91, 0.25) * 0.16;
        float bassTerrain = pow(clamp(uBass, 0.0, 1.0), 0.72) * bassSpread;
        float midMask = smoothstep(0.10, 0.28, spectrumPhase) * (1.0 - smoothstep(0.73, 0.94, spectrumPhase));
        float localSpectrum = spectrum * 0.74 + (neighborA + neighborB) * 0.11 + (neighborC + neighborD) * 0.02;
        float midTerrain = pow(clamp(localSpectrum * midMask, 0.0, 1.0), mix(1.72, 0.94, uMountainPeaks));
        float highMask = smoothstep(0.64, 0.90, spectrumPhase);
        float highTerrain = localSpectrum * highMask * uTreble;
        float audioHeight = bassTerrain * 0.075 + midTerrain * (0.13 + uMid * 0.075);
        float signedTerrain = baseSignedTerrain + slowSignedTerrain + audioHeight;

        float glowNeighborA = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase - 0.085, 0.0, 1.0), 0.5)).r;
        float glowNeighborB = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase + 0.085, 0.0, 1.0), 0.5)).r;
        float glowNeighborC = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase - 0.16, 0.0, 1.0), 0.5)).r;
        float glowNeighborD = texture2D(uSpectrumTex, vec2(clamp(spectrumPhase + 0.16, 0.0, 1.0), 0.5)).r;
        float spreadSpectrum = barLevel * 0.48 + (glowNeighborA + glowNeighborB) * 0.17 + (glowNeighborC + glowNeighborD) * 0.09;
        float baseGlow = 0.16 + 0.025 * (sin(mountainPhase * 6.2831853 * 2.0 + 0.8) * 0.5 + 0.5);
        float glowFlowA = sin((mountainPhase + uTime * 0.0027) * 6.2831853 * 3.0 + 1.1) * 0.5 + 0.5;
        float glowFlowB = sin((mountainPhase - uTime * 0.0018) * 6.2831853 * 5.0 - 0.4) * 0.5 + 0.5;
        float noiseGlow = 0.055 + glowFlowA * 0.065 + glowFlowB * 0.035;
        float audioGlow = smoothstep(0.015, 0.82, spreadSpectrum + bassTerrain * 0.18);
        audioGlow *= 0.42 + uEnergy * 0.48 + uMid * 0.24;

        // A broad radial volume turns the existing terrain into a fluid ring
        // around the label: its silhouette is irregular, but the cover stays
        // legible at the centre like a physical record beneath liquid glass.
        float terrainMidline = 0.805;
        float liquidTop = clamp(
          terrainMidline + signedTerrain * (0.94 + uMountainEdge * 0.42) + audioHeight * (0.24 + uBass * 0.22),
          0.61,
          0.985
        );
        float radialT = clamp((radius - 0.50) / max(0.001, liquidTop - 0.50), 0.0, 1.0);
        float edgeSoftness = mix(0.072, 0.034, uMountainPeaks);
        float mountainBand = smoothstep(0.455, 0.525, radius) * (1.0 - smoothstep(liquidTop - edgeSoftness, liquidTop + edgeSoftness, radius));
        float mountainDome = pow(sin(radialT * 3.14159265), mix(0.54, 1.04, uMountainPeaks));
        float mountainCrest = smoothstep(0.18, 0.95, radialT) * (1.0 - smoothstep(0.82, 1.0, radialT));
        float surfaceRipple = sin((mountainPhase - uTime * 0.006) * 6.2831853 * 19.0 + radius * 31.0);
        surfaceRipple += sin((mountainPhase + uTime * 0.004) * 6.2831853 * 31.0 - radius * 19.0) * 0.45;
        float ridgeDetail = surfaceRipple * (0.018 + highTerrain * 0.085);
        float signedRelief = baseSignedTerrain * 1.15 + slowSignedTerrain * 0.78;
        float baseRelief = 0.24 + signedRelief;
        float audioRelief = bassTerrain * 0.24 + midTerrain * (0.68 + uMid * 0.28);
        float spectrumLift = max(0.14, baseRelief + audioRelief * (0.78 + uMountainHeight * 0.90));
        float sweepHead = fract(uTime * uSweepSpeed + 0.08);
        float sweepDistance = circularDistance(mountainPhase, sweepHead);
        float sweepPacket = 1.0 - smoothstep(0.025, 0.14, sweepDistance);
        sweepPacket = pow(sweepPacket, 1.55);
        float oppositeSweepDistance = circularDistance(mountainPhase, fract(sweepHead + 0.5));
        float oppositeSweepPacket = 1.0 - smoothstep(0.025, 0.14, oppositeSweepDistance);
        oppositeSweepPacket = pow(oppositeSweepPacket, 1.55);
        sweepPacket = max(sweepPacket, oppositeSweepPacket);
        float valleyResponse = 1.0 - smoothstep(-0.055, 0.16, signedRelief + audioHeight * 0.35);
        float terrainSweep = mountainBand * sweepPacket * (0.86 + valleyResponse * 1.22);
        float mountainWave = mountainBand * mountainDome * spectrumLift * (1.18 + uEnergy * 0.52 + uBass * 0.24);
        mountainWave += terrainSweep * 0.72;
        mountainWave += mountainBand * mountainCrest * ridgeDetail;
        float audioLift = uBass * 0.16 + uTreble * fine * 0.05;
        float ripple = sin(radius * 34.0 - uTime * 2.8 + angle * 2.0) * 0.018 * (0.35 + uMid);
        float coverCenterDome = smoothstep(coverR, 0.05, radius);
        float coverBeatRingCenter = uCoverRippleAge * coverR * 1.16;
        float coverBeatRingWidth = mix(0.022, 0.055, smoothstep(0.0, 1.0, uCoverRippleAge));
        float coverBeatRing = (1.0 - smoothstep(coverBeatRingWidth, coverBeatRingWidth * 2.15, abs(radius - coverBeatRingCenter)));
        coverBeatRing *= coverMask * (1.0 - smoothstep(0.76, 1.0, uCoverRippleAge));
        coverBeatRing *= smoothstep(0.02, 0.11, coverBeatRingCenter);
        float outerRippleAge = clamp((uCoverRippleAge - 0.08) / 0.92, 0.0, 1.0);
        float outerRippleCenter = coverR + outerRippleAge * (recordR - coverR - 0.05);
        float outerRippleWidth = mix(0.125, 0.195, outerRippleAge);
        float outerRippleDistance = abs(radius - outerRippleCenter);
        float outerRippleBody = 1.0 - smoothstep(
          outerRippleWidth,
          outerRippleWidth * 1.42,
          outerRippleDistance
        );
        float outerRippleCrest = 1.0 - smoothstep(
          outerRippleWidth * 0.16,
          outerRippleWidth * 0.42,
          outerRippleDistance
        );
        float outerRipple = outerRippleBody * 0.76 + outerRippleCrest * 0.38;
        outerRipple *= vinylMask * smoothstep(coverR + 0.01, coverR + 0.09, radius);
        outerRipple *= 1.0 - smoothstep(0.93, 1.0, outerRippleAge);
        outerRipple *= mountainBand * (1.18 + mountainDome * 0.38);

        vec2 rotated = rotate2d(-0.34) * centered;
        vec3 pos = vec3(rotated.x * 3.05, rotated.y * 3.05, 0.0);
        vec2 radialDir = normalize(rotated + vec2(0.0001, 0.0));
        float edgePush = mountainBand * smoothstep(0.55, 1.0, radialT) * max(0.055, 0.10 + signedRelief + audioHeight * 0.72 + ridgeDetail * 0.20);
        pos.xy += radialDir * edgePush * uMountainEdge;
        pos.x += 0.08;
        pos.y += 0.02;
        pos.z += (groove * 0.028 + fine * 0.010 + ripple * 0.55 + audioLift * 0.45) * vinylMask;
        pos.z += mountainWave * uMountainHeight;
        pos.z += coverMask * (0.018 + uBass * 0.010);
        pos.z += coverMask * uCoverPulse * (0.032 + coverCenterDome * 0.018);
        pos.z += outerRipple * uCoverPulse * 0.018;
        pos.xy += radialDir * outerRipple * uCoverPulse * 0.005;

        float summonProgress = clamp(uVoiceSummonAge, 0.0, 1.0);
        float summonScatter = smoothstep(0.0, 0.30, summonProgress)
          * (1.0 - smoothstep(0.50, 0.92, summonProgress));
        float summonGather = smoothstep(0.44, 1.0, summonProgress);
        float summonSeed = fract(sin(dot(aUv, vec2(91.7, 267.3))) * 41837.127);
        float summonAngle = angle + summonScatter * (3.8 + summonSeed * 7.2) + radius * 2.15 + uTime * 0.38;
        float spiralRadius = radius * 3.05 + summonScatter * (0.65 + summonSeed * 2.55);
        vec2 spiralPosition = vec2(cos(summonAngle), sin(summonAngle)) * spiralRadius;
        spiralPosition += vec2(cos(summonAngle * 0.37), sin(summonAngle * 0.51)) * summonScatter * 0.34;

        // Style 1: a six-lobed supernova that opens like liquid petals.
        float petalWave = 0.5 + 0.5 * sin(angle * 6.0 + summonSeed * 1.7 + uTime * 0.52);
        float petalRadius = radius * 2.75 + summonScatter * (0.48 + petalWave * 2.45 + summonSeed * 0.62);
        float petalAngle = angle + summonScatter * sin(angle * 3.0 + uTime * 0.44) * 0.58;
        vec2 petalPosition = vec2(cos(petalAngle), sin(petalAngle)) * petalRadius;
        petalPosition += vec2(0.0, (summonSeed - 0.5) * 0.72) * summonScatter;

        // Style 2: two counter-rotating tidal arms with a pinched waist.
        float armSide = summonSeed > 0.5 ? 1.0 : -1.0;
        float tidalAngle = angle + armSide * summonScatter * (5.4 + radius * 4.8);
        float tidalRadius = radius * 2.72 + summonScatter * (0.72 + pow(abs(sin(angle)), 0.7) * 2.2);
        vec2 tidalPosition = vec2(cos(tidalAngle), sin(tidalAngle)) * tidalRadius;
        tidalPosition.x += armSide * summonScatter * (0.42 + summonSeed * 0.46);
        tidalPosition.y *= 0.72 + abs(cos(tidalAngle)) * 0.34;

        float isPetal = step(0.5, uSummonEffect) * (1.0 - step(1.5, uSummonEffect));
        float isTidal = step(1.5, uSummonEffect);
        vec2 summonPosition = mix(spiralPosition, petalPosition, isPetal);
        summonPosition = mix(summonPosition, tidalPosition, isTidal);
        pos.xy = mix(pos.xy, summonPosition, summonScatter * 0.94);
        float depthScatter = (summonSeed - 0.5) * 4.2 + sin(angle * 6.0 + summonSeed * 15.0) * 0.38;
        depthScatter = mix(depthScatter, sin(angle * 6.0) * 1.45 + (petalWave - 0.5) * 2.2, isPetal);
        depthScatter = mix(depthScatter, armSide * sin(tidalAngle * 2.0) * 1.7 + (summonSeed - 0.5) * 2.4, isTidal);
        pos.z += summonScatter * depthScatter;
        // The normal layout is intentionally offset, but the summoned disc
        // must share the post-process orb's exact screen-space centre.
        pos.xy = mix(pos.xy, vec2(rotated.x * 3.05, rotated.y * 3.05), summonGather);

        float transitionBurst = max(0.0, sin(uSongTransition * 3.14159265));
        float galaxySeed = fract(sin(dot(aUv, vec2(127.1, 311.7))) * 43758.5453);
        float galaxyAngle = angle + transitionBurst * (2.2 + galaxySeed * 4.8) + radius * 1.35;
        float galaxyRadius = radius * 3.05 + transitionBurst * (0.48 + galaxySeed * 2.15);
        vec2 galaxyPosition = vec2(cos(galaxyAngle), sin(galaxyAngle)) * galaxyRadius;

        float songPetalWave = 0.5 + 0.5 * sin(angle * 6.0 + galaxySeed * 1.7 + uTime * 0.52);
        float songPetalRadius = radius * 2.75 + transitionBurst * (0.42 + songPetalWave * 2.15 + galaxySeed * 0.55);
        float songPetalAngle = angle + transitionBurst * sin(angle * 3.0 + uTime * 0.44) * 0.52;
        vec2 songPetalPosition = vec2(cos(songPetalAngle), sin(songPetalAngle)) * songPetalRadius;

        float songArmSide = galaxySeed > 0.5 ? 1.0 : -1.0;
        float songTidalAngle = angle + songArmSide * transitionBurst * (4.8 + radius * 4.2);
        float songTidalRadius = radius * 2.82 + transitionBurst * (0.62 + pow(abs(sin(angle)), 0.7) * 1.95);
        vec2 songTidalPosition = vec2(cos(songTidalAngle), sin(songTidalAngle)) * songTidalRadius;
        songTidalPosition.x += songArmSide * transitionBurst * (0.36 + galaxySeed * 0.40);
        songTidalPosition.y *= 0.74 + abs(cos(songTidalAngle)) * 0.30;

        float songIsPetal = step(0.5, uSongEffect) * (1.0 - step(1.5, uSongEffect));
        float songIsTidal = step(1.5, uSongEffect);
        vec2 songTransitionPosition = mix(galaxyPosition, songPetalPosition, songIsPetal);
        songTransitionPosition = mix(songTransitionPosition, songTidalPosition, songIsTidal);
        pos.xy = mix(pos.xy, songTransitionPosition, transitionBurst * 0.88);
        float songDepthScatter = (galaxySeed - 0.5) * 3.1 + sin(angle * 5.0 + galaxySeed * 12.0) * 0.24;
        songDepthScatter = mix(songDepthScatter, sin(angle * 6.0) * 1.25 + (songPetalWave - 0.5) * 1.8, songIsPetal);
        songDepthScatter = mix(songDepthScatter, songArmSide * sin(songTidalAngle * 2.0) * 1.45, songIsTidal);
        pos.z += transitionBurst * songDepthScatter;

        // Shared vinyl-to-portrait handoff: the existing record particles
        // break into a deterministic spiral cloud before the portrait gathers.
        float portraitBreak = smoothstep(0.0, 0.72, uPortraitTransition);
        float portraitSeed = fract(sin(dot(aUv, vec2(173.3, 269.5))) * 41731.731);
        vec2 portraitTangent = vec2(-radialDir.y, radialDir.x);
        pos.xy += radialDir * portraitBreak * (0.35 + portraitSeed * 2.25);
        pos.xy += portraitTangent * sin(portraitBreak * 3.14159265) * (portraitSeed - 0.5) * 2.8;
        pos.z += (portraitSeed - 0.5) * portraitBreak * 3.4;

        vUv = vec2(cos(angle), sin(angle)) * radius * 0.5 / max(coverR, 0.001) + 0.5;
        float tintAngle = spectrumPhase * 6.2831853;
        vTintUv = vec2(cos(tintAngle), sin(tintAngle)) * 0.28 + 0.5;
        vRadius = radius;
        vAlpha = inside;
        vCoverMask = coverMask;
        vGroove = groove;
        vMountain = mountainWave;
        vMountainBand = mountainBand;
        vCoverRipple = 0.0;
        vBeatSweep = outerRipple * uCoverPulse;
        vViewFacing = abs(normalize(normalMatrix * vec3(0.0, 0.0, 1.0)).z);
        vBaseGlow = baseGlow;
        vNoiseGlow = noiseGlow;
        vAudioGlow = audioGlow;
        vTerrainSweep = terrainSweep;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        // The points form a height field. This analytical normal follows the
        // existing relief without changing a single particle position.
        vec3 estimatedNormal = normalize(vec3(
          -radialDir * (0.11 + mountainWave * 0.42 + ridgeDetail * 0.58),
          1.0
        ));
        vec3 viewNormal = normalize(normalMatrix * estimatedNormal);
        vec3 viewDirection = normalize(-mvPosition.xyz);
        float normalViewDot = clamp(dot(viewNormal, viewDirection), 0.0, 1.0);
        vFresnel = pow(1.0 - normalViewDot, 3.8);
        vec3 keyDirection = normalize(vec3(-0.48, 0.72, 0.50));
        vec3 cyanDirection = normalize(vec3(0.78, 0.18, 0.42));
        vec3 reflectionDirection = reflect(-keyDirection, viewNormal);
        vSpecularFacing = pow(max(dot(reflectionDirection, viewDirection), 0.0), 42.0);
        vStudioLight = vec2(
          pow(max(dot(viewNormal, keyDirection), 0.0), 7.0),
          pow(max(dot(viewNormal, cyanDirection), 0.0), 11.0)
        );
        vParticleSeed = fract(sin(dot(aUv, vec2(127.31, 311.73))) * 43758.5453);
        vViewPosition = mvPosition.xyz;
        float pointBase = mix(0.19 + uTreble * 0.22 + groove * 0.055 + mountainWave * 0.09, 0.16 + uTreble * 0.055, coverMask);
        pointBase += mountainBand * 0.035;
        gl_PointSize = pointBase * (420.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uCoverTex;
      uniform sampler2D uPreviousCoverTex;
      uniform float uBass;
      uniform float uMid;
      uniform float uTreble;
      uniform float uEnergy;
      uniform float uPlaying;
      uniform float uSongTransition;
      uniform float uTime;
      uniform float uPortraitTransition;
      varying vec2 vUv;
      varying vec2 vTintUv;
      varying float vRadius;
      varying float vAlpha;
      varying float vCoverMask;
      varying float vGroove;
      varying float vMountain;
      varying float vMountainBand;
      varying float vCoverRipple;
      varying float vBeatSweep;
      varying float vViewFacing;
      varying float vBaseGlow;
      varying float vNoiseGlow;
      varying float vAudioGlow;
      varying float vTerrainSweep;
      varying float vFresnel;
      varying float vSpecularFacing;
      varying float vParticleSeed;
      varying vec2 vStudioLight;
      varying vec3 vViewPosition;

      float hash12(vec2 point) {
        vec3 p3 = fract(vec3(point.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 acesFilmic(vec3 value) {
        const float a = 2.51;
        const float b = 0.03;
        const float c = 2.43;
        const float d = 0.59;
        const float e = 0.14;
        return clamp((value * (a * value + b)) / (value * (c * value + d) + e), 0.0, 1.0);
      }

      vec3 boostSaturation(vec3 color, float amount) {
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        return max(vec3(0.0), mix(vec3(luminance), color, amount));
      }

      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float spriteDistance = length(point);
        float dotMask = smoothstep(0.43, 0.17, spriteDistance);
        float spriteCore = 1.0 - smoothstep(0.018, 0.095, spriteDistance);
        float spriteHalo = (1.0 - smoothstep(0.08, 0.31, spriteDistance)) * (1.0 - spriteCore * 0.72);
        vec2 coverUv = clamp(vUv, 0.004, 0.996);
        vec2 coverTexel = vec2(0.0024);
        float coverMix = smoothstep(0.06, 0.94, uSongTransition);
        vec3 oldCoverSource = texture2D(uPreviousCoverTex, coverUv).rgb;
        vec3 newCoverSource = texture2D(uCoverTex, coverUv).rgb;
        vec3 coverSource = mix(oldCoverSource, newCoverSource, coverMix);
        vec3 coverBlur = texture2D(uCoverTex, clamp(coverUv + vec2(coverTexel.x, 0.0), 0.004, 0.996)).rgb;
        coverBlur += texture2D(uCoverTex, clamp(coverUv - vec2(coverTexel.x, 0.0), 0.004, 0.996)).rgb;
        coverBlur += texture2D(uCoverTex, clamp(coverUv + vec2(0.0, coverTexel.y), 0.004, 0.996)).rgb;
        coverBlur += texture2D(uCoverTex, clamp(coverUv - vec2(0.0, coverTexel.y), 0.004, 0.996)).rgb;
        coverBlur *= 0.25;
        coverBlur = mix(oldCoverSource, coverBlur, coverMix);
        vec3 cover = clamp(coverSource + (coverSource - coverBlur) * 0.82, 0.0, 1.0);
        cover = clamp((cover - 0.5) * 1.14 + 0.5, 0.0, 1.0);
        vec2 tintUv = clamp(vTintUv, 0.04, 0.96);
        vec3 oldCoverTint = texture2D(uPreviousCoverTex, tintUv).rgb;
        vec3 newCoverTint = texture2D(uCoverTex, tintUv).rgb;
        vec3 coverTint = mix(oldCoverTint, newCoverTint, coverMix);
        vec3 paletteTint = texture2D(uCoverTex, vec2(0.28, 0.34)).rgb;
        paletteTint += texture2D(uCoverTex, vec2(0.72, 0.36)).rgb;
        paletteTint += texture2D(uCoverTex, vec2(0.34, 0.72)).rgb;
        paletteTint += texture2D(uCoverTex, vec2(0.68, 0.68)).rgb;
        paletteTint *= 0.25;
        // Sample a continuously travelling path through the current artwork.
        // The path is shared by the entire terrain, so the colour reads as
        // liquid flowing through one surface instead of particles flickering
        // independently. Two broad waves prevent a visible repeating seam.
        float liquidAngle = atan(vTintUv.y - 0.5, vTintUv.x - 0.5);
        float liquidPhase = liquidAngle * 1.65 + vRadius * 13.5 - uTime * (0.23 + uPlaying * 0.07);
        liquidPhase += sin(liquidAngle * 3.0 + uTime * 0.11) * 0.72;
        vec2 liquidSampleUv = vec2(
          0.5 + cos(liquidPhase) * 0.34,
          0.5 + sin(liquidPhase * 0.73 + uTime * 0.065) * 0.34
        );
        vec3 oldLiquidTint = texture2D(uPreviousCoverTex, clamp(liquidSampleUv, 0.04, 0.96)).rgb;
        vec3 newLiquidTint = texture2D(uCoverTex, clamp(liquidSampleUv, 0.04, 0.96)).rgb;
        vec3 movingCoverTint = mix(oldLiquidTint, newLiquidTint, coverMix);
        float coverLum = dot(cover, vec3(0.299, 0.587, 0.114));
        float coverHigh = max(max(cover.r, cover.g), cover.b);
        float coverLow = min(min(cover.r, cover.g), cover.b);
        float coverSaturation = (coverHigh - coverLow) / max(coverHigh, 0.08);
        float paleSurface = smoothstep(0.40, 0.86, coverLum)
          * (1.0 - smoothstep(0.24, 0.72, coverSaturation));
        float dimColoredSurface = (1.0 - smoothstep(0.12, 0.38, coverLum))
          * smoothstep(0.035, 0.20, coverHigh);
        float surfaceGlow = clamp(paleSurface + dimColoredSurface * 0.62, 0.0, 1.0);
        float playbackGlow = uPlaying * (0.08 + uEnergy * 0.10 + uBass * 0.025);
        vec3 coverNeutral = vec3(coverLum);
        vec3 coverDisplay = mix(coverNeutral, cover, 1.34 + uPlaying * 0.22);
        coverDisplay = clamp(coverDisplay * (1.02 + coverLum * 0.18 + playbackGlow), 0.0, 1.0);
        coverDisplay = boostSaturation(coverDisplay, 1.16 + uPlaying * 0.10);
        vec3 liftedSurfaceTint = mix(
          cover / max(coverHigh, 0.10) * 0.58,
          vec3(0.92, 0.97, 1.0),
          paleSurface * 0.72
        );
        coverDisplay += liftedSurfaceTint * surfaceGlow * (0.16 + uPlaying * 0.10);
        float tintLum = max(dot(coverTint, vec3(0.299, 0.587, 0.114)), 0.08);
        float paletteLum = max(dot(paletteTint, vec3(0.299, 0.587, 0.114)), 0.06);
        float darkTintBlend = 1.0 - smoothstep(0.055, 0.22, tintLum);
        coverTint = mix(coverTint, paletteTint / paletteLum * 0.34, darkTintBlend * 0.82);
        tintLum = max(dot(coverTint, vec3(0.299, 0.587, 0.114)), 0.08);
        coverTint = mix(coverTint / tintLum * 0.38, coverTint, 0.38);
        float liquidWave = sin(liquidPhase * 1.37 - uTime * 0.17) * 0.5 + 0.5;
        vec3 auroraTint = mix(coverTint / tintLum, paletteTint / paletteLum, 0.34 + liquidWave * 0.34);
        float movingTintLum = max(dot(movingCoverTint, vec3(0.299, 0.587, 0.114)), 0.055);
        vec3 normalizedMovingTint = movingCoverTint / movingTintLum * 0.48;
        auroraTint = mix(auroraTint, normalizedMovingTint, 0.30 + liquidWave * 0.26);
        auroraTint = boostSaturation(auroraTint, 1.72 + uPlaying * 0.12);
        float auroraHigh = max(max(auroraTint.r, auroraTint.g), auroraTint.b);
        auroraTint *= min(1.0, 0.94 / max(auroraHigh, 0.001));
        vec3 vinyl = vec3(0.0025, 0.003, 0.0035);
        float grooveBand = smoothstep(0.45, 0.50, vRadius) * (1.0 - smoothstep(0.935, 0.965, vRadius));
        float grooveLine = pow(sin(vRadius * 760.0 + vGroove * 0.55) * 0.5 + 0.5, 9.0);
        float slowTrack = pow(sin(vRadius * 96.0 - uBass * 2.2) * 0.5 + 0.5, 5.0);
        vec3 grooveBlack = vec3(0.0015, 0.0018, 0.0019);
        grooveBlack += vec3(0.03, 0.033, 0.034) * grooveLine;
        grooveBlack += vec3(0.016, 0.018, 0.018) * slowTrack;
        float ambientGlow = vBaseGlow + vNoiseGlow;
        float musicGlow = smoothstep(0.0, 1.0, vAudioGlow);
        float ringGlow = ambientGlow + musicGlow * (0.42 + uTreble * 0.16);
        grooveBlack += boostSaturation(coverTint, 1.46) * (0.058 + grooveBand * ringGlow * 0.42);
        grooveBlack += auroraTint * vMountainBand * (ambientGlow * 0.34 + musicGlow * 0.46);
        grooveBlack += auroraTint * vMountain * (0.11 + musicGlow * (0.23 + uTreble * 0.075));
        grooveBlack += auroraTint * vTerrainSweep * 0.31;
        vinyl = mix(vinyl, grooveBlack, grooveBand);
        // Keep the new light volume strictly outside the central label, so
        // the cover remains a dark, solid record rather than a lit surface.
        float outerLiquidMask = smoothstep(0.445, 0.535, vRadius);
        float liquidVolume = vMountainBand * outerLiquidMask * (0.11 + vMountain * 0.23 + musicGlow * 0.095);
        float liquidCrest = smoothstep(0.22, 0.94, vMountain + vTerrainSweep * 0.34);
        vinyl += auroraTint * liquidVolume * (0.24 + liquidCrest * 0.24);
        vinyl += mix(auroraTint, vec3(0.90, 0.97, 1.0), 0.34) * liquidCrest * vMountainBand * outerLiquidMask * (0.018 + musicGlow * 0.022);
        vinyl += vec3(0.07, 0.072, 0.066) * smoothstep(0.95, 0.965, vRadius);
        vinyl += vec3(0.018, 0.020, 0.021) * vGroove * (1.0 - grooveBand);
        vec3 labelRing = vec3(0.34, 0.35, 0.35) * smoothstep(0.035, 0.006, abs(vRadius - 0.42));
        vec3 outerTrackRing = vec3(0.19, 0.20, 0.19) * smoothstep(0.018, 0.004, abs(vRadius - 0.945));
        vec3 color = mix(vinyl, coverDisplay, vCoverMask);
        color += coverTint * vCoverMask * playbackGlow * 0.075;
        color = mix(color, coverTint * 1.18 + vec3(0.18), vCoverRipple * 0.34);
        float beatSweepGlow = pow(clamp(vBeatSweep, 0.0, 1.0), 0.72);
        float beatSweepTintLum = max(dot(coverTint, vec3(0.299, 0.587, 0.114)), 0.06);
        vec3 beatSweepTint = coverTint / beatSweepTintLum * 0.72;
        color += beatSweepTint * beatSweepGlow * (0.20 + uEnergy * 0.035);
        color += beatSweepTint * pow(beatSweepGlow, 1.9) * 0.11;
        color += labelRing + outerTrackRing;
        color += vec3(0.66, 0.42, 0.22) * uTreble * 0.08 * vGroove;

        // Procedural studio reflections: a broad white softbox and a narrow
        // cyan edge source create material depth without scene lights.
        float subjectMask = grooveBand * outerLiquidMask;
        float materialSurfaceGlow = surfaceGlow * clamp(vCoverMask + subjectMask * 0.72, 0.0, 1.0);
        color += vec3(0.46, 0.57, 0.68) * vStudioLight.x * subjectMask * 0.20;
        color += vec3(0.08, 0.52, 0.72) * vStudioLight.y * subjectMask * 0.18;

        // View-dependent rim light. Angular breakup keeps it local instead of
        // drawing a fixed blue outline around the whole silhouette.
        float viewAngle = atan(vViewPosition.y, vViewPosition.x);
        float rimBreakup = 0.34 + 0.66 * pow(sin(viewAngle * 2.35 + uTime * 0.055) * 0.5 + 0.5, 1.7);
        float rimStrength = vFresnel * rimBreakup * subjectMask;
        vec3 rimTint = mix(auroraTint, vec3(0.88, 0.96, 1.0), vStudioLight.x * 0.62);
        color += rimTint * rimStrength * 0.42;

        // A narrow reflection travels slowly across the curved height field.
        // The core is white, with a compact cyan/ice-blue shoulder and only a
        // trace of violet dispersion at the brightest edge.
        float bandMotion = sin(uTime * (0.105 + uMid * 0.005)) * 0.48;
        float bandCoordinate = dot(normalize(vViewPosition.xy + vec2(0.0001)), normalize(vec2(0.68, 0.73)))
          + vViewPosition.z * 0.30 - bandMotion;
        float bandCore = 1.0 - smoothstep(0.018, 0.052, abs(bandCoordinate));
        float bandShoulder = 1.0 - smoothstep(0.045, 0.145, abs(bandCoordinate));
        float movingSpecular = subjectMask * (bandShoulder * 0.28 + bandCore * 0.72)
          * (0.58 + vStudioLight.x * 0.42);
        vec3 specularTint = mix(auroraTint * 0.78, vec3(0.96, 0.985, 1.0), bandCore);
        specularTint += vec3(0.045, 0.018, 0.085) * bandCore * smoothstep(0.0, 0.05, bandCoordinate);
        color += specularTint * movingSpecular * (0.48 + uEnergy * 0.025);

        // Keep the vinyl surface continuous: decorative white particle cores
        // read as visual noise on bright album artwork.
        float brightParticle = 0.0;
        float glintSeed = hash12(vec2(vParticleSeed, floor(viewAngle * 17.0)));
        float glintCycle = max(0.0, sin(uTime * (0.72 + glintSeed * 0.58) + glintSeed * 31.0));
        float glintLife = pow(glintCycle, 22.0);
        float rareGlint = 0.0;
        color += vec3(0.16, 0.72, 0.96) * spriteHalo * brightParticle * 0.30;
        color += vec3(0.90, 0.98, 1.0) * spriteCore * brightParticle * 0.92;
        color += liftedSurfaceTint * spriteHalo * materialSurfaceGlow * (0.18 + uPlaying * 0.12);
        color += vec3(0.18, 0.78, 1.0) * spriteHalo * rareGlint * 0.90;
        color += vec3(2.35, 2.46, 2.55) * spriteCore * rareGlint;
        float spindleHole = smoothstep(0.025, 0.032, vRadius);
        float glassRingBody = smoothstep(0.030, 0.037, vRadius)
          * (1.0 - smoothstep(0.050, 0.057, vRadius));
        float glassRingInnerEdge = 1.0 - smoothstep(0.003, 0.008, abs(vRadius - 0.034));
        float glassRingOuterEdge = 1.0 - smoothstep(0.003, 0.008, abs(vRadius - 0.053));
        float glassRingEdge = max(glassRingInnerEdge, glassRingOuterEdge);
        float ringTintLuminance = dot(coverTint, vec3(0.299, 0.587, 0.114));
        vec3 ringEnvironmentTint = mix(vec3(ringTintLuminance), coverTint, 0.20);
        ringEnvironmentTint = mix(vec3(0.48), ringEnvironmentTint, 0.46);
        float ringAngleLight = sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 2.0 - uTime * 0.42) * 0.5 + 0.5;
        vec3 glassRingColor = mix(ringEnvironmentTint, vec3(0.72, 0.86, 1.0), 0.26);
        glassRingColor += vec3(0.16, 0.03, 0.10) * glassRingEdge * (1.0 - ringAngleLight) * 0.32;
        glassRingColor += vec3(0.02, 0.12, 0.18) * glassRingEdge * ringAngleLight * 0.34;
        glassRingColor += vec3(0.88, 0.94, 1.0) * glassRingEdge * (0.08 + ringAngleLight * 0.10);
        color = mix(color, glassRingColor, glassRingBody * 0.78);
        float coverAlpha = 0.82 + uPlaying * 0.05;
        float alpha = vAlpha * dotMask * mix(0.10 + grooveBand * 0.28 + vMountainBand * (0.21 + uTreble * 0.18 + vMountain * 0.24) + vMountain * 0.34, coverAlpha, vCoverMask);
        alpha += grooveBand * dotMask * (vBaseGlow * 0.025 + vNoiseGlow * 0.018 + vAudioGlow * 0.035);
        alpha += liquidVolume * dotMask * (0.035 + liquidCrest * 0.055);
        alpha += vTerrainSweep * dotMask * 0.052;
        alpha += vCoverRipple * dotMask * 0.10;
        alpha += beatSweepGlow * dotMask * (0.32 + uEnergy * 0.12);
        alpha += spriteHalo * materialSurfaceGlow * (0.07 + uPlaying * 0.06);
        alpha = max(alpha, (spriteCore * 0.86 + spriteHalo * 0.16) * brightParticle * vAlpha);
        alpha = max(alpha, (spriteCore + spriteHalo * 0.22) * rareGlint * vAlpha);
        float sideViewCompensation = mix(0.16, 1.0, smoothstep(0.06, 0.78, vViewFacing));
        alpha *= mix(sideViewCompensation, 1.0, vCoverMask);
        alpha *= 1.0 - smoothstep(0.965, 1.0, vRadius);
        alpha *= spindleHole;
        float glassRingAlpha = glassRingBody * dotMask
          * (0.24 + glassRingEdge * 0.24 + ringAngleLight * 0.08);
        alpha = max(alpha, glassRingAlpha);
        alpha *= 1.0 - smoothstep(0.18, 0.68, uPortraitTransition);
        // Tone-map inside this custom shader so high-energy cores retain
        // cyan/blue/silver transitions instead of clipping to dead white.
        color = acesFilmic(color * 0.92);
        color = boostSaturation(color, 1.24);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  }), [])

  useEffect(() => {
    spectrumTextureRef.current = material.uniforms.uSpectrumTex.value
  }, [material])

  useEffect(() => {
    samplerRef.current = makeAudioSampler(getFrequencyData, active)
  }, [active, getFrequencyData])

  useEffect(() => {
    rimTrailMaterialRef.current = rimTrailMaterial
  }, [rimTrailMaterial])

  useEffect(() => () => {
    rimTrailGeometry.dispose()
    rimTrailMaterial.dispose()
  }, [rimTrailGeometry, rimTrailMaterial])

  useFrame((state, delta) => {
    const trailMaterial = rimTrailMaterialRef.current
    if (!materialRef.current || !trailMaterial || !samplerRef.current) return
    const audio = samplerRef.current.read()
    if (voiceOrbVisible && !previousVoiceOrbVisibleRef.current) {
      voiceSummonAgeRef.current = 0
      summonEffectRef.current = Math.floor(Math.random() * 3)
      materialRef.current.uniforms.uSummonEffect.value = summonEffectRef.current
    }
    previousVoiceOrbVisibleRef.current = voiceOrbVisible
    voiceSummonAgeRef.current = voiceOrbVisible
      ? Math.min(1, voiceSummonAgeRef.current + delta / 3.6)
      : 0
    materialRef.current.uniforms.uVoiceSummonAge.value = voiceSummonAgeRef.current
    // FFT is an input producer only. From this point onward the record reads
    // the same normalized optical field as the orb and UI glass.
    opticalFieldController.setAudioFrame(audio)
    opticalFieldController.tick(delta)
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    materialRef.current.uniforms.uBass.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uBass.value, audio.bass, 0.12)
    materialRef.current.uniforms.uMid.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uMid.value, audio.mid, 0.10)
    materialRef.current.uniforms.uTreble.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uTreble.value, audio.treble, 0.13)
    materialRef.current.uniforms.uEnergy.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uEnergy.value, audio.energy, 0.12)
    materialRef.current.uniforms.uPlaying.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uPlaying.value, active ? 1 : 0, 0.08)
    trailMaterial.uniforms.uTime.value = state.clock.elapsedTime
    trailMaterial.uniforms.uPlaying.value = THREE.MathUtils.lerp(
      trailMaterial.uniforms.uPlaying.value,
      voiceOrbVisible ? 0 : active ? 1 : 0.48,
      0.065,
    )
    trailMaterial.uniforms.uEnergy.value = THREE.MathUtils.lerp(
      trailMaterial.uniforms.uEnergy.value,
      audio.energy,
      0.1,
    )
    materialRef.current.uniforms.uPortraitTransition.value = portraitTransition
    materialRef.current.uniforms.uMountainEdge.value = mountainControls.edge
    materialRef.current.uniforms.uMountainHeight.value = mountainControls.height
    materialRef.current.uniforms.uMountainPeaks.value = mountainControls.peaks
    materialRef.current.uniforms.uSweepSpeed.value = mountainControls.speed ?? 0.006
    if (audio.beatStrength > 0.14) {
      coverPulseRef.current = Math.max(coverPulseRef.current, 0.85 + audio.beatStrength * 1.5)
      recordShakeRef.current.power = Math.max(recordShakeRef.current.power, audio.beatStrength)
      coverRippleAgeRef.current = 0
    }
    coverPulseRef.current = THREE.MathUtils.damp(coverPulseRef.current, 0, 2.1, delta)
    recordShakeRef.current.power = THREE.MathUtils.damp(recordShakeRef.current.power, 0, 9.5, delta)
    recordShakeRef.current.phase += delta * (17 + recordShakeRef.current.power * 16)
    coverRippleAgeRef.current = Math.min(1, coverRippleAgeRef.current + delta * (1.75 + coverPulseRef.current * 0.42))
    materialRef.current.uniforms.uCoverPulse.value = coverPulseRef.current
    materialRef.current.uniforms.uCoverRippleAge.value = coverRippleAgeRef.current
    songTransitionRef.current = Math.min(1, songTransitionRef.current + delta * 0.5)
    materialRef.current.uniforms.uSongTransition.value = songTransitionRef.current
    if (spectrumTextureRef.current && audio.bins) {
      const textureData = spectrumTextureRef.current.image.data
      for (let index = 0; index < SPECTRUM_BINS; index += 1) {
        const value = THREE.MathUtils.clamp(Math.round(audio.bins[index] * 1.55 * 255), 0, 255)
        const offset = index * 4
        textureData[offset] = value
        textureData[offset + 1] = value
        textureData[offset + 2] = value
        textureData[offset + 3] = 255
      }
      spectrumTextureRef.current.needsUpdate = true
    }
    if (coverTextureRef.current && materialRef.current.uniforms.uCoverTex.value !== coverTextureRef.current) {
      if (hasLoadedCoverRef.current) {
        materialRef.current.uniforms.uPreviousCoverTex.value = materialRef.current.uniforms.uCoverTex.value
        songEffectRef.current = Math.floor(Math.random() * 3)
        materialRef.current.uniforms.uSongEffect.value = songEffectRef.current
        songTransitionRef.current = 0
        materialRef.current.uniforms.uSongTransition.value = 0
      } else {
        materialRef.current.uniforms.uPreviousCoverTex.value = coverTextureRef.current
        hasLoadedCoverRef.current = true
      }
      materialRef.current.uniforms.uCoverTex.value = coverTextureRef.current
      trailMaterial.uniforms.uCoverTex.value = coverTextureRef.current
    }
    if (groupRef.current) {
      const pointer = pointerRef.current
      spinRef.current += delta * (0.25 + audio.bass * 0.22)
      if (spinRef.current > Math.PI * 2) {
        spinRef.current -= Math.PI * 2
        groupRef.current.rotation.z -= Math.PI * 2
      }
      const entryLocked = performance.now() < entryTransitionUntilRef.current
      const targetX = voiceOrbVisible || entryLocked ? 0 : THREE.MathUtils.clamp(pointer.dragY * 1.22 + pointer.y * 0.045, -3.05, 3.05)
      const targetY = voiceOrbVisible || entryLocked ? 0 : THREE.MathUtils.clamp(pointer.dragX * 1.22 + pointer.x * 0.055, -3.05, 3.05)
      const targetZ = spinRef.current + Math.sin(state.clock.elapsedTime * 0.23) * 0.018
      const shakePower = voiceOrbVisible ? 0 : recordShakeRef.current.power
      const shakePhase = recordShakeRef.current.phase
      const shakeTiltX = Math.sin(shakePhase) * shakePower * 0.026
      const shakeTiltY = Math.cos(shakePhase * 1.17) * shakePower * 0.020
      const shakeOffsetX = Math.cos(shakePhase * 1.31) * shakePower * 0.018
      const shakeOffsetY = Math.sin(shakePhase * 1.08) * shakePower * 0.014
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX + shakeTiltX, 0.08)
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetY + shakeTiltY, 0.08)
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, targetZ, 0.08)
      groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, shakeOffsetX, 0.16)
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, shakeOffsetY, 0.16)
    }
  })

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
        <primitive ref={materialRef} object={material} attach="material" />
      </points>
    </group>
  )
}

function PointerCameraRig({ pointerRef, voiceOrbVisible }) {
  useFrame(({ camera }) => {
    const pointer = pointerRef.current
    const targetX = voiceOrbVisible ? 0 : pointer.x * 0.08
    const targetY = voiceOrbVisible ? 0 : pointer.y * 0.055
    const targetZ = CAMERA_POSITION[2] + pointer.zoom + (voiceOrbVisible ? 1.35 : 0)
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.075)
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.075)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.09)
    camera.lookAt(targetX * 0.55, targetY * 0.55, 0)
  })

  return null
}

const GLASS_ORB_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const GLASS_ORB_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform vec2 uSphere;
  uniform float uRadius;
  uniform float uTime;
  uniform float uOrbVisibility;
  uniform float uOrbVoiceLevel;
  uniform vec4 uPlayerRect;
  uniform float uPlayerRadius;
  uniform float uPlayerGlassStrength;
  uniform float uPlayerOpenProgress;
  uniform float uOpticalIntensity;
  uniform float uOpticalDistortion;
  uniform float uOpticalFlow;
  uniform float uOpticalBlur;
  uniform float uOpticalChromatic;
  uniform int uUiGlassCount;
  uniform vec4 uUiGlassRects[24];
  uniform float uUiGlassRadii[24];
  uniform float uUiGlassStrengths[24];
  uniform vec4 uLibraryRect;
  uniform float uLibraryOpenProgress;
  uniform vec4 uTopControlsRect;
  uniform float uTopControlsOpenProgress;
  uniform float uTopFogStrength;
  uniform float uTopBlurStrength;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
      mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), local.x),
      local.y
    );
  }

  float fluidNoise(vec2 point) {
    float noiseValue = valueNoise(point);
    noiseValue += valueNoise(point * 2.03 + 7.13) * 0.5;
    noiseValue += valueNoise(point * 4.01 - 3.72) * 0.25;
    return noiseValue / 1.75;
  }

  float sdRoundedBox(vec2 point, vec2 halfSize, float radius) {
    vec2 localPoint = abs(point) - halfSize + radius;
    return length(max(localPoint, 0.0))
      + min(max(localPoint.x, localPoint.y), 0.0) - radius;
  }

  float smoothUnion(float distanceA, float distanceB, float radius) {
    float blend = clamp(0.5 + 0.5 * (distanceB - distanceA) / radius, 0.0, 1.0);
    return mix(distanceB, distanceA, blend) - radius * blend * (1.0 - blend);
  }

  float playerGlassDistance(vec2 fragmentPixel) {
    float progress = clamp(uPlayerOpenProgress, 0.0, 1.0);
    float bodyGrowth = smoothstep(0.14, 0.70, progress);
    float settling = smoothstep(0.56, 0.84, progress);
    float reboundPhase = clamp((progress - 0.56) / 0.28, 0.0, 1.0);
    float rebound = sin(reboundPhase * 3.14159265)
      * (1.0 - smoothstep(0.80, 0.90, progress));
    vec2 finalHalf = max(uPlayerRect.zw, vec2(1.0));
    vec2 edgeCenter = vec2(uPlayerRect.x, -5.0);
    float edgeRadius = mix(18.0, 14.0, smoothstep(0.50, 0.86, progress));
    float edgeDistance = length(fragmentPixel - edgeCenter) - edgeRadius;
    vec2 seedCenter = vec2(uPlayerRect.x, 5.0);
    vec2 bodyCenter = mix(seedCenter, uPlayerRect.xy, bodyGrowth);
    bodyCenter.x += sin(progress * 3.14159265) * (1.0 - settling) * 7.0;
    vec2 bodyHalf = mix(
      vec2(18.0, 10.0),
      finalHalf * vec2(1.0 + rebound * 0.035, 1.0 + rebound * 0.055),
      bodyGrowth
    );
    float bodyRadius = mix(11.0, min(uPlayerRadius, min(bodyHalf.x, bodyHalf.y)), bodyGrowth);
    float bodyDistance = sdRoundedBox(fragmentPixel - bodyCenter, bodyHalf, bodyRadius)
      + (1.0 - bodyGrowth) * 94.0;
    vec2 bridgeStart = vec2(bodyCenter.x, bodyCenter.y - bodyHalf.y + bodyRadius * 0.52);
    vec2 bridgeVector = edgeCenter - bridgeStart;
    float bridgeLengthSquared = max(dot(bridgeVector, bridgeVector), 1.0);
    float bridgePosition = clamp(
      dot(fragmentPixel - bridgeStart, bridgeVector) / bridgeLengthSquared,
      0.0,
      1.0
    );
    vec2 bridgePoint = bridgeStart + bridgeVector * bridgePosition;
    float startRadius = mix(14.0, bodyRadius * 0.70, bodyGrowth);
    float bridgeRadius = mix(startRadius, edgeRadius * 0.88, bridgePosition);
    float neckFormation = smoothstep(0.54, 0.84, progress);
    bridgeRadius -= sin(bridgePosition * 3.14159265)
      * min(bridgeRadius * 0.60, 16.0) * neckFormation;
    bridgeRadius = max(7.0, bridgeRadius);
    float bridgeDistance = length(fragmentPixel - bridgePoint) - bridgeRadius;
    bridgeDistance += sin(
      bridgePosition * 11.0 + fragmentPixel.x * 0.025 + uTime * 0.70
    ) * 1.05 * (0.3 + neckFormation * 0.7);
    float finalDistance = smoothUnion(edgeDistance, bridgeDistance, 14.0);
    finalDistance = smoothUnion(finalDistance, bodyDistance, mix(12.0, 27.0, bodyGrowth));
    return finalDistance;
  }

  float libraryGlassDistance(vec2 fragmentPixel) {
    float progress = clamp(uLibraryOpenProgress, 0.0, 1.0);
    float bodyGrowth = smoothstep(0.15, 0.68, progress);
    float settling = smoothstep(0.55, 0.82, progress);
    float reboundPhase = clamp((progress - 0.55) / 0.27, 0.0, 1.0);
    float rebound = sin(reboundPhase * 3.14159265) * (1.0 - smoothstep(0.78, 0.88, progress));

    vec2 finalHalf = max(uLibraryRect.zw, vec2(1.0));
    vec2 edgeCenter = vec2(uResolution.x + 5.0, uLibraryRect.y);
    float edgeRadius = mix(20.0, 16.0, smoothstep(0.50, 0.86, progress));
    float edgeDropletDistance = length(fragmentPixel - edgeCenter) - edgeRadius;

    vec2 seedCenter = vec2(uResolution.x - 5.0, uLibraryRect.y);
    vec2 bodyCenter = mix(seedCenter, uLibraryRect.xy, bodyGrowth);
    bodyCenter.y += sin(progress * 3.14159265) * (1.0 - settling) * 8.0;
    vec2 bodyHalf = mix(
      vec2(10.0, 17.0),
      finalHalf * vec2(1.0 + rebound * 0.045, 1.0 + rebound * 0.028),
      bodyGrowth
    );
    float bodyRadius = mix(11.0, min(30.0, min(bodyHalf.x, bodyHalf.y)), bodyGrowth);
    float bodyDistance = sdRoundedBox(fragmentPixel - bodyCenter, bodyHalf, bodyRadius);
    bodyDistance += (1.0 - bodyGrowth) * 96.0;

    vec2 bridgeStart = vec2(
      bodyCenter.x + bodyHalf.x - bodyRadius * 0.52,
      bodyCenter.y
    );
    vec2 bridgeVector = edgeCenter - bridgeStart;
    float bridgeLengthSquared = max(dot(bridgeVector, bridgeVector), 1.0);
    float bridgePosition = clamp(
      dot(fragmentPixel - bridgeStart, bridgeVector) / bridgeLengthSquared,
      0.0,
      1.0
    );
    vec2 bridgeAxisPoint = bridgeStart + bridgeVector * bridgePosition;
    float startRadius = mix(15.0, bodyRadius * 0.72, bodyGrowth);
    float bridgeRadius = mix(startRadius, edgeRadius * 0.88, bridgePosition);
    float neckFormation = smoothstep(0.55, 0.82, progress);
    bridgeRadius -= sin(bridgePosition * 3.14159265)
      * min(bridgeRadius * 0.62, 17.0) * neckFormation;
    bridgeRadius = max(7.0, bridgeRadius);
    float bridgeDistance = length(fragmentPixel - bridgeAxisPoint) - bridgeRadius;
    bridgeDistance += sin(
      bridgePosition * 12.0 + fragmentPixel.y * 0.027 + uTime * 0.72
    ) * 1.15 * (0.28 + neckFormation * 0.72);

    float finalGlassDistance = smoothUnion(edgeDropletDistance, bridgeDistance, 14.0);
    finalGlassDistance = smoothUnion(finalGlassDistance, bodyDistance, mix(12.0, 28.0, bodyGrowth));
    return finalGlassDistance;
  }

  float topControlsGlassDistance(vec2 fragmentPixel) {
    float progress = clamp(uTopControlsOpenProgress, 0.0, 1.0);
    float bodyGrowth = smoothstep(0.15, 0.68, progress);
    float settling = smoothstep(0.55, 0.82, progress);
    float reboundPhase = clamp((progress - 0.55) / 0.27, 0.0, 1.0);
    float rebound = sin(reboundPhase * 3.14159265) * (1.0 - smoothstep(0.78, 0.88, progress));
    vec2 finalHalf = max(uTopControlsRect.zw, vec2(1.0));
    vec2 edgeCenter = vec2(uTopControlsRect.x, uResolution.y + 5.0);
    float edgeRadius = mix(19.0, 15.0, smoothstep(0.50, 0.86, progress));
    float edgeDistance = length(fragmentPixel - edgeCenter) - edgeRadius;
    vec2 seedCenter = vec2(uTopControlsRect.x, uResolution.y - 5.0);
    vec2 bodyCenter = mix(seedCenter, uTopControlsRect.xy, bodyGrowth);
    bodyCenter.x += sin(progress * 3.14159265) * (1.0 - settling) * 7.0;
    vec2 bodyHalf = mix(
      vec2(18.0, 10.0),
      finalHalf * vec2(1.0 + rebound * 0.032, 1.0 + rebound * 0.052),
      bodyGrowth
    );
    float bodyRadius = mix(11.0, min(28.0, min(bodyHalf.x, bodyHalf.y)), bodyGrowth);
    float bodyDistance = sdRoundedBox(fragmentPixel - bodyCenter, bodyHalf, bodyRadius)
      + (1.0 - bodyGrowth) * 92.0;
    vec2 bridgeStart = vec2(bodyCenter.x, bodyCenter.y + bodyHalf.y - bodyRadius * 0.52);
    vec2 bridgeVector = edgeCenter - bridgeStart;
    float bridgeLengthSquared = max(dot(bridgeVector, bridgeVector), 1.0);
    float bridgePosition = clamp(
      dot(fragmentPixel - bridgeStart, bridgeVector) / bridgeLengthSquared,
      0.0,
      1.0
    );
    vec2 bridgePoint = bridgeStart + bridgeVector * bridgePosition;
    float startRadius = mix(14.0, bodyRadius * 0.70, bodyGrowth);
    float bridgeRadius = mix(startRadius, edgeRadius * 0.88, bridgePosition);
    float neckFormation = smoothstep(0.55, 0.82, progress);
    bridgeRadius -= sin(bridgePosition * 3.14159265)
      * min(bridgeRadius * 0.60, 16.0) * neckFormation;
    bridgeRadius = max(7.0, bridgeRadius);
    float bridgeDistance = length(fragmentPixel - bridgePoint) - bridgeRadius;
    bridgeDistance += sin(
      bridgePosition * 11.0 + fragmentPixel.x * 0.025 + uTime * 0.70
    ) * 1.05 * (0.3 + neckFormation * 0.7);
    float finalDistance = smoothUnion(edgeDistance, bridgeDistance, 14.0);
    finalDistance = smoothUnion(finalDistance, bodyDistance, mix(12.0, 27.0, bodyGrowth));
    return finalDistance;
  }

  vec2 getFluidWarp(vec2 normalXY, float radialMask) {
    float slowTime = uTime * 0.055;
    float noiseA = fluidNoise(normalXY * 1.72 + vec2(slowTime, -slowTime * 0.72));
    float noiseB = fluidNoise(normalXY.yx * 1.46 + vec2(9.7 - slowTime * 0.64, 3.1 + slowTime));
    vec2 flow = vec2(noiseA - 0.5, noiseB - 0.5);
    flow += vec2(-normalXY.y, normalXY.x) * (noiseA - noiseB) * 0.36;
    return flow * radialMask;
  }

  vec2 getSphereOffset(vec2 uv, vec2 center, float radius) {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 delta = uv - center;
    delta.x *= aspect;
    float distanceFromCenter = length(delta);
    vec2 direction = delta / max(distanceFromCenter, 0.0001);

    if (distanceFromCenter < radius) {
      vec2 normalXY = delta / radius;
      float normalZ = sqrt(max(0.0, 1.0 - dot(normalXY, normalXY)));
      float normalizedDistance = distanceFromCenter / radius;
      float middleOuterMask = smoothstep(0.22, 0.88, normalizedDistance);
      float edgeCompression = smoothstep(0.48, 0.94, normalizedDistance);
      float refraction = pow(1.0 - normalZ, 1.72);
      float geometricStrength = mix(0.22, 1.30, middleOuterMask);
      vec2 offset = normalXY * refraction * radius * geometricStrength;
      vec2 fluidWarp = getFluidWarp(normalXY, middleOuterMask * (1.0 - smoothstep(0.94, 1.0, normalizedDistance)));
      offset += fluidWarp * radius * mix(0.009, 0.024, edgeCompression);
      offset.x /= aspect;
      return offset;
    }

    float influence = 1.0 - smoothstep(radius, radius * 3.1, distanceFromCenter);
    float falloff = pow(radius / max(distanceFromCenter, radius), 3.0);
    vec2 offset = -direction * falloff * influence * radius * 0.12;
    offset.x /= aspect;
    return offset;
  }

  vec4 sampleSceneSoft(vec2 uv, float softness) {
    vec2 texel = softness / max(uResolution, vec2(1.0));
    vec4 sampleColor = texture2D(uScene, uv) * 0.20;
    sampleColor += texture2D(uScene, uv + vec2(texel.x, 0.0)) * 0.12;
    sampleColor += texture2D(uScene, uv - vec2(texel.x, 0.0)) * 0.12;
    sampleColor += texture2D(uScene, uv + vec2(0.0, texel.y)) * 0.12;
    sampleColor += texture2D(uScene, uv - vec2(0.0, texel.y)) * 0.12;
    sampleColor += texture2D(uScene, uv + texel) * 0.08;
    sampleColor += texture2D(uScene, uv - texel) * 0.08;
    sampleColor += texture2D(uScene, uv + vec2(texel.x, -texel.y)) * 0.08;
    sampleColor += texture2D(uScene, uv + vec2(-texel.x, texel.y)) * 0.08;
    return sampleColor;
  }

  float sceneLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void sampleLocalScene(
    vec2 uv,
    out vec3 averageColor,
    out float averageLuminance,
    out float localDetail
  ) {
    vec2 sampleStep = vec2(6.0) / max(uResolution, vec2(1.0));
    vec3 center = sampleSceneSoft(uv, 2.4).rgb;
    vec3 sample0 = texture2D(uScene, uv + vec2(sampleStep.x, 0.0)).rgb;
    vec3 sample1 = texture2D(uScene, uv - vec2(sampleStep.x, 0.0)).rgb;
    vec3 sample2 = texture2D(uScene, uv + vec2(0.0, sampleStep.y)).rgb;
    vec3 sample3 = texture2D(uScene, uv - vec2(0.0, sampleStep.y)).rgb;
    vec3 sample4 = texture2D(uScene, uv + sampleStep).rgb;
    vec3 sample5 = texture2D(uScene, uv - sampleStep).rgb;
    vec3 sample6 = texture2D(uScene, uv + vec2(sampleStep.x, -sampleStep.y)).rgb;
    vec3 sample7 = texture2D(uScene, uv + vec2(-sampleStep.x, sampleStep.y)).rgb;
    averageColor = (
      center * 2.0 + sample0 + sample1 + sample2 + sample3
      + sample4 + sample5 + sample6 + sample7
    ) / 10.0;
    averageLuminance = sceneLuminance(averageColor);
    float centerLuminance = sceneLuminance(center);
    localDetail = (
      abs(sceneLuminance(sample0) - centerLuminance)
      + abs(sceneLuminance(sample1) - centerLuminance)
      + abs(sceneLuminance(sample2) - centerLuminance)
      + abs(sceneLuminance(sample3) - centerLuminance)
      + abs(sceneLuminance(sample4) - centerLuminance)
      + abs(sceneLuminance(sample5) - centerLuminance)
      + abs(sceneLuminance(sample6) - centerLuminance)
      + abs(sceneLuminance(sample7) - centerLuminance)
    ) / 8.0;
  }

  vec3 applySharedLargeGlassMaterial(
    vec3 refractedColor,
    vec2 sampleUv,
    vec3 localAverageColor,
    float localAverageLuminance,
    float localDetail,
    float materialMask
  ) {
    float complexBackground = smoothstep(0.035, 0.19, localDetail);
    vec3 localNeutral = vec3(localAverageLuminance);
    vec3 environmentTint = mix(localNeutral, localAverageColor, 0.22);
    environmentTint = mix(vec3(0.5), environmentTint, 0.46);
    vec3 softSample = sampleSceneSoft(
      sampleUv,
      3.2 + complexBackground * 1.8 + uTopBlurStrength * 1.35
    ).rgb;
    vec3 fogTint = mix(vec3(sceneLuminance(softSample)), environmentTint, 0.16);
    float fogAmount = clamp(
      materialMask * (0.045 + complexBackground * 0.025) * uTopFogStrength,
      0.0,
      0.92
    );
    float blurAmount = clamp(
      materialMask * uTopBlurStrength * (0.022 + complexBackground * 0.010),
      0.0,
      0.72
    );
    float tintAmount = clamp(
      materialMask * (0.018 + complexBackground * 0.012) * uTopFogStrength,
      0.0,
      0.65
    );
    refractedColor = mix(refractedColor, softSample, fogAmount);
    refractedColor = mix(refractedColor, softSample, blurAmount);
    return mix(refractedColor, fogTint, tintAmount);
  }

  vec4 internalLightBand(vec2 glassLocal, float baseDepth, float phase, vec3 bandColor, float bandIndex) {
    float lane = bandIndex - 2.0;
    float slowTime = uTime * (0.072 + bandIndex * 0.003);
    vec2 point = glassLocal;
    float depth = baseDepth
      + sin(point.x * (2.12 + bandIndex * 0.06) + phase + slowTime) * 0.082
      + (fluidNoise(point * 1.28 + phase) - 0.5) * 0.085;
    point.x += depth * glassLocal.x * 0.16;
    point.y += depth * glassLocal.y * 0.08;

    float segmentStart = -0.90;
    float segmentEnd = 0.88;
    float segmentMask = smoothstep(segmentStart, segmentStart + 0.20, point.x)
      * (1.0 - smoothstep(segmentEnd - 0.22, segmentEnd, point.x));
    float segmentProgress = clamp((point.x - segmentStart) / max(0.001, segmentEnd - segmentStart), 0.0, 1.0);
    float horizontalPosition = segmentProgress * 2.0 - 1.0;
    float widthEnvelope = pow(max(0.0, 1.0 - horizontalPosition * horizontalPosition), 0.68);
    float endConvergence = smoothstep(0.0, 0.34, widthEnvelope);
    float listeningEnergy = uOpticalIntensity;
    float idleBreath = 0.5 + 0.5 * sin(uTime * 0.54 + phase * 0.3);

    float sharedTime = uTime * 0.078;
    float centerY = sin(point.x * 3.22 + 1.26 + sharedTime) * 0.145;
    centerY += sin(point.x * 1.36 - 0.54 - sharedTime * 0.55) * 0.062;
    centerY += (fluidNoise(point * 1.62 + vec2(1.26, sharedTime)) - 0.5) * 0.075;
    centerY += sin(point.x * 2.05 - uTime * 0.82 + phase) * uOpticalDistortion * 0.115 * widthEnvelope;
    float localPeaks = sin(point.x * 8.8 + uTime * 1.65 + phase) * uOpticalFlow * 0.030;
    localPeaks += sin(point.x * 15.7 - uTime * 2.4 + phase * 1.7) * uOpticalChromatic * 0.018;
    localPeaks += (fluidNoise(vec2(point.x * 4.8 - uTime * 0.62, phase + uTime * 0.19)) - 0.5)
      * (uOpticalFlow * 0.042 + uOpticalChromatic * 0.028);
    centerY += localPeaks * widthEnvelope;
    float layerSeparation = lane * 0.040 + sin(point.x * 2.2 + phase + slowTime) * 0.012;
    centerY += layerSeparation * widthEnvelope;

    float maximumWidth = 0.112 + (1.0 - min(1.0, abs(lane) * 0.5)) * 0.014;
    maximumWidth *= 1.0 + idleBreath * 0.025 + listeningEnergy * 0.72 * pow(widthEnvelope, 1.35) + uOpticalDistortion * 0.34 * widthEnvelope;
    float pulsePosition = fract(uTime * (0.095 + uOpticalIntensity * 0.24) + bandIndex * 0.047) * 2.0 - 1.0;
    float travelingPulse = exp(-pow((horizontalPosition - pulsePosition) * 5.2, 2.0));
    maximumWidth *= 1.0 + travelingPulse * uOpticalIntensity * 0.16 * widthEnvelope;
    float bandWidth = maximumWidth * widthEnvelope + 0.0015;
    float upperVariation = (fluidNoise(vec2(point.x * 1.82 + phase, slowTime * 0.72 + 4.1)) - 0.5) * 0.18;
    float lowerVariation = (fluidNoise(vec2(point.x * 1.57 - phase, slowTime * 0.61 + 8.7)) - 0.5) * 0.16;
    float upperWidth = bandWidth * (1.02 + upperVariation + sin(point.x * 2.4 + slowTime) * 0.035);
    float lowerWidth = bandWidth * (0.92 + lowerVariation - sin(point.x * 2.05 - slowTime * 0.8) * 0.042);
    float signedDistance = point.y - centerY;
    float normalizedBandDistance = signedDistance >= 0.0
      ? signedDistance / max(upperWidth, 0.002)
      : -signedDistance / max(lowerWidth, 0.002);
    float band = 1.0 - smoothstep(0.48, 1.0, normalizedBandDistance);
    float bandGlow = (1.0 - smoothstep(0.72, 2.75, normalizedBandDistance))
      * (1.0 - band) * endConvergence;
    float sphereSurfaceDepth = sqrt(max(0.0, 1.0 - dot(glassLocal, glassLocal)));
    float volumeMask = smoothstep(abs(depth) + 0.08, abs(depth) + 0.18, sphereSurfaceDepth);
    float depthFade = mix(0.48, 0.88, depth * 0.5 + 0.5);
    float centralExpansion = mix(0.28, 1.0, widthEnvelope);
    float alpha = (band * 0.66 + bandGlow * 0.28) * segmentMask * volumeMask * depthFade * centralExpansion;

    float luminousCore = 1.0 - smoothstep(0.08, 0.72, normalizedBandDistance);
    luminousCore *= mix(0.58, 1.0, widthEnvelope);
    vec3 shadedColor = bandColor * mix(1.05, 1.88, depth * 0.5 + 0.5);
    shadedColor += bandColor * bandGlow * 0.62;
    shadedColor *= 1.0 + uOpticalIntensity * 0.46 + idleBreath * 0.018;
    shadedColor += mix(bandColor, vec3(1.0, 0.985, 0.95), 0.42)
      * luminousCore * (0.58 + uOpticalIntensity * 0.62);
    shadedColor += mix(bandColor, vec3(1.0), 0.62) * travelingPulse
      * (0.08 + uOpticalIntensity * 0.78) * band * widthEnvelope;
    return vec4(shadedColor, alpha);
  }

  vec4 blendLightBand(vec4 underLayer, vec4 overLayer) {
    float resultAlpha = overLayer.a + underLayer.a * (1.0 - overLayer.a);
    vec3 resultColor = (
      overLayer.rgb * overLayer.a
      + underLayer.rgb * underLayer.a * (1.0 - overLayer.a)
    ) / max(resultAlpha, 0.001);
    return vec4(resultColor, resultAlpha);
  }

  vec3 lightBandSpectrum(float position) {
    float spectralPosition = clamp(position, 0.0, 1.0);
    vec3 spectrum = mix(vec3(1.00, 0.12, 0.10), vec3(1.00, 0.72, 0.10), smoothstep(0.00, 0.26, spectralPosition));
    spectrum = mix(spectrum, vec3(0.16, 1.00, 0.48), smoothstep(0.22, 0.50, spectralPosition));
    spectrum = mix(spectrum, vec3(0.12, 0.58, 1.00), smoothstep(0.46, 0.75, spectralPosition));
    spectrum = mix(spectrum, vec3(0.72, 0.22, 1.00), smoothstep(0.72, 1.00, spectralPosition));
    return spectrum;
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 delta = vUv - uSphere;
    delta.x *= aspect;
    float distanceFromCenter = length(delta);
    float normalizedDistance = distanceFromCenter / uRadius;
    vec4 originalColor = texture2D(uScene, vUv);
    vec2 offset = getSphereOffset(vUv, uSphere, uRadius) * uOrbVisibility;
    vec4 color = texture2D(uScene, vUv - offset);

    if (distanceFromCenter < uRadius) {
      vec2 normalXY = delta / uRadius;
      float normalZ = sqrt(max(0.0, 1.0 - dot(normalXY, normalXY)));
      float middleOuterMask = smoothstep(0.22, 0.88, normalizedDistance);
      float bend = pow(1.0 - normalZ, 1.72) * uRadius * mix(0.22, 1.30, middleOuterMask);
      vec2 fluidWarp = getFluidWarp(normalXY, middleOuterMask * (1.0 - smoothstep(0.94, 1.0, normalizedDistance)));
      vec2 geometricOffset = normalXY * bend + fluidWarp * uRadius * 0.021;
      geometricOffset.x /= aspect;

      vec2 dispersionOffset = normalXY * bend * 0.045;
      dispersionOffset.x /= aspect;
      float backgroundSoftness = mix(4.5, 9.0, smoothstep(0.12, 0.94, normalizedDistance));
      color.r = sampleSceneSoft(vUv - geometricOffset - dispersionOffset, backgroundSoftness).r;
      color.g = sampleSceneSoft(vUv - geometricOffset, backgroundSoftness).g;
      color.b = sampleSceneSoft(vUv - geometricOffset + dispersionOffset, backgroundSoftness).b;
      float backgroundLuma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(backgroundLuma), color.rgb, 0.58);
      color.rgb = mix(color.rgb, vec3(backgroundLuma * 0.74 + 0.018), 0.24);

      float fresnel = pow(1.0 - normalZ, 3.0);
      float rim = smoothstep(0.66, 1.0, normalizedDistance);
      float localDarkEdge = smoothstep(0.69, 0.99, normalizedDistance)
        * smoothstep(-0.82, 0.34, dot(normalize(normalXY + vec2(0.0001)), normalize(vec2(0.72, -0.56))));
      float highlight = smoothstep(0.34, 0.0, length((normalXY - vec2(-0.34, 0.38)) * vec2(0.72, 1.5)));

      vec3 ghostSample = sampleSceneSoft(vUv - geometricOffset * 1.12 + vec2(0.0025 / aspect, -0.0018), backgroundSoftness * 1.18).rgb;
      vec3 reflectedSample = sampleSceneSoft(vUv + geometricOffset * 0.42, backgroundSoftness * 1.32).rgb;
      color.rgb = mix(color.rgb, ghostSample, rim * 0.10);
      color.rgb += reflectedSample * fresnel * 0.16;

      float upperHemisphere = smoothstep(-0.10, 0.18, normalXY.y);
      float upperDepth = smoothstep(0.02, 0.92, normalXY.y);
      float upperBlackGradient = upperHemisphere * mix(0.42, 0.86, upperDepth);
      upperBlackGradient *= 1.0 - highlight * 0.22;
      vec3 upperGlassTint = mix(vec3(0.012, 0.016, 0.022), vec3(0.001, 0.003, 0.006), upperDepth);
      color.rgb = mix(color.rgb, upperGlassTint, upperBlackGradient);
      color.a = max(color.a, upperBlackGradient * 0.88);

      vec2 refractedLocal = normalXY - vec2(geometricOffset.x * aspect, geometricOffset.y) / max(uRadius, 0.0001) * 0.46;
      refractedLocal += fluidWarp * 0.08;
      float voicePulse = clamp(uOrbVoiceLevel, 0.0, 1.0);
      float bandBreath = 1.0 + voicePulse * (0.16 + 0.10 * sin(uTime * 17.0));
      vec4 lightBandStack = internalLightBand(refractedLocal, -0.36, 1.04 * bandBreath, vec3(1.00, 0.13, 0.10), 0.0);
      lightBandStack = blendLightBand(lightBandStack, internalLightBand(refractedLocal, -0.18, 1.15 * bandBreath, vec3(1.00, 0.72, 0.10), 1.0));
      lightBandStack = blendLightBand(lightBandStack, internalLightBand(refractedLocal, 0.00, 1.26 * bandBreath, vec3(0.16, 1.00, 0.48), 2.0));
      lightBandStack = blendLightBand(lightBandStack, internalLightBand(refractedLocal, 0.18, 1.37 * bandBreath, vec3(0.12, 0.58, 1.00), 3.0));
      lightBandStack = blendLightBand(lightBandStack, internalLightBand(refractedLocal, 0.36, 1.48 * bandBreath, vec3(0.72, 0.22, 1.00), 4.0));
      vec3 lightBandVolume = lightBandStack.rgb;
      float lightBandAlpha = lightBandStack.a;
      float glassDepthFade = smoothstep(0.99, 0.72, normalizedDistance);
      color.rgb = mix(color.rgb, lightBandVolume, min(0.92, lightBandAlpha * glassDepthFade * (1.22 + voicePulse * 0.28)));

      float shellProjection = smoothstep(0.66, 0.96, normalizedDistance) * (1.0 - smoothstep(0.988, 1.0, normalizedDistance));
      vec2 shellFlow = fluidWarp * mix(0.045, 0.12, shellProjection);
      shellFlow += vec2(-normalXY.y, normalXY.x) * sin(normalXY.x * 5.2 + uTime * 0.11) * shellProjection * 0.018;
      vec2 surfaceProjection = normalXY * 0.78 + shellFlow;
      vec4 surfaceStack = internalLightBand(surfaceProjection, -0.36, 1.04, vec3(1.00, 0.13, 0.10), 0.0);
      surfaceStack = blendLightBand(surfaceStack, internalLightBand(surfaceProjection, -0.18, 1.15, vec3(1.00, 0.72, 0.10), 1.0));
      surfaceStack = blendLightBand(surfaceStack, internalLightBand(surfaceProjection, 0.00, 1.26, vec3(0.16, 1.00, 0.48), 2.0));
      surfaceStack = blendLightBand(surfaceStack, internalLightBand(surfaceProjection, 0.18, 1.37, vec3(0.12, 0.58, 1.00), 3.0));
      surfaceStack = blendLightBand(surfaceStack, internalLightBand(surfaceProjection, 0.36, 1.48, vec3(0.72, 0.22, 1.00), 4.0));
      vec3 surfaceBandLight = surfaceStack.rgb * surfaceStack.a;
      float surfaceBandAlpha = surfaceStack.a;
      float contactField = surfaceBandAlpha * shellProjection;
      vec2 contactOffset = vec2(
        surfaceStack.r - surfaceStack.b,
        surfaceStack.g - (surfaceStack.r + surfaceStack.b) * 0.32
      ) * uRadius * contactField * 0.15;
      contactOffset.x /= aspect;
      vec3 contactRefraction = sampleSceneSoft(
        vUv - geometricOffset - contactOffset,
        backgroundSoftness * mix(1.0, 0.72, contactField)
      ).rgb;
      color.rgb = mix(color.rgb, contactRefraction, contactField * 0.34);

      color.rgb *= 1.0 - rim * 0.23 - localDarkEdge * 0.23;
      vec3 surfaceSpectrum = lightBandSpectrum(normalXY.x * 0.5 + 0.5);
      float sphereIllumination = (0.026 + surfaceBandAlpha * 0.12) * (0.56 + normalZ * 0.44);
      sphereIllumination *= mix(1.0, 0.56, upperBlackGradient);
      color.rgb += surfaceSpectrum * sphereIllumination;
      color.rgb += surfaceBandLight * shellProjection * 0.74;

      float outerReflectionMask = smoothstep(0.966, 0.985, normalizedDistance)
        * (1.0 - smoothstep(0.992, 1.0, normalizedDistance));
      vec3 outerReflectionColor = mix(
        surfaceSpectrum,
        surfaceStack.rgb,
        clamp(surfaceBandAlpha * 1.45, 0.0, 1.0)
      );
      float outerReflectionStrength = outerReflectionMask * (0.34 + surfaceBandAlpha * 0.62);
      color.rgb += outerReflectionColor * outerReflectionStrength;
      color.rgb += vec3(1.0, 0.94, 0.84) * highlight * 0.20;
      color.a = max(
        color.a,
        0.045 + highlight * 0.18 + lightBandAlpha * 0.26
          + surfaceBandAlpha * shellProjection * 0.34
          + outerReflectionStrength * 0.38
      );
    }

    vec4 opticalComposite = mix(originalColor, color, uOrbVisibility);

    // The DOM player and the record share this screen-space optical volume.
    // uPlayerRect is expressed in framebuffer pixels: center.xy, halfSize.xy.
    vec2 fragmentPixel = vUv * uResolution;
    vec2 panelHalf = max(uPlayerRect.zw, vec2(1.0));
    float panelDistance = playerGlassDistance(fragmentPixel);
    float panelMask = 1.0 - smoothstep(-1.5, 1.5, panelDistance);
    float panelEdge = smoothstep(-32.0, -1.0, panelDistance);
    vec2 panelLocal = (fragmentPixel - uPlayerRect.xy) / panelHalf;
    vec2 panelNormal = normalize(panelLocal * vec2(0.34, 1.0) + vec2(0.0001, 0.0));
    float panelFlow = fluidNoise(panelLocal * vec2(2.4, 1.6) + vec2(uTime * 0.035, -uTime * 0.024)) - 0.5;
    vec2 panelOffsetPixels = panelNormal * (2.0 + panelEdge * panelEdge * (10.0 + uOpticalDistortion * 8.0));
    panelOffsetPixels += vec2(panelFlow, -panelFlow * 0.42)
      * (1.2 + panelEdge * 2.2 + uOpticalFlow * 3.2);
    vec2 panelOffset = panelOffsetPixels / uResolution;
    float playerThinRim = smoothstep(-7.0, -1.1, panelDistance)
      * (1.0 - smoothstep(-0.7, 1.5, panelDistance));
    vec2 chromaOffset = panelNormal
      * (0.8 + panelEdge * 2.2 + uOpticalChromatic * 4.2) / uResolution;
    vec3 panelRefraction;
    panelRefraction.r = texture2D(uScene, vUv - panelOffset - chromaOffset).r;
    panelRefraction.g = texture2D(uScene, vUv - panelOffset).g;
    panelRefraction.b = texture2D(uScene, vUv - panelOffset + chromaOffset).b;
    vec3 reflectedRecord = texture2D(uScene, vUv + panelOffset * 0.34).rgb;
    panelRefraction = mix(panelRefraction, reflectedRecord, uOpticalBlur * 0.075);
    vec3 playerAverageColor;
    float playerAverageLuminance;
    float playerLocalDetail;
    sampleLocalScene(vUv, playerAverageColor, playerAverageLuminance, playerLocalDetail);
    panelRefraction = applySharedLargeGlassMaterial(
      panelRefraction,
      vUv - panelOffset * 0.20,
      playerAverageColor,
      playerAverageLuminance,
      playerLocalDetail,
      panelMask
    );
    panelRefraction += reflectedRecord * panelEdge * (0.043 + uOpticalIntensity * 0.04);
    panelRefraction += vec3(0.72, 0.88, 1.0) * panelEdge
      * (0.018 + uOpticalIntensity * 0.012);
    panelRefraction *= 1.0 - playerThinRim * 0.055;
    panelRefraction += vec3(0.78, 0.90, 1.0) * playerThinRim
      * (0.075 + uOpticalIntensity * 0.035);
    float playerInnerGlow = (1.0 - smoothstep(-42.0, -8.0, panelDistance))
      * (0.008 + uOpticalIntensity * 0.012);
    panelRefraction += vec3(0.42, 0.58, 0.82) * playerInnerGlow;
    vec4 playerGlass = vec4(panelRefraction, opticalComposite.a);
    vec4 sharedComposite = mix(opticalComposite, playerGlass, panelMask * uPlayerGlassStrength);

    // Additional DOM glass surfaces share the exact same scene texture and
    // optical field. This makes particles bend beneath controls and panels.
    for (int glassIndex = 0; glassIndex < 24; glassIndex++) {
      if (glassIndex >= uUiGlassCount) break;
      // Strengths above 1 are geometry inputs for the dedicated top-controls
      // optical body. Rendering them here as well would refract the same
      // button twice and make its lens appear offset from the DOM control.
      if (uUiGlassStrengths[glassIndex] > 1.0) continue;
      vec4 glassRect = uUiGlassRects[glassIndex];
      vec2 glassHalf = max(glassRect.zw, vec2(1.0));
      float glassRadius = uUiGlassRadii[glassIndex];
      vec2 glassPoint = abs(fragmentPixel - glassRect.xy) - glassHalf + glassRadius;
      float glassDistance = length(max(glassPoint, 0.0))
        + min(max(glassPoint.x, glassPoint.y), 0.0) - glassRadius;
      float glassMask = 1.0 - smoothstep(-1.25, 1.25, glassDistance);
      float glassEdge = smoothstep(-min(22.0, glassHalf.y * 0.62), -0.8, glassDistance);
      vec2 glassLocal = (fragmentPixel - glassRect.xy) / glassHalf;
      vec2 glassNormal = normalize(glassLocal * vec2(0.42, 1.0) + vec2(0.0001, 0.0));
      float glassFlow = fluidNoise(glassLocal * vec2(2.1, 1.55) + vec2(uTime * 0.032, -uTime * 0.021)) - 0.5;
      vec2 glassOffsetPixels = glassNormal
        * (1.2 + glassEdge * glassEdge * (6.0 + uOpticalDistortion * 6.5));
      glassOffsetPixels += vec2(glassFlow, -glassFlow * 0.38) * (0.8 + uOpticalFlow * 2.6);
      vec2 glassOffset = glassOffsetPixels / uResolution;
      vec2 glassChroma = glassNormal
        * (0.7 + glassEdge * 1.8 + uOpticalChromatic * 3.8) / uResolution;
      vec3 glassRefraction;
      glassRefraction.r = texture2D(uScene, vUv - glassOffset - glassChroma).r;
      glassRefraction.g = texture2D(uScene, vUv - glassOffset).g;
      glassRefraction.b = texture2D(uScene, vUv - glassOffset + glassChroma).b;
      vec3 glassReflection = texture2D(uScene, vUv + glassOffset * 0.30).rgb;
      glassRefraction = mix(glassRefraction, glassReflection, uOpticalBlur * 0.075);
      glassRefraction += glassReflection * glassEdge * (0.038 + uOpticalIntensity * 0.036);
      glassRefraction += vec3(0.74, 0.88, 1.0) * glassEdge * 0.020;
      vec4 uiGlass = vec4(glassRefraction, sharedComposite.a);
      sharedComposite = mix(
        sharedComposite,
        uiGlass,
        glassMask * uUiGlassStrengths[glassIndex]
      );
    }

    // The library is one dynamic optical body. All primitives are merged into
    // finalGlassDistance before mask, normal, refraction or lighting is computed.
    vec2 libraryHalf = max(uLibraryRect.zw, vec2(1.0));
    bool insideLibraryRegion = fragmentPixel.x > uLibraryRect.x - libraryHalf.x - 46.0
      && abs(fragmentPixel.y - uLibraryRect.y) < libraryHalf.y + 48.0;
    if (insideLibraryRegion) {
      float finalGlassDistance = libraryGlassDistance(fragmentPixel);
      float libraryMask = 1.0 - smoothstep(-1.4, 1.4, finalGlassDistance);
      float libraryEdge = smoothstep(-24.0, -0.7, finalGlassDistance);
      float libraryThinRim = smoothstep(-7.0, -1.1, finalGlassDistance)
        * (1.0 - smoothstep(-0.7, 1.5, finalGlassDistance));
      float gradientStep = 1.7;
      vec2 libraryGradient = vec2(
        libraryGlassDistance(fragmentPixel + vec2(gradientStep, 0.0)) - finalGlassDistance,
        libraryGlassDistance(fragmentPixel + vec2(0.0, gradientStep)) - finalGlassDistance
      );
      vec2 libraryNormal = normalize(libraryGradient + vec2(0.0001, 0.0));
      vec2 libraryLocal = (fragmentPixel - uLibraryRect.xy) / libraryHalf;
      float libraryNoise = fluidNoise(
        libraryLocal * vec2(2.0, 1.45) + vec2(uTime * 0.028, -uTime * 0.019)
      ) - 0.5;
      vec2 libraryOffsetPixels = libraryNormal
        * (1.6 + libraryEdge * libraryEdge * (7.5 + uOpticalDistortion * 7.2));
      libraryOffsetPixels += vec2(libraryNoise, -libraryNoise * 0.42)
        * (1.0 + libraryEdge * 1.7 + uOpticalFlow * 2.9);
      vec2 libraryOffset = libraryOffsetPixels / uResolution;
      vec2 libraryChroma = libraryNormal
        * (0.8 + libraryEdge * 2.2 + uOpticalChromatic * 4.2) / uResolution;
      vec3 libraryRefraction;
      libraryRefraction.r = texture2D(uScene, vUv - libraryOffset - libraryChroma).r;
      libraryRefraction.g = texture2D(uScene, vUv - libraryOffset).g;
      libraryRefraction.b = texture2D(uScene, vUv - libraryOffset + libraryChroma).b;
      vec3 libraryReflection = texture2D(uScene, vUv + libraryOffset * 0.32).rgb;
      libraryRefraction = mix(libraryRefraction, libraryReflection, uOpticalBlur * 0.075);
      vec3 libraryAverageColor;
      float libraryAverageLuminance;
      float libraryLocalDetail;
      sampleLocalScene(vUv, libraryAverageColor, libraryAverageLuminance, libraryLocalDetail);
      libraryRefraction = applySharedLargeGlassMaterial(
        libraryRefraction,
        vUv - libraryOffset * 0.20,
        libraryAverageColor,
        libraryAverageLuminance,
        libraryLocalDetail,
        libraryMask
      );
      libraryRefraction += libraryReflection * libraryEdge
        * (0.043 + uOpticalIntensity * 0.04);
      libraryRefraction += vec3(0.72, 0.88, 1.0) * libraryEdge
        * (0.018 + uOpticalIntensity * 0.012);
      libraryRefraction *= 1.0 - libraryThinRim * 0.055;
      libraryRefraction += vec3(0.78, 0.90, 1.0) * libraryThinRim
        * (0.075 + uOpticalIntensity * 0.035);
      float libraryInnerGlow = (1.0 - smoothstep(-42.0, -8.0, finalGlassDistance))
        * (0.008 + uOpticalIntensity * 0.012);
      libraryRefraction += vec3(0.42, 0.58, 0.82) * libraryInnerGlow;
      vec4 libraryGlass = vec4(libraryRefraction, sharedComposite.a);
      sharedComposite = mix(sharedComposite, libraryGlass, libraryMask * 0.76);
    }

    vec2 topControlsHalf = max(uTopControlsRect.zw, vec2(1.0));
    float topOpenVisibility = smoothstep(0.08, 0.24, uTopControlsOpenProgress);
    bool insideTopControlsRegion = topOpenVisibility > 0.001
      && abs(fragmentPixel.x - uTopControlsRect.x) < topControlsHalf.x + 48.0
      && fragmentPixel.y > uTopControlsRect.y - topControlsHalf.y - 46.0;
    if (insideTopControlsRegion) {
      float topDistance = topControlsGlassDistance(fragmentPixel);
      float topMask = 1.0 - smoothstep(-1.4, 1.4, topDistance);
      float topEdge = smoothstep(-24.0, -0.7, topDistance);
      float topThinRim = smoothstep(-7.0, -1.1, topDistance)
        * (1.0 - smoothstep(-0.7, 1.5, topDistance));
      float topGradientStep = 1.7;
      vec2 topGradient = vec2(
        topControlsGlassDistance(fragmentPixel + vec2(topGradientStep, 0.0)) - topDistance,
        topControlsGlassDistance(fragmentPixel + vec2(0.0, topGradientStep)) - topDistance
      );
      vec2 topNormal = normalize(topGradient + vec2(0.0001, 0.0));
      vec2 topLocal = (fragmentPixel - uTopControlsRect.xy) / topControlsHalf;
      vec2 topButtonNormalSum = vec2(0.0);
      vec2 topButtonCenterSum = vec2(0.0);
      float topButtonWeightSum = 0.0;
      float topButtonBulge = 0.0;
      float topButtonPrismFocus = 0.0;
      float topButtonHighlight = 0.0;
      float topButtonSuppress = 0.0;
      for (int glassIndex = 0; glassIndex < 24; glassIndex++) {
        if (glassIndex >= uUiGlassCount) break;
        if (uUiGlassStrengths[glassIndex] <= 1.0) continue;
        vec4 buttonRect = uUiGlassRects[glassIndex];
        if (abs(buttonRect.x - uTopControlsRect.x) > topControlsHalf.x + buttonRect.z + 22.0
          || abs(buttonRect.y - uTopControlsRect.y) > topControlsHalf.y + buttonRect.w + 22.0) continue;
        float buttonBoost = clamp((uUiGlassStrengths[glassIndex] - 1.0) / 0.34, 0.0, 1.0);
        vec2 buttonHalf = max(buttonRect.zw, vec2(1.0));
        float buttonRadius = min(uUiGlassRadii[glassIndex], min(buttonHalf.x, buttonHalf.y));
        vec2 buttonPoint = abs(fragmentPixel - buttonRect.xy) - buttonHalf + buttonRadius;
        float buttonDistance = length(max(buttonPoint, 0.0))
          + min(max(buttonPoint.x, buttonPoint.y), 0.0) - buttonRadius;
        float buttonInfluence = (1.0 - smoothstep(-16.0, 18.0, buttonDistance)) * buttonBoost;
        if (buttonInfluence <= 0.001) continue;
        float buttonOcclusion = (1.0 - smoothstep(-30.0, 42.0, buttonDistance)) * buttonBoost;
        topButtonSuppress = max(topButtonSuppress, buttonOcclusion);
        float buttonEdge = smoothstep(-18.0, -0.6, buttonDistance);
        float buttonRim = smoothstep(-8.5, -1.0, buttonDistance)
          * (1.0 - smoothstep(-0.6, 1.7, buttonDistance));
        float buttonGradientStep = 1.2;
        vec2 buttonGradient = vec2(
          (
            length(max(abs(fragmentPixel + vec2(buttonGradientStep, 0.0) - buttonRect.xy) - buttonHalf + buttonRadius, 0.0))
            + min(max(
              (abs(fragmentPixel + vec2(buttonGradientStep, 0.0) - buttonRect.xy) - buttonHalf + buttonRadius).x,
              (abs(fragmentPixel + vec2(buttonGradientStep, 0.0) - buttonRect.xy) - buttonHalf + buttonRadius).y
            ), 0.0) - buttonRadius
          ) - buttonDistance,
          (
            length(max(abs(fragmentPixel + vec2(0.0, buttonGradientStep) - buttonRect.xy) - buttonHalf + buttonRadius, 0.0))
            + min(max(
              (abs(fragmentPixel + vec2(0.0, buttonGradientStep) - buttonRect.xy) - buttonHalf + buttonRadius).x,
              (abs(fragmentPixel + vec2(0.0, buttonGradientStep) - buttonRect.xy) - buttonHalf + buttonRadius).y
            ), 0.0) - buttonRadius
          ) - buttonDistance
        );
        vec2 buttonNormal = normalize(buttonGradient + vec2(0.0001, 0.0));
        float buttonLight = clamp(dot(buttonNormal, normalize(vec2(-0.62, 0.78))) * 0.5 + 0.5, 0.0, 1.0);
        topButtonNormalSum += buttonNormal * buttonInfluence * (0.32 + buttonEdge * 0.68);
        topButtonCenterSum += buttonRect.xy * buttonInfluence;
        topButtonWeightSum += buttonInfluence;
        topButtonBulge = max(topButtonBulge, buttonInfluence * (0.45 + buttonEdge * 0.72));
        topButtonPrismFocus = max(topButtonPrismFocus, buttonRim * buttonInfluence * (0.72 + buttonLight * 0.82));
        topButtonHighlight = max(topButtonHighlight, buttonRim * buttonInfluence * buttonLight);
      }
      vec2 topButtonNormal = topButtonWeightSum > 0.001
        ? normalize(topButtonNormalSum + vec2(0.0001, 0.0))
        : topNormal;
      float topNoise = fluidNoise(
        topLocal * vec2(2.0, 1.45) + vec2(uTime * 0.028, -uTime * 0.019)
      ) - 0.5;
      float topUpperFocus = clamp(topNormal.y * 0.5 + 0.5, 0.0, 1.0);
      float topPrismFocus = topThinRim
        * mix(0.72, 1.55, topUpperFocus)
        * mix(0.92, 1.55, topEdge);
      vec2 topCardOffsetPixels = topNormal
        * (1.6 + topEdge * topEdge * (7.5 + uOpticalDistortion * 7.2));
      topCardOffsetPixels += vec2(topNoise, -topNoise * 0.42)
        * (1.0 + topEdge * 1.7 + uOpticalFlow * 2.9);
      float topButtonBlend = clamp(topButtonBulge * 1.18, 0.0, 0.96);
      vec2 topButtonOffsetPixels = topButtonNormal
        * (2.8 + topButtonBulge * (7.8 + uOpticalDistortion * 6.2 + uOpticalChromatic * 2.0));
      topButtonOffsetPixels += vec2(topNoise, -topNoise * 0.34)
        * (0.34 + topButtonBulge * 0.95 + uOpticalFlow * 1.35);
      vec2 topOffsetPixels = mix(topCardOffsetPixels, topButtonOffsetPixels, topButtonBlend);
      vec2 topOffset = topOffsetPixels / uResolution;
      vec2 topCenterUv = uTopControlsRect.xy / uResolution;
      vec2 topButtonCenterUv = topButtonWeightSum > 0.001
        ? (topButtonCenterSum / topButtonWeightSum) / uResolution
        : topCenterUv;
      float topMagnifyMask = 1.0 - smoothstep(-28.0, -6.5, topDistance);
      float topMagnifyAmount = 0.036 + uOpticalIntensity * 0.008;
      vec2 topLensUv = topCenterUv
        + (vUv - topCenterUv) * (1.0 - topMagnifyMask * topMagnifyAmount);
      vec2 topButtonLensUv = topButtonCenterUv
        + (vUv - topButtonCenterUv) * (1.0 - topButtonBulge * (0.048 + uOpticalIntensity * 0.012));
      topLensUv = mix(topLensUv, topButtonLensUv, clamp(topButtonBulge * 0.92, 0.0, 0.96));
      vec3 localAverageColor;
      float localAverageLuminance;
      float localDetail;
      sampleLocalScene(vUv, localAverageColor, localAverageLuminance, localDetail);
      float buttonPresence = clamp(topButtonBulge, 0.0, 1.0);
      float brightBackground = smoothstep(0.46, 0.78, localAverageLuminance);
      float darkBackground = 1.0 - smoothstep(0.16, 0.48, localAverageLuminance);
      float complexBackground = smoothstep(0.035, 0.19, localDetail);
      vec3 localNeutral = vec3(localAverageLuminance);
      vec3 environmentTint = mix(localNeutral, localAverageColor, 0.22);
      environmentTint = mix(vec3(0.5), environmentTint, 0.46);
      vec3 glassOnDark = mix(environmentTint, vec3(0.76), 0.58);
      vec3 glassOnLight = mix(environmentTint, vec3(0.10), 0.66);
      vec3 adaptiveGlassTint = mix(glassOnDark, glassOnLight, brightBackground);
      vec2 topCardChroma = topNormal
        * (0.82 + topEdge * 2.35 + uOpticalChromatic * 4.35 + topPrismFocus * 2.1) / uResolution;
      vec2 topButtonChroma = topButtonNormal
        * (1.4 + topButtonPrismFocus * 7.8 + topButtonBulge * 4.6 + uOpticalChromatic * 2.2)
        / uResolution;
      float topButtonChromaBlend = clamp(topButtonPrismFocus * 1.28 + topButtonBlend * 0.24, 0.0, 0.98);
      vec2 topChroma = mix(topCardChroma, topButtonChroma, topButtonChromaBlend);
      vec3 topRefraction;
      topRefraction.r = texture2D(uScene, topLensUv - topOffset - topChroma).r;
      topRefraction.g = texture2D(uScene, topLensUv - topOffset).g;
      topRefraction.b = texture2D(uScene, topLensUv - topOffset + topChroma).b;
      vec3 topReflection = texture2D(uScene, topLensUv + topOffset * 0.32).rgb;
      topRefraction = mix(topRefraction, topReflection, uOpticalBlur * 0.075);
      float outerCardFogMask = 1.0 - smoothstep(0.08, 0.56, buttonPresence);
      topRefraction = applySharedLargeGlassMaterial(
        topRefraction,
        topLensUv - topOffset * 0.20,
        localAverageColor,
        localAverageLuminance,
        localDetail,
        outerCardFogMask
      );
      vec3 topButtonScatter = sampleSceneSoft(
        topButtonLensUv - topOffset * 0.42,
        1.8 + topButtonBulge * (2.2 + complexBackground * 3.8)
      ).rgb;
      topRefraction = mix(
        topRefraction,
        topButtonScatter,
        clamp(topButtonBulge * (0.10 + complexBackground * 0.16 + uOpticalBlur * 0.08), 0.0, 0.32)
      );
      float adaptiveTintAmount = buttonPresence
        * (0.025 + complexBackground * 0.105 + brightBackground * 0.035 + darkBackground * 0.018);
      topRefraction = mix(topRefraction, adaptiveGlassTint, adaptiveTintAmount);
      float textDimming = buttonPresence * brightBackground
        * (0.10 + complexBackground * 0.085);
      topRefraction = mix(topRefraction, adaptiveGlassTint * 0.42, textDimming);
      topRefraction += topReflection * topEdge
        * (0.043 + uOpticalIntensity * 0.04);
      topRefraction += vec3(0.72, 0.88, 1.0) * topEdge
        * (0.018 + uOpticalIntensity * 0.012);
      topRefraction *= 1.0 - topThinRim * 0.055;
      topRefraction += vec3(0.78, 0.90, 1.0) * topThinRim
        * (0.075 + uOpticalIntensity * 0.035);
      topRefraction += vec3(0.18, 0.06, 0.0) * topPrismFocus * 0.035;
      topRefraction += vec3(0.0, 0.06, 0.16) * topPrismFocus * 0.032;
      float adaptiveButtonHighlight = mix(1.28, 0.66, brightBackground)
        * mix(0.90, 1.18, complexBackground);
      topRefraction += mix(vec3(0.18), environmentTint, 0.28)
        * topButtonPrismFocus * 0.074 * adaptiveButtonHighlight;
      topRefraction -= vec3(0.035, 0.045, 0.060)
        * topButtonPrismFocus * brightBackground * (0.45 + complexBackground * 0.55);
      float topOuterReflectMask = topThinRim
        * mix(0.7, 1.3, topUpperFocus)
        * (0.82 + topEdge * 0.44);
      vec2 topReflectUv = topLensUv
        + topNormal * (6.0 + topEdge * 9.0) / uResolution
        + topOffset * 0.16;
      vec3 topReflectSample = sampleSceneSoft(topReflectUv, 3.0).rgb;
      float topReflectLuma = dot(topReflectSample, vec3(0.2126, 0.7152, 0.0722));
      vec3 topReflectTint = mix(
        vec3(0.86, 0.91, 0.98),
        normalize(topReflectSample + vec3(0.001)) * max(topReflectLuma, 0.001),
        0.68
      );
      topRefraction += topReflectTint * topOuterReflectMask
        * (0.05 + topReflectLuma * 0.12);
      topRefraction += vec3(0.90, 0.96, 1.0) * topButtonHighlight
        * (0.018 + uOpticalIntensity * 0.014)
        * adaptiveButtonHighlight;
      float topInnerGlow = (1.0 - smoothstep(-42.0, -8.0, topDistance))
        * (0.008 + uOpticalIntensity * 0.012);
      topRefraction += vec3(0.42, 0.58, 0.82) * topInnerGlow;
      vec4 topGlass = vec4(topRefraction, sharedComposite.a);
      float topBodyMask = topMask * 0.76 * topOpenVisibility;
      sharedComposite = mix(sharedComposite, topGlass, topBodyMask);
    }

    gl_FragColor = sharedComposite;
  }
`

function LiquidGlassOrbPass({ visible, voiceLevel = 0, topFogStrength, topBlurStrength }) {
  const { gl, scene, camera, size } = useThree()
  const renderTarget = useFBO({
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  })
  const postProcessing = useMemo(() => {
    const postScene = new THREE.Scene()
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: renderTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uSphere: { value: new THREE.Vector2(0.5, 0.5) },
        uRadius: { value: 0.105 },
        uTime: { value: 0 },
        uOrbVisibility: { value: 0 },
        uOrbVoiceLevel: { value: 0 },
        uPlayerRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uPlayerRadius: { value: 1 },
        uPlayerGlassStrength: { value: 0 },
        uPlayerOpenProgress: { value: 1 },
        uOpticalIntensity: { value: 0 },
        uOpticalDistortion: { value: 0 },
        uOpticalFlow: { value: 0 },
        uOpticalBlur: { value: 0 },
        uOpticalChromatic: { value: 0 },
        uUiGlassCount: { value: 0 },
        uUiGlassRects: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
        uUiGlassRadii: { value: new Float32Array(24) },
        uUiGlassStrengths: { value: new Float32Array(24) },
        uLibraryRect: { value: new THREE.Vector4(1, 1, 1, 1) },
        uLibraryOpenProgress: { value: 0 },
        uTopControlsRect: { value: new THREE.Vector4(1, 1, 1, 1) },
        uTopControlsOpenProgress: { value: 0 },
        uTopFogStrength: { value: 1 },
        uTopBlurStrength: { value: 0 },
      },
      vertexShader: GLASS_ORB_VERTEX_SHADER,
      fragmentShader: GLASS_ORB_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    postScene.add(quad)
    return { postScene, postCamera, material, quad }
  }, [renderTarget.texture])
  const postProcessingRef = useRef(postProcessing)
  const revealProgressRef = useRef(0)
  const playerRectFrameRef = useRef(0)
  const playerGlassTargetRef = useRef(0)
  const playerOpenProgressRef = useRef(1)
  const uiGlassFrameRef = useRef(0)
  const renderSizeRef = useRef({ width: 0, height: 0 })
  const canvasMetricsRef = useRef({ frame: 0, rect: null, scaleX: 1, scaleY: 1, radiusScale: 1 })
  const libraryOpenProgressRef = useRef(0)
  const topControlsOpenProgressRef = useRef(0)

  useEffect(() => {
    postProcessingRef.current = postProcessing
  }, [postProcessing])

  useEffect(() => () => {
    postProcessing.quad.geometry.dispose()
    postProcessing.material.dispose()
  }, [postProcessing])

  useFrame((state, delta) => {
    const pass = postProcessingRef.current
    const pixelRatio = gl.getPixelRatio()
    const width = Math.max(1, Math.floor(size.width * pixelRatio))
    const height = Math.max(1, Math.floor(size.height * pixelRatio))
    const canvasMetrics = canvasMetricsRef.current
    canvasMetrics.frame += 1
    if (!canvasMetrics.rect || canvasMetrics.frame % 20 === 0) {
      const canvasRect = gl.domElement.getBoundingClientRect()
      canvasMetrics.rect = canvasRect
      canvasMetrics.scaleX = width / Math.max(canvasRect.width, 1)
      canvasMetrics.scaleY = height / Math.max(canvasRect.height, 1)
      canvasMetrics.radiusScale = (canvasMetrics.scaleX + canvasMetrics.scaleY) * 0.5
    }
    const canvasRect = canvasMetrics.rect
    const scaleX = canvasMetrics.scaleX
    const scaleY = canvasMetrics.scaleY
    const radiusScale = canvasMetrics.radiusScale
    const writeCanvasRect = (uniform, rect) => {
      const centerX = rect.left + rect.width * 0.5
      const centerY = rect.top + rect.height * 0.5

      uniform.set(
        (centerX - canvasRect.left) * scaleX,
        (canvasRect.bottom - centerY) * scaleY,
        rect.width * 0.5 * scaleX,
        rect.height * 0.5 * scaleY,
      )
    }
    const opticalField = opticalFieldController.opticalField
    if (renderSizeRef.current.width !== width || renderSizeRef.current.height !== height) {
      renderTarget.setSize(width, height)
      renderSizeRef.current = { width, height }
    }

    gl.setRenderTarget(renderTarget)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.clear()

    pass.material.uniforms.uResolution.value.set(width, height)
    pass.material.uniforms.uSphere.value.set(0.5, 0.5)
    pass.material.uniforms.uRadius.value = 104 * pixelRatio / Math.max(1, Math.min(width, height))
    pass.material.uniforms.uTime.value = state.clock.elapsedTime
    pass.material.uniforms.uOrbVoiceLevel.value = THREE.MathUtils.damp(
      pass.material.uniforms.uOrbVoiceLevel.value,
      THREE.MathUtils.clamp(voiceLevel, 0, 1),
      18,
      delta,
    )
    const mountainPanelIsOpen = document.querySelector('.mountain-tuning-panel')?.classList.contains('is-open')
    pass.material.uniforms.uOpticalIntensity.value = opticalField.intensity
    pass.material.uniforms.uOpticalDistortion.value = opticalField.distortion
    pass.material.uniforms.uOpticalFlow.value = opticalField.flow
    pass.material.uniforms.uOpticalBlur.value = mountainPanelIsOpen ? 0 : opticalField.blur
    pass.material.uniforms.uOpticalChromatic.value = opticalField.chromatic
    pass.material.uniforms.uTopFogStrength.value = mountainPanelIsOpen ? 0 : THREE.MathUtils.clamp(topFogStrength, 0, 20)
    pass.material.uniforms.uTopBlurStrength.value = mountainPanelIsOpen ? 0 : THREE.MathUtils.clamp(topBlurStrength, 0, 20)
    const libraryElement = document.querySelector('.local-library-drawer')
    const libraryTarget = libraryElement?.classList.contains('is-open') ? 1 : 0
    const libraryResponse = libraryTarget > libraryOpenProgressRef.current ? 2.6 : 3.8
    libraryOpenProgressRef.current = THREE.MathUtils.damp(
      libraryOpenProgressRef.current,
      libraryTarget,
      libraryResponse,
      delta,
    )
    if (Math.abs(libraryTarget - libraryOpenProgressRef.current) < 0.001) {
      libraryOpenProgressRef.current = libraryTarget
    }
    pass.material.uniforms.uLibraryOpenProgress.value = libraryOpenProgressRef.current
    if (libraryElement) {
      const libraryContent = libraryElement.querySelector('.library-content')
      if (libraryContent) {
        const contentOpacity = THREE.MathUtils.clamp(
          (libraryOpenProgressRef.current - 0.82) / 0.18,
          0,
          1,
        )
        libraryContent.style.opacity = contentOpacity.toFixed(3)
      }
    }
    const topControlsElement = document.querySelector('.top-controls-card')
    const topControlsTarget = topControlsElement?.classList.contains('is-open') ? 1 : 0
    topControlsOpenProgressRef.current = THREE.MathUtils.damp(
      topControlsOpenProgressRef.current,
      topControlsTarget,
      topControlsTarget > topControlsOpenProgressRef.current ? 2.8 : 4.0,
      delta,
    )
    if (Math.abs(topControlsTarget - topControlsOpenProgressRef.current) < 0.001) {
      topControlsOpenProgressRef.current = topControlsTarget
    }
    pass.material.uniforms.uTopControlsOpenProgress.value = topControlsOpenProgressRef.current
    if (topControlsElement) {
      const topControlsContent = topControlsElement.querySelector('.top-controls-content')
      if (topControlsContent) {
        const contentOpacity = THREE.MathUtils.clamp(
          (topControlsOpenProgressRef.current - 0.82) / 0.18,
          0,
          1,
        )
        topControlsContent.style.opacity = contentOpacity.toFixed(3)
      }
    }
    uiGlassFrameRef.current += 1
    if (uiGlassFrameRef.current % 8 === 0) {
      const selector = [
        '.status-card',
        '.mode-switch',
        '.top-controls-card.is-open .mode-option',
        '.persona-switch',
        '.top-controls-card.is-open .persona-option',
        '.top-controls-card.is-open .action-button',
        '.top-controls-card.is-open .gesture-camera-toggle',
        '.top-controls-card.is-open',
        '.voice-popover.is-open',
        '.memory-settings-panel.is-open',
        '.ai-mode-expanded.is-open',
        '.chat-panel',
      ].join(',')
      const elements = Array.from(document.querySelectorAll(selector))
      let glassCount = 0
      for (const element of elements) {
        if (glassCount >= 24) break
        const isTopControlsButton = element.matches('.mode-option, .persona-option, .action-button, .gesture-camera-toggle')
        const isTopControlsShell = element.matches('.top-controls-card')
        if (element.closest('.top-controls-card') && !isTopControlsButton && !isTopControlsShell) continue
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        if (Number(style.opacity) <= 0.08 || style.display === 'none' || rect.width < 18 || rect.height < 18) continue
        const visibleWidth = Math.min(rect.right, size.width) - Math.max(rect.left, 0)
        const visibleHeight = Math.min(rect.bottom, size.height) - Math.max(rect.top, 0)
        if (visibleWidth < 14 || visibleHeight < 14) continue
        const libraryDrawer = element.closest('.local-library-drawer')
        if (libraryDrawer && element !== libraryDrawer) {
          const drawerRect = libraryDrawer.getBoundingClientRect()
          const fullyInsideDrawer = rect.left >= drawerRect.left - 1
            && rect.right <= drawerRect.right + 1
            && rect.top >= drawerRect.top - 1
            && rect.bottom <= drawerRect.bottom + 1
          if (!fullyInsideDrawer) continue
        }
        const radius = Math.min(parseFloat(style.borderRadius) || 18, rect.width * 0.5, rect.height * 0.5)
        writeCanvasRect(pass.material.uniforms.uUiGlassRects.value[glassCount], rect)
        pass.material.uniforms.uUiGlassRadii.value[glassCount] = radius * radiusScale
        pass.material.uniforms.uUiGlassStrengths.value[glassCount] = isTopControlsButton ? 1.34 : 0.72
        glassCount += 1
      }
      pass.material.uniforms.uUiGlassCount.value = glassCount
      pass.material.uniforms.uUiGlassRadii.value.needsUpdate = true
      pass.material.uniforms.uUiGlassStrengths.value.needsUpdate = true
      if (libraryElement) {
        const rect = libraryElement.getBoundingClientRect()
        writeCanvasRect(pass.material.uniforms.uLibraryRect.value, rect)
      }
      if (topControlsElement) {
        const rect = topControlsElement.getBoundingClientRect()
        writeCanvasRect(pass.material.uniforms.uTopControlsRect.value, rect)
      }
    }
    playerRectFrameRef.current += 1
    if (playerRectFrameRef.current % 6 === 0) {
      const playerElement = document.querySelector('.player-card')
      if (playerElement) {
        const rect = playerElement.getBoundingClientRect()
        const validPlayerRect = rect.width > 160 && rect.height > 40
        if (validPlayerRect) {
          writeCanvasRect(pass.material.uniforms.uPlayerRect.value, rect)
          pass.material.uniforms.uPlayerRadius.value = Math.min(rect.height * 0.5, 58) * radiusScale
        }
        playerGlassTargetRef.current = validPlayerRect ? 0.76 : 0
      } else {
        playerGlassTargetRef.current = 0
      }
    }
    const playerElement = document.querySelector('.player-card')
    const immersiveMode = document.querySelector('.app')?.classList.contains('immersive-mode')
    const playerOpenTarget = !immersiveMode || playerElement?.classList.contains('is-immersive-visible') ? 1 : 0
    playerOpenProgressRef.current = THREE.MathUtils.damp(
      playerOpenProgressRef.current,
      playerOpenTarget,
      playerOpenTarget > playerOpenProgressRef.current ? 2.7 : 4.0,
      delta,
    )
    pass.material.uniforms.uPlayerOpenProgress.value = playerOpenProgressRef.current
    pass.material.uniforms.uPlayerGlassStrength.value = THREE.MathUtils.damp(
      pass.material.uniforms.uPlayerGlassStrength.value,
      playerGlassTargetRef.current,
      8,
      delta,
    )
    revealProgressRef.current = visible
      ? Math.min(1, revealProgressRef.current + delta / 3.6)
      : THREE.MathUtils.damp(revealProgressRef.current, 0, 3.4, delta)
    pass.material.uniforms.uOrbVisibility.value = THREE.MathUtils.smoothstep(revealProgressRef.current, 0, 1)
    gl.render(pass.postScene, pass.postCamera)
  }, 1)

  return null
}

function ParticleVinylScene({ active, coverUrl, getFrequencyData, pointerRef, mountainControls, topFogStrength, topBlurStrength, voiceOrbVisible, voiceOrbLevel, portraitTransition, quality }) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <PointerCameraRig pointerRef={pointerRef} voiceOrbVisible={voiceOrbVisible} />
      <ParticleVinylDisc
        active={active}
        coverUrl={coverUrl}
        getFrequencyData={getFrequencyData}
        pointerRef={pointerRef}
        mountainControls={mountainControls}
        voiceOrbVisible={voiceOrbVisible}
        portraitTransition={portraitTransition}
        quality={quality}
      />
      {/* The pass also composites the top controls and library glass. Keep it
          mounted at every quality level; the canvas DPR below is what bounds
          its cost on the recommended and smooth presets. */}
      <LiquidGlassOrbPass visible={voiceOrbVisible} voiceLevel={voiceOrbLevel} topFogStrength={topFogStrength} topBlurStrength={topBlurStrength} />
    </>
  )
}

export default function ParticleVinylBackground({
  active = false,
  coverUrl = FALLBACK_COVER,
  trackKey = '',
  preloadCoverUrls = [],
  getFrequencyData,
  mountainControls = { edge: 0.68, height: 0.36, peaks: 0.42, speed: 0.006 },
  backgroundBrightness = 0.72,
  topFogStrength = 1,
  topBlurStrength = 8,
  viewLocked = false,
  voiceOrbVisible = false,
  voiceOrbLevel = 0,
  onReady,
  portraitTransition = 0,
  quality = 'high',
}) {
  const pointerRef = useRef(opticalFieldController.state)
  const { colors: backgroundColors, source: paletteSource } = useCoverBackgroundColors(coverUrl, preloadCoverUrls)
  const [showFlowBackground, setShowFlowBackground] = useState(true)
  // Flow gives the opening screen its visual identity; defer the much heavier
  // 115k-point record mesh until the first controls have been painted.
  const [showRecord, setShowRecord] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [debugFlowStrength, setDebugFlowStrength] = useState(1)
  const [pauseFlow, setPauseFlow] = useState(false)
  const [isolateFlow, setIsolateFlow] = useState(false)
  const [showBaseFlow, setShowBaseFlow] = useState(true)
  const [showTransitionBurst, setShowTransitionBurst] = useState(true)
  const [debugBurstStrength, setDebugBurstStrength] = useState(1)
  const [debugView, setDebugView] = useState(0)
  const [forceTransitionSignal, setForceTransitionSignal] = useState(0)
  const backgroundStyle = useMemo(() => {
    const brightness = THREE.MathUtils.clamp(backgroundBrightness, 0.16, 1.45)
    return {
      '--vinyl-bg-base': `rgb(${colorToRgb(scaleColor(backgroundColors.base, brightness))})`,
      '--vinyl-bg-primary': `rgba(${colorToRgb(scaleColor(backgroundColors.primary, brightness))}, ${0.2 + brightness * 0.24})`,
      '--vinyl-bg-secondary': `rgba(${colorToRgb(scaleColor(backgroundColors.secondary, brightness))}, ${0.16 + brightness * 0.2})`,
      '--vinyl-bg-accent': `rgba(${colorToRgb(scaleColor(backgroundColors.accent, brightness))}, ${0.12 + brightness * 0.18})`,
      '--vinyl-bg-dim': `${Math.max(0.28, 0.76 - brightness * 0.26)}`,
    }
  }, [backgroundBrightness, backgroundColors])
  const flowColors = useMemo(() => {
    const brightness = THREE.MathUtils.clamp(backgroundBrightness, 0.35, 1.35)
    const normalize = (color, gain = 1) => color.map((value) => (
      THREE.MathUtils.clamp(value * brightness * gain / 255, 0, 1)
    ))
    return {
      base: normalize(backgroundColors.base, 0.72),
      primary: normalize(backgroundColors.primary, 1.16),
      secondary: normalize(backgroundColors.secondary, 1.22),
      accent: normalize(backgroundColors.accent, 1.08),
    }
  }, [backgroundBrightness, backgroundColors])
  const flowSettings = useMemo(() => ({
    baseFlowSpeed: quality === 'low' ? 0.012 : debugMode ? 0.036 : 0.022,
    baseWarpStrength: quality === 'low' ? 0.07 : debugMode ? 0.22 : 0.14,
    baseBreathAmount: quality === 'low' ? 0.018 : 0.045,
    baseDriftAmount: quality === 'low' ? 0.014 : debugMode ? 0.052 : 0.035,
    leftDarkness: 0.38,
    vignetteStrength: 0.32,
    debugFlowStrength,
    debugBurstStrength,
    showBaseFlow,
    showTransitionBurst,
    debugView,
    audioReactiveAmount: active && quality !== 'low' ? 0.24 : 0,
  }), [active, debugBurstStrength, debugFlowStrength, debugMode, debugView, quality, showBaseFlow, showTransitionBurst])
  const resolvedCoverUrl = coverUrl || FALLBACK_COVER
  const flowTrackKey = paletteSource === resolvedCoverUrl ? (trackKey || resolvedCoverUrl) : ''
  const recordDpr = quality === 'low'
    ? [0.45, 0.58]
    : quality === 'medium'
      ? [0.58, 0.72]
      : [0.85, 1.12]

  useEffect(() => {
    let cancelled = false
    const revealRecord = () => {
      if (!cancelled) setShowRecord(true)
    }
    const idleId = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(revealRecord, { timeout: 700 })
      : window.setTimeout(revealRecord, 360)

    return () => {
      cancelled = true
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
    }
  }, [])

  useEffect(() => {
    const app = document.querySelector('.app')
    app?.classList.toggle('flow-debug-isolated', isolateFlow)
    return () => app?.classList.remove('flow-debug-isolated')
  }, [isolateFlow])

  useEffect(() => {
    const toggleIsolation = () => {
      setIsolateFlow((current) => {
        const next = !current
        setShowFlowBackground(true)
        setShowRecord(!next)
        setDebugMode(next || debugMode)
        return next
      })
    }
    const handleDebugKeys = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!event.shiftKey && event.code === 'KeyF') setPauseFlow((value) => !value)
      else if (!event.shiftKey && event.code === 'KeyB') setForceTransitionSignal((value) => value + 1)
      else if (!event.shiftKey && event.code === 'Digit1') {
        setShowBaseFlow(true)
        setShowTransitionBurst(false)
        setDebugView(1)
      } else if (!event.shiftKey && event.code === 'Digit2') {
        setShowBaseFlow(false)
        setShowTransitionBurst(true)
        setDebugView(2)
      } else if (!event.shiftKey && event.code === 'Digit3') {
        setShowBaseFlow(true)
        setShowTransitionBurst(true)
        setDebugView(0)
      } else if (event.shiftKey && event.code === 'KeyF') setShowFlowBackground((value) => !value)
      else if (event.shiftKey && event.code === 'KeyR') setShowRecord((value) => !value)
      else if (event.shiftKey && event.code === 'KeyD') setDebugMode((value) => !value)
      else if (event.shiftKey && event.code === 'KeyP') setPauseFlow((value) => !value)
      else if (event.shiftKey && event.code === 'KeyI') toggleIsolation()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleDebugKeys)
    window.__flowDebug = {
      setShowFlowBackground,
      setShowRecord,
      setDebugFlowStrength,
      setDebugBurstStrength,
      setPauseFlow,
      setDebugMode,
      setShowBaseFlow,
      setShowTransitionBurst,
      forceTransition: () => setForceTransitionSignal((value) => value + 1),
      setIsolateFlow,
      toggleIsolation,
    }
    return () => {
      window.removeEventListener('keydown', handleDebugKeys)
      delete window.__flowDebug
    }
  }, [debugMode])

  useEffect(() => {
    opticalFieldController.acquire()
    return () => opticalFieldController.release()
  }, [])

  useEffect(() => {
    const pointer = pointerRef.current
    if (viewLocked) {
      const fixedView = { dragX: pointer.dragX, dragY: pointer.dragY, zoom: pointer.zoom }
      window.localStorage.setItem(FIXED_VIEW_STORAGE_KEY, JSON.stringify(fixedView))
      pointer.x = 0
      pointer.y = 0
      pointer.dragging = false
      pointer.active = false
      return undefined
    }

    const handlePointerMove = (event) => {
      if (!pointer.dragging) return
      event.preventDefault()
      const dx = event.clientX - pointer.lastClientX
      const dy = event.clientY - pointer.lastClientY
      pointer.dragX = THREE.MathUtils.clamp(pointer.dragX + dx * 0.0054, -2.7, 2.7)
      pointer.dragY = THREE.MathUtils.clamp(pointer.dragY + dy * 0.0048, -2.7, 2.7)
      pointer.lastClientX = event.clientX
      pointer.lastClientY = event.clientY
    }
    const handlePointerDown = (event) => {
      if (event.button !== 0 || event.target instanceof Element && event.target.closest('.local-library-drawer, .library-edge-trigger, button, input, textarea, select, [contenteditable="true"], a')) return
      event.preventDefault()
      pointer.dragging = true
      pointer.lastClientX = event.clientX
      pointer.lastClientY = event.clientY
    }
    const handlePointerUp = () => { pointer.dragging = false }
    const handleWheel = (event) => {
      if (event.target instanceof Element && event.target.closest('.local-library-drawer, .library-edge-trigger, button, input, textarea, select, [contenteditable="true"], a')) return
      pointer.zoom = THREE.MathUtils.clamp(pointer.zoom + event.deltaY * 0.0042, -4.4, 4.2)
      event.preventDefault()
    }
    const handlePointerLeave = () => {
      pointer.dragging = false
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerdown', handlePointerDown, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('pointerleave', handlePointerLeave)
    window.addEventListener('blur', handlePointerLeave)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('pointerleave', handlePointerLeave)
      window.removeEventListener('blur', handlePointerLeave)
    }
  }, [viewLocked])

  return (
    <div className="particle-vinyl-background" style={backgroundStyle}>
      {showFlowBackground && quality !== 'low' && (
        <div className="flow-field-layer" aria-hidden="true">
          <FlowFieldBackground
            colors={flowColors}
            trackKey={flowTrackKey}
            settings={flowSettings}
            paused={pauseFlow}
            forceTransitionSignal={forceTransitionSignal}
            quality={quality}
          />
        </div>
      )}
      {showRecord && (
        <div className="record-canvas-layer" aria-hidden="true">
          <Canvas
            camera={{ position: CAMERA_POSITION, fov: CAMERA_FOV }}
            dpr={recordDpr}
            gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.setClearColor(0x000000, 0)
              gl.outputColorSpace = THREE.SRGBColorSpace
              gl.toneMapping = THREE.ACESFilmicToneMapping
              gl.toneMappingExposure = 0.9
              window.requestAnimationFrame(() => window.requestAnimationFrame(() => onReady?.()))
            }}
          >
            <ParticleVinylScene
              active={active}
              coverUrl={coverUrl}
              getFrequencyData={getFrequencyData}
              pointerRef={pointerRef}
              mountainControls={mountainControls}
              topFogStrength={topFogStrength}
              topBlurStrength={topBlurStrength}
              voiceOrbVisible={voiceOrbVisible}
              voiceOrbLevel={voiceOrbLevel}
              portraitTransition={portraitTransition}
              quality={quality}
            />
          </Canvas>
        </div>
      )}
      {debugMode && (
        <aside className="flow-debug-panel" aria-label="流动光场调试面板">
          <strong>FLOW FIELD DEBUG</strong>
          <label><input type="checkbox" checked={showFlowBackground} onChange={(event) => setShowFlowBackground(event.target.checked)} /> showFlowBackground</label>
          <label><input type="checkbox" checked={showRecord} onChange={(event) => setShowRecord(event.target.checked)} /> showRecord</label>
          <label><input type="checkbox" checked={pauseFlow} onChange={(event) => setPauseFlow(event.target.checked)} /> pauseFlow</label>
          <label><input type="checkbox" checked={showBaseFlow} onChange={(event) => setShowBaseFlow(event.target.checked)} /> showBaseFlow</label>
          <label><input type="checkbox" checked={showTransitionBurst} onChange={(event) => setShowTransitionBurst(event.target.checked)} /> showTransitionBurst</label>
          <label>
            debugFlowStrength
            <input type="range" min="0" max="2" step="0.05" value={debugFlowStrength} onChange={(event) => setDebugFlowStrength(Number(event.target.value))} />
            <span>{debugFlowStrength.toFixed(2)}</span>
          </label>
          <label>
            debugBurstStrength
            <input type="range" min="0" max="2" step="0.05" value={debugBurstStrength} onChange={(event) => setDebugBurstStrength(Number(event.target.value))} />
            <span>{debugBurstStrength.toFixed(2)}</span>
          </label>
          <button type="button" onClick={() => setForceTransitionSignal((value) => value + 1)}>forceTransition</button>
          <button type="button" onClick={() => {
            const next = !isolateFlow
            setIsolateFlow(next)
            setShowFlowBackground(true)
            setShowRecord(!next)
          }}>{isolateFlow ? '恢复全部图层' : '仅看光场'}</button>
        </aside>
      )}
    </div>
  )
}
