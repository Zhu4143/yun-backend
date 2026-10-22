import test from 'node:test'
import assert from 'node:assert/strict'
import { createLyricPainter, lyricColors, lyricGlyphs, lyricInterval, lyricProgress } from './lyricEffects.js'
import { LYRIC_EFFECT_DEFAULTS } from '../../server/visuals/lyricEffectsSchema.js'

test('line timing handles seeks, offsets, translations and the final line', () => {
  const lines = [{ time: 10 }, { time: 10 }, { time: 14 }, { time: 19 }]
  const interval = lyricInterval(lines, 0, 25)
  assert.deepEqual(interval, { start: 10, end: 14 })
  assert.deepEqual(lyricInterval(lines, 1, 25), interval)
  assert.equal(lyricProgress(12, interval), .5)
  assert.equal(lyricProgress(7, interval), 0)
  assert.equal(lyricProgress(20, interval), 1)
  assert.equal(lyricProgress(12, interval, 1), .75)
  assert.equal(lyricProgress(12, interval, 0, 'line'), 1)
  assert.deepEqual(lyricInterval(lines, 3, 25), { start: 19, end: 25 })
})

test('the painter follows media time, stops on pause, and never invents progress during buffering', () => {
  const media = new EventTarget()
  Object.assign(media, { currentTime: 10, paused: false, ended: false })
  let frameId = 0
  const queue = new Map(), values = ['', '', '', '']
  const nodes = values.map((_, index) => ({ style: { setProperty: (_key, value) => { values[index] = value } } }))
  const step = now => { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback(now)) }
  const controller = createLyricPainter({ nodes, media, readTime: () => 99, interval: { start: 10, end: 14 }, offset: 0, mode: 'sweep',
    requestFrame: callback => { queue.set(++frameId, callback); return frameId }, cancelFrame: id => queue.delete(id) })
  assert.deepEqual(values, ['0%', '0%', '0%', '0%'])
  media.currentTime = 11.5; step(100)
  assert.deepEqual(values, ['100%', '50%', '0%', '0%'])
  step(1000)
  assert.deepEqual(values, ['100%', '50%', '0%', '0%'], 'a stalled audio clock leaves the fill still')
  media.paused = true; media.dispatchEvent(new Event('pause'))
  assert.equal(queue.size, 0)
  media.currentTime = 10.25; media.dispatchEvent(new Event('seeked'))
  assert.deepEqual(values, ['25%', '0%', '0%', '0%'])
  assert.equal(queue.size, 0, 'seeking while paused paints once')
  media.paused = false; media.dispatchEvent(new Event('play'))
  assert.equal(queue.size, 1)
  controller.dispose()
  assert.equal(queue.size, 0)
  media.dispatchEvent(new Event('play'))
  assert.equal(queue.size, 0, 'unmounted lyrics remove media listeners')
})

test('hidden lyrics suspend drawing and emoji remain whole graphemes', () => {
  assert.deepEqual(lyricGlyphs('你👩‍🚀e\u0301'), ['你', '👩‍🚀', 'é'])
  let visible = false, draws = 0
  const controller = createLyricPainter({ nodes: [{ style: { setProperty: () => draws++ } }], readTime: () => 2,
    interval: { start: 0, end: 4 }, offset: 0, mode: 'sweep', visible: () => visible,
    requestFrame: () => assert.fail('paused/hidden lyrics must not schedule frames'), cancelFrame: () => {} })
  assert.equal(draws, 0)
  visible = true; controller.refresh()
  assert.equal(draws, 1)
  controller.dispose()
})

test('a crossfade deck handoff follows the new media clock and releases the previous deck', () => {
  const outgoing = Object.assign(new EventTarget(), { currentTime: 13, paused: true })
  const incoming = Object.assign(new EventTarget(), { currentTime: 11, paused: true })
  let active = outgoing, painted = ''
  const controller = createLyricPainter({ nodes: [{ style: { setProperty: (_key, value) => { painted = value } } }],
    readMedia: () => active, readTime: () => 0, interval: { start: 10, end: 14 }, offset: 0, mode: 'sweep',
    requestFrame: () => assert.fail('paused decks do not animate'), cancelFrame: () => {} })
  assert.equal(painted, '75%')
  active = incoming; controller.refresh()
  assert.equal(painted, '25%')
  incoming.currentTime = 12; incoming.dispatchEvent(new Event('seeked'))
  assert.equal(painted, '50%')
  incoming.currentTime = 14; outgoing.dispatchEvent(new Event('seeked'))
  assert.equal(painted, '50%', 'retired deck events cannot repaint the lyric')
  controller.dispose()
})

test('cover colors remain readable; explicit custom colors are respected', () => {
  const cover = lyricColors(LYRIC_EFFECT_DEFAULTS, { primary: [5, 10, 25], accent: [125, 20, 10] })
  assert.ok(cover.every(color => /^#[a-f0-9]{6}$/.test(color)))
  assert.notEqual(cover[0], '#050a19')
  assert.notEqual(cover[0], cover[1])
  assert.deepEqual(lyricColors({ colorMode: 'custom', colorA: '#112233', colorB: '#aabbcc' }), ['#112233', '#aabbcc'])
})
