import test from 'node:test'
import assert from 'node:assert/strict'
import { observeRecordLayout } from './recordLayout.js'

function fixture() {
  const root = {}, stage = {}, album = { parentElement: stage }
  const host = { closest: () => root }, slot = { parentElement: album }
  const bounds = { left: 170, top: 94, width: 274, height: 274 }
  let drawn, draws = 0
  const resizes = [], mutations = []
  class Resize {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); resizes.push(this) }
    observe(node) { this.nodes.add(node) }
    disconnect() { this.nodes.clear() }
  }
  class Mutation {
    constructor(callback) { this.callback = callback; this.nodes = new Map(); mutations.push(this) }
    observe(node, options) { this.nodes.set(node, options) }
    disconnect() { this.nodes.clear() }
  }
  const layout = () => { drawn = { ...bounds }; draws++ }
  const stop = observeRecordLayout(host, slot, layout, { ResizeObserver: Resize, MutationObserver: Mutation })
  layout()
  return { root, album, bounds, stop, drawn: () => drawn, draws: () => draws,
    resize(node) { resizes.filter(observer => observer.nodes.has(node)).forEach(observer => observer.callback()) },
    mutate(node, attributeName) {
      mutations.filter(observer => observer.nodes.get(node)?.attributeFilter.includes(attributeName)).forEach(observer => observer.callback())
    },
  }
}

test('queue open and close repositions the disc even when every observed box keeps the same size', () => {
  const h = fixture()
  for (const left of [338, 170, 338, 170]) {
    h.bounds.left = left
    // CSS grid columns change with the root class, without a resize event.
    h.mutate(h.root, 'class')
    assert.equal(h.drawn().left, left)
    assert.equal(h.drawn().width, 274)
  }
  h.stop()
})

test('a taller album moves its unchanged slot; unrelated attributes and disposed observers do not redraw', () => {
  const h = fixture()
  h.bounds.top = 75
  h.resize(h.album)
  assert.equal(h.drawn().top, 75)
  assert.equal(h.drawn().height, 274)
  const draws = h.draws()
  h.mutate(h.root, 'aria-label')
  assert.equal(h.draws(), draws)
  h.stop()
  h.bounds.left = 600
  h.resize(h.album); h.mutate(h.root, 'class')
  assert.equal(h.draws(), draws)
})
