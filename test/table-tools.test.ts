import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { roomFixture as setup, makeToken } from './room-fixture';
import {
  initialRoom,
  parseRoom,
  sortInitiative,
  roomSchema,
  commandSchema,
} from '../src/shared/model';

test('stable numeric sorting and strict v1 room migration', () => {
  const entries = [
    { id: randomUUID(), name: 'A', value: 10 },
    { id: randomUUID(), name: 'B', value: 10 },
    { id: randomUUID(), name: 'C', value: -2.5 },
  ];
  assert.deepEqual(
    sortInitiative(entries, false).map((e) => e.name),
    ['A', 'B', 'C'],
  );
  assert.deepEqual(
    sortInitiative(entries, true).map((e) => e.name),
    ['C', 'A', 'B'],
  );
  assert.deepEqual(
    entries.map((e) => e.name),
    ['A', 'B', 'C'],
  );
  const { initiative, initiativeAscending, drawings, ...rest } = initialRoom();
  const old = { ...rest, schemaVersion: 1, tokens: [makeToken()] };
  const migrated = parseRoom(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.initiative, []);
  assert.deepEqual(migrated.drawings, []);
  assert.equal(migrated.tokens[0].secret, old.tokens[0].secret);
  assert.throws(() => parseRoom({ ...old, extra: true }));
  assert.throws(() => parseRoom({ ...old, schemaVersion: 99 }));
  assert.equal(
    roomSchema.safeParse({ ...migrated, initiative: [entries[0], entries[0]] }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'initiative.put',
      entry: { ...entries[0], value: Infinity },
      epoch: 0,
    }).success,
    false,
  );
});

test('players share initiative CRUD/order and lines; only DM clears; stale or invalid commands do not mutate', async () => {
  const x = await setup();
  try {
    const dm = await x.peer(),
      a = await x.peer(),
      b = await x.peer();
    const entry = { id: randomUUID(), name: '游侠', value: 12 };
    a.send({ type: 'initiative.put', entry, epoch: 0 });
    await b.wait((e) => e.type === 'snapshot' && e.room.initiative.length === 1);
    const edited = { ...entry, value: -1.5 };
    b.send({ type: 'initiative.put', entry: edited, epoch: 0 });
    await a.wait((e) => e.type === 'snapshot' && e.room.initiative[0]?.value === -1.5);
    b.send({ type: 'initiative.order', ascending: true, epoch: 0 });
    await a.wait((e) => e.type === 'snapshot' && e.room.initiativeAscending);
    const drawing = { id: randomUUID(), x1: 1, y1: 2, x2: 180, y2: 200, color: '#d33b32' };
    a.send({ type: 'drawing.add', drawing, epoch: 0 });
    await b.wait((e) => e.type === 'snapshot' && e.room.drawings.length === 1);
    for (const command of [
      { type: 'drawing.clear', epoch: 0 },
      { type: 'drawing.add', drawing, epoch: 0 },
      { type: 'drawing.delete', id: drawing.id, epoch: 99 },
      { type: 'drawing.add', drawing: { ...drawing, id: randomUUID(), x2: 1000001 }, epoch: 0 },
      { type: 'initiative.put', entry: { ...edited, secret: 'no' }, epoch: 0 },
    ]) {
      const before = structuredClone(x.service.getRoom()),
        mark = a.events.length;
      a.send(command);
      await a.wait((e) => e.type === 'error', mark);
      assert.deepEqual(x.service.getRoom(), before);
    }
    b.send({ type: 'drawing.delete', id: drawing.id, epoch: 0 });
    await a.wait((e) => e.type === 'snapshot' && e.room.drawings.length === 0);
    a.send({ type: 'drawing.add', drawing: { ...drawing, id: randomUUID() }, epoch: 0 });
    await b.wait(
      (e) => e.type === 'snapshot' && e.room.drawings.length === 1 && e.room.revision > 5,
    );
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    dm.send({ type: 'drawing.clear', epoch: 0 });
    await b.wait((e) => e.type === 'snapshot' && !e.room.drawings.length && e.room.revision > 6);
    b.send({ type: 'initiative.delete', id: entry.id, epoch: 0 });
    await a.wait((e) => e.type === 'snapshot' && !e.room.initiative.length);
  } finally {
    await x.cleanup();
  }
});

