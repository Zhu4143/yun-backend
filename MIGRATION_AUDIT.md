# 昀 × Mineradio 迁移审计报告

> 初次审计：2026-07-01；本次修订：2026-07-02  
> 审计范围：`C:\Users\zhudo\yun-liquid-ui-react`（项目 A，以下简称“昀”）与 `D:\Mineradio\新建文件夹\Mineradio\resources\app`（项目 B 的实际源码目录，以下简称“Mineradio”）  
> 本轮边界：仅静态审计；未修改任何现有源码、样式、配置或依赖。本文件是唯一新增文件。

## 结论摘要

最终产品应继续以“昀”的 React/Vite 工程、视觉树和交互面板为唯一前端主体。Mineradio 不适合作为宿主，也不适合整页迁移；它最有价值的部分是 Electron 壳、登录窗口/持久会话、IPC、网易云与 QQ 音源适配、播放失败分类与换源、歌单接口、歌词解析、桌面歌词窗口、节拍离线分析及打包经验。

迁移前必须先完成一次“播放真相收口”：建立唯一 `PlayerCore`，让 UI、歌词、粒子唱片、地形、光场、频谱和 AI 只订阅同一个快照。当前两项目不能直接拼接，因为两边各自持有 `currentSong/currentIdx`、播放布尔值、队列、歌词、音频对象和分析器。

昀的 `useLocalPlayer` 已经具有 active/standby 双 Deck 交叉淡化雏形。修订后的硬约束不是“只能有一个 `HTMLAudioElement`”，而是：只能有一个逻辑 PlayerCore、一套 PlayerState、一个长期运行的主播放 AudioContext，以及一个管理所有声音输出的 AudioEngine。AudioEngine 私有的 activeDeck/standbyDeck 可以在明确的交叉淡化窗口短暂同时发声，但不能形成第二套播放器状态机。

---

## 一、两个项目的技术结构对比

| 维度 | 昀 | Mineradio | 迁移判断 |
|---|---|---|---|
| 前端 | React 19 + Vite 8，ESM；入口 `src/main.jsx` → `src/App.jsx` | 单个约 1.35 MB 的 `public/index.html`，内联 CSS/DOM/脚本 | 保留昀；禁止把 React UI 塞入旧页面 |
| 视觉 | R3F/Three.js、自定义 Shader、粒子唱片、音乐地形、封面取色光场、液态玻璃 | 原生 Three.js/GSAP、粒子舞台、3D 歌单架、多套视觉预设 | 昀为唯一视觉系统；仅借鉴算法 |
| 播放 | `useLocalPlayer.js`，两个 `Audio` 做交叉淡化，一个 Web Audio 分析链 | `public/index.html` 全局单 `audio`，主 AudioContext + 分析器/Gain；另有 UI SFX 与临时解码 context | 先用 adapter 收口状态；后续重构为双 Deck、单 PlayerCore、单主 AudioContext |
| 后端 | ESM `server.js`（约 161 KB），本地扫描、网易云基础搜索/音频/歌词、AI/记忆/TTS | CommonJS `server.js`（约 168 KB），网易云/QQ/播客/歌单/登录/换源/缓存/更新 | 不覆盖任一 server；先抽 provider，再由昀后端编排 |
| 桌面 | 尚无 Electron | Electron 主进程 `desktop/main.js`、preload、overlay preload、多窗口、全局热键 | 选择性移植为昀的 `desktop/` 壳 |
| 数据状态 | React state/ref；曲库充当播放序列 | 大量页面全局变量和 DOM 状态 | PlayerCore store 成为唯一真相 |
| 本地曲库 | 服务端递归扫描 `MUSIC_DIR`，`music-metadata` 解析并提供文件路由/LRC 匹配 | 浏览器拖放/文件对象 URL；更偏单次导入 | 保留昀扫描，补 Electron 文件选择/目录授权 |
| 包结构 | `package.json` 含 React/Three/VRM/liquid-glass/music-metadata | `package.json` v1.1.1，入口 `desktop/main.js`；依赖 `NeteaseCloudMusicApi`、`gsap`、`mpg123-decoder` | 依赖逐项引入，禁止覆盖 package.json |

### 目录结构（排除 `node_modules`、构建产物和大批媒体/LRC 数据）

```text
yun-liquid-ui-react/
├─ package.json / vite.config.js / index.html / server.js
├─ server/data/                 # 昀设置、长期记忆、曲库与手工标签
├─ public/
│  ├─ animations/ models/       # VRMA、VRM/GLB
│  ├─ user_memory.json / scene.png / icons.svg
├─ src/
│  ├─ main.jsx / index.css / App.jsx / App.css
│  ├─ api/                      # yun、tts、memory、companion、smartMusic、netease
│  ├─ hooks/                    # useLocalPlayer、useYunChat/Memory/Voice
│  ├─ services/                 # OpticalField、LyricFlow、chatIntent、audioDucking
│  └─ components/               # 粒子唱片、地形、光场、歌词、雾、VRM、语音玻璃等
├─ 歌词/VipSongsDownload/       # 大量本地 LRC
└─ liquid-glass-settings-demo/  # 独立参考 demo，不是生产入口

Mineradio/resources/app/
├─ package.json / server.js / dj-analyzer.js
├─ desktop/
│  ├─ main.js
│  ├─ preload.js
│  └─ overlay-preload.js
└─ public/
   ├─ index.html                # 主界面、状态、播放和视觉逻辑集中于此
   ├─ desktop-lyrics.html
   ├─ wallpaper.html
   └─ vendor/                   # Three.js、GSAP、music-tempo 等
```

### Mineradio 源码来源判定

结论：`D:\Mineradio\新建文件夹\Mineradio\resources\app` 是 **Electron 安装版中以非 asar 形式展开的应用发行载荷**，不是原始 Git 工作树，也不属于“从 app.asar 手工解包”的目录。

判断依据：

