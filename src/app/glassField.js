// The same rounded-box distance and sqrt edge profile used by liquidOreSource.
// Bake it only when a surface changes size; the compositor refracts the actual
// backdrop, including artwork and scrolling content, without a WebGL scene.
const cache = new Map()
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const opticalField = Object.freeze({ intensity: .55, distortion: 1, flow: 0, blur: 0, chromatic: .025 })

export function createGlassField(width, height, radius) {
  const key = `${width}:${height}:${radius}`
  if (cache.has(key)) return cache.get(key)
  const scale = Math.min(1, 360 / Math.max(width, height), Math.sqrt(80000 / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width * scale))
  canvas.height = Math.max(2, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return ''
  const pixels = context.createImageData(canvas.width, canvas.height)
  const depth = Math.min(32, Math.min(width, height) * .36)
  const sdf = (x, y) => {
    const qx = Math.abs(x - width / 2) - width / 2 + radius
    const qy = Math.abs(y - height / 2) - height / 2 + radius
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
  }
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + .5) * width / canvas.width, py = (y + .5) * height / canvas.height
      const distance = sdf(px, py)
      const dx = sdf(px + .5, py) - sdf(px - .5, py)
      const dy = sdf(px, py + .5) - sdf(px, py - .5)
      const length = Math.hypot(dx, dy) || 1
      const heightProfile = Math.sqrt(clamp(-distance / depth, 0, 1))
      const rim = 1 - heightProfile
      const index = (y * canvas.width + x) * 4
      pixels.data[index] = Math.round(128 + dx / length * rim * 127)
      pixels.data[index + 1] = Math.round(128 + dy / length * rim * 127)
      pixels.data[index + 2] = Math.round(Math.sqrt(clamp(-distance / Math.min(8, depth), 0, 1)) * 255)
      // Displacement channels must remain opaque; putting height in alpha
      // premultiplies their normals and incorrectly bends the entire rim.
      pixels.data[index + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  const url = canvas.toDataURL()
  cache.set(key, url)
  if (cache.size > 20) cache.delete(cache.keys().next().value)
  return url
}
