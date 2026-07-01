import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { opticalFieldController } from '../services/OpticalFieldController'
import { lyricFlowController } from '../services/LyricFlowController'

const TRANSITION_DURATION = 2.35
const BURST_DIRECTIONS = [
  [0.65, -0.20],
  [0.58, 0.30],
  [-0.45, -0.16],
  [-0.38, 0.28],
]

const FLOW_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FLOW_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uCurrentColorA;
  uniform vec3 uCurrentColorB;
  uniform vec3 uCurrentColorC;
  uniform vec3 uNextColorA;
  uniform vec3 uNextColorB;
  uniform vec3 uNextColorC;
  uniform float uBaseFlowSpeed;
  uniform float uBaseWarpStrength;
  uniform float uBaseBreathAmount;
  uniform float uBaseDriftAmount;
  uniform float uStableFlowSeed;
  uniform float uLeftDarkness;
  uniform float uVignetteStrength;
  uniform float uTransitionProgress;
  uniform vec2 uBurstOrigin;
  uniform vec2 uBurstDirection;
  uniform float uBurstSeed;
  uniform float uBurstStrength;
  uniform float uAudioReactiveAmount;
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

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

  float simplexNoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
      + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 0.5 + 0.5 * (130.0 * dot(m, g));
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.54;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * simplexNoise(p);
      p = rotation * p * 2.03 + vec2(7.1, -3.8);
      amplitude *= 0.49;
    }
    return value;
  }

  float softBlob(vec2 point, vec2 center, vec2 scale, float distortion) {
    float distanceToBlob = length((point - center) / scale);
    return 1.0 - smoothstep(0.20 + distortion, 1.28 + distortion, distanceToBlob);
  }

  float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  vec4 buildFlowShape(vec2 point, float noiseA, float noiseB, float layerSpeed) {
    float flowClock = uTime * (uBaseFlowSpeed / 0.022) * layerSpeed;
    vec2 drift = vec2(
      sin(flowClock * 0.47 + noiseA * 2.7),
      cos(flowClock * 0.39 + noiseB * 2.3)
    ) * uBaseDriftAmount;
    vec2 fieldPoint = point + drift;
    vec2 blob1Pos = vec2(0.30 + sin(flowClock * 0.21) * 0.10, 0.28 + cos(flowClock * 0.17) * 0.08);
    vec2 blob2Pos = vec2(0.68 + cos(flowClock * 0.14 + 1.3) * 0.12, 0.45 + sin(flowClock * 0.19 + 0.7) * 0.10);
    vec2 blob3Pos = vec2(0.58 + sin(flowClock * 0.12 + 2.1) * 0.09, 0.82 + cos(flowClock * 0.16 + 0.4) * 0.07);
    vec2 blob4Pos = vec2(0.82 + cos(flowClock * 0.11 + 2.8) * 0.08, 0.20 + sin(flowClock * 0.15 + 1.7) * 0.08);
    float distortion = (noiseA - 0.5) * 0.20 + (noiseB - 0.5) * 0.12;
    float blob1 = softBlob(fieldPoint, blob1Pos, vec2(0.46, 0.38), distortion);
    float blob2 = softBlob(fieldPoint, blob2Pos, vec2(0.55, 0.43), -distortion * 0.7);
    float blob3 = softBlob(fieldPoint, blob3Pos, vec2(0.48, 0.39), (noiseB - 0.5) * 0.16);
    float blob4 = softBlob(fieldPoint, blob4Pos, vec2(0.42, 0.34), (noiseA - noiseB) * 0.10);
    return vec4(blob1, blob2, blob3, blob4);
  }

  vec3 colorizeFlow(vec4 shape, vec3 colorA, vec3 colorB, vec3 colorC, float noiseA, float noiseB, float layerSpeed) {
    float flowClock = uTime * (uBaseFlowSpeed / 0.022) * layerSpeed;
    float localBreath = 1.0 + sin(flowClock * 0.65 + noiseA * 4.0) * uBaseBreathAmount;
    vec3 darkBase = mix(colorA, colorB, 0.5) * 0.075;
    vec3 field = darkBase;
    field += colorA * shape.x * 0.72;
    field += colorB * shape.y * 0.68;
    field += colorC * shape.z * 0.58;
    field += mix(colorB, colorC, 0.42) * shape.w * 0.34;
    field += mix(colorA, colorC, noiseB) * pow(noiseA, 2.4) * 0.12;
    return field * localBreath;
  }

  float easeInOutCubic(float value) {
    return value < 0.5
      ? 4.0 * value * value * value
      : 1.0 - pow(-2.0 * value + 2.0, 3.0) * 0.5;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 aspectPoint = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;
    float flowClock = uTime * (uBaseFlowSpeed / 0.022);

    vec2 stableSeed = vec2(uStableFlowSeed, -uStableFlowSeed * 0.371);
    vec2 q = vec2(
      fbm(aspectPoint * 1.05 + vec2(flowClock * 0.018, -flowClock * 0.011) + stableSeed),
      fbm(aspectPoint * 1.05 + vec2(-flowClock * 0.013, flowClock * 0.016) - stableSeed * 0.73 + 5.4)
    );
    vec2 warpedPoint = aspectPoint + (q - 0.5) * uBaseWarpStrength;
    vec2 r = vec2(
      fbm(warpedPoint * 1.55 + q * 1.4 + vec2(flowClock * 0.009, -flowClock * 0.006)),
      fbm(warpedPoint * 1.35 - q * 1.2 + vec2(-flowClock * 0.007, flowClock * 0.010) + 9.2)
    );
    vec2 finalPoint = warpedPoint + (r - 0.5) * uBaseWarpStrength * 0.55;
    float noiseA = fbm(finalPoint * 1.16 + r * 0.36 + stableSeed * 0.31);
    float noiseB = fbm(finalPoint.yx * vec2(-1.06, 0.94) + q * 0.28 - stableSeed * 0.19 + 12.7);

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
    float preGather = lyricNear * (1.0 - smoothstep(0.0, 0.20, uLyricReveal));
    vec2 flowDisplacement = lyricDirection * frontCompression * 0.052;
    flowDisplacement += lyricSide * sign(lyricSideDistance) * sideFlow * 0.044;
    flowDisplacement -= lyricDirection * wake * 0.026;
    flowDisplacement -= normalize(lyricDelta + vec2(0.0001)) * preGather * 0.014;
    flowDisplacement *= thrustEnvelope;
    vec2 lyricFlowPoint = finalPoint - flowDisplacement * vec2(aspect, 1.0);

    vec4 farShape = buildFlowShape(finalPoint + (q - 0.5) * 0.035, noiseB, noiseA, 0.42);
    vec4 flowShape = buildFlowShape(lyricFlowPoint, noiseA, noiseB, 1.0);
    vec3 farOldField = colorizeFlow(farShape, uCurrentColorA, uCurrentColorB, uCurrentColorC, noiseB, noiseA, 0.42);
    vec3 farNewField = colorizeFlow(farShape, uNextColorA, uNextColorB, uNextColorC, noiseB, noiseA, 0.42);
    vec3 oldField = colorizeFlow(flowShape, uCurrentColorA, uCurrentColorB, uCurrentColorC, noiseA, noiseB, 1.0);
    vec3 newField = colorizeFlow(flowShape, uNextColorA, uNextColorB, uNextColorC, noiseA, noiseB, 1.0);

    float p = clamp(uTransitionProgress, 0.0, 1.0);
    float launchEase = 1.0 - pow(1.0 - p, 3.0);
    vec2 direction = normalize(uBurstDirection + vec2(0.0001));
    vec2 side = vec2(-direction.y, direction.x);
    vec2 movingCenter = uBurstOrigin + uBurstDirection * launchEase * 0.42;
    vec2 delta = uv - movingCenter;
    float forwardDistance = dot(delta, direction);
    float sideDistance = dot(delta, side);
    float lengthRadius = mix(0.08, 0.78, launchEase);
    float sideRadius = mix(0.05, 0.52, smoothstep(0.05, 0.85, p));
    float ellipseDistance = length(vec2(
      forwardDistance / max(lengthRadius, 0.001),
      sideDistance / max(sideRadius, 0.001)
    ));
    float burstNoise = fbm(
      uv * 3.0 + vec2(uBurstSeed, -uBurstSeed * 0.37) + uTime * vec2(0.06, -0.045)
    );
    float edgeWarp = (burstNoise - 0.5) * 0.34;
    float burstMask = 1.0 - smoothstep(0.72 + edgeWarp, 1.05 + edgeWarp, ellipseDistance);
    float internalDensity = smoothstep(
      0.18,
      0.85,
      fbm(uv * 2.2 + vec2(burstNoise) + uTime * 0.025)
    );
    burstMask *= mix(0.68, 1.0, internalDensity);
    float launch = smoothstep(0.0, 0.22, p);
    float expand = smoothstep(0.10, 0.72, p);
    float settle = smoothstep(0.68, 1.0, p);
    burstMask *= launch * mix(0.72, 1.0, expand) * uBurstStrength;
    float paletteMix = easeInOutCubic(p);
    float localBurstMix = clamp(burstMask * 0.92, 0.0, 1.0) * uShowTransitionBurst;
    float localTakeover = max(paletteMix, localBurstMix * (1.0 - settle * 0.35));

    vec3 farField = mix(farOldField, farNewField, localTakeover);
    vec3 middleField = mix(oldField, newField, localTakeover);
    vec3 flowColor = farField * 0.28 + middleField * 0.86;
    flowColor += mix(uCurrentColorB, uNextColorB, paletteMix)
      * frontCompression * thrustEnvelope * 0.08;
    flowColor *= 1.0 - wake * thrustEnvelope * 0.12;
    float burstGlowEnvelope = smoothstep(0.0, 0.10, p) * (1.0 - smoothstep(0.42, 0.82, p));
    float burstGlow = burstMask * burstGlowEnvelope * uDebugBurstStrength;
    vec3 burstGlowColor = mix(uNextColorA, uNextColorB, 0.45);
    flowColor += burstGlowColor * burstGlow * 0.30;
    flowColor *= uShowBaseFlow;

    float audioLift = 1.0 + uAudioReactiveAmount * (0.035 + noiseA * 0.055);
    flowColor *= audioLift * uDebugFlowStrength;
    float leftMask = 1.0 - smoothstep(0.08, 0.54, uv.x);
    float lyricDarkening = leftMask * uLeftDarkness;
    flowColor *= 1.0 - lyricDarkening;
    float vignette = smoothstep(0.96, 0.28, length((uv - 0.5) * vec2(0.82, 1.0)));
    flowColor *= mix(1.0 - uVignetteStrength, 1.0, vignette);
    flowColor = max(flowColor, vec3(0.003, 0.003, 0.008));

    if (uDebugView > 1.5) flowColor = vec3(burstMask);
    else if (uDebugView > 0.5) flowColor = farField * 0.28 + mix(oldField, newField, paletteMix) * 0.86;

    gl_FragColor = vec4(flowColor, 1.0);
  }
