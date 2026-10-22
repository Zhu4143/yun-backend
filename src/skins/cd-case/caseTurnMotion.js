const TAU = Math.PI * 2;
const DURATION = 1.6;
const smooth = t => t * t * (3 - 2 * t);

// A closed case can replace its print only while its front faces away. Hold
// the back pose if the caller has not committed yet; never reveal stale art.
export function createCaseTurnMotion({ reduced = false } = {}) {
  let active = false;
  let elapsed = 0;
  let committed = false;
  return {
    get active() { return active; },
    get progress() { return active ? elapsed / DURATION : 0; },
    get yaw() { return active && !reduced ? TAU * smooth(elapsed / DURATION) : 0; },
    get canCommit() { return active && (reduced || Math.cos(this.yaw) < -0.8); },
    canReplace(facing) { return this.canCommit && (reduced || facing < -0.9); },
    begin() {
      if (active) return;
      active = true; elapsed = 0; committed = false;
    },
    commit() {
      if (!this.canCommit) return false;
      committed = true;
      if (reduced) active = false;
      return true;
    },
    cancel() { active = false; elapsed = 0; committed = false; },
    step(dt) {
      if (!active || reduced) return;
      elapsed = Math.min(committed ? DURATION : DURATION / 2, elapsed + Math.max(0, dt));
      if (elapsed === DURATION) active = false;
    },
  };
}