1. 上级目录同时存在 `Mineradio.exe`、`resources.pak`、Electron/Chromium DLL、`LICENSE.electron.txt`、`LICENSES.chromium.html` 和卸载程序，这是典型 Electron Windows 安装目录。
2. 应用代码位于标准的 `resources/app`；目录内没有 `.git`、源码历史、根级 `README.md`、`LICENSE`、`NOTICE.md`、`package-lock.json` 和开发脚本集合，`git rev-parse` 明确返回“not a git repository”。
3. 本地发行 `package.json` 只有运行依赖，没有原仓库的 `scripts`、`devDependencies` 和完整 `build` 配置。
4. [原始 Git 仓库的 package.json](https://github.com/XxHuberrr/Mineradio/blob/main/package.json) 明确设置 `build.asar: false`，并将 `desktop/**/*`、`public/**/*`、`server.js`、`dj-analyzer.js` 等直接打入发行包。因此这里是 electron-builder 复制出的 unpacked app payload，不是 asar 解包产物。
5. 用户截图对应 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) 的 `v1.1.0` Release；Release 指向 commit `9183c26`，并说明安装包由可信源码重新构建。

**后续硬要求：**迁移审计与取材必须改用原始 Git 仓库 `https://github.com/XxHuberrr/Mineradio.git`，固定明确 tag/commit（初始对照可用 `v1.1.0` / `9183c26`，实施前再确认目标版本）。不得将安装目录作为长期开发基础，也不得从安装目录直接复制代码后失去 commit、许可证和变更历史。当前发行载荷只用于交叉验证实际安装行为。

---

## 二、昀现有视觉和功能资产清单

以下均应视为迁移保护区，不应重写、删除或被 Mineradio UI 替代：

1. `App.jsx` + `App.css` 中统一液态玻璃语言、外层光学体、面板层级、按钮/控制栏材质和响应式布局。
2. `services/OpticalFieldController.js`：共享光学场、指针扰动和 CSS 变量发布。
3. `ParticleVinylBackground.jsx/.css`：粒子唱片、换歌旋转/解构/聚合、屏幕空间光学体、音频驱动效果。
4. `SonicTopographyBackground.jsx` + `SonicMapShaderMaterial.js`：唱片外围地形、多频段 uniform、脉冲/流星/粒子反馈。
5. `FlowFieldBackground.jsx`：气体/流场及过渡。
6. `useSongTheme()`（`App.jsx`）：封面取色并向全局 CSS 主题变量映射。
7. `FloatingLyrics.jsx/.css`、`LyricForegroundFog.jsx`、`LyricFlowController.js`：同步歌词、层级滚动、前景雾。
8. `FloatingWaveBars`、`HologramParticles`、`YunHologramAvatar`、`YunVrmModel`、`VictoryGestureWake`、`VoicePickupGlass` 等交互/角色视觉。
9. 曲库、记忆、语音、播放模式、聊天等现有玻璃面板及其开合/形变动画。
10. `useYunChat`、`useYunMemory`、`useYunVoice`、`chatIntentRouter` 及 server 中的陪伴人格、长期记忆、TTS、歌曲反应和音乐意图控制。
11. 昀本地曲库扫描、metadata、歌词匹配、AI 标签/歌词理解缓存。

玻璃系统已有清晰的共享光学体原则：外层面板负责折射，嵌套按钮主要作为表面细节；这一架构应继续维持，不能引入 Mineradio 的另一套 glass CSS 变量和 SVG/滤镜体系。

---

## 三、Mineradio 值得迁移的能力模块

> 本节判断技术价值，不等同于授予复制许可。具体代码的直接复用必须经过第十六章 GPL-3.0、第三方许可证与平台条款闸门；若昀不接受 GPL-3.0，则 Mineradio 自有实现应参考行为后独立重写。

### 高价值，可迁移能力但必须适配

- Electron 生命周期、无边框窗口控制、开发/生产 URL 加载、退出与重启需求：`desktop/main.js`；建议重写最小安全实现。
- 安全 preload 桥：窗口控制、登录、全局热键、导入导出、桌面歌词；应改名为 `window.yunDesktop` 并缩小权限。
- 网易云/QQ 官方登录子窗口、持久 partition、cookie 提取与清理。
- 网易云与 QQ 搜索、歌曲 URL、歌词、用户歌单、歌单曲目接口。
- 播放限制分类、音质降级、同名同歌手跨源 fallback。应迁成纯服务，不迁 DOM toast/弹窗。
- 歌词解析：LRC 行级、YRC 逐字、持续时间推断、无歌词 fallback。
- `dj-analyzer.js` 与离线 beat map 思路；输出标准化 audio features，不直接控制昀视觉。
- 桌面歌词透明置顶窗口、拖动、锁定、点击穿透的 IPC 机制；渲染样式需改为昀视觉。
- 文件导入/导出对话框和全局热键注册机制。
- 更新与打包逻辑可在后期评估；更新仓库配置不能照搬。

### 仅可借鉴算法，不宜直接复制

- `public/index.html` 中队列操作、换源编排和播放失败恢复。
- beat map 缓存/预取策略。
- 本地文件拖放及 Object URL 生命周期管理。
- 后台低占用、可见性切换与媒体会话策略。

---

## 四、Mineradio 不应该迁移的界面或视觉模块

- `public/index.html` 的 DOM 页面结构、播放器控制栏、搜索框、歌单面板、登录 modal、视觉控制台。
- 其全局 glass CSS、颜色变量、滤镜、面板层级和响应式规则。
- 旧粒子舞台、封面舞台、3D 歌单架、视觉 preset UI、天气电台首页、壁纸页视觉。
- Mineradio 的播放按钮、进度条、音量浮层、歌词主面板和队列 UI。
- 直接依赖 DOM id 的函数、inline onclick、全局变量及 toast/modal 控制。
- Mineradio 的产品名、图标、更新仓库、安装器标识与用户数据目录。

