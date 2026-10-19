import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function launch(args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = once(child, 'close');
  const records = () =>
    output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    child,
    done,
    records,
    text: () => output,
    async ready(event: string) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (
          output
            .split('\n')
            .filter(Boolean)
            .some((line) => JSON.parse(line).event === event)
        )
          return;
        if (child.exitCode !== null) throw Error('process stopped before readiness');
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error('process readiness timeout');
    },
  };
}
async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'close');
  child.kill('SIGKILL');
  await done;
}

test(
  'real executable logs startup, graceful shutdown and configuration startup failure safely',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'st-log-process-'));
    const net = createServer();
    await new Promise<void>((r) => net.listen(0, '127.0.0.1', r));
    const port = (net.address() as { port: number }).port;
    await new Promise<void>((r) => net.close(() => r()));
    const secret = 'Room-Process-061-Secret';
    const env = {
      DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      ROOM_PASSWORD: secret,
      DM_PASSWORD: 'Keeper-Process-061-Secret',
    };
    let p: ReturnType<typeof launch> | undefined;
    try {
      p = launch(['src/server/index.ts'], env);
      await p.ready('process.started');
      p.child.kill('SIGTERM');
      assert.equal((await p.done)[0], 0);
      assert.deepEqual(
        p.records().map((r) => r.event),
        ['process.starting', 'process.started', 'process.stopping', 'process.stopped'],
      );
      assert.ok(!p.text().includes(secret));
      const file = path.join(dir, 'invalid.json');
      await writeFile(file, JSON.stringify({ password: secret }));
      p = launch(['src/server/index.ts'], { ...env, SMALLTABLE_CONFIG: file });
      assert.equal((await p.done)[0], 1);
      assert.deepEqual(
        p.records().map((r) => r.event),
        [
          'process.starting',
          'config.load_failed',
          'process.startup_failed',
          'process.abnormal_exit',
        ],
      );
      assert.ok(!p.text().includes(secret));
    } finally {
      if (p) await kill(p.child);
      await rm(dir, { recursive: true, force: true });
    }
  },
);

for (const [expression, event] of [
  [
    "setImmediate(() => { throw Error('private-unhandled-secret-061'); });",
    'process.uncaught_exception',
  ],
  ["Promise.reject(Error('private-unhandled-secret-061'));", 'process.unhandled_rejection'],
])
  test(
    `fatal handler records ${event} and exits without printing the exception text`,
    { timeout: 10000 },
    async () => {
      const url = pathToFileURL(path.resolve('src/server/log.ts')).href;
      const code = `import { installProcessLogging } from ${JSON.stringify(url)}; installProcessLogging(); ${expression}`;
      const p = launch(['--input-type=module', '-e', code]);
      try {
        assert.equal((await p.done)[0], 1);
        assert.deepEqual(
          p.records().map((r) => r.event),
          [event, 'process.abnormal_exit'],
        );
        assert.ok(p.records().every((r) => r.level === 'fatal'));
        assert.ok(!p.text().includes('private-unhandled-secret-061'));
      } finally {
        await kill(p.child);
      }
    },
  );
