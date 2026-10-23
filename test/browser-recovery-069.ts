import { launchBrowser, submitLogin } from './support/browser';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { createSmalltable } from './helpers';
import { config } from '../src/server/config';

// Use the checked-in Vite configuration and its actual 5173 -> 3000 proxy route.
const dir = await mkdtemp(path.join(tmpdir(), 'st-dev-069-'));
const service = await createSmalltable(
  { ...config(), dataDir: dir },
  {
    roomPassword: 'Room-Dev-069',
    dmPassword: 'Keeper-Dev-069',
  },
);
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(3000, '127.0.0.1', resolve);
  });
  vite = await createServer({ server: { port: 5173, strictPort: true, host: '127.0.0.1' } });
  await vite.listen();
  browser = await launchBrowser([
    '--no-zygote',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
  ]);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('PAGEERROR', e.message);
  });
  page.on('response', async (r) => {
    if (r.url().includes('/api/') && r.status() >= 400)
      console.log('HTTP', r.status(), r.url(), await r.text());
  });
  // Retain an observation reference to the native audio element, without mocking playback.
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    (window as any).observedAudios = [];
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        (window as any).observedAudios.push(this);
      }
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await submitLogin(page, 'Keeper', 'Keeper-Dev-069');
  await page.locator('.app').waitFor();
  await page.locator('.music-panel summary').click();
  await page.locator('.music-panel input[type=file]').setInputFiles({
    name: 'tone.mp3',
    mimeType: 'audio/mpeg',
    buffer: await readFile(new URL('./fixtures/tone-long.mp3', import.meta.url)),
  });
  await page.getByText('音乐已加入库', { exact: true }).waitFor();
  const audioResponse = page.waitForResponse(
    (r) => r.url().includes(':5173/audio/') && [200, 206].includes(r.status()),
  );
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const response = await audioResponse;
  assert.match(response.headers()['content-type'], /audio\/mpeg/);
  await page.waitForFunction(() => {
    const a = (window as any).observedAudios.at(-1);
    return a && !a.paused && a.currentTime > 0.1 && !a.error;
  });
  console.log(
    'PASS: actual Vite 5173 music upload, Cookie-authenticated audio proxy and native playback',
  );
  await page.getByRole('button', { name: '先攻盘', exact: true }).click();
  await page.getByLabel('先攻名字', { exact: true }).fill('draft069');
  await page.getByRole('button', { name: '属性工具', exact: true }).click();
  await page.locator('iframe').waitFor();
  await page.frameLocator('iframe').locator('body').waitFor();
  await page.evaluate(() => {
    (window as any).retainedFrame = document.querySelector('iframe');
    (document.querySelector('iframe')!.contentWindow as any).retained069 = 'alive';
  });
  await page.getByRole('button', { name: '返回桌面', exact: true }).click();
  await page.route('**/api/session', (route) => route.abort());
  await page.evaluate(async () => {
    const controllerPath = '/src/client/controller.ts';
    const { smalltable } = await import(controllerPath);
    smalltable.ws.close();
  });
  await page
    .getByText('重连失败，可手动重试或离开房间', { exact: true })
    .waitFor({ timeout: 100000 });
  assert.equal(await page.locator('.app').count(), 1);
  assert.equal(await page.locator('.st-login-submit').count(), 0);
  assert.equal(await page.getByLabel('先攻名字', { exact: true }).inputValue(), 'draft069');
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector('iframe') === (window as any).retainedFrame &&
        (document.querySelector('iframe')!.contentWindow as any).retained069 === 'alive',
    ),
  );
  assert.ok(await page.getByRole('button', { name: '重试进入', exact: true }).isEnabled());
  console.log(
    'PASS: ten failed automatic retries preserve desktop, initiative draft and live iframe; manual retry available',
  );
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: '重试进入', exact: true }).click();
  await page.locator('.dot.online').waitFor();
  await page.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await page.getByRole('button', { name: '锁定工具箱', exact: true }).waitFor();
  assert.equal(await page.getByLabel('先攻名字', { exact: true }).inputValue(), 'draft069');
  assert.ok(
    await page.evaluate(
      () => (document.querySelector('iframe')!.contentWindow as any).retained069 === 'alive',
    ),
  );
  console.log(
    'PASS: manual recovery restores authoritative DM state without remounting iframe or initiative',
  );
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PLAYER_FULL', error: '房间人数已满' }),
    }),
  );
  await page.evaluate(async () => {
    const controllerPath = '/src/client/controller.ts';
    const { smalltable } = await import(controllerPath);
    smalltable.ws.close();
  });
  await page.getByText('房间人数已满', { exact: true }).waitFor();
  assert.equal(await page.locator('.app').count(), 1);
  assert.equal(await page.getByLabel('先攻名字', { exact: true }).inputValue(), 'draft069');
  assert.ok(await page.getByRole('button', { name: '重试进入', exact: true }).isEnabled());
  await page.unroute('**/api/session');
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ID_CONFLICT', error: 'ID occupied' }),
    }),
  );
  await page.getByRole('button', { name: '重试进入', exact: true }).click();
  await page.getByText('原临时 ID 已被使用，请更换 ID 并重新登录', { exact: true }).waitFor();
  assert.equal(await page.locator('.app').count(), 0);
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(await page.getByRole('button', { name: '重试进入', exact: true }).count(), 0);
  console.log(
    'PASS: injected full/conflict recovery responses retain desktop only for full; conflict requests new ID and removes stale retry',
  );
  await page.unroute('**/api/session');
  await submitLogin(page, 'NewID', 'Keeper-Dev-069');
  await page.locator('.app').waitFor();
  await page.getByRole('button', { name: '离开房间', exact: true }).click();
  await page.locator('.st-login-submit').waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: explicit logout unmounts desktop; no uncaught browser errors');
} finally {
  await browser?.close();
  await vite?.close();
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
