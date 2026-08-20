import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import './PixelRhythmPortrait.css'

// THREE.Color converts these display-space colors into the renderer's linear
// working space. The shader can then return the requested sRGB palette exactly.
const DARK_BLUE = new THREE.Color('#005DFF')
const MID_CYAN = new THREE.Color('#008CFF')
const HIGH_CYAN = new THREE.Color('#D8FFFF')

function mixPalette(from, to, amount) {
  const t = THREE.MathUtils.clamp(amount, 0, 1)
  return [
    THREE.MathUtils.lerp(from.r, to.r, t),
    THREE.MathUtils.lerp(from.g, to.g, t),
    THREE.MathUtils.lerp(from.b, to.b, t),
  ]
}

const vertexShader = `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uUserSize;
  uniform float uMaxPointSize;
  uniform float uMinPointRatio;
  uniform float uBreath;
  uniform float uJitter;
  uniform float uRevealProgress;
  attribute float aSize;
  attribute float aPhase;
  attribute float aAlpha;
  attribute float aLuma;
  attribute vec3 aTransitionScatter;
  attribute vec3 aAccentColor;
  varying vec3 vColor;
  varying vec3 vAccentColor;
  varying float vAlpha;
  varying float vLuma;

  void main() {
    vColor = color;
    vAccentColor = aAccentColor;
    vAlpha = aAlpha;
    vLuma = aLuma;
    float reveal = smoothstep(0.18, 0.92, uRevealProgress);
    vec3 p = position + aTransitionScatter * (1.0 - reveal);
    float wave = sin(uTime * 1.35 + aPhase + position.x * 0.007 + position.y * 0.004);
    p.z += wave * uBreath;
    p.x += sin(uTime * 0.55 + aPhase + position.y * 0.013) * uJitter;
    p.y += cos(uTime * 0.48 + aPhase + position.x * 0.011) * uJitter * 0.45;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float screenSize = clamp(
      aSize * uUserSize,
      uMaxPointSize * uMinPointRatio,
      uMaxPointSize
    );
    gl_PointSize = screenSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  precision mediump float;
  uniform float uIntensity;
  uniform float uOpacityScale;
  uniform float uLedMix;
  varying vec3 vColor;
  varying vec3 vAccentColor;
  varying float vAlpha;
  varying float vLuma;
  void main() {
    vec2 pointUv = gl_PointCoord - 0.5;
    float d = length(pointUv);
    float circle = 1.0 - smoothstep(0.46, 0.50, d);
    if (circle <= 0.001) discard;
    float core = 1.0 - smoothstep(0.00, 0.18, d);
    float midGlow = 1.0 - smoothstep(0.12, 0.36, d);
    float rim = smoothstep(0.28, 0.47, d) * circle;
    float halo = 1.0 - smoothstep(0.30, 0.50, d);

    float v = pow(clamp(vLuma, 0.0, 1.0), 0.62);
    float brightness = smoothstep(0.05, 0.95, v) * 1.35;
    float highlight = smoothstep(0.68, 1.0, v);
    brightness += highlight * 0.75;

    vec3 deepBlue = vec3(0.0, 0.018, 0.10);
    vec3 mainBlue = vec3(0.0, 0.31, 1.0);
    vec3 electricCyan = vec3(0.0, 0.86, 1.0);
    vec3 whiteCyan = vec3(0.85, 1.0, 1.0);
    vec3 ledColor = deepBlue;
    ledColor = mix(ledColor, mainBlue, midGlow);
    ledColor = mix(ledColor, electricCyan, core * 0.75);
    ledColor = mix(ledColor, whiteCyan, core * highlight);
    ledColor += mainBlue * rim * 0.45;

    float edgeBand = smoothstep(0.28, 0.48, d) * circle;
    ledColor.r += max(pointUv.x, 0.0) * edgeBand * 0.36;
    ledColor.b += max(-pointUv.x, 0.0) * edgeBand * 0.5;
    ledColor.g += core * 0.08;
    float stripe = fract(gl_PointCoord.x * 3.0);
    vec3 subPixel = vec3(
      1.0 - smoothstep(0.0, 0.32, stripe),
      smoothstep(0.25, 0.48, stripe) * (1.0 - smoothstep(0.52, 0.7, stripe)),
      smoothstep(0.64, 0.86, stripe)
    );
    ledColor += subPixel * 0.12 * edgeBand * brightness;

    float colorFlow = smoothstep(-0.5, 0.5, pointUv.x * 0.8 - pointUv.y * 0.55);
    vec3 sourceTint = mix(vColor, vAccentColor, 0.08 + colorFlow * 0.18);
    vec3 finalColor = mix(sourceTint, ledColor, uLedMix) * brightness * uIntensity;
    float alpha = (circle + halo * 0.16) * vAlpha * uOpacityScale;
    gl_FragColor = vec4(finalColor, alpha);
  }
`

