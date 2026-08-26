import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNetEaseAccountSessionService } from './accountSessionService.js'
import { createFileNetEaseSessionStore, createMemoryNetEaseSessionStore } from './sessionStore.js'

const FAKE_COOKIE = 'MUSIC_U=fake-session-value'

async function makeFileStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yun-netease-session-'))
  return { directory, filePath: path.join(directory, 'netease-cookie.txt'), store: null }
}

test('FileNetEaseSessionStore reads the legacy netease-cookie.txt format', async () => {
  const context = await makeFileStore()
  try {
    await writeFile(context.filePath, `${FAKE_COOKIE}; Path=/; HttpOnly`, 'utf8')
    context.store = createFileNetEaseSessionStore({ filePath: context.filePath })
    assert.deepEqual(await context.store.get(), { cookie: FAKE_COOKIE })
  } finally { await rm(context.directory, { recursive: true, force: true }) }
})

test('setSession, getSession and clearSession work through a file store', async () => {
  const context = await makeFileStore()
  try {
    const service = createNetEaseAccountSessionService({ store: createFileNetEaseSessionStore({ filePath: context.filePath }) })
    await service.setSession({ cookie: FAKE_COOKIE })
    assert.deepEqual(await service.getSession(), { cookie: FAKE_COOKIE })
    assert.equal(await readFile(context.filePath, 'utf8'), FAKE_COOKIE)
    await service.clearSession()
    assert.equal(await service.getSession(), null)
    assert.equal((await service.getStatus()).status, 'not_logged_in')
  } finally { await rm(context.directory, { recursive: true, force: true }) }
})

test('no session is not_logged_in and validation distinguishes invalid from expired', async () => {
  const missing = createNetEaseAccountSessionService({ store: createMemoryNetEaseSessionStore() })
  assert.equal((await missing.validateSession()).status, 'not_logged_in')
  const invalid = createNetEaseAccountSessionService({ store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }), validate: async () => ({ status: 'invalid' }) })
  assert.equal((await invalid.validateSession()).status, 'invalid')
  const expired = createNetEaseAccountSessionService({ store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }), validate: async () => ({ status: 'expired' }) })
  assert.equal((await expired.validateSession()).status, 'expired')
})

test('a network validation failure retains the existing session', async () => {
  const service = createNetEaseAccountSessionService({
    store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }),
    validate: async () => { const error = new Error('socket timeout'); error.code = 'network_error'; throw error },
  })
  assert.equal((await service.validateSession()).status, 'network_error')
  assert.deepEqual(await service.getSession(), { cookie: FAKE_COOKIE })
})

test('public status serialization never exposes credentials', async () => {
  const service = createNetEaseAccountSessionService({
    store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }),
    validate: async () => ({ status: 'logged_in', user: { userId: 42, nickname: 'Test User' } }),
  })
  const serialized = JSON.stringify(await service.validateSession())
  assert.doesNotMatch(serialized, /MUSIC_U|cookie|token|fake-session-value/i)
})

test('the same service works with a memory store', async () => {
  const store = createMemoryNetEaseSessionStore()
  const service = createNetEaseAccountSessionService({ store, validate: async () => ({ status: 'logged_in' }) })
  await service.setSession({ cookie: FAKE_COOKIE })
  assert.equal((await service.validateSession()).status, 'logged_in')
  assert.deepEqual(await store.get(), { cookie: FAKE_COOKIE })
})
