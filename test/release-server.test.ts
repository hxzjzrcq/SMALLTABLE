import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { createSmalltable, testStorage } from './helpers';
import { config, backupLimits } from '../src/server/config';
import { initialRoom, parseRoom, type Capabilities, type ServerEvent } from '../src/shared/model';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';

const roomPassword = 'Room-Release-060',
  dmPassword = 'Keeper-Release-060';
const token = () => ({
  id: randomUUID(),
  name: 'A',
  label: '',
  shape: 'circle' as const,
  color: '#123456',
  x: 0,
  y: 0,
  size: 1,
  angle: 0,
  asset: null as string | null,
  note: '',
  secret: 'DM-private-060',
});
const drawing = () => ({ id: randomUUID(), x1: 0, y1: 0, x2: 1, y2: 1, color: '#202b36' as const });
async function fixture(caps: Capabilities = DEFAULT_CAPABILITIES) {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-release-'));
  const cfg = { ...config(), dataDir: dir, caps };
  const service = await createSmalltable(cfg, { roomPassword, dmPassword });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  async function peer() {
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: roomPassword }),
    });
    assert.equal(login.status, 200);
    const { token: session } = await login.json();
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', session]);
    sockets.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    async function until(predicate: (event: ServerEvent) => boolean, mark = 0) {
      for (let i = 0; i < 500; i++) {
        const e = events.slice(mark).find(predicate);
        if (e) return e;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error('expected release event missing');
    }
    await until((e) => e.type === 'snapshot');
    const send = (c: unknown) => ws.send(JSON.stringify(c));
    return {
      ws,
      events,
      until,
      send,
      session,
      headers: { Authorization: 'Bearer ' + session },
      async unlock() {
        send({ type: 'unlock', password: dmPassword });
        await until((e) => e.type === 'snapshot' && e.dm);
      },
    };
  }
  return {
    dir,
    cfg,
    service,
    url,
    peer,
    async close() {
      for (const ws of sockets) ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('legacy environment settings require explicit migration; invalid nested limits and derived overflow fail at startup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-config-release-')),
    file = path.join(dir, 'settings.json');
  const mappings = {
    MAX_SEATS: 'limits.players',
    IDLE_MINUTES: 'session.idleMinutes',
    MAP_BYTES: 'images.mapBytes',
    MAP_PIXELS: 'images.mapPixels',
    MAP_EDGE: 'images.mapEdge',
    TOKEN_BYTES: 'images.tokenBytes',
    TOKEN_EDGE: 'images.tokenEdge',
  };
  try {
    await writeFile(file, '{}');
    for (const [key, destination] of Object.entries(mappings)) {
      const before = process.env[key];
      process.env[key] = '17';
      try {
        assert.throws(
          () => config(file),
          (e) => e instanceof Error && e.message.includes(key) && e.message.includes(destination),
        );
      } finally {
        if (before === undefined) delete process.env[key];
        else process.env[key] = before;
      }
    }
    for (const raw of [
      { unknown: 1 },
      { images: { mapEdge: 0 } },
      { session: { idleMinutes: 1.5 } },
      { limits: { players: '20' } },
      { images: { tokenEdge: Number.MAX_SAFE_INTEGER } },
      { session: { idleMinutes: Number.MAX_SAFE_INTEGER } },
      { limits: { rollHistory: Number.MAX_SAFE_INTEGER } },
    ]) {
      await writeFile(file, JSON.stringify(raw));
      assert.throws(() => config(file), /配置/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const revoke of ['lock', 'disconnect', 'password'] as const)
  test(
    `queued HTTP and WS management is rejected after ${revoke} revocation`,
    { timeout: 15000 },
    async () => {
      const f = await fixture();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const started = new Promise<void>((r) => (entered = r));
      const original = f.service.storage.backup.bind(f.service.storage);
      try {
        const a = await f.peer(),
          b = await f.peer();
        await a.unlock();
        await b.unlock();
        const before = f.service.getRoom();
        const oldCredentials = await readFile(path.join(f.dir, 'credentials.json'), 'utf8');
        const zip = await original(initialRoom());
        f.service.storage.backup = async (room) => {
          entered();
          await gate;
          return original(room);
        };
        const blocking = fetch(f.url + '/api/backup', { headers: b.headers });
        await started;
        if (revoke === 'lock') {
          a.send({ type: 'lock' });
          const pong = once(a.ws, 'pong');
          a.ws.ping();
          await pong;
        }
        let rotate: Promise<Response> | undefined;
        // Observe real HTTP arrival while the queue is blocked. The server has run the first authorization check.
        let rotateResult: Promise<Response> | undefined;
        if (revoke === 'password') {
          const arrived = new Promise<void>((resolve) => {
            const handler = (req: import('node:http').IncomingMessage) => {
              if (req.url === '/api/passwords') {
                f.service.server.off('request', handler);
                resolve();
              }
            };
            f.service.server.on('request', handler);
          });
          rotate = fetch(f.url + '/api/passwords', {
            method: 'POST',
            headers: { ...a.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentDMPassword: dmPassword,
              dmPassword: 'Keeper-Release-Next',
            }),
          });
          await arrived;
          // Body parsing finishes asynchronously; its end listener runs after Express registered its parser.
          await new Promise((r) => setTimeout(r, 20));
          rotateResult = rotate;
        }
        const pending: Promise<Response>[] = [];
        for (const [method, route, body, content] of [
          ['GET', '/api/backup', undefined, undefined],
          ['POST', '/api/restore', new Uint8Array(zip), 'application/zip'],
          ['POST', '/api/image/token', new Uint8Array([0]), 'application/octet-stream'],
          [
            'POST',
            '/api/passwords',
            JSON.stringify({
              currentDMPassword: dmPassword,
              roomPassword: 'Room-Unauthorized-Next',
            }),
            'application/json',
          ],
        ] as const) {
          const arrived = new Promise<void>((resolve) => {
            const handler = (req: import('node:http').IncomingMessage) => {
              if (req.url === route) {
                f.service.server.off('request', handler);
                resolve();
              }
            };
            f.service.server.on('request', handler);
          });
          pending.push(
            fetch(f.url + route, {
              method,
              headers: { ...a.headers, ...(content ? { 'Content-Type': content } : {}) },
              body,
            }),
          );
          await arrived;
        }
        a.send({ type: 'clear' });
        const pong = once(a.ws, 'pong');
        a.ws.ping();
        await pong;
        if (revoke === 'disconnect') {
          const closed = once(a.ws, 'close');
          a.ws.close();
          await closed;
        }
        release();
        assert.equal((await blocking).status, 200);
        if (rotateResult) assert.equal((await rotateResult).status, 200);
        const results = await Promise.all(pending);
        assert.ok(results.every((r) => r.status === 400 || r.status === 401));
        assert.deepEqual(f.service.getRoom(), before);
        if (revoke !== 'password')
          assert.equal(
            await readFile(path.join(f.dir, 'credentials.json'), 'utf8'),
            oldCredentials,
          );
        else {
          const mark = a.events.length;
          a.send({ type: 'names', names: ['revoked'] });
          await a.until((e) => e.type === 'error', mark);
          assert.deepEqual(f.service.getRoom(), before);
        }
      } finally {
        release();
        await f.close();
      }
    },
  );

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
        { type: 'create', token: token() },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.tokens.length === 260,
      ],
      [
        { type: 'initiative.put', entry: { id: randomUUID(), name: 'extra', value: 2 }, epoch: 1 },
        (e: ServerEvent) => e.type === 'snapshot' && e.room.initiative.length === 261,
      ],
      [
        { type: 'drawing.add', drawing: drawing(), epoch: 1 },
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
    assert.equal(parseRoom(legacy, caps).tokens.length, 259);
  } finally {
    await f.close();
  }
});

