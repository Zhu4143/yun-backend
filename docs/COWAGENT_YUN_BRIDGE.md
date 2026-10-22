# CowAgent × 昀微信桥接

CowAgent 负责微信收发；昀负责陪伴人格、音乐理解和本机播放器执行。两者必须运行在同一台 Windows 电脑上。

## 使用方式

在微信里对 CowAgent 说：

```text
昀，播放我的跑步歌单
@昀 换一首
小昀，给我准备一组雨天歌
```

没有 `昀，`、`@昀` 或 `小昀，` 前缀的消息不应转发给昀。

## 在 CowAgent 中创建技能

在 CowAgent 的“技能”中创建一个本机 HTTP 技能，并使用下列规则：

```text
技能名：昀音乐陪伴

仅当微信消息以“昀，”“@昀”或“小昀，”开头时调用本机接口。
把原始消息原样作为 message 发送，sender 填微信发送者昵称，sessionId 使用稳定的会话 ID。

POST http://127.0.0.1:3030/api/yun/cowagent/command
Content-Type: application/json

{
  "message": "{{原始微信消息}}",
  "sender": "{{发送者昵称}}",
  "sessionId": "{{稳定会话ID}}"
}

将响应中的 reply 原样回复到微信。
若 accepted 为 false，将响应中的 message 回复给用户。
不要自行搜索或决定歌曲；播放、队列和网易云操作全部交给昀。
```

示例请求：

```powershell
Invoke-RestMethod -Method Post 'http://127.0.0.1:3030/api/yun/cowagent/command' `
  -ContentType 'application/json' `
  -Body '{"message":"昀，播放我的跑步歌单","sender":"东宇","sessionId":"wechat-dongyu"}'
```

## 执行条件与状态

提交成功仅代表昀已理解并排队。真正的播放动作由已打开的昀网页领取执行，因此电脑上必须同时运行完整昀服务并打开网页：

```powershell
npm run yun:start:no-wechat
```

可选地查询执行结果：

```text
GET http://127.0.0.1:3030/api/yun/cowagent/jobs/{job.id}
```

所有桥接接口仅监听本机 `127.0.0.1`。不要把 3030 端口映射到公网，也不要把网易云 Cookie、DeepSeek Key 或 `.env` 内容填入 CowAgent。
