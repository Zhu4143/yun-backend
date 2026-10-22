import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRenderClock } from './frameBudget';
import { cylinderMetrics, cylinderWall, rowVelocity, wallItems, wallSlotItem } from './libraryWallModel';
import { createRowWheelMotion, wheelPixels } from './rowWheelMotion';
import './cd-library-wall.css';

function JewelCase({ item }) {
  return <span className="cd-jewel">
    <img src={item.cover} alt="" draggable="false" decoding="async" onError={event => {
      if (!event.currentTarget.src.endsWith('/covers/default-cover.jpg')) event.currentTarget.src = '/covers/default-cover.jpg';
    }} />
    <span className="cd-jewel__spine" />
    <span className="cd-jewel__lip" />
  </span>;
}

export default function CdLibraryWall({ open, library, selection, error, onPick, onClose, onFlightComplete, onExited, getTarget }) {
  const [present, setPresent] = useState(open);
  const [query, setQuery] = useState('');
  const [metrics, setMetrics] = useState(() => cylinderMetrics(window.innerWidth, window.innerHeight, 200));
  const [offsets, setOffsets] = useState([0, 0, 0, 0]);
  const items = useMemo(() => wallItems(library, query), [library, query]);
  const root = useRef(null);
  const hero = useRef(null);
  const wallOpacity = useRef(0);
  const buttons = useRef(new Map());
  const hover = useRef(null);
  const emphasis = useRef(new Map());
  const pointer = useRef(null);
  const [wheelMotion] = useState(createRowWheelMotion);
  const phases = useRef([0, 0, 0, 0]);
  const renderedOffsets = useRef([0, 0, 0, 0]);
  const props = useRef({});
  useLayoutEffect(() => { props.current = { onFlightComplete, onExited, onClose, getTarget }; });
  useLayoutEffect(() => { emphasis.current.clear(); hover.current = null; wheelMotion.reset(); }, [metrics, query, library.source, library.view, library.activePlaylist?.id, wheelMotion]);
  useLayoutEffect(() => { phases.current.fill(0); }, [query]);
  useLayoutEffect(() => { wheelMotion.reset(); }, [open, selection, wheelMotion]);
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    const node = root.current;
    if (!present || !node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = open ? 1 : 0;
    let cancelled = false;
    const animation = node.animate([{ opacity: wallOpacity.current }, { opacity: target }], {
      duration: reduced ? 120 : open ? 650 : 900,
      easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards',
    });
    animation.finished.then(() => {
      if (cancelled) return;
      wallOpacity.current = target;
      if (!open) { setPresent(false); props.current.onExited(); }
    }).catch(() => {});
    return () => {
      cancelled = true;
      wallOpacity.current = Number.parseFloat(getComputedStyle(node).opacity) || 0;
      node.style.opacity = String(wallOpacity.current);
      animation.cancel();
    };
  }, [open, present]);

  useLayoutEffect(() => {
    if (!present) return;
    const update = () => setMetrics(cylinderMetrics(window.innerWidth, window.innerHeight, items.length));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [present, items.length]);

  useEffect(() => {
    if (!present || !open || selection) return;
    const node = root.current;
    const onWheel = event => {
      if (event.ctrlKey) return;
      const card = event.target.closest?.('.cd-library__case');
      if (!card || !node.contains(card)) return;
      const pixels = wheelPixels(event, window.innerHeight);
      if (!pixels) return;
      event.preventDefault();
      pointer.current = { x: event.clientX, y: event.clientY };
      hover.current = null;
      wheelMotion.push(Number(card.dataset.wallRow), pixels);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [present, open, selection, wheelMotion]);

  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement;
    root.current?.querySelector('input')?.focus({ preventScroll: true });
    const onKey = event => {
      if (document.querySelector('.netease-login-dialog')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); props.current.onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = [...root.current.querySelectorAll('button:not([disabled]),input,select')].filter(node => node.getClientRects().length && node.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.({ preventScroll: true }); };
  }, [present]);

  useEffect(() => {
    if (!present) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = createRenderClock();
    let frame;
    let wasScrolling = false;
    const tick = now => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) { clock.reset(); wheelMotion.reset(); wasScrolling = false; return; }
      const gap = clock.sample(now);
      if (gap === null) return;
      const dt = Math.min(gap, 0.05);
      const nextOffsets = [];
      const rowWeights = [];
      const rowPhases = [];
      const scrolling = Array.from({ length: metrics.rows }, (_, row) => wheelMotion.moving(row));
      if (wasScrolling && !scrolling.some(Boolean) && pointer.current) {
        const card = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('.cd-library__case');
        hover.current = card && root.current?.contains(card) ? { row: Number(card.dataset.wallRow), slot: Number(card.dataset.wallSlot) } : null;
      }
      wasScrolling = scrolling.some(Boolean);
      for (let row = 0; row < metrics.rows; row++) {
        const active = hover.current?.row === row || Array.from({ length: metrics.columns }, (_, slot) => emphasis.current.get(`${row}:${slot}`) || 0).some(value => value > 0);
        if (!selection) {
          phases.current[row] -= wheelMotion.step(row, dt, reduced) / metrics.cell * metrics.step;
          if (query.trim()) {
            const count = Math.ceil((items.length - row) / metrics.rows);
            const limit = Math.max(0, count - 1) * metrics.step / 2;
            phases.current[row] = Math.max(-limit, Math.min(limit, phases.current[row]));
          } else if (!reduced && !scrolling[row] && !active) phases.current[row] += rowVelocity(row) * dt;
        }
        const shift = Math.floor(phases.current[row] / metrics.step);
        const movedSlots = shift - (renderedOffsets.current[row] || 0);
        if (movedSlots) {
          const old = Array.from({ length: metrics.columns }, (_, slot) => emphasis.current.get(`${row}:${slot}`) || 0);
          for (let slot = 0; slot < metrics.columns; slot++) emphasis.current.set(`${row}:${slot}`, old[slot - movedSlots] || 0);
          if (hover.current?.row === row) hover.current = null;
        }
        rowWeights[row] = Array.from({ length: metrics.columns }, (_, slot) => {
          const id = `${row}:${slot}`;
          const target = Number(!scrolling[row] && hover.current?.row === row && hover.current?.slot === slot);
          let amount = emphasis.current.get(id) || 0;
          if (!selection) amount += (target - amount) * (reduced ? 1 : 1 - Math.exp(-dt * 14));
          if (Math.abs(target - amount) < 0.001) amount = target;
          emphasis.current.set(id, amount);
          return amount;
        });
        nextOffsets[row] = shift;
        rowPhases[row] = phases.current[row] - shift * metrics.step;
      }
      const poses = cylinderWall(metrics, rowPhases, rowWeights);
      for (let row = 0; row < metrics.rows; row++) {
        for (const pose of poses[row]) {
          const node = buttons.current.get(`${row}:${pose.slot}`);
          if (!node) continue;
          if (!pose.visible) {
            node.style.visibility = 'hidden'; node.tabIndex = -1; node.setAttribute('aria-hidden', 'true');
            continue;
          }
          node.style.transform = `translate3d(${pose.x}px,${pose.y}px,${pose.z}px) rotateY(${-pose.angle}rad) scale(${pose.scale})`;
          node.style.visibility = pose.visible ? 'visible' : 'hidden';
          const centerX = window.innerWidth / 2 + pose.x * metrics.perspective / (metrics.perspective - pose.z);
          node.tabIndex = pose.visible && centerX > 0 && centerX < window.innerWidth && !selection ? 0 : -1;
          node.setAttribute('aria-hidden', String(!pose.visible));
        }
      }
      if (nextOffsets.length !== renderedOffsets.current.length || nextOffsets.some((value, i) => value !== renderedOffsets.current[i])) {
        renderedOffsets.current = nextOffsets;
        setOffsets(nextOffsets);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [present, metrics, selection, query, items.length, wheelMotion]);

  useEffect(() => {
    if (!selection || !hero.current) return;
    const target = props.current.getTarget();
    const source = selection.source;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = hero.current.animate([
      { transform: source.transform },
      { transform: `translate3d(${target.x + target.width / 2 - source.x}px,${target.y + target.height / 2 - source.y}px,0) rotateY(0rad) scale(${target.width / source.cell},${target.height / source.cell})` },
    ], { delay: (reduced ? 80 : 320) + 40, duration: reduced ? 100 : 1000, easing: 'cubic-bezier(.22,.8,.22,1)', fill: 'both' });
    animation.finished.then(() => props.current.onFlightComplete(selection.key)).catch(() => {});
    return () => animation.cancel();
  }, [selection]);

  if (!present) return null;
  const isPlaylists = library.source === 'netease' && library.view === 'playlists';
  const value = library.source === 'local' ? 'local' : isPlaylists ? 'playlists' : String(library.activePlaylist?.id || 'results');
  const busy = library.status === 'loading';
  const pick = (item, event, slot) => {
    if (selection) return;
    if (item.kind === 'playlist') { setQuery(''); hover.current = null; library.onPlaylist(item.record); return; }
    const node = event.currentTarget;
    const frame = node.parentElement.getBoundingClientRect();
    onPick(item, node.getBoundingClientRect().toJSON(), {
      slot, cell: metrics.cell, perspective: metrics.perspective,
      x: frame.x + frame.width / 2, y: frame.y + frame.height / 2,
      transform: node.style.transform,
    });
  };

  return createPortal(<section ref={root} className={`cd-library${open ? ' is-open' : ' is-leaving'}${selection ? ' is-selecting' : ''}`}
    onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY }; }}
    onPointerLeave={() => { pointer.current = null; hover.current = null; }}
    style={{ '--cd-wall-clear': window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '80ms' : '320ms' }}
    role="dialog" aria-modal="true" aria-label="圆柱唱片墙" data-wall-items={items.length} data-wall-phase={!open ? 'leaving' : selection ? 'handoff' : 'browsing'}>
    <header className="cd-library__header">
      <div className="cd-library__heading"><span>你的音乐收藏</span><h1>{isPlaylists ? '我的歌单' : library.activePlaylist?.name || (library.source === 'local' ? '本地唱片架' : '在线歌曲')}</h1></div>
      <div className="cd-library__controls">
        <select aria-label="选择唱片墙歌单" value={value} onChange={event => {
          setQuery(''); hover.current = null;
          const id = event.target.value;
          if (id === 'local') library.onLocal();
          else if (id === 'playlists') library.onPlaylists();
          else { const playlist = library.playlists.find(item => String(item.id) === id); if (playlist) library.onPlaylist(playlist); }
        }}>
          <option value="local">本地曲库</option>
          <option value="playlists">我的网易云歌单</option>
          {library.source === 'netease' && !isPlaylists && !library.activePlaylist && <option value="results">在线搜索结果</option>}
          {(library.playlists || []).map(playlist => <option key={playlist.id} value={String(playlist.id)}>{playlist.name}</option>)}
        </select>
        <input type="search" aria-label="搜索唱片墙" placeholder={isPlaylists ? '找歌单' : '找歌名或歌手'} value={query} onChange={event => { setQuery(event.target.value); hover.current = null; }} />
        <button type="button" onClick={onClose}>收起唱片墙 <span aria-hidden="true">×</span></button>
      </div>
    </header>
    {busy ? <p className="cd-library__message" role="status">正在读取你的歌单…</p> : items.length === 0 ? <div className="cd-library__message" role="status">
      <p>{library.error || (query ? '没有找到匹配的音乐' : isPlaylists && !library.loggedIn ? '登录网易云，展开你的歌单' : '这里暂时没有音乐')}</p>
      {isPlaylists && !library.loggedIn && <button type="button" onClick={library.onLogin}>登录网易云</button>}
    </div> : <div className="cd-library__viewport" aria-label={isPlaylists ? '歌单盒子' : '歌曲盒子'}>
      <div className="cd-library__cylinder" style={{ perspective: metrics.perspective, '--cd-wall-cell': `${metrics.cell}px` }}>
        {Array.from({ length: metrics.rows }, (_, row) => Array.from({ length: metrics.columns }, (_, slot) => {
          const item = wallSlotItem(items, metrics, row, slot, offsets[row], Boolean(query.trim()));
          if (!item) return null;
          const id = `${row}:${slot}`;
          return <button key={id} ref={node => { if (node) buttons.current.set(id, node); else buttons.current.delete(id); }}
            className={`cd-library__case${selection?.source.slot === id ? ' is-picked' : ''}`} type="button" data-wall-row={row} data-wall-slot={slot} data-wall-key={item.key} aria-label={`${item.kind === 'playlist' ? '打开歌单' : '播放'} ${item.title} ${item.subtitle}`}
            onPointerEnter={() => { hover.current = { row, slot }; }}
            onPointerLeave={() => { if (hover.current?.row === row && hover.current?.slot === slot) hover.current = null; }}
            onFocus={() => { hover.current = { row, slot }; }} onBlur={() => { hover.current = null; }}
            onClick={event => pick(item, event, id)}>
            <JewelCase item={item} />
            <span className="cd-library__caption"><strong>{item.title}</strong><span>{item.subtitle}</span></span>
          </button>;
        }))}
      </div>
    </div>}
    <div className="cd-library__floor" aria-hidden="true" />
    <footer className="cd-library__footer"><span>{items.length} {isPlaylists ? '张歌单' : '首歌曲'} · 每行反向慢转</span><a href="https://github.com/annnguyentt/vibe-coding/tree/efba8dfb956cca848422f18e8ede1bdf96033fca/cd-case" target="_blank" rel="noreferrer">CD case by Ann Nguyen ↗</a><span role="status">{error || (selection ? '正在取出这张唱片…' : '悬停放大 · 滚轮转动当前行 · 点击取出 · Esc 收起')}</span></footer>
    {selection && <div className="cd-library__flight-stage" style={{ perspective: selection.source.perspective, perspectiveOrigin: `${selection.source.x}px ${selection.source.y}px` }}>
      <div ref={hero} className="cd-library__picked" style={{ left: selection.source.x, top: selection.source.y, width: selection.source.cell, height: selection.source.cell, margin: -selection.source.cell / 2, transform: selection.source.transform }}><JewelCase item={selection.item} /></div>
    </div>}
    {selection && <div className="cd-library__handoff-status"><span role="status">准备播放…</span><button type="button" onClick={onClose}>收起唱片墙</button></div>}
  </section>, document.querySelector('.app.skin-cd-case') || document.body);
}
