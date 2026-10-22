# 人物模式玻璃 UI 性能修复

## 修改与原因

- `src/avatar/portraitFrameProcessing.js`、`portraitMotion.worker.js`：抠图、去背景边缘及粒子采样移到模块 Worker；仅允许一个处理中任务，丢弃过时帧，切换视频和卸载后屏蔽旧结果。
- `src/avatar/usePortraitMotionTargets.js`：主线程保留视频采样、嘴部混合及结果上传；Worker 不可用时回退原处理。队列空闲会重试暂停中的新视频首帧。
- `src/components/ParticleVinylBackground.jsx`：人物完全成形后，顶点着色器直接计算人物路径，跳过唱片地形和频谱计算；形态转换期间仍使用完整路径。
- `src/avatar/portraitFrameProcessing.test.js`、`package.json`：覆盖队列上限、迟到结果、暂停首帧、卸载和失败回退；纳入 `test:avatar`。

## 实际页面验证

同一正式构建，声音面板展开后分别采样 3 秒，唱片、人物各两轮：

| 状态 | 第一轮 P95 帧间隔 | 第二轮 P95 帧间隔 | 超过 25ms 的帧 | 长任务 |
| --- | --- | --- | --- | --- |
| 唱片 | 6.2ms | 6.1ms | 0 | 0 |
| 人物聆听 | 6.1ms | 6.1ms | 0 | 0 |

人物主线程视频采样 P95 为 3.6–3.8ms。数据是本机、本次画面和质量下的结果，不代表所有显卡或窗口尺寸。

性能记录：`C:/Users/zhudo/.codex/visualizations/2026/09/23/01a0cc78-2048-7d90-b628-4bbb8730f8e0/avatar-glass-performance.json`。

开发服务器另有 React 开发模式 JSX 创建开销：完整 App 生成约 80–90ms，正式构建约 0.2ms。因此最终网页试听使用正式构建，不以开发服务器长帧判断发布版性能。临时计时、测试按钮和 JSX 标记已从源代码移除。

## 针对性检查

- 帧处理 5/5、人物生命周期与遮罩 23/23、口型 5/5、音量计 3/3 通过。
- 网易云相关 54 项、播放生命周期 6 项通过；本次总计 96 项。
- 修改代码定向 ESLint 通过；Vite 正式构建通过。

2026-10-01 收尾：最终构建成功，临时计时器、日志、测试按钮已全部移除。恢复后端 3031 和正式预览 3030，两端 `/api/health` 均返回 200；真实账号登录有效。保留开发模式调试入口，正式构建不显示调试按钮。
