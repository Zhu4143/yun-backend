# Liquid Glass UI Skill for Yun Music Companion

## 1. 当前项目前端结构

当前项目是 React + Vite，但当前页面实现方式是单 App 组件前端，不是拆分组件化前端。

真实被浏览器加载的入口链路：

- `index.html` 是浏览器首先加载的 HTML 文件。
- `index.html` 中的 `<div id="root"></div>` 是 React 挂载点。
- `index.html` 通过 `<script type="module" src="/src/main.jsx"></script>` 加载真实前端入口。
- `src/main.jsx` 引入 `src/index.css` 和 `src/App.jsx`，然后使用 `createRoot(document.getElementById('root')).render(<App />)` 渲染页面。
- `src/App.jsx` 是当前页面主要 HTML/JSX 结构所在文件。
- `src/App.css` 是当前页面主要视觉样式所在文件。
- `src/index.css` 只负责 `html`、`body`、`#root` 的基础尺寸和 overflow。

核心 UI 文件：

- `src/App.jsx`：当前 UI 结构、LiquidGlass 组件、卡片内容、播放条内容。
- `src/App.css`：当前背景、顶部卡片、底部播放条、封面、文字、按钮样式。
- `src/index.css`：根节点全屏布局，不是主要 UI 设计文件。
- `public/scene.png`：当前背景场景图。

不能乱动的文件：

- `index.html`：不要改 `#root`，不要改 `/src/main.jsx` 入口。
- `src/main.jsx`：不要改 React 挂载方式。
- `src/index.css`：除非明确需要修复根尺寸，否则不要动。
- `package.json` / `package-lock.json`：UI 微调不应修改依赖。
- `public/*`：不要删除现有图片、图标、favicon。
- `node_modules/*`：不要修改第三方包。
- `dist/*`：构建产物，不作为源码修改目标。

当前项目里没有发现独立的音乐播放、聊天、TTS、播客模式等业务 JS 文件。当前 `src/App.jsx` 中只有静态 UI 结构和 LiquidGlass 参数；暂停按钮当前没有事件绑定。

## 2. 当前已有 UI 结构地图

### 整体背景场景

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：`<main className="app">` 内的 `<div className="bg-image" />`
- 当前作用：铺满整个窗口，使用 `public/scene.png` 作为暖色场景背景。
- CSS 位置：`.app` 和 `.bg-image`
- 修改注意：
  - 背景图路径使用 `url('/scene.png')`，不要改成相对 `src` 路径。
  - 不要删除 `.bg-image`。
  - 不要用纯色或黑色控制台背景覆盖当前暖色场景。
  - 液态玻璃效果依赖背景图提供折射和反射质感。

### 顶部倾听状态卡片

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：第一个 `<LiquidGlass className="status-card">`
- 当前作用：显示 `YUN IS LISTENING` 和倾听状态文案。
- CSS 位置：`.status-card`、`.sub`、`h1`、`p`
- 当前 LiquidGlass 参数：
  - `displacementScale={86}`
  - `blurAmount={0.08}`
  - `saturation={150}`
  - `aberrationIntensity={2.5}`
  - `elasticity={0.35}`
  - `cornerRadius={40}`
  - `padding="32px 40px"`
- 修改注意：
  - 保持顶部居中，不要挡住主体人物脸部。
  - 不要把文字放到高光伪元素下面。
  - 中文文案当前在源码里显示为乱码；修复文案时只修正文案本身，不要重构结构。
  - 顶部卡片高光强度应弱于底部播放条。

### 底部 Now Playing 播放条

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：第二个 `<LiquidGlass className="player-card">`
- 内部容器：`<div className="player-content">`
- 当前作用：显示当前歌曲封面、播放状态、歌名、歌手、暂停按钮。
- CSS 位置：`.player-card`、`.player-content`、`.cover`、`.track-info`、`button`
- 当前 LiquidGlass 参数：
  - `displacementScale={90}`
  - `blurAmount={0.1}`
  - `saturation={150}`
  - `aberrationIntensity={2.5}`
  - `elasticity={0.35}`
  - `cornerRadius={40}`
  - `padding="28px 34px"`
- 修改注意：
  - 播放条必须保持横向长条。
  - `.player-content` 必须保持 `display: flex`、`align-items: center`。
  - 不要让 LiquidGlass 生成层或 wrapper 把内容挤到卡片外。
  - 不要让播放条被内部内容撑成短块。
  - 不要改按钮事件绑定；当前没有绑定，未来如果有绑定更不能随意替换 DOM。

