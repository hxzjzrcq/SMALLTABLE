import { sessionBody } from './helpers';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createSmalltable, type CredentialAccess } from '../src/server/app';
import { config } from '../src/server/config';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { temporaryId } from '../src/shared/session';
import type { ServerEvent } from '../src/shared/model';
import { waitEvent } from './helpers';

async function setup(limits = {}, access?: CredentialAccess) {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-session-068-'));
  let now = 1_800_000_000_000,
    room = 'Room-068',
    dm = 'Keeper-068';
  const credentials: CredentialAccess = access ?? {
    roomMatches: async (p) => p === room,
    dmMatches: async (p) => p === dm,
    change: async (input) => {
      if (input.currentDMPassword !== dm) throw Error('当前 DM 密码错误');
      if (input.roomPassword) room = input.roomPassword;
      if (input.dmPassword) dm = input.dmPassword;
      return;
    },
  };
  const cfg = { ...config(), dataDir: dir, caps: { ...DEFAULT_CAPABILITIES, ...limits } };
  const app = await createSmalltable(cfg, credentials, { now: () => now });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  const request = (
    route: string,
    token = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    fetch(url + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = (name: string, password = room, token = '') =>
    request('/api/login', token, { name, password });
  async function socket(token: string) {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    sockets.push(ws);
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
    const wait = (predicate: (e: ServerEvent) => boolean, mark = 0) =>
      waitEvent(events, predicate, mark);
    await wait((e) => e.type === 'snapshot');
    return { ws, token, events, wait, send: (c: unknown) => ws.send(JSON.stringify(c)) };
  }
  async function peer(name: string, password = room) {
    const res = await login(name, password);
    assert.equal(res.status, 200, await res.clone().text());
    return socket((await sessionBody(res)).token);
  }
  return {
    app,
    cfg,
    request,
    login,
    socket,
    peer,
    url,
    advance: (ms: number) => (now += ms),
    close: async () => {
      sockets.forEach((ws) => ws.terminate());
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
type Peer = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['peer']>>;
async function closePeer(p: Peer) {
  const closed = once(p.ws, 'close');
  p.ws.close();
  await closed;
}
async function command(p: Peer, c: unknown, check: (e: ServerEvent) => boolean) {
  const mark = p.events.length;
  p.send(c);
  return p.wait(check, mark);
}
const upgraded = (e: ServerEvent) => e.type === 'snapshot' && e.dm;
const downgraded = (e: ServerEvent) => e.type === 'snapshot' && !e.dm;

test('temporary IDs use Unicode code points and reject unsupported characters without rewriting', () => {
  for (const name of ['12345678', 'AbCdEfGh', '一二三四', '玩家A01', '𠀀𠀁𠀂𠀃'])
    assert.equal(temporaryId(name).valid, true, name);
  for (const name of [
    '',
    'abcdefghijklmnopq',
    '一二三四五六七八九',
    ' a',
    'a ',
    '\n',
    '<b>',
    '🙂',
    'Ａ',
    '１',
    'é',
    'a\u0000',
  ])
    assert.equal(temporaryId(name).valid, false, name);
  assert.equal(temporaryId('玩家A01').units, 7);
  assert.equal(DEFAULT_CAPABILITIES.idleMs, 30 * 60000);
  assert.equal(DEFAULT_CAPABILITIES.maxDMs, 1);
});

test('five player seats and an independent DM seat; failed upgrade keeps player and lock at capacity logs out', async () => {
  const f = await setup({ maxSeats: 5 });
  try {
    const players = [];
    for (let i = 0; i < 5; i++) players.push(await f.peer('P' + i));
    const dm = await f.peer('DM', 'Keeper-068');
    await dm.wait((e) => e.type === 'presence' && e.count === 5 && e.dms === 1);
    assert.equal((await f.login('extra')).status, 409);
    assert.equal((await f.login('DM2', 'Keeper-068')).status, 409);
    await command(
      players[0],
      { type: 'unlock', password: 'Keeper-068' },
      (e) => e.type === 'error' && e.message === 'DM 席位已满',
    );
    assert.equal(players[0].ws.readyState, WebSocket.OPEN);
    const closed = once(dm.ws, 'close');
    dm.send({ type: 'lock' });
    assert.equal((await closed)[0], 4011);
    assert.equal((await f.request('/api/health', dm.token)).status, 401);
    await command(players[0], { type: 'unlock', password: 'Keeper-068' }, upgraded);
    await command(players[0], { type: 'lock' }, downgraded);
    await players[0].wait((e) => e.type === 'presence' && e.count === 5 && e.dms === 0);
  } finally {
    await f.close();
  }
});

test('offline sessions release seats and IDs; reservations expire at 15 seconds, preserving authentication', async () => {
  const f = await setup({ maxSeats: 1 });
  try {
    const initial = await f.login('Alice'),
      { token } = await sessionBody(initial);
    assert.match(
      initial.headers.get('set-cookie')!,
      /HttpOnly; SameSite=Strict; Path=\/; Max-Age=2700/,
    );
    assert.equal((await f.login('Bob')).status, 409);
    f.advance(15000);
    const bob = await f.peer('Bob');
    assert.equal((await f.request('/api/session', token)).status, 200);
    assert.equal((await f.request('/api/session', token, {})).status, 409);
    await closePeer(bob);
    const alice = await f.socket(token);
    await closePeer(alice);
    const other = await f.peer('alice');
    const conflict = await f.request('/api/session', token, {});
    assert.equal((await conflict.json()).code, 'ID_CONFLICT');
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    const bad = await f.login('New', 'wrong', token);
    assert.equal(bad.status, 403);
    assert.equal((await f.request('/api/health', token)).status, 200);
    await closePeer(other);
    const replacement = await f.login('New', undefined, token);
    assert.equal(replacement.status, 200);
    assert.equal((await f.request('/api/health', token)).status, 401);
  } finally {
    await f.close();
  }
});

test('healthy online sessions survive idle threshold; disconnected recovery has a fixed 45 minute deadline', async () => {
  const f = await setup();
  try {
    const a = await f.peer('A');
    f.advance(120 * 60000);
    assert.equal((await f.request('/api/session', a.token)).status, 200);
    assert.match(
      (await f.request('/api/session', a.token)).headers.get('set-cookie')!,
      /Max-Age=2700/,
    );
    await closePeer(a);
    f.advance(44 * 60000);
    const res = await f.request('/api/session', a.token, {});
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie')!, /Max-Age=60/);
    // A failed/incomplete handshake never extends the original cutoff.
    f.advance(60000);
    assert.equal((await f.request('/api/session', a.token, {})).status, 401);
    const b = await f.peer('B');
    await closePeer(b);
    f.advance(40 * 60000);
    const resumed = await f.socket(b.token);
    f.advance(120 * 60000);
    assert.equal((await f.request('/api/session', b.token)).status, 200);
    await closePeer(resumed);
    f.advance(45 * 60000);
    assert.equal((await f.request('/api/session', b.token)).status, 401);
  } finally {
    await f.close();
  }
});

test('disconnected expiration is enforced before WS handshake and without maintenance', async () => {
  const f = await setup();
  try {
    const { token } = await sessionBody(await f.login('A'));
    f.advance(45 * 60000);
    const ws = new WebSocket(f.url.replace('http', 'ws') + '/ws', ['tabletop', token]);
    const rejected = new Promise<number>((resolve) =>
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode!);
        res.resume();
        ws.terminate();
      }),
    );
    ws.on('error', () => {});
    assert.equal(await rejected, 401);
    assert.equal((await f.request('/api/health', token)).status, 401);
  } finally {
    await f.close();
  }
});

test('connection takeover replaces only old connection, allows full-room refresh, and invalidates old management target', async () => {
  const f = await setup({ maxSeats: 1 });
  try {
    const dm = await f.peer('DM', 'Keeper-068'),
      a = await f.peer('A');
    const list = await dm.wait((e) => e.type === 'players' && e.players.length === 2);
    assert.equal(list.type, 'players');
    if (list.type !== 'players') return;
    const stale = list.players.find((p) => !p.dm)!.target;
    assert.ok(!JSON.stringify(list).includes(a.token));
    const closed = once(a.ws, 'close'),
      b = await f.socket(a.token);
    assert.equal((await closed)[0], 4005);
    await command(
      dm,
      { type: 'player.kick', target: stale },
      (e) => e.type === 'error' && e.message.includes('列表已更新'),
    );
    assert.equal(b.ws.readyState, WebSocket.OPEN);
    assert.equal((await f.request('/api/health', b.token)).status, 200);
    const mark = dm.events.length;
    await command(b, { type: 'activity' }, (e) => e.type === 'activity');
    const current = [...dm.events].reverse().find((e) => e.type === 'players');
    assert.ok(current?.type === 'players');
    if (current?.type !== 'players') return;
    const newTarget = current.players.find((p) => !p.dm)!.target;
    assert.notEqual(newTarget, stale);
    const kicked = once(b.ws, 'close');
    dm.send({ type: 'player.kick', target: newTarget });
    assert.equal((await kicked)[0], 4004);
    assert.equal((await f.request('/api/health', b.token)).status, 401);
    assert.ok(!b.events.some((e) => e.type === 'players'));
    await f.peer('A');
    assert.ok(dm.events.length >= mark);
  } finally {
    await f.close();
  }
});

test('queued commands from replaced and kicked sockets cannot mutate the room', async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const dm = await f.peer('DM', 'Keeper-068'),
      a = await f.peer('A');
    const original = f.app.storage.backup.bind(f.app.storage);
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    f.app.storage.backup = async (room) => {
      entered();
      await gate;
      return original(room);
    };
    const backup = f.request('/api/backup', dm.token);
    await started;
    a.send({ type: 'initiative.order', ascending: true, epoch: 0 });
    const replaced = once(a.ws, 'close');
    const b = await f.socket(a.token);
    await replaced;
    release();
    await backup;
    await command(b, { type: 'activity' }, (e) => e.type === 'activity');
    assert.equal(f.app.getRoom().initiativeAscending, false);
    // Kick precedes victim mutation in the same serial queue.
    const current = [...dm.events].reverse().find((e) => e.type === 'players');
    assert.ok(current?.type === 'players');
    if (current?.type !== 'players') return;
    const target = current.players.find((p) => !p.dm)!.target;
    const kicked = once(b.ws, 'close');
    dm.send({ type: 'player.kick', target });
    await kicked;
    assert.equal((await f.request('/api/health', b.token)).status, 401);
  } finally {
    release?.();
    await f.close();
  }
});

