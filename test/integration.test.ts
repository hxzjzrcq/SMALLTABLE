import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { createSmalltable } from '../src/server/app.js';
import { config } from '../src/server/config.js';
import type { ServerEvent } from '../src/shared/model.js';
process.env.ROOM_PASSWORD = 'test-room';
process.env.DM_PASSWORD = 'test-dm-55';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Peer {
  events: ServerEvent[] = [];
  ws: WebSocket;
  token: string;
  constructor(url: string, token: string) {
    this.token = token;
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    this.ws.on('message', (d) => this.events.push(JSON.parse(d.toString())));
    this.ws.on('error', () => {});
  }
  send(c: unknown) {
    this.ws.send(JSON.stringify(c));
  }
  async wait(predicate: (e: ServerEvent) => boolean, after = 0) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const event = this.events.slice(after).find(predicate);
      if (event) return event;
      await delay(10);
    }
    throw Error('Timed out waiting for event: ' + JSON.stringify(this.events.slice(-2)));
  }
}
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabletop-'));
  const cfg = { ...config(), dataDir: dir };
  const service = await createSmalltable(cfg);
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const port = (service.server.address() as { port: number }).port,
    url = `http://127.0.0.1:${port}`;
  const peers: Peer[] = [];
  async function login(address = url) {
    const res = await fetch(address + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-room' }),
    });
    return { res, body: await res.json() };
  }
  async function peer() {
    const { res, body } = await login();
    assert.equal(res.status, 200);
    const p = new Peer(url, body.token);
    peers.push(p);
    await p.wait((e) => e.type === 'snapshot');
    return p;
  }
  return {
    dir,
    cfg,
    service,
    url,
    peer,
    login,
    async cleanup() {
      for (const p of peers) p.ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const makeToken = () => ({
  id: randomUUID(),
  name: '骷髅',
  label: '1',
  shape: 'circle' as const,
  color: '#3872a4',
  x: 64,
  y: 64,
  size: 1,
  angle: 0,
  asset: null,
  note: '公开',
  secret: '只给 DM 的秘密',
});
test('real sockets: password, role isolation, movement, rotation, dice log and backup restore', async () => {
  const x = await setup();
  try {
    const bad = await fetch(x.url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
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
test('image validation, deduplication and portable backup on a fresh instance', async () => {
  const x = await setup();
  let fresh: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    const dm = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const image = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const headers = {
      Authorization: `Bearer ${dm.token}`,
      'Content-Type': 'application/octet-stream',
    };
    const a = await fetch(x.url + '/api/image/token', {
      method: 'POST',
      headers,
      body: new Uint8Array(image),
    });
    assert.equal(a.status, 200);
    const asset = await a.json();
    const b = await fetch(x.url + '/api/image/token', {
      method: 'POST',
      headers,
      body: new Uint8Array(image),
    });
    assert.equal((await b.json()).asset, asset.asset);
    const oversize = await sharp({
      create: { width: 257, height: 256, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    assert.equal(
      (
        await fetch(x.url + '/api/image/token', {
          method: 'POST',
          headers,
          body: new Uint8Array(oversize),
        })
      ).status,
      400,
    );
    const token = { ...makeToken(), asset: asset.asset };
    dm.send({ type: 'create', token });
    await dm.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    const backup = Buffer.from(
      await (await fetch(x.url + '/api/backup', { headers })).arrayBuffer(),
    );
    fresh = await setup();
    const dm2 = await fresh.peer();
    dm2.send({ type: 'unlock', password: 'test-dm-55' });
    await dm2.wait((e) => e.type === 'snapshot' && e.dm);
    const restored = await fetch(fresh.url + '/api/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dm2.token}`, 'Content-Type': 'application/zip' },
      body: backup,
    });
    assert.equal(restored.status, 200);
    assert.equal(fresh.service.getRoom().tokens[0].asset, asset.asset);
    assert.ok((await readFile(path.join(fresh.dir, 'assets', asset.asset))).length > 0);
  } finally {
    if (fresh) await fresh.cleanup();
    await x.cleanup();
  }
});
test('restore rejects a ZIP whose declared size is forged to zero', async () => {
  const x = await setup();
  try {
    const dm = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const room = x.service.getRoom();
    const padded = Buffer.from(JSON.stringify(room) + ' '.repeat(9 * 1024 * 1024));
    const zip = new AdmZip();
    zip.addFile('room.json', padded);
    const raw = Buffer.from(zip.toBuffer());
    assert.equal(raw.readUInt32LE(0), 0x04034b50);
    raw.writeUInt32LE(0, 22);
    const central = raw.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.notEqual(central, -1);
    raw.writeUInt32LE(0, central + 24);
    const before = x.service.getRoom();
    const response = await fetch(x.url + '/api/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' },
      body: raw,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(x.service.getRoom(), before);
  } finally {
    await x.cleanup();
  }
});
test('15 connections, 255 tokens, concurrent movement converges; log cap and restart persist', async () => {
  const x = await setup();
  try {
    const peers: Peer[] = [];
    // Different loopback transport addresses avoid the intentional per-IP login rate limit.
    for (let i = 0; i < 15; i++) {
      const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        void import('node:http').then(({ request }) => {
          const req = request(
            x.url + '/api/login',
            {
              method: 'POST',
              localAddress: `127.0.0.${i + 2}`,
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (d) => (body += d));
              res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify({ password: 'test-room' }));
        });
      });
      assert.equal(response.status, 200);
      const p = new Peer(x.url, response.body.token);
      peers.push(p);
      await p.wait((e) => e.type === 'snapshot');
    }
    const full = await x.login();
    assert.equal(full.res.status, 409);
    // Build a validated backup to populate maximum board size without fighting input rate limits.
    const room = x.service.getRoom();
    room.tokens = Array.from({ length: 255 }, makeToken);
    room.rolls = Array.from({ length: 255 }, () => ({
      id: randomUUID(),
      name: '天意爷',
      expression: '1d6',
      dice: [{ sign: 1 as const, sides: 6, values: [1] }],
      result: 1,
      time: new Date().toISOString(),
    }));
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(room)));
    const dm = peers[0];
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    assert.equal(
      (
        await fetch(x.url + '/api/restore', {
          method: 'POST',
          headers: { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' },
          body: new Uint8Array(zip.toBuffer()),
        })
      ).status,
      200,
    );
    await peers[14].wait((e) => e.type === 'snapshot' && e.room.tokens.length === 255);
    const id = room.tokens[0].id;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 5; i++)
        peers[i].send({ type: 'move', id, x: round * 100 + i, y: i, final: round === 9, epoch: 1 });
      await delay(105);
    }
    await peers[14].wait((e) => e.type === 'token' && e.token.x === 904);
    assert.equal(x.service.getRoom().tokens[0].x, 904);
    const mark = dm.events.length;
    dm.send({ type: 'create', token: makeToken() });
    await dm.wait((e) => e.type === 'error', mark);
    assert.equal(x.service.getRoom().tokens.length, 255);
    dm.send({ type: 'roll', expression: 'd20', name: '天意爷' });
    await peers[14].wait(
      (e) => e.type === 'snapshot' && e.room.rolls.at(-1)?.expression === '1d20',
    );
    assert.equal(x.service.getRoom().rolls.length, 255);
    for (const p of peers) p.ws.terminate();
    await delay(40);
    await x.service.close();
    const restarted = await createSmalltable(x.cfg);
    try {
      assert.equal(restarted.getRoom().tokens[0].x, 904);
      assert.equal(restarted.getRoom().rolls.length, 255);
    } finally {
      await restarted.close();
    }
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
      body: JSON.stringify({ password: 'test-room' }),
    });
    assert.equal(blocked.status, 403);
  } finally {
    await x.cleanup();
  }
});
test('movement snapshots are throttled while final placement is accepted immediately', async () => {
  const x = await setup();
  try {
    const dm = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const t = makeToken();
    dm.send({ type: 'create', token: t });
    await dm.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    const mark = dm.events.length;
    for (let i = 0; i < 12; i++)
      dm.send({ type: 'move', id: t.id, x: i, y: 0, final: false, epoch: 0 });
    dm.send({ type: 'move', id: t.id, x: 500, y: 0, final: true, epoch: 0 });
    await dm.wait((e) => e.type === 'token' && e.token.x === 500, mark);
    const updates = dm.events.slice(mark).filter((e) => e.type === 'token');
    assert.ok(updates.length <= 2);
    assert.equal(x.service.getRoom().tokens[0].x, 500);
  } finally {
    await x.cleanup();
  }
});
test('idle clients are disconnected even when WebSocket pong heartbeats are alive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabletop-idle-'));
  const service = await createSmalltable({
    ...config(),
    dataDir: dir,
    caps: { ...config().caps, idleMs: 150 },
  });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-room' }),
    });
    const { token } = await login.json();
    const peer = new Peer(url, token);
    await peer.wait((e) => e.type === 'snapshot');
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('idle disconnect timed out')), 12000);
      peer.ws.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(code, 4001);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
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
    dm.send({ type: 'rotate', id: t.id, angle: 90, epoch: 0 });
    await dm.wait((e) => e.type === 'saved' && e.revision === 2, later);
    const saved = JSON.parse(await readFile(path.join(x.dir, 'room.json'), 'utf8'));
    assert.equal(saved.tokens[0].angle, 90);
  } finally {
    await x.cleanup();
  }
});
