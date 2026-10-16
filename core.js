/*!
 * core.js — ハロウィン カレンダーパズルのロジック。DOM を触らないので node でテストできる。
 *
 * 盤は 8 x 7 マスの格子。穴の形は実物の写真から起こした (CLAUDE.md の「盤の形」を見る)。
 * 日付のマスが 31 個あり、ピースは 8 枚。選んだ日のマスだけ空けて、あとを全部うめる。
 *
 * 座標は「マス単位」。マス (c, r) は x が c〜c+1、y が r〜r+1 の四角。
 * ピースの三角 (屋根・矢じり) は、盤の 3 か所のくぼみにだけはまる。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 盤
  // 行ごとの [最初の列, 最後の列]。日付が入る 31 マス。
  const ROWS = [
    [0, 7], [0, 7], [1, 6], [2, 6], [3, 4], [3, 4]
  ];
  const COLS = 8;
  const NROWS = 6;

  const CELLS = [];
  ROWS.forEach(function (range, r) {
    for (let c = range[0]; c <= range[1]; c++) CELLS.push([c, r]);
  });

  /** 各マスに印刷してある日付 (写真 32 枚から読んだ)。 */
  const DATE_AT = {
    '0,0': 6,  '1,0': 16, '2,0': 30, '3,0': 27, '4,0': 10, '5,0': 3,  '6,0': 22, '7,0': 13,
    '0,1': 11, '1,1': 25, '2,1': 20, '3,1': 23, '4,1': 29, '5,1': 15, '6,1': 19, '7,1': 5,
    '1,2': 2,  '2,2': 28, '3,2': 12, '4,2': 26, '5,2': 7,  '6,2': 17,
    '2,3': 9,  '3,3': 4,  '4,3': 21, '5,3': 1,  '6,3': 31,
    '3,4': 24, '4,4': 18,
    '3,5': 14, '4,5': 8
  };
  /** 写真で字と位置を確かめた日 (7 日も、使う人が「7」と教えてくれた写真で位置まで確かめた)。 */
  const CONFIRMED = {};
  Object.keys(DATE_AT).forEach(function (k) { CONFIRMED[k] = true; });

  const key = function (c, r) { return c + ',' + r; };
  const CELL_OF_DATE = {};
  Object.keys(DATE_AT).forEach(function (k) {
    const p = k.split(',');
    CELL_OF_DATE[DATE_AT[k]] = [Number(p[0]), Number(p[1])];
  });

  /** 屋根 2 つ・矢じり 1 つの三角くぼみ。apex = 頂点、base = 底辺の中点。 */
  const NOTCHES = [
    { id: 'L', apex: [2, -1], base: [2, 0] },
    { id: 'R', apex: [6, -1], base: [6, 0] },
    { id: 'T', apex: [4, 7], base: [4, 6] }
  ];

  // ---------------------------------------------------------------- ピース
  /**
   * cells: ピースの中のマス。tri: 三角 (あれば)。
   * 座標は盤の上で実物の写真どおりに置いたときのもの。
   */
  const PIECES = [
    { id: 'P', name: 'P', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]] },
    { id: 'A', name: 'A', cells: [[2, 0], [2, 1]], tri: { apex: [2, -1], base: [2, 0] } },
    { id: 'T', name: 'T', cells: [[3, 0], [3, 1], [3, 2], [4, 1]] },
    { id: 'S', name: 'S', cells: [[2, 2], [2, 3], [3, 3], [3, 4]] },
    { id: 'N', name: 'N', cells: [[5, 0], [5, 1], [5, 2], [4, 2], [4, 3]] },
    { id: 'L', name: 'L', cells: [[6, 1], [6, 2], [6, 3], [5, 3]] },
    { id: 'F', name: 'F', cells: [[6, 0], [7, 0], [7, 1]], tri: { apex: [6, -1], base: [6, 0] } },
    { id: 'Z', name: 'Z', cells: [[4, 4], [3, 5], [4, 5]], tri: { apex: [4, 7], base: [4, 6] } }
  ];

  // ---------------------------------------------------------------- 向き (回す・裏返す)
  // 向き o = 0..7: 下位 2 ビットが回した回数 (90 度ずつ)、ビット 2 が裏返し。
  function mapPoint(x, y, o) {
    let px = x, py = y;
    if (o & 4) px = -px;             // 裏返す (左右)
    for (let i = 0; i < (o & 3); i++) { const t = px; px = -py; py = t; }   // 90 度 (画面で時計まわり)
    return [px, py];
  }

  /** ピースを向き o にして、マスの最小が (0,0) になるようそろえた形を返す。 */
  function orient(piece, o) {
    const cells = piece.cells.map(function (p) {
      const q = mapPoint(p[0] + 0.5, p[1] + 0.5, o);
      return [Math.round(q[0] - 0.5), Math.round(q[1] - 0.5)];
    });
    let tri = null;
    if (piece.tri) tri = { apex: mapPoint(piece.tri.apex[0], piece.tri.apex[1], o), base: mapPoint(piece.tri.base[0], piece.tri.base[1], o) };
    let minC = Infinity, minR = Infinity;
    cells.forEach(function (p) { minC = Math.min(minC, p[0]); minR = Math.min(minR, p[1]); });
    const norm = cells.map(function (p) { return [p[0] - minC, p[1] - minR]; });
    cells.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    norm.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    if (tri) {
      tri = { apex: [tri.apex[0] - minC, tri.apex[1] - minR], base: [tri.base[0] - minC, tri.base[1] - minR] };
    }
    return { cells: norm, tri: tri, o: o };
  }

  /** 形が同じ向きを 1 つにまとめた、重ならない向きの一覧 */
  function orientations(piece) {
    const seen = {}, out = [];
    for (let o = 0; o < 8; o++) {
      const s = orient(piece, o);
      const sig = s.cells.map(function (p) { return p.join(','); }).join(';') +
        (s.tri ? '|' + s.tri.apex.join(',') + '>' + s.tri.base.join(',') : '');
      if (!seen[sig]) { seen[sig] = true; out.push(s); }
    }
    return out;
  }

  const ORIENTS = {};
  PIECES.forEach(function (p) { ORIENTS[p.id] = orientations(p); });

  /**
   * ピースを向き o で、左上 (dc, dr) に置いたときに占めるマスと三角。
   * o は orient() の向き番号 (0〜7)。
   */
  function place(piece, o, dc, dr) {
    const s = orient(piece, o);
    return {
      cells: s.cells.map(function (p) { return [p[0] + dc, p[1] + dr]; }),
      tri: s.tri && { apex: [s.tri.apex[0] + dc, s.tri.apex[1] + dr], base: [s.tri.base[0] + dc, s.tri.base[1] + dr] }
    };
  }

  function triNotch(tri) {
    if (!tri) return null;
    for (let i = 0; i < NOTCHES.length; i++) {
      const n = NOTCHES[i];
      if (n.apex[0] === tri.apex[0] && n.apex[1] === tri.apex[1] &&
          n.base[0] === tri.base[0] && n.base[1] === tri.base[1]) return n.id;
    }
    return null;
  }

  // ---------------------------------------------------------------- 解く
  function placementsFor(piece, freeSet) {
    const out = [];
    const seen = {};
    for (let o = 0; o < 8; o++) {
      const s = orient(piece, o);
      const sig = s.cells.map(function (p) { return p.join(','); }).join(';') +
        (s.tri ? '|' + s.tri.apex.join(',') + '>' + s.tri.base.join(',') : '');
      if (seen[sig]) continue;
      seen[sig] = true;
      let positions = [];
      if (s.tri) {
        // 三角がくぼみに合う位置だけ
        NOTCHES.forEach(function (n) {
          const dc = n.apex[0] - s.tri.apex[0], dr = n.apex[1] - s.tri.apex[1];
          if (s.tri.base[0] + dc === n.base[0] && s.tri.base[1] + dr === n.base[1]) positions.push([dc, dr, n.id]);
        });
      } else {
        for (let dc = -1; dc < COLS; dc++) for (let dr = -1; dr < NROWS; dr++) positions.push([dc, dr, null]);
      }
      positions.forEach(function (pos) {
        const cells = s.cells.map(function (p) { return [p[0] + pos[0], p[1] + pos[1]]; });
        if (cells.every(function (p) { return freeSet[key(p[0], p[1])]; })) {
          out.push({ pieceId: piece.id, o: o, dc: pos[0], dr: pos[1], cells: cells, notch: pos[2] });
        }
      });
    }
    return out;
  }

  /**
   * day の日付のマスだけ空けて、ピース全部で残りをうめる解を探す。
   * limit 個まで見つけて返す (数えたいとき用)。
   */
  function solve(day, limit) {
    const target = CELL_OF_DATE[day];
    if (!target) return [];
    const free = {};
    CELLS.forEach(function (p) { free[key(p[0], p[1])] = true; });
    delete free[key(target[0], target[1])];
    const all = {};
    PIECES.forEach(function (p) { all[p.id] = placementsFor(p, free); });
    const solutions = [];
    const cap = limit || 1;
    const cover = {};
    const usedPiece = {};
    const usedNotch = {};
    const chosen = [];

    function firstFree() {
      for (let i = 0; i < CELLS.length; i++) {
        const k = key(CELLS[i][0], CELLS[i][1]);
        if (free[k] && !cover[k]) return CELLS[i];
      }
      return null;
    }
    function dfs() {
      if (solutions.length >= cap) return;
      const cell = firstFree();
      if (!cell) {
        if (PIECES.every(function (p) { return usedPiece[p.id]; })) solutions.push(chosen.slice());
        return;
      }
      for (let i = 0; i < PIECES.length; i++) {
        const p = PIECES[i];
        if (usedPiece[p.id]) continue;
        const list = all[p.id];
        for (let j = 0; j < list.length; j++) {
          const pl = list[j];
          if (!pl.cells.some(function (q) { return q[0] === cell[0] && q[1] === cell[1]; })) continue;
          if (pl.cells.some(function (q) { return cover[key(q[0], q[1])]; })) continue;
          if (pl.notch && usedNotch[pl.notch]) continue;
          pl.cells.forEach(function (q) { cover[key(q[0], q[1])] = true; });
          usedPiece[p.id] = true;
          if (pl.notch) usedNotch[pl.notch] = true;
          chosen.push(pl);
          dfs();
          chosen.pop();
          if (pl.notch) delete usedNotch[pl.notch];
          delete usedPiece[p.id];
          pl.cells.forEach(function (q) { delete cover[key(q[0], q[1])]; });
          if (solutions.length >= cap) return;
        }
      }
    }
    dfs();
    return solutions;
  }

  // ---------------------------------------------------------------- 盤の状態の判定
  /**
   * 置いたピースの一覧 [{id, o, dc, dr}] を検べる。
   * 返すもの: { ok, covered, overlap, outside, triBad, complete }
   *  complete = 選んだ日のマス以外が全部うまり、ピースが全部置かれ、はみ出しや重なりが無い
   */
  function check(day, placed) {
    const target = CELL_OF_DATE[day];
    const hole = {};
    CELLS.forEach(function (p) { hole[key(p[0], p[1])] = true; });
    const cover = {};
    let overlap = 0, outside = 0, triBad = 0;
    const usedNotch = {};
    placed.forEach(function (pc) {
      const piece = PIECES.filter(function (p) { return p.id === pc.id; })[0];
      const g = place(piece, pc.o, pc.dc, pc.dr);
      g.cells.forEach(function (q) {
        const k = key(q[0], q[1]);
        if (!hole[k] || (target && q[0] === target[0] && q[1] === target[1])) outside++;
        if (cover[k]) overlap++;
        cover[k] = true;
      });
      if (g.tri) {
        const n = triNotch(g.tri);
        if (!n || usedNotch[n]) triBad++;
        if (n) usedNotch[n] = true;
      }
    });
    const covered = Object.keys(cover).length;
    const complete = placed.length === PIECES.length && overlap === 0 && outside === 0 && triBad === 0 &&
      covered === CELLS.length - 1;
    return { covered: covered, overlap: overlap, outside: outside, triBad: triBad, complete: complete };
  }

  /** 置こうとしているピースが、盤の上の他のピースと重ならず、ちゃんとはまるか */
  function canPlace(day, placed, pc) {
    const target = CELL_OF_DATE[day];
    const hole = {};
    CELLS.forEach(function (p) { hole[key(p[0], p[1])] = true; });
    const cover = {};
    const usedNotch = {};
    placed.forEach(function (o) {
      const piece = PIECES.filter(function (p) { return p.id === o.id; })[0];
      const g = place(piece, o.o, o.dc, o.dr);
      g.cells.forEach(function (q) { cover[key(q[0], q[1])] = true; });
      const n = triNotch(g.tri);
      if (n) usedNotch[n] = true;
    });
    const piece = PIECES.filter(function (p) { return p.id === pc.id; })[0];
    const g = place(piece, pc.o, pc.dc, pc.dr);
    for (let i = 0; i < g.cells.length; i++) {
      const q = g.cells[i], k = key(q[0], q[1]);
      if (!hole[k] || cover[k]) return false;
      if (target && q[0] === target[0] && q[1] === target[1]) return false;
    }
    if (g.tri) {
      const n = triNotch(g.tri);
      if (!n || usedNotch[n]) return false;
    }
    return true;
  }


  // ---------------------------------------------------------------- 形の外ふち・大きさ
  /** 三角の 3 つの頂点 [頂点, 底辺の一端, 底辺のもう一端] */
  function triPoints(tri) {
    const a = tri.apex, b = tri.base;
    const dx = a[0] === b[0] ? 1 : 0, dy = a[0] === b[0] ? 0 : 1;   // 底辺の向き
    return [a, [b[0] - dx, b[1] - dy], [b[0] + dx, b[1] + dy]];
  }

  /** 形 (orient の結果) の外ふち。時計まわりの点の輪を返す (まっすぐな所の途中の点は省く)。 */
  function outline(shape) {
    const edges = {};                      // "x,y>x,y" -> [from, to]
    const ek = function (a, b) { return a.join(',') + '>' + b.join(','); };
    const add = function (a, b) {
      const rev = ek(b, a);
      if (edges[rev]) delete edges[rev];
      else edges[ek(a, b)] = [a, b];
    };
    shape.cells.forEach(function (p) {
      const c = p[0], r = p[1];
      add([c, r], [c + 1, r]); add([c + 1, r], [c + 1, r + 1]);
      add([c + 1, r + 1], [c, r + 1]); add([c, r + 1], [c, r]);
    });
    const tris = shape.tris || (shape.tri ? [shape.tri] : []);
    tris.forEach(function (tri) {
      const t = triPoints(tri);
      let a = t[0], b = t[1], c = t[2];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross < 0) { const tmp = b; b = c; c = tmp; }
      // a→b→c→a。底辺 (a を含まない辺) は 1 マスずつに割る。
      const segs = [[a, b], [b, c], [c, a]];
      segs.forEach(function (sg) {
        const from = sg[0], to = sg[1];
        const horizontal = from[1] === to[1] && from[0] !== to[0] && from !== a && to !== a;
        const vertical = from[0] === to[0] && from !== a && to !== a;
        if (horizontal || vertical) {
          const n = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
          const sx = Math.sign(to[0] - from[0]), sy = Math.sign(to[1] - from[1]);
          for (let i = 0; i < n; i++) add([from[0] + sx * i, from[1] + sy * i], [from[0] + sx * (i + 1), from[1] + sy * (i + 1)]);
        } else add(from, to);
      });
    });
    const next = {};
    Object.keys(edges).forEach(function (k) {
      const e = edges[k]; const f = e[0].join(',');
      (next[f] = next[f] || []).push(e);
    });
    const loops = [];
    const used = {};
    Object.keys(edges).forEach(function (k) {
      if (used[k]) return;
      const pts = [];
      let e = edges[k];
      while (e && !used[ek(e[0], e[1])]) {
        used[ek(e[0], e[1])] = true;
        pts.push(e[0]);
        const list = next[e[1].join(',')] || [];
        e = list.filter(function (x) { return !used[ek(x[0], x[1])]; })[0];
      }
      // まっすぐな所の途中の点を省く
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[(i + pts.length - 1) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        if ((p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]) !== 0) out.push(p1);
      }
      loops.push(out);
    });
    return loops;
  }

  /** 形 (三角もふくむ) をぴったり囲む四角 [x0, y0, x1, y1] (マス単位) */
  function bbox(shape) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    shape.cells.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0] + 1); y1 = Math.max(y1, p[1] + 1);
    });
    if (shape.tri) triPoints(shape.tri).forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    return [x0, y0, x1, y1];
  }

  // ---------------------------------------------------------------- 最初の並べ方
  /** 決まった順番で数を出す乱数 (mulberry32)。同じ seed からは同じ並びになる。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 置き場にピースを並べる。向きは日ごとにばらばら (横長になる向きの中から選ぶ)。
   * widthCells: 置き場の幅 (マス単位)。返り値: items = [{id, o, x, y}] (x,y は四角の左上)、height。
   */
  function trayLayout(widthCells, seed) {
    const rng = mulberry32(seed);
    const gap = 0.3;
    const items = PIECES.map(function (p) {
      const os = [];
      for (let o = 0; o < 8; o++) {
        const bb = bbox(orient(p, o));
        os.push({ o: o, w: bb[2] - bb[0], h: bb[3] - bb[1] });
      }
      const wide = os.filter(function (e) { return e.w >= e.h; });
      const pool = wide.length ? wide : os;
      const pick = pool[Math.floor(rng() * pool.length)];
      return { id: p.id, o: pick.o, w: pick.w, h: pick.h };
    });
    items.sort(function (a, b) { return b.h - a.h || a.id.localeCompare(b.id); });
    const rows = [];
    let row = null;
    items.forEach(function (it) {
      if (!row || row.w + it.w + (row.list.length ? gap : 0) > widthCells) { row = { list: [], w: 0, h: 0 }; rows.push(row); }
      row.w += it.w + (row.list.length ? gap : 0);
      row.h = Math.max(row.h, it.h);
      row.list.push(it);
    });
    const out = [];
    let y = 0;
    rows.forEach(function (rw) {
      let x = (widthCells - rw.w) / 2;
      rw.list.forEach(function (it) {
        out.push({ id: it.id, o: it.o, x: x, y: y + (rw.h - it.h) / 2, w: it.w, h: it.h });
        x += it.w + gap;
      });
      y += rw.h + gap;
    });
    return { items: out, height: y - gap, rows: rows.length };
  }

  return {
    triPoints: triPoints, outline: outline, bbox: bbox, trayLayout: trayLayout, mulberry32: mulberry32,
    COLS: COLS, NROWS: NROWS, CELLS: CELLS, DATE_AT: DATE_AT, CONFIRMED: CONFIRMED,
    CELL_OF_DATE: CELL_OF_DATE, NOTCHES: NOTCHES, PIECES: PIECES, ORIENTS: ORIENTS,
    orient: orient, place: place, triNotch: triNotch, solve: solve, check: check, canPlace: canPlace,
    key: key
  };
});
