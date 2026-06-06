# HANDOFF - 昀 AI 音乐伴侣

## 1. 项目目标和当前完成进度

这个项目是一个本地运行的 AI 音乐伴侣网页，名字叫“昀”。目标不是普通聊天机器人，而是一个能陪用户聊天、写日记、推荐音乐、控制本机播放器、识别当前播放歌曲，并把回复用豆包/火山 TTS 读出来的私人音乐陪伴工具。

当前已经完成到可本地运行阶段：

- 保留了原有网页 UI、日记、历史记录和聊天体验。
- DeepSeek 聊天已接入后端，不再把 Key 暴露在前端。
- Windows 本地音乐控制已接入，可以控制当前响应系统媒体键的播放器。
- 当前播放歌曲识别已接入，优先读取网易云音乐托盘 tooltip，失败后再尝试 Windows 媒体会话。
- 豆包/火山 TTS v3 unidirectional 已接入，前端支持自动朗读、试听、音色、自定义 speaker、语速和音量。
- “昀”的 system prompt 已多轮调整，更偏真人、短句、带一点吃醋和占有感，并减少 AI 腔。

## 2. 技术栈、启动方式、主要文件结构

技术栈：

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js 原生 `http` 服务，ESM
- 数据存储：浏览器 `localStorage`
- LLM：DeepSeek Chat API
- TTS：豆包/火山引擎 TTS v3 unidirectional
- Windows 控制：PowerShell + Windows API / UI Automation

启动方式：

```powershell
npm install
npm.cmd run dev
```

如果 PowerShell 报 `npm.ps1` 执行策略错误，用：

```powershell
npm.cmd run dev
```

或：

```powershell
node server.js
```

打开：

```text
http://localhost:3000
```

一般不需要管理员权限。音乐控制和托盘识别如果失败，优先检查网易云是否正在运行、是否响应系统媒体键、浏览器访问的是本机后端。

主要文件结构：

```text
.
├─ public/
│  └─ index.html        # 主前端页面，包含 UI、聊天、日记、TTS 控件、音乐控制逻辑
├─ server.js            # Node 后端，包含 DeepSeek、TTS、音乐控制、当前播放识别接口
├─ package.json         # npm scripts，当前无外部依赖
├─ package-lock.json
├─ .env.example         # 环境变量示例，不含真实 Key
├─ .env                 # 本地真实配置，不要提交、不要暴露
└─ HANDOFF.md           # 本交接文档
```

`.env.example` 当前应包含：

```env
DEEPSEEK_API_KEY=sk-把你的key放这里
DEEPSEEK_MODEL=deepseek-chat

DOUBAO_TTS_API_KEY=your_api_key_here
DOUBAO_TTS_RESOURCE_ID=your_resource_id_here
DOUBAO_TTS_SPEAKER=your_speaker_id_here
DOUBAO_TTS_FORMAT=mp3
DOUBAO_TTS_SAMPLE_RATE=24000
```

不要在聊天里索要、展示或复制用户真实 `.env` 内容。

## 3. 已实现功能

已实现的主要功能：

- DeepSeek 后端聊天接口 `/api/chat`
- 日记输入、心情标签、AI 回应、音乐推荐
- 日记历史记录、左侧历史列表、详情弹窗、回声档案
- 本地浏览器 `localStorage` 保存记录
- 语义意图识别：用户说“现在是什么歌”“换一首”“暂停一下”等，不靠固定关键词，而是先让 DeepSeek 判断意图
- 音乐控制接口 `/api/music-control`
  - `playPause`
  - `next`
  - `previous`
  - `volumeUp`
  - `volumeDown`
- 当前播放识别接口 `/api/current-track`
  - 优先读取网易云托盘 tooltip
  - fallback 到 Windows 系统媒体会话
  - 返回歌曲名、歌手、播放器名、播放状态等
- 换歌后自动读取新歌，并生成更像音乐博客的较长介绍
- 豆包/火山 TTS v3 接口 `/api/tts`
  - 支持 text、voice、speed、volume
  - 支持接口返回 base64 音频或二进制音频
  - 返回 `audio/mpeg` 或 `audio/wav`
