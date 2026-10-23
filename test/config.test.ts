import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../src/server/config';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { createRoomSchema, createCommandSchema, initialRoom } from '../src/shared/model';
import { readNotes, writeNotes } from '../src/client/notes-store';
import { token, drawing, roll } from './support/limits-fixture';

test('JSON partial overrides, defaults, >15 seats, invalid fields and obsolete URL', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-config-'));
  const file = path.join(dir, 'settings.json');
  try {
    await writeFile(
      file,
      JSON.stringify({
        limits: { players: 23, dms: 2, tokens: 300, privateNotesBytes: 9 },
        images: { tokenEdge: 512 },
        session: { idleMinutes: 2 },
      }),
    );
    process.env.DNDROLL_URL = 'unused-invalid-url';
    const c = config(file);
    assert.equal(c.caps.maxSeats, 23);
    assert.equal(c.caps.maxDMs, 2);
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
      ...[0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER].map((dms) => ({ limits: { dms } })),
      { limits: { players: Number.MAX_SAFE_INTEGER, dms: 1 } },
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
