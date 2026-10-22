import { stepLiquidOreHover } from '../components/liquidOreSource.js'

// Preserve the source spring's position and velocity when a pointer reverses.
// Small integration steps keep its response stable across display frame rates.
export function advanceGlassSpring(state, elapsed, target, reduced = false) {
  if (reduced) return { progress: target, velocity: 0 }
  let next = state, remaining = Math.min(.12, Math.max(0, elapsed))
  while (remaining > .000001) {
    const delta = Math.min(1 / 120, remaining)
    next = stepLiquidOreHover(next, delta, target)
    remaining -= delta
  }
  return glassSpringMoving(next, target) ? next : { progress: target, velocity: 0 }
}

export function glassSpringMoving(state, target) {
  return Math.abs(state.progress - target) > .0001 || Math.abs(state.velocity) > .001
}
