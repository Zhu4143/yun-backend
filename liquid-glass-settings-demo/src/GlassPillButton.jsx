import UnifiedLiquidGlass from './UnifiedLiquidGlass'

export default function GlassPillButton({
  children,
  active = false,
  fullWidth = false,
  onClick,
  type = 'button',
}) {
  return (
    <span className={`glass-pill-shell${active ? ' is-active' : ''}${fullWidth ? ' is-wide' : ''}`}>
      <span className="glass-pill-shell__halo" aria-hidden="true" />
      <UnifiedLiquidGlass
        displacementScale={14}
        saturation={138}
        aberrationIntensity={1.18}
        cornerRadius={16}
        padding="0"
        className="glass-pill-lens"
        thicknessBoost={1.48}
        highlightBoost={1.18}
        transmissionDim={0.944}
      >
        <button
          className={`glass-pill-button${active ? ' is-active' : ''}`}
          type={type}
          onClick={onClick}
        >
          {children}
        </button>
      </UnifiedLiquidGlass>
    </span>
  )
}
