import { testStorage, createSmalltable } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { config, backupLimits } from '../src/server/config';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom } from '../src/shared/model';
import { token } from './support/limits-fixture';
import { roomPassword, dmPassword, token as managementToken } from './support/management-fixture';

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
    assert.equal(limits.entries, 300 + cfg.caps.maxMaps + 1);
    assert.ok(limits.bytes > backupLimits({ ...cfg.caps, maxTokens: 3 }).bytes);
    const excess = new AdmZip();
    excess.addFile('room.json', Buffer.from(JSON.stringify(initialRoom())));
    excess.addFile('extra.txt', Buffer.from('x'));
    await assert.rejects(() => storage.prepareRestore(excess.toBuffer()), /路径/);
  } finally {
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
    room.tokens = [{ ...managementToken(), asset: id }];
    await writeFile(path.join(dir, 'room.json'), JSON.stringify(room));
    await assert.rejects(storage.load(), /存档损坏/);
    await writeFile(path.join(dir, 'room.json'), ' '.repeat(backupLimits(caps).roomBytes + 1));
    await assert.rejects(storage.load(), /存档损坏/);
    await assert.rejects(async () =>
      storage.save({ ...initialRoom(), tokens: [managementToken(), managementToken()] }),
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
