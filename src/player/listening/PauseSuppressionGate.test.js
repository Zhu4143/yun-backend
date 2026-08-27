import assert from 'node:assert/strict'
import test from 'node:test'
import { PauseSuppressionGate } from './PauseSuppressionGate.js'

test('suppression is deck-scoped, consumed once, and never arms an already-paused deck', () => {
  const gate = new PauseSuppressionGate()
  const deckA = { paused: false }
  const deckB = { paused: false }
  assert.equal(gate.arm(deckA), true)
  assert.equal(gate.consume(deckA), true)
  assert.equal(gate.consume(deckA), false)
  assert.equal(gate.consume(deckB), false)
  deckA.paused = true
  assert.equal(gate.arm(deckA), false)
  deckA.paused = false
  assert.equal(gate.consume(deckA), false)
})
