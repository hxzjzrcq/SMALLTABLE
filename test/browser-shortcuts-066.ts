import { launchBrowser, submitLogin } from './support/browser';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import assert from 'node:assert/strict';
import { fixture, roomPassword, dmPassword, token } from './support/management-fixture';
const f = await fixture({ ...DEFAULT_CAPABILITIES, maxDMs: 2 });
const browser = await launchBrowser();
try {
  const manager = await f.peer();
  await manager.unlock();
  const t = token();
  manager.send({ type: 'create', token: t });
  await manager.until((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(f.url);
  await submitLogin(page, 'Browser', roomPassword);
  const piece = page.locator('.board-token');
  await piece.click();
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await page.keyboard.press('Delete');
  assert.equal(dialogs, 0, 'ordinary player cannot delete');
  assert.equal(f.service.getRoom().tokens.length, 1);
  await page.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await page.getByLabel('DM 密码', { exact: true }).fill(dmPassword);
  await page.getByRole('button', { name: '解锁工具箱', exact: true }).click();
  await page.getByRole('button', { name: '掀桌', exact: true }).waitFor();
  await piece.click();
  await page.keyboard.press('Delete');
  assert.equal(dialogs, 1, 'one cancellation prompt');
  assert.equal(f.service.getRoom().tokens.length, 1);
  await page.keyboard.press('Shift+Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.up('Delete');
  assert.equal(dialogs, 2, 'repeat does not prompt again');
  // Real input edit must neither show a prompt nor delete the selected piece.
  const field = page.locator('.inspector input:not([type])').first();
  await field.fill('abc');
  await field.press('Home');
  await field.press('Delete');
  assert.equal(await field.inputValue(), 'bc');
  assert.equal(dialogs, 2);
  await page.getByRole('button', { name: '属性工具', exact: true }).click();
  await page.keyboard.press('Delete');
  assert.equal(dialogs, 2);
  await page.getByRole('button', { name: '返回桌面', exact: true }).click();
  await piece.click();
  page.removeAllListeners('dialog');
  page.once('dialog', async (d) => {
    dialogs++;
    assert.match(d.message(), /不可撤销/);
    await d.accept();
  });
  const revision = f.service.getRoom().revision;
  await page.keyboard.press('Delete');
  await manager.until(
    (e) => e.type === 'snapshot' && e.room.revision > revision && e.room.tokens.length === 0,
  );
  await piece.waitFor({ state: 'detached' });
  assert.equal(dialogs, 3);
  await page.keyboard.press('Delete');
  console.log(
    'PASS: player guard, cancellation, modifiers, repeat, text editing, modal guard, confirmed deletion and peer snapshot',
  );
  await context.close();
} finally {
  await browser.close();
  await f.close();
}
