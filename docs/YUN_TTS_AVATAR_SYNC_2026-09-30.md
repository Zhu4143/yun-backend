# 人物与 TTS 播放同步修复

## 问题证据

- 原 `resolveAvatarRenderPhase` 在人物已成形但唤醒动作未结束时，将真实 `SPEAKING` 返回为 `WAKE_MOTION`。新增回归测试在修复前 23 项中 1 项失败：期望 `SPEAKING`，实际 `WAKE_MOTION`。
- 说话视频及穿插的唤醒、聆听片段原来按视频自己的时间循环，嘴部随机粒子扰动不能使视频口型跟随 TTS 停顿。

## 修改文件

- `src/avatar/portraitMotion.js`、`portraitMotion.test.js`：真实播放优先，粒子成形仍由原 morph progress 控制。
- `src/voice/audio/voiceMeter.js`、`src/hooks/useYunVoice.js`：从实际浏览器播放头和输出增益、原生播放 PCM 时间读取嘴部包络；前导静音、停顿、淡出、停止和完成均闭嘴。阻止取消后迟到的音频解码结果覆盖新一轮音频。
- `src/avatar/portraitSpeech.js`、`portraitSpeech.test.js`：从原 speaking 视频自动提取闭嘴、半开和张开的真实嘴部像素，只羽化混合小范围嘴部，保留 alpha 和身体动作。
- `src/avatar/usePortraitMotionTargets.js`：独立静音视频一次扫描提取口型图集，避免扫描抢占正在显示的视频；实时播放不为口型 seek。保留 Worker 帧处理、队列背压、旧帧失效保护、镜头校准和既有身体片段穿插。
- `src/App.jsx`：TTS 实际播放覆盖调试/唤醒视觉门控；说完回到安静聆听，原连续对话采集和会话结束还原唱片保持原逻辑。
- `src/components/ParticleVinylBackground.jsx`：将计量 ref 交给人像 motion hook，删除随机嘴部位置扰动（主任务统一集成）。

## 验证

- `node src/avatar/portraitMotion.test.js`：23/23 通过。
- `node src/voice/audio/voiceMeter.test.js`：3/3 通过。
- `node src/avatar/portraitSpeech.test.js`：5/5 通过，包含真实播放时间的前导静音、音节、停顿、静音输出和结束，以及对原本闭嘴的身体片段张嘴、对原本张嘴片段在静音时闭嘴、独立语音时钟/背压/末端闭嘴和扫描清理。
- 上述源码/测试、voice hook、App 的 scoped ESLint 通过。
- 原 speaking 素材按 12 FPS 读取 73 帧，使用现有校准 transform（scale 1.037037）。闭嘴/半开/张开图集 score 分别为 0 / 0.03125 / 0.0625；同一 1.5 秒帧仅改变包络 0 / 0.5 / 1，截图可见闭嘴、半开、张开，身体和摄像构图保持一致。
- 素材证据：`C:/Users/zhudo/.codex/visualizations/2026/09/23/01a0cc78-2048-7d90-b628-4bbb8730f8e0/avatar-tts-mouth-source-check.jpg`。

## 验证边界

素材截图验证嘴部像素；实际网页试听另已完成下述检查。口型由声音包络驱动开合，不声称达到音素级唇读匹配；未验证实体扬声器的端到端声画延迟。

## 语音时钟与扫描生命周期补充

- 原嘴部刷新仍受身体视频 12 FPS tick 限制，视频 seek 或暂停期间无法独立响应音量变化。现增加独立 24 FPS 语音 tick；身体与语音使用同一节流判断，TTS 活跃时最多 24 FPS，无 TTS 时仍只响应身体 12 FPS 帧。
- Worker 正忙时丢弃采样，不积压；结束或停止后，闭嘴状态可在身体 tick 不变时提交，Worker 空闲回调按最新计量重试。还原唱片时先冻结源动作并提交闭嘴目标。
- 扫描的 fallback、RVFC、总 timeout 统一在结束、失败、超时、AbortSignal 取消时清理。加载、seek 的等待也跟随同一卸载取消信号，防止暂停或卸载后继续定时扫描。
- 新增测试验证冻结身体帧仍可语音刷新、24 FPS 上限、背压丢帧后提交最新状态、结束闭嘴；验证 fallback 与总 timeout 在取消后清空，以及 RVFC 与总 timeout 在自然结束后清空。三处改动源码/测试的 scoped ESLint 通过。

## 真实网页试听与计时器修复

- 试听时发现音频生成成功，但浏览器调用播放计时器抛出 `TypeError: Illegal invocation`。`PendingPlaybackController` 将浏览器计时器作为实例方法调用，改变了要求的接收者。
- `src/voice/PendingPlaybackController.mjs` 改为通过 `globalThis` 调用默认计时器；测试增加浏览器接收者约束，修复前 1 项失败，修复后 6/6 通过。原注入计时器接口保持兼容。
- 实际声音面板“试听声音”已验证：后端返回 WAV；浏览器 `play()` 成功，音频非 paused/ended；页面进入 `SPEAKING`，结束后回到 `LISTENING`。临时播放日志已移除。

## 2026-10-01 可见张嘴修复

- 原验收只确认播放状态，没有充分验证实际嘴部张开。实测当前 40% 音量试听 WAV：85 个采样帧仅 1 帧开合值超过 0.5；页面扫描还出现 `speaking unavailable false false 0`，口型图集没有加载。
- 修改 `src/voice/audio/voiceMeter.js`：按当前音频的 90 分位音量归一化开合，缓存参考值；正常听音音量不再缩小嘴部，静音、停顿、低音量尾部淡出仍关闭嘴部。相同 WAV 修复后 38/85 帧超过 0.5，峰值达到 1。
- 修改 `src/avatar/usePortraitMotionTargets.js`：口型扫描独立加载说话视频，静音播放请求解码，不再等待可能延迟预加载的身体视频；加载等待上限 12 秒，仍可取消。按原速采样，避免 6 倍播放漏掉短暂张嘴帧。实际图集闭嘴 score 0.00390625、张嘴 score 0.0546875。
- 修改 `src/voice/audio/voiceMeter.test.js`：新增低音量/轻声、停顿、静音和淡出回归，修复前失败，修复后 4/4；口型与扫描生命周期测试 5/5、定向 ESLint 通过。
- 真实网页“试听声音”连续截图确认可见张嘴与停顿闭嘴，截图 `mouth-fixed-8.png` 显示张嘴；口型开合采样记录同时达到 1。临时 DOM 诊断标记已移除。该实现控制开合，仍不属于音素级口型。
