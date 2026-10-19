import { waitEvent } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import AdmZip from 'adm-zip';
import { CredentialStore, validatePassword } from '../src/server/credentials.js';
import { createSmalltable } from './helpers.js';
import { config } from '../src/server/config.js';
import { ServerEvent } from '../src/shared/model.js';

const roomPassword = 'Room-055-Start',
  dmPassword = 'Keeper-055-Start';

const nextRoom = 'Room-055-Next',
  nextDM = 'Keeper-055-Next';

const directory = () => mkdtemp(path.join(tmpdir(), 'smalltable-passwords-'));

test('password policy: categories, Unicode length, controls and exact case-insensitive blocklist', () => {
  for (const value of [
    '12345678',
    'abcdefgh',
    'Pass1!',
    'Password1!',
    'pAsSwOrD1!',
    'Qwerty123!',
    'valid pass1',
    'valid\npass1',
    'a'.repeat(128) + '1',
  ])
    assert.throws(() => validatePassword(value));
  for (const value of [
    'Dungeon55',
    'dungeon!',
    'UPPER274',
    '1234567!',
    'MyPassword1!Longer',
    '冒险者Ab12345',
    'a'.repeat(127) + '1',
  ])
    assert.doesNotThrow(() => validatePassword(value));
});

test('initialization fails closed; independent salted credentials persist; reset is offline and preserves room data', async () => {
  const dir = await directory();
  let store: CredentialStore | undefined;
  try {
    await assert.rejects(CredentialStore.open(dir, {}), /首次启动/);
    await assert.rejects(
      CredentialStore.open(dir, { roomPassword: 'Password1!', dmPassword }),
      /常见/,
    );
    store = await CredentialStore.open(dir, { roomPassword, dmPassword });
    const original = await readFile(path.join(dir, 'credentials.json'), 'utf8');
    assert.ok(!original.includes(roomPassword) && !original.includes(dmPassword));
    const data = JSON.parse(original);
    assert.notEqual(data.room.salt, data.dm.salt);
    await assert.rejects(CredentialStore.reset(dir, nextRoom, nextDM), /凭证锁/);
    await assert.rejects(CredentialStore.open(dir, {}), /凭证锁/);
    await assert.rejects(
      store.change({ currentDMPassword: 'wrong', roomPassword: nextRoom }),
      /当前 DM/,
    );
    await assert.rejects(
      store.change({
        currentDMPassword: dmPassword,
        roomPassword: nextRoom,
        dmPassword: 'Password1!',
      }),
      /常见/,
    );
    assert.equal(await readFile(path.join(dir, 'credentials.json'), 'utf8'), original);
    await assert.rejects(
      store.change({ currentDMPassword: dmPassword, roomPassword: dmPassword }),
      /不能相同/,
    );
    await assert.rejects(store.change({ currentDMPassword: dmPassword, dmPassword }), /当前相同/);
    // Disk write failure must leave both the active credentials and old file intact.
    await mkdir(path.join(dir, 'credentials.json.tmp'));
    await assert.rejects(
      store.change({ currentDMPassword: dmPassword, roomPassword: nextRoom, dmPassword: nextDM }),
    );
    assert.equal(await store.roomMatches(roomPassword), true);
    assert.equal(await store.dmMatches(dmPassword), true);
    assert.equal(await readFile(path.join(dir, 'credentials.json'), 'utf8'), original);
    await rm(path.join(dir, 'credentials.json.tmp'), { recursive: true });
    await store.change({
      currentDMPassword: dmPassword,
      roomPassword: nextRoom,
      dmPassword: nextDM,
    });
    await store.close();
    store = undefined;
    // Initial environment values no longer control initialized credentials.
    store = await CredentialStore.open(dir, { roomPassword, dmPassword });
    assert.equal(await store.roomMatches(nextRoom), true);
    assert.equal(await store.dmMatches(nextDM), true);
    await store.close();
    store = undefined;
    await writeFile(path.join(dir, 'room.json'), 'table-data');
    await CredentialStore.reset(dir, roomPassword, dmPassword);
    assert.equal(await readFile(path.join(dir, 'room.json'), 'utf8'), 'table-data');
    store = await CredentialStore.open(dir, {});
    assert.equal(await store.roomMatches(roomPassword), true);
    await store.close();
    store = undefined;
    await writeFile(path.join(dir, 'credentials.json'), '{broken');
    await assert.rejects(CredentialStore.open(dir, { roomPassword, dmPassword }), /损坏/);
    assert.equal(await readFile(path.join(dir, 'credentials.json'), 'utf8'), '{broken');
    await CredentialStore.reset(dir, roomPassword, dmPassword);
  } finally {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await directory();
  const cfg = { ...config(), dataDir: dir };
  let service = await createSmalltable(cfg, { roomPassword, dmPassword });
  const sockets: WebSocket[] = [];
  async function listen() {
    await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  }
  let url = await listen();
  const login = (password: string) =>
    fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  async function peer(password = roomPassword) {
    const response = await login(password);
    assert.equal(response.status, 200);
    const { token } = await response.json();
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    sockets.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    const wait = async (predicate: (e: ServerEvent) => boolean, mark = 0) => {
      return waitEvent(events, predicate, mark);
    };
    await wait((e) => e.type === 'snapshot');
    return {
      ws,
      token,
      events,
      wait,
      async unlock(password = dmPassword) {
        const mark = events.length;
        ws.send(JSON.stringify({ type: 'unlock', password }));
        await wait((e) => e.type === 'snapshot' && e.dm, mark);
      },
    };
  }
  const change = (token: string, body: unknown) =>
    fetch(url + '/api/passwords', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    dir,
    peer,
    login,
    change,
    get url() {
      return url;
    },
    get service() {
      return service;
    },
    async restart() {
      for (const ws of sockets) ws.terminate();
      await service.close();
      service = await createSmalltable(cfg, {});
      url = await listen();
    },
    async close() {
      for (const ws of sockets) ws.terminate();
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('HTTP authorization, fresh DM verification, strict request shape, validation and rate limit', async () => {
  const s = await setup();
  try {
    assert.equal(
      (await s.change('invalid', { currentDMPassword: dmPassword, dmPassword: nextDM })).status,
      401,
    );
    const p = await s.peer();
    assert.equal(
      (await s.change(p.token, { currentDMPassword: dmPassword, dmPassword: nextDM })).status,
      400,
    );
    await p.unlock();
    for (const body of [
      { currentDMPassword: 'wrong', dmPassword: nextDM },
      { currentDMPassword: dmPassword },
      { currentDMPassword: dmPassword, roomPassword: nextRoom, dmPassword: 'Password1!' },
      { currentDMPassword: dmPassword, roomPassword: nextRoom, extra: 'not-allowed' },
    ])
      assert.equal((await s.change(p.token, body)).status, 400);
    const limited = await s.change(p.token, { currentDMPassword: dmPassword, dmPassword: nextDM });
    assert.match((await limited.json()).error, /频繁/);
    assert.equal((await s.login(roomPassword)).status, 200);
  } finally {
    await s.close();
  }
});

test('DM rotation revokes all DM privileges; room rotation disconnects all and invalidates pending tokens; reboot and backup restore preserve new secrets', async () => {
  const s = await setup();
  try {
    const a = await s.peer(),
      b = await s.peer();
    await a.unlock();
    await b.unlock();
    a.ws.send(JSON.stringify({ type: 'names', names: ['055验证'] }));
    await a.wait((e) => e.type === 'snapshot' && e.room.names[0] === '055验证');
    const backupRes = await fetch(s.url + '/api/backup', {
      headers: { Authorization: 'Bearer ' + a.token },
    });
    assert.equal(backupRes.status, 200);
    const backup = Buffer.from(await backupRes.arrayBuffer());
    const entries = new AdmZip(backup).getEntries().map((e) => e.entryName);
    assert.deepEqual(entries, ['room.json']);
    assert.ok(!new AdmZip(backup).readAsText('room.json').includes('credentials'));
    const markA = a.events.length,
      markB = b.events.length;
    assert.equal(
      (await s.change(a.token, { currentDMPassword: dmPassword, dmPassword: nextDM })).status,
      200,
    );
    for (const [p, mark] of [
      [a, markA],
      [b, markB],
    ] as const)
      await p.wait((e) => e.type === 'snapshot' && !e.dm, mark);
    assert.equal(a.ws.readyState, WebSocket.OPEN);
    assert.equal(b.ws.readyState, WebSocket.OPEN);
    assert.equal(
      (await fetch(s.url + '/api/backup', { headers: { Authorization: 'Bearer ' + b.token } }))
        .status,
      400,
    );
    const mark = a.events.length;
    a.ws.send(JSON.stringify({ type: 'unlock', password: dmPassword }));
    await a.wait((e) => e.type === 'error' && e.message.includes('密码错误'), mark);
    await a.unlock(nextDM);
    await s.restart();
    const dm = await s.peer();
    await dm.unlock(nextDM);
    const pending = await (await s.login(roomPassword)).json();
    const closeA = once(dm.ws, 'close');
    const viewer = await s.peer();
    const closeB = once(viewer.ws, 'close');
    assert.equal(
      (await s.change(dm.token, { currentDMPassword: nextDM, roomPassword: nextRoom })).status,
      200,
    );
    assert.equal((await closeA)[0], 4003);
    assert.equal((await closeB)[0], 4003);
    for (const token of [dm.token, viewer.token, pending.token]) {
      assert.equal(
        (await fetch(s.url + '/api/health', { headers: { Authorization: 'Bearer ' + token } }))
          .status,
        401,
      );
      assert.equal(
        (await s.change(token, { currentDMPassword: nextDM, dmPassword: dmPassword })).status,
        401,
      );
    }
    assert.equal((await s.login(roomPassword)).status, 403);
    await s.restart();
    assert.equal((await s.login(roomPassword)).status, 403);
    const fresh = await s.peer(nextRoom);
    await fresh.unlock(nextDM);
    const restored = await fetch(s.url + '/api/restore', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + fresh.token, 'Content-Type': 'application/zip' },
      body: backup,
    });
    assert.equal(restored.status, 200);
    assert.equal(s.service.getRoom().names[0], '055验证');
    assert.equal((await s.login(nextRoom)).status, 200);
    assert.equal((await s.login(roomPassword)).status, 403);
  } finally {
    await s.close();
  }
});

test('simultaneous password updates cannot reuse a revoked session or partially mix credentials', async () => {
  const s = await setup();
  try {
    const p = await s.peer();
    await p.unlock();
    const results = await Promise.all([
      s.change(p.token, {
        currentDMPassword: dmPassword,
        roomPassword: nextRoom,
        dmPassword: nextDM,
      }),
      s.change(p.token, {
        currentDMPassword: dmPassword,
        roomPassword: 'Other-Room-055',
        dmPassword: 'Other-Keeper-055',
      }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const winner =
      results[0].status === 200 ? [nextRoom, nextDM] : ['Other-Room-055', 'Other-Keeper-055'];
    await s.restart();
    const fresh = await s.peer(winner[0]);
    await fresh.unlock(winner[1]);
    assert.equal((await s.login(roomPassword)).status, 403);
  } finally {
    await s.close();
  }
});

test('login verified with an old credential cannot create a session after room rotation', async () => {
  const originalOpen = CredentialStore.open;
  let hold = false;
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  CredentialStore.open = async (...args: Parameters<typeof originalOpen>) => {
    const store = await originalOpen(...args);
    const check = store.roomMatches;
    store.roomMatches = async (candidate) => {
      const result = await check(candidate);
      if (hold) {
        hold = false;
        entered();
        await gate;
      }
      return result;
    };
    return store;
  };
  let s: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    s = await setup();
    CredentialStore.open = originalOpen;
    const dm = await s.peer();
    await dm.unlock();
    hold = true;
    const pending = s.login(roomPassword);
    await waiting;
    assert.equal(
      (await s.change(dm.token, { currentDMPassword: dmPassword, roomPassword: nextRoom })).status,
      200,
    );
    release();
    assert.equal((await pending).status, 403);
    assert.equal((await s.login(nextRoom)).status, 200);
  } finally {
    release();
    CredentialStore.open = originalOpen;
    await s?.close();
  }
});
