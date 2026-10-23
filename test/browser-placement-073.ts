import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, submitLogin } from './support/browser';
import { createSmalltable } from '../src/server/app';
import { config } from '../src/server/config';

const dir = await mkdtemp(path.join(tmpdir(), 'st-placement-073-'));
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
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await submitLogin(page, 'DM', 'keeper');
  await page.locator('.board svg').waitFor();
  await page.locator('.tabs button').filter({ hasText: '棋子' }).click();
  // One JS task: all six commands leave before any network snapshot can arrive.
  await page.evaluate(() => {
    const create = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('无图片棋子'),
    )!;
    for (const letter of 'ABC') {
      create.click();
      [...document.querySelectorAll<HTMLButtonElement>('.public-box button')]
        .find((b) => b.textContent?.trim() === letter)!
        .click();
    }
  });
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 6);
  const tokens = service.getRoom().tokens;
  assert.equal(tokens.length, 6);
  assert.equal(new Set(tokens.map((t) => `${t.x},${t.y}`)).size, 6);
  assert.equal(tokens.filter((t) => t.publicId).length, 3);
  const view = await page.locator('.board svg').evaluate((el) => {
    const v = (el as SVGSVGElement).viewBox.baseVal;
    return { x: v.x, y: v.y, width: v.width, height: v.height };
  });
  for (const t of tokens) {
    assert.ok(t.x >= view.x && t.x <= view.x + view.width);
    assert.ok(t.y >= view.y && t.y <= view.y + view.height);
  }
  // Moving the local camera starts placement at the new visible center again.
  await page.locator('.board svg').hover();
  await page.mouse.wheel(0, -300);
  await page.waitForFunction((old) => {
    const v = document.querySelector<SVGSVGElement>('.board svg')!.viewBox.baseVal;
    return v.width !== old;
  }, view.width);
  const center = await page.locator('.board svg').evaluate((el) => {
    const v = (el as SVGSVGElement).viewBox.baseVal;
    return { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  });
  await page.getByRole('button', { name: '＋ 无图片棋子', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.board-token').length === 7);
  const last = service.getRoom().tokens.at(-1)!;
  assert.ok(Math.abs(last.x - center.x) < 0.01 && Math.abs(last.y - center.y) < 0.01);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: rapid mixed ordinary/public placements have six distinct visible positions; camera change resets placement.',
  );
} finally {
  await browser.close();
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
