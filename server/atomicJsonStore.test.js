import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { AtomicJsonStore } from './atomicJsonStore.js'

async function createTempStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yun-json-store-'))
  const filePath = path.join(directory, 'memory.json')
  return {
    directory,
    filePath,
    store: new AtomicJsonStore(filePath, { defaultValue: { count: 0 } }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

test('concurrent updates are serialized and do not lose writes', async () => {
  const fixture = await createTempStore()
  try {
    await Promise.all(Array.from({ length: 24 }, () => fixture.store.update((current) => {
      current.count += 1
      return current
    })))

    assert.deepEqual(await fixture.store.load(), { count: 24 })
  } finally {
    await fixture.cleanup()
  }
})

test('a corrupt primary file recovers from the last valid backup', async () => {
  const fixture = await createTempStore()
  try {
    await fixture.store.write({ count: 7 })
    await fixture.store.write({ count: 8 })
    await writeFile(fixture.filePath, '{broken json', 'utf8')

    assert.deepEqual(await fixture.store.load(), { count: 7 })
    assert.deepEqual(JSON.parse(await readFile(fixture.filePath, 'utf8')), { count: 7 })
  } finally {
    await fixture.cleanup()
  }
})

test('an aborted update does not write its draft', async () => {
  const fixture = await createTempStore()
  const controller = new AbortController()
  let releaseUpdate
  try {
    await fixture.store.write({ count: 2 })
    const update = fixture.store.update(async (current) => {
      current.count = 99
      await new Promise((resolve) => { releaseUpdate = resolve })
      return current
    }, { signal: controller.signal })
    await new Promise((resolve) => {
      const waitForMutator = () => releaseUpdate ? resolve() : setImmediate(waitForMutator)
      waitForMutator()
    })
    controller.abort()
    releaseUpdate()

    await assert.rejects(update, (error) => error?.name === 'AbortError')
    assert.deepEqual(await fixture.store.load(), { count: 2 })
  } finally {
    await fixture.cleanup()
  }
})
