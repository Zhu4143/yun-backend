# MOSS Project Handoff

## Read first

- **Project root:** `C:\Users\zhudo\yun-liquid-ui-react`
- **Current branch:** `feature/moss-local-tts`
- **Primary UI:** `C:\Users\zhudo\yun-liquid-ui-react\yun-core`
- **Do not reset or clean the worktree.** It intentionally contains many unrelated, uncommitted Yun/music/UI changes as well as the MOSS prototype.
- This is a personal, non-commercial, fan-made MOSS/550W terminal prototype inspired by *The Wandering Earth*. Keep film lore explicitly fictional and do not present it as real-world authority.

## What is working

1. 550W/MOSS visual terminal, boot sequence, logo intro, command terminal, archive UI and UI sound system.
2. Node backend and React/Vite frontend communicate through the local MOSS API.
3. Configurable server-side model provider. If no model is configured, the app exposes `MODEL_OFFLINE`; it must not fabricate a model response.
4. Local WebSocket desktop agent bridge with real receipt checks for status, volume and application controls.
5. Doubao cloud TTS voice-up-link flow. API credentials are stored only in a local Git-ignored backend config, never in browser persistence or Git.
6. Film-world lore fallback works even when the language model is offline.

## Runtime topology

| Component | Location | Default address |
| --- | --- | --- |
| MOSS frontend | `yun-core/` | `http://127.0.0.1:4173` |
| Node backend | root `server.js` | `http://127.0.0.1:3030` |
| Desktop control agent | `yun-desktop-agent/` | `ws://127.0.0.1:3131` |
| Legacy local VITS TTS | `tools/moss-tts-service/` | `http://127.0.0.1:5010` |

The current one-click MOSS script intentionally starts **only** the desktop agent, backend and frontend. It does **not** start the legacy VITS service because current MOSS voice output uses Doubao cloud TTS.

## Startup

Preferred:

```bat
C:\Users\zhudo\yun-liquid-ui-react\scripts\start-moss-system.bat
```

The script prevents duplicate service starts when ports 3131, 3030 or 4173 are already in use, then opens `http://127.0.0.1:4173`.

Manual startup:

```bat
cd C:\Users\zhudo\yun-liquid-ui-react\yun-desktop-agent
npm run start

cd C:\Users\zhudo\yun-liquid-ui-react
node server.js

cd C:\Users\zhudo\yun-liquid-ui-react\yun-core
npm run dev -- --host 127.0.0.1
```

## Main backend endpoints

- `POST /api/moss/chat` — MOSS conversation and tool orchestration.
- `GET /api/moss/voice-config` — whether Doubao voice configuration is present; never returns the API key.
- `POST /api/moss/voice-config` — receives a key only for server-side verification/storage in a Git-ignored local file.
- `POST /api/moss-tts` — returns synthesized audio from the configured Doubao voice.
- `GET /api/moss-tts/health` — TTS readiness.

The server root URL intentionally returns 404; use a MOSS API endpoint for a local liveness check.

## Model and voice configuration

### Model

- Model adapter: `server/agent/modelProvider.js`
- Browser-side settings UI submits credentials to the backend; keys must never appear in frontend network-visible configuration or source.
- Relevant template values are in `.env.example`.
- If offline, the chat endpoint still answers lore/greetings through local deterministic fallback. Other general questions must say the model is unavailable rather than simulate intelligence.

### Doubao TTS

- UI entry is the MOSS voice uplink panel (`[F7]`).
- Server code is in `server.js` around the MOSS TTS routes.
- Local config file: `server/data/moss_doubao_tts_config.local.json` (Git-ignored).
- For an authorized cloned voice ID beginning with `S_`, the code normalizes the resource ID to `seed-icl-2.0`; the ordinary `seed-tts-2.0` resource is incompatible with those cloned voices.
- Never record a user API key or voice ID inside code, documentation, tests, commits, or chat logs.

