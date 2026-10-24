import { blank, exampleCard, uid, classify, total, validate, symbol, toText } from './core.js';
import { installSorting } from './drag.js';
import './host.js';
let card = exampleCard(),
  dirty = false,
  editing = null;
const $ = (s) => document.querySelector(s),
  sheet = $('#sheet');
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat())
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const button = (text, action, cls = '', attrs = {}) =>
  el('button', { type: 'button', class: cls, onclick: action, ...attrs }, text);
function changed() {
  dirty = true;
  $('#saved').hidden = true;
  $('#status').textContent = '内容已更改 · 请导出 JSON 保存';
}
function heading(index, title, controls = []) {
  return el(
    'div',
    { class: 'section-head' },
    el('h2', {}, el('span', { class: 'num' }, String(index).padStart(2, '0')), title),
    el('div', {}, controls),
  );
}
function handle() {
  return button('⠿', () => {}, 'handle icon', {
    'data-handle': '',
    'aria-label': '拖拽排序（键盘方向键亦可）',
    title: '拖动排序；方向键排序',
  });
}
const textHints = {
  name: '姓名和角色核心信息，如：汉娜，1级女性人类战士。',
  quick: '属性和重要特征，如：力量16，敏捷14，体质14，智力8，感知10，魅力12；先攻+2。',
  other: '不必加入所有内容，只记录你需要的资料。',
  notes: '人物背景、经历，以及其他想记下的事情。',
};
function textSection(index, title, key, rows) {
  const input = el('textarea', {
    class: 'plain ' + (key === 'name' ? 'name' : ''),
    rows,
    'aria-label': title,
    placeholder: textHints[key],
    value: card[key],
    oninput: (e) => {
      card[key] = e.target.value;
      changed();
    },
  });
  return el('section', {}, heading(index, title), input);
}
function updateResult(p, node) {
  const t = total(p);
  node.querySelector('.result').textContent = t.sum;
  node.querySelector('.expressions').textContent = t.expressions
    .map((s) => '未计算：' + s)
    .join('\n');
  node.querySelector('.project-error').textContent = [...new Set(t.errors)].join('；');
}
function projectNode(p, key) {
  const node = el('article', { class: 'project', 'data-sort-id': p.id });
  const name = el('input', {
    class: 'project-name',
    placeholder: '项目名称',
    value: p.name,
    'aria-label': '项目名称',
    title: p.name,
    oninput: (e) => {
      p.name = e.target.value;
      e.target.title = p.name;
      changed();
    },
  });
  node.append(
    el(
      'div',
      { class: 'project-head' },
      handle(),
      name,
      button(
        '×',
        () => {
          card[key] = card[key].filter((x) => x.id !== p.id);
          changed();
          render();
        },
        'icon',
        { 'aria-label': '删除项目' },
      ),
    ),
    el('div', { class: 'result' }),
    el('div', { class: 'expressions' }),
    el('div', { class: 'project-error', role: 'status' }),
  );
  const rows = el('div', { class: 'rows', 'data-list': 'rows:' + p.id });
  rows.hidden = card.collapsed[key];
  for (const r of p.rows) {
    const wrap = el('div', { 'data-sort-id': r.id });
    const error = el('div', { class: 'row-error' });
    const raw = el('input', {
      class: 'raw',
      placeholder: '数值',
      value: r.raw,
      'aria-label': '数值或表达式',
      title: r.raw,
      oninput: (e) => {
        r.raw = e.target.value;
        refresh();
        changed();
      },
    });
    function refresh() {
      const v = classify(r.raw),
        bad = v.kind === 'error';
      raw.classList.toggle('invalid', bad);
      raw.setAttribute('aria-invalid', String(bad));
      raw.title = r.raw;
      error.textContent = bad ? v.message : '';
      updateResult(p, node);
    }
    const reason = el('input', {
      class: 'reason',
      placeholder: '理由',
      value: r.reason,
      'aria-label': '理由',
      title: r.reason,
      oninput: (e) => {
        r.reason = e.target.value;
        e.target.title = r.reason;
        changed();
      },
    });
    wrap.append(
      el(
        'div',
        { class: 'row' },
        handle(),
        el('input', {
          type: 'checkbox',
          checked: r.enabled,
          'aria-label': '启用此行',
          onchange: (e) => {
            r.enabled = e.target.checked;
            changed();
            updateResult(p, node);
          },
        }),
        raw,
        reason,
        button(
          '×',
          () => {
            p.rows = p.rows.filter((x) => x.id !== r.id);
            changed();
            render();
          },
          'icon',
          { 'aria-label': '删除计算行' },
        ),
      ),
      error,
    );
    rows.append(wrap);
    refresh();
  }
  node.append(rows);
  const add = button(
    '＋ 计算行',
    () => {
      p.rows.push({ id: uid(), raw: '', reason: '', enabled: true });
      changed();
      render();
      sheet.querySelector(`[data-sort-id="${p.rows.at(-1).id}"] .raw`).focus();
    },
    'add-row',
  );
  add.hidden = card.collapsed[key];
  node.append(add);
  updateResult(p, node);
  return node;
}
function calcSection(index, title, key) {
  const list = el('div', { class: 'calc-list', 'data-list': key });
  if (!card[key].length)
    list.append(el('span', { class: 'empty' }, '添加项目，建立自己的计算竖式。'));
  card[key].forEach((p) => list.append(projectNode(p, key)));
  return el(
    'section',
    {},
    heading(index, title, [
      button(card.collapsed[key] ? '展开草稿纸' : '收起草稿纸', () => {
        card.collapsed[key] = !card.collapsed[key];
        render();
      }),
      button('＋ 项目', () => {
        card[key].push({
          id: uid(),
          name: '',
          rows: [{ id: uid(), raw: '', reason: '', enabled: true }],
        });
        changed();
        render();
        sheet.querySelector(`[data-sort-id="${card[key].at(-1).id}"] .project-name`).focus();
      }),
    ]),
    list,
  );
}
const preview = el('div', { class: 'preview' });
document.body.append(preview);
function tagsSection(index, title, key) {
  const list = el('div', { class: 'tag-list', 'data-list': key });
  if (!card[key].length) list.append(el('span', { class: 'empty' }, '将常用能力或物品放在这里。'));
  for (const t of card[key]) {
    const name = button(t.name || '未命名', () => openTag(key, t.id), 'tag-open');
    name.addEventListener('mouseenter', (e) => {
      if (!t.detail || !matchMedia('(hover: hover)').matches) return;
      preview.textContent = t.detail;
      preview.style.display = 'block';
      const b = e.target.getBoundingClientRect();
      preview.style.left =
        Math.max(8, Math.min(b.left, innerWidth - preview.offsetWidth - 8)) + 'px';
      preview.style.top =
        Math.max(8, Math.min(b.bottom + 6, innerHeight - preview.offsetHeight - 8)) + 'px';
    });
    name.addEventListener('mouseleave', () => (preview.style.display = 'none'));
    name.addEventListener('click', () => (preview.style.display = 'none'));
    const tag = el(
      'span',
      { class: 'tag' + (t.mode === 'count' && t.count === 0 ? ' zero' : '') },
      handle(),
      name,
    );
    if (t.mode === 'count')
      tag.append(
        button('−', () => count(-1), 'icon', {
          'aria-label': '减少 ' + t.name,
          disabled: t.count === 0 ? '' : undefined,
        }),
      );
    const countNode = el('span', { class: 'tag-count' }, symbol(t));
    tag.append(countNode);
    if (t.mode === 'count')
      tag.append(button('＋', () => count(1), 'icon', { 'aria-label': '增加 ' + t.name }));
    function count(delta) {
      t.count = Math.max(0, Math.min(99, t.count + delta));
      changed();
      render();
    }
    tag.append(
      button(
        '×',
        () => {
          card[key] = card[key].filter((x) => x.id !== t.id);
          changed();
          render();
        },
        'icon',
        { 'aria-label': '删除标签 ' + t.name },
      ),
    );
    list.append(el('span', { class: 'tag-wrap', 'data-sort-id': t.id }, tag));
  }
  return el(
    'section',
    {},
    heading(index, title, [button('＋ 标签', () => openTag(key, null))]),
    list,
  );
}
function render() {
  const positions = new Map(
    [...sheet.querySelectorAll('.calc-list')].map((n) => [n.dataset.list, n.scrollLeft]),
  );
  preview.style.display = 'none';
  sheet.replaceChildren(
    textSection(1, 'NAME', 'name', 1),
    textSection(2, '标准速查', 'quick', 2),
    calcSection(3, '重要被动', 'passive'),
    calcSection(4, '重要主动', 'active'),
    tagsSection(5, '重要个人能力', 'abilities'),
    tagsSection(6, '重要物品', 'items'),
    textSection(7, '其他角色内容', 'other', 3),
    textSection(8, '附注', 'notes', 3),
  );
  sheet
    .querySelectorAll('.calc-list')
    .forEach((n) => (n.scrollLeft = positions.get(n.dataset.list) || 0));
}
function openTag(key, id) {
  editing = { key, id };
  const t = card[key].find((x) => x.id === id) || { name: '', detail: '', mode: 'count', count: 0 };
  $('#tag-name').value = t.name;
  $('#tag-detail').value = t.detail;
  $('#tag-mode').value = t.mode;
  $('#tag-count').value = t.count;
  modeDisplay();
  $('#tag-dialog').showModal();
  $('#tag-name').focus();
}
function modeDisplay() {
  $('#count-label').hidden = $('#tag-mode').value !== 'count';
  $('#tag-count').disabled = $('#tag-mode').value !== 'count';
}
$('#tag-mode').onchange = modeDisplay;
$('#tag-form').onsubmit = (e) => {
  e.preventDefault();
  const { key, id } = editing,
    old = card[key].find((t) => t.id === id),
    count = $('#tag-count').disabled ? old?.count || 0 : Number($('#tag-count').value);
  if (!Number.isInteger(count) || count < 0 || count > 99) return;
  const t = {
    id: id || uid(),
    name: $('#tag-name').value,
    detail: $('#tag-detail').value,
    mode: $('#tag-mode').value,
    count,
  };
  if (old) card[key][card[key].indexOf(old)] = t;
  else card[key].push(t);
  $('#tag-dialog').close();
  changed();
  render();
};
for (const id of ['cancel', 'cancel-x']) $('#' + id).onclick = () => $('#tag-dialog').close();
$('#help').onclick = () => $('#help-dialog').showModal();
$('#help-close').onclick = () => $('#help-dialog').close();
function replace(c) {
  card = c;
  dirty = false;
  $('#saved').hidden = true;
  render();
  $('#status').textContent = '当前卡已载入 · 请用 JSON 保存后续修改';
}
const canReplace = () =>
  !dirty || confirm('当前卡有尚未导出为 JSON 的内容。替换会丢失这些内容，是否继续？');
