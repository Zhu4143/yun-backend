import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_ACTIONS = 4
const MAX_RUNS = 120
const PLAYBACK_MODES = new Set(['sequence', 'shuffle', 'loop_one', 'ai_recommend', 'companion_continue'])

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) } catch { return fallback }
}

function normalizeTrigger(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~…《》“”"']/g, '')
    .replace(/^(?:小云|小昀|请|帮我|麻烦|能不能|可以)+/, '')
    .slice(0, 80)
}

function safeAction(action) {
  const type = String(action?.type || '')
  const payload = action?.payload || {}
  if (type === 'music.recommend') {
    return { type, payload: { queue: Boolean(payload.queue), limit: Math.max(1, Math.min(8, Number(payload.limit) || 4)) } }
  }
  if (type === 'music.set_mode' && PLAYBACK_MODES.has(payload.mode)) return { type, payload: { mode: payload.mode } }
  if (type === 'music.analyze_section' && typeof payload.target === 'string' && payload.target.trim()) return { type, payload: { target: payload.target.trim().slice(0, 60) } }
  if (type === 'music.get_state') return { type, payload: { diagnostics: Boolean(payload.diagnostics) } }
  return null
}

function safeActions(actions) {
  const list = Array.isArray(actions) ? actions : []
  if (!list.length || list.length > MAX_ACTIONS) return null
  const sanitized = list.map(safeAction)
  return sanitized.every(Boolean) ? sanitized : null
}

function fingerprint(trigger, actions) {
  return crypto.createHash('sha256').update(JSON.stringify({ trigger, actions })).digest('hex').slice(0, 24)
}

function actionKey(actions) {
  return crypto.createHash('sha256').update(JSON.stringify(actions)).digest('hex').slice(0, 24)
}

function isSceneRecommendation(text) {
  const value = normalizeTrigger(text)
  if (!value || /(下一首|上一首|暂停|继续播放|停止播放)/.test(value)) return false
  return /(推荐|来点|放点|听点|想听|适合.*听|歌|音乐)/.test(value)
}

