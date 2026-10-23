import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSchema, initialRoom, project, tokenSchema } from '../src/shared/model';

test('public note contract accepts only its field and validates bytes and epoch', () => {
  const c = {
    type: 'note',
    id: '00000000-0000-4000-8000-000000000001',
    note: 'HP 12/20',
    epoch: 0,
  };
  assert.equal(commandSchema.parse(c).type, 'note');
  for (const bad of [
    { ...c, secret: 'bad' },
    { ...c, x: 42 },
    { ...c, epoch: -1 },
    { ...c, note: '字'.repeat(1366) },
  ]) {
    assert.equal(commandSchema.safeParse(bad).success, false);
  }
  const token = tokenSchema.parse({
    id: c.id,
    name: '',
    hidden: false,
    label: '1',
    shape: 'circle',
    color: '#3872a4',
    x: 0,
    y: 0,
    size: 1,
    angle: 0,
    asset: null,
    note: c.note,
    secret: 'DM secret',
  });
  const room = { ...initialRoom(), tokens: [token] };
  assert.equal(project(room, false).tokens[0].note, c.note);
  assert.equal(project(room, false).tokens[0].secret, undefined);
  assert.equal(project(room, true).tokens[0].secret, 'DM secret');
});
