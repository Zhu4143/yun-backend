# 唤醒灵敏度回归记录

## 历史对比

对 `642790b` 和 `eaae249` 中的 browser fallback 唤醒实现做了定点比较。两者均为：3.5 秒冷却、6 秒滚动缓冲、3 帧静音判定、RMS 启动阈值 0.012、静音阈值 0.006。当前代码没有这些参数收紧的证据，因此保留阈值，避免以增加误唤醒来假装修复。

更可疑的退化来自采集所有权：持久音频 hook 与 barge-in hook 都能启动共享 AudioCaptureManager，而 Native KWS 同时持有物理输入。即使共享 browser manager 自身只开一路，它仍与 native sidecar 形成两路采集。Native 正常时现在只让 sidecar 持麦；browser wake fallback 和 browser barge-in 共用一个 manager。Native 掉线后先确认 sidecar 释放麦克风，重试 3 次失败后进入 browser fallback；每 15 秒检查并串行切回 native。

Browser fallback 已改为对同一语音段并行执行 wake 检测和 ASR，命令文本可直接接续，不再为了补识别再开启一轮麦克风。这减少的是链路等待，不改 wake 模型阈值。

## 可观测性

唤醒设置显示采集来源和 owner、采样率、帧长、队列和丢帧、RMS 与 VAD 阈值、wake score/confidence、browser 的漏检交叉核验、人工有效/误唤醒标记、冷却抑制、TTS 活跃监听帧、命令抑制帧和 Native reconnect 次数。开发模式下 AudioCaptureManager 每秒打印一次 `[CAPTURE]` 指标。

Browser 的“漏唤醒”只在 ASR 听到唤醒词、但 KWS 未触发时计数；它不会自动知道用户说过但 ASR 也没识别的情况。Native KWS 阈值、真实设备灵敏度和误唤醒率需要目标机器实测，本仓库目前没有 sidecar 模型源码或录音基准。

## 设备验收建议

在同一 Windows 设备、麦克风、扬声器音量、距离和房间噪声下，各重复 20 次“只说小昀”和“播放 TTS 时插话”：

1. Native 模式确认 owner 为 native，Chromium `getUserMedia` 打开次数为 0。
2. 暂停/结束 Native sidecar，确认三次重试耗尽后状态转成 browser fallback，owner 单独变为 browser。
3. 恢复 Native，确认切换期间 browser stream 先关闭，再由 Native 接管；全程无双 owner。
4. 对照记录首次命中率、唤醒到 orb/命令响应时间、误唤醒次数、wake score/confidence 和丢帧。

代码和自动化测试可验证状态机、唯一 owner 与 fallback 顺序；真实麦克风的灵敏度结论需结合上述设备记录，不能仅凭构建成功下结论。
