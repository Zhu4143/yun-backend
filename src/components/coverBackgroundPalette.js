export const DEFAULT_BACKGROUND_COLORS = {
  base: [8, 3, 2],
  primary: [118, 73, 42],
  secondary: [74, 90, 126],
  accent: [232, 181, 96],
  portrait: [128, 128, 128],
}
const BACKGROUND_PALETTE_CACHE = new Map()

function scaleColor(color, amount) {
  return color.map(value => Math.max(0, Math.min(255, value * amount)))
}

// Read an already decoded cover once; CD artwork needs no extra network request.
export function readCoverBackgroundColors(image) {
  try {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    const buckets = [
      { total: [0, 0, 0], count: 0 },
      { total: [0, 0, 0], count: 0 },
      { total: [0, 0, 0], count: 0 },
    ]
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255
      if (alpha < 0.2) continue
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255
      const bucket = luminance > 0.62 ? buckets[2] : luminance > 0.32 ? buckets[1] : buckets[0]
      bucket.total[0] += red
      bucket.total[1] += green
      bucket.total[2] += blue
      bucket.count += 1
    }
    const readBucket = (bucket, fallback) => bucket.count
      ? bucket.total.map((value) => value / bucket.count)
      : fallback
    const portraitSamples = buckets.reduce((total, bucket) => total + bucket.count, 0)
    const portraitTone = [0, 1, 2].map((channel) => portraitSamples
      ? buckets.reduce((total, bucket) => total + bucket.total[channel], 0) / portraitSamples
      : DEFAULT_BACKGROUND_COLORS.portrait[channel])
    return {
      base: scaleColor(readBucket(buckets[0], DEFAULT_BACKGROUND_COLORS.base), 0.42),
      primary: readBucket(buckets[1], DEFAULT_BACKGROUND_COLORS.primary),
      secondary: readBucket(buckets[0], DEFAULT_BACKGROUND_COLORS.secondary),
      accent: readBucket(buckets[2], DEFAULT_BACKGROUND_COLORS.accent),
      portrait: portraitTone,
    }
  } catch { return DEFAULT_BACKGROUND_COLORS }
}

export function loadCoverBackgroundPalette(source) {
  if (BACKGROUND_PALETTE_CACHE.has(source)) return BACKGROUND_PALETTE_CACHE.get(source)
  const palettePromise = new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve({ colors: readCoverBackgroundColors(image), source })
    image.onerror = () => resolve({ colors: DEFAULT_BACKGROUND_COLORS, source })
    image.src = source
  })
  BACKGROUND_PALETTE_CACHE.set(source, palettePromise)
  return palettePromise
}

