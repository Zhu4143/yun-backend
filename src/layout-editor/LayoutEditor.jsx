import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arrangeRects, decodeRect, emptyDocument, encodeRect, fitRect, moveRect, parseDocument, profileFor, pushHistory, resizeRect } from './layoutEngine'
import './LayoutEditor.css'
import ElementEditor from './ElementEditor'
import { collectElementNodes, elementCSS } from './elementLayout'

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
const edges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** Host adapter owns cards; versioned geometry and scoped element styles persist. */
export default function LayoutEditor({ items, storageKey, onEditingChange }) {
  const [editing, setEditing] = useState(false)
  const [ready, setReady] = useState(false)
  const [rects, setRects] = useState({})
  const [selection, setSelection] = useState([])
  const [guides, setGuides] = useState([])
  const [snap, setSnap] = useState(true)
  const [gap, setGap] = useState(16)
  const [status, setStatus] = useState('')
  const [transfer, setTransfer] = useState(null)
  const [mode, setMode] = useState('cards')
  const [nodes, setNodes] = useState([])
  const [elementStyles, setElementStyles] = useState({})
  const [history, setHistory] = useState({ entries: [{ rects: {}, imported: null }], index: 0 })
  const [document, setDocument] = useState(() => {
    try { const raw = localStorage.getItem(storageKey); return raw ? parseDocument(raw, items) : emptyDocument() } catch { return emptyDocument() }
  })
  const [view, setView] = useState(viewport)
  const gesture = useRef(null)
  const frame = useRef(null)
  const draft = useRef({})
  const defaults = useRef({})
  const fileInput = useRef(null)
  const importedDocument = useRef(null)
  const elementDraft = useRef({})
  const profile = profileFor(view)

  useEffect(() => {
    const resize = () => {
      const nextView = viewport()
      setView(nextView)
      if (!editing) return
      cancelAnimationFrame(frame.current)
      gesture.current = null
      if (profileFor(nextView) !== profile) {
        elementDraft.current = structuredClone((importedDocument.current || document).elements[profileFor(nextView)])
        setElementStyles(elementDraft.current)
      }
      const next = Object.fromEntries(items.filter(item => draft.current[item.id]).map(item => [item.id, fitRect(draft.current[item.id], item, nextView)]))
      draft.current = next
      setRects(next)
      setHistory({ entries: [{ rects: structuredClone(next), elements: structuredClone(elementDraft.current), imported: structuredClone(importedDocument.current) }], index: 0 })
      setGuides([])
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [items, editing, document, profile])

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    for (const item of items) {
      const element = window.document.querySelector(item.selector)
      if (!element) continue
      delete element.dataset.uiLayout
      delete element.dataset.uiLayoutSelected
      delete element.dataset.uiLayoutHost
      delete element.dataset.uiLayoutFocus
      for (const key of ['x', 'y', 'width', 'height']) element.style.removeProperty(`--ui-layout-${key}`)
    }
  }, [items])

  useLayoutEffect(() => {
    for (const item of items) {
      const element = window.document.querySelector(item.selector)
      if (!element) continue
      element.dataset.uiLayoutHost = item.id
      if (editing && mode === 'elements') element.dataset.uiLayoutFocus = selection[0] === item.id ? 'true' : 'false'
      else delete element.dataset.uiLayoutFocus
      const saved = document.profiles[profile][item.id]
      const rect = editing ? rects[item.id] : saved ? decodeRect(saved, item, view) : null
      if (editing && selection.includes(item.id)) element.dataset.uiLayoutSelected = 'true'
      else delete element.dataset.uiLayoutSelected
      if (rect) {
        element.dataset.uiLayout = item.id
        for (const [key, value] of Object.entries(rect)) if (['x', 'y', 'width', 'height'].includes(key)) element.style.setProperty(`--ui-layout-${key}`, `${value}px`)
      } else {
        delete element.dataset.uiLayout
        for (const key of ['x', 'y', 'width', 'height']) element.style.removeProperty(`--ui-layout-${key}`)
      }
    }
  }, [items, document, profile, editing, rects, view, selection, mode])

  function commit(next, elements = elementDraft.current) {
    draft.current = next
    elementDraft.current = elements
    setElementStyles(elements)
    setRects(next)
    setHistory(prev => pushHistory(prev, { rects: next, elements, imported: importedDocument.current }))
    setGuides([])
  }

  function enter() {
    importedDocument.current = null
    draft.current = {}
    setReady(false)
    setRects({})
    setSelection([])
    setMode('cards')
    elementDraft.current = structuredClone(document.elements[profile])
    setElementStyles(elementDraft.current)
    setTransfer(null)
    setHistory({ entries: [{ rects: {}, imported: null }], index: 0 })
    setEditing(true)
    onEditingChange?.(true)
    setStatus('拖动卡片；拖动八个控制点缩放。Shift 多选，Alt 暂停吸附。')
    // Wait for the host's preview class, then measure natural geometry.
    frame.current = requestAnimationFrame(() => {
      const natural = {}
      for (const item of items) {
        const el = window.document.querySelector(item.selector)
        if (!el) continue
        delete el.dataset.uiLayout
        const r = el.getBoundingClientRect()
        natural[item.id] = fitRect({ x: r.x, y: r.y, width: r.width, height: r.height }, item, viewport())
      }
      defaults.current = natural
      const next = { ...natural }
      for (const item of items) if (document.profiles[profile][item.id]) next[item.id] = decodeRect(document.profiles[profile][item.id], item, viewport())
      draft.current = next
      setRects(next)
      setHistory({ entries: [{ rects: structuredClone(next), elements: structuredClone(elementDraft.current), imported: null }], index: 0 })
      setSelection(Object.keys(next).slice(0, 1))
      setNodes(collectElementNodes(items))
      setReady(true)
    })
  }

  function exit(save) {
    if (save && !ready) return
    if (save) {
      const next = structuredClone(importedDocument.current || document)
      next.profiles[profile] = encodedProfile()
      next.elements[profile] = elementDraft.current
      try { localStorage.setItem(storageKey, JSON.stringify(next)); setDocument(next) } catch { setStatus('保存失败：浏览器存储不可用，可导出布局文件备份'); return }
    }
    cancelAnimationFrame(frame.current)
    gesture.current = null
    setEditing(false)
    onEditingChange?.(false)
    setGuides([])
  }

  function encodedProfile() {
    if (JSON.stringify(draft.current) === JSON.stringify(defaults.current)) return {}
    return Object.fromEntries(items.filter(item => draft.current[item.id]).map(item => [item.id, encodeRect(draft.current[item.id], item, view)]))
  }

  function travel(delta) {
    const index = Math.max(0, Math.min(history.entries.length - 1, history.index + delta))
    const snapshot = structuredClone(history.entries[index])
    draft.current = snapshot.rects
    importedDocument.current = snapshot.imported
    elementDraft.current = snapshot.elements || {}
    setElementStyles(elementDraft.current)
    setRects(draft.current)
    setHistory({ ...history, index })
    setGuides([])
  }

  function begin(event, id, edge) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    let ids = selection.includes(id) ? [id, ...selection.filter(key => key !== id)] : [id]
    if (event.shiftKey && !edge) { ids = selection.includes(id) ? selection.filter(key => key !== id) : [...selection, id]; setSelection(ids); return }
    if (edge) ids = [id]
    setSelection(ids)
    gesture.current = { id, ids, edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, before: structuredClone(draft.current) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event) {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return
    const dx = event.clientX - g.x, dy = event.clientY - g.y
    const item = items.find(item => item.id === g.id)
    let next = { ...g.before }, nextGuides = []
    if (g.edge) next[g.id] = resizeRect(g.before[g.id], g.edge, dx, dy, item, view)
    else {
      const others = Object.entries(g.before).filter(([id]) => !g.ids.includes(id)).map(([, r]) => r)
      const moved = moveRect(g.before[g.id], dx, dy, item, view, others, snap && !event.altKey)
      const actualX = moved.rect.x - g.before[g.id].x, actualY = moved.rect.y - g.before[g.id].y
      // Bound the whole selection so its spacing survives a group drag.
      const boundedX = Math.max(-Math.min(...g.ids.map(id => g.before[id].x)), Math.min(actualX, Math.min(...g.ids.map(id => view.width - g.before[id].x - g.before[id].width))))
      const boundedY = Math.max(-Math.min(...g.ids.map(id => g.before[id].y)), Math.min(actualY, Math.min(...g.ids.map(id => view.height - g.before[id].y - g.before[id].height))))
      for (const id of g.ids) next[id] = { ...g.before[id], x: g.before[id].x + boundedX, y: g.before[id].y + boundedY }
      nextGuides = moved.guides
    }
    draft.current = next
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { setRects(next); setGuides(nextGuides) })
  }

  function finish(event, cancelled = false) {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return
    gesture.current = null
    cancelAnimationFrame(frame.current)
    if (cancelled) { draft.current = g.before; setRects(g.before); setGuides([]) } else commit(draft.current)
  }

  function keyDown(event) {
    event.stopPropagation()
    const input = event.target.matches('input, textarea, select')
    if (event.key === 'Escape') { event.preventDefault(); if (transfer) setTransfer(null); else exit(false) }
    if (input) return
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation(); travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1)
    }
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!offset) return
    if (mode === 'elements') return
    event.preventDefault(); event.stopPropagation()
    const next = { ...draft.current }, scale = event.shiftKey ? 10 : 1
    for (const id of selection) next[id] = moveRect(next[id], offset[0] * scale, offset[1] * scale, items.find(item => item.id === id), view, [], false).rect
    commit(next)
  }

  function arrange(direction) {
    try { commit(arrangeRects(draft.current, selection, direction, gap, view)); setStatus('已排列选中的卡片') } catch (error) { setStatus(error.message) }
  }

  function exportText() {
    const next = structuredClone(importedDocument.current || document)
    next.profiles[profile] = encodedProfile()
    next.elements[profile] = elementDraft.current
    return JSON.stringify(next, null, 2)
  }

  function exportFile() {
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }))
    const link = window.document.createElement('a'); link.href = url; link.download = 'ui-layout.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function previewImport(text) {
    try {
      if (text.length > 100000) throw new Error('布局文件过大')
      const next = parseDocument(text, items)
      importedDocument.current = next
      elementDraft.current = next.elements[profile]
      const current = { ...defaults.current }
      for (const item of items) if (next.profiles[profile][item.id]) current[item.id] = decodeRect(next.profiles[profile][item.id], item, view)
      commit(current); setTransfer(null); setStatus('已预览导入布局，点击保存后生效')
    } catch (error) { setStatus(error.message) }
  }

  async function importFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 100000) throw new Error('布局文件过大')
      previewImport(await file.text())
    } catch (error) { setStatus(error.message) }
  }

  const selected = items.find(item => item.id === selection[0])
  const rect = rects[selected?.id]
  return createPortal(<div data-layout-editor-ui="true" className="layout-editor" onKeyDown={keyDown}>
    <style>{elementCSS(editing ? elementStyles : document.elements[profile], items)}</style>
    {!editing ? <button className="layout-editor-launch" onClick={enter}>布局</button> : <>
      <div className="layout-editor-toolbar" role="toolbar" aria-label="布局编辑工具">
        <strong>布局编辑</strong>
        <button disabled={!ready} aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>卡片</button>
        <button disabled={!ready} aria-pressed={mode === 'elements'} onClick={() => { if (mode !== 'elements') setNodes(collectElementNodes(items)); setMode('elements'); setSelection([selection[0] || items[0].id]); setStatus('点击卡片内的按钮、文字或选择内部图层。容器支持自动排版。') }}>内部元素</button>
        <button disabled={history.index === 0} onClick={() => travel(-1)}>撤销</button>
        <button disabled={history.index === history.entries.length - 1} onClick={() => travel(1)}>重做</button>
        <button disabled={!ready} onClick={() => { commit(structuredClone(defaults.current), {}); setStatus('已恢复初始位置和内部排版，点击保存后生效') }}>恢复默认</button>
        <button disabled={!ready} onClick={() => setTransfer({ mode: 'export', text: exportText() })}>导出</button><button disabled={!ready} onClick={() => setTransfer({ mode: 'import', text: '' })}>导入</button>
        <button onClick={() => exit(false)}>取消</button><button disabled={!ready} className="layout-editor-save" onClick={() => exit(true)}>保存并退出</button>
      </div>
      <aside className="layout-editor-inspector" aria-label="布局属性">
        <strong>卡片</strong>
        {items.map(item => <label key={item.id}><input type={mode === 'elements' ? 'radio' : 'checkbox'} name="layout-card" checked={selection.includes(item.id)} disabled={!rects[item.id]} onChange={event => setSelection(mode === 'elements' ? [item.id] : event.target.checked ? [item.id, ...selection.filter(id => id !== item.id)] : selection.filter(id => id !== item.id))}/>{item.label}</label>)}
        {mode === 'elements' ? <ElementEditor items={items} nodes={nodes} rootId={selection[0]} styles={elementStyles} onRootPick={id => setSelection([id])} onPreview={next => { elementDraft.current = next; setElementStyles(next) }} onCommit={next => commit(draft.current, next)}/> : <>
        {rect && <div className="layout-editor-fields">{[['x', 'X'], ['y', 'Y'], ['width', '宽'], ['height', '高']].map(([key, label]) => <label key={key}>{label}<input aria-label={`${selected.label}${label}`} type="number" value={Math.round(rect[key])} onChange={event => { if (event.target.value === '') return; commit({ ...draft.current, [selected.id]: fitRect({ ...rect, [key]: Number(event.target.value) }, selected, view) }) }}/></label>)}</div>}
        <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)}/>边缘 / 中心吸附</label>
        <label>间距<input aria-label="排列间距" type="number" min="0" max="120" value={gap} onChange={event => setGap(Math.max(0, Math.min(120, Number(event.target.value))))}/></label>
        <div className="layout-editor-arrange"><button disabled={selection.length < 2} onClick={() => arrange('horizontal')}>横向排列</button><button disabled={selection.length < 2} onClick={() => arrange('vertical')}>纵向排列</button></div>
        </>}
        <small>{profile === 'desktop' ? '桌面' : '窄屏'}布局独立保存</small>
        <p role="status">{status}</p>
      </aside>
      {items.filter(item => rects[item.id] && (mode === 'cards' || selection.includes(item.id))).map(item => <div key={item.id} className={`layout-editor-outline${selection.includes(item.id) ? ' is-selected' : ''}${mode === 'elements' ? ' is-passive' : ''}`} style={{ left: rects[item.id].x, top: rects[item.id].y, width: rects[item.id].width, height: rects[item.id].height }} tabIndex={mode === 'elements' ? -1 : 0} role="group" aria-label={`调整${item.label}`} onPointerDown={event => mode === 'cards' && begin(event, item.id)} onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
        <span className="layout-editor-label">{item.label}</span>
        {mode === 'cards' && selection.includes(item.id) && edges.map(edge => <button key={edge} className={`layout-editor-handle handle-${edge}`} aria-label={`${item.label}缩放${edge}`} onPointerDown={event => begin(event, item.id, edge)}/>)}
      </div>)}
      {guides.map(guide => <div key={guide.axis} className={`layout-editor-guide guide-${guide.axis}`} style={guide.axis === 'x' ? { left: guide.value } : { top: guide.value }}/>) }
      <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={importFile}/>
      {transfer && <div className="layout-editor-transfer-backdrop"><section className="layout-editor-transfer" role="dialog" aria-modal="true" aria-label="布局 JSON">
        <strong>{transfer.mode === 'export' ? '导出布局' : '导入布局'}</strong>
        <p>布局包含卡片位置、内部元素尺寸和文字 / 容器排版。迁移到其他项目时由适配器映射卡片。</p>
        <textarea aria-label="布局 JSON 内容" autoFocus readOnly={transfer.mode === 'export'} value={transfer.text} onChange={event => setTransfer({ ...transfer, text: event.target.value })}/>
        <div>{transfer.mode === 'export' ? <button onClick={exportFile}>下载 JSON 文件</button> : <><button onClick={() => fileInput.current.click()}>选择 JSON 文件</button><button onClick={() => previewImport(transfer.text)}>预览导入</button></>}
          <button onClick={() => setTransfer(null)}>关闭</button></div>
        <p role="status">{status}</p>
      </section></div>}
    </>}
  </div>, window.document.body)
}
