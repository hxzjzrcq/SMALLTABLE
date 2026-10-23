let loginSequence068 = 0;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lockDataDirectory } from '../src/server/instance-lock.js';

const root = process.cwd();
const lockURL = pathToFileURL(path.resolve('src/server/instance-lock.ts')).href;
const dir = () => mkdtemp(path.join(tmpdir(), 'smalltable-lifecycle-'));
function launch(args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout!.on('data', (data) => {
    stdout += data;
  });
  child.stderr!.on('data', (data) => {
    stderr += data;
  });
  const exited = once(child, 'exit');
  return {
    child,
    exited,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    async ready(marker: string) {
      for (let i = 0; i < 1000; i++) {
        if (stdout.includes(marker)) return;
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error('Child exited before ready: ' + stderr);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error('Child readiness timeout: ' + stderr);
    },
  };
}
async function kill(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill(signal);
  await done;
}
const holder = (directory: string) =>
  launch([
    '--input-type=module',
    '-e',
    `import { lockDataDirectory } from ${JSON.stringify(lockURL)};
const release=await lockDataDirectory(${JSON.stringify(directory)}); console.log('LOCK_READY');
setInterval(()=>{},1000); process.on('SIGTERM',async()=>{await release();process.exit(0)});`,
  ]);
const env = (directory: string, port: number) => ({
  DATA_DIR: directory,
  HOST: '127.0.0.1',
  PORT: String(port),
  ROOM_PASSWORD: 'Room-Lifecycle-056',
  DM_PASSWORD: 'Keeper-Lifecycle-056',
});
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test(
  'kernel lock rejects same directory and path aliases, allows independent data and releases after SIGKILL',
  { timeout: 15000 },
  async () => {
    const directory = await dir(),
      other = await dir();
    const p = holder(directory);
    try {
      await p.ready('LOCK_READY');
      await assert.rejects(lockDataDirectory(directory), /凭证锁/);
      await assert.rejects(
        lockDataDirectory(path.join(directory, '..', path.basename(directory))),
        /凭证锁/,
      );
      if (process.platform !== 'win32') {
        const alias = path.join(other, 'alias');
        await symlink(directory, alias);
        await assert.rejects(lockDataDirectory(alias), /凭证锁/);
      }
      const release = await lockDataDirectory(other);
      await release();
      await release();
      await kill(p.child, 'SIGKILL');
      const recovered = await lockDataDirectory(directory);
      await recovered();
      await assert.rejects(readFile(path.join(directory, 'credentials.lock')), { code: 'ENOENT' });
    } finally {
      await kill(p.child, 'SIGKILL');
      await rm(directory, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  },
);

test('simultaneous processes have exactly one lock owner', { timeout: 20000 }, async () => {
  const directory = await dir();
  const peers = Array.from({ length: 5 }, () => holder(directory));
  try {
    for (let i = 0; i < 1000; i++) {
      if (
        peers.filter((p) => p.stdout.includes('LOCK_READY')).length === 1 &&
        peers.filter((p) => p.child.exitCode !== null).length === 4
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(peers.filter((p) => p.stdout.includes('LOCK_READY')).length, 1);
    assert.equal(
      peers.filter((p) => p.child.exitCode !== null && p.child.exitCode !== 0).length,
      4,
    );
    await assert.rejects(lockDataDirectory(directory), /凭证锁/);
  } finally {
    for (const p of peers) await kill(p.child, 'SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'real server restart after SIGKILL preserves credentials and does not require removing a lock',
  { timeout: 15000 },
  async () => {
    const directory = await dir(),
      port = await unusedPort();
    let p = launch(['src/server/index.ts'], env(directory, port));
    try {
      await p.ready('SMALLTABLE:');
      const saved = await readFile(path.join(directory, 'credentials.json'));
      await kill(p.child, 'SIGKILL');
      p = launch(['src/server/index.ts'], {
        ...env(directory, port),
        ROOM_PASSWORD: '',
        DM_PASSWORD: '',
      });
      await p.ready('SMALLTABLE:');
      const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'Room-Lifecycle-056', name: 'U' + ++loginSequence068 }),
      });
      assert.equal(login.status, 200);
      assert.deepEqual(await readFile(path.join(directory, 'credentials.json')), saved);
      await kill(p.child);
      const release = await lockDataDirectory(directory);
      await release();
    } finally {
      await kill(p.child, 'SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'occupied HTTP port reports original EADDRINUSE and cleans the data lock before exit',
  { timeout: 15000 },
  async () => {
    const directory = await dir(),
      occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as { port: number }).port;
    let p = launch(['src/server/index.ts'], env(directory, port));
    try {
      const [code] = await p.exited;
      assert.notEqual(code, 0);
      assert.match(p.stderr, /EADDRINUSE/);
      const release = await lockDataDirectory(directory);
      await release();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      p = launch(['src/server/index.ts'], env(directory, port));
      await p.ready('SMALLTABLE:');
      await kill(p.child);
    } finally {
      await kill(p.child, 'SIGKILL');
      if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('failed credential initialization releases the endpoint; legacy 055 PID locks are conservative', async () => {
  const directory = await dir();
  try {
    await writeFile(path.join(directory, 'credentials.lock'), String(process.pid));
    await assert.rejects(lockDataDirectory(directory), /旧版凭证锁进程/);
    assert.equal(
      await readFile(path.join(directory, 'credentials.lock'), 'utf8'),
      String(process.pid),
    );
    const gone = launch(['--input-type=module', '-e', '']);
    await gone.exited;
    await writeFile(path.join(directory, 'credentials.lock'), String(gone.child.pid));
    const release = await lockDataDirectory(directory);
    await release();
    await assert.rejects(readFile(path.join(directory, 'credentials.lock')), { code: 'ENOENT' });
    await writeFile(path.join(directory, 'credentials.lock'), 'invalid');
    await assert.rejects(lockDataDirectory(directory), /无法识别/);
    await rm(path.join(directory, 'credentials.lock'));
    const failed = launch(['src/server/index.ts'], {
      ...env(directory, await unusedPort()),
      ROOM_PASSWORD: '12345678',
    });
    const [code] = await failed.exited;
    assert.notEqual(code, 0);
    const again = await lockDataDirectory(directory);
    await again();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
