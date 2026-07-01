# Phase 1 Result: PlayerCore Foundation

Date: 2026-07-02  
Branch: `feature/player-core-foundation`  
Scope completed: Phase 0 and Phase 1 only.

## 1. New files

- `src/player/PlayerCore.js`: stable command and state-subscription facade.
- `src/player/playerStore.js`: minimal external-store primitive with `getState`, `subscribe`, `replaceState`, and explicit notification flushing.
- `src/player/playerTypes.js`: Phase 1 status constants and minimal initial state.
- `src/player/adapters/yunLegacyPlayerAdapter.js`: projects the legacy hook result into PlayerState and delegates every command back to the legacy hook.
- `src/player/react/PlayerContext.js`: isolated React context.
- `src/player/react/PlayerProvider.jsx`: provider for later consumer adoption.
- `src/player/react/usePlayer.js`: `useSyncExternalStore` consumer hook plus core accessor.
- `docs/migration/PHASE_0_BASELINE.md`: frozen pre-change baseline.
- `docs/migration/PHASE_1_RESULT.md`: this result record.

## 2. Modified files

- `src/App.jsx` only.

No Phase 1 edit was made to `src/App.css`, `src/hooks/useLocalPlayer.js`, `server.js`, `package.json`, shaders, particle components, lyric components, chat hooks, TTS, or ducking.

The worktree already contained many modified and untracked files before the branch was created. Git therefore shows unrelated pre-existing diffs against HEAD; they were preserved and not cleaned, staged, or rewritten.

## 3. Purpose of the App change

- Calls the existing `useLocalPlayer(libraryTracks)` exactly once as before.
- Creates one stable `yunLegacyPlayerAdapter`/PlayerCore instance.
- Projects the current legacy hook result into the minimal PlayerState.
- Provides the core through `PlayerProvider` for incremental later adoption.
- Routes only the requested controls through PlayerCore: play/pause, next, previous, and seek.
- Reads PlayerCore state only for the requested display consumers: player title/artist/cover, progress/time, play/pause label, and particle-vinyl `active`/track key.
- Keeps direct legacy references for lyrics, color calculation, AI/chat, TTS, ducking, and high-frequency audio data.

## 4. State still owned by the legacy system

`useLocalPlayer` remains the sole owner of:

- `currentSong` and `currentSongRef`
- `isPlaying`
- `currentTime`
- `duration`
- `playbackMode`
- active/standby Audio elements
- crossfade token, frame, timing, curves, and Deck swap
- AudioContext/analyser creation and frequency reads
- playlist reference and automatic ended/next behavior

PlayerCore does not set a second `currentTrack` or `isPlaying`. Its store is a read-only projection of the latest legacy hook render. There is no independent track/play state setter in the adapter.

Phase 1 `volume` is read from the current legacy Audio element when available, otherwise it retains the initial value `1`. `status` is derived from legacy track/play/duration state. `error` is adapter command metadata; it does not control legacy playback.

## 5. Consumers connected to PlayerCore

- Main play/pause button command and label.
- Main previous/next button commands, while retaining the existing song-reaction callback wrapper.
- Progress click/ArrowLeft/ArrowRight seek commands and displayed time/progress.
- Main current-track title, artist, and cover.
- Particle vinyl current track key and active/playing flag.

## 6. Consumers intentionally not connected

- `FloatingLyrics` request and active-line flow.
- `useSongTheme` and cover-color/global light-field calculation.
- `SonicTopography` and high-frequency analyser reader.
- `FlowFieldBackground` transition ownership.
- `useYunChat`, `chatIntentRouter`, and their player object.
- `useYunVoice`, TTS Audio, ducking, and direct legacy `audioRef`.
- Library/memory-strip track-selection buttons.
- Queue, lyrics, dominant color, audio features, and track-change progress state.
- Any AudioEngine, provider, Electron, QQ, Mineradio, or beat-analysis work.

## 7. Test results

### Passed

- `npm run build`: passed after the change; 601 modules transformed.
- `npx eslint src/player src/App.jsx`: passed with zero errors/warnings.
- Adapter delegation test with a fake legacy hook contract: passed for snapshot projection, one subscription notification, cleanup, toggle, next, previous, and seek delegation.
- Browser startup: passed; page loaded and displayed 211 local tracks.
- Track metadata projection: selecting `就忘了吧` displayed `就忘了吧 / 1K / 03:23` through the PlayerCore-backed player metadata.
- Next through PlayerCore: changed to `Clean Bandit Rather Be Without Me / 03:44`.
- Previous through PlayerCore: returned to `就忘了吧 / 03:23`.
- Seek through PlayerCore: ArrowRight changed display from `00:00` to `00:05`.
- StrictMode: no duplicate PlayerCore listener or repeated control invocation was observed. The adapter owns no DOM/audio listener and cleanup only clears store subscribers; it never destroys legacy audio resources.
- Static constructor scan: no `new Audio`, `new AudioContext`, `webkitAudioContext`, or `createMediaElementSource` was added under `src/player`.
- Mineradio fingerprint scan: no Mineradio name, owner, `playQueueAt`, Electron IPC channel, QQ adapter, or copied source appeared under `src/player`.
- Production CSS output size remained unchanged at 98.61 KB; no CSS file was edited.

### Preserved by unchanged implementation; human audible smoke test still required

- Play/pause acoustics.
- Natural ended-to-next transition.
- Seven-second equal-power dual-Deck crossfade and absence of double audio.
- Subjective crossfade feel.

The in-app browser automation surface did not expose audible output and kept the play label paused during both the Phase 0 and Phase 1 audio attempts, without a console error. It could therefore validate state/control routing but cannot honestly certify what a human hears. The relevant legacy code, event wiring, constants, Deck creation, and crossfade implementation have byte-for-byte remained outside this Phase 1 patch.

## 8. Console changes

- Before: three repeated `THREE.Clock` deprecation warnings; no runtime error.
- After: the same three `THREE.Clock` warnings; no new warning or runtime error during startup, track selection, next, previous, and seek.
- Full repository lint still has the pre-existing standalone demo error at `liquid-glass-settings-demo/src/UnifiedLiquidGlass.jsx:172`. Phase 1 did not modify that demo.

## 9. Git diff summary

Phase-owned change set:

- One existing runtime file changed: `src/App.jsx`.
- Seven PlayerCore foundation files added under `src/player`.
- Two migration records added under `docs/migration`.
- Zero CSS, shader, audio-hook, server, package, Electron, provider, or Mineradio files changed by this phase.

The branch was created from a dirty worktree, so repository-wide `git diff --stat` also includes the user's earlier unrelated work. This report lists only files changed by Phase 0/1 work.

## 10. Next-stage recommendation

Stop here. Before authorizing Phase 2, run one short human audible smoke test on this branch:

1. Select a local track and verify play/pause.
2. Trigger next while playing and listen through the full seven-second crossfade.
3. Trigger previous, seek, and a natural ended transition.
4. Confirm one audible program, unchanged particle disassembly/reassembly, unchanged cover/light transition, synchronized lyrics, and unchanged TTS ducking.

Do not begin lyric, AI, AudioEngine, provider, beat-analysis, or Electron migration until that audible sign-off is recorded.
