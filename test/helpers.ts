import { openSmalltable } from '../src/server/bootstrap';
import { Config, backupLimits } from '../src/server/config';
import { Storage } from '../src/server/storage';
import { parseRoom } from '../src/shared/model';

export const createSmalltable = (
  cfg: Config,
  initial: { roomPassword?: string; dmPassword?: string } = {
    roomPassword: process.env.ROOM_PASSWORD,
    dmPassword: process.env.DM_PASSWORD,
  },
) => openSmalltable(cfg, initial);

export function testStorage(cfg: Config) {
  const { mapBytes, mapPixels, mapEdge, tokenBytes, tokenEdge } = cfg.caps;
  return new Storage({
    dataDir: cfg.dataDir,
    images: { mapBytes, mapPixels, mapEdge, tokenBytes, tokenEdge },
    backup: backupLimits(cfg.caps),
    parse: (input) => parseRoom(input, cfg.caps),
  });
}

export async function waitEvent<T>(
  events: T[],
  predicate: (event: T) => boolean,
  after = 0,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = events.slice(after).find(predicate);
    if (event !== undefined) return event;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('Timed out waiting for event: ' + JSON.stringify(events.slice(-2)));
}
