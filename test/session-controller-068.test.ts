import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRoom } from '../src/shared/model';
import { SESSION_CLOSE } from '../src/shared/session';
import { SmalltableClient } from '../src/client/controller';

function harness() {
  const before = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    storage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  const stored = new Map<string, string>(),
    sockets: FakeSocket[] = [],
    requests: { url: string; body?: string }[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onmessage?: (e: { data: string }) => void;
    onclose?: (e: { code: number; reason: string }) => void;
    onopen?: () => void;
    onerror?: () => void;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {}
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'http:', host: 'localhost' },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k),
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    },
  });
  let offline = false;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body as string });
    if (offline) throw TypeError('offline');
    return Response.json({ token: 'ephemeral', name: 'A', dm: false });
  };
  return {
    stored,
    sockets,
    requests,
    setOffline: (value: boolean) => (offline = value),
    restore() {
      globalThis.fetch = before.fetch;
      globalThis.WebSocket = before.WebSocket;
      for (const [key, value] of [
        ['location', before.location],
        ['localStorage', before.storage],
      ] as const)
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    },
  };
}

test('initialization restores by Cookie only and terminal WS closes never schedule a reconnect', async () => {
  const h = harness();
  try {
    for (const code of [4001, 4003, 4004, 4005, 4006, 4007, 4009, 4010, 4011]) {
      const client = new SmalltableClient();
      await client.initialize();
      assert.equal(h.requests.at(-1)?.url, '/api/session');
      assert.equal(h.requests.at(-1)?.body, undefined);
      const socket = h.sockets.at(-1)!;
      socket.onopen?.();
      socket.onclose?.({ code, reason: 'stop' });
      assert.equal(client.getSnapshot().connection, 'disconnected');
      assert.equal(client.getSnapshot().room, null);
      assert.equal(client.getSnapshot().resumable, [4006, 4010].includes(code));
      assert.equal((client as any).reconnectTimer, undefined);
    }
  } finally {
    h.restore();
  }
});

test('offline logout stores no credential and next initialization performs logout before any restoration', async () => {
  const h = harness();
  try {
    const client = new SmalltableClient();
    await client.join('sensitive-password', 'A');
    h.sockets[0].onopen?.();
    h.setOffline(true);
    await client.leave();
    assert.equal(client.getSnapshot().notice, '已在本地退出，服务器注销待联网完成');
    assert.deepEqual([...h.stored], [['smalltable.logout-pending', '1']]);
    h.setOffline(false);
    const fresh = new SmalltableClient();
    const mark = h.requests.length;
    await fresh.initialize();
    assert.deepEqual(
      h.requests.slice(mark).map((r) => r.url),
      ['/api/logout'],
    );
    assert.equal(h.stored.size, 0);
    assert.equal(fresh.getSnapshot().room, null);
  } finally {
    h.restore();
  }
});

test('logout waits for an in-flight login response so late Set-Cookie cannot restore a signed-out session', async () => {
  const h = harness();
  try {
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolve = r)),
      order: string[] = [];
    globalThis.fetch = async (url) => {
      order.push(String(url));
      return String(url) === '/api/login' ? pending : Response.json({ ok: true });
    };
    const client = new SmalltableClient();
    const joining = client.join('Room-068', 'A');
    // Authentication requests are serialized; allow the first request to start.
    await Promise.resolve();
    await Promise.resolve();
    const leaving = client.leave();
    assert.deepEqual(order, ['/api/login']);
    resolve(Response.json({ token: 'late-cookie', dm: false, name: 'A' }));
    await Promise.all([joining, leaving]);
    assert.deepEqual(order, ['/api/login', '/api/logout']);
    assert.equal(h.sockets.length, 0);
    assert.equal(h.stored.size, 0);
  } finally {
    h.restore();
  }
});

test('temporary disconnect retains public desktop; full seats retain it; terminal causes remove it', async () => {
  const h = harness();
  try {
    for (const code of [1006, ...Object.values(SESSION_CLOSE)]) {
      const c = new SmalltableClient();
      await c.initialize();
      const socket = h.sockets.at(-1)!;
      socket.onopen?.();
      const room = initialRoom();
      room.tokens.push({
        id: 't',
        name: 'A',
        hidden: false,
        label: '1',
        shape: 'circle',
        color: '#000000',
        x: 0,
        y: 0,
        size: 1,
        angle: 0,
        asset: null,
        note: 'public',
        secret: 'private',
      });
      socket.onmessage?.({ data: JSON.stringify({ type: 'snapshot', room, dm: true, epoch: 0 }) });
      socket.onclose?.({ code, reason: 'test' });
      const state = c.getSnapshot();
      assert.equal(!!state.room, [1006, 4006, 4010].includes(code));
      assert.equal(state.dm, false);
      assert.deepEqual(state.players, []);
      assert.ok(!JSON.stringify(state).includes('private'));
      assert.equal(c.send({ type: 'activity' }), false);
      if (code === 4007) {
        assert.equal(state.resumable, false);
        assert.match(state.notice, /更换 ID/);
      }
      await c.leave();
    }
  } finally {
    h.restore();
  }
});

