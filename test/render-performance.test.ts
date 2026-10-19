import { createDom, installDomGlobals } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom, type ServerEvent } from '../src/shared/model';

test('render budget: 25 position events do not execute unrelated memoized panels', async () => {
  const dom = createDom('<div id="root"></div>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  let socket: FakeSocket;
  const sent: any[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onmessage?: (e: { data: string }) => void;
    onopen?: () => void;
    onclose?: (e: { code: number; reason: string }) => void;
    onerror?: () => void;
    constructor() {
      socket = this;
    }
    send(data: string) {
      sent.push(JSON.parse(data));
    }
    close() {}
  }
  const restoreGlobals = installDomGlobals(dom, {
    WebSocket: FakeSocket,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: async (url: string) =>
      new Response(
        JSON.stringify(url === '/api/login' ? { token: 'test-token' } : DEFAULT_CAPABILITIES),
      ),
  });
  dom.window.matchMedia = (() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof dom.window.matchMedia;
  dom.window.HTMLDialogElement.prototype.close = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {};
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import('../src/client/App');
  const { smalltable } = await import('../src/client/controller');
  const { DicePanel } = await import('../src/client/components/DicePanel');
  const { Notes } = await import('../src/client/components/Notes');
  const { InitiativePanel } = await import('../src/client/components/InitiativePanel');
  const { DMPanel } = await import('../src/client/components/DMPanel');
  const { TokenList } = await import('../src/client/components/Inspector');
  const counts: Record<string, number> = {};
  const restorers: (() => void)[] = [];
  // Instrument actual component bodies behind memo; no production counters/hooks.
  for (const [name, component] of Object.entries({
    DicePanel,
    Notes,
    InitiativePanel,
    DMPanel,
    TokenList,
  })) {
    const target = component as unknown as { type: (props: unknown) => unknown };
    assert.equal(typeof target.type, 'function', `${name} has an update boundary`);
    const original = target.type;
    counts[name] = 0;
    target.type = (props) => {
      counts[name]++;
      return original(props);
    };
    restorers.push(() => {
      target.type = original;
    });
  }
  const root = createRoot(document.getElementById('root')!);
  const room = initialRoom();
  const token = {
    id: randomUUID(),
    name: 'A',
    label: '1',
    shape: 'circle' as const,
    color: '#123456',
    x: 0,
    y: 0,
    size: 1,
    angle: 0,
    asset: null,
    note: '',
    secret: '',
  };
  room.tokens.push(token);
  const receive = async (event: ServerEvent) =>
    act(async () => socket!.onmessage?.({ data: JSON.stringify(event) }));
  try {
    await act(async () => root.render(createElement(App)));
    await act(async () => {
      await smalltable.join('room');
      socket!.onopen?.();
    });
    await receive({ type: 'snapshot', room, epoch: 0, dm: true, caps: DEFAULT_CAPABILITIES });
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === '先攻盘')!.click(),
    );
    const before = { ...counts };
    for (let i = 1; i <= 25; i++)
      await receive({ type: 'token', token: { ...token, x: i }, epoch: 0, revision: i });
    assert.deepEqual(counts, before);
    assert.match(
      document.querySelector('.board-token')!.getAttribute('transform')!,
      /translate\(25 0\)/,
    );
    await receive({
      type: 'token',
      token: { ...token, x: 25, name: 'changed' },
      epoch: 0,
      revision: 26,
    });
    assert.ok(counts.TokenList > before.TokenList, 'counter must observe relevant updates');
  } finally {
    await act(async () => {
      root.unmount();
      smalltable.leave();
    });
    for (const restore of restorers) restore();
    dom.window.close();
    restoreGlobals();
  }
});
