import { useEffect, useState } from 'react'
import GlassPillButton from './GlassPillButton'
import UnifiedLiquidGlass from './UnifiedLiquidGlass'
import { opticalFieldController } from './OpticalFieldController'

const modes = [
  { id: 'quiet', label: '安静模式', copy: '只保留必要信息，减少主动联想。' },
  { id: 'natural', label: '自然记得', copy: '自然保留近期偏好与常用选择。' },
  { id: 'deep', label: '认真陪你', copy: '主动结合长期记忆理解你的表达。' },
]

export default function App() {
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState('deep')
  const [aiControl, setAiControl] = useState(true)

  useEffect(() => {
    opticalFieldController.start()
  }, [])

  const selectedMode = modes.find((item) => item.id === mode) ?? modes[0]

  return (
    <main className="demo-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <div className="particle-disc" aria-hidden="true" />

      <UnifiedLiquidGlass
        displacementScale={12}
        saturation={132}
        aberrationIntensity={1.05}
        cornerRadius={30}
        padding="0"
        className="settings-glass"
      >
        <section className="settings-card">
          <header className="settings-header">
            <div>
              <p className="eyebrow">YUN MEMORY</p>
              <h1>记忆设置</h1>
            </div>
            <button className="close-button" type="button" aria-label="关闭">×</button>
          </header>

          <div className="settings-row">
            <span>允许使用本地记忆</span>
            <button
              className={`toggle${enabled ? ' is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((value) => !value)}
            >
              <i />
            </button>
          </div>

          <p className="summary">
            默认记忆：开 · 模式：{selectedMode.label} · 近期话题：设计、音乐、陪伴。
          </p>

          <div className="mode-grid">
            {modes.map((item) => (
              <GlassPillButton
                key={item.id}
                active={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </GlassPillButton>
            ))}
          </div>

          <p className="mode-copy">{selectedMode.copy}</p>

          <GlassPillButton fullWidth>查看你的记忆</GlassPillButton>

          <div className="manage-grid">
            <GlassPillButton>重载默认</GlassPillButton>
            <GlassPillButton>清空近期</GlassPillButton>
          </div>

          <div className="divider" />

          <div className="settings-row">
            <span>允许 AI 控制播放形式</span>
            <button
              className={`toggle${aiControl ? ' is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={aiControl}
              onClick={() => setAiControl((value) => !value)}
            >
              <i />
            </button>
          </div>
        </section>
      </UnifiedLiquidGlass>

      <p className="hint">移动鼠标，观察统一 opticalField 对玻璃亮度与色散的影响</p>
    </main>
  )
}
