import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { fixture, token, drawing } from './support/management-fixture';
import { DEFAULT_CAPABILITIES as defaults } from '../src/shared/limits';
import { parseRoom, initialRoom, coordinate, createCommandSchema } from '../src/shared/model';
import { config, backupLimits } from '../src/server/config';
import { waitEvent, testStorage, createSmalltable } from './helpers';
import { inspectMp3 } from '../src/server/mp3';
const mp3 = () => readFile(new URL('./fixtures/tone.mp3', import.meta.url));
const png = (color = 'red') =>
  sharp({ create: { width: 8, height: 8, channels: 4, background: color } })
    .png()
    .toBuffer();
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Peer = Awaited<ReturnType<Fixture['peer']>>;
async function post(f: Fixture, p: Peer, route: string, data: Buffer, name = 'sample') {
  return fetch(f.url + route, {
    method: 'POST',
    headers: {
      ...p.headers,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
    },
    body: new Uint8Array(data),
  });
}
async function command(
  p: Peer,
  c: unknown,
  check: (e: import('../src/shared/model').ServerEvent) => boolean,
) {
  const mark = p.events.length;
  p.send(c);
  return p.until(check, mark);
}
const updated = (revision: number) => (e: import('../src/shared/model').ServerEvent) =>
  e.type === 'snapshot' && e.room.revision > revision;
async function restore(f: Fixture, p: Peer, data: Buffer) {
  return fetch(f.url + '/api/restore', {
    method: 'POST',
    headers: { ...p.headers, 'Content-Type': 'application/zip' },
    body: new Uint8Array(data),
  });
}

test('multi-map defaults, custom count, independent scale and unchanged table; duplicates count entries only', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const peers = await Promise.all([f.peer(), f.peer(), f.peer()]);
    for (const p of peers) await p.unlock();
    const dm = peers[0],
      player = await f.peer();
    const t = token();
    t.label = '贴条';
    t.note = '公开说明';
    await command(dm, { type: 'create', token: t }, updated(0));
    await command(player, { type: 'drawing.add', drawing: drawing(), epoch: 0 }, updated(1));
    const stable = f.service.getRoom(),
      image = await png();
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await post(f, peers[Math.floor(i / 4)], '/api/image/map', image, '同名.png')).status,
        200,
      );
    assert.equal((await post(f, peers[2], '/api/image/map', image)).status, 400);
    const maps = f.service.getRoom().maps;
    assert.equal(maps.length, 10);
    assert.equal(new Set(maps.map((m) => m.id)).size, 10);
    assert.equal((await readdir(f.service.storage.assetDir)).length, 1);
    for (const [id, scale] of [
      [maps[0].id, 10],
      [maps[1].id, 300],
      [maps[2].id, 100],
    ] as const)
      await command(dm, { type: 'map.scale', id, scale }, updated(f.service.getRoom().revision));
    for (const scale of [0, 9, 15, 301, Infinity]) {
      const before = f.service.getRoom();
      await command(dm, { type: 'map.scale', id: maps[0].id, scale }, (e) => e.type === 'error');
      assert.deepEqual(f.service.getRoom(), before);
    }
    await command(
      dm,
      { type: 'map.select', id: maps[0].id },
      updated(f.service.getRoom().revision),
    );
    const after = f.service.getRoom();
    for (const key of ['tokens', 'drawings', 'grid', 'names', 'initiative', 'rolls'] as const)
      assert.deepEqual(after[key], stable[key]);
    assert.equal(after.maps[0].scale, 10);
    assert.equal(after.maps[1].scale, 300);
    await command(dm, { type: 'map.delete', id: maps[1].id }, updated(after.revision));
    assert.equal(f.service.getRoom().currentMapId, maps[0].id);
    await command(
      dm,
      { type: 'map.delete', id: maps[0].id },
      updated(f.service.getRoom().revision),
    );
    assert.equal(f.service.getRoom().currentMapId, maps[2].id);
    assert.equal((await post(f, peers[2], '/api/image/map', image)).status, 200);
    for (const m of f.service.getRoom().maps)
      await command(dm, { type: 'map.delete', id: m.id }, updated(f.service.getRoom().revision));
    assert.equal(f.service.getRoom().currentMapId, null);
    assert.equal(await f.service.storage.usage(), 0);
    const playerSnapshot = player.events.filter((e) => e.type === 'snapshot').at(-1);
    assert.ok(!JSON.stringify(playerSnapshot).includes(t.secret));
  } finally {
    await f.close();
  }
  const small = await fixture({ ...defaults, maxMaps: 1 });
  try {
    const dm = await small.peer();
    await dm.unlock();
    assert.equal((await post(small, dm, '/api/image/map', await png())).status, 200);
    assert.equal((await post(small, dm, '/api/image/map', await png())).status, 400);
  } finally {
    await small.close();
  }
});

