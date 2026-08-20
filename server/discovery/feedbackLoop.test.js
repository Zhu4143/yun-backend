import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFeedbackLoop } from './feedbackLoop.js'

test('P6 requires an active P5 proposal before recording an adoption', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-feedback-'))
  try {
    const discovery = { getBacklog: async () => ({ items: [{ id: 'manual-skip-rate', evidence: { rate: 1 } }] }) }
    const loop = createFeedbackLoop({ dataDir: dir, discovery, now: () => new Date('2026-08-17T00:00:00Z') })
    const entry = await loop.decide({ requirementId: 'manual-skip-rate', decision: 'adopted', reason: 'confirmed after real use' })
    assert.equal(entry.applied, false)
    assert.equal((await loop.list()).decisions.length, 1)
    await assert.rejects(() => loop.decide({ requirementId: 'unknown', decision: 'adopted' }))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
