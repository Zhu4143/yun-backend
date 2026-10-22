import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommentAutoScroll } from './commentAutoScroll.js'

function reader({ height = 1000, viewport = 200 } = {}) {
  let top = 0, nextId = 0, now = 0, ends = 0
  const frames = new Map()
  const element = { scrollHeight: height, clientHeight: viewport, get scrollTop() { return top }, set scrollTop(value) { top = Math.round(value) } }
  const controller = createCommentAutoScroll(element, {
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id },
    cancelFrame(id) { frames.delete(id) },
    onEnd() { ends++ },
  })
  const advance = ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      now += 16
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(now))
    }
  }
  const jump = ms => {
    now += ms
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(now))
  }
  return { element, controller, advance, jump, pending: () => frames.size, ends: () => ends }
}

test('comments allow reading first, then scroll slowly despite integer scrollTop', () => {
  const f = reader()
  f.advance(2100)
  assert.equal(f.element.scrollTop, 0)
  f.advance(2100)
  assert.ok(f.element.scrollTop > 12 && f.element.scrollTop < 25)
  f.controller.destroy()
  assert.equal(f.pending(), 0)
})

test('manual reading wins over hover leave and resumes at the reader position', () => {
  const f = reader()
  f.advance(6000)
  f.controller.setPaused('hover', true)
  f.controller.setPaused('manual', true)
  f.element.scrollTop = 350
  f.controller.setPaused('hover', false)
  assert.equal(f.pending(), 0)
  f.advance(10000)
  assert.equal(f.element.scrollTop, 350)
  f.controller.setPaused('manual', false)
  f.advance(2000)
  assert.equal(f.element.scrollTop, 350)
  f.advance(2000)
  assert.ok(f.element.scrollTop > 350 && f.element.scrollTop < 375)
  f.controller.destroy()
})

test('visibility and focus pauses compose, with no catch-up jump after a long absence', () => {
  const f = reader()
  f.advance(6000)
  const before = f.element.scrollTop
  f.controller.setPaused('hidden', true)
  f.controller.setPaused('window', true)
  f.advance(60000)
  f.controller.setPaused('hidden', false)
  assert.equal(f.pending(), 0)
  f.controller.setPaused('window', false)
  f.advance(2200)
  assert.equal(f.element.scrollTop, before)
  f.controller.destroy()
  f.controller.setPaused('window', false)
  assert.equal(f.pending(), 0)
})

test('the bottom stops once and only an explicit restart returns to the beginning', () => {
  const f = reader({ height: 250 })
  f.advance(20000)
  assert.equal(f.element.scrollTop, 50)
  assert.equal(f.ends(), 1)
  assert.equal(f.pending(), 0)
  f.controller.setPaused('hover', false)
  assert.equal(f.pending(), 0)
  f.controller.restartIfEnded()
  assert.equal(f.element.scrollTop, 0)
  f.advance(2100)
  assert.equal(f.element.scrollTop, 0)
  f.controller.destroy()
})

test('short comments do not keep an idle animation running', () => {
  const f = reader({ height: 100 })
  f.advance(4000)
  assert.equal(f.element.scrollTop, 0)
  assert.equal(f.pending(), 0)
  assert.equal(f.ends(), 1)
})

test('a delayed browser frame finishes the reading delay without a large scroll jump', () => {
  const f = reader()
  f.advance(16)
  f.jump(5000)
  assert.ok(f.element.scrollTop <= 1)
  f.advance(1000)
  assert.ok(f.element.scrollTop >= 10 && f.element.scrollTop < 15)
  f.controller.setPaused('hover', false)
  const before = f.element.scrollTop
  f.advance(1000)
  assert.ok(f.element.scrollTop > before + 10, 'an unchanged pause reason must not restart the reading delay')
  f.controller.destroy()
})
