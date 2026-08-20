import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createYunAgent } from './agentLoop.js'

function onlineModel(toolCalls = [], semanticProposal = null) {
  return {
    getStatus: () => ({ status: 'MODEL_ONLINE' }),
    sendMessage: async ({ systemPrompt = '' }) => (
      systemPrompt.includes('background skill analyst')
        ? { toolCalls: [], response: { message: '后台分析完成。', ...semanticProposal } }
        : { toolCalls, response: { message: '已规划。' } }
    ),
  }
}

test('skills return declarative playlist actions without browser ownership', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '帮我做一个歌单', context: { online: true } })
    assert.equal(result.ok, true)
    assert.equal(result.source, 'skill')
    assert.equal(result.actions[0].type, 'music.recommend')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a named personal playlist never falls back to an AI recommendation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '播放我叫「夜跑收藏」的歌单', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.deepEqual(result.actions, [{ type: 'music.play_netease_playlist', payload: { playlistName: '夜跑收藏' } }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('NetEase liked songs are treated as an exact playlist target', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '播放我喜欢的音乐', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.equal(result.message, '好，给你放「我喜欢的音乐」。')
    assert.deepEqual(result.actions, [{ type: 'music.play_netease_playlist', payload: { playlistName: '我喜欢的音乐' } }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('playlist skill preserves an explicit listening scene in its queue query', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '给我创造一个运动时可以听的歌单', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.deepEqual(result.actions[0], { type: 'music.search_netease', payload: { query: '运动 歌曲', queue: true, limit: 4 } })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('lonely holiday playlist requests receive a companion response before music is arranged', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '今天七夕就我一个人过，给我来一组歌单吧', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.match(result.message, /七夕一个人过/)
    assert.equal(result.actions[0].type, 'music.recommend')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('scene requests use the playlist skill when the Pro planner is unavailable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '给我来点适合跑步的歌。', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.deepEqual(result.actions, [{ type: 'music.search_netease', payload: { query: '运动 歌曲', queue: true, limit: 4 } }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('night-route requests can prepare a queue without interrupting the current song', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '先别急着换歌，给我准备一组夜路回家的歌。', context: { online: true } })
    assert.equal(result.source, 'skill')
    assert.deepEqual(result.actions, [{ type: 'music.prepare_queue', payload: { query: '夜路回家 舒缓 歌曲', limit: 4 } }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('playlist skill preserves setup actions before building its queue', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '切到随机播放，然后把这首收藏，再做一张跑步歌单', context: { online: true } })
    assert.deepEqual(result.actions, [
      { type: 'music.set_mode', payload: { mode: 'shuffle' } },
      { type: 'music.add_to_collection', payload: { target: 'liked' } },
      { type: 'music.search_netease', payload: { query: '运动 歌曲', queue: true, limit: 4 } },
    ])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('playlist skill preserves a response-mode setup before its queue', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel() })
    const result = await agent.handle({ message: '进入专注模式，然后做一张雨天歌单', context: { online: true } })
    assert.deepEqual(result.actions, [
      { type: 'music.set_response_mode', payload: { mode: 'silent' } },
      { type: 'music.search_netease', payload: { query: '雨天 歌曲', queue: true, limit: 4 } },
    ])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('model tool calls are schema checked and become renderer actions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: onlineModel([{ function: { name: 'music_play_track', arguments: JSON.stringify({ trackId: 'a' }) } }]) })
    const result = await agent.handle({ message: '播放这首', context: { library: [{ id: 'a', title: 'A' }] } })
    assert.equal(result.ok, true)
    assert.equal(result.actions[0].type, 'music.play_track')
    assert.equal(result.actions[0].payload.track.id, 'a')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('agent falls back to a JSON action plan when function calling returns no content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  let calls = 0
  try {
    const agent = createYunAgent({
      dataDir: dir,
      modelProvider: {
        getStatus: () => ({ status: 'MODEL_ONLINE' }),
        sendMessage: async () => {
          calls += 1
          if (calls === 1) throw new Error('model returned no answer content')
          return { toolCalls: [], response: { message: '我给你准备好了。', toolCalls: [{ name: 'music_search_netease', arguments: { query: '夜路回家 舒缓 歌曲' } }] } }
        },
      },
    })
    const result = await agent.handle({ message: '按你对我此刻状态的判断，安排接下来听什么。', context: { online: true } })
    assert.equal(calls, 2)
    assert.equal(result.ok, true)
    assert.deepEqual(result.actions, [{ type: 'music.search_netease', payload: { query: '夜路回家 舒缓 歌曲' } }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('offline model never invents a music action', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const agent = createYunAgent({ dataDir: dir, modelProvider: { getStatus: () => ({ status: 'MODEL_OFFLINE' }) } })
    const result = await agent.handle({ message: '来点音乐' })
    assert.equal(result.ok, false)
    assert.deepEqual(result.actions, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('agent applies a verified model configuration without persisting the secret', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  let received = null
  try {
    const agent = createYunAgent({
      dataDir: dir,
      modelProvider: {
        getStatus: () => ({ status: 'MODEL_OFFLINE' }),
        connect: async (config) => {
          received = config
          return { status: 'MODEL_ONLINE', provider: 'deepseek', model: config.model }
        },
      },
    })
    const result = await agent.configureModel({ apiKey: 'temporary-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' })
    assert.deepEqual(result, { status: 'MODEL_ONLINE', provider: 'deepseek', model: 'deepseek-v4-pro' })
    assert.equal(received.apiKey, 'temporary-key')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('agent creates its runtime data directory on first request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  const nested = path.join(dir, 'runtime', 'agent')
  try {
    const agent = createYunAgent({ dataDir: nested, modelProvider: onlineModel() })
    await agent.handle({ message: '帮我做一个歌单', context: { online: true } })
    assert.equal((await stat(path.join(nested, 'runtime_state.json'))).isFile(), true)
    assert.equal((await stat(path.join(nested, 'memory.json'))).isFile(), true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('approved mined skills bypass the model on their next matching request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-agent-'))
  try {
    const model = onlineModel(
      [{ function: { name: 'music_recommend', arguments: '{}' } }],
      { family: 'scene_recommendation', title: '场景化续播', rationale: '会根据当前场景推荐。' },
    )
    const agent = createYunAgent({ dataDir: dir, modelProvider: model })
    let candidate = null
    for (let index = 0; index < 3; index += 1) {
      const result = await agent.handle({ message: '帮我安排一个通勤时听歌的流程', context: { online: true } })
      const outcome = await agent.recordOutcome({ runId: result.runId, success: true })
      candidate = outcome.candidate || candidate
    }
    for (let attempt = 0; attempt < 10 && !candidate; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      candidate = (await agent.listSkillCandidates())[0] || null
    }
    await agent.decideSkillCandidate({ candidateId: candidate.id, decision: 'approved' })
    const result = await agent.handle({ message: '小云，帮我安排一个通勤时听歌的流程', context: { online: true } })
    assert.equal(result.source, 'user_skill')
    assert.equal(result.actions[0].type, 'music.recommend')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
