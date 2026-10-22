import * as THREE from 'three'
import { discGeometry } from '../skins/cd-case/caseGeometry.js'
import { DISC_VERT, DISC_FRAG } from '../skins/cd-case/shaders.js'
import { createLiquidMetalField } from '../components/liquidMetalField.js'
import { readImmersivePalette } from './immersivePalette.js'
import { resolveLiquidMetalBackgroundSettings } from '../components/liquidMetalSettings.js'
import { normalizeImmersiveBackground } from '../../server/visuals/immersiveBackgroundSchema.js'
import { createRenderClock } from '../skins/cd-case/frameBudget.js'
import { advanceRecordSpin, createRecordArtwork } from './recordArtwork.js'
import { createLiquidGlassPass } from './liquidGlassPass.js'
import { observeRecordLayout } from './recordLayout.js'

// Reuse Ann Nguyen / TypingMind's physical disc and the existing metallic-print
// extension. Only the final display conversion and layer opacity are added;
// the standalone scene does not need the case's HDR/glint post-processing.
const DISC_FRAGMENT = `uniform float uOpacity;
${DISC_FRAG.replace('void main()', 'void shadePhysicalDisc()')}
void main() {
  shadePhysicalDisc();
  vec3 c = clamp(gl_FragColor.rgb, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  gl_FragColor = vec4(c, uOpacity);
}`

