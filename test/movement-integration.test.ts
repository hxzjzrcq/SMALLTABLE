let loginSequence068 = 0;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { createSmalltable } from './helpers.js';
import { roomFixture as setup, makeToken, Peer, delay } from './room-fixture';

test('15 connections, 255 tokens, concurrent movement converges; log cap and restart persist', async () => {
  const x = await setup();
  try {
    const peers: Peer[] = [];
    // Different loopback transport addresses avoid the intentional per-IP login rate limit.
    for (let i = 0; i < 15; i++) {
      const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        void import('node:http').then(({ request }) => {
          const req = request(
            x.url + '/api/login',
            {
              method: 'POST',
              localAddress: `127.0.0.${i + 2}`,
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (d) => (body += d));
              res.on('end', () =>
                resolve({
                  status: res.statusCode!,
                  body: {
                    ...JSON.parse(body),
                    token: res.headers['set-cookie']?.[0]?.match(/tt_room=([^;]+)/)?.[1],
                  },
                }),
              );
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify({ password: 'test-room', name: 'U' + ++loginSequence068 }));
        });
      });
      assert.equal(response.status, 200);
      const p = new Peer(x.url, response.body.token);
      peers.push(p);
      x.trackPeer(p);
      await p.wait((e) => e.type === 'snapshot');
    }
    const full = await x.login();
    assert.equal(full.res.status, 409);
    // Build a validated backup to populate maximum board size without fighting input rate limits.
    const room = x.service.getRoom();
    room.tokens = Array.from({ length: 255 }, makeToken);
    room.rolls = Array.from({ length: 255 }, () => ({
      id: randomUUID(),
      name: '天意爷',
      expression: '1d6',
      dice: [{ sign: 1 as const, sides: 6, values: [1] }],
      result: 1,
      time: new Date().toISOString(),
    }));
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(room)));
    const dm = peers[0];
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    assert.equal(
      (
        await fetch(x.url + '/api/restore', {
          method: 'POST',
          headers: { Authorization: `Bearer ${dm.token}`, 'Content-Type': 'application/zip' },
          body: new Uint8Array(zip.toBuffer()),
        })
      ).status,
      200,
    );
    await peers[14].wait((e) => e.type === 'snapshot' && e.room.tokens.length === 255);
    const id = room.tokens[0].id;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 5; i++)
        peers[i].send({ type: 'move', id, x: round * 100 + i, y: i, final: round === 9, epoch: 1 });
      await delay(105);
    }
    // Cross-socket arrival order is unspecified. A later explicit placement establishes the convergence target.
    const finalMarks = peers.map((p) => p.events.length);
    dm.send({ type: 'move', id, x: 1001, y: 77, final: true, epoch: 1 });
    await Promise.all(
      peers.map((p, i) =>
        p.wait((e) => e.type === 'token' && e.token.x === 1001 && e.token.y === 77, finalMarks[i]),
      ),
    );
    assert.equal(x.service.getRoom().tokens[0].x, 1001);
    const mark = dm.events.length;
    dm.send({ type: 'create', token: makeToken() });
    await dm.wait((e) => e.type === 'error', mark);
    assert.equal(x.service.getRoom().tokens.length, 255);
    dm.send({ type: 'roll', expression: 'd20', name: '天意爷' });
    await peers[14].wait(
      (e) => e.type === 'snapshot' && e.room.rolls.at(-1)?.expression === '1d20',
    );
    assert.equal(x.service.getRoom().rolls.length, 255);
    for (const p of peers) p.ws.terminate();
    await delay(40);
    await x.service.close();
    const restarted = await createSmalltable(x.cfg, {});
    try {
      assert.equal(restarted.getRoom().tokens[0].x, 1001);
      assert.equal(restarted.getRoom().rolls.length, 255);
    } finally {
      await restarted.close();
    }
  } finally {
    await x.cleanup();
  }
});

test('movement publishes intermediate positions across throttle windows and accepts final placement within the window', async () => {
  const x = await setup();
  try {
    const dm = await x.peer(),
      observer = await x.peer();
    dm.send({ type: 'unlock', password: 'test-dm-55' });
    await dm.wait((e) => e.type === 'snapshot' && e.dm);
    const t = makeToken();
    dm.send({ type: 'create', token: t });
    await observer.wait((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
    let mark = observer.events.length;
    dm.send({ type: 'move', id: t.id, x: 100, y: 0, final: false, epoch: 0 });
    await observer.wait((e) => e.type === 'token' && e.token.x === 100, mark);
    await delay(110);
    mark = observer.events.length;
    dm.send({ type: 'move', id: t.id, x: 200, y: 0, final: false, epoch: 0 });
    await observer.wait((e) => e.type === 'token' && e.token.x === 200, mark);
    // Same socket preserves command order: burst updates should be suppressed,
    // while the final command bypasses the same throttle window.
    mark = observer.events.length;
    for (let i = 0; i < 12; i++)
      dm.send({ type: 'move', id: t.id, x: 300 + i, y: 0, final: false, epoch: 0 });
    dm.send({ type: 'move', id: t.id, x: 500, y: 0, final: true, epoch: 0 });
    await observer.wait((e) => e.type === 'token' && e.token.x === 500, mark);
    const updates = observer.events.slice(mark).filter((e) => e.type === 'token');
    assert.ok(updates.length <= 2, `unexpected burst broadcasts: ${updates.length}`);
    assert.equal(x.service.getRoom().tokens[0].x, 500);
  } finally {
    await x.cleanup();
  }
});
