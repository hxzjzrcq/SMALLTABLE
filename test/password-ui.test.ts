import { createDom, installDomGlobals, inputValue } from './environment';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { PasswordSettings } from '../src/client/components/PasswordSettings';
import { SmalltableClient } from '../src/client/controller';

test('password form requires confirmation, supports separate fields and clears secrets after failures', async () => {
  const dom = createDom('<div id="root"></div>', { url: 'http://localhost' });
  const replacements = {
    confirm: () => allow,
  };
  let allow = false;
  const restoreGlobals = installDomGlobals(dom, replacements);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const calls: unknown[] = [];
  const actions = {
    changePasswords: async (data: unknown) => {
      calls.push(data);
      throw Error('当前 DM 密码错误');
    },
  } as unknown as SmalltableClient;
  const inputs = () => [...document.querySelectorAll('input')];
  const fill = (index: number, value: string) => inputValue(inputs()[index], value);
  const submit = async () =>
    act(async () => {
      document
        .querySelector('form')!
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
  try {
    await act(async () =>
      root.render(createElement(PasswordSettings, { actions, connected: true })),
    );
    assert.equal(inputs().length, 5);
    assert.ok(inputs().every((e) => e.type === 'password'));
    await fill(0, 'Keeper-055-Start');
    await fill(1, 'Room-055-Next');
    await fill(2, 'mismatch');
    await submit();
    assert.equal(calls.length, 0);
    assert.match(document.body.textContent!, /不一致/);
    await fill(2, 'Room-055-Next');
    await submit();
    assert.equal(calls.length, 0);
    allow = true;
    await submit();
    assert.deepEqual(calls, [
      { currentDMPassword: 'Keeper-055-Start', roomPassword: 'Room-055-Next' },
    ]);
    assert.ok(inputs().every((e) => !e.value));
    assert.match(document.body.textContent!, /当前 DM 密码错误/);
    await fill(0, 'Keeper-055-Start');
    await fill(3, 'Keeper-055-Next');
    await fill(4, 'Keeper-055-Next');
    allow = false;
    await submit();
    assert.deepEqual(calls[1], {
      currentDMPassword: 'Keeper-055-Start',
      dmPassword: 'Keeper-055-Next',
    });
    assert.ok(inputs().every((e) => !e.value));
    await act(async () =>
      root.render(createElement(PasswordSettings, { actions, connected: false })),
    );
    assert.ok(inputs().every((e) => e.disabled));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restoreGlobals();
  }
});
