import { existsSync } from 'node:fs';
import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { CredentialStore } from '../src/server/credentials.js';
/** Native Node terminal input: works in CMD, PowerShell and Unix TTYs; never echoes secrets. */
export function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error('请在交互式终端运行，不能通过管道输入密码');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('keypress', keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const keypress = (
      text: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean } = {},
    ) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(Error('已取消，未修改密码'));
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value);
      } else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && text && !/[\p{C}]/u.test(text)) {
        if ([...(value + text)].length > 128) {
          cleanup();
          reject(Error('密码最多 128 个字符，未修改'));
        } else value += text;
      }
    };
    process.stdin.on('keypress', keypress);
    process.stdout.write(prompt);
  });
}
export async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  console.log('SMALLTABLE 密码重置：请先停止服务。只重置密码，不修改桌面。');
  const room = await hiddenInput('新房间口令：');
  if (room !== (await hiddenInput('再次输入房间口令：'))) throw Error('两次房间口令不一致，未修改');
  const dm = await hiddenInput('新 DM 密码：');
  if (dm !== (await hiddenInput('再次输入 DM 密码：'))) throw Error('两次 DM 密码不一致，未修改');
  await CredentialStore.reset(path.resolve(process.env.DATA_DIR ?? 'data'), room, dm);
  console.log('密码已重置。现在可以启动服务；环境中的旧初始密码不会覆盖此次重置。');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error('密码重置失败：' + (error instanceof Error ? error.message : '未知错误'));
    process.exitCode = 1;
  });
}
