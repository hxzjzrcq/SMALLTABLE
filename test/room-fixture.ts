import { sessionBody } from './helpers';
let loginSequence068 = 0;
import { waitEvent, createSmalltable } from './helpers';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { config } from '../src/server/config';
import { ServerEvent } from '../src/shared/model';

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Peer {
  events: ServerEvent[] = [];
  ws: WebSocket;
  token: string;
  constructor(url: string, token: string) {
    this.token = token;
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    this.ws.on('message', (d) => this.events.push(JSON.parse(d.toString())));
    this.ws.on('error', () => {});
  }
  send(c: unknown) {
    this.ws.send(JSON.stringify(c));
  }
  async wait(predicate: (e: ServerEvent) => boolean, after = 0) {
    return waitEvent(this.events, predicate, after);
  }
}

export async function roomFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabletop-'));
  const cfg = { ...config(), dataDir: dir };
  const service = await createSmalltable(cfg, {
    roomPassword: 'test-room',
    dmPassword: 'test-dm-55',
  });
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  const port = (service.server.address() as { port: number }).port,
    url = `http://127.0.0.1:${port}`;
  const peers: Peer[] = [];
  async function login(address = url) {
    const res = await fetch(address + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-room', name: 'U' + ++loginSequence068 }),
    });
    return { res, body: await sessionBody(res) };
  }
  async function peer() {
    const { res, body } = await login();
    assert.equal(res.status, 200);
    const p = new Peer(url, body.token);
    peers.push(p);
    await p.wait((e) => e.type === 'snapshot');
    return p;
  }
  return {
    dir,
    cfg,
    service,
    url,
    peer,
    login,
    trackPeer: (p: Peer) => peers.push(p),
    async cleanup() {
      for (const p of peers) p.ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const makeToken = () => ({
  id: randomUUID(),
  name: '骷髅',
  hidden: false,
  label: '1',
  shape: 'circle' as const,
  color: '#3872a4',
  x: 64,
  y: 64,
  size: 1,
  angle: 0,
  asset: null,
  note: '公开',
  secret: '只给 DM 的秘密',
});
