export const PARTICLE_DISC_RADIUS = 0.965 * 3.05;
export const PARTICLE_CAMERA_FOV = 42;

export function alignedRecordLayout(width, height, zoom = 0) {
  const tangent = Math.tan(PARTICLE_CAMERA_FOV * Math.PI / 360);
  const naturalDistance = Math.max(1.2, 5.6 + zoom);
  const diameter = Math.min(width * 0.92, height * 0.92, PARTICLE_DISC_RADIUS * height / (naturalDistance * tangent));
  return { x: width / 2, y: height / 2, diameter, cameraZ: PARTICLE_DISC_RADIUS * height / (diameter * tangent) };
}

function spring(value, velocity, target, rate, dt) {
  const offset = value - target, impulse = velocity + rate * offset;
  const decay = Math.exp(-rate * dt);
  const next = target + (offset + impulse * dt) * decay;
  const speed = (velocity - rate * impulse * dt) * decay;
  return Math.abs(next - target) < 0.001 && Math.abs(speed) < 0.008 ? [target, 0] : [next, speed];
}

// Only this clock owns the handoff. Both renderers read the same presentation;
// React changes the mounted trees at the start, midpoint and end only.
export function createRecordSkinMotion() {
  const state = { active: false, phase: 'idle', particleAlign: 0, cdAlign: 0, mix: 0, caseVisibility: 1, angle: 0 };
  const ready = new Set();
  const velocities = { particleAlign: 0, cdAlign: 0, mix: 0, caseVisibility: 0 };
  let elapsed = 0, owner, reduced, boxed;
  const move = (key, target, dt, rate = 13) => {
    [state[key], velocities[key]] = spring(state[key], velocities[key], target, rate, dt);
  };
  return {
    state,
    particleSpin: 0, cdSpin: 0, cdBoxVisible: false, zoom: 0,
    publishParticleSpin(angle) { this.particleSpin = angle; },
    setZoom(zoom) { if (!state.active) this.zoom = zoom; },
    publishCdPose(angle, boxed) { this.cdSpin = angle; this.cdBoxVisible = boxed; },
    start(from, to, options = {}) {
      reduced = Boolean(options.reduced); boxed = Boolean(options.boxed ?? this.cdBoxVisible);
      Object.assign(state, { active: true, phase: 'aligning', from, to, destination: to,
        reduced,
        particleAlign: from === 'particle' ? 0 : 1, cdAlign: from === 'cd-case' ? 0 : 1,
        mix: 0, caseVisibility: from === 'cd-case' && boxed ? 1 : 0,
        angle: from === 'particle' ? this.particleSpin : this.cdSpin });
      for (const key of Object.keys(velocities)) velocities[key] = 0;
      ready.clear(); ready.add(from); elapsed = 0; owner = from;
    },
    reverse() {
      if (!state.active) return;
      state.destination = state.destination === state.to ? state.from : state.to;
      if (state.phase !== 'blending') state.phase = 'aligning';
    },
    markReady(kind) { ready.add(kind); if (kind === 'particle') this.hasParticle = true; },
    step(delta) {
      if (!state.active) return {};
      const result = {};
      let remaining = Math.min(0.12, Math.max(0, delta));
      while (remaining > 0.000001) {
        const dt = Math.min(remaining, 1 / 60); remaining -= dt; elapsed += dt;
        state.angle += dt * 0.3;
        if (elapsed > 12 && !ready.has(state.destination)) {
          state.destination = state.from; state.phase = 'settling'; result.failed = true;
        }
        if (state.phase === 'aligning') {
          // Reverse before blending can return directly to the original pose.
          if (state.destination === state.from && state.mix === 0) state.phase = 'settling';
          else {
            move('caseVisibility', 0, dt, 17);
            if (!boxed || state.caseVisibility === 0) move('cdAlign', 1, dt);
            move('particleAlign', 1, dt);
            if (reduced || (state.cdAlign === 1 && state.particleAlign === 1)) {
              if (ready.has(state.destination)) state.phase = 'blending';
            }
          }
        }
        if (state.phase === 'blending') {
          const goal = Number(state.destination === state.to);
          move('mix', goal, dt, reduced ? 32 : 8);
          if (state.mix === goal) state.phase = 'settling';
        }
        if (state.phase === 'settling') {
          const key = state.destination === 'cd-case' ? 'cdAlign' : 'particleAlign';
          move(key, 0, dt);
          const showBox = boxed && state.destination === state.from && state.from === 'cd-case';
          if (showBox && state.cdAlign === 0) move('caseVisibility', 1, dt);
          if (reduced || (state[key] === 0 && (!showBox || state.caseVisibility === 1))) {
            state.active = false; state.phase = 'idle'; result.finished = state.destination;
          }
        }
        const nextOwner = state.mix >= 0.5 ? state.to : state.from;
        if (nextOwner !== owner) { owner = nextOwner; result.commit = owner; }
      }
      return result;
    },
  };
}
