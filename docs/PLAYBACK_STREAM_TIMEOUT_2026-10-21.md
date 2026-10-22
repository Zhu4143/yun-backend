# 在线音频中途卡住：流超时修复

确认的问题：`handleNeteaseAudio` 使用通用 `fetchWithRetry` 下载 CDN 音频。通用请求的 `AbortSignal.timeout(12000)` 在收到响应头后仍有效，会在请求开始 12 秒后中断尚未传完的响应体。较慢的在线音频下载会因此断流，前端可能耗尽缓冲并停止声音和进度。

本轮修改：

- `server/netRequest.js` 增加显式 `timeoutScope: 'headers'`：收到响应头即清除连接计时器，用户取消信号继续约束后续响应体。默认 API 请求仍使用原来的响应体超时。
- `server.js` 仅两处 CDN 音频请求选择该模式，覆盖首次请求和失效地址刷新后的重试。
- `server/netRequest.test.js` 使用本地 HTTP 慢速音频流回归：响应头立即返回、尾部在 400ms 后到达、超时设为 150ms。修复前稳定失败于 `TimeoutError`；修复后能读取完整响应。
- 验证未返回响应头仍超时、普通 API 仍有截止时间、用户离开后仍取消音频传输。临时播放器诊断输出已移除。

验证结果：

- `node --test --test-isolation=none server/netRequest.test.js server/requestLifecycle.test.js src/player/playback/playbackOrchestration.test.js`：28 项通过，exit 0。
- 修改文件 ESLint、`node --check server.js` 通过，exit 0。
- 已重启本地 3030 后端应用修复；5175 前端沿用现有进程。
- 真实网易云《我怀念的》音频代理返回 HTTP 206、`audio/mpeg`，有效分段 `bytes 0-1023/11564974`。
- 独立内置预览播放该在线版本，进度从约 1:31 推进到 2:46，观察期间没有中断、浏览器无 error/warn。截图位于 `design/playback-stall-20261021/verified.png`。验证后已暂停并关闭测试页。

本轮确认并修复的是上述固定时限截断。后台另有网易云连接超时记录，外部网络波动不能仅凭这次验证认定已经消除。
