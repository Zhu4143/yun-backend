import assert from 'node:assert/strict'
import test from 'node:test'
import { createContinuousVoiceCall, isCompanionCallEnd, normalizeCompanionTranscript } from './continuousVoiceCall.js'

function timers() {
  const entries = new Map()
  let id = 0
  return { entries, schedule(callback, delay) { entries.set(++id, { callback, delay }); return id }, cancel(key) { entries.delete(key) } }
}

test('continuous capture never reopens before explicit consent or while a turn is busy', () => {
  const clock = timers()
  const call = createContinuousVoiceCall(clock)
  call.resumeAfter({}, () => assert.fail('no consent'))
  assert.equal(clock.entries.size, 0)
  call.start()
  call.resumeAfter({ busy: true }, () => assert.fail('parallel recorder'))
  assert.equal(clock.entries.size, 0)
})

test('a completed spoken reply leaves an echo guard before reopening one listening turn', () => {
  const clock = timers()
  const call = createContinuousVoiceCall(clock)
  const token = call.start()
  let resumed = 0
  call.resumeAfter({ now: 1000, lastSpeechEndedAt: 900 }, (current) => { assert.equal(current, token); resumed += 1 })
  assert.equal([...clock.entries.values()][0].delay, 850)
  const old = [...clock.entries.values()][0].callback
  call.resumeAfter({ now: 1200, lastSpeechEndedAt: 900 }, () => { resumed += 1 })
  assert.equal(clock.entries.size, 1)
  call.stop()
  old()
  assert.equal(resumed, 0)
  assert.equal(clock.entries.size, 0)
})

test('leaving the page or stopping the call revokes stale callbacks and pending start results', () => {
  const clock = timers()
  const call = createContinuousVoiceCall(clock)
  const first = call.start()
  call.resumeAfter({}, () => assert.fail('stale reopen'))
  const stale = [...clock.entries.values()][0].callback
  call.stop()
  const second = call.start()
  stale()
  assert.equal(call.isCurrent(first), false)
  assert.equal(call.isCurrent(second), true)
})

test('spoken end phrases finish the call while ordinary music requests remain requests', () => {
  for (const phrase of ['结束对话', '小云，先这样。', '没事了，小昀', '停止陪聊']) assert.equal(isCompanionCallEnd(phrase), true)
  assert.equal(isCompanionCallEnd('播放结束以后继续推荐'), false)
  assert.equal(normalizeCompanionTranscript('小昀，播放晴天'), '播放晴天')
  assert.equal(normalizeCompanionTranscript('，。！？'), '')
})
