import { createDom, installDomGlobals, inputValue } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { InitiativePanel } from '../src/client/components/InitiativePanel';
import { initialRoom } from '../src/shared/model';
import { SmalltableClient } from '../src/client/controller';

test('initiative panel sorts ties, toggles order, edits/deletes and hides without changing room', async () => {
  const dom = createDom('<div id="root"></div>', { url: 'http://localhost' });
  const restoreGlobals = installDomGlobals(dom, {});
  const { createRoot } = await import('react-dom/client');
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
    for (const [label, value] of [
      ['修改先攻名字', '新守卫'],
      ['修改先攻数字', '-3.5'],
    ]) {
      const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      await inputValue(input, value);
    }
    await act(async () =>
      document
        .querySelector('form.initiative-row')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(puts, [{ ...room.initiative[1], name: '新守卫', value: -3.5 }]);
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
    restoreGlobals();
  }
});
