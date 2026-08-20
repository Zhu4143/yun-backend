const MIN_BPM = 68
const MAX_BPM = 184

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeTempo(bpm, reference = 112) {
  let value = Number(bpm)
  if (!Number.isFinite(value) || value <= 0) return null
  while (value < MIN_BPM) value *= 2
  while (value > MAX_BPM) value /= 2
  const alternatives = [value / 2, value, value * 2]
    .filter((candidate) => candidate >= MIN_BPM && candidate <= MAX_BPM)
  return alternatives.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference))[0] || value
}

export function analyzeRhythmWindow(samples, sampleRate) {
  const data = samples instanceof Int16Array ? samples : new Int16Array(samples || [])
  const rate = Number(sampleRate) || 8000
  if (data.length < rate * 4) return { bpm: null, confidence: 0, energy: 0, firstOnsetSec: 0 }

  const hop = Math.max(64, Math.round(rate * 0.02))
  const envelope = []
  let totalEnergy = 0
  for (let offset = 0; offset + hop <= data.length; offset += hop) {
    let sum = 0
    for (let index = offset; index < offset + hop; index += 1) {
      const value = data[index] / 32768
      sum += value * value
    }
    const rms = Math.sqrt(sum / hop)
    envelope.push(rms)
    totalEnergy += rms
  }

  const meanEnergy = totalEnergy / Math.max(1, envelope.length)
  const onset = new Float32Array(envelope.length)
  let previous = envelope[0] || 0
  for (let index = 1; index < envelope.length; index += 1) {
    const localBaseline = previous * 0.84 + envelope[index] * 0.16
    onset[index] = Math.max(0, envelope[index] - localBaseline)
    previous = localBaseline
  }

  const framesPerSecond = rate / hop
  const minLag = Math.max(1, Math.floor(framesPerSecond * 60 / MAX_BPM))
  const maxLag = Math.min(onset.length - 2, Math.ceil(framesPerSecond * 60 / MIN_BPM))
  let bestLag = 0
  let bestScore = 0
  let scoreTotal = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0
    for (let index = lag; index < onset.length; index += 1) {
      score += onset[index] * onset[index - lag]
    }
    // Mildly prefer the fundamental over half-time aliases.
    score *= 1 + (lag - minLag) / Math.max(1, maxLag - minLag) * 0.06
    scoreTotal += score
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  const peakThreshold = Math.max(0.004, meanEnergy * 0.42)
  const firstOnsetFrame = onset.findIndex((value, index) => index > 1 && value >= peakThreshold)
  const confidence = bestScore > 0 ? clamp(bestScore / Math.max(1e-6, scoreTotal / Math.max(1, maxLag - minLag + 1)) / 8, 0, 1) : 0
  const rawBpm = bestLag ? 60 * framesPerSecond / bestLag : null

  return {
    bpm: rawBpm ? Math.round(normalizeTempo(rawBpm) * 10) / 10 : null,
    confidence: Math.round(confidence * 1000) / 1000,
    energy: Math.round(clamp(meanEnergy * 7.5, 0, 1) * 1000) / 1000,
    firstOnsetSec: firstOnsetFrame > 0 ? Math.round(firstOnsetFrame / framesPerSecond * 1000) / 1000 : 0,
  }
}

export function createSeamlessTransitionPlan(fromAnalysis, candidateAnalyses = []) {
  const fromBpm = normalizeTempo(fromAnalysis?.bpm)
  const fromEnergy = Number(fromAnalysis?.energy) || 0.35
  const ranked = candidateAnalyses
    .filter((item) => item?.track)
    .map((item, index) => {
      const toBpm = normalizeTempo(item.analysis?.bpm, fromBpm || 112)
      const bpmGap = fromBpm && toBpm ? Math.abs(Math.log2(toBpm / fromBpm)) : 0.34
      const energyGap = Math.abs((Number(item.analysis?.energy) || 0.35) - fromEnergy)
      const confidence = Math.min(Number(fromAnalysis?.confidence) || 0, Number(item.analysis?.confidence) || 0)
      return {
        ...item,
        index,
        toBpm,
        score: 100 - bpmGap * 155 - energyGap * 30 + confidence * 9 - index * 0.35,
      }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const selected = ranked[0]
  if (!selected) return null

  const targetBpm = fromBpm && selected.toBpm
    ? Math.sqrt(fromBpm * selected.toBpm)
    : fromBpm || selected.toBpm || 112
  const fromRate = fromBpm ? clamp(targetBpm / fromBpm, 0.95, 1.05) : 1
  const toRate = selected.toBpm ? clamp(targetBpm / selected.toBpm, 0.95, 1.05) : 1
  const crossfadeMs = clamp((60 / targetBpm) * 16 * 1000, 5200, 9000)

  return {
    version: 'yun-seamless-transition/v1',
    selectedTrackId: String(selected.track.providerId || selected.track.id || ''),
    candidateOrder: ranked.map((item) => String(item.track.providerId || item.track.id || '')),
    fromBpm: fromBpm ? Math.round(fromBpm * 10) / 10 : null,
    toBpm: selected.toBpm ? Math.round(selected.toBpm * 10) / 10 : null,
    fromRate: Math.round(fromRate * 1000) / 1000,
    toRate: Math.round(toRate * 1000) / 1000,
    crossfadeMs: Math.round(crossfadeMs),
    startOffsetSec: clamp(Number(selected.analysis?.firstOnsetSec) || 0, 0, 0.75),
    restoreDurationMs: 9000,
    confidence: Math.round(Math.min(Number(fromAnalysis?.confidence) || 0, Number(selected.analysis?.confidence) || 0) * 1000) / 1000,
    provider: 'ffmpeg-onset-autocorrelation',
  }
}
