# 昀启动链与桌面运行时

## 启动依赖

`BACKEND_HEALTH` 是启动服务的前置条件。`LOAD_SETTINGS` 和网易云 provider 初始化都只依赖它；本地曲库只依赖设置读取，因此网易云不可用不会挡住曲库、播放器核心或播放状态恢复。

```text
BOOT_CONFIG
└─ BACKEND_HEALTH
   ├─ LOAD_SETTINGS ── LOAD_LIBRARY ── INIT_PLAYER_CORE ── RESTORE_PLAYER
   │                   └─ PRELOAD_COVERS (optional)
   ├─ INIT_MUSIC_PROVIDER (optional) ── LOAD_PLAYLISTS (optional)
   ├─ LOAD_MEMORY (optional)
   ├─ INIT_COMPANION (optional)
   └─ INIT_TTS (optional)
```

provider 或歌单任务失败时，BootManager 记录 warning，界面继续使用本地音乐，并显示网易云降级提示。重试属于各自任务，不会重跑已经成功的本地库任务。

## 记忆开关语义

- 当前对话历史仍作为当前轮次的 conversation context。
- “允许使用本地记忆”关闭，或记忆模式设为“安静模式”时，后端 prompt 不接收近期陪伴记忆和长期记忆；近期和长期记忆写入也关闭。
- 关闭记忆会取消当前对话请求。静默模式跳过歌曲理解与重复回复改写；只有明确的记忆命令仍执行必要的记忆判断。
- 长期记忆更新在 HTTP 响应前结算，取消信号会传到提取模型和串行写入操作，避免响应结束后的后台写入。

## Electron 数据与版本

- Electron 数据目录：`app.getPath('userData')/data`，通过 `YUN_DATA_DIR` 传给后端。
- 用户设置、曲库、记忆、网易云 cookie 和运行时 `.env` 都在数据目录。打包配置排除 `server/data/**`，只打包程序代码和 build metadata。
- 启动时仅在目标文件不存在时，迁移旧 `.env` 和列出的 JSON/cookie 文件；已有用户数据优先保留。迁移使用独占复制，不删除旧文件。
- `/api/health` 提供 `service`、`apiVersion`、`appVersion` 和 `buildHash`。桌面端只复用 API 版本匹配且提供应用 HTML shell 的旧服务；发现不兼容服务时，在空闲端口启动自己的服务并显示提示。
- `desktop:pack` 与 `desktop:dist` 会先生成 `build/build-info.json`，再构建目录版或 Windows NSIS 安装包。

## 发布检查

```powershell
npm.cmd run lint
npm.cmd run verify
npm.cmd run desktop:dist
```

安装包构建后应核对 `release/Yun-Setup-1.0.10.exe` 的时间戳，以及启动后“记忆设置”页显示的应用版本、API 版本和 build hash。build hash 带 `-dirty` 表示打包时 Git 工作树存在已跟踪改动。
