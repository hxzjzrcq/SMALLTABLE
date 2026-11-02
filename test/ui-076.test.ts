import { createDom, installDomGlobals } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Board } from '../src/client/components/Board';
import { InitiativePanel } from '../src/client/components/InitiativePanel';
import { initialRoom } from '../src/shared/model';
import { token } from './support/management-fixture';
import type { SmalltableClient } from '../src/client/controller';
test('076 context menu retains multi-selection, hides once, closes on Escape; player health hides fields', async () => {
  const dom = createDom('<div id="root"></div>', { url: 'http://localhost' });
  const restore = installDomGlobals(dom, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const a = token(),
    b = token();
  const hidden: string[][] = [];
  let selectionCalls = 0;
  const actions = {
    setHiddenMany: (ids: string[]) => hidden.push(ids),
  } as unknown as SmalltableClient;
  try {
    const props = {
      room: { ...initialRoom(), tokens: [a, b] },
      selected: [a.id, b.id],
      onSelect: () => {
        selectionCalls++;
      },
      actions,
      tool: 'move' as const,
      fitSignal: 0,
      epoch: 0,
      connected: true,
      dm: true,
    };
    await act(async () => root.render(createElement(Board, props)));
    const context = () =>
      document.querySelector('.board-token')!.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 10000,
          clientY: 10000,
        }),
      );
    await act(async () => {
      context();
    });
    assert.equal(selectionCalls, 0);
    const menu = document.querySelector('[role=menu]') as HTMLElement;
    assert.ok(menu);
    assert.ok(parseInt(menu.style.left) < dom.window.innerWidth);
    await act(async () => {
      (menu.querySelector('button') as HTMLButtonElement).click();
    });
    assert.deepEqual(hidden, [[a.id, b.id]]);
    assert.equal(document.querySelector('[role=menu]'), null);
    await act(async () => {
      context();
    });
    await act(async () => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    assert.equal(document.querySelector('[role=menu]'), null);
    const props2 = {
      entries: [{ id: a.id, name: 'Guard', value: 1, hp: 'secret HP', other: 'AC' }],
      dm: false,
      connected: true,
      actions,
      maxEntries: 255,
      ascending: false,
      onClose: () => {},
    };
    await act(async () => root.render(createElement(InitiativePanel, props2)));
    assert.equal(document.querySelector('.initiative-details'), null);
    await act(async () => root.render(createElement(InitiativePanel, { ...props2, dm: true })));
    await act(async () => {
      (document.querySelector('.initiative-details button') as HTMLButtonElement).click();
    });
    const input = document.querySelector('.initiative-details input') as HTMLInputElement;
    assert.equal(input.value, 'secret HP');
    await act(async () =>
      root.render(
        createElement(InitiativePanel, {
          ...props2,
          dm: true,
          entries: [{ ...props2.entries[0], value: 9 }],
        }),
      ),
    );
    assert.equal(document.querySelector('.initiative-details input'), input);
    await act(async () => root.render(createElement(InitiativePanel, props2)));
    assert.equal(document.querySelector('.initiative-details'), null);
  } finally {
    await act(async () => root.unmount());
    restore();
    dom.window.close();
  }
});
