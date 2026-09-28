import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'

import { createRequestLifecycle } from './requestLifecycle.js'

test('an aborted HTTP request aborts its downstream work with a safe response ID', () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.writableEnded = false
  const originalInfo = console.info
  const logs = []
  console.info = (...items) => logs.push(items.join(' '))

  try {
    const lifecycle = createRequestLifecycle(req, res, { responseId: 'turn\nprivate-text' })
    req.emit('aborted')

    assert.equal(lifecycle.signal.aborted, true)
    assert.equal(lifecycle.responseId, 'turn-private-text')
    assert.match(logs[0], /request_id=turn-private-text/)
    assert.doesNotMatch(logs[0], /\n/)
    lifecycle.cleanup()
  } finally {
    console.info = originalInfo
  }
})

test('a completed response closing does not abort its request', () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.writableEnded = true
  const lifecycle = createRequestLifecycle(req, res)

  res.emit('close')

  assert.equal(lifecycle.signal.aborted, false)
  lifecycle.cleanup()
})

test('a request ID can be attached after the HTTP body has been parsed', () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  const lifecycle = createRequestLifecycle(req, res)

  lifecycle.setResponseId('yun-turn-42')
  res.writableEnded = false
  res.emit('close')

  assert.equal(lifecycle.signal.aborted, true)
  assert.match(lifecycle.signal.reason.message, /yun-turn-42/)
  lifecycle.cleanup()
})