原因不是这些模块无价值，而是它们与昀的 React 组件树、光学场、z-index、事件模型和视觉叙事互斥，迁移成本高于重接数据适配层。

---

## 五、两个项目播放状态的冲突位置

### 昀

- `src/hooks/useLocalPlayer.js`：`currentSong`、`isPlaying`、`currentTime`、`duration`、`playbackMode`；`playlistRef` 实际兼任播放顺序。
- `src/App.jsx`：将上述状态分发给按钮、进度、歌词、背景、AI；另有 `displayedSong` 和场景封面列表，但后者是显示派生值，不应升级为第二播放真相。
- `useYunChat`/`chatIntentRouter` 接收一个临时 player 对象，方法名仍是 `playSong/pausePlayback/togglePlayPause/seekTo`。

### Mineradio

- `public/index.html:2677`：`audio/audioCtx/source/analyser/beatAnalyser/gainNode`。
- `public/index.html:2693`：`playlist/playQueue/currentIdx/playing`。
- `playQueueAt()` 同时承担选曲、URL 获取、换源、封面、beat map、播放、歌词和 UI 刷新，耦合过重。
- `playing` 与 `audio.paused` 并存；`syncPlaybackStateFromAudioEvent()` 负责修正，存在双真相窗口。
- 歌词内部另有 original/custom/stage/desktop 状态。

### 直接合并会产生的错误

1. React `currentSong` 与 Mineradio `playQueue[currentIdx]` 不一致。
2. 两个播放按钮分别操作不同 audio。
3. 两套 ended/next 处理重复跳两首。
4. 歌词 token 与 React currentTrack 竞态，旧请求覆盖新歌。
5. 视觉读取昀 analyser，而实际声音来自 Mineradio audio，导致频谱失真或静止。
6. AI 操作昀 player，Electron 全局快捷键却操作 Mineradio 全局函数。

结论：Mineradio 的页面播放状态不能进入昀；只能将其 provider、解析器和 Electron 能力置于 PlayerCore 下游。

---

## 六、所有 audio 元素和 AudioContext 的位置

### 昀

| 位置 | 类型 | 用途 | 结论 |
|---|---|---|---|
| `src/hooks/useLocalPlayer.js:135`，`ensureActiveAudio()` | `new Audio()` / `audioRef` | 当前 active Deck | 保留为 AudioEngine 私有 Deck 候选 |
| `src/hooks/useLocalPlayer.js:144`，`ensureStandbyAudio()` | `new Audio()` / `standbyAudioRef` | standby Deck/交叉淡化 | 允许保留，但必须接入同一主 context 与独立 GainNode |
| `src/hooks/useLocalPlayer.js:198` | `new AudioContext()` | 音乐分析 | 改由 AudioEngine 唯一创建 |
| `src/hooks/useLocalPlayer.js:212-215` | analyser + media source | 实时频谱 | 保留能力，移动所有权 |
| `src/hooks/useYunVoice.js:124/190` | `new Audio()` | TTS 语音 | 不是音乐源；需明确独立 speech channel |
| `src/components/VoicePickupGlass.jsx:138-140` | `new AudioContext()` + analyser | 麦克风拾取可视化 | 属 capture context，不得冒充主播放 context；可后续统一生命周期 |

### Mineradio

| 位置 | 类型 | 用途 | 结论 |
|---|---|---|---|
| `public/index.html:18502`（另见 20034） | 懒创建 `new Audio()` | 主音乐/本地文件复用同一变量 | 不迁元素，仅迁逻辑 |
| `public/index.html:17730` | 主 `AudioContext` | media source、analyser、beat analyser、gain | 算法适配到昀 AudioEngine |
| `public/index.html:17758` | `uiSfxCtx` | UI 选择音效 | 不迁，或以后挂到同一主 context |
| `public/index.html:10409,11591` | 临时 `AudioContext` | 离线/预取解码 fallback | 不应成为常驻 context；优先 worker/OfflineAudioContext |
| `public/index.html:10406,11588` | `OfflineAudioContext` | beat 分析 | 可作为非实时离线分析资源 |
| `public/index.html:25969` | splash AudioContext | 启动音效 | 不迁 |

“一个主 AudioContext”定义为：实时声音输出图只有一个长期存在、最终连接扬声器的 context，并由 AudioEngine 独占创建和销毁。`OfflineAudioContext` 是离线计算且不接扬声器；麦克风 capture 若受浏览器限制必须独立，应明确标为输入分析 context，并纳入 AudioEngine 生命周期管理。TTS、UI SFX 和音乐 Deck 的可听输出都必须经 AudioEngine 编排，不得各自创建可独立操作的输出状态机。

### 修订后的 Audio 硬约束

1. 全项目只有一个逻辑 PlayerCore 和一套 PlayerState。
2. `currentTrack/isPlaying/queue/queueIndex` 各自只有一个真相来源。
3. 只有一个长期运行的主播放 AudioContext；所有可听输出由同一 AudioEngine 管理。
4. 禁止出现两套可独立操作的播放器状态机。
5. AudioEngine 内部允许 `activeDeck`、`standbyDeck` 两个 `HTMLAudioElement`。
6. 两个 Deck 必须连接同一 AudioContext：`MediaElementSource(A/B) → GainNode(A/B) → shared analysis/master gain → destination`。
7. 正常播放只有 activeDeck 的 gain 可大于静音阈值；standbyDeck 必须为 0。
8. 只有带 token、起止时间和最大时长保护的交叉淡化事务内，两 Deck 才可短暂同时发声；取消、失败、暂停、seek 和快速连切必须把非 active Deck 立即归零。
9. Deck A/B 是 AudioEngine 私有实现；React、AI、歌词、唱片、快捷键只能调用 PlayerCore，不能持有 Deck、MediaElementSource 或 GainNode。
10. Deck 切换只改变内部角色，不产生第二份 `currentTrack/isPlaying/time/duration` UI 状态。

