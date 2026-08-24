export function formatYunChatErrorReply(error) {
  const message = error instanceof Error ? error.message : ''
  if (error?.code === 'network_error' || /fetch failed|failed to fetch|networkerror/i.test(message)) {
    return '我刚才没能连接上服务。你可以检查网络后再试一次。'
  }
  return error instanceof Error && error.message
    ? `我刚才有点卡住了：${error.message}`
    : '我刚才有点卡住了。你再说一遍，我听着。'
}
