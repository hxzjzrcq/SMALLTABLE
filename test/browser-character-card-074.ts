import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, submitLogin } from './support/browser';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';

const dir = await mkdtemp(path.join(tmpdir(), 'st-card-browser-074-'));
const service = await createSmalltable(
  { ...config(), dataDir: dir },
  {
    roomMatches: async (p) => p === 'room',
    dmMatches: async (p) => p === 'keeper',
    change: async () => {},
  },
);
await new Promise<void>((r) => service.server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
const browser = await launchBrowser();
const errors: string[] = [],
  sent: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { testSockets: WebSocket[] }).testSockets = sockets;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text()))
      errors.push(m.text());
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(response.status() === 401 && pathname === '/api/session'))
      errors.push(`${response.status()} ${pathname}`);
  });
  page.on('websocket', (ws) => ws.on('framesent', (e) => sent.push(String(e.payload))));
  await page.goto(url);
  await submitLogin(page, '主持人', 'keeper');
  await page.locator('.board svg').waitFor();
  await page.locator('.tabs button').filter({ hasText: '棋子' }).click();
  await page.getByRole('button', { name: '＋ 无图片棋子', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 1);
  const initial = JSON.stringify(service.getRoom());
  await page.getByRole('button', { name: '角色卡管理', exact: true }).click();
  const tool = page.locator('.character-card-tool'),
    frame = page.frameLocator('iframe[title="自由角色卡"]');
  await frame.locator('[data-list=passive] .project').first().waitFor();
  assert.equal(await frame.locator('[aria-label=NAME]').inputValue(), '');
  assert.match(
    (await frame.locator('[aria-label=NAME]').getAttribute('placeholder')) || '',
    /汉娜/,
  );
  assert.deepEqual(await frame.locator('[data-list=passive] .result').allTextContents(), [
    '12',
    '12',
  ]);
  const privateText = 'LOCAL-CARD-ONLY-074';
  await frame.locator('[aria-label=NAME]').fill(privateText);
  const raw = frame.locator('[data-list=active] .project').first().locator('.raw');
  await raw.nth(1).fill('+4');
  assert.equal(await frame.locator('[data-list=active] .result').first().innerText(), '6');
  const passive = frame.locator('#sheet section').nth(2);
  await passive.getByRole('button', { name: '收起草稿纸' }).click();
  assert.equal(await passive.locator('.rows').first().isVisible(), false);
  const abilities = frame.locator('[data-list=abilities]');
  await abilities.locator('.tag-open').first().click();
  await frame.locator('#tag-detail').fill('私有长详情\n'.repeat(300));
  await frame.locator('#tag-form').getByRole('button', { name: '保存', exact: true }).click();
  await abilities.getByRole('button', { name: '增加 回气' }).click();
  assert.equal(await abilities.locator('.tag-count').first().innerText(), '3');
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    frame.locator('#json').click(),
  ]);
  const json = await readFile((await jsonDownload.path())!, 'utf8');
  assert.equal(JSON.parse(json).name, privateText);
  assert.equal(JSON.parse(json).quick, '');
  const [txtDownload] = await Promise.all([
    page.waitForEvent('download'),
    frame.locator('#txt').click(),
  ]);
  assert.match(await readFile((await txtDownload.path())!, 'utf8'), /未计算：1D8/);
  await frame.locator('#saved').click();
  await frame
    .locator('#file')
    .setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(json) });

  await frame.locator('#status').filter({ hasText: '当前卡已载入' }).waitFor();
  assert.equal(await frame.locator('[aria-label=NAME]').inputValue(), privateText);
  // The card's own dialog owns Escape; an outer close must not also fire.
  await abilities.locator('.tag-open').first().click();
  await frame.locator('#tag-name').press('Escape');
  assert.equal(await frame.locator('#tag-dialog').isVisible(), false);
  assert.equal(await tool.isVisible(), true);
  // Mouse sort inside iframe: preview and insertion line must not hit-test as the target.
  const tags = abilities.locator('.tag-wrap');
  await tags.first().scrollIntoViewIfNeeded();
  const from = await tags.nth(1).locator('.handle').boundingBox(),
    to = await tags.first().boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + 8, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + 12, { steps: 12 });
  await frame.locator('.drag-ghost').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await frame.locator('.drag-ghost').count(), 0);
  assert.equal(await tool.isVisible(), true);
  await page.mouse.move(from.x + 8, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + 12, { steps: 12 });
  await page.mouse.up();
  assert.equal(await abilities.locator('.tag-open').first().innerText(), '武器精通：匕首');
  await page.keyboard.press('Delete');
  assert.equal(JSON.stringify(service.getRoom()), initial);
  await page.getByRole('button', { name: '返回桌面', exact: true }).click();
  assert.equal(await tool.isVisible(), false);
  await page.getByRole('button', { name: '角色卡管理', exact: true }).click();
  assert.equal(await frame.locator('[aria-label=NAME]').inputValue(), privateText);
  assert.equal(await abilities.locator('.tag-open').first().innerText(), '武器精通：匕首');
  await frame.locator('[aria-label=NAME]').press('Escape');
  assert.equal(await tool.isVisible(), false);
  await page.getByRole('button', { name: '角色卡管理', exact: true }).click();
  await page.screenshot({ path: path.join(tmpdir(), 'st-card-074-desktop.png') });
  console.log(
    'PASS production: default card/placeholders, arithmetic, tag detail/count, collapse, mouse sorting/preview, nested Escape, Delete guard, close/reopen, JSON/TXT downloads and import',
  );

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mobile.newPage();
  mp.on('pageerror', (e) => errors.push(e.message));
  await mp.goto(url);
  await submitLogin(mp, '玩家', 'room');
  await mp.locator('.board svg').waitFor();
  await mp.getByRole('button', { name: '角色卡管理', exact: true }).click();
  const mf = mp.frameLocator('iframe[title="自由角色卡"]');
  await mf.locator('[data-list=passive] .project').first().waitFor();
  assert.equal(await mf.locator('[aria-label=NAME]').inputValue(), '');
  assert.equal(await mf.locator('[data-list=abilities] .tag-open').first().innerText(), '回气');
  const modalBox = await mp.locator('.character-card-tool').boundingBox();
  assert.ok(modalBox && modalBox.x >= 0 && modalBox.x + modalBox.width <= 390);
  const child = mp.frames().find((f) => f.url().endsWith('/character-card.html'))!;
  assert.ok(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const list = mf.locator('[data-list=active]');
  await list.scrollIntoViewIfNeeded();
  const listBox = await list.boundingBox();
  assert.ok(listBox);
  const cdp = await mobile.newCDPSession(mp);
  async function touch(points: { x: number; y: number }[]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
    for (const point of points.slice(1))
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await touch([
    { x: 330, y: listBox.y + 80 },
    { x: 260, y: listBox.y + 80 },
    { x: 170, y: listBox.y + 80 },
    { x: 65, y: listBox.y + 80 },
  ]);
  await child.waitForFunction(() => document.querySelector('[data-list=active]')!.scrollLeft > 0);
  const mtags = mf.locator('[data-list=abilities]');
  await mtags.locator('.tag-wrap').first().scrollIntoViewIfNeeded();
  const mh = await mtags.locator('.handle').nth(1).boundingBox(),
    mt = await mtags.locator('.tag-wrap').first().boundingBox();
  assert.ok(mh && mt);
  await touch([
    { x: mh.x + 8, y: mh.y + 10 },
    { x: mt.x + 5, y: mt.y + 10 },
  ]);
  await mtags.locator('.tag-open').first().filter({ hasText: '武器精通：匕首' }).waitFor();
  assert.equal(await mf.locator('dialog[open]').count(), 0);
  await mtags.locator('.tag-open').first().click();
  const innerDialog = await mf.locator('#tag-dialog').boundingBox();
  assert.ok(innerDialog && innerDialog.x >= 0 && innerDialog.x + innerDialog.width <= 390);
  await mf.locator('#cancel').click();
  await mp.screenshot({ path: path.join(tmpdir(), 'st-card-074-mobile.png') });
  await mp.getByRole('button', { name: '返回桌面', exact: true }).click();
  assert.equal(await mp.locator('.character-card-tool').isVisible(), false);
  console.log(
    'PASS mobile simulation: player entry, no horizontal page overflow, fixed horizontal calculators, native touch scroll vs handle sort, nested detail and persistent return button',
  );
  assert.equal(JSON.stringify(service.getRoom()), initial);
  assert.ok(sent.every((s) => !s.includes(privateText) && !s.includes('私有长详情')));
  assert.deepEqual(errors, []);
  console.log(
    'PASS private card data never enters room state or outgoing room socket; separate player starts with default card; unchanged CSP has no browser errors',
  );
  // Reload is intentionally a new in-memory card, while the current page's save semantics stay explicit.
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.locator('.board svg').waitFor();
  await page.getByRole('button', { name: '角色卡管理', exact: true }).click();
  await frame.locator('[data-list=passive] .project').first().waitFor();
  assert.equal(await frame.locator('[aria-label=NAME]').inputValue(), '');
  console.log('PASS refresh returns to default example card (no auto-draft)');
  await frame.locator('[aria-label=NAME]').fill('重连保留');
  await page
    .locator('iframe[title=自由角色卡]')
    .evaluate((el) => el.setAttribute('data-persist-test', 'yes'));
  await page.evaluate(() => {
    for (const socket of (window as unknown as { testSockets: WebSocket[] }).testSockets)
      socket.close();
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { testSockets: WebSocket[] }).testSockets.length >= 2 &&
      document.querySelector('.status')?.textContent?.includes('已连接'),
  );
  assert.equal(
    await page.locator('iframe[title=自由角色卡]').getAttribute('data-persist-test'),
    'yes',
  );
  assert.equal(await frame.locator('[aria-label=NAME]').inputValue(), '重连保留');
  console.log('PASS controlled WebSocket close/reconnect keeps the same frame and local card');
} finally {
  await browser.close();
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
