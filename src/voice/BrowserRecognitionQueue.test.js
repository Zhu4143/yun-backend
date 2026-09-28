import assert from 'node:assert/strict'
import test from 'node:test'

import { BrowserRecognitionQueue } from './BrowserRecognitionQueue.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('a complete segment arriving during recognition waits and is processed next', async () => {
  const queue = new BrowserRecognitionQueue()
  const firstRecognition = deferred()
  const starts = []
  let active = 0
  let maxActive = 0
  const processSegment = async ({ id }) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    starts.push(id)
    if (id === 1) await firstRecognition.promise
    active -= 1
  }

  queue.enqueue({ id: 1 })
  const draining = queue.drain(processSegment)
  queue.enqueue({ id: 2 })
  await Promise.resolve()

  assert.deepEqual(starts, [1])
  firstRecognition.resolve()
  await draining

  assert.deepEqual(starts, [1, 2])
  assert.equal(maxActive, 1)
  assert.equal(queue.pendingCount, 0)
})
