import AdmZip from 'adm-zip';
import { sessionBody } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createSmalltable } from '../src/server/app';
import { config, backupLimits } from '../src/server/config';
import { Sessions } from '../src/server/sessions';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import {
  initialRoom,
  parseRoom,
  tokenLabel,
  nextLabel,
  type Room,
  type ServerEvent,
} from '../src/shared/model';
import { temporaryId } from '../src/shared/session';
import { makeToken } from './room-fixture';
import { Peer } from './room-fixture';

async function setup(seed = initialRoom()) {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-072-'));
  await writeFile(path.join(dir, 'room.json'), JSON.stringify(seed));
  let now = 1800000000000;
  const cfg = { ...config(), dataDir: dir };
  const access = {
    roomMatches: async (p: unknown) => p === 'room',
    dmMatches: async (p: unknown) => p === 'keeper',
    change: async () => {},
  };
  const service = await createSmalltable(cfg, access, { now: () => now });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const peers: Peer[] = [];
  async function peer(name: string, dm = false) {
    const res = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: dm ? 'keeper' : 'room' }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const p = new Peer(url, (await sessionBody(res)).token);
    peers.push(p);
    await p.wait((e) => e.type === 'snapshot');
    return p;
  }
  return {
    dir,
    cfg,
    service,
    url,
    access,
    peer,
    advance: (ms: number) => (now += ms),
    close: async () => {
      peers.forEach((p) => p.ws.terminate());
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function command(p: Peer, c: unknown, type: ServerEvent['type'] = 'snapshot') {
  const mark = p.events.length;
  p.send(c);
  return p.wait((e) => e.type === type, mark);
}
const current = (f: Awaited<ReturnType<typeof setup>>) => f.service.getRoom();

test('072 labels, nickname units, schema 4 split pools and immutable public invariants', () => {
  for (const label of ['甲', '甲乙丙丁', 'AB12', '𠀀𠀁𠀂𠀃', ' a '])
    assert.ok(tokenLabel.safeParse(label).success);
  for (const label of ['', '    ', '12345', '甲乙丙丁戊', 'a\nb', 'a\u0000', 'a\t'])
    assert.ok(!tokenLabel.safeParse(label).success, label);
  assert.equal(temporaryId('一二三四五六七八').valid, true);
  assert.equal(temporaryId('ABCDEFGHIJKLMNOP').valid, true);
  assert.equal(temporaryId('一二三四ABCDEFGH').valid, true);
  assert.equal(temporaryId('一二三四五六七八九').valid, false);
  const seed = initialRoom();
  seed.tokens = Array.from({ length: 255 }, makeToken);
  for (const publicId of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    seed.tokens.push({ ...makeToken(), publicId, label: publicId, name: '', note: '', secret: '' });
  assert.equal(parseRoom(seed).tokens.length, 281);
  assert.throws(() => parseRoom({ ...seed, tokens: [...seed.tokens, makeToken()] }));
  const bad = structuredClone(seed);
  bad.tokens[255].publicId = 'B';
  assert.throws(() => parseRoom(bad));
  for (const patch of [
    { asset: 'a'.repeat(64) + '.webp' },
    { hidden: true },
    { size: 2 },
    { publicId: 'AA' },
  ]) {
    const invalid = structuredClone(seed);
    Object.assign(invalid.tokens[255], patch);
    assert.throws(() => parseRoom(invalid));
  }
  assert.throws(() => parseRoom({ ...seed, schemaVersion: 3 }), /版本 4/);
  assert.ok(backupLimits(DEFAULT_CAPABILITIES).roomBytes > 281 * 65536);
  assert.ok(
    tokenLabel.safeParse(
      nextLabel(Array.from({ length: 9999 }, (_, i) => ({ label: String(i + 1) }))),
    ).success,
  );
});

test('072 public take race, restricted editing, return/reset, cloning, pool boundary and persistence/restore', async () => {
  const seed = initialRoom();
  seed.tokens = Array.from({ length: 254 }, makeToken);
  const f = await setup(seed);
  try {
    const dm = await f.peer('DM', true),
      a = await f.peer('A'),
      b = await f.peer('B');
    const marks = [a.events.length, b.events.length];
    a.send({ type: 'public.take', publicId: 'A', x: 100, y: 200, epoch: 0 });
    b.send({ type: 'public.take', publicId: 'A', x: 300, y: 400, epoch: 0 });
    await Promise.all([
      a.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 255, marks[0]),
      b.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 255, marks[1]),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(current(f).tokens.filter((t) => t.publicId === 'A').length, 1);
    const pub = current(f).tokens.find((t) => t.publicId === 'A')!;
    await command(a, { type: 'token.label', id: pub.id, label: '四字棋面', epoch: 0 });
    assert.equal(current(f).tokens.find((t) => t.id === pub.id)!.label, '四字棋面');
    for (const c of [
      { type: 'create', token: makeToken() },
      { type: 'edit', token: { ...pub, color: '#abcdef' } },
      { type: 'token.hidden', id: pub.id, hidden: true, epoch: 0 },
      { type: 'note', id: pub.id, note: 'forged', epoch: 0 },
    ])
      await command(a, c, 'error');
    const ordinary = current(f).tokens.find((t) => !t.publicId)!;
    await command(a, { type: 'delete.many', ids: [pub.id, ordinary.id], epoch: 0 }, 'error');
    assert.ok(current(f).tokens.some((t) => t.id === pub.id));
    const copy = {
      ...current(f).tokens.find((t) => t.id === pub.id)!,
      id: randomUUID(),
      publicId: undefined,
      x: 124,
      y: 224,
    };
    await command(dm, { type: 'create', token: copy });
    assert.equal(current(f).tokens.filter((t) => !t.publicId).length, 255);
    await command(dm, { type: 'create', token: { ...copy, id: randomUUID() } }, 'error');
    await command(a, { type: 'delete', id: pub.id });
    await command(a, { type: 'public.take', publicId: 'A', x: -5, y: 10, epoch: 0 });
    const reset = current(f).tokens.find((t) => t.publicId === 'A')!;
    assert.equal(reset.label, 'A');
    assert.equal(reset.angle, 0);
    assert.equal(reset.asset, null);
    assert.equal(current(f).tokens.find((t) => t.id === copy.id)!.label, '四字棋面');
    for (const letter of 'BCDEFGHIJKLMNOPQRSTUVWXYZ')
      await command(dm, { type: 'public.take', publicId: letter, x: 0, y: 0, epoch: 0 });
    assert.equal(current(f).tokens.length, 281);
    const bytes = await readFile(path.join(f.dir, 'room.json'));
    assert.equal(parseRoom(JSON.parse(bytes.toString())).tokens.length, 281);
    const backup = await f.service.storage.backup(current(f));
    const headers = { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' };
    assert.equal(
      (
        await fetch(f.url + '/api/restore', {
          method: 'POST',
          headers,
          body: new Uint8Array(backup),
        })
      ).status,
      200,
    );
    assert.equal(current(f).tokens.length, 281);
    // PL snapshot never gains private ordinary fields, including after public cloning.
    const snap = await command(a, { type: 'activity' }, 'activity');
    assert.equal(snap.type, 'activity');
    const views = a.events.filter((e) => e.type === 'snapshot');
    assert.ok(
      views.every((e) => e.type !== 'snapshot' || e.room.tokens.every((t) => !('secret' in t))),
    );
    await command(dm, { type: 'clear' });
    assert.equal(current(f).tokens.length, 0);
    await command(a, { type: 'public.take', publicId: 'A', x: 0, y: 0, epoch: 2 });
    assert.equal(current(f).tokens[0].label, 'A');
    await f.service.close();
    const restarted = await createSmalltable(f.cfg, f.access);
    assert.equal(restarted.getRoom().tokens[0].publicId, 'A');
    assert.equal(restarted.getRoom().tokens[0].label, 'A');
    await restarted.close();
  } finally {
    await f.close();
  }
});

test('072 hiding blocks all moves/rotation, final acknowledgements preserve authority and save failure semantics', async () => {
  const f = await setup();
  try {
    const dm = await f.peer('DM', true),
      pl = await f.peer('PL');
    const t = makeToken();
    await command(dm, { type: 'create', token: t });
    await command(dm, { type: 'token.hidden', id: t.id, hidden: true, epoch: 0 });
    for (const p of [dm, pl]) {
      const moveId = randomUUID();
      const ack = await command(
        p,
        { type: 'move', id: t.id, x: 999, y: 999, final: true, moveId, epoch: 0 },
        'move.ack',
      );
      assert.ok(ack.type === 'move.ack' && !ack.ok && ack.x === t.x);
      await command(p, { type: 'rotate', id: t.id, angle: 90, epoch: 0 }, 'error');
    }
    assert.equal(current(f).tokens[0].x, t.x);
    await command(pl, { type: 'token.hidden', id: t.id, hidden: false, epoch: 0 }, 'error');
    const snapshot = await command(dm, { type: 'activity' }, 'activity');
    assert.equal(snapshot.type, 'activity');
    const persisted = parseRoom(JSON.parse(await readFile(path.join(f.dir, 'room.json'), 'utf8')));
    assert.equal(persisted.tokens[0].hidden, true);
    const save = f.service.storage.save.bind(f.service.storage);
    f.service.storage.save = async () => {
      throw Error('injected failure');
    };
    await command(dm, { type: 'token.hidden', id: t.id, hidden: false, epoch: 0 }, 'error');
    assert.equal(current(f).tokens[0].hidden, true);
    f.service.storage.save = save;
    await command(dm, { type: 'token.hidden', id: t.id, hidden: false, epoch: 0 });
    f.service.storage.save = async () => {
      throw Error('injected failure');
    };
    const moveId = randomUUID();
    const mark = pl.events.length;
    const ack = await command(
      pl,
      { type: 'move', id: t.id, x: 111, y: 222, final: true, moveId, epoch: 0 },
      'move.ack',
    );
    assert.ok(ack.type === 'move.ack' && ack.ok && ack.moveId === moveId && ack.x === 111);
    await pl.wait((e) => e.type === 'error' && e.code === 'SAVE_FAILED', mark);
    f.service.storage.save = save;
    await command(dm, { type: 'token.hidden', id: t.id, hidden: true, epoch: 0 });
    const hiddenCopy = { ...current(f).tokens[0], id: randomUUID() };
    await command(dm, { type: 'create', token: hiddenCopy });
    assert.equal(current(f).tokens[1].hidden, true);
    const backup = await f.service.storage.backup(current(f));
    const prepared = await f.service.storage.prepareRestore(backup);
    assert.ok(prepared.room.tokens.every((t) => t.hidden));
    // Loading the saved current schema reproduces the state on a new server.
    await f.service.close();
    const restarted = await createSmalltable(f.cfg, f.access);
    assert.ok(restarted.getRoom().tokens.every((t) => t.hidden));
    await restarted.close();
  } finally {
    await f.close();
  }
});

test('072 heartbeat allows two missed responses, resets on pong, terminates on third missed check', () => {
  let now = 1000,
    terminated = 0,
    pings = 0;
  const sessions = new Sessions(
    DEFAULT_CAPABILITIES,
    () => {},
    () => now,
  );
  const s = sessions.create('A', false);
  const ws = {
    readyState: WebSocket.OPEN,
    ping: () => pings++,
    terminate: () => terminated++,
    close: () => {},
  } as unknown as WebSocket;
  sessions.attach(s, ws);
  sessions.heartbeat(s);
  sessions.heartbeat(s);
  sessions.heartbeat(s);
  assert.equal(terminated, 0);
  s.alive = true;
  s.missed = 0;
  sessions.heartbeat(s);
  assert.equal(terminated, 0);
  sessions.heartbeat(s);
  sessions.heartbeat(s);
  sessions.heartbeat(s);
  assert.equal(terminated, 1);
  assert.equal(pings, 6);
  assert.equal(s.disconnectedUntil, now + 45 * 60000);
  now += 44 * 60000;
  sessions.reserve(s);
  assert.equal(s.disconnectedUntil, 1000 + 45 * 60000);
  now += 60000;
  assert.equal(sessions.valid(s), false);
});

test('072 default maximum 16 peers and 281 tokens converge, save and restore; report local latency', async () => {
  const seed = initialRoom();
  seed.tokens = Array.from({ length: 255 }, makeToken);
  for (const publicId of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    seed.tokens.push({ ...makeToken(), publicId, label: publicId, name: '', note: '', secret: '' });
  const f = await setup(seed);
  try {
    const dm = await f.peer('DM', true),
      players: Peer[] = [];
    for (let i = 0; i < 15; i++) players.push(await f.peer('P' + i));
    await dm.wait((e) => e.type === 'presence' && e.count === 15 && e.dms === 1);
    const elapsed: number[] = [];
    for (let i = 0; i < 15; i++) {
      const id = seed.tokens[i].id,
        moveId = randomUUID(),
        p = players[i],
        marks = players.map((x) => x.events.length),
        start = performance.now();
      p.send({ type: 'move', id, x: i * 10, y: 100, final: true, moveId, epoch: 0 });
      await Promise.all(
        players.map((p, j) =>
          p.wait((e) => e.type === 'token' && e.token.id === id && e.token.y === 100, marks[j]),
        ),
      );
      elapsed.push(performance.now() - start);
      await new Promise((r) => setTimeout(r, 100));
    }
    const latest = current(f);
    await dm.wait((e) => e.type === 'saved' && e.revision >= latest.revision);
    const zip = await f.service.storage.backup(latest);
    const response = await fetch(f.url + '/api/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' },
      body: new Uint8Array(zip),
    });
    assert.equal(response.status, 200);
    await Promise.all(
      players.map((p) =>
        p.wait((e) => e.type === 'snapshot' && e.epoch === 1 && e.room.tokens.length === 281),
      ),
    );
    for (const p of players) {
      const snap = [...p.events].reverse().find((e) => e.type === 'snapshot');
      assert.ok(snap?.type === 'snapshot');
      assert.ok(snap.room.tokens.every((t) => !('secret' in t)));
    }
    elapsed.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        scenario: '16 peers / 281 tokens / 15 final moves / local loopback',
        p50Ms: elapsed[7],
        p95Ms: elapsed[14],
        zipBytes: zip.length,
      }),
    );
  } finally {
    await f.close();
  }
});

