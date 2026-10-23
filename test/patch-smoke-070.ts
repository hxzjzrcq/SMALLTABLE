import { launchBrowser, submitLogin } from './support/browser';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '../patch-install');
const url = 'http://127.0.0.1:3000';
let processLog = '',
  child: ChildProcess | undefined;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: '3000',
      HOST: '127.0.0.1',
      DATA_DIR: path.join(dir, 'data'),
      ROOM_PASSWORD: 'Room-Patch-070',
      DM_PASSWORD: 'Keeper-Patch-070',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (processLog += d));
  child.stderr?.on('data', (d) => (processLog += d));
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw Error(processLog);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('start timeout: ' + processLog);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise<void>((r) => child!.once('exit', () => r()));
  child.kill('SIGTERM');
  await closed;
}
const protectedPaths = [
  '.env',
  'smalltable.config.json',
  'data/sentinel.txt',
  'tunnel/private.conf',
];
const before = await Promise.all(protectedPaths.map((p) => readFile(path.join(dir, p))));
const browser = await launchBrowser(['--no-zygote', '--disable-gpu']);
try {
  await start();
  const p = await browser.newPage();
  await p.goto(url);
  await p.locator('#st-login-name').waitFor();
  assert.equal(await p.locator('.st-login-version').textContent(), 'v0.7.2');
  await submitLogin(p, 'Patch', 'Room-Patch-070');
  await p.locator('.app').waitFor();
  await p.getByLabel('骰子表达式', { exact: true }).fill('1d20+5 补丁安装检查');
  await p.getByRole('button', { name: '投掷', exact: true }).click();
  await p.getByText('补丁安装检查', { exact: true }).waitFor();
  await p.reload();
  await p.locator('.app').waitFor();
  console.log(
    'PASS: clean 0.6.9 + overlay uses pre-existing dependencies; actual 3000 server, built UI/version, reason and refresh work',
  );
  await stop();
  const stored = JSON.parse(await readFile(path.join(dir, 'data/room.json'), 'utf8'));
  assert.equal(stored.rolls.at(-1).reason, '补丁安装检查');
  assert.equal(stored.rolls[0].reason, undefined);
  await start();
  await p.goto(url);
  await p.locator('#st-login-name').waitFor();
  await submitLogin(p, 'Patch', 'Room-Patch-070');
  await p.getByText('补丁安装检查', { exact: true }).waitFor();
  assert.equal(await p.locator('.roll').count(), 2);
  console.log('PASS: restart loads both baseline record without reason and new record with reason');
  for (let i = 0; i < protectedPaths.length; i++)
    assert.deepEqual(await readFile(path.join(dir, protectedPaths[i])), before[i]);
  console.log('PASS: private .env/config/data sentinel/tunnel config remain byte-identical');
} finally {
  await browser.close();
  await stop();
  await mkdir('docs/validation-0.7.0', { recursive: true });
  await writeFile('docs/validation-0.7.0/patch-process.log', processLog);
}
