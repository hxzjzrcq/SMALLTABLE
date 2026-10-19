import { createDom, installDomGlobals } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import { initialRoom } from '../src/shared/model';

test('effective limits appear in panels; local notes use configured UTF-8 bytes', async () => {
  const dom = createDom('<div id="root"></div>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const restoreGlobals = installDomGlobals(dom, {});
  const oldFetch = globalThis.fetch;
  const { createRoot } = await import('react-dom/client');
  const { smalltable } = await import('../src/client/controller');
  const { Notes } = await import('../src/client/components/Notes');
  const { DicePanel } = await import('../src/client/components/DicePanel');
  const { InitiativePanel } = await import('../src/client/components/InitiativePanel');
  const { TokenList } = await import('../src/client/components/Inspector');
  const { DMPanel } = await import('../src/client/components/DMPanel');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(Notes)));
    assert.equal(document.querySelector('textarea')!.readOnly, true);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ...DEFAULT_CAPABILITIES, maxNotesBytes: 6 }));
    await act(async () => {
      await smalltable.loadConfig();
      root.render(createElement(Notes, { maxBytes: smalltable.getSnapshot().caps?.maxNotesBytes }));
    });
    assert.equal(document.querySelector('textarea')!.readOnly, false);
    assert.match(document.querySelector('.meta')!.textContent!, /0 \/ 6/);
    const textarea = document.querySelector('textarea')!;
    async function input(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLTextAreaElement.prototype,
          'value',
        )!.set!.call(textarea, value);
        textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    }
    await input('中文');
    assert.equal(localStorage.getItem('smalltable.private-notes.v1'), '中文');
    await input('中文a');
    assert.equal(localStorage.getItem('smalltable.private-notes.v1'), '中文');
    assert.match(document.querySelector('[role="status"]')!.textContent!, /6 字节/);
    const room = initialRoom();
    await act(async () =>
      root.render(
        createElement(DicePanel, {
          rolls: room.rolls,
          names: room.names,
          actions: smalltable,
          connected: true,
          maxRolls: 2,
        }),
      ),
    );
    assert.match(document.querySelector('h2')!.textContent!, /0 \/ 2/);
    await act(async () =>
      root.render(
        createElement(InitiativePanel, {
          entries: room.initiative,
          ascending: room.initiativeAscending,
          actions: smalltable,
          connected: true,
          onClose() {},
          maxEntries: 4,
        }),
      ),
    );
    assert.match(document.querySelector('h2')!.textContent!, /0\/4/);
    await act(async () =>
      root.render(
        createElement(TokenList, {
          tokens: room.tokens,
          selected: null,
          onSelect() {},
          maxTokens: 3,
        }),
      ),
    );
    assert.match(document.querySelector('h2')!.textContent!, /0 \/ 3/);
    await act(async () =>
      root.render(
        createElement(DMPanel, {
          grid: room.grid,
          names: room.names,
          dm: true,
          actions: smalltable,
          connected: true,
          maxNames: 6,
        }),
      ),
    );
    assert.ok([...document.querySelectorAll('.meta')].some((e) => /1 \/ 6/.test(e.textContent!)));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    dom.window.close();
    restoreGlobals();
  }
});
