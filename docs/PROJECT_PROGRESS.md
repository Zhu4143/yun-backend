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
