import { z } from 'zod';
import { DEFAULT_CAPABILITIES, type Capabilities } from './limits.js';
export type { Capabilities } from './limits.js';
export const SCHEMA_VERSION = 3 as const;
export const bytes = (s: string) => new TextEncoder().encode(s).length;
export const text = (max: number) => z.string().refine((s) => bytes(s) <= max, '文字超过字节上限');
export const WORLD_LIMIT = 32768;
export const coordinate = z.number().finite().min(-WORLD_LIMIT).max(WORLD_LIMIT);
export const assetId = z.string().regex(/^[a-f0-9]{64}\.webp$/);
export const tokenSchema = z
  .object({
    id: z.string().uuid(),
    name: text(128),
    label: text(32),
    shape: z.enum(['circle', 'square']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    x: coordinate,
    y: coordinate,
    size: z
      .number()
      .min(1 / 16)
      .max(4),
    angle: z.number().finite().min(-3600).max(3600),
    asset: assetId.nullable(),
    note: text(4096),
    secret: text(4096),
  })
  .strict();
export type Token = z.infer<typeof tokenSchema>;
export type PublicToken = Omit<Token, 'secret'> & { secret?: string };
export const gridSchema = z
  .object({ cell: z.number().min(4).max(2048), x: coordinate, y: coordinate, visible: z.boolean() })
  .strict();
export const backgroundScale = z.number().int().min(10).max(300).multipleOf(10);
export const mapSchema = z
  .object({
    id: z.string().uuid(),
    name: text(1024),
    scale: backgroundScale,
    asset: assetId,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const rollSchema = z
  .object({
    id: z.string().uuid(),
    name: text(128),
    expression: z.string().max(128),
    dice: z
      .array(
        z
          .object({
            sign: z.union([z.literal(1), z.literal(-1)]),
            sides: z.number().int().min(2).max(1000),
            values: z.array(z.number().int().min(1).max(1000)).max(100),
          })
          .strict(),
      )
      .max(100),
    result: z.number().int().refine(Number.isSafeInteger),
    time: z.string().datetime(),
  })
  .strict();
export type Roll = z.infer<typeof rollSchema>;
export const initiativeEntrySchema = z
  .object({
    id: z.string().uuid(),
    name: text(128).refine((s) => s.trim().length > 0, '请输入名字'),
    value: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();
export type InitiativeEntry = z.infer<typeof initiativeEntrySchema>;
export const drawingSchema = z
  .object({
    id: z.string().uuid(),
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
    color: z.enum(['#d33b32', '#246fc2', '#2b8a50', '#9a4bb5', '#202b36']),
  })
  .strict();
export type Drawing = z.infer<typeof drawingSchema>;
export function sortInitiative(entries: InitiativeEntry[], ascending: boolean) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (ascending ? a.entry.value - b.entry.value : b.entry.value - a.entry.value) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}
export const createRoomSchema = (caps: Capabilities) =>
  z
    .object({
      schemaVersion: z.literal(SCHEMA_VERSION),
      revision: z.number().int().nonnegative(),
      maps: z
        .array(
          mapSchema
            .extend({
              width: z.number().int().positive().max(caps.mapEdge),
              height: z.number().int().positive().max(caps.mapEdge),
            })
            .refine((m) => m.width * m.height <= caps.mapPixels, '地图像素超过上限'),
        )
        .max(caps.maxMaps),
      currentMapId: z.string().uuid().nullable(),
      grid: gridSchema,
      tokens: z.array(tokenSchema).max(caps.maxTokens),
      names: z.array(text(128)).min(1).max(caps.maxNames),
      rolls: z.array(rollSchema).max(caps.maxRolls),
      initiative: z.array(initiativeEntrySchema).max(caps.maxInitiative),
      initiativeAscending: z.boolean(),
      drawings: z.array(drawingSchema).max(caps.maxDrawings),
    })
    .strict()
    .refine((s) => new Set(s.maps.map((m) => m.id)).size === s.maps.length, '地图 ID 重复')
    .refine(
      (s) =>
        s.maps.length ? s.maps.some((m) => m.id === s.currentMapId) : s.currentMapId === null,
      '当前地图无效',
    )
    .refine((s) => new Set(s.tokens.map((t) => t.id)).size === s.tokens.length, '棋子 ID 重复')
    .refine(
      (s) => new Set(s.initiative.map((t) => t.id)).size === s.initiative.length,
      '先攻条目 ID 重复',
    )
    .refine((s) => new Set(s.drawings.map((t) => t.id)).size === s.drawings.length, '线条 ID 重复');
export const roomSchema = createRoomSchema(DEFAULT_CAPABILITIES);
export function parseRoom(input: unknown, caps: Capabilities = DEFAULT_CAPABILITIES): Room {
  if (
    !input ||
    typeof input !== 'object' ||
    !('schemaVersion' in input) ||
    input.schemaVersion !== SCHEMA_VERSION
  )
    throw Error('不兼容的房间 schema，要求版本 3；不执行迁移');
  return createRoomSchema(caps).parse(input);
}
export type Room = z.infer<typeof roomSchema>;
export type View = Omit<Room, 'tokens'> & { tokens: PublicToken[] };
export const initialRoom = (): Room => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  maps: [],
  currentMapId: null,
  grid: { cell: 64, x: 0, y: 0, visible: true },
  tokens: [],
  names: ['天意爷'],
  rolls: [],
  initiative: [],
  initiativeAscending: false,
  drawings: [],
});
export const publicToken = (t: Token, dm: boolean): PublicToken => {
  if (dm) return { ...t };
  const { secret, ...rest } = t;
  return rest;
};
export const project = (room: Room, dm: boolean): View => ({
  ...room,
  tokens: room.tokens.map((t) => publicToken(t, dm)),
});
export const measure = (a: { x: number; y: number }, b: { x: number; y: number }, cell: number) =>
  Math.round(Math.hypot(b.x - a.x, b.y - a.y) / cell);
export const createCommandSchema = (caps: Capabilities) =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('initiative.put'),
        entry: initiativeEntrySchema,
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('initiative.delete'),
        id: z.string().uuid(),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('initiative.order'),
        ascending: z.boolean(),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('drawing.add'),
        drawing: drawingSchema,
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal('drawing.delete'),
        id: z.string().uuid(),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ type: z.literal('drawing.clear'), epoch: z.number().int().nonnegative() }).strict(),
    z.object({ type: z.literal('map.select'), id: z.string().uuid() }).strict(),
    z.object({ type: z.literal('map.delete'), id: z.string().uuid() }).strict(),
    z
      .object({ type: z.literal('map.scale'), id: z.string().uuid(), scale: backgroundScale })
      .strict(),
    z.object({ type: z.literal('music.play'), id: z.string().uuid() }).strict(),
    z.object({ type: z.literal('music.pause') }).strict(),
    z.object({ type: z.literal('music.stop') }).strict(),
    z.object({ type: z.literal('music.delete'), id: z.string().uuid() }).strict(),
    z.object({ type: z.literal('activity') }),
    z.object({
      type: z.literal('move'),
      id: z.string().uuid(),
      x: coordinate,
      y: coordinate,
      final: z.boolean(),
      epoch: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal('rotate'),
      id: z.string().uuid(),
      angle: z.number().finite().min(-3600).max(3600),
      epoch: z.number().int().nonnegative(),
    }),
    z
      .object({
        type: z.literal('note'),
        id: z.string().uuid(),
        note: text(4096),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ type: z.literal('roll'), expression: z.string().max(128), name: text(128) }),
    z.object({ type: z.literal('unlock'), password: z.string().max(1024) }),
    z.object({ type: z.literal('lock') }),
    z.object({
      type: z.literal('create'),
      token: tokenSchema,
      uploadId: z.string().uuid().optional(),
    }),
    z.object({
      type: z.literal('edit'),
      token: tokenSchema,
      uploadId: z.string().uuid().optional(),
    }),
    z.object({ type: z.literal('delete'), id: z.string().uuid() }),
    z
      .object({
        type: z.literal('delete.many'),
        ids: z
          .array(z.string().uuid())
          .min(1)
          .max(caps.maxTokens)
          .refine((ids) => new Set(ids).size === ids.length, '棋子 ID 重复'),
        epoch: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ type: z.literal('clear') }),
    z.object({ type: z.literal('grid'), grid: gridSchema }),
    z.object({ type: z.literal('names'), names: z.array(text(128)).min(1).max(caps.maxNames) }),
  ]);
export const commandSchema = createCommandSchema(DEFAULT_CAPABILITIES);
export type Command = z.infer<typeof commandSchema>;
export type ServerEvent =
  | { type: 'snapshot'; room: View; dm: boolean; epoch: number; caps?: Capabilities }
  | { type: 'token'; token: PublicToken; revision: number; epoch: number }
  | { type: 'music'; music: import('./music.js').MusicSnapshot; acceptedPushId?: string }
  | { type: 'presence'; count: number; max: number }
  | { type: 'saved'; revision: number }
  | { type: 'error'; message: string }
  | { type: 'idle'; seconds: number };
