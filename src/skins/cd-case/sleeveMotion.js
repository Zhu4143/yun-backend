// An interruptible, critically damped slide. Artwork swaps temporarily park the
// disc without losing the user's latest choice of whether to leave it out.
export function createSleeveMotion({ reduced = false } = {}) {
  let position = 0;
  let velocity = 0;
  let requested = false;
  let swapping = false;
  const home = () => position === 0 && velocity === 0;
  return {
    get position() { return position; },
    get extracted() { return requested; },
    get swapping() { return swapping; },
    get home() { return home(); },
    get phase() {
      const target = swapping ? 0 : Number(requested);
      return position === target && velocity === 0
        ? (target ? 'extracted' : 'shelved')
        : (target ? 'extracting' : 'inserting');
    },
    setExtracted(on = !requested) { requested = Boolean(on); },
    beginSwap() { swapping = true; },
    finishSwap() { swapping = false; },
    step(dt, canExtract = true) {
      const target = swapping || !canExtract ? 0 : Number(requested);
      if (reduced) { position = target; velocity = 0; return; }
      const omega = 8.5;
      const offset = position - target;
      const impulse = velocity + omega * offset;
      const decay = Math.exp(-omega * dt);
      position = target + (offset + impulse * dt) * decay;
      velocity = (velocity - omega * impulse * dt) * decay;
      if (Math.abs(position - target) < 0.0005 && Math.abs(velocity) < 0.004) {
        position = target;
        velocity = 0;
      }
    },
  };
}
