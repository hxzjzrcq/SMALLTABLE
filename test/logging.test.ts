import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { logEvent } from '../src/server/log';
import { config } from '../src/server/config';
import { testStorage } from './helpers';
import { captureLogs } from './support/log-capture';

test('logs have fixed fields and levels, allow operational codes, and never serialize sensitive details', (t) => {
  const logs = captureLogs(t);
  const secret = 'password-token-private-note-061\nFORGED';
  const error = Object.assign(new Error(secret), { code: 'ENOSPC', cause: { password: secret } });
  logEvent('storage.save_failed', { error, password: secret, note: secret, token: secret } as any);
  logEvent('auth.dm_failed', { scope: secret, reason: secret, error: { code: secret } } as any);
  logEvent('process.started', { port: 3000 });
  logEvent('FORGED\nEVENT' as any);
  assert.equal(logs.lines.length, 3);
  const [disk, auth, started] = logs.records();
  assert.deepEqual(Object.keys(disk).sort(), ['code', 'event', 'level', 'time']);
  assert.equal(disk.code, 'ENOSPC');
  assert.equal(disk.level, 'error');
  assert.equal(auth.level, 'warn');
  assert.deepEqual(Object.keys(auth).sort(), ['event', 'level', 'time']);
  assert.equal(started.level, 'info');
  assert.equal(started.port, 3000);
  for (const record of logs.records())
    assert.equal(new Date(record.time as string).toISOString(), record.time);
  assert.ok(!logs.lines.join('').includes(secret));
  assert.ok(!logs.lines.join('').includes('FORGED'));
});

test('a failed output sink cannot throw into a business operation', (t) => {
  t.mock.method(console, 'error', () => {
    throw new Error('sink unavailable');
  });
  assert.doesNotThrow(() => logEvent('storage.save_failed', { error: new Error('private') }));
});

test('configuration and disk read failures are logged without raw input; a new room is not an error', async (t) => {
  const logs = captureLogs(t);
  const dir = await mkdtemp(path.join(tmpdir(), 'st-log-disk-'));
  const secret = 'private-config-and-room-text-061';
  try {
    const storage = testStorage({ ...config(), dataDir: dir });
    assert.equal(await storage.load(), null);
    assert.deepEqual(logs.events(), []);
    await writeFile(path.join(dir, 'room.json'), secret);
    await assert.rejects(storage.load(), /存档损坏/);
    const settings = path.join(dir, secret + '.json');
    await writeFile(settings, JSON.stringify({ password: secret }));
    assert.throws(() => config(settings), /配置/);
    assert.deepEqual(logs.events(), ['storage.load_failed', 'config.load_failed']);
    assert.ok(!logs.lines.join('').includes(secret));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
