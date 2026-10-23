import { launchBrowser } from './support/browser';
import assert from 'node:assert/strict';
import { fixture, roomPassword } from './support/management-fixture';
import { readFile } from 'node:fs/promises';
const f = await fixture();
const browser = await launchBrowser([
  '--autoplay-policy=document-user-activation-required',
  '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
]);
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
  await page.waitForFunction(
    () =>
      (document.querySelector('.st-login-submit') as HTMLButtonElement | null)?.disabled === false,
  );
  const cdp = await context.newCDPSession(page);
  const evaluate = async (expression: string) =>
    (await cdp.send('Runtime.evaluate', { expression, userGesture: false, returnByValue: true }))
      .result.value;
  // Browser startup must not consume the short fixture before the policy assertion.
  f.service.music.control('stop');
  f.service.music.control('play', f.service.music.tracks[0].id);
  await evaluate(
    `(() => {const n=document.querySelector('#st-login-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'NoClick');n.dispatchEvent(new Event('input',{bubbles:true}));const i=document.querySelector('#st-login-password');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(roomPassword)});i.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>i.form.requestSubmit(),0);})()`,
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
