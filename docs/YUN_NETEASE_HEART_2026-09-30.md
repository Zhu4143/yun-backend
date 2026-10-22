# 网易云红心按钮修复（2026-09-30）

## 修改范围

- `src/App.jsx`：将底部播放器无事件处理的 Repeat 按钮替换为红心按钮；传入当前歌曲、当前网易云账号变化标识和现有登录入口。
- `src/App.css`、`src/components/NeteaseLikeButton.jsx`：未喜欢显示透明轮廓心，已喜欢显示红色实心；同步中防止重复点击，登录过期可打开网易云登录，读取失败可重试。
- `src/services/netease/likeController.js`：切歌、账号刷新、组件退出后屏蔽旧请求；重复点击只提交一次；返回正在写入的歌曲时，等待写入完成再读取；只在服务器确认后更新红心。
- `src/api/neteaseApi.js`：读取接口支持取消请求；新增明确的红心添加/取消 POST；通过原有 AI 收藏入口添加后通知按钮更新。
- `server/netease/capabilityService.js`、`server.js`：复用当前账号认证和 Cookie，在 `POST /api/netease/library/liked` 执行添加或取消。Cookie 保留在后端。
- 对应三个测试文件：覆盖 API 参数、认证/失败、重复点击、切歌延迟、账号变化和返回待写入歌曲。
- `package.json`：将新增控制器测试接入已有 `test:services` 验证入口。

## 明确证据

原 Repeat 按钮仅有 `aria-label="Repeat"`，没有 `onClick`。原项目已有 `likelist` 查询及仅添加收藏接口。

已安装 `NeteaseCloudMusicApi/module/like.js` 使用 `query.like == 'false'` 判断取消。传布尔 `false` 会被解释为添加；新服务向 SDK 传字符串 `'true'` / `'false'`，并要求返回 `code: 200` 才确认更新。

## 针对性验证

- `node src/services/netease/likeController.test.js`：7/7 通过。
- `node src/api/neteaseApi.test.js`：29/29 通过。
- `node server/netease/capabilityService.test.js`：18/18 通过。
- 相关新组件、控制器、API、服务、测试及 `server.js` 定向 ESLint 通过。
- `node --check server.js` 通过；相关文件 `git diff --check` 通过。

## 验证边界

不猜测本地歌曲的网易云对应歌曲；无明确网易云歌曲 ID 时红心禁用并显示原因。

后端已重启加载新路由。真实账号只读验证成功：登录有效，红心列表返回 412 首；网页底部已渲染心形按钮，对无网易云 ID 的默认歌曲正确禁用。添加/取消、红色状态、切歌与账号竞态通过模拟测试；没有为了测试修改真实网易云收藏，真实写入待用户点击验证。

2026-10-01 恢复服务后再次只读验证：登录有效，红心列表返回 413 首。最终正式网页正常启动，底部透明轮廓心渲染确认；当前本地曲未有网易云 ID，按既定规则禁用。未进行真实收藏写入。
