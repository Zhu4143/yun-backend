import { useEffect, useLayoutEffect, useRef } from 'react';

// Keep FloatingLyrics' existing loading, timing, palette and accessibility.
// This skin only needs one WebGL context: reserve it for the acrylic case.
export default function CdCaseLyrics({
  lines, songId, activeIndex, currentTime, settings, palette,
  outgoing, transitionId, onTransitionComplete,
}) {
  const rootRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const fit = () => {
      const sizes = [...root.querySelectorAll('.cd-case-lyrics__line')].map(line => (
        [line, Math.min(1, line.clientWidth / Math.max(1, line.firstElementChild.scrollWidth))]
      ));
      sizes.forEach(([line, scale]) => line.style.setProperty('--cd-line-fit', scale));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, [lines, activeIndex, outgoing, settings.size]);

  useEffect(() => {
    if (!outgoing) return undefined;
    const timer = window.setTimeout(() => onTransitionComplete(transitionId), 900);
    return () => window.clearTimeout(timer);
  }, [outgoing, transitionId, onTransitionComplete]);

  const renderTrack = (trackLines, active, time, colors, exiting = false) => (
    <div
      key={exiting ? `out-${transitionId}` : songId}
      className={`cd-case-lyrics__track${exiting ? ' is-outgoing' : outgoing ? ' is-incoming' : ''}`}
      style={{
        '--cd-lyric-color': settings.followCover ? `color-mix(in srgb, ${colors.primary}, white 55%)` : settings.color,
        '--cd-lyric-fill': settings.followCover ? `color-mix(in srgb, ${colors.secondary}, white 65%)` : settings.glowColor,
        '--cd-lyric-side': settings.followCover ? colors.primary : settings.sideColor,
        '--cd-depth-x': `${(0.8 - settings.lightX * 0.2) * settings.depth}px`,
        '--cd-depth-y': `${(0.7 + settings.lightY * 0.2) * settings.depth}px`,
      }}
    >
      {trackLines.slice(Math.max(0, active - 2), active + 4).map((line, localIndex) => {
        const index = Math.max(0, active - 2) + localIndex;
        const offset = index - active;
        if (offset < -2 || offset > 3) return null;
        const duration = Math.max(0.8, (Number(line.nextTime) || Number(line.time) + 4) - Number(line.time));
        const progress = Math.max(0, Math.min(1, (time - Number(line.time)) / duration));
        return (
          <div
            key={`${line.time}-${index}`}
            className={`cd-case-lyrics__line${offset === 0 ? ' is-current' : ''}`}
            style={{
              '--cd-line-offset': offset,
              '--cd-line-opacity': offset === 0 ? 1 : Math.max(0.3, 0.68 - Math.abs(offset) * 0.1),
              '--cd-line-progress': `${progress * 100}%`,
              '--cd-rotate-x': `${settings.rotateX}deg`,
              '--cd-rotate-y': `${settings.rotateY}deg`,
            }}
          >
            <span>{line.text}</span>
            {offset === 0 && <span className="cd-case-lyrics__fill">{line.text}</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="cd-case-lyrics" ref={rootRef}>
      {outgoing && renderTrack(outgoing.lines, outgoing.activeIndex, outgoing.currentTime, outgoing.palette, true)}
      {renderTrack(lines, activeIndex, currentTime, palette)}
    </div>
  );
}
