// test-core.ts — signal / effect / batch の回帰テスト
// 実行: node --test dist/test/  (jsdom 不要)

import assert from "node:assert/strict";
import { test } from "node:test";
import { batch, cached, effect, isSignal, signal, untrack } from "../src/reactive.js";
import { store } from "../src/store.js";

test("signal の基本", () => {
  const s = signal(1);
  assert.equal(s.value, 1, "signal 初期値");
  s.value = 2;
  assert.equal(s.value, 2, "signal 書き込み");
  assert.equal(s.peek(), 2, "peek は同値");
});

test("effect は初回即実行、依存変化で再実行", () => {
  const s = signal(0);
  let runs = 0,
    last;
  effect(() => {
    runs++;
    last = s.value;
  });
  assert.equal(runs, 1, "effect 初回実行 (runs)");
  assert.equal(last, 0, "effect 初回実行 (last)");
  s.value = 5;
  assert.equal(runs, 2, "effect 依存変化で再実行 (runs)");
  assert.equal(last, 5, "effect 依存変化で再実行 (last)");
});

test("無変化なら再実行しない", () => {
  const s = signal(0);
  let runs = 0;
  effect(() => {
    s.value;
    runs++;
  });
  s.value = 0;
  assert.equal(runs, 1, "無変化 set は再実行しない");
});

test("dispose で購読解除", () => {
  const s = signal(0);
  let runs = 0;
  const dispose = effect(() => {
    s.value;
    runs++;
  });
  dispose();
  s.value = 1;
  assert.equal(runs, 1, "dispose 後は反応しない");
});

test("動的依存（条件で読む signal が変わる）", () => {
  const cond = signal(true);
  const a = signal("a"),
    b = signal("b");
  let last,
    runs = 0;
  effect(() => {
    runs++;
    last = cond.value ? a.value : b.value;
  });
  assert.equal(last, "a", "動的依存 初期 (last)");
  assert.equal(runs, 1, "動的依存 初期 (runs)");
  b.value = "B";
  assert.equal(runs, 1, "動的依存 未参照のbは無反応");
  cond.value = false;
  assert.equal(last, "B", "動的依存 切替 (last)");
  assert.equal(runs, 2, "動的依存 切替 (runs)");
  a.value = "A";
  assert.equal(runs, 2, "動的依存 切替後 旧依存aは無反応");
});

test("batch は1回にまとめる", () => {
  const a = signal(1),
    b = signal(2);
  let runs = 0,
    sum;
  effect(() => {
    runs++;
    sum = a.value + b.value;
  });
  runs = 0;
  batch(() => {
    a.value = 10;
    b.value = 20;
  });
  assert.equal(runs, 1, "batch は1回だけ再実行");
  assert.equal(sum, 30, "batch 後の値");
});

test("派生は関数で書く（複数読みでも値は整合）", () => {
  const a = signal(1),
    b = signal(2);
  const sum = () => a.value + b.value;
  let seen = 0;
  effect(() => {
    seen = sum() + sum(); // 同じ派生を2回読んでも整合
  });
  assert.equal(seen, 6, "派生関数 初期 (1+2)*2");
  a.value = 10;
  assert.equal(seen, 24, "派生関数 入力変化で追従 (10+2)*2");
});

test("cached: 計算共有とキャッシュ", () => {
  const a = signal(1),
    b = signal(2);
  let calc = 0;
  const sum = cached(() => {
    calc++;
    return a.value + b.value;
  });
  assert.equal(calc, 1, "生成時に1回計算（eager）");
  assert.equal(sum(), 3, "初期値");
  assert.equal(sum(), 3, "複数読みでも");
  assert.equal(calc, 1, "複数読みでも再計算なし（共有）");
  a.value = 10;
  assert.equal(sum(), 12, "入力変化で再計算（値）");
  assert.equal(calc, 2, "入力変化で再計算（回数）");
});

test("cached: value-cutoff（結果が同じなら下流は走らない）", () => {
  const w = signal(2),
    h = signal(3);
  const area = cached(() => w.value * h.value);
  let downstream = 0;
  effect(() => {
    area();
    downstream++;
  });
  assert.equal(area(), 6, "派生セル 初期値");
  assert.equal(downstream, 1, "下流 初期");
  // 入力は変わるが面積は同じ（2*3 → 6*1）→ cutoff で下流は走らない。
  // batch で1回の再計算にまとめ、途中の別の値を経由させない。
  batch(() => {
    w.value = 6;
    h.value = 1;
  });
  assert.equal(area(), 6, "面積は同じ");
  assert.equal(downstream, 1, "結果不変なら下流据え置き（cutoff）");
  h.value = 2;
  assert.equal(area(), 12, "面積が変化");
  assert.equal(downstream, 2, "結果変化で下流実行");
});

