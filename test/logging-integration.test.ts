import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';
import type { ServerEvent } from '../src/shared/model';
import { waitEvent } from './helpers';
import { makeToken } from './room-fixture';
import { captureLogs } from './support/log-capture';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-log-api-'));
  const roomPassword = 'Room-Log-061-Secret',
    dmPassword = 'Keeper-Log-061-Secret';
  const service = await createSmalltable(
    { ...config(), dataDir: dir },
    {
      roomMatches: async (value) => value === roomPassword,
      dmMatches: async (value) => value === dmPassword,
      change: async () => {
        throw Error(dmPassword);
      },
    },
  );
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  const login = (password: string) =>
    fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  async function peer() {
    const response = await login(roomPassword);
    assert.equal(response.status, 200);
    const { token } = await response.json();
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    sockets.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (data) => events.push(JSON.parse(data.toString())));
    ws.on('error', () => {});
    await waitEvent(events, (e) => e.type === 'snapshot');
    return {
      ws,
      events,
      token,
      send: (command: unknown) => ws.send(JSON.stringify(command)),
      headers: { Authorization: 'Bearer ' + token },
      async unlock() {
        const mark = events.length;
        ws.send(JSON.stringify({ type: 'unlock', password: dmPassword }));
        await waitEvent(events, (e) => e.type === 'snapshot' && e.dm, mark);
      },
    };
  }
  return {
    url,
    service,
    peer,
    login,
    roomPassword,
    dmPassword,
    async close() {
      for (const ws of sockets) ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('failed logins, DM authorization and their rate limits generate safe warning events', async (t) => {
  const logs = captureLogs(t),
    f = await fixture();
  try {
    assert.equal((await f.login('wrong-private-password')).status, 403);
    const p = await f.peer();
    for (let i = 0; i < 6; i++) {
      const mark = p.events.length;
      p.send({ type: 'unlock', password: 'wrong-private-dm' });
      await waitEvent(p.events, (e) => e.type === 'error', mark);
    }
    for (let i = 0; i < 20; i++) await f.login('wrong-private-password');
    assert.ok(logs.events().includes('auth.login_failed'));
    assert.ok(logs.events().includes('auth.dm_failed'));
    const scopes = logs
      .records()
      .filter((r) => r.event === 'rate_limit.triggered')
      .map((r) => r.scope);
    assert.ok(scopes.includes('login'));
    assert.ok(scopes.includes('dm'));
    for (const secret of [
      f.roomPassword,
      f.dmPassword,
      p.token,
      'wrong-private-password',
      'wrong-private-dm',
    ])
      assert.ok(!logs.lines.join('').includes(secret));
  } finally {
    await f.close();
  }
});

test('normal updates stay quiet; save/restore/image/real WebSocket errors are observable without private data', async (t) => {
  const logs = captureLogs(t),
    f = await fixture();
  const save = f.service.storage.save.bind(f.service.storage);
  try {
    const p = await f.peer();
    await p.unlock();
    const secret = 'DM-private-player-note-sentinel-061';
    const piece = { ...makeToken(), secret };
    p.send({ type: 'create', token: piece });
    await waitEvent(p.events, (e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    p.send({ type: 'move', id: piece.id, x: 99, y: 33, final: true, epoch: 0 });
    await waitEvent(p.events, (e) => e.type === 'token' && e.token.x === 99);
    await waitEvent(p.events, (e) => e.type === 'saved' && e.revision === 2);
    assert.deepEqual(logs.events(), []);
    f.service.storage.save = async () => {
      throw Object.assign(Error(secret), { code: 'ENOSPC' });
    };
    const mark = p.events.length;
    p.send({ type: 'rotate', id: piece.id, angle: 45, epoch: 0 });
    await waitEvent(p.events, (e) => e.type === 'error', mark);
    f.service.storage.save = save;
    const restore = await fetch(f.url + '/api/restore', {
      method: 'POST',
      headers: { ...p.headers, 'Content-Type': 'application/zip' },
      body: secret,
    });
    assert.equal(restore.status, 400);
    const image = await fetch(f.url + '/api/image/token', {
      method: 'POST',
      headers: { ...p.headers, 'Content-Type': 'application/octet-stream' },
      body: secret,
    });
    assert.equal(image.status, 400);
    const closed = once(p.ws, 'close');
    p.ws.send(Buffer.from([0xff]), { binary: false });
    assert.equal((await closed)[0], 1007);
    for (const event of [
      'storage.save_failed',
      'backup.restore_failed',
      'image.process_failed',
      'websocket.error',
    ])
      assert.ok(logs.events().includes(event), event);
    for (const value of [secret, f.roomPassword, f.dmPassword, p.token])
      assert.ok(!logs.lines.join('').includes(value));
  } finally {
    f.service.storage.save = save;
    await f.close();
  }
});
