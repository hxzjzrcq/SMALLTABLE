import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createDom, installDomGlobals, inputValue } from './environment';
import { LabelEditor } from '../src/client/components/PublicBox';
import type { SmalltableClient } from '../src/client/controller';
import { makeToken } from './room-fixture';

test('072 public label preserves dirty IME draft across remote rename and never submits during composition', async () => {
  const dom = createDom('<div id="root"></div>');
  const restore = installDomGlobals(dom);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const submitted: string[] = [];
  const actions = {
    setLabel: (_id: string, value: string) => {
      submitted.push(value);
      return true;
    },
  } as unknown as SmalltableClient;
  const token = { ...makeToken(), publicId: 'A', label: 'A' };
  try {
    await act(async () =>
      root.render(createElement(LabelEditor, { token, actions, connected: true })),
    );
    const input = document.querySelector('input')!;
    await act(async () =>
      input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })),
    );
    await inputValue(input, '中文草稿');
    await act(async () =>
      root.render(
        createElement(LabelEditor, {
          token: { ...token, label: '中文草稿' },
          actions,
          connected: true,
        }),
      ),
    );
    await act(async () =>
      root.render(
        createElement(LabelEditor, {
          token: { ...token, label: '远端' },
          actions,
          connected: true,
        }),
      ),
    );
    assert.equal(input.value, '中文草稿');
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(submitted, []);
    await act(async () =>
      input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true })),
    );
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(submitted, ['中文草稿']);
    await inputValue(input, '五字非法稿');
    assert.equal(document.querySelector('button')!.disabled, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restore();
  }
});
