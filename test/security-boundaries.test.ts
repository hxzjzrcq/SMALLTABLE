import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/server/config';
import { WS_PERMISSIONS, HTTP_PERMISSIONS, canCommand, canHttp } from '../src/server/permissions';
import { commandSchema } from '../src/shared/model';

test('every schema command has one explicit rule; unknown commands are denied even to DM', () => {
  const commands = commandSchema.options.map((s) => s.shape.type.value);
  assert.deepEqual(Object.keys(WS_PERMISSIONS).sort(), commands.sort());
  for (const action of [
    'activity',
    'unlock',
    'lock',
    'move',
    'rotate',
    'note',
    'roll',
    'initiative.put',
    'initiative.delete',
    'initiative.order',
    'drawing.add',
    'drawing.delete',
  ]) {
    assert.equal(canCommand({ dm: false }, action), true, action);
  }
  for (const action of ['drawing.clear', 'create', 'edit', 'delete', 'clear', 'grid', 'names']) {
    assert.equal(canCommand({ dm: false }, action), false, action);
    assert.equal(canCommand({ dm: true }, action), true, action);
  }
  for (const action of ['unknown', 'drawing.future', 'toString', '__proto__'])
    assert.equal(canCommand({ dm: true }, action), false);
});

test('HTTP permission inventory preserves public/session/DM routes', () => {
  assert.deepEqual(HTTP_PERMISSIONS, {
    'GET /api/config': 'public',
    'POST /api/login': 'public',
    'GET /media/:id': 'session',
    'GET /api/health': 'session',
    'GET /api/backup': 'dm',
    'POST /api/restore': 'dm',
    'POST /api/image/:kind': 'dm',
    'POST /api/passwords': 'dm',
  });
  for (const route of Object.keys(HTTP_PERMISSIONS)) {
    assert.equal(
      canHttp(undefined, route),
      HTTP_PERMISSIONS[route as keyof typeof HTTP_PERMISSIONS] === 'public',
    );
    assert.equal(
      canHttp({ dm: false }, route),
      HTTP_PERMISSIONS[route as keyof typeof HTTP_PERMISSIONS] !== 'dm',
    );
    assert.equal(canHttp({ dm: true }, route), true);
  }
  assert.equal(canHttp({ dm: true }, 'POST /api/new'), false);
});

test('ordinary config does not read, carry or expose initialization credentials', () => {
  process.env.ROOM_PASSWORD = 'not-a-valid-password';
  process.env.DM_PASSWORD = 'same';
  const cfg = config();
  assert.ok(!('roomPassword' in cfg));
  assert.ok(!('dmPassword' in cfg));
  assert.ok(!JSON.stringify(cfg).includes('not-a-valid-password'));
});
