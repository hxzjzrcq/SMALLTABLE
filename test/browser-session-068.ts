import { launchBrowser, submitLogin } from './support/browser';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { fixture, roomPassword, dmPassword } from './support/management-fixture';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
const f = await fixture({ ...DEFAULT_CAPABILITIES, maxSeats: 2 });
const browser = await launchBrowser([
  '--no-zygote',
  '--disable-gpu',
  '--disable-software-rasterizer',
]);
let checks = 0;
function checked(label: string) {
  checks++;
  console.log(`PASS ${checks}: ${label}`);
}
async function login(page: Page, name: string, password = roomPassword) {
  await submitLogin(page, name, password);
  await page.locator('.app').waitFor();
}
async function dmPanel(page: Page) {
  await page.getByRole('button', { name: 'DM 工具', exact: true }).click();
}
try {
  const dmContext = await browser.newContext(),
    aContext = await browser.newContext(),
    bContext = await browser.newContext();
  const dm = await dmContext.newPage(),
    a = await aContext.newPage(),
    b = await bContext.newPage();
  const errors: string[] = [];
  for (const page of [dm, a, b]) page.on('pageerror', (e) => errors.push(e.message));
  let loginRequests = 0,
    activityFrames = 0;
  aContext.on('request', (r) => {
    if (r.url().endsWith('/api/login')) loginRequests++;
  });
  aContext.on('page', (p) =>
    p.on('websocket', (ws) =>
      ws.on('framesent', (e) => {
        if (e.payload.toString().includes('"type":"activity"')) activityFrames++;
      }),
    ),
  );
  await dm.goto(f.url);
  await login(dm, 'Keeper', dmPassword);
  await dmPanel(dm);
  await a.goto(f.url);
  await login(a, 'Alice');
  await b.goto(f.url);
  await login(b, 'Bob');
  await dm.getByText('Alice · 普通玩家', { exact: true }).waitFor();
  await dm.getByText('Bob · 普通玩家', { exact: true }).waitFor();
  checked('isolated browser contexts show separate player/DM capacity and DM-only management list');
  const cookies = await aContext.cookies();
  const cookie = cookies.find((c) => c.name === 'tt_room')!;
  assert.ok(cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.expires > Date.now() / 1000);
  await a.reload();
  await a.locator('.app').waitFor();
  assert.equal(loginRequests, 1);
  const extra = await aContext.newPage();
  await extra.goto(f.url);
  await extra.locator('.app').waitFor();
  await a.getByText('此会话已在其他页面打开', { exact: true }).waitFor();
  assert.equal(activityFrames, 0, 'automatic restoration must not send activity');
  checked(
    'persistent HttpOnly cookie restores refresh and new tab without password or synthetic activity; old tab stops',
  );
  await extra.close();
  const reopened = await aContext.newPage();
  await reopened.goto(f.url);
  await reopened.locator('.app').waitFor();
  assert.equal(loginRequests, 1);
  checked('closing then reopening a page preserves session and ID');
  await dm.reload();
  await dm.locator('.app').waitFor();
  await dmPanel(dm);
  await dm.getByRole('button', { name: '锁定工具箱', exact: true }).waitFor();
  checked('DM role survives refresh');
  dm.once('dialog', (d) => {
    assert.ok(d.message().includes('Alice'));
    void d.accept();
  });
  await dm
    .locator('.button-row')
    .filter({ hasText: 'Alice · 普通玩家' })
    .getByRole('button', { name: '移出房间', exact: true })
    .click();
  await reopened.getByText('你已被 DM 移出房间', { exact: true }).waitFor();
  await reopened.waitForTimeout(2200);
  assert.equal(loginRequests, 1);
  checked('kick confirms target ID, returns to login and stops reconnect');
  await login(reopened, 'Alice');
  checked('kicked user can reauthenticate');
  await dm.getByRole('button', { name: '锁定工具箱', exact: true }).click();
  await dm.getByText('普通席位已满，已退出房间', { exact: true }).waitFor();
  assert.equal(await dm.getByRole('button', { name: '重试进入', exact: true }).count(), 0);
  checked(
    'locking a direct DM with full ordinary seats logs out without offering stale session recovery',
  );
  await login(dm, 'Keeper', dmPassword);
  await dmPanel(dm);
  // Preserve Bob offline, fill the released seat, and restore Bob into a full room.
  await b.close();
  const cContext = await browser.newContext(),
    c = await cContext.newPage();
  await c.goto(f.url);
  await login(c, 'Charlie');
  const b2 = await bContext.newPage();
  await b2.goto(f.url);
  await b2.getByText('房间人数已满', { exact: true }).waitFor();
  await b2.getByRole('button', { name: '重试进入', exact: true }).waitFor();
  assert.equal(await b2.locator('.app').count(), 0);
  await c.getByRole('button', { name: '离开房间', exact: true }).click();
  await c.getByText('已离开房间', { exact: true }).waitFor();
  await b2.getByRole('button', { name: '重试进入', exact: true }).click();
  await b2.locator('.app').waitFor();
  checked('full-room recovery offers manual retry and preserves original authentication');
  await bContext.setOffline(true);
  await b2.getByRole('button', { name: '离开房间', exact: true }).click();
  await b2.getByText('已在本地退出，服务器注销待联网完成', { exact: true }).waitFor();
  assert.equal(await b2.evaluate(() => localStorage.getItem('smalltable.logout-pending')), '1');
  await bContext.setOffline(false);
  await b2.getByText('已离开房间', { exact: true }).waitFor();
  await b2.reload();
  await b2.locator('.st-login').waitFor();
  assert.equal(await b2.locator('.app').count(), 0);
  checked(
    'offline logout stores only a pending flag and completes revocation before online recovery',
  );
  await submitLogin(b2, ' bad', roomPassword);
  await b2
    .getByText('请先输入有效临时 ID：1–16 单位的字母、数字或汉字。', { exact: true })
    .waitFor();
  checked('invalid temporary ID has a visible error without silent trimming');
  await b2.setViewportSize({ width: 390, height: 844 });
  await b2.locator('#st-login-name').fill('玩家A01');
  assert.equal(await b2.locator('#st-login-name').inputValue(), '玩家A01');
  const bounds = await b2.locator('.st-login-submit').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await b2.getByRole('button', { name: '进入房间', exact: true }).click();
  await b2.locator('.app').waitFor();
  await b2.getByRole('button', { name: '离开房间', exact: true }).click();
  await b2.getByText('已离开房间', { exact: true }).waitFor();
  checked(
    '390px login accepts a mixed Chinese ID without truncation and keeps submit within viewport',
  );
  await dm.getByRole('button', { name: '离开房间', exact: true }).click();
  await dm.getByText('已离开房间', { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  checked('tested pages have no uncaught browser errors');
  console.log(`Browser session checks passed: ${checks}`);
} finally {
  await browser.close();
  await f.close();
}
