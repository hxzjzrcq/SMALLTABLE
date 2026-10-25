import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';
import { initialRoom } from '../src/shared/model';
import { testStorage } from './helpers';
import { captureLogs } from './support/log-capture';

test('existing 10-second loop collects every 15 minutes, serializes ticks and spaces failed attempts', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-maintenance-075-'));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const callbacks: { callback: () => void; ms: number }[] = [];
  t.mock.method(globalThis, 'setInterval', (callback: () => void, ms: number) => {
    callbacks.push({ callback, ms });
    return { unref() {} };
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const logs = captureLogs(t);
  const service = await createSmalltable(
    { ...config(), dataDir: dir },
    {
      roomMatches: async () => false,
      dmMatches: async () => false,
      change: async () => {},
    },
  );
  try {
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].ms, 10000);
    let calls = 0;
    let fail = false;
    let release: (() => void) | undefined;
    let hold = false;
    t.mock.method(service.storage, 'collect', async () => {
      calls++;
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (fail) throw new Error('resource scan unavailable');
    });
    const tick = async (elapsed: number) => {
      now += elapsed;
      callbacks[0].callback();
      await turn();
    };
    await tick(10000);
    await tick(15 * 60000 - 20000);
    assert.equal(calls, 0);
    await tick(10000);
    assert.equal(calls, 1);
    await tick(10000);
    assert.equal(calls, 1);
    fail = true;
    await tick(15 * 60000 - 10000);
    assert.equal(calls, 2);
    assert.ok(logs.events().includes('resource.cleanup_failed'));
    await tick(10000);
    assert.equal(calls, 2);
    fail = false;
    hold = true;
    await tick(15 * 60000 - 10000);
    assert.equal(calls, 3);
    await tick(10000);
    await tick(10000);
    release!();
    await turn();
    assert.equal(calls, 3);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('temporary images survive beyond 10 minutes; exact 30-minute expiry permits collection while formal refs survive', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-leases-075-'));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const storage = testStorage({ ...config(), dataDir: dir });
  const room = initialRoom();
  try {
    const temporary = await storage.install(Buffer.from('temporary image'), 'webp');
    const formal = await storage.install(Buffer.from('formal image'), 'webp');
    const abandoned = await storage.install(Buffer.from('abandoned image'), 'webp');
    room.maps.push({
      id: randomUUID(),
      asset: formal,
      name: 'map',
      scale: 100,
      width: 1,
      height: 1,
    });
    const uploadId = storage.temporary(temporary, 'owner');
    now += 10 * 60000 + 1;
    await storage.collect(room);
    assert.doesNotThrow(() => storage.checkBinding(temporary, uploadId, 'owner', room));
    assert.throws(() => storage.checkBinding(temporary, uploadId, 'other', room));
    assert.deepEqual(new Set((await storage.files()).keys()), new Set([temporary, formal]));
    assert.ok(!(await storage.files()).has(abandoned));
    now += 20 * 60000 - 2;
    assert.doesNotThrow(() => storage.checkBinding(temporary, uploadId, 'owner', room));
    now++;
    assert.throws(() => storage.checkBinding(temporary, uploadId, 'owner', room), /过期/);
    // Expiration alone does not delete a file.
    assert.ok((await storage.files()).has(temporary));
    await storage.collect(room);
    assert.deepEqual([...(await storage.files()).keys()], [formal]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
