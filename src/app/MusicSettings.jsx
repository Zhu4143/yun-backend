import { lazy, Suspense, useId, useRef, useState } from 'react'
import { configureYunProModel } from '../api/yunModelApi.js'
import { IconButton, LoadingState, Modal } from './components.jsx'
import { Play, Pause } from './icons.js'

const AsrSettingsPanel = lazy(() => import('../components/AsrSettingsPanel.jsx'))
const TABS = [
  { id: 'general', label: '通用' },
  { id: 'voice', label: '声音' },
  { id: 'memory', label: '记忆与隐私' },
  { id: 'model', label: '模型连接' },
]
const WAKE_STATUS = {
  off: '已关闭', starting: '正在启动', listening: '等待「小昀」', paused: '对话时暂缓唤醒',
  unsupported: '当前浏览器不支持语音唤醒', denied: '麦克风权限被拒绝', error: '唤醒暂不可用',
  verifying: '正在确认唤醒', woken: '已唤醒', 'voiceprint-bypassed': '已唤醒',
  'voiceprint-denied': '无法使用麦克风', 'voiceprint-rejected': '声纹未匹配',
}

function SettingRow({ title, description, htmlFor, children }) {
  return <div className="setting-row">
    <div className="setting-copy">
      {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <strong>{title}</strong>}
      {description && <p>{description}</p>}
    </div>
    <div className="setting-control">{children}</div>
  </div>
}

function Toggle({ id, checked, onChange, disabled = false, label }) {
  return <input id={id} type="checkbox" role="switch" aria-label={label} checked={Boolean(checked)}
    disabled={disabled} onChange={event => onChange(event.target.checked)} />
}

