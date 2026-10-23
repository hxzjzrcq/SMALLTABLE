import { createSmalltable } from '../helpers';
import { waitEvent } from '../helpers';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { type ServerEvent } from '../../src/shared/model';

export const token = (asset: string | null = null) => ({
  id: randomUUID(),
  name: 'A',
  hidden: false,
  label: '1',
  shape: 'circle' as const,
  color: '#000000',
  x: 0,
  y: 0,
  size: 1,
  angle: 0,
  asset,
  note: '',
  secret: '',
});

export const drawing = () => ({
  id: randomUUID(),
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  color: '#202b36' as const,
});

export const roll = () => ({
  id: randomUUID(),
  name: 'A',
  expression: 'd6',
  dice: [],
  result: 1,
  time: new Date().toISOString(),
});

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Peer {
  events: ServerEvent[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.events.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
  }
  async until(predicate: (e: ServerEvent) => boolean, after = 0) {
    return waitEvent(this.events, predicate, after);
  }
  send(c: unknown) {
    this.ws.send(JSON.stringify(c));
  }
}
export const createLimitsRoom = (cfg: import('../../src/server/config').Config) =>
  createSmalltable(cfg, { roomPassword: 'test-room', dmPassword: 'test-dm-55' });