$('#new').onclick = () => {
  if (canReplace()) replace(blank());
};
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const next = validate(JSON.parse(await f.text()));
    if (canReplace()) replace(next);
  } catch (err) {
    alert('导入失败，当前卡未被替换。\n' + err.message);
  } finally {
    e.target.value = '';
  }
};
function download(kind) {
  try {
    validate(card);
    const data = kind === 'json' ? JSON.stringify(card, null, 2) : toText(card),
      blob = new Blob([data], {
        type: kind === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8',
      }),
      url = URL.createObjectURL(blob),
      a = el('a', {
        href: url,
        download:
          (card.name
            .trim()
            .slice(0, 60)
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '自由角色卡') +
          '.' +
          kind,
      });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (kind === 'json') $('#saved').hidden = false;
    $('#status').textContent = '已请求下载 ' + kind.toUpperCase() + ' · 请确认文件已保存';
  } catch (err) {
    alert('无法导出：' + err.message);
  }
}
$('#saved').onclick = () => {
  dirty = false;
  $('#saved').hidden = true;
  $('#status').textContent = '已确认 JSON 保存 · 后续修改请再次导出';
};
$('#json').onclick = () => download('json');
$('#txt').onclick = () => download('txt');
addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
installSorting(sheet, (scope, id, before) => {
  const list = scope.startsWith('rows:')
    ? [...card.passive, ...card.active].find((p) => p.id === scope.slice(5))?.rows
    : card[scope];
  if (!list) return;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || before === id) return;
  const [item] = list.splice(i, 1);
  const at = before === null ? list.length : list.findIndex((x) => x.id === before);
  if (at < 0) {
    list.splice(i, 0, item);
    return;
  }
  list.splice(at, 0, item);
  changed();
  render();
});
render();
