import { launchBrowser, submitLogin } from './support/browser';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { fixture, roomPassword, dmPassword } from './support/management-fixture';
const f = await fixture();
const browser = await launchBrowser(['--no-zygote', '--disable-gpu']);
let checks = 0;
const checked = (s: string) => console.log(`PASS ${++checks}: ${s}`);
async function login(p: Page, name: string, password: string) {
  await p.goto(f.url);
  await submitLogin(p, name, password);
  await p.locator('.app').waitFor();
}
try {
  const player = await browser.newPage(),
    dm = await browser.newPage();
  const errors: string[] = [];
  for (const p of [player, dm]) p.on('pageerror', (e) => errors.push(e.message));
  await player.goto(f.url);
  await player.locator('#st-login-name').waitFor();
  assert.equal(await player.locator('.st-login-version').textContent(), 'v0.7.3');
  checked('no-session local production visit shows normal login and version 0.7.3');
  await login(player, 'Player', roomPassword);
  await login(dm, 'Keeper', dmPassword);
  for (const p of [player, dm]) {
    await p.evaluate(() => localStorage.setItem('smalltable.private-notes.v1', '私人笔记070'));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await p.route('**/api/session', async (route) => {
      await gate;
      await route.continue();
    });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.locator('[data-recovery=true]').waitFor();
    assert.equal(await p.locator('#st-login-password').count(), 0);
    await p.getByText('正在检查会话…', { exact: true }).waitFor();
    assert.equal(await p.locator('.st-login-version').textContent(), 'v0.7.3');
    for (const [width, height] of [
      [1366, 768],
      [390, 844],
      [844, 390],
    ]) {
      await p.setViewportSize({ width, height });
      await p.emulateMedia({ reducedMotion: 'reduce' });
      const box = await p.locator('.st-login-panel').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(await p.getByRole('button', { name: '退出当前会话', exact: true }).isVisible());
      if (p === player)
        await p.screenshot({ path: `/tmp/st-070-recovery-${width}.png`, fullPage: true });
    }
    assert.equal(await p.locator('.notes textarea').inputValue(), '私人笔记070');
    release();
    await p.locator('.app').waitFor();
    await p.unroute('**/api/session');
  }
  await dm.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await dm.getByRole('button', { name: '锁定工具箱', exact: true }).waitFor();
  checked(
    'player/DM refresh use recovery page; restore role/notes; desktop/phone/short landscape and reduced motion',
  );
  await player.setViewportSize({ width: 1366, height: 768 });
  await dm.getByRole('button', { name: '骰盘', exact: true }).click();
  const input = player.getByLabel('骰子表达式', { exact: true });
  for (const reason of ['侦查陷阱', '😀'.repeat(32), 'Check trap! +2', '<b>查</b>']) {
    await player.waitForTimeout(1100);
    await input.fill(' 1d20 + 5 ' + reason + '  ');
    await player.getByRole('button', { name: '投掷', exact: true }).click();
    await dm.locator('.roll-reason').filter({ hasText: reason }).first().waitFor();
    await player.locator('.roll-reason').filter({ hasText: reason }).first().waitFor();
    assert.equal(await dm.locator('.roll-reason b').count(), 0);
  }
  const before = await player.locator('.roll').count();
  await input.fill('1d20 ' + '查'.repeat(33));
  await player.getByRole('button', { name: '投掷', exact: true }).click();
  await player.getByText('投骰理由最多 32 个 Unicode 字符', { exact: true }).waitFor();
  assert.equal(await player.locator('.roll').count(), before);
  await player.waitForTimeout(1100);
  await player.getByRole('button', { name: 'd6', exact: true }).click();
  await player.waitForFunction((n) => document.querySelectorAll('.roll').length === n, before + 1);
  assert.equal(await player.locator('.roll').first().locator('.roll-reason').count(), 0);
  checked(
    'plain-text reasons synchronize; 32 emoji accepted; 33 Chinese characters rejected; quick dice omit reason',
  );
  await player.route('**/api/session', (route) => route.abort());
  await player.reload();
  await player
    .getByText('重连失败，可手动重试或离开房间', { exact: true })
    .waitFor({ timeout: 100000 });
  assert.equal(await player.locator('[data-recovery=true]').count(), 1);
  await player.unroute('**/api/session');
  await player.getByRole('button', { name: '重试进入', exact: true }).click();
  await player.locator('.app').waitFor();
  checked('refresh network failures stop after ten retries; manual recovery succeeds');
  await player.route('**/api/session', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ID_CONFLICT', error: 'conflict' }),
    }),
  );
  await player.reload();
  await player.getByText('原临时 ID 已被使用，请更换 ID 并重新登录', { exact: true }).waitFor();
  assert.equal(await player.locator('[data-recovery=true]').count(), 0);
  assert.equal(await player.getByRole('button', { name: '重试进入', exact: true }).count(), 0);
  await player.unroute('**/api/session');
  checked('terminal conflict returns to login with new-ID instruction and no stale retry');
  await dm.getByRole('button', { name: '离开房间', exact: true }).click();
  await dm.locator('#st-login-name').waitFor();
  await dm.reload();
  await dm.locator('#st-login-name').waitFor();
  assert.equal(await dm.locator('[data-recovery=true]').count(), 0);
  await dm.screenshot({ path: '/tmp/st-070-login.png', fullPage: true });
  assert.deepEqual(errors, []);
  checked('explicit logout/no-session refresh return to login; no uncaught page errors');
  console.log(`Browser 0.7.3 checks passed: ${checks}`);
} finally {
  await browser.close();
  await f.close();
}
