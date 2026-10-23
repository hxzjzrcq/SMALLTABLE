import assert from 'node:assert/strict';
import { launchBrowser, submitLogin } from './support/browser';
import { fixture, token, roomPassword } from './support/management-fixture';
import type { WebSocketRoute } from 'playwright';
const f = await fixture();
const browser = await launchBrowser(['--disable-gpu']);
let checks = 0;
const checked = (message: string) => console.log(`PASS ${++checks}: ${message}`);
try {
  const manager = await f.peer();
  await manager.unlock();
  const t = { ...token(), x: 160, y: 160, label: '甲乙丙丁' };
  manager.send({ type: 'create', token: t });
  await manager.until((e) => e.type === 'snapshot' && e.room.tokens.length === 1);
  const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  let mode: 'normal' | 'delay' | 'drop' = 'normal';
  const held: string[] = [];
  let ackCount = 0;
  let outgoing: WebSocketRoute;
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.routeWebSocket('**/ws', (route) => {
    outgoing = route;
    const server = route.connectToServer();
    route.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === 'move.ack') ackCount++;
      if (data.type === 'move.ack' && mode !== 'normal') {
        if (mode === 'delay') held.push(String(message));
        return;
      }
      route.send(message);
    });
  });
  await p.goto(f.url);
  await submitLogin(p, 'Player', '' + roomPassword);
  await p.locator('.app').waitFor();
  const element = () => p.locator(`[data-token-id="${t.id}"]`);
  async function xy() {
    return element().getAttribute('transform');
  }
  async function drag(dx: number, dy: number) {
    const beforeAck = ackCount;
    const b = await element().boundingBox();
    assert.ok(b);
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 4 });
    await p.mouse.up();
    const deadline = Date.now() + 4000;
    while (ackCount === beforeAck && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(ackCount > beforeAck);
  }
  async function moveOther(x: number, y: number) {
    const mark = manager.events.length;
    manager.send({ type: 'move', id: t.id, x, y, final: true, epoch: 0 });
    await manager.until((e) => e.type === 'token' && e.token.x === x && e.token.y === y, mark);
    await p.waitForTimeout(40);
  }
  mode = 'delay';
  await drag(70, 30);
  await p.waitForTimeout(100);
  assert.equal(held.length, 1);
  const final = await xy();
  await moveOther(80, 80);
  assert.equal(await xy(), final, 'ordinary broadcasts cannot acknowledge local final preview');
  outgoing!.send(held.shift()!);
  await p.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-token-id="${id}"]`)
        ?.getAttribute('transform')
        ?.includes('translate(80 80)'),
    t.id,
  );
  checked(
    'matching ack ends preview; later other-player authoritative move wins over older acknowledgement',
  );
  await drag(70, 20);
  await p.waitForTimeout(70);
  const old = held.shift()!;
  await drag(60, 20);
  await p.waitForTimeout(70);
  const latest = held.shift()!;
  const second = await xy();
  outgoing!.send(old);
  await p.waitForTimeout(80);
  assert.equal(await xy(), second);
  outgoing!.send(latest);
  await p.waitForTimeout(80);
  assert.equal(await xy(), second);
  checked('rapid repeat drag ignores an old ack and keeps the newest preview');
  mode = 'drop';
  await drag(60, 20);
  await moveOther(120, 120);
  const before = await xy();
  assert.ok(!before?.includes('translate(120 120)'));
  await p.getByText('移动同步延迟，已回到最近同步位置', { exact: true }).waitFor();
  assert.match((await xy())!, /translate\(120 120\)/);
  await p.getByText('诊断信息', { exact: false }).click();
  const diagnostic = await p.getByLabel('脱敏诊断信息').inputValue();
  assert.ok(!diagnostic.includes('DM-private'));
  assert.ok(!diagnostic.includes('tt_room'));
  assert.ok(!diagnostic.includes(manager.session));
  await p.evaluate(
    "Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(Error('denied'))}, configurable: true})",
  );
  await p.getByRole('button', { name: '复制诊断', exact: true }).click();
  await p.getByText('复制不可用，请选中上方文字复制', { exact: true }).waitFor();
  checked(
    'lost ack times out to latest authority after 2s; diagnostic whitelist and clipboard fallback work',
  );
  await p.getByRole('button', { name: '关闭提示', exact: true }).click();
  mode = 'delay';
  const b = await element().boundingBox();
  assert.ok(b);
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 20, { steps: 3 });
  const mark = manager.events.length;
  manager.send({ type: 'token.hidden', id: t.id, hidden: true, epoch: 0 });
  await manager.until((e) => e.type === 'snapshot' && e.room.tokens[0].hidden, mark);
  await p.waitForFunction((id) => !document.querySelector(`[data-token-id="${id}"]`), t.id);
  await p.mouse.up();
  for (const ack of held.splice(0)) outgoing!.send(ack);
  await p.waitForTimeout(150);
  assert.equal(await element().count(), 0);
  assert.equal(await p.locator('.token-rotate').count(), 0);
  checked(
    'hide during an active pointer drag immediately removes all graphics/controls; late messages do not revive it',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      browser: browser.version(),
      faults:
        'ack delay/drop injected with WS route; real server, real pointers, real other player moves',
    }),
  );
} finally {
  await browser.close();
  await f.close();
}
