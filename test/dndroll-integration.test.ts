import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSmalltable } from './helpers.js';
import { config } from '../src/server/config.js';

test('vendored Core source is byte-identical to the supplied DNDROLL 0.4 source', async () => {
  const root = path.resolve('packages/dndroll-core');
  const manifest = JSON.parse(await readFile(path.join(root, 'UPSTREAM.json'), 'utf8'));
  for (const [file, sha] of Object.entries(manifest.sourceSha256))
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex'),
      sha,
      file,
    );
});

test('built tool entry and CSP allow same-origin embedding without modifying room state', async () => {
  process.env.ROOM_PASSWORD = 'stage-room';
  process.env.DM_PASSWORD = 'stage-dm';
  const dataDir = await mkdtemp(path.join(tmpdir(), 'smalltable-stage-'));
  const service = await createSmalltable({ ...config(), dataDir });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
    const response = await fetch(url + '/dndroll.html');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
    const html = await response.text();
    assert.match(html, /SMALLTABLE/);
    const scripts = [...html.matchAll(/(?:src|href)="([^" ]+\.js)"/g)].map((m) => m[1]);
    assert.ok(scripts.length);
    for (const src of scripts) assert.equal((await fetch(url + src)).status, 200);
    assert.equal(service.getRoom().revision, 0);
  } finally {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
