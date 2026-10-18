export function mountLoginScene(root) {
  'use strict';

  var mapEl = root.querySelector('.st-login-map');
  var statusR = root.querySelector('.st-login-status-r');
  var logOld = root.querySelector('.st-login-log-old');
  var logNew = root.querySelector('.st-login-log-new');
  var MESSAGES = {
    idle: '',
    connecting: '正在连接房间…',
    error: '密码不对，再试一次。',
  };

  /* ================= 地城 ================= */
  // # 墙  . 地面  ' 门  < 楼梯  + 上锁的门（房间入口）  $ 金币  ! 药水  空格 岩石
  var MAP = [
    '#########         ###########',
    '#.......###########.........#',
    "#..$....'.........'.........#",
    '#.......###########......!..#',
    '#.<.....#         #.........#',
    "#.......#         ######'####",
    "####'####              #.#   ",
    "   #.#       ###########'####",
    '   #.#########....#.........#',
    "   #.........'..............+",
    '   ###########..............#',
    '             #....#......$..#',
    '             ################',
  ];
  var W = 29,
    H = 13,
    N = W * H;
  var GATE = { x: 28, y: 9 };
  var A1 = 110,
    A2 = 240; // 记忆褪色的时间（帧）
  var TICK_MS = 110;

  var AMBIENCE = ['火把噼啪作响。', '远处有水滴声。', '空气里有股霉味。', '墙缝里有风。'];
  var TRY_LINE = '你把钥匙插进锁孔，慢慢转动——';
  var FAIL_LINE = '咔。转不动，口令不对。';
  var WAIT_LINES = ['门缝里透出烛光', '门那边有人在洗骰子', '有人在翻规则书', '桌上的蜡烛晃了一下'];

  var grid = [],
    items0 = {},
    items = {};
  (function parse() {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var c = MAP[y].charAt(x) || ' ';
        if (c === '$' || c === '!') {
          items0[y * W + x] = c;
          c = '.';
        }
        grid.push(c);
      }
    }
  })();

  function tile(x, y) {
    return x < 0 || y < 0 || x >= W || y >= H ? ' ' : grid[y * W + x];
  }
  function walkable(x, y) {
    var c = tile(x, y);
    return c === '.' || c === "'" || c === '<';
  }
  function opaque(x, y) {
    var c = tile(x, y);
    return c === '#' || c === ' ' || c === '+';
  }
  function rand(n) {
    return Math.floor(Math.random() * n);
  }

  /* ---- 寻路：把手写的途经点连成一条巡游路线 ---- */
  var DIRS8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  function findPath(ax, ay, bx, by) {
    var prev = {},
      q = [[ax, ay]],
      k0 = ay * W + ax,
      kb = by * W + bx;
    prev[k0] = -1;
    while (q.length) {
      var p = q.shift(),
        kp = p[1] * W + p[0];
      if (kp === kb) break;
      for (var i = 0; i < 8; i++) {
        var dx = DIRS8[i][0],
          dy = DIRS8[i][1],
          nx = p[0] + dx,
          ny = p[1] + dy,
          kn = ny * W + nx;
        if (!walkable(nx, ny) || prev.hasOwnProperty(kn)) continue;
        if (dx && dy && (!walkable(p[0] + dx, p[1]) || !walkable(p[0], p[1] + dy))) continue;
        prev[kn] = kp;
        q.push([nx, ny]);
      }
    }
    var out = [],
      k = kb;
    while (k !== k0 && k !== undefined) {
      out.unshift({ x: k % W, y: (k / W) | 0 });
      k = prev[k];
    }
    return out;
  }

  var WAYS = [
    { x: 2, y: 4, ev: 'start', pause: 4 },
    { x: 3, y: 2, ev: 'gold' },
    { x: 25, y: 3, ev: 'potion' },
    { x: 24, y: 8 },
    { x: 25, y: 11, ev: 'gold' },
    { x: 27, y: 9, ev: 'door', pause: 16 },
    { x: 14, y: 9 },
    { x: 4, y: 5 },
  ];
  var route = [],
    doorIdx = 0;
  (function buildRoute() {
    for (var i = 0; i < WAYS.length; i++) {
      var a = WAYS[i],
        b = WAYS[(i + 1) % WAYS.length];
      var seg = findPath(a.x, a.y, b.x, b.y);
      if (!seg.length) continue;
      var last = seg[seg.length - 1];
      last.ev = b.ev;
      last.pause = b.pause || 0;
      route = route.concat(seg);
    }
    for (var j = 0; j < route.length; j++) if (route[j].ev === 'door') doorIdx = j;
  })();

  /* ---- 世界状态 ---- */
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduce = !!(mq && mq.matches);
  var state = 'idle';
  var tick = 0,
    timer = null,
    flick = 0;
  var hero = { x: WAYS[0].x, y: WAYS[0].y };
  var rat = { x: 21, y: 4 };
  var ratSeen = false,
    routeIdx = 0,
    pauseLeft = 0,
    gold = 0;
  var logs = ['', ''];
  var failureLine = FAIL_LINE;
  var light = new Array(N),
    seen = new Array(N),
    vis = new Array(N);
  for (var s = 0; s < N; s++) {
    light[s] = 0;
    seen[s] = -1e9;
  }

  function log(t) {
    logs.push(t);
    if (logs.length > 2) logs.shift();
  }

  function handleEvent(ev) {
    var k = hero.y * W + hero.x;
    if (ev === 'start') {
      items = {};
      for (var key in items0) if (items0.hasOwnProperty(key)) items[key] = items0[key];
      ratSeen = false;
      log(AMBIENCE[rand(AMBIENCE.length)]);
    } else if (ev === 'gold' && items[k]) {
      delete items[k];
      var n = 3 + rand(18);
      gold += n;
      log('你捡起 ' + n + ' 枚金币。');
    } else if (ev === 'potion' && items[k]) {
      delete items[k];
      log('你捡起一瓶冒泡的药水。');
    } else if (ev === 'door') {
      log('一扇上锁的厚门。门上刻着：报上口令。');
    }
  }

  function stepHero() {
    if (pauseLeft > 0) {
      pauseLeft--;
      return;
    }
    var st = route[routeIdx];
    routeIdx = (routeIdx + 1) % route.length;
    hero.x = st.x;
    hero.y = st.y;
    if (st.ev) handleEvent(st.ev);
    if (st.pause) pauseLeft = st.pause;
  }

  function stepRat() {
    var opts = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0, 0],
    ];
    var near = Math.abs(rat.x - hero.x) + Math.abs(rat.y - hero.y) <= 4;
    var best = null,
      bestScore = -1e9;
    for (var i = 0; i < opts.length; i++) {
      var nx = rat.x + opts[i][0],
        ny = rat.y + opts[i][1];
      if (nx < 19 || nx > 27 || ny < 1 || ny > 4) continue;
      if (nx === hero.x && ny === hero.y) continue;
      var score = near ? Math.abs(nx - hero.x) + Math.abs(ny - hero.y) : Math.random();
      if (score > bestScore) {
        bestScore = score;
        best = [nx, ny];
      }
    }
    if (best && (near || Math.random() < 0.5)) {
      rat.x = best[0];
      rat.y = best[1];
    }
  }

  /* ---- 光照：视线被墙挡住，墙面只在可见地面旁边亮起 ---- */
  function los(x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0),
      dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1,
      err = dx - dy,
      x = x0,
      y = y0;
    while (true) {
      var e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return true;
      if (opaque(x, y)) return false;
    }
  }

  function addLight(lx, ly, r, k) {
    var R = Math.ceil(r) + 1,
      x,
      y,
      i;
    var x0 = Math.max(0, lx - R),
      x1 = Math.min(W - 1, lx + R);
    var y0 = Math.max(0, ly - R),
      y1 = Math.min(H - 1, ly + R);
    for (y = y0; y <= y1; y++)
      for (x = x0; x <= x1; x++) {
        i = y * W + x;
        vis[i] = (x === lx && y === ly) || (walkable(x, y) && los(lx, ly, x, y));
      }
    for (y = y0; y <= y1; y++)
      for (x = x0; x <= x1; x++) {
        i = y * W + x;
        if (vis[i] || tile(x, y) === ' ' || walkable(x, y)) continue;
        for (var d = 0; d < 8; d++) {
          var nx = x + DIRS8[d][0],
            ny = y + DIRS8[d][1];
          if (
            nx >= x0 &&
            nx <= x1 &&
            ny >= y0 &&
            ny <= y1 &&
            vis[ny * W + nx] &&
            walkable(nx, ny)
          ) {
            vis[i] = 2;
            break;
          }
        }
      }
    for (y = y0; y <= y1; y++)
      for (x = x0; x <= x1; x++) {
        i = y * W + x;
        if (!vis[i]) continue;
        var ddx = x - lx,
          ddy = (y - ly) * 1.2;
        var dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > r) continue;
        var v = k * (1 - dist / (r + 0.6));
        if (v > light[i]) light[i] = v;
        vis[i] = false;
      }
  }

  function computeLight() {
    for (var i = 0; i < N; i++) {
      light[i] = 0;
      vis[i] = false;
    }
    if (state === 'idle') {
      addLight(hero.x, hero.y, 5.4 + flick, 1);
    } else if (state === 'connecting') {
      addLight(hero.x, hero.y, 4.4 + flick * 0.6, 0.9);
      var pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(tick * 0.17);
      addLight(GATE.x, GATE.y, 2.6 + 1.4 * pulse, 1); // 门缝漏出的光
      light[GATE.y * W + GATE.x] = 1;
    } else {
      addLight(hero.x, hero.y, 3.6, 0.85);
    }
    for (var j = 0; j < N; j++) if (light[j] > 0) seen[j] = tick;
  }

  /* ---- 渲染 ---- */
  var cells = [],
    lastCls = [],
    lastTxt = [];
  (function buildCells() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < N; i++) {
      var el = document.createElement('span');
      el.className = 'st-login-c';
      frag.appendChild(el);
      cells.push(el);
      lastCls.push('st-login-c');
      lastTxt.push('');
    }
    mapEl.appendChild(frag);
  })();

  function render() {
    for (var i = 0; i < N; i++) {
      var c = grid[i],
        cls = 'st-login-c',
        txt = '';
      if (c !== ' ') {
        var x = i % W,
          y = (i / W) | 0,
          lv = light[i],
          type;
        if (hero.x === x && hero.y === y) {
          type = 'hero';
          txt = '@';
          lv = 1;
        } else if (lv > 0 && rat.x === x && rat.y === y && state === 'idle') {
          type = 'rat';
          txt = 'r';
        } else if (items[i]) {
          type = items[i] === '$' ? 'gold' : 'potion';
          txt = items[i];
        } else if (c === '#') {
          type = 'wall';
        } else if (c === '.') {
          type = 'floor';
          txt = '·';
        } else if (c === "'") {
          type = 'door';
          txt = "'";
        } else if (c === '<') {
          type = 'stair';
          txt = '<';
        } else {
          txt = '+';
          type = state === 'connecting' ? 'gate-lit' : state === 'error' ? 'gate-bad' : 'gate';
        }
        var v;
        if (lv > 0) v = lv > 0.66 ? 'l4' : lv > 0.45 ? 'l3' : lv > 0.25 ? 'l2' : 'l1';
        else {
          var age = tick - seen[i];
          v = age < A1 ? 'm1' : age < A2 ? 'm2' : '';
        }
        cls += ' st-login-' + type + (v ? ' st-login-' + v : '');
      }
      if (cls !== lastCls[i]) {
        cells[i].className = cls;
        lastCls[i] = cls;
      }
      if (txt !== lastTxt[i]) {
        cells[i].textContent = txt;
        lastTxt[i] = txt;
      }
    }

    statusR.textContent = 'HP 12/12  金币 ' + gold;

    var oldLine = logs[0],
      newLine = logs[1];
    if (state === 'connecting') {
      var dots = reduce ? '…' : ['.', '..', '...'][Math.floor(tick / 4) % 3];
      oldLine = TRY_LINE;
      newLine = WAIT_LINES[Math.floor(tick / 28) % WAIT_LINES.length] + dots;
    }
    logOld.textContent = oldLine;
    logNew.textContent = newLine;
    logNew.className = 'st-login-log-new' + (state === 'error' ? ' st-login-log-bad' : '');
  }

  /* ---- 循环 ---- */
  function simulate() {
    tick++;
    flick = reduce ? 0 : Math.max(-0.6, Math.min(0.6, flick * 0.7 + (Math.random() - 0.5) * 0.5));
    if (state === 'idle' && tick % 2 === 0) {
      stepHero();
      if (tick % 6 === 0) stepRat();
    }
    computeLight();
    if (state === 'idle' && !ratSeen && light[rat.y * W + rat.x] > 0) {
      ratSeen = true;
      log('一只老鼠吱吱叫着钻进角落。');
    }
  }

  function loop() {
    simulate();
    render();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    stop();
    computeLight();
    render();
    if (reduce || document.hidden || state === 'error') return;
    timer = setInterval(loop, TICK_MS);
  }

  function bump() {
    mapEl.classList.remove('st-login-bump');
    void mapEl.offsetWidth;
    mapEl.classList.add('st-login-bump');
  }
  var onAnimationEnd = function () {
    mapEl.classList.remove('st-login-bump');
  };
  mapEl.addEventListener('animationend', onAnimationEnd);

  /* ================= 状态 ================= */
  function setState(next, opts) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGES, next)) return;
    opts = opts || {};
    var prev = state;
    state = next;
    root.setAttribute('data-state', next);

    var busy = next === 'connecting';
    var err = next === 'error';
    failureLine = opts.passwordError ? FAIL_LINE : '门暂时没有打开，请查看提示。';
    // 地城：连接与出错时，冒险者站到门前
    if (busy || err) {
      hero.x = GATE.x - 1;
      hero.y = GATE.y;
      routeIdx = (doorIdx + 1) % route.length;
      pauseLeft = 0;
    }
    if (err) {
      logs = [TRY_LINE, failureLine];
      bump();
    }
    if (next === 'idle' && prev !== 'idle') {
      logs = ['', ''];
      log(prev === 'error' ? '你把钥匙收回口袋，再想想。' : '你把钥匙收回口袋。');
      pauseLeft = 6;
    }

    start();
  }

  if (mq) {
    var onMotionChange = function () {
      reduce = mq.matches;
      start();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
    else if (mq.addListener) mq.addListener(onMotionChange);
  }

  document.addEventListener('visibilitychange', start);

  // 初始化：先静默走几步，让地图一打开就有一段探索过的痕迹
  handleEvent('start');
  pauseLeft = 4;
  for (var f = 0; f < 56; f++) simulate();
  setState('idle');
  return {
    setState: setState,
    destroy: function () {
      stop();
      document.removeEventListener('visibilitychange', start);
      mapEl.removeEventListener('animationend', onAnimationEnd);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', onMotionChange);
        else if (mq.removeListener) mq.removeListener(onMotionChange);
      }
      mapEl.replaceChildren();
    },
  };
}