test('world bounds apply to commands/load/restore, leave initiative and dice numerical domains intact', async () => {
  for (const n of [-32768, 32768, -1.25]) assert.ok(coordinate.safeParse(n).success);
  for (const n of [-32768.01, 32768.01, Infinity, NaN])
    assert.equal(coordinate.safeParse(n).success, false);
  const schema = createCommandSchema(defaults);
  assert.ok(
    schema.safeParse({
      type: 'initiative.put',
      entry: { id: randomUUID(), name: 'A', value: 999999 },
      epoch: 0,
    }).success,
  );
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    const t = { ...token(), x: -32768, y: 32768 };
    await command(dm, { type: 'create', token: t }, updated(0));
    for (const c of [
      { type: 'move', id: t.id, x: 32769, y: 0, final: true, epoch: 0 },
      { type: 'grid', grid: { cell: 64, x: Infinity, y: 0, visible: true } },
      { type: 'drawing.add', drawing: { ...drawing(), x2: -32769 }, epoch: 0 },
    ]) {
      const before = f.service.getRoom();
      await command(dm, c, (e) => e.type === 'error');
      assert.deepEqual(f.service.getRoom(), before);
    }
    const invalid = { ...f.service.getRoom(), tokens: [{ ...t, x: 32769 }] };
    assert.throws(() => parseRoom(invalid));
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(invalid)));
    assert.equal((await restore(f, dm, zip.toBuffer())).status, 400);
    for (const version of [1, 2])
      assert.throws(() => parseRoom({ ...initialRoom(), schemaVersion: version }), /不兼容/);
    assert.equal(inspectMp3(await mp3()).duration > 8, true);
  } finally {
    await f.close();
  }
});

test('flip table persists once, preserves named data and music, rejects late movement/drawing and player controls', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer(),
      p = await f.peer();
    await dm.unlock();
    assert.equal((await post(f, dm, '/api/image/map', await png())).status, 200);
    await post(f, dm, '/api/music', await mp3());
    const track = f.service.music.tracks[0];
    await command(
      dm,
      { type: 'music.play', id: track.id },
      (e) => e.type === 'music' && e.music.playback.status === 'playing',
    );
    const t = token();
    await command(dm, { type: 'create', token: t }, updated(f.service.getRoom().revision));
    await command(
      p,
      { type: 'drawing.add', drawing: drawing(), epoch: 0 },
      updated(f.service.getRoom().revision),
    );
    await command(
      p,
      { type: 'initiative.put', entry: { id: randomUUID(), name: 'A', value: 1 }, epoch: 0 },
      updated(f.service.getRoom().revision),
    );
    const before = f.service.getRoom(),
      music = f.service.music.snapshot().playback;
    for (const type of [
      'clear',
      'map.select',
      'map.delete',
      'map.scale',
      'music.play',
      'music.pause',
      'music.stop',
      'music.delete',
    ]) {
      const c = {
        type,
        ...(type.startsWith('map.')
          ? { id: before.maps[0].id }
          : type === 'music.play' || type === 'music.delete'
            ? { id: track.id }
            : {}),
        ...(type === 'map.scale' ? { scale: 100 } : {}),
      };
      await command(p, c, (e) => e.type === 'error');
      assert.deepEqual(f.service.getRoom(), before);
    }
    await command(dm, { type: 'clear' }, (e) => e.type === 'snapshot' && e.epoch === 1);
    const after = f.service.getRoom();
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.tokens, []);
    assert.deepEqual(after.drawings, []);
    for (const k of [
      'maps',
      'currentMapId',
      'grid',
      'names',
      'rolls',
      'initiative',
      'initiativeAscending',
    ] as const)
      assert.deepEqual(after[k], before[k]);
    assert.deepEqual(f.service.music.snapshot().playback, music);
    await p.until((e) => e.type === 'snapshot' && e.epoch === 1);
    for (const c of [
      { type: 'move', id: t.id, x: 1, y: 2, final: true, epoch: 0 },
      { type: 'drawing.add', drawing: drawing(), epoch: 0 },
    ])
      await command(p, c, (e) => e.type === 'error');
    assert.deepEqual(f.service.getRoom(), after);
    assert.deepEqual(await f.service.storage.load(), after);
  } finally {
    await f.close();
  }
});

