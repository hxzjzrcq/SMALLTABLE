import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DndApp from '../src/dndroll/App';
import { AbilityTool } from '../src/client/components/AbilityTool';
import type { SmalltableClient } from '../src/client/controller';
test('embedded UI completes a Core-backed session; modal preserves frame and filters activity messages', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
  });
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const container = dom.window.document.getElementById('root')!;
  let root = createRoot(container);
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    assert.ok(button, label);
    await act(async () => button.click());
  }
  try {
    await act(async () => root.render(createElement(DndApp, { rng: () => 4 })));
    assert.equal(document.documentElement.dataset.theme, 'light');
    await act(async () => container.querySelector<HTMLButtonElement>('.method-card')!.click());
    await click('开始生成');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="掷骰"]')!.click(),
    );
    await click('确认完成并锁定');
    assert.equal(container.querySelectorAll('.complete-panel .final-score').length, 6);
    assert.ok(
      [...container.querySelectorAll('.complete-panel .final-score')].every(
        (e) => e.textContent === '12',
      ),
    );
    assert.ok(localStorage.getItem('smalltable.dndroll.session.v1'));
    assert.equal(localStorage.getItem('dndroll.session.v1'), null);
    await act(async () => root.unmount());
    root = createRoot(container);
    let pulses = 0;
    const actions = {
      activity: () => {
        pulses++;
      },
    } as unknown as SmalltableClient;
    const render = (open: boolean) =>
      createElement(AbilityTool, { open, onClose: () => {}, actions });
    await act(async () => root.render(render(true)));
    const frame = container.querySelector('iframe')!;
    assert.equal(frame.getAttribute('src'), '/dndroll.html');
    window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        origin: 'http://localhost',
        source: frame.contentWindow,
        data: { type: 'smalltable.tool-activity' },
      }),
    );
    assert.equal(pulses, 1);
    window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        origin: 'https://wrong.example',
        source: frame.contentWindow,
        data: { type: 'smalltable.tool-activity' },
      }),
    );
    assert.equal(pulses, 1);
    await act(async () => root.render(render(false)));
    assert.equal(container.querySelector('iframe'), frame);
    await act(async () => root.render(render(true)));
    assert.equal(container.querySelector('iframe'), frame);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
