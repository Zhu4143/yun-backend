// The immersive mineral field needs chromatic stops, rather than averages of
// white paper, black lettering and small coloured areas on an album cover.
const NEUTRAL_PALETTE = Object.freeze({
  base: [5, 14, 23], secondary: [17, 47, 65],
  primary: [45, 106, 139], accent: [124, 183, 201],
})
const FLOW_PALETTE = Object.freeze({
  base: [7, 12, 28], secondary: [57, 37, 83],
  primary: [45, 106, 151], accent: [82, 182, 162],
})

function shiftedHue(rgb, shift) {
  const high = Math.max(...rgb), low = Math.min(...rgb), chroma = high - low
  let hue = high === rgb[0] ? (rgb[1] - rgb[2]) / chroma
    : high === rgb[1] ? (rgb[2] - rgb[0]) / chroma + 2 : (rgb[0] - rgb[1]) / chroma + 4
  hue = (((hue / 6 + shift) % 1 + 1) % 1) * 6
  const x = .68 * (1 - Math.abs(hue % 2 - 1))
  const sector = Math.floor(hue)
  return [[.68, x, 0], [x, .68, 0], [0, .68, x], [0, x, .68], [x, 0, .68], [.68, 0, x]][sector].map(value => (value + .32) * 255)
}

function tone(color, peak, soften = 0) {
  const floor = Math.min(...color) * .55
  const chromatic = color.map(channel => (channel - floor) * (1 - soften) + 255 * soften)
  const scale = peak / Math.max(1, ...chromatic)
  return chromatic.map(channel => Math.round(channel * scale))
}

export function extractImmersivePalette(pixels, { multicolor = false } = {}) {
  const buckets = Array.from({ length: 24 }, (_, index) => ({ index, sum: [0, 0, 0], weight: 0, count: 0 }))
  let visible = 0, coloured = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    if (alpha < .2) continue
    visible++
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]]
    const maximum = Math.max(...rgb), minimum = Math.min(...rgb), chroma = maximum - minimum
    if (maximum < 28 || chroma < 24 || chroma / maximum < .18) continue
    coloured++
    let hue = maximum === rgb[0] ? (rgb[1] - rgb[2]) / chroma
      : maximum === rgb[1] ? (rgb[2] - rgb[0]) / chroma + 2 : (rgb[0] - rgb[1]) / chroma + 4
    hue = ((hue / 6) % 1 + 1) % 1
    const bucket = buckets[Math.min(23, Math.floor(hue * 24))]
    const weight = alpha * (chroma / 255) * (.5 + chroma / maximum)
    bucket.weight += weight; bucket.count++
    for (let channel = 0; channel < 3; channel++) bucket.sum[channel] += rgb[channel] * weight
  }
  // A stray coloured pixel or compression fringe must not recolour a B&W cover.
  if (coloured < Math.max(3, visible * .015)) return multicolor ? FLOW_PALETTE : NEUTRAL_PALETTE
  const ranked = buckets.filter(bucket => bucket.count).sort((a, b) => b.weight - a.weight)
  const dominant = ranked[0]
  const companion = ranked.find(bucket => {
    const distance = Math.abs(bucket.index - dominant.index)
    return Math.min(distance, 24 - distance) >= 3 && bucket.weight >= dominant.weight * .18
  })
  const mean = bucket => bucket.sum.map(channel => channel / bucket.weight)
  const primary = mean(dominant)
  // Keep immersive ore faithful to the artwork. Only the main workspace opts
  // into extra hues for its broad colour currents.
  const middle = tone(primary, 154)
  const secondary = tone(multicolor ? shiftedHue(primary, .38) : primary, 77)
  const accent = tone(companion ? mean(companion) : multicolor ? shiftedHue(primary, .61) : primary, 210, .18)
  const luma = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  const secondaryScale = Math.min(1, luma(middle) * .68 / Math.max(1, luma(secondary)))
  const accentLuma = luma(accent)
  const lift = Math.max(0, (luma(middle) + 18 - accentLuma) / (255 - accentLuma))
  return {
    base: tone(primary, 23), secondary: secondary.map(channel => Math.round(channel * secondaryScale)),
    primary: middle, accent: accent.map(channel => Math.round(channel + (255 - channel) * lift)),
  }
}

export function readImmersivePalette(image, options) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, 32, 32)
    return extractImmersivePalette(context.getImageData(0, 0, 32, 32).data, options)
  } catch { return extractImmersivePalette([], options) }
}
