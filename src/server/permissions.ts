import type { Command } from '../shared/model.js';
type Role = 'player' | 'dm';
type Principal = { dm: boolean };
export const WS_PERMISSIONS = {
  activity: 'player',
  unlock: 'player',
  lock: 'player',
  move: 'player',
  rotate: 'player',
  note: 'player',
  roll: 'player',
  'initiative.put': 'player',
  'initiative.delete': 'player',
  'initiative.order': 'player',
  'drawing.add': 'player',
  'drawing.delete': 'player',
  'drawing.clear': 'dm',
  create: 'dm',
  edit: 'dm',
  delete: 'dm',
  clear: 'dm',
  grid: 'dm',
  names: 'dm',
} as const satisfies Record<Command['type'], Role>;
export const HTTP_PERMISSIONS = {
  'GET /api/config': 'public',
  'POST /api/login': 'public',
  'GET /media/:id': 'session',
  'GET /api/health': 'session',
  'GET /api/backup': 'dm',
  'POST /api/restore': 'dm',
  'POST /api/image/:kind': 'dm',
  'POST /api/passwords': 'dm',
} as const;
export type HttpOperation = keyof typeof HTTP_PERMISSIONS;
export function canCommand(principal: Principal, action: string): boolean {
  if (!Object.hasOwn(WS_PERMISSIONS, action)) return false;
  return WS_PERMISSIONS[action as Command['type']] === 'player' || principal.dm;
}
export function canHttp(principal: Principal | undefined, operation: string): boolean {
  if (!Object.hasOwn(HTTP_PERMISSIONS, operation)) return false;
  const required = HTTP_PERMISSIONS[operation as HttpOperation];
  return required === 'public' || (!!principal && (required === 'session' || principal.dm));
}
