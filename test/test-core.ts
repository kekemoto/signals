// test-core.ts — signal / effect / batch / memo の回帰テスト
// 実行: node dist/test/test-core.js  (jsdom 不要)
const mod = process.argv[2] || "../src/reactive.js";
const { signal, effect, batch, memo } = await import(mod);

let pass = 0, fail = 0;
const log: string[] = [];
function check(name: string, cond: unknown, detail = ""): void {
  if (cond) { pass++; log.push(`  ok  ${name}`); }
  else { fail++; log.push(`FAIL  ${name}  ${detail}`); }
}

// 1. signal の基本
{
  const s = signal(1);
  check("signal 初期値", s.value === 1);
  s.value = 2;
  check("signal 書き込み", s.value === 2);
  check("peek は同値", s.peek() === 2);
}

// 2. effect は初回即実行、依存変化で再実行
{
  const s = signal(0);
  let runs = 0, last;
  effect(() => { runs++; last = s.value; });
  check("effect 初回実行", runs === 1 && last === 0);
  s.value = 5;
  check("effect 依存変化で再実行", runs === 2 && last === 5);
}

// 3. 無変化なら再実行しない
{
  const s = signal(0);
  let runs = 0;
  effect(() => { s.value; runs++; });
  s.value = 0;
  check("無変化 set は再実行しない", runs === 1);
}

// 4. dispose で購読解除
{
  const s = signal(0);
  let runs = 0;
  const dispose = effect(() => { s.value; runs++; });
  dispose();
  s.value = 1;
  check("dispose 後は反応しない", runs === 1);
}

// 5. 動的依存（条件で読む signal が変わる）
{
  const cond = signal(true);
  const a = signal("a"), b = signal("b");
  let last, runs = 0;
  effect(() => { runs++; last = cond.value ? a.value : b.value; });
  check("動的依存 初期", last === "a" && runs === 1);
  b.value = "B";
  check("動的依存 未参照のbは無反応", runs === 1);
  cond.value = false;
  check("動的依存 切替", last === "B" && runs === 2);
  a.value = "A";
  check("動的依存 切替後 旧依存aは無反応", runs === 2);
}

// 6. batch は1回にまとめる
{
  const a = signal(1), b = signal(2);
  let runs = 0, sum;
  effect(() => { runs++; sum = a.value + b.value; });
  runs = 0;
  batch(() => { a.value = 10; b.value = 20; });
  check("batch は1回だけ再実行", runs === 1, `runs=${runs}`);
  check("batch 後の値", sum === 30);
}

// 7. memo: 計算共有とキャッシュ
{
  const a = signal(1), b = signal(2);
  let calc = 0;
  const sum = memo(() => { calc++; return a.value + b.value; });
  check("memo 初期計算", sum() === 3 && calc === 1);
  sum(); sum();
  check("memo 複数読みでも再計算なし", calc === 1, `calc=${calc}`);
  a.value = 10;
  check("memo 入力変化で再計算", sum() === 12 && calc === 2, `calc=${calc}`);
}

// 8. memo: value-cutoff（結果が同じなら下流は走らない）
{
  const n = signal(2);
  const isEven = memo(() => n.value % 2 === 0);
  let runs = 0;
  effect(() => { isEven(); runs++; });
  check("cutoff 初期", runs === 1);
  n.value = 4; // 偶数のまま → isEven は true のまま
  check("cutoff 結果不変なら下流据え置き", runs === 1, `runs=${runs}`);
  n.value = 3; // 奇数へ
  check("cutoff 結果変化で下流実行", runs === 2, `runs=${runs}`);
}

// 9. ネストした batch
{
  const a = signal(0);
  let runs = 0;
  effect(() => { a.value; runs++; });
  runs = 0;
  batch(() => { batch(() => { a.value = 1; }); a.value = 2; });
  check("ネストbatchは外側で1回flush", runs === 1, `runs=${runs}`);
}

// 10. effect 連鎖（A が書き B が読む）でグリッチなし
{
  const x = signal(1);
  const doubled = signal(0);
  effect(() => { doubled.value = x.value * 2; });
  let seen, runs = 0;
  effect(() => { runs++; seen = doubled.value; });
  x.value = 5;
  check("連鎖伝播 最終値正しい", seen === 10, `seen=${seen}`);
}

// 11. flush 中に effect が例外を投げても他は実行されるか（堅牢性）
{
  const a = signal(0);
  let bRan = false;
  effect(() => { if (a.value === 1) throw new Error("boom"); });
  effect(() => { a.value; if (a.value === 1) bRan = true; });
  let threw = false;
  try { a.value = 1; } catch { threw = true; }
  check("[堅牢性] 例外時も後続effectが走る", bRan, `bRan=${bRan} threw=${threw}`);
}

// 12. flush 中に例外が出た後、システムが回復するか
{
  const a = signal(0);
  effect(() => { if (a.value === 99) throw new Error("boom2"); });
  try { a.value = 99; } catch {}
  // 例外後、別の signal/effect が正常動作するか
  const b = signal(0);
  let runs = 0;
  effect(() => { b.value; runs++; });
  b.value = 1;
  check("[堅牢性] 例外後もシステム回復", runs === 2, `runs=${runs}`);
}

// 13. 例外を投げる effect 内での signal 書き込みも、購読する別 effect に伝播する
{
  const trigger = signal(0);
  const data = signal(0);
  let seen = -1;
  effect(() => { seen = data.value; });          // data を購読
  effect(() => {
    if (trigger.value === 1) { data.value = 9; throw new Error("boom"); }
  });
  try { trigger.value = 1; } catch {}
  check("[堅牢性] 例外effect内のsignal書き込みも伝播", seen === 9, `seen=${seen}`);
}

console.log(log.join("\n"));
console.log(`\n==> ${mod}\n    pass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
