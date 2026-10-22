import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fixture, token } from './support/management-fixture';
import { createCommandSchema } from '../src/shared/model';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { selectTokens } from '../src/client/selection';

test('local selection replaces, toggles and retains on Shift empty click', () => {
  assert.deepEqual(selectTokens(['a', 'b'], 'c'), ['c']);
  assert.deepEqual(selectTokens(['a', 'b'], 'a'), ['a']);
  assert.deepEqual(selectTokens(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(selectTokens(['a', 'b'], 'a', true), ['b']);
  assert.deepEqual(selectTokens(['a', 'b'], null), []);
  assert.deepEqual(selectTokens(['a', 'b'], null, true), ['a', 'b']);
});
test('batch deletion schema bounds, empty, malformed and duplicate IDs', () => {
  const schema = createCommandSchema({ ...DEFAULT_CAPABILITIES, maxTokens: 2 });
  const a = randomUUID(),
    b = randomUUID();
  const parse = (ids: string[], epoch = 0) =>
    schema.safeParse({ type: 'delete.many', ids, epoch }).success;
  assert.ok(parse([a, b]));
  for (const ids of [[], [a, a], ['bad'], [a, b, randomUUID()]]) assert.ok(!parse(ids));
  assert.ok(!parse([a], -1));
});
test('batch deletion commits once; shared assets, player privacy, stale epoch, missing IDs and late movement', async () => {
  const f = await fixture();
  try {
    const dm = await f.peer(),
      player = await f.peer();
    await dm.unlock();
    const data = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'red' } })
      .png()
      .toBuffer();
    const response = await fetch(f.url + '/api/image/token', {
      method: 'POST',
      headers: { ...dm.headers, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    assert.equal(response.status, 200);
    const image = await response.json();
    const original = { ...token(), asset: image.asset, note: 'initial', label: 'guard' };
    const copies = [
      original,
      { ...original, id: randomUUID(), x: 24 },
      { ...original, id: randomUUID(), x: 48 },
    ];
    for (const [i, t] of copies.entries()) {
      const rev = f.service.getRoom().revision;
      dm.send({ type: 'create', token: t, ...(i === 0 ? { uploadId: image.uploadId } : {}) });
      await dm.until((e) => e.type === 'snapshot' && e.room.revision > rev);
    }
    const before = f.service.getRoom();
    let mark = player.events.length;
    player.send({ type: 'delete.many', ids: [original.id], epoch: 0 });
    const denied = await player.until((e) => e.type === 'error', mark);
    assert.equal(denied.type === 'error' && denied.message, '操作未授权');
    assert.deepEqual(f.service.getRoom(), before);
    const playerSnapshot = await player.until(
      (e) => e.type === 'snapshot' && e.room.revision === before.revision,
    );
    assert.ok(!JSON.stringify(playerSnapshot).includes('DM-private-060'));
    const save = f.service.storage.save.bind(f.service.storage);
    let saves = 0;
    f.service.storage.save = async (room) => {
      saves++;
      return save(room);
    };
    dm.send({ type: 'delete.many', ids: [copies[0].id, copies[1].id, randomUUID()], epoch: 0 });
    const event = await player.until(
      (e) => e.type === 'snapshot' && e.room.revision > before.revision,
    );
    assert.ok(event.type === 'snapshot');
    assert.equal(event.room.revision, before.revision + 1);
    assert.equal(saves, 1);
    assert.deepEqual(
      event.room.tokens.map((t) => t.id),
      [copies[2].id],
    );
    assert.equal((await readdir(f.service.storage.assetDir)).length, 1);
    assert.equal(JSON.parse(await readFile(f.dir + '/room.json', 'utf8')).tokens.length, 1);
    mark = dm.events.length;
    dm.send({ type: 'move', id: copies[0].id, x: 1, y: 1, final: true, epoch: 0 });
    await dm.until((e) => e.type === 'error', mark);
    assert.equal(f.service.getRoom().tokens.length, 1);
    mark = dm.events.length;
    dm.send({ type: 'delete.many', ids: [copies[2].id], epoch: 1 });
    const stale = await dm.until((e) => e.type === 'error', mark);
    assert.match(stale.type === 'error' ? stale.message : '', /桌面已更新/);
    assert.equal(f.service.getRoom().tokens.length, 1);
    const rev = f.service.getRoom().revision;
    dm.send({ type: 'delete.many', ids: [copies[2].id], epoch: 0 });
    await dm.until((e) => e.type === 'snapshot' && e.room.revision > rev);
    assert.equal((await readdir(f.service.storage.assetDir)).length, 0);
  } finally {
    await f.close();
  }
});
test('batch save failure keeps room, persisted bytes and asset reference intact', async () => {
  const f = await fixture();
  try {
    const dm = await f.peer();
    await dm.unlock();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'blue' } })
      .png()
      .toBuffer();
    const response = await fetch(f.url + '/api/image/token', {
      method: 'POST',
      headers: { ...dm.headers, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    });
    assert.equal(response.status, 200);
    const image = await response.json();
    const a = { ...token(), asset: image.asset },
      b = { ...token(), asset: image.asset };
    for (const t of [a, b]) {
      const rev = f.service.getRoom().revision;
      dm.send({ type: 'create', token: t, ...(t.id === a.id ? { uploadId: image.uploadId } : {}) });
      await dm.until((e) => e.type === 'snapshot' && e.room.revision > rev);
    }
    const before = f.service.getRoom(),
      disk = await readFile(f.dir + '/room.json', 'utf8');
    const save = f.service.storage.save.bind(f.service.storage);
    f.service.storage.save = async () => {
      throw Error('injected disk failure');
    };
    const mark = dm.events.length;
    dm.send({ type: 'delete.many', ids: [a.id, b.id], epoch: 0 });
    const error = await dm.until((e) => e.type === 'error', mark);
    assert.match(error.type === 'error' ? error.message : '', /保存失败/);
    assert.deepEqual(f.service.getRoom(), before);
    assert.equal(await readFile(f.dir + '/room.json', 'utf8'), disk);
    assert.equal((await readdir(f.service.storage.assetDir)).length, 1);
    f.service.storage.save = save;
  } finally {
    await f.close();
  }
});
