# CD case skin

Open the existing Yun frontend with `?skin=cd-case`. Without that parameter,
the existing particle skin remains the default. Use the existing backend and
login flow; this directory has no search service, credentials, audio element,
playback queue, or model calls.

`CdCaseBackground` receives `coverUrl`, `trackKey`, `isPlaying`, and optional
`onReady`. Its module-level disc configuration is intentionally stable so song
changes update textures without rebuilding the renderer. The original app
retains Space playback and voice shortcuts. Playback/pause automatically owns
the CD presentation. In standby, the focused scene also supports O for
opening/closing the lid.

## Independent cylinder library

In the CD skin, move to the right edge and left-click to open `CdLibraryWall`.
The particle skin retains its existing hover drawer. The wall uses the real
local library and the existing NetEase account, playlist and playback APIs.
Choose a playlist in the header; playlist boxes open that playlist's songs.
Search filters the loaded collection locally and shows small result sets once.
It never creates sample albums or changes a queue just by browsing.

Four rows (three on narrow screens) face inward around a CSS 3D cylinder.
Adjacent rows rotate in opposite directions. Hover/focus pauses the active
row, enlarges its case and shifts neighbours using shared angular endpoints.
Live widths drive the packing directly, so rapidly changing the hovered case
does not interpolate the faces through one another. Adjacent rows reserve the
full combined half-heights where their angular footprints overlap, and pass
that clearance to the next row. A maximum of 68 pooled cards are mounted;
rotation only writes transforms and does not re-render React every frame.
Hidden tabs and reduced-motion preferences stop continuous rotation.

Wheel over a case to rotate only its row. Vertical wheel and horizontal
touchpad deltas map to actual travel distance, with a short smooth catch-up;
faster input therefore moves faster. Reversing input cancels the old catch-up.
During manual scrolling the row's enlarged case contracts, and the case under
the pointer expands again after settling. Slot wraps retain the moving case's
live size so the shared-edge packing remains valid. Other rows keep their
normal slow rotation. Filtered results scroll within their finite collection
without duplicating items. Changing collection, closing, picking or hiding
the tab clears queued wheel movement; Ctrl+wheel retains browser zoom.

Selecting a song keeps its live 3D pose while the surrounding wall fades out.
The original selected tile is hidden as an identical 3D copy takes over; the
copy starts moving only after the wall has cleared. It then faces the screen
and moves into the existing stage, without jumping to a flat bounding box.
Audio preparation and the movement run together. The stage waits for the
matching artwork, successful playback and the case's arrival before exposing
its normal opening/extraction. Rapid repeated picks submit one request;
failed playback restores the wall with a retry message. Esc/close cancels
the visual handoff without claiming to cancel an already-started audio request.
Opening again during the exit starts a fresh selection session. If the original
player's stream recovery interrupts its first play promise, the CD handoff
observes that player for up to six seconds and continues only when the selected
track's clock advances. It submits no retry or extra audio request; a genuine
failure still returns to the wall for another choice.

While the wall conceals the stage, the existing CD is parked closed and its
WebGL draws are skipped. The wall adds no WebGL context or heavy acrylic
passes per tile: its preview cases use lightweight cover images and CSS
frames. The selected stage retains Ann Nguyen's original geometry, material
and the author's credit. Header controls, keyboard focus, empty/loading states
and the original account login remain available.

## Album box and disc extraction

The existing acrylic frame contains a square printed insert using the same
song texture as the disc. During playback, `playbackMotion.js` shows the full
disc at the original right-side position (76% of desktop width), within the
scene bounds above the player. Narrow screens centre the complete disc.
The disc faces the screen and keeps its in-plane spin without positional
sway, hover tilt or drag rotation. The case, insert and case shadows fade
away gradually. The oversized corner quadrant was reverted because a
500px embedded cover was magnified to a roughly 1400px disc. Restoring the
original size avoids that enlargement without raising the GPU pixel budget.

Pause runs three ordered phases: the open, empty case fades in while the
disc stays in its playback position; the disc flies into the fully visible tray; then
the lid closes after landing. Starting playback opens the case, fades all case
material completely, then enlarges and moves the disc. Returning discs first
reach the tray centre at their original size above its rim, then lower onto
the spindle before the lid closes. The loose disc uses a foreground plane
whose projected position and diameter match the existing layout.
The motion can reverse continuously if play/pause is pressed
midway through a flight or lid close. Artwork arriving while paused waits
until the return has finished, so it cannot close the lid prematurely.

When new artwork is ready during playback, the old disc exits upward while
the new one enters from beyond the right edge with a short overlap. One extra
disc mesh and inner ring share the existing geometry and renderer. The old
texture stays alive until its disc has exited. Fast track selections retain
only the latest pending texture without restarting the current movement.
Standby selections close the lid and rotate the closed case once. The print
changes only while the case front faces away (view-facing dot below -0.9).
Rapid requests keep the current turn and take the latest ready artwork; a
late request after the hidden interval waits for another turn. The normal
opening/extraction waits for the turn even if the existing Next action has
already started audio. Concealed library handoffs commit directly while hidden.
Reduced motion switches directly between the same end states.

Click/O lid opening and drag rotation remain available in standby. Manual
extraction controls are replaced by the automatic playback/pause flow.
The loose disc has its own clear inner annulus; the tray spindle
stays in the case. The original lid curves remain for manual inspection.

