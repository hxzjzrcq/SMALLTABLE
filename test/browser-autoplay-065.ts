import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, roomPassword } from './support/management-fixture';
import { readFile } from 'node:fs/promises';
const f = await fixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SMALLTABLE_CHROMIUM ? { executablePath: process.env.SMALLTABLE_CHROMIUM } : {}),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=document-user-activation-required',
    '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
  ],
});
try {
  const dm = await f.peer();
  await dm.unlock();
  const data = await readFile(new URL('./fixtures/tone.mp3', import.meta.url));
  assert.equal(
    (
      await fetch(f.url + '/api/music', {
        method: 'POST',
        headers: { ...dm.headers, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(data),
      })
    ).status,
    200,
  );
  f.service.music.control('play', f.service.music.tracks[0].id);
  const pushId = f.service.music.snapshot().playback.pushId!;
  const context = await browser.newContext();
  await context.addInitScript(
    ({ pushId }) =>
      sessionStorage.setItem(
        'smalltable.music.choice',
        JSON.stringify({ pushId, choice: 'accepted' }),
      ),
    { pushId },
  );
  const page = await context.newPage();
  await page.goto(f.url);
  await page.reload();
  const cdp = await context.newCDPSession(page);
  const evaluate = async (expression: string) =>
    (await cdp.send('Runtime.evaluate', { expression, userGesture: false, returnByValue: true }))
      .result.value;
  await evaluate(
    `(() => {const i=document.querySelector('#st-login-password');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(roomPassword)});i.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>i.form.requestSubmit(),0);})()`,
  );
  const deadline = Date.now() + 10000;
  let text = '';
  while (Date.now() < deadline) {
    text = await evaluate('document.body.innerText');
    if (text.includes('本地：受浏览器阻止')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(text.includes('本地：受浏览器阻止'), text);
  assert.equal(await evaluate('navigator.userActivation.hasBeenActive'), false);
  await page.getByRole('button', { name: '点击播放', exact: true }).click();
  await page.getByText('本地：播放中', { exact: true }).waitFor();
  await page.getByText('本地：停止', { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(f.service.music.snapshot().playback.status, 'stopped');
  await context.close();
  console.log('BROWSER_NATIVE_AUTOPLAY_BLOCK_AND_CLICK_RECOVERY_PASS');
} finally {
  await browser.close();
  await f.close();
}
