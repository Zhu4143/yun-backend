import { useEffect, useId, useRef, useState } from 'react'
import { LYRIC_EFFECT_GROUPS } from '../../server/visuals/lyricEffectsSchema.js'
import { LYRIC_FONTS, LYRIC_GENRES, lyricTrackKey } from '../../server/visuals/lyricFontCatalog.js'
import GlassSurface from './GlassSurface.jsx'
import { IconButton } from './components.jsx'
import { Close } from './icons.js'

export default function LyricEffectsEditor({ effects, onClose, id, colors, selection, song, fontUnavailable }) {
  const [groupId, setGroupId] = useState('color')
  const closeRef = useRef(null), prefix = useId()
  const group = LYRIC_EFFECT_GROUPS.find(item => item.id === groupId)
  const trackKey = lyricTrackKey(song), automatic = effects.settings.fontMode === 'auto'
  const changeCategory = value => {
    const next = { ...effects.settings.trackGenres }
    delete next[trackKey]
    if (value !== 'auto') next[trackKey] = value
    effects.change('trackGenres', next)
  }
  const changeFont = value => {
    if (automatic && selection.id !== 'unknown') effects.change('genreFonts', { ...effects.settings.genreFonts, [selection.id]: value })
    else effects.change('font', value)
  }
  useEffect(() => { closeRef.current?.focus() }, [])
  return <GlassSurface as="section" className="immersive-background-editor lyric-effects-editor" radius={24} id={id} aria-label="歌词特效调节"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><div><h2>歌词特效</h2><p>随歌声染色，把喜欢的效果留下。</p></div><IconButton ref={closeRef} icon={Close} label="收起歌词调节" onClick={onClose} /></header>
    <div className="lyric-palette-preview"><span style={{ background: colors[0] }} /><span style={{ background: colors[1] }} /><small>{effects.settings.colorMode === 'cover' ? '跟随当前歌曲封面' : '使用自定义双色'}</small></div>
    <div className="ore-editor-groups" role="group" aria-label="歌词调节分类">{LYRIC_EFFECT_GROUPS.map(item => <button key={item.id} type="button" aria-pressed={item.id === groupId} onClick={() => setGroupId(item.id)}>{item.label}</button>)}</div>
    <div className="ore-editor-controls" aria-label={group.label}>
      {groupId === 'font' && <div className="lyric-font-matching">
        <label htmlFor={`${prefix}-font-mode`}>字体切换</label>
        <select id={`${prefix}-font-mode`} value={effects.settings.fontMode} onChange={event => effects.change('fontMode', event.target.value)}>
          <option value="auto">跟随歌曲风格</option><option value="manual">手动固定字体</option>
        </select>
        <p className="lyric-font-current">{automatic ? `${selection.label} → ${selection.font.label}` : `固定字体 · ${selection.font.label}`}</p>
        <p className="lyric-editor-hint">{automatic ? selection.source : '换歌时保持此字体'}；标签不明确时可手动分类。</p>
        <label htmlFor={`${prefix}-genre`}>当前歌曲分类</label>
        <select id={`${prefix}-genre`} value={effects.settings.trackGenres[trackKey] || 'auto'} onChange={event => changeCategory(event.target.value)}>
          <option value="auto">自动判断</option>{LYRIC_GENRES.map(genre => <option key={genre.id} value={genre.id}>{genre.label}</option>)}
        </select>
        <label htmlFor={`${prefix}-font`}>{automatic && selection.id !== 'unknown' ? '此类别的字体' : automatic ? '默认字体' : '固定字体'}</label>
        <select id={`${prefix}-font`} value={selection.font.id} onChange={event => changeFont(event.target.value)}>{LYRIC_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select>
        <p className="lyric-font-sample" style={{ fontFamily: selection.font.family }}>把时间留给音乐<br /><span>Feel the music</span></p>
        {fontUnavailable && <p className="lyric-editor-hint" role="status">字体资源暂不可用，已使用系统字体。</p>}
        {['gothic', 'cyber', 'condensed'].includes(selection.font.id) && <p className="lyric-editor-hint">此字体用于拉丁字母；中文搭配工业体，避免缺字。</p>}
      </div>}
      {group.controls.filter(control => !['font', 'fontMode'].includes(control.key)).map(control => {
        const value = effects.settings[control.key], inputId = `${prefix}-${control.key}`
        const customColor = control.type === 'color', disabled = customColor && effects.settings.colorMode !== 'custom'
        return <div className={`ore-editor-control ${customColor ? 'ore-editor-control--color' : ''}`} key={control.key}>
          <div><label htmlFor={inputId}>{control.label}</label>{control.type !== 'select' && <output htmlFor={inputId} aria-hidden="true">{customColor ? value : `${Number(value).toFixed(control.digits ?? 2)}${control.suffix || ''}`}</output>}</div>
          {control.type === 'select' ? <select id={inputId} value={value} onChange={event => effects.change(control.key, event.target.value)}>{control.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            : <input id={inputId} type={control.type || 'range'} min={control.min} max={control.max} step={control.step} value={value} disabled={disabled}
              style={!customColor ? { '--range-progress': `${(value - control.min) / (control.max - control.min) * 100}%` } : undefined}
              onChange={event => effects.change(control.key, customColor ? event.target.value : Number(event.target.value))} />}
        </div>
      })}
      {groupId === 'font' && <details className="lyric-font-mappings"><summary>8 类风格的字体匹配</summary>
        {LYRIC_GENRES.map(genre => <label key={genre.id}><span>{genre.label}</span><select aria-label={`${genre.label}字体`} value={effects.settings.genreFonts[genre.id]} onChange={event => effects.change('genreFonts', { ...effects.settings.genreFonts, [genre.id]: event.target.value })}>
          {LYRIC_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}
        </select></label>)}
        <p className="lyric-editor-hint">自动匹配优先使用歌曲标签，再参考曲名和歌手关键词；未识别的歌曲使用默认字体。分类和匹配规则随“保存歌词效果”一起保存。</p>
      </details>}
      {groupId === 'timing' && <p className="lyric-editor-hint">按歌词时间推进，句内扫色使用这一句的时间区间。暂停、拖动时同步更新。</p>}
      {groupId === 'color' && <p className="lyric-editor-hint">选择自定义双色后可调颜色；封面配色会在换歌时平滑过渡。</p>}
    </div>
    <footer><p role="status">{effects.dirty ? '● ' : ''}{effects.message}</p><div><button type="button" className="ore-editor-reset" onClick={effects.reset} disabled={effects.saving}>恢复默认</button><button type="button" className="ore-editor-save" onClick={() => void effects.save()} disabled={effects.loading || effects.saving}>{effects.saving ? '保存中…' : '保存歌词效果'}</button></div></footer>
  </GlassSurface>
}
