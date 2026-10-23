import { logEvent, installProcessLogging } from './log.js';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.off('listening', ready);
      reject(error);
    };
    const ready = () => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, host);
  });
}
installProcessLogging();
logEvent('process.starting');

async function main() {
  try {
    if (existsSync('.env')) process.loadEnvFile('.env');
  } catch (error) {
    logEvent('config.load_failed', { error });
    throw error;
  }
  const { config } = await import('./config.js');
  const { openSmalltable } = await import('./bootstrap.js');
  const cfg = config();
  const service = await openSmalltable(cfg, {
    roomPassword: process.env.ROOM_PASSWORD,
    dmPassword: process.env.DM_PASSWORD,
  });
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= service.close());
  const onSignal = (signal: 'SIGTERM' | 'SIGINT') => {
    if (stopping) return;
    logEvent('process.stopping', { signal });
    void stop()
      .then(() => {
        logEvent('process.stopped');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logEvent('process.shutdown_failed', { error });
        process.exit(1);
      });
  };
  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  try {
    await listen(service.server, cfg.port, cfg.host);
  } catch (error) {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    // Keep the original bind error as the primary diagnostic even if cleanup fails.
    try {
      await stop();
    } catch (cleanup) {
      logEvent('process.shutdown_failed', { error: cleanup });
    }
    throw error;
  }
  service.server.on('error', (error) => {
    logEvent('server.error', { error });
    void stop()
      .catch((error: unknown) => logEvent('process.shutdown_failed', { error }))
      .finally(() => process.exit(1));
  });
  logEvent('process.started', { port: cfg.port });
}
main().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith('不兼容的房间 schema'))
    console.error(
      JSON.stringify({
        code: 'SCHEMA_INCOMPATIBLE',
        message:
          '旧房间存档不兼容：0.7.2 要求 schema 4，不执行迁移；请保留旧部署及备份，使用新的数据目录。',
      }),
    );
  logEvent('process.startup_failed', { error });
  process.exitCode = 1;
});
