import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, token } from './support/management-fixture';
import { parseRoom } from '../src/shared/model';
test('076 batch visibility, empty label, initiative private details and role permissions persist atomically', async () => {
  const f = await fixture();
  try {
    const dm = await f.peer(),
      pl = await f.peer();
    await dm.unlock();
    async function change(peer: typeof dm, c: object) {
      const rev = f.service.getRoom().revision;
      peer.send(c);
      await peer.until((e) => e.type === 'snapshot' && e.room.revision > rev);
    }
    async function deny(c: object) {
      const before = structuredClone(f.service.getRoom()),
        mark = pl.events.length;
      pl.send(c);
      await pl.until((e) => e.type === 'error', mark);
      assert.deepEqual(f.service.getRoom(), before);
    }
    const t = { ...token(), label: '' };
    await change(dm, { type: 'create', token: t });
    await change(dm, { type: 'public.take', publicId: 'A', x: 0, y: 0, epoch: 0 });
    const pub = f.service.getRoom().tokens.find((t) => t.publicId)!;
    await deny({ type: 'token.hidden.many', ids: [t.id], hidden: true, epoch: 0 });
    const before = f.service.getRoom().revision;
    await change(dm, {
      type: 'token.hidden.many',
      ids: [t.id, pub.id, randomUUID()],
      hidden: true,
      epoch: 0,
    });
    assert.equal(f.service.getRoom().revision, before + 1);
    assert.equal(f.service.getRoom().tokens[0].hidden, true);
    assert.equal(f.service.getRoom().tokens[1].hidden, false);
    await change(dm, { type: 'token.hidden.many', ids: [t.id], hidden: false, epoch: 0 });
    assert.deepEqual(f.service.getRoom().tokens[0], t);
    const entry = { id: randomUUID(), name: '守卫', value: 12 };
    await change(dm, { type: 'initiative.put', entry, epoch: 0 });
    await change(dm, {
      type: 'initiative.details',
      id: entry.id,
      hp: '12/20',
      other: 'AC -2',
      epoch: 0,
    });
    await deny({ type: 'initiative.details', id: entry.id, hp: '0', other: '', epoch: 0 });
    await change(pl, { type: 'initiative.put', entry: { ...entry, name: '卫兵' }, epoch: 0 });
    assert.equal(f.service.getRoom().initiative[0].hp, '12/20');
    const snapshot = await pl.until(
      (e) => e.type === 'snapshot' && e.room.revision === f.service.getRoom().revision,
    );
    assert.ok(
      snapshot.type === 'snapshot' &&
        !('hp' in snapshot.room.initiative[0]) &&
        !('other' in snapshot.room.initiative[0]),
    );
    await change(dm, {
      type: 'initiative.details',
      id: entry.id,
      hp: '12/20',
      other: '',
      epoch: 0,
    });
    const saved = parseRoom(JSON.parse(await readFile(f.dir + '/room.json', 'utf8')));
    assert.deepEqual(saved, f.service.getRoom());
    const backup = await fetch(f.url + '/api/backup', { headers: dm.headers });
    assert.equal(backup.status, 200);
    const archive = new Uint8Array(await backup.arrayBuffer());
    await change(pl, { type: 'initiative.delete', id: entry.id, epoch: 0 });
    const restored = await fetch(f.url + '/api/restore', {
      method: 'POST',
      headers: { ...dm.headers, 'Content-Type': 'application/zip' },
      body: archive,
    });
    assert.equal(restored.status, 200);
    assert.deepEqual(f.service.getRoom().initiative, saved.initiative);

    assert.equal(saved.tokens[0].label, '');
    assert.throws(() => parseRoom({ ...saved, schemaVersion: 4 }), /要求版本 6/);
  } finally {
    await f.close();
  }
});
