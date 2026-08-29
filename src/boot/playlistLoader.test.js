import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadCompletePlaylistCache,
  loadPaginatedCollection,
  saveCompletePlaylistCache,
} from './playlistLoader.js'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('the first playlist page cannot complete the collection while another page is pending', async () => {
  const secondPage = deferred()
  let settled = false
  const loading = loadPaginatedCollection({
    pageSize: 2,
    fetchPage: async ({ offset }) => offset === 0
      ? { items: [{ id: '1' }, { id: '2' }], total: 3, hasMore: true }
      : secondPage.promise,
  }).then(() => { settled = true })

  await Promise.resolve()
  assert.equal(settled, false)

  secondPage.resolve({ items: [{ id: '3' }], total: 3, hasMore: false })
  await loading
  assert.equal(settled, true)
})

test('all playlist pages complete with truthful loaded and expected counts', async () => {
  const progress = []
  const result = await loadPaginatedCollection({
    pageSize: 2,
    fetchPage: async ({ offset }) => offset === 0
      ? { items: [{ id: '1' }, { id: '2' }], total: 3, hasMore: true }
      : { items: [{ id: '3' }], total: 3, hasMore: false },
    onProgress: (update) => progress.push(update),
  })

  assert.deepEqual(result.items.map((item) => item.id), ['1', '2', '3'])
  assert.equal(result.loadedCount, 3)
  assert.equal(result.expectedCount, 3)
  assert.deepEqual(progress.at(-1), { loadedCount: 3, expectedCount: 3, progress: 100 })
})

test('duplicate playlist ids fail integrity validation', async () => {
  await assert.rejects(() => loadPaginatedCollection({
    fetchPage: async () => ({ items: [{ id: '1' }, { id: '1' }], total: 2, hasMore: false }),
  }), /duplicate/i)
})

test('invalid playlist objects fail integrity validation', async () => {
  await assert.rejects(() => loadPaginatedCollection({
    fetchPage: async () => ({ items: [{ name: 'missing id' }], total: 1, hasMore: false }),
  }), /invalid/i)
})

test('loadedCount different from expectedCount cannot be complete', async () => {
  await assert.rejects(() => loadPaginatedCollection({
    fetchPage: async () => ({ items: [{ id: '1' }], total: 2, hasMore: false }),
  }), /expected 2.*loaded 1/i)
})

test('a final provider page without a total uses its loaded count instead of zero', async () => {
  const result = await loadPaginatedCollection({
    fetchPage: async () => ({ items: [{ id: '1' }], hasMore: false }),
  })

  assert.equal(result.expectedCount, 1)
  assert.equal(result.loadedCount, 1)
})

test('an incomplete playlist cache is never restored as ready', () => {
  const storage = createStorage()
  storage.setItem('playlists', JSON.stringify({ version: 1, complete: false, totalItems: 2, items: [{ id: '1' }] }))

  assert.equal(loadCompletePlaylistCache({ storage, key: 'playlists', version: 1 }), null)
})

test('a versioned complete playlist cache restores only when its count is intact', () => {
  const storage = createStorage()
  const items = [{ id: '1' }, { id: '2' }]
  saveCompletePlaylistCache({ storage, key: 'playlists', version: 2, items, updatedAt: 123 })

  assert.deepEqual(loadCompletePlaylistCache({ storage, key: 'playlists', version: 2 }), {
    version: 2,
    complete: true,
    totalItems: 2,
    updatedAt: 123,
    items,
  })
})
