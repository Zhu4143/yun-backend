# Yun Core Stability Follow-up Handoff

## Starting point

- Repository: `C:\Users\zhudo\yun-liquid-ui-react`
- Branch: `feature/netease-capability-p2`
- Parent commit: `11eee2355ae6795dfd97af02a6a013ab8efe3884`
- Scope: memory cancellation and global Memory Off, Browser wake recognition queue, NetEase fetch/stream cancellation, and `/api/tts` boot health.

## Changes in this checkpoint

- Chat, mood recommendation, Companion tool-result, CowAgent, and Yun Agent request paths pass the turn AbortSignal into memory writes and await them before replying. Server-side memory settings persist `memoryEnabled` and `memoryMode`; memory APIs, default user memory, and the legacy static URL follow that policy.
- Browser fallback continues frame buffering and VAD while recognition is active. Complete speech segments wait in a serial queue. Wake thresholds and silence thresholds were not changed.
- NetEase fetch retries compose caller cancellation with timeout cancellation. The audio proxy ties fetch and stream work to request/response lifecycle cancellation.
- Boot loads the persisted memory policy before loading memory data. Its voice task probes `/api/tts/health`, reflecting the selected `/api/tts` provider; native playback is optional.
- CowAgent/Yun Agent recent-turn persistence skips writes while global memory is disabled and accepts the current request signal.

## Verification

- `npm.cmd run verify` passed on 2026-09-28, including lint, configured unit/integration tests, conversation E2E, and Vite production build.
- The Vite build emitted its existing bundle-size advisory.
- Targeted tests also passed for the memory write gate, fetch signal composition, serial Browser recognition, provider-specific TTS health, and Boot decisions.

## Boundaries and remaining runtime checks

- This work starts from `11eee2355ae6795dfd97af02a6a013ab8efe3884` and stays on `feature/netease-capability-p2`; it does not merge `main`.
- Particle-person visual files and user data are outside this repair. Existing dirty files in the worktree must remain unstaged unless separately requested.
- Wake threshold values remain unchanged. Physical microphone sensitivity/false-wake rates, live local TTS synthesis, and a real CDN disconnect during streaming need device/runtime verification.
