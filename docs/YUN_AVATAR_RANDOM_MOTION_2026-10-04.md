# 说话随机动作与陪伴人形保持 — 2026-10-04

## 修改范围

| 文件 | 本次修改 |
| --- | --- |
| `src/avatar/portraitMotion.js` | 增加说话动作随机序列；把陪伴响应模式接入人物状态判断。 |
| `src/avatar/usePortraitMotionTargets.js` | 用独立动作计时替代由嘴型扫描片段驱动的固定交替；离开说话状态时清理计时并阻止过期异步切换。 |
| `src/App.jsx` | 向人物状态解析传入 `responseMode`。 |
| `src/avatar/portraitMotion.test.js` | 覆盖随机顺序、起点、时长、素材边界、陪伴模式和模式退出。 |

## 1. 说话动作

- 使用现有 speaking、wake、listening 三段视频素材，每轮打乱顺序，并避免相邻重复同一素材。
- 每段取约 2.4–3.8 秒，起点随机，重复使用素材时避开上次起点；不足该长度的素材按实际长度限制。
- 动作选择不再等待嘴型扫描完成，也不再要求识别出至少两个嘴型片段。
- 身体动作有独立节奏；嘴型继续由 TTS 音频驱动。沿用已有画面校准和粒子平滑过渡。

### 验证

- 开发网页连续说话预览约 40 秒，记录末尾 12 次实际动作启动：三段素材均出现，起点和持续时间变化，没有相邻重复。
- 此长时间预览验证身体动作调度，不包含真实音频。
- 正式网页实际点击“试听声音”，观察到说话状态进入；结束后说话标记消失。
- 临时动作诊断标记已移除，临时测试页面及 Vite 服务已关闭。

## 2. 陪伴模式保持人形

- 点击“陪伴”直接进入人形状态；没有语音播放时保持人物聆听状态。
- 语音开始时进入说话状态，结束后回到人物聆听。
- 此改动仅控制视觉形态，没有自动开启麦克风通话。

### 验证

- 开发网页点击“陪伴”，观察到唱片经转换进入人物聆听状态。
- 正式网页真实语音试听完成后，DOM 显示 `mode: 陪伴`、`speaking: false`，截图确认人物仍在。
- 单元测试覆盖退出陪伴且无其他唤醒信号时恢复唱片状态。

## 自动检查

- `node src/avatar/portraitMotion.test.js`：26/26。
- `node src/avatar/portraitSpeech.test.js`：7/7。
- `node src/avatar/portraitFrameProcessing.test.js`：5/5。
- `node src/voice/audio/voiceMeter.test.js`：4/4。
- 本次涉及的四个源码/测试文件 ESLint 通过。
- 移除临时诊断后生产构建通过；仍有现有大 chunk 提示。
- 最新产物已由 `http://127.0.0.1:3031/` 加载。

## 浏览器证据

目录：`C:/Users/zhudo/.codex/visualizations/2026/09/23/01a0cc78-2048-7d90-b628-4bbb8730f8e0/`

- `random-motion-2026-10-04.json`：开发网页实际动作序列记录。
- `random-motion-2026-10-04-a.png`：连续动作预览。
- `companion-speaking-2026-10-04.png`：正式网页真实 TTS 说话状态。
- `companion-idle-2026-10-04.png`：真实 TTS 结束后仍为人形。
