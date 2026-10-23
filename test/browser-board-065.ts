import { launchBrowser, submitLogin } from './support/browser';
import { DEFAULT_CAPABILITIES } from '../src/shared/limits';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture, roomPassword, dmPassword, token, drawing } from './support/management-fixture';
import { randomUUID } from 'node:crypto';
const f = await fixture({ ...DEFAULT_CAPABILITIES, maxDMs: 2 });
const browser = await launchBrowser([
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
]);
try {
  const manager = await f.peer();
  await manager.unlock();
  const a = {
    ...token(),
    id: randomUUID(),
    name: '左端',
    shape: 'square',
    x: -32768,
    y: -32768,
    angle: 45,
    size: 4,
  };
  const b = { ...token(), id: randomUUID(), name: '右端', x: 32768, y: 32768, size: 4 };
  for (const t of [a, b]) {
    const revision = f.service.getRoom().revision;
    manager.send({ type: 'create', token: t });
    await manager.until((e) => e.type === 'snapshot' && e.room.revision > revision);
  }
  const d = { ...drawing(), x1: -32768, y1: 32768, x2: 32768, y2: -32768 };
  manager.send({ type: 'drawing.add', drawing: d, epoch: 0 });
  await manager.until((e) => e.type === 'snapshot' && e.room.drawings.length === 1);
  const context = await browser.newContext({ viewport: { width: 320, height: 850 } }),
    page = await context.newPage();
  await page.goto(f.url);
  await submitLogin(page, 'Browser', roomPassword);
  await page.getByRole('button', { name: '查看全部', exact: true }).waitFor();
  await page.getByRole('button', { name: '收起面板', exact: true }).click();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  const svg = page.locator('svg[aria-label^="共享桌面"]');
  const bounds = await svg.evaluate((el) => {
    const box = el.getBoundingClientRect(),
      view = (el as SVGSVGElement).viewBox.baseVal;
    const tokens = [...el.querySelectorAll('.board-token')].map((t) => {
      const r = t.getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    return {
      box: { x: box.left, y: box.top, right: box.right, bottom: box.bottom },
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
      tokens,
    };
  });
  for (const r of bounds.tokens)
    assert.ok(
      r.x >= bounds.box.x &&
        r.right <= bounds.box.right &&
        r.y >= bounds.box.y &&
        r.bottom <= bounds.box.bottom,
      JSON.stringify(bounds),
    );
  assert.deepEqual(
    f.service.getRoom().tokens.map((t) => [t.x, t.y]),
    [
      [-32768, -32768],
      [32768, 32768],
    ],
  );
  const image = await sharp({ create: { width: 64, height: 32, channels: 4, background: 'red' } })
    .png()
    .toBuffer();
  for (const name of ['one.png', 'two.png'])
    assert.equal(
      (
        await fetch(f.url + '/api/image/map', {
          method: 'POST',
          headers: {
            ...manager.headers,
            'Content-Type': 'application/octet-stream',
            'X-File-Name': name,
          },
          body: new Uint8Array(image),
        })
      ).status,
      200,
    );
  const maps = f.service.getRoom().maps;
  await page.locator('svg image').waitFor();
  const camera = await svg.getAttribute('viewBox');
  manager.send({ type: 'map.scale', id: maps[1].id, scale: 300 });
  await page.waitForFunction(
    () => document.querySelector('svg image')?.getAttribute('width') === '192',
  );
  assert.equal(await svg.getAttribute('viewBox'), camera);
  manager.send({ type: 'map.select', id: maps[0].id });
  await page.waitForFunction(
    () => document.querySelector('svg image')?.getAttribute('width') === '64',
  );
  assert.equal(await svg.getAttribute('viewBox'), camera);
  // Desktop DM confirmation: cancel leaves the table intact, confirm clears tokens and lines.
  await page.getByRole('button', { name: '展开面板', exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('button', { name: 'DM 工具', exact: true }).click();
  await page.getByLabel('DM 密码', { exact: true }).fill(dmPassword);
  await page.getByRole('button', { name: '解锁工具箱', exact: true }).click();
  await page.getByRole('button', { name: '掀桌', exact: true }).waitFor();
  let dialogs = 0;
  page.once('dialog', (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: '掀桌', exact: true }).click();
  assert.equal(f.service.getRoom().tokens.length, 2);
  page.once('dialog', (dialog) => {
    dialogs++;
    void dialog.accept();
  });
  await page.getByRole('button', { name: '掀桌', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 0);
  assert.equal(dialogs, 2);
  assert.equal(f.service.getRoom().drawings.length, 0);
  assert.equal(f.service.getRoom().maps.length, 2);
  await context.close();
  console.log('BROWSER_BOARD_PASS', JSON.stringify(bounds));
} finally {
  await browser.close();
  await f.close();
}
