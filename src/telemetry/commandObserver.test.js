import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommandObserver } from './commandObserver.js'

function makeRecorder() {
  const events = []
  return {
    emit(type, payload, opts) {
      events.push({ type, payload, opts })
    },
    events,
  }
}

const handled = async () => ({ handled: true })

test('same semantic intent within window is recorded as repeated', async () => {
  const recorder = makeRecorder()
  const observe = createCommandObserver(handled, recorder)
  await observe({ message: '下一首' })
  await observe({ message: '换一首' })
  assert.equal(recorder.events.filter((event) => event.type === 'command.repeated').length, 1)
})

test('different intents are never recorded as repeated', async () => {
  const recorder = makeRecorder()
  const observe = createCommandObserver(handled, recorder)
  await observe({ message: '下一首' })
  await observe({ message: '声音小一点' })
  assert.equal(recorder.events.filter((event) => event.type === 'command.repeated').length, 0)
})

test('identical normalized text within window is recorded as repeated', async () => {
  const recorder = makeRecorder()
  const observe = createCommandObserver(handled, recorder)
  await observe({ message: '下一首' })
  await observe({ message: '下一首' })
  assert.equal(recorder.events.filter((event) => event.type === 'command.repeated').length, 1)
})

test('a single user input produces exactly one command.received', async () => {
  const recorder = makeRecorder()
  const observe = createCommandObserver(handled, recorder)
  await observe({ message: '播放一首歌' })
  assert.equal(recorder.events.filter((event) => event.type === 'command.received').length, 1)
})

test('command telemetry carries no raw text by default', async () => {
  const recorder = makeRecorder()
  const observe = createCommandObserver(handled, recorder)
  await observe({ message: '播放周杰伦的歌' })
  for (const event of recorder.events) {
    assert.equal('text' in (event.payload || {}), false)
    assert.equal(typeof event.payload?.length, 'number')
  }
})
