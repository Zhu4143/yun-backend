# Phase 4 Result: Crossfade Transaction Orchestration

## Baseline

- Source branch: `feature/player-core-p1-audio-engine`
- Verified source HEAD: `227b2137516b786d1d0dd1f8df4a5ddd41c1f843`
- Working branch: `feature/player-core-p1-crossfade`
- P1-B automated verification, GitHub Actions and audible regression were green before this phase.

## Before ownership

`useLocalPlayer` owned both playback policy and the complete imperative transition lifecycle. In addition to deciding the target song, queue behavior and playback mode, it held the crossfade transaction, token, animation frames, recovery timer, tempo ramp, stale standby play guard, envelope execution, cancellation and Deck swap.

This mixed 60 fps resource orchestration with React hook business state and made cancellation correctness depend on several related refs being updated together.

## CrossfadeController design

`src/player/transition/CrossfadeController.js` is a pure JavaScript imperative domain object. It has no React, PlayerCore, chat, AI, provider or recommendation dependency. It receives the existing `AudioEngine` and an optional scheduler. Production uses browser RAF/timers; unit tests inject a deterministic fake scheduler and never wait for the real seven-second blend.

The controller is instantiated once with lazy React state in `useLocalPlayer` and disposed on hook unmount. It does not create or own `Audio`, `AudioContext`, analyser, gain or media-source resources.

The hook effect explicitly reactivates the stable instance during every committed setup. This is required because React StrictMode replays setup, cleanup and setup without replacing lazy state objects.

## Cold-start regression correction

The first P1-C audible pass exposed a development StrictMode regression. The replay cleanup called `CrossfadeController.dispose()`, which marked the stable controller as disposed. The replay setup did not reactivate it. Consequently the first ordinary `pausePlayback()` called `cancel({ pauseActive: true })` on a disposed controller and returned without pausing the real active Deck. The first later crossfade appeared to repair the application because `startTransition()` reactivated the controller.

The correction separates the two responsibilities:

- hook effect setup reactivates the stable transition controller after every replay cleanup;
- CrossfadeController cancellation only cancels and stabilizes transition state;
- ordinary pause orchestration cancels any transition, obtains the resulting AudioEngine active Deck, and explicitly pauses that Deck;
- the existing first hard-play Deck and song-state commit order is preserved in a small stateless helper so it can be regression tested without adding a React test framework.

No timeout, forced-next, UI fallback, replacement Audio element or second player state was added.

## Transaction lifecycle

1. `useLocalPlayer` decides that the current Deck should transition to a selected song and supplies its source plus an optional existing transition plan.
2. The controller creates one transaction in `preparing`, resumes the existing AudioEngine output paths, prepares the standby Deck and starts its media element.
3. Only a current token may enter `fading`. The controller executes the existing equal-power envelope and transition-specific playback-rate ramp through one injected RAF scheduler.
4. Completion clears the RAF and recovery timer, stops and silences the old Deck, swaps AudioEngine Deck ownership once, restores stable volume, and settles the transaction.
5. A planned tempo match is restored to native rate through the same interruptible scheduler after the Deck commit.

Constants and algorithms remain unchanged:

- `CROSSFADE_DURATION = 7000`
- `CROSSFADE_START_VOLUME = 0.03`
- `MIN_CROSSFADE_DURATION = 1200`
- transition playback-rate clamp remains `0.95` to `1.05`
- fade-in remains `sin(PI / 2 * progress)`
- fade-out remains `cos(PI / 2 * progress)`

## Cancel and supersede semantics

Cancellation invalidates the token before touching Deck state, cancels the active blend RAF, clears the recovery timer, cancels the tempo ramp and resets transition playback rates.

Cancellation does not own the ordinary player's pause command. `useLocalPlayer` pauses the active Deck after cancellation has selected or promoted the stable Deck.

Once the incoming Deck has started and `useLocalPlayer` has made that target the current song, cancellation promotes that Deck to the stable active Deck. This preserves the pre-migration behavior for `A -> B`, followed immediately by a request for `C`: the controller first stabilizes B, then begins `B -> C`. If preparation has not completed, the original active Deck remains active.

The stale `toDeck.play()` guard is owned by the controller because it protects only the transition standby request. A stale promise may settle its own cancelled result, but cannot pause a reused standby Deck, commit, or swap.

## Deck swap ownership

