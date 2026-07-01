import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { lyricFlowController } from '../services/LyricFlowController'

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uLyricCenter;
  uniform vec2 uLyricSize;
  uniform vec2 uLyricVelocity;
  uniform float uLyricForce;
  uniform float uLyricReveal;
  uniform float uLyricSettle;
  uniform float uLyricVisibility;
  uniform vec3 uFogColorA;
  uniform vec3 uFogColorB;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.56;
    for (int octave = 0; octave < 4; octave++) {
      value += noise(p) * amplitude;
      p = mat2(0.82, -0.57, 0.57, 0.82) * p * 2.02 + 4.7;
      amplitude *= 0.48;
    }
    return value;
  }

  float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    vec2 local = vUv - uLyricCenter;
    vec2 halfSize = max(uLyricSize * 0.5, vec2(0.035, 0.022));
    float sdf = roundedRectSdf(local, halfSize, min(halfSize.y, 0.035));
    float speed = length(uLyricVelocity);
    vec2 direction = speed > 0.025 ? normalize(uLyricVelocity) : vec2(1.0, 0.0);
    vec2 side = vec2(-direction.y, direction.x);
    float forwardDistance = dot(local, direction);
    float sideDistance = dot(local, side);
    vec2 flowUv = vec2(forwardDistance, sideDistance);
    float fogNoise = fbm(flowUv * vec2(7.0, 12.0) + vec2(-uTime * 0.055, uTime * 0.024));
    float nearText = 1.0 - smoothstep(0.015, 0.115, sdf);
    float surfaceBand = 1.0 - smoothstep(0.0, 0.055, abs(sdf + 0.012));
    float frontCompression = nearText * smoothstep(-0.02, 0.12, forwardDistance);
    float sideSlip = nearText * smoothstep(0.018, 0.15, abs(sideDistance));
    float trailingMist = nearText * (1.0 - smoothstep(-0.18, -0.015, forwardDistance));
    float movingWisp = smoothstep(0.52, 0.86, fogNoise)
      * (0.45 + 0.55 * sin((forwardDistance - uTime * 0.028) * 32.0) * 0.5 + 0.275);
    float activeFog = uLyricForce * (1.0 - uLyricSettle * 0.62);
    float residualFog = mix(0.025, 0.055, uLyricReveal) * nearText;
    float alpha = surfaceBand * frontCompression * activeFog * 0.16;
    alpha += sideSlip * movingWisp * activeFog * 0.10;
    alpha += trailingMist * fogNoise * activeFog * 0.055;
    alpha += movingWisp * residualFog;
    alpha *= smoothstep(0.08, 0.42, fogNoise) * uLyricVisibility;
    vec3 color = mix(uFogColorA, uFogColorB, fogNoise) * (0.64 + fogNoise * 0.34);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.18));
  }
`

function ForegroundFogQuad() {
  const materialRef = useRef(null)
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uLyricCenter: { value: new THREE.Vector2() },
      uLyricSize: { value: new THREE.Vector2() },
      uLyricVelocity: { value: new THREE.Vector2() },
      uLyricForce: { value: 0 },
      uLyricReveal: { value: 1 },
      uLyricSettle: { value: 1 },
      uLyricVisibility: { value: 0 },
      uFogColorA: { value: new THREE.Color() },
      uFogColorB: { value: new THREE.Color() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  }), [])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const shader = materialRef.current
    if (!shader) return
    const lyricFlow = lyricFlowController
    shader.uniforms.uTime.value = state.clock.elapsedTime
    shader.uniforms.uLyricCenter.value.fromArray(lyricFlow.center)
    shader.uniforms.uLyricSize.value.fromArray(lyricFlow.size)
    shader.uniforms.uLyricVelocity.value.fromArray(lyricFlow.velocity)
    shader.uniforms.uLyricForce.value = lyricFlow.force
    shader.uniforms.uLyricReveal.value = lyricFlow.reveal
    shader.uniforms.uLyricSettle.value = lyricFlow.settle
    shader.uniforms.uLyricVisibility.value = lyricFlow.visibility
    shader.uniforms.uFogColorA.value.fromArray(lyricFlow.palette, 3)
    shader.uniforms.uFogColorB.value.fromArray(lyricFlow.palette, 6)
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive ref={materialRef} object={material} attach="material" />
    </mesh>
  )
}

export default function LyricForegroundFog() {
  return (
    <div className="lyric-foreground-fog" aria-hidden="true">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], near: 0, far: 2 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ForegroundFogQuad />
      </Canvas>
    </div>
  )
}
