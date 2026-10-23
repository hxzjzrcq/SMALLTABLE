import { launchBrowser, submitLogin } from './support/browser';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { listMethods, listVersions } from '@dndroll/core';
import { fixture, roomPassword } from './support/management-fixture';
const f = await fixture();
const browser = await launchBrowser([
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
]);
async function join(p: Page) {
  await p.goto(f.url);
  await submitLogin(p, 'Browser', roomPassword);
  await p.getByRole('button', { name: '属性工具', exact: true }).waitFor();
}
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await join(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '属性工具', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await frame.locator('.rail-item').first().waitFor();
  const methods = listVersions().flatMap((v) =>
    listMethods(v.id)
      .filter((m) => m.mode === 'buy')
      .map((m) => ({ v, m })),
  );
  let cases = 0;
  for (const width of [320, 360, 390, 420]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { v, m } of methods) {
      // Reload only the real embedded document to start a clean Core session.
      const handle = page.frames().find((fr) => fr.url().endsWith('/dndroll.html'))!;
      await handle.evaluate(() => localStorage.removeItem('smalltable.dndroll.session.v1'));
      await handle.goto(f.url + '/dndroll.html');
      await frame.locator('.rail-item').filter({ hasText: v.name.zh }).click();
      await frame
        .locator('.method-name')
        .filter({
          hasText: new RegExp('^' + m.name.zh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
        })
        .click();
      await frame.getByRole('button', { name: '开始生成', exact: true }).click();
      if (m.id === 'adnd2e.sp-IX')
        await frame.getByRole('button', { name: '掷骰', exact: true }).click();
      await frame.locator('.buy-row').first().waitFor();
      const rows = frame.locator('.buy-row');
      for (let i = 0; i < (await rows.count()); i++) {
        const row = rows.nth(i);
        await row.scrollIntoViewIfNeeded();
        const metrics = await row.evaluate((el) => {
          const row = el.getBoundingClientRect();
          return {
            viewport: innerWidth,
            scroll: el.scrollWidth,
            width: el.clientWidth,
            buttons: [...el.querySelectorAll('button')].map((b) => {
              const r = b.getBoundingClientRect();
              return {
                x: r.x,
                right: r.right,
                width: r.width,
                height: r.height,
                inside: r.left >= row.left && r.right <= row.right,
                hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b,
              };
            }),
          };
        });
        assert.ok(
          metrics.scroll <= metrics.width + 1,
          JSON.stringify({ width, mode: m.id, metrics }),
        );
        for (const b of metrics.buttons)
          assert.ok(
            b.x >= 0 &&
              b.right <= metrics.viewport + 1 &&
              b.width >= 40 &&
              b.height >= 40 &&
              b.inside &&
              b.hit,
            JSON.stringify({ width, mode: m.id, metrics }),
          );
        const plus = row.getByRole('button', { name: /\+1$/ });
        if (await plus.isEnabled()) {
          const before = Number(await row.locator('.stepper-value').textContent());
          await plus.click();
          assert.equal(Number(await row.locator('.stepper-value').textContent()), before + 1);
          await row.getByRole('button', { name: /-1$/ }).click();
        }
      }
      console.log('LAYOUT', width, m.id, 'PASS');
      cases++;
    }
  }
  assert.equal(cases, 28);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('BROWSER_LAYOUT_PASS');
} finally {
  await browser.close();
  await f.close();
}