The insert, clear annulus, outgoing disc and depth masks share the existing
renderer and render targets. No extra canvas, optical pass, artwork request
or React update per animation frame is added. Invisible case optical passes
are skipped. Shader visibility uniforms fade the case and its shadows while
preserving the material at full visibility. All geometry/materials and live,
outgoing or pending textures are disposed with the stage.

The CD mode never mounts `AnimatedBackground`. Its CSS restores the DOM
materials and open/ready content visibility that the original particle
renderer’s `LiquidGlassOrbPass` normally supplies. The fallback styles are
scoped to `.skin-cd-case`.

## Rendering and motion

This skin passes `CdCaseLyrics` to the existing `FloatingLyrics` model. It
keeps the same lyric loader, playback clock, palette, accessible text, scrolling,
progress fill and track transition, using DOM/CSS instead of a second WebGL
context. The default skin still uses `ThreeLyricText`. The CD lyrics add a
shallow CSS edge and concentrated glow to the current line, following the
existing depth, light direction and side-colour settings. This is an inexpensive
depth cue rather than the original WebGL text extrusion. The active line uses
a concentrated glow while the surrounding text remains sharp.

The CD keeps the author's acrylic shaders, geometry, optical passes, 4x MSAA and
opening/closing curves. The 4x-MSAA optical targets retain their 1.2-million-pixel
budget. Artwork and presentation use separate targets up to 3 million pixels,
at most DPR 1.5, so the loose playing disc does not inherit the glass buffers'
lower resolution. The transparent case region still uses the optical budget.
Both sizes can adapt down when frames remain slow. Drawing is capped
at 60 fps and suspended in hidden tabs. Animation advances by elapsed time
using stable integration steps, instead of dropping time on late frames.
Only this skin opts into wall-time catch-up for the existing panel springs.
Its panel surfaces use static layered highlights and rim shading. Settled player,
top controls and small popovers use a bounded 10px backdrop blur; large panels
and the expanding morph shell keep their static material.

Only acrylic rods encode the alpha-above-2 seeds consumed by the star filter.
After the box has fully faded, the bright extraction and both star-streak passes
are skipped, and the final shader does not sample their stale textures. Disc
metal, grooves, rainbow reflections, the hub and shadow continue rendering.
When the empty box reappears, all its optical/glint passes resume immediately.

## Liquid Ore UI material

The CD skin also paints the original full-page Liquid Ore field. Both skins
share `liquidMetalField`, including the unchanged five-octave/domain-warp shader,
palette transitions, music response and lyric wake. The CD adapter reuses its
existing WebGL renderer and frame clock. Only this slowly moving field refreshes
at 30 Hz in a buffer capped at 640,000 pixels; the disc's printed artwork and
60 Hz case motion keep their separate budgets. The field is sampled underneath
the original case shadows and through its refraction passes. Cover colors are
read once from the already decoded artwork when its visible print is committed,
so hidden back-face changes and background color transitions stay connected.
Existing background settings and brightness controls apply to both skins.
Reduced-motion preferences freeze spatial flow while retaining a color fade.

The CD renderer also reuses the original `liquidOreSource` glass/blur shaders,
hover spring and saved settings. `CdLiquidOre` samples the CD's composited scene
with the same WebGL context and clock. Only visible outer UI bodies participate;
the particle scene and its voice composition pass are not mounted. A morph shell
replaces its arriving target rather than stacking two refraction masks. Closed
React panels, ancestor-clipped bodies, CD geometry and cylinder-wall cards are
excluded. Surface discovery is throttled/cached; live bounds follow moving shells.

The UI adapter opts into a neutral body tint for readable
white UI text. This is a shader define; the default particle shader retains its
original equations. Once the shader presents successfully, the CD's fallback
CSS fill and backdrop blur are disabled so the material is rendered only once.
No visible surfaces means no extra post-processing. Frost zero bypasses both
blur passes. Observers, pointer listeners, materials and targets are disposed
with the stage; the original Ann Nguyen / TypingMind credit remains visible.

Star glints use a reduced gain (0.4 instead of 1.6), shorter sampling spacing
(0.55 instead of 1.5) and faster arm falloff (0.52 instead of 0.7). This keeps
small concentrated highlights while preserving the original acrylic/disc
reflections and all optical shaders and passes.

Use a production preview when assessing smoothness:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5175 --strictPort
```

Stop any existing frontend using that port first. Keep the existing backend
running, then open `http://127.0.0.1:5175/?skin=cd-case`. The Vite development
server can add substantial React scheduler overhead on this app; production
and development measurements should be reported separately.

## Attribution

CD case design, geometry, shaders and original motion: **Ann Nguyen**
([@ann_nnng](https://x.com/ann_nnng)), built with **TypingMind**.

Source: [annnguyentt/vibe-coding, cd-case](https://github.com/annnguyentt/vibe-coding/tree/efba8dfb956cca848422f18e8ede1bdf96033fca/cd-case)
at commit `efba8dfb956cca848422f18e8ede1bdf96033fca`.

The author's case geometry is copied unchanged. The acrylic shaders retain
their optical calculations with added visibility blending. The disc's printed
face extends the original shader with filtered concentric grooves,
view-dependent anisotropic highlights and a reflective ink layer, so opaque
song artwork no longer masks all of the optical surface. `disc.inkMetalness`
defaults to 0.9; 0 restores the original flat print and 1 uses the full metallic
print. Groove detail fades below pixel size to avoid moire. This adds no mesh,
texture load or render pass. The backdrop shader's disc shadow now uses the
separate disc transform and fades the case shadow independently. `CaseStage`
retains the independent prototype's latest-request handling.
The original author credit and source link remain visible in the skin.
