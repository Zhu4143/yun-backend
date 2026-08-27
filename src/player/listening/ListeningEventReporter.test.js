import assert from 'node:assert/strict'
import test from 'node:test'
import { createListeningEventReporter } from './ListeningEventReporter.js'

test('reporter serializes sends in caller order and transport failure does not reject playback', async () => {
  const sent = []
  const reporter = createListeningEventReporter({ fetchImpl: async (_url, request) => { sent.push(JSON.parse(request.body).id); if (sent.length === 1) throw new Error('offline') } })
  assert.equal(reporter.report({ id: 'session:1' }), true)
  assert.equal(reporter.report({ id: 'session:2' }), true)
  await reporter.flush()
  assert.deepEqual(sent, ['session:1', 'session:2'])
  assert.equal(reporter.getQueuedCount(), 0)
})