### 歌曲封面

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：`<div className="cover" />`
- 当前作用：静态渐变封面占位。
- CSS 位置：`.cover`
- 修改注意：
  - 保持固定尺寸或稳定 `flex-basis`。
  - 不要让封面被压缩成 0 宽。
  - 圆角应与玻璃播放条风格协调。

### 歌名与歌手名

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：`<div className="track-info">`
- 当前内容：
  - 小标题：`NOW PLAYING`
  - 歌名：`golden hour`
  - 歌手：`kudasai`
- CSS 位置：`.track-info`、`.sub`、`h2`、`p`
- 修改注意：
  - 保持左对齐。
  - `.track-info` 应保留 `flex: 1`，让按钮自然靠右。
  - 不要用装饰高光遮挡文字。

### 播放 / 暂停按钮

- 对应文件：`src/App.jsx`、`src/App.css`
- DOM / class / id：`<button aria-label="Pause">...</button>`
- 当前作用：静态暂停按钮展示。
- CSS 位置：全局 `button`、`.player-card button`、`.player-content button`
- 修改注意：
  - 当前没有 `onClick`。
  - 未来如果绑定了 play / pause，不要替换按钮节点。
  - 按钮点击区域应保持清晰，不要被伪元素覆盖。
  - 当前按钮文本在源码里显示为乱码；修复时只修正文案或图标，不要重构播放条。

### 可能存在的聊天区域、历史记录区域、模式切换区域

- 对应文件：当前项目未发现。
- DOM / class / id：当前没有发现聊天输入、消息历史、模式切换按钮、TTS 控件或播客模式 DOM。
- 当前作用：不存在。
- 修改注意：
  - 如果未来新增这些区域，必须先定位真实 DOM / class / id。
  - 不要假设已有聊天、历史记录、模式切换逻辑。
  - 不要为了 UI 效果提前创建聊天或 TTS 结构。

## 3. Liquid Glass 视觉目标

本项目的视觉目标是暖色场景上的液态玻璃音乐陪伴界面，不是普通毛玻璃卡片。

必须体现：

- 透明感：卡片能看到背景场景，而不是实心块。
- 背景模糊：可以有 `backdrop-filter: blur(...)`，但不能只有 blur。
- 边缘高光：外边缘要有像玻璃边缘反射的亮线。
- 内部暖色反射：玻璃内应有轻微暖色光带，与 `scene.png` 的木质、夕阳、室内灯光呼应。
- 玻璃厚度感：底部和侧边应有轻微暗部或 inset shadow，表现厚玻璃边。
- 柔和外阴影：卡片应从背景中浮起，但不能像发光按钮。
- 彩边 / 折射感：可以使用轻微 chromatic edge、LiquidGlass 的 `aberrationIntensity`、细边渐变。

必须避免：

- 不是普通灰色半透明卡片。
- 不是纯 `backdrop-filter: blur(...)`。
- 不是纯 `box-shadow`。
- 不能变成塑料感。
- 不能变成黑色控制台 UI。
- 不能用高对比霓虹边框破坏当前温柔、安静、暖色音乐氛围。

## 4. 本项目 Liquid Glass 的 CSS 配方

### 基础玻璃层

基础玻璃层应该使用多层背景，而不是单一半透明灰色：

```css
background:
  linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
  radial-gradient(circle at 20% 10%, rgba(255, 228, 185, 0.18), transparent 34%),
  rgba(255, 255, 255, 0.08);
backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
border: 1px solid var(--glass-border);
border-radius: var(--glass-radius-lg);
box-shadow: var(--glass-shadow);
```

规则：

- `rgba` 透明度要轻，不要把背景盖死。
- `linear-gradient` 用来提供面上的轻微明暗变化。
- `radial-gradient` 用来做暖色反射点。
- `backdrop-filter` 负责模糊和饱和度，不负责全部质感。
- `border-radius` 与 LiquidGlass 的 `cornerRadius` 保持一致。
- `box-shadow` 应柔和、低透明，不要像发光按钮。

### 外边缘高光

外边缘高光可以组合使用：

- `border`：提供基础细边。
- `::before`：覆盖在卡片上方，负责外圈渐变高光。
- `inset shadow`：加强上下边缘和厚度。
- `linear-gradient mask`：只让高光出现在边缘，不覆盖内容。

推荐方式：

```css
.player-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background:
    linear-gradient(135deg,
      rgba(255, 255, 255, 0.85),
      rgba(255, 230, 190, 0.28) 35%,
      rgba(120, 210, 255, 0.18) 62%,
      rgba(255, 255, 255, 0.48));
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
```

