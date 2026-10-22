# 待机嘴部变形修复 — 2026-10-06

## 根因与隔离证据

人物视频帧进入粒子处理前，原逻辑在所有状态中调用嘴型合成。非说话状态传入张口值 0，实际效果是持续把 speaking 视频里的闭嘴贴片覆盖到 listening/wake 视频上。不同视频的表情和肤色不同，跟踪与贴片缩放会把待机嘴角及周围皮肤改写。

临时隔离页面对 listening 视频 3、4、5 秒的同一帧分别显示原图和闭嘴合成图：原图表情正常，旧合成图出现嘴角收缩及肤色变化；关闭非 TTS 合成后，两侧表情一致。2026-10-04 已在正常网页复现并保存基线，2026-10-06 完成修复及验证。

## 修改文件

| 文件 | 修改 |
| --- | --- |
| `src/avatar/portraitSpeech.js` | 嘴型合成增加显式 `active` 条件，默认不覆盖原画面。 |
| `src/avatar/usePortraitMotionTargets.js` | 只有人物处于 SPEAKING 且实际语音正在播放时启用嘴型合成。 |
| `src/avatar/portraitSpeech.test.js` | 新增待机、聆听、播放结束及残留张口值不会改写原始面部像素的回归测试；保留实际语音与停顿时的张口/闭嘴测试。 |

待机、聆听、思考和形态转换保持原视频表情。播放中的句内停顿仍可闭嘴；语音结束后恢复原视频帧。保留既有随机动作和陪伴模式人形保持逻辑。

## 验证结果

- 回归测试先在旧代码上失败，修复后通过。
- `node src/avatar/portraitSpeech.test.js`：8/8。
- `node src/avatar/portraitMotion.test.js`：26/26。
- 三个修改文件 ESLint 通过，生产构建通过。
- 开发网页实际语音试听：捕捉到 `SPEAKING / speaking: true`；结束后为 `LISTENING / speaking: false / mode: 陪伴`，人物仍在，待机恢复原视频表情。
- 开发网页正常桌面及小窗口检查完成；临时窗口尺寸已恢复。
- 正式网页 `dist` 已更新，3031 后端恢复运行，健康检查返回 200。内置浏览器本次打开正式 3031 页面返回 `ERR_BLOCKED_BY_CLIENT`，因此实际画面及 TTS 切换在连接同一后端的开发网页验证；没有将健康检查或构建成功当作正式网页视觉证据。
- 临时同帧隔离 HTML 已删除。

### 网页启动配置修正

用户反馈打不开后，进一步检查发现 `/api/health` 为 200，但首页 `/` 为 404。上次启动 `server.js` 时遗漏 `YUN_PUBLIC_DIR`，服务默认从没有 `index.html` 的 `public` 目录提供网页。

已重启本任务启动的 3031 服务，显式设置 `YUN_PUBLIC_DIR=C:/Users/zhudo/yun-liquid-ui-react/dist`。首页、当前构建的 JavaScript 和健康接口均为 200，内置浏览器已完成启动并显示人形和歌曲选择界面。截图为上述证据目录中的 `yun-web-restored-2026-10-06.png`。此证据修正了之前仅检查健康接口时对网页可用性的判断。

## 画面证据

目录：`C:/Users/zhudo/.codex/visualizations/2026/09/23/01a0cc78-2048-7d90-b628-4bbb8730f8e0/`

- `idle-mouth-before-2026-10-04.png`：正常网页修复前待机截图。
- `idle-mouth-isolation-2026-10-06.png`：原始与旧待机合成同帧对照。
- `idle-mouth-isolation-fixed-2026-10-06.png`：修复后的同帧对照。
- `idle-fix-real-speaking-2026-10-06.png`：实际 TTS 说话状态。
- `idle-fix-after-tts-2026-10-06.png`：语音结束后保持人形聆听。
- `idle-fix-narrow-2026-10-06.png`：小窗口待机表情检查。
