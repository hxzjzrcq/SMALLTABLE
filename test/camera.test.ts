import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomCamera, pinchCamera } from '../src/client/camera.js';

test('touch zoom buttons preserve the center anchor and clamp scaling', () => {
  const camera = { x: 10, y: 20, scale: 1 },
    point = { x: 100, y: 200 },
    next = zoomCamera(camera, point, 2);
  assert.equal(next.x + point.x / next.scale, camera.x + point.x / camera.scale);
  assert.equal(next.y + point.y / next.scale, camera.y + point.y / camera.scale);
  assert.equal(zoomCamera(camera, point, 1000).scale, 8);
  assert.equal(zoomCamera(camera, point, 0.0001).scale, 0.03);
});

test('two-finger gesture preserves its world anchor while midpoint pans', () => {
  const next = pinchCamera({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 100, 200, {
    x: 120,
    y: 140,
  });
  assert.equal(next.scale, 2);
  assert.equal(next.x + 120 / next.scale, 100);
  assert.equal(next.y + 140 / next.scale, 100);
});