test("cached: 生入力と同じ effect で読んでも値は整合（read口は素の関数）", () => {
  const a = signal(1);
  const double = cached(() => a.value * 2);
  let seen: [number, number] = [0, 0];
  effect(() => {
    seen = [a.value, double()]; // 生入力と cached を同じ effect で読む
  });
  assert.deepEqual(seen, [1, 2], "初回の値");
  a.value = 5;
  assert.deepEqual(seen, [5, 10], "変更後の値も整合");
});

test("cached: untrack で追跡せずに読める（peek 相当）", () => {
  const a = signal(1);
  const double = cached(() => a.value * 2);
  let runs = 0;
  effect(() => {
    runs++;
    untrack(double); // 値は使わず、追跡だけ止めて読む
  });
  assert.equal(runs, 1, "初回");
  a.value = 9;
  assert.equal(runs, 1, "untrack 読みなので入力変化でも再実行しない");
  assert.equal(double(), 18, "値自体は最新（eager に更新済み）");
});

test("ネストした batch", () => {
  const a = signal(0);
  let runs = 0;
  effect(() => {
    a.value;
    runs++;
  });
  runs = 0;
  batch(() => {
    batch(() => {
      a.value = 1;
    });
    a.value = 2;
  });
  assert.equal(runs, 1, "ネストbatchは外側で1回flush");
});

test("effect 連鎖（A が書き B が読む）でグリッチなし", () => {
  const x = signal(1);
  const doubled = signal(0);
  effect(() => {
    doubled.value = x.value * 2;
  });
  let seen,
    runs = 0;
  effect(() => {
    runs++;
    seen = doubled.value;
  });
  x.value = 5;
  assert.equal(seen, 10, "連鎖伝播 最終値正しい");
  assert.equal(runs, 2, "グリッチなし: 初回 + 変更後の計2回だけ走る");
});

test("[堅牢性] 例外時も後続effectが走る", () => {
  const a = signal(0);
  let bRan = false;
  effect(() => {
    if (a.value === 1) throw new Error("boom");
  });
  effect(() => {
    a.value;
    if (a.value === 1) bRan = true;
  });
  let threw = false;
  try {
    a.value = 1;
  } catch {
    threw = true;
  }
  assert.ok(bRan, `例外時も後続effectが走る threw=${threw}`);
});

test("[堅牢性] 例外後もシステム回復", () => {
  const a = signal(0);
  effect(() => {
    if (a.value === 99) throw new Error("boom2");
  });
  try {
    a.value = 99;
  } catch {}
  // 例外後、別の signal/effect が正常動作するか
  const b = signal(0);
  let runs = 0;
  effect(() => {
    b.value;
    runs++;
  });
  b.value = 1;
  assert.equal(runs, 2, "例外後もシステム回復");
});

test("[堅牢性] 例外effect内のsignal書き込みも伝播", () => {
  const trigger = signal(0);
  const data = signal(0);
  let seen = -1;
  effect(() => {
    seen = data.value;
  }); // data を購読
  effect(() => {
    if (trigger.value === 1) {
      data.value = 9;
      throw new Error("boom");
    }
  });
  try {
    trigger.value = 1;
  } catch {}
  assert.equal(seen, 9, "例外effect内のsignal書き込みも伝播");
});

test("[堅牢性] 自己ループは検出して throw", () => {
  let threw = false;
  try {
    const a = signal(0);
    effect(() => {
      a.value = a.value + 1;
    }); // 読んで書く → 収束しない
  } catch {
    threw = true;
  }
  assert.ok(threw, "自己ループは検出して throw");
});

