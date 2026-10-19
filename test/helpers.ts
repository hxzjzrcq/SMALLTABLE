import { openSmalltable } from '../src/server/bootstrap';
import type { Config } from '../src/server/config';
import { Storage } from '../src/server/storage';
import { backupLimits } from '../src/server/config';
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
