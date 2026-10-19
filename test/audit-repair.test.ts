import { testStorage } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { WebSocket } from 'ws';
import { config, backupLimits } from '../src/server/config';
import { createSmalltable } from './helpers';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import {
  createRoomSchema,
  createCommandSchema,
  initialRoom,
  type ServerEvent,
} from '../src/shared/model';
import { readNotes, writeNotes } from '../src/client/notes-store';
process.env.ROOM_PASSWORD = 'test-room';
process.env.DM_PASSWORD = 'test-dm-55';
const token = (asset: string | null = null) => ({
  id: randomUUID(),
  name: 'A',
  label: '',
  shape: 'circle' as const,
  color: '#000000',
  x: 0,
  y: 0,
  size: 1,
  angle: 0,
  asset,
  note: '',
  secret: '',
});
const drawing = () => ({ id: randomUUID(), x1: 0, y1: 0, x2: 1, y2: 1, color: '#202b36' as const });
const roll = () => ({
  id: randomUUID(),
  name: 'A',
  expression: 'd6',
  dice: [],
  result: 1,
  time: new Date().toISOString(),
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('JSON partial overrides, defaults, >15 seats, invalid fields and obsolete URL', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-config-'));
  const file = path.join(dir, 'settings.json');
  try {
    await writeFile(
      file,
      JSON.stringify({
        limits: { players: 23, tokens: 300, privateNotesBytes: 9 },
        images: { tokenEdge: 512 },
        session: { idleMinutes: 2 },
      }),
    );
    process.env.DNDROLL_URL = 'unused-invalid-url';
    const c = config(file);
    assert.equal(c.caps.maxSeats, 23);
    assert.equal(c.caps.maxTokens, 300);
    assert.equal(c.caps.maxNotesBytes, 9);
    assert.equal(c.caps.tokenEdge, 512);
    assert.equal(c.caps.idleMs, 120000);
    assert.equal(c.caps.maxDrawings, 255);
    assert.ok(!('dndrollUrl' in c.caps));
    for (const value of [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER]) {
      await writeFile(file, JSON.stringify({ limits: { tokens: value } }));
      assert.throws(() => config(file), /配置/);
    }
    await writeFile(file, '{');
    assert.throws(() => config(file), /配置/);
    await writeFile(file, '{"limits":{"toknes":3}}');
    assert.throws(() => config(file), /toknes/);
    await writeFile(file, '{}');
    assert.deepEqual(config(file).caps, DEFAULT_CAPABILITIES);
    assert.throws(() => config(path.join(dir, 'missing.json')), /无法读取配置/);
  } finally {
    delete process.env.DNDROLL_URL;
    await rm(dir, { recursive: true, force: true });
  }
});

test('independent non-default schema limits, byte limits, and values above 255', () => {
  const caps = {
    ...DEFAULT_CAPABILITIES,
    maxTokens: 3,
    maxInitiative: 4,
    maxDrawings: 5,
    maxRolls: 2,
    maxNames: 6,
  };
  const schema = createRoomSchema(caps);
  const room = {
    ...initialRoom(),
    tokens: Array.from({ length: 3 }, () => token()),
    initiative: Array.from({ length: 4 }, () => ({ id: randomUUID(), name: 'A', value: 1 })),
    drawings: Array.from({ length: 5 }, drawing),
    rolls: Array.from({ length: 2 }, roll),
    names: Array.from({ length: 6 }, (_, i) => String(i)),
  };
  assert.ok(schema.safeParse(room).success);
  for (const key of ['tokens', 'initiative', 'drawings', 'rolls', 'names'] as const) {
    const extra =
      key === 'tokens'
        ? token()
        : key === 'drawings'
          ? drawing()
          : key === 'rolls'
            ? roll()
            : key === 'names'
              ? 'extra'
              : { id: randomUUID(), name: 'B', value: 2 };
    assert.equal(schema.safeParse({ ...room, [key]: [...room[key], extra] }).success, false, key);
  }
  assert.equal(
    createCommandSchema(caps).safeParse({ type: 'names', names: Array(7).fill('A') }).success,
    false,
  );
  assert.ok(
    createRoomSchema({ ...caps, maxTokens: 300 }).safeParse({
      ...initialRoom(),
      tokens: Array.from({ length: 300 }, () => token()),
    }).success,
  );
  let saved = '';
  const store = {
    getItem: () => saved,
    setItem: (_k: string, v: string) => {
      saved = v;
    },
  };
  writeNotes(store, '中文', 6);
  assert.equal(readNotes(store), '中文');
  assert.throws(() => writeNotes(store, '中文a', 6), /6 字节/);
  assert.equal(saved, '中文');
  writeNotes(store, 'a'.repeat(70000), 70000);
  assert.equal(saved.length, 70000);
});

test('restore and disk load apply deployment limits; backup budgets grow with limits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-restore-'));
  const cfg = { ...config(), dataDir: dir, caps: { ...DEFAULT_CAPABILITIES, maxTokens: 300 } };
  const storage = testStorage(cfg);
  try {
    await storage.load();
    const room = { ...initialRoom(), tokens: Array.from({ length: 300 }, () => token()) };
    await storage.save(room);
    assert.equal((await storage.load())?.tokens.length, 300);
    const zip = await storage.backup(room);
    const restored = await storage.prepareRestore(zip);
    assert.equal(restored.room.tokens.length, 300);
    const low = testStorage({ ...cfg, caps: { ...cfg.caps, maxTokens: 3 } });
    await assert.rejects(() => low.load(), /存档损坏/);
    await assert.rejects(() => low.prepareRestore(zip));
    const limits = backupLimits(cfg.caps);
    assert.equal(limits.entries, 302);
    assert.ok(limits.bytes > backupLimits({ ...cfg.caps, maxTokens: 3 }).bytes);
    const excess = new AdmZip();
    excess.addFile('room.json', Buffer.from(JSON.stringify(initialRoom())));
    excess.addFile('extra.txt', Buffer.from('x'));
    await assert.rejects(() => storage.prepareRestore(excess.toBuffer()), /路径/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

class Peer {
  events: ServerEvent[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.events.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
  }
  async until(predicate: (e: ServerEvent) => boolean, after = 0) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const e = this.events.slice(after).find(predicate);
      if (e) return e;
      await wait(10);
    }
    throw Error('event timeout: ' + JSON.stringify(this.events.slice(-2)));
  }
  send(c: unknown) {
    this.ws.send(JSON.stringify(c));
  }
}

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
      body: JSON.stringify({ password: 'test-room' }),
    });
  try {
    assert.deepEqual(await (await fetch(url + '/api/config')).json(), caps);
    let auth = '';
    for (let i = 0; i < 2; i++) {
      const res = await login();
      assert.equal(res.status, 200);
      const { token: credential } = await res.json();
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
    dm.send({ type: 'create', token: first });
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
    dm.send({ type: 'edit', token: { ...first, asset: second.asset } });
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
        body: JSON.stringify({ password: 'test-room' }),
      });
      assert.equal(res.status, i < 17 ? 200 : 409);
      if (i < 17) {
        const { token } = await res.json();
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

test('backup restores more than 257 entries when token configuration permits it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-assets-'));
  const storage = testStorage({
    ...config(),
    dataDir: dir,
    caps: { ...DEFAULT_CAPABILITIES, maxTokens: 260 },
  });
  try {
    await storage.load();
    const room = initialRoom();
    for (let i = 0; i < 260; i++) {
      const data = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: { r: i % 256, g: Math.floor(i / 256), b: 0 },
        },
      })
        .png()
        .toBuffer();
      const image = await storage.put(data, 'token');
      room.tokens.push(token(image.asset));
    }
    const zip = await storage.backup(room);
    assert.equal(new AdmZip(zip).getEntries().length, 261);
    assert.equal((await storage.prepareRestore(zip)).room.tokens.length, 260);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