export function createSkillMining({ dataDir, now = () => new Date(), threshold = 3 } = {}) {
  const filePath = path.join(dataDir, 'skill_mining.json')
  const empty = () => ({ version: 'yun-skill-mining/v1', runs: [], candidates: [], skills: [] })

  async function load() {
    const data = await readJson(filePath, empty())
    return { ...empty(), ...data, runs: Array.isArray(data.runs) ? data.runs : [], candidates: Array.isArray(data.candidates) ? data.candidates : [], skills: Array.isArray(data.skills) ? data.skills : [] }
  }

  async function save(data) {
    await mkdir(dataDir, { recursive: true })
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  async function recordPlan({ runId, message, actions } = {}) {
    const trigger = normalizeTrigger(message)
    const safe = safeActions(actions)
    if (!runId || trigger.length < 2 || !safe) return { tracked: false }
    const data = await load()
    data.runs = [...data.runs.filter((run) => run.runId !== runId), {
      runId: String(runId), trigger, originalMessage: String(message).slice(0, 160), actions: safe,
      fingerprint: fingerprint(trigger, safe), actionKey: actionKey(safe), createdAt: now().toISOString(), outcome: null,
    }].slice(-MAX_RUNS)
    await save(data)
    return { tracked: true }
  }

  async function recordOutcome({ runId, success } = {}) {
    const data = await load()
    const run = data.runs.find((item) => item.runId === runId)
    if (!run || run.outcome) return { ok: false, candidate: null }
    run.outcome = success === true ? 'success' : 'failed'
    run.completedAt = now().toISOString()
    let candidate = null
    let analysisRequest = null
    if (run.outcome === 'success') {
      const successCount = data.runs.filter((item) => item.fingerprint === run.fingerprint && item.outcome === 'success').length
      candidate = data.candidates.find((item) => item.fingerprint === run.fingerprint) || null
      // Recommendation flows are the only family that is intentionally
      // generalized by the background Pro pass. Other safe flows retain the
      // conservative exact-trigger fallback from P6.1.
      if (!candidate && successCount >= threshold && !run.actions.every((item) => item.type === 'music.recommend')) {
        candidate = {
          id: `candidate_${crypto.randomUUID()}`,
          fingerprint: run.fingerprint,
          title: `常用操作：${run.originalMessage}`,
          trigger: run.trigger,
          actions: run.actions,
          successCount,
          status: 'proposed',
          requiresHumanApproval: true,
          createdAt: now().toISOString(),
        }
        data.candidates.push(candidate)
      }
      if (candidate) candidate.successCount = successCount

      const similarRuns = data.runs.filter((item) => item.actionKey === run.actionKey && item.outcome === 'success')
      const hasSemanticCandidate = data.candidates.some((item) => item.actionKey === run.actionKey && item.matcher?.family === 'scene_recommendation')
      if (!hasSemanticCandidate && similarRuns.length >= threshold && !similarRuns.some((item) => item.semanticQueuedAt)) {
        similarRuns.forEach((item) => { item.semanticQueuedAt = now().toISOString() })
        analysisRequest = {
          actionKey: run.actionKey,
          actions: run.actions,
          examples: similarRuns.slice(-12).map((item) => item.originalMessage),
        }
      }
    }
    await save(data)
    return { ok: true, candidate, analysisRequest }
  }

  async function applySemanticProposal({ actionKey: proposedActionKey, proposal } = {}) {
    if (proposal?.family !== 'scene_recommendation') return null
    const data = await load()
    const exemplar = data.runs.find((item) => item.actionKey === proposedActionKey)
    if (!exemplar || !exemplar.actions.every((item) => item.type === 'music.recommend')) return null
    const existing = data.candidates.find((item) => item.actionKey === proposedActionKey && item.matcher?.family === proposal.family)
    if (existing) return existing
    const candidate = {
      id: `candidate_${crypto.randomUUID()}`,
      fingerprint: `semantic_${proposedActionKey}`,
      actionKey: proposedActionKey,
      title: String(proposal.title || '按当前场景续播').trim().slice(0, 80),
      trigger: exemplar.trigger,
      actions: exemplar.actions,
      successCount: data.runs.filter((item) => item.actionKey === proposedActionKey && item.outcome === 'success').length,
      matcher: { family: 'scene_recommendation' },
      rationale: String(proposal.rationale || '').trim().slice(0, 180),
      status: 'proposed',
      requiresHumanApproval: true,
      createdAt: now().toISOString(),
    }
    data.candidates.push(candidate)
    await save(data)
    return candidate
  }

  async function listCandidates() {
    const data = await load()
    return data.candidates.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  async function decide({ candidateId, decision } = {}) {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be approved or rejected')
    const data = await load()
    const candidate = data.candidates.find((item) => item.id === candidateId)
    if (!candidate || candidate.status !== 'proposed') throw new Error('candidate is not awaiting approval')
    candidate.status = decision
    candidate.decidedAt = now().toISOString()
    if (decision === 'approved') {
      data.skills.push({
        id: `user_skill_${crypto.randomUUID()}`,
        name: candidate.title,
        trigger: candidate.trigger,
        actions: candidate.actions,
        matcher: candidate.matcher || { family: 'exact', trigger: candidate.trigger },
        sourceCandidateId: candidate.id,
        enabled: true,
        createdAt: candidate.decidedAt,
      })
    }
    await save(data)
    return candidate
  }

  async function match(message) {
    const trigger = normalizeTrigger(message)
    if (!trigger) return null
    const data = await load()
    return data.skills.find((skill) => {
      if (!skill.enabled) return false
      if (skill.matcher?.family === 'scene_recommendation') return isSceneRecommendation(message)
      return skill.trigger === trigger
    }) || null
  }

  return { recordPlan, recordOutcome, applySemanticProposal, listCandidates, decide, match }
}
