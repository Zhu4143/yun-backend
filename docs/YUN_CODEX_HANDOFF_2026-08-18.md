# 昀（Yun）项目交接说明

> 交接日期：2026-08-18  
> 项目根目录：`C:\Users\zhudo\yun-liquid-ui-react`  
> 当前分支：`feature/yun-telemetry-p0`  
> **重要：工作区是刻意保留的 heavy dirty 状态，绝对不要执行 `git reset --hard`、`git clean` 或覆盖未知改动。**

## 1. 当前目标与完成状态

昀是 React/Vite + Node 本地服务的沉浸式音乐陪伴应用。当前 P0 到 P6 已完成并停在未提交工作区：

| 阶段 | 内容 | 当前状态 |
| --- | --- | --- |
| P0 | 前后端 Telemetry、NDJSON、聚合信号 | 已完成 |
| P1 | 通用 Yun Agent Core（工具、权限、状态、记忆、模型） | 已完成 |
| P2 | PlayerCore/Legacy Player Adapter 接口收口 | 已完成 |
| P3 | 音乐 Tools、Agent Loop、`/api/yun/agent`、前端动作执行 | 已完成 |
| P4 | `build_playlist`、`troubleshoot_playback` Skills | 已完成 |
| P5 | Telemetry → hypothesis → verifier → prioritize → backlog | 已完成 |
| P6 | 反馈闭环、Skill 候选与用户确认 | 已完成 |
| P6.1 | 成功动作的异步 Pro 分析、可复用场景推荐 Skill 候选 | 已完成 |

最近一轮解决的是“本地路由把本应进入 Agent 的请求拦截掉”的问题。

## 2. 必须先了解的运行架构

```text
用户输入/语音
  └─ src/hooks/useYunChat.js
       └─ src/services/chatIntentRouter.js
            ├─ 单一步骤、低延迟：本地立即执行（暂停、下一首等）
            ├─ 常规音乐解析：DeepSeek Flash Smart Music Gate
            └─ 场景/复合/多步骤：useYunAgent → /api/yun/agent
                    └─ server/yun-agent/agentLoop.js
                         ├─ 静态 Skill
                         ├─ DeepSeek Pro 工具规划
                         └─ 返回 declarative actions
                    └─ src/services/yunAgentActions.js 在浏览器实际执行
```

### 模型分工

- Flash：快速、结构化的 Smart Music 路由与普通低延迟任务。
- Pro：`/api/yun/agent` 的多步骤规划、深层陪伴对话、后台 Skill 归类。
- 代码位置：`server.js` 的 `deepseekFlashModel`、`deepseekProModel`，以及 `yunAgent` 初始化的 `AI_MODEL`。
- 不要把 API Key 写入前端、文档、测试或提交记录；模型/密钥只读环境变量或本地 Git-ignore 配置。

## 3. 最近完成：路由拦截修复

### 修改的文件

| 文件 | 作用 |
| --- | --- |
| `src/services/chatIntentRouter.js` | 判断复合指令、场景推荐；Smart Gate 失败或 `none` 时继续回退，不再作为最终回复 |
| `server/yun-agent/skills.js` | `build_playlist` 可保留前置设置/收藏，并按原顺序生成动作 |
| `server/yun-agent/musicTools.js` | 增加收藏当前歌曲、设置回复模式的模型工具 |
| `server/yun-agent/agentLoop.js` | 提示 Pro 在多步骤请求中按用户顺序返回全部安全动作 |
| `src/services/yunAgentActions.js` | 实际执行收藏网易云歌曲、播放模式、回复模式等动作 |
| `server/yun-agent/agentLoop.test.js` | 覆盖组合动作顺序 |

### 新的路由规则

1. “暂停”“下一首”“换歌”等纯单一指令仍本地即时执行，不等待模型。
2. 含有“然后、并且、同时、顺便、接着、之后、再帮我/给我/做……”的多目标请求会交给 Agent，避免本地规则只执行前半句。
3. “推荐几首适合运动的歌”“给我做一张雨天歌单”等场景请求会走 `build_playlist` Skill，而不是泛化的 AI 推荐或“我的网易云歌单”查找。
4. Smart Music Gate 请求失败，或回传 `plan.action === 'none'` 时，不再回复“智能音乐判断没有完成”；会继续走直搜、Agent 或普通陪伴对话。

### 可以人工验证的句子

- `推荐几首适合运动的歌`
- `切到随机播放，然后做一张跑步歌单`
- `进入专注模式，然后做一张雨天歌单`
- `把这首收藏，再做一张跑步歌单`
- `分析这首歌的结构，然后跳到第二段副歌`

