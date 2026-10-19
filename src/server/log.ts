/** Small, fixed-schema operational logs. Never serialize errors, requests or room data. */
export const LOG_LEVELS = {
  'process.starting': 'info',
  'process.started': 'info',
  'process.stopping': 'info',
  'process.stopped': 'info',
  'process.startup_failed': 'fatal',
  'process.shutdown_failed': 'error',
  'process.uncaught_exception': 'fatal',
  'process.unhandled_rejection': 'fatal',
  'process.abnormal_exit': 'fatal',
  'server.error': 'error',
  'config.load_failed': 'error',
  'auth.login_failed': 'warn',
  'auth.dm_failed': 'warn',
  'rate_limit.triggered': 'warn',
  'storage.save_failed': 'error',
  'storage.load_failed': 'error',
  'backup.create_failed': 'error',
  'backup.restore_failed': 'error',
  'image.process_failed': 'error',
  'websocket.error': 'error',
  'websocket.rejected': 'warn',
} as const;

type LogEvent = keyof typeof LOG_LEVELS;
const scopes = new Set(['login', 'dm', 'password_change', 'upload', 'ws', 'roll']);
const reasons = new Set([
  'invalid_credentials',
  'capacity',
  'credentials_changed',
  'denied',
  'binary',
  'invalid_command',
  'slow_client',
  'heartbeat',
]);
const errorCodes = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOSPC',
  'EIO',
  'EROFS',
  'EISDIR',
  'ENOTDIR',
  'EMFILE',
  'ENFILE',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_HTTP_SERVER_CLOSED',
  'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
  'WS_ERR_INVALID_UTF8',
  'WS_ERR_UNEXPECTED_RSV_1',
  'WS_ERR_UNEXPECTED_RSV_2_3',
]);
interface Details {
  error?: unknown;
  scope?: 'login' | 'dm' | 'password_change' | 'upload' | 'ws' | 'roll';
  reason?:
    | 'invalid_credentials'
    | 'capacity'
    | 'credentials_changed'
    | 'denied'
    | 'binary'
    | 'invalid_command'
    | 'slow_client'
    | 'heartbeat';
  exitCode?: number;
  port?: number;
  signal?: 'SIGTERM' | 'SIGINT';
}

export function logEvent(event: LogEvent, details: Details = {}) {
  // Logging is best effort: a broken sink must not change a business operation's result.
  try {
    if (!Object.hasOwn(LOG_LEVELS, event)) return;
    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level: LOG_LEVELS[event],
      event,
    };
    if (event === 'process.started') record.message = 'SMALLTABLE: service ready';
    if (scopes.has(details.scope!)) record.scope = details.scope;
    if (reasons.has(details.reason!)) record.reason = details.reason;
    if (details.signal === 'SIGTERM' || details.signal === 'SIGINT') record.signal = details.signal;
    if (Number.isInteger(details.exitCode) && details.exitCode! >= 0 && details.exitCode! <= 255)
      record.exitCode = details.exitCode;
    if (Number.isInteger(details.port) && details.port! >= 1 && details.port! <= 65535)
      record.port = details.port;
    // Even error.code is untrusted. Only known operational codes are useful here.
    const code = (details.error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code === 'string' && errorCodes.has(code)) record.code = code;
    const line = JSON.stringify(record);
    if (record.level === 'info') console.log(line);
    else console.error(line);
  } catch {
    /* Do not retry a failing log sink or dump its exception. */
  }
}

/** Install only in the executable entry point, never when importing a service in tests. */
export function installProcessLogging() {
  process.on('uncaughtException', (error) => {
    logEvent('process.uncaught_exception', { error });
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    logEvent('process.unhandled_rejection', { error });
    process.exit(1);
  });
  process.on('exit', (exitCode) => {
    if (exitCode !== 0) logEvent('process.abnormal_exit', { exitCode });
  });
}
