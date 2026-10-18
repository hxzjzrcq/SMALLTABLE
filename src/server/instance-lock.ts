import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

/** Kernel-owned endpoint: a crash releases ownership without stale-file deletion races.
 * All cooperating processes must use the same host and OS namespace, with local storage.
 */
export async function lockDataDirectory(dir: string) {
  await mkdir(dir, { recursive: true });
  const resolved = await realpath(dir);
  const canonical = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const key = createHash('sha256').update(canonical).digest('hex');
  // One fixed endpoint per canonical directory; never fall back to another port.
  // Keep it below the usual Windows/Linux ephemeral port ranges.
  const endpoint = {
    host: '127.0.0.1',
    port: 10000 + (parseInt(key.slice(0, 8), 16) % 20000),
    exclusive: true,
  };
  const guard = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        guard.off('listening', ready);
        reject(error);
      };
      const ready = () => {
        guard.off('error', failed);
        resolve();
      };
      guard.once('error', failed);
      guard.once('listening', ready);
      guard.listen(endpoint);
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE')
      throw Error(
        `无法取得凭证锁：本机运行锁端口 ${endpoint.port} 已被占用，可能已有服务/重置程序或端口冲突`,
        { cause: error },
      );
    throw Error(`无法取得数据目录运行锁（${code ?? '未知错误'}）`, { cause: error });
  }
  let closing: Promise<void> | undefined;
  const release = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      guard.close((error) => (error ? reject(error) : resolve()));
    }));
  try {
    // 0.5.5 only: never remove a legacy PID lock while that PID is alive or unknown.
    // New versions do not create a credentials.lock file, so kernel crashes cannot
    // leave new ambiguous PID records behind. Mixed-version concurrent runs are unsupported.
    const legacy = path.join(resolved, 'credentials.lock');
    let value: string | undefined;
    try {
      value = await readFile(legacy, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (value !== undefined) {
      const pid = Number(value.trim());
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw Error(
          '旧版 credentials.lock 无法识别；确认旧服务已停止后只删除此锁文件，不要删除 credentials.json',
        );
      let dead = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') dead = true;
        else throw Error('无法确认旧版锁持有者是否退出，拒绝启动', { cause: error });
      }
      if (!dead) throw Error(`旧版凭证锁进程 ${pid} 仍存在，拒绝启动；请先停止旧服务`);
      await unlink(legacy);
    }
    // A library caller holding only this guard should not keep an idle process alive.
    guard.unref();
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
