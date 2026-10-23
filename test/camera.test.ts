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
  assert.equal(zoomCamera(camera, point, 0.0001).scale, 0.0001);
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

test('birth center follows scale/pan and stays in both viewport and world; wholly outside view has no birth point', async () => {
  const { visibleWorldCenter } = await import('../src/client/camera');
  assert.deepEqual(visibleWorldCenter({ x: 100, y: -200, scale: 2 }, 800, 600), { x: 300, y: -50 });
  assert.deepEqual(visibleWorldCenter({ x: 32700, y: 0, scale: 1 }, 800, 600), {
    x: 32768,
    y: 300,
  });
  assert.equal(visibleWorldCenter({ x: 40000, y: 0, scale: 1 }, 800, 600), null);
});

test('073 placement spreads consecutive tokens and stays visible at zoomed world edges', async () => {
  const { visibleWorldCenter, visibleWorldPlacement } = await import('../src/client/camera');
  for (const camera of [
    { x: 100, y: -200, scale: 2 },
    { x: 32700, y: 32700, scale: 1 },
    { x: -32800, y: -32800, scale: 8 },
    { x: -1000, y: -1000, scale: 0.1 },
  ]) {
    const width = 800,
      height = 600;
    const points = Array.from({ length: 49 }, (_, i) =>
      visibleWorldPlacement(camera, width, height, i)!,
    );
    assert.deepEqual(points[0], visibleWorldCenter(camera, width, height));
    assert.equal(new Set(points.map((p) => JSON.stringify(p))).size, 49);
    for (const p of points) {
      assert.ok(p.x >= -32768 && p.x <= 32768 && p.y >= -32768 && p.y <= 32768);
      assert.ok(p.x >= camera.x && p.x <= camera.x + width / camera.scale);
      assert.ok(p.y >= camera.y && p.y <= camera.y + height / camera.scale);
    }
    assert.deepEqual(visibleWorldPlacement(camera, width, height, 49), points[0]);
  }
  assert.equal(visibleWorldPlacement({ x: 40000, y: 0, scale: 1 }, 800, 600, 1), null);
  assert.equal(visibleWorldPlacement({ x: 0, y: 0, scale: 1 }, 0, 600, 1), null);
});
