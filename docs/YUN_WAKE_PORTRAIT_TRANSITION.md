# Particle vinyl to portrait transition

## Current proof of concept

The wake animation keeps `ParticleVinylBackground` as the primary scene. On wake, an additive particle bridge maps the existing record particles through a brief scatter into a portrait; the portrait overlay then switches to the local pixel-rhythm renderer. This preserves the app's existing record, mountain, lighting, and audio-reactive render path.

`AnimatedBackground` in `src/App.jsx` owns the transition progress. It eases from 0 to 1 over 2.6 seconds. The vinyl fades during the first 22% of progress, the particle bridge carries the middle, and the portrait fades in from 78% through 96%.

The bridge uses `VinylPortraitBridge` with the first local portrait frame and a 56,000-point cloud. Its shader keeps the transition at one progress value, so wake interruption or a new turn can reverse the same animation without starting a second scene. `PixelRhythmPortrait` uses the same crop and sample region, six-pixel sampling, and eleven PNG frames under `public/portrait-sequence/`. It plays the existing frame order at three frames per second and loops back through the sequence.

The current crop is `{ x: 0.08, y: 0.18, width: 0.84, height: 0.68 }`. The source frames, crop, frame order, playback rate, point count, and progress are explicit inputs, so another portrait sequence or a future captured animation can be substituted without replacing the vinyl renderer.

## Verified behavior

- A local browser render loaded the app with empty fixture data and no microphone access.
- A local mock wake event exercised the real app wake callback. The screenshot showed scattered particles during the transition and the assembled blue pixel portrait after it.
- `npm run verify` completed successfully, including the production build.
- `npm run desktop:dist` produced the Windows NSIS installer.

The local mock verifies rendering and event wiring. It does not validate microphone sensitivity, acoustic echo cancellation, or portrait visibility on a physical display. Those require the installed app and the target microphone/display.

## Extension point for a promotional sequence

Keep the musical record as the opening silhouette and reuse the same renderer ownership. Replace or extend the local portrait frame sequence, then tune the crop, frame order, rate, bridge point count, and transition duration against a captured reference. A later video capture path can sample the same progress and frame clock to produce deterministic frames; it should not add a second live WebGL scene or replace the music-reactive particle record.
