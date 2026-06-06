// test-owner.ts — owner ツリー / onCleanup / createRoot のテスト
// 実行: node dist/test-owner.js  (jsdom 不要)
import { signal, effect, memo, onCleanup, batch, createRoot } from "./reactive.js";

let pass = 0, fail = 0;
const log: string[] = [];
function check(name: string, cond: unknown, detail = ""): void {
  if (cond) { pass++; log.push(`  ok  ${name}`); }
  else { fail++; log.push(`FAIL  ${name}  ${detail}`); }
}

// 1. onCleanup: 再実行の直前に前回分が走る
{
  const s = signal(0);
  const order: string[] = [];
  effect(() => {
    const v = s.value;
    onCleanup(() => order.push(`cleanup ${v}`));
    order.push(`run ${v}`);
  });
  s.value = 1;
  s.value = 2;
  check("onCleanup 再実行直前に前回分が走る",
    JSON.stringify(order) === JSON.stringify(["run 0", "cleanup 0", "run 1", "cleanup 1", "run 2"]),
    JSON.stringify(order));
}

// 2. onCleanup: dispose 時に走る
{
  const s = signal(0);
  let cleaned = 0;
  const d = effect(() => { s.value; onCleanup(() => cleaned++); });
  check("dispose 前は未cleanup", cleaned === 0);
  d();
  check("dispose で cleanup", cleaned === 1);
}

// 3. onCleanup: setInterval 的な「再貼り直し」パターン
{
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
  check("再貼り直し: open 系列", JSON.stringify(opened) === JSON.stringify(["a", "b", "c"]), JSON.stringify(opened));
  check("再貼り直し: 全て閉じられる", JSON.stringify(closed) === JSON.stringify(["a", "b", "c"]), JSON.stringify(closed));
}

// 4. owner: 親 dispose で子 effect も止まる
{
  const inner = signal(0);
  let childRuns = 0;
  const disposeParent = effect(() => {
    effect(() => { inner.value; childRuns++; }); // 子
  });
  check("子は初回実行", childRuns === 1, `childRuns=${childRuns}`);
  inner.value = 1;
  check("子は依存変化で再実行", childRuns === 2, `childRuns=${childRuns}`);
  disposeParent();                    // 親を畳む → 子も連鎖 dispose
  inner.value = 2;
  check("親 dispose 後は子も反応しない", childRuns === 2, `childRuns=${childRuns}`);
}

// 5. owner: 親再実行で前回の子が畳まれる（作り直しでリークしない）
{
  const outer = signal(0);
  const inner = signal(0);
  let childRuns = 0;
  effect(() => {
    outer.value;                                   // 親は outer に依存
    effect(() => { inner.value; childRuns++; });   // 親再実行のたびに子を新規作成
  });
  // ここまで: 親1回 → 子1つ作成 → childRuns=1
  check("初期 childRuns", childRuns === 1, `childRuns=${childRuns}`);
  outer.value = 1;                  // 親再実行 → 前回の子を畳んで新しい子を作る
  check("親再実行で新しい子", childRuns === 2, `childRuns=${childRuns}`);
  inner.value = 1;                  // 子が反応。リークしていれば古い子も走り +2 になる
  check("生きている子は1つだけ（リークなし）", childRuns === 3, `childRuns=${childRuns}`);
}

// 6. memo: effect 内で作った memo は親と一緒に畳まれる
{
  const a = signal(1);
  let calc = 0;
  let read;
  const disposeParent = effect(() => {
    const m = memo(() => { calc++; return a.value * 2; });
    read = m();
  });
  check("memo 初期計算", calc === 1 && read === 2, `calc=${calc} read=${read}`);
  disposeParent();                  // 親 effect ごと畳む → memo の内部 effect も停止
  a.value = 5;                      // 停止しているので再計算されないはず
  check("親 dispose で memo も停止", calc === 1, `calc=${calc}`);
}

// 7. memo: トップレベル memo は read.dispose で止められる
{
  const a = signal(1);
  let calc = 0;
  const m = memo(() => { calc++; return a.value; });
  m();
  a.value = 2;
  check("dispose 前は追従", calc === 2, `calc=${calc}`);
  m.dispose();
  a.value = 3;
  check("read.dispose 後は止まる", calc === 2, `calc=${calc}`);
}

// 8. onCleanup と batch の併用（まとめ更新でも cleanup は1回）
{
  const a = signal(0), b = signal(0);
  let cleanups = 0;
  effect(() => { a.value; b.value; onCleanup(() => cleanups++); });
  batch(() => { a.value = 1; b.value = 1; });
  check("batch 1回再実行 → cleanup 1回", cleanups === 1, `cleanups=${cleanups}`);
}

// 9. 3階層ネストの連鎖 dispose
{
  const s = signal(0);
  let g = 0;
  const top = effect(() => {
    effect(() => {                       // child
      effect(() => { s.value; g++; });   // grandchild
    });
  });
  check("孫まで初回実行", g === 1, `g=${g}`);
  top();                                  // 根を畳む
  s.value = 1;
  check("根 dispose で孫も止まる", g === 1, `g=${g}`);
}

// 10. createRoot: 中で作った effect は root の dispose で止まる
{
  const s = signal(0);
  let runs = 0;
  let disposeRoot!: () => void;
  createRoot((dispose) => {
    disposeRoot = dispose;
    effect(() => { s.value; runs++; });
  });
  check("createRoot 内 effect は初回実行", runs === 1, `runs=${runs}`);
  s.value = 1;
  check("createRoot 内 effect は反応する", runs === 2, `runs=${runs}`);
  disposeRoot();
  s.value = 2;
  check("createRoot dispose で止まる", runs === 2, `runs=${runs}`);
}

// 11. createRoot は親の所有ツリーに繋がらない（独立スコープ）
{
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;
  effect(() => {
    outer.value;                       // 親 effect は outer に依存
    createRoot(() => {
      effect(() => { inner.value; innerRuns++; }); // root 内（独立）
    });
  });
  check("初期 innerRuns", innerRuns === 1, `innerRuns=${innerRuns}`);
  outer.value = 1;                     // 親再実行。root は独立なので前回の中身は畳まれない
  check("親再実行で root 内 effect が新規に増える", innerRuns === 2, `innerRuns=${innerRuns}`);
  // 独立スコープなので、前回の root 内 effect も生きたまま → inner 変化で両方走る
  inner.value = 1;
  check("独立 root は親再実行で畳まれない（両方反応）", innerRuns === 4, `innerRuns=${innerRuns}`);
}

// 12. createRoot 直下での signal 読みは追跡されない（untrack）
{
  const s = signal(0);
  let rootRuns = 0;
  createRoot(() => {
    rootRuns++;
    s.value;          // root 直下で読む（effect ではない）
  });
  s.value = 1;        // 追跡されていなければ rootRuns は増えない
  check("createRoot 直下の読みは未追跡", rootRuns === 1, `rootRuns=${rootRuns}`);
}

console.log(log.join("\n"));
console.log(`\npass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
