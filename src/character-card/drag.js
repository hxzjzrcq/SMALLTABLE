// Pointer sorting: one list per scope, pointer capture, explicit drop validation.
export function installSorting(root, commit) {
  let drag = null,
    frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    drag?.el.classList.remove('dragging');
    drag?.ghost?.remove();
    drag?.marker?.remove();
    drag?.note?.remove();
    document.body.classList.remove('sorting');
    drag = null;
  };
  function startPreview() {
    const source = drag.el.classList.contains('tag-wrap') ? drag.el.querySelector('.tag') : drag.el;
    const bounds = source.getBoundingClientRect(),
      ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    // Copies have no identity or interactive role in the live document.
    for (const n of [ghost, ...ghost.querySelectorAll('*')]) {
      n.removeAttribute('id');
      n.removeAttribute('data-sort-id');
      n.removeAttribute('data-list');
      n.removeAttribute('data-handle');
    }
    ghost.style.width = Math.min(bounds.width, 280, innerWidth - 32) + 'px';
    const marker = document.createElement('div');
    marker.className = 'drop-marker';
    marker.hidden = true;
    const note = document.createElement('div');
    note.className = 'drag-note';
    note.setAttribute('role', 'status');
    drag.ghost = ghost;
    drag.marker = marker;
    drag.note = note;
    document.querySelector('.preview')?.style.setProperty('display', 'none');
    document.body.append(ghost, marker, note);
    drag.el.classList.add('dragging');
    document.body.classList.add('sorting');
    showPreview(targetAt(drag.x, drag.y));
  }
  function showPreview(landing) {
    const { ghost, marker, note } = drag,
      gap = drag.touch ? 28 : 16;
    const width = ghost.offsetWidth,
      height = ghost.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - width - 8, drag.x + gap));
    const y = Math.max(
      8,
      Math.min(innerHeight - height - 8, drag.touch ? drag.y - height - gap : drag.y + gap),
    );
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
    ghost.classList.toggle('invalid-drop', !landing);
    note.textContent = landing ? '松开以放置 · Esc 取消' : '此处不可放置 · 松开保持原序';
    marker.hidden = !landing;
    if (!landing) return;
    const anchor =
      landing.target ||
      [...landing.list.children]
        .filter((e) => e.dataset.sortId && e.dataset.sortId !== drag.id)
        .at(-1);
    if (!anchor) {
      marker.hidden = true;
      return;
    }
    const b = anchor.getBoundingClientRect(),
      list = landing.list.getBoundingClientRect();
    const horizontal = landing.list.classList.contains('rows');
    marker.classList.toggle('horizontal', horizontal);
    if (horizontal) {
      const left = Math.max(2, list.left),
        right = Math.min(innerWidth - 2, list.right);
      marker.style.cssText = `left:${left}px;top:${landing.target ? b.top : b.bottom}px;width:${Math.max(0, right - left)}px;height:4px`;
    } else {
      const edge = landing.target ? b.left : b.right;
      const top = Math.max(2, b.top),
        bottom = Math.min(innerHeight - 2, b.bottom);
      marker.style.cssText = `left:${Math.max(list.left + 2, Math.min(list.right - 4, edge))}px;top:${top}px;width:4px;height:${Math.max(0, bottom - top)}px`;
    }
  }
  function targetAt(x, y) {
    const hit = document.elementFromPoint(x, y),
      list = hit?.closest('[data-list]');
    if (!list || list.dataset.list !== drag.scope) return null;
    const children = [...list.children].filter(
      (e) => e.dataset.sortId && e.dataset.sortId !== drag.id,
    );
    let target = null;
    if (list.classList.contains('calc-list'))
      target = children.find((e) => {
        const b = e.getBoundingClientRect();
        return x < b.x + b.width / 2;
      });
    else if (list.classList.contains('tag-list'))
      target = children.find((e) => {
        const b = e.getBoundingClientRect();
        return y < b.y || (y <= b.bottom && x < b.x + b.width / 2);
      });
    else
      target = children.find((e) => {
        const b = e.getBoundingClientRect();
        return y < b.y + b.height / 2;
      });
    return { list, before: target?.dataset.sortId || null, target };
  }
  function tick() {
    if (!drag) return;
    if (drag.started) {
      const list = drag.list,
        b = list.getBoundingClientRect();
      if (list.classList.contains('calc-list') && drag.y >= b.top && drag.y <= b.bottom) {
        if (drag.x > b.right - 38) list.scrollLeft += 12;
        if (drag.x < b.left + 38) list.scrollLeft -= 12;
      }
      if (drag.y > innerHeight - 45) window.scrollBy(0, 10);
      if (drag.y < 45) window.scrollBy(0, -10);
      showPreview(targetAt(drag.x, drag.y));
    }
    frame = requestAnimationFrame(tick);
  }
  root.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-handle]');
    if (!h || e.button !== 0) return;
    if (drag) return;
    const el = h.closest('[data-sort-id]'),
      list = el.parentElement;
    drag = {
      id: el.dataset.sortId,
      scope: list.dataset.list,
      list,
      el,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      touch: e.pointerType === 'touch',
      pointerId: e.pointerId,
    };
    h.setPointerCapture(e.pointerId);
    e.preventDefault();
    frame = requestAnimationFrame(tick);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5) {
      drag.started = true;
      startPreview();
    }
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag,
      t = d.started ? targetAt(e.clientX, e.clientY) : null;
    stop();
    if (t) commit(d.scope, d.id, t.before);
  });
  root.addEventListener('pointercancel', stop);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stop();
      return;
    }
    const h = e.target.closest?.('[data-handle]');
    if (!h || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const el = h.closest('[data-sort-id]'),
      list = el.parentElement,
      all = [...list.children].filter((x) => x.dataset.sortId),
      i = all.indexOf(el),
      forward = ['ArrowRight', 'ArrowDown'].includes(e.key);
    if ((!forward && i === 0) || (forward && i === all.length - 1)) return;
    commit(
      list.dataset.list,
      el.dataset.sortId,
      forward ? all[i + 2]?.dataset.sortId || null : all[i - 1].dataset.sortId,
    );
    root.querySelector(`[data-sort-id="${CSS.escape(el.dataset.sortId)}"] [data-handle]`)?.focus();
  });
}
