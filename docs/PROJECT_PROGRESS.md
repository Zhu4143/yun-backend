# Yun Companion Project Progress

Last updated: 2026-09-14

This file is the repository-safe progress entry point for ChatGPT and other
review tools. It must never contain credentials, cookies, account identifiers,
raw listening events, private memory contents, or machine-specific paths.

## Repository state

- Active branch: `feature/netease-capability-p2`
- Unified Boot base commit: `f34417d3632f6c8b364dd56f0eef9256666b698e`
- Sync state: local Boot fixes are verified but must still be reviewed and pushed.

## Current focus

The unified Boot / Self Check system now releases the main UI as soon as every
blocking task succeeds. Optional tasks continue and retry in the background,
then move diagnostics to `degraded` only when their retries are exhausted.

NetEase startup now loads every playlist track page, validates each playlist's
declared `trackCount`, rejects missing/duplicate/invalid tracks, and stores only
versioned caches whose nested track collections are complete. The backend no
longer mistakes `playlist_track_all` page counts for collection totals or repeats
remote login-status checks for every track page.

The two-hand convergence gesture improvement is verified locally but remains
uncommitted together with other isolated working-tree changes.

## Latest verification

- Current 1.0.6 worktree `npm run verify`: PASS
- Windows NSIS installer 1.0.6: built and package contents verified locally
- Boot tests: 24/24 PASS
- Deterministic conversation flow: 27/27 PASS
- Real browser Boot: `ready`, 100%, 4.14 seconds
- Real NetEase Boot load: 914 tracks fully checked before the main UI mounted
- Slowest Boot tasks: playlists 3.95s, cover preload 0.63s, local library 0.41s

## Privacy boundary

Only committed source code, tests, and sanitized documentation belong in
GitHub. Local model weights, virtual environments, generated installers,
screenshots, NetEase login material, personal voice samples, runtime memory,
and raw listening data must remain local and Git-ignored.

## Reading instructions

Treat the latest pushed version of this file and the referenced commit as the
source of truth. A local-only change cannot be observed from ChatGPT's GitHub
connection until it is reviewed, committed, and pushed.
