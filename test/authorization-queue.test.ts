import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initialRoom } from '../src/shared/model';
import { dmPassword, fixture } from './support/management-fixture';

for (const revoke of ['lock', 'disconnect', 'password'] as const)
  test(
    `queued HTTP and WS management is rejected after ${revoke} revocation`,
    { timeout: 15000 },
    async () => {
      const f = await fixture({ ...DEFAULT_CAPABILITIES, maxDMs: 2 });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const started = new Promise<void>((r) => (entered = r));
      const original = f.service.storage.backup.bind(f.service.storage);
      try {
        const a = await f.peer(),
          b = await f.peer();
        await a.unlock();
        await b.unlock();
        const before = f.service.getRoom();
        const oldCredentials = await readFile(path.join(f.dir, 'credentials.json'), 'utf8');
        const zip = await original(initialRoom());
        f.service.storage.backup = async (room) => {
          entered();
          await gate;
          return original(room);
        };
        const blocking = fetch(f.url + '/api/backup', { headers: b.headers });
        await started;
        if (revoke === 'lock') {
          a.send({ type: 'lock' });
          const pong = once(a.ws, 'pong');
          a.ws.ping();
          await pong;
        }
        let rotate: Promise<Response> | undefined;
        // Observe real HTTP arrival while the queue is blocked. The server has run the first authorization check.
        let rotateResult: Promise<Response> | undefined;
        if (revoke === 'password') {
          const arrived = new Promise<void>((resolve) => {
            const handler = (req: import('node:http').IncomingMessage) => {
              if (req.url === '/api/passwords') {
                f.service.server.off('request', handler);
                resolve();
              }
            };
            f.service.server.on('request', handler);
          });
          rotate = fetch(f.url + '/api/passwords', {
            method: 'POST',
            headers: { ...a.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentDMPassword: dmPassword,
              dmPassword: 'Keeper-Release-Next',
            }),
          });
          await arrived;
          // Body parsing finishes asynchronously; its end listener runs after Express registered its parser.
          await new Promise((r) => setTimeout(r, 20));
          rotateResult = rotate;
        }
        const pending: Promise<Response>[] = [];
        for (const [method, route, body, content] of [
          ['GET', '/api/backup', undefined, undefined],
          ['POST', '/api/restore', new Uint8Array(zip), 'application/zip'],
          ['POST', '/api/image/token', new Uint8Array([0]), 'application/octet-stream'],
          [
            'POST',
            '/api/music',
            new Uint8Array(await readFile(new URL('./fixtures/tone.mp3', import.meta.url))),
            'application/octet-stream',
          ],
          [
            'POST',
            '/api/upload/cancel',
            JSON.stringify({ uploadId: '00000000-0000-4000-8000-000000000001' }),
            'application/json',
          ],
          [
            'POST',
            '/api/passwords',
            JSON.stringify({
              currentDMPassword: dmPassword,
              roomPassword: 'Room-Unauthorized-Next',
            }),
            'application/json',
          ],
        ] as const) {
          const arrived = new Promise<void>((resolve) => {
            const handler = (req: import('node:http').IncomingMessage) => {
              if (req.url === route) {
                f.service.server.off('request', handler);
                resolve();
              }
            };
            f.service.server.on('request', handler);
          });
          pending.push(
            fetch(f.url + route, {
              method,
              headers: { ...a.headers, ...(content ? { 'Content-Type': content } : {}) },
              body,
            }),
          );
          await arrived;
        }
        const managementMark = a.events.length;
        a.send({ type: 'map.select', id: '00000000-0000-4000-8000-000000000001' });
        a.send({ type: 'map.scale', id: '00000000-0000-4000-8000-000000000001', scale: 100 });
        a.send({ type: 'map.delete', id: '00000000-0000-4000-8000-000000000001' });
        a.send({ type: 'music.play', id: '00000000-0000-4000-8000-000000000001' });
        a.send({ type: 'music.pause' });
        a.send({ type: 'music.stop' });
        a.send({ type: 'music.delete', id: '00000000-0000-4000-8000-000000000001' });
        a.send({ type: 'delete.many', ids: ['00000000-0000-4000-8000-000000000001'], epoch: 0 });
        a.send({ type: 'clear' });
        a.send({ type: 'player.kick', target: '00000000-0000-4000-8000-000000000001' });
        const pong = once(a.ws, 'pong');
        a.ws.ping();
        await pong;
        if (revoke === 'disconnect') {
          const closed = once(a.ws, 'close');
          a.ws.close();
          await closed;
        }
        release();
        assert.equal((await blocking).status, 200);
        if (rotateResult) assert.equal((await rotateResult).status, 200);
        const results = await Promise.all(pending);
        assert.ok(results.every((r) => r.status === 400 || r.status === 401));
        if (revoke !== 'disconnect') {
          const denied = () =>
            a.events
              .slice(managementMark)
              .filter((e) => e.type === 'error' && e.message === '操作未授权');
          await a.until((e) => e.type === 'error' && denied().length === 10, managementMark);
          assert.equal(
            denied().length,
            10,
            'all ten queued commands must reach authorization rejection',
          );
        }
        assert.deepEqual(f.service.getRoom(), before);
        if (revoke !== 'password')
          assert.equal(
            await readFile(path.join(f.dir, 'credentials.json'), 'utf8'),
            oldCredentials,
          );
        else {
          const mark = a.events.length;
          a.send({ type: 'names', names: ['revoked'] });
          await a.until((e) => e.type === 'error', mark);
          assert.deepEqual(f.service.getRoom(), before);
        }
      } finally {
        release();
        await f.close();
      }
    },
  );
