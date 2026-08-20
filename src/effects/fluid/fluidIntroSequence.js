const wait = (milliseconds, signal) => new Promise((resolve) => {
  const timer = window.setTimeout(resolve, milliseconds)
  signal?.addEventListener('abort', () => {
    window.clearTimeout(timer)
    resolve()
  }, { once: true })
})

const easeInOutCubic = (value) => (
  value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2
)

const lerp = (from, to, amount) => from + (to - from) * amount

function getYunInkColor(progress) {
  const red = [0.34, 0.035, 0.045]
  const violet = [0.19, 0.045, 0.24]
  const blue = [0.035, 0.12, 0.34]
  const from = progress < 0.5 ? red : violet
  const to = progress < 0.5 ? violet : blue
  const amount = progress < 0.5 ? progress * 2 : (progress - 0.5) * 2
  return from.map((value, index) => lerp(value, to[index], amount))
}

export async function runYunIntroInkSequence(engine, signal) {
  const duration = 1900
  const count = 22
  for (let index = 0; index < count && !signal?.aborted; index += 1) {
    const progress = index / (count - 1)
    const eased = easeInOutCubic(progress)
    const x = lerp(-0.04, 1.04, eased)
    const y = lerp(0.59, 0.46, eased) + Math.sin(progress * Math.PI * 1.65) * 0.045
    const nextProgress = Math.min(1, progress + 0.035)
    const nextEased = easeInOutCubic(nextProgress)
    const nextX = lerp(-0.04, 1.04, nextEased)
    const nextY = lerp(0.59, 0.46, nextEased) + Math.sin(nextProgress * Math.PI * 1.65) * 0.045
    const force = lerp(1760, 720, progress)
    const radius = 0.15 + ((index * 7) % 6) * 0.014
    const color = getYunInkColor(progress)
    const intensity = lerp(1.12, 0.50, progress)

    engine.splat({
      x,
      y,
      dx: (nextX - x) * force,
      dy: (nextY - y) * force,
      radius,
      color,
      intensity,
    })
    engine.splat({
      x: x - 0.014,
      y: y + 0.12,
      dx: (nextX - x) * force * 0.82,
      dy: (nextY - y) * force * 0.56,
      radius: radius * 0.82,
      color: [color[0] * 0.82, color[1] * 0.9, color[2]],
      intensity: intensity * 0.72,
    })
    engine.splat({
      x: x + 0.012,
      y: y - 0.12,
      dx: (nextX - x) * force * 0.74,
      dy: (nextY - y) * force * 0.46,
      radius: radius * 0.78,
      color: [color[0] * 0.7, color[1] * 0.82, color[2] * 0.9],
      intensity: intensity * 0.65,
    })
    if (index % 3 === 1) {
      engine.splat({
        x: x - 0.008,
        y: y + 0.012,
        dx: (nextX - x) * force * 0.42,
        dy: (nextY - y) * force * 0.36,
        radius: radius * 0.68,
        color: [0.11, 0.18, 0.20],
        intensity: intensity * 0.34,
      })
    }
    await wait(duration / count, signal)
  }
}

export function createIdleFlow(engine) {
  let timer = 0
  let stopped = false
  const schedule = () => {
    if (stopped) return
    timer = window.setTimeout(() => {
      const side = Math.random()
      const x = side < 0.5 ? 0.03 + Math.random() * 0.14 : 0.83 + Math.random() * 0.14
      const y = 0.05 + Math.random() * 0.32
      engine.splatVelocityOnly(x, y, side < 0.5 ? 7 : -7, 3 + Math.random() * 5, 0.18 + Math.random() * 0.07)
      schedule()
    }, 1800 + Math.random() * 1400)
  }
  schedule()
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}

export function runExitFlow(engine) {
  engine.splatVelocityOnly(0.48, 0.5, 48, 1.2, 0.24)
  engine.splatVelocityOnly(0.64, 0.48, 62, -0.8, 0.2)
}

export async function runVinylTransition(engine, signal) {
  const colors = {
    copper: [0.30, 0.12, 0.045],
    blue: [0.075, 0.12, 0.28],
    gold: [0.34, 0.22, 0.07],
    violet: [0.16, 0.08, 0.28],
  }
  for (let index = 0; index < 13 && !signal?.aborted; index += 1) {
    const p = index / 12
    const radius = 0.105 + p * 0.045
    const spin = 34 + p * 42
    const points = [
      { x: p * 0.48, y: 0.5 + Math.sin(p * Math.PI) * 0.12, dx: spin, dy: spin * 0.72, color: colors.copper },
      { x: 1 - p * 0.48, y: 0.5 - Math.sin(p * Math.PI) * 0.12, dx: -spin, dy: -spin * 0.72, color: colors.blue },
      { x: 0.5 - Math.sin(p * Math.PI) * 0.12, y: 1 - p * 0.48, dx: -spin * 0.72, dy: -spin, color: colors.gold },
      { x: 0.5 + Math.sin(p * Math.PI) * 0.12, y: p * 0.48, dx: spin * 0.72, dy: spin, color: colors.violet },
    ]
    points.forEach((point) => engine.splat({ ...point, radius, intensity: 0.72 - p * 0.18 }))
    await wait(58, signal)
  }
  engine.splatVelocityOnly(0.5, 0.5, 86, -72, 0.34)
  engine.splatVelocityOnly(0.5, 0.5, -64, 82, 0.24)
}