### 两种实现方案比较

| 维度 | 方案 A：单 Audio 淡出→换源→淡入 | 方案 B：双 Deck + 单 PlayerCore + 单 AudioContext |
|---|---|---|
| 听感 | 中间必有换源/缓冲间隙；网络源更明显 | 下一首可预载，支持 equal-power 真正连续交叉淡化 |
| 与昀现状 | 需要放弃当前双源交叉区间 | 与 `crossfadeToSong()` 的现有意图一致 |
| 视觉/颜色连续性 | 可做视觉连续，但声音可能在粒子解构时断开 | 音色、封面色和粒子过渡可共享同一 progress 时间轴 |
| 状态复杂度 | 较低 | 较高，但复杂度被封装在 AudioEngine 内，不泄漏到 UI |
| CPU/内存 | 最低；通常一个解码流 | 交叉窗口短时两个解码流、两个 MediaElementSource/Gain；正常时 standby 静音/暂停，长期开销接近单 Deck |
| 网络/缓存 | 换源时才加载 | standby 可预加载；会短时增加带宽与解码内存 |
| 风险 | gap、切歌失败后恢复、视觉与听觉脱节 | race、双响泄漏、CORS、快速连切、ended 归属和 Deck 角色切换 |

**推荐方案 B。**昀已经以换歌粒子解构/重聚、封面颜色连续过渡和无缝听感为产品特征；方案 B 能保留这些特征，同时新的单 PlayerCore/单状态约束可消除“双播放器”风险。方案 A 作为低性能设备、交叉淡化失败或 provider 不支持预载时的可配置 fallback。

方案 B 的独立实施步骤：

1. 在状态收口完成后建立 `AudioEngine`，一次性创建主 AudioContext、master gain、共享 analyser。
2. 创建私有 activeDeck/standbyDeck，并各创建一个 MediaElementSource 和 Deck GainNode；media element 自身 `volume` 固定为 1，响度只由 GainNode 控制。
3. 定义带 token 的 crossfade transaction；预载 standby，确认可播后用同一时钟调度 equal-power gain curve。
4. 在逻辑切换点只提交一次 PlayerState：更新 currentTrack/queueIndex，并发布 `trackChangeProgress`；不要发布 Deck 状态。
5. 统一处理 play/pause/seek/volume/ended/error/取消/快速连切；任何异常都执行“一个 gain 有效、另一个 gain=0”的安全收尾。
6. 将 TTS ducking、UI SFX（若保留）和输出静音接到 AudioEngine master graph；视觉只读取共享 analyser/audio features。
7. 用自动断言监控：非 crossfade 时两个 Deck 不得同时 audible；主 AudioContext 实例数必须为 1。

---

## 七、歌词、队列、当前歌曲、音频分析的数据流

### 昀当前数据流

```text
server 本地扫描 / 网易云搜索
  → libraryTracks
  → useLocalPlayer(playlistRef)
  → currentSong + time + duration + isPlaying
     ├→ Player controls / progress
     ├→ FloatingLyrics → 本地或网易云歌词请求 → active line
     ├→ ParticleVinylBackground(trackKey, cover, frequency reader)
     ├→ SonicTopography shader uniforms
     ├→ useSongTheme → CSS 主题变量/全局光场
     └→ useYunChat → chatIntentRouter → player methods
```

问题：歌词由组件自行 fetch，因此 `lyrics` 还不是统一状态；队列不是显式实体；音量未暴露为 React 状态/API；`trackChangeProgress` 留在视觉内部；`dominantColor` 以 CSS style 派生，未进入播放器快照。

### Mineradio 当前数据流

```text
搜索/歌单/本地拖放
  → playlist 或 playQueue + currentIdx
  → playQueueAt
     ├→ provider URL + quality/fallback
     ├→ audio.src / play
     ├→ fetchLyric → original/custom lyric state → stage/desktop lyrics
     ├→ cover/颜色/视觉准备
     └→ beat cache / OfflineAudioContext / realtime analyser
```

优点是能力完整；缺点是 `playQueueAt` 是巨型事务并直接操纵 DOM。迁移时要拆成 `TrackResolver`、`LyricsService`、`QueueManager`、`AudioEngine`、`AudioFeatureService`，再由 PlayerCore 编排。

---

## 八、全局 CSS、事件监听器和快捷键冲突

### CSS

- 昀的 `App.css` 已定义 `--glass-*`、`--song-primary/secondary`、歌词色、全局光学层、固定面板和高 z-index overlay。
- Mineradio `index.html` 也定义全局主题/玻璃、`body/html`、固定浮层、modal、控制栏及大量 id selector。
- 两套 CSS 同载会造成变量覆盖、滤镜重复、GPU 合成层膨胀、pointer-events 与 z-index 冲突。禁止导入 Mineradio 主 CSS。
- 昀已有“嵌套控件不重复创建折射镜片”的性能规则；Mineradio glass selector 批量覆盖会破坏此规则。

### 事件与快捷键

- 昀：粒子唱片注册全局 `keydown/pointermove/pointerdown/up/cancel/wheel/blur`；OpticalField 注册 pointer/blur；语音唤醒注册一次性 pointer/keydown；进度条处理左右键。
- Mineradio：document 级 keydown、拖放、搜索输入键盘、全局快捷键、Electron `before-input-event` 均可能截获 Space、方向键、F11/Esc、媒体键。
- 迁移后必须有单一 `ShortcutManager`：输入框/contenteditable 时不触发播放快捷键；Electron global shortcut 只派发语义 action 到 PlayerCore；不得直接调用 DOM 函数。
- 所有全局 listener 必须返回 cleanup；Electron renderer 重载时解除订阅；StrictMode 下避免重复注册。

---

## 九、Electron 接入昀项目的可行方案

可行，且不需要改变 React/Vite 技术栈。

