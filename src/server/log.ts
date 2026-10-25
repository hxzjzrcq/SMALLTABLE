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
  'resource.cleanup_failed': 'error',
  'music.failed': 'error',
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
/** Keep a bounded diagnostic, without quoted input, credentials or multiline payloads. */
function diagnostic(text: string) {
  return text
    .replace(/\b(?:authorization|(?:set-)?cookie)\s*[:=]\s*[^\r\n]+/gi, '[redacted header]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:password|passwd|token|secret|session(?:id)?|tt_room|dmPrivate|privateNotes?|note|密码|口令|令牌|私有说明|私人笔记)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\\r\n])*`/g, '[quoted]')
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>:,;]+/g, '[path]')
    .replace(/\b[a-f0-9]{48,}\b/gi, '[redacted id]')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 512);
}
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
    const error = details.error;
    if (error !== undefined) {
      // Only scalar diagnostic fields; never stringify unknown objects, stack or cause.
      const fields =
        error !== null && typeof error === 'object'
          ? (error as { name?: unknown; message?: unknown; code?: unknown })
          : undefined;
      record.errorType = diagnostic(typeof fields?.name === 'string' ? fields.name : typeof error);
      const message = fields ? fields.message : error;
      if (typeof message === 'string') record.errorMessage = diagnostic(message);
      else if (message === null || typeof message === 'number' || typeof message === 'boolean')
        record.errorMessage = String(message);
      if (typeof fields?.code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(fields.code))
        record.code = diagnostic(fields.code);
    }
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
