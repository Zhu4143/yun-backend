import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverRequirements, parseTelemetryNdjson } from './index.js'

const event = (type) => ({ type, ts: '2026-08-17T00:00:00.000Z' })

test('discovery ignores malformed NDJSON and proposes only verified signals', () => {
  assert.equal(parseTelemetryNdjson('{bad}\n' + JSON.stringify(event('tts.started'))).length, 1)
  const events = [...Array(10).fill(0).map(() => event('tts.started')), ...Array(4).fill(0).map(() => event('tts.interrupted'))]
  const items = discoverRequirements(events)
  assert.equal(items[0].id, 'tts-interrupt-rate')
  assert.equal(items[0].requiresHumanApproval, true)
})

test('discovery keeps low-volume signals out of the backlog', () => {
  const items = discoverRequirements([event('command.received'), event('command.failed')])
  assert.equal(items.length, 0)
})
