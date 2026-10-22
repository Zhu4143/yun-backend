const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

export const DISC_CLEARANCE = 24;
export function discFlight(amount) {
  const travel = smooth((amount - 0.14) / 0.86);
  return { travel, lift: DISC_CLEARANCE * smooth(amount / 0.14) * (1 - travel) };
}

function spring(value, velocity, target, omega, dt) {
  const offset = value - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  const next = target + (offset + impulse * dt) * decay;
  const speed = (velocity - omega * impulse * dt) * decay;
  return Math.abs(next - target) < 0.0005 && Math.abs(speed) < 0.004 ? [target, 0] : [next, speed];
}

// Playback owns the display pose; a separate short exchange lets two discs
// coexist without replacing artwork on a visible, stationary front face.
export function createPlaybackMotion({ reduced = false } = {}) {
  let playing = false;
  let amount = 0;
  let speed = 0;
  let caseOpacity = 1;
  let fadeSpeed = 0;
  let boxOpen = 0;
  let lidSpeed = 0;
  let phase = 'standby';
  let exchange = -1;
  return {
    get playing() { return playing; },
    get amount() { return amount; },
    get caseOpacity() { return caseOpacity; },
    get boxOpen() { return boxOpen; },
    get swapping() { return exchange >= 0; },
    get outgoing() { return exchange < 0 ? 1 : smooth(exchange / 0.72); },
    get incoming() { return exchange < 0 ? 1 : smooth((exchange - 0.12) / 0.80); },
    get phase() { return phase; },
    presentDisc() {
      // Incoming skin starts at its shared disc pose; it must not replay the
      // box-opening sequence invisibly underneath the material crossfade.
      playing = true; amount = boxOpen = 1; caseOpacity = 0;
      speed = fadeSpeed = lidSpeed = 0; phase = 'playing'; exchange = -1;
    },
    park() {
      // Used only while the library fully conceals the scene, to receive the
      // selected closed case before the visible opening/extraction begins.
      playing = false; amount = speed = fadeSpeed = boxOpen = lidSpeed = 0;
      caseOpacity = 1; phase = 'standby'; exchange = -1;
    },
    setPlaying(on, presentedOpen = boxOpen) {
      if (Boolean(on) === playing) return;
      if (phase === 'standby') boxOpen = clamp01(presentedOpen);
      playing = Boolean(on);
      phase = playing ? (amount === 0 && boxOpen < 1 ? 'opening' : caseOpacity > 0 ? 'hiding' : 'entering')
        : (amount === 0 ? 'closing' : 'revealing');
    },
    startSwap() {
      if (exchange >= 0 || reduced) return false;
      exchange = 0;
      return true;
    },
    step(dt) {
      if (reduced) {
        amount = Number(playing); caseOpacity = 1 - amount; boxOpen = amount;
        speed = fadeSpeed = lidSpeed = 0; exchange = -1;
        phase = playing ? 'playing' : 'standby';
        return;
      }
      if (exchange >= 0) {
        exchange += dt;
        if (exchange >= 0.96) exchange = -1;
      }
      if (playing) {
        [boxOpen, lidSpeed] = spring(boxOpen, lidSpeed, 1, 11, dt);
        if (phase === 'opening' && boxOpen === 1) phase = 'hiding';
        [caseOpacity, fadeSpeed] = spring(caseOpacity, fadeSpeed, phase === 'opening' ? 1 : 0, 12, dt);
        if (phase === 'hiding' && caseOpacity === 0) phase = 'entering';
        // Keep the disc's live pose still while any case material is visible.
        // Scaling/moving through a partially faded tray creates intersections.
        if (phase === 'opening' || phase === 'hiding') speed = 0;
        else [amount, speed] = spring(amount, speed, 1, 8, dt);
        if (amount === 1 && caseOpacity === 0) phase = 'playing';
      } else if (phase !== 'standby') {
        // Reveal an OPEN, EMPTY tray before the disc starts flying home.
        [caseOpacity, fadeSpeed] = spring(caseOpacity, fadeSpeed, 1, 9, dt);
        [boxOpen, lidSpeed] = spring(boxOpen, lidSpeed, phase === 'closing' ? 0 : 1, 11, dt);
        if (phase === 'revealing') {
          [amount, speed] = spring(amount, speed, amount, 8, dt);
          if (caseOpacity === 1 && boxOpen === 1 && exchange < 0) phase = 'returning';
        } else if (phase === 'returning') {
          [amount, speed] = spring(amount, speed, 0, 8, dt);
          if (amount === 0) phase = 'closing';
        }
        if (phase === 'closing' && boxOpen === 0 && caseOpacity === 1) phase = 'standby';
      }
    },
  };
}

export function playbackLayout(width, height) {
  const narrow = width < 700;
  const top = width <= 640 ? 40 : 28;
  const bottom = width <= 640 ? 195 : 160;
  const sceneHeight = Math.max(1, height - top - bottom);
  return {
    x: width * (narrow ? 0.5 : 0.76),
    y: top + sceneHeight * (narrow ? 0.43 : 0.5),
    // Restore the full-disc presentation within the original scene/dock bounds.
    // Common 500px embedded covers cannot resolve the former ~1400px disc.
    diameter: Math.min(width * (narrow ? 0.72 : 0.38), sceneHeight * 0.78),
  };
}