test('logout is idempotent without a socket, checks origin, clears cookie and revokes offline authentication', async () => {
  const f = await setup();
  try {
    const { token } = await sessionBody(await f.login('A'));
    assert.equal(
      (
        await fetch(f.url + '/api/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, Origin: 'https://other.invalid' },
        })
      ).status,
      403,
    );
    assert.equal((await f.request('/api/health', token)).status, 200);
    const logout = await f.request('/api/logout', token, {});
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await f.request('/api/health', token)).status, 401);
    assert.equal((await f.request('/api/logout', token, {})).status, 200);
  } finally {
    await f.close();
  }
});

test('DM rotation respects authentication source, online order, offline role and unchanged activity expiration', async () => {
  const f = await setup({ maxSeats: 3, maxDMs: 5 });
  try {
    const ordinary = await f.peer('P'),
      promoted = await f.peer('Up'),
      offline = await f.peer('Off');
    await command(promoted, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    await command(offline, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    await closePeer(offline);
    const direct = await f.peer('Direct', 'Keeper-068'),
      locked = await f.peer('Locked', 'Keeper-068');
    await command(locked, { type: 'lock' }, downgraded);
    await closePeer(locked);

    assert.equal((await f.request('/api/backup', offline.token)).status, 400);
    f.advance(20 * 60000);
    const closed = once(direct.ws, 'close');
    assert.equal(
      (
        await f.request('/api/passwords', promoted.token, {
          currentDMPassword: 'Keeper-068',
          dmPassword: 'Keeper-Next',
        })
      ).status,
      200,
    );
    assert.equal((await closed)[0], 4003);
    await promoted.wait(downgraded);
    for (const p of [direct, locked])
      assert.equal((await f.request('/api/health', p.token)).status, 401);
    const result = await f.request('/api/session', offline.token);
    assert.equal((await result.json()).dm, false);
    assert.match(result.headers.get('set-cookie')!, /Max-Age=1500/);
    assert.equal((await f.request('/api/health', ordinary.token)).status, 200);
    f.advance(10 * 60000);
    assert.equal((await f.request('/api/health', promoted.token)).status, 200);
  } finally {
    await f.close();
  }
});

test('demotion order is connection order and player capacity is never exceeded', async () => {
  const f = await setup({ maxSeats: 1, maxDMs: 3 });
  try {
    const first = await f.peer('First');
    await command(first, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    const second = await f.peer('Second');
    await command(second, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    const third = await f.peer('Third');
    await command(third, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    const closed2 = once(second.ws, 'close'),
      closed3 = once(third.ws, 'close');
    await f.request('/api/passwords', first.token, {
      currentDMPassword: 'Keeper-068',
      dmPassword: 'Keeper-Next',
    });
    await first.wait(downgraded);
    assert.equal((await closed2)[0], 4011);
    assert.equal((await closed3)[0], 4011);
    await first.wait((e) => e.type === 'presence' && e.count === 1 && e.dms === 0);
  } finally {
    await f.close();
  }
});

test('room password rotation invalidates every source, online and offline, including modifier', async () => {
  const f = await setup();
  try {
    const p = await f.peer('P');
    await closePeer(p);
    const dm = await f.peer('DM', 'Keeper-068');
    const closed = once(dm.ws, 'close');
    await f.request('/api/passwords', dm.token, {
      currentDMPassword: 'Keeper-068',
      roomPassword: 'Room-Next',
    });
    assert.equal((await closed)[0], 4003);
    for (const token of [p.token, dm.token])
      assert.equal((await f.request('/api/health', token)).status, 401);
    assert.equal((await f.login('P', 'Room-068')).status, 403);
    assert.equal((await f.login('P', 'Room-Next')).status, 200);
  } finally {
    await f.close();
  }
});

test('concurrent names and seats reserve atomically, DM login uses login attempt limiter', async () => {
  const f = await setup({ maxSeats: 1 });
  try {
    const res = await Promise.all([f.login('Alice'), f.login('alice'), f.login('Bob')]);
    assert.equal(res.filter((r) => r.status === 200).length, 1);
    for (let i = 0; i < 5; i++)
      assert.equal((await f.login('D' + i, 'Keeper-068')).status, i === 0 ? 200 : 409);
    const limited = await f.login('D6', 'Keeper-068');
    assert.equal(limited.status, 409); // DM capacity, not the toolbox attempt bucket.
    for (let i = 0; i < 11; i++) await f.login('N' + i, 'wrong');
    assert.equal((await f.login('Last', 'wrong')).status, 429);
  } finally {
    await f.close();
  }
});

test('offline direct-DM source is revoked by DM rotation, and a stale role target cannot be kicked', async () => {
  const f = await setup({ maxDMs: 2 });
  try {
    const keeper = await f.peer('DM', 'Keeper-068'),
      offline = await f.peer('Off', 'Keeper-068');
    await closePeer(offline);
    const p = await f.peer('P');
    const listed = await keeper.wait(
      (e) => e.type === 'players' && e.players.some((p) => p.name === 'P'),
    );
    assert.ok(listed.type === 'players');
    if (listed.type !== 'players') return;
    const target = listed.players.find((p) => p.name === 'P')!.target;
    await command(
      p,
      { type: 'player.kick', target },
      (e) => e.type === 'error' && e.message === '操作未授权',
    );
    assert.equal(p.ws.readyState, WebSocket.OPEN);
    await command(p, { type: 'unlock', password: 'Keeper-068' }, upgraded);
    await command(
      keeper,
      { type: 'player.kick', target },
      (e) => e.type === 'error' && e.message.includes('列表已更新'),
    );
    assert.equal(p.ws.readyState, WebSocket.OPEN);
    assert.equal(
      (
        await f.request('/api/passwords', keeper.token, {
          currentDMPassword: 'Keeper-068',
          dmPassword: 'Keeper-Next',
        })
      ).status,
      200,
    );
    assert.equal((await f.request('/api/health', offline.token)).status, 401);
  } finally {
    await f.close();
  }
});

test('DM password rotation rejects an already verified direct-DM login result', async () => {
  let hold = false,
    entered!: () => void,
    release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const access: CredentialAccess = {
    roomMatches: async (p) => p === 'Room-068',
    dmMatches: async (p) => {
      const result = p === 'Keeper-068';
      if (hold) {
        hold = false;
        entered();
        await gate;
      }
      return result;
    },
    change: async () => {},
  };
  const f = await setup({}, access);
  try {
    const dm = await f.peer('DM', 'Keeper-068');
    hold = true;
    const pending = f.login('Other', 'Keeper-068');
    await started;
    assert.equal(
      (
        await f.request('/api/passwords', dm.token, {
          currentDMPassword: 'Keeper-068',
          dmPassword: 'Keeper-Next',
        })
      ).status,
      200,
    );
    release();
    const result = await pending;
    assert.equal(result.status, 403);
    assert.equal((await result.json()).code, 'CREDENTIALS_CHANGED');
  } finally {
    release();
    await f.close();
  }
});

test('a player disconnected during asynchronous DM validation cannot gain authority', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const f = await setup(
    {},
    {
      roomMatches: async () => true,
      dmMatches: async () => {
        entered();
        await gate;
        return true;
      },
      change: async () => {},
    },
  );
  try {
    const p = await f.peer('P');
    p.send({ type: 'unlock', password: 'Keeper-068' });
    await started;
    await closePeer(p);
    release();
    // A queued read flushes the unlock operation. No offline DM authority may be granted.
    const other = await f.peer('Other');
    await command(other, { type: 'activity' }, (e) => e.type === 'activity');
    assert.equal((await (await f.request('/api/session', p.token)).json()).dm, false);
  } finally {
    release();
    await f.close();
  }
});

test('failed WS protocol handshake releases its reservation immediately without revoking authentication', async () => {
  const f = await setup({ maxSeats: 1 });
  try {
    const { token } = await sessionBody(await f.login('A'));
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        f.url + '/ws',
        {
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': 'invalid',
            'Sec-WebSocket-Protocol': 'tabletop, ' + token,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 400);
    assert.equal((await f.login('B')).status, 200);
    assert.equal((await f.request('/api/health', token)).status, 200);
  } finally {
    await f.close();
  }
});

test('healthy online connections receive broadcasts beyond the former idle limit', async () => {
  const f = await setup();
  try {
    const online = await f.peer('DM', 'Keeper-068');
    f.advance(29 * 60000);
    const current = await f.peer('P');
    const mark = online.events.length;
    f.advance(60000);
    await command(
      current,
      { type: 'initiative.order', ascending: true, epoch: 0 },
      (e) => e.type === 'snapshot' && e.room.initiativeAscending,
    );
    await online.wait((e) => e.type === 'snapshot' && e.room.initiativeAscending, mark);
    assert.equal(online.ws.readyState, WebSocket.OPEN);
  } finally {
    await f.close();
  }
});
