// Budget the *internal* render targets; CSS size, geometry and optical shaders
// stay unchanged. A full-screen 4x-MSAA refraction pipeline otherwise scales
// quadratically with display DPI.
export const CD_PIXEL_BUDGET = 1_200_000;
// Artwork and the final presentation do not need the glass targets' 4x MSAA.
// Keep their detail independent of the more expensive optical buffers.
export const CD_SURFACE_PIXEL_BUDGET = 3_000_000;
const MIN_RATIO = 0.75;

export function initialRenderRatio(width, height, deviceRatio = 1) {
  const pixels = Math.max(1, width * height);
  return Math.min(deviceRatio, 1.5, Math.sqrt(CD_PIXEL_BUDGET / pixels));
}

export function renderRatios(width, height, deviceRatio = 1, qualityScale = 1) {
  const pixels = Math.max(1, width * height);
  return {
    surface: Math.min(deviceRatio, 1.5, Math.sqrt(CD_SURFACE_PIXEL_BUDGET / pixels)) * qualityScale,
    optics: initialRenderRatio(width, height, deviceRatio) * qualityScale,
  };
}

export function nextRenderRatio(ratio, frameGaps) {
  // Very long gaps usually indicate a suspended/occluded tab, not GPU load.
  // Include 100–500ms slow frames, which the upstream probe discarded.
  const samples = frameGaps.filter(gap => gap > 0 && gap <= 0.5).sort((a, b) => a - b);
  if (samples.length < 24) return ratio;
  const median = samples[samples.length >> 1];
  if (median <= 1 / 42) return ratio;
  const floor = Math.min(ratio, MIN_RATIO);
  return Math.max(floor, Math.min(ratio * 0.85, ratio * Math.sqrt((1 / 55) / median)));
}

// Integrate the existing motion at stable steps, but retain elapsed wall time
// when a frame is late. Rendering still happens only once per display frame.
export function advanceMotion(elapsed, advance) {
  let remaining = Math.min(1, Math.max(0, elapsed));
  while (remaining > 0.000001) {
    const step = Math.min(remaining, 1 / 60);
    advance(step);
    remaining -= step;
  }
}

// A high-refresh display should not submit this seven-pass scene 144–240
// times a second while the player and its panels share the same GPU.
export function createRenderClock(maxFps = 60) {
  const interval = 1000 / maxFps;
  let previous = null;
  let deadline = 0;
  return {
    reset() { previous = null; deadline = 0; },
    sample(now) {
      if (now + 0.5 < deadline) return null;
      const elapsed = previous === null ? 1 / maxFps : (now - previous) / 1000;
      previous = now;
      deadline = now - deadline >= interval ? now + interval : deadline + interval;
      return elapsed;
    },
  };
}
