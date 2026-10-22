import { useEffect, useRef, useState } from 'react'
import { nodeElement, nodeElements, readNode } from './elementLayout'
import { resizeRect } from './layoutEngine'

const edges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const numeric = { x: [-2000, 2000], y: [-2000, 2000], width: [8, 3000], height: [8, 2000], fontSize: [8, 120], fontWeight: [100, 900], lineHeight: [0.8, 3], letterSpacing: [-4, 20], gap: [0, 120], padding: [0, 120], order: [-100, 100] }

export default function ElementEditor({ items, nodes, rootId, styles, onRootPick, onPreview, onCommit }) {
  const [selectedKey, setSelectedKey] = useState(null)
  const [measurement, setMeasurement] = useState(null)
  const [search, setSearch] = useState('')
  const [instance, setInstance] = useState(null)
  const selected = nodes.find(node => node.key === selectedKey && node.rootId === rootId)
  const gesture = useRef(null), animation = useRef(null), pending = useRef(null)
  const props = styles[selected?.key] || {}

  useEffect(() => {
    const measure = () => setMeasurement(readNode(selected, items, instance))
    const frame = requestAnimationFrame(measure)
    const el = instance?.isConnected ? instance : nodeElement(selected, items)
    const observer = new ResizeObserver(measure)
    if (el) observer.observe(el)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure) }
  }, [selected, styles, items, instance])

  useEffect(() => {
    function pick(event) {
      if (event.target.closest('[data-layout-editor-ui]')) return
      const root = items.find(item => event.target.closest(item.selector))
      if (!root) return
      event.preventDefault(); event.stopPropagation()
      if (event.type === 'click') return
      // The innermost registered node wins, without changing the host's DOM.
      const match = nodes.filter(node => node.rootId === root.id).sort((a, b) => b.depth - a.depth).map(node => ({ node, el: nodeElements(node, items).find(el => el.contains(event.target)) })).find(match => match.el)
      if (match) { setSelectedKey(match.node.key); setInstance(match.el); onRootPick(root.id) }
    }
    window.document.addEventListener('pointerdown', pick, true)
    window.document.addEventListener('click', pick, true)
    return () => { window.document.removeEventListener('pointerdown', pick, true); window.document.removeEventListener('click', pick, true); cancelAnimationFrame(animation.current) }
  }, [items, nodes, onRootPick])

  function update(key, value) {
    if (value === '') return
    const nextValue = numeric[key] ? Math.max(numeric[key][0], Math.min(numeric[key][1], Number(value))) : value
    if (typeof nextValue === 'number' && !Number.isFinite(nextValue)) return
    onCommit({ ...styles, [selected.key]: { ...props, [key]: nextValue } })
  }

  function begin(event, edge) {
    if (event.button !== 0 || !measurement) return
    event.preventDefault(); event.stopPropagation()
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, before: structuredClone(styles), rect: measurement.rect, edge }
    pending.current = styles
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event) {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const el = instance?.isConnected ? instance : nodeElement(selected, items), root = window.document.querySelector(items.find(item => item.id === rootId).selector)
    const parent = el?.parentElement.getBoundingClientRect(), bounds = root.getBoundingClientRect()
    if (!parent) return
    const dx = event.clientX - g.x, dy = event.clientY - g.y
    const before = g.before[selected.key] || {}
    const next = { ...before }
    if (g.edge) {
      const local = { ...g.rect, x: g.rect.x - bounds.x, y: g.rect.y - bounds.y }
      const resized = resizeRect(local, g.edge, dx, dy, { minWidth: 8, minHeight: 8 }, { width: bounds.width, height: bounds.height })
      Object.assign(next, { width: resized.width, height: resized.height, x: (before.x || 0) + resized.x - local.x, y: (before.y || 0) + resized.y - local.y })
    } else {
      // Keep offsets inside the card; flow position still adapts with its parent.
      next.x = Math.max(bounds.x - g.rect.x, Math.min(dx, bounds.right - g.rect.x - g.rect.width)) + (before.x || 0)
      next.y = Math.max(bounds.y - g.rect.y, Math.min(dy, bounds.bottom - g.rect.y - g.rect.height)) + (before.y || 0)
    }
    pending.current = { ...g.before, [selected.key]: next }
    cancelAnimationFrame(animation.current)
    animation.current = requestAnimationFrame(() => onPreview(pending.current))
  }

  function finish(event, cancelled = false) {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    gesture.current = null
    cancelAnimationFrame(animation.current)
    if (cancelled) onPreview(g.before)
    else onCommit(pending.current)
  }

  const numberField = (key, label, step = 1) => <label key={key}>{label}<input type="number" aria-label={`元素${label}`} min={numeric[key][0]} max={numeric[key][1]} step={step} value={props[key] ?? (['x', 'y'].includes(key) ? 0 : Math.round((measurement?.[key] || 0) * 100) / 100)} onChange={event => update(key, event.target.value)}/></label>
  const selectField = (key, label, options) => <label key={key}>{label}<select aria-label={`元素${label}`} value={props[key] || measurement?.[key] || options[0][0]} onChange={event => update(key, event.target.value)}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
  return <>
    <div className="layout-editor-element-fields">
      <strong>内部图层 · 点击画面也可选中</strong>
      <input aria-label="筛选内部图层" placeholder="搜索按钮、文字、容器" value={search} onChange={event => setSearch(event.target.value)}/>
      <div className="layout-editor-layers" role="group" aria-label="内部图层">
        {nodes.filter(node => node.rootId === rootId && node.label.toLowerCase().includes(search.toLowerCase())).map(node => <button key={node.key} className={selected?.key === node.key ? 'is-active' : ''} onClick={() => { setSelectedKey(node.key); setInstance(null) }}>{node.kind === 'container' ? '▦' : node.kind === 'text' ? 'T' : '◉'} {node.label}</button>)}
      </div>
      {selected && measurement && <>
        <strong>{selected.label}</strong>
        <div className="layout-editor-fields">{numberField('x', '偏移X')}{numberField('y', '偏移Y')}{numberField('width', '宽')}{numberField('height', '高')}</div>
        <small>偏移相对于自动排版位置；鼠标拖动或控制点缩放。</small>
        {selected.kind !== 'image' && <>{numberField('fontSize', '字号')}{numberField('fontWeight', '字重', 100)}{numberField('lineHeight', '行高', 0.05)}{numberField('letterSpacing', '字距', 0.1)}{selectField('textAlign', '文字对齐', [['left', '左'], ['center', '居中'], ['right', '右']])}</>}
        {selected.kind === 'container' && <>
          <button onClick={() => onCommit({ ...styles, [selected.key]: { ...props, display: 'flex', flexDirection: props.flexDirection || 'row' } })}>启用自动排版</button>
          {selectField('flexDirection', '排版方向', [['row', '横向'], ['column', '纵向']])}
          {numberField('gap', '间距')}{numberField('padding', '内边距')}
          {selectField('alignItems', '交叉对齐', [['flex-start', '起始'], ['center', '居中'], ['flex-end', '末尾'], ['stretch', '拉伸']])}
          {selectField('justifyContent', '主轴对齐', [['flex-start', '起始'], ['center', '居中'], ['flex-end', '末尾'], ['space-between', '两端'], ['space-around', '均分']])}
          {selectField('flexWrap', '换行', [['nowrap', '不换行'], ['wrap', '自动换行']])}
        </>}
        {numberField('order', '排列顺序')}
        <button onClick={() => { const next = { ...styles }; delete next[selected.key]; onCommit(next) }}>重置此元素</button>
      </>}
      <small>歌曲行的文字 / 按钮样式统一应用到同类行。歌曲内容仍随播放更新。</small>
    </div>
    {selected && measurement && <div className="layout-editor-outline is-selected layout-editor-element-outline" style={{ left: measurement.rect.x, top: measurement.rect.y, width: measurement.rect.width, height: measurement.rect.height }} tabIndex={0} role="group" aria-label={`调整元素${selected.label}`} onPointerDown={event => begin(event)} onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
      <span className="layout-editor-label">{selected.label}</span>
      {edges.map(edge => <button key={edge} className={`layout-editor-handle handle-${edge}`} aria-label={`元素缩放${edge}`} onPointerDown={event => begin(event, edge)}/>)}
    </div>}
  </>
}
