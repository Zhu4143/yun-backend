import LiquidGlass from 'liquid-glass-react'
import './YunWakeOrb.css'

export default function YunWakeOrb({ visible = false }) {
  return (
    <div className={`yun-wake-orb-shell${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <LiquidGlass
        displacementScale={40}
        blurAmount={0.01}
        saturation={160}
        aberrationIntensity={3}
        elasticity={0.35}
        cornerRadius={999}
        padding="0px"
        className="yun-wake-orb"
      >
        <span className="yun-wake-orb__rear" />
        <span className="yun-wake-orb__depth" />
        <span className="yun-wake-orb__shine" />
      </LiquidGlass>
    </div>
  )
}
