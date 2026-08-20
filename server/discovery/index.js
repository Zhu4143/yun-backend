import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MIN_SAMPLES = 8

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0
}

function countByType(events) {
  return events.reduce((counts, event) => {
    const type = String(event?.type || '')
    if (type) counts[type] = (counts[type] || 0) + 1
    return counts
  }, {})
}

export function parseTelemetryNdjson(raw) {
  return String(raw || '').split(/\r?\n/).flatMap((line) => {
    try {
      const event = JSON.parse(line)
      return event?.type && event?.ts ? [event] : []
    } catch {
      return []
    }
  })
}

export function discoverRequirements(events, { minSamples = MIN_SAMPLES } = {}) {
  const totals = countByType(events)
  const candidate = ({ id, title, category, numerator, denominator, threshold, recommendation }) => {
    const sampleSize = totals[denominator] || 0
    const rate = ratio(totals[numerator] || 0, sampleSize)
    if (sampleSize < minSamples || rate < threshold) return null
    const confidence = Math.min(0.95, 0.45 + Math.min(sampleSize, 80) / 160 + rate * 0.35)
    return {
      id, title, category, status: 'proposed', requiresHumanApproval: true,
      evidence: { numerator, denominator, count: totals[numerator] || 0, sampleSize, rate: Number(rate.toFixed(3)) },
      confidence: Number(confidence.toFixed(3)), recommendation,
    }
  }

  const hypotheses = [
    candidate({ id: 'recommendation-skip-rate', title: '推荐跳过率偏高', category: 'recommendation', numerator: 'recommendation.rejected', denominator: 'recommendation.accepted', threshold: 0.4, recommendation: '复核推荐候选、上下文与拒绝原因后再调整排序。' }),
    candidate({ id: 'tts-interrupt-rate', title: 'TTS 被打断比例偏高', category: 'voice', numerator: 'tts.interrupted', denominator: 'tts.started', threshold: 0.3, recommendation: '检查播报时机、长度与可打断策略。' }),
    candidate({ id: 'command-failure-rate', title: '语音/聊天指令失败率偏高', category: 'command', numerator: 'command.failed', denominator: 'command.received', threshold: 0.12, recommendation: '审查失败指令的脱敏上下文与规则覆盖；先补回归用例。' }),
    candidate({ id: 'manual-skip-rate', title: '手动跳歌频率偏高', category: 'playback', numerator: 'playback.skip_manual', denominator: 'playback.play_started', threshold: 0.35, recommendation: '分析播放首段与推荐匹配，不自动改变 taste profile。' }),
  ].filter(Boolean)

  return hypotheses
    .map((item) => ({ ...item, priority: Number((item.confidence * 0.65 + item.evidence.rate * 0.35).toFixed(3)) }))
    .sort((a, b) => b.priority - a.priority)
}

export function createRequirementDiscovery({ dataDir, now = () => new Date() } = {}) {
  const telemetryPath = path.join(dataDir, 'yun_telemetry.ndjson')
  const backlogPath = path.join(dataDir, 'yun_requirement_backlog.json')

  async function refresh() {
    let raw = ''
    try { raw = await readFile(telemetryPath, 'utf8') } catch { /* no telemetry yet */ }
    const events = parseTelemetryNdjson(raw)
    const backlog = {
      version: 'yun-requirement-backlog/v1', mode: 'shadow', generatedAt: now().toISOString(),
      source: { eventCount: events.length, telemetryPath: path.basename(telemetryPath) },
      items: discoverRequirements(events),
      note: 'P5 only proposes verified candidates. No preference, rule, roadmap, or code change is applied automatically.',
    }
    await mkdir(dataDir, { recursive: true })
    await writeFile(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`, 'utf8')
    return backlog
  }

  async function getBacklog() {
    try { return JSON.parse(await readFile(backlogPath, 'utf8')) } catch { return refresh() }
  }
  return { refresh, getBacklog }
}
