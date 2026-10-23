import { sessionBody } from './helpers';
let loginSequence068 = 0;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { WebSocket } from 'ws';
import { config } from '../src/server/config';
import { createLimitsRoom as createSmalltable } from './support/limits-fixture';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom, type ServerEvent, parseRoom } from '../src/shared/model';
import { token, drawing, Peer } from './support/limits-fixture';
import {
  roomPassword,
  dmPassword,
  token as managementToken,
  drawing as managementDrawing,
  fixture,
} from './support/management-fixture';

test('real API/socket limits and image edits avoid re-encoding; invalid resource replacement rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-runtime-'));
  const caps = {
    ...DEFAULT_CAPABILITIES,
    maxSeats: 2,
    maxTokens: 3,
    maxInitiative: 4,
    maxDrawings: 5,
    maxRolls: 2,
    maxNames: 6,
    maxNotesBytes: 9,
  };
  const service = await createSmalltable({ ...config(), caps, dataDir: dir });
  const peers: Peer[] = [];
  const convert = service.storage.validateImage.bind(service.storage);
  const check = service.storage.checkImage.bind(service.storage);
  let converted = 0,
    checked = 0;
  service.storage.validateImage = async (...args) => {
    converted++;
    return convert(...args);
  };
  service.storage.checkImage = async (...args) => {
    checked++;
    return check(...args);
  };
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const login = () =>
    fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-room', name: 'U' + ++loginSequence068 }),
    });
  try {
    assert.deepEqual(await (await fetch(url + '/api/config')).json(), caps);
    let auth = '';
    for (let i = 0; i < 2; i++) {
      const res = await login();
      assert.equal(res.status, 200);
      const { token: credential } = await sessionBody(res);
      if (!i) auth = credential;
      const peer = new Peer(
        new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', credential]),
      );
      peers.push(peer);
      const event = await peer.until((e) => e.type === 'snapshot');
      assert.deepEqual(event.type === 'snapshot' && event.caps, caps);
    }
    assert.equal((await login()).status, 409);
    const dm = peers[0];
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.until((e) => e.type === 'snapshot' && e.dm);
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff0000' } })
      .png()
      .toBuffer();
    const upload = await fetch(url + '/api/image/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(png),
    });
    assert.equal(upload.status, 200);
    const image = await upload.json();
    assert.equal(converted, 1);
    const first = token(image.asset);
    dm.send({ type: 'create', token: first, uploadId: image.uploadId });
    await dm.until((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    assert.equal(checked, 1);
    assert.equal(converted, 1);
    let mark = dm.events.length;
    dm.send({ type: 'edit', token: { ...first, name: 'renamed', secret: 'changed' } });
    await dm.until((e) => e.type === 'snapshot' && e.room.tokens[0].name === 'renamed', mark);
    assert.equal(checked, 1);
    assert.equal(converted, 1);
    mark = dm.events.length;
    dm.send({ type: 'edit', token: { ...first, asset: 'a'.repeat(64) + '.webp' } });
    await dm.until((e) => e.type === 'error', mark);
    assert.equal(service.getRoom().tokens[0].asset, image.asset);
    const secondData = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#0000ff' },
    })
      .png()
      .toBuffer();
    const second = await service.storage.put(secondData, 'token');
    const before = converted,
      beforeCheck = checked;
    mark = dm.events.length;
    dm.send({
      type: 'edit',
      token: { ...first, asset: second.asset },
      uploadId: service.storage.temporary(second.asset, auth),
    });
    await dm.until((e) => e.type === 'snapshot' && e.room.tokens[0].asset === second.asset, mark);
    assert.equal(checked, beforeCheck + 1);
    assert.equal(converted, before);
    const mapData = await sharp({
      create: { width: 257, height: 1, channels: 4, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    const map = await service.storage.put(mapData, 'map');
    await assert.rejects(() => service.storage.checkImage(map.asset, 'token'), /限制/);
    for (let i = 2; i <= 3; i++) {
      dm.send({ type: 'create', token: token() });
      await dm.until((e) => e.type === 'snapshot' && e.room.tokens.length === i);
    }
    mark = dm.events.length;
    dm.send({ type: 'create', token: token() });
    await dm.until((e) => e.type === 'error' && e.message.includes('3'), mark);
    for (let i = 1; i <= 4; i++) {
      dm.send({
        type: 'initiative.put',
        entry: { id: randomUUID(), name: 'A', value: i },
        epoch: 0,
      });
      await dm.until((e) => e.type === 'snapshot' && e.room.initiative.length === i);
    }
    mark = dm.events.length;
    dm.send({ type: 'initiative.put', entry: { id: randomUUID(), name: 'B', value: 5 }, epoch: 0 });
    await dm.until((e) => e.type === 'error' && e.message.includes('4'), mark);
    for (let i = 1; i <= 5; i++) {
      dm.send({ type: 'drawing.add', drawing: drawing(), epoch: 0 });
      await dm.until((e) => e.type === 'snapshot' && e.room.drawings.length === i);
    }
    mark = dm.events.length;
    dm.send({ type: 'drawing.add', drawing: drawing(), epoch: 0 });
    await dm.until((e) => e.type === 'error' && e.message.includes('5'), mark);
    for (let i = 0; i < 3; i++) {
      mark = dm.events.length;
      dm.send({ type: 'roll', name: '天意爷', expression: 'd6' });
      await dm.until(
        (e) => e.type === 'snapshot' && e.room.rolls.length === Math.min(i + 1, 2),
        mark,
      );
    }
    assert.equal(service.getRoom().rolls.length, 2);
    const backup = await fetch(url + '/api/backup', {
      headers: { Authorization: `Bearer ${auth}` },
    });
    assert.equal(backup.status, 200);
    const restored = await service.storage.prepareRestore(Buffer.from(await backup.arrayBuffer()));
    assert.equal(restored.room.tokens.length, 3);
  } finally {
    for (const p of peers) p.ws.terminate();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('configured >15 connections are admitted and the next seat is rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-seats-'));
  const service = await createSmalltable({
    ...config(),
    dataDir: dir,
    caps: { ...DEFAULT_CAPABILITIES, maxSeats: 17 },
  });
  const peers: Peer[] = [];
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  try {
    for (let i = 0; i < 18; i++) {
      const res = await fetch(url + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-room', name: 'U' + ++loginSequence068 }),
      });
      assert.equal(res.status, i < 17 ? 200 : 409);
      if (i < 17) {
        const { token } = await sessionBody(res);
        const p = new Peer(new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]));
        peers.push(p);
        await p.until((e) => e.type === 'snapshot');
      }
    }
    await peers[0].until((e) => e.type === 'presence' && e.count === 17 && e.max === 17);
  } finally {
    for (const p of peers) p.ws.terminate();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('all collections exceed old defaults through live commands, disk and restore; long names command exceeds old 64 KiB wire limit', async () => {
  const caps = {
    ...DEFAULT_CAPABILITIES,
    maxTokens: 260,
    maxInitiative: 261,
    maxDrawings: 262,
    maxRolls: 263,
    maxNames: 600,
  };
  const f = await fixture(caps);
  try {
    const dm = await f.peer();
    await dm.unlock();
    const player = await f.peer();
    const room = initialRoom();
    room.tokens = Array.from({ length: 259 }, token);
    room.initiative = Array.from({ length: 260 }, () => ({
      id: randomUUID(),
      name: 'I',
      value: 1,
    }));
    room.drawings = Array.from({ length: 261 }, drawing);
    room.rolls = Array.from({ length: 263 }, () => ({
      id: randomUUID(),
      name: '天意爷',
      expression: '1d6',
      dice: [],
      result: 1,
      time: new Date().toISOString(),
    }));
    const zip = await f.service.storage.backup(room);
    assert.equal(
      (
        await fetch(f.url + '/api/restore', {
          method: 'POST',
          headers: { ...dm.headers, 'Content-Type': 'application/zip' },
          body: new Uint8Array(zip),
        })
      ).status,
      200,
    );
    await dm.until((e) => e.type === 'snapshot' && e.epoch === 1);
    for (const [command, done] of [
      [
        { type: 'create', token: managementToken() },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.tokens.length === 260,
      ],
      [
        { type: 'initiative.put', entry: { id: randomUUID(), name: 'extra', value: 2 }, epoch: 1 },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.initiative.length === 261,
      ],
      [
        { type: 'drawing.add', drawing: managementDrawing(), epoch: 1 },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.drawings.length === 262,
      ],
      [
        { type: 'roll', name: '天意爷', expression: 'd20' },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.rolls.at(-1)?.expression === '1d20',
      ],
    ] as const) {
      const mark = dm.events.length;
      dm.send(command);
      await dm.until(done, mark);
    }
    const names = Array.from(
      { length: 600 },
      (_, i) => String(i).padStart(4, '0') + 'n'.repeat(124),
    );
    const mark = dm.events.length;
    assert.ok(Buffer.byteLength(JSON.stringify({ type: 'names', names })) > 65536);
    dm.send({ type: 'names', names });
    await dm.until((e) => e.type === 'snapshot' && e.room.names.length === 600, mark);
    assert.equal(f.service.getRoom().rolls.length, 263);
    await player.until((e) => e.type === 'snapshot' && e.room.names.length === 600);
    const credentials = JSON.parse(await readFile(path.join(f.dir, 'credentials.json'), 'utf8'));
    const exports = [
      await (await fetch(f.url + '/api/config')).json(),
      player.events,
      JSON.parse(
        new AdmZip(await f.service.storage.backup(f.service.getRoom())).readAsText('room.json'),
      ),
    ];
    for (const value of exports) {
      const text = JSON.stringify(value);
      for (const secret of [
        roomPassword,
        dmPassword,
        credentials.room.hash,
        credentials.room.salt,
        credentials.dm.hash,
        credentials.dm.salt,
        dm.session,
        player.session,
      ])
        assert.ok(!text.includes(secret));
    }
    assert.ok(!JSON.stringify(player.events).includes('DM-private-060'));
    const portable = await f.service.storage.backup(f.service.getRoom());
    assert.equal((await f.service.storage.prepareRestore(portable)).room.names.length, 600);
    await f.service.storage.save(f.service.getRoom());
    assert.equal((await f.service.storage.load())?.tokens.length, 260);
    const legacy = { ...room, schemaVersion: 1 } as Record<string, unknown>;
    delete legacy.initiative;
    delete legacy.initiativeAscending;
    delete legacy.drawings;
    assert.throws(() => parseRoom(legacy, caps), /不兼容/);
  } finally {
    await f.close();
  }
});
