import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmalltableClient } from '../src/client/controller.js';
import { initialRoom } from '../src/shared/model.js';
import { randomUUID } from 'node:crypto';
for (const code of [4001, 4003])
  test(`UI controller removes private state on disconnect ${code}`, async () => {
    const previous = {
      fetch: globalThis.fetch,
      ws: globalThis.WebSocket,
      location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    };
    let socket: FakeSocket;
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      onmessage?: (event: { data: string }) => void;
      onopen?: () => void;
      onclose?: (event: { code: number; reason: string }) => void;
      onerror?: () => void;
      constructor() {
        socket = this;
      }
      send() {}
      close() {}
    }
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ token: 'temporary-session' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { protocol: 'http:', host: 'localhost' },
      });
      const client = new SmalltableClient();
      await client.join('password', 'Test');
      socket!.onopen?.();
      const room = initialRoom();
      room.tokens.push({
        id: randomUUID(),
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
        note: '公开',
        secret: '私有说明',
      });
      socket!.onmessage?.({ data: JSON.stringify({ type: 'snapshot', room, dm: true, epoch: 0 }) });
      assert.equal(client.getSnapshot().dm, true);
      socket!.onclose?.({ code, reason: code === 4003 ? '房间口令已更换' : 'idle' });
      if (code === 4003) {
        assert.equal(client.getSnapshot().room, null);
        assert.equal('password' in client, false);
      }
      assert.equal(client.getSnapshot().dm, false);
      assert.ok(!JSON.stringify(client.getSnapshot().room).includes('私有说明'));
      if (code === 4001) assert.equal(client.getSnapshot().room, null);
      client.leave();
    } finally {
      globalThis.fetch = previous.fetch;
      globalThis.WebSocket = previous.ws;
      if (previous.location) Object.defineProperty(globalThis, 'location', previous.location);
      else Reflect.deleteProperty(globalThis, 'location');
    }
  });
