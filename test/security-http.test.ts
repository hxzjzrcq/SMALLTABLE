import { sessionBody } from './helpers';
let loginSequence068 = 0;
import { waitEvent, createSmalltable } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import AdmZip from 'adm-zip';
import { config } from '../src/server/config';
import { ServerEvent } from '../src/shared/model';

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
    return waitEvent(events, predicate, after);
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
      body: JSON.stringify({ password: roomPassword, name: 'U' + ++loginSequence068 }),
    });
    assert.equal(login.status, 200);
    const { token } = await sessionBody(login);
    const headers = { Authorization: `Bearer ${token}` };
    ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
    await until((e) => e.type === 'snapshot');
    assert.equal((await fetch(url + '/api/health', { headers })).status, 200);
    const piece = {
      id: randomUUID(),
      name: 'A',
      hidden: false,
      label: '1',
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
    const image = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    const validZip = new AdmZip();
    validZip.addFile('room.json', Buffer.from(JSON.stringify(service.getRoom())));
    const restoreBody = validZip.toBuffer();
    async function deniedHttp() {
      const before = service.getRoom();
      const assets = await readdir(path.join(dir, 'assets'));
      assert.equal((await fetch(url + '/api/backup', { headers })).status, 400);
      for (const [route, contentType, body] of [
        ['/api/restore', 'application/zip', restoreBody],
        ['/api/image/token', 'application/octet-stream', image],
        ['/api/image/map', 'application/octet-stream', image],
      ] as const)
        assert.equal(
          (
            await fetch(url + route, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': contentType },
              body: new Uint8Array(body),
            })
          ).status,
          400,
        );
      assert.deepEqual(service.getRoom(), before);
      assert.deepEqual(await readdir(path.join(dir, 'assets')), assets);
    }
    await deniedHttp();
    ws.send(JSON.stringify({ type: 'unlock', password: dmPassword }));
    await until((e) => e.type === 'snapshot' && e.dm);
    for (const kind of ['token', 'map']) {
      assert.equal(
        (
          await fetch(url + '/api/image/' + kind, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array(image),
          })
        ).status,
        200,
      );
    }
    assert.equal(
      (
        await fetch(url + '/api/restore', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/zip' },
          body: new Uint8Array(restoreBody),
        })
      ).status,
      200,
    );
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
    assert.equal((await fetch(url + '/api/backup', { headers })).status, 400);
    assert.equal((await fetch(url + '/api/health', { headers })).status, 200);
  } finally {
    ws?.terminate();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
