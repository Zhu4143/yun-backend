import assert from 'node:assert/strict'
import test from 'node:test'
import { createListeningEventHandler, MAX_LISTENING_EVENT_BYTES } from './http.js'

test('listening event endpoint persists through the service and returns no event data', async () => {
  const calls = []
  const replies = []
  const handler = createListeningEventHandler({
    musicMemoryService: { async persistListeningEvent(input) { calls.push(input); return { written: true, duplicate: false, event: input } } },
    readJson: async (...args) => {
      assert.equal(args[1].maxBytes, MAX_LISTENING_EVENT_BYTES)
      return { id: 'event-1', cookie: 'MUSIC_U=private', type: 'play' }
    },
    sendJson: (_res, status, body) => replies.push({ status, body }),
  })
  await handler({}, {})
  assert.equal(calls.length, 1)
  assert.deepEqual(replies, [{ status: 200, body: { ok: true, written: true, duplicate: false } }])
  assert.doesNotMatch(JSON.stringify(replies), /MUSIC_U|cookie|event-1/)
  assert.equal(MAX_LISTENING_EVENT_BYTES, 32 * 1024)
})

test('listening event endpoint rejects invalid or oversized requests without echoing input', async () => {
  const replies = []
  const handler = createListeningEventHandler({
    musicMemoryService: { async persistListeningEvent() { return { written: false, invalid: true } } },
    readJson: async () => { throw new Error('payload_too_large MUSIC_U=private') },
    sendJson: (_res, status, body) => replies.push({ status, body }),
  })
  await handler({}, {})
  assert.deepEqual(replies, [{ status: 400, body: { ok: false, written: false, duplicate: false } }])
})

test('listening event endpoint reports a repository duplicate without returning its event', async () => {
  const replies = []
  const handler = createListeningEventHandler({
    musicMemoryService: { async persistListeningEvent() { return { written: false, duplicate: true, event: { id: 'session:1' } } } },
    readJson: async () => ({ id: 'session:1', type: 'play' }),
    sendJson: (_res, status, body) => replies.push({ status, body }),
  })
  await handler({}, {})
  assert.deepEqual(replies, [{ status: 200, body: { ok: true, written: false, duplicate: true } }])
  assert.doesNotMatch(JSON.stringify(replies), /session:1/)
})
