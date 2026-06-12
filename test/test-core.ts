// test-core.ts — signal / effect / batch / memo の回帰テスト
// 実行: node --test dist/test/  (jsdom 不要)

import assert from "node:assert/strict";
import { test } from "node:test";
import { batch, effect, isSignal, memo, signal, untrack } from "../src/reactive.js";
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

test("memo: 計算共有とキャッシュ", () => {
  const a = signal(1),
    b = signal(2);
  let calc = 0;
  const sum = memo(() => {
    calc++;
    return a.value + b.value;
  });
  assert.equal(sum(), 3, "memo 初期計算 (値)");
  assert.equal(calc, 1, "memo 初期計算 (回数)");
  sum();
  sum();
  assert.equal(calc, 1, "memo 複数読みでも再計算なし");
  a.value = 10;
  assert.equal(sum(), 12, "memo 入力変化で再計算 (値)");
  assert.equal(calc, 2, "memo 入力変化で再計算 (回数)");
});

test("memo: value-cutoff（結果が同じなら下流は走らない）", () => {
  const n = signal(2);
  const isEven = memo(() => n.value % 2 === 0);
  let runs = 0;
  effect(() => {
    isEven();
    runs++;
  });
  assert.equal(runs, 1, "cutoff 初期");
  n.value = 4; // 偶数のまま → isEven は true のまま
  assert.equal(runs, 1, "cutoff 結果不変なら下流据え置き");
  n.value = 3; // 奇数へ
  assert.equal(runs, 2, "cutoff 結果変化で下流実行");
});

test("memo: lazy（読まれなければ計算しない / #1）", () => {
  const a = signal(1);
  let calc = 0;
  const m = memo(() => {
    calc++;
    return a.value * 2;
  });
  assert.equal(calc, 0, "memo 生成だけでは計算しない");
  a.value = 2;
  assert.equal(calc, 0, "未使用 memo は入力変化でも計算しない");
  assert.equal(m(), 4, "初めて読んだ時点で計算（値）");
  assert.equal(calc, 1, "初めて読んだ時点で計算（回数）");
  a.value = 3;
  assert.equal(calc, 1, "入力変化しても読まれるまで再計算しない");
  assert.equal(m(), 6, "再び読むと最新値（値）");
  assert.equal(calc, 2, "再び読むと再計算（回数）");
});

test("memo: 生入力と memo を同じ effect で読んでも二重実行しない（グリッチなし / #2）", () => {
  const a = signal(1);
  const double = memo(() => a.value * 2);
  let runs = 0;
  let seen: [number, number] = [0, 0];
  effect(() => {
    runs++;
    seen = [a.value, double()]; // 生入力と memo を同じ effect で読む
  });
  assert.equal(runs, 1, "初回1回");
  assert.deepEqual(seen, [1, 2], "初回の値");
  a.value = 5;
  assert.equal(runs, 2, "a 変更で effect は1回だけ（a 由来＋memo 由来の二重実行なし）");
  assert.deepEqual(seen, [5, 10], "変更後の値も整合（グリッチなし）");
});

test("memo: ダイヤモンド依存でも下流 effect は1回（中間 memo 経由）", () => {
  const a = signal(1);
  const b = memo(() => a.value + 1);
  const c = memo(() => a.value + 2);
  let runs = 0;
  let sum = 0;
  effect(() => {
    runs++;
    sum = b() + c();
  });
  assert.equal(runs, 1, "初回1回");
  assert.equal(sum, 5, "初回 (1+1)+(1+2)");
  a.value = 10;
  assert.equal(runs, 2, "共通入力 a の変更でも下流 effect は1回だけ");
  assert.equal(sum, 23, "変更後 (10+1)+(10+2)");
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
  // memo は関数（object ではない）なので signal ではない。
  assert.equal(isSignal(memo(() => 1)), false, "memo は signal ではない");
  assert.equal(isSignal(null), false, "null は signal ではない");
  assert.equal(isSignal(undefined), false, "undefined は signal ではない");
  assert.equal(isSignal(5), false, "プリミティブは signal ではない");
});
