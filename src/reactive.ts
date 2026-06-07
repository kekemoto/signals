// =============================================================================
// reactive.ts — ライブラリ非依存の最小リアクティブコア
//
//   signal    : 値を持ち、読まれたら依存登録・書かれたら購読者へ通知するセル
//   effect    : 依存が変わると再実行される副作用。dispose 関数を返す
//   batch     : 複数の変更を1回の再実行にまとめる
//   memo      : 重い派生を1回だけ計算して共有・キャッシュする（signal+effect の合成）
//   onCleanup : effect の後始末を登録する。再実行直前・dispose時に呼ばれる
//
// 派生値は基本「ただの関数」で書く:
//   const fullName = () => first.value + " " + last.value;
//   effect(() => console.log(fullName()));   // first / last の変化に反応する
// 関数は中間ノードを作らず、読まれた瞬間に最新値を計算するのでグリッチが起きない。
// 唯一の弱点はメモ化されないこと。重い派生を複数箇所で読むホットな場面だけ memo に
// 差し替える（呼び出しは fullName() のまま）。memo は計算の共有と value-cutoff を得る
// 代わり、eager（未使用でも計算する）で、生入力と memo を同じ effect で読むと二重実行になる。
//
// 所有ツリー（ownership）:
//   effect / memo を作ると、いま実行中の effect の「子」として自動登録される。
//   - 親が再実行されると、前回作った子は自動で dispose される（作り直しでリークしない）
//   - 親を dispose すると、子も連鎖して畳まれる
//   なので dispose を手で持ち回る必要はほぼなくなり、ツリーの根（トップレベルの
//   effect）の dispose を1つ握るだけで配下ごと片付く。
//   onCleanup(fn) は「再実行直前・dispose時に呼ぶ後始末」を現在の effect に登録する
//   （setInterval の clear、イベント購読の解除、fetch の abort など）。
//
// 等価判定は Object.is 固定。
//
// 既知の限界（最小実装ゆえの割り切り）:
//   - effect 内で自分の依存を書き換える無限ループの保護なし
//   - トップレベル（どの effect の中でもない場所）で作った effect / memo は親がいない
//     ので自動では畳まれない。戻り値（effect）や read.dispose（memo）で手動解放する。
//     これらを1か所にまとめたいなら createRoot 相当を足すとよい。
// =============================================================================

// --- 型 ---------------------------------------------------------------------
/** `.value` で読み書き、`.peek()` で追跡せずに読むリアクティブセル。 */
export interface Signal<T> {
  value: T;
  /** 依存登録せずに現在値を読む。 */
  peek(): T;
}

/** `memo` の読み口。関数として呼ぶと最新のキャッシュ値を返す。 */
export interface Memo<T> {
  (): T;
  /** 内部 effect を解放する（トップレベル memo の明示停止用）。 */
  dispose: () => void;
}

// 購読者リスト（ある signal / key を読んでいる computation の集合）。
type Subscribers = Set<Computation>;

// 所有ツリーのノード。effect の本体(run)と createRoot の根が共通で持つ。
interface Owner {
  deps: Set<Subscribers>;        // 自分が購読している購読者リスト（古い依存の掃除用）
  children: Set<Computation>;    // 子ノード（自分の中で作られた effect / memo）
  cleanups: Array<() => void>;   // onCleanup で登録された後始末
  owner: Owner | null;           // 作成時の親
}

// 依存追跡の対象になる computation。run() で再実行される callable な Owner。
interface Computation extends Owner {
  (): void;
}

// --- 内部状態 ---------------------------------------------------------------
let activeComputation: Computation | null = null; // いま依存を集めている effect（observer）
let currentOwner: Owner | null = null;             // いまの所有ツリーの親（effect か createRoot の根）
let batchDepth = 0;                                // batch() のネスト深さ
const pendingEffects = new Set<Computation>();     // バッチ終了時にまとめて走らせる effect

// 溜まった effect を一度ずつ実行する。
// 1つの effect が例外を投げても残りはすべて実行し、最初の例外だけを投げ直す。
// （pendingEffects は実行前にクリアするので、ここで途中で抜けると残りの effect が
//   恒久的に失われる ＝ 1つのバグが無関係な effect を巻き添えにする。それを防ぐ）
function flush(): void {
  const list = [...pendingEffects];
  pendingEffects.clear();
  let firstError: unknown;
  let errored = false;
  for (const run of list) {
    try {
      run();
    } catch (err) {
      if (!errored) { firstError = err; errored = true; }
    }
  }
  if (errored) throw firstError;
}

// fn 中の変更をまとめ、最後に一度だけ flush する
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) flush();
  }
}

// 依存していた全ての購読者リストから自分を外す（古い依存の掃除）
function unsubscribe(node: Owner): void {
  for (const subscribers of node.deps) subscribers.delete(node as Computation);
  node.deps.clear();
}

// node のサブツリーを掃除する: 子を再帰で畳む → onCleanup を実行 → 依存を解除。
// node 自身は親の children に残す（effect の再実行で同じ node を再利用するため）。
function cleanup(node: Owner): void {
  for (const child of node.children) cleanup(child); // 子を先に畳む（深い方から）
  node.children.clear();
  for (const fn of node.cleanups) fn();              // ユーザー登録の後始末
  node.cleanups.length = 0;
  unsubscribe(node);                                 // 購読解除
}

