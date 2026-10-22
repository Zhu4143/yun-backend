import assert from 'node:assert/strict';
import test from 'node:test';
import { cylinderMetrics, cylinderRow, cylinderWall, rowItem, rowVelocity, wallItems, wallSlotItem } from './libraryWallModel.js';

test('wall items retain the actual song and playlist objects, filter locally and deduplicate', () => {
  const song = Object.freeze({ id: 'a', title: '小半', artist: '陈粒', coverUrl: '/real.jpg' });
  const playlist = Object.freeze({ id: 'p', name: '我喜欢的音乐', trackCount: 120, coverUrl: '/liked.jpg' });
  const local = wallItems({ source: 'local', tracks: [song, song] }, '陈粒');
  assert.equal(local.length, 1);
  assert.equal(local[0].record, song);
  assert.equal(local[0].cover, '/real.jpg');
  const lists = wallItems({ source: 'netease', view: 'playlists', playlists: [playlist] });
  assert.equal(lists[0].kind, 'playlist');
  assert.equal(lists[0].record, playlist);
  assert.equal(wallItems({ source: 'local', tracks: [song] }, '不存在').length, 0);
  assert.equal(wallItems({ source: 'netease', view: 'songs', status: 'error', tracks: [song] }).length, 0, 'never show the old playlist after a new playlist fails');
});

test('a hovered case and its neighbours share cylinder endpoints without overlap or gaps', () => {
  const metrics = cylinderMetrics(1651, 871, 211);
  const poses = cylinderRow(metrics, 1, 0.06, 7, 1, 1);
  const endpoint = (pose, side) => ({
    x: pose.x + side * metrics.cell * pose.scale / 2 * Math.cos(pose.angle),
    z: pose.z + side * metrics.cell * pose.scale / 2 * Math.sin(pose.angle),
  });
  for (let i = 0; i < poses.length - 1; i++) {
    const right = endpoint(poses[i], 1); const left = endpoint(poses[i + 1], -1);
    assert.ok(Math.abs(right.x - left.x) < 1e-8);
    assert.ok(Math.abs(right.z - left.z) < 1e-8);
  }
  assert.ok(poses[7].scale > 1.3);
  assert.equal(poses[6].scale, 1);
});

test('adjacent rows counter-rotate and large libraries keep a bounded pool of cards', () => {
  assert.ok(rowVelocity(0) * rowVelocity(1) < 0);
  assert.ok(rowVelocity(1) * rowVelocity(2) < 0);
  for (const [w, h] of [[390, 844], [1651, 871], [3840, 2160]]) {
    const metrics = cylinderMetrics(w, h, 10000);
    assert.ok(metrics.rows * metrics.columns <= 68);
    assert.ok(Number.isFinite(cylinderRow(metrics, 0, 0)[0].x));
  }
});

test('rapid hover changes keep shared side edges and enough space between every overlapping row', () => {
  for (const [width, height] of [[390, 844], [1280, 720], [1651, 871]]) {
    const metrics = cylinderMetrics(width, height, 211);
    const weights = Array.from({ length: metrics.rows }, () => Array(metrics.columns).fill(0));
    for (let frame = 0; frame < 180; frame++) {
      const targetRow = Math.floor(frame / 12) % metrics.rows;
      const targetSlot = 3 + Math.floor(frame / 9) % (metrics.columns - 6);
      for (let row = 0; row < metrics.rows; row++) for (let slot = 0; slot < metrics.columns; slot++) {
        weights[row][slot] += (Number(row === targetRow && slot === targetSlot) - weights[row][slot]) * 0.21;
      }
      const rows = cylinderWall(metrics, [0.02, 0.11, 0.03, 0.17], weights);
      for (const row of rows) for (let slot = 0; slot < row.length - 1; slot++) {
        const a = row[slot]; const b = row[slot + 1];
        for (const axis of ['x', 'z']) {
          const trig = axis === 'x' ? Math.cos : Math.sin;
          const aEdge = a[axis] + metrics.cell * a.scale / 2 * trig(a.angle);
          const bEdge = b[axis] - metrics.cell * b.scale / 2 * trig(b.angle);
          assert.ok(Math.abs(aEdge - bEdge) < 1e-8, 'animated widths must preserve contact');
        }
      }
      for (let row = 1; row < rows.length; row++) for (const lower of rows[row]) for (const upper of rows[row - 1]) {
        if (Math.abs(lower.angle - upper.angle) >= lower.half + upper.half) continue;
        assert.ok(lower.y - upper.y >= metrics.cell * (lower.scale + upper.scale) / 2 - 1e-8,
          'all angularly overlapping cards need their full combined half-heights');
      }
    }
  }
});

test('row wrap preserves the item at the same physical cylinder position', () => {
  const items = Array.from({ length: 211 }, (_, id) => ({ id }));
  const rows = 4;
  const slot = 6;
  const metrics = cylinderMetrics(1651, 871, items.length);
  const before = cylinderRow(metrics, 0, metrics.step - 1e-7)[slot];
  const after = cylinderRow(metrics, 0, 0)[slot + 1];
  assert.ok(Math.abs(before.x - after.x) < 0.001);
  assert.equal(rowItem(items, rows, 0, slot), rowItem(items, rows, 0, slot + 1 - 1));
  for (let row = 0; row < rows; row++) {
    const selected = rowItem(items, rows, row, -100);
    assert.equal(selected.id % rows, row);
  }
  assert.equal(rowItem([], rows, 0, 0), null);
});

test('small search result sets appear once, centred, without changing the browsing loop', () => {
  for (const count of [1, 2, 7]) {
    const items = Array.from({ length: count }, (_, id) => ({ id }));
    const metrics = cylinderMetrics(1651, 871, count);
    const rendered = [];
    for (let row = 0; row < metrics.rows; row++) for (let slot = 0; slot < metrics.columns; slot++) {
      const item = wallSlotItem(items, metrics, row, slot, 0, true);
      if (item) rendered.push(item.id);
    }
    assert.deepEqual(rendered.sort((a, b) => a - b), items.map(item => item.id));
    assert.ok(wallSlotItem(items, metrics, 0, 0, 13, false));
  }
});

test('a filtered result keeps its physical slot while a manually scrolled row wraps', () => {
  const items = Array.from({ length: 12 }, (_, id) => ({ id }));
  const metrics = cylinderMetrics(1280, 720, items.length);
  const slot = Math.floor(metrics.columns / 2);
  assert.equal(wallSlotItem(items, metrics, 1, slot, 0, true), wallSlotItem(items, metrics, 1, slot + 1, 1, true));
});
