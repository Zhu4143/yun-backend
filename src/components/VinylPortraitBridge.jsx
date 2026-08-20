import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const DARK_BLUE = new THREE.Color('#005DFF')
const MID_CYAN = new THREE.Color('#008CFF')
const HIGH_CYAN = new THREE.Color('#D8FFFF')

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
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

function mixPalette(from, to, amount) {
  const t = clamp01(amount)
  return [
    THREE.MathUtils.lerp(from.r, to.r, t),
    THREE.MathUtils.lerp(from.g, to.g, t),
    THREE.MathUtils.lerp(from.b, to.b, t),
  ]
}

function makePortraitSamples(image, crop) {
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
  const data = context.getImageData(0, 0, width, height).data
  const samples = []

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3] / 255
      if (alpha < 0.08) continue
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      const whitenessDistance = Math.hypot(255 - r, 255 - g, 255 - b)
      if ((luma > 0.965 && whitenessDistance < 18) || luma < 0.015) continue
      samples.push({
        x: x - width / 2,
        y: -(y - height / 2),
        luma,
        alpha,
      })
    }
  }

  return { width, height, samples }
}

function stableRandom(index, salt = 0) {
  return Math.abs(Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453) % 1
}

function buildBridgeGeometry({ image, crop, pointCount, viewportWidth, viewportHeight }) {
  const portrait = makePortraitSamples(image, crop)
  const samples = portrait.samples.length ? portrait.samples : [{ x: 0, y: 0, luma: 0.6, alpha: 1 }]
  const recordPositions = new Float32Array(pointCount * 3)
  const scatterPositions = new Float32Array(pointCount * 3)
  const portraitPositions = new Float32Array(pointCount * 3)
  const colors = new Float32Array(pointCount * 3)
  const sizes = new Float32Array(pointCount)
  const alphas = new Float32Array(pointCount)
  const phases = new Float32Array(pointCount)
  const fit = Math.min(viewportWidth / 880, viewportHeight / 920)
  const recordRadius = Math.min(viewportWidth, viewportHeight) * 0.285
  const coverRadius = recordRadius * 0.42

  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * 3
    const seedA = stableRandom(index, 1.3)
    const seedB = stableRandom(index, 5.7)
    const angle = index * 2.39996323 + seedA * 0.08
    const discBand = seedB < 0.28
      ? THREE.MathUtils.lerp(0, coverRadius, Math.sqrt(seedA))
      : THREE.MathUtils.lerp(coverRadius * 1.08, recordRadius, Math.sqrt(seedA))
    const recordX = Math.cos(angle - 0.34) * discBand
    const recordY = Math.sin(angle - 0.34) * discBand
    recordPositions[offset] = recordX
    recordPositions[offset + 1] = recordY
    recordPositions[offset + 2] = (seedB - 0.5) * 18

    const scatterRadius = recordRadius * (0.78 + seedA * 1.3)
    const tangent = angle + Math.PI * 0.5 + (seedB - 0.5) * 1.8
    scatterPositions[offset] = recordX * 0.38 + Math.cos(tangent) * scatterRadius
    scatterPositions[offset + 1] = recordY * 0.38 + Math.sin(tangent) * scatterRadius
    scatterPositions[offset + 2] = (seedA - 0.5) * 260

    const sample = samples[(index * 37) % samples.length]
    const faceJitter = (seedA - 0.5) * 1.8
    portraitPositions[offset] = sample.x * fit + faceJitter
    portraitPositions[offset + 1] = sample.y * fit - 14 * fit + (seedB - 0.5) * 1.8
    portraitPositions[offset + 2] = sample.luma * 46 + (seedA - 0.5) * 10

    const palette = sample.luma > 0.82
      ? mixPalette(MID_CYAN, HIGH_CYAN, (sample.luma - 0.68) / 0.32)
      : mixPalette(DARK_BLUE, MID_CYAN, sample.luma / 0.68)
    colors[offset] = palette[0]
    colors[offset + 1] = palette[1]
    colors[offset + 2] = palette[2]
    sizes[index] = 3.1 + sample.luma * 1.8
    alphas[index] = Math.min(1, 0.45 + sample.alpha * 0.35 + sample.luma * 0.22)
    phases[index] = angle
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(recordPositions, 3))
  geometry.setAttribute('aRecordPosition', new THREE.BufferAttribute(recordPositions, 3))
  geometry.setAttribute('aScatterPosition', new THREE.BufferAttribute(scatterPositions, 3))
  geometry.setAttribute('aPortraitPosition', new THREE.BufferAttribute(portraitPositions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.computeBoundingSphere()
  return geometry
}

const vertexShader = `
  uniform float uProgress;
  uniform float uTime;
  uniform float uPixelRatio;
  attribute vec3 aRecordPosition;
  attribute vec3 aScatterPosition;
  attribute vec3 aPortraitPosition;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float breakT = smoothstep(0.0, 0.52, uProgress);
    float gatherT = smoothstep(0.42, 1.0, uProgress);
    vec3 scattered = aScatterPosition;
    scattered.x += sin(uTime * 0.7 + aPhase) * 10.0 * sin(uProgress * 3.14159265);
    scattered.y += cos(uTime * 0.55 + aPhase * 0.7) * 7.0 * sin(uProgress * 3.14159265);
    vec3 p = mix(aRecordPosition, scattered, breakT);
    p = mix(p, aPortraitPosition, gatherT);
    vColor = color;
    vAlpha = aAlpha * (0.82 + sin(uProgress * 3.14159265) * 0.18);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float circle = 1.0 - smoothstep(0.44, 0.50, d);
    if (circle <= 0.001) discard;
    float core = 1.0 - smoothstep(0.0, 0.18, d);
    float halo = 1.0 - smoothstep(0.26, 0.50, d);
    vec3 color = vColor;
    color = mix(color, vec3(0.85, 1.0, 1.0), core * 0.35);
    color += vec3(0.0, 0.48, 1.0) * halo * 0.22;
    gl_FragColor = vec4(color * 1.65, (circle + halo * 0.12) * vAlpha);
  }
`

export default function VinylPortraitBridge({
  imageUrl,
  crop = { x: 0, y: 0, width: 1, height: 1 },
  progress = 1,
  pointCount = 56000,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const progressRef = useRef(progress)

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    if (!imageUrl) return undefined
    let destroyed = false
    let frameId = 0
    let geometry = null
    const wrap = wrapRef.current
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    camera.position.z = 10
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: progressRef.current },
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
    })
    const points = new THREE.Points(undefined, material)
    points.frustumCulled = false
    scene.add(points)

    const resizeCamera = () => {
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.left = -width / 2
      camera.right = width / 2
      camera.top = height / 2
      camera.bottom = -height / 2
      camera.updateProjectionMatrix()
      material.uniforms.uPixelRatio.value = ratio
      return { width, height }
    }

    const rebuild = async () => {
      const image = await loadImage(imageUrl)
      if (destroyed) return
      const viewport = resizeCamera()
      geometry?.dispose()
      geometry = buildBridgeGeometry({ image, crop, pointCount, viewportWidth: viewport.width, viewportHeight: viewport.height })
      points.geometry = geometry
    }

    const onResize = () => {
      rebuild().catch((error) => console.error('Bridge resize rebuild failed', error))
    }

    rebuild().catch((error) => console.error('Bridge image failed to load', error))
    window.addEventListener('resize', onResize)
    const clock = new THREE.Clock()
    const animate = () => {
      if (destroyed) return
      material.uniforms.uProgress.value = progressRef.current
      material.uniforms.uTime.value = clock.getElapsedTime()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      destroyed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      geometry?.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [imageUrl, crop, pointCount])

  return (
    <div ref={wrapRef} className="vinyl-portrait-bridge">
      <canvas ref={canvasRef} />
    </div>
  )
}
