export async function awaitConversationMemoryWrites({ policy, signal, writes = [] } = {}) {
  if (!policy?.enabled) return { written: false }
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
  await Promise.all(writes.map((write) => write({ signal })))
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
  return { written: writes.length > 0 }
}
