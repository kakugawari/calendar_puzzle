/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * 直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

// 対象は iPhone 16 Plus だけ (430 x 932)。端末名ではなく大きさで決め打つ。
const PHONE = { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}
function section(name) { console.log('\n' + name); }

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, extra) {
  const context = await browser.newContext({ ...PHONE, ...(extra || {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__app);
  await page.waitForTimeout(200);
  return { context, page, errors };
}

/** 指で運ぶ (押す → 少しずつ動かす → 離す) */
async function dragTo(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const n = steps || 12;
  for (let i = 1; i <= n; i++) await page.mouse.move(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n);
  await page.mouse.up();
}

const cellPoint = (page, id, i) => page.evaluate(([a, b]) => window.__app.cellPoint(a, b), [id, i || 0]);
/** つかめるマス (手前に見えているマス) を探して、その番号と画面上の点を返す */
async function grab(page, id) {
  const i = await page.evaluate((a) => window.__app.grabCell(a), id);
  if (i < 0) return null;
  return { i, pt: await cellPoint(page, id, i) };
}
/** ピースのつかめるマスから、盤の (列, 行) にそのマスが来るように運ぶ */
async function carry(page, id, col, row, steps) {
  const g = await grab(page, id);
  if (!g) return false;
  const info = await pieceInfo(page, id);
  const cell = info.cells[g.i];
  const to = await boardPoint(page, cell[0] + col, cell[1] + row);
  await dragTo(page, g.pt, to, steps);
  return true;
}
const boardPoint = (page, c, r) => page.evaluate(([a, b]) => window.__app.boardPoint(a, b), [c, r]);
const pieceInfo = (page, id) => page.evaluate((a) => {
  const p = window.__app.piece(a);
  return { o: p.o, cx: p.cx, cy: p.cy, placed: p.placed, cells: p.shape.cells, bb: p.bb };
}, id);
const shapeSig = (page, id, o) => page.evaluate(([a, b]) => {
  const s = window.Core.orient(window.Core.PIECES.filter((p) => p.id === a)[0], b);
  return JSON.stringify([s.cells, s.tri]);
}, [id, o]);
const nowSig = (page, id) => page.evaluate((a) => {
  const p = window.__app.piece(a);
  return JSON.stringify([p.shape.cells, p.shape.tri]);
}, id);

/** ピースを、解のとおりの形になるまで 回す・裏返す (ボタンで。タップで回ることは別に確かめる) */
async function orientTo(page, id, wantO) {
  const want = await shapeSig(page, id, wantO);
  if ((await nowSig(page, id)) === want) return true;
  await page.evaluate((a) => window.__app.select(a), id);
  for (let flipTry = 0; flipTry < 2; flipTry++) {
    for (let k = 0; k < 4; k++) {
      if ((await nowSig(page, id)) === want) return true;
      await page.locator('#btnRotate').click();
      await page.waitForTimeout(20);
    }
    if ((await nowSig(page, id)) === want) return true;
    await page.locator('#btnFlip').click();
    await page.waitForTimeout(20);
  }
  return (await nowSig(page, id)) === want;
}

async function solveByDrag(page, day) {
  const sol = await page.evaluate((d) => { window.__app.goDay(d); return window.__app.solution().map((pl) => ({ id: pl.pieceId, o: pl.o, dc: pl.dc, dr: pl.dr })); }, day);
  await page.waitForTimeout(100);
  let placedOk = 0;
  for (const pl of sol) {
    const done = await orientTo(page, pl.id, pl.o);
    if (!done) return { ok: false, why: `${pl.id} が向きに合わない` };
    if (!(await carry(page, pl.id, pl.dc, pl.dr))) return { ok: false, why: `${pl.id} がつかめない` };
    await page.waitForTimeout(60);
    const after = await pieceInfo(page, pl.id);
    if (after.placed && after.placed.dc === pl.dc && after.placed.dr === pl.dr) placedOk++;
  }
  return { ok: placedOk === sol.length, placedOk, total: sol.length };
}

async function run() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く');
    {
      const { context, page, errors: errs } = await open(browser);
      const fit = await page.evaluate(() => ({
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tall: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        title: document.querySelector('h1').textContent.trim(),
        day: window.__app.day()
      }));
      ok(fit.wide <= 1 && fit.tall <= 1, `スマホ幅で縦にも横にもスクロールが出ない (${fit.wide}, ${fit.tall})`);
      ok(fit.title.length > 0, `見出しが出ている (${fit.title})`);
      const today = Math.min(31, new Date().getDate());
      ok(fit.day === today, `はじめは今日の日付 (${fit.day} 日)`);

      // 全部のボタンが画面の中に、押せる大きさで見えている (横に送らないと見えない所に置かない)
      const btns = await page.evaluate(() => ['btnPrev', 'btnDate', 'btnNext', 'btnRotate', 'btnFlip', 'btnHint', 'btnReset'].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { id, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
      }));
      ok(btns.every((b) => b.l >= 0 && b.r <= 430 && b.t >= 0 && b.b <= 932), '操作ボタンが全部、画面の中に見えている');
      ok(btns.every((b) => b.w >= 44 && b.h >= 44), `操作ボタンはどれも 44px 以上 (最小 ${Math.round(Math.min(...btns.map((b) => Math.min(b.w, b.h))))}px)`);
      ok(errs.length === 0, 'JS エラーなし');
      await context.close();
    }

    // ------------------------------------------------ 最初の並べ方
    section('最初の並べ方 (31 日ぶん)');
    {
      const { context, page } = await open(browser);
      let bad = [];
      for (let d = 1; d <= 31; d++) {
        const res = await page.evaluate((day) => {
          window.__app.goDay(day);
          const m = window.__app.metrics();
          const rects = window.Core.PIECES.map((pc) => {
            const p = window.__app.piece(pc.id);
            const x0 = m.ox + (p.cx + p.bb[0]) * m.u, y0 = m.oy + (p.cy + p.bb[1]) * m.u;
            return { id: pc.id, x0, y0, x1: m.ox + (p.cx + p.bb[2]) * m.u, y1: m.oy + (p.cy + p.bb[3]) * m.u, placed: !!p.placed };
          });
          const issues = [];
          rects.forEach((r) => {
            if (r.x0 < -0.5 || r.y0 < -0.5 || r.x1 > m.W + 0.5 || r.y1 > m.H + 0.5) issues.push(r.id + ' が画面の外');
            if (r.y0 < m.tray.top - 1) issues.push(r.id + ' が盤の上にかかる');
            if (r.placed) issues.push(r.id + ' が最初から置かれている');
          });
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (!(a.x1 <= b.x0 + 0.5 || b.x1 <= a.x0 + 0.5 || a.y1 <= b.y0 + 0.5 || b.y1 <= a.y0 + 0.5)) issues.push(a.id + 'と' + b.id + ' が重なる');
          }
          return { issues, u: m.u };
        }, d);
        if (res.issues.length) bad.push(d + '日: ' + res.issues.join(', '));
      }
      ok(bad.length === 0, bad.length ? bad.join(' / ') : '31 日とも、ピースが画面におさまり、盤にかからず、重ならない');
      const u = await page.evaluate(() => window.__app.metrics().u);
      ok(u >= 36, `1 マスの大きさが指で触れる大きさ (${u}px)`);
      await context.close();
    }

    // ------------------------------------------------ 安全域を差し込んでも収まる
    section('安全域 (上 59・下 34) を差し込んでも収まる');
    {
      const { context, page } = await open(browser);
      await page.addStyleTag({ content: ':root{--sat:59px;--sab:34px}' });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const m = window.__app.metrics();
        const tb = document.getElementById('toolbar').getBoundingClientRect();
        const stage = document.getElementById('stage').getBoundingClientRect();
        const outs = window.Core.PIECES.map((pc) => {
          const p = window.__app.piece(pc.id);
          return { id: pc.id, y1: m.oy + (p.cy + p.bb[3]) * m.u, y0: m.oy + (p.cy + p.bb[1]) * m.u, x0: m.ox + (p.cx + p.bb[0]) * m.u, x1: m.ox + (p.cx + p.bb[2]) * m.u };
        });
        return {
          tall: document.documentElement.scrollHeight - 932,
          toolbarBottom: tb.bottom, stageH: stage.height, u: m.u,
          out: outs.filter((o) => o.y1 > stage.height + 0.5 || o.y0 < -0.5 || o.x0 < -0.5 || o.x1 > 430.5).map((o) => o.id)
        };
      });
      ok(r.tall <= 0 && r.toolbarBottom <= 932 - 34 + 1, `ツールバーの下が安全域の内側 (${Math.round(r.toolbarBottom)} <= 898)`);
      ok(r.out.length === 0, `ピースが盤面の外へはみ出さない ${r.out.join(',')}`);
      ok(r.u >= 34, `それでも 1 マス 34px 以上 (${r.u}px)`);
      await context.close();
    }

    // ------------------------------------------------ 回す・裏返す
    section('回す・裏返す');
    {
      const { context, page, errors: errs } = await open(browser);
      const id = 'T';
      ok(await page.locator('#btnRotate').isDisabled(), '選ぶ前は「回す」が押せない');
      const before = await pieceInfo(page, id);
      const c0 = { x: before.cx + (before.bb[0] + before.bb[2]) / 2, y: before.cy + (before.bb[1] + before.bb[3]) / 2 };
      const pt = (await grab(page, id)).pt;
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(250);
      const after = await pieceInfo(page, id);
      ok((after.o & 3) === (((before.o & 3) + 1) & 3), `タップすると 90 度回る (向き ${before.o} → ${after.o})`);
      const c1 = { x: after.cx + (after.bb[0] + after.bb[2]) / 2, y: after.cy + (after.bb[1] + after.bb[3]) / 2 };
      ok(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 0.6, `回しても見た目の中心が動かない (${Math.hypot(c1.x - c0.x, c1.y - c0.y).toFixed(2)} マス)`);
      ok(!(await page.locator('#btnRotate').isDisabled()), 'タップすると「回す」が押せる');
      for (let i = 0; i < 3; i++) await page.locator('#btnRotate').click();
      const four = await pieceInfo(page, id);
      ok((four.o & 3) === (before.o & 3), '4 回で元の向きにもどる');
      await page.locator('#btnFlip').click();
      const flipped = await pieceInfo(page, id);
      ok((flipped.o & 4) !== (four.o & 4), '「裏返す」で裏表が入れかわる');
      await page.locator('#btnFlip').click();
      const again = await pieceInfo(page, id);
      ok(again.o === four.o, '2 回裏返すと元にもどる');
      ok(errs.length === 0, 'JS エラーなし');
      await context.close();
    }

    // ------------------------------------------------ 指でうめる (本物の操作)
    section('指でうめて、クリアする');
    for (const day of [15, 7, 31]) {
      const { context, page, errors: errs } = await open(browser);
      const res = await solveByDrag(page, day);
      ok(res.ok, `${day} 日: 8 枚を回して運び、全部が解の位置にはまった (${res.placedOk}/${res.total}${res.why ? ' ' + res.why : ''})`);
      const done = await page.evaluate(() => ({ s: window.__app.status(), win: !document.getElementById('win').hidden, tools: document.getElementById('tools').hidden, text: document.getElementById('winText').textContent, count: document.getElementById('solvedCount').textContent }));
      ok(done.s.complete && done.win && done.tools, `${day} 日: クリアの表示が出る (${done.text})`);
      ok(done.count.includes('1/31'), `${day} 日: 解いた数が増える (${done.count})`);
      ok(errs.length === 0, 'JS エラーなし');
      await context.close();
    }

    // ------------------------------------------------ はまらない置き方
    section('はまらない置き方は、はまらない');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => window.__app.goDay(1));
      await page.waitForTimeout(80);
      // 屋根つきのピース A を、盤のまんなか (くぼみではない所) へ
      let id = 'A';
      let from, to;
      await carry(page, id, 3, 2);          // (3,2) のあたり: くぼみではない
      await page.waitForTimeout(250);
      let info = await pieceInfo(page, id);
      ok(!info.placed, '屋根つきのピースは、くぼみ以外にははまらない');
      ok(await page.evaluate(() => window.__app.status().covered) === 0, '盤の上には何も置かれていない');

      // 普通のピースを置いて、その上に別のピースを重ねる
      id = 'T';
      await orientTo(page, id, 0);
      await carry(page, id, 3, 0);
      await page.waitForTimeout(250);
      info = await pieceInfo(page, id);
      ok(!!info.placed, '普通のピースは盤にはまる');
      const other = 'P';
      await carry(page, other, 3, 1);          // T の上
      await page.waitForTimeout(250);
      const op = await pieceInfo(page, other);
      ok(!op.placed, '置いたピースの上には重ねられない');
      ok(await page.evaluate(() => window.__app.status().overlap) === 0, '重なりが無い');

      // 空ける日のマスには置けない
      await page.evaluate(() => window.__app.goDay(16));
      await page.waitForTimeout(80);
      await carry(page, 'P', 0, 0);       // P を (0,0) へ: 16 日のマス (1,0) をふさぐ
      await page.waitForTimeout(250);
      ok(!(await pieceInfo(page, 'P')).placed, '空ける日 (16) のマスはふさげない');
      await context.close();
    }

    // ------------------------------------------------ 置いたあと回す
    section('置いたピースを回す');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => window.__app.goDay(1));
      await page.waitForTimeout(80);
      const id = 'S';
      await orientTo(page, id, 0);
      await carry(page, id, 2, 2);
      await page.waitForTimeout(250);
      const info = await pieceInfo(page, id);
      ok(!!info.placed, 'S が盤にはまる');
      // 回すと、はまらない形になる所なので、浮く
      const gr = await grab(page, id);
      await page.mouse.click(gr.pt.x, gr.pt.y);
      await page.waitForTimeout(250);
      const rot = await pieceInfo(page, id);
      const st = await page.evaluate(() => window.__app.status());
      ok(rot.placed === null || st.overlap === 0, `回したあと、重なったまま置かれた扱いにならない (placed=${JSON.stringify(rot.placed)}, 重なり ${st.overlap})`);
      await context.close();
    }

    // ------------------------------------------------ 吸いつきで飛ばない
    section('はめる動きが飛ばない');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => window.__app.goDay(1));
      await page.waitForTimeout(80);
      const id = 'T';
      await orientTo(page, id, 0);
      const g = await grab(page, id);
      const info = await pieceInfo(page, id);
      const to0 = await boardPoint(page, info.cells[g.i][0] + 3, info.cells[g.i][1] + 0);
      const to = { x: to0.x + 10, y: to0.y - 9 };       // ぴったりから少しずらして離す
      await page.mouse.move(g.pt.x, g.pt.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(g.pt.x + (to.x - g.pt.x) * i / 10, g.pt.y + (to.y - g.pt.y) * i / 10);
      const dropped = await page.evaluate(() => { const r = document.querySelector('.piece[data-id="T"]').getBoundingClientRect(); return [r.left, r.top]; });
      await page.mouse.up();
      // 離した直後から、1 フレームずつ位置を測る
      const traced = await page.evaluate(() => new Promise((resolve) => {
        const g = document.querySelector('.piece[data-id="T"]');
        const out = [];
        let n = 0;
        const tick = () => { const r = g.getBoundingClientRect(); out.push([r.left, r.top]); if (++n < 14) requestAnimationFrame(tick); else resolve(out); };
        requestAnimationFrame(tick);
      }));
      const last = traced[traced.length - 1];
      const total = Math.hypot(last[0] - dropped[0], last[1] - dropped[1]);
      let worst = 0;
      traced.forEach((f) => { worst = Math.max(worst, Math.hypot(f[0] - dropped[0], f[1] - dropped[1])); });
      ok(total > 5, `ずらして離すと、ぴったりの位置まで動く (${total.toFixed(1)}px)`);
      ok(worst <= total + 3, `離したあと、行き過ぎたり飛んだりしない (最大 ${worst.toFixed(1)}px / 移動 ${total.toFixed(1)}px)`);
      const first = Math.hypot(traced[0][0] - dropped[0], traced[0][1] - dropped[1]);
      ok(first <= total * 0.8 + 2, `動きはじめが、離した場所から連続している (最初の 1 コマ ${first.toFixed(1)}px)`);
      const fin = await pieceInfo(page, id);
      ok(!!fin.placed, 'ずらして離しても、近ければはまる');
      await context.close();
    }

    // ------------------------------------------------ 指が画面の外へ出ても
    section('指を端の帯へ滑らせても');
    {
      const { context, page } = await open(browser);
      const id = 'N';
      const from = (await grab(page, id)).pt;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x, from.y + (920 - from.y) * i / 8);   // ツールバーの上まで
      await page.mouse.move(from.x, 931);
      await page.mouse.up();
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const mm = window.__app.metrics(), p = window.__app.piece('N');
        return { y1: mm.oy + (p.cy + p.bb[3]) * mm.u, H: mm.H, drag: document.querySelector('.piece.drag') !== null };
      });
      ok(m.y1 <= m.H + 0.5, `盤面の外へ出ず、下の端で止まる (${Math.round(m.y1)} <= ${m.H})`);
      ok(!m.drag, '離したあと、つかんだ状態が残らない');
      // 続けて別のピースを運べる
      const g2 = await grab(page, 'L');
      const dx = g2.pt.x < 215 ? 20 : -20;           // 画面の中ほうへ (端で止められないように)
      await dragTo(page, g2.pt, { x: g2.pt.x + dx, y: g2.pt.y - 30 });
      const moved = await cellPoint(page, 'L', g2.i);
      ok(Math.abs(moved.x - g2.pt.x - dx) < 2 && Math.abs(moved.y - g2.pt.y + 30) < 2,
        `離したあとも、次のピースがちゃんと動く (動いた量 ${(moved.x - g2.pt.x).toFixed(1)}, ${(moved.y - g2.pt.y).toFixed(1)})`);
      await context.close();
    }

    // ------------------------------------------------ ヒント
    section('ヒント');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => window.__app.goDay(12));
      await page.waitForTimeout(80);
      await page.locator('#btnHint').click();
      await page.waitForTimeout(250);
      let st = await page.evaluate(() => ({ placed: window.Core.PIECES.filter((p) => window.__app.piece(p.id).placed).length, label: document.getElementById('hintLabel').textContent }));
      ok(st.placed === 1 && st.label.includes('1'), `1 回押すと 1 枚だけ正しい所へ入る (${st.placed} 枚, ${st.label})`);
      // わざと、まちがった所へ数枚置いてからヒントだけでクリアできるか
      let wrong = 0;
      for (const id of ['T', 'P', 'S', 'N']) {
        const info = await pieceInfo(page, id);
        if (info.placed) continue;
        for (const cell of [[3, 2], [4, 0], [2, 1], [5, 1], [3, 3]]) {
          await carry(page, id, cell[0] - 1, cell[1] - 1, 6);
          await page.waitForTimeout(40);
          if ((await pieceInfo(page, id)).placed) { wrong++; break; }
        }
      }
      let presses = 0;
      for (; presses < 12; presses++) {
        const done = await page.evaluate(() => window.__app.status().complete);
        if (done) break;
        await page.locator('#btnHint').click();
        await page.waitForTimeout(40);
      }
      const fin = await page.evaluate(() => window.__app.status().complete);
      ok(fin, `まちがった置き方があっても、ヒントを押し続ければクリアする (まちがい ${wrong} 枚 → ヒント ${presses + 1} 回)`);
      await context.close();
    }
    {
      // 31 日ぜんぶ: ヒントだけで 8 回以内にクリア (内部の呼び出し)
      const { context, page } = await open(browser);
      const bad = await page.evaluate(() => {
        const out = [];
        for (let d = 1; d <= 31; d++) {
          window.__app.goDay(d);
          let n = 0;
          while (!window.__app.status().complete && n < 10) { window.__app.hint(); n++; }
          if (!window.__app.status().complete || n > 8) out.push(d + '日(' + n + '回)');
        }
        return out;
      });
      ok(bad.length === 0, bad.length ? '31 日のうち、ヒント 8 回で終わらない日: ' + bad.join(',') : '31 日ぜんぶ、ヒント 8 回以内でクリアする');
      await context.close();
    }

    // ------------------------------------------------ 日付をえらぶ
    section('日付をえらぶ');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => window.__app.goDay(31));
      await page.locator('#btnNext').click();
      ok((await page.evaluate(() => window.__app.day())) === 1, '31 日の次は 1 日');
      await page.locator('#btnPrev').click();
      ok((await page.evaluate(() => window.__app.day())) === 31, '1 日の前は 31 日');
      await page.locator('#btnDate').click();
      const n = await page.locator('#cal button').count();
      ok(n === 31, `カレンダーに 31 日が並ぶ (${n})`);
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('#cal button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44 || r.left < 0 || r.right > 430; }).length);
      ok(small === 0, 'どの日のボタンも 44px 以上で、画面の中');
      await page.locator('#cal button', { hasText: /^7$/ }).click();
      ok((await page.evaluate(() => window.__app.day())) === 7 && (await page.locator('#picker').isHidden()), '7 日をえらぶと切りかわり、閉じる');
      ok((await page.locator('#dayLabel').textContent()) === '7', '日付の表示が 7');
      // 日を変えると並べ直す
      await carry(page, 'T', 3, 0, 4);
      await page.locator('#btnNext').click();
      const home = await page.evaluate(() => window.Core.PIECES.every((p) => !window.__app.piece(p.id).placed));
      ok(home, '日を変えると、ピースが最初の並びにもどる');
      await context.close();
    }

    // ------------------------------------------------ 記録が残る
    section('解いた日が残る');
    {
      const { context, page } = await open(browser);
      await page.evaluate(() => { window.__app.goDay(20); for (let i = 0; i < 8; i++) window.__app.hint(); });
      await page.waitForTimeout(500);
      await page.reload();
      await page.waitForFunction(() => window.__app);
      const r = await page.evaluate(() => ({ day: window.__app.day(), count: document.getElementById('solvedCount').textContent }));
      ok(r.day === 20 && r.count.includes('1/31'), `開き直しても、日付と解いた数が残る (${r.day} 日, ${r.count})`);
      await context.close();
    }

    // ------------------------------------------------ 手の入口 (処理の重さ)
    section('遅い端末でもドラッグが軽い');
    {
      const { context, page } = await open(browser);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const ms = await page.evaluate(() => {
        const g = document.querySelector('.piece[data-id="N"]');
        const r = g.getBoundingClientRect();
        const pt = window.__app.cellPoint('N', 0);
        const fire = (type, x, y) => g.dispatchEvent(new PointerEvent(type, { pointerId: 9, bubbles: true, clientX: x, clientY: y, isPrimary: true }));
        fire('pointerdown', pt.x, pt.y);
        const t0 = performance.now();
        for (let i = 1; i <= 120; i++) fire('pointermove', pt.x + i, pt.y + i * 0.5);
        const t1 = performance.now();
        fire('pointerup', pt.x + 120, pt.y + 60);
        void r;
        return (t1 - t0) / 120;
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      ok(ms < 2, `CPU 4 倍遅で、1 回の動きに ${ms.toFixed(2)}ms (2ms 未満)`);
      await context.close();
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
