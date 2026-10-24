export const FORMAT = 'free-character-card';
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export const blank = () => ({
  format: FORMAT,
  schemaVersion: 1,
  name: '',
  quick: '',
  passive: [],
  active: [],
  abilities: [],
  items: [],
  other: '',
  notes: '',
  collapsed: { passive: false, active: false },
});
// Only the editable calculators and tags are seeded. Plain-text guidance is UI placeholder text.
export function exampleCard() {
  const card = blank();
  const project = (name, values) => ({
    id: uid(),
    name,
    rows: values.map(([raw, reason]) => ({ id: uid(), raw, reason, enabled: true })),
  });
  const tag = (name, mode = 'none', count = 0) => ({ id: uid(), name, detail: '', mode, count });
  card.passive = [
    project('HP', [
      ['10', '职业'],
      ['2', '体质'],
    ]),
    project('AC', [
      ['10', '基础'],
      ['2', '敏捷'],
    ]),
  ];
  card.active = [
    project('长剑攻击', [
      ['+2', '熟练'],
      ['+3', '力量'],
    ]),
    project('长剑伤害', [
      ['1D8', '武器'],
      ['+3', '力量'],
      ['+2', '战斗风格'],
    ]),
  ];
  card.abilities = [
    tag('回气', 'count', 2),
    tag('武器精通：匕首'),
    tag('武器精通：巨剑'),
    tag('武器精通：长剑'),
    tag('战斗风格：对决'),
  ];
  card.items = [tag('长剑')];
  return card;
}
export function classify(raw) {
  const s = raw.trim();
  if (!s) return { kind: 'empty' };
  if (/^[+-]?\d+$/.test(s)) {
    const n = BigInt(s);
    return n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)
      ? { kind: 'error', message: '整数超出精确范围' }
      : { kind: 'integer', value: n };
  }
  if (/^[+-]?(?:\d+\.\d*|\.\d+)$/.test(s)) return { kind: 'error', message: '不支持小数' };
  if (/^[+\-\d.\s]+$/.test(s)) return { kind: 'error', message: '整数格式错误' };
  return { kind: 'expression', value: raw };
}
export function total(project) {
  let sum = 0n;
  const expressions = [],
    errors = [];
  for (const row of project.rows) {
    const v = classify(row.raw);
    if (v.kind === 'error') errors.push(v.message);
    if (!row.enabled) continue;
    if (v.kind === 'integer') sum += v.value;
    if (v.kind === 'expression') expressions.push(v.value);
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER))
    errors.push('合计超出精确范围');
  return { sum: errors.length ? '—' : String(sum), expressions, errors };
}
export function validate(card) {
  const fail = (m) => {
    throw new Error(m);
  };
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v, expected) => {
    if (!object(v) || Object.keys(v).sort().join('|') !== [...expected].sort().join('|'))
      fail('字段缺失或包含本格式未支持的字段');
  };
  const str = (v) => {
    if (typeof v !== 'string') fail('文本字段类型错误');
  };
  const ids = new Set();
  const id = (v) => {
    str(v);
    if (!v || ids.has(v)) fail('标识为空或重复');
    ids.add(v);
  };
  keys(card, [
    'format',
    'schemaVersion',
    'name',
    'quick',
    'passive',
    'active',
    'abilities',
    'items',
    'other',
    'notes',
    'collapsed',
  ]);
  if (card.format !== FORMAT || card.schemaVersion !== 1) fail('不支持的文件格式或 schemaVersion');
  ['name', 'quick', 'other', 'notes'].forEach((k) => str(card[k]));
  keys(card.collapsed, ['passive', 'active']);
  for (const k of ['passive', 'active']) {
    if (typeof card.collapsed[k] !== 'boolean' || !Array.isArray(card[k])) fail('计算区域结构错误');
    for (const p of card[k]) {
      keys(p, ['id', 'name', 'rows']);
      id(p.id);
      str(p.name);
      if (!Array.isArray(p.rows)) fail('计算行必须为列表');
      for (const r of p.rows) {
        keys(r, ['id', 'raw', 'reason', 'enabled']);
        id(r.id);
        str(r.raw);
        str(r.reason);
        if (typeof r.enabled !== 'boolean') fail('启用状态错误');
      }
      if (total(p).errors.length) fail('计算项目存在无效输入：' + total(p).errors.join('、'));
    }
  }
  for (const k of ['abilities', 'items']) {
    if (!Array.isArray(card[k])) fail('标签必须为列表');
    for (const t of card[k]) {
      keys(t, ['id', 'name', 'detail', 'mode', 'count']);
      id(t.id);
      str(t.name);
      str(t.detail);
      if (
        !['count', 'infinite', 'none'].includes(t.mode) ||
        !Number.isInteger(t.count) ||
        t.count < 0 ||
        t.count > 99
      )
        fail('标签模式或数量错误');
    }
  }
  return card;
}
export const symbol = (t) =>
  t.mode === 'count' ? String(t.count) : t.mode === 'infinite' ? '∞' : '—';
export function toText(c) {
  const out = ['NAME', c.name, '', '标准速查', c.quick];
  for (const [k, title] of [
    ['passive', '重要被动'],
    ['active', '重要主动'],
  ]) {
    out.push('', title);
    for (const p of c[k]) {
      const t = total(p);
      out.push(`${p.name || '未命名'}：${t.sum}`);
      t.expressions.forEach((s) => out.push('未计算：' + s));
      p.rows.forEach((r) => out.push(`[${r.enabled ? '启用' : '停用'}] ${r.raw}  ${r.reason}`));
    }
  }
  for (const [k, title] of [
    ['abilities', '重要个人能力'],
    ['items', '重要物品'],
  ]) {
    out.push('', title);
    for (const t of c[k]) out.push(`${t.name || '未命名'}（${symbol(t)}）`, t.detail);
  }
  out.push('', '其他角色内容', c.other, '', '附注', c.notes);
  return out.join('\n');
}
