import { waitEvent, createSmalltable } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { config } from '../src/server/config';
import { ServerEvent } from '../src/shared/model';

test('public notes synchronize, persist and preserve DM-only fields', async () => {
  process.env.ROOM_PASSWORD = 'note-test-room';
  process.env.DM_PASSWORD = 'note-test-dm';
  const dir = await mkdtemp(path.join(tmpdir(), 'smalltable-note-'));
  const service = await createSmalltable({ ...config(), dataDir: dir });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const peers: WebSocket[] = [];
  const wait = async (events: ServerEvent[], predicate: (e: ServerEvent) => boolean, mark = 0) => {
    return waitEvent(events, predicate, mark);
  };
  async function peer() {
    const res = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'note-test-room' }),
    });
    const { token } = await res.json();
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    peers.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    await wait(events, (e) => e.type === 'snapshot');
    return { events, send: (c: unknown) => ws.send(JSON.stringify(c)) };
  }
  try {
    const dm = await peer(),
      player = await peer();
    dm.send({ type: 'unlock', password: 'note-test-dm' });
    await wait(dm.events, (e) => e.type === 'snapshot' && e.dm);
    const token = {
      id: '00000000-0000-4000-8000-000000000001',
      name: '棋子',
      label: '1',
      shape: 'circle',
      color: '#3872a4',
      x: 64,
      y: 64,
      size: 1,
      angle: 0,
      asset: null,
      note: '',
      secret: 'DM secret',
    };
    dm.send({ type: 'create', token });
    await wait(player.events, (e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    player.send({ type: 'note', id: token.id, note: 'HP 12/20', epoch: 0 });
    await wait(player.events, (e) => e.type === 'token' && e.token.note === 'HP 12/20');
    const event = await wait(dm.events, (e) => e.type === 'token' && e.token.note === 'HP 12/20');
    assert.ok(event.type === 'token' && event.token.secret === token.secret);
    for (const command of [
      { type: 'note', id: token.id, note: 'bad', epoch: 99 },
      { type: 'note', id: token.id, note: '字'.repeat(1366), epoch: 0 },
      { type: 'note', id: token.id, note: 'bad', secret: 'hacked', epoch: 0 },
      { type: 'edit', token: { ...token, name: 'hacked' } },
    ]) {
      const mark = player.events.length;
      player.send(command);
      await wait(player.events, (e) => e.type === 'error', mark);
      assert.deepEqual(service.getRoom().tokens[0], { ...token, note: 'HP 12/20' });
    }
    player.send({ type: 'rotate', id: token.id, angle: 45, epoch: 0 });
    await wait(dm.events, (e) => e.type === 'token' && e.token.angle === 45);
    await wait(dm.events, (e) => e.type === 'saved' && e.revision === service.getRoom().revision);
    const disk = JSON.parse(await readFile(path.join(dir, 'room.json'), 'utf8'));
    assert.equal(disk.tokens[0].note, 'HP 12/20');
    assert.equal(disk.tokens[0].secret, 'DM secret');
    assert.ok(!JSON.stringify(player.events).includes('DM secret'));
  } finally {
    for (const ws of peers) ws.terminate();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