AudioEngine remains the owner of active/standby Deck identity and exposes `swapDecks()`. CrossfadeController is the only transition lifecycle owner that invokes it. A normal successful transition swaps at commit, never at start or merely when `play()` resolves. A superseded transition may perform one explicit promotion swap to stabilize the already-selected audible target before the replacement transition begins.

## Volume, ducking and tempo ownership

- Deck volume remains `user volume x crossfade envelope`.
- The current user volume remains owned by existing player/AudioEngine state; CrossfadeController reads it and does not copy it into independent state.
- TTS ducking remains outside CrossfadeController and continues to use AudioEngine `musicGain`.
- CrossfadeController owns only transition-specific playback-rate ramps and their cleanup.
- Success, cancellation, failure and disposal leave the two Decks in a defined stable state; a planned post-commit rate restoration remains interruptible by the next playback command.

## Recovery ownership

Each transaction owns at most one recovery timer. It commits only the current transaction after `duration + 350ms`. Success, cancellation, failure, supersede and disposal all clear the timer. No recovery handle is exposed through diagnostics.

## Remaining responsibilities

`useLocalPlayer` continues to own:

- `currentSong`, `isPlaying` and React playback state
- requested song, queue, up-next and playback modes
- next/previous selection and explicit playback commands
- natural-ended, audible-end and tail-silence policy
- companion continuation, transition-plan selection and AI recommendation boundaries
- the decision of why and when to start a crossfade
- TTS ducking policy and user-facing error/recovery call sites

`AudioEngine` continues to own:

- exactly two lazily-created music Decks
- active/standby Deck identity
- the main music AudioContext and media element source bindings
- analyser/FFT buffers and music gain resources
- user-volume capability and ducking gain resource

`PlayerCore` continues to own the canonical player state/command contract. The legacy adapter and `useLocalPlayer` real playback owner remain in place; this phase is not the final PlayerCore or state-owner migration.

## Diagnostics and compatibility paths

CrossfadeController diagnostics expose only frozen primitive values: activity, progress, transaction id, duration, phase and boolean handle presence. Mutable transactions, Decks, callbacks and raw scheduler handles remain private.

`useLocalPlayer.getPlaybackDiagnostics()` preserves its existing field names by composing AudioEngine and CrossfadeController diagnostics. The existing `yunLegacyPlayerAdapter` remains untouched. These paths stay until a later migration has tests proving all consumers use a replacement contract.

Crossfade progress remains imperative and is not written at frame rate to React state, PlayerStore or Context.

## Static ownership audit

Occurrences in `src/hooks/useLocalPlayer.js`:

| Ownership ref | Before | After |
| --- | ---: | ---: |
| `crossfadeFrameRef` | 9 | 0 |
| `crossfadeRecoveryTimerRef` | 10 | 0 |
| `tempoRampFrameRef` | 7 | 0 |
| `crossfadeTokenRef` | 8 | 0 |
| `crossfadeTransactionRef` | 7 | 0 |
| `standbyPlayTokenRef` | 3 | 0 |
| `isCrossfadingRef` | 12 | 0 |

Music transition RAF ownership is concentrated in `src/player/transition/`. Existing RAF loops for visual effects, lyrics, voice UI and unrelated animation systems were not changed.

## Automated tests

`CrossfadeController.test.js` uses fake Decks, a fake AudioEngine and a fake scheduler. It covers transaction creation, unchanged timing and curves, progress checkpoints, commit invariants, cancellation, stale async play settlement, supersede at 20% and 80%, rapid requests, playback-rate cleanup, real play failure, unavailable AudioContext output, recovery, volume interaction, idempotent disposal, diagnostics and resource/business ownership boundaries.

`playbackOrchestration.test.js` covers first hard-play state commit before any next command, first PlayerCore projection, stable pause, same-Deck resume, post-transition active-Deck resolution and StrictMode-like controller dispose/setup replay.

The controller and orchestration suites are included in `npm run test:player`. After the cold-start correction, the player suite passes 42 tests and the unified verification passes 146 tests plus the production build.

## Human audible regression checklist

Status: **NEEDS HUMAN RETEST**

Test ordinary playback, next, previous, seek, natural ended to next, a complete seven-second crossfade, next at roughly 20% and 80%, rapid next three times, selecting C during A-to-B, volume changes during the blend, TTS ducking and recovery, five-song continuous playback, queue, up-next, playback modes, FFT visuals, lyrics and ParticleVinyl. Listen specifically for double audio, silence, stale-song return, stale commit, volume or playback-rate residue, a stuck transition, and UI/audio track mismatch.