test('new room data survives backup/restore and disk load; v1 backups and disk files migrate', async () => {
  const x = await setup();
  try {
    const dm = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const entry = { id: randomUUID(), name: '先攻', value: 9 };
    const drawing = { id: randomUUID(), x1: 1, y1: 2, x2: 3, y2: 4, color: '#246fc2' };
    dm.send({ type: 'initiative.put', entry, epoch: 0 });
    dm.send({ type: 'drawing.add', drawing, epoch: 0 });
    await dm.wait((e) => e.type === 'snapshot' && e.room.drawings.length === 1);
    await dm.wait((e) => e.type === 'saved' && e.revision === x.service.getRoom().revision);
    const disk = await x.service.storage.load();
    assert.deepEqual(disk?.initiative, [entry]);
    assert.deepEqual(disk?.drawings, [drawing]);
    const headers = { Authorization: `Bearer ${dm.token}` };
    const res = await fetch(x.url + '/api/backup', { headers });
    const zip = Buffer.from(await res.arrayBuffer());
    dm.send({ type: 'drawing.clear', epoch: 0 });
    await dm.wait((e) => e.type === 'snapshot' && !e.room.drawings.length && e.room.revision > 2);
    const restored = await fetch(x.url + '/api/restore', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: zip,
    });
    assert.equal(restored.status, 200);
    await dm.wait((e) => e.type === 'snapshot' && e.epoch === 1 && e.room.drawings.length === 1);
    assert.deepEqual(x.service.getRoom().initiative, [entry]);
    const { initiative, initiativeAscending, drawings, ...old } = initialRoom();
    const legacy = { ...old, schemaVersion: 1, tokens: [makeToken()] };
    const oldZip = new AdmZip();
    oldZip.addFile('room.json', Buffer.from(JSON.stringify(legacy)));
    assert.equal(
      (
        await fetch(x.url + '/api/restore', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/zip' },
          body: new Uint8Array(oldZip.toBuffer()),
        })
      ).status,
      200,
    );
    assert.equal(x.service.getRoom().schemaVersion, 2);
    assert.deepEqual(x.service.getRoom().drawings, []);
    assert.equal(x.service.getRoom().tokens[0].secret, legacy.tokens[0].secret);
    // Use a separate storage directory to exercise loading a legacy on-disk room.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(x.dir, 'room.json'), JSON.stringify(legacy));
    const migrated = await x.service.storage.load();
    assert.equal(migrated?.schemaVersion, 2);
    assert.deepEqual(migrated?.initiative, []);
  } finally {
    await x.cleanup();
  }
});

test('255 item budgets reject additions without blocking edits or deletions', async () => {
  const x = await setup();
  try {
    const dm = await x.peer(),
      player = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const seed = initialRoom();
    seed.initiative = Array.from({ length: 255 }, (_, i) => ({
      id: randomUUID(),
      name: String(i),
      value: i,
    }));
    seed.drawings = Array.from({ length: 255 }, (_, i) => ({
      id: randomUUID(),
      x1: i,
      y1: 0,
      x2: i,
      y2: 10,
      color: '#202b36' as const,
    }));
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(seed)));
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
    await player.wait((e) => e.type === 'snapshot' && e.epoch === 1);
    for (const command of [
      { type: 'initiative.put', entry: { id: randomUUID(), name: 'overflow', value: 1 }, epoch: 1 },
      { type: 'drawing.add', drawing: { ...seed.drawings[0], id: randomUUID() }, epoch: 1 },
    ]) {
      const mark = player.events.length;
      player.send(command);
      await player.wait((e) => e.type === 'error', mark);
    }
    player.send({ type: 'initiative.put', entry: { ...seed.initiative[0], value: 999 }, epoch: 1 });
    await dm.wait((e) => e.type === 'snapshot' && e.room.initiative[0]?.value === 999);
    player.send({ type: 'drawing.delete', id: seed.drawings[0].id, epoch: 1 });
    await dm.wait((e) => e.type === 'snapshot' && e.room.drawings.length === 254);
    assert.equal(x.service.getRoom().initiative.length, 255);
  } finally {
    await x.cleanup();
  }
});