test('HTTP recovery failures retain desktop for full/network only, and ten retries stop visibly', async () => {
  const h = harness();
  try {
    for (const code of [
      'PLAYER_FULL',
      'DM_FULL',
      'ID_CONFLICT',
      'EXPIRED',
      'KICKED',
      'CREDENTIALS_CHANGED',
      'REPLACED',
      'network',
    ]) {
      globalThis.fetch = async () => Response.json({ token: 'valid' });
      const c = new SmalltableClient();
      await c.initialize();
      const socket = h.sockets.at(-1)!;
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', room: initialRoom(), dm: false, epoch: 0 }),
      });
      globalThis.fetch = async () => {
        if (code === 'network') throw TypeError('offline');
        return Response.json({ code, error: code }, { status: 409 });
      };
      (c as any).attempts = 10;
      await (c as any).connect(true);
      assert.equal(!!c.getSnapshot().room, ['PLAYER_FULL', 'DM_FULL', 'network'].includes(code));
      assert.equal((c as any).reconnectTimer, undefined);
      if (code === 'network') {
        assert.equal(c.getSnapshot().connection, 'disconnected');
        assert.match(c.getSnapshot().notice, /重连失败/);
      }
      if (code === 'ID_CONFLICT') assert.equal(c.getSnapshot().resumable, false);
      globalThis.fetch = async () => Response.json({ ok: true });
      await c.leave();
    }
  } finally {
    h.restore();
  }
});

test('recovery phases never expose a login form before session resolution; snapshots end recovery', async () => {
  const h = harness();
  try {
    const c = new SmalltableClient();
    assert.equal(c.getSnapshot().recovery, 'checking');
    await c.initialize();
    assert.equal(c.getSnapshot().recovery, 'socket');
    const socket = h.sockets.at(-1)!;
    socket.onopen?.();
    assert.equal(c.getSnapshot().recovery, 'snapshot');
    assert.equal(c.getSnapshot().room, null);
    socket.onmessage?.({
      data: JSON.stringify({ type: 'snapshot', room: initialRoom(), dm: true, epoch: 0 }),
    });
    assert.equal(c.getSnapshot().recovery, null);
    assert.equal(c.getSnapshot().dm, true);
    socket.onclose?.({ code: 1006, reason: '' });
    assert.equal(c.getSnapshot().recovery, null, 'existing desktop must remain visible');
    assert.equal(c.getSnapshot().dm, false);
    await c.leave();
    assert.equal(c.getSnapshot().recovery, null);
    for (const code of ['EXPIRED', 'ID_CONFLICT', 'KICKED', 'PLAYER_FULL', 'DM_FULL']) {
      globalThis.fetch = async () => Response.json({ code, error: code }, { status: 409 });
      const fresh = new SmalltableClient();
      await fresh.initialize();
      assert.equal(fresh.getSnapshot().recovery, code.endsWith('FULL') ? 'retry' : null);
    }
  } finally {
    h.restore();
  }
});

test('socket/snapshot timeout participates in the ten-retry budget until an actual snapshot arrives', async (t) => {
  const h = harness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const c = new SmalltableClient();
    for (let attempt = 0; attempt < 11; attempt++) {
      if (!attempt) await c.initialize();
      else await (c as any).connect(true);
      const socket = h.sockets.at(-1)!;
      socket.onopen?.();
      let closed = false;
      socket.close = () => {
        closed = true;
      };
      t.mock.timers.tick(15000);
      assert.equal(closed, true);
      socket.onclose?.({ code: 1000, reason: '桌面同步超时' });
    }
    assert.equal(c.getSnapshot().recovery, 'retry');
    assert.match(c.getSnapshot().notice, /重连失败/);
    globalThis.fetch = async () => Response.json({ ok: true });
    await c.leave();
    assert.equal(c.getSnapshot().recovery, null);
  } finally {
    t.mock.timers.reset();
    h.restore();
  }
});

