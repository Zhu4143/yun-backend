import test from 'node:test'
import assert from 'node:assert/strict'
import { getPodcastLengthPolicy, finishPodcastReply } from './podcastReactionPolicy.js'

test('long podcast retains a complete multi-sentence observation beyond the old 56-character cap', () => {
  const text = '上一首留下来的情绪还没有完全散开，我们可以先让它停一会儿。下一段不必急着重新开始，你可以把注意力从歌名移回自己的呼吸。等旋律慢慢展开，再看看这一刻让你想起了什么。'
  assert.equal(finishPodcastReply(text, 'long'), text)
  for (const length of ['short', 'medium', 'long']) {
    assert.ok(getPodcastLengthPolicy(length).maxTokens >= 3072, 'Pro reasoning must leave a budget for final JSON, even for short speech')
  }
})
test('short and medium endings use complete sentences rather than slicing speech in half', () => {
  const sentence = '这一句可以完整地说到结尾，不会突然截断。'
  assert.equal(finishPodcastReply(sentence.repeat(8), 'short'), sentence.repeat(2))
  assert.equal(finishPodcastReply('', 'long'), '')
})
