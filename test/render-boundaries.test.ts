import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom, type ServerEvent } from '../src/shared/model';

test('25 position events skip unrelated panels, preserve drafts/scroll, and relevant changes remain visible', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
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
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    WebSocket: FakeSocket,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: async (url: string) =>
      new Response(
        JSON.stringify(url === '/api/login' ? { token: 'test-token' } : DEFAULT_CAPABILITIES),
      ),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
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
    secret: 'private-render-secret',
  };
  room.tokens.push(token);
  room.rolls.push({
    id: randomUUID(),
    name: '天意爷',
    expression: 'd6',
    dice: [],
    result: 3,
    time: new Date().toISOString(),
  });
  room.initiative.push({ id: randomUUID(), name: '守卫', value: 5 });
  async function receive(event: ServerEvent) {
    await act(async () => socket!.onmessage?.({ data: JSON.stringify(event) }));
  }
  async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      const proto =
        node.tagName === 'TEXTAREA'
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  }
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
    const expression = document.querySelector<HTMLInputElement>('[aria-label="骰子表达式"]')!;
    const notes = document.querySelector<HTMLTextAreaElement>('[aria-label="私人笔记"]')!;
    const initiativeName = document.querySelector<HTMLInputElement>('[aria-label="先攻名字"]')!;
    await input(expression, '2d8+3');
    await input(notes, '私人草稿');
    await input(initiativeName, '未提交');
    const passwordDraft = document.querySelector<HTMLInputElement>('.password-settings input')!;
    await input(passwordDraft, 'Keeper-Draft-060');
    const sidebar = document.querySelector<HTMLElement>('.sidebar-content')!;
    sidebar.scrollTop = 123;
    await act(async () => document.querySelector<HTMLButtonElement>('.token-list button')!.click());
    const noteDraft = document.querySelector<HTMLTextAreaElement>('.inspector textarea')!;
    const nameDraft = document.querySelector<HTMLInputElement>('.inspector input')!;
    await input(noteDraft, '未提交备注');
    await input(nameDraft, '未提交名称');
    const before = { ...counts };
    for (let i = 1; i <= 25; i++)
      await receive({ type: 'token', token: { ...token, x: i }, epoch: 0, revision: i });
    const delta = Object.fromEntries(Object.keys(counts).map((k) => [k, counts[k] - before[k]]));
    assert.deepEqual(delta, {
      DicePanel: 0,
      Notes: 0,
      InitiativePanel: 0,
      DMPanel: 0,
      TokenList: 0,
    });
    assert.equal(expression.value, '2d8+3');
    assert.equal(notes.value, '私人草稿');
    assert.equal(initiativeName.value, '未提交');
    assert.equal(sidebar.scrollTop, 123);
    assert.equal(passwordDraft.value, 'Keeper-Draft-060');
    assert.equal(noteDraft.value, '未提交备注');
    assert.equal(nameDraft.value, '未提交名称');
    assert.ok(document.querySelector('.token-list button.active'));
    assert.match(
      document.querySelector('.board-token')!.getAttribute('transform')!,
      /translate\(25 0\)/,
    );
    // Commit the management form directly; latest coordinates must be retained.
    await act(async () =>
      document
        .querySelectorAll('.inspector form')[1]
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    const edit = [...sent].reverse().find((c) => c.type === 'edit');
    assert.equal(edit.token.x, 25);
    assert.equal(edit.token.name, '未提交名称');
    // Rotation and public note events update Board/Inspector without executing unrelated panels.
    const beforeOther = { ...counts };
    await receive({ type: 'token', token: { ...token, x: 25, angle: 45 }, epoch: 0, revision: 26 });
    await receive({
      type: 'token',
      token: { ...token, x: 25, angle: 45, note: '公开更新' },
      epoch: 0,
      revision: 27,
    });
    assert.deepEqual(counts, beforeOther);
    assert.match(
      document.querySelector('.board-token')!.getAttribute('transform')!,
      /rotate\(45\)/,
    );
    assert.equal(passwordDraft.value, 'Keeper-Draft-060');
    assert.ok(!JSON.stringify(sent).includes('私人草稿'));
    // A rename must invalidate the token-list comparison, without touching its selection behavior.
    await receive({
      type: 'token',
      token: { ...token, x: 25, name: '改名' },
      epoch: 0,
      revision: 28,
    });
    assert.match(document.querySelector('.token-list')!.textContent!, /改名/);
    await receive({
      type: 'token',
      token: { ...token, x: 25, name: '', label: '新编号', color: '#abcdef', shape: 'square' },
      epoch: 0,
      revision: 29,
    });
    assert.match(document.querySelector('.token-list')!.textContent!, /新编号/);
    assert.equal(
      document.querySelector<HTMLElement>('.swatch')!.style.background,
      'rgb(171, 205, 239)',
    );
    const next = {
      ...room,
      revision: 30,
      tokens: [{ ...token, x: 25, angle: 45 }],
      names: ['新名字'],
      rolls: [...room.rolls, { ...room.rolls[0], id: randomUUID(), result: 6 }],
      initiative: [{ ...room.initiative[0], value: 9 }],
    };
    await receive({
      type: 'snapshot',
      room: next,
      epoch: 0,
      dm: true,
      caps: { ...DEFAULT_CAPABILITIES, maxNotesBytes: 100 },
    });
    assert.equal(document.querySelectorAll('.roll').length, 2);
    assert.match(
      document.querySelector('.board-token')!.getAttribute('transform')!,
      /rotate\(45\)/,
    );
    assert.ok(document.querySelector('[aria-label="顺时针旋转棋子 45°"]'));
    assert.match(document.querySelector('.dice select')!.textContent!, /新名字/);
    assert.match(document.querySelector('.initiative-row strong')!.textContent!, /9/);
    assert.match(document.querySelector('.notes .meta')!.textContent!, /100/);
    assert.equal(expression.value, '2d8+3');
    assert.equal(notes.value, '私人草稿');
    assert.equal(initiativeName.value, '未提交');
    assert.equal(sidebar.scrollTop, 123);
    // Existing close behavior remains: initiative drafts disappear, saved rows survive reopening.
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="隐藏先攻盘"]')!.click(),
    );
    assert.equal(document.querySelector('.initiative-panel'), null);
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === '先攻盘')!.click(),
    );
    assert.equal(document.querySelector<HTMLInputElement>('[aria-label="先攻名字"]')!.value, '');
    assert.match(document.querySelector('.initiative-row strong')!.textContent!, /9/);
    // DM-only controls and private drafts must be removed across the memo boundary.
    const { secret, ...publicToken } = next.tokens[0];
    await receive({
      type: 'snapshot',
      room: { ...next, tokens: [publicToken] },
      epoch: 0,
      dm: false,
    });
    assert.equal(document.querySelector('.password-settings'), null);
    assert.ok(!document.body.textContent!.includes('DM 私有说明'));
    assert.ok(!JSON.stringify(smalltable.getSnapshot().room).includes('private-render-secret'));
    await receive({ type: 'snapshot', room: next, epoch: 0, dm: true });
    const freshPassword = document.querySelector<HTMLInputElement>('.password-settings input')!;
    assert.equal(freshPassword.value, '');
    await input(freshPassword, 'another-draft');
    await act(async () => socket!.onclose?.({ code: 4001, reason: 'idle' }));
    assert.equal(document.querySelector('.password-settings'), null);
    assert.ok(!JSON.stringify(smalltable.getSnapshot().room).includes('private-render-secret'));
    console.log('25 position events: additional panel renders =', JSON.stringify(delta));
  } finally {
    await act(async () => {
      root.unmount();
      smalltable.leave();
    });
    for (const restore of restorers) restore();
    dom.window.close();
    for (const [key, desc] of originals) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
