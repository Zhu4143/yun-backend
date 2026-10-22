import assert from 'node:assert/strict';
import test from 'node:test';
import { opticalCard, overlapFraction } from './opticalSurfaceGeometry.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
test('liquid ore follows the actual canvas position and render resolution', () => {
  const body = rect(150, 550, 500, 80);
  const card = opticalCard(body, rect(100, 50, 1000, 700), { width: 1500, height: 1050 }, 40);
  assert.deepEqual(card, { x: 450, y: 240, halfWidth: 375, halfHeight: 60, radius: 60 });
});
test('hidden, tiny and ancestor-clipped bodies cannot leave stray optical edges', () => {
  const canvas = rect(0, 0, 390, 844), buffer = { width: 585, height: 1266 };
  assert.equal(opticalCard(rect(400, 20, 100, 100), canvas, buffer, 20), null);
  assert.equal(opticalCard(rect(50, 20, 0, 100), canvas, buffer, 20), null);
  assert.equal(opticalCard(rect(20, 20, 100, 100), canvas, buffer, 20, [rect(40, 0, 80, 200)]), null);
  assert.ok(opticalCard(rect(-20, 20, 100, 100), canvas, buffer, 20), 'viewport clipping preserves the original body geometry');
});
test('a morph shell replaces the arriving panel instead of stacking two lenses', () => {
  const body = rect(100, 100, 500, 100);
  assert.ok(overlapFraction(body, rect(103, 104, 490, 96)) > 0.9);
  assert.equal(overlapFraction(body, rect(700, 100, 500, 100)), 0);
});