注意：

- 高光应该像玻璃边缘反射，不是按钮发光。
- 不要把 `::before` 放在文字之上遮挡内容。
- 若伪元素覆盖点击区域，必须加 `pointer-events: none`。

### 内部反射光

内部反射光适合使用 `::after`：

```css
.player-card::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(circle at 16% 12%, rgba(255, 238, 205, 0.24), transparent 30%),
    linear-gradient(120deg, transparent 10%, rgba(255, 255, 255, 0.16) 32%, transparent 52%),
    radial-gradient(circle at 82% 88%, rgba(255, 190, 120, 0.14), transparent 34%);
  opacity: 0.72;
  filter: blur(0.2px);
}
```

规则：

- `radial-gradient` 表现局部暖色反射。
- `linear-gradient` 表现斜向玻璃反光带。
- `opacity` 要克制。
- `blur` 只用于软化反射，不要让整个卡片糊掉。

### 顶部亮边

顶部亮边应该是细线或局部反射，而不是整张卡片发白：

```css
box-shadow:
  inset 0 1px 1px rgba(255, 255, 255, 0.68),
  inset 0 -1px 2px rgba(70, 35, 10, 0.18),
  0 18px 42px rgba(36, 18, 5, 0.18);
```

规则：

- 顶部亮边用 `inset 0 1px`。
- 不要给整个背景加过高白色透明度。
- 顶部卡片亮边强度应比播放条弱。

### 底部厚度

底部厚度通过暗部渐变和 inset shadow 制造：

```css
background:
  linear-gradient(to bottom, rgba(255, 255, 255, 0.16), rgba(80, 38, 14, 0.08)),
  rgba(255, 255, 255, 0.08);
box-shadow:
  inset 0 1px 1px rgba(255, 255, 255, 0.6),
  inset 0 -10px 24px rgba(70, 33, 10, 0.16),
  0 20px 48px rgba(35, 17, 5, 0.22);
```

规则：

- 底部暗部不要太黑。
- 玻璃厚度要柔和，和暖色背景融合。
- 不要用纯黑大阴影。

## 5. 推荐的 CSS 变量

当前项目尚未定义 CSS 变量。未来如需要系统化玻璃样式，建议在 `src/App.css` 的顶部或 `.app` 中定义，避免和其他全局变量冲突：

```css
.app {
  --glass-bg: rgba(255, 255, 255, 0.08);
  --glass-bg-strong: rgba(255, 255, 255, 0.14);
  --glass-border: rgba(255, 255, 255, 0.38);
  --glass-highlight: rgba(255, 255, 255, 0.78);
  --glass-inner-glow: rgba(255, 207, 145, 0.18);
  --glass-shadow: 0 18px 46px rgba(38, 18, 5, 0.22);
  --glass-radius-lg: 40px;
  --glass-radius-pill: 999px;
  --glass-blur: 18px;
  --glass-saturate: 150%;
}
```

变量用途：

- `--glass-bg`：基础透明玻璃底色。
- `--glass-bg-strong`：更明显的玻璃面色，适合播放条。
- `--glass-border`：基础边框。
- `--glass-highlight`：外边缘高光。
- `--glass-inner-glow`：内部暖色反射。
- `--glass-shadow`：柔和外阴影。
- `--glass-radius-lg`：顶部卡片和圆角播放器。
- `--glass-radius-pill`：胶囊形播放条。
- `--glass-blur`：背景模糊强度。
- `--glass-saturate`：玻璃下背景饱和度。

## 6. 可复用 class 设计

当前项目已有命名较直接：`.status-card`、`.player-card`、`.player-content`、`.cover`、`.track-info`。未来可基于现有 class 逐步增强，不要强行替换为完全不同命名体系。

推荐可复用 class：

- `.liquid-glass`
  - 用途：通用玻璃基类。
  - 适用区域：顶部卡片、播放条、按钮、未来面板。
  - 注意：只能作为附加 class，不应替代现有 `.status-card` / `.player-card`。

- `.liquid-glass--panel`
  - 用途：普通面板型玻璃。
  - 适用区域：顶部倾听状态卡片、未来聊天历史面板。
  - 注意：高光较弱，文字清晰优先。

- `.liquid-glass--pill`
  - 用途：胶囊形长条玻璃。
  - 适用区域：底部 Now Playing 播放条。
  - 注意：宽度应响应式，不能固定到移动端溢出。

