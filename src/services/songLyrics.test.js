import test from 'node:test'
import assert from 'node:assert/strict'
import { createSongLyricsLoader } from './songLyrics.js'

test('prefetched next-song lyrics share the request used at track commit', async () => {
  let resolveLyrics
  let fetchCount = 0
  const loader = createSongLyricsLoader({
    fetchNetease: () => {
      fetchCount += 1
      return new Promise((resolve) => { resolveLyrics = resolve })
    },
  })
  const song = { id: 'netease-42', providerId: '42', source: 'netease' }
  loader.prefetch(song)
  const committedRequest = loader.load(song)
  await Promise.resolve()
  assert.equal(fetchCount, 1)
  resolveLyrics({ lines: [{ time: 0, text: 'new song' }] })
  assert.deepEqual((await committedRequest).lines, [{ time: 0, text: 'new song' }])
})

test('distinct tracks never reuse previous-song lyrics', async () => {
  const loader = createSongLyricsLoader({
    fetchLocal: async (id) => ({ lines: [{ time: 0, text: id }] }),
  })
  assert.equal((await loader.load({ id: 'old' })).lines[0].text, 'old')
  assert.equal((await loader.load({ id: 'new' })).lines[0].text, 'new')
})
