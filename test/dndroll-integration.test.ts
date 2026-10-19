import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyAction,
  createSession,
  getSessionView,
  listVersions,
  listMethods,
  generateBatch,
  exportResult,
  formatResult,
  serializeSession,
  deserializeSession,
} from '@dndroll/core';
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
test('embedded package exposes the full catalog and preserves replay/export compatibility', () => {
  assert.ok(listVersions().some((v) => v.id === 'ose-classic'));
  assert.ok(listVersions().some((v) => v.id === 'dcc'));
  let s = createSession({ versionId: 'adnd2e', methodId: 'adnd2e.phb-I' });
  s = applyAction(s, { type: 'roll' }, (n) => (n === 100 ? 100 : 6));
  const v = getSessionView(s);
  assert.equal(v.attempt.scores.STR, 18);
  assert.equal(v.attempt.exceptionalStrength, 100);
  s = applyAction(s, { type: 'finalize' }, (n) => n);
  assert.match(formatResult(s, 'zh'), /18\/00/);
  assert.deepEqual(deserializeSession(serializeSession(s)), s);
  assert.equal(exportResult(s).adjustedScores.STR, 18);
});
test('adapter handles assignment, point-buy, batch and DCC mapping via Core APIs', () => {
  let s = createSession({ versionId: 'pf1', methodId: 'pf1.standard' });
  s = applyAction(s, { type: 'roll' }, () => 4);
  let view = getSessionView(s);
  s = applyAction(s, {
    type: 'assign',
    assignments: Object.fromEntries(
      view.version.order.map((ab, i) => [ab, view.attempt.candidates[i].id]),
    ),
  });
  assert.ok(getSessionView(s).canFinalize);
  let buy = createSession({ versionId: 'pf1', methodId: 'pf1.purchase', options: { budget: 25 } });
  buy = applyAction(buy, { type: 'setScore', ability: 'STR', score: 18 });
  assert.equal(getSessionView(buy).pointBuy?.spent, 17);
  const batch = generateBatch({ versionId: 'dcc', methodId: 'dcc.3d6-in-order' }, 4, () => 4);
  assert.equal(batch.length, 4);
  const result = exportResult(batch[0].session);
  assert.ok('AGI' in result.nativeScores);
  assert.ok('LCK' in result.nativeModifiers!);
  assert.equal(listMethods('adnd1e').find((m) => m.id === 'adnd1e.ua-V')?.status, 'pending');
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
