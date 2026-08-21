# Phase 2 Result: PlayerCore Consumer Cutover

## Baseline

- Source branch: `feature/yun-telemetry-p0`
- Source HEAD: `5f9d2e3226beff6d31b1e29d3962b8fab84cce00`
- Work branch: `feature/player-core-p1-consumers`
- P0 baseline supplied by the user: `npm run verify` PASS, 111 tests PASS, production build PASS, GitHub Actions Verify PASS, manual playback/audio/UI smoke test PASS.
- Existing modified data files and untracked files were preserved and excluded from this phase.

## Ownership before this phase

`useLocalPlayer` already owned every real playback resource and state. `PlayerCore` was a commit-safe projection, but App still destructured ordinary state and commands from the legacy return object. App also passed either the complete legacy object or an ad-hoc legacy-shaped player object to chat, Agent, and CowAgent consumers. `PlayerProvider` existed, but no product component consumed `usePlayer()`.

## Completed cutover

- Added canonical Track/Queue/Playback commands required by current consumers:
  - `playTrackFromQueue`
  - `setPlaybackQueue`
  - `clearPlaybackQueue`
  - `setQueuedNextTrack`
  - `enqueueUpNext`, `removeUpNext`, `clearUpNext`
  - `setAutoUpNext`, `removeAutoUpNext`, `clearAutoUpNext`
- Retained one explicitly transitional read-only `getPlaybackDiagnostics` passthrough so the existing Agent state action keeps its behavior. `useLocalPlayer` remains its owner; its removal condition is the later AudioEngine diagnostics contract.
- App ordinary state now comes from the render-safe `playerState` projection: `currentTrack`, `isPlaying`, `playbackMode`, `upNext`, and `autoUpNext`.
- App ordinary playback, track selection, queue, up-next, AI queue, keyboard, seek, volume, and playback-mode commands now call the single `playerCore` instance.
- `useYunChat`, `chatIntentRouter`, `radioEngine`, `useYunAgent`, `yunAgentActions`, and the existing CowAgent bridge now receive the canonical PlayerCore command/state contract.
- Response mode remains a separate non-player callback instead of being added to PlayerCore.
- `FloatingLyrics` is the first lower React consumer to read ordinary playback state through `usePlayer()`. Its lyric lookup, timing, flow, and visual code were not changed.

## Dependency map after this phase

### PlayerCore consumers

- App ordinary playback display and controls
- App track/queue/up-next/auto-up-next operations
- `FloatingLyrics` ordinary track/time/play state
- `useYunChat` and `chatIntentRouter`
- `radioEngine`
- `useYunAgent` and `yunAgentActions`
- CowAgent action execution

### Intentional legacy boundary

- `usePlayerObserver(useLocalPlayer(...))` observes the actual owner so telemetry can preserve method and natural-end semantics.
- `yunLegacyPlayerAdapter` translates canonical names to the current `useLocalPlayer` implementation and projects its state after commit.
- `lastAutoNextSong` remains a legacy one-shot transition signal because it is not canonical PlayerState and currently drives podcast reaction behavior.
- `getPlaybackDiagnostics` remains a read-only adapter passthrough for the existing Agent state action until AudioEngine ownership migration defines the final diagnostics contract.

### Audio-engine-only capabilities

- `audioRef`
- `musicDuckingController`
- `readAudioFrequencyData`
- active/standby audio elements
- Web Audio graph and `AudioContext`
- crossfade transaction and tail-silence analysis

These remain owned by `useLocalPlayer` and were not moved into React state.

## Ownership after this phase

| Concern | Owner |
| --- | --- |
| `currentTrack` source of truth | `useLocalPlayer`; PlayerCore store is a projection |
| `isPlaying` source of truth | `useLocalPlayer`; PlayerCore store is a projection |
| queue / up-next / auto-up-next | `useLocalPlayer`; PlayerCore delegates commands and projects state |
| Audio elements | `useLocalPlayer` |
| AudioContext / Web Audio graph | `useLocalPlayer` |
| crossfade | `useLocalPlayer` |
| ducking | `useLocalPlayer` / `musicDuckingController` |
| PlayerCore store | commit-safe external-store projection; not an independent playback owner |

Only one `useLocalPlayer` and one `PlayerCore` are instantiated.

## Static audit

App direct-call counts from baseline to Phase 2:

| Pattern | Before | After |
| --- | ---: | ---: |
| `legacyPlayer.` | 0 | 0 |
| `playSong(` | 1 | 0 |
| `playSongFromQueue(` | 1 | 0 |
| `playNext(` | 0 | 0 |
| `playPrevious(` | 0 | 0 |
| `seekTo(` | 0 | 0 |
| `togglePlayPause(` | 1 | 0 |
| `pausePlayback(` | 0 | 0 |

The `legacyPlayer` token count fell from 7 to 5. The five remaining occurrences are only its declaration, the explicit audio-only/transition capability destructure, render projection, commit binding, and effect dependency. App no longer passes `legacyPlayer` to business consumers.

## Verification

- `npm run lint`: PASS
- `npm run test:player`: PASS, 13 tests
- `npm run test:voice`: PASS, 6 tests
- `npm run test:telemetry`: PASS, 21 tests
- `npm run test:services`: PASS, 13 tests
- `npm run test:discovery`: PASS, 2 tests
- `npm run test:feedback`: PASS, 1 test
- `npm run test:core`: PASS, 38 tests
- `npm run test:moss`: PASS, 23 tests
- Total tracked tests: 117 PASS
- `npm run build`: PASS; Vite retained the pre-existing large-chunk warning.
- `npm run verify`: PASS

## Architecture guard

- No second player or PlayerState owner was introduced.
- No `new Audio()` or `AudioContext` was added.
- Crossfade, ducking, analyser, tail-silence, and playback-rate internals were not rewritten.
- `CROSSFADE_DURATION` was not changed.
- No CSS, shader, particle, vinyl, SonicTopography, FlowField, TTS, ASR, wake-word, barge-in, recommendation/provider, persona, memory, MOSS, CowAgent, server, or Electron behavior was redesigned.

## Human verification

NEEDS HUMAN AUDIBLE SMOKE TEST

- play / pause
- select a track
- next / previous
- seek
- natural `ended` to next
- 7-second crossfade
- queue to next
- manual up-next
- playback-mode switch
- TTS ducking
- lyric synchronization
- ParticleVinyl track-change animation

## Next phase only

P1-B should first define an AudioEngine ownership contract and migration sequence for media elements, Web Audio, crossfade transactions, analyser access, ducking, and diagnostics. Do not move those resources until that contract and audible regression plan are approved.
