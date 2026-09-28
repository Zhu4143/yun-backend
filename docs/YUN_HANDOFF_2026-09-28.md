# 昀核心稳定性与唤醒链路交接｜2026-09-28

## 项目与分支

项目根目录：C:\Users\zhudo\yun-liquid-ui-react
当前开发分支：feature/netease-capability-p2
本说明随 fix: core stability / wake pipeline repair checkpoint 检查点更新。该检查点不合并 main。

开始后先执行 git status --short。工作区还可能包含未提交的个人曲库/记忆数据、实验材料及其他用户改动；保留现场，按任务边界处理，不要用 reset、clean 或整文件覆盖清理。粒子人物实验不属于本检查点。

## 本轮已修复链路

- 启动任务依赖后端健康检查；本地曲库和播放器可以在网易云 provider/歌单失败时继续启动，界面显示降级状态。
- VoiceSessionController 统一会话、响应 ID、过期响应防护和取消注册；新用户轮次、打断、结束通话及关闭记忆会沿会话链路取消聊天与 TTS 工作。
- 原生麦克风正常时不再由 renderer 额外启动浏览器采集。原生故障转移先请求释放设备，确认后才启动浏览器 fallback；恢复时先释放 browser owner 再交回 native。fallback 唤醒和命令转写复用同一个采集流，并提供状态诊断。
- 记忆关闭/安静模式不会把近期或长期记忆放进 prompt，也会停止相应写入。记忆更新在响应前完成，并通过串行原子 JSON store 写入，避免并发覆盖。
- 待播队列只有在候选歌曲实际播放成功后才提交消费。
- Electron 通过健康信息识别兼容后端，旧服务不兼容时使用独立端口；运行时 .env、cookie、曲库和记忆位于 app.getPath('userData')/data。安装包排除仓库里的用户数据。
- 启动状态、桌面身份和构建信息有专门测试；新增的队列、请求生命周期、记忆策略、麦克风所有者和采集器测试已加入 npm.cmd run verify。

## 验证与边界

2026-09-28 的 npm.cmd run verify 通过：lint、完整配置测试套件、conversation E2E 和 production build 均成功。Vite 仍提示主 JavaScript bundle 较大，这只是体积 advisory。

npm.cmd run desktop:dist 成功构建本地 1.0.10 Windows 安装包。它是本地生成的打包产物，未加入源代码提交，也没有安装或发布。

Browser fallback 阈值已与历史代码比较并保持原值。自动化验证覆盖状态迁移、owner 唯一性及失败回退；没有目标设备上的物理麦克风对照，因此不能据此宣称真实唤醒率已改善。Native KWS sidecar 模型不在本仓库，本轮没有改模型阈值。网易云实时播放也未做完整逐曲验证。

## 继续开发

- 运行 npm.cmd run verify 做全量回归。
- 桌面安装包使用 npm.cmd run desktop:dist；先确认 git status --short，该命令会打包当前工作树。
- 唤醒排查看 docs/YUN_AUDIO_CAPTURE_STATE_MACHINE.md 和 docs/YUN_WAKE_SENSITIVITY_REGRESSION.md。
- Electron/启动排查看 docs/YUN_BOOT_AND_DESKTOP_RUNTIME.md。
- docs/PROJECT_PROGRESS.md 是公开的项目进度入口；此文件记录本轮交接细节。