test('resource leases cancel/expire, survive shared references and release last ref; restart discards leases', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    const image = await png();
    const a = await (await post(f, dm, '/api/image/token', image)).json();
    const b = await (await post(f, dm, '/api/image/token', image)).json();
    assert.equal(a.asset, b.asset);
    const size = await f.service.storage.usage();
    assert.ok(size > 0);
    const cancel = (uploadId: string) =>
      fetch(f.url + '/api/upload/cancel', {
        method: 'POST',
        headers: { ...dm.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
    await cancel(a.uploadId);
    assert.equal(await f.service.storage.usage(), size);
    await command(
      dm,
      { type: 'create', token: { ...token(), asset: a.asset }, uploadId: a.uploadId },
      (e) => e.type === 'error',
    );
    const t = { ...token(), asset: b.asset };
    await command(dm, { type: 'create', token: t, uploadId: b.uploadId }, updated(0));
    const copy = { ...t, id: randomUUID() };
    await command(dm, { type: 'create', token: copy }, updated(1));
    await command(dm, { type: 'delete', id: t.id }, updated(2));
    assert.equal(await f.service.storage.usage(), size);
    await command(dm, { type: 'delete', id: copy.id }, updated(3));
    assert.equal(await f.service.storage.usage(), 0);
    const c = await (await post(f, dm, '/api/image/token', image)).json();
    const now = Date.now;
    Date.now = () => now() + 600001;
    try {
      await f.service.storage.collect(f.service.getRoom(), f.service.music.tracks);
    } finally {
      Date.now = now;
    }
    await command(
      dm,
      { type: 'create', token: { ...token(), asset: c.asset }, uploadId: c.uploadId },
      (e) => e.type === 'error',
    );
    assert.equal(await f.service.storage.usage(), 0);
    await f.service.storage.put(image, 'token');
    assert.ok((await f.service.storage.usage()) > 0);
    await f.service.close();
    const reopened = await createSmalltable(f.cfg, {});
    try {
      assert.equal(await reopened.storage.usage(), 0);
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('exact single/total byte quotas and serialized concurrent uploads; failed cleanup continues counting', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const image = await png();
    const out = await f.service.storage.validateImage(image, 'token');
    const exact = testStorage({
      ...f.cfg,
      caps: { ...defaults, tokenBytes: image.length, resourceBytes: out.data.length },
    });
    assert.equal((await exact.validateImage(image, 'token')).data.length, out.data.length);
    await assert.rejects(
      testStorage({ ...f.cfg, caps: { ...defaults, tokenBytes: image.length - 1 } }).validateImage(
        image,
        'token',
      ),
      /超过/,
    );
    await exact.install(out.data, 'webp');
    assert.equal(await exact.usage(), out.data.length);
    await exact.assertBudget(
      new Map([[createHash('sha256').update(out.data).digest('hex') + '.webp', out.data.length]]),
    );
    await assert.rejects(exact.assertBudget(new Map([['a'.repeat(64) + '.mp3', 1]])), /预算/);
    await exact.collect(initialRoom());
    const orphan = 'b'.repeat(64) + '.webp';
    await mkdir(path.join(exact.assetDir, orphan));
    await exact.collect(initialRoom());
    assert.equal(await exact.usage(), (await stat(path.join(exact.assetDir, orphan))).size);
    await assert.rejects(exact.assertBudget(), /预算/);
    await rm(path.join(exact.assetDir, orphan), { recursive: true });
  } finally {
    await f.close();
  }
  const prep = await fixture();
  const red = await png('red'),
    blue = await png('blue');
  const r = await prep.service.storage.validateImage(red, 'map'),
    b = await prep.service.storage.validateImage(blue, 'map');
  await prep.close();
  const concurrent = await fixture({
    ...defaults,
    resourceBytes: Math.max(r.data.length, b.data.length),
    maxDMs: 2,
  });
  try {
    const a = await concurrent.peer(),
      b = await concurrent.peer();
    await a.unlock();
    await b.unlock();
    const results = await Promise.all([
      post(concurrent, a, '/api/image/map', red),
      post(concurrent, b, '/api/image/map', blue),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal(concurrent.service.getRoom().maps.length, 1);
  } finally {
    await concurrent.close();
  }
});

test('map and music save failures preserve authoritative state and clean rejected files', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    await post(f, dm, '/api/image/map', await png('red'));
    const before = f.service.getRoom(),
      size = await f.service.storage.usage();
    await mkdir(path.join(f.dir, 'room.json.tmp'));
    assert.equal((await post(f, dm, '/api/image/map', await png('blue'))).status, 400);
    assert.deepEqual(f.service.getRoom(), before);
    assert.equal(await f.service.storage.usage(), size);
    assert.deepEqual(await f.service.storage.load(), before);
    await command(dm, { type: 'clear' }, (e) => e.type === 'error');
    assert.deepEqual(f.service.getRoom(), before);
    await rm(path.join(f.dir, 'room.json.tmp'), { recursive: true });
    await mkdir(path.join(f.dir, 'music.json.tmp'));
    assert.equal((await post(f, dm, '/api/music', await mp3())).status, 400);
    assert.deepEqual(f.service.music.tracks, []);
    assert.equal(await f.service.storage.usage(), size);
  } finally {
    await f.close();
  }
});

test('portable backup covers noncurrent maps; restore excludes music, preserves playback and validates candidate quota', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    await post(f, dm, '/api/image/map', await png('red'));
    await post(f, dm, '/api/image/map', await png('blue'));
    const backup = await f.service.storage.backup(f.service.getRoom());
    const zip = new AdmZip(backup);
    assert.equal(zip.getEntries().length, 3);
    assert.equal(
      zip.getEntries().some((e) => /music|audio/.test(e.entryName)),
      false,
    );
    await post(f, dm, '/api/music', await mp3());
    const id = f.service.music.tracks[0].id;
    await command(
      dm,
      { type: 'music.play', id },
      (e) => e.type === 'music' && e.music.playback.status === 'playing',
    );
    const library = structuredClone(f.service.music.tracks),
      playback = f.service.music.snapshot().playback;
    assert.equal((await restore(f, dm, backup)).status, 200);
    assert.deepEqual(f.service.music.tracks, library);
    assert.deepEqual(f.service.music.snapshot().playback, playback);
    const before = f.service.getRoom();
    for (const mutate of [
      (z: AdmZip) =>
        z.deleteFile(z.getEntries().find((e) => e.entryName.startsWith('assets/'))!.entryName),
      (z: AdmZip) =>
        z.updateFile(
          z.getEntries().find((e) => e.entryName.startsWith('assets/'))!.entryName,
          Buffer.from('bad'),
        ),
      (z: AdmZip) =>
        z.updateFile('room.json', Buffer.from(JSON.stringify({ ...before, schemaVersion: 2 }))),
    ]) {
      const z = new AdmZip(backup);
      mutate(z);
      const validator = await f.peer();
      await validator.unlock();
      assert.equal((await restore(f, validator, z.toBuffer())).status, 400);
      assert.deepEqual(f.service.getRoom(), before);
    }
    const low = testStorage({
      ...f.cfg,
      caps: { ...defaults, resourceBytes: (await mp3()).length },
    });
    await assert.rejects((await low.prepareRestore(backup)).checkBudget(before), /预算/);
    await f.service.close();
    const reopened = await createSmalltable(f.cfg, {});
    try {
      assert.deepEqual(reopened.music.tracks, library);
      assert.equal(reopened.music.snapshot().playback.trackId, null);
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('MP3 bytes are validated, authorized ranges work; pushes pause/stop/switch/natural end/deletion', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer(),
      p = await f.peer();
    await dm.unlock();
    const data = await mp3();
    assert.equal((await post(f, p, '/api/music', data)).status, 400);
    assert.equal((await post(f, dm, '/api/music', Buffer.from('ID3invalid'))).status, 400);
    assert.throws(() => inspectMp3(data.subarray(0, data.length - 3)), /截断/);
    assert.equal((await post(f, dm, '/api/music', data, 'A.mp3')).status, 200);
    assert.equal((await post(f, dm, '/api/music', data, 'B.mp3')).status, 200);
    const [a, b] = f.service.music.tracks;
    assert.equal(a.asset, b.asset);
    assert.equal(await f.service.storage.usage(), data.length);
    assert.equal((await fetch(f.url + '/audio/' + a.asset)).status, 401);
    const range = await fetch(f.url + '/audio/' + a.asset, {
      headers: { ...p.headers, Range: 'bytes=10-29' },
    });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), data.subarray(10, 30));
    assert.equal(
      (
        await fetch(f.url + '/audio/' + a.asset, {
          headers: { ...p.headers, Range: `bytes=${data.length}-` },
        })
      ).status,
      416,
    );
    await command(
      dm,
      { type: 'music.play', id: a.id },
      (e) => e.type === 'music' && e.music.playback.status === 'playing',
    );
    const push = f.service.music.snapshot().playback.pushId;
    await command(
      dm,
      { type: 'music.pause' },
      (e) => e.type === 'music' && e.music.playback.status === 'paused',
    );
    await command(
      dm,
      { type: 'music.play', id: a.id },
      (e) => e.type === 'music' && e.music.playback.status === 'playing',
    );
    assert.equal(f.service.music.snapshot().playback.pushId, push);
    await command(
      dm,
      { type: 'music.stop' },
      (e) => e.type === 'music' && e.music.playback.status === 'stopped',
    );
    assert.equal(f.service.music.snapshot().playback.position, 0);
    await command(
      dm,
      { type: 'music.play', id: a.id },
      (e) => e.type === 'music' && e.music.playback.status === 'playing',
    );
    assert.equal(f.service.music.snapshot().playback.pushId, push);
    await command(
      dm,
      { type: 'music.play', id: b.id },
      (e) => e.type === 'music' && e.music.playback.trackId === b.id,
    );
    assert.notEqual(f.service.music.snapshot().playback.pushId, push);
    await command(
      dm,
      { type: 'music.play', id: a.id },
      (e) => e.type === 'music' && e.music.playback.trackId === a.id,
    );
    assert.notEqual(f.service.music.snapshot().playback.pushId, push);
    await waitEvent(
      p.events,
      (e) =>
        e.type === 'music' &&
        e.music.playback.status === 'stopped' &&
        e.music.playback.trackId === a.id,
      p.events.length,
      10000,
    );
    await command(
      dm,
      { type: 'music.delete', id: a.id },
      (e) => e.type === 'music' && e.music.playback.trackId === null,
    );
    assert.equal(await f.service.storage.usage(), data.length);
    await command(
      dm,
      { type: 'music.delete', id: b.id },
      (e) => e.type === 'music' && !e.music.tracks.length,
    );
    assert.equal(await f.service.storage.usage(), 0);
  } finally {
    await f.close();
  }
});

test('new positive integer config/overflow validation and startup lower limits reject data', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const file = path.join(f.dir, 'settings.json');
    for (const raw of [
      { limits: { maps: 0 } },
      { limits: { music: 1.5 } },
      { resources: { totalBytes: -1 } },
      { resources: { musicBytes: '1' } },
      { resources: { totalBytes: Number.MAX_SAFE_INTEGER } },
    ]) {
      await writeFile(file, JSON.stringify(raw));
      assert.throws(() => config(file), /配置/);
    }
    await writeFile(
      file,
      JSON.stringify({
        limits: { maps: 2, music: 3 },
        resources: { totalBytes: 70000, musicBytes: 65000 },
      }),
    );
    const caps = config(file).caps;
    assert.equal(caps.maxMaps, 2);
    assert.equal(caps.maxMusic, 3);
    assert.equal(caps.resourceBytes, 70000);
    assert.ok(backupLimits(caps).entries >= caps.maxMaps + caps.maxTokens + 1);
    const dm = await f.peer();
    await dm.unlock();
    await post(f, dm, '/api/image/map', await png());
    await f.service.close();
    await assert.rejects(
      createSmalltable({ ...f.cfg, caps: { ...defaults, resourceBytes: 1 } }, {}),
      /预算/,
    );
    assert.equal(JSON.parse(await readFile(path.join(f.dir, 'room.json'), 'utf8')).maps.length, 1);
  } finally {
    await f.close();
  }
});