test('resource references reject missing, invalid, animated, byte and dimension violations without conversion; disk budgets and current image limits apply', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-images-'));
  const caps = {
    ...DEFAULT_CAPABILITIES,
    maxTokens: 1,
    maxRolls: 1,
    maxInitiative: 1,
    maxDrawings: 1,
    maxNames: 1,
    tokenEdge: 8,
    tokenBytes: 1024,
  };
  const storage = testStorage({ ...config(), dataDir: dir, caps });
  try {
    await storage.load();
    await assert.rejects(storage.checkImage('../escape', 'token'));
    await assert.rejects(storage.checkImage('a'.repeat(64) + '.webp', 'token'));
    const id = 'b'.repeat(64) + '.webp',
      file = path.join(dir, 'assets', id);
    await writeFile(file, 'not an image');
    await assert.rejects(storage.checkImage(id, 'token'));
    await writeFile(file, Buffer.alloc(1025));
    await assert.rejects(storage.checkImage(id, 'token'), /上限/);
    const frame = async (color: string) =>
      sharp({ create: { width: 2, height: 2, channels: 4, background: color } })
        .png()
        .toBuffer();
    const animated = await sharp([await frame('red'), await frame('blue')], {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    assert.equal((await sharp(animated).metadata()).pages, 2);
    await writeFile(file, animated);
    await assert.rejects(storage.checkImage(id, 'token'), /动画/);
    const large = await sharp({ create: { width: 9, height: 1, channels: 4, background: 'red' } })
      .webp()
      .toBuffer();
    await writeFile(file, large);
    await assert.rejects(storage.checkImage(id, 'token'), /限制/);
    const room = initialRoom();
    room.tokens = [{ ...token(), asset: id }];
    await writeFile(path.join(dir, 'room.json'), JSON.stringify(room));
    await assert.rejects(storage.load(), /存档损坏/);
    await writeFile(path.join(dir, 'room.json'), ' '.repeat(backupLimits(caps).roomBytes + 1));
    await assert.rejects(storage.load(), /存档损坏/);
    await assert.rejects(async () =>
      storage.save({ ...initialRoom(), tokens: [token(), token()] }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('room initialization failure releases credential ownership and permits subsequent startup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-start-fail-'));
  const cfg = { ...config(), dataDir: dir };
  try {
    await writeFile(path.join(dir, 'room.json'), '{broken');
    await assert.rejects(createSmalltable(cfg, { roomPassword, dmPassword }), /存档损坏/);
    const saved = await readFile(path.join(dir, 'credentials.json'));
    await writeFile(path.join(dir, 'room.json'), JSON.stringify(initialRoom()));
    // A successful reopen proves the failed startup released the same-directory kernel lock.
    const service = await createSmalltable(cfg, {});
    await service.close();
    assert.deepEqual(await readFile(path.join(dir, 'credentials.json')), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