test('072 old disk/ZIP schema is clearly rejected without changing existing bytes or state', async () => {
  const f = await setup();
  const oldDir = await mkdtemp(path.join(tmpdir(), 'st-old-schema-'));
  try {
    const dm = await f.peer('DM', true);
    const before = current(f),
      disk = await readFile(path.join(f.dir, 'room.json'));
    const old = Buffer.from(JSON.stringify({ ...initialRoom(), schemaVersion: 3 }));
    const zip = new AdmZip();
    zip.addFile('room.json', old);
    const res = await fetch(f.url + '/api/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' },
      body: new Uint8Array(zip.toBuffer()),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /要求版本 4/);
    assert.deepEqual(current(f), before);
    assert.deepEqual(await readFile(path.join(f.dir, 'room.json')), disk);
    await writeFile(path.join(oldDir, 'room.json'), old);
    await assert.rejects(
      () => createSmalltable({ ...f.cfg, dataDir: oldDir }, f.access),
      /不兼容.*要求版本 4/,
    );
    assert.deepEqual(await readFile(path.join(oldDir, 'room.json')), old);
  } finally {
    await f.close();
    await rm(oldDir, { recursive: true, force: true });
  }
});

test('073 player batch return skips stale IDs, synchronizes peers and rejects existing ordinary tokens atomically', async () => {
  const seed = initialRoom();
  const ordinary = makeToken();
  seed.tokens = [ordinary];
  const f = await setup(seed);
  try {
    const a = await f.peer('A'),
      b = await f.peer('B');
    for (const publicId of 'ABC')
      await command(a, { type: 'public.take', publicId, x: 0, y: 0, epoch: 0 });
    const ids = current(f)
      .tokens.filter((t) => t.publicId)
      .map((t) => t.id);
    await command(b, { type: 'delete', id: ids[1] });
    const mark = b.events.length;
    await command(a, { type: 'delete.many', ids, epoch: 0 });
    const received = await b.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1, mark);
    assert.equal(received.type, 'snapshot');
    assert.deepEqual(
      current(f).tokens.map((t) => t.id),
      [ordinary.id],
    );
    assert.deepEqual(
      parseRoom(JSON.parse(await readFile(path.join(f.dir, 'room.json'), 'utf8'))).tokens.map(
        (t) => t.id,
      ),
      [ordinary.id],
    );
    // Repeating the completed batch is a no-op, rather than an authorization failure.
    const revision = current(f).revision;
    await command(a, { type: 'delete.many', ids, epoch: 0 });
    assert.equal(current(f).revision, revision);
    await command(a, { type: 'delete', id: ids[1] }, 'error');
    assert.equal(current(f).revision, revision);
    await command(a, { type: 'public.take', publicId: 'A', x: 0, y: 0, epoch: 0 });
    const pub = current(f).tokens.find((t) => t.publicId)!;
    const before = structuredClone(current(f));
    const error = await command(
      a,
      { type: 'delete.many', ids: [pub.id, ids[1], ordinary.id], epoch: 0 },
      'error',
    );
    assert.equal(error.type, 'error');
    if (error.type === 'error') assert.match(error.message, /操作未授权/);
    assert.deepEqual(current(f), before);
    await command(a, { type: 'delete.many', ids: [pub.id, ids[1]], epoch: 99 }, 'error');
    assert.deepEqual(current(f), before);
  } finally {
    await f.close();
  }
});
