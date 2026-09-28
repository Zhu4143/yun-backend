## 2026-09-28 Core stability / wake pipeline repair checkpoint

Branch: feature/netease-capability-p2.

### Follow-up fixes from `11eee2355ae6795dfd97af02a6a013ab8efe3884`

- Current-turn memory updates in chat, mood recommendations, Companion tool results, and Yun/CowAgent commands now carry the request AbortSignal and finish before the HTTP response. Server settings persist `memoryEnabled`; memory reads/writes and default user-memory delivery follow the same policy, including the legacy static URL.
- Browser fallback keeps capturing and segmenting frames during recognition, queues complete segments, and processes them serially. Existing wake and silence thresholds are unchanged.
- NetEase fetch retries combine caller cancellation with per-attempt timeouts. The audio proxy passes the request signal to upstream fetches and cancels stream work when the client disconnects.
- Boot reads memory policy before memory content and checks `/api/tts/health`, which reports the provider selected by `/api/tts`; native playback remains optional.
- `npm.cmd run verify` passed on 2026-09-28. The build emitted the existing large-chunk advisory. The new tests cover memory policy and write awaiting, cancellation-aware retries, recognition serialization, TTS provider health, and Boot memory/voice decisions.
- No particle-person visuals were changed in this follow-up, and `main` was not merged. Physical microphone sensitivity and live local TTS/CDN disconnect behavior still require runtime checks.
- Follow-up handoff: [YUN_HANDOFF_2026-09-28-core-wake-memory-followup.md](./YUN_HANDOFF_2026-09-28-core-wake-memory-followup.md).

This checkpoint covers the boot dependency chain and degraded-provider behavior; response/session cancellation across chat, TTS, and HTTP requests; single-owner native/browser microphone fallback and command capture; memory prompt-off semantics and serialized atomic persistence; transactional Up Next queue consumption; and Electron backend identity, runtime environment, and per-user data setup.

- npm.cmd run verify passed on 2026-09-28, including lint, the full configured unit/integration suites, conversation E2E, and production build.
- npm.cmd run desktop:dist passed and produced a local 1.0.10 Windows installer. The installer is a local build artifact, not part of this source checkpoint.
- Wake thresholds were compared against the recorded historical implementations and left unchanged. Automated state and ownership checks passed; physical microphone sensitivity and false-wake rates still require a same-device test.
- Electron packages code and build metadata without bundling the repository's personal server/data files; runtime data and environment settings use Electron userData.
- Detailed continuation notes: [YUN_HANDOFF_2026-09-28.md](./YUN_HANDOFF_2026-09-28.md).

The verification section below records the earlier 2026-09-25 checkpoint and its then-current lint state; this 2026-09-28 checkpoint supersedes that state.

---

# Yun Music Project Progress — 2026-09-25

This is the public, repository-safe entry point for reviewing the current React/Vite and Electron music app.

## Read the correct branch

- Current app branch: [`feature/netease-capability-p2`](https://github.com/Zhu4143/yun-backend/tree/feature/netease-capability-p2)
- Latest app source commit at this checkpoint: [`f955332`](https://github.com/Zhu4143/yun-backend/commit/f95533244e63fa267605e8441bd9b61a3a9474f7)
- The repository's default `main` branch contains an older backend deployment with unrelated Git history. Reading `main` or requesting this document without its branch name will not show the current app.

Open this file with the branch in the URL: [`docs/PROJECT_PROGRESS.md` on the current app branch](https://github.com/Zhu4143/yun-backend/blob/feature/netease-capability-p2/docs/PROJECT_PROGRESS.md).

## Current implementation

- React/Vite UI, Node local backend, and Electron desktop shell.
- Local and NetEase playback with a canonical player queue. Sequence mode advances through the selected playlist; AI recommendations enter the next-track queue only in AI recommendation and companion continuation modes.
- Cover-reactive lyrics and metal visuals, smooth lyric transitions, adjustable Three.js lyric appearance, and beat-responsive highlights.
- Companion transitions use varied-length spoken remarks with music ducking and speech fade. Audio stalls and media errors have bounded recovery logic.
- Desktop startup checks both backend API health and a usable app page before reusing a running service.

## Verification at this checkpoint

- Boot tests: 26/26 passed.
- Desktop tests: 6/6 passed.
- Player tests: 53/53 passed, including sequence playback with a populated AI queue.
- Service tests: 131/131 passed.
- Visual and gesture tests: 8/8 each passed.
- Additional lyric, metal, companion, and crossfade tests: 24/24 passed.
- Vite production build passed. Full ESLint still reports four `react-hooks/set-state-in-effect` errors in `src/App.jsx`; they have not been fixed or waived.
- Browser smoke test: in sequence mode, Next advanced from local-library track 35 to adjacent track 36. This does not establish live NetEase playback for every track.

## Scope and privacy

This branch contains the committed app source and tests. Local song metadata changes, personal memory, login material, model weights, voice samples, generated installers, historical drafts, and experiment files were not uploaded as part of this checkpoint. The previously built installer predates the latest playback fix; no new installer or GitHub release was published here.
