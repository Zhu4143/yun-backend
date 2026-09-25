import assert from 'node:assert/strict'
import test from 'node:test'

import { describePlaylistTrackPage } from '../../server/netease/playlistPagination.js'
import {
  isValidCompletePlaylist,
  loadCompletePlaylistTracks,
  loadCompletePlaylistCache,
  loadPaginatedCollection,
  saveCompletePlaylistCache,
} from './playlistLoader.js'

test('playlist_track_all page count is not misreported as the collection total', () => {
  assert.deepEqual(describePlaylistTrackPage({
    body: { count: 200 },
    songCount: 200,
    offset: 0,
    limit: 200,
  }), {
    hasMore: true,
    total: null,
  })

  assert.deepEqual(describePlaylistTrackPage({
    body: { count: 411 },
    songCount: 11,
    offset: 400,
    limit: 200,
  }), {
    hasMore: false,
    total: 411,
  })
})

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

test('a live collection may grow while pagination is in progress', async () => {
  const result = await loadPaginatedCollection({
    pageSize: 2,
    fetchPage: async ({ offset }) => offset === 0
      ? { items: [{ id: '1' }, { id: '2' }], total: 3, hasMore: true }
      : { items: [{ id: '3' }, { id: '4' }], total: 4, hasMore: false },
  })

  assert.deepEqual(result.items.map((item) => item.id), ['1', '2', '3', '4'])
  assert.equal(result.expectedCount, 4)
  assert.equal(result.loadedCount, 4)
})

test('every playlist waits for its complete paginated track collection', async () => {
  const finalPage = deferred()
  let settled = false
  const loading = loadCompletePlaylistTracks({
    playlists: [
      { id: 'liked', name: '我喜欢的音乐', trackCount: 3 },
      { id: 'empty', name: '空歌单', trackCount: 0 },
    ],
    concurrency: 1,
    pageSize: 2,
    fetchPage: async ({ playlistId, offset }) => {
      if (playlistId === 'empty') return { items: [], total: 0, hasMore: false }
      if (offset === 0) {
        return {
          items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
          total: 3,
          hasMore: true,
        }
      }
      return finalPage.promise
    },
  }).then((result) => {
    settled = true
    return result
  })

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled, false)

  finalPage.resolve({ items: [{ id: 'c', title: 'C' }], total: 3, hasMore: false })
  const result = await loading

  assert.equal(result.complete, true)
  assert.equal(result.loadedPlaylistCount, 2)
  assert.equal(result.expectedPlaylistCount, 2)
  assert.equal(result.loadedTrackCount, 3)
  assert.equal(result.expectedTrackCount, 3)
  assert.deepEqual(result.playlists[0].tracks.map((track) => track.id), ['a', 'b', 'c'])
  assert.equal(result.playlists[0].complete, true)
  assert.deepEqual(result.playlists[1].tracks, [])
})

test('playlist track metadata follows the provider total when the collection changed', async () => {
  const result = await loadCompletePlaylistTracks({
    playlists: [{ id: 'liked', name: '我喜欢的音乐', trackCount: 2 }],
    fetchPage: async () => ({ items: [{ id: 'a', title: 'A' }], total: 1, hasMore: false }),
  })

  assert.equal(result.loadedTrackCount, 1)
  assert.equal(result.expectedTrackCount, 1)
  assert.equal(result.playlists[0].trackCount, 1)
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

test('a playlist cache with missing tracks is never restored as complete', () => {
  const storage = createStorage()
  storage.setItem('playlists', JSON.stringify({
    version: 3,
    complete: true,
    totalItems: 1,
    updatedAt: 123,
    items: [{
      id: 'liked',
      name: '我喜欢的音乐',
      trackCount: 2,
      complete: true,
      tracks: [{ id: 'a', title: 'A' }],
    }],
  }))

  assert.equal(loadCompletePlaylistCache({
    storage,
    key: 'playlists',
    version: 3,
    validateItem: isValidCompletePlaylist,
  }), null)
})
