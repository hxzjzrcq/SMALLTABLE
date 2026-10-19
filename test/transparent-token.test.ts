import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Board } from '../src/client/components/Board';
import type { SmalltableClient } from '../src/client/controller';
import { initialRoom } from '../src/shared/model';

test('transparent image hit rectangle supports selecting, dragging and rotation; plain token shape remains', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.SVGElement.prototype.setPointerCapture = () => {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const piece = {
    id: crypto.randomUUID(),
    name: '透明棋子',
    label: '1',
    shape: 'circle' as const,
    color: '#123456',
    x: 64,
    y: 64,
    size: 1,
    angle: 45,
    asset: 'a'.repeat(64) + '.webp',
    note: '',
  };
  const room = {
    ...initialRoom(),
    tokens: [piece, { ...piece, id: crypto.randomUUID(), asset: null, name: '无图片' }],
  };
  let selected: string | null = null;
  const moves: unknown[][] = [],
    rotations: unknown[][] = [];
  const actions = {
    move: (...args: unknown[]) => moves.push(args),
    rotate: (...args: unknown[]) => rotations.push(args),
  } as unknown as SmalltableClient;
  const props = {
    room,
    selected: piece.id,
    onSelect: (id: string | null) => {
      selected = id;
    },
    actions,
    tool: 'move' as const,
    fitSignal: 0,
    epoch: 0,
    connected: true,
  };
  async function pointer(target: Element, type: string, x: number, y: number) {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
    await act(async () => target.dispatchEvent(event));
  }
  try {
    await act(async () => root.render(createElement(Board, props)));
    const image = document.querySelector('[aria-label="透明棋子"]')!,
      plain = document.querySelector('[aria-label="无图片"]')!;
    const hit = image.querySelector('rect')!;
    assert.equal(hit.getAttribute('fill'), 'transparent');
    assert.equal(hit.getAttribute('pointer-events'), 'all');
    assert.equal(hit.getAttribute('width'), '64');
    assert.equal(image.querySelector('circle'), null);
    assert.ok(image.querySelector('image'));
    assert.ok(plain.querySelector('circle[fill="#123456"]'));
    assert.ok(image.querySelector('rect[stroke="#ffb000"]'));
    await pointer(hit, 'pointerdown', 164, 164);
    await pointer(document.querySelector('svg')!, 'pointermove', 204, 194);
    await pointer(document.querySelector('svg')!, 'pointerup', 204, 194);
    assert.equal(selected, piece.id);
    assert.deepEqual(moves.at(-1), [piece.id, 104, 94, true]);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="顺时针旋转棋子 45°"]')!.click(),
    );
    assert.equal(rotations.length, 1);
    assert.equal(rotations[0][1], 45);
    assert.match(image.getAttribute('transform')!, /rotate\(45\)/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
