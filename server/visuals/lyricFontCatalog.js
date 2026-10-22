// Shared catalog: the UI, preset validator and font download tool use the same IDs.
export const LYRIC_FONTS = [
  { id: 'sans', label: '简洁黑体', family: '"Segoe UI", "Microsoft YaHei", sans-serif', category: '通用' },
  { id: 'serif', label: '人文宋体', family: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif', category: '通用' },
  { id: 'rounded', label: '柔和圆体', family: '"Yuanti SC", "YouYuan", "Microsoft YaHei", sans-serif', category: '通用' },
  { id: 'brush', label: '马善政 · 毛笔楷体', name: 'Ma Shan Zheng', folder: 'mashanzheng', weight: 400, family: '"Ma Shan Zheng", "KaiTi", serif', category: '古风' },
  { id: 'gothic', label: 'UnifrakturCook · 哥特', name: 'UnifrakturCook', folder: 'unifrakturcook', weight: 700, family: '"UnifrakturCook", "ZCOOL QingKe HuangYou", "Microsoft YaHei", sans-serif', category: 'Phonk', companion: 'industrial' },
  { id: 'cyber', label: 'Orbitron · 未来科技', name: 'Orbitron', folder: 'orbitron', weight: 600, family: '"Orbitron", "ZCOOL QingKe HuangYou", "Microsoft YaHei", sans-serif', category: '电子', companion: 'industrial' },
  { id: 'condensed', label: 'Bebas Neue · 硬朗窄体', name: 'Bebas Neue', folder: 'bebasneue', weight: 400, family: '"Bebas Neue", "ZCOOL QingKe HuangYou", "Microsoft YaHei", sans-serif', category: '摇滚 / 说唱', companion: 'industrial' },
  { id: 'handwritten', label: '龙藏 · 手写行草', name: 'Long Cang', folder: 'longcang', weight: 400, family: '"Long Cang", "KaiTi", serif', category: '民谣' },
  { id: 'playful', label: '站酷快乐体', name: 'ZCOOL KuaiLe', folder: 'zcoolkuaile', weight: 400, family: '"ZCOOL KuaiLe", "YouYuan", sans-serif', category: '轻快' },
  { id: 'elegant', label: 'Cormorant · 优雅衬线', name: 'Cormorant Garamond', folder: 'cormorantgaramond', weight: 600, family: '"Cormorant Garamond", "ZCOOL XiaoWei", "SimSun", serif', category: '古典 / 爵士', companion: 'songti' },
  { id: 'songti', label: '站酷小薇 · 文艺宋体', name: 'ZCOOL XiaoWei', folder: 'zcoolxiaowei', weight: 400, family: '"ZCOOL XiaoWei", "SimSun", serif', category: '抒情' },
  { id: 'industrial', label: '站酷庆科黄油 · 工业体', name: 'ZCOOL QingKe HuangYou', folder: 'zcoolqingkehuangyou', weight: 400, family: '"ZCOOL QingKe HuangYou", "Microsoft YaHei", sans-serif', category: '电子 / 中文补字' },
]
export const LYRIC_FONT_OPTIONS = LYRIC_FONTS.map(font => [font.id, font.label])
export const LYRIC_GENRES = [
  { id: 'guofeng', label: '古风 / 国风', font: 'brush' },
  { id: 'phonk', label: 'Phonk / 暗黑', font: 'gothic' },
  { id: 'electronic', label: '电子 / 赛博', font: 'cyber' },
  { id: 'rock', label: '摇滚 / 说唱', font: 'condensed' },
  { id: 'folk', label: '民谣 / 独立', font: 'handwritten' },
  { id: 'playful', label: '轻快 / 动漫', font: 'playful' },
  { id: 'classical', label: '古典 / 爵士', font: 'elegant' },
  { id: 'ballad', label: '抒情 / 流行', font: 'songti' },
]
export const LYRIC_GENRE_DEFAULTS = Object.freeze(Object.fromEntries(LYRIC_GENRES.map(genre => [genre.id, genre.font])))
export const lyricTrackKey = song => song ? `${song.source || 'local'}:${song.providerId || song.id || song.fileUrl || ''}` : ''
export const lyricFont = id => LYRIC_FONTS.find(font => font.id === id) || LYRIC_FONTS[0]
