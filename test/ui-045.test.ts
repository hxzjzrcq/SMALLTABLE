import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Board } from '../src/client/components/Board';
import { InitiativePanel } from '../src/client/components/InitiativePanel';
import { initialRoom, type Drawing } from '../src/shared/model';
import type { SmalltableClient } from '../src/client/controller';

test('pointer line preview stays local, release submits once, cancel/pinch do not draw; line selection deletes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.SVGElement.prototype.setPointerCapture = () => {};
  const root = createRoot(document.getElementById('root')!);
  const drawings: Drawing[] = [],
    deleted: string[] = [];
  const actions = {
    addDrawing: (d: Drawing) => drawings.push(d),
    deleteDrawing: (id: string) => deleted.push(id),
  } as unknown as SmalltableClient;
  const props = {
    room: initialRoom(),
    selected: null,
    onSelect: () => {},
    actions,
    tool: 'draw' as const,
    maxDrawings: 255,
    fitSignal: 0,
    epoch: 0,
    connected: true,
  };
  async function pointer(type: string, x: number, y: number, id = 1, touch = false) {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperties(event, {
      pointerId: { value: id },
      pointerType: { value: touch ? 'touch' : 'mouse' },
    });
    await act(async () => document.querySelector('svg')!.dispatchEvent(event));
  }
  try {
    await act(async () => root.render(createElement(Board, props)));
    await pointer('pointerdown', 120, 140);
    await pointer('pointermove', 220, 240);
    assert.equal(drawings.length, 0);
    await pointer('pointerup', 220, 240);
    assert.equal(drawings.length, 1);
    assert.deepEqual(
      { ...drawings[0], id: '' },
      { id: '', x1: 20, y1: 40, x2: 120, y2: 140, color: '#d33b32' },
    );
    await pointer('pointerdown', 120, 140);
    await pointer('pointermove', 220, 240);
    await pointer('pointercancel', 220, 240);
    assert.equal(drawings.length, 1);
    await pointer('pointerdown', 120, 140, 1, true);
    await pointer('pointerdown', 220, 240, 2, true);
    await pointer('pointerup', 220, 240, 2, true);
    await pointer('pointerup', 120, 140, 1, true);
    assert.equal(drawings.length, 1);
    await act(async () =>
      root.render(
        createElement(Board, { ...props, tool: 'move', room: { ...initialRoom(), drawings } }),
      ),
    );
    const hit = document.querySelector('[aria-label="选择线条"]')!;
    await act(async () =>
      hit.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 })),
    );
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === '删除选中线条',
    )!;
    assert.ok(button);
    await act(async () => button.click());
    assert.deepEqual(deleted, [drawings[0].id]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('initiative panel sorts ties, toggles order, edits/deletes and hides without changing room', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root')!);
  const room = {
    ...initialRoom(),
    initiative: [
      { id: crypto.randomUUID(), name: 'A', value: 5 },
      { id: crypto.randomUUID(), name: 'B', value: 10 },
      { id: crypto.randomUUID(), name: 'C', value: 10 },
    ],
  };
  let ascending = false,
    closed = false;
  const deletes: string[] = [],
    puts: unknown[] = [];
  const actions = {
    orderInitiative: (a: boolean) => {
      ascending = a;
      return true;
    },
    deleteInitiative: (id: string) => deletes.push(id),
    putInitiative: (e: unknown) => {
      puts.push(e);
      return true;
    },
  } as unknown as SmalltableClient;
  try {
    await act(async () =>
      root.render(
        createElement(InitiativePanel, {
          entries: room.initiative,
          ascending: room.initiativeAscending,
          maxEntries: 255,
          actions,
          connected: true,
          onClose: () => {
            closed = true;
          },
        }),
      ),
    );
    assert.deepEqual(
      [...document.querySelectorAll('.initiative-name')].map((e) => e.textContent),
      ['B', 'C', 'A'],
    );
    const order = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('从大到小'),
    )!;
    await act(async () => order.click());
    assert.equal(ascending, true);
    const modify = [...document.querySelectorAll('button')].find((b) => b.textContent === '修改')!;
    await act(async () => modify.click());
    await act(async () =>
      document
        .querySelector('form.initiative-row')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(puts, [room.initiative[1]]);
    await act(async () =>
      (document.querySelector('[aria-label="删除先攻 B"]') as HTMLButtonElement).click(),
    );
    assert.deepEqual(deletes, [room.initiative[1].id]);
    await act(async () =>
      (document.querySelector('[aria-label="隐藏先攻盘"]') as HTMLButtonElement).click(),
    );
    assert.equal(closed, true);
    assert.equal(room.initiative.length, 3);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
