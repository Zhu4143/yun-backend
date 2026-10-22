import { cleanElementStyles, validNodeKey } from './elementLayout.js'
const clamp = (n, low, high) => Math.min(high, Math.max(low, n))
export const profileFor = ({ width }) => width < 900 ? 'compact' : 'desktop'
export const emptyDocument = () => ({ version: 2, profiles: { desktop: {}, compact: {} }, elements: { desktop: {}, compact: {} } })

export function fitRect(rect, item, view) {
  const width = clamp(rect.width, Math.min(item.minWidth || 180, view.width), view.width)
  const height = clamp(rect.height, Math.min(item.minHeight || 100, view.height), view.height)
  return { x: clamp(rect.x, 0, view.width - width), y: clamp(rect.y, 0, view.height - height), width, height }
}

export function encodeRect(rect, item, view) {
  const anchorX = item.anchorX || 'left'
  const anchorY = item.anchorY || 'top'
  const origin = (anchor, total, extent) => anchor === 'center' ? (total - extent) / 2 : anchor === 'right' || anchor === 'bottom' ? total - extent : 0
  return { ...rect, x: rect.x - origin(anchorX, view.width, rect.width), y: rect.y - origin(anchorY, view.height, rect.height), anchorX, anchorY }
}

export function decodeRect(rect, item, view) {
  const origin = (anchor, total, extent) => anchor === 'center' ? (total - extent) / 2 : anchor === 'right' || anchor === 'bottom' ? total - extent : 0
  return fitRect({ ...rect, x: rect.x + origin(rect.anchorX, view.width, rect.width), y: rect.y + origin(rect.anchorY, view.height, rect.height) }, item, view)
}

export function parseDocument(text, items) {
  const doc = JSON.parse(text)
  if (![1, 2].includes(doc?.version) || !doc.profiles) throw new Error('布局文件版本不支持')
  const result = emptyDocument()
  for (const profile of ['desktop', 'compact']) {
    const entries = doc.profiles[profile]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('布局文件格式不正确')
    for (const item of items) {
      const r = entries[item.id]
      if (!r) continue
      if (!['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && Math.abs(r[k]) < 100000) || r.width <= 0 || r.height <= 0 || !['left', 'center', 'right'].includes(r.anchorX) || !['top', 'center', 'bottom'].includes(r.anchorY)) throw new Error('布局包含无效的尺寸或位置')
      result.profiles[profile][item.id] = { x: r.x, y: r.y, width: r.width, height: r.height, anchorX: r.anchorX, anchorY: r.anchorY }
    }
    const elements = doc.elements?.[profile] || {}
    if (typeof elements !== 'object' || Array.isArray(elements)) throw new Error('元素布局格式不正确')
    for (const [key, styles] of Object.entries(elements)) {
      if (validNodeKey(key, items)) result.elements[profile][key] = cleanElementStyles(styles)
    }
  }
  return result
}

export function moveRect(start, dx, dy, item, view, others = [], snap = true) {
  let rect = fitRect({ ...start, x: start.x + dx, y: start.y + dy }, item, view)
  const guides = []
  if (snap) {
    for (const [axis, extent, total] of [['x', 'width', view.width], ['y', 'height', view.height]]) {
      const targets = [0, total / 2, total, ...others.flatMap(r => [r[axis], r[axis] + r[extent] / 2, r[axis] + r[extent]])]
      let best = null
      for (const offset of [0, rect[extent] / 2, rect[extent]]) {
        for (const target of targets) {
          const delta = target - rect[axis] - offset
          if (Math.abs(delta) <= 6 && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target }
        }
      }
      if (best) { rect = { ...rect, [axis]: rect[axis] + best.delta }; guides.push({ axis, value: best.target }) }
    }
  }
  return { rect: fitRect(rect, item, view), guides }
}

export function resizeRect(start, edge, dx, dy, item, view) {
  const minW = Math.min(item.minWidth || 180, view.width)
  const minH = Math.min(item.minHeight || 100, view.height)
  let { x, y, width, height } = start
  if (edge.includes('e')) width = clamp(width + dx, minW, view.width - x)
  if (edge.includes('s')) height = clamp(height + dy, minH, view.height - y)
  if (edge.includes('w')) { x = clamp(x + dx, 0, start.x + start.width - minW); width = start.x + start.width - x }
  if (edge.includes('n')) { y = clamp(y + dy, 0, start.y + start.height - minH); height = start.y + start.height - y }
  return { x, y, width, height }
}

export function arrangeRects(rects, ids, direction, gap, view) {
  const axis = direction === 'horizontal' ? 'x' : 'y'
  const size = axis === 'x' ? 'width' : 'height'
  const cross = axis === 'x' ? 'y' : 'x'
  const total = ids.reduce((sum, id) => sum + rects[id][size], 0) + gap * (ids.length - 1)
  if (total > (axis === 'x' ? view.width : view.height)) throw new Error('空间不足，请先缩小卡片或减少选中项')
  let pos = Math.min(Math.min(...ids.map(id => rects[id][axis])), (axis === 'x' ? view.width : view.height) - total)
  const alignment = Math.min(...ids.map(id => rects[id][cross]))
  const result = { ...rects }
  for (const id of ids) { result[id] = { ...rects[id], [axis]: pos, [cross]: alignment }; pos += rects[id][size] + gap }
  return result
}

export function pushHistory(history, next) {
  if (JSON.stringify(history.entries[history.index]) === JSON.stringify(next)) return history
  const entries = [...history.entries.slice(0, history.index + 1), structuredClone(next)].slice(-60)
  return { entries, index: entries.length - 1 }
}