function createDotMaterial(breath, jitter, intensity = 1, ledMix = 1) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uUserSize: { value: 1 },
      uMaxPointSize: { value: 4 },
      uMinPointRatio: { value: 0 },
      uBreath: { value: breath },
      uJitter: { value: jitter },
      uRevealProgress: { value: 1 },
      uIntensity: { value: intensity },
      uOpacityScale: { value: 1 },
      uLedMix: { value: ledMix },
    },
  })
}

function toGeometry({ positions, colors, accents, sizes, phases, alphas, lumas, sampleUvs }) {
  const geometry = new THREE.BufferGeometry()
  const pointCount = positions.length / 3
  const transitionScatter = new Float32Array(pointCount * 3)
  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * 3
    const angle = index * 2.39996323
    const seed = Math.abs(Math.sin(index * 78.233 + 0.37))
    const radius = 70 + seed * 230
    transitionScatter[offset] = Math.cos(angle) * radius
    transitionScatter[offset + 1] = Math.sin(angle) * radius
    transitionScatter[offset + 2] = (seed - 0.5) * 180
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aTransitionScatter', new THREE.BufferAttribute(transitionScatter, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aAccentColor', new THREE.Float32BufferAttribute(accents, 3))
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
  geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1))
  geometry.setAttribute('aBaseAlpha', new THREE.Float32BufferAttribute(alphas, 1))
  geometry.setAttribute('aLuma', new THREE.Float32BufferAttribute(lumas, 1))
  geometry.setAttribute('aSampleUv', new THREE.Float32BufferAttribute(sampleUvs, 2))
  return geometry
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

