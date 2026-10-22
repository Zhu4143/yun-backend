export function wheelPixels({ deltaX = 0, deltaY = 0, deltaMode = 0 }, pageHeight) {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return Number.isFinite(delta) ? delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1) : 0;
}

// Consume actual wheel distance with a short continuous catch-up, rather than
// advancing one fixed card per event. OS touchpad momentum passes through.
export function createRowWheelMotion() {
  const pending = [0, 0, 0, 0];
  return {
    push(row, pixels) {
      if (row < 0 || row >= pending.length || !Number.isFinite(pixels)) return;
      if (pending[row] * pixels < 0) pending[row] = 0;
      pending[row] += pixels;
    },
    moving: row => Math.abs(pending[row] || 0) > 0,
    step(row, dt, immediate = false) {
      const before = pending[row] || 0;
      const used = immediate || Math.abs(before) < 0.01 ? before : before * (1 - Math.exp(-24 * dt));
      pending[row] = before - used;
      return used;
    },
    reset() { pending.fill(0); },
  };
}
