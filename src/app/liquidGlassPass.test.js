import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiquidGlassPass } from './liquidGlassPass.js'
import { liquidOreGlassState } from '../components/liquidOreSource.js'

function fixture(options = {}) {
  const previous = new Map(['document', 'Element', 'getComputedStyle', 'matchMedia', 'ResizeObserver', 'MutationObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const listeners = new Map(), mutations = [], resizes = [], draws = []
  const eventTarget = () => ({ addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) })
  class Element {
    constructor(parentElement, surface = false) {
      this.parentElement = parentElement; this.surface = surface; this.dataset = {}; this.isConnected = true
      this.style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', borderRadius: '24px' }
      this.style.getPropertyValue = name => this.style[name] || ''
    }
    closest() { for (let node = this; node; node = node.parentElement) if (node.surface) return node; return null }
    matches() { return this.surface }
    querySelectorAll() { return [] }
    getBoundingClientRect() { return this.parentElement ? { left: 40, right: 240, top: 40, bottom: 120, width: 200, height: 80 } : { left: 0, right: 640, top: 0, bottom: 360, width: 640, height: 360 } }
  }
  const body = new Element(null), root = new Element(body, true), nested = new Element(root, true), hidden = new Element(body, true)
  hidden.style.display = 'none'
  const preference = { matches: false, ...eventTarget() }
  Object.assign(globalThis, {
    Element, document: { body, documentElement: eventTarget(), querySelectorAll: () => [root, nested, hidden], ...eventTarget() },
    getComputedStyle: node => node.style, matchMedia: () => preference,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.observations = 0; resizes.push(this) }
      observe() { this.observations++ }
      unobserve() {}
      disconnect() { this.disconnected = true }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutations.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
    },
  })
  let wakes = 0
  const renderer = { capabilities: { maxSamples: 4 }, domElement: { getBoundingClientRect: () => body.getBoundingClientRect() }, setRenderTarget() {}, render: scene => draws.push(scene.children[0].material) }
  const pass = createLiquidGlassPass(renderer, { accept: () => true, invalidate: () => wakes++, ...options })
  pass.resize(640, 360)
  return { pass, body, root, hidden, draws, listeners, preference, mutations, resizes, wakes: () => wakes,
    restore() {
      pass.dispose()
      for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]
    },
  }
}

test('fading-in ancestors recover without a new surface registration; only outer bodies render', () => {
  const f = fixture()
  try {
    f.body.style.opacity = '0'
    assert.equal(f.pass.prepare(1 / 60), false)
    f.body.style.opacity = '1'
    assert.equal(f.pass.prepare(1 / 60), true)
    assert.equal(f.root.dataset.glassSource, undefined)
    f.pass.present()
    assert.equal(f.draws.at(-1).uniforms.uCardCount.value, 1)
    assert.equal(f.root.dataset.glassSource, 'liquid-ore')
    assert.equal(f.root.dataset.glassMode, 'original')
    const observed = f.resizes[0].observations
    f.mutations[0].callback([{ type: 'attributes', target: f.root }])
    f.pass.prepare(1 / 60)
    assert.equal(f.resizes[0].observations, observed, 'rescanning must not re-observe unchanged bodies and create an idle loop')
  } finally { f.restore() }
})

test('pointer input drives the original hover uniforms and stops after release', () => {
  const f = fixture()
  try {
    f.pass.prepare(1 / 60); f.pass.present()
    const uniforms = f.draws.at(-1).uniforms
    f.listeners.get('pointermove')({ target: f.root, pointerType: 'mouse', clientX: 120, clientY: 70 })
    let peak = 0
    for (let i = 0; i < 90; i++) { f.pass.prepare(1 / 60); peak = Math.max(peak, uniforms.uHover.value[0]) }
    assert.ok(peak > 1.02)
    assert.equal(uniforms.uHoverRefract.value, .55)
    f.listeners.get('pointermove')({ target: f.body, pointerType: 'mouse', clientX: 400, clientY: 200 })
    for (let i = 0; i < 150; i++) f.pass.prepare(1 / 60)
    assert.equal(uniforms.uHover.value[0], 0)
    assert.equal(f.pass.moving(), false)
    f.preference.matches = true
    f.listeners.get('pointerdown')({ target: f.root, clientX: 100, clientY: 70 })
    f.pass.prepare(1 / 60)
    assert.ok(Math.abs(uniforms.uHover.value[0] - 1.08) < .00001)
    assert.equal(uniforms.uHoverScale.value, 0)
    assert.equal(f.pass.moving(), false)
  } finally { f.restore() }
})

