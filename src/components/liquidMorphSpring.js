export const LIQUID_MORPH_STIFFNESS = 140
export const LIQUID_MORPH_BOUNCE = 0.62
export const LIQUID_MORPH_REVEAL_PROGRESS = 0.86
export const LIQUID_MORPH_MIN_REVEAL_SECONDS = 0.48

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const lerp = (from, to, amount) => from + (to - from) * amount

export function stepLiquidMorph(
  spring,
  delta,
  target = 1,
  bounce = LIQUID_MORPH_BOUNCE,
) {
  const safeDelta = clamp(Number(delta) || 0, 0, 0.05)
  const dampingRatio = 1 - 0.65 * clamp(bounce, 0, 1)
  const damping = 2 * dampingRatio * Math.sqrt(LIQUID_MORPH_STIFFNESS)
  const maxStep = 1 / 120
  const steps = Math.min(16, Math.max(1, Math.ceil(safeDelta / maxStep)))
  const step = safeDelta / steps
  let progress = spring.progress
  let velocity = spring.velocity

  for (let index = 0; index < steps; index += 1) {
    const acceleration = (target - progress) * LIQUID_MORPH_STIFFNESS - velocity * damping
    velocity += acceleration * step
    progress += velocity * step
  }

  return { progress, velocity }
}

export function resolveLiquidMorphDelta(elapsedSeconds, visibilityState = 'visible') {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0)
  return Math.min(elapsed, visibilityState === 'hidden' ? 0.5 : 1 / 30)
}

export function shouldRevealLiquidMorph(spring, elapsedSeconds) {
  return spring.progress >= LIQUID_MORPH_REVEAL_PROGRESS
    && elapsedSeconds >= LIQUID_MORPH_MIN_REVEAL_SECONDS
}

export function resolveLiquidMorphFrame(transition, spring) {
  const progress = spring.progress
  const clampedRadiusProgress = clamp(progress, 0, 1.15)
  const fromCenterX = transition.from.left + transition.from.width * 0.5
  const fromCenterY = transition.from.top + transition.from.height * 0.5
  const toCenterX = transition.to.left + transition.to.width * 0.5
  const toCenterY = transition.to.top + transition.to.height * 0.5
  const squeeze = 1 + Math.min(Math.abs(spring.velocity), 5) * 0.01
  const width = Math.max(1, lerp(transition.from.width, transition.to.width, progress) * squeeze)
  const height = Math.max(1, lerp(transition.from.height, transition.to.height, progress) / squeeze)
  const centerX = lerp(fromCenterX, toCenterX, progress)
  const centerY = lerp(fromCenterY, toCenterY, progress)
  const directionLength = Math.hypot(toCenterX - fromCenterX, toCenterY - fromCenterY) || 1

  return {
    left: centerX - width * 0.5,
    top: centerY - height * 0.5,
    width,
    height,
    radius: Math.max(0, lerp(transition.fromRadius, transition.toRadius, clampedRadiusProgress)),
    energy: Math.min(Math.abs(spring.velocity) / 4.5, 1),
    directionX: (toCenterX - fromCenterX) / directionLength,
    directionY: (toCenterY - fromCenterY) / directionLength,
  }
}

export function liquidMorphHasSettled(spring, target = 1) {
  return Math.abs(target - spring.progress) < 0.0015 && Math.abs(spring.velocity) < 0.025
}