- `.liquid-glass--button`
  - 用途：圆形或小型玻璃按钮。
  - 适用区域：播放 / 暂停、next、previous。
  - 注意：必须保留可点击区域和事件绑定。

- `.liquid-glass--player`
  - 用途：播放器专用玻璃增强。
  - 适用区域：`.player-card`。
  - 注意：内部必须横向 flex。

- `.liquid-glass--top-card`
  - 用途：顶部状态卡专用玻璃增强。
  - 适用区域：`.status-card`。
  - 注意：不要挡住主体人物，不要过亮。

基于当前项目的最稳妥做法：

- 保留 `.status-card` 和 `.player-card`。
- 可以在 JSX 中追加 class，例如 `className="player-card liquid-glass liquid-glass--player"`。
- 如果不想改 JSX，可以直接增强 `.player-card` 和 `.status-card`。

## 7. 修改底部 Now Playing 播放条的规则

底部播放条规则：

- 播放条必须是横向长条。
- 位置固定在底部视觉中心。
- 不能被内容撑成短块。
- 宽度应使用 `clamp(...)` 或 `width + max-width`，避免移动端溢出。
- 高度应稳定，例如 `height` 或 `min-height`。
- 内部布局必须保持横向 flex。
- `.player-content` 应保持：
  - `display: flex`
  - `align-items: center`
  - `gap`
  - `width: 100%`
- `.cover` 应保持固定尺寸或稳定 `flex-basis`。
- `.track-info` 应保持 `flex: 1`，让文本区域吃掉剩余空间。
- 按钮应保持固定尺寸并靠右。
- 移动端应降低宽度、间距、封面尺寸或字号，但不能改成竖排，除非用户明确要求。
- 不能影响 play / pause / next / previous 逻辑。
- 不能改 JS 事件绑定，除非用户明确确认。
- 当前项目没有真实播放逻辑和事件绑定；未来若出现，必须先定位再修改。

推荐尺寸策略：

```css
.player-card {
  left: 50%;
  bottom: clamp(20px, 4vh, 36px);
  transform: translateX(-50%);
  width: clamp(320px, 72vw, 860px);
  min-height: 86px;
}
```

移动端策略：

```css
@media (max-width: 640px) {
  .player-card {
    width: calc(100vw - 32px);
    min-height: 76px;
  }

  .player-content {
    gap: 12px;
  }
}
```

## 8. 修改顶部倾听卡片的规则

顶部倾听卡片规则：

- 保持水平居中。
- 保持半透明暖色玻璃感。
- 字体层级清晰：`.sub` 小标题、`h1` 主状态、`p` 辅助描述。
- 不要挡住主体人物脸部。
- 不要大幅增加高度。
- 移动端不能溢出屏幕。
- 顶部卡片的边缘高光应比播放条弱。
- 内部反射可以更轻，避免影响文字阅读。
- 如果修复中文乱码，只修复文本内容，不借机重构 DOM。

推荐尺寸策略：

```css
.status-card {
  top: clamp(32px, 8vh, 80px);
  left: 50%;
  transform: translateX(-50%);
  width: min(520px, calc(100vw - 32px));
}
```

## 9. 禁止事项

以后修改本项目 Liquid Glass UI 时，Codex 绝对不能做：

- 不要新建 React / JSX 组件，除非用户明确要求，并且项目本来就是 React。
- 不要把原生 HTML/CSS/JS 改成 React/Vue/Next。
- 不要删除现有 UI 结构。
- 不要重构音乐播放逻辑。
- 不要重构聊天逻辑。
- 不要重构 TTS 逻辑。
- 不要改 API 接口。
- 不要为了 UI 效果改 `server.js` 业务逻辑。
- 不要用纯黑控制台风格覆盖当前暖色场景。
- 不要把玻璃效果写成普通灰色半透明块。
- 不要只写 `backdrop-filter`，却没有边缘高光和内部反射。
- 不要用固定死的巨大 px 导致移动端崩掉。
- 不要删除 `public/scene.png`。
- 不要修改 `package.json` 来实现纯 UI 微调。
- 不要修改 `node_modules/liquid-glass-react`。
- 不要用伪元素覆盖按钮点击区域。
- 不要把底部播放条改成竖排，除非用户明确要求。

## 10. 修改前检查清单

每次改 Liquid Glass UI 前，必须先检查：

