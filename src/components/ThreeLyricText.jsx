import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { lyricPaletteColor } from './lyricPaletteColor'

const FONT = '700 96px system-ui, sans-serif'
const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uProgress;
  uniform float uTextMin;
  uniform float uTextMax;
  uniform float uOpacity;
  uniform vec3 uBaseColor;
  uniform vec3 uFillColor;
  uniform vec3 uGlowColor;
  uniform vec2 uLight;
  uniform float uBaseGain;
  uniform float uFillGain;
  varying vec2 vUv;
  void main() {
    float alpha = texture2D(uMap, vUv).a;
    if (alpha < 0.01) discard;
    float textPosition = clamp((vUv.x - uTextMin) / max(0.001, uTextMax - uTextMin), 0.0, 1.0);
    float filled = 1.0 - smoothstep(uProgress - 0.035, uProgress + 0.035, textPosition);
    float edge = 1.0 - smoothstep(0.0, 0.055, abs(textPosition - uProgress));
    float light = clamp(0.45 + (vUv.x - 0.5) * uLight.x + (vUv.y - 0.5) * uLight.y, 0.0, 1.0);
    vec3 coverGradient = mix(uBaseColor, uFillColor, smoothstep(0.0, 1.0, textPosition));
    vec3 color = mix(coverGradient * uBaseGain, coverGradient * uFillGain + vec3(0.04), filled);
    color += uGlowColor * (edge * 0.48 + light * 0.04);
    gl_FragColor = vec4(color, alpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function makeTextMask(text) {
  const measure = document.createElement('canvas').getContext('2d')
  measure.font = FONT
  const textWidth = Math.max(1, measure.measureText(text).width)
  const padding = 28
  const width = Math.ceil(textWidth + padding * 2)
  const height = 160
  const ratio = Math.min(1, 4096 / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * ratio))
  canvas.height = Math.ceil(height * ratio)
  const context = canvas.getContext('2d')
  context.scale(ratio, ratio)
  context.font = FONT
  context.textBaseline = 'middle'
  context.fillStyle = '#fff'
  context.fillText(text, padding, height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return {
    texture,
    width,
    height,
    textWidth,
    padding,
    textMin: padding / width,
    textMax: (padding + textWidth) / width,
  }
}

function CameraRig({ perspective }) {
  const { size } = useThree()
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(size.height / (2 * perspective)))
  return <PerspectiveCamera makeDefault position={[0, 0, perspective]} fov={fov} near={1} far={4000} />
}

function LyricLine({ line, index, activeIndex, currentTime, isPlaying, settings, palette, trackFadeRef }) {
  const { size, invalidate } = useThree()
  const groupRef = useRef(null)
  const materialRef = useRef(null)
  const sideMaterialsRef = useRef([])
  const progressRef = useRef(0)
  const mask = useMemo(() => makeTextMask(line.text || ''), [line.text])
  const distance = Math.abs(index - activeIndex)
  const isCurrent = index === activeIndex
  const browserWidth = typeof window === 'undefined' ? size.width : window.innerWidth
  const immersive = typeof document !== 'undefined' && document.querySelector('.app.immersive-mode') != null
  const fontSize = isCurrent
    ? browserWidth <= 768 ? 24 : immersive ? Math.min(40, Math.max(25, browserWidth * 0.0215)) : Math.min(42, Math.max(24, browserWidth * 0.0235))
    : browserWidth <= 768 ? 15 : immersive ? Math.min(25, Math.max(16, browserWidth * 0.0135)) : Math.min(28, Math.max(17, browserWidth * 0.0155))
  const depthScale = Math.max(0.84, 1 - Math.min(distance, 4) * 0.06)
  const naturalWidth = mask.textWidth * fontSize / 96 * settings.size * depthScale
  const fit = Math.min(1, Math.max(0.05, (size.width - 32) / Math.max(1, naturalWidth)))
  const scale = fontSize / 96 * settings.size * depthScale * fit
  const x = -size.width / 2 + 12 + (mask.width / 2 - mask.padding) * scale
  const rowHeight = browserWidth <= 768 ? 40 : 58
  const y = -(index - activeIndex) * rowHeight
  const opacity = isCurrent ? 1 : index < activeIndex ? 0.68 : distance === 1 ? 0.64 : distance === 2 ? 0.46 : 0.3
  const nextTime = Number(line.nextTime) || Number(line.time) + 4
  const duration = Math.max(0.8, nextTime - (Number(line.time) || 0))
  const progress = index < activeIndex ? 1 : index > activeIndex ? 0
    : THREE.MathUtils.clamp((currentTime - (Number(line.time) || 0)) / duration, 0, 1)
  const geometry = useMemo(() => new THREE.PlaneGeometry(mask.width, mask.height), [mask])
  const [initialTransform] = useState(() => ({ position: [x, y, 0], scale: [scale, scale, scale] }))
  useEffect(() => () => {
    geometry.dispose()
  }, [geometry])
  useEffect(() => () => {
    mask.texture.dispose()
  }, [mask])
  const uniforms = useMemo(() => {
    const primary = lyricPaletteColor(settings.followCover ? palette.primary : settings.color)
    const secondary = lyricPaletteColor(settings.followCover ? palette.secondary : settings.glowColor)
    return {
      uMap: { value: mask.texture },
      uProgress: { value: 0 },
      uTextMin: { value: mask.textMin },
      uTextMax: { value: mask.textMax },
      uOpacity: { value: opacity },
      uBaseColor: { value: primary },
      uFillColor: { value: secondary },
      uGlowColor: { value: secondary.clone() },
      uLight: { value: new THREE.Vector2(settings.lightX * 0.2, settings.lightY * 0.2) },
      uBaseGain: { value: isCurrent ? 0.42 : 1.08 },
      uFillGain: { value: isCurrent ? 1.55 : 1.08 },
    }
  }, [mask, opacity, isCurrent, palette.primary, palette.secondary, settings.color, settings.glowColor, settings.followCover, settings.lightX, settings.lightY])
  const sideCount = Math.min(6, Math.max(0, Math.round(settings.depth * 4)))

  useEffect(() => {
    progressRef.current = progress
    if (materialRef.current) materialRef.current.uniforms.uProgress.value = progress
    invalidate()
  }, [invalidate, progress])

  useFrame((_, delta) => {
    const trackOpacity = trackFadeRef.current
    if (materialRef.current) materialRef.current.uniforms.uOpacity.value = opacity * trackOpacity
    sideMaterialsRef.current.forEach((material) => {
      if (material) material.opacity = opacity * 0.24 * trackOpacity
    })
    if (isCurrent && isPlaying && materialRef.current) {
      progressRef.current = Math.min(1, progressRef.current + Math.min(delta, 0.1) / duration)
      materialRef.current.uniforms.uProgress.value = progressRef.current
    }
    const group = groupRef.current
    if (group) {
      const step = Math.min(delta, 0.05)
      group.position.x = THREE.MathUtils.damp(group.position.x, x, 4.5, step)
      group.position.y = THREE.MathUtils.damp(group.position.y, y, 4.5, step)
      const nextScale = THREE.MathUtils.damp(group.scale.x, scale, 4.5, step)
      group.scale.setScalar(nextScale)
      if (!isPlaying && (Math.abs(group.position.y - y) > 0.1 || Math.abs(group.scale.x - scale) > 0.001)) {
        invalidate()
      }
    }
  })

  return (
    <group ref={groupRef} position={initialTransform.position} scale={initialTransform.scale} rotation={[
      THREE.MathUtils.degToRad(settings.rotateX),
      THREE.MathUtils.degToRad(settings.rotateY),
      0,
    ]}>
      {Array.from({ length: sideCount }, (_, layer) => (
        <mesh
          key={layer}
          geometry={geometry}
          position={[
            (layer + 1) * (0.8 - settings.lightX * 0.2),
            -(layer + 1) * (0.7 + settings.lightY * 0.2),
            -(layer + 1) * 1.5,
          ]}
        >
          <meshBasicMaterial
            ref={(material) => { sideMaterialsRef.current[layer] = material }}
            map={mask.texture}
            color={settings.followCover ? palette.primary : settings.sideColor}
            transparent
            opacity={opacity * 0.24}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <mesh geometry={geometry}>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

function LyricTrack({ lines, activeIndex, currentTime, isPlaying, settings, palette, slide, transitionId, onSlideComplete }) {
  const { size, invalidate } = useThree()
  const groupRef = useRef(null)
  const elapsedRef = useRef(0)
  const completedRef = useRef(false)
  const trackFadeRef = useRef(1)
  const width = size.width
  const startX = slide === 'incoming' ? -width : 0
  const endX = slide === 'outgoing' ? Math.min(width * 0.15, 90) : 0
  const visibleLines = []
  for (let index = Math.max(0, activeIndex - 3); index <= Math.min(lines.length - 1, activeIndex + 3); index += 1) {
    if (lines[index]?.text?.trim()) visibleLines.push({ ...lines[index], nextTime: lines[index + 1]?.time, index })
  }

  useEffect(() => {
    elapsedRef.current = 0
    completedRef.current = false
    trackFadeRef.current = 1
    if (groupRef.current && slide) groupRef.current.position.x = startX
    invalidate()
  }, [slide, transitionId, startX, invalidate])

  useFrame((_, delta) => {
    if (!slide || !groupRef.current) return
    elapsedRef.current = Math.min(0.9, elapsedRef.current + Math.min(delta, 0.1))
    const t = elapsedRef.current / 0.9
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    groupRef.current.position.x = THREE.MathUtils.lerp(startX, endX, eased)
    if (slide === 'outgoing') {
      const fadeProgress = Math.min(1, t / 0.7)
      trackFadeRef.current = 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
    }
    if (t < 1) invalidate()
    else if (slide === 'incoming' && !completedRef.current) {
      completedRef.current = true
      onSlideComplete?.(transitionId)
    }
  })

  return (
    <group ref={groupRef} position={[startX, 0, 0]}>
      {visibleLines.map((line) => (
        <LyricLine
          key={`${line.time}-${line.index}`}
          line={line}
          index={line.index}
          activeIndex={activeIndex}
          currentTime={currentTime}
          isPlaying={isPlaying}
          settings={settings}
          palette={palette}
          trackFadeRef={trackFadeRef}
        />
      ))}
    </group>
  )
}

export default function ThreeLyricText({
  lines, songId, activeIndex, currentTime, isPlaying, settings, palette, outgoing, transitionId, onTransitionComplete,
}) {
  return (
    <div className="floating-lyrics__stage">
      <Canvas
        frameloop={isPlaying || outgoing ? 'always' : 'demand'}
        camera={{ position: [0, 0, settings.perspective], fov: 45, near: 1, far: 4000 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      >
        <CameraRig perspective={settings.perspective} />
        {outgoing && (
          <LyricTrack
            key={`outgoing-${transitionId}`}
            lines={outgoing.lines}
            activeIndex={outgoing.activeIndex}
            currentTime={outgoing.currentTime}
            isPlaying={false}
            settings={settings}
            palette={outgoing.palette}
            slide="outgoing"
            transitionId={transitionId}
          />
        )}
        <LyricTrack
          key={`current-${songId}`}
          lines={lines}
          activeIndex={activeIndex}
          currentTime={currentTime}
          isPlaying={isPlaying}
          settings={settings}
          palette={palette}
          slide={outgoing ? 'incoming' : null}
          transitionId={transitionId}
          onSlideComplete={onTransitionComplete}
        />
      </Canvas>
    </div>
  )
}
