# 昀音乐 · YUN

React、Vite 和 Electron 音乐播放器，提供透明果冻液态玻璃界面、沉浸唱片与歌词，以及本地音乐和网易云入口。

当前源码位于 [`feature/netease-capability-p2`](https://github.com/Zhu4143/yun-backend/tree/feature/netease-capability-p2)。Windows 安装包见 [Releases](https://github.com/Zhu4143/yun-backend/releases)。

## 1.0.11

- 桌面与窄屏布局、日间和夜间模式。
- 实体唱片、液态矿脉背景及可保存的视觉调节。
- 跟随播放进度的歌词扫色、辉光、渐变、重影和按歌曲风格切换的字体。
- 右侧透明悬浮待播列表，歌词同时显示，主布局保持不动。
- 主播放条与沉浸播放条连续推进，支持副歌位置标记。
- 播放连接恢复、切歌过渡和异步请求取消方面的修复。

## 本地开发

需要 Node.js 22.12 或更新版本及 npm。Windows PowerShell 可使用 `npm.cmd`。

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

在两个终端分别运行：

```powershell
npm.cmd run server
```

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

打开 Vite 输出的 HTTP 地址。直接双击 `index.html` 不会启动应用。

本地音频由使用者导入，或通过本机 `.env` 的 `MUSIC_DIR` 配置；安装包不附带音乐库。在线歌曲的可用性取决于来源服务与账号权限。陪伴聊天和语音按需配置对应 API 或本地服务，API 密钥只放在本地 `.env` 中。

## 验证与 Windows 打包

```powershell
npm.cmd run verify
npm.cmd run desktop:dist
```

安装程序输出到 `release/Yun-Setup-<版本>.exe`。桌面程序启动自己的本地后端；安装后的账号、设置与记忆保存在 Electron 用户数据目录，升级时沿用已有数据。

源码与安装包排除 `.env`、网易云 Cookie、聊天记忆、音乐库索引、私人封面缓存及模型权重。项目内的历史提交保持原样；停止跟踪运行数据不会删除过去的 Git 记录。

字体分片与 OFL 许可证在 [`public/fonts/lyrics`](public/fonts/lyrics/README.md)，字体下载脚本为 [`tools/vendor-lyric-fonts.ps1`](tools/vendor-lyric-fonts.ps1)。唱片界面保留原设计来源标注。