test('transparent controls do not inherit the dark panel tint, including after hover', () => {
  const f = fixture({ dark: true })
  try {
    f.root.style['--glass-tint-opacity'] = '0'
    f.pass.prepare(1 / 60); f.pass.present()
    const uniforms = f.draws.at(-1).uniforms
    assert.equal(uniforms.uBodyOpacity.value, .72, 'reading panels retain their contrast default')
    assert.equal(uniforms.uCardBodyOpacity.value[0], 0, 'explicit zero must override the dark default')
    f.listeners.get('pointermove')({ target: f.root, pointerType: 'mouse', clientX: 120, clientY: 70 })
    for (let i = 0; i < 30; i++) f.pass.prepare(1 / 60)
    assert.ok(uniforms.uHover.value[0] > .9)
    assert.equal(uniforms.uCardBodyOpacity.value[0], 0)
    delete f.root.style['--glass-tint-opacity']
    f.pass.prepare(1 / 60)
    assert.ok(Math.abs(uniforms.uCardBodyOpacity.value[0] - .72) < .00001)
  } finally { f.restore() }
})

test('an edge-aligned square drawer keeps zero corner radius in the optical pass', () => {
  const f = fixture({ dark: true })
  try {
    f.root.style.borderRadius = '0px'
    f.root.style['--glass-tint-opacity'] = '0'
    f.pass.prepare(1 / 60); f.pass.present()
    const uniforms = f.draws.at(-1).uniforms
    assert.equal(uniforms.uCardRadius.value[0], 0)
    assert.equal(uniforms.uCardBodyOpacity.value[0], 0)
  } finally { f.restore() }
})

test('disable and dispose restore the DOM fallback and release GPU resources once', () => {
  const f = fixture()
  try {
    f.pass.prepare(1 / 60); f.pass.present()
    let releases = 0
    f.pass.input.addEventListener('dispose', () => releases++)
    assert.equal(f.pass.prepare(1 / 60, false), false)
    assert.equal(f.root.dataset.glassSource, undefined)
    assert.equal(f.root.dataset.glassMode, 'fallback')
    f.pass.prepare(1 / 60); f.pass.present()
    f.pass.dispose(); f.pass.dispose()
    assert.equal(f.root.dataset.glassSource, undefined)
    assert.equal(releases, 1)
    assert.equal(f.listeners.size, 0)
    assert.ok(f.resizes[0].disconnected && f.mutations[0].disconnected)
  } finally { f.restore() }
})

test('every outer surface has subtle hover growth even with a legacy large setting', () => {
  const previous = liquidOreGlassState.hoverScale, f = fixture()
  try {
    liquidOreGlassState.hoverScale = .12
    f.hidden.style.display = 'block'
    f.pass.prepare(1 / 60); f.pass.present()
    const u = f.draws.at(-1).uniforms
    assert.equal(u.uCardCount.value, 2)
    for (const root of [f.root, f.hidden]) {
      f.listeners.get('pointermove')({ target: root, pointerType: 'mouse', clientX: 120, clientY: 70 })
      for (let i = 0; i < 90; i++) {
        f.pass.prepare(1 / 60)
        for (let card = 0; card < 2; card++) assert.ok(u.uHoverScale.value * u.uHover.value[card] < .01)
      }
    }
  } finally { liquidOreGlassState.hoverScale = previous; f.restore() }
})

test('night materials follow theme changes without replacing the renderer or obscuring content', () => {
  let night = 0
  const f = fixture({ readNight: () => night })
  try {
    f.pass.prepare(1 / 60); f.pass.present()
    const u = f.draws.at(-1).uniforms, dayColor = u.uBodyColor.value.clone(), daySpecular = u.uSpecular.value
    night = 1
    f.pass.prepare(1 / 60); f.pass.present()
    assert.ok(u.uBodyColor.value.r < dayColor.r / 2)
    assert.ok(u.uBodyOpacity.value < .1)
    assert.ok(u.uSpecular.value < daySpecular)
    assert.equal(f.root.dataset.glassSource, 'liquid-ore')
    night = 0
    f.pass.prepare(1 / 60)
    assert.deepEqual(u.uBodyColor.value.toArray(), dayColor.toArray())
  } finally { f.restore() }
})

test('the finished shader is copied behind DOM content with a rounded transparent exterior', () => {
  const f = fixture(), calls = []
  try {
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ({
      clearRect() {}, save() {}, beginPath() {}, restore() {},
      roundRect: (...args) => calls.push(['round', ...args]),
      clip: () => calls.push(['clip']), drawImage: () => calls.push(['copy', f.draws.length]),
    }) }
    f.root.querySelector = () => canvas
    f.pass.prepare(1 / 60); f.pass.present()
    assert.deepEqual(calls.map(call => call[0]), ['round', 'clip', 'copy'])
    assert.equal(calls.at(-1)[1], 3, 'copy must follow both blur passes and the final glass pass')
    assert.ok(canvas.width > 200 && canvas.height > 80)
    assert.equal(f.root.dataset.glassSource, 'liquid-ore')
  } finally { f.restore() }
})
