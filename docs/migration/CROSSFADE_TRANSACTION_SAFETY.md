# Crossfade transaction safety analysis

## Confirmed root cause

The progressive volume loss was caused by the temporary, already-faded `fromAudio.volume` being reused as the next crossfade's target volume. Before this repair, `crossfadeToSong()` called `getSafeVolume(fromAudio)` at the start of every transition. A rapid Next could cancel the old transition while `fromAudio.volume` was below the user's intended level, so every subsequent transition inherited a smaller baseline.

The previous cancellation path also cancelled only the current RAF. Its recovery timer was local to the crossfade Promise and could not be cleared atomically by `cancelCrossfade()`. Cancellation did not normalize the two Decks, so pause, seek, and rapid Next could leave partial volumes, a stale active/standby assignment, or a pending async continuation.

## Implemented transaction rules

- `userVolumeRef` is the sole user base-volume source.
- Effective Deck volume is `userVolumeRef × duckingFactorRef × crossfadeFactor`.
- A crossfade transaction records its token, from/to Decks, target song, progress, resolver, RAF, and recovery timer ownership.
- Every new transition increments the token, cancels the old RAF and timer, resolves the old Promise as cancelled, and normalizes to one active audible Deck plus one silent paused standby Deck.
- Pause and seek use the same atomic cancellation/normalization path before acting.
- `requestedSongRef` advances navigation independently of an unresolved `audio.play()` Promise, so rapid Next requests still advance the requested queue position once per click.
- Stale async continuations exit when their token no longer matches. A stale `play()` completion may only pause the standby Deck when it still owns the latest standby play token.
- `setVolume()` updates the base volume and reapplies the current crossfade/ducking factors instead of overwriting the transaction mix.
- TTS ducking now changes `duckingFactorRef`; stopping or cancelling ducking restores factor `1`, which means restoration always targets the current user base volume.

## Stable-state invariant

After success or cancellation, development builds assert:

- `isCrossfadingRef === false`
- no crossfade RAF remains
- no recovery timer remains
- active Deck volume equals the current effective volume
- standby Deck is paused with volume `0`

`getPlaybackDiagnostics()` additionally exposes the current transaction, Deck, source, base-volume, ducking, RAF, and timer state for deterministic test recording.

## Special test matrix

The following cases must record final track, `isPlaying`, `isCrossfading`, both Deck paused/volume values, RAF/timer ownership, user base volume, and effective volume:

13. Next five times at one-second intervals.
14. Next five times at 300 ms intervals.
15. Next ten times as fast as possible.
16. Pause and resume during repeated Next.
17. Seek to 30 seconds during repeated Next.
18. Wait ten seconds after repeated Next and compare final volume with the pre-transition base volume.
19. Set volume to 30%, Next five times, verify final base/effective volume is 30%.
20. Set volume to 80%, Next five times, verify final base/effective volume is 80%.
21. Complete TTS ducking, then repeat Next and verify final volume.
22. After repeated Next, run normal play, pause, seek, and Next again.

Deck state and transaction cleanup are code-assertable. Subjective loudness and crossfade continuity still require manual listening.

## Current verification result

- Production build: passed (601 modules).
- Targeted ESLint: passed.
- No new `Audio` or `AudioContext` construction was added.
- UI navigation test 13: starting at track index 0, five Next clicks at one-second intervals ended at index 5 (`红色高跟鞋`), with no new console error.
- UI navigation test 14: starting at track index 0, five Next clicks at 300 ms intervals ended at index 5 (`红色高跟鞋`), with no new console error.
- UI navigation test 15: starting at track index 0, ten immediate Next clicks ended at index 10 (`虚拟`), with no new console error.
- The in-app automated browser did not enter audible playback, so tests 16–22 and subjective loudness/crossfade continuity remain pending manual playback verification. The new development invariant and `getPlaybackDiagnostics()` must be used to record deterministic Deck and transaction values during that run.
