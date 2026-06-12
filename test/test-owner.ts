// test-owner.ts — owner ツリー / onCleanup / createRoot のテスト
// 実行: node --test dist/test/  (jsdom 不要)
import { test } from "node:test";
import assert from "node:assert/strict";
import { signal, effect, memo, onCleanup, batch, createRoot } from "../src/reactive.js";

test("onCleanup: 再実行直前に前回分が走る", () => {
  const s = signal(0);
  const order: string[] = [];
  effect(() => {
    const v = s.value;
    onCleanup(() => order.push(`cleanup ${v}`));
    order.push(`run ${v}`);
  });
  s.value = 1;
  s.value = 2;
  assert.deepEqual(order, ["run 0", "cleanup 0", "run 1", "cleanup 1", "run 2"]);
});

test("onCleanup: dispose 時に走る", () => {
  const s = signal(0);
  let cleaned = 0;
  const d = effect(() => { s.value; onCleanup(() => cleaned++); });
  assert.equal(cleaned, 0, "dispose 前は未cleanup");
  d();
  assert.equal(cleaned, 1, "dispose で cleanup");
});

test("onCleanup: 再貼り直しパターン", () => {
  const id = signal("a");
  const opened: string[] = [], closed: string[] = [];
  const d = effect(() => {
    const cur = id.value;
    opened.push(cur);                 // 購読を開く
    onCleanup(() => closed.push(cur)); // 次回・dispose時に閉じる
  });
  id.value = "b";
  id.value = "c";
  d();
  assert.deepEqual(opened, ["a", "b", "c"], "再貼り直し: open 系列");
  assert.deepEqual(closed, ["a", "b", "c"], "再貼り直し: 全て閉じられる");
});

test("owner: 親 dispose で子 effect も止まる", () => {
  const inner = signal(0);
  let childRuns = 0;
  const disposeParent = effect(() => {
    effect(() => { inner.value; childRuns++; }); // 子
  });
  assert.equal(childRuns, 1, "子は初回実行");
  inner.value = 1;
  assert.equal(childRuns, 2, "子は依存変化で再実行");
  disposeParent();                    // 親を畳む → 子も連鎖 dispose
  inner.value = 2;
  assert.equal(childRuns, 2, "親 dispose 後は子も反応しない");
});

test("owner: 親再実行で前回の子が畳まれる", () => {
  const outer = signal(0);
  const inner = signal(0);
  let childRuns = 0;
  effect(() => {
    outer.value;                                   // 親は outer に依存
    effect(() => { inner.value; childRuns++; });   // 親再実行のたびに子を新規作成
  });
  // ここまで: 親1回 → 子1つ作成 → childRuns=1
  assert.equal(childRuns, 1, "初期 childRuns");
  outer.value = 1;                  // 親再実行 → 前回の子を畳んで新しい子を作る
  assert.equal(childRuns, 2, "親再実行で新しい子");
  inner.value = 1;                  // 子が反応。リークしていれば古い子も走り +2 になる
  assert.equal(childRuns, 3, "生きている子は1つだけ（リークなし）");
});

test("memo: effect 内で作った memo は親と一緒に畳まれる", () => {
  const a = signal(1);
  let calc = 0;
  let read;
  const disposeParent = effect(() => {
    const m = memo(() => { calc++; return a.value * 2; });
    read = m();
  });
  assert.ok(calc === 1 && read === 2, "memo 初期計算");
  disposeParent();                  // 親 effect ごと畳む → memo の内部 effect も停止
  a.value = 5;                      // 停止しているので再計算されないはず
  assert.equal(calc, 1, "親 dispose で memo も停止");
});

test("memo: トップレベル memo は read.dispose で止められる", () => {
  const a = signal(1);
  let calc = 0;
  const m = memo(() => { calc++; return a.value; });
  m();
  a.value = 2;
  assert.equal(calc, 2, "dispose 前は追従");
  m.dispose();
  a.value = 3;
  assert.equal(calc, 2, "read.dispose 後は止まる");
});

test("onCleanup と batch の併用", () => {
  const a = signal(0), b = signal(0);
  let cleanups = 0;
  effect(() => { a.value; b.value; onCleanup(() => cleanups++); });
  batch(() => { a.value = 1; b.value = 1; });
  assert.equal(cleanups, 1, "batch 1回再実行 → cleanup 1回");
});

test("3階層ネストの連鎖 dispose", () => {
  const s = signal(0);
  let g = 0;
  const top = effect(() => {
    effect(() => {                       // child
      effect(() => { s.value; g++; });   // grandchild
    });
  });
  assert.equal(g, 1, "孫まで初回実行");
  top();                                  // 根を畳む
  s.value = 1;
  assert.equal(g, 1, "根 dispose で孫も止まる");
});

test("createRoot: 中で作った effect は root の dispose で止まる", () => {
  const s = signal(0);
  let runs = 0;
  let disposeRoot!: () => void;
  createRoot((dispose) => {
    disposeRoot = dispose;
    effect(() => { s.value; runs++; });
  });
  assert.equal(runs, 1, "createRoot 内 effect は初回実行");
  s.value = 1;
  assert.equal(runs, 2, "createRoot 内 effect は反応する");
  disposeRoot();
  s.value = 2;
  assert.equal(runs, 2, "createRoot dispose で止まる");
});

test("createRoot は親の所有ツリーに繋がらない（独立スコープ）", () => {
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;
  effect(() => {
    outer.value;                       // 親 effect は outer に依存
    createRoot(() => {
      effect(() => { inner.value; innerRuns++; }); // root 内（独立）
    });
  });
  assert.equal(innerRuns, 1, "初期 innerRuns");
  outer.value = 1;                     // 親再実行。root は独立なので前回の中身は畳まれない
  assert.equal(innerRuns, 2, "親再実行で root 内 effect が新規に増える");
  // 独立スコープなので、前回の root 内 effect も生きたまま → inner 変化で両方走る
  inner.value = 1;
  assert.equal(innerRuns, 4, "独立 root は親再実行で畳まれない（両方反応）");
});

test("createRoot 直下での signal 読みは追跡されない", () => {
  const s = signal(0);
  let rootRuns = 0;
  createRoot(() => {
    rootRuns++;
    s.value;          // root 直下で読む（effect ではない）
  });
  s.value = 1;        // 追跡されていなければ rootRuns は増えない
  assert.equal(rootRuns, 1, "createRoot 直下の読みは未追跡");
});