test("[堅牢性] 相互ループは検出して throw", () => {
  let threw = false;
  try {
    const x = signal(0),
      y = signal(0);
    effect(() => {
      x.value = y.value + 1;
    });
    effect(() => {
      y.value = x.value + 1;
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "相互ループは検出して throw");
});

test("[堅牢性] 収束する自己更新は通る", () => {
  let threw = false;
  const n = signal(100);
  try {
    effect(() => {
      if (n.value > 10) n.value = 10;
    });
  } catch {
    threw = true;
  }
  assert.ok(!threw && n.value === 10, `収束する自己更新は通る threw=${threw} n=${n.value}`);
});

test("[堅牢性] flush は世代順（割り込まない）", () => {
  const a = signal(0);
  const order: string[] = [];
  effect(() => {
    order.push(`E1:${a.value}`);
  }); // a を購読
  effect(() => {
    a.value;
    order.push("E2");
    if (a.value === 1) a.value = 2;
  }); // 途中で a を書く
  order.length = 0;
  a.value = 1;
  // 世代順なら「E1(1) E2 | E1(2) E2」と区切られる（再帰なら割り込んで順序が乱れる）。
  assert.equal(order.join(","), "E1:1,E2,E1:2,E2", "flush は世代順（割り込まない）");
});

test("untrack: 中で読んだ signal は依存登録されない", () => {
  const a = signal(1);
  const b = signal(10);
  let seen = 0;
  let runs = 0;
  effect(() => {
    runs++;
    seen = a.value + untrack(() => b.value); // b は追跡しない
  });
  assert.equal(seen, 11, "untrack 初期 (値)");
  assert.equal(runs, 1, "untrack 初期 (回数)");
  b.value = 20; // 追跡していないので再実行されない
  assert.equal(runs, 1, "untrack した b の変化では再実行しない");
  a.value = 2; // a は追跡している → 再実行され、その時点の b を読む
  assert.equal(runs, 2, "追跡している a の変化では再実行する");
  assert.equal(seen, 22, "untrack: 再実行時は最新の b を読む");
});

test("untrack: 戻り値をそのまま返す", () => {
  assert.equal(
    untrack(() => 42),
    42,
    "untrack は fn の戻り値を返す",
  );
});

test("untrack: 中で作った effect は現在のスコープにぶら下がる", () => {
  const a = signal(0);
  let inner = 0;
  const dispose = effect(() => {
    a.value; // 外側は a を追跡
    untrack(() => {
      effect(() => {
        a.value; // 内側 effect は通常どおり a を追跡する（untrack は追跡を止めるが新しい effect 内では効かない）
        inner++;
      });
    });
  });
  assert.equal(inner, 1, "untrack 内の effect 初回実行");
  dispose(); // 外側を畳むと内側も連鎖 dispose される
  a.value = 1;
  assert.equal(inner, 1, "親 dispose で untrack 内の effect も畳まれる");
});

test("store: 葉が signal になり、個別に反応する", () => {
  const s = store({ user: { name: "a", age: 20 }, ok: true });
  let seen,
    runs = 0;
  effect(() => {
    runs++;
    seen = s.user.age.value;
  });
  assert.equal(seen, 20, "store 初期値 (値)");
  assert.equal(runs, 1, "store 初期値 (回数)");
  s.user.age.value++;
  assert.equal(seen, 21, "store 葉の更新で反応 (値)");
  assert.equal(runs, 2, "store 葉の更新で反応 (回数)");
  runs = 0;
  s.user.name.value = "b"; // 別の葉は無反応のはず
  assert.equal(runs, 0, "store 別の葉は無反応");
});

test("store: プリミティブはそのまま signal（再帰の終端）", () => {
  const s = store(5);
  assert.ok(s.value === 5 && typeof s.peek === "function", "store プリミティブは signal");
});

test("store: 配列の各要素も signal になる", () => {
  const s = store([1, 2]);
  assert.ok(s[0].value === 1 && s[1].value === 2, "store 配列要素も signal");
});

test("isSignal: signal / store の葉は true、無関係なオブジェクトは false (#31)", () => {
  assert.equal(isSignal(signal(1)), true, "signal は signal");
  assert.equal(isSignal(store(1)), true, "store の葉も signal");
  // peek を持つだけの無関係なオブジェクトは signal 扱いしない（duck typing 対策）。
  assert.equal(isSignal({ peek: () => 1 }), false, "peek を持つ別物は signal ではない");
  assert.equal(isSignal({ value: 1, peek: () => 1 }), false, "value+peek でも signal ではない");
  // 関数（object ではない）は signal ではない。
  assert.equal(
    isSignal(() => 1),
    false,
    "関数は signal ではない",
  );
  assert.equal(isSignal(null), false, "null は signal ではない");
  assert.equal(isSignal(undefined), false, "undefined は signal ではない");
  assert.equal(isSignal(5), false, "プリミティブは signal ではない");
});
