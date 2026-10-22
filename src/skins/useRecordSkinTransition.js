import { useEffect, useRef, useState } from 'react';
import { createRecordSkinMotion } from './recordSkinMotion';

export function useRecordSkinTransition(onCommit) {
  const [motion] = useState(createRecordSkinMotion);
  const [transition, setTransition] = useState(null);
  const particleLayer = useRef(null), cdLayer = useRef(null);
  const commit = useRef(onCommit);
  useEffect(() => { commit.current = onCommit; }, [onCommit]);
  useEffect(() => {
    if (!transition) return;
    let frame, previous = performance.now();
    const tick = now => {
      const dt = document.hidden ? 0 : (now - previous) / 1000;
      previous = now;
      const event = motion.step(dt), s = motion.state;
      for (const [kind, ref] of [['particle', particleLayer], ['cd-case', cdLayer]]) {
        if (!ref.current) continue;
        ref.current.style.opacity = kind === s.to ? String(s.mix) : '1';
        ref.current.dataset.transitionPhase = s.phase;
      }
      if (event.commit) commit.current(event.commit === 'cd-case');
      if (event.finished) { setTransition(null); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [transition, motion]);
  const begin = (from, to) => {
    if (motion.state.active) motion.reverse();
    else {
      if (!motion.hasParticle) {
        try {
          const saved = JSON.parse(window.localStorage.getItem('yun-particle-vinyl-fixed-view') || 'null');
          if (Number.isFinite(saved?.zoom)) motion.setZoom(Math.max(-4.4, Math.min(4.2, saved.zoom)));
        } catch { /* Use the neutral shared pose when there is no saved view. */ }
      }
      motion.start(from, to, { reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
    setTransition({ from: motion.state.from, to: motion.state.to, destination: motion.state.destination });
  };
  return { motion, transition, particleLayer, cdLayer, begin };
}