`

function writePalette(target, colors) {
  const sources = [colors.primary, colors.secondary, colors.accent]
  for (let colorIndex = 0; colorIndex < 3; colorIndex += 1) {
    const source = sources[colorIndex]
    const offset = colorIndex * 3
    target[offset] = source[0]
    target[offset + 1] = source[1]
    target[offset + 2] = source[2]
  }
}

function copyPalette(target, source) {
  for (let index = 0; index < 9; index += 1) target[index] = source[index]
}

function mixPalette(target, from, to, progress) {
  for (let index = 0; index < 9; index += 1) {
    target[index] = THREE.MathUtils.lerp(from[index], to[index], progress)
  }
}

function easeInOutCubic(progress) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) * 0.5
}

function setPaletteUniforms(uniforms, prefix, palette) {
  uniforms[`${prefix}ColorA`].value.setRGB(palette[0], palette[1], palette[2])
  uniforms[`${prefix}ColorB`].value.setRGB(palette[3], palette[4], palette[5])
  uniforms[`${prefix}ColorC`].value.setRGB(palette[6], palette[7], palette[8])
}

function FlowFieldQuad({ colors, trackKey, settings, paused, forceTransitionSignal }) {
  const materialRef = useRef(null)
  const flowTimeRef = useRef(0)
  const previousTrackKeyRef = useRef(null)
  const initializedRef = useRef(false)
  const { gl } = useThree()
  const transitionRef = useRef({
      state: 'idle',
      startTime: 0,
      duration: TRANSITION_DURATION,
      progress: 0,
      currentPalette: new Float32Array(9),
      fromPalette: new Float32Array(9),
      nextPalette: new Float32Array(9),
      visiblePalette: new Float32Array(9),
      incomingPalette: new Float32Array(9),
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
      uCurrentColorA: { value: new THREE.Color() },
      uCurrentColorB: { value: new THREE.Color() },
      uCurrentColorC: { value: new THREE.Color() },
      uNextColorA: { value: new THREE.Color() },
      uNextColorB: { value: new THREE.Color() },
      uNextColorC: { value: new THREE.Color() },
      uBaseFlowSpeed: { value: 0.022 },
      uBaseWarpStrength: { value: 0.14 },
      uBaseBreathAmount: { value: 0.045 },
      uBaseDriftAmount: { value: 0.035 },
      uStableFlowSeed: { value: 17.23 },
      uLeftDarkness: { value: 0.38 },
      uVignetteStrength: { value: 0.32 },
      uTransitionProgress: { value: 0 },
      uBurstOrigin: { value: new THREE.Vector2(0.62, 0.48) },
      uBurstDirection: { value: new THREE.Vector2(0.65, -0.20) },
      uBurstSeed: { value: 0 },
      uBurstStrength: { value: 0 },
      uAudioReactiveAmount: { value: 0 },
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
      const visibleProgress = easeInOutCubic(transition.progress)
      mixPalette(
        transition.visiblePalette,
        transition.fromPalette,
        transition.nextPalette,
        visibleProgress,
      )
      copyPalette(transition.currentPalette, transition.visiblePalette)
    }
    copyPalette(transition.fromPalette, transition.currentPalette)
    writePalette(transition.incomingPalette, nextColors)
    if (forceRandomPalette) {
      const hueShift = 0.72 + Math.random() * 0.55
      for (let index = 0; index < 9; index += 1) {
        transition.incomingPalette[index] = THREE.MathUtils.clamp(
          transition.incomingPalette[index] * hueShift + Math.random() * 0.12,
          0.03,
          1,
        )
      }
    }
    copyPalette(transition.nextPalette, transition.incomingPalette)
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
    if (!initializedRef.current) {
      writePalette(transition.currentPalette, colors)
      writePalette(transition.fromPalette, colors)
      writePalette(transition.nextPalette, colors)
      initializedRef.current = true
      previousTrackKeyRef.current = trackKey
      return
    }
    if (previousTrackKeyRef.current !== trackKey) {
      beginSongTransition(colors)
      previousTrackKeyRef.current = trackKey
    }
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
    shader.uniforms.uTime.value = flowTimeRef.current
    gl.getDrawingBufferSize(shader.uniforms.uResolution.value)

    if (transition.state !== 'idle') {
      transition.progress = THREE.MathUtils.clamp(
        (flowTimeRef.current - transition.startTime) / transition.duration,
        0,
        1,
      )
      if (transition.progress >= 0.68) transition.state = 'settle'
      if (transition.progress >= 1) {
        copyPalette(transition.currentPalette, transition.nextPalette)
        copyPalette(transition.fromPalette, transition.nextPalette)
        copyPalette(transition.nextPalette, transition.currentPalette)
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
    shader.uniforms.uBaseFlowSpeed.value = settings.baseFlowSpeed
    shader.uniforms.uBaseWarpStrength.value = settings.baseWarpStrength
    shader.uniforms.uBaseBreathAmount.value = settings.baseBreathAmount
    shader.uniforms.uBaseDriftAmount.value = settings.baseDriftAmount
    shader.uniforms.uLeftDarkness.value = settings.leftDarkness
    shader.uniforms.uVignetteStrength.value = settings.vignetteStrength
    shader.uniforms.uDebugFlowStrength.value = settings.debugFlowStrength
    shader.uniforms.uDebugBurstStrength.value = settings.debugBurstStrength
    shader.uniforms.uShowBaseFlow.value = settings.showBaseFlow ? 1 : 0
    shader.uniforms.uShowTransitionBurst.value = settings.showTransitionBurst ? 1 : 0
    shader.uniforms.uDebugView.value = settings.debugView
    shader.uniforms.uAudioReactiveAmount.value = settings.audioReactiveAmount
      * opticalFieldController.opticalField.intensity
    shader.uniforms.uLyricCenter.value.fromArray(lyricFlowController.center)
    shader.uniforms.uLyricSize.value.fromArray(lyricFlowController.size)
    shader.uniforms.uLyricVelocity.value.fromArray(lyricFlowController.velocity)
    shader.uniforms.uLyricForce.value = lyricFlowController.force
    shader.uniforms.uLyricReveal.value = lyricFlowController.reveal
    shader.uniforms.uLyricSettle.value = lyricFlowController.settle
    if (transition.state === 'idle') {
      lyricFlowController.setPalette(transition.currentPalette)
    } else {
      mixPalette(
        transition.visiblePalette,
        transition.fromPalette,
        transition.nextPalette,
        easeInOutCubic(transition.progress),
      )
      lyricFlowController.setPalette(transition.visiblePalette)
    }
  })

  return (
    <mesh frustumCulled={false}>
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
}) {
  return (
    <Canvas
      className="flow-field-canvas"
      orthographic
      camera={{ position: [0, 0, 1], near: 0, far: 2 }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
    >
      <FlowFieldQuad
        colors={colors}
        trackKey={trackKey}
        settings={settings}
        paused={paused}
        forceTransitionSignal={forceTransitionSignal}
      />
    </Canvas>
  )
}
