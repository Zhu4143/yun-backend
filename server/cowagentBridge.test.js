import test from 'node:test'
import assert from 'node:assert/strict'
import { createCowAgentCommandQueue, extractCowAgentCommand } from './cowagentBridge.js'

test('CowAgent commands require an explicit Yun prefix', () => {
  assert.equal(extractCowAgentCommand('昀，播放我的跑步歌单'), '播放我的跑步歌单')
  assert.equal(extractCowAgentCommand('@昀 换一首'), '换一首')
  assert.equal(extractCowAgentCommand('帮我换一首'), '')
})

test('remote jobs are claimed once and report execution results', () => {
  let time = 1_000
  const queue = createCowAgentCommandQueue({ now: () => time })
  const job = queue.enqueue({ message: '下一首', reply: '好，给你换一首。', actions: [{ type: 'music.next', payload: {} }] })
  const [claimed] = queue.claim({ clientId: 'yun-web' })
  assert.equal(claimed.id, job.id)
  assert.deepEqual(queue.claim({ clientId: 'other-client' }), [])
  time += 1
  assert.equal(queue.report(job.id, { success: true }).status, 'completed')
})
