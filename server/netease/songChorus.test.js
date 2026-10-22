import test from 'node:test'
import assert from 'node:assert/strict'
import { createSongChorusLoader, normalizeSongChorus } from './songChorus.js'

test('provider chorus milliseconds become seconds for the requested song only', () => {
  const result = normalizeSongChorus({ body: { code: 200, chorus: [{ id: 2053420961, startTime: 74379, endTime: 104355 }] } }, '2053420961')
  assert.deepEqual(result, { start: 74.379, end: 104.355, source: 'netease-chorus' })
  assert.equal(normalizeSongChorus({ data: [{ id: 123, startTime: 5000, endTime: 9000 }] }, '456'), null)
  for (const row of [{}, { startTime: 0, endTime: 0 }, { startTime: -1, endTime: 5000 }, { startTime: 'invalid', endTime: 5000 }]) {
    assert.equal(normalizeSongChorus({ chorus: [{ id: 123, ...row }] }, '123'), null)
  }
})

test('chorus lookups share requests, expire and allow retry after failure', async () => {
  let now = 0, calls = 0, failing = true
  const load = createSongChorusLoader(async id => {
    calls++
    if (failing) throw new Error('offline')
    return { data: [{ id, startTime: 30000, endTime: 50000 }] }
  }, { now: () => now })
  await assert.rejects(load('123'))
  failing = false
  const first = load('123')
  assert.equal(first, load('123'))
  assert.equal((await first).start, 30)
  assert.equal(calls, 2)
  now = 16 * 60 * 1000
  await load('123')
  assert.equal(calls, 3)
})
