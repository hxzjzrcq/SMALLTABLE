import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, submitLogin } from './support/browser';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';
import { initialRoom } from '../src/shared/model';
import { makeToken, Peer } from './room-fixture';
import { sessionBody } from './helpers';
import type { Page } from 'playwright';
const dir = await mkdtemp(path.join(tmpdir(), 'st-browser-072-'));
const seed = initialRoom();
seed.tokens = Array.from({ length: 255 }, (_, i) => ({
  ...makeToken(),
  name: `普通${i + 1}`,
  x: 10000 + i * 80,
  y: 10000,
}));
for (const [i, publicId] of Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').entries())
  seed.tokens.push({
    ...makeToken(),
    name: '',
    note: '',
    secret: '',
    label: publicId,
    publicId,
    x: 100 + i * 80,
    y: 100,
  });
await writeFile(path.join(dir, 'room.json'), JSON.stringify(seed));
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
const browser = await launchBrowser([
  '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu',
]);
const peers: Peer[] = [];
let checks = 0;
const checked = (message: string) => console.log(`PASS ${++checks}: ${message}`);
const errors: string[] = [];
async function ready(p: Page, predicate: () => boolean) {
  await p.waitForFunction(predicate);
}
async function center(p: Page) {
  return p.locator('.board svg').evaluate((el) => {
    const b = el.getBoundingClientRect(),
      v = (el as SVGSVGElement).viewBox.baseVal;
    return { x: v.x + v.width / 2, y: v.y + v.height / 2, width: b.width, height: b.height };
  });
}
async function layout(p: Page, width: number, height: number) {
  await p.setViewportSize({ width, height });
  await p.waitForTimeout(100);
  const info = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    board: document.querySelector('.board')!.getBoundingClientRect().height,
  }));
  await p.screenshot({ path: `/workspace/scratch/d1ec1fe06b4e/qa-${width}-${height}.png` });
  assert.equal(info.overflow, false, `overflow ${width}x${height}`);
  assert.ok(info.board > 25, JSON.stringify(info));
}
try {
  const dc = await browser.newContext({ viewport: { width: 1366, height: 768 } }),
    pc = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  for (const c of [dc, pc])
    await c.addInitScript(() => {
      const Native = window.Audio;
      const audios: HTMLAudioElement[] = [];
      (window as any).testAudios = audios;
      window.Audio = class extends Native {
        constructor(src?: string) {
          super(src);
          audios.push(this);
        }
      };
      const NativeWS = window.WebSocket;
      const sockets: WebSocket[] = [];
      (window as any).testSockets = sockets;
      window.WebSocket = class extends NativeWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      };
      (window as any).uploadMessages = [];
      new MutationObserver(() => {
        const values = [...document.querySelectorAll('.upload-status')].map((e) => e.textContent);
        for (const value of values)
          if (!(window as any).uploadMessages.includes(value))
            (window as any).uploadMessages.push(value);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
  const dm = await dc.newPage(),
    pl = await pc.newPage();
  for (const p of [dm, pl]) p.on('pageerror', (e) => errors.push(e.message));
  await dm.goto(url);
  await pl.goto(url);
  const loginResponse = dm.waitForResponse((r) => r.url().endsWith('/api/login'));
  await submitLogin(dm, '主持人甲乙丙丁戊', 'keeper');
  assert.equal('token' in (await (await loginResponse).json()), false);
  await submitLogin(pl, 'ABCDEFGHIJKLMNOP', 'room');
  await dm.locator('.app').waitFor();
  await pl.locator('.app').waitFor();
  assert.equal(await dm.locator('.board-token').count(), 281);
  const cookie = (await dc.cookies()).find((c) => c.name === 'tt_room');
  assert.ok(cookie?.httpOnly && cookie.expires > Date.now() / 1000 + 2600);
  assert.ok(!(await dm.evaluate(() => document.cookie)).includes('tt_room'));
  checked(
    '8 Han / 16 ASCII login, HttpOnly cookie-only authentication, maximum 281 rendered tokens',
  );
  // Add fourteen real raw PL peers to reach the default 15 PL + 1 DM configuration.
  for (let i = 0; i < 14; i++) {
    const res = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Peer' + i, password: 'room' }),
    });
    const peer = new Peer(url, (await sessionBody(res)).token);
    peers.push(peer);
    await peer.wait((e) => e.type === 'snapshot');
  }
  await dm.getByText('普通玩家 15 / 15 · DM 1 / 1', { exact: true }).waitFor();
  for (const p of [dm, pl]) await p.getByRole('button', { name: '棋子', exact: true }).click();
  await pl
    .locator('.public-letters button')
    .filter({ hasText: /^A · 桌上$/ })
    .click();
  assert.equal(await pl.getByRole('button', { name: '保存棋面文字', exact: true }).count(), 1);
  await pl.getByLabel('棋面文字（1–4 字符）').fill('四字棋面');
  await pl.getByRole('button', { name: '保存棋面文字', exact: true }).click();
  await dm.getByRole('button', { name: 'A · 四字棋面', exact: true }).waitFor();
  assert.equal(service.getRoom().tokens.find((t) => t.publicId === 'A')!.label, '四字棋面');
  const publicRow = dm
    .locator('.token-list-row')
    .filter({ has: dm.getByRole('button', { name: 'A · 四字棋面', exact: true }) });
  await publicRow.locator('summary').click();
  assert.equal(await publicRow.getByRole('button', { name: /^克隆 / }).isDisabled(), true);
  const normalRow = dm
    .locator('.token-list-row')
    .filter({ has: dm.getByRole('button', { name: '普通1', exact: true }) });
  await normalRow.getByRole('button', { name: '普通1', exact: true }).click();
  dm.once('dialog', (d) => d.accept());
  await dm.locator('.inspector').getByRole('button', { name: '删除', exact: true }).click();
  await dm.waitForFunction(() => document.querySelectorAll('.board-token').length === 280);
  await publicRow.getByRole('button', { name: /^克隆 / }).click();
  await dm.waitForFunction(() => document.querySelectorAll('.board-token').length === 281);
  const copy = service.getRoom().tokens.find((t) => !t.publicId && t.label === '四字棋面')!;
  assert.ok(copy);
  const cloneRow = dm.locator(`[data-token-row-id="${copy.id}"]`);
  await cloneRow.locator('summary').click();
  await cloneRow.getByRole('button', { name: '隐藏', exact: true }).click();
  await dm.waitForFunction((id) => !document.querySelector(`[data-token-id="${id}"]`), copy.id);
  await pl.waitForFunction((id) => !document.querySelector(`[data-token-id="${id}"]`), copy.id);
  await cloneRow.getByRole('button', { name: '定位', exact: true }).click();
  assert.equal(await dm.locator(`[data-token-id="${copy.id}"]`).count(), 0);
  await cloneRow.getByRole('button', { name: '显形', exact: true }).click();
  await dm.locator(`[data-token-id="${copy.id}"]`).waitFor();
  checked(
    'PL changes public label, clone quota boundary, DM hide/locate/reveal excludes both desktops',
  );
  // Return and take into the actual viewport center after panning/zooming.
  await pl
    .locator('.public-letters button')
    .filter({ hasText: /^A · 桌上$/ })
    .click();
  pl.once('dialog', (d) => d.accept());
  await pl.getByRole('button', { name: '归还盒子', exact: true }).click();
  await pl.locator('.public-letters button').filter({ hasText: /^A$/ }).waitFor();
  await pl.getByRole('button', { name: '放大视图', exact: true }).click();
  const before = await center(pl);
  await pl.locator('.public-letters button').filter({ hasText: /^A$/ }).click();
  await pl.waitForFunction(() =>
    Array.from(document.querySelectorAll('.public-letters button')).some(
      (b) => b.textContent === 'A · 桌上',
    ),
  );
  const taken = service.getRoom().tokens.find((t) => t.publicId === 'A')!;
  assert.ok(Math.abs(taken.x - before.x) < 1 && Math.abs(taken.y - before.y) < 1);
  assert.equal(taken.label, 'A');
  assert.equal(service.getRoom().tokens.find((t) => t.id === copy.id)!.label, '四字棋面');
  checked(
    'return resets original identity and label; public take uses panned/scaled viewport center',
  );
  // Create a normal token at the current viewport center using the slot freed by deleting the clone.
  await cloneRow.locator('button[data-board-selection]').click();
  dm.once('dialog', (d) => d.accept());
  await dm.locator('.inspector').getByRole('button', { name: '删除', exact: true }).click();
  await dm.waitForFunction((id) => !document.querySelector(`[data-token-id="${id}"]`), copy.id);
  const dmCenter = await center(dm);
  await dm.getByRole('button', { name: '＋ 无图片棋子', exact: true }).click();
  await dm.waitForFunction(() => document.querySelectorAll('.board-token').length === 281);
  const created = service.getRoom().tokens.at(-1)!;
  assert.ok(!created.publicId);
  assert.ok(Math.abs(created.x - dmCenter.x) < 1 && Math.abs(created.y - dmCenter.y) < 1);
  // Four characters and real pointer drag of a public token; verify another peer converges.
  const aId = taken.id;
  const target = pl.locator(`[data-token-id="${aId}"]`);
  const box = await target.boundingBox();
  assert.ok(box);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await pl.mouse.move(start.x, start.y);
  await pl.mouse.down();
  await pl.mouse.move(start.x + 60, start.y + 35, { steps: 8 });
  await pl.mouse.up();
  await pl.waitForTimeout(200);
  const moved = service.getRoom().tokens.find((t) => t.id === aId)!;
  assert.ok(moved.x > taken.x + 20);
  await dm.waitForFunction(
    ({ id, x }) =>
      document
        .querySelector(`[data-token-id="${id}"]`)
        ?.getAttribute('transform')
        ?.includes(String(x)),
    { id: aId, x: moved.x },
  );
  checked(
    'ordinary create uses local camera center; actual pointer movement converges with 16 peers / 281 tokens',
  );
  // Native Audio remains the same object and continues while management closes.
  await dm.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await dm.getByRole('button', { name: '棋子', exact: true }).click();
  const musicSummary = dm.locator('.music-panel summary');
  await musicSummary.click();
  await dm.locator('.music-panel input[type=file]').setInputFiles({
    name: 'test.mp3',
    mimeType: 'audio/mpeg',
    buffer: await readFile(new URL('./fixtures/tone-long.mp3', import.meta.url)),
  });
  await dm.getByText('音乐已加入库', { exact: true }).waitFor();
  await dm
    .locator('.music-panel details')
    .getByRole('button', { name: '播放', exact: true })
    .click();
  await dm.waitForFunction(() => {
    const a = (window as any).testAudios.at(-1);
    return a && !a.paused && a.currentTime > 0;
  });
  const firstAudio = await dm.evaluate(() => ({
    n: (window as any).testAudios.length,
    time: (window as any).testAudios.at(-1).currentTime,
  }));
  await musicSummary.click();
  await dm.waitForTimeout(500);
  const afterAudio = await dm.evaluate(() => ({
    n: (window as any).testAudios.length,
    time: (window as any).testAudios.at(-1).currentTime,
    paused: (window as any).testAudios.at(-1).paused,
  }));
  assert.equal(firstAudio.n, afterAudio.n);
  assert.equal(afterAudio.paused, false);
  assert.ok(afterAudio.time > firstAudio.time);
  await pl.getByRole('button', { name: '拒绝音乐', exact: true }).click();
  checked(
    'native MP3 upload/play; closing music management preserves Audio object/time and PL can refuse',
  );

  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#4388aa' } })
    .png()
    .toBuffer();
  await dm.getByRole('button', { name: 'DM 工具', exact: true }).click();
  let finishProcess!: () => void;
  const processGate = new Promise<void>((r) => (finishProcess = r));
  const validate = service.storage.validateImage.bind(service.storage);
  service.storage.validateImage = async (...args) => {
    await processGate;
    return validate(...args);
  };
  const mapInput = dm.locator('.dm input[type=file][accept*=image]');
  await mapInput.setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: png });
  await dm.locator('.dm .upload-status').filter({ hasText: '服务器处理中' }).waitFor();
  assert.equal(
    await mapInput.isDisabled(),
    true,
    'same upload entry remains disabled during server processing',
  );
  assert.equal(service.getRoom().maps.length, 0, '100% upload is not a committed map');
  finishProcess();
  await dm.getByText('地图已添加', { exact: true }).waitFor();
  service.storage.validateImage = validate;
  await dm.getByRole('button', { name: '棋子', exact: true }).click();
  await dm.locator(`[data-token-row-id="${created.id}"] button[data-board-selection]`).click();
  await dm
    .locator('.inspector input[type=file]')
    .setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer: png });
  await dm.getByText('图片已准备，点击保存修改后生效', { exact: true }).waitFor();
  await dm.getByRole('button', { name: '保存修改', exact: true }).click();
  await dm.waitForFunction(
    (id) => document.querySelector(`[data-token-id="${id}"] image`),
    created.id,
  );
  const backup = await service.storage.backup(service.getRoom());
  await dm.getByRole('button', { name: 'DM 工具', exact: true }).click();
  dm.once('dialog', (d) => d.accept());
  await dm
    .locator('.dm input[type=file][accept*=zip]')
    .setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: backup });
  await dm.getByText('房间已恢复', { exact: true }).waitFor();
  assert.equal(service.getRoom().tokens.length, 281);
  await dm.getByRole('button', { name: '棋子', exact: true }).click();
  checked(
    'map and token image / ZIP uploads use real HTTP; 100% processing is separate and repeat submission is disabled',
  );
  for (const p of [dm, pl])
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
      [844, 390],
    ]) {
      await layout(p, width, height);
      const toggle = p.getByRole('button', { name: '收起面板', exact: true });
      if (await toggle.isVisible()) {
        await toggle.click();
        await layout(p, width, height);
        await p.getByRole('button', { name: '展开面板', exact: true }).click();
        await p.locator('aside').waitFor({ state: 'visible' });
      }
    }
  // A real socket close + injected temporary recovery HTTP delay exercises readonly desktop and notes retention.
  await pl.evaluate(() => localStorage.setItem('smalltable.private-notes.v1', 'private-072'));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await pl.route('**/api/session', async (route) => {
    await gate;
    await route.continue();
  });
  await pl.evaluate(() => (window as any).testSockets.at(-1).close());
  await pl.waitForFunction(() =>
    document.querySelector('.status')?.textContent?.includes('重连中'),
  );
  assert.equal(await pl.locator('.board-token').count(), 281);
  for (const [width, height] of [
    [1366, 768],
    [390, 844],
    [844, 390],
  ])
    await layout(pl, width, height);
  release();
  await pl.waitForFunction(() =>
    document.querySelector('.status')?.textContent?.includes('已连接'),
  );
  await pl.unroute('**/api/session');
  assert.equal(
    await pl.evaluate(() => localStorage.getItem('smalltable.private-notes.v1')),
    'private-072',
  );
  checked(
    'DM/PL desktop, 390×844 portrait, 844×390 landscape, sidebar open/closed, playback and reconnect layouts',
  );

  // A touch-capable browser context exercises mobile controls and actual touch input.
  peers.pop()!.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(url);
  await submitLogin(mobile, '手机玩家', 'room');
  await mobile.locator('.app').waitFor();
  await mobile.getByRole('button', { name: '棋子', exact: true }).tap();
  await mobile
    .locator('.public-letters button')
    .filter({ hasText: /^A · 桌上$/ })
    .tap();
  await mobile.getByLabel('棋面文字（1–4 字符）').fill('手机四字');
  await mobile.getByRole('button', { name: '保存棋面文字', exact: true }).tap();
  const aRow = mobile.locator(`[data-token-row-id="${aId}"]`);
  await aRow.locator('summary').tap();
  await aRow.getByRole('button', { name: '定位', exact: true }).tap();
  await mobile.getByRole('button', { name: '收起面板', exact: true }).tap();
  const touchBox = await mobile.locator(`[data-token-id="${aId}"]`).boundingBox();
  assert.ok(touchBox);
  const touchBefore = { ...service.getRoom().tokens.find((t) => t.id === aId)! };
  const cdp = await mobileContext.newCDPSession(mobile);
  const tx = touchBox.x + touchBox.width / 2,
    ty = touchBox.y + touchBox.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: tx, y: ty }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: tx + 35, y: ty + 20 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Release the injected gesture before returning to the high-level tap driver.
  await cdp.detach();
  await mobile.waitForTimeout(1000);
  const touchAfter = service.getRoom().tokens.find((t) => t.id === aId)!;
  assert.ok(touchAfter.x > touchBefore.x + 10);
  await mobile.getByRole('button', { name: '展开面板', exact: true }).tap();

  await mobile.locator('aside').waitFor({ state: 'visible' });
  await layout(mobile, 390, 844);
  await layout(mobile, 844, 390);
  checked(
    'touch-capable mobile: tap public controls, four-Han label, locate, collapse/reopen and actual touch drag',
  );
  const messages = await dm.evaluate(() => (window as any).uploadMessages);
  assert.ok(messages.some((s: string) => s.includes('服务器处理中')));
  assert.ok(messages.some((s: string) => s.includes('完成')));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      browser: browser.version(),
      uploadMessages: messages,
      scope: 'browser simulation, no physical device',
    }),
  );
} finally {
  peers.forEach((p) => p.ws.terminate());
  await browser.close();
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
