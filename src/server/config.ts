import { logEvent } from './log.js';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_CAPABILITIES, type Capabilities } from '../shared/limits.js';
const positive = z.number().int().positive().refine(Number.isSafeInteger);
const settingsSchema = z
  .object({
    limits: z
      .object({
        players: positive.optional(),
        maps: positive.optional(),
        music: positive.optional(),
        tokens: positive.optional(),
        privateNotesBytes: positive.optional(),
        initiativeEntries: positive.optional(),
        drawings: positive.optional(),
        rollHistory: positive.optional(),
        names: positive.optional(),
      })
      .strict()
      .optional(),
    images: z
      .object({
        mapBytes: positive.optional(),
        mapPixels: positive.optional(),
        mapEdge: positive.optional(),
        tokenBytes: positive.optional(),
        tokenEdge: positive.optional(),
      })
      .strict()
      .optional(),
    resources: z
      .object({ totalBytes: positive.optional(), musicBytes: positive.optional() })
      .strict()
      .optional(),
    session: z.object({ idleMinutes: positive.optional() }).strict().optional(),
  })
  .strict();
// Conservative allowance for the schema's maximum strings/dice, including JSON escaping.
export function backupLimits(caps: Capabilities) {
  const roomBytes =
    4096 +
    caps.maxTokens * 65536 +
    caps.maxRolls * 65536 +
    caps.maxNames * 1024 +
    caps.maxInitiative * 2048 +
    caps.maxDrawings * 1024 +
    caps.maxMaps * 8192;
  // Include ZIP headers and worst-case compression overhead as well as content.
  const contentBytes = caps.resourceBytes + roomBytes;
  const bytes =
    contentBytes + Math.ceil(contentBytes / 1000) + (caps.maxTokens + caps.maxMaps + 1) * 512;
  const entries = caps.maxTokens + caps.maxMaps + 1;
  if (
    ![roomBytes, bytes, entries, caps.idleMs, caps.tokenEdge ** 2, caps.maxMusic * 8192].every(
      Number.isSafeInteger,
    )
  )
    throw Error('配置过大，派生预算超出安全整数范围');
  return { bytes, entries, roomBytes };
}
const legacySettings = {
  MAX_SEATS: 'limits.players',
  IDLE_MINUTES: 'session.idleMinutes',
  MAP_BYTES: 'images.mapBytes',
  MAP_PIXELS: 'images.mapPixels',
  MAP_EDGE: 'images.mapEdge',
  TOKEN_BYTES: 'images.tokenBytes',
  TOKEN_EDGE: 'images.tokenEdge',
};
function loadConfig(file: string) {
  const legacy = Object.keys(legacySettings).filter((key) => process.env[key] !== undefined);
  if (legacy.length)
    throw Error(
      '旧限额环境变量须迁移到 smalltable.config.json 后移除: ' +
        legacy
          .map((key) => key + ' → ' + legacySettings[key as keyof typeof legacySettings])
          .join(', '),
    );
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code !== 'ENOENT' ||
      process.env.SMALLTABLE_CONFIG ||
      file !== 'smalltable.config.json'
    )
      throw Error(`无法读取配置 ${file}: ${(e as Error).message}`);
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw Error(`配置 ${file} 无效: ${parsed.error.message}`);
  const { limits = {}, images = {}, resources = {}, session = {} } = parsed.data;
  const caps: Capabilities = { ...DEFAULT_CAPABILITIES, ...images };
  const keys = {
    players: 'maxSeats',
    maps: 'maxMaps',
    music: 'maxMusic',
    tokens: 'maxTokens',
    privateNotesBytes: 'maxNotesBytes',
    initiativeEntries: 'maxInitiative',
    drawings: 'maxDrawings',
    rollHistory: 'maxRolls',
    names: 'maxNames',
  } as const;
  for (const key of Object.keys(keys) as (keyof typeof keys)[])
    if (limits[key] !== undefined) caps[keys[key]] = limits[key]!;
  if (session.idleMinutes !== undefined) caps.idleMs = session.idleMinutes * 60000;
  if (resources.totalBytes !== undefined) caps.resourceBytes = resources.totalBytes;
  if (resources.musicBytes !== undefined) caps.musicBytes = resources.musicBytes;
  backupLimits(caps);
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('无效配置 PORT');
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port,
    dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    caps,
  };
}
export function config(file = process.env.SMALLTABLE_CONFIG ?? 'smalltable.config.json') {
  try {
    return loadConfig(file);
  } catch (error) {
    logEvent('config.load_failed', { error });
    throw error;
  }
}
export type Config = ReturnType<typeof config>;
