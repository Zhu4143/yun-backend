import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppearanceStore } from './appearance.js'

function fixture(initial = 'light') {
  let saved = initial, dark = false, system, storage, removes = 0
  const applied = [], writes = []
  const store = createAppearanceStore({
    read: () => saved, write: value => { saved = value; writes.push(value) }, systemDark: () => dark,
    onSystemChange(callback) { system = callback; return () => { system = null; removes++ } },
    onStorageChange(callback) { storage = callback; return () => { storage = null; removes++ } },
    apply: theme => applied.push(theme),
  })
  return { store, applied, writes, removals: () => removes, system(value) { dark = value; system?.() }, storage(value) { saved = value; storage?.(value) } }
}

test('night preference restores at startup and a direct toggle persists immediately', () => {
  const f = fixture('dark')
  assert.deepEqual(f.store.getSnapshot(), { mode: 'dark', theme: 'dark' })
  assert.deepEqual(f.applied, ['dark'])
  assert.equal(f.store.setMode('light'), true)
  assert.deepEqual(f.writes, ['light'])
  assert.deepEqual(f.store.getSnapshot(), { mode: 'light', theme: 'light' })
})

test('system changes affect follow-system mode while an explicit choice remains stable', () => {
  const f = fixture('system'), events = []
  const stop = f.store.subscribe(() => events.push(f.store.getSnapshot().theme))
  f.system(true)
  assert.equal(f.store.getSnapshot().theme, 'dark')
  f.store.setMode('light')
  const snapshot = f.store.getSnapshot()
  f.system(false); f.system(true)
  assert.equal(f.store.getSnapshot(), snapshot)
  assert.deepEqual(events, ['dark', 'light'])
  stop()
})

test('other tabs update mode, and clearing preferences restores the default', () => {
  const f = fixture(), stop = f.store.subscribe(() => {})
  f.storage('dark')
  assert.equal(f.store.getSnapshot().theme, 'dark')
  f.storage(null)
  assert.deepEqual(f.store.getSnapshot(), { mode: 'light', theme: 'light' })
  assert.equal(f.writes.length, 0, 'external storage changes must not echo writes')
  stop()
})

test('subscribers share observers and release them only after the final unsubscribe', () => {
  const f = fixture(), stopA = f.store.subscribe(() => {}), stopB = f.store.subscribe(() => {})
  stopA(); assert.equal(f.removals(), 0)
  stopB(); assert.equal(f.removals(), 2)
  const stopC = f.store.subscribe(() => {})
  f.store.setMode('dark')
  assert.equal(f.store.getSnapshot().theme, 'dark')
  stopC(); assert.equal(f.removals(), 4)
})

test('blocked storage still supports a working session preference', () => {
  const store = createAppearanceStore({
    read: () => { throw new Error('blocked') }, write: () => { throw new Error('blocked') },
    systemDark: () => true, onSystemChange: () => () => {}, onStorageChange: () => () => {}, apply() {},
  })
  assert.equal(store.getSnapshot().theme, 'light')
  assert.equal(store.setMode('dark'), false)
  assert.equal(store.getSnapshot().theme, 'dark')
})
