import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installShortcuts } from '../src/client/shortcuts';
test('shortcut guards, cancellation consumption and listener cleanup', () => {
  const dom = new JSDOM(
    '<input><textarea></textarea><select></select><button>x</button><div contenteditable="true"><span></span></div><dialog></dialog>',
  );
  const w = dom.window;
  let calls = 0,
    enabled = true;
  const stop = installShortcuts(w as unknown as Window, [
    {
      key: 'Delete',
      enabled: () => enabled,
      run: () => {
        calls++;
      },
    },
  ]);
  function press(target: EventTarget = w, init: KeyboardEventInit = {}) {
    const event = new w.KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  try {
    for (const el of w.document.querySelectorAll('input,textarea,select,button,span'))
      assert.equal(press(el), false);
    for (const init of [
      { repeat: true },
      { isComposing: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
      { key: 'Backspace' },
    ])
      assert.equal(press(w, init), false);
    const dialog = w.document.querySelector('dialog')!;
    dialog.setAttribute('open', '');
    assert.equal(press(), false);
    dialog.removeAttribute('open');
    enabled = false;
    assert.equal(press(), false);
    enabled = true;
    assert.equal(press(), true);
    assert.equal(calls, 1);
    stop();
    stop();
    assert.equal(press(), false);
    assert.equal(calls, 1);
  } finally {
    stop();
    w.close();
  }
});
