const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function wallItems(library, query = '') {
  if (library.status === 'loading' || library.status === 'error') return [];
  const playlists = library.source === 'netease' && library.view === 'playlists';
  const records = playlists ? library.playlists : library.tracks;
  const seen = new Set();
  const needle = query.trim().toLocaleLowerCase();
  return (records || []).flatMap(record => {
    const key = `${playlists ? 'playlist' : record.source || 'local'}:${record.id || record.fileUrl || record.url || `${record.title}-${record.artist}`}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const title = playlists ? record.name : record.title;
    const subtitle = playlists ? `${record.trackCount ?? record.songCount ?? 0} 首歌曲` : record.artist;
    if (needle && !`${title} ${subtitle}`.toLocaleLowerCase().includes(needle)) return [];
    return [{ key, title: title || '未命名', subtitle: subtitle || '', cover: record.coverUrl || record.coverPath || record.artwork || '/covers/default-cover.jpg', kind: playlists ? 'playlist' : 'track', record }];
  });
}

export function cylinderMetrics(width, height, itemCount) {
  const rows = Math.min(width < 700 ? 3 : 4, Math.max(1, itemCount));
  const cell = clamp(Math.min((height - 178) / rows, width / (width < 700 ? 3.4 : 8.5)), 92, 190);
  const radius = Math.max(cell * 3, width * 0.48);
  const columns = Math.min(17, Math.ceil(width / cell / 2) * 2 + 5);
  return { rows, cell, radius, columns, perspective: Math.max(360, width * 0.5), step: 2 * Math.asin(cell / (2 * radius)) };
}

// Variable angular widths share the same endpoint on the cylinder. Enlarging
// one case therefore pushes its neighbours instead of covering them or opening
// a horizontal gap. All positions are presentation values, updated by the RAF.
export function cylinderRow(metrics, row, phase, hoverSlot = -1, emphasis = 0, weights) {
  const { cell, radius, columns, rows, step } = metrics;
  const scales = Array.from({ length: columns }, (_, slot) => 1 + 0.34 * clamp(Array.isArray(weights) ? weights[slot] || 0 : slot === hoverSlot ? emphasis : 0, 0, 1));
  const halves = scales.map(scale => Math.asin(cell * scale / (2 * radius)));
  const span = halves.reduce((sum, half) => sum + half * 2, 0);
  const baseline = (row - (rows - 1) / 2) * cell;
  let edge = phase - columns * step / 2 - (span - columns * step) / 2;
  return Array.from({ length: columns }, (_, slot) => {
    const scale = scales[slot];
    const half = halves[slot];
    const angle = edge + half;
    edge += half * 2;
    const distance = radius * Math.cos(half);
    return { slot, angle, half, scale, x: distance * Math.sin(angle), y: baseline, z: radius - distance * Math.cos(angle), visible: Math.abs(angle) < 1.03 };
  });
}

// Solve from animated widths, never by interpolating independent card poses.
// Horizontal edges then remain shared during a rapid hover change as well.
// Vertical constraints propagate through neighbouring rows, with a broad
// approach ramp before contact so rotating cards have room before they meet.
export function cylinderWall(metrics, phases, weights = []) {
  const rows = Array.from({ length: metrics.rows }, (_, row) => cylinderRow(metrics, row, phases[row] || 0, -1, 0, weights[row]));
  const anchor = Math.floor((metrics.rows - 1) / 2);
  const baseline = row => (row - (metrics.rows - 1) / 2) * metrics.cell;
  const separate = (row, neighbour, direction) => {
    for (const pose of rows[row]) {
      for (const other of rows[neighbour]) {
        const gap = Math.abs(pose.angle - other.angle) - pose.half - other.half;
        const ramp = clamp(1 - Math.max(0, gap) / metrics.step, 0, 1);
        const influence = ramp * ramp * (3 - 2 * ramp);
        const shift = other.y - baseline(neighbour) + direction * metrics.cell * (pose.scale + other.scale - 2) / 2;
        const limit = baseline(row) + shift * influence;
        pose.y = direction > 0 ? Math.max(pose.y, limit) : Math.min(pose.y, limit);
      }
    }
  };
  for (let row = anchor - 1; row >= 0; row--) separate(row, row + 1, -1);
  for (let row = anchor + 1; row < metrics.rows; row++) separate(row, row - 1, 1);
  return rows;
}

export function rowItem(items, rows, row, index) {
  const count = Math.ceil((items.length - row) / rows);
  if (count < 1) return null;
  const wrapped = ((index % count) + count) % count;
  return items[wrapped * rows + row];
}

export function wallSlotItem(items, metrics, row, slot, offset, filtered = false) {
  if (filtered && items.length <= metrics.rows * metrics.columns) {
    const count = Math.max(0, Math.ceil((items.length - row) / metrics.rows));
    const start = Math.floor((metrics.columns - count) / 2);
    const index = slot - start - offset;
    return index < 0 || index >= count ? null : items[index * metrics.rows + row];
  }
  return rowItem(items, metrics.rows, row, slot - offset);
}

export const rowVelocity = row => [0.024, -0.020, 0.018, -0.026][row % 4];
