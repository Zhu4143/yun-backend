import * as THREE from 'three'
import { createLiquidGlassPass, GLASS_VERTEX } from './liquidGlassPass.js'
import { createRecordArtwork } from './recordArtwork.js'
import { readImmersivePalette, extractImmersivePalette } from './immersivePalette.js'
import { LIQUID_COLOR_FLOW_GLSL } from './liquidColorFlow.js'
import { createRenderClock } from '../skins/cd-case/frameBudget.js'

const BACKGROUND = `varying vec2 vUv;
uniform vec2 uResolution;
uniform float uNight, uFlowTime;
uniform vec3 uFlowBase, uFlowPrimary, uFlowSecondary, uFlowAccent;
${LIQUID_COLOR_FLOW_GLSL}
void main() {
  vec3 flow = liquidColorFlow(vUv, uResolution.x / max(1.0,uResolution.y), uFlowTime,
    uFlowBase, uFlowPrimary, uFlowSecondary, uFlowAccent);
  // Broad colour currents with a bounded reading luminance, no cover shadows.
  vec3 day = vec3(.82) + flow * .17;
  vec3 night = vec3(.032, .039, .052) + flow * .18;
  vec3 color = mix(day, night, uNight);
  gl_FragColor = vec4(color,1.0);
}`

/** One budgeted canvas shares the moving colour field and original glass. */
export function createOriginalGlassScene(host, { initialNight = 0, readSuspended, onReady, onFail }) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas)
  let renderer
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'low-power' }) }
  catch { canvas.remove(); onFail(); return null }
  const scene = new THREE.Scene(), camera = new THREE.Camera(), geometry = new THREE.PlaneGeometry(2, 2)
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) }, uNight: { value: initialNight }, uFlowTime: { value: 0 },
  }
  const paletteFields = [['base', 'uFlowBase'], ['primary', 'uFlowPrimary'], ['secondary', 'uFlowSecondary'], ['accent', 'uFlowAccent']]
  const neutral = extractImmersivePalette([], { multicolor: true }), nextColor = new THREE.Vector3()
  for (const [key, uniform] of paletteFields) uniforms[uniform] = { value: new THREE.Vector3(...neutral[key]).multiplyScalar(1 / 255) }
  const material = new THREE.ShaderMaterial({ vertexShader: GLASS_VERTEX, fragmentShader: BACKGROUND, uniforms, depthTest: false, depthWrite: false })
  const quad = new THREE.Mesh(geometry, material)
  quad.frustumCulled = false; scene.add(quad)
  const clock = createRenderClock(20), reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false, raf = 0, fading = false, firstFrame = true, fallback = false, inFrame = false
  let targetNight = initialNight
  const loading = new Set()
  function wake() {
    if (!disposed && !readSuspended() && !document.hidden && !raf) {
      if (!inFrame) clock.reset()
      raf = requestAnimationFrame(tick)
    }
  }
  const glass = createLiquidGlassPass(renderer, {
    accept(node) {
      const dialog = [...document.querySelectorAll('.music-dialog')].at(-1)
      return !node.closest('.immersive-player') && (!dialog || dialog.contains(node))
    }, invalidate: wake, readNight: () => uniforms.uNight.value,
  })
  const artwork = createRecordArtwork({
    load: source => new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'; loading.add(image)
      image.onerror = () => { loading.delete(image); reject(new Error('Artwork unavailable')) }
      image.onload = () => {
        loading.delete(image)
        resolve(readImmersivePalette(image, { multicolor: true }))
      }
      image.src = source
    }),
    release: () => {},
    publish({ current, incoming, mix }) {
      for (const [key, uniform] of paletteFields) {
        uniforms[uniform].value.fromArray(current.value[key]).multiplyScalar(1 / 255)
        if (incoming) uniforms[uniform].value.lerp(nextColor.fromArray(incoming.value[key]).multiplyScalar(1 / 255), mix)
      }
      fading = Boolean(incoming); wake()
    },
    onError(_error, retained) { if (!retained && !fallback) { fallback = true; void artwork.set('/artwork/coast.webp') } },
  })
  function layout() {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(1.25, devicePixelRatio || 1, Math.sqrt(600_000 / (width * height))))
    renderer.setSize(width, height, false)
    uniforms.uResolution.value.set(canvas.width, canvas.height)
    glass.resize(canvas.width, canvas.height); wake()
  }
  function tick(now) {
    raf = 0
    if (disposed || readSuspended() || document.hidden) return
    inFrame = true
    try {
      const elapsed = clock.sample(now)
      if (elapsed === null) { wake(); return }
      const delta = Math.min(.1, elapsed)
      if (!reduced.matches) uniforms.uFlowTime.value += delta
      uniforms.uNight.value += (targetNight - uniforms.uNight.value) * (reduced.matches ? 1 : 1 - Math.exp(-12 * delta))
      const changingTheme = Math.abs(targetNight - uniforms.uNight.value) > .001
      if (!changingTheme) uniforms.uNight.value = targetNight
      artwork.step(delta, reduced.matches)
      const hasGlass = glass.prepare(delta)
      renderer.setRenderTarget(hasGlass ? glass.input : null)
      renderer.render(scene, camera)
      if (hasGlass) glass.present()
      if (firstFrame) { firstFrame = false; onReady() }
      if (!reduced.matches || fading || changingTheme || glass.moving()) wake()
    } finally { inFrame = false }
  }
  const resizeObserver = new ResizeObserver(layout)
  resizeObserver.observe(host)
  const visibility = () => { cancelAnimationFrame(raf); raf = 0; clock.reset(); wake() }
  const lost = event => { event.preventDefault(); onFail() }
  document.addEventListener('visibilitychange', visibility)
  reduced.addEventListener('change', visibility)
  canvas.addEventListener('webglcontextlost', lost)
  layout()
  return {
    setTheme(theme) {
      targetNight = theme === 'dark' ? 1 : 0
      if (readSuspended() || reduced.matches) uniforms.uNight.value = targetNight
      wake()
    },
    async setCover(source) {
      await artwork.set(source || '/artwork/coast.webp')
      if (readSuspended()) artwork.step(0, true)
    },
    resume() { clock.reset(); wake() },
    dispose() {
      if (disposed) return
      disposed = true; cancelAnimationFrame(raf); resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility)
      canvas.removeEventListener('webglcontextlost', lost)
      for (const image of loading) { image.onload = image.onerror = null; image.src = '' }
      loading.clear(); artwork.dispose(); glass.dispose(); geometry.dispose(); material.dispose()
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    },
  }
}
