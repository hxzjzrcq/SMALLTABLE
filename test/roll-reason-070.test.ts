import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitRollInput, rollReason } from '../src/shared/roll-input';
import { createCommandSchema, initialRoom, parseRoom } from '../src/shared/model';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { fixture } from './support/management-fixture';
import { createSmalltable } from './helpers';

test('roll input preserves existing whitespace syntax and splits the longest valid expression', () => {
  for (const expression of ['1d20', 'd100', '2d6+1d4-2', ' 1d20 + 5 ', '1 d 20 + 5'])
    assert.deepEqual(splitRollInput(expression), { expression: expression.trim() });
  for (const reason of [
    '侦查陷阱',
    '查'.repeat(32),
    '😀'.repeat(32),
    'Check trap! +2',
    '<b>查</b>',
  ])
    assert.deepEqual(splitRollInput(` 1d20 + 5   ${reason}  `), { expression: '1d20 + 5', reason });
  for (const bad of [
    '1d20 ' + '查'.repeat(33),
    '1d20 ' + '😀'.repeat(33),
    '1d20 查\n验',
    '1d20 a\tb',
    '1d0 原因',
    'foo reason',
    '101d6 why',
    '1d20 ' + '\uD800',
  ])
    assert.throws(() => splitRollInput(bad), bad);
});

test('wire reason rejects forged fields; old records and schema 3 remain valid', () => {
  const schema = createCommandSchema(DEFAULT_CAPABILITIES);
  const command = { type: 'roll', expression: '1d20', name: 'A' };
  for (const reason of ['a'.repeat(33), '行\r文', '行\n文', '\u0000', '\u2028', 1, null])
    assert.equal(schema.safeParse({ ...command, reason }).success, false);
  assert.equal(rollReason.parse('  查 trap!  '), '查 trap!');
  const room = initialRoom();
  room.rolls.push({
    id: 'c40ca3c1-7040-437d-8568-daf206ebc963',
    name: room.names[0],
    expression: '1d20',
    dice: [{ sign: 1, sides: 20, values: [7] }],
    result: 7,
    time: new Date().toISOString(),
  });
  assert.deepEqual(parseRoom(room), room);
});

test('real peers synchronize reasons, reject invalid input without mutation, persist, restart and restore old backup', async () => {
  const f = await fixture();
  try {
    const a = await f.peer(),
      b = await f.peer();
    const name = f.service.getRoom().names[0];
    await a.unlock();
    // A genuine old-format record (no reason), saved/exported with the existing storage path.
    a.send({ type: 'roll', expression: '1d20', name });
    await a.until((e) => e.type === 'snapshot' && e.room.rolls.length === 1);
    const oldBackup = await fetch(f.url + '/api/backup', { headers: a.headers }).then((r) =>
      r.arrayBuffer(),
    );
    a.send({ type: 'roll', expression: '1d20 + 5', name, reason: '😀'.repeat(32) });
    const snapshot = await b.until((e) => e.type === 'snapshot' && e.room.rolls.length === 2);
    assert.ok(snapshot.type === 'snapshot');
    assert.equal(snapshot.room.rolls[1].reason, '😀'.repeat(32));
    assert.equal(snapshot.room.rolls[1].expression, '1d20+5');
    for (const command of [
      { expression: '1d20', reason: '查'.repeat(33) },
      { expression: '1d20', reason: 'a\nb' },
      { expression: '1d0', reason: 'valid' },
    ]) {
      const before = structuredClone(f.service.getRoom()),
        mark = b.events.length;
      b.send({ type: 'roll', name, ...command });
      await b.until((e) => e.type === 'error', mark);
      assert.deepEqual(f.service.getRoom(), before);
    }
    await f.service.storage.save(f.service.getRoom());
    assert.equal(
      JSON.parse(await readFile(f.dir + '/room.json', 'utf8')).rolls[1].reason,
      '😀'.repeat(32),
    );
    a.ws.terminate();
    b.ws.terminate();
    await f.service.close();
    const restarted = await createSmalltable(f.cfg);
    try {
      assert.equal(restarted.getRoom().rolls[1].reason, '😀'.repeat(32));
      const { room: restored } = await restarted.storage.prepareRestore(Buffer.from(oldBackup));
      assert.equal(restored.rolls.length, 1);
      assert.equal(restored.rolls[0].reason, undefined);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
