import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDom, installDomGlobals } from './environment';
import { CharacterCardTool } from '../src/client/components/CharacterCardTool';
import type { SmalltableClient } from '../src/client/controller';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';

test('card dialog loads lazily, preserves frame, filters activity/close messages and cleans listeners', async () => {
  const dom = createDom();
  const restore = installDomGlobals(dom);
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  let pulses = 0,
    closes = 0;
  const actions = { activity: () => pulses++ } as unknown as SmalltableClient;
  const onClose = () => closes++;
  const render = async (open: boolean) => {
    await act(async () =>
      root.render(createElement(CharacterCardTool, { open, onClose, actions })),
    );
  };
  try {
    await render(false);
    assert.equal(document.querySelector('iframe'), null);
    await render(true);
    const frame = document.querySelector('iframe')!;
    assert.equal(frame.getAttribute('src'), '/character-card.html');
    const message = (type: string, origin = 'http://localhost', source = frame.contentWindow) =>
      window.dispatchEvent(
        new dom.window.MessageEvent('message', { origin, source, data: { type } }),
      );
    message('smalltable.tool-activity');
    assert.equal(pulses, 1);
    message('smalltable.tool-activity', 'https://wrong.example');
    message('smalltable.tool-activity', 'http://localhost', dom.window as unknown as Window);
    assert.equal(pulses, 1);
    message('smalltable.character-card-close', 'https://wrong.example');
    assert.equal(closes, 0);
    message('smalltable.character-card-close');
    assert.equal(closes, 1);
    await render(false);
    assert.equal(document.querySelector('iframe'), frame);
    assert.equal(document.querySelector('dialog')!.hasAttribute('open'), false);
    await render(true);
    assert.equal(document.querySelector('iframe'), frame);
    await act(async () => root.unmount());
    message('smalltable.tool-activity');
    assert.equal(pulses, 1);
  } finally {
    dom.window.close();
    restore();
  }
});

test('production card and every compiled asset load under unchanged CSP without room mutation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'st-card-074-'));
  const service = await createSmalltable(
    { ...config(), dataDir: dir },
    { roomMatches: async () => false, dmMatches: async () => false, change: async () => {} },
  );
  await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
    const response = await fetch(url + '/character-card.html');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy')!, /script-src 'self';/);
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    const html = await response.text();
    assert.ok(!/<script(?![^>]*src=)[^>]*>\s*\S/.test(html));
    const assets = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map((m) => m[1]);
    assert.ok(assets.length >= 2);
    for (const asset of assets) assert.equal((await fetch(url + asset)).status, 200, asset);
    assert.equal(service.getRoom().revision, 0);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
