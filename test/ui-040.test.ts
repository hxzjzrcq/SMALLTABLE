import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../src/client/components/Board';
import { Inspector } from '../src/client/components/Inspector';
import { initialRoom } from '../src/shared/model';
import type { SmalltableClient } from '../src/client/controller';
import { readFile } from 'node:fs/promises';

test('selection-only rotation and player public-note-only controls', () => {
  const token = {
    id: '00000000-0000-4000-8000-000000000001',
    name: '测试',
    label: '1',
    shape: 'square' as const,
    color: '#3872a4',
    x: 64,
    y: 64,
    size: 1,
    angle: 45,
    asset: null,
    note: 'HP 12/20',
  };
  const actions = {} as SmalltableClient;
  const props = {
    room: { ...initialRoom(), tokens: [token] },
    selected: null as string | null,
    onSelect: () => {},
    actions,
    tool: 'move' as const,
    fitSignal: 0,
    epoch: 0,
    connected: true,
  };
  assert.ok(!renderToStaticMarkup(createElement(Board, props)).includes('token-rotate'));
  const selected = renderToStaticMarkup(createElement(Board, { ...props, selected: token.id }));
  assert.match(selected, /class="token-rotate"/);
  assert.match(selected, /顺时针旋转棋子 45°/);
  const player = renderToStaticMarkup(
    createElement(Inspector, { token, dm: false, connected: true, actions }),
  );
  assert.match(player, /保存公开注释/);
  assert.match(player, /HP 12\/20/);
  assert.ok(!player.includes('DM 私有说明'));
  assert.ok(!player.includes('删除'));
});

test('batch UI has no mounted entry and create control belongs to token panel', async () => {
  const dnd = await readFile(new URL('../src/dndroll/App.tsx', import.meta.url), 'utf8');
  assert.ok(!dnd.includes('BatchPanel'));
  const app = await readFile(new URL('../src/client/App.tsx', import.meta.url), 'utf8');
  const toolbar = app.slice(
    app.indexOf('<nav className="toolbar"'),
    app.indexOf('<main className="workspace"'),
  );
  assert.ok(!toolbar.includes('无图片棋子'));
  const tokenPanel = app.slice(
    app.indexOf("<div hidden={tab !== 'tokens'}>"),
    app.indexOf("<div hidden={tab !== 'notes'}>"),
  );
  assert.match(tokenPanel, /dm &&/);
  assert.match(tokenPanel, /无图片棋子/);
});
