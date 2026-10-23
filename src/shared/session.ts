/** Display names are transient; never use them as authentication credentials. */
export function temporaryId(value: unknown) {
  let units = 0;
  if (typeof value !== 'string') return { units, valid: false };
  for (const char of value) {
    if (/^[A-Za-z0-9]$/.test(char)) units++;
    else if (/^\p{Unified_Ideograph}$/u.test(char)) units += 2;
    else return { units, valid: false };
  }
  return { units, valid: units >= 1 && units <= 16 };
}
export type OnlinePlayer = { target: string; name: string; dm: boolean };
export type SessionCode =
  | 'EXPIRED'
  | 'PLAYER_FULL'
  | 'DM_FULL'
  | 'DEMOTION_FULL'
  | 'ID_CONFLICT'
  | 'INVALID_ID'
  | 'CREDENTIALS_CHANGED'
  | 'INVALID_PASSWORD'
  | 'RATE_LIMIT'
  | 'KICKED'
  | 'REPLACED'
  | 'LOGGED_OUT';
export const SESSION_CLOSE = {
  EXPIRED: 4001,
  CREDENTIALS_CHANGED: 4003,
  KICKED: 4004,
  REPLACED: 4005,
  PLAYER_FULL: 4006,
  DM_FULL: 4010,
  DEMOTION_FULL: 4011,
  ID_CONFLICT: 4007,
  LOGGED_OUT: 4009,
} as const;
export class SessionError extends Error {
  constructor(
    public code: SessionCode,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
