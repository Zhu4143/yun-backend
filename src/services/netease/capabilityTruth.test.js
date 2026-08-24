import test from 'node:test'
import assert from 'node:assert/strict'
import { getRelevantNeteaseCapabilityTruth } from './capabilityTruth.js'

test('model capability truth is registry-derived and limited to the matched capability', () => {
  const truth = getRelevantNeteaseCapabilityTruth({ message: '最近歌曲' })
  assert.equal(truth.source, 'netease-capability-registry')
  assert.equal(truth.detectedIntent, 'library.recent')
  assert.equal(truth.capabilities.length, 1)
  assert.deepEqual(truth.capabilities[0], {
    id: 'netease.library.recent',
    name: '网易云最近播放',
    domain: 'library',
    actions: ['list'],
    transport: 'api',
    supportStatus: 'available',
  })
})

test('unmatched conversation does not inject the entire registry', () => {
  assert.equal(getRelevantNeteaseCapabilityTruth({ message: '今天心情有点复杂' }), null)
})
