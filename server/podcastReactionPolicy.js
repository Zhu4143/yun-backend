const policies = Object.freeze({
  short: { guide: '1 到 2 句，约 35 到 70 字', sentences: 2, maxCharacters: 100, maxTokens: 4096 },
  medium: { guide: '3 到 4 句，约 90 到 150 字', sentences: 4, maxCharacters: 190, maxTokens: 4096 },
  long: { guide: '4 到 6 句，约 160 到 240 字', sentences: 6, maxCharacters: 300, maxTokens: 4096 },
})

export function getPodcastLengthPolicy(length = 'medium') {
  return policies[length] || policies.medium
}

export function finishPodcastReply(reply, length = 'medium') {
  const policy = getPodcastLengthPolicy(length)
  const sentences = String(reply || '').trim().match(/[^。！？!?]+[。！？!?]?/g) || []
  let result = ''
  for (const sentence of sentences.slice(0, policy.sentences)) {
    if (result && result.length + sentence.length > policy.maxCharacters) break
    result += sentence
  }
  return result.trim()
}
