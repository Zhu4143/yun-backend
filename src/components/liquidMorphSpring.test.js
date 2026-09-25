import assert from 'node:assert/strict'
import test from 'node:test'
import {
  liquidMorphHasSettled,
  resolveLiquidMorphDelta,
  resolveLiquidMorphFrame,
  shouldRevealLiquidMorph,
  stepLiquidMorph,
} from './liquidMorphSpring.js'

test('liquid morph spring overshoots and settles independently of frame rate', () => {
  const run = (delta) => {
    let spring = { progress: 0, velocity: 0 }
    let maximum = 0
    for (let elapsed = 0; elapsed < 2.5; elapsed += delta) {
      spring = stepLiquidMorph(spring, delta)
      maximum = Math.max(maximum, spring.progress)
    }
    return { spring, maximum }
  }

  const fast = run(1 / 120)
  const slow = run(1 / 25)
  assert.ok(fast.maximum > 1.04)
  assert.ok(slow.maximum > 1.04)
  assert.ok(Math.abs(fast.maximum - slow.maximum) < 0.015)
  assert.ok(liquidMorphHasSettled(fast.spring))
  assert.ok(liquidMorphHasSettled(slow.spring))
})

test('liquid morph frame preserves target geometry and exposes motion energy', () => {
  const transition = {
    from: { left: 20, top: 30, width: 60, height: 40 },
    to: { left: 200, top: 100, width: 400, height: 260 },
    fromRadius: 20,
    toRadius: 32,
  }
  const moving = resolveLiquidMorphFrame(transition, { progress: 0.5, velocity: 3 })
  const final = resolveLiquidMorphFrame(transition, { progress: 1, velocity: 0 })

  assert.ok(moving.energy > 0)
  assert.ok(moving.width > (transition.from.width + transition.to.width) / 2)
  assert.equal(final.left, transition.to.left)
  assert.equal(final.top, transition.to.top)
  assert.equal(final.width, transition.to.width)
  assert.equal(final.height, transition.to.height)
  assert.equal(final.radius, transition.toRadius)
})

test('liquid morph does not expose panel content in the first instant', () => {
  let spring = { progress: 0, velocity: 0 }
  for (let elapsed = 0; elapsed < 0.12; elapsed += 1 / 60) {
    spring = stepLiquidMorph(spring, 1 / 60)
  }

  assert.ok(spring.progress < 0.72)
  assert.equal(shouldRevealLiquidMorph(spring, 0.12), false)
  assert.equal(shouldRevealLiquidMorph({ progress: 0.94, velocity: 1 }, 0.24), false)
  assert.equal(shouldRevealLiquidMorph({ progress: 0.94, velocity: 1 }, 0.5), true)
})

test('top and bottom chrome reveal late enough to read as a continuous liquid expansion', () => {
  let spring = { progress: 0, velocity: 0 }
  let revealAt = null

  for (let elapsed = 0; elapsed < 1.2; elapsed += 1 / 60) {
    spring = stepLiquidMorph(spring, 1 / 60)
    if (shouldRevealLiquidMorph(spring, elapsed + 1 / 60)) {
      revealAt = elapsed + 1 / 60
      break
    }
  }

  assert.ok(revealAt >= 0.45, `content revealed too early at ${revealAt}s`)
  assert.ok(revealAt <= 0.8, `content revealed too late at ${revealAt}s`)
})

test('visible morph animation cannot catch up half a second in one frame', () => {
  assert.equal(resolveLiquidMorphDelta(0.5, 'visible'), 1 / 30)
  assert.equal(resolveLiquidMorphDelta(0.5, 'hidden'), 0.5)
})