- 前端 TTS 控件
  - 自动朗读开关
  - 试听声音按钮
  - 预设声音选择
  - 自定义 speaker ID
  - 语速控制
  - 音量控制
- TTS 播放前处理
  - 尽量去掉括号里的动作/旁白，避免朗读“轻轻吸气”这类内容
  - 给标点后加间隔，让停顿稍微明显一点
- 角色人格调节
  - 话多程度
  - 感性程度
  - 幽默感
  - 音乐偏好
  - 控制欲
- “昀”的回复风格已调整为更短、更口语、更像朋友，不像心理咨询师或情感文案。

## 4. 还没完成的功能

还没有完成或只是初步实现的方向：

- 多设备同步聊天记录。现在手机和电脑各自用自己的浏览器 `localStorage`，不会自动互相同步聊天和日记。
- 真正绑定网易云音乐应用状态。当前是“系统媒体键控制当前播放器”，不是网易云专属 SDK。
- 更稳定的跨设备手机 TTS 自动播放。手机浏览器有自动播放限制，目前做了音频解锁，但仍可能需要用户先点一次“试听声音”。
- 当前播放识别还没有做到 100% 稳定。托盘 tooltip 和 Windows media session 都是本地系统能力，可能受网易云版本、托盘状态、系统权限影响。
- 没有后端数据库。历史记录、日记、聊天上下文主要在前端本地。
- 没有登录、多用户隔离、云端保存。
- 没有完整测试框架。

## 5. 当前已知 bug / 风险

已知问题：

- PowerShell 可能禁止 `npm run dev`，报 `npm.ps1` 执行策略错误。解决方式是用 `npm.cmd run dev`。
- 当前播放识别依赖网易云托盘 tooltip。它不使用固定屏幕坐标，也不做 OCR，但可能会打开托盘隐藏图标面板并移动鼠标 hover 图标。
- 如果系统媒体会话被抖音、浏览器视频、Electron 应用占用，fallback 结果可能不准。最近已改成优先托盘 tooltip，并过滤部分非音乐会话，但仍不是绝对可靠。
- 手机端 TTS：普通聊天通常能播，换歌后的长回复由于链路更长，仍可能被移动端浏览器自动播放策略拦截。建议先点一次“试听声音”解锁。
- 自定义 speaker ID 必须和豆包/火山的 Resource ID 匹配，否则后端会收到类似 `resource ID is mismatched with speaker related resource` 的错误。
- TTS 去括号逻辑会去掉括号内文本。如果歌名本身包含括号，语音版可能读得不完整，但屏幕显示文本不受影响。
- 本地服务只在运行 `server.js` 的电脑上控制音乐。如果手机访问这个网页，控制的仍是运行后端那台电脑的播放器。

## 6. 最近一次修改了哪些文件、为什么改

最近主要修改过这些文件：

- `server.js`
  - 新增和完善 `/api/chat`，把 DeepSeek Key 放到后端 `.env`。
  - 新增 `/api/music-control`，通过 Windows 系统媒体键控制播放器。
  - 新增 `/api/current-track`，读取当前播放歌曲。
  - 当前播放识别逻辑调整为优先读取网易云托盘 tooltip，再 fallback Windows 媒体会话，避免被抖音等媒体会话误导。
  - 新增 `/api/tts`，改用豆包/火山 TTS v3 unidirectional。
  - 修复豆包 v3 返回多行 JSON / base64 音频时解析失败的问题。

- `public/index.html`
  - 保留原有日记、历史记录、聊天 UI。
  - 增加 TTS 设置区：自动朗读、试听、声音选择、自定义 speaker、语速、音量。
  - 增加语义意图识别：用户自然问“你知道我在听什么吗”时自动调用当前播放识别，不需要按钮。
  - 去掉或弱化固定“识别当前播放”按钮式体验，改成聊天里自然触发。
  - 增加换歌后识别新歌并长一点介绍的逻辑。
  - 增加“控制欲”性格滑杆，并把它写入 prompt。
  - 调整 system prompt，减少 AI 腔、心理咨询腔、乐评模板腔。
  - 增加 TTS 文本清洗和移动端音频解锁逻辑。

