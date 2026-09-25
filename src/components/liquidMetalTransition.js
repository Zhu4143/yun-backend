export const LIQUID_METAL_PALETTE_SIZE = 12
export const liquidMetalPaletteState = {
  visible: new Float32Array(LIQUID_METAL_PALETTE_SIZE),
  initialized: false,
}

export function writeLiquidMetalPalette(target, colors) {
  // The existing cover analysis already gives us these semantic levels.
  // Liquid Ore's ramp expects darkest -> brightest.
  const sources = [colors.base, colors.secondary, colors.primary, colors.accent]
  for (let colorIndex = 0; colorIndex < sources.length; colorIndex += 1) {
    const source = sources[colorIndex]
    const offset = colorIndex * 3
    target[offset] = source[0]
    target[offset + 1] = source[1]
    target[offset + 2] = source[2]
  }
  return target
}

export function copyLiquidMetalPalette(target, source) {
  for (let index = 0; index < LIQUID_METAL_PALETTE_SIZE; index += 1) {
    target[index] = source[index]
  }
  return target
}

export function publishLiquidMetalPalette(source) {
  copyLiquidMetalPalette(liquidMetalPaletteState.visible, source)
  liquidMetalPaletteState.initialized = true
  return liquidMetalPaletteState.visible
}

export function mixLiquidMetalPalette(target, from, to, progress) {
  const amount = Math.max(0, Math.min(1, Number(progress) || 0))
  for (let index = 0; index < LIQUID_METAL_PALETTE_SIZE; index += 1) {
    target[index] = from[index] + (to[index] - from[index]) * amount
  }
  return target
}

export function easeLiquidMetalPalette(progress) {
  const value = Math.max(0, Math.min(1, Number(progress) || 0))
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) * 0.5
}