预期：不应出现“找不到你的网易云歌单名字”来回答创建/推荐歌单；复合句不应只执行第一段。

## 4. Agent、Skill 与学习闭环

### 主要文件

| 模块 | 文件 |
| --- | --- |
| Agent Core | `server/yun-agent/core/` |
| Agent Loop | `server/yun-agent/agentLoop.js` |
| 音乐工具定义 | `server/yun-agent/musicTools.js` |
| 静态 Skills | `server/yun-agent/skills.js` |
| Skill Mining | `server/yun-agent/skillMining.js` |
| 浏览器动作执行 | `src/services/yunAgentActions.js` |
| Agent Hook | `src/hooks/useYunAgent.js` |
| Telemetry | `src/telemetry/`、`server/telemetry/` |
| P5/P6 Discovery | `server/discovery/` |

### Skill 生成机制

- 用户本轮先获得正常执行结果，不能等待后台学习。
- 成功的安全动作会通过 `POST /api/yun/agent/outcomes` 记录。
- 同一类动作累计成功后，后台 Pro 只分析“是否属于场景化推荐”；它不参与当前回复。
- 生成候选后，前端展示“保存快捷方式 / 暂不保存”；未经用户确认不会启用为长期快捷 Skill。
- 已确认的 Skill 下次会本地命中，跳过模型调用。

## 5. 音频、视觉与已知历史修复

- `src/hooks/useYunVoice.js`：TTS 完成、停止、失败时必须释放/取消音乐 duck token，避免歌曲音量长期被压低。
- `src/components/FloatingLyrics.jsx`：歌词高亮采用 `requestAnimationFrame` 与 CSS 变量持续插值，避免 `timeupdate` 驱动导致一顿一顿。
- `src/components/ParticleVinylBackground.jsx`：已做画质分档、降低默认渲染负担、清除异常白环/白色粒子相关效果。若仍掉帧，优先检查浏览器 GPU、画质档与主线程长任务。

## 6. 常用接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/yun/agent` | Agent 规划，返回 declarative actions |
| POST | `/api/yun/agent/outcomes` | 上报前端动作执行成功/失败 |
| GET | `/api/yun/skill-candidates` | 拉取未决 Skill 候选 |
| POST | `/api/yun/skill-candidates/decision` | 用户确认/拒绝候选 |
| POST | `/api/yun/telemetry` | P0 事件上报 |

## 7. 验证命令

从项目根目录运行：

```powershell
npm run test:core
npm run test:telemetry
npm run test:player
npm run test:discovery
npm run test:feedback
npm run build
```

最近一次已实际通过：

- `npm run test:core`：31/31。
- `npm run test:telemetry`：21/21。
- 修改文件 ESLint：0 error / 0 warning。
- `node --check`（最近修改的路由、Agent、Skill 文件）：通过。
- `git diff --check`：通过。
- `npm run build`：通过；仍有既有的约 1.34 MB 主 chunk 警告，未阻断构建。

## 8. 接手时的注意事项与建议顺序

1. 先启动应用并手工执行第 3 节的五条口令，确认实际 API/网易云登录状态下的行为；不要只依赖单元测试。
2. 若修复路由，优先改 `chatIntentRouter.js`，但必须同时考虑：本地即时动作、Smart Gate、直搜、Agent、普通陪伴对话五条路径。
3. 不要让 `plan.action === 'none'` 或 Smart Gate 网络失败直接成为最终回复；这会再次阻断 Agent。
4. 新增 Agent action 时必须同时改三处：`musicTools.js`（模型可调用）、`yunAgentActions.js`（浏览器实际执行）、测试；必要时还要更新 Skill。
5. 收藏/网易云等需要用户状态的动作，失败必须如实返回，不可在模型回复中预先声称完成。
6. 工作区里有大量 MOSS、语音、视觉、Electron 和历史试验文件，它们不是本轮路由修复的全部归属。提交前务必人工分组 `git diff`，不要一把提交全部。
7. `docs/CODEX_HANDOFF.md` 是较早的 MOSS 交接文档，不代表当前昀的主线；以本文和当前源码为准。

## 9. 下一位 Codex 的第一步建议

先进行人工验证并记录每条命令走的是“本地 / Flash / Pro / Skill”哪条路径。若仍有“被错误拦截”的输入，先补一条复现测试，再最小化修改路由优先级；不要通过关闭所有本地规则来解决，否则会损失语音控制的响应速度。
