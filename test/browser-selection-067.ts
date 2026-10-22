import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, roomPassword, dmPassword, token } from './support/management-fixture';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import sharp from 'sharp';
const f = await fixture({ ...DEFAULT_CAPABILITIES, maxTokens: 4 });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.SMALLTABLE_CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const dm = await f.peer();
  await dm.unlock();
  const imageBytes = await sharp({
    create: { width: 8, height: 8, channels: 4, background: 'red' },
  })
    .png()
    .toBuffer();
  const upload = await fetch(f.url + '/api/image/token', {
    method: 'POST',
    headers: { ...dm.headers, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(imageBytes),
  });
  assert.equal(upload.status, 200);
  const image = await upload.json();
  const source = {
    ...token(),
    name: '杂兵',
    label: 'g',
    note: 'HP 10',
    secret: 'private guard',
    asset: image.asset,
  };
  dm.send({ type: 'create', token: source, uploadId: image.uploadId });
  await dm.until((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } }),
    page = await context.newPage();
  const sent: any[] = [];
  page.on('websocket', (ws) =>
    ws.on('framesent', (e) => {
      try {
        sent.push(JSON.parse(e.payload.toString()));
      } catch {}
    }),
  );
  await page.goto(f.url);
  await page.locator('#st-login-password').fill(roomPassword);
  await page.getByRole('button', { name: '进入房间', exact: true }).click();
  await page.locator('.board-token').waitFor();
  await page.getByRole('button', { name: '棋子', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '克隆 杂兵', exact: true }).count(),
    0,
    'players have no clone action',
  );
  await page.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await page.getByLabel('DM 密码', { exact: true }).fill(dmPassword);
  await page.getByRole('button', { name: '解锁工具箱', exact: true }).click();
  await page.getByRole('button', { name: '掀桌', exact: true }).waitFor();
  await page.getByRole('button', { name: '棋子', exact: true }).click();
  const sourceRow = page.locator('.token-list-row').first();
  await sourceRow.getByRole('button', { name: '克隆 杂兵', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 2);
  await sourceRow.getByRole('button', { name: '克隆 杂兵', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 3);
  const tokens = f.service.getRoom().tokens;
  const [a, b, c] = tokens;
  for (const copy of [b, c]) {
    assert.notEqual(copy.id, a.id);
    assert.deepEqual({ ...copy, id: a.id, x: a.x, y: a.y }, a);
  }
  assert.equal(new Set(tokens.map((t) => t.asset)).size, 1);
  const piece = (id: string) => page.locator(`[data-token-id="${id}"]`);
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-token-id="${id}"]`)?.getAttribute('aria-pressed') === 'true',
    c.id,
  );
  // Move them apart through the existing server command, then test local selection only.
  for (const [i, t] of tokens.entries()) {
    dm.send({ type: 'move', id: t.id, x: i * 160, y: 100, final: true, epoch: 0 });
  }
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await piece(a.id).click();
  const mark = sent.length;
  const before = f.service.getRoom().tokens.map((t) => [t.id, t.x, t.y]);
  await page.keyboard.down('Shift');
  await piece(b.id).click();
  await piece(c.id).click();
  await piece(b.id).click();
  // Holding Shift while moving the pointer must not move a single piece or the group.
  const box = (await piece(b.id).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);
  await page.mouse.up();
  await piece(b.id).click();
  await page.keyboard.up('Shift');
  assert.equal(await page.locator('.board-token[aria-pressed="true"]').count(), 2);
  assert.deepEqual(
    f.service.getRoom().tokens.map((t) => [t.id, t.x, t.y]),
    before,
  );
  assert.equal(
    sent.slice(mark).filter((c) => c.type !== 'activity').length,
    0,
    'Shift selection sends no room commands',
  );
  assert.equal(
    await page.getByLabel('公开注释', { exact: true }).count(),
    0,
    'multi-select cannot edit a piece',
  );
  await piece(c.id).click();
  assert.equal(
    await page.locator('.board-token[aria-pressed="true"]').count(),
    1,
    'plain click replaces multiselect',
  );
  const svg = page.locator('svg[aria-label^="共享桌面"]');
  await svg.click({ position: { x: 20, y: 20 } });
  assert.equal(await page.locator('.board-token[aria-pressed="true"]').count(), 0);
  // Directory selection uses the same toggle policy; Delete works while that selection button is focused.
  const rows = page.locator('.token-list-row');
  await rows.nth(0).locator('button[data-board-selection]').click();
  await rows
    .nth(1)
    .locator('button[data-board-selection]')
    .click({ modifiers: ['Shift'] });
  let dialogs = 0;
  page.once('dialog', async (d) => {
    dialogs++;
    assert.match(d.message(), /2 枚/);
    await d.dismiss();
  });
  await page.keyboard.press('Delete');
  assert.equal(dialogs, 1);
  assert.equal(f.service.getRoom().tokens.length, 3);
  assert.equal(await page.locator('.board-token[aria-pressed="true"]').count(), 2);
  const rev = f.service.getRoom().revision,
    deleteMark = sent.length;
  page.once('dialog', async (d) => {
    dialogs++;
    await d.accept();
  });
  await page.keyboard.press('Delete');
  await dm.until(
    (e) => e.type === 'snapshot' && e.room.revision > rev && e.room.tokens.length === 1,
  );
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 1);
  assert.equal(dialogs, 2);
  const deletes = sent.slice(deleteMark).filter((c) => c.type === 'delete.many');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].ids.length, 2);
  assert.equal(await page.locator('.board-token[aria-pressed="true"]').count(), 0);
  // Remaining clone's notes are independent; cloning at the positive boundary stays legal.
  const remaining = f.service.getRoom().tokens[0];
  const edge = { ...remaining, x: 32768, y: 32768, note: 'HP 3' };
  const oldRev = f.service.getRoom().revision;
  dm.send({ type: 'edit', token: edge });
  await dm.until((e) => e.type === 'snapshot' && e.room.revision > oldRev);
  await page.getByRole('button', { name: '克隆 杂兵', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 2);
  assert.equal(f.service.getRoom().tokens[1].x, 32744);
  assert.equal(f.service.getRoom().tokens[1].note, 'HP 3');
  const fork = f.service.getRoom().tokens[1],
    r = f.service.getRoom().revision;
  dm.send({ type: 'note', id: fork.id, note: 'HP 1', epoch: 0 });
  await dm.until((e) => e.type === 'token' && e.revision > r);
  assert.equal(f.service.getRoom().tokens[0].note, 'HP 3');
  assert.equal(f.service.getRoom().tokens[1].note, 'HP 1');
  // Failed clone creation leaves the original and selection intact; no phantom copy.
  const originalSave = f.service.storage.save.bind(f.service.storage);
  f.service.storage.save = async () => {
    throw Error('injected clone save failure');
  };
  await page.getByRole('button', { name: '克隆 杂兵', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(f.service.getRoom().tokens.length, 2);
  assert.equal(await page.locator('.board-token').count(), 2);
  f.service.storage.save = originalSave;
  for (let count = 2; count < 4; count++) {
    await page.getByRole('button', { name: '克隆 杂兵', exact: true }).first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.board-token').length === n,
      count + 1,
    );
  }
  for (const button of await page.getByRole('button', { name: '克隆 杂兵', exact: true }).all())
    assert.ok(await button.isDisabled(), 'configured token cap disables clones');
  // Another DM deleting the selected piece cleans this tab's local selection.
  const current = f.service.getRoom(),
    last = current.tokens[current.tokens.length - 1];
  dm.send({ type: 'delete', id: last.id });
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 3);
  assert.equal(await page.locator('.board-token[aria-pressed="true"]').count(), 0);
  console.log(
    'PASS: actual directory clones share image and copy all fields; independent notes; Shift local-only/toggle/plain/empty; one confirmation/cancel; one batch deletion and peer snapshot; boundary clone, failed creation, configured cap and external deletion',
  );
  await context.close();
} finally {
  await browser.close();
  await f.close();
}