export function createImmersiveRecordScene(host, slot, { readPlaying, readGlassEnabled, readRecordVisible = () => true, onPalette, backgroundSettings, onReady, onFail }) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  host.appendChild(canvas)
  let renderer
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'low-power' }) }
  catch { canvas.remove(); onFail(); return null }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const clock = createRenderClock(30)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 2000)
  camera.position.z = 900
  renderer.setClearColor(0x12242c, 1)
  const field = createLiquidMetalField()
  // Bright album palettes must leave room for white lyrics. Preserve the ore's
  // hue and motion, compressing only its brightest areas in this reading view.
  field.material.fragmentShader = field.material.fragmentShader.replace(
    'gl_FragColor = vec4(flowColor, 1.0);',
    'float readingLuma = dot(pow(max(flowColor, vec3(0.0)), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722)); flowColor *= pow(0.12 / (0.12 + readingLuma), 1.0 / 2.2); gl_FragColor = vec4(flowColor, 1.0);',
  )
  field.material.depthTest = false
  field.material.depthWrite = false
  const quadGeometry = new THREE.PlaneGeometry(2, 2)
  const background = new THREE.Mesh(quadGeometry, field.material)
  background.frustumCulled = false
  background.renderOrder = -10
  scene.add(background, new THREE.AmbientLight(0xffffff, 1.1))
  const light = new THREE.DirectionalLight(0xe6f2ff, 1.4)
  light.position.set(-1, 1, 3); scene.add(light)
  const geometry = discGeometry()
  const hubGeometry = new THREE.RingGeometry(7.5, 15, 128)
  const rimGeometries = [7.6, 14.7, 59.8].map(radius => new THREE.TorusGeometry(radius, .16, 5, 128))
  function layer(order) {
    const group = new THREE.Group()
    const material = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: DISC_FRAGMENT,
      uniforms: { uArt: { value: null }, uArtIn: { value: 16.2 }, uPrintOut: { value: 59.1 }, uInkMetalness: { value: .9 }, uOpacity: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false,
    })
    const disc = new THREE.Mesh(geometry, material)
    disc.renderOrder = order
    const materials = [material]
    group.add(disc)
    // The physical trim stays constant while only the printed face dissolves.
    // Drawing two transparent hubs would brighten it midway through a song change.
    if (order === 1) {
      const hubMaterial = new THREE.MeshPhongMaterial({ color: 0xc5d3df, shininess: 100, transparent: true, opacity: .45, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
      const hub = new THREE.Mesh(hubGeometry, hubMaterial)
      hub.position.z = -1.18; hub.renderOrder = 7
      const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xd3e0e8, transparent: true, opacity: .7, depthTest: false, depthWrite: false })
      materials.push(hubMaterial, rimMaterial); group.add(hub)
      for (const rimGeometry of rimGeometries) {
        const rim = new THREE.Mesh(rimGeometry, rimMaterial)
        rim.position.z = -1.15; rim.renderOrder = 8; group.add(rim)
      }
    }
    group.visible = false; scene.add(group)
    return { group, material, materials }
  }
  const currentLayer = layer(1), incomingLayer = layer(4)
  let disposed = false, raf = 0, firstFrame = false, paletteKey = '', width = 1, height = 1
  let spin = { angle: 0, speed: 0 }, motionTime = 0
  const images = new Set()
  const sourceSettings = normalizeImmersiveBackground(backgroundSettings)
  const settings = resolveLiquidMetalBackgroundSettings({ settings: sourceSettings, active: false })
  function wake() { if (!disposed && !document.hidden && !raf) raf = requestAnimationFrame(tick) }
  const glass = createLiquidGlassPass(renderer, {
    accept: node => host.closest('.immersive-player')?.contains(node), invalidate: wake, dark: true, samples: 2,
  })
  function load(source) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'; images.add(image)
      image.onerror = () => { images.delete(image); reject(new Error('唱片封面暂不可用')) }
      image.onload = async () => {
        images.delete(image)
        try { await image.decode?.() } catch { /* onload already provides decoded pixels on older browsers. */ }
        if (disposed) { reject(new Error('Scene disposed')); return }
        const texture = new THREE.Texture(image)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
        texture.needsUpdate = true
        resolve({ texture, colors: readImmersivePalette(image) })
      }
      image.src = source
    })
  }
  let fallbackAttempted = false
  const artwork = createRecordArtwork({ load, release: value => value.texture.dispose(),
    publish({ current, incoming, mix }) {
      currentLayer.material.uniforms.uArt.value = current.value.texture
      currentLayer.group.visible = true
      incomingLayer.group.visible = Boolean(incoming)
      if (incoming) incomingLayer.material.uniforms.uArt.value = incoming.value.texture
      incomingLayer.material.uniforms.uOpacity.value = mix
      const next = incoming || current
      if (paletteKey !== next.key) {
        paletteKey = next.key
        onPalette?.(next.value.colors)
        const normalize = color => color.map(value => THREE.MathUtils.clamp(value / 255, 0, 1))
        field.setColors(Object.fromEntries(['base', 'primary', 'secondary', 'accent'].map(key => [key, normalize(next.value.colors[key])])), next.key)
        if (reduced.matches) field.step(settings.transitionDuration + .1, { settings }, canvas.width, canvas.height)
      }
      wake()
    },
    onError(_error, retained) {
      if (retained) return
      if (!fallbackAttempted) { fallbackAttempted = true; void artwork.set('/artwork/coast.webp') }
      else onFail()
    },
  })
  function layout() {
    const bounds = host.getBoundingClientRect(), target = slot.getBoundingClientRect()
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight)
    renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1, Math.sqrt(950_000 / (width * height))))
    renderer.setSize(width, height, false)
    glass.resize(canvas.width, canvas.height)
    camera.aspect = width / height; camera.updateProjectionMatrix()
    const unit = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(14)) / height
    const diameter = Math.min(target.width, target.height) * .96
    for (const { group } of [currentLayer, incomingLayer]) {
      group.position.set((target.left - bounds.left + target.width / 2 - width / 2) * unit,
        (height / 2 - target.top + bounds.top - target.height / 2) * unit, 0)
      group.scale.setScalar(diameter * unit / 120)
    }
    wake()
  }
  function tick(now) {
    raf = 0
    if (disposed || document.hidden) return
    const elapsed = clock.sample(now)
    if (elapsed === null) { wake(); return }
    const delta = Math.min(.1, elapsed)
    artwork.step(delta, reduced.matches)
    spin = advanceRecordSpin(spin, readPlaying(), delta, reduced.matches)
    currentLayer.group.rotation.z = incomingLayer.group.rotation.z = -spin.angle
    const recordVisible = readRecordVisible() && getComputedStyle(slot).visibility !== 'hidden'
    currentLayer.group.visible = Boolean(currentLayer.material.uniforms.uArt.value) && recordVisible
    incomingLayer.group.visible = Boolean(incomingLayer.material.uniforms.uArt.value) && incomingLayer.material.uniforms.uOpacity.value > 0 && recordVisible
    field.step(reduced.matches ? 0 : delta, { settings }, canvas.width, canvas.height)
    // Integrate speed changes instead of multiplying all elapsed time by the
    // newest speed. Dragging this slider must not jump the mineral field.
    if (!reduced.matches) motionTime += delta * settings.baseFlowSpeed / .022
    field.material.uniforms.uTime.value = motionTime
    const hasGlass = glass.prepare(delta, readGlassEnabled())
    renderer.setRenderTarget(hasGlass ? glass.input : null)
    renderer.render(scene, camera)
    if (hasGlass) glass.present()
    if (!firstFrame && currentLayer.material.uniforms.uArt.value) { firstFrame = true; onReady() }
    if (!reduced.matches || glass.moving()) wake()
  }
  const stopObservingLayout = observeRecordLayout(host, slot, layout)
  const visibility = () => { cancelAnimationFrame(raf); raf = 0; clock.reset(); wake() }
  const motionPreference = () => {
    // Stop at the current field phase; changing its speed uniform would jump
    // back to time zero. Settle any palette fade before drawing a static frame.
    if (reduced.matches) field.step(settings.transitionDuration + .1, { settings }, canvas.width, canvas.height)
    clock.reset(); wake()
  }
  const contextLost = event => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; onFail() }
  document.addEventListener('visibilitychange', visibility)
  reduced.addEventListener('change', motionPreference)
  canvas.addEventListener('webglcontextlost', contextLost)
  layout()
  return {
    redraw: wake,
    setBackgroundSettings(next) {
      Object.assign(settings, resolveLiquidMetalBackgroundSettings({ settings: normalizeImmersiveBackground(next), active: false }))
      wake()
    },
    setArtwork(source, key) {
      // A wrapped title can move the centered album without resizing its slot.
      layout()
      return artwork.set(source || '/artwork/coast.webp', key || source)
    },
    dispose() {
      if (disposed) return
      disposed = true; cancelAnimationFrame(raf); stopObservingLayout()
      document.removeEventListener('visibilitychange', visibility)
      reduced.removeEventListener('change', motionPreference)
      canvas.removeEventListener('webglcontextlost', contextLost)
      for (const image of images) { image.onload = image.onerror = null; image.src = '' }
      images.clear(); artwork.dispose()
      for (const item of [currentLayer, incomingLayer]) for (const material of item.materials) material.dispose()
      for (const item of [geometry, hubGeometry, ...rimGeometries, quadGeometry]) item.dispose()
      glass.dispose(); field.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    },
  }
}
