import test from 'node:test'
import assert from 'node:assert/strict'
import { buildYunAgentFinalReply } from './yunAgentReply.js'

test('agent planning placeholder is replaced only after every renderer action succeeds', () => {
  const result = { message: '计划已生成，等待播放器执行结果。', actions: [{ type: 'music.recommend' }] }
  assert.equal(buildYunAgentFinalReply(result, [{ ok: true }]), '已经按你的要求执行完成。')
})

test('agent action failure cannot retain a planned or success-sounding reply', () => {
  const result = { message: '我已经准备好执行这些操作。', actions: [{ type: 'music.recommend' }] }
  const reply = buildYunAgentFinalReply(result, [{ ok: false, error: 'provider_error' }])
  assert.match(reply, /没有完成/)
  assert.doesNotMatch(reply, /准备好|执行完成/)
})