推荐新增独立 Electron 层：开发时启动现有 Vite 与昀 server，Electron 加载 Vite URL；生产时 Electron 启动/连接昀后端并加载打包后的 renderer。不要 `require` Mineradio 原 server 作为第二后端长期运行。

关键设计：

1. 主窗口仅承载昀构建产物。
2. `contextIsolation: true`、`nodeIntegration: false`；preload 只暴露白名单命令。
3. 登录窗口和 cookie partition 可移植，但 IPC 命名改为 `yun:*`。
4. server 端口由 Electron 分配，通过环境变量或启动返回值传递；开发/生产 URL 分离。
5. 本地文件/目录选择由主进程 dialog 完成，返回受控路径给昀后端扫描。
6. 桌面歌词作为后期可选窗口，数据来自 PlayerCore 快照，不再自行判断当前歌。
7. 不直接复制 Mineradio 安装器配置、更新仓库或 userData 名称。

---

## 十、建议的统一 PlayerCore 接口

```ts
interface PlayerCore {
  play(): Promise<Result>
  pause(): Promise<Result>
  togglePlay(): Promise<Result>
  next(): Promise<Result>
  previous(): Promise<Result>
  seek(seconds: number): void
  setVolume(value: number): void
  playTrack(track: Track, options?: PlayOptions): Promise<Result>
  search(keyword: string, options?: SearchOptions): Promise<Track[]>
  getQueue(): Track[]
  setQueue(tracks: Track[], options?: QueueOptions): void
  getLyrics(track?: Track): Promise<Lyrics>
  getAudioFeatures(): AudioFeatures
  getState(): PlayerState
  subscribe(listener: (state: PlayerState) => void): () => void
  destroy(): void
}
```

统一状态：

```ts
interface PlayerState {
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  queue: Track[]
  queueIndex: number
  lyrics: Lyrics
  dominantColor: ColorTheme | null
  audioFeatures: AudioFeatures
  trackChangeProgress: number // 0..1；由切歌事务发布，视觉只消费
  playbackMode: PlaybackMode
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'
  error: PlayerError | null
}
```

补充约束：

- `currentTrack` 只能由 PlayerCore 改写。
- `isPlaying` 以 media element 事件为准，不由按钮乐观维护第二份。
- queue 的顺序和 index 必须原子更新。
- 歌词请求携带 track key/abort signal，旧请求不得覆盖新歌。
- `audioFeatures` 是稳定对象或环形缓冲快照，高频数据不走 React 每帧 setState；Three.js 通过 reader/ref 读取。
- `trackChangeProgress` 是逻辑切歌阶段；粒子组件可对它做视觉 easing，但不能反向决定播放状态。
- `dominantColor` 建议由 CoverColorService 生成并写入同一快照，再映射到 CSS variables。

---

## 十一、建议新增的适配层和目录结构

```text
src/player/
├─ PlayerCore.js
├─ playerStore.js
├─ types.js
├─ AudioEngine.js              # 私有双 Deck + 唯一长期主播放 AudioContext/输出图
├─ QueueManager.js
├─ TrackResolver.js
├─ LyricsService.js
├─ AudioFeatureService.js
├─ CoverColorService.js
├─ ShortcutManager.js
├─ providers/
│  ├─ localProvider.js
│  ├─ neteaseProvider.js
│  └─ qqProvider.js
├─ adapters/
│  ├─ yunLegacyPlayerAdapter.js
│  └─ electronDesktopAdapter.js
└─ react/
   ├─ PlayerProvider.jsx
   └─ usePlayer.js

desktop/
├─ main.cjs
├─ preload.cjs
├─ ipc/
│  ├─ windowIpc.cjs
│  ├─ loginIpc.cjs
│  ├─ libraryIpc.cjs
│  └─ shortcutIpc.cjs
└─ windows/
   ├─ loginWindows.cjs
   └─ desktopLyricsWindow.cjs

server/providers/
├─ neteaseProvider.js
├─ qqProvider.js
└─ providerErrors.js
```

目录是建议，不代表下一轮必须一次建完；应按阶段最小增量添加。

---

## 十二、分阶段迁移步骤

### 阶段 0：基线冻结与行为清单

记录昀现有播放、切歌、粒子聚合、颜色、歌词、聊天/TTS、曲库扫描行为；保存截图/录屏和关键响应样例。不接 Mineradio。

### 阶段 1：昀内部 PlayerCore 收口

1. 创建 PlayerCore 接口和唯一 PlayerState 形状。
2. 创建 `yunLegacyPlayerAdapter`。
3. 将现有 `useLocalPlayer` 包装进 PlayerCore，不改其内部 Audio/交叉淡化实现。
4. 保持当前听觉效果、换歌视觉、颜色与歌词表现不变。
5. 逐步让按钮、唱片、进度和歌词读取统一快照；旧 hook 状态只允许由 adapter 暂时桥接。
6. 以状态收口验收为结束条件，不在本阶段重构 AudioEngine。

### 阶段 2：视觉与 AI 全部改订阅统一快照

歌词、唱片、地形、光场、封面色、AI/聊天从 PlayerCore 读取；暴露稳定 audio feature reader 和 track change progress。完成后不再允许组件自行维护 currentSong/playing/lyrics 真相。

### 阶段 3：AudioEngine 独立重构

使用独立 Git 提交把 legacy 双 Audio 交叉淡化重构为“私有 activeDeck/standbyDeck + 单长期主 AudioContext + Deck GainNode”。本阶段不得同时接 QQ、Electron 或 provider；方案 A 仅作为 fallback。完成后删除 adapter 对 Deck 的任何直接暴露。

### 阶段 4：抽取 Mineradio 在线 provider

先接搜索、URL、歌词；再接登录、歌单和跨源 fallback。每个 provider 返回统一 Track/Lyrics/ProviderError，不带 Mineradio DOM/UI。

### 阶段 5：本地曲库与队列增强

