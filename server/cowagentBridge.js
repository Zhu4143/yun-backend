import { randomUUID } from 'node:crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000

export function extractCowAgentCommand(message = '') {
  const text = String(message || '').trim()
  // CowAgent is a general assistant. Requiring a direct address prevents an
  // ordinary WeChat conversation from unexpectedly controlling the player.
  const match = text.match(/^(?:@\s*)?(?:昀|小昀)[，,:：\s]+(.+)$/u)
  return match?.[1]?.trim().slice(0, 500) || ''
}

export function createCowAgentCommandQueue({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const jobs = new Map()

  function prune() {
    const expiresBefore = now() - ttlMs
    for (const [id, job] of jobs) {
      if (job.createdAtMs < expiresBefore && job.status === 'queued') jobs.delete(id)
    }
  }

  function publicJob(job) {
    if (!job) return null
    return {
      id: job.id,
      status: job.status,
      message: job.message,
      reply: job.reply,
      createdAt: new Date(job.createdAtMs).toISOString(),
      claimedAt: job.claimedAtMs ? new Date(job.claimedAtMs).toISOString() : null,
      completedAt: job.completedAtMs ? new Date(job.completedAtMs).toISOString() : null,
      error: job.error || null,
    }
  }

  return {
    enqueue({ message, reply, actions = [], sender = '微信' } = {}) {
      prune()
      const id = `cow-yun-${randomUUID()}`
      const job = {
        id,
        message: String(message || '').trim().slice(0, 500),
        reply: String(reply || '').trim().slice(0, 800),
        actions: Array.isArray(actions) ? actions : [],
        sender: String(sender || '微信').trim().slice(0, 80),
        status: 'queued',
        createdAtMs: now(),
        claimedAtMs: 0,
        completedAtMs: 0,
        error: '',
      }
      jobs.set(id, job)
      return publicJob(job)
    },

    claim({ clientId, limit = 3 } = {}) {
      prune()
      const safeLimit = Math.max(1, Math.min(8, Number(limit) || 3))
      const claimed = []
      for (const job of jobs.values()) {
        if (job.status !== 'queued') continue
        job.status = 'executing'
        job.claimedBy = String(clientId || 'local-client').slice(0, 120)
        job.claimedAtMs = now()
        claimed.push({ ...publicJob(job), actions: job.actions, sender: job.sender })
        if (claimed.length >= safeLimit) break
      }
      return claimed
    },

    report(id, { success, error = '' } = {}) {
      const job = jobs.get(String(id || ''))
      if (!job) return null
      job.status = success ? 'completed' : 'failed'
      job.error = success ? '' : String(error || '本机播放器未能执行该命令。').slice(0, 300)
      job.completedAtMs = now()
      return publicJob(job)
    },

    get(id) {
      prune()
      return publicJob(jobs.get(String(id || '')))
    },
  }
}