function paddedJpeg(jpeg: Buffer, target: number) {
  const chunks: Buffer[] = [jpeg.subarray(0, 2)];
  let remaining = target - jpeg.length;
  while (remaining) {
    let size = Math.min(65537, remaining);
    if (remaining - size > 0 && remaining - size < 4) size -= 4;
    assert.ok(size >= 4);
    const chunk = Buffer.alloc(size);
    chunk.writeUInt16BE(0xfffe, 0);
    chunk.writeUInt16BE(size - 2, 2);
    chunks.push(chunk);
    remaining -= size;
  }
  chunks.push(jpeg.subarray(2));
  return Buffer.concat(chunks);
}
function paddedMp3(data: Buffer, target: number) {
  const tagSize = data[6] * 2097152 + data[7] * 16384 + data[8] * 128 + data[9];
  const frames = data.subarray(10 + tagSize),
    size = target - frames.length - 10,
    header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]);
  header[6] = (size >>> 21) & 127;
  header[7] = (size >>> 14) & 127;
  header[8] = (size >>> 7) & 127;
  header[9] = size & 127;
  return Buffer.concat([header, Buffer.alloc(size), frames]);
}
test('valid exact 256 KiB token, 10 MiB map and 4 MiB MP3 accepted; one extra byte rejected; final transcode limit enforced', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer();
    for (const [kind, limit] of [
      ['token', defaults.tokenBytes],
      ['map', defaults.mapBytes],
    ] as const) {
      assert.equal((await post(f, dm, '/api/image/' + kind, paddedJpeg(jpeg, limit))).status, 200);
      const p = await f.peer();
      await p.unlock();
      assert.equal(
        (await post(f, p, '/api/image/' + kind, paddedJpeg(jpeg, limit + 1))).status,
        400,
      );
    }
    const data = await mp3();
    const p = await f.peer();
    await p.unlock();
    assert.equal(
      (await post(f, p, '/api/music', paddedMp3(data, defaults.musicBytes))).status,
      200,
    );
    assert.equal(
      (await post(f, p, '/api/music', paddedMp3(data, defaults.musicBytes + 1))).status,
      400,
    );
    let seed = 123;
    const raw = Buffer.alloc(256 * 256 * 3);
    for (let i = 0; i < raw.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[i] = seed >>> 24;
    }
    const source = await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 50 })
      .toBuffer();
    const lossless = await sharp(source).webp({ lossless: true }).toBuffer();
    const fallback = await sharp(lossless).webp({ quality: 85 }).toBuffer();
    assert.ok(fallback.length > source.length);
    const limited = testStorage({ ...f.cfg, caps: { ...defaults, tokenBytes: source.length } });
    await assert.rejects(limited.validateImage(source, 'token'), /转码后/);
  } finally {
    await f.close();
  }
});

