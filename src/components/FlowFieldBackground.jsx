import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { opticalFieldController } from '../services/OpticalFieldController'
import { lyricFlowController } from '../services/LyricFlowController'
import { nextMetalBeatPulse } from './metalBeatPulse'
import {
  LIQUID_METAL_PALETTE_SIZE,
  copyLiquidMetalPalette,
  easeLiquidMetalPalette,
  mixLiquidMetalPalette,
  publishLiquidMetalPalette,
  writeLiquidMetalPalette,
} from './liquidMetalTransition'

const TRANSITION_DURATION = 2.35
const BURST_DIRECTIONS = [[0.65, -0.20], [0.58, 0.30], [-0.45, -0.16], [-0.38, 0.28]]

const FLOW_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Direct Three.js adaptation of liquid-ore/src/liquidField.js. Its hash,
// five-octave FBM, two-stage IQ domain warp, metal lighting and four-stop ramp
// stay intact. A second palette and cubic crossfade are the app integration.
const FLOW_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uScale;
  uniform float uWarp;
  uniform float uDetail;
  uniform float uMetal;
  uniform float uGrain;
  uniform float uContrast;
  uniform float uBias;
  uniform float uRampShift;
  uniform float uPaletteFidelity;
  uniform float uColorSaturation;
  uniform float uColorExposure;
  uniform float uHueShift;
  uniform vec3 uTintColor;
  uniform float uTintStrength;
  uniform vec3 uCurrentC0;
  uniform vec3 uCurrentC1;
  uniform vec3 uCurrentC2;
  uniform vec3 uCurrentC3;
  uniform vec3 uNextC0;
  uniform vec3 uNextC1;
  uniform vec3 uNextC2;
  uniform vec3 uNextC3;
  uniform float uLeftDarkness;
  uniform float uVignetteStrength;
  uniform float uTransitionProgress;
  uniform vec2 uBurstOrigin;
  uniform vec2 uBurstDirection;
  uniform float uBurstSeed;
  uniform float uBurstStrength;
  uniform float uAudioReactiveAmount;
  uniform float uBeatPulse;
  uniform float uDebugFlowStrength;
  uniform float uDebugBurstStrength;
  uniform float uShowBaseFlow;
  uniform float uShowTransitionBurst;
  uniform float uDebugView;
  uniform vec2 uLyricCenter;
  uniform vec2 uLyricSize;
  uniform vec2 uLyricVelocity;
  uniform float uLyricForce;
  uniform float uLyricReveal;
  uniform float uLyricSettle;

  const vec3 CREAM = vec3(1.0, 0.92, 0.82);

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbmLiquid(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    float gain = mix(0.35, 0.62, uDetail);
    for (int i = 0; i < 5; i++) {
      sum += amp * vnoise(p);
      norm += amp;
      amp *= gain;
      p = p * 2.03 + vec2(11.7, 5.3);
    }
    return sum / max(norm, 1e-4);
  }

  float liquidField(vec2 p, float t, out vec2 flow) {
    vec2 q = vec2(
      fbmLiquid(p + t * 0.055),
      fbmLiquid(p + vec2(5.2, 1.3) - t * 0.048)
    );
    vec2 r = vec2(
      fbmLiquid(p + uWarp * q + vec2(1.7, 9.2) + t * 0.04),
      fbmLiquid(p + uWarp * q + vec2(8.3, 2.8) - t * 0.045)
    );
    flow = r;
    return fbmLiquid(p + uWarp * r);
  }

  vec3 liquidRamp(float x, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    x = clamp(x, 0.0, 1.0);
    float k = uRampShift;
    vec3 c = mix(c0, c1, smoothstep(0.00 - k, 0.42 - k, x));
    c = mix(c, c2, smoothstep(0.30 - k, 0.74 - k, x));
    c = mix(c, c3, smoothstep(0.56 - k, 1.00 - k, x));
    return c;
  }

  vec3 rotateHue(vec3 color, float angle) {
    vec3 axis = normalize(vec3(1.0));
    float cosine = cos(angle);
    return color * cosine
      + cross(axis, color) * sin(angle)
      + axis * dot(axis, color) * (1.0 - cosine);
  }

  float easeInOutCubic(float value) {
    return value < 0.5
      ? 4.0 * value * value * value
      : 1.0 - pow(-2.0 * value + 2.0, 3.0) * 0.5;
  }

  float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    vec2 uv = vUv;
    vec2 fragCoord = gl_FragCoord.xy;

    // Keep the established lyric wake inside the same liquid field.
    vec2 lyricDelta = uv - uLyricCenter;
    vec2 lyricHalfSize = max(uLyricSize * 0.5, vec2(0.035, 0.022));
    float lyricDistance = roundedRectSdf(lyricDelta, lyricHalfSize, min(lyricHalfSize.y, 0.035));
    float lyricNear = 1.0 - smoothstep(0.0, 0.18, lyricDistance);
    float lyricSpeed = length(uLyricVelocity);
    vec2 lyricDirection = lyricSpeed > 0.025 ? normalize(uLyricVelocity) : vec2(1.0, 0.0);
    vec2 lyricSide = vec2(-lyricDirection.y, lyricDirection.x);
    float lyricForward = dot(lyricDelta, lyricDirection);
    float lyricSideDistance = dot(lyricDelta, lyricSide);
    float thrustEnvelope = uLyricForce * (0.32 + uLyricReveal * 0.68) * (1.0 - uLyricSettle * 0.72);
    float frontCompression = lyricNear * smoothstep(-0.025, 0.12, lyricForward);
    float sideFlow = lyricNear * smoothstep(0.012, 0.13, abs(lyricSideDistance));
    float wake = lyricNear * (1.0 - smoothstep(-0.20, -0.015, lyricForward));
    vec2 lyricDisplacement = lyricDirection * frontCompression * 0.052;
    lyricDisplacement += lyricSide * sign(lyricSideDistance) * sideFlow * 0.044;
    lyricDisplacement -= lyricDirection * wake * 0.026;
    fragCoord -= lyricDisplacement * thrustEnvelope * uResolution.y;

    vec2 p = (fragCoord - 0.5 * uResolution) / uResolution.y;
    p *= vec2(1.0, 0.86);
    p *= uScale;
    p += vec2(0.0, uTime * 0.02);

    vec2 flow;
    float h = liquidField(p, uTime, flow);
    float g = clamp((h - 0.5) * uContrast + 0.5 + uBias, 0.0, 1.0);
    float paletteMix = easeInOutCubic(clamp(uTransitionProgress, 0.0, 1.0));
    vec3 c0 = mix(uCurrentC0, uNextC0, paletteMix);
    vec3 c1 = mix(uCurrentC1, uNextC1, paletteMix);
    vec3 c2 = mix(uCurrentC2, uNextC2, paletteMix);
    vec3 c3 = mix(uCurrentC3, uNextC3, paletteMix);

    vec3 n = normalize(vec3(flow * 1.25 - 0.5, 1.0));
    vec3 lightDir = normalize(vec3(0.45, 0.62, 0.64));
    float diff = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 26.0);
    float lit = smoothstep(0.42, 0.88, g);
    vec3 paletteColor = liquidRamp(g, c0, c1, c2, c3);
    vec3 metalCol = CREAM * (0.20 + 0.80 * lit);
    vec3 metalColor = mix(
      paletteColor,
      paletteColor * (0.78 + 0.42 * diff) + metalCol * spec * 0.45,
      uMetal
    );
    vec3 faithfulColor = paletteColor * (0.90 + 0.20 * diff);
    vec3 flowColor = mix(metalColor, faithfulColor, uPaletteFidelity);
    // Only the already bright metal ridges flare on bass transients.
    flowColor += (paletteColor * 0.42 + CREAM * 0.58)
      * pow(lit, 2.5) * (0.25 + spec * 0.75) * uBeatPulse * 0.8;

    // Restrained glint: song changes remain visible without resetting the field.
    vec2 direction = normalize(uBurstDirection + vec2(0.0001));
    float changeEnvelope = sin(paletteMix * 3.14159265);
    float sweepPosition = dot(uv - uBurstOrigin, direction) - (paletteMix - 0.5) * 1.35;
    float sweepNoise = (fbmLiquid(uv * 2.4 + uBurstSeed * 0.01) - 0.5) * 0.16;
    float transitionGlint = exp(-pow((sweepPosition + sweepNoise) * 8.0, 2.0))
      * changeEnvelope * uBurstStrength * uShowTransitionBurst;
    flowColor += mix(c2, c3, 0.52) * transitionGlint * 0.14 * uDebugBurstStrength;

    flowColor = max(rotateHue(flowColor, radians(uHueShift)), vec3(0.0));
    float colorLuma = dot(flowColor, vec3(0.2126, 0.7152, 0.0722));
    flowColor = mix(vec3(colorLuma), flowColor, uColorSaturation) * uColorExposure;
    vec3 tintedColor = flowColor * (0.30 + uTintColor * 1.40);
    flowColor = mix(flowColor, tintedColor, uTintStrength);

    float sourceVignette = smoothstep(1.30, 0.30, length(p / max(uScale, 0.4) * 0.60));
    flowColor *= mix(0.74, 1.0, sourceVignette);
    flowColor += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * uGrain;
    flowColor *= 1.0 + uAudioReactiveAmount * (0.025 + h * 0.065);
    float leftMask = 1.0 - smoothstep(0.08, 0.54, uv.x);
    flowColor *= 1.0 - leftMask * uLeftDarkness;
    float appVignette = smoothstep(0.96, 0.28, length((uv - 0.5) * vec2(0.82, 1.0)));
    flowColor *= mix(1.0 - uVignetteStrength, 1.0, appVignette);
    flowColor = max(flowColor * uDebugFlowStrength, vec3(0.003, 0.003, 0.008));
    if (uDebugView > 1.5) flowColor = vec3(transitionGlint);
    else if (uDebugView > 0.5) flowColor = liquidRamp(g, c0, c1, c2, c3);
    flowColor *= uShowBaseFlow;
    gl_FragColor = vec4(flowColor, 1.0);
  }
