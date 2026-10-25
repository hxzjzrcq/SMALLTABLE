import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { logEvent } from '../src/server/log';
import { config } from '../src/server/config';
import { testStorage } from './helpers';
import { captureLogs } from './support/log-capture';

test('logs have fixed fields and levels, retain diagnostics and operational codes, and never serialize sensitive details', (t) => {
  const logs = captureLogs(t);
  const secret = 'password-token-private-note-061\nFORGED';
  const error = Object.assign(new Error('write failed: password=' + secret), {
    code: 'ENOSPC',
    cause: { password: secret },
  });
  logEvent('storage.save_failed', { error, password: secret, note: secret, token: secret } as any);
  logEvent('auth.dm_failed', {
    scope: secret,
    reason: secret,
    error: { code: secret, password: secret },
  } as any);
  logEvent('process.started', { port: 3000 });
  logEvent('FORGED\nEVENT' as any);
  assert.equal(logs.lines.length, 3);
  const [disk, auth, started] = logs.records();
  assert.deepEqual(Object.keys(disk).sort(), [
    'code',
    'errorMessage',
    'errorType',
    'event',
    'level',
    'time',
  ]);
  assert.equal(disk.code, 'ENOSPC');
  assert.equal(disk.errorType, 'Error');
  assert.match(disk.errorMessage as string, /write failed/);
  assert.equal(disk.level, 'error');
  assert.equal(auth.level, 'warn');
  assert.deepEqual(Object.keys(auth).sort(), ['errorType', 'event', 'level', 'time']);
  assert.equal(started.level, 'info');
  assert.equal(started.port, 3000);
  for (const record of logs.records())
    assert.equal(new Date(record.time as string).toISOString(), record.time);
  assert.ok(!logs.lines.join('').includes(secret));
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

test('plain errors, new codes and non-Error rejections retain bounded diagnostic text', (t) => {
  const logs = captureLogs(t);
  logEvent('process.startup_failed', {
    error: Object.assign(new Error('listen failed'), { code: 'EADDRINUSE' }),
  });
  logEvent('config.load_failed', { error: new Error('无效配置 PORT') });
  logEvent('image.process_failed', {
    error: Object.assign(new TypeError('decoder unavailable'), { code: 'ERR_NEW_DECODER' }),
  });
  logEvent('process.unhandled_rejection', { error: 'worker stopped' });
  logEvent('process.unhandled_rejection', {
    error: { message: 'disk busy', code: 'CUSTOM_IO', privateNote: 'HIDDEN' },
  });
  logEvent('process.unhandled_rejection', { error: { privateNote: 'HIDDEN' } });
  logEvent('server.error', { error: new Error('x'.repeat(1000)) });
  const records = logs.records();
  assert.equal(records[0].code, 'EADDRINUSE');
  assert.equal(records[1].errorMessage, '无效配置 PORT');
  assert.equal(records[2].errorType, 'TypeError');
  assert.equal(records[2].code, 'ERR_NEW_DECODER');
  assert.equal(records[2].errorMessage, 'decoder unavailable');
  assert.equal(records[3].errorMessage, 'worker stopped');
  assert.equal(records[4].errorMessage, 'disk busy');
  assert.equal(records[5].errorType, 'object');
  assert.equal((records[6].errorMessage as string).length, 512);
  assert.ok(!logs.lines.join('').includes('HIDDEN'));
});

test('diagnostics redact credentials, quoted input, identifiers and private field values', (t) => {
  const logs = captureLogs(t);
  const secret = 'SENSITIVE_075';
  for (const message of [
    'Authorization: Bearer ' + secret,
    'Cookie: tt_room=' + secret,
    'Bearer ' + secret,
    'password=' + secret,
    'token="' + secret + '"',
    'DMPrivate: ' + secret,
    'privateNote=' + secret,
    '私人笔记=' + secret,
    'Unexpected token in "' + secret + '"',
    'Invalid JSON ' + JSON.stringify('prefix "' + secret + '"'),
    'failure at /tmp/' + secret + '/room.json',
  ])
    logEvent('server.error', { error: new Error(message) });
  logEvent('server.error', { error: new Error('session=' + 'a'.repeat(64)) });
  assert.ok(!logs.lines.join('').includes(secret));
  assert.ok(!logs.lines.join('').includes('a'.repeat(64)));
  assert.ok(logs.records().every((r) => typeof r.errorMessage === 'string'));
});
