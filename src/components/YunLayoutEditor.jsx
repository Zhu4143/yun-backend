import LayoutEditor from '../layout-editor/LayoutEditor'
import './YunLayoutEditor.css'

const items = [
  { id: 'player', label: '底部播放器', selector: '.app .player-card', minWidth: 320, minHeight: 112, anchorX: 'center', anchorY: 'bottom', elementLabels: { '.player-content': '播放器内容排版', '.player-meta': '封面与歌曲信息', '.track-info': '歌曲文字分组', '.track-info h2': '当前歌名', '.track-info p:not(.sub)': '当前歌手', '.cover': '歌曲封面', '.player-controls': '播放按钮组', '.control-button--primary': '播放 / 暂停', '.time-code': '播放时间' } },
  { id: 'chat', label: '聊天卡片', selector: '.app .chat-panel', minWidth: 280, minHeight: 220, anchorX: 'left', anchorY: 'bottom' },
  { id: 'voice', label: '声音面板', selector: '.app .voice-popover', minWidth: 280, minHeight: 260, anchorX: 'right', anchorY: 'top' },
  { id: 'library', label: '右侧歌单', selector: '.app .local-library-drawer', minWidth: 320, minHeight: 400, anchorX: 'right', anchorY: 'top', repeatSelectors: ['.library-scroll-track', '.library-track', '.library-playlist-row', '.library-up-next-track'], elementLabels: { '.library-content': '歌单内容排版', '.library-header': '歌单标题与操作', '.library-header-actions': '歌单操作按钮组', '.library-account-strip': '账户与快捷操作', '.library-account-profile': '账户信息', '.library-search': '歌曲搜索', '.library-track-info': '歌曲行 · 文字分组', '.library-play-button': '歌曲行 · 播放按钮', '.library-cover': '歌曲行 · 封面', '.library-all-button': '查看全部歌曲' } },
]
export default function YunLayoutEditor({ onEditingChange }) {
  return <LayoutEditor items={items} storageKey="yun-ui-layout-v1" onEditingChange={onEditingChange}/>
}
