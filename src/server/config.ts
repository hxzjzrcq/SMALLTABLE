import path from 'node:path';
import type { Capabilities } from '../shared/model.js';
const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1) throw Error(`无效配置 ${name}`);
  return n;
};
export function config() {
  const roomPassword = process.env.ROOM_PASSWORD,
    dmPassword = process.env.DM_PASSWORD;
  const caps: Capabilities = {
    maxSeats: Math.min(15, envInt('MAX_SEATS', 15)),
    maxTokens: 255,
    maxNotesBytes: 65535,
    mapBytes: envInt('MAP_BYTES', 10 * 1024 * 1024),
    mapPixels: envInt('MAP_PIXELS', 16_000_000),
    mapEdge: envInt('MAP_EDGE', 8192),
    tokenBytes: envInt('TOKEN_BYTES', 128 * 1024),
    tokenEdge: envInt('TOKEN_EDGE', 256),
    idleMs: envInt('IDLE_MINUTES', 30) * 60000,
    dndrollUrl: process.env.DNDROLL_URL ?? '',
  };
  if (caps.dndrollUrl && !/^https?:\/\//.test(caps.dndrollUrl))
    throw Error('DNDROLL_URL 须为 http(s) 地址');
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: envInt('PORT', 3000),
    dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
    roomPassword,
    dmPassword,
    caps,
  };
}
export type Config = ReturnType<typeof config>;
