# Phase 0 Baseline

Date: 2026-07-02  
Branch: `feature/player-core-foundation`  
Scope: pre-PlayerCore runtime and source baseline. No runtime code was changed while collecting this record.

## Commands and startup

- `npm run build`: passed with Vite 8.0.16; 595 modules transformed. The main JS bundle was approximately 1.23 MB (361.91 KB gzip). Vite reported no build error.
- `npm run lint`: failed on a pre-existing rule violation in `liquid-glass-settings-demo/src/UnifiedLiquidGlass.jsx:172` (`react-hooks/set-state-in-effect`). This file is outside the production player path and was not changed.
- Existing local services were already running before the baseline: Vite at `http://localhost:5173` and the Yun backend at `http://localhost:3030`.
- The browser loaded the page successfully. The backend returned a local library of 211 tracks.

## Playback controls

- Selecting `就忘了吧` changed the current title/artist to `就忘了吧 / 1K` and loaded duration `03:23`.
- Next changed the current track to `Clean Bandit Rather Be Without Me` with duration `03:44`.
- Previous returned to `就忘了吧`.
- Pressing ArrowRight on the progress control advanced the displayed time from `00:00` to `00:05`.
- Play/pause controls remain delegated to `useLocalPlayer.togglePlayPause()`.
- Ended behavior is implemented by `handleEnded()` in `src/hooks/useLocalPlayer.js`: it clears playing state and calls `playNext({ auto: true })` unless a crossfade is already active.
- The in-app automation surface confirmed track selection, metadata, next, previous, and seek state changes. It did not expose audible output, so listening quality, pause acoustics, and natural ended playback are source-confirmed but require a human speaker/headphone smoke test for final acceptance.

## Existing dual-Deck crossfade

- `CROSSFADE_DURATION = 7000` ms.
- `MIN_CROSSFADE_DURATION = 1200` ms.
- Incoming Deck starts at `CROSSFADE_START_VOLUME = 0.03` of target volume.
- `crossfadeToSong()` uses equal-power sine/cosine curves and swaps `audioRef`/`standbyAudioRef` only after the fade completes.
- A recovery timer completes the swap at fade duration + 350 ms.
- Explicit previous uses the hard-play path; next and the automatic sequence path request crossfade.
- No timing, curve, Deck, or volume behavior was modified in Phase 0.

## Particle vinyl and visual transition

- `ParticleVinylBackground` receives `active={isPlaying}` and a track key derived from the current song.
- Playing state drives the vinyl shader's `uPlaying` interpolation and audio sampling; paused state smoothly reduces the reactive amount.
- A song change resets `songTransitionRef` to 0. The shader advances it at `delta * 0.5`, giving an approximately two-second particle disassembly/reassembly envelope.
- The song-transition shader mixes galaxy, petal, and tidal positions, with depth scatter and cover mixing. These shader values were not changed.

## Cover color and global optical field

- `useSongTheme(backgroundCoverUrl)` extracts the selected cover palette and publishes song theme values to the root app style.
- The same current-song cover is passed to the particle background.
- `FlowFieldBackground` uses the resolved track key and has `TRANSITION_DURATION = 2.35` seconds for palette/burst continuity.
- The browser baseline showed title, mood tags, lyrics, cover-driven scene, and current-track metadata change together after selecting a track.
- No CSS variable, glass material, optical-field, cover-color, or animation parameter was changed.

## Lyrics

- `FloatingLyrics` owns its current Phase 0 request flow.
- Local tracks use `fetchSongLyrics`; NetEase tracks use `fetchNeteaseLyrics`.
- The request is keyed by current song identifiers and the component derives the active line from `currentTime`.
- Selecting `就忘了吧` displayed its synced lyric rows in the `滚动歌词` region.
- Phase 1 must not move or rewrite this request path.

## Chat, music intent, and TTS ducking

- `useYunChat` receives the original legacy player object from `App.jsx` and delegates intent handling to `chatIntentRouter`.
- TTS remains owned by `useYunVoice`; its speech `Audio` and music ducking behavior are unchanged.
- Ducking targets the current legacy `musicAudioRef`, fades down through `startDucking`, and restores through `stopDucking`/cleanup.
- Phase 1 must not route chat, TTS, or ducking through PlayerCore.

## Existing console and static-analysis issues

- Browser console baseline: three repeated warnings, `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` No browser console error was observed during the baseline interactions.
- Lint baseline: one existing error in the standalone liquid-glass demo, described above.
- Initial track selection did not advance audible playback in the automation environment even after a Play click; no console error was emitted. Control-state verification therefore distinguishes browser-observable behavior from human-audible verification.

## Phase 0 freeze rule

The following are frozen for Phase 1: `useLocalPlayer` Deck internals, crossfade constants and curves, audio event wiring, particle/shader values, App CSS, glass material, layout, global light field, lyric request logic, chat/AI control, TTS, and ducking.