function renderFrameData(image, crop) {
  const sx = image.width * crop.x
  const sy = image.height * crop.y
  const sw = image.width * crop.width
  const sh = image.height * crop.height
  const width = 720
  const height = Math.round((sh / sw) * width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

function applyFrameToGeometry(geometry, frame) {
  const uv = geometry.getAttribute('aSampleUv')
  const color = geometry.getAttribute('color')
  const luma = geometry.getAttribute('aLuma')
  const alpha = geometry.getAttribute('aAlpha')
  const baseAlpha = geometry.getAttribute('aBaseAlpha')
  for (let index = 0; index < uv.count; index += 1) {
    const x = Math.min(frame.width - 1, Math.max(0, Math.round(uv.getX(index) * (frame.width - 1))))
    const y = Math.min(frame.height - 1, Math.max(0, Math.round(uv.getY(index) * (frame.height - 1))))
    const pixel = (y * frame.width + x) * 4
    const sourceAlpha = frame.data[pixel + 3] / 255
    const luminance = (frame.data[pixel] * 0.299 + frame.data[pixel + 1] * 0.587 + frame.data[pixel + 2] * 0.114) / 255
    const palette = luminance > 0.82
      ? mixPalette(MID_CYAN, HIGH_CYAN, (luminance - 0.68) / 0.32)
      : mixPalette(DARK_BLUE, MID_CYAN, luminance / 0.68)
    color.setXYZ(index, palette[0], palette[1], palette[2])
    luma.setX(index, luminance)
    alpha.setX(index, baseAlpha.getX(index) * (sourceAlpha > 0.08 ? sourceAlpha : 0))
  }
  color.needsUpdate = true
  luma.needsUpdate = true
  alpha.needsUpdate = true
}

function buildPortraitGeometry(image, { sampleStep, crop }) {
  const sx = image.width * crop.x
  const sy = image.height * crop.y
  const sw = image.width * crop.width
  const sh = image.height * crop.height
  const drawW = 720
  const drawH = Math.round((sh / sw) * drawW)
  const canvas = document.createElement('canvas')
  canvas.width = drawW
  canvas.height = drawH
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, sx, sy, sw, sh, 0, 0, drawW, drawH)
  const data = context.getImageData(0, 0, drawW, drawH).data
  const gray = new Float32Array(drawW * drawH)
  const makeLayer = () => ({ positions: [], colors: [], accents: [], sizes: [], phases: [], alphas: [], lumas: [], sampleUvs: [] })
  const fill = makeLayer()
  const edges = makeLayer()
  const scatter = makeLayer()

  for (let y = 0; y < drawH; y += 1) {
    for (let x = 0; x < drawW; x += 1) {
      const index = (y * drawW + x) * 4
      gray[y * drawW + x] = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    }
  }

  const getGray = (x, y) => gray[
    Math.max(0, Math.min(drawH - 1, y)) * drawW + Math.max(0, Math.min(drawW - 1, x))
  ]

  const getSobel = (x, y) => {
    const gx =
      -getGray(x - 1, y - 1) + getGray(x + 1, y - 1)
      - 2 * getGray(x - 1, y) + 2 * getGray(x + 1, y)
      - getGray(x - 1, y + 1) + getGray(x + 1, y + 1)
    const gy =
      -getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - getGray(x + 1, y - 1)
      + getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + getGray(x + 1, y + 1)
    return Math.hypot(gx, gy)
  }

  const addPoint = (target, x, y, z, color, accent, size, alpha, luma, phaseOffset = 0) => {
    target.positions.push(x - drawW / 2, -(y - drawH / 2), z)
    target.colors.push(...color)
    target.accents.push(accent.r, accent.g, accent.b)
    target.sizes.push(size)
    // A stable phase keeps the points on a regular LED grid instead of looking noisy.
    target.phases.push((x * 0.071 + y * 0.047 + phaseOffset) % (Math.PI * 2))
    target.alphas.push(Math.min(alpha, 1))
    target.lumas.push(luma)
    target.sampleUvs.push(THREE.MathUtils.clamp(x / drawW, 0, 1), THREE.MathUtils.clamp(y / drawH, 0, 1))
  }

  const readSample = (x, y) => {
      const index = (y * drawW + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const sourceAlpha = data[index + 3]
      if (sourceAlpha < 20) return null

      const brightness = gray[y * drawW + x]
      const luminance = brightness / 255
      const edgeStrength = Math.min(getSobel(x, y) / 180, 1)
      const whitenessDistance = Math.hypot(255 - r, 255 - g, 255 - b)
      const nearWhiteBackground = whitenessDistance < 17 && edgeStrength < 0.13
      const nearBlackBackground = brightness < 8 && edgeStrength < 0.18
      if (nearWhiteBackground || nearBlackBackground) return null

      return { brightness, luminance, edgeStrength, whitenessDistance }
  }

  // The fill grid is intentionally sparse. Its spacing grows together with
  // the LED diameter, preserving the black seams seen in a physical matrix.
  for (let y = 0; y < drawH; y += sampleStep) {
    for (let x = 0; x < drawW; x += sampleStep) {
      const sample = readSample(x, y)
      if (!sample) continue
      const { brightness, luminance, edgeStrength, whitenessDistance } = sample

      const isFill = brightness > 20 && whitenessDistance > 16
      if (isFill) {
        const curvedLuminance = Math.pow(luminance, 0.75)
        const faceShade = THREE.MathUtils.smoothstep(curvedLuminance, 0.12, 0.95)
        let color
        if (luminance > 0.82) {
          color = mixPalette(MID_CYAN, HIGH_CYAN, (luminance - 0.68) / 0.32)
        } else {
          color = mixPalette(DARK_BLUE, MID_CYAN, luminance / 0.68)
        }
        const dotSize = (2.25 + luminance * 0.9) * THREE.MathUtils.lerp(0.72, 1.12, faceShade)
        const dotAlpha = Math.max(0.48, (0.48 + luminance * 0.42) * THREE.MathUtils.lerp(0.55, 1, faceShade))
        addPoint(
          fill,
          x,
          y,
          luminance * 32 + Math.sin(x * 0.05 + y * 0.03) * 1.2,
          color,
          MID_CYAN,
          dotSize * (luminance > 0.82 ? 1.12 : 1),
          Math.min(1, dotAlpha + edgeStrength * 0.08),
          luminance,
        )
      }

    }
  }

  // The edge grid stays denser than the fill grid, so eyes, mouth, hair and
  // the outside silhouette remain readable while the total point count falls.
  const edgeStep = 3
  for (let y = 0; y < drawH; y += edgeStep) {
    for (let x = 0; x < drawW; x += edgeStep) {
      const sample = readSample(x, y)
      if (!sample) continue
      const { luminance, edgeStrength } = sample
      if (edgeStrength > 0.12) {
        addPoint(
          edges,
          x,
          y,
          luminance * 32 + edgeStrength * 32 + 3,
          mixPalette(DARK_BLUE, MID_CYAN, edgeStrength * 0.28),
          MID_CYAN,
          1.6 + edgeStrength * 0.8,
          Math.min(0.6, 0.35 + edgeStrength * 0.25),
          luminance > 0.82 ? 1 : Math.max(luminance, edgeStrength * 0.72),
          1.7,
        )
        const scatterHash = Math.abs(Math.sin(x * 12.9898 + y * 78.233))
        if (edgeStrength > 0.24 && scatterHash < 0.075) {
          addPoint(
            scatter,
            x + Math.sin(y * 0.31) * 2.2,
            y + Math.cos(x * 0.27) * 1.8,
            luminance * 26 + edgeStrength * 18 - 2,
            [DARK_BLUE.r, DARK_BLUE.g, DARK_BLUE.b],
            MID_CYAN,
            1.2 + edgeStrength * 0.65,
            0.2 + edgeStrength * 0.22,
            Math.max(0.15, luminance * 0.55),
            2.9,
          )
        }
      }
    }
  }
  return { fill: toGeometry(fill), edges: toGeometry(edges), scatter: toGeometry(scatter) }
}

export default function PixelRhythmPortrait({
  imageUrl,
  sequenceUrls,
  sequenceOrder,
  sequenceFps = 12,
  revealProgress = 1,
  sampleStep = 3,
  pointSize = 1,
  crop = { x: 0, y: 0, width: 1, height: 1 },
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const materialsRef = useRef(null)
  const sequenceFpsRef = useRef(sequenceFps)
  const revealProgressRef = useRef(revealProgress)

  useEffect(() => {
    sequenceFpsRef.current = sequenceFps
  }, [sequenceFps])

  useEffect(() => {
    revealProgressRef.current = revealProgress
  }, [revealProgress])


  useEffect(() => {
    if (!imageUrl) return undefined
    let destroyed = false
    let frameId = 0
    let sequenceFrames = null
    let renderedSequenceIndex = -1
    let portrait = null
    const wrap = wrapRef.current
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: false, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.toneMappingExposure = 1
    renderer.setClearColor(0x01030a, 1)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 4000)
    camera.position.z = 900
    const fillMaterial = createDotMaterial(7, 0.38, 2.45, 1)
    const edgeMaterial = createDotMaterial(5, 0.2, 3.05, 1)
    const scatterMaterial = createDotMaterial(6, 0.55, 1.05, 0.28)
    materialsRef.current = { fill: fillMaterial, edge: edgeMaterial, scatter: scatterMaterial }

    const resize = () => {
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      fillMaterial.uniforms.uPixelRatio.value = ratio
      edgeMaterial.uniforms.uPixelRatio.value = ratio
      scatterMaterial.uniforms.uPixelRatio.value = ratio
      const fit = Math.min(width / 880, height / 920)
      // Keep dot overlap—and therefore additive brightness—consistent with the
      // 1280×720 reference viewport as the portrait scales between windows.
      const pixelsPerWorldUnit = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z)
      const gridStepPixels = sampleStep * fit * pixelsPerWorldUnit
      fillMaterial.uniforms.uMaxPointSize.value = Math.max(2.4, gridStepPixels * 0.88)
      edgeMaterial.uniforms.uMaxPointSize.value = Math.min(3.2, Math.max(1.8, gridStepPixels * 0.52))
      scatterMaterial.uniforms.uMaxPointSize.value = Math.min(2.2, Math.max(1.2, gridStepPixels * 0.34))
      if (portrait) portrait.scale.setScalar(fit)
    }

    const sourceUrls = sequenceUrls?.length ? sequenceUrls : [imageUrl]
    Promise.all(sourceUrls.map(loadImage)).then((images) => {
      if (destroyed) return
      sequenceFrames = images.map((image) => renderFrameData(image, crop))
      const geometries = buildPortraitGeometry(images[0], { sampleStep, crop })
      portrait = new THREE.Group()
      portrait.add(new THREE.Points(geometries.fill, fillMaterial))
      portrait.add(new THREE.Points(geometries.edges, edgeMaterial))
      portrait.add(new THREE.Points(geometries.scatter, scatterMaterial))
      portrait.position.set(0, -14, 24)
      portrait.renderOrder = 2
      scene.add(portrait)
      resize()
    }).catch((error) => console.error('Pixel portrait image failed to load', error))

    window.addEventListener('resize', resize)
    resize()
    const clock = new THREE.Clock()
    const animate = () => {
      if (destroyed) return
      const time = clock.getElapsedTime()
      fillMaterial.uniforms.uTime.value = time
      edgeMaterial.uniforms.uTime.value = time
      scatterMaterial.uniforms.uTime.value = time
      fillMaterial.uniforms.uRevealProgress.value = revealProgressRef.current
      edgeMaterial.uniforms.uRevealProgress.value = revealProgressRef.current
      scatterMaterial.uniforms.uRevealProgress.value = revealProgressRef.current
      if (portrait) {
        portrait.rotation.z = Math.sin(time * 0.22) * 0.005
        const responsiveScale = Math.min(wrap.clientWidth / 880, wrap.clientHeight / 920)
        portrait.scale.setScalar(responsiveScale * (1 + Math.sin(time * 1.15) * 0.007))
      }
      if (portrait && sequenceFrames?.length > 1) {
        const playback = sequenceOrder?.length ? sequenceOrder : sequenceFrames.map((_, index) => index)
        const playbackIndex = Math.floor(time * sequenceFpsRef.current) % playback.length
        const nextFrameIndex = playback[playbackIndex]
        if (nextFrameIndex !== renderedSequenceIndex && sequenceFrames[nextFrameIndex]) {
          portrait.children.forEach((points) => applyFrameToGeometry(points.geometry, sequenceFrames[nextFrameIndex]))
          renderedSequenceIndex = nextFrameIndex
        }
      }
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      destroyed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      scene.traverse((object) => {
        object.geometry?.dispose()
        object.material?.dispose()
      })
      renderer.dispose()
      materialsRef.current = null
    }
  }, [imageUrl, sequenceUrls, sequenceOrder, sampleStep, crop])

  useEffect(() => {
    const materials = materialsRef.current
    if (!materials) return
    const largeDotMode = pointSize > 1.4
    materials.fill.uniforms.uUserSize.value = largeDotMode
      ? THREE.MathUtils.lerp(1.16, 1.65, (pointSize - 1.4) / 1.1)
      : THREE.MathUtils.lerp(1, 1.16, (pointSize - 1) / 0.4)
    const sliderT = THREE.MathUtils.clamp((pointSize - 1) / 1.5, 0, 1)
    materials.fill.uniforms.uMinPointRatio.value = THREE.MathUtils.lerp(0.45, 0.92, sliderT)
    materials.fill.uniforms.uOpacityScale.value = 1
    materials.edge.uniforms.uUserSize.value = largeDotMode ? 0.78 : 0.86
    materials.edge.uniforms.uOpacityScale.value = 1
    materials.scatter.uniforms.uUserSize.value = 0.72
    materials.scatter.uniforms.uOpacityScale.value = 0.72
  }, [pointSize, sampleStep])

  return (
    <div ref={wrapRef} className="pixel-rhythm-portrait">
      <canvas ref={canvasRef} />
      <div className="pixel-rhythm-vignette" />
      <div className="pixel-rhythm-scanline" />
    </div>
  )
}