保留昀 server 扫描，增加目录选择、增量扫描、持久队列和导入；复用 Mineradio 文件对话框思想，不迁其临时 UI。

### 阶段 6：音频特征与 beat map

将 Mineradio `dj-analyzer`/离线分析接入 AudioFeatureService；实时分析仍取唯一 AudioEngine；缓存按 track/provider/quality/version 键控。

### 阶段 7：Electron 壳

接主窗口、preload、窗口控制、登录窗口、文件对话框和快捷键；先开发运行，再生产打包。Renderer 始终是昀。

### 阶段 8：桌面歌词、更新与发布能力

桌面歌词订阅统一状态；最后再接安装、更新和签名，避免早期被打包问题拖住核心迁移。

---

## 十三、每个阶段预计修改的文件

| 阶段 | 预计新增/修改 |
|---|---|
| 0 | 新增测试记录/快照；不改运行代码 |
| 1 | 新增 PlayerCore、playerStore、`yunLegacyPlayerAdapter`；增量修改 `src/App.jsx` 和消费者；`useLocalPlayer.js` 仅为适配所需的小改，不删除交叉淡化 |
| 2 | 修改 `FloatingLyrics.jsx`、`ParticleVinylBackground.jsx`、`SonicTopographyBackground.jsx`、`FlowFieldBackground.jsx`、`App.jsx`、`useYunChat.js`；CSS 原则上只增接口变量，不重写 |
| 3 | 独立新增/重构 `AudioEngine.js`，修改 legacy adapter 与 `useLocalPlayer.js` 的音频所有权；独立提交，不夹带 provider/UI 功能 |
| 4 | 新增 `server/providers/*`、`src/player/providers/*`；增量修改现有 `server.js`、`src/api/neteaseApi.js`；新增 QQ API 文件 |
| 5 | 修改 `server.js`、`yunApi.js`、PlayerCore/QueueManager；曲库面板只改数据绑定 |
| 6 | 新增 AudioFeatureService/worker/cache；修改 AudioEngine 和视觉 reader；`dj-analyzer` 依许可证决策参考重写或按 GPL 合规复用 |
| 7 | 新增 `desktop/*`；增量修改 `package.json` scripts/dependencies、Vite 配置；不覆盖原文件 |
| 8 | 新增桌面歌词 renderer/window、打包配置、签名/更新配置；PlayerCore 只增加订阅桥 |

---

## 十四、每个阶段的验收标准

| 阶段 | 必须通过 |
|---|---|
| 0 | 所有 10 项昀资产有可对比基线；本地/在线各有测试曲目 |
| 1 | PlayerCore/PlayerState 各只有一套；旧交叉淡化听感与视觉无回归；按钮/唱片/进度/歌词逐项改读统一快照；不得提前删除 standby Audio |
| 2 | 唱片、地形、歌词、光场、AI 显示同一 track key；快速连切 10 次无旧歌词/旧颜色回写；换歌动画不退化 |
| 3 | 只有一个长期主播放 AudioContext；双 Deck 均接同一 context/GainNode；非 crossfade 时只有一个有效 gain；快速连切、pause、seek、error 后无双响；CPU 对比基线可接受 |
| 4 | 网易云/QQ 搜索、播放 URL、歌词和错误分类通过；fallback 不产生第二播放状态；登录 cookie 不暴露给 renderer |
| 5 | 本地目录可重扫、去重、持久化；队列重启恢复；删除/移动文件时给出可恢复错误 |
| 6 | 实时 features 与实际声音同步；暂停后能量归零/平滑衰减；离线分析不创建常驻可听 context；CPU/GPU 无明显回退 |
| 7 | 开发/生产均能启动；窗口控制、登录、文件选择、快捷键正常；刷新/关闭无僵尸 server 与重复 listener |
| 8 | 桌面歌词与主歌词同 track/time；安装包在干净机器运行；更新源、应用 ID、userData 均属于昀 |

跨阶段不变量：`App.jsx`、`App.css`、`package.json`、`server.js` 只能增量修改并逐次审查；任何阶段不得以 Mineradio 页面替换昀 UI。

---

## 十五、风险和回滚方案

| 风险 | 表现 | 缓解 | 回滚点 |
|---|---|---|---|
| 双 Deck 状态泄漏 | UI 出现两个 currentTrack/playing 或异常双响 | Deck 完全私有；统一 token/安全收尾；非 crossfade 同响断言 | feature flag 回退 legacy adapter；方案 A 作为音频 fallback |
| AudioContext 重建/CORS | analyser 静音或媒体不可播 | URL 代理统一 CORS；AudioEngine 只初始化一次 | 回退为 media element 直出并暂关分析 |
| provider 法务/稳定性 | API 变更、会员/版权限制 | 明确 provider error；不绕过权限；可禁用单 provider | 配置开关关闭 QQ/网易云适配 |
| 旧歌词竞态 | 快切后显示上一首 | AbortController + track key 校验 | 回退到本地歌词 provider |
| 高频 React 更新 | 卡顿、粒子掉帧 | features 用 ref/typed array，低频状态才 publish | 关闭离线/高级 feature 层 |
| Electron 安全 | renderer 获得过大文件/系统权限 | preload 白名单、路径校验、context isolation | 保持 Web 版可独立运行 |
| server 合并过大 | AI/TTS/音乐接口互相回归 | provider 文件独立，server 仅路由编排 | 每个 provider 独立开关/回退原路由 |
| CSS/视觉污染 | 白线、重复折射、层级错乱 | 不导入 Mineradio CSS；只注册外层光学体 | 删除当阶段新增 selector/变量 |
| 全局快捷键重复 | 一次按键触发两次 | 单 ShortcutManager + action 去重 | 禁用 Electron global shortcut |
| 打包路径差异 | 本地扫描/模型/动画找不到 | 所有资源路径区分 dev/prod，打包前 manifest 审核 | Web 版与 server 独立启动作为保底 |