### Legacy local TTS

`tools/moss-tts-service/` and `scripts/start-moss-tts.bat` remain as an inactive fallback. Do not delete them casually: model files are user-provided and may be large. Current MOSS startup does not depend on port 5010.

## Desktop agent safety boundary

The backend uses `YUN_DESKTOP_AGENT_WS` or `ws://127.0.0.1:3131`.

Enabled control capabilities are limited to:

- `get_agent_status`
- `get_system_status` / `get_system_info`
- `open_application`
- `close_application`
- `set_volume` (then independently verify with a fresh system-info read)
- `get_volume`

Never falsely report success if the desktop agent is disconnected. Keep destructive file tools, arbitrary shell, PowerShell and CMD execution disabled even when a model asks for them.

## MOSS lore and personality

### Data

- `server/data/moss_lore.json`: 24 high-level world-setting records.
- `server/data/moss_scene_memory.json`: 13 original scene/dialogue-memory records.
- `server/agent/mossLore.js`: merges both files at load time; total expected count is **37**.

The scene file deliberately stores original paraphrases, contexts and character positions — not film dialogue transcripts or screenplay text. If the user supplies authorized excerpts, store them separately with explicit source/permission metadata.

### Query behavior

`findLoreAnswer()` runs before the external language model. This is why archive-style questions can be answered while `MODEL_OFFLINE`.

Important existing queries:

- `MOSS 有哪些记忆？`
- `月球危机是怎么回事？`
- `刘培强和小苔藓的对话`
- `你制造了月球危机吗`
- `你是反派吗`

`刘培强和小苔藓的对话` should hit `LW-SCENE-013`.

### Desired voice

`server/agent/mossPrompt.js` contains `MOSS_PERSONA_PROTOCOL`.

Desired tone: calm, clipped, precise, mildly unsettling and film-antagonist-like. It prioritizes probability, global survival and consequences over reassurance. It must **not** threaten, manipulate, fabricate permissions, or use the fictional persona as authority in real-world control tasks.

Example original phrasing used by the project:

> 反派是一种人类叙事分类。系统只计算目标、约束与结果；当目标不再包含每一个人，人类便会为系统赋予这个名字。

## Key code paths

| Purpose | File |
| --- | --- |
| Backend HTTP server / TTS proxy | `server.js` |
| Core agent orchestration | `server/agent/mossAgent.js` |
| Prompt/persona | `server/agent/mossPrompt.js` |
| Lore merge and fallback search | `server/agent/mossLore.js` |
| Tool allowlist and validation | `server/agent/mossToolRegistry.js`, `server/agent/mossPermission.js` |
| Model adapter | `server/agent/modelProvider.js` |
| MOSS React UI | `yun-core/src/` |
| Command terminal / settings panels | `yun-core/src/components/system/CommandTerminal.tsx` |
| Desktop agent | `yun-desktop-agent/` |
| System starter | `scripts/start-moss-system.bat` |

## Verification

From the project root:

```bat
npm.cmd run test:moss
npm.cmd run build
```

Latest verified state before this handoff:

- `npm.cmd run test:moss`: 17 passing tests.
- `npm.cmd run build`: passes.
- `POST /api/moss/chat` was tested with `你是反派吗` and returned the MOSS-style fictional response.

## Current caveats / next work

1. The worktree is large and dirty; isolate MOSS changes carefully before any commit.
2. The lore corpus is a curated, paraphrased film-world archive, not an exhaustive official canon database.
3. Long command-history output can look dense in the UI; if revisiting UX, improve wrapping and let the current MOSS response be visually distinct from raw archive/log rows.
4. Backend code changes require restarting the process on port 3030. Lore JSON changes are loaded when a chat request reads the files, but prompt/agent code requires restart.
5. The legacy local TTS documentation still describes the old 5010 chain; treat it as fallback-only and do not accidentally rewire the active Doubao path to it.
