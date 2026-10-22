import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { fixture, roomPassword, dmPassword, token, drawing } from './support/management-fixture';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { waitEvent } from './helpers';
const f = await fixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SMALLTABLE_CHROMIUM ? { executablePath: process.env.SMALLTABLE_CHROMIUM } : {}),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=user-gesture-required',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
async function join(p: Page) {
  await p.goto(f.url);
  await login(p);
}
async function login(p: Page) {
  await p.locator('#st-login-password').fill(roomPassword);
  await p.getByRole('button', { name: '进入房间', exact: true }).click();
  await p.getByRole('button', { name: '属性工具', exact: true }).waitFor();
}
async function waitText(p: Page, text: string) {
  await p.getByText(text, { exact: true }).waitFor();
}
async function audioState(p: Page) {
  return p.evaluate(() => {
    const a = (window as unknown as { testAudios: HTMLAudioElement[] }).testAudios.at(-1);
    return a
      ? { time: a.currentTime, paused: a.paused, ready: a.readyState, error: a.error?.code }
      : null;
  });
}
try {
  const manager = await f.peer();
  await manager.unlock();
  const data = await readFile(new URL('./fixtures/tone-long.mp3', import.meta.url));
  for (const name of ['A.mp3', 'B.mp3']) {
    const res = await fetch(f.url + '/api/music', {
      method: 'POST',
      headers: {
        ...manager.headers,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': name,
      },
      body: new Uint8Array(data),
    });
    assert.equal(res.status, 200);
  }
  const [a, b] = f.service.music.tracks;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  for (const c of contexts)
    await c.addInitScript(() => {
      const NativeSocket = window.WebSocket;
      const sockets: WebSocket[] = [];
      Object.defineProperty(window, 'testSockets', { value: sockets });
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      };
      const Native = window.Audio;
      const store: HTMLAudioElement[] = [];
      Object.defineProperty(window, 'testAudios', { value: store });
      window.Audio = class extends Native {
        constructor(src?: string) {
          super(src);
          store.push(this);
        }
      };
    });
  const [dm, accept, reject] = await Promise.all(contexts.map((c) => c.newPage()));
  const requests: Record<string, number> = { accept: 0, reject: 0 };
  let acceptedSockets = 0;
  accept.on('websocket', () => acceptedSockets++);
  accept.on('request', (r) => {
    if (r.url().includes('/audio/')) requests.accept++;
  });
  reject.on('request', (r) => {
    if (r.url().includes('/audio/')) requests.reject++;
  });
  await Promise.all([join(dm), join(accept), join(reject)]);
  await dm.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await dm.getByLabel('DM 密码', { exact: true }).fill(dmPassword);
  await dm.getByRole('button', { name: '解锁工具箱', exact: true }).click();
  await dm.getByText('已解锁', { exact: true }).waitFor();
  await dm.getByText(/音乐管理/).click();
  const play = (name: string) =>
    dm
      .locator('.music-panel .button-row')
      .filter({ hasText: name })
      .getByRole('button', { name: '播放', exact: true })
      .click();
  await play('A.mp3');
  await accept.getByRole('button', { name: '接受音乐', exact: true }).waitFor();
  assert.equal(requests.accept, 0);
  assert.equal(requests.reject, 0);
  await reject.getByRole('button', { name: '拒绝音乐', exact: true }).click();
  await waitText(reject, '本地：已拒绝');
  assert.equal(requests.reject, 0);
  await accept.getByRole('button', { name: '接受音乐', exact: true }).click();
  await accept.waitForFunction(() => {
    const a = (window as any).testAudios.at(-1);
    return a?.readyState >= 1;
  });
  // With strict native autoplay policy, either real playback succeeds or a real blocked state appears.
  await accept.waitForFunction(() =>
    /本地：(播放中|受浏览器阻止)/.test(document.body.textContent ?? ''),
  );
  const blocked = await accept.getByText('本地：受浏览器阻止', { exact: true }).isVisible();
  if (blocked) await accept.getByRole('button', { name: '点击播放', exact: true }).click();
  await waitText(accept, '本地：播放中');
  await dm.waitForFunction(() =>
    /本地：(播放中|受浏览器阻止)/.test(document.body.textContent ?? ''),
  );
  if (await dm.getByText('本地：受浏览器阻止', { exact: true }).isVisible())
    await dm.getByRole('button', { name: '点击播放', exact: true }).click();
  await waitText(dm, '本地：播放中');
  await accept.waitForTimeout(1200);
  const state = await audioState(accept),
    p = f.service.music.snapshot().playback;
  const expected = p.position + (Date.now() - p.updatedAt) / 1000;
  assert.ok(
    state && !state.paused && Math.abs(state.time - expected) <= 2,
    JSON.stringify({ state, expected }),
  );
  console.log(
    'AUDIO_SYNC_SECONDS',
    Math.abs(state!.time - expected),
    'strictAutoplayBlocked',
    blocked,
  );
  await dm.getByRole('button', { name: '暂停全桌音乐', exact: true }).click();
  await waitText(accept, '本地：暂停');
  const paused = (await audioState(accept))!.time;
  await accept.waitForTimeout(400);
  assert.ok(Math.abs((await audioState(accept))!.time - paused) < 0.1);
  await play('A.mp3');
  await waitText(accept, '本地：播放中');
  assert.equal(await accept.getByRole('button', { name: '接受音乐', exact: true }).count(), 0);
  await dm.getByRole('button', { name: '停止全桌音乐', exact: true }).click();
  await waitText(accept, '本地：停止');
  assert.equal((await audioState(accept))!.time, 0);
  await play('A.mp3');
  await waitText(accept, '本地：播放中');
  assert.equal(requests.reject, 0);
  await play('B.mp3');
  await accept.getByRole('button', { name: '接受音乐', exact: true }).waitFor();
  assert.equal((await audioState(accept))!.paused, true);
  const stalePrompt = await accept
    .getByRole('button', { name: '接受音乐', exact: true })
    .elementHandle();
  const beforeAccept = requests.accept;
  await play('A.mp3');
  await accept.getByRole('button', { name: '接受音乐', exact: true }).waitFor();
  assert.equal(requests.accept, beforeAccept);
  await stalePrompt!.evaluate((b: HTMLButtonElement) => b.click());
  assert.equal(requests.accept, beforeAccept);
  assert.equal(await accept.getByRole('button', { name: '接受音乐', exact: true }).count(), 1);
  // Reject the new A push: the previous accepted A push does not authorize it.
  await accept.getByRole('button', { name: '拒绝音乐', exact: true }).click();
  await accept.reload();
  await login(accept);
  await waitText(accept, '本地：已拒绝');
  assert.equal(requests.accept, beforeAccept);
  // New B push overrides the refusal. Acceptance survives refresh and actual socket reconnect.
  await play('B.mp3');
  await accept.getByRole('button', { name: '接受音乐', exact: true }).click();
  await accept.waitForFunction(() =>
    /本地：(播放中|受浏览器阻止)/.test(document.body.textContent ?? ''),
  );
  if (await accept.getByText('本地：受浏览器阻止', { exact: true }).isVisible())
    await accept.getByRole('button', { name: '点击播放', exact: true }).click();
  await waitText(accept, '本地：播放中');
  await accept.reload();
  await login(accept);
  assert.equal(await accept.getByRole('button', { name: '接受音乐', exact: true }).count(), 0);
  await accept.waitForFunction(() =>
    /本地：(播放中|受浏览器阻止)/.test(document.body.textContent ?? ''),
  );
  const beforeReconnect = acceptedSockets;
  await accept.evaluate(() => {
    (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)!.close(4000, '测试断线');
  });
  const reconnectDeadline = Date.now() + 8000;
  while (acceptedSockets === beforeReconnect && Date.now() < reconnectDeadline)
    await accept.waitForTimeout(50);
  assert.ok(acceptedSockets > beforeReconnect, 'new WebSocket was opened by reconnect');
  await accept.waitForFunction(() =>
    document.querySelector('.status')?.textContent?.includes('已连接'),
  );
  assert.equal(await accept.getByRole('button', { name: '接受音乐', exact: true }).count(), 0);
  const fresh = await contexts[1].newPage();
  await join(fresh);
  await fresh.getByRole('button', { name: '接受音乐', exact: true }).waitFor();
  await fresh.close();
  assert.equal(requests.reject, 0);
  // A new accepted push with a deliberately failed HTTP transfer reports a local load failure.
  await accept.route('**/audio/**', (route) => route.abort('failed'));
  await play('A.mp3');
  await accept.getByRole('button', { name: '接受音乐', exact: true }).click();
  await waitText(accept, '本地：加载失败');
  await accept.unroute('**/audio/**');
  // Deleting the current track cancels the other tab's outstanding prompt and stops all local media.
  dm.once('dialog', (d) => void d.accept());
  await dm
    .locator('.music-panel .button-row')
    .filter({ hasText: 'A.mp3' })
    .getByRole('button', { name: '删除曲目', exact: true })
    .click();
  await reject.getByText('全桌：停止 · 无曲目', { exact: true }).waitFor();
  assert.equal(await reject.getByRole('button', { name: '接受音乐', exact: true }).count(), 0);
  assert.equal((await audioState(accept))!.paused, true);
  for (const c of contexts) await c.close();
  console.log('BROWSER_MUSIC_PASS');
} finally {
  await browser.close();
  await f.close();
}