// node を完全に破棄する: サブツリーを掃除し、親の children からも外す。
function dispose(node: Owner): void {
  cleanup(node);
  if (node.owner) node.owner.children.delete(node as Computation);
}

// 読み取り中の effect を、いま触った購読者リストに相互登録する
function track(subscribers: Subscribers): void {
  if (activeComputation) {
    subscribers.add(activeComputation);
    activeComputation.deps.add(subscribers);
  }
}

// 購読者を再実行キューに積む（batch 内なら合流し、最後に一度だけ flush される）
function notify(subscribers: Subscribers): void {
  batch(() => {
    for (const run of subscribers) pendingEffects.add(run);
  });
}

// --- signal -----------------------------------------------------------------
// 値ひとつ＋購読者リストひとつのリアクティブセル。
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers: Subscribers = new Set();
  return {
    get value(): T {
      track(subscribers);                 // 読まれた → 依存登録
      return value;
    },
    set value(next: T) {
      if (Object.is(next, value)) return; // 無変化なら何もしない
      value = next;
      notify(subscribers);                // 購読者へ通知
    },
    peek: () => value,                    // 追跡せずに読む
  };
}

// signal() が返すセルかどうかを判定する。h / tags / html で「関数の穴」と同じく
// reactive に扱うため、シグナルを直接渡せる（${count} のように .value を省ける）。
// peek を持つことを目印にする（プレーンなオブジェクトは peek を持たないので false）。
export function isSignal(x: unknown): x is Signal<unknown> {
  return x != null && typeof x === "object" && typeof (x as Signal<unknown>).peek === "function";
}

// --- effect -----------------------------------------------------------------
// 依存が変わると再実行される副作用。戻り値を呼ぶと購読解除（dispose）。
// run() 自身が「実行中の effect」の正体。依存(deps)・子(children)・後始末(cleanups)・
// 作成時の親(owner) をプロパティとして持ち回る。
export function effect(fn: () => void): () => void {
  const run = (() => {
    cleanup(run);                         // 毎回、前回の子・後始末・依存を捨ててから
    const prevObserver = activeComputation;
    const prevOwner = currentOwner;
    activeComputation = run;              // 依存追跡の対象を自分に
    currentOwner = run;                   // 所有ツリーの親も自分に
    try {
      fn();                               // fn 内の signal 読み取りを依存として収集
    } finally {
      activeComputation = prevObserver;
      currentOwner = prevOwner;
    }
  }) as Computation;
  run.deps = new Set();
  run.children = new Set();
  run.cleanups = [];
  run.owner = currentOwner;               // 作成時の親（再実行では変わらない）
  if (currentOwner) currentOwner.children.add(run); // 親にぶら下げる
  run();
  return () => dispose(run);              // dispose（サブツリーごと畳む）
}

// --- onCleanup --------------------------------------------------------------
// 現在の effect に後始末を登録する。effect が「再実行される直前」と「dispose される時」
// に呼ばれる。setInterval の clear、購読解除、AbortController.abort などに使う。
// effect の外で呼んでも何も起きない（捨てられる）。
export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

// --- createRoot -------------------------------------------------------------
// 所有ツリーの「独立した根」を作る。fn には dispose 関数が渡され、root の中で作った
// effect / memo はこの根にぶら下がる。dispose を呼ぶと、その配下をまとめて畳める。
// 親の所有ツリーには繋がない（＝自動では畳まれない、明示 dispose 用の独立スコープ）。
// リストの行のように「個別に生かしたり消したりしたい単位」を包むのに使う。
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Owner = { deps: new Set(), children: new Set(), cleanups: [], owner: null };
  const prevOwner = currentOwner;
  const prevObserver = activeComputation;
  currentOwner = owner;
  activeComputation = null;             // 根の直下での生読みは追跡しない（untrack）
  try {
    return fn(() => dispose(owner));
  } finally {
    currentOwner = prevOwner;
    activeComputation = prevObserver;
  }
}

// --- memo -------------------------------------------------------------------
// 重い派生を「1回だけ計算して共有・入力が変わるまでキャッシュ」したいとき。
// 中身は signal(結果置き場) + effect(依存が変われば計算して書き込む) の合成。
// 読み口は派生関数と同じ関数なので、() => ... を memo(() => ...) に差し替えるだけ。
//   - 計算の共有: 何箇所から読んでも、入力変化ごとに1回しか計算しない
//   - value-cutoff: 結果が前と同じなら（中間 signal の Object.is で）下流は走らない
//   - 代償: eager（未使用でも計算する）/ 生入力と同じ effect で読むと二重実行
// 内部 effect は所有ツリーに乗るので、effect の中で作った memo は親と一緒に畳まれる。
// トップレベルで作った memo を明示的に止めたいときだけ read.dispose() を使う。
export function memo<T>(fn: () => T): Memo<T> {
  const cache = signal<T | undefined>(undefined);
  const disposeMemo = effect(() => { cache.value = fn(); }); // 依存が変わるたび計算
  const read = (() => cache.value as T) as Memo<T>;          // 読み口（fullName() のように呼ぶ）
  read.dispose = disposeMemo;                                // 任意: 内部 effect の解放用
  return read;
}
