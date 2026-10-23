import { createDom, installDomGlobals, inputValue } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom, type ServerEvent } from '../src/shared/model';

test('live room updates preserve drafts and scroll, refresh visible data, and remove private controls on revocation', async () => {
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
  const root = createRoot(document.getElementById('root')!);
  const room = initialRoom();
  const token = {
    id: randomUUID(),
    name: 'A',
    hidden: false,
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
  try {
    await act(async () => root.render(createElement(App)));
    await act(async () => {
      await smalltable.join('room', 'Test');
      socket!.onopen?.();
    });
    await receive({ type: 'snapshot', room, epoch: 0, dm: true, caps: DEFAULT_CAPABILITIES });
    assert.ok(!document.querySelector('.toolbar')!.textContent!.includes('无图片棋子'));
    const create = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('无图片棋子'),
    )!;
    assert.ok(create);
    assert.equal(create.closest('[hidden]')?.getAttribute('hidden'), '');
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('.tabs button')]
        .find((b) => b.textContent === '棋子')!
        .click(),
    );
    assert.equal(create.closest('[hidden]'), null);
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === '先攻盘')!.click(),
    );
    const expression = document.querySelector<HTMLInputElement>('[aria-label="骰子表达式"]')!;
    const notes = document.querySelector<HTMLTextAreaElement>('[aria-label="私人笔记"]')!;
    const initiativeName = document.querySelector<HTMLInputElement>('[aria-label="先攻名字"]')!;
    await inputValue(expression, '2d8+3');
    await inputValue(notes, '私人草稿');
    await inputValue(initiativeName, '未提交');
    const passwordDraft = document.querySelector<HTMLInputElement>('.password-settings input')!;
    await inputValue(passwordDraft, 'Keeper-Draft-060');
    const sidebar = document.querySelector<HTMLElement>('.sidebar-content')!;
    sidebar.scrollTop = 123;
    await act(async () => document.querySelector<HTMLButtonElement>('.token-list button')!.click());
    const noteDraft = document.querySelector<HTMLTextAreaElement>('.inspector textarea')!;
    const nameDraft = document.querySelector<HTMLInputElement>('.inspector input')!;
    await inputValue(noteDraft, '未提交备注');
    await inputValue(nameDraft, '未提交名称');
    for (let i = 1; i <= 25; i++)
      await receive({ type: 'token', token: { ...token, x: i }, epoch: 0, revision: i });
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
    // Rotation and public note events refresh the live board.
    await receive({ type: 'token', token: { ...token, x: 25, angle: 45 }, epoch: 0, revision: 26 });
    await receive({
      type: 'token',
      token: { ...token, x: 25, angle: 45, note: '公开更新' },
      epoch: 0,
      revision: 27,
    });
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
    await act(async () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === '属性工具')!.click(),
    );
    const frameBefore = document.querySelector('iframe');
    assert.ok(frameBefore);
    const appBefore = document.querySelector('.app');
    await act(async () => socket!.onclose?.({ code: 1006, reason: '' }));
    assert.equal(document.querySelector('.app'), appBefore);
    assert.equal(document.querySelector('iframe'), frameBefore);
    assert.equal(document.querySelector('[aria-label="先攻名字"]'), initiativeName);
    assert.equal(initiativeName.value, '未提交');
    assert.equal(expression.value, '2d8+3');
    assert.equal(document.querySelector('.password-settings'), null);
    assert.ok(!JSON.stringify(smalltable.getSnapshot().room).includes('private-render-secret'));
    assert.ok(document.querySelector('.board-token'));
    await act(async () => {
      await smalltable.retry();
      socket!.onopen?.();
    });
    await receive({ type: 'snapshot', room: next, epoch: 0, dm: true });
    assert.equal(document.querySelector('iframe'), frameBefore);
    assert.equal(initiativeName.value, '未提交');
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
    assert.ok(
      ![...document.querySelectorAll('button')].some((b) => b.textContent?.includes('无图片棋子')),
    );
    assert.ok(!document.body.textContent!.includes('DM 私有说明'));
    assert.ok(!JSON.stringify(smalltable.getSnapshot().room).includes('private-render-secret'));
    await receive({ type: 'snapshot', room: next, epoch: 0, dm: true });
    const freshPassword = document.querySelector<HTMLInputElement>('.password-settings input')!;
    assert.equal(freshPassword.value, '');
    await inputValue(freshPassword, 'another-draft');
    await act(async () => socket!.onclose?.({ code: 4001, reason: 'idle' }));
    assert.equal(document.querySelector('.password-settings'), null);
    assert.ok(!JSON.stringify(smalltable.getSnapshot().room).includes('private-render-secret'));
  } finally {
    await act(async () => {
      root.unmount();
      smalltable.leave();
    });
    dom.window.close();
    restoreGlobals();
  }
});
