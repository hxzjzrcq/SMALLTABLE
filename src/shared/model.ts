import { z } from 'zod';
export const SCHEMA_VERSION = 2 as const;
export const bytes = (s: string) => new TextEncoder().encode(s).length;
export const text = (max: number) => z.string().refine((s) => bytes(s) <= max, '文字超过字节上限');
export const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
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
export const mapSchema = z
  .object({
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
export const roomSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    map: mapSchema.nullable(),
    grid: gridSchema,
    tokens: z.array(tokenSchema).max(255),
    names: z.array(text(128)).min(1).max(255),
    rolls: z.array(rollSchema).max(255),
    initiative: z.array(initiativeEntrySchema).max(255),
    initiativeAscending: z.boolean(),
    drawings: z.array(drawingSchema).max(255),
  })
  .strict()
  .refine((s) => new Set(s.tokens.map((t) => t.id)).size === s.tokens.length, '棋子 ID 重复')
  .refine(
    (s) => new Set(s.initiative.map((t) => t.id)).size === s.initiative.length,
    '先攻条目 ID 重复',
  )
  .refine((s) => new Set(s.drawings.map((t) => t.id)).size === s.drawings.length, '线条 ID 重复');
// Explicit migration: validate the old schema strictly before supplying new fields.
const legacyRoomSchema = z
  .object({ ...roomSchema.shape })
  .omit({ initiative: true, initiativeAscending: true, drawings: true })
  .strict()
  .extend({ schemaVersion: z.literal(1) })
  .refine((s) => new Set(s.tokens.map((t) => t.id)).size === s.tokens.length);
export function parseRoom(input: unknown): Room {
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 1) {
    return roomSchema.parse({
      ...legacyRoomSchema.parse(input),
      schemaVersion: 2,
      initiative: [],
      initiativeAscending: false,
      drawings: [],
    });
  }
  return roomSchema.parse(input);
}
export type Room = z.infer<typeof roomSchema>;
export type View = Omit<Room, 'tokens'> & { tokens: PublicToken[] };
export const initialRoom = (): Room => ({
  schemaVersion: 2,
  revision: 0,
  map: null,
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
export const commandSchema = z.discriminatedUnion('type', [
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
  z.object({ type: z.literal('create'), token: tokenSchema }),
  z.object({ type: z.literal('edit'), token: tokenSchema }),
  z.object({ type: z.literal('delete'), id: z.string().uuid() }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('grid'), grid: gridSchema }),
  z.object({ type: z.literal('names'), names: z.array(text(128)).min(1).max(255) }),
]);
export type Command = z.infer<typeof commandSchema>;
export type ServerEvent =
  | { type: 'snapshot'; room: View; dm: boolean; epoch: number }
  | { type: 'token'; token: PublicToken; revision: number; epoch: number }
  | { type: 'presence'; count: number; max: number }
  | { type: 'saved'; revision: number }
  | { type: 'error'; message: string }
  | { type: 'idle'; seconds: number };
export type Capabilities = {
  maxSeats: number;
  maxTokens: number;
  maxNotesBytes: number;
  mapBytes: number;
  mapPixels: number;
  mapEdge: number;
  tokenBytes: number;
  tokenEdge: number;
  idleMs: number;
  dndrollUrl: string;
};