test('custom music count enforced and restoring replacement images does not double-count retired room assets', async () => {
  const f = await fixture({ ...defaults, maxMusic: 1 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    const data = await mp3();
    assert.equal((await post(f, dm, '/api/music', data)).status, 200);
    assert.equal((await post(f, dm, '/api/music', data)).status, 400);
    const image = await png('red'),
      a = await f.service.storage.put(image, 'map');
    const before = initialRoom();
    before.maps = [{ ...a, id: randomUUID(), name: 'red', scale: 100 }];
    before.currentMapId = before.maps[0].id;
    await f.service.storage.save(before);
    const blue = await f.service.storage.validateImage(await png('blue'), 'map');
    const id = createHash('sha256').update(blue.data).digest('hex') + '.webp';
    const candidate = structuredClone(before);
    candidate.maps[0] = { ...candidate.maps[0], asset: id, width: blue.width, height: blue.height };
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(candidate)));
    zip.addFile('assets/' + id, blue.data);
    const exact = testStorage({
      ...f.cfg,
      caps: { ...f.cfg.caps, resourceBytes: data.length + blue.data.length },
    });
    await (await exact.prepareRestore(zip.toBuffer())).checkBudget(before);
    const tmp = await f.service.storage.put(await png('green'), 'token');
    f.service.storage.temporary(tmp.asset, dm.session);
    await assert.rejects((await exact.prepareRestore(zip.toBuffer())).checkBudget(before), /预算/);
    // A valid candidate with a failing room write cannot replace the current room or music.
    const state = f.service.getRoom(),
      music = f.service.music.snapshot();
    await f.service.storage.save(state);
    await mkdir(path.join(f.dir, 'room.json.tmp'));
    assert.equal((await restore(f, dm, zip.toBuffer())).status, 400);
    assert.deepEqual(f.service.getRoom(), state);
    assert.deepEqual(f.service.music.snapshot().tracks, music.tracks);
    assert.deepEqual(f.service.music.snapshot().playback, music.playback);
  } finally {
    await f.close();
  }
});