- 当前页面真实加载的文件是哪一个。
- 目标元素的 class / id 是什么。
- 是否已有相同功能的 CSS。
- 是否会影响 JS `querySelector` / `getElementById`。
- 是否会影响移动端。
- 是否会影响点击区域。
- 是否会影响音乐控制按钮。
- 是否需要备份。
- 是否存在真实业务逻辑文件，不能凭感觉假设。
- LiquidGlass 的默认定位、padding、cornerRadius 是否会和外层 wrapper 冲突。
- 伪元素是否会遮住文字或按钮。

## 11. 修改后检查清单

每次改完必须检查：

- 页面是否还能打开。
- 背景是否还在。
- 顶部卡片是否还在。
- 底部播放条是否还是横向长条。
- 歌曲封面是否还显示。
- 歌名歌手是否还显示。
- 播放暂停按钮是否还能点击。
- 聊天输入是否还能用。
- TTS 是否没有被影响。
- 手机端是否没有溢出。
- LiquidGlass 内容是否仍在卡片内，没有被 transform 或 wrapper 挤偏。
- 文字是否清晰，没有被高光遮挡。

当前项目没有发现聊天输入、TTS 或真实播放事件；如果未来加入这些功能，必须按上面清单验证。

## 12. 示例代码

下面示例只作为 Skill 文档参考，不要直接应用到项目。应用前必须重新读取当前 `src/App.jsx` 和 `src/App.css`，确认 DOM 和 class 未变化。

```css
/* Example only. Do not paste blindly. */
.app {
  --glass-bg: rgba(255, 255, 255, 0.08);
  --glass-bg-strong: rgba(255, 255, 255, 0.14);
  --glass-border: rgba(255, 255, 255, 0.38);
  --glass-highlight: rgba(255, 255, 255, 0.78);
  --glass-inner-glow: rgba(255, 207, 145, 0.18);
  --glass-shadow: 0 18px 46px rgba(38, 18, 5, 0.22);
  --glass-radius-pill: 999px;
  --glass-blur: 18px;
  --glass-saturate: 150%;
}

.player-card {
  position: absolute;
  left: 50%;
  bottom: clamp(20px, 4vh, 36px);
  transform: translateX(-50%);
  width: clamp(320px, 72vw, 860px);
  min-height: 86px;
  border-radius: var(--glass-radius-pill);
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
    radial-gradient(circle at 18% 12%, rgba(255, 226, 190, 0.18), transparent 34%),
    var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.62),
    inset 0 -10px 24px rgba(72, 34, 12, 0.16),
    var(--glass-shadow);
}

.player-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background:
    linear-gradient(135deg,
      rgba(255, 255, 255, 0.85),
      rgba(255, 230, 190, 0.3) 34%,
      rgba(120, 210, 255, 0.18) 62%,
      rgba(255, 255, 255, 0.48));
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.player-card::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(circle at 16% 12%, rgba(255, 238, 205, 0.24), transparent 30%),
    linear-gradient(120deg, transparent 10%, rgba(255, 255, 255, 0.16) 32%, transparent 52%),
    radial-gradient(circle at 84% 88%, rgba(255, 190, 120, 0.14), transparent 34%);
  opacity: 0.72;
  filter: blur(0.2px);
}

.player-content {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  align-items: center;
  gap: clamp(12px, 2vw, 18px);
}

.player-content .cover {
  flex: 0 0 76px;
}

.player-content .track-info {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.player-content button {
  flex: 0 0 52px;
  margin-left: auto;
}

@media (max-width: 640px) {
  .player-card {
    width: calc(100vw - 32px);
    min-height: 76px;
  }

  .player-content .cover {
    flex-basis: 60px;
    width: 60px;
    height: 60px;
  }
}
```

## 13. 给未来 Codex 的执行方式

以后如果用户要求修改液态玻璃 UI，必须按这个顺序执行：

1. 先读取本 Skill。
2. 再读取当前真实前端文件。
3. 再定位目标 DOM / class。
4. 再给出最小修改计划。
5. 等用户确认后再改。
6. 只改必要 CSS / HTML / JSX。
7. 不碰业务逻辑。
8. 改完汇报具体改了哪里。

额外要求：

- 如果用户明确说“只读”，绝不写文件。
- 如果用户明确说“不要改 UI”，只输出分析或文档。
- 如果需要备份，先说明要备份哪些文件并等待确认。
- 如果发现当前项目结构和本 Skill 描述不一致，以最新真实文件为准，并在回复中指出差异。
- 如果未来出现音乐播放、聊天、TTS、模式切换等业务代码，UI 修改必须避开这些逻辑，除非用户明确要求修改业务行为。
