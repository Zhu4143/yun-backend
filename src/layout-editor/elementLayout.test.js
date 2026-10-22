import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanElementStyles, elementCSS, validNodeKey } from './elementLayout.js'
import { emptyDocument, parseDocument, pushHistory } from './layoutEngine.js'

const items = [{ id: 'player' }, { id: 'library' }]
const key = 'player::.player-content > .player-controls > .control-button:nth-of-type(2)'
test('nested button / text styles roundtrip per breakpoint and old layouts migrate', () => {
  const doc = emptyDocument()
  doc.elements.desktop[key] = { width: 52, height: 52, x: 12, fontSize: 20, lineHeight: 1.4 }
  doc.elements.compact[key] = { width: 32 }
  assert.deepEqual(parseDocument(JSON.stringify(doc), items), doc)
  const old = parseDocument(JSON.stringify({ version: 1, profiles: { desktop: {}, compact: {} } }), items)
  assert.equal(old.version, 2)
  assert.deepEqual(old.elements, { desktop: {}, compact: {} })
})
test('import cannot inject selectors / CSS or escape the host', () => {
  for (const attack of ['player::body,body', 'player::.x{color:red}', 'player::button + body', 'player::.x > *', 'other::button', 'player::button::before']) assert.equal(Boolean(validNodeKey(attack, items)), false)
  assert.equal(validNodeKey(key, items), true)
  assert.deepEqual(cleanElementStyles({ color: 'red', position: 'fixed', fontSize: 19 }), { fontSize: 19 })
  assert.throws(() => cleanElementStyles({ width: -1 }))
  assert.throws(() => cleanElementStyles({ fontSize: '30px' }))
  assert.throws(() => cleanElementStyles({ textAlign: 'left; color:red' }))
  assert.throws(() => cleanElementStyles({ x: Infinity }))
})
test('flow offsets compose with host transforms; flex / typography overrides are scoped', () => {
  const css = elementCSS({ [key]: { x: 10, y: 2, width: 44, fontSize: 18, lineHeight: 1.5 }, 'library::.library-content > .library-header': { display: 'flex', gap: 12, flexDirection: 'column' } }, items)
  assert.ok(css.includes('[data-ui-layout-host="player"] > .player-content'))
  assert.ok(css.includes('translate:10px 2px!important'))
  assert.ok(!css.includes('transform:'))
  assert.ok(css.includes('font-size:18px!important'))
  assert.ok(css.includes('line-height:1.5!important'))
  assert.ok(css.includes('gap:12px!important'))
})
test('undo restores internal properties together with geometry and pending import', () => {
  const first = { rects: { player: { x: 1 } }, elements: {}, imported: null }
  const second = { ...first, elements: { [key]: { width: 50 } } }
  const h = pushHistory({ entries: [first], index: 0 }, second)
  assert.deepEqual(h.entries[0], first)
  second.elements[key].width = 100
  assert.equal(h.entries[1].elements[key].width, 50)
})
