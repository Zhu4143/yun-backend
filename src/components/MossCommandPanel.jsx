import { useState } from 'react'
import { useMossAgent } from '../hooks/useMossAgent'
import './MossCommandPanel.css'

const QUICK_COMMANDS = ['你好', '当前木星危机的风险是什么？', '查看系统状态', '当前音量']

export default function MossCommandPanel() {
  const [expanded, setExpanded] = useState(false)
  const [command, setCommand] = useState('')
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [modelForm, setModelForm] = useState({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', temperature: '0.3' })
  const [modelConfigMessage, setModelConfigMessage] = useState('')
  const { runtimeState, modelStatus, desktopAgent, entries, pendingConfirmation, isProcessing, submit, abort, retry, cancelConfirmation, configureModel } = useMossAgent()
  const send = async (event) => {
    event?.preventDefault()
    const value = command.trim()
    if (!value || isProcessing) return
    setCommand('')
    await submit({ message: value })
  }
  const applyModelConfig = async (event) => {
    event.preventDefault()
    setModelConfigMessage('正在安全应用模型配置…')
    try {
      const result = await configureModel({ ...modelForm, temperature: Number(modelForm.temperature) })
      setModelForm((form) => ({ ...form, apiKey: '' }))
      setModelConfigMessage(`${result.modelStatus.status} · 配置已应用到当前本地服务。`)
    } catch (error) {
      setModelConfigMessage(error.message)
    }
  }
  return (
    <aside className={`moss-command-panel ${expanded ? 'is-expanded' : ''}`} aria-label="MOSS command terminal">
      <button className="moss-command-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span>550W</span><i /> MOSS TERMINAL
      </button>
      {expanded && <div className="moss-terminal-shell">
        <header>
          <div><strong>550W / MOSS</strong><small>CENTRAL INTELLIGENCE</small></div>
          <div className="moss-terminal-statuses">
            <em className={`moss-status moss-status-${String(runtimeState.status || 'READY').toLowerCase()}`}>{runtimeState.status || 'READY'}</em>
            <em className={`moss-status moss-status-${String(modelStatus.status || 'MODEL_OFFLINE').toLowerCase()}`}>{modelStatus.status || 'MODEL_OFFLINE'}</em>
            <em className={`moss-status moss-status-${String(desktopAgent.status || 'DISCONNECTED').toLowerCase()}`}>AGENT_{desktopAgent.status || 'DISCONNECTED'}</em>
          </div>
        </header>
        <button className="moss-model-config-toggle" type="button" onClick={() => setShowModelConfig((value) => !value)}>
          {showModelConfig ? '隐藏模型配置' : '接入模型 API'}
        </button>
        {showModelConfig && <form className="moss-model-config" onSubmit={applyModelConfig}>
          <p>仅发送至本机后端；密钥不会显示、不会写入前端文件，也不会提交到 Git。</p>
          <label>供应商<input value={modelForm.provider} onChange={(event) => setModelForm((form) => ({ ...form, provider: event.target.value }))} placeholder="deepseek" /></label>
          <label>Base URL<input value={modelForm.baseUrl} onChange={(event) => setModelForm((form) => ({ ...form, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com" /></label>
          <label>模型<input value={modelForm.model} onChange={(event) => setModelForm((form) => ({ ...form, model: event.target.value }))} placeholder="deepseek-chat" /></label>
          <label>API Key<input type="password" value={modelForm.apiKey} onChange={(event) => setModelForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="仅在提交时使用" autoComplete="off" required /></label>
          <label>温度<input type="number" min="0" max="1" step="0.1" value={modelForm.temperature} onChange={(event) => setModelForm((form) => ({ ...form, temperature: event.target.value }))} /></label>
          <button type="submit">应用并联机</button><small>{modelConfigMessage}</small>
        </form>}
        <div className="moss-terminal-output" role="log" aria-live="polite">
          {!entries.length && <p className="moss-terminal-idle">[SYSTEM] 等待授权指令。所有工具调用均返回真实执行回执。</p>}
          {entries.map((entry) => <article key={entry.id} className={entry.ok ? '' : 'is-error'}>
            <small>&gt; {entry.command}</small><p>{entry.message}</p>
            {entry.result && <code>{entry.result.ok ? 'EXECUTED' : 'BLOCKED'} · {entry.result.tool}{entry.result.error ? ` · ${entry.result.error}` : ''}</code>}
          </article>)}
        </div>
        {pendingConfirmation && <div className="moss-confirmation">
          <b>CONFIRMATION REQUIRED</b><p>{pendingConfirmation.summary}</p>
          <button onClick={() => submit({ confirmedActionId: pendingConfirmation.actionId })} disabled={isProcessing}>确认执行</button>
          <button onClick={cancelConfirmation} disabled={isProcessing}>拒绝</button>
        </div>}
        <div className="moss-quick-commands">{QUICK_COMMANDS.map((item) => <button key={item} onClick={() => { setCommand(item); submit({ message: item }) }} disabled={isProcessing}>{item}</button>)}</div>
        <form onSubmit={send} className="moss-command-form">
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="输入 MOSS 指令" disabled={isProcessing} />
          {isProcessing ? <button type="button" onClick={abort}>停止</button> : <button type="submit">执行</button>}
          <button type="button" onClick={retry} disabled={isProcessing || !entries.length}>重试</button>
        </form>
      </div>}
    </aside>
  )
}