- `.env.example`
  - 从旧版 AppID / AccessToken / Cluster 改成豆包/火山 TTS v3 的 API Key / Resource ID / Speaker 配置。

- `package.json`
  - 保持简单 npm scripts：`dev` 和 `start` 都运行 `node server.js`。

## 7. 重要业务逻辑 / 不要随便改

这些地方不要轻易大改：

- `public/index.html` 里的 `STORAGE_KEY`
  - 当前历史记录存在浏览器 `localStorage`。改 key 会让用户看起来像“历史没了”。

- `callDeepSeek()` / `/api/chat`
  - 前端不应该直接调用 DeepSeek，也不应该出现 DeepSeek Key。

- `classifyUserIntent()`
  - 用户希望“昀”理解自然语言，而不是只识别固定关键词。
  - 不要退回简单关键词匹配，否则“你知道我在听什么吗”“这首是谁唱的”等体验会变差。

- `/api/current-track`
  - 当前优先托盘 tooltip 是为了绕开 Windows media session 被抖音等应用抢占的问题。
  - 不要随便改回“媒体会话优先”。
  - 不要使用截图 OCR。
  - 不要依赖固定屏幕坐标。

- `/api/music-control`
  - 它控制的是系统当前媒体播放器，不限定网易云。
  - 这是第一阶段设计，不要硬写死网易云窗口或坐标。

- `/api/tts`
  - 必须只从 `process.env` 读取 API Key / Resource ID / Speaker。
  - 前端不能出现任何 Key、Token、AppID。
  - 豆包 v3 可能返回多行 JSON + base64 音频，不要只按普通 JSON 解析。

- TTS 播放失败不应阻断聊天
  - 用户要求“语音合成失败，但文字回复正常”。
  - 不要因为 TTS 失败导致聊天发送失败。

- “控制欲”人格
  - 允许的是偏撒娇、吃醋、黏人、关心式的占有感。
  - 不要写成威胁、羞辱、命令、操控、限制人身自由。

## 8. 接下来最推荐的新对话任务清单

推荐下一轮 Codex 优先做这些小步任务：

1. 修复“手机端和电脑端都无法识别当前歌曲”的最新问题
   - 先直接请求 `/api/current-track`
   - 看后端 console 的 tray tooltip / media session 日志
   - 不要先改 prompt，先确认接口真实返回

2. 给 `/api/current-track` 做一个前端可见的调试提示
   - 例如临时显示 method、playerName、rawTooltip
   - 方便用户判断到底读到了什么

3. 优化换歌后的长回复
   - 减少重复句式，例如“你在想谁”
   - 多写歌曲背景、歌手风格、旋律/歌词情绪
   - 同时保持“朋友边听边聊”的口吻

4. 继续优化 TTS 移动端播放
   - 切歌后长回复生成完成时，确认是否复用已解锁 audio
   - 必要时加一个明显的“点一下开启语音”状态

5. 增加可选同步能力
   - 如果用户想让两台手机/电脑看到同一聊天记录，需要后端存储或 WebSocket。
   - 这会改变架构，建议单独开任务做。

6. 给常用功能加轻量测试脚本
   - `/api/chat`
   - `/api/tts`
   - `/api/music-control`
   - `/api/current-track`

## 9. 给下一个 Codex 的注意事项

- 不要删除已有功能。
- 不要大范围重构。
- 优先小步修改，改完立刻验证。
- 先读 `server.js` 和 `public/index.html` 再动手。
- 不要把真实 `.env` 内容写进代码、文档或聊天。
- 不要让前端持有任何 API Key。
- 不要用 OCR 或固定坐标识别歌曲。
- 不要把音乐控制写死为网易云窗口操作。
- 不要把“昀”改回心理咨询师、情感文案或标准 AI 助手口吻。
- 每次改 prompt 都要保留：短句、口语、少模板、像朋友、可以轻微吃醋和关心。
- 如果修当前播放识别，重点看后端 console 日志，不要只看前端回复。
- 如果修 TTS，记住文字聊天必须优先可用，TTS 失败只能作为附加提示。