`

function setPaletteUniforms(uniforms, prefix, palette) {
  for (let colorIndex = 0; colorIndex < 4; colorIndex += 1) {
    const offset = colorIndex * 3
    uniforms[`${prefix}C${colorIndex}`].value.setRGB(
      palette[offset], palette[offset + 1], palette[offset + 2],
    )
  }
}

function publishLyricPalette(transition) {
  const source = transition.state === 'idle'
    ? transition.currentPalette
    : mixLiquidMetalPalette(
      transition.visiblePalette,
      transition.fromPalette,
      transition.nextPalette,
      easeLiquidMetalPalette(transition.progress),
    )
  const target = transition.lyricPalette
  // LyricFlowController retains its primary/secondary/accent order.
  target.set(source.subarray(6, 9), 0)
  target.set(source.subarray(3, 6), 3)
  target.set(source.subarray(9, 12), 6)
  lyricFlowController.setPalette(target)
  publishLiquidMetalPalette(source)
}

export function LiquidMetalFieldQuad({ colors, trackKey, settings, paused, forceTransitionSignal, active, getFrequencyData }) {
  const materialRef = useRef(null)
  const beatRef = useRef({ baseline: 0, pulse: 0 })
  const flowTimeRef = useRef(0)
  const previousTrackKeyRef = useRef(null)
  const previousPaletteSignatureRef = useRef('')
  const initializedRef = useRef(false)
  const { gl } = useThree()
  const transitionRef = useRef({
    state: 'idle',
    startTime: 0,
    duration: TRANSITION_DURATION,
    progress: 0,
    currentPalette: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
    fromPalette: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
    nextPalette: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
    visiblePalette: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
    incomingPalette: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
    lyricPalette: new Float32Array(9),
    burstOrigin: new THREE.Vector2(0.62, 0.48),
    burstDirection: new THREE.Vector2(0.65, -0.20),
    burstSeed: 0,
    burstStrength: 0,
    directionIndex: 0,
  })
  const material = useMemo(() => new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uScale: { value: 1.2 },
      uWarp: { value: 1.8 },
      uDetail: { value: 0.24 },
      uMetal: { value: 0.3 },
      uGrain: { value: 0.02 },
      uContrast: { value: 2.4 },
      // Music palettes need the mid-tone anchor to remain dominant. The
      // source demo's warm-only 0.24 bias over-selected the brightest cover
      // color and made the background diverge from the record surface.
      uBias: { value: 0.08 },
      uRampShift: { value: 0.28 },
      uPaletteFidelity: { value: 0.72 },
      uColorSaturation: { value: 1 },
      uColorExposure: { value: 1 },
      uHueShift: { value: 0 },
      uTintColor: { value: new THREE.Color('#ffffff') },
      uTintStrength: { value: 0 },
      uCurrentC0: { value: new THREE.Color() },
      uCurrentC1: { value: new THREE.Color() },
      uCurrentC2: { value: new THREE.Color() },
      uCurrentC3: { value: new THREE.Color() },
      uNextC0: { value: new THREE.Color() },
      uNextC1: { value: new THREE.Color() },
      uNextC2: { value: new THREE.Color() },
      uNextC3: { value: new THREE.Color() },
      uLeftDarkness: { value: 0.38 },
      uVignetteStrength: { value: 0.32 },
      uTransitionProgress: { value: 0 },
      uBurstOrigin: { value: new THREE.Vector2(0.62, 0.48) },
      uBurstDirection: { value: new THREE.Vector2(0.65, -0.20) },
      uBurstSeed: { value: 0 },
      uBurstStrength: { value: 0 },
      uAudioReactiveAmount: { value: 0 },
      uBeatPulse: { value: 0 },
      uDebugFlowStrength: { value: 1 },
      uDebugBurstStrength: { value: 1 },
      uShowBaseFlow: { value: 1 },
      uShowTransitionBurst: { value: 1 },
      uDebugView: { value: 0 },
      uLyricCenter: { value: new THREE.Vector2(0.34, 0.54) },
      uLyricSize: { value: new THREE.Vector2(0.28, 0.08) },
      uLyricVelocity: { value: new THREE.Vector2(0.34, 0) },
      uLyricForce: { value: 0 },
      uLyricReveal: { value: 1 },
      uLyricSettle: { value: 1 },
    },
    vertexShader: FLOW_VERTEX_SHADER,
    fragmentShader: FLOW_FRAGMENT_SHADER,
  }), [])

  const beginSongTransition = useCallback((nextColors, forceRandomPalette = false) => {
    const transition = transitionRef.current
    if (transition.state !== 'idle') {
      mixLiquidMetalPalette(
        transition.visiblePalette,
        transition.fromPalette,
        transition.nextPalette,
        easeLiquidMetalPalette(transition.progress),
      )
      copyLiquidMetalPalette(transition.currentPalette, transition.visiblePalette)
    }
    copyLiquidMetalPalette(transition.fromPalette, transition.currentPalette)
    writeLiquidMetalPalette(transition.incomingPalette, nextColors)
    if (forceRandomPalette) {
      const gain = 0.72 + Math.random() * 0.55
      for (let index = 0; index < LIQUID_METAL_PALETTE_SIZE; index += 1) {
        transition.incomingPalette[index] = THREE.MathUtils.clamp(
          transition.incomingPalette[index] * gain + Math.random() * 0.12, 0.03, 1,
        )
      }
    }
    copyLiquidMetalPalette(transition.nextPalette, transition.incomingPalette)
    transition.state = 'transition'
    transition.startTime = flowTimeRef.current
    transition.progress = 0
    transition.burstOrigin.set(0.54 + Math.random() * 0.16, 0.34 + Math.random() * 0.30)
    const direction = BURST_DIRECTIONS[transition.directionIndex % BURST_DIRECTIONS.length]
    transition.directionIndex += 1
    transition.burstDirection.set(direction[0], direction[1])
    transition.burstSeed = Math.random() * 1000
    transition.burstStrength = 1
  }, [])

  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    if (!trackKey) return
    const transition = transitionRef.current
    const paletteSignature = [colors.base, colors.secondary, colors.primary, colors.accent]
      .flat().map((value) => Number(value).toFixed(4)).join(',')
    if (!initializedRef.current) {
      writeLiquidMetalPalette(transition.currentPalette, colors)
      writeLiquidMetalPalette(transition.fromPalette, colors)
      writeLiquidMetalPalette(transition.nextPalette, colors)
      initializedRef.current = true
    } else if (
      previousTrackKeyRef.current !== trackKey
      || previousPaletteSignatureRef.current !== paletteSignature
    ) {
      beginSongTransition(colors)
    }
    previousTrackKeyRef.current = trackKey
    previousPaletteSignatureRef.current = paletteSignature
  }, [beginSongTransition, colors, trackKey])

  useEffect(() => {
    if (forceTransitionSignal <= 0 || !initializedRef.current) return
    beginSongTransition(colors, true)
  }, [beginSongTransition, colors, forceTransitionSignal])

  useFrame((_, delta) => {
    const shader = materialRef.current
    if (!shader || !initializedRef.current) return
    const transition = transitionRef.current
    if (!paused) flowTimeRef.current += delta
    shader.uniforms.uTime.value = flowTimeRef.current * (settings.baseFlowSpeed / 0.022)
    gl.getDrawingBufferSize(shader.uniforms.uResolution.value)
    transition.duration = settings.transitionDuration || TRANSITION_DURATION

    if (transition.state !== 'idle') {
      transition.progress = THREE.MathUtils.clamp(
        (flowTimeRef.current - transition.startTime) / transition.duration, 0, 1,
      )
      if (transition.progress >= 0.68) transition.state = 'settle'
      if (transition.progress >= 1) {
        copyLiquidMetalPalette(transition.currentPalette, transition.nextPalette)
        copyLiquidMetalPalette(transition.fromPalette, transition.nextPalette)
        copyLiquidMetalPalette(transition.nextPalette, transition.currentPalette)
        transition.state = 'idle'
        transition.progress = 0
        transition.burstStrength = 0
      }
    }

    setPaletteUniforms(shader.uniforms, 'uCurrent', transition.currentPalette)
    setPaletteUniforms(shader.uniforms, 'uNext', transition.nextPalette)
    shader.uniforms.uTransitionProgress.value = transition.progress
    shader.uniforms.uBurstOrigin.value.copy(transition.burstOrigin)
    shader.uniforms.uBurstDirection.value.copy(transition.burstDirection)
    shader.uniforms.uBurstSeed.value = transition.burstSeed
    shader.uniforms.uBurstStrength.value = transition.burstStrength
    shader.uniforms.uWarp.value = 1.8 * THREE.MathUtils.clamp(settings.baseWarpStrength / 0.14, 0.5, 1.8)
    shader.uniforms.uScale.value = settings.scale + Math.sin(flowTimeRef.current * 0.28) * settings.baseBreathAmount
    shader.uniforms.uDetail.value = settings.detail
    shader.uniforms.uMetal.value = settings.metal
    shader.uniforms.uGrain.value = settings.grain
    shader.uniforms.uContrast.value = settings.contrast
    shader.uniforms.uBias.value = settings.bias
    shader.uniforms.uRampShift.value = settings.rampShift
    shader.uniforms.uPaletteFidelity.value = settings.paletteFidelity
    shader.uniforms.uColorSaturation.value = settings.colorSaturation
    shader.uniforms.uColorExposure.value = settings.colorExposure
    shader.uniforms.uHueShift.value = settings.hueShift
    shader.uniforms.uTintColor.value.set(settings.tintColor)
    shader.uniforms.uTintStrength.value = settings.tintStrength
    shader.uniforms.uLeftDarkness.value = settings.leftDarkness
    shader.uniforms.uVignetteStrength.value = settings.vignetteStrength
    shader.uniforms.uDebugFlowStrength.value = settings.debugFlowStrength * settings.flowStrength
    shader.uniforms.uDebugBurstStrength.value = settings.debugBurstStrength * settings.transitionGlint
    shader.uniforms.uShowBaseFlow.value = settings.showBaseFlow ? 1 : 0
    shader.uniforms.uShowTransitionBurst.value = settings.showTransitionBurst ? 1 : 0
    shader.uniforms.uDebugView.value = settings.debugView
    shader.uniforms.uAudioReactiveAmount.value = settings.audioReactiveAmount
      * opticalFieldController.opticalField.intensity
    beatRef.current = nextMetalBeatPulse(
      beatRef.current,
      active && !paused ? getFrequencyData?.() : null,
      Math.min(delta, 0.1),
    )
    shader.uniforms.uBeatPulse.value = beatRef.current.pulse * settings.audioReactiveAmount
    shader.uniforms.uLyricCenter.value.fromArray(lyricFlowController.center)
    shader.uniforms.uLyricSize.value.fromArray(lyricFlowController.size)
    shader.uniforms.uLyricVelocity.value.fromArray(lyricFlowController.velocity)
    shader.uniforms.uLyricForce.value = lyricFlowController.force
    shader.uniforms.uLyricReveal.value = lyricFlowController.reveal
    shader.uniforms.uLyricSettle.value = lyricFlowController.settle
    publishLyricPalette(transition)
  })

  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
      <primitive ref={materialRef} object={material} attach="material" />
    </mesh>
  )
}

export default function FlowFieldBackground({
  colors,
  trackKey,
  settings,
  paused = false,
  forceTransitionSignal = 0,
  quality = 'high',
  active = false,
  getFrequencyData,
}) {
  const dpr = quality === 'low'
    ? [0.45, 0.6]
    : quality === 'medium'
      ? [0.6, 0.8]
      : [1, 1.5]

  return (
    <Canvas
      className="flow-field-canvas"
      orthographic
      camera={{ position: [0, 0, 1], near: 0, far: 2 }}
      dpr={dpr}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
    >
      <LiquidMetalFieldQuad
        colors={colors}
        trackKey={trackKey}
        settings={settings}
        paused={paused}
        forceTransitionSignal={forceTransitionSignal}
        active={active}
        getFrequencyData={getFrequencyData}
      />
    </Canvas>
  )
}
