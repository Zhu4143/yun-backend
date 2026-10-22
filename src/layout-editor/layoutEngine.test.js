import test from 'node:test'
import assert from 'node:assert/strict'
import { arrangeRects, decodeRect, emptyDocument, encodeRect, fitRect, moveRect, parseDocument, profileFor, pushHistory, resizeRect } from './layoutEngine.js'

const item = { id: 'player', minWidth: 320, minHeight: 112, anchorX: 'center', anchorY: 'bottom' }
const view = { width: 1200, height: 800 }
const start = { x: 100, y: 200, width: 400, height: 150 }

test('center / bottom anchors preserve offsets when viewport changes', () => {
  const r = { x: 300, y: 650, width: 600, height: 140 }
  const encoded = encodeRect(r, item, view)
  assert.deepEqual(decodeRect(encoded, item, view), r)
  assert.deepEqual(decodeRect(encoded, item, { width: 1600, height: 1000 }), { ...r, x: 500, y: 850 })
})
test('small viewports fit minimum constraints without negative geometry', () => {
  assert.deepEqual(fitRect(start, item, { width: 250, height: 100 }), { x: 0, y: 0, width: 250, height: 100 })
  assert.equal(profileFor({ width: 537 }), 'compact')
  assert.equal(profileFor({ width: 1200 }), 'desktop')
})
test('move snaps nearest edge / center and Alt-equivalent disabling is exact', () => {
  const other = { x: 650, y: 400, width: 300, height: 200 }
  const snapped = moveRect(start, 147, 47, item, view, [other])
  assert.equal(snapped.rect.x, 250)
  assert.equal(snapped.rect.y, 250)
  assert.deepEqual(snapped.guides, [{ axis: 'x', value: 650 }, { axis: 'y', value: 400 }])
  assert.equal(moveRect(start, 147, 47, item, view, [other], false).rect.x, 247)
})
test('all eight resize handles preserve the opposite edge and minimum size', () => {
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const r = resizeRect(start, edge, 900, 900, item, view)
    assert.ok(r.width >= 320 && r.height >= 112)
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1200 && r.y + r.height <= 800)
    if (edge.includes('w')) assert.equal(r.x + r.width, start.x + start.width)
    if (edge.includes('n')) assert.equal(r.y + r.height, start.y + start.height)
  }
})
test('one gesture commits once; undo followed by a new edit discards redo', () => {
  let h = { entries: [{ player: start }], index: 0 }
  h = pushHistory(h, { player: { ...start, x: 110 } })
  h = pushHistory(h, { player: { ...start, x: 110 } })
  assert.equal(h.entries.length, 2)
  h = pushHistory({ ...h, index: 0 }, { player: { ...start, y: 210 } })
  assert.equal(h.entries.length, 2)
  assert.equal(h.entries[1].player.x, 100)
  assert.equal(h.entries[1].player.y, 210)
})
test('versioned JSON roundtrips both profiles and strips unknown IDs / properties', () => {
  const doc = emptyDocument()
  doc.profiles.desktop.player = { ...encodeRect(start, item, view), selector: 'body' }
  doc.profiles.desktop.unknown = { dangerous: true }
  doc.profiles.compact.player = encodeRect({ ...start, width: 320 }, item, view)
  const parsed = parseDocument(JSON.stringify(doc), [item])
  assert.deepEqual(Object.keys(parsed.profiles.desktop), ['player'])
  assert.equal(parsed.profiles.desktop.player.selector, undefined)
  assert.ok(parsed.profiles.compact.player)
})
test('malformed import is rejected before application', () => {
  assert.throws(() => parseDocument('{', [item]))
  assert.throws(() => parseDocument(JSON.stringify({ version: 99, profiles: {} }), [item]))
  const doc = emptyDocument()
  doc.profiles.desktop.player = { ...encodeRect(start, item, view), width: -1 }
  assert.throws(() => parseDocument(JSON.stringify(doc), [item]))
  doc.profiles.desktop.player.width = '400px'
  assert.throws(() => parseDocument(JSON.stringify(doc), [item]))
})
test('arrange preserves dimensions and spacing, and reports insufficient space', () => {
  const rects = { a: start, b: { ...start, x: 550, width: 300 } }
  const next = arrangeRects(rects, ['a', 'b'], 'horizontal', 16, view)
  assert.equal(next.b.x - next.a.x - next.a.width, 16)
  assert.equal(next.b.y, next.a.y)
  assert.equal(next.b.width, 300)
  assert.throws(() => arrangeRects(rects, ['a', 'b'], 'horizontal', 16, { width: 500, height: 800 }))
})
