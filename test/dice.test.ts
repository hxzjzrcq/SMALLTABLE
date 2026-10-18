import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDice } from '../src/shared/dice.js';
import { bytes, measure, initialRoom, project, tokenSchema } from '../src/shared/model.js';
import { randomUUID } from 'node:crypto';
test('dice preserves raw values, signs and canonical form', () => {
  const r = rollDice(' d20 + 2d6 - 5 ', (n) => n);
  assert.equal(r.expression, '1d20+2d6-5');
  assert.equal(r.result, 27);
  assert.deepEqual(
    r.dice.map((d) => d.values),
    [[20], [6, 6]],
  );
  assert.equal(rollDice('d6-d4', (n) => n).result, 2);
});
test('dice rejects excessive work, unsafe values and public text', () => {
  for (const input of [
    '101d6',
    '0d20',
    '1d1',
    '1d1001',
    '2d6 命中',
    'd20;process.exit()',
    '9007199254740991+d20',
    '4',
    '999999999999999999999999d6',
    '1d6+',
  ])
    assert.throws(() => rollDice(input, (n) => n), input);
});
test('units remain rule-neutral and text limits count UTF-8', () => {
  assert.equal(bytes('中文'), 6);
  assert.equal(measure({ x: 0, y: 0 }, { x: 36, y: 0 }, 10), 4);
  assert.equal(measure({ x: 0, y: 0 }, { x: 25, y: 0 }, 10), 3);
});
test('public projection never contains private token note', () => {
  const room = initialRoom();
  room.tokens.push(
    tokenSchema.parse({
      id: randomUUID(),
      name: 'A',
      label: '1',
      shape: 'circle',
      color: '#000000',
      x: 0,
      y: 0,
      size: 1 / 16,
      angle: 0,
      asset: null,
      note: 'public',
      secret: 'secret-value',
    }),
  );
  assert.ok(!JSON.stringify(project(room, false)).includes('secret-value'));
  assert.equal(project(room, true).tokens[0].secret, 'secret-value');
});
