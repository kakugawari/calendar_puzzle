/*!
 * app.js — 画面まわり。操作と描画はここに書く。
 *
 * 位置はすべて「盤のマス (0,0) を原点にしたマス単位」(cx, cy) で持つ。
 * 画面の px は origin + cx * u で出す。だから画面の大きさが変わっても置き場所が崩れない。
 */
(function () {
  'use strict';

  const C = window.Core;
  const NS = 'http://www.w3.org/2000/svg';
  const STORE = 'calpuz.v1';

  // 盤の木の板 (マス単位)。穴のまわりに余白を取る。
  const BOARD = { x0: -0.5, x1: 8.5, y0: -2.25, y1: 7.5 };
  const TAP_SLOP = 6;      // これより動いたらドラッグ (px)
  const SNAP = 0.62;       // ぴったりの位置からこれ以内ならはめる (マス)

  const els = {
    svg: document.getElementById('svg'),
    stage: document.getElementById('stage'),
    dayLabel: document.getElementById('dayLabel'),
    solvedCount: document.getElementById('solvedCount'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    btnDate: document.getElementById('btnDate'),
    btnRotate: document.getElementById('btnRotate'),
    btnFlip: document.getElementById('btnFlip'),
    btnHint: document.getElementById('btnHint'),
    btnReset: document.getElementById('btnReset'),
    hintLabel: document.getElementById('hintLabel'),
    tools: document.getElementById('tools'),
    win: document.getElementById('win'),
    winText: document.getElementById('winText'),
    winSub: document.getElementById('winSub'),
    btnNextDay: document.getElementById('btnNextDay'),
    btnWinClose: document.getElementById('btnWinClose'),
    picker: document.getElementById('picker'),
    cal: document.getElementById('cal'),
    btnPickerClose: document.getElementById('btnPickerClose'),
    btnToday: document.getElementById('btnToday')
  };

  const state = {
    day: 1,
    solved: [],            // 解いた日
    pieces: [],            // { id, o, cx, cy, home:{o,cx,cy}, placed:{dc,dr}|null, shape, bb, g, body, fill, shine, shadow }
    selected: null,
    complete: false,
    hints: 0,
    u: 36, ox: 0, oy: 0, W: 0, H: 0
  };

  const solutionCache = {};

  // ---------------------------------------------------------------- 保存 (まとめて書く・失敗しても動く)
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (Array.isArray(v.solved)) state.solved = v.solved.filter(function (d) { return d >= 1 && d <= 31; });
      if (v.day >= 1 && v.day <= 31) return v.day;
    } catch (e) { /* 保存が使えなくても遊べる */ }
    return null;
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, JSON.stringify({ solved: state.solved, day: state.day })); } catch (e) { /* 無視 */ }
    }, 250);
  }

  // ---------------------------------------------------------------- 小道具
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const px = function (cells) { return cells * state.u; };

  function pathOf(loops, u) {
    return loops.map(function (pts) {
      return 'M' + pts.map(function (p) { return (p[0] * u).toFixed(2) + ' ' + (p[1] * u).toFixed(2); }).join('L') + 'Z';
    }).join('');
  }

  function pieceById(id) { return state.pieces.filter(function (p) { return p.id === id; })[0]; }

  // ---------------------------------------------------------------- 盤 (動かない下地)
  const layers = {};

  function buildSvg() {
    const svg = els.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = el('defs', null, svg);
    const grad = function (id, x1, y1, x2, y2, stops) {
      const g = el('linearGradient', { id: id, x1: x1, y1: y1, x2: x2, y2: y2 }, defs);
      stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] === undefined ? 1 : s[2] }, g); });
    };
    grad('gPiece', 0, 0, 1, 1, [[0, '#3c1f96'], [1, '#26106b']]);
    grad('gShine', 0, 0, 0.8, 1, [[0, '#ffffff', 0.26], [0.45, '#ffffff', 0.04], [1, '#ffffff', 0]]);
    grad('gPump', 0, 0, 1, 0.6, [[0, '#ff5a22'], [0.55, '#ff9a2a'], [1, '#ffd23a']]);
    grad('gBat', 0, 0, 0, 1, [[0, '#6c86ee'], [0.5, '#8a64dc'], [1, '#9a54cf']]);
    grad('gWood', 0, 0, 1, 1, [[0, '#7a553a'], [1, '#5d3e2a']]);
    layers.board = el('g', { 'pointer-events': 'none' }, svg);
    layers.pieces = el('g', null, svg);
    layers.fx = el('g', { 'pointer-events': 'none' }, svg);
  }

  function drawBoard() {
    const u = state.u, ox = state.ox, oy = state.oy;
    const g = layers.board;
    while (g.firstChild) g.removeChild(g.firstChild);
    const root = el('g', { transform: 'translate(' + ox + ' ' + oy + ')' }, g);
    const X = function (v) { return v * u; };

    // 木の板
    const bx = X(BOARD.x0), by = X(BOARD.y0), bw = X(BOARD.x1 - BOARD.x0), bh = X(BOARD.y1 - BOARD.y0);
    el('rect', { x: bx, y: by, width: bw, height: bh, rx: X(0.55), fill: 'url(#gWood)' }, root);
    const clip = el('clipPath', { id: 'boardClip' }, root);
    el('rect', { x: bx, y: by, width: bw, height: bh, rx: X(0.55) }, clip);
    const grain = el('g', { 'clip-path': 'url(#boardClip)' }, root);
    const rng = C.mulberry32(7);
    for (let i = 0; i < 90; i++) {
      const x = bx + rng() * bw, w = 0.6 + rng() * 2.4;
      const dark = rng() < 0.6;
      el('rect', { x: x, y: by, width: w, height: bh, fill: dark ? 'rgba(40,22,10,' + (0.08 + rng() * 0.18).toFixed(2) + ')' : 'rgba(255,220,170,' + (0.03 + rng() * 0.07).toFixed(2) + ')' }, grain);
    }
    el('rect', { x: bx + 1, y: by + 1, width: bw - 2, height: bh - 2, rx: X(0.55), fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 2 }, root);

    // 月のふだ (10)
    const bd = el('g', { transform: 'translate(' + X(-0.2) + ' ' + X(-2.0) + ')' }, root);
    el('path', {
      d: 'M0 0 H' + X(1.2) + ' V' + X(0.75) + ' Q' + X(1.2) + ' ' + X(1.0) + ' ' + X(0.95) + ' ' + X(1.0) +
         ' H' + X(0.25) + ' Q0 ' + X(1.0) + ' 0 ' + X(0.75) + ' Z',
      fill: '#f4eefb', stroke: 'rgba(30,10,60,.7)', 'stroke-width': 1.5
    }, bd);
    const t10 = el('text', { x: X(0.6), y: X(0.66), 'text-anchor': 'middle', 'font-size': X(0.62), 'font-weight': 800, fill: '#3a1d70' }, bd);
    t10.textContent = '10';

    // 穴 (日付のマスと三角のくぼみ)
    const hole = el('g', null, root);
    const outline = C.outline({ cells: C.CELLS, tris: C.NOTCHES });
    el('path', { d: pathOf(outline, u), fill: '#f0e2bf', stroke: 'rgba(25,10,5,.85)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, hole);
    // 日付の下の (ぶつかって見える) 隠れマス: カボチャの下
    el('rect', { x: X(1), y: X(3), width: X(1), height: X(1), fill: '#e8d8b0' }, hole);
    C.CELLS.forEach(function (p) {
      el('rect', { x: X(p[0]) + 0.5, y: X(p[1]) + 0.5, width: u - 1, height: u - 1, fill: 'none', stroke: 'rgba(120,90,50,.28)', 'stroke-width': 1 }, hole);
      const d = C.DATE_AT[p[0] + ',' + p[1]];
      const t = el('text', {
        x: X(p[0] + 0.5), y: X(p[1] + 0.5) + u * 0.17, 'text-anchor': 'middle', 'font-size': u * 0.5, 'font-weight': 700,
        fill: '#3a2a1c', 'font-variant-numeric': 'tabular-nums'
      }, hole);
      t.textContent = String(d);
    });
    layers.holeGroup = hole;

    // いま空けるマス
    layers.target = el('g', null, root);
    drawTarget();

    // コウモリ
    drawBat(el('g', { transform: 'translate(' + X(4.0) + ' ' + X(-0.82) + ') scale(' + u + ')' }, root));
    // カボチャ
    drawPumpkin(el('g', { transform: 'translate(' + X(0.98) + ' ' + X(3.78) + ') scale(' + (u * 1.12) + ')' }, root));
  }

  function drawTarget() {
    const g = layers.target;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const t = C.CELL_OF_DATE[state.day];
    const u = state.u;
    el('rect', {
      class: 'target-ring', x: t[0] * u + 2, y: t[1] * u + 2, width: u - 4, height: u - 4, rx: 5,
      fill: 'rgba(255,138,43,.18)', stroke: '#ff8a2b', 'stroke-width': 3
    }, g);
    // 数字をもう一度、輪の上に (ピースの下になるので、輪は字の下)
    const d = state.day;
    const tx = el('text', { x: t[0] * u + u / 2, y: t[1] * u + u / 2 + u * 0.17, 'text-anchor': 'middle', 'font-size': u * 0.5, 'font-weight': 800, fill: '#b04a00' }, g);
    tx.textContent = String(d);
  }

  function drawBat(g) {
    // 単位は 1 マス。中心 (0,0)
    const edge = { stroke: '#14081f', 'stroke-width': 0.035, fill: 'url(#gBat)' };
    el('path', Object.assign({ d: 'M0.12 -0.5 C0.18 -0.92 0.42 -1.08 0.62 -1.0 C0.72 -0.7 0.64 -0.42 0.5 -0.22 Z' }, edge), g);
    el('path', Object.assign({ d: 'M-0.5 -0.12 C-0.68 -0.52 -0.95 -0.58 -1.08 -0.42 C-0.98 -0.15 -0.82 0.06 -0.55 0.22 Z' }, edge), g);
    el('ellipse', Object.assign({ cx: 0, cy: 0.1, rx: 0.68, ry: 0.62 }, edge), g);
    el('path', { d: 'M-0.44 0.0 L-0.1 0.08 L-0.4 0.24 Z', fill: '#ffe94a' }, g);
    el('path', { d: 'M0.44 0.0 L0.1 0.08 L0.4 0.24 Z', fill: '#ffe94a' }, g);
  }

  function drawPumpkin(g) {
    // カボチャ: 中心 (0,0)。右はしの 0.1 マスぶんはあえて穴のすき間を見せる
    el('rect', { x: -0.05, y: -0.55, width: 0.22, height: 0.4, rx: 0.08, transform: 'rotate(18)', fill: '#4cc13a', stroke: '#14340a', 'stroke-width': 0.03 }, g);
    el('path', { d: 'M-0.78 -0.2 C-0.7 -0.55 0.62 -0.55 0.78 -0.2 C0.88 0.1 0.9 0.5 0.7 0.72 C0.5 0.92 0.3 0.84 0.1 0.9 C-0.1 0.98 -0.3 0.86 -0.5 0.9 C-0.8 0.86 -0.92 0.4 -0.78 -0.2 Z', fill: 'url(#gPump)', stroke: '#3a1204', 'stroke-width': 0.03 }, g);
    el('path', { d: 'M-0.55 -0.02 L-0.2 0.0 L-0.4 0.26 Z', fill: '#4a2008' }, g);
    el('path', { d: 'M0.55 -0.02 L0.2 0.0 L0.4 0.26 Z', fill: '#4a2008' }, g);
    el('path', { d: 'M-0.6 0.36 Q0 0.78 0.6 0.36 L0.5 0.56 L0.35 0.5 L0.2 0.62 L0.05 0.56 L-0.1 0.66 L-0.25 0.56 L-0.4 0.58 Z', fill: '#4a2008' }, g);
  }

  // ---------------------------------------------------------------- ピースの描画
  function shapeOf(p) {
    p.shape = C.orient(PIECE[p.id], p.o);
    p.bb = C.bbox(p.shape);
  }
  const PIECE = {};
  C.PIECES.forEach(function (pc) { PIECE[pc.id] = pc; });

  function buildPieceDom(p) {
    const g = el('g', { class: 'piece', 'data-id': p.id }, layers.pieces);
    const body = el('g', { class: 'body' }, g);
    p.g = g; p.body = body;
    p.shadow = el('path', { class: 'shadow' }, body);
    p.fill = el('path', { class: 'fill', fill: 'url(#gPiece)' }, body);
    p.shine = el('path', { class: 'shine', fill: 'url(#gShine)' }, body);
    g.addEventListener('pointerdown', onDown);
  }

  function renderShape(p) {
    shapeOf(p);
    const d = pathOf(C.outline(p.shape), state.u);
    p.fill.setAttribute('d', d);
    p.shine.setAttribute('d', d);
    p.shadow.setAttribute('d', d);
    p.shadow.setAttribute('transform', 'translate(2 3)');
  }

  function place(p) {
    p.g.style.transform = 'translate(' + (state.ox + p.cx * state.u).toFixed(2) + 'px,' + (state.oy + p.cy * state.u).toFixed(2) + 'px)';
  }

  function slideTo(p, cx, cy) {
    const from = p.g.style.transform;
    p.cx = cx; p.cy = cy;
    place(p);
    p.g.animate([{ transform: from }, { transform: p.g.style.transform }], { duration: 160, easing: 'ease-out' });
  }

  function placedList(except) {
    return state.pieces.filter(function (p) { return p.placed && p !== except; })
      .map(function (p) { return { id: p.id, o: p.o, dc: p.placed.dc, dr: p.placed.dr }; });
  }

  function refreshClasses() {
    state.pieces.forEach(function (p) { p.g.classList.toggle('sel', state.selected === p); });
  }

  // ---------------------------------------------------------------- 盤にはめる
  /** 位置 (cx, cy) の近くで、はまる置き方を探す。見つかれば {dc, dr}。 */
  function findSnap(p, cx, cy) {
    const others = placedList(p);
    let best = null;
    for (let a = Math.floor(cx); a <= Math.ceil(cx); a++) {
      for (let b = Math.floor(cy); b <= Math.ceil(cy); b++) {
        const dist = Math.hypot(cx - a, cy - b);
        if (dist > SNAP) continue;
        if (!C.canPlace(state.day, others, { id: p.id, o: p.o, dc: a, dr: b })) continue;
        if (!best || dist < best.dist) best = { dc: a, dr: b, dist: dist };
      }
    }
    return best;
  }

  function trySnap(p, animate) {
    const s = findSnap(p, p.cx, p.cy);
    if (!s) { p.placed = null; return false; }
    p.placed = { dc: s.dc, dr: s.dr };
    if (animate) slideTo(p, s.dc, s.dr);
    else { p.cx = s.dc; p.cy = s.dr; place(p); }
    return true;
  }

  function clampPiece(p) {
    const u = state.u, m = 4;
    const left = state.ox + p.cx * u + p.bb[0] * u;
    const right = state.ox + p.cx * u + p.bb[2] * u;
    const top = state.oy + p.cy * u + p.bb[1] * u;
    const bottom = state.oy + p.cy * u + p.bb[3] * u;
    let dx = 0, dy = 0;
    if (left < m) dx = m - left;
    if (right > state.W - m) dx = state.W - m - right;
    if (top < m) dy = m - top;
    if (bottom > state.H - m) dy = state.H - m - bottom;
    p.cx += dx / u; p.cy += dy / u;
  }

  // ---------------------------------------------------------------- 操作
  let drag = null;

  function pointerPos(ev) {
    const r = els.svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function onDown(ev) {
    if (drag) return;
    const g = ev.currentTarget;
    const p = pieceById(g.getAttribute('data-id'));
    ev.preventDefault();
    layers.pieces.appendChild(g);                  // いちばん手前へ (つかむ前に。つかんだあとに動かすと捕まえが外れる)
    try { g.setPointerCapture(ev.pointerId); } catch (e) { /* 捕まえられなくても動く */ }
    const pos = pointerPos(ev);
    drag = { p: p, id: ev.pointerId, sx: pos.x, sy: pos.y, cx0: p.cx, cy0: p.cy, moved: false };
    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', onUp);
    g.addEventListener('pointercancel', onUp);
  }

  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const pos = pointerPos(ev);
    const dx = pos.x - drag.sx, dy = pos.y - drag.sy;
    const p = drag.p;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      drag.moved = true;
      if (p.placed) { p.placed = null; afterChange(); }
      p.g.classList.add('drag');
      state.selected = p;
      refreshClasses();
    }
    p.cx = drag.cx0 + dx / state.u;
    p.cy = drag.cy0 + dy / state.u;
    clampPiece(p);
    place(p);
  }

  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const g = ev.currentTarget, p = drag.p, moved = drag.moved;
    g.removeEventListener('pointermove', onMove);
    g.removeEventListener('pointerup', onUp);
    g.removeEventListener('pointercancel', onUp);
    try { g.releasePointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
    g.classList.remove('drag');
    drag = null;
    if (ev.type === 'pointercancel') return;
    if (!moved) {
      // タップ: 選んで、90 度回す
      state.selected = p;
      refreshClasses();
      rotate(p);
      return;
    }
    trySnap(p, true);
    afterChange();
  }

  /** 見た目の中心をそのままに、向きを変える */
  function reorient(p, o, anim) {
    const cxOld = p.cx + (p.bb[0] + p.bb[2]) / 2, cyOld = p.cy + (p.bb[1] + p.bb[3]) / 2;
    const wasPlaced = !!p.placed;
    p.o = o;
    renderShape(p);
    p.cx = cxOld - (p.bb[0] + p.bb[2]) / 2;
    p.cy = cyOld - (p.bb[1] + p.bb[3]) / 2;
    p.placed = null;
    clampPiece(p);
    place(p);
    // 回した先で盤に合うなら、そのままはめる
    if (wasPlaced) trySnap(p, true);
    if (anim) p.body.animate([{ transform: anim }, { transform: 'none' }], { duration: 150, easing: 'ease-out' });
    afterChange();
  }

  function rotate(p) {
    const f = p.o & 4, k = p.o & 3;
    reorient(p, f | ((k + 1) & 3), 'rotate(-90deg)');
  }

  function flip(p) {
    const f = p.o & 4, k = p.o & 3;
    reorient(p, (f ^ 4) | ((4 - k) & 3), 'scaleX(-1)');
  }

  // ---------------------------------------------------------------- 判定・表示
  function status() {
    return C.check(state.day, placedList());
  }

  function afterChange() {
    const s = status();
    const was = state.complete;
    state.complete = s.complete;
    if (s.complete && !was) onWin();
    if (!s.complete && was) { els.win.hidden = true; els.tools.hidden = false; }
    updateButtons();
  }

  function updateButtons() {
    els.btnRotate.disabled = !state.selected;
    els.btnFlip.disabled = !state.selected;
    els.hintLabel.textContent = state.hints ? 'ヒント ' + state.hints : 'ヒント';
    els.solvedCount.textContent = '🎃 ' + state.solved.length + '/31';
    els.dayLabel.textContent = String(state.day);
  }

  function onWin() {
    if (state.solved.indexOf(state.day) < 0) { state.solved.push(state.day); save(); }
    els.winText.textContent = '🎃 10月' + state.day + '日 クリア！';
    els.winSub.textContent = state.hints ? 'ヒント ' + state.hints + ' 回つかった' : 'ヒントなしで解いた！';
    state.selected = null;
    refreshClasses();
    els.tools.hidden = true;
    els.win.hidden = false;
    updateButtons();
    sparkle();
  }

  function sparkle() {
    const g = layers.fx;
    while (g.firstChild) g.removeChild(g.firstChild);
    const u = state.u;
    const cx = state.ox + 4 * u, cy = state.oy + 2.6 * u;
    const rng = C.mulberry32(state.day + 99);
    const colors = ['#ffd166', '#ff8a2b', '#b69cff', '#7be0a0'];
    for (let i = 0; i < 28; i++) {
      const a = rng() * Math.PI * 2, r = (2.2 + rng() * 3.2) * u;
      const c = el('circle', { cx: cx, cy: cy, r: 2 + rng() * 3, fill: colors[i % colors.length] }, g);
      c.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + (Math.cos(a) * r).toFixed(1) + 'px,' + (Math.sin(a) * r).toFixed(1) + 'px) scale(.3)', opacity: 0 }
      ], { duration: 900 + rng() * 500, easing: 'ease-out', fill: 'forwards' });
    }
  }

  // ---------------------------------------------------------------- 日付・並べ直し
  function computeMetrics() {
    const r = els.stage.getBoundingClientRect();
    state.W = Math.round(r.width); state.H = Math.round(r.height);
    els.svg.setAttribute('viewBox', '0 0 ' + state.W + ' ' + state.H);
    const pad = 6;
    const boardCells = BOARD.y1 - BOARD.y0;
    let u = Math.min(46, (state.W - 2 * pad) / (BOARD.x1 - BOARD.x0));
    let tray = null;
    for (; u >= 24; u -= 0.5) {
      const wc = Math.floor((state.W - 2 * pad) / u);
      tray = C.trayLayout(wc, state.day);
      if ((boardCells + 0.35) * u + tray.height * u + 2 * pad <= state.H) break;
    }
    state.u = u;
    state.ox = (state.W - (BOARD.x1 - BOARD.x0) * u) / 2 - BOARD.x0 * u;
    state.oy = pad - BOARD.y0 * u;
    const wc = Math.floor((state.W - 2 * pad) / u);
    tray = C.trayLayout(wc, state.day);
    state.tray = { layout: tray, left: (state.W - wc * u) / 2, top: pad + (boardCells + 0.35) * u };
  }

  function homeOf(item) {
    const p = state.tray;
    const shape = C.orient(PIECE[item.id], item.o);
    const bb = C.bbox(shape);
    const pxX = p.left + item.x * state.u - bb[0] * state.u;
    const pxY = p.top + item.y * state.u - bb[1] * state.u;
    return { o: item.o, cx: (pxX - state.ox) / state.u, cy: (pxY - state.oy) / state.u };
  }

  function setDay(day, opts) {
    state.day = day;
    state.complete = false;
    state.hints = 0;
    state.selected = null;
    els.win.hidden = true;
    els.tools.hidden = false;
    layers.fx && (layers.fx.innerHTML = '');
    save();
    layout(true);
    updateButtons();
  }

  /** 画面の大きさに合わせて並べ直す。fresh なら最初の並べ方にもどす。 */
  function layout(fresh) {
    const old = state.pieces.map(function (p) { return { id: p.id, o: p.o, cx: p.cx, cy: p.cy, placed: p.placed }; });
    const oldU = state.u;
    computeMetrics();
    if (!state.W || !state.H) return;
    buildSvg();
    drawBoard();
    state.pieces = C.PIECES.map(function (pc) { return { id: pc.id, o: 0, cx: 0, cy: 0, placed: null }; });
    state.pieces.forEach(function (p) { buildPieceDom(p); });
    const byId = {};
    old.forEach(function (o) { byId[o.id] = o; });
    state.tray.layout.items.forEach(function (it) {
      const p = pieceById(it.id);
      const h = homeOf(it);
      p.home = h;
      const prev = byId[p.id];
      if (!fresh && prev) { p.o = prev.o; p.cx = prev.cx; p.cy = prev.cy; p.placed = prev.placed; }
      else { p.o = h.o; p.cx = h.cx; p.cy = h.cy; }
      renderShape(p);
      place(p);
    });
    if (!fresh && oldU !== state.u) state.pieces.forEach(function (p) { if (!p.placed) clampPiece(p), place(p); });
    refreshClasses();
    afterChange();
  }

  function resetBoard() {
    state.hints = 0;
    state.selected = null;
    state.complete = false;
    els.win.hidden = true; els.tools.hidden = false;
    layers.fx.innerHTML = '';
    state.pieces.forEach(function (p) {
      p.placed = null;
      if (p.o !== p.home.o) { p.o = p.home.o; renderShape(p); }
      slideTo(p, p.home.cx, p.home.cy);
    });
    refreshClasses();
    updateButtons();
  }

  // ---------------------------------------------------------------- ヒント
  function solution() {
    if (!solutionCache[state.day]) solutionCache[state.day] = C.solve(state.day, 1)[0];
    return solutionCache[state.day];
  }

  function sameCells(a, b) {
    if (a.length !== b.length) return false;
    const s = {};
    a.forEach(function (q) { s[q[0] + ',' + q[1]] = true; });
    return b.every(function (q) { return s[q[0] + ',' + q[1]]; });
  }

  function cellsOf(p) {
    return C.place(PIECE[p.id], p.o, p.placed.dc, p.placed.dr);
  }

  function hint() {
    if (state.complete) return;
    const sol = solution();
    // 合っていないピースのうち、最初の 1 枚を正しい場所へ
    const todo = sol.filter(function (pl) {
      const p = pieceById(pl.pieceId);
      return !(p.placed && sameCells(cellsOf(p).cells, pl.cells));
    });
    if (!todo.length) return;
    const pl = todo[0];
    const p = pieceById(pl.pieceId);
    const target = C.place(PIECE[p.id], pl.o, pl.dc, pl.dr);
    // じゃまになっているピースは置き場へもどす
    state.pieces.forEach(function (q) {
      if (q === p || !q.placed) return;
      const qc = cellsOf(q);
      const hit = qc.cells.some(function (a) { return target.cells.some(function (b) { return a[0] === b[0] && a[1] === b[1]; }); });
      const sameNotch = qc.tri && target.tri && C.triNotch(qc.tri) === C.triNotch(target.tri);
      if (hit || sameNotch) {
        q.placed = null;
        if (q.o !== q.home.o) { q.o = q.home.o; renderShape(q); }
        slideTo(q, q.home.cx, q.home.cy);
      }
    });
    p.o = pl.o;
    renderShape(p);
    p.placed = { dc: pl.dc, dr: pl.dr };
    layers.pieces.appendChild(p.g);
    slideTo(p, pl.dc, pl.dr);
    state.selected = p;
    state.hints++;
    refreshClasses();
    afterChange();
  }

  // ---------------------------------------------------------------- 日付えらび
  function openPicker() {
    const y = new Date().getFullYear();
    const first = new Date(y, 9, 1).getDay();
    const today = new Date();
    const isOct = today.getMonth() === 9;
    els.cal.innerHTML = '';
    '日月火水木金土'.split('').forEach(function (d) {
      const s = document.createElement('div'); s.className = 'dow'; s.textContent = d; els.cal.appendChild(s);
    });
    for (let i = 0; i < first; i++) els.cal.appendChild(document.createElement('div'));
    for (let d = 1; d <= 31; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.day = String(d);
      b.textContent = String(d);
      if (d === state.day) b.classList.add('sel');
      if (isOct && d === today.getDate()) b.classList.add('now');
      if (state.solved.indexOf(d) >= 0) {
        const m = document.createElement('span'); m.className = 'mark'; m.textContent = '🎃'; b.appendChild(m);
      }
      b.addEventListener('click', function () { closePicker(); goDay(d); });
      els.cal.appendChild(b);
    }
    els.picker.hidden = false;
  }
  function closePicker() { els.picker.hidden = true; }

  function goDay(d) {
    d = ((d - 1 + 31) % 31) + 1;
    setDay(d);
  }

  function todayDay() { return Math.min(31, new Date().getDate()); }

  // ---------------------------------------------------------------- 起動
  function main() {
    const saved = load();
    state.day = saved || todayDay();

    els.btnPrev.addEventListener('click', function () { goDay(state.day - 1); });
    els.btnNext.addEventListener('click', function () { goDay(state.day + 1); });
    els.btnDate.addEventListener('click', openPicker);
    els.btnPickerClose.addEventListener('click', closePicker);
    els.picker.addEventListener('click', function (e) { if (e.target === els.picker) closePicker(); });
    els.btnToday.addEventListener('click', function () { closePicker(); goDay(todayDay()); });
    els.btnRotate.addEventListener('click', function () { if (state.selected) rotate(state.selected); });
    els.btnFlip.addEventListener('click', function () { if (state.selected) flip(state.selected); });
    els.btnHint.addEventListener('click', hint);
    els.btnReset.addEventListener('click', resetBoard);
    els.btnWinClose.addEventListener('click', function () { els.win.hidden = true; els.tools.hidden = false; });
    els.btnNextDay.addEventListener('click', function () {
      let d = state.day;
      for (let i = 0; i < 31; i++) { d = (d % 31) + 1; if (state.solved.indexOf(d) < 0) break; }
      goDay(d);
    });

    let rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        const r = els.stage.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) layout(false);
      }, 120);
    });

    layout(true);
    updateButtons();

    // 自動テストから中身をのぞくための入口
    window.__app = {
      state: function () { return state; },
      day: function () { return state.day; },
      goDay: goDay,
      hint: hint,
      reset: resetBoard,
      status: status,
      solution: solution,
      piece: function (id) {
        const p = pieceById(id);
        const r = els.svg.getBoundingClientRect();
        return { id: p.id, o: p.o, cx: p.cx, cy: p.cy, placed: p.placed, shape: p.shape, bb: p.bb, left: r.left, top: r.top };
      },
      /** 画面上 (client) の、ピースのマス i の中心 */
      cellPoint: function (id, i) {
        const p = pieceById(id), r = els.svg.getBoundingClientRect();
        const c = p.shape.cells[i];
        return { x: r.left + state.ox + (p.cx + c[0] + 0.5) * state.u, y: r.top + state.oy + (p.cy + c[1] + 0.5) * state.u };
      },
      /** ピースのマスのうち、いま手前に見えていて指でつかめるマス (なければ -1) */
      grabCell: function (id) {
        const p = pieceById(id), r = els.svg.getBoundingClientRect();
        for (let i = 0; i < p.shape.cells.length; i++) {
          const c = p.shape.cells[i];
          const x = r.left + state.ox + (p.cx + c[0] + 0.5) * state.u, y = r.top + state.oy + (p.cy + c[1] + 0.5) * state.u;
          const hit = document.elementFromPoint(x, y);
          const g = hit && hit.closest ? hit.closest('.piece') : null;
          if (g && g.getAttribute('data-id') === id) return i;
        }
        return -1;
      },
      /** 画面上 (client) の、盤のマス (c, r) の中心 */
      boardPoint: function (c, rr) {
        const r = els.svg.getBoundingClientRect();
        return { x: r.left + state.ox + (c + 0.5) * state.u, y: r.top + state.oy + (rr + 0.5) * state.u };
      },
      select: function (id) { state.selected = pieceById(id); refreshClasses(); updateButtons(); },
      metrics: function () { return { u: state.u, ox: state.ox, oy: state.oy, W: state.W, H: state.H, tray: state.tray }; }
    };
  }

  main();
})();
