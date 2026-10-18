import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomCamera, pinchCamera } from '../src/client/camera.js';
import { readNotes, writeNotes, NOTES_KEY } from '../src/client/notes-store.js';
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
test('rebranding preserves legacy local notes and explicit empty new notes stay empty', () => {
  const map = new Map([['tabletop.private-notes.v1', '原有角色笔记']]);
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  assert.equal(readNotes(storage), '原有角色笔记');
  writeNotes(storage, '');
  assert.equal(map.get(NOTES_KEY), '');
  assert.equal(readNotes(storage), '');
  assert.equal(map.get('tabletop.private-notes.v1'), '原有角色笔记');
});
