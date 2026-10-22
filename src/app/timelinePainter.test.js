import test from 'node:test'
import assert from 'node:assert/strict'
import { createTimelinePainter } from './timelinePainter.js'
import { createCrossfadeTimeline } from '../player/playback/crossfadeTimeline.js'

const deck = (currentTime = 20, duration = 200) => Object.assign(new EventTarget(), { currentTime, duration, paused: false, ended: false })
function setup(options = {}) {
  let id = 0, writes = 0
  const queue = new Map(), values = new Map(), media = deck()
  const controller = createTimelinePainter({
    node: { style: { setProperty: (key, value) => { values.set(key, value); writes++ } } },
    readMedia: () => media, readPosition: () => ({ time: 0, duration: 0 }),
    requestFrame: callback => { queue.set(++id, callback); return id }, cancelFrame: key => queue.delete(key),
    ...options,
  })
  return { media, controller, queue, progress: () => Number(values.get('--range-ratio')), writes: () => writes,
    step() { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback()) } }
}

test('the rail advances on each display frame between low-frequency timeupdate events', () => {
  const h = setup(), positions = []
  for (let i = 1; i <= 60; i++) {
    h.media.currentTime = 20 + i / 60
    h.step()
    positions.push(h.progress())
  }
  assert.equal(new Set(positions).size, 60)
  assert.equal(positions.at(-1), 21 / 200)
  assert.ok(positions.every((position, i) => !i || position > positions[i - 1]))
  h.controller.dispose()
})

test('buffering never invents progress; pausing and seeking paint immediately without easing', () => {
  const h = setup(), writes = h.writes()
  for (let i = 0; i < 60; i++) h.step()
  assert.equal(h.progress(), .1)
  assert.equal(h.writes(), writes, 'a frozen media clock does not repaint the rail')
  h.media.paused = true; h.media.dispatchEvent(new Event('pause'))
  assert.equal(h.queue.size, 0)
  h.media.currentTime = 150; h.media.dispatchEvent(new Event('seeking'))
  assert.equal(h.progress(), .75)
  h.media.currentTime = 5; h.media.dispatchEvent(new Event('seeked'))
  assert.equal(h.progress(), .025)
  assert.equal(h.queue.size, 0)
  h.media.paused = false; h.media.playbackRate = 2; h.media.dispatchEvent(new Event('playing'))
  h.media.currentTime = 5.04; h.step()
  assert.equal(h.progress(), 5.04 / 200, 'playback rate is already reflected in the real media clock')
  h.media.ended = true; h.media.currentTime = 200; h.media.dispatchEvent(new Event('ended'))
  assert.equal(h.progress(), 1)
  assert.equal(h.queue.size, 0)
  h.controller.dispose()
})

test('crossfade progress follows the announced target before deck promotion, then the active deck', () => {
  const outgoing = deck(190, 200), incoming = deck(.5, 100)
  let active = outgoing
  const timeline = createCrossfadeTimeline({ onTime() {}, onDuration() {}, readActiveMedia: () => active })
  const h = setup({ readMedia: timeline.getMedia })
  assert.equal(h.progress(), .95)
  timeline.follow(incoming); h.controller.refresh()
  assert.equal(h.progress(), .005)
  incoming.currentTime = .52; h.step()
  assert.equal(h.progress(), .0052)
  active = incoming; timeline.clear(); h.controller.refresh()
  incoming.currentTime = .54; h.step()
  assert.equal(h.progress(), .0054)
  incoming.currentTime = 10; outgoing.dispatchEvent(new Event('timeupdate'))
  assert.equal(h.progress(), .0054, 'retired deck listeners have been removed')
  h.controller.dispose()
})

test('hidden timelines stop frames, resume at the actual position, and release listeners on disposal', () => {
  let visible = true
  const h = setup({ visible: () => visible })
  visible = false; h.controller.refresh()
  assert.equal(h.queue.size, 0)
  h.media.currentTime = 40; h.media.dispatchEvent(new Event('timeupdate'))
  assert.equal(h.progress(), .1)
  visible = true; h.controller.refresh()
  assert.equal(h.progress(), .2)
  assert.equal(h.queue.size, 1)
  h.controller.dispose()
  h.media.currentTime = 50; h.media.dispatchEvent(new Event('play')); h.controller.refresh()
  assert.equal(h.progress(), .2)
  assert.equal(h.queue.size, 0)
})

test('restored metadata paints once without a deck and invalid positions stay bounded', () => {
  let position = { time: 12, duration: 60 }
  const h = setup({ readMedia: () => null, readPosition: () => position })
  assert.equal(h.progress(), .2)
  assert.equal(h.queue.size, 0)
  for (const [time, duration, expected] of [[-1, 60, 0], [90, 60, 1], [NaN, 60, 0], [12, Infinity, 0], [12, 0, 0]]) {
    position = { time, duration }; h.controller.refresh()
    assert.equal(h.progress(), expected)
  }
  h.controller.dispose()
})
