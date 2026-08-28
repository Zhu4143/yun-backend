import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMusicRecommendationMemoryContext } from './recommendationContext.js'

test('positive music taste is recalled for open ended recommendation', () => {
  const context = buildMusicRecommendationMemoryContext({
    userText: '你帮我放一首吧',
    musicPreferences: ['用户长期喜欢钢琴 + 女声 + 安静氛围的歌'],
  })

  assert.deepEqual(context.positivePreferences, ['用户长期喜欢钢琴 + 女声 + 安静氛围的歌'])
  assert.match(context.prompt, /钢琴/)
  assert.match(context.prompt, /女声/)
  assert.match(context.prompt, /安静氛围/)
  assert.match(context.prompt, /优先考虑长期正向偏好/)
})

test('negative music taste is recalled to avoid noisy recommendations', () => {
  const context = buildMusicRecommendationMemoryContext({
    userText: '随便放一首',
    musicPreferences: ['别再给我推这种吵的歌', '避免太炸、强刺激、过度高能的音乐'],
  })

  assert.deepEqual(context.avoidPreferences, ['别再给我推这种吵的歌', '避免太炸、强刺激、过度高能的音乐'])
  assert.match(context.prompt, /长期避开项/)
  assert.match(context.prompt, /吵/)
  assert.match(context.prompt, /太炸/)
  assert.match(context.prompt, /强刺激/)
})

test('temporary quiet mood affects current recommendation only', () => {
  const currentSession = buildMusicRecommendationMemoryContext({
    userText: '你来选一首',
    musicPreferences: [],
    recentChat: [{ role: 'user', content: '今天想听点安静的。' }],
  })
  const newSession = buildMusicRecommendationMemoryContext({
    userText: '你来选一首',
    musicPreferences: [],
    recentChat: [],
  })

  assert.deepEqual(currentSession.sessionScopedPreferences, ['今天想听点安静的。'])
  assert.match(currentSession.prompt, /当前会话临时需求/)
  assert.deepEqual(currentSession.positivePreferences, [])
  assert.deepEqual(newSession.sessionScopedPreferences, [])
  assert.doesNotMatch(newSession.prompt, /今天想听点安静的/)
})

test('bedtime listening habit is recalled in sleep context', () => {
  const context = buildMusicRecommendationMemoryContext({
    userText: '我要睡了，帮我放一首。',
    musicPreferences: ['以后我睡前都想听这种'],
  })

  assert.deepEqual(context.sceneHabits, ['以后我睡前都想听这种'])
  assert.equal(context.bedtimeHabitMatched, true)
  assert.match(context.prompt, /睡前习惯已命中/)
  assert.match(context.prompt, /安静、放松、低刺激/)
})

test('conflicting music preferences are merged without dropping avoidance', () => {
  const context = buildMusicRecommendationMemoryContext({
    userText: '来点有情绪的。',
    musicPreferences: [
      '用户喜欢钢琴女声',
      '用户喜欢安静氛围',
      '避免太吵',
      '不要太炸或高刺激',
    ],
  })

  assert.deepEqual(context.positivePreferences, ['用户喜欢钢琴女声', '用户喜欢安静氛围'])
  assert.deepEqual(context.avoidPreferences, ['避免太吵', '不要太炸或高刺激'])
  assert.match(context.prompt, /来点有情绪的/)
  assert.match(context.prompt, /有情绪不等于高刺激/)
  assert.match(context.prompt, /避免太吵/)
  assert.doesNotMatch(context.prompt, /用户喜欢摇滚|用户经常听电子乐/)
})
