import { waitEvent } from '../helpers';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createSmalltable } from '../helpers';
import { config } from '../../src/server/config';
import { type Capabilities, type ServerEvent } from '../../src/shared/model';
import { DEFAULT_CAPABILITIES } from '../../src/shared/limits';

export const roomPassword = 'Room-Release-060',
  dmPassword = 'Keeper-Release-060';

export const token = () => ({
  id: randomUUID(),
  name: 'A',
  label: '',
  shape: 'circle' as const,
  color: '#123456',
  x: 0,
  y: 0,
  size: 1,
  angle: 0,
  asset: null as string | null,
  note: '',
  secret: 'DM-private-060',
});

export const drawing = () => ({
  id: randomUUID(),
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  color: '#202b36' as const,
});

export async function fixture(caps: Capabilities = DEFAULT_CAPABILITIES) {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-release-'));
  const cfg = { ...config(), dataDir: dir, caps };
  const service = await createSmalltable(cfg, { roomPassword, dmPassword });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  async function peer() {
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: roomPassword }),
    });
    assert.equal(login.status, 200);
    const { token: session } = await login.json();
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', session]);
    sockets.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    async function until(predicate: (event: ServerEvent) => boolean, mark = 0) {
      return waitEvent(events, predicate, mark);
    }
    await until((e) => e.type === 'snapshot');
    const send = (c: unknown) => ws.send(JSON.stringify(c));
    return {
      ws,
      events,
      until,
      send,
      session,
      headers: { Authorization: 'Bearer ' + session },
      async unlock() {
        send({ type: 'unlock', password: dmPassword });
        await until((e) => e.type === 'snapshot' && e.dm);
      },
    };
  }
  return {
    dir,
    cfg,
    service,
    url,
    peer,
    async close() {
      for (const ws of sockets) ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
