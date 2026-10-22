import * as THREE from 'three'
import { LIQUID_ORE_MAX_CARDS, LIQUID_ORE_GLASS_FRAGMENT_SHADER, LIQUID_ORE_BLUR_FRAGMENT_SHADER, LIQUID_ORE_GLASS_DEFAULTS, liquidOreGlassState } from '../components/liquidOreSource.js'
import { opticalCard } from '../skins/cd-case/opticalSurfaceGeometry.js'
import { advanceGlassSpring, glassSpringMoving } from './glassInteraction.js'

export const GLASS_VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`
const SURFACE = '[data-yun-glass="surface"]'

/** The original Liquid Ore shader, with visible DOM rectangles as its inputs.
 * Layout/text stay in the DOM. No DOM screenshot, SVG filter or particle pass. */
export function createLiquidGlassPass(renderer, { accept, invalidate, dark = false, readNight = () => dark ? 1 : 0, samples = 0 }) {
  const geometry = new THREE.PlaneGeometry(2, 2)
  const camera = new THREE.Camera()
  const input = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false })
  input.samples = Math.min(samples, renderer.capabilities.maxSamples)
  const blurredX = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  const blurredY = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  const materials = []
  const pass = (fragmentShader, uniforms, defines = {}) => {
    const material = new THREE.ShaderMaterial({ vertexShader: GLASS_VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false })
    materials.push(material)
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false; scene.add(mesh)
    return { scene, material }
  }
  const blur = (texture, x, y) => pass(LIQUID_ORE_BLUR_FRAGMENT_SHADER, {
    uTex: { value: texture }, uDir: { value: new THREE.Vector2(x, y) },
    uTexel: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 4 },
  })
  const horizontal = blur(input.texture, 1, 0), vertical = blur(blurredX.texture, 0, 1)
  const uniforms = {
    uScene: { value: input.texture }, uBlurred: { value: blurredY.texture },
    uResolution: { value: new THREE.Vector2(1, 1) }, uCardCount: { value: 0 },
    uCards: { value: Array.from({ length: LIQUID_ORE_MAX_CARDS }, () => new THREE.Vector4()) },
    uCardRadius: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uPointer: { value: new THREE.Vector2(-100000, -100000) },
    uHover: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uMorphEnergy: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uMorphDir: { value: Array.from({ length: LIQUID_ORE_MAX_CARDS }, () => new THREE.Vector2(0, 1)) },
    // Panels can keep reading contrast while controls opt out of body tint.
    uBodyColor: { value: new THREE.Color(dark ? .065 : .87, dark ? .085 : .93, dark ? .12 : .96) },
    uBodyOpacity: { value: dark ? .72 : .08 },
    uCardBodyOpacity: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
  }
  const settingKeys = {
    uRefractionHeight: 'refractionHeight', uRefractionAmount: 'refractionAmount', uChromatic: 'chromatic',
    uSaturation: 'saturation', uTint: 'tint', uSpecular: 'specular', uShadow: 'shadow',
    uEdgeWidth: 'edgeWidth', uHoverGlow: 'hoverGlow', uHoverScale: 'hoverScale', uHoverRefract: 'hoverRefract',
  }
  for (const [name, key] of Object.entries(settingKeys)) uniforms[name] = { value: liquidOreGlassState[key] }
  const glass = pass(LIQUID_ORE_GLASS_FRAGMENT_SHADER, uniforms, { LIQUID_ORE_BODY_TINT: 1, LIQUID_ORE_CARD_BODY_OPACITY: 1 })
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const springs = new WeakMap(), painted = new Set(), observed = new Set(), transitions = new Set()
  let width = 1, height = 1, records = [], dirty = true, moving = false, disposed = false
  let hovered = null, pressed = null, pointer = { x: -100000, y: -100000 }
  const queue = () => { if (!disposed) invalidate() }
  const markDirty = () => { dirty = true; queue() }
  const relevant = target => {
    const node = target instanceof Element ? target.closest(SURFACE) : null
    return node && accept(node) ? node : null
  }
  const move = event => {
    const next = event.pointerType === 'touch' ? null : relevant(event.target)
    if (!next && !hovered && !pressed) return
    pointer = { x: event.clientX, y: event.clientY }; hovered = next; queue()
  }
  const down = event => { pressed = relevant(event.target); if (pressed) { pointer = { x: event.clientX, y: event.clientY }; queue() } }
  const up = () => { if (pressed) { pressed = null; queue() } }
  const leave = () => { hovered = pressed = null; queue() }
  const motionStart = event => {
    if (relevant(event.target) || [...event.target.querySelectorAll?.(SURFACE) || []].some(accept)) {
      transitions.add(event.target); queue()
    }
  }
  const motionEnd = event => { if (transitions.delete(event.target)) queue() }
  const resizeObserver = new ResizeObserver(markDirty)
  const observer = new MutationObserver(changes => {
    if (changes.some(change => change.type === 'childList'
      ? [...change.addedNodes, ...change.removedNodes].some(node => node.nodeType === 1)
      : change.target.matches?.(`${SURFACE}, .music-app, .music-dialog, .immersive-player`))) markDirty()
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-yun-glass'] })
  document.addEventListener('pointermove', move, { passive: true })
  document.addEventListener('pointerdown', down, { passive: true })
  document.addEventListener('pointerup', up, { passive: true })
  document.addEventListener('pointercancel', up, { passive: true })
  document.documentElement.addEventListener('pointerleave', leave)
  document.addEventListener('scroll', markDirty, { passive: true, capture: true })
  for (const type of ['transitionrun', 'animationstart']) document.addEventListener(type, motionStart, true)
  for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) document.addEventListener(type, motionEnd, true)
  reduced.addEventListener('change', markDirty)
  function scan() {
    records = [...document.querySelectorAll(SURFACE)].filter(node => accept(node) && !node.parentElement?.closest(SURFACE))
      .flatMap(node => {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return []
        const clips = [], ancestors = []
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const ancestor = getComputedStyle(parent)
          if (ancestor.display === 'none' || ancestor.visibility === 'hidden') return []
          ancestors.push(parent)
          if (/(hidden|clip|scroll|auto)/.test(`${ancestor.overflowX} ${ancestor.overflowY}`)) clips.push(parent)
        }
        if (!observed.has(node)) { resizeObserver.observe(node); observed.add(node) }
        const radius = parseFloat(style.borderRadius)
        return [{ node, radius: Number.isFinite(radius) ? Math.max(0, radius) : 26, clips, ancestors }]
      })
    const visible = new Set(records.map(record => record.node))
    for (const node of observed) if (!visible.has(node)) { resizeObserver.unobserve(node); observed.delete(node) }
    dirty = false
  }
  const clearPaint = except => {
    for (const node of painted) if (!except?.has(node)) { delete node.dataset.glassSource; node.dataset.glassMode = 'fallback'; painted.delete(node) }
  }
  return {
    input,
    resize(w, h) {
      width = w; height = h
      input.setSize(w, h)
      const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1)
      blurredX.setSize(bw, bh); blurredY.setSize(bw, bh)
      horizontal.material.uniforms.uTexel.value.set(1 / bw, 1 / bh)
      vertical.material.uniforms.uTexel.value.set(1 / bw, 1 / bh)
      uniforms.uResolution.value.set(w, h); markDirty()
    },
    prepare(delta, enabled = true) {
      if (!enabled) { uniforms.uCardCount.value = 0; moving = false; clearPaint(); return false }
      if (dirty) scan()
      const night = Math.max(0, Math.min(1, readNight()))
      if (!dark) {
        uniforms.uBodyColor.value.setRGB(THREE.MathUtils.lerp(.87,.05,night), THREE.MathUtils.lerp(.93,.085,night), THREE.MathUtils.lerp(.96,.13,night))
        uniforms.uBodyOpacity.value = THREE.MathUtils.lerp(.08,.04,night)
      }
      const bounds = renderer.domElement.getBoundingClientRect(), present = new Set(), copies = []
      let count = 0
      moving = false; uniforms.uHover.value.fill(0)
      for (const { node, radius, clips, ancestors } of records) {
        if ([node, ...ancestors].some(parent => Number(getComputedStyle(parent).opacity) < .05)) continue
        const card = opticalCard(node.getBoundingClientRect(), bounds, { width, height }, radius, clips.map(parent => parent.getBoundingClientRect()))
        if (!card || count === LIQUID_ORE_MAX_CARDS) continue
        const target = pressed === node ? 1.08 : hovered === node ? 1 : 0
        const spring = advanceGlassSpring(springs.get(node) || { progress: 0, velocity: 0 }, delta, target, reduced.matches)
        springs.set(node, spring); moving ||= glassSpringMoving(spring, target)
        uniforms.uCards.value[count].set(card.x, card.y, card.halfWidth, card.halfHeight)
        uniforms.uCardRadius.value[count] = card.radius
        uniforms.uHover.value[count] = Math.max(0, Math.min(1.12, spring.progress))
        const bodyOpacity = Number.parseFloat(getComputedStyle(node).getPropertyValue('--glass-tint-opacity'))
        uniforms.uCardBodyOpacity.value[count] = Math.max(0, Math.min(1,
          Number.isFinite(bodyOpacity) ? bodyOpacity : uniforms.uBodyOpacity.value))
        copies.push({ node, rect: node.getBoundingClientRect(), radius: card.radius, hover: uniforms.uHover.value[count] })
        present.add(node); count++
      }
      uniforms.uCardCount.value = count
      const sx = width / Math.max(1, bounds.width), sy = height / Math.max(1, bounds.height), ratio = (sx + sy) / 2
      uniforms.uPointer.value.set((pointer.x - bounds.left) * sx, (bounds.bottom - pointer.y) * sy)
      for (const [name, key] of Object.entries(settingKeys)) uniforms[name].value = liquidOreGlassState[key]
        * (['refractionHeight', 'refractionAmount', 'edgeWidth'].includes(key) ? ratio : 1)
      // Keep the source spring, with only a subtle lift in the music UI.
      uniforms.uHoverScale.value = Math.min(uniforms.uHoverScale.value, LIQUID_ORE_GLASS_DEFAULTS.hoverScale)
      uniforms.uSpecular.value *= 1 - night * .55
      uniforms.uHoverGlow.value *= 1 - night * .6
      if (reduced.matches) { uniforms.uHoverScale.value = 0; uniforms.uHoverRefract.value = 0 }
      horizontal.material.uniforms.uRadius.value = vertical.material.uniforms.uRadius.value = liquidOreGlassState.frost
      clearPaint(present)
      // Apply the CSS handoff only after present() has drawn these bodies.
      this.pendingPaint = present
      this.pendingCopies = { copies, bounds, sx, sy }
      return count > 0
    },
    moving() {
      for (const node of transitions) if (!node.isConnected) transitions.delete(node)
      return moving || transitions.size > 0
    },
    present() {
      const frost = liquidOreGlassState.frost > 0
      if (frost) {
        renderer.setRenderTarget(blurredX); renderer.render(horizontal.scene, camera)
        renderer.setRenderTarget(blurredY); renderer.render(vertical.scene, camera)
      }
      uniforms.uBlurred.value = frost ? blurredY.texture : input.texture
      renderer.setRenderTarget(null); renderer.render(glass.scene, camera)
      // A source shader can only sample its scene, not DOM lettering. Copy its
      // optical result behind each surface's text so workspace backgrounds and
      // modal backdrops cannot occlude it. These are small 2D copies, sharing
      // this one WebGL renderer and its event-driven clock.
      const { copies = [], bounds, sx, sy } = this.pendingCopies || {}
      for (const { node, rect, radius, hover } of copies) {
        const canvas = node.querySelector?.(':scope > .glass-optical-canvas')
        const context = canvas?.getContext('2d')
        if (!context) continue
        const padding = Math.ceil(Math.max(rect.width, rect.height) * uniforms.uHoverScale.value * .6 + 4)
        const w = Math.max(1, Math.ceil((rect.width + padding * 2) * sx)), h = Math.max(1, Math.ceil((rect.height + padding * 2) * sy))
        if (canvas.width !== w) canvas.width = w
        if (canvas.height !== h) canvas.height = h
        canvas.style.left = canvas.style.top = `${-padding}px`
        canvas.style.width = `${rect.width + padding * 2}px`; canvas.style.height = `${rect.height + padding * 2}px`
        const scale = 1 + uniforms.uHoverScale.value * hover
        const mw = rect.width * sx * scale, mh = rect.height * sy * scale
        context.clearRect(0, 0, w, h); context.save(); context.beginPath()
        context.roundRect((w - mw) / 2, (h - mh) / 2, mw, mh, Math.min(radius * scale, mw / 2, mh / 2))
        context.clip()
        context.drawImage(renderer.domElement, (rect.left - bounds.left - padding) * sx, (rect.top - bounds.top - padding) * sy,
          (rect.width + padding * 2) * sx, (rect.height + padding * 2) * sy, 0, 0, w, h)
        context.restore()
      }
      for (const node of this.pendingPaint || []) { node.dataset.glassSource = 'liquid-ore'; node.dataset.glassMode = 'original'; painted.add(node) }
    },
    dispose() {
      if (disposed) return
      disposed = true; clearPaint(); observer.disconnect(); resizeObserver.disconnect()
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up)
      document.documentElement.removeEventListener('pointerleave', leave)
      document.removeEventListener('scroll', markDirty, true); reduced.removeEventListener('change', markDirty)
      for (const type of ['transitionrun', 'animationstart']) document.removeEventListener(type, motionStart, true)
      for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) document.removeEventListener(type, motionEnd, true)
      geometry.dispose(); for (const material of materials) material.dispose()
      for (const target of [input, blurredX, blurredY]) target.dispose()
    },
  }
}
