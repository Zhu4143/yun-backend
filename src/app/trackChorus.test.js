import test from 'node:test'
import assert from 'node:assert/strict'
import { chorusWithinDuration, createTrackChorusLoader } from './trackChorus.js'

test('a marker is shown only for a real provider point within playable duration', () => {
  const chorus = { start: 74.379, end: 104.355, source: 'netease-chorus' }
  assert.deepEqual(chorusWithinDuration(chorus, 222), chorus)
  assert.equal(chorusWithinDuration(chorus, 60), null)
  assert.equal(chorusWithinDuration(chorus, 0), null)
  assert.equal(chorusWithinDuration(chorus, Infinity), null)
  assert.equal(chorusWithinDuration({ ...chorus, source: 'guess' }, 222), null)
  assert.equal(chorusWithinDuration(null, 222), null)
  assert.equal(chorusWithinDuration(chorus, 90).end, 90)
})

test('main, mobile and immersive players share one bounded metadata request', async () => {
  const calls = []
  const load = createTrackChorusLoader(async (...args) => {
    calls.push(args)
    return { ok: true, json: async () => ({ ok: true, chorus: { start: 74.379, end: 104.355, source: 'netease-chorus' } }) }
  })
  const requests = [load('netease-123'), load('123'), load('123')]
  assert.equal(requests[0], requests[1])
  assert.equal((await Promise.all(requests))[2].start, 74.379)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/api/netease/chorus?id=123')
  assert.equal(calls[0][2].timeoutMs, 8000)
  assert.equal(await load('invalid'), null)
})

test('failed lookups do not poison future marker requests, absent data stays absent', async () => {
  let ok = false
  const load = createTrackChorusLoader(async () => ({ ok, json: async () => ({ ok, chorus: null }) }))
  await assert.rejects(load('123'))
  ok = true
  assert.equal(await load('123'), null)
})