test('map and token can share content; token replacement and final map deletion release only unused hashes', async () => {
  const f = await fixture({ ...defaults, maxDMs: 4 });
  try {
    const dm = await f.peer();
    await dm.unlock();
    const data = await png();
    await post(f, dm, '/api/image/map', data);
    const map = f.service.getRoom().maps[0],
      image = await (await post(f, dm, '/api/image/token', data)).json();
    assert.equal(map.asset, image.asset);
    const t = { ...token(), asset: image.asset };
    await command(
      dm,
      { type: 'create', token: t, uploadId: image.uploadId },
      updated(f.service.getRoom().revision),
    );
    const bytes = await f.service.storage.usage();
    assert.equal(bytes, (await readFile(path.join(f.service.storage.assetDir, map.asset))).length);
    const replacement = await (await post(f, dm, '/api/image/token', await png('blue'))).json();
    await command(
      dm,
      { type: 'edit', token: { ...t, asset: replacement.asset }, uploadId: replacement.uploadId },
      updated(f.service.getRoom().revision),
    );
    assert.ok((await f.service.storage.usage()) > bytes);
    await command(dm, { type: 'map.delete', id: map.id }, updated(f.service.getRoom().revision));
    await assert.rejects(readFile(path.join(f.service.storage.assetDir, map.asset)));
    assert.ok(
      (await readFile(path.join(f.service.storage.assetDir, replacement.asset))).length > 0,
    );
    await command(
      dm,
      { type: 'edit', token: { ...t, asset: null } },
      updated(f.service.getRoom().revision),
    );
    assert.equal(await f.service.storage.usage(), 0);
  } finally {
    await f.close();
  }
});