每一阶段应使用独立提交和功能开关；只有验收通过才进入下一阶段。不要做跨阶段“大合并提交”。

---

## 十六、许可证、版权与可迁移边界

> 本节是工程风险审计，不构成法律意见。正式公开分发前应由项目所有者确认“昀”的目标许可证，并在存在商业化、闭源分发或平台接口争议时咨询专业法律意见。

### 许可证证据

- 原仓库根目录存在 [GPL-3.0 LICENSE](https://github.com/XxHuberrr/Mineradio/blob/main/LICENSE)，README 明确写明 `Copyright (C) 2026 XxHuberrr` 与 GPL-3.0。
- 原仓库 [NOTICE.md](https://github.com/XxHuberrr/Mineradio/blob/main/NOTICE.md) 列出 Electron、Three.js、GSAP、music-tempo、NeteaseCloudMusicApi、mpg123-decoder，并声明 Mineradio 名称、MR Logo、界面视觉设计、粒子视觉体验和电影镜头产品表达属于作者原创。
- 原始与发行 `package.json` 均 **没有 `license` 字段**；许可依据来自根级 LICENSE/README。缺少 package 字段不等于没有许可证。
- 本地 `resources/app` 没有随带项目 `LICENSE`/`NOTICE.md`；安装根目录的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html` 只覆盖 Electron/Chromium，不替代 Mineradio 的 GPL-3.0 文件。这也是后续必须从 Git 仓库取材并维护 NOTICE 的原因。
- 本地直接依赖审计：`mpg123-decoder`、`NeteaseCloudMusicApi`、`music-metadata`、Express、Axios 标注 MIT；GSAP 3.15.0 标注其 Standard “no charge” license，不能笼统当作 MIT。Electron、Three.js、music-tempo 仍需在锁定原仓库 commit 后逐项保存版本与许可证文本。

### 模块级迁移标记

| 项目 | 标记 | 结论与条件 |
|---|---|---|
| Mineradio 自有源码整体 | **需要保留许可证和声明** | GPL-3.0。直接复制或改编并对外分发，通常会触发 GPL 对组合/派生作品的源码与同许可证义务；若昀不准备 GPL-3.0 开源，应避免直接复制并先取得作者另行授权 |
| `package.json`/构建思路 | **只能参考后重写** | scripts/build 配置本身简单，但产品名、appId、图标、publish owner 必须改成昀；依赖各守其许可证 |
| Logo、Mineradio 名称、界面截图、原创视觉资产 | **不建议迁移** | README/NOTICE 明确保留品牌与原创视觉表达；本项目也不需要这些资产 |
| 网易云/QQ 音源适配代码（`server.js`） | **只能参考后重写** | 同时受 Mineradio GPL 与平台服务条款/版权/会员规则约束；应以 provider 接口重新实现，不绕过付费、会员、DRM 或地域限制 |
| 登录与 cookie 代码（`desktop/main.js`） | **只能参考后重写** | 机制可借鉴，但原实现受 GPL；还涉及账号凭据、session partition、最小权限、隐私告知和安全存储，不能照搬默认常量/IPC |
| 歌词解析（`parseLyricText/parseYrcText`） | **只能参考后重写** | 算法思路通用，具体实现受 GPL；歌词文本本身另有内容版权，不得随应用重新分发未经授权歌词库 |
| `dj-analyzer.js` | **尚未确认** | 当前视为 Mineradio GPL 自有源码；若直接复用必须 GPL 合规。实施前还要追踪其算法/代码是否来自第三方及文件头；保守路线是依据公开 DSP 原理独立重写并做 clean-room 记录 |
| Electron 壳代码（`desktop/main.js/preload.js`） | **只能参考后重写** | Electron 库本身可按其许可证使用，但 Mineradio 壳实现受 GPL；昀应新建最小安全壳，只借鉴窗口/IPC需求 |
| `mpg123-decoder`、`NeteaseCloudMusicApi` 等 MIT 依赖 | **需要保留许可证和声明** | 可以按各自许可证直接依赖或复用，分发时保留版权与 MIT 文本；版本以新锁文件为准 |
| GSAP | **需要保留许可证和声明** | 可否免费/商业使用取决于 GSAP 当前 Standard License 和具体使用方式；实施前须阅读并保存对应版本条款，不得按 MIT 处理 |
| Electron/Three.js/music-tempo | **需要保留许可证和声明** | 原则上可直接使用库，但必须按锁定版本核验许可证、NOTICE 与分发要求；不要复制 Mineradio 的 vendor 文件代替正常依赖管理 |
| MR 粒子/电影镜头/3D 歌单视觉 | **不建议迁移** | 除 GPL 代码外还有作者明确的原创视觉表达声明，并与昀现有视觉体系冲突 |

“可以直接复用”在本审计中仅适用于许可证已经独立确认且与昀目标分发方式兼容的第三方库；对 Mineradio 自有代码，未取得额外授权前不作无条件“可以直接复用”判断。

### 实施前许可证闸门

1. 克隆原仓库并固定 commit/tag，保存 `LICENSE`、`NOTICE.md`、`package-lock.json`。
2. 生成 production dependency license 清单，逐项检查 SPDX、特殊条款和 NOTICE。
3. 决定昀是否接受 GPL-3.0。若不接受，Mineradio 自有实现一律按“需求/行为参考后独立重写”处理，并保留 clean-room 设计记录。
4. 对网易云/QQ provider 做平台条款与隐私复核；cookie 不写日志、不发往非必要服务、不提交仓库。
5. 发布包中加入第三方许可证页面与文件；品牌、Logo、截图和歌词内容另行审查。

---

## 十七、关键证据定位索引

行号基于本次审计文件快照，后续以锁定 commit 重新生成；函数名与对象名是更稳定的定位锚点。

| 判断 | 路径 / 函数 / 对象 / 近似行号 |
|---|---|
| 昀 active Audio 创建 | `src/hooks/useLocalPlayer.js`，`ensureActiveAudio()`，`audioRef.current = new Audio()`，约 130–138 行 |
| 昀 standby Audio 创建 | `src/hooks/useLocalPlayer.js`，`ensureStandbyAudio()`，`standbyAudioRef.current = new Audio()`，约 140–147 行 |
| 昀主播放 AudioContext | `src/hooks/useLocalPlayer.js`，`getAudioContext()` 约 90–94 行；初始化约 198 行；`createMediaElementSource` 约 215 行 |
| 昀双 Deck 交叉淡化 | `src/hooks/useLocalPlayer.js`，`crossfadeToSong()` 约 365–469 行；对象 `audioRef/standbyAudioRef/isCrossfadingRef/crossfadeTokenRef` |
| 昀当前歌曲真相 | `src/hooks/useLocalPlayer.js`，`currentSongRef` 约 110 行，React `currentSong` 约 121 行；阶段 1 由 adapter 暂时收口 |
| 昀 ended | `src/hooks/useLocalPlayer.js`，`handleEnded()` 约 659–676 行，listener 约 698 行 |
| 昀歌词请求 | `src/components/FloatingLyrics.jsx`，effect 约 30–66 行；`fetchNeteaseLyrics()` 调用约 47 行；本地入口 `fetchSongLyrics()` |
| 昀 AI 播放入口 | `src/App.jsx`，传给 `useYunChat` 的 `player` 对象约 539–551 行；`src/services/chatIntentRouter.js` 的播放/seek 分支约 300–326 行 |
| 昀麦克风 context | `src/components/VoicePickupGlass.jsx`，约 138–140 行，局部 `audioContext/analyser` |
| 昀 TTS Audio | `src/hooks/useYunVoice.js`，`speechAudioRef` 约 124、190 行，`onended` 约 205 行 |
| Mineradio 全局播放状态 | `public/index.html`，`audio/audioCtx/...` 约 2677 行；`playlist/playQueue/currentIdx/playing` 约 2693 行 |
| Mineradio 主 AudioContext | `public/index.html`，`initAudio()` 附近约 17730–17742 行；`audioCtx/source/analyser/beatAnalyser/gainNode` |
| Mineradio UI SFX context | `public/index.html`，`getUiSfxContext()` 附近约 17756–17760 行，`uiSfxCtx` |
| Mineradio 临时解码 context | `public/index.html`，约 10405–10421、11588–11591 行，`OfflineAudioContext/DecodeCtx` |
| Mineradio Audio 创建 | `public/index.html`，`playQueueAt()` 内约 18502 行；本地文件路径约 20034 行，复用全局 `audio` |
| Mineradio 核心切歌事务 | `public/index.html`，`playQueueAt(idx, opts)` 约 18390 行；写 `currentIdx` 约 18401 行；歌词调用约 18605 行 |
| Mineradio ended | `public/index.html`，在线播放 `audio.onended` 约 18513–18518 行；本地文件约 20041 行 |
| Mineradio 歌词请求 | `public/index.html`，`fetchLyric(songOrId, token)` 约 19017 行；QQ `/api/qq/lyric` 与网易云 `/api/lyric` 约 19025–19028 行 |
| Mineradio 上/下一首 | `public/index.html`，`nextTrack()/prevTrack()` 约 18705–18718 行，直接修改 `currentIdx` 后调用 `playQueueAt` |
| Mineradio全局快捷键注册 | `desktop/main.js`，`globalShortcut.unregister/register` 约 138/154 行；IPC `mineradio-hotkeys-configure-global` 约 1124 行；renderer 配置约 `public/index.html:22070–22083` |
| Electron IPC | `desktop/main.js`，窗口 IPC 约 1100–1124；登录约 1163–1175；桌面歌词约 1204–1274；壁纸约 1292–1302 |
| Electron preload | `desktop/preload.js`，`contextBridge.exposeInMainWorld('desktopWindow', ...)` 约 3–45 行；`overlay-preload.js` 约 1–18 行 |
| Electron 主窗口 | `desktop/main.js`，`createWindow()` 约 1320 行；require server 约 1343；BrowserWindow 约 1348；`before-input-event` 约 1379；loadURL 约 1426 |
| Mineradio 后端路由 | `server.js`，总 dispatcher 约 3247–4186 行；搜索 3416/3426；URL 3439/3671；歌词 3453/3991；歌单 3505–3516、3837、4098 |

---

## 最推荐的技术路线

**推荐“昀内核先收口，再接能力”的路线：**

1. 先建立 PlayerCore 接口与 `yunLegacyPlayerAdapter`，包装现有 `useLocalPlayer`；阶段 1 不改听觉实现。
2. 保留昀全部 React UI、玻璃系统、粒子唱片、地形、光场、歌词和 AI；它们只改数据入口，不换实现。
3. 状态收口验收后，用独立阶段、独立 Git 提交重构 AudioEngine；采用私有双 Deck + 单 PlayerCore + 单长期主播放 AudioContext，方案 A 作为 fallback。
4. 从原始 Git 仓库的锁定 commit 进行许可证可追溯的行为审计；若昀不采用 GPL-3.0，则 Mineradio 自有实现只作需求参考并独立重写。
5. 将 Mineradio 后端能力按 provider 拆出，优先顺序为：搜索/URL/歌词 → 登录/歌单 → fallback → beat 分析。
6. 最后才套 Electron 壳；Electron 只提供桌面能力和安全桥，不成为播放器状态持有者。
7. TTS、UI SFX 与音乐输出统一由 AudioEngine 管理；麦克风是输入通道，但同样不得产生第二套播放状态。

这条路线最符合“最终产品仍然是昀”以及无缝交叉淡化的目标。下一步若确认实施，建议只启动阶段 0 和阶段 1；AudioEngine 必须等状态收口验收后单独实施，不同时接 QQ、Electron 或 beat analyzer。
