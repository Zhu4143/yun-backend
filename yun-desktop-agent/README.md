# Yun Desktop Agent

本地桌面 Agent，提供两类入口：

- WebSocket：给昀调用 Windows 桌面工具。
- HTTP：给电脑微信监听器转发命令。

## 启动 Agent

在项目根目录运行：

```bash
npm run server
npm run desktop-agent
```

默认监听：

```text
ws://127.0.0.1:3131
http://127.0.0.1:17890/api/wechat-command
```

可用环境变量：

```bash
YUN_DESKTOP_AGENT_HOST=127.0.0.1
YUN_DESKTOP_AGENT_PORT=3131
YUN_DESKTOP_AGENT_HTTP_PORT=17890
YUN_COMPANION_CHAT_URL=http://127.0.0.1:3030/api/companion-chat
YUN_WECHAT_ALLOWED_CONTACT=东宇
```

## 桌面工具

- `open_app`：打开 Windows 应用
- `set_volume`：调整系统音量
- `get_system_info`：获取当前音量和运行软件
- `close_app`：关闭应用

微信发送、打开聊天、OCR、Windows 通知读取工具仍保留为 fallback，但默认微信触发链路不再使用 Windows 通知或 OCR。

## 微信监听链路

新版微信使用声音触发模式：平时只监听微信进程的音频会话，不读取微信窗口；检测到微信提示音后，才打开/读取一次指定聊天。

链路：

```text
监听 Weixin/WeChatAppEx 提示音
↓
提示音触发后读取指定聊天最新消息
↓
判断有没有“昀”
↓
POST 到 yun-desktop-agent
↓
复用现有工具分发
```

### 第一步：登录电脑微信

请先登录新版电脑微信。

### 第二步：安装 Python 依赖

```bash
cd C:\Users\zhudo\yun-liquid-ui-react
pip install -r yun-desktop-agent/wechat-listener/requirements.txt
```

### 第三步：启动监听器

```bash
cd C:\Users\zhudo\yun-liquid-ui-react
npm run wechat-listener -- --contact 东宇
```

也可以直接运行 Python：

```bash
python yun-desktop-agent/wechat-listener/wechat_listener.py --contact 东宇
```

### 第四步：手机测试

用手机微信给电脑微信小号发：

```text
昀，查看系统状态
```

也支持：

```text
昀 查看系统状态
@昀 查看系统状态
昀帮我暂停音乐
```

如果 `pyweixin` 能直接读取聊天，就用 `pyweixin`；如果当前环境无法读取，监听器会在触发后做一次性 OCR fallback。它不再持续读取，也不需要一直打开讲述人。

监听器会转发：

```json
{
  "source": "wechat",
  "from": "东宇",
  "rawText": "昀，查看系统状态",
  "command": "查看系统状态"
}
```

Agent 收到后会调用现有 `/api/companion-chat`，继续复用原有音乐控制和桌面工具分发逻辑。

## 日志

监听器会输出：

- 微信监听器已启动
- 当前监听聊天：xxx
- 收到微信消息：xxx
- 命中唤醒词，转发给 Agent
- Agent 返回结果