test('072 final preview waits for matching ack; old ack/timeouts, later moves and snapshots cannot undo new state', async (t) => {
  const h = harness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const c = new SmalltableClient();
    await c.initialize();
    const socket = h.sockets.at(-1)!;
    socket.onopen?.();
    assert.equal(c.send({ type: 'activity' }), false, 'handshake alone must not enable writes');
    const room = initialRoom();
    const id = '00000000-0000-4000-8000-000000000001';
    const token = {
      id,
      name: 'A',
      label: 'A',
      hidden: false,
      shape: 'circle' as const,
      color: '#123456',
      x: 0,
      y: 0,
      size: 1,
      angle: 0,
      asset: null,
      note: '',
      secret: 'private',
    };
    room.tokens.push(token);
    const receive = (event: unknown) => socket.onmessage?.({ data: JSON.stringify(event) });
    receive({ type: 'snapshot', room, dm: true, epoch: 0 });
    c.move(id, 10, 20, true);
    const first = c.getSnapshot().pendingMoves[id].moveId;
    receive({ type: 'token', token: { ...token, x: 5, y: 5 }, epoch: 0, revision: 1 });
    assert.equal(c.getSnapshot().pendingMoves[id].x, 10, 'broadcast is not acknowledgement');
    t.mock.timers.tick(1000);
    c.move(id, 30, 40, true);
    const second = c.getSnapshot().pendingMoves[id].moveId;
    receive({ type: 'move.ack', id, moveId: first, epoch: 0, revision: 2, ok: true, x: 10, y: 20 });
    t.mock.timers.tick(1000);
    assert.equal(c.getSnapshot().pendingMoves[id].moveId, second);
    receive({ type: 'token', token: { ...token, x: 90, y: 90 }, epoch: 0, revision: 5 });
    receive({
      type: 'move.ack',
      id,
      moveId: second,
      epoch: 0,
      revision: 3,
      ok: true,
      x: 30,
      y: 40,
    });
    assert.equal(c.getSnapshot().pendingMoves[id], undefined);
    assert.equal(c.getSnapshot().room!.tokens[0].x, 90, 'later authoritative movement wins');
    c.move(id, 100, 200, true);
    t.mock.timers.tick(2000);
    assert.equal(c.getSnapshot().pendingMoves[id], undefined);
    assert.match(c.getSnapshot().error, /同步延迟/);
    c.move(id, 100, 200, true);
    const pending = c.getSnapshot().pendingMoves[id].moveId;
    receive({
      type: 'snapshot',
      room: { ...room, revision: 6, tokens: [{ ...token, hidden: true }] },
      dm: true,
      epoch: 0,
    });
    assert.equal(c.getSnapshot().pendingMoves[id], undefined);
    receive({
      type: 'move.ack',
      id,
      moveId: pending,
      epoch: 0,
      revision: 7,
      ok: true,
      x: 100,
      y: 200,
    });
    assert.equal(c.getSnapshot().room!.tokens[0].hidden, true);
    assert.equal(c.getSnapshot().room!.tokens[0].x, 0);
    assert.ok(!c.diagnostic().includes('private'));
    assert.ok(!c.diagnostic().includes('ephemeral'));
    await c.leave();
  } finally {
    t.mock.timers.reset();
    h.restore();
  }
});

test('072 upload reports actual progress/processing, prevents duplicates, and recovers from failure', async () => {
  const h = harness();
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  const requests: FakeXHR[] = [];
  class FakeXHR {
    upload: {
      onprogress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void;
      onload?: () => void;
    } = {};
    timeout = 0;
    status = 200;
    responseText = '{"ok":true}';
    onerror?: () => void;
    onload?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    headers: Record<string, string> = {};
    constructor() {
      requests.push(this);
    }
    open() {}
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send() {}
  }
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FakeXHR });
  try {
    const c = new SmalltableClient(),
      file = new File(['abc'], 'tone.mp3');
    const task = c.uploadMusic(file);
    const xhr = requests[0];
    assert.equal(c.getSnapshot().uploads.music.phase, 'uploading');
    await assert.rejects(() => c.uploadMusic(file), /正在上传/);
    assert.equal(requests.length, 1);
    xhr.upload.onprogress?.({ loaded: 1, total: 3, lengthComputable: true });
    assert.equal(c.getSnapshot().uploads.music.percent, 33);
    xhr.upload.onload?.();
    assert.equal(c.getSnapshot().uploads.music.phase, 'processing');
    xhr.status = 400;
    xhr.responseText = '{"error":"文件无效"}';
    xhr.onload?.();
    await assert.rejects(task, /文件无效/);
    assert.equal(c.getSnapshot().uploads.music.phase, 'failed');
    const retry = c.uploadMusic(file);
    requests[1].upload.onprogress?.({ loaded: 1, total: 0, lengthComputable: false });
    assert.equal(c.getSnapshot().uploads.music.percent, undefined);
    requests[1].upload.onload?.();
    requests[1].onload?.();
    await retry;
    assert.equal(c.getSnapshot().uploads.music.phase, 'done');
    assert.ok(!('Authorization' in requests[1].headers));
  } finally {
    if (prior) Object.defineProperty(globalThis, 'XMLHttpRequest', prior);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
    h.restore();
  }
});
