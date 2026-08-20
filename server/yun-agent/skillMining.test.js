import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSkillMining } from './skillMining.js'

test('only repeated successful safe action plans become approvable skills', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-skill-mining-'))
  try {
    const mining = createSkillMining({ dataDir: dir, threshold: 3, now: () => new Date('2026-08-17T00:00:00Z') })
    let candidate = null
    for (const runId of ['one', 'two', 'three']) {
      await mining.recordPlan({ runId, message: '切换到随机播放', actions: [{ type: 'music.set_mode', payload: { mode: 'shuffle' } }] })
      candidate = (await mining.recordOutcome({ runId, success: true })).candidate
    }
    assert.equal(candidate.status, 'proposed')
    assert.equal(candidate.requiresHumanApproval, true)
    await mining.decide({ candidateId: candidate.id, decision: 'approved' })
    assert.equal((await mining.match('小云，切换到随机播放')).actions[0].type, 'music.set_mode')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('unsafe or failed plans never create a candidate', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-skill-mining-'))
  try {
    const mining = createSkillMining({ dataDir: dir, threshold: 1 })
    await mining.recordPlan({ runId: 'unsafe', message: '搜索一首歌', actions: [{ type: 'music.search_netease', payload: { query: 'x' } }] })
    assert.equal((await mining.recordOutcome({ runId: 'unsafe', success: true })).ok, false)
    await mining.recordPlan({ runId: 'failed', message: '做歌单', actions: [{ type: 'music.recommend', payload: {} }] })
    assert.equal((await mining.recordOutcome({ runId: 'failed', success: false })).candidate, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('approved scene recommendation skill matches different scene wording locally', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-skill-mining-'))
  try {
    const mining = createSkillMining({ dataDir: dir, threshold: 1 })
    await mining.recordPlan({ runId: 'scene', message: '雨天回家来点放松的歌', actions: [{ type: 'music.recommend', payload: { queue: true } }] })
    const run = (await mining.recordOutcome({ runId: 'scene', success: true }))
    const candidate = await mining.applySemanticProposal({
      actionKey: run.analysisRequest.actionKey,
      proposal: { family: 'scene_recommendation', title: '场景化续播', rationale: '安全推荐' },
    })
    await mining.decide({ candidateId: candidate.id, decision: 'approved' })
    assert.equal((await mining.match('今天通勤想听轻松一点')).id.startsWith('user_skill_'), true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