export default function MusicSettings({ model, appearance, onClose, onLogin }) {
  const uid = useId()
  const [tab, setTab] = useState('general')
  const [advancedVoice, setAdvancedVoice] = useState(false)
  const [glassEnabled, setGlassEnabled] = useState(() => {
    try { return window.localStorage.getItem('yun_glass_enabled') !== 'false' } catch { return true }
  })
  const [notice, setNotice] = useState('')
  const [previewNotice, setPreviewNotice] = useState('')
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [modelStatus, setModelStatus] = useState(() => model.bootState?.data?.INIT_COMPANION || null)
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionNotice, setConnectionNotice] = useState('')
  const [modelForm, setModelForm] = useState(() => ({
    apiKey: '', baseUrl: 'https://api.deepseek.com',
    model: model.bootState?.data?.INIT_COMPANION?.model || 'deepseek-v4-pro',
  }))
  const modelBusyRef = useRef(false)
  const { voice, voiceInput, memory, account } = model
  const settings = voice.settings
  const memoryActive = memory.memoryEnabled && memory.memoryMode !== 'off'
  const canWake = voiceInput.supported && typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const voiceBusy = voice.isSpeaking || voice.isPreparingSpeech || voice.isPreviewing

  const changeTab = nextTab => {
    setTab(nextTab)
    setAdvancedVoice(false)
    setConfirmation('')
  }
  const handleTabKey = event => {
    const index = TABS.findIndex(item => item.id === tab)
    let nextIndex
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    else return
    event.preventDefault()
    changeTab(TABS[nextIndex].id)
    document.getElementById(`${uid}-tab-${TABS[nextIndex].id}`)?.focus()
  }
  const changeGlass = enabled => {
    setGlassEnabled(enabled)
    setNotice('')
    try { window.localStorage.setItem('yun_glass_enabled', String(enabled)) }
    catch { setNotice('当前浏览器无法保存外观偏好，本次设置仍会应用。') }
    window.dispatchEvent(new CustomEvent('yun:glass-setting', { detail: { enabled } }))
  }
  const updateMemory = async action => {
    if (memoryBusy) return
    setMemoryBusy(true)
    setNotice('')
    try { await action() }
    catch { setNotice('记忆设置未能保存，请稍后重试。') }
    finally { setMemoryBusy(false); setConfirmation('') }
  }
  const preview = async () => {
    setPreviewNotice('')
    try {
      const played = await voice.previewVoice()
      setPreviewNotice(played ? '试听结束' : '暂时无法试听，请检查语音服务与播放权限。')
    } catch { setPreviewNotice('暂时无法试听，请检查语音服务与播放权限。') }
  }
  const refreshModelStatus = async () => {
    if (modelBusyRef.current) return
    modelBusyRef.current = true
    setConnectionBusy(true)
    setConnectionNotice('')
    try {
      const response = await fetch('/api/yun/model-status', { cache: 'no-store' })
      if (!response.ok) throw new Error('Unavailable')
      const status = await response.json()
      setModelStatus({ status: status.status, provider: status.provider, model: status.model })
      setConnectionNotice('状态已刷新。实际可用性以对话结果为准。')
    } catch { setConnectionNotice('无法获取模型状态，请检查服务连接。') }
    finally { modelBusyRef.current = false; setConnectionBusy(false) }
  }
  const submitModel = async event => {
    event.preventDefault()
    if (modelBusyRef.current || !modelForm.apiKey.trim()) return
    modelBusyRef.current = true
    setConnectionBusy(true)
    setConnectionNotice('正在验证模型连接…')
    try {
      const result = await configureYunProModel({
        apiKey: modelForm.apiKey.trim(), baseUrl: modelForm.baseUrl.trim(), model: modelForm.model.trim(),
      })
      setModelForm(current => ({ ...current, apiKey: '' }))
      if (result.modelStatus) setModelStatus({
        status: result.modelStatus.status, provider: result.modelStatus.provider, model: result.modelStatus.model,
      })
      setConnectionNotice('验证通过，模型配置已保存到服务端。')
    } catch { setConnectionNotice('连接失败，请检查 API Key、服务地址和模型名后重试。') }
    finally { modelBusyRef.current = false; setConnectionBusy(false) }
  }

  return <Modal title="设置" onClose={onClose} className="settings-dialog">
    <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={handleTabKey}>
      {TABS.map(item => <button type="button" key={item.id} id={`${uid}-tab-${item.id}`} role="tab"
        aria-selected={tab === item.id} aria-controls={`${uid}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        className={tab === item.id ? 'is-active' : ''} onClick={() => changeTab(item.id)}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={`${uid}-panel-${tab}`} aria-labelledby={`${uid}-tab-${tab}`}>
      {tab === 'general' && <section className="settings-section">
        <SettingRow title="界面外观" htmlFor={`${uid}-appearance`} description="夜晚模式降低界面亮度，保留液态玻璃和封面色彩。">
          <select id={`${uid}-appearance`} aria-label="界面外观" value={appearance.mode} onChange={event => {
            const saved = appearance.setMode(event.target.value)
            setNotice(saved ? '' : '当前浏览器无法保存外观偏好，本次设置仍会应用。')
          }}>
            <option value="light">日间</option><option value="dark">夜晚</option><option value="system">跟随系统</option>
          </select>
        </SettingRow>
        <SettingRow title="网易云音乐" description={account.info?.loggedIn
          ? `已登录 · ${account.info.profile?.nickname || account.info.nickname || '网易云账户'}`
          : '登录后访问你的收藏和歌单。'}>
          <button type="button" className="button button--secondary" onClick={onLogin}>
            {account.info?.loggedIn ? '管理账户' : '登录账户'}
          </button>
        </SettingRow>
        <SettingRow title="液态玻璃" htmlFor={`${uid}-glass`} description="保留玻璃的折射与通透质感；关闭后使用简洁半透明外观。">
          <Toggle id={`${uid}-glass`} label="液态玻璃" checked={glassEnabled} onChange={changeGlass} />
        </SettingRow>
        <SettingRow title="本地曲库" description={`${model.library.songs.length} 首歌曲 · 音乐文件保留在当前设备。`}>
          <button type="button" className="button button--secondary" disabled={model.library.status === 'loading'}
            onClick={() => model.library.refresh({ scan: true })}>
            {model.library.status === 'loading' ? '扫描中…' : '重新扫描'}
          </button>
        </SettingRow>
        {model.library.error && <p className="inline-notice" role="status">{model.library.error}</p>}
        <p className="settings-note">电脑端可按空格播放或暂停。手机端点击底部播放器查看歌词和播放队列。</p>
      </section>}
      {tab === 'voice' && <section className="settings-section">
        <SettingRow title="自动朗读" htmlFor={`${uid}-reading`} description="为聊天和普通播客回复播放语音。关闭后仍保留文字。">
          <Toggle id={`${uid}-reading`} label="自动朗读" checked={settings.enabled} onChange={enabled => {
            if (!enabled) voice.stopSpeaking()
            voice.updateSettings({ enabled })
          }} />
        </SettingRow>
        <SettingRow title="声音" htmlFor={`${uid}-voice`}>
          <select id={`${uid}-voice`} value={settings.voice} onChange={event => voice.updateSettings({ voice: event.target.value })}>
            <option value="zh_female_xiaohe_uranus_bigtts">小何 · 温柔自然</option>
            <option value="S_5U82YXa42">专属声音</option>
          </select>
        </SettingRow>
        <SettingRow title="语速" htmlFor={`${uid}-speed`}>
          <input id={`${uid}-speed`} type="range" min="0.7" max="1.4" step="0.05" value={settings.speed}
            onChange={event => voice.updateSettings({ speed: Number(event.target.value) })} />
          <output htmlFor={`${uid}-speed`}>{Number(settings.speed).toFixed(2)}×</output>
        </SettingRow>
        <SettingRow title="朗读音量" htmlFor={`${uid}-voice-volume`}>
          <input id={`${uid}-voice-volume`} type="range" min="0.4" max="1.5" step="0.05" value={settings.volume}
            onChange={event => voice.updateSettings({ volume: Number(event.target.value) })} />
          <output htmlFor={`${uid}-voice-volume`}>{Math.round(settings.volume * 100)}%</output>
        </SettingRow>
        <SettingRow title="朗读时音乐音量" htmlFor={`${uid}-duck`} description="播放语音时，将音乐暂时降低到这个音量。">
          <input id={`${uid}-duck`} type="range" min="0.12" max="0.6" step="0.01" value={settings.duckingVolume}
            onChange={event => voice.updateSettings({ duckingVolume: Number(event.target.value) })} />
          <output htmlFor={`${uid}-duck`}>{Math.round(settings.duckingVolume * 100)}%</output>
        </SettingRow>
        <div className="setting-row">
          <div className="setting-copy"><strong>试听声音</strong><p>试听只播放这一句，不会开启自动朗读。</p></div>
          <div className="setting-control">
            {voiceBusy ? <IconButton icon={Pause} label="停止试听或朗读" onClick={voice.stopSpeaking} />
              : <button type="button" className="button button--secondary" onClick={preview}><Play size={16} aria-hidden="true" />试听</button>}
          </div>
        </div>
        {previewNotice && <p className="inline-notice" role="status">{previewNotice}</p>}
        <SettingRow title="语音唤醒" htmlFor={`${uid}-wake`} description={!canWake
          ? '当前浏览器不支持语音唤醒，可使用聊天栏的麦克风输入。'
          : WAKE_STATUS[voiceInput.wakeStatus] || '点击开启后，可说「小昀」开始对话。'}>
          <Toggle id={`${uid}-wake`} label="语音唤醒" checked={voiceInput.wakeEnabled}
            disabled={voiceInput.nativeEnabled || (!canWake && !voiceInput.wakeEnabled)} onChange={voiceInput.setWakeEnabled} />
        </SettingRow>
        <p className="settings-note">开启语音唤醒或点击麦克风后才会申请麦克风权限。识别内容将发送至你配置的语音服务。</p>
        <details className="settings-advanced" onToggle={event => setAdvancedVoice(event.currentTarget.open)}>
          <summary>高级语音设置</summary>
          <SettingRow title="桌面原生唤醒与打断" htmlFor={`${uid}-native`} description={voiceInput.nativeEnabled
            ? voiceInput.nativeStatus : '在本机使用原有 KWS、回声消除和语音打断，需要已安装的桌面语音服务。本次开启后生效。'}>
            <Toggle id={`${uid}-native`} label="桌面原生唤醒与打断" checked={voiceInput.nativeEnabled}
              disabled={voiceInput.nativeChanging || !['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)}
              onChange={voiceInput.setNativeEnabled} />
          </SettingRow>
          {advancedVoice && <Suspense fallback={<LoadingState>正在加载语音识别设置…</LoadingState>}>
            <AsrSettingsPanel embedded />
          </Suspense>}
        </details>
      </section>}
      {tab === 'memory' && <section className="settings-section">
        <SettingRow title="记忆" htmlFor={`${uid}-memory`} description="允许昀在后续对话中记住你的偏好。">
          <Toggle id={`${uid}-memory`} label="长期记忆" checked={memory.memoryEnabled} disabled={memoryBusy}
            onChange={enabled => updateMemory(() => memory.setMemoryEnabled(enabled))} />
        </SettingRow>
        <SettingRow title="记忆方式" htmlFor={`${uid}-memory-mode`}>
          <select id={`${uid}-memory-mode`} value={memory.memoryMode} disabled={memoryBusy || !memory.memoryEnabled}
            onChange={event => updateMemory(() => memory.setMemoryMode(event.target.value))}>
            <option value="off">关闭记忆</option><option value="smart">自然记得</option><option value="deep">认真陪你</option>
          </select>
        </SettingRow>
        <p className="settings-note">{memory.memoryModeCopy?.[memory.memoryMode]}</p>
        <div className="memory-summary">
          <strong>{memory.status === 'loading' ? '正在读取记忆' : memory.status === 'error' ? '记忆服务暂不可用' : memoryActive ? '当前记忆摘要' : '记忆已关闭'}</strong>
          <p>{memory.summary}</p>
          {memory.status === 'error' && <p className="inline-notice" role="status">读取或保存未完成，请检查服务后重试。</p>}
        </div>
        <p className="settings-note">关闭记忆会停止读取和记录长期、近期记忆；当前对话仍用于本轮上下文。已有服务端记忆不会因此删除。</p>
        <div className="setting-control">
          <button type="button" className="button button--secondary" disabled={memoryBusy || !memoryActive} onClick={memory.openLongTermMemory}>查看长期记忆</button>
          <button type="button" className="button button--secondary" disabled={memoryBusy} onClick={() => setConfirmation('recent')}>清空近期记忆</button>
          <button type="button" className="button button--secondary" disabled={memoryBusy || !memoryActive} onClick={() => setConfirmation('reset')}>重载默认记忆</button>
        </div>
        {confirmation && <div className="inline-notice" role="group" aria-label="确认记忆操作">
          <p>{confirmation === 'recent' ? '将清空当前设备的近期记忆，保留服务端长期记忆。确认继续？'
            : '将重新读取默认记忆，并重置服务端长期记忆。此操作无法撤销，确认继续？'}</p>
          <div className="setting-control">
            <button type="button" className="button button--secondary" disabled={memoryBusy} onClick={() => setConfirmation('')}>取消</button>
            <button type="button" className="button button--primary" disabled={memoryBusy}
              onClick={() => updateMemory(() => confirmation === 'recent' ? memory.clearRecentMemory() : memory.resetDefaultMemory())}>
              {memoryBusy ? '处理中…' : '确认继续'}
            </button>
          </div>
        </div>}
      </section>}
      {tab === 'model' && <section className="settings-section">
        <SettingRow title="对话模型" description={modelStatus?.model
          ? `${modelStatus.provider || '已配置'} · ${modelStatus.model}` : '尚未读取连接状态'}>
          <button type="button" className="button button--secondary" disabled={connectionBusy} onClick={refreshModelStatus}>检查状态</button>
        </SettingRow>
        <p className="settings-note">连接 DeepSeek 兼容服务。API Key 仅提交到当前服务端进行验证和保存，不写入浏览器存储。</p>
        <form className="model-form" onSubmit={submitModel}>
          <label className="field-label" htmlFor={`${uid}-base-url`}>服务地址</label>
          <input id={`${uid}-base-url`} type="url" value={modelForm.baseUrl} autoComplete="off" spellCheck="false" required disabled={connectionBusy}
            onChange={event => setModelForm(current => ({ ...current, baseUrl: event.target.value }))} />
          <label className="field-label" htmlFor={`${uid}-model-name`}>模型名称</label>
          <input id={`${uid}-model-name`} value={modelForm.model} autoComplete="off" spellCheck="false" required disabled={connectionBusy}
            onChange={event => setModelForm(current => ({ ...current, model: event.target.value }))} />
          <label className="field-label" htmlFor={`${uid}-model-key`}>API Key</label>
          <input id={`${uid}-model-key`} type="password" value={modelForm.apiKey} autoComplete="off" spellCheck="false" required disabled={connectionBusy}
            placeholder="填写后验证连接" onChange={event => setModelForm(current => ({ ...current, apiKey: event.target.value }))} />
          <button type="submit" className="button button--primary" disabled={connectionBusy || !modelForm.apiKey.trim()}>
            {connectionBusy ? '处理中…' : '验证并保存'}
          </button>
        </form>
        {connectionNotice && <p className="inline-notice" role="status">{connectionNotice}</p>}
      </section>}
    </div>
    {notice && <p className="inline-notice" role="status">{notice}</p>}
  </Modal>
}
