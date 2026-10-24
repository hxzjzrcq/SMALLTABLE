import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank, uid, classify, total, validate, toText } from '../src/character-card/core.js';
const row = (raw, enabled = true) => ({ id: uid(), raw, reason: '理由很长而且不可截断', enabled });
const project = (...raws) => ({ id: uid(), name: '攻击', rows: raws.map((s) => row(s)) });
test('完整整数、负数、0与空白', () => {
  for (const s of ['6', '+6', '-2', '0', '  +6  ']) assert.equal(classify(s).kind, 'integer');
  assert.equal(classify(' ').kind, 'empty');
  assert.equal(total(project('+6', '-2', '0', '')).sum, '4');
});
test('表达式完全不拆整数，按顺序保留原文', () => {
  const p = project('+6', '+4', '+1D6', '2D6+3');
  assert.deepEqual(total(p), { sum: '10', expressions: ['+1D6', '2D6+3'], errors: [] });
  p.rows[2].enabled = false;
  assert.deepEqual(total(p).expressions, ['2D6+3']);
});
test('小数与格式错误均拒绝；停用错误行也要求修正', () => {
  for (const s of ['1.5', '-.5', '1.', '+', '--2', '1 2']) assert.equal(classify(s).kind, 'error');
  const p = project('1.5');
  p.rows[0].enabled = false;
  assert.equal(total(p).sum, '—');
});
test('精确范围和合计溢出，BigInt中间计算避免精度丢失', () => {
  assert.equal(classify('9007199254740992').kind, 'error');
  assert.equal(total(project('9007199254740991', '1')).sum, '—');
  assert.equal(total(project('9007199254740991', '1', '-1')).sum, '9007199254740991');
  assert.equal(total(project('-9007199254740991', '-1')).sum, '—');
});
function fixture() {
  const c = blank();
  c.name = '<script>alert(1)</script>';
  c.quick = '速查\n换行';
  c.passive = [project('10', '-2')];
  c.active = [project('2D6+3', '+4')];
  c.active[0].rows[1].enabled = false;
  c.collapsed.active = true;
  c.abilities = Array.from({ length: 50 }, (_, i) => ({
    id: uid(),
    name: '能力' + i,
    mode: ['count', 'infinite', 'none'][i % 3],
    count: i,
    detail: '长详情\n'.repeat(500),
  }));
  c.items = [{ id: uid(), name: '空药瓶', mode: 'count', count: 0, detail: '仍保留' }];
  c.other = '其他';
  c.notes = '附注\n第二行';
  return c;
}
test('50标签长文本、顺序、开关及折叠状态JSON无损往返', () => {
  const c = fixture();
  assert.deepEqual(validate(JSON.parse(JSON.stringify(c))), c);
});
test('拒绝错误版本、结构、类型、范围、重复ID及额外字段', () => {
  const mutations = [
    (c) => (c.schemaVersion = 2),
    (c) => delete c.name,
    (c) => (c.other = 2),
    (c) => (c.items[0].count = 100),
    (c) => (c.items[0].count = 0.5),
    (c) => (c.active[0].rows[0].enabled = 1),
    (c) => (c.items[0].id = c.passive[0].id),
    (c) => (c.cachedTotal = 10),
    (c) => (c.passive[0].rows[0].raw = '1.5'),
    (c) => (c.collapsed.active = 'yes'),
    (c) => (c.abilities[0].mode = 'max'),
  ];
  for (const mutate of mutations) {
    const c = fixture();
    mutate(c);
    assert.throws(() => validate(c));
  }
  assert.throws(() => validate(null));
});
test('TXT包含折叠计算行、停用、0标签、所有长详情与八区域', () => {
  const c = fixture(),
    text = toText(c);
  for (const s of [
    'NAME',
    '标准速查',
    '重要被动',
    '重要主动',
    '重要个人能力',
    '重要物品',
    '其他角色内容',
    '附注',
    '[停用] +4',
    '未计算：2D6+3',
    '空药瓶（0）',
    c.abilities[0].detail,
    c.notes,
  ])
    assert.ok(text.includes(s), s);
  c.collapsed.active = false;
  assert.equal(toText(c), text);
});

test('默认示例的计算与标签有效，文本提示不作为存档数据，每次创建相互独立', async () => {
  const { exampleCard } = await import('../src/character-card/core.js');
  const c = exampleCard();
  validate(c);
  for (const key of ['name', 'quick', 'other', 'notes']) assert.equal(c[key], '');
  assert.deepEqual(
    c.passive.map((p) => total(p).sum),
    ['12', '12'],
  );
  assert.deepEqual(
    c.active.map((p) => total(p).sum),
    ['5', '5'],
  );
  assert.deepEqual(total(c.active[1]).expressions, ['1D8']);
  assert.equal(c.abilities[0].count, 2);
  assert.equal(c.abilities[0].mode, 'count');
  assert.ok(c.abilities.slice(1).every((t) => t.mode === 'none' && t.detail === ''));
  assert.equal(c.items[0].name, '长剑');
  assert.equal(c.items[0].mode, 'none');
  const next = exampleCard();
  assert.notEqual(next.passive[0].id, c.passive[0].id);
  c.passive[0].rows[0].raw = '99';
  assert.equal(next.passive[0].rows[0].raw, '10');
  assert.ok(!JSON.stringify(c).includes('汉娜'));
  assert.ok(!toText(c).includes('只记录你需要的资料'));
});
