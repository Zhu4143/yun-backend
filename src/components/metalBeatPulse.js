export function nextMetalBeatPulse(state, frequencyData, deltaSeconds) {
  const previous = state || { baseline: 0, pulse: 0 }
  const bins = frequencyData?.length ? Math.min(18, Math.max(1, Math.floor(frequencyData.length * 0.055))) : 0
  let bass = 0
  for (let index = 1; index < bins; index += 1) bass += Number(frequencyData[index] || 0) / 255
  bass /= Math.max(1, bins - 1)
  const baseline = previous.baseline + (bass - previous.baseline) * Math.min(1, deltaSeconds * 1.4)
  const onset = Math.max(0, bass - baseline)
  const hit = Math.min(1, Math.max(0, (onset - 0.045) * 7))
    * Math.min(1, Math.max(0, (bass - 0.07) * 4))
  return {
    baseline,
    pulse: Math.max(hit, previous.pulse * Math.exp(-deltaSeconds * 6.5)),
  }
}
