import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createMemoryStore } from './memoryStore.js'

test('memoryStore remembers and scopes long-term entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-mem-'))
  try {
    const file = path.join(dir, 'memory.json')
    const music = createMemoryStore(file, { scope: 'music' })
    const companion = createMemoryStore(file, { scope: 'companion' })

    await music.remember('喜欢周杰伦')
    await companion.remember('用户叫东宇')

    assert.equal(music.scope, 'music')
    assert.deepEqual((await music.context('s1')).longTerm.map((item) => item.text), ['喜欢周杰伦'])
    assert.deepEqual((await companion.context('s1')).longTerm.map((item) => item.text), ['用户叫东宇'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memoryStore appendTurn keeps session turns scoped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-mem-'))
  try {
    const store = createMemoryStore(path.join(dir, 'm.json'), { scope: 'music' })
    await store.appendTurn('s1', { user: 'hi' })
    const ctx = await store.context('s1')
    assert.equal(ctx.recent.length, 1)
    assert.equal(ctx.recent[0].scope, 'music')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memoryStore isolates recent turns by scope within a shared session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-mem-'))
  try {
    const file = path.join(dir, 'm.json')
    const music = createMemoryStore(file, { scope: 'music' })
    const companion = createMemoryStore(file, { scope: 'companion' })

    await music.appendTurn('shared', { user: '放歌' })
    await companion.appendTurn('shared', { user: '陪我聊' })

    assert.deepEqual((await music.context('shared')).recent.map((turn) => turn.user), ['放歌'])
    assert.deepEqual((await companion.context('shared')).recent.map((turn) => turn.user), ['陪我聊'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memoryStore rejects sensitive content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-mem-'))
  try {
    const store = createMemoryStore(path.join(dir, 'm.json'), { scope: 'music' })
    const result = await store.remember('我的 api_key 是 abc')
    assert.equal(result.saved, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
