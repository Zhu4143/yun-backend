import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNetEaseAccountSessionService, createNetEaseAccountSessionValidator } from './accountSessionService.js'
import { toNeteaseLoginInfo } from './accountSessionCompatibility.js'
import { createNeteaseCapabilityService } from './capabilityService.js'
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

test('a provider 503 is network_error and retains the existing session', async () => {
  const service = createNetEaseAccountSessionService({
    store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }),
    validate: createNetEaseAccountSessionValidator({ loginStatus: async () => ({ status: 503, body: { code: 503 } }) }),
  })
  assert.equal((await service.validateSession()).status, 'network_error')
  assert.deepEqual(service.getSession(), { cookie: FAKE_COOKIE })
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

test('FileNetEaseSessionStore removes a credential temp file when rename fails', async () => {
  const files = new Map()
  const removed = []
  const store = createFileNetEaseSessionStore({
    filePath: '/safe/netease-cookie.txt',
    fs: {
      mkdir: async () => {},
      readFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error },
      writeFile: async (filePath, value, options) => { files.set(filePath, { value, options }) },
      rename: async () => { throw new Error('rename_failed') },
      unlink: async (filePath) => { removed.push(filePath); files.delete(filePath) },
    },
  })
  await assert.rejects(() => store.set({ cookie: FAKE_COOKIE }), /rename_failed/)
  assert.equal(files.size, 0)
  assert.equal(removed.length, 1)
  assert.match(removed[0], /^\/safe\/netease-cookie\.txt\.[0-9a-f-]{36}\.tmp$/)
})

test('FileNetEaseSessionStore cleans a possibly-created temp file when write fails', async () => {
  const files = new Set()
  const store = createFileNetEaseSessionStore({
    filePath: '/safe/netease-cookie.txt',
    fs: {
      mkdir: async () => {},
      readFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error },
      writeFile: async (filePath, _value, options) => {
        files.add(filePath)
        assert.equal(options.mode, 0o600)
        throw new Error('write_failed')
      },
      rename: async () => { throw new Error('rename_must_not_run') },
      unlink: async (filePath) => { files.delete(filePath) },
    },
  })
  await assert.rejects(() => store.set({ cookie: FAKE_COOKIE }), /write_failed/)
  assert.equal(files.size, 0)
})

test('session public status is adapted to legacy account fields before capability consumers run', async () => {
  const session = createNetEaseAccountSessionService({
    store: createMemoryNetEaseSessionStore({ cookie: FAKE_COOKIE }),
    validate: createNetEaseAccountSessionValidator({
      loginStatus: async () => ({ body: { code: 200, data: { profile: { userId: 42, nickname: 'Test User', avatarUrl: 'https://example.test/avatar', vipType: 11 } } } }),
    }),
  })
  const calls = []
  const api = {
    async user_record(query) { calls.push({ method: 'user_record', uid: query.uid }); return { body: { code: 200, weekData: [] } } },
    async likelist(query) { calls.push({ method: 'likelist', uid: query.uid }); return { body: { code: 200, ids: ['1'] } } },
    async vip_info_v2(query) { calls.push({ method: 'vip_info_v2', uid: query.uid }); return { body: { code: 200, data: {} } } },
    async user_dj(query) { calls.push({ method: 'user_dj', uid: query.uid }); return { body: { code: 200, programs: [] } } },
  }
  const getLoginInfo = async () => toNeteaseLoginInfo(await session.validateSession())
  const capabilityService = createNeteaseCapabilityService({ api, getCookie: () => session.getSession()?.cookie || '', getLoginInfo })

  const info = await getLoginInfo()
  assert.equal(info.userId, 42)
  assert.equal(info.user?.userId, 42)
  assert.doesNotMatch(JSON.stringify(info), /MUSIC_U|cookie|token|fake-session-value/i)
  await capabilityService.userRecord()
  await capabilityService.likedStatus({ ids: '1' })
  await capabilityService.membership()
  await capabilityService.podcasts({ source: 'created' })
  assert.deepEqual(calls, [
    { method: 'user_record', uid: 42 },
    { method: 'likelist', uid: 42 },
    { method: 'vip_info_v2', uid: 42 },
    { method: 'user_dj', uid: 42 },
  ])
})
