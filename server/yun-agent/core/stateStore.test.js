import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStateStore, DEFAULT_RUNTIME_STATE } from './stateStore.js'

test('stateStore returns defaults and persists updates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-state-'))
  try {
    const file = path.join(dir, 'state.json')
    const store = createStateStore(file)
    assert.deepEqual(await store.get(), DEFAULT_RUNTIME_STATE)

    await store.update({ status: 'EXECUTING', currentTask: 'play' })
    const state = await store.get()
    assert.equal(state.status, 'EXECUTING')
    assert.equal(state.currentTask, 'play')
    assert.ok(state.updatedAt)

    // A fresh store reads the persisted file.
    const fresh = createStateStore(file)
    assert.equal((await fresh.get()).currentTask, 'play')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('stateStore accepts a custom default state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-state-'))
  try {
    const store = createStateStore(path.join(dir, 's.json'), { phase: 'idle', count: 0 })
    assert.equal((await store.get()).phase, 'idle')
    assert.equal((await store.get()).count, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
