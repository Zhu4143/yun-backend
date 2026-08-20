import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) } catch { return fallback }
}

export function createFeedbackLoop({ dataDir, discovery, now = () => new Date() } = {}) {
  const decisionsPath = path.join(dataDir, 'yun_requirement_decisions.json')
  const profilePath = path.join(dataDir, 'yun_feedback_profile.json')

  async function list() {
    return readJson(decisionsPath, { version: 'yun-requirement-decisions/v1', decisions: [] })
  }

  async function decide({ requirementId, decision, reason = '' } = {}) {
    if (!['adopted', 'rejected'].includes(decision)) throw new Error('decision must be adopted or rejected')
    const backlog = await discovery.getBacklog()
    const item = backlog.items.find((candidate) => candidate.id === requirementId)
    if (!item) throw new Error('requirement is not an active proposal')
    const record = await list()
    const entry = { requirementId, decision, reason: String(reason).slice(0, 300), decidedAt: now().toISOString(), evidence: item.evidence, applied: false }
    record.decisions = [...record.decisions.filter((item) => item.requirementId !== requirementId), entry]
    await mkdir(dataDir, { recursive: true })
    await writeFile(decisionsPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

    // P6 begins with an auditable preference signal only. Runtime behavior is
    // intentionally unchanged until a later, separately approved integration.
    if (decision === 'adopted') {
      const profile = await readJson(profilePath, { version: 'yun-feedback-profile/v1', signals: {} })
      profile.signals[requirementId] = { acknowledgedAt: entry.decidedAt, reason: entry.reason, evidence: item.evidence }
      await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
    }
    return entry
  }

  return { list, decide }
}
