import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { roomFixture as setup, makeToken } from './room-fixture';

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
