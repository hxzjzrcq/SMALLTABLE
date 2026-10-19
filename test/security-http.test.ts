import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import AdmZip from 'adm-zip';
import { createSmalltable } from './helpers';
import { config } from '../src/server/config';
import type { ServerEvent } from '../src/shared/model';

test('HTTP/WS authorization, lock/disconnect and serialized outputs preserve security boundaries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-security-'));
  const roomPassword = 'unique-room-secret-053',
    dmPassword = 'unique-dm-secret-053';
  const cfg = { ...config(), dataDir: dir };
  const service = await createSmalltable(cfg, { roomPassword, dmPassword });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  let ws: WebSocket | undefined;
  const events: ServerEvent[] = [];
  async function until(predicate: (e: ServerEvent) => boolean, after = 0) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const event = events.slice(after).find(predicate);
      if (event) return event;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('missing event');
  }
  function noPasswords(value: unknown) {
    const json = JSON.stringify(value);
    assert.ok(!json.includes(roomPassword));
    assert.ok(!json.includes(dmPassword));
    assert.ok(!json.includes('roomPassword'));
    assert.ok(!json.includes('dmPassword'));
  }
  try {
    noPasswords(cfg);
    const caps = await (await fetch(url + '/api/config')).json();
    assert.deepEqual(caps, cfg.caps);
    noPasswords(caps);
    assert.equal((await fetch(url + '/api/health')).status, 401);
    assert.equal((await fetch(url + '/media/' + 'a'.repeat(64) + '.webp')).status, 401);
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: roomPassword }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
    await until((e) => e.type === 'snapshot');
    assert.equal((await fetch(url + '/api/health', { headers })).status, 200);
    const piece = {
      id: randomUUID(),
      name: 'A',
      label: '',
      shape: 'circle',
      color: '#000000',
      x: 0,
      y: 0,
      size: 1,
      angle: 0,
      asset: null,
      note: '',
      secret: 'private-DM-note',
    };
    for (const command of [
      { type: 'create', token: piece },
      { type: 'edit', token: piece },
      { type: 'delete', id: piece.id },
      { type: 'clear' },
      { type: 'grid', grid: service.getRoom().grid },
      { type: 'names', names: ['B'] },
      { type: 'drawing.clear', epoch: 0 },
    ]) {
      const mark = events.length,
        revision = service.getRoom().revision;
      ws.send(JSON.stringify(command));
      await until((e) => e.type === 'error', mark);
      assert.equal(service.getRoom().revision, revision);
    }
    async function deniedHttp() {
      assert.equal((await fetch(url + '/api/backup', { headers })).status, 400);
      for (const [route, contentType] of [
        ['/api/restore', 'application/zip'],
        ['/api/image/token', 'application/octet-stream'],
      ])
        assert.equal(
          (
            await fetch(url + route, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': contentType },
              body: new Uint8Array([0]),
            })
          ).status,
          400,
        );
    }
    await deniedHttp();
    ws.send(JSON.stringify({ type: 'unlock', password: dmPassword }));
    await until((e) => e.type === 'snapshot' && e.dm);
    ws.send(JSON.stringify({ type: 'create', token: piece }));
    await until((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    const backup = await fetch(url + '/api/backup', { headers });
    assert.equal(backup.status, 200);
    const json = JSON.parse(
      new AdmZip(Buffer.from(await backup.arrayBuffer())).readAsText('room.json'),
    );
    noPasswords(json);
    assert.equal(json.tokens[0].secret, 'private-DM-note');
    let mark = events.length;
    ws.send(JSON.stringify({ type: 'lock' }));
    const publicEvent = await until((e) => e.type === 'snapshot' && !e.dm, mark);
    noPasswords(publicEvent);
    assert.ok(!JSON.stringify(publicEvent).includes('private-DM-note'));
    await deniedHttp();
    mark = events.length;
    ws.send(JSON.stringify({ type: 'clear' }));
    await until((e) => e.type === 'error', mark);
    assert.equal(service.getRoom().tokens.length, 1);
    mark = events.length;
    ws.send(JSON.stringify({ type: 'not-implemented' }));
    await until((e) => e.type === 'error', mark);
    const closed = new Promise<void>((r) => ws!.once('close', () => r()));
    ws.close();
    await closed;
    assert.equal((await fetch(url + '/api/backup', { headers })).status, 401);
  } finally {
    ws?.terminate();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
