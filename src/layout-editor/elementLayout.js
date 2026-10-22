// Only host-scoped structural selectors and a small style vocabulary are stored.
const segment = /^(?:[a-z][a-z0-9-]*|\.[a-zA-Z_][\w-]*)(?::nth-of-type\([1-9]\d*\))?$/
const ranges = { x: [-2000, 2000], y: [-2000, 2000], width: [8, 3000], height: [8, 2000], fontSize: [8, 120], lineHeight: [0.8, 3], letterSpacing: [-4, 20], gap: [0, 120], padding: [0, 120], order: [-100, 100], fontWeight: [100, 900] }
const enums = { textAlign: ['left', 'center', 'right'], display: ['flex', 'grid'], flexDirection: ['row', 'column'], flexWrap: ['nowrap', 'wrap'], alignItems: ['flex-start', 'center', 'flex-end', 'stretch'], justifyContent: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'] }

export function validNodeKey(key, items) {
  const [root, path, extra] = key.split('::')
  return !extra && items.some(item => item.id === root) && path?.length < 1500 && path.split(' > ').every(part => segment.test(part))
}

export function cleanElementStyles(styles) {
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) throw new Error('元素属性格式不正确')
  const result = {}
  for (const [key, value] of Object.entries(styles)) {
    if (Object.hasOwn(ranges, key)) {
      if (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]) throw new Error('元素属性超出范围')
      result[key] = value
    } else if (Object.hasOwn(enums, key)) {
      if (!enums[key].includes(value)) throw new Error('元素排版属性无效')
      result[key] = value
    }
  }
  return result
}

export function elementCSS(styles, items) {
  return Object.entries(styles).filter(([key]) => validNodeKey(key, items)).map(([key, props]) => {
    const [root, path] = key.split('::')
    const safe = cleanElementStyles(props)
    const declarations = Object.entries(safe).filter(([name]) => !['x', 'y'].includes(name)).map(([name, value]) => {
      const cssName = name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
      const unit = ['width', 'height', 'fontSize', 'letterSpacing', 'gap', 'padding'].includes(name) ? 'px' : ''
      return `${cssName}:${value}${unit}!important`
    })
    if ('x' in safe || 'y' in safe) declarations.push(`translate:${safe.x || 0}px ${safe.y || 0}px!important`)
    if ('width' in safe) declarations.push('flex-shrink:0!important', 'flex-basis:auto!important', 'min-width:0!important', 'max-width:none!important')
    if ('height' in safe) declarations.push('min-height:0!important', 'max-height:none!important')
    return `[data-ui-layout-host="${root}"] > ${path}{${declarations.join(';')}}`
  }).join('\n')
}

function partFor(el) {
  const classes = [...el.classList].filter(name => /^[a-zA-Z_][\w-]*$/.test(name) && !/^(is-|active|selected|cover-)/.test(name))
  const name = classes[0] ? `.${classes[0]}` : el.localName
  const peers = [...el.parentElement.children].filter(peer => peer.matches(name))
  if (peers.length === 1) return name
  const index = [...el.parentElement.children].filter(peer => peer.localName === el.localName).indexOf(el) + 1
  return `${name}:nth-of-type(${index})`
}

export function collectElementNodes(items) {
  const nodes = [], seen = new Set()
  for (const item of items) {
    const root = window.document.querySelector(item.selector)
    if (!root) continue
    for (const el of root.querySelectorAll('*')) {
      const registeredLabel = Object.entries(item.elementLabels || {}).find(([selector]) => el.matches(selector))?.[1]
      if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || (el.closest('[aria-hidden="true"]') && !registeredLabel) || el.matches('style, script')) continue
      if (!el.getClientRects().length) continue
      const template = item.repeatSelectors?.map(selector => el.closest(selector)).find(Boolean)
      if (template && root.querySelector(`.${template.classList[0]}`) !== template) continue
      const text = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())
      const computed = getComputedStyle(el)
      const container = el.children.length > 0 && (['flex', 'grid', 'inline-flex'].includes(computed.display) || el.matches('div,section,nav,header,footer,article,form'))
      if (!text && !container && !registeredLabel && !el.matches('button,input,textarea,img,[role="button"]')) continue
      if (el.matches('.library-virtual-list,.library-scroll-list') || template === el) continue // Virtual row geometry belongs to the host.
      const parts = []
      for (let current = el; current && current !== root; current = current.parentElement) parts.unshift(current === template ? `.${template.classList[0]}` : partFor(current))
      const key = `${item.id}::${parts.join(' > ')}`
      if (seen.has(key) || !validNodeKey(key, items)) continue
      seen.add(key)
      const kind = container && !el.matches('button') ? 'container' : el.matches('button,input,textarea,[role="button"]') ? 'button' : el.matches('img') || computed.backgroundImage !== 'none' ? 'image' : 'text'
      const fallback = container ? (computed.display === 'grid' ? '网格分组' : computed.display.includes('flex') ? computed.flexDirection === 'column' ? '纵向分组' : '横向分组' : '内容分组') : el.matches('img') ? '图片' : el.matches('input,textarea') ? '输入框' : '按钮'
      const label = registeredLabel || (template ? `歌曲行 · ${el.matches('h3,strong') ? '歌名' : el.matches('p,small') ? '歌手 / 说明' : el.getAttribute('title') || fallback}` : el.getAttribute('aria-label') || el.getAttribute('title') || (text ? el.textContent.trim().slice(0, 24) : fallback))
      nodes.push({ key, rootId: item.id, path: parts.join(' > '), label, kind, depth: parts.length })
    }
  }
  return nodes
}

export function nodeElements(node, items) {
  const root = window.document.querySelector(items.find(item => item.id === node?.rootId)?.selector || ':not(*)')
  return node && root ? [...root.querySelectorAll(`:scope > ${node.path}`)] : []
}

export function nodeElement(node, items) {
  const elements = nodeElements(node, items)
  return elements.find(el => { const r = el.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < window.innerHeight }) || elements[0]
}

export function readNode(node, items, instance) {
  if (!node) return null
  const el = instance?.isConnected ? instance : nodeElement(node, items)
  if (!el) return null
  const r = el.getBoundingClientRect(), css = getComputedStyle(el)
  return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, width: r.width, height: r.height, fontSize: parseFloat(css.fontSize), fontWeight: Number(css.fontWeight) || 400, lineHeight: parseFloat(css.lineHeight) / parseFloat(css.fontSize) || 1.2, letterSpacing: parseFloat(css.letterSpacing) || 0, textAlign: css.textAlign, gap: parseFloat(css.gap) || 0, padding: parseFloat(css.paddingTop) || 0, flexDirection: css.flexDirection, flexWrap: css.flexWrap, alignItems: css.alignItems, justifyContent: css.justifyContent, order: Number(css.order) || 0 }
}
