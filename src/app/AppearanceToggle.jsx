import { IconButton } from './components.jsx'

function Moon({ size = 20, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
  </svg>
}
function Sun({ size = 20, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" {...props}>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
  </svg>
}
export default function AppearanceToggle({ dark, onChange }) {
  return <IconButton className="round-button appearance-toggle" icon={dark ? Sun : Moon}
    label={dark ? '切换到日间模式' : '切换到夜晚模式'} onClick={onChange} />
}
