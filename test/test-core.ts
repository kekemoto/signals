// test-core.ts — signal / effect / batch / memo の回帰テスト
// 実行: node --test dist/test/  (jsdom 不要)
import { test } from "node:test";
import assert from "node:assert/strict";
import { signal, effect, batch, memo } from "../src/reactive.js";
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
  let runs = 0, last;
  effect(() => { runs++; last = s.value; });
  assert.equal(runs, 1, "effect 初回実行 (runs)");
  assert.equal(last, 0, "effect 初回実行 (last)");
  s.value = 5;
  assert.equal(runs, 2, "effect 依存変化で再実行 (runs)");
  assert.equal(last, 5, "effect 依存変化で再実行 (last)");
});

test("無変化なら再実行しない", () => {
  const s = signal(0);
  let runs = 0;
  effect(() => { s.value; runs++; });
  s.value = 0;
  assert.equal(runs, 1, "無変化 set は再実行しない");
});

test("dispose で購読解除", () => {
  const s = signal(0);
  let runs = 0;
  const dispose = effect(() => { s.value; runs++; });
  dispose();
  s.value = 1;
  assert.equal(runs, 1, "dispose 後は反応しない");
});

test("動的依存（条件で読む signal が変わる）", () => {
  const cond = signal(true);
  const a = signal("a"), b = signal("b");
  let last, runs = 0;
  effect(() => { runs++; last = cond.value ? a.value : b.value; });
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
  const a = signal(1), b = signal(2);
  let runs = 0, sum;
  effect(() => { runs++; sum = a.value + b.value; });
  runs = 0;
  batch(() => { a.value = 10; b.value = 20; });
  assert.equal(runs, 1, "batch は1回だけ再実行");
  assert.equal(sum, 30, "batch 後の値");
});

test("memo: 計算共有とキャッシュ", () => {
  const a = signal(1), b = signal(2);
  let calc = 0;
  const sum = memo(() => { calc++; return a.value + b.value; });
  assert.equal(sum(), 3, "memo 初期計算 (値)");
  assert.equal(calc, 1, "memo 初期計算 (回数)");
  sum(); sum();
  assert.equal(calc, 1, "memo 複数読みでも再計算なし");
  a.value = 10;
  assert.equal(sum(), 12, "memo 入力変化で再計算 (値)");
  assert.equal(calc, 2, "memo 入力変化で再計算 (回数)");
});

test("memo: value-cutoff（結果が同じなら下流は走らない）", () => {
  const n = signal(2);
  const isEven = memo(() => n.value % 2 === 0);
  let runs = 0;
  effect(() => { isEven(); runs++; });
  assert.equal(runs, 1, "cutoff 初期");
  n.value = 4; // 偶数のまま → isEven は true のまま
  assert.equal(runs, 1, "cutoff 結果不変なら下流据え置き");
  n.value = 3; // 奇数へ
  assert.equal(runs, 2, "cutoff 結果変化で下流実行");
});

test("ネストした batch", () => {
  const a = signal(0);
  let runs = 0;
  effect(() => { a.value; runs++; });
  runs = 0;
  batch(() => { batch(() => { a.value = 1; }); a.value = 2; });
  assert.equal(runs, 1, "ネストbatchは外側で1回flush");
});

test("effect 連鎖（A が書き B が読む）でグリッチなし", () => {
  const x = signal(1);
  const doubled = signal(0);
  effect(() => { doubled.value = x.value * 2; });
  let seen, runs = 0;
  effect(() => { runs++; seen = doubled.value; });
  x.value = 5;
  assert.equal(seen, 10, "連鎖伝播 最終値正しい");
});

test("[堅牢性] 例外時も後続effectが走る", () => {
  const a = signal(0);
  let bRan = false;
  effect(() => { if (a.value === 1) throw new Error("boom"); });
  effect(() => { a.value; if (a.value === 1) bRan = true; });
  let threw = false;
  try { a.value = 1; } catch { threw = true; }
  assert.ok(bRan, `例外時も後続effectが走る threw=${threw}`);
});

test("[堅牢性] 例外後もシステム回復", () => {
  const a = signal(0);
  effect(() => { if (a.value === 99) throw new Error("boom2"); });
  try { a.value = 99; } catch {}
  // 例外後、別の signal/effect が正常動作するか
  const b = signal(0);
  let runs = 0;
  effect(() => { b.value; runs++; });
  b.value = 1;
  assert.equal(runs, 2, "例外後もシステム回復");
});

test("[堅牢性] 例外effect内のsignal書き込みも伝播", () => {
  const trigger = signal(0);
  const data = signal(0);
  let seen = -1;
  effect(() => { seen = data.value; });          // data を購読
  effect(() => {
    if (trigger.value === 1) { data.value = 9; throw new Error("boom"); }
  });
  try { trigger.value = 1; } catch {}
  assert.equal(seen, 9, "例外effect内のsignal書き込みも伝播");
});

test("[堅牢性] 自己ループは検出して throw", () => {
  let threw = false;
  try {
    const a = signal(0);
    effect(() => { a.value = a.value + 1; }); // 読んで書く → 収束しない
  } catch { threw = true; }
  assert.ok(threw, "自己ループは検出して throw");
});

test("[堅牢性] 相互ループは検出して throw", () => {
  let threw = false;
  try {
    const x = signal(0), y = signal(0);
    effect(() => { x.value = y.value + 1; });
    effect(() => { y.value = x.value + 1; });
  } catch { threw = true; }
  assert.ok(threw, "相互ループは検出して throw");
});

test("[堅牢性] 収束する自己更新は通る", () => {
  let threw = false;
  const n = signal(100);
  try { effect(() => { if (n.value > 10) n.value = 10; }); } catch { threw = true; }
  assert.ok(!threw && n.value === 10, `収束する自己更新は通る threw=${threw} n=${n.value}`);
});

test("[堅牢性] flush は世代順（割り込まない）", () => {
  const a = signal(0);
  const order: string[] = [];
  effect(() => { order.push("E1:" + a.value); });                       // a を購読
  effect(() => { a.value; order.push("E2"); if (a.value === 1) a.value = 2; }); // 途中で a を書く
  order.length = 0;
  a.value = 1;
  // 世代順なら「E1(1) E2 | E1(2) E2」と区切られる（再帰なら割り込んで順序が乱れる）。
  assert.equal(order.join(","), "E1:1,E2,E1:2,E2", "flush は世代順（割り込まない）");
});

test("store: 葉が signal になり、個別に反応する", () => {
  const s = store({ user: { name: "a", age: 20 }, ok: true });
  let seen, runs = 0;
  effect(() => { runs++; seen = s.user.age.value; });
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
