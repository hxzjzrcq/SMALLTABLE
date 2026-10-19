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
async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { config } = await import('./config.js');
  const { openSmalltable } = await import('./bootstrap.js');
  const cfg = config();
  const service = await openSmalltable(cfg, {
    roomPassword: process.env.ROOM_PASSWORD,
    dmPassword: process.env.DM_PASSWORD,
  });
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= service.close());
  const onSignal = () => {
    void stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('停止服务失败：', error instanceof Error ? error.message : '未知错误');
        process.exit(1);
      });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    await listen(service.server, cfg.port, cfg.host);
  } catch (error) {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    // Keep the original bind error as the primary diagnostic even if cleanup fails.
    try {
      await stop();
    } catch (cleanup) {
      console.error(
        '启动失败后的清理失败：',
        cleanup instanceof Error ? cleanup.message : '未知错误',
      );
    }
    throw error;
  }
  service.server.on('error', (error) => {
    console.error('服务器运行错误：', error.message);
    void stop().finally(() => process.exit(1));
  });
  console.log(`SMALLTABLE: http://${cfg.host}:${cfg.port}`);
}
main().catch((error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  console.error(
    `启动失败${code ? ' [' + code + ']' : ''}：${error instanceof Error ? error.message : '未知错误'}`,
  );
  process.exitCode = 1;
});
