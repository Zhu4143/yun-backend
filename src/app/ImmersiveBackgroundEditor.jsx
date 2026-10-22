import { useEffect, useId, useRef, useState } from 'react'
import { IMMERSIVE_BACKGROUND_GROUPS } from '../../server/visuals/immersiveBackgroundSchema.js'
import GlassSurface from './GlassSurface.jsx'
import { IconButton } from './components.jsx'
import { Close } from './icons.js'

export default function ImmersiveBackgroundEditor({ background, onClose, id }) {
  const [groupId, setGroupId] = useState('flow')
  const closeRef = useRef(null), prefix = useId()
  const group = IMMERSIVE_BACKGROUND_GROUPS.find(item => item.id === groupId)
  useEffect(() => { closeRef.current?.focus() }, [])
  return <GlassSurface as="section" className="immersive-background-editor" radius={24} id={id} aria-label="矿脉背景调节"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><div><h2>矿脉背景</h2><p>边调边看，留住喜欢的效果。</p></div><IconButton ref={closeRef} icon={Close} label="收起背景调节，回到歌词" onClick={onClose} /></header>
    <div className="ore-editor-groups" role="group" aria-label="背景调节分类">{IMMERSIVE_BACKGROUND_GROUPS.map(item => <button key={item.id} type="button" aria-pressed={item.id === groupId} onClick={() => setGroupId(item.id)}>{item.label}</button>)}</div>
    <div className="ore-editor-controls" aria-label={group.label}>
      {group.controls.map(control => {
        const value = background.settings[control.key], inputId = `${prefix}-${control.key}`
        return <div className={`ore-editor-control ${control.type === 'color' ? 'ore-editor-control--color' : ''}`} key={control.key}>
          <div><label htmlFor={inputId}>{control.label}</label><output htmlFor={inputId} aria-hidden="true">{control.type === 'color' ? value : `${Number(value).toFixed(control.digits ?? 2)}${control.suffix || ''}`}</output></div>
          <input id={inputId} type={control.type || 'range'} min={control.min} max={control.max} step={control.step} value={value}
            style={control.type !== 'color' ? { '--range-progress': `${(value - control.min) / (control.max - control.min) * 100}%` } : undefined}
            onChange={event => background.change(control.key, control.type === 'color' ? event.target.value : Number(event.target.value))} />
        </div>
      })}
    </div>
    <footer><p role="status">{background.dirty ? '● ' : ''}{background.message}</p><div><button type="button" className="ore-editor-reset" onClick={background.reset} disabled={background.saving}>恢复默认</button><button type="button" className="ore-editor-save" onClick={() => void background.save()} disabled={background.loading || background.saving}>{background.saving ? '保存中…' : '保存效果'}</button></div></footer>
  </GlassSurface>
}
