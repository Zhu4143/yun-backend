# Phase 3 Result: AudioEngine Foundation and Resource Ownership

Date: 2026-08-22  
Source branch: `feature/player-core-p1-consumers`  
Source/P1-A HEAD: `d2480b1c1e3e6b13cfec891eb72dfb059a054bf4`  
Work branch: `feature/player-core-p1-audio-engine`

## Baseline gate

P1-B began only after the P1-A commit was pushed, its GitHub Actions Verify run passed, local `npm run verify` passed, and the user confirmed the P1-A audible smoke test passed. The branch was created directly from the verified P1-A HEAD. The unrelated-history `main` branch was not fetched into the work, merged, rebased, or reset.

The pre-existing modifications under `server/data/` and all pre-existing untracked files were preserved and excluded from this migration.

## Resource ownership before migration

`useLocalPlayer` directly stored and created the active/standby `HTMLAudioElement` instances, the music `AudioContext`, master/music gain nodes, per-deck media sources and analysers, and their frequency/time-domain buffers. It also closed the context and paused the decks during hook cleanup.

This mixed real media-resource lifetime with playback state and orchestration. The existing WeakMap prevented duplicate `MediaElementSource` binding, but the resource contract and disposal behavior were private implementation details of a large React hook.

## Resource ownership after migration

| Concern | Owner |
| --- | --- |
| active/standby music Deck instances | one stable `AudioEngine` |
| main music `AudioContext` | `AudioEngine`, lazy and at most one live context per engine |
| master/music gain nodes | `AudioEngine` |
| per-Deck `MediaElementSource` and analyser | `AudioEngine`, one entry per Deck through a WeakMap |
| frequency/time-domain buffers | `AudioEngine`; imperative reads only |
| resource pause/disconnect/context close | `AudioEngine.dispose()` |
| current song, play state, time, duration and mode | `useLocalPlayer` |
| playlist, queue, up-next and auto-up-next | `useLocalPlayer` |
| next/previous/auto-next/tail-silence policy | `useLocalPlayer` |
| crossfade transaction, timing, progress and swap decision | `useLocalPlayer` |
| ducking token/policy decisions | existing `musicDuckingController` in `useLocalPlayer` |
| canonical command/state consumer contract | `PlayerCore`; state remains a projection |

There is still one real playback owner. No second player and no second PlayerState were introduced.

## AudioEngine API and rules

`src/player/audio/AudioEngine.js` is a plain JavaScript domain object with injected `audioFactory` and `audioContextFactory` seams for Node tests. Its constructor creates no browser resource. The current production API is limited to real consumers:

- Deck access and lazy creation: `getActiveDeck`, `getStandbyDeck`, `ensureActiveDeck`, `ensureStandbyDeck`.
- Existing-Deck order change: `swapDecks`; it creates nothing and never decides when a swap occurs.
- Graph lifecycle: `ensureGraphFor`, `resumeOutput`.
- Imperative analyser reads: `readFrequencyData`, `readTimeDomainData`.
- Resource application: `setUserVolume`, `setDuckingFactor`.
- Read-only diagnostics and lifecycle: `getDiagnostics`, `dispose`.

All music Deck sources and analysers share one main context and one music bus. Repeated `ensureGraphFor` calls for the same Deck reuse the same source/analyser entry, so a media element is not rebound through `createMediaElementSource`.

Deck volume continues to represent user volume and the crossfade envelope. The shared Web Audio `musicGain` continues to represent TTS ducking. FFT data is returned imperatively and is not written into React state, context state, or PlayerStore.

## Deck and disposal lifecycle

- The active Deck is created only when hard playback first needs it.
- The standby Deck is created only when preload or crossfade needs it.
- `useLocalPlayer` keeps the existing preload source/reset/volume behavior.
- `useLocalPlayer` still chooses when a crossfade starts, when it is cancelled, and when a Deck is promoted.
- A successful or promoted transition tells AudioEngine to swap its two existing Deck references; swap creates no media element.
- `dispose` pauses both Decks, disconnects per-Deck sources/analysers and shared gains, closes the main context, clears resource maps/references, and is idempotent.
- A disposed engine can lazily reactivate with fresh resources, which prevents a closed context from being retained across development lifecycle teardown/replay.

## Logic intentionally retained by useLocalPlayer

The migration did not move or redesign `playSong`, `playNext`, `playPrevious`, seek, ended/error recovery, queue selection, recommendation policy, tail-silence decisions, tempo ramp, or crossfade orchestration. `CROSSFADE_DURATION` remains `7000`, and the existing equal-power fade functions and transaction cancellation behavior are unchanged.

## PlayerCore boundary

PlayerCore remains the ordinary business command/state contract above `useLocalPlayer`. It does not store AudioEngine, raw media elements, `AudioContext`, Web Audio nodes, or FFT buffers. `yunLegacyPlayerAdapter` remains the commit-safe bridge and was not removed.

## Compatibility paths and deletion conditions

- `useLocalPlayer.audioRef` is now a stable, read-only-compatible facade whose `current` getter always resolves AudioEngine's current active Deck. Final owner: `AudioEngine`. Delete when `useYunVoice` no longer needs its raw-volume fallback and `usePlayerObserver` listens through an explicit active-Deck/event capability.
- `yunLegacyPlayerAdapter` remains the PlayerCore-to-hook transition bridge. Final owner: PlayerCore migration layer. Delete only after a later phase makes the canonical implementation satisfy all commands/state directly and tests prove no legacy consumer remains.
- `PlayerCore.getPlaybackDiagnostics` remains the existing read-only adapter passthrough. Final owner: current legacy orchestration diagnostics. Delete when a final diagnostics contract no longer requires the legacy passthrough.

The separate TTS `Audio` and speech `AudioContext` in `useYunVoice` are independent voice resources, not music Decks or fallback music players, and were intentionally left untouched.

## Tests and static contracts

AudioEngine fake-resource tests cover lazy singleton Deck creation, repeated ensure calls, one main context, one source per Deck, separate per-Deck analysers, frequency/time reads from the correct Deck, user-volume/ducking separation, suspended-context resume, allocation-free swap, full disposal, idempotent disposal, lazy reactivation, absence of FFT buffers from PlayerState, and absence of song/queue/mode business fields from AudioEngine.

Current automated results:

- `npm run lint`: PASS.
- `npm run test:player`: PASS, 22 tests.
- `npm run test:voice`: PASS, 6 tests.
- `npm run test:telemetry`: PASS, 21 tests.
- `npm run test:services`: PASS, 13 tests.
- `npm run test:discovery`: PASS, 2 tests.
- `npm run test:feedback`: PASS, 1 test.
- `npm run test:core`: PASS, 38 tests.
- `npm run test:moss`: PASS, 23 tests.
- Total tracked tests: 126 PASS.
- `npm run build`: PASS; the existing large-chunk warning remains.
- `npm run verify`: PASS, including all 126 tracked tests and production build.
- `git diff --check`: PASS.

## Human audible regression result

PASS — confirmed by the user on 2026-08-22.

- Normal play, pause/resume, seek, volume, previous and next passed.
- Natural ended, queue/up-next, the full seven-second crossfade, rapid repeated next, and next during crossfade passed.
- TTS ducking and post-TTS volume restoration passed.
- Lyrics synchronization, FFT-driven visuals, ParticleVinyl, track-change visuals, and continuous playback for at least three to five tracks passed.
- No double audio, sudden silence, reduced second-track volume, stuck post-crossfade volume, suspended-context silence, or sound/UI desynchronization was observed.

P1-B audible regression is accepted. P1-C has not been started.
