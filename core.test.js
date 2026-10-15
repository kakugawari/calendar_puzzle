const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

const area = (loop) => {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
const sig = (cellLists) => cellLists.map((c) => c.map((q) => q.join(',')).sort().join(';')).sort().join('|');

test('同じ seed からは同じ数が出る', () => {
  const a = Core.mulberry32(42), b = Core.mulberry32(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a(), b());
});

// ------------------------------------------------------------ 盤
test('盤は 31 マスで、日付 1〜31 がひとつずつ入っている', () => {
  assert.strictEqual(Core.CELLS.length, 31);
  const dates = Core.CELLS.map((p) => Core.DATE_AT[p.join(',')]);
  assert.ok(dates.every((d) => Number.isInteger(d)), '全マスに日付がある');
  assert.deepStrictEqual(dates.slice().sort((a, b) => a - b), Array.from({ length: 31 }, (_, i) => i + 1));
  for (let d = 1; d <= 31; d++) assert.ok(Core.CELL_OF_DATE[d], `${d} 日のマスがある`);
});

test('写真で読んだ日付の位置が入っている', () => {
  // 日 -> [列, 行]。7 日だけは字が欠けた写真で、消去して決めた
  const seen = { 2: [1, 2], 20: [2, 1], 31: [6, 3], 3: [5, 0], 1: [5, 3], 23: [3, 1], 14: [3, 5], 13: [7, 0],
    10: [4, 0], 16: [1, 0], 28: [2, 2], 21: [4, 3], 29: [4, 1], 25: [1, 1], 22: [6, 0], 12: [3, 2],
    8: [4, 5], 18: [4, 4], 15: [5, 1], 11: [0, 1], 24: [3, 4], 4: [3, 3], 5: [7, 1], 9: [2, 3], 6: [0, 0],
    17: [6, 2], 27: [3, 0], 19: [6, 1], 30: [2, 0], 26: [4, 2] };
  Object.keys(seen).forEach((d) => assert.deepStrictEqual(Core.CELL_OF_DATE[d], seen[d], `${d} 日`));
  assert.deepStrictEqual(Core.CELL_OF_DATE[7], [5, 2]);
  assert.strictEqual(Object.keys(Core.CONFIRMED).length, 30);
});

test('穴の外ふちは 1 つの輪で、面積は 31 マス + 三角 3 つ', () => {
  const loops = Core.outline({ cells: Core.CELLS, tris: Core.NOTCHES });
  assert.strictEqual(loops.length, 1);
  assert.strictEqual(area(loops[0]), 34);
});

// ------------------------------------------------------------ ピース
test('ピースは 8 枚で、マスの合計は 30 (31 マスから 1 つ空ける)', () => {
  assert.strictEqual(Core.PIECES.length, 8);
  assert.strictEqual(Core.PIECES.reduce((s, p) => s + p.cells.length, 0), 30);
  assert.strictEqual(Core.PIECES.filter((p) => p.tri).length, 3, '三角つきは 3 枚 (屋根 2・矢じり 1)');
});

test('どの向きでも外ふちは 1 つの輪で、面積がマス数 (+三角 1) と合う', () => {
  Core.PIECES.forEach((p) => {
    for (let o = 0; o < 8; o++) {
      const loops = Core.outline(Core.orient(p, o));
      assert.strictEqual(loops.length, 1, `${p.id} 向き${o}`);
      assert.ok(Math.abs(area(loops[0]) - (p.cells.length + (p.tri ? 1 : 0))) < 1e-9, `${p.id} 向き${o} の面積`);
    }
  });
});

// ------------------------------------------------------------ 解
test('31 日ぜんぶ、解がある (どの日も遊べる)', () => {
  for (let d = 1; d <= 31; d++) {
    const s = Core.solve(d, 1);
    assert.strictEqual(s.length, 1, `${d} 日に解がある`);
  }
});

test('解は、空けた日のマス以外を重ならずにうめ、check が通る', () => {
  for (let d = 1; d <= 31; d++) {
    const sol = Core.solve(d, 1)[0];
    const cover = {};
    sol.forEach((pl) => pl.cells.forEach((q) => {
      assert.ok(!cover[q.join(',')], '重ならない');
      cover[q.join(',')] = true;
    }));
    const t = Core.CELL_OF_DATE[d];
    assert.strictEqual(Object.keys(cover).length, 30);
    assert.ok(!cover[t.join(',')], `${d} 日のマスは空いている`);
    const placed = sol.map((pl) => ({ id: pl.pieceId, o: pl.o, dc: pl.dc, dr: pl.dr }));
    assert.ok(Core.check(d, placed).complete, `${d} 日の解で完成と出る`);
    // 1 枚だけ 1 マスずらすと完成でなくなる
    const moved = placed.map((p, i) => (i === 0 ? { ...p, dc: p.dc + 1 } : p));
    assert.ok(!Core.check(d, moved).complete, '1 枚ずらしたら完成ではない');
  }
});

test('写真の並べ方 (10 日と 13 日) が解のひとつになっている', () => {
  const ph10 = [[[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]], [[2, 0], [2, 1]], [[3, 0], [3, 1], [3, 2], [4, 1]],
    [[2, 2], [2, 3], [3, 3], [3, 4]], [[5, 0], [5, 1], [5, 2], [4, 2], [4, 3]], [[6, 1], [6, 2], [6, 3], [5, 3]],
    [[6, 0], [7, 0], [7, 1]], [[4, 4], [3, 5], [4, 5]]];
  const ph13 = [[[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]], [[2, 0], [2, 1]], [[3, 0], [3, 1], [3, 2], [4, 2], [4, 3]],
    [[2, 2], [2, 3], [3, 3], [3, 4]], [[4, 0], [4, 1], [5, 0]], [[5, 1], [5, 2], [5, 3], [6, 3]],
    [[6, 0], [6, 1], [6, 2], [7, 1]], [[4, 4], [3, 5], [4, 5]]];
  assert.ok(Core.solve(10, 200).some((s) => sig(s.map((p) => p.cells)) === sig(ph10)), '10 日');
  assert.ok(Core.solve(13, 200).some((s) => sig(s.map((p) => p.cells)) === sig(ph13)), '13 日');
});

// ------------------------------------------------------------ はめる判定
test('三角つきのピースは、三角のくぼみ以外には置けない', () => {
  // A (屋根つき) を、くぼみに合わない場所へ
  assert.ok(!Core.canPlace(1, [], { id: 'A', o: 0, dc: 3, dr: 1 }), '盤の中ほどには置けない');
  assert.ok(!Core.canPlace(1, [], { id: 'A', o: 0, dc: 2, dr: 1 }), '1 マスずらすとはまらない');
  assert.ok(Core.canPlace(1, [], { id: 'A', o: 0, dc: 2, dr: 0 }), '左の屋根にはまる');
  // 矢じり (Z) は下のくぼみにだけ
  assert.ok(Core.canPlace(1, [], { id: 'Z', o: 0, dc: 3, dr: 4 }), '矢じりが下のくぼみにはまる');
  assert.ok(!Core.canPlace(1, [], { id: 'Z', o: 0, dc: 3, dr: 3 }), '1 行ずらすとはまらない');
  // 同じくぼみには 2 枚入らない (屋根どうし)
  assert.ok(!Core.canPlace(1, [{ id: 'A', o: 0, dc: 2, dr: 0 }], { id: 'F', o: 0, dc: 2, dr: 0 }), '同じ屋根に 2 枚');
});

test('重なる・穴の外・空ける日のマスには置けない', () => {
  assert.ok(!Core.canPlace(16, [], { id: 'P', o: 0, dc: 0, dr: 0 }), '16 日のマス (1,0) をふさぐ置き方');
  assert.ok(Core.canPlace(1, [], { id: 'P', o: 0, dc: 0, dr: 0 }), '1 日なら置ける');
  const placed = [{ id: 'P', o: 0, dc: 0, dr: 0 }];
  assert.ok(!Core.canPlace(1, placed, { id: 'T', o: 0, dc: 1, dr: 0 }), '重なる');
  assert.ok(!Core.canPlace(1, [], { id: 'T', o: 0, dc: 7, dr: 0 }), '穴の外にはみ出す');
});

// ------------------------------------------------------------ 最初の並べ方
test('置き場の並べ方: 重ならず、幅におさまり、同じ日なら同じ並び', () => {
  [9, 10, 11].forEach((w) => {
    for (let day = 1; day <= 31; day++) {
      const a = Core.trayLayout(w, day), b = Core.trayLayout(w, day);
      assert.deepStrictEqual(a, b, '同じ日は同じ');
      assert.strictEqual(a.items.length, 8);
      a.items.forEach((it) => {
        assert.ok(it.x >= -1e-9 && it.x + it.w <= w + 1e-9, `${day}日 ${it.id} が幅におさまる`);
      });
      for (let i = 0; i < a.items.length; i++) for (let j = i + 1; j < a.items.length; j++) {
        const p = a.items[i], q = a.items[j];
        const sep = p.x + p.w <= q.x + 1e-9 || q.x + q.w <= p.x + 1e-9 || p.y + p.h <= q.y + 1e-9 || q.y + q.h <= p.y + 1e-9;
        assert.ok(sep, `${day}日 ${p.id} と ${q.id} が重ならない`);
      }
    }
  });
  const orients = new Set();
  for (let day = 1; day <= 31; day++) orients.add(Core.trayLayout(10, day).items.map((i) => i.o).join(''));
  assert.ok(orients.size > 10, '日ごとに向きがちがう');
});
