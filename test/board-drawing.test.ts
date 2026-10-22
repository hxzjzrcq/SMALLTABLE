import { createDom, installDomGlobals } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Board } from '../src/client/components/Board';
import { initialRoom, type Drawing } from '../src/shared/model';
import { SmalltableClient } from '../src/client/controller';

test('pointer line preview stays local, release submits once, cancel/pinch do not draw; line selection deletes', async () => {
  const dom = createDom('<div id="root"></div>', { url: 'http://localhost' });
  const restoreGlobals = installDomGlobals(dom, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  dom.window.SVGElement.prototype.setPointerCapture = () => {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const drawings: Drawing[] = [],
    deleted: string[] = [];
  const actions = {
    addDrawing: (d: Drawing) => drawings.push(d),
    deleteDrawing: (id: string) => deleted.push(id),
  } as unknown as SmalltableClient;
  const props = {
    room: initialRoom(),
    selected: [],
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
    restoreGlobals();
  }
});
