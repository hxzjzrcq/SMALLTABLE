import { createDom, installDomGlobals } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { LoginPage } from '../src/client/components/LoginPage';
import { mountLoginScene } from '../src/client/login/scene.js';

function environment(reduced = false) {
  const dom = createDom('<div id="root"></div>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const intervals = new Map<number, () => void>();
  let id = 0;
  const motionListeners = new Set<() => void>();
  const mq = {
    matches: reduced,
    addEventListener: (_t: string, fn: () => void) => motionListeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => motionListeners.delete(fn),
  };
  Object.defineProperty(dom.window, 'matchMedia', { value: () => mq });
  const restoreGlobals = installDomGlobals(dom, {
    setInterval: (fn: () => void) => {
      intervals.set(++id, fn);
      return id;
    },
    clearInterval: (key: number) => intervals.delete(key),
  });
  return {
    dom,
    intervals,
    mq,
    motionListeners,
    restore() {
      dom.window.close();
      restoreGlobals();
    },
  };
}

test('login uses actual states, accepts keyboard form submission, clears password and preserves local notes', async () => {
  const env = environment();
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const passwords: string[] = [];
  let edits = 0;
  const props = {
    connection: 'disconnected' as const,
    error: '',
    notice: '',
    onSubmit: (p: string) => passwords.push(p),
    onEdit: () => {
      edits++;
    },
  };
  try {
    localStorage.setItem('smalltable.private-notes.v1', '本机笔记');
    await act(async () => root.render(createElement(LoginPage, props)));
    assert.ok(document.querySelector('.st-login-c'));
    assert.equal(document.querySelector('.st-login-demo'), null);
    assert.equal(env.intervals.size, 1);
    assert.ok(document.querySelector('.st-login-notes')?.textContent?.includes('查看本机私人笔记'));
    assert.equal(document.querySelector<HTMLTextAreaElement>('.notes textarea')!.value, '本机笔记');
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.match(document.getElementById('st-login-message')!.textContent!, /请先输入/);
    const input = document.querySelector<HTMLInputElement>('#st-login-password')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        env.dom.window.HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'test-password');
      input.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(passwords, ['test-password']);
    assert.equal(input.value, '');
    await act(async () =>
      root.render(createElement(LoginPage, { ...props, connection: 'connecting' })),
    );
    assert.equal(document.querySelector<HTMLButtonElement>('.st-login-submit')!.disabled, true);
    assert.equal(input.readOnly, true);
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.equal(passwords.length, 1);
    await act(async () =>
      root.render(createElement(LoginPage, { ...props, error: '房间人数已满' })),
    );
    assert.equal(document.getElementById('st-login-message')!.textContent, '房间人数已满');
    assert.ok(!document.querySelector('.st-login-log-new')!.textContent?.includes('口令不对'));
    assert.equal(env.intervals.size, 0);
    await act(async () =>
      root.render(createElement(LoginPage, { ...props, error: '房间密码错误' })),
    );
    assert.match(document.querySelector('.st-login-log-new')!.textContent!, /口令不对/);
    await act(async () =>
      root.render(createElement(LoginPage, { ...props, connection: 'connected' })),
    );
    assert.equal(document.getElementById('st-login-message')!.textContent, '正在同步桌面…');
    await act(async () => root.unmount());
    assert.equal(env.intervals.size, 0);
    assert.equal(env.motionListeners.size, 0);
    document.dispatchEvent(new env.dom.window.Event('visibilitychange'));
    assert.equal(env.intervals.size, 0);
    assert.equal(localStorage.getItem('smalltable.private-notes.v1'), '本机笔记');
  } finally {
    env.restore();
  }
});

test('animation respects reduced motion/hidden pages and supports cleanup then remount', async () => {
  const env = environment(true);
  try {
    const host = document.getElementById('root')!;
    host.innerHTML =
      '<div class="st-login-map"></div><span class="st-login-status-r"></span><p class="st-login-log-old"></p><p class="st-login-log-new"></p>';
    let scene = mountLoginScene(host);
    assert.equal(env.intervals.size, 0);
    env.mq.matches = false;
    env.motionListeners.forEach((fn) => fn());
    assert.equal(env.intervals.size, 1);
    for (let i = 0; i < 500; i++) for (const fn of env.intervals.values()) fn();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new env.dom.window.Event('visibilitychange'));
    assert.equal(env.intervals.size, 0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new env.dom.window.Event('visibilitychange'));
    assert.equal(env.intervals.size, 1);
    scene.destroy();
    assert.equal(env.intervals.size, 0);
    assert.equal(env.motionListeners.size, 0);
    scene = mountLoginScene(host);
    assert.ok(host.querySelector('.st-login-c'));
    assert.equal(env.intervals.size, 1);
    scene.destroy();
    assert.equal(env.intervals.size, 0);
    assert.equal(host.querySelectorAll('.st-login-c').length, 0);
  } finally {
    env.restore();
  }
});

test('App transitions from actual client handshake to tabletop and back without retaining animation', async () => {
  const env = environment();
  const savedFetch = globalThis.fetch,
    savedSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'),
    savedObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import('../src/client/App');
  const { smalltable } = await import('../src/client/controller');
  const { initialRoom } = await import('../src/shared/model');
  let socket: FakeSocket;
  const requests: string[] = [];
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
  globalThis.fetch = async (url, init) => {
    requests.push(String(url));
    if (String(url) === '/api/login')
      assert.equal(JSON.parse(String(init?.body)).password, 'actual-client-test');
    return new Response(
      JSON.stringify(String(url) === '/api/login' ? { token: 'local-test-session' } : {}),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  env.dom.window.HTMLDialogElement.prototype.close = function () {};
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(App)));
    const input = document.querySelector<HTMLInputElement>('#st-login-password')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        env.dom.window.HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'actual-client-test');
      input.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.ok(requests.includes('/api/login'));
    await act(async () => socket!.onopen?.());
    assert.equal(document.getElementById('st-login-message')!.textContent, '正在同步桌面…');
    await act(async () =>
      socket!.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', room: initialRoom(), dm: false, epoch: 0 }),
      }),
    );
    assert.equal(document.querySelector('.st-login'), null);
    assert.ok(document.querySelector('.app'));
    assert.equal(env.intervals.size, 0);
    await act(async () => smalltable.leave());
    assert.ok(document.querySelector('.st-login'));
    assert.equal(env.intervals.size, 1);
    await act(async () => root.unmount());
    assert.equal(env.intervals.size, 0);
    assert.equal(env.motionListeners.size, 0);
  } finally {
    smalltable.leave();
    globalThis.fetch = savedFetch;
    if (savedSocket) Object.defineProperty(globalThis, 'WebSocket', savedSocket);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
    if (savedObserver) Object.defineProperty(globalThis, 'ResizeObserver', savedObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    env.restore();
  }
});
