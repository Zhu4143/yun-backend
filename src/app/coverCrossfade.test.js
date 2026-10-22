import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoverCrossfade } from './coverCrossfade.js'

function harness(reducedMotion = false) {
  const images = [], rafs = new Map(), timers = new Map(), listeners = new Set()
  let id = 0
  const motion = {
    matches: reducedMotion,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  const host = {
    children: [],
    append(image) { this.children.push(image) },
    ownerDocument: { createElement() {
      const events = new Map()
      const image = {
        src: '', style: {}, onload: null, onerror: null,
        decode: async () => {},
        getBoundingClientRect: () => ({ width: 1280, height: 720 }),
        removeAttribute(name) { if (name === 'src') this.src = '' },
        addEventListener: (name, fn) => events.set(name, fn),
        removeEventListener: name => events.delete(name),
        remove() { host.children = host.children.filter(child => child !== this) },
        finish() { events.get('transitionend')?.({ target: this, propertyName: 'opacity' }) },
      }
      images.push(image)
      return image
    } },
  }
  const controller = createCoverCrossfade(host, { environment: {
    matchMedia: () => motion,
    requestAnimationFrame(fn) { rafs.set(++id, fn); return id },
    cancelAnimationFrame: key => rafs.delete(key),
    setTimeout(fn) { timers.set(++id, fn); return id },
    clearTimeout: key => timers.delete(key),
  } })
  return {
    controller, host, images, rafs, timers, listeners,
    async load(source) {
      controller.setCover(source)
      const image = images.at(-1)
      await image.onload()
      return image
    },
    paint() { const work = [...rafs.values()]; rafs.clear(); work.forEach(fn => fn()) },
    reduce() { motion.matches = true; [...listeners].forEach(fn => fn()) },
  }
}

test('a new cover starts transparent above the current image and retires it only after fading', async () => {
  const h = harness()
  const first = await h.load('/a.webp')
  h.paint(); first.finish()
  const next = await h.load('/b.webp')
  assert.deepEqual(h.host.children, [first, next])
  assert.equal(first.style.opacity, '1')
  assert.equal(next.style.opacity, '0')
  h.paint()
  assert.equal(next.style.opacity, '1')
  next.finish()
  assert.deepEqual(h.host.children, [next])
  assert.equal(h.timers.size, 0)
  h.controller.dispose()
})

test('an older decode completing after the newest request cannot replace it', async () => {
  const h = harness()
  h.controller.setCover('/slow.webp')
  const slow = h.images.at(-1)
  let resolveDecode
  slow.decode = () => new Promise(resolve => { resolveDecode = resolve })
  const oldLoad = slow.onload()
  const newest = await h.load('/new.webp')
  h.paint()
  resolveDecode()
  await oldLoad
  assert.deepEqual(h.host.children, [newest])
  h.controller.dispose()
})

test('rapid changes preserve the in-flight layers, cap them at three, and keep only the latest pending cover', async () => {
  const h = harness()
  const a = await h.load('/a.webp'); h.paint(); a.finish()
  const b = await h.load('/b.webp'); h.paint()
  const c = await h.load('/c.webp'); h.paint()
  const d = await h.load('/d.webp')
  const e = await h.load('/e.webp')
  assert.deepEqual(h.host.children, [a, b, c])
  assert.equal(b.style.opacity, '1')
  b.finish()
  assert.deepEqual(h.host.children, [b, c, e])
  assert.equal(h.host.children.includes(d), false)
  h.paint(); c.finish(); e.finish()
  assert.deepEqual(h.host.children, [e])
  h.controller.dispose()
})

test('a failed new image and failed fallback leave the previous background visible', async () => {
  const h = harness()
  const current = await h.load('/a.webp'); h.paint(); current.finish()
  h.controller.setCover('/broken.webp')
  const broken = h.images.at(-1)
  broken.onerror()
  assert.equal(broken.src, '/artwork/coast.webp')
  broken.onerror()
  assert.deepEqual(h.host.children, [current])
  assert.equal(current.style.opacity, '1')
  h.controller.dispose()
})

test('same-cover updates do not reload or restart a fade', async () => {
  const h = harness()
  const current = await h.load('/a.webp'); h.paint()
  h.controller.setCover('/a.webp')
  assert.equal(h.images.length, 1)
  assert.deepEqual(h.host.children, [current])
  h.controller.dispose()
})

test('reduced motion settles directly and can finish an interrupted pending transition', async () => {
  const h = harness()
  const a = await h.load('/a.webp'); h.paint(); a.finish()
  await h.load('/b.webp'); h.paint()
  await h.load('/c.webp'); h.paint()
  const latest = await h.load('/latest.webp')
  h.reduce()
  assert.deepEqual(h.host.children, [latest])
  assert.equal(latest.style.opacity, '1')
  assert.equal(h.rafs.size, 0)
  assert.equal(h.timers.size, 0)
  const next = await h.load('/no-motion.webp')
  assert.deepEqual(h.host.children, [next])
  assert.equal(h.rafs.size, 0)
  h.controller.dispose()
})

test('timeout cleanup retires the covered layer if transitionend is not delivered', async () => {
  const h = harness()
  const a = await h.load('/a.webp'); h.paint(); a.finish()
  const b = await h.load('/b.webp'); h.paint()
  for (const callback of [...h.timers.values()]) callback()
  assert.deepEqual(h.host.children, [b])
  assert.equal(h.timers.size, 0)
  h.controller.dispose()
})

test('dispose cancels loading, scheduled starts and cleanup callbacks', async () => {
  const h = harness()
  await h.load('/a.webp')
  h.controller.setCover('/loading.webp')
  const loading = h.images.at(-1)
  h.controller.dispose()
  assert.equal(loading.onload, null)
  assert.equal(loading.src, '')
  assert.equal(h.host.children.length, 0)
  assert.equal(h.rafs.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
  h.controller.setCover('/after-dispose.webp')
  assert.equal(h.images.length, 2)
})
