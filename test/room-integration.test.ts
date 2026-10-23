let loginSequence068 = 0;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createSmalltable } from './helpers.js';
import { config } from '../src/server/config.js';
import { roomFixture as setup, makeToken, Peer } from './room-fixture';

test('real sockets: password, role isolation, movement, rotation, dice log and backup restore', async () => {
  const x = await setup();
  try {
    const bad = await fetch(x.url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong', name: 'U' + ++loginSequence068 }),
    });
    assert.equal(bad.status, 403);
    const dm = await x.peer(),
      player = await x.peer();
    let mark = player.events.length;
    const t = makeToken();
    player.send({ type: 'create', token: t });
    await player.wait((e) => e.type === 'error', mark);
    assert.equal(x.service.getRoom().tokens.length, 0);
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    dm.send({ type: 'create', token: t });
    await player.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    assert.ok(!JSON.stringify(player.events).includes(t.secret));
    mark = player.events.length;
    player.send({ type: 'move', id: t.id, x: 120, y: 240, final: true, epoch: 0 });
    await player.wait((e) => e.type === 'token' && e.token.x === 120, mark);
    dm.send({ type: 'move', id: t.id, x: 160, y: 280, final: true, epoch: 0 });
    await player.wait((e) => e.type === 'token' && e.token.x === 160, mark);
    assert.equal(x.service.getRoom().tokens[0].x, 160);
    player.send({ type: 'rotate', id: t.id, angle: 90, epoch: 0 });
    await player.wait((e) => e.type === 'token' && e.token.angle === 90, mark);
    player.send({ type: 'roll', expression: '1d20+5', name: '天意爷' });
    const roll = await player.wait((e) => e.type === 'snapshot' && e.room.rolls.length === 1);
    assert.equal(roll.type, 'snapshot');
    if (roll.type === 'snapshot') {
      const r = roll.room.rolls[0];
      assert.equal(r.result, r.dice[0].values[0] + 5);
    }
    const headers = { Authorization: `Bearer ${dm.token}` };
    const b = await fetch(x.url + '/api/backup', { headers });
    assert.equal(b.status, 200);
    const backup = Buffer.from(await b.arrayBuffer());
    assert.equal(
      (await fetch(x.url + '/api/backup', { headers: { Authorization: `Bearer ${player.token}` } }))
        .status,
      400,
    );
    dm.send({ type: 'clear' });
    await dm.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 0 && e.epoch === 1);
    const restored = await fetch(x.url + '/api/restore', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: backup,
    });
    assert.equal(restored.status, 200);
    await player.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1 && e.epoch === 2);
    assert.equal(x.service.getRoom().tokens[0].angle, 90);
    assert.ok(!JSON.stringify(player.events).includes(t.secret));
    mark = player.events.length;
    player.send({ type: 'move', id: t.id, x: 999, y: 999, final: true, epoch: 0 });
    await player.wait((e) => e.type === 'error', mark);
    assert.equal(x.service.getRoom().tokens[0].x, 160);
    const disk = JSON.parse(await readFile(path.join(x.dir, 'room.json'), 'utf8'));
    assert.equal(disk.tokens[0].x, 160);
    const malicious = new AdmZip();
    malicious.addFile('../outside', Buffer.from('bad'));
    const before = x.service.getRoom();
    const invalid = await fetch(x.url + '/api/restore', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: new Uint8Array(malicious.toBuffer()),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(x.service.getRoom(), before);
  } finally {
    await x.cleanup();
  }
});

test('static entry serves its real JS/CSS and images require room authorization', async () => {
  const x = await setup();
  try {
    const page = await fetch(x.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    const script = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(script);
    const js = await fetch(x.url + script);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    assert.equal((await fetch(x.url + '/media/' + 'a'.repeat(64) + '.webp')).status, 401);
    const blocked = await fetch(x.url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
      body: JSON.stringify({ password: 'test-room', name: 'U' + ++loginSequence068 }),
    });
    assert.equal(blocked.status, 403);
  } finally {
    await x.cleanup();
  }
});

test('healthy connection is retained beyond a configured former idle threshold', async () => {
  const f = await setup();
  try {
    const peer = await f.peer();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(peer.ws.readyState, 1);
  } finally {
    await f.cleanup();
  }
});

test('save failure reports unsaved state and a later successful write recovers', async () => {
  const x = await setup();
  try {
    const dm = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const original = x.service.storage.save.bind(x.service.storage);
    x.service.storage.save = async () => {
      throw Error('simulated disk failure');
    };
    const mark = dm.events.length,
      t = makeToken();
    dm.send({ type: 'create', token: t });
    await dm.wait((e) => e.type === 'error' && e.message.includes('保存失败'), mark);
    x.service.storage.save = original;
    const later = dm.events.length;
    assert.equal(x.service.getRoom().tokens.length, 0, 'failed create is not committed');
    dm.send({ type: 'create', token: { ...t, angle: 90 } });
    await dm.wait((e) => e.type === 'saved' && e.revision === 1, later);
    const saved = JSON.parse(await readFile(path.join(x.dir, 'room.json'), 'utf8'));
    assert.equal(saved.tokens[0].angle, 90);
  } finally {
    await x.cleanup();
  }
});
