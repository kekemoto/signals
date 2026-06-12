// =============================================================================
// reactive.ts — ライブラリ非依存の最小リアクティブコア
//
//   signal    : 値を持ち、読まれたら依存登録・書かれたら購読者へ通知するセル
//   effect    : 依存が変わると再実行される副作用。dispose 関数を返す
//   batch     : 複数の変更を1回の再実行にまとめる
//   memo      : 重い派生を「読まれたときだけ」計算して共有・キャッシュする派生ノード
//   onCleanup : effect の後始末を登録する。再実行直前・dispose時に呼ばれる
//
// 派生値は基本「ただの関数」で書く:
//   const fullName = () => first.value + " " + last.value;
//   effect(() => console.log(fullName()));   // first / last の変化に反応する
// 関数は中間ノードを作らず、読まれた瞬間に最新値を計算するのでグリッチが起きない。
// 唯一の弱点はメモ化されないこと。重い派生を複数箇所で読むホットな場面だけ memo に
// 差し替える（呼び出しは fullName() のまま）。memo は計算の共有と value-cutoff を得る。
//
// push-pull 評価（lazy memo）:
//   signal の変更は「下流を dirty/check に印付けして effect だけをキューに積む」push、
//   memo の計算は「読まれた瞬間に必要なら計算する」pull の二段構え。これにより
//   - memo は読まれるまで計算しない（未使用なら計算ゼロ）
//   - 生入力と memo を同じ effect で読んでも、effect 実行前に依存 memo を pull して
//     最新化するので同一世代で値が確定し、二重実行（グリッチ）が起きない
//   ノードは状態 clean / check / dirty を持つ:
//   - dirty : 直接の入力が変わった → 読まれたら必ず再計算
//   - check : 上流のどこかが変わった「かもしれない」→ 読まれたら上流を辿って確認し、
//             本当に変わった入力があったときだけ再計算（中間 memo の cutoff を尊重）
//   - clean : 最新
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
//   - effect が自分の依存を書き換え続ける無限ループは、flush が収束しないと検出して
//     例外を投げる（FLUSH_LIMIT 世代まで）。数パスで収束する正当な自己更新は許す。
//   - トップレベル（どの effect の中でもない場所）で作った effect / memo は親がいない
//     ので自動では畳まれない。戻り値（effect）や read.dispose（memo）で手動解放する。
//     これらを1か所にまとめたいなら createRoot で囲み、返ってくる dispose を1つ握れば
//     配下ごと畳める。
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
  /** 内部ノードを解放する（トップレベル memo の明示停止用）。 */
  dispose: () => void;
}

// ノードの鮮度。値が小さいほど新しい（clean < check < dirty）。
// 比較で「より dirty 側へ印を強める」判定に使うので数値にしてある。
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;
type State = typeof CLEAN | typeof CHECK | typeof DIRTY;

// 観測できるもの（signal / memo）。自分を読んでいる computation の集合を持つ。
interface Source {
  observers: Set<Computation>; // この source を読んでいる computation
  // memo だけが持つ: 読まれる前に「必要なら最新化」する pull の入口。
  // signal は常に最新なので持たない（undefined）。
  updateIfNecessary?: () => void;
}

// 所有ツリーのノード。effect / memo の本体と createRoot の根が共通で持つ。
interface Owner {
  sources: Set<Source>; // 自分が読んでいる source（古い依存の掃除用）
  children: Set<Computation>; // 子ノード（自分の中で作られた effect / memo）
  cleanups: Array<() => void>; // onCleanup で登録された後始末
  owner: Owner | null; // 作成時の親
}

// 依存追跡の対象になる computation（effect / memo）。Owner でもある。
interface Computation extends Owner {
  fn: () => unknown; // 本体（effect は副作用、memo は派生計算）
  state: State; // clean / check / dirty
  isMemo: boolean; // memo か（true なら flush でスケジュールせず値を持つ）
  disposed: boolean; // dispose 済みか（flush 中の「復活」を防ぐ印）
  // memo のときだけ意味を持つ（Source としても振る舞うための枠）
  observers?: Set<Computation>; // 自分（memo）を読んでいる computation
  updateIfNecessary?: () => void; // 自分（memo）を pull する入口
  value?: unknown; // memo のキャッシュ値
  initialized?: boolean; // memo が一度でも計算されたか
}

// memo ノードは Computation かつ Source（観測される側）でもある。
type MemoNode = Computation & Source;

// --- 内部状態 ---------------------------------------------------------------
let activeComputation: Computation | null = null; // いま依存を集めている effect / memo（observer）
let currentOwner: Owner | null = null; // いまの所有ツリーの親（effect / memo か createRoot の根）
let batchDepth = 0; // batch() のネスト深さ
let flushing = false; // いま flush 中か（再入を1つに束ねる）
const pendingEffects = new Set<Computation>(); // バッチ終了時にまとめて走らせる effect
const FLUSH_LIMIT = 1000; // 1回の flush で許す「世代」数（暴走検出の閾値）

// 溜まった effect を実行する。空になるまで「世代」単位で繰り返す（while ループ）。
//
// 再入を1本に束ねる: effect の実行中に signal が書かれると notify→batch→flush が
// 再び呼ばれるが、flushing 中は即 return し、積まれた分は外側の while が次の世代として
// 拾う。これで (1) 再帰 flush によるスタック増加を防ぎ、(2) 「今の世代を全部流してから
// 次の世代」という決定的な順序になる（割り込みでの観測が起きない）。
//
// 暴走検出: effect が自分の依存を書き換え続けると世代が尽きない。FLUSH_LIMIT を超えたら
// pending を捨てて例外を投げる（無限ループでハング／スタックオーバーフローする代わりに、
// 検出可能なエラーにして次の更新から回復できるようにする）。
//
// 例外耐性: 1つの effect が投げても同じ世代の残りはすべて実行し、最初の例外だけを最後に
// 投げ直す。pending は世代ごとに実行前クリアするので、途中で抜けても無関係な effect を
// 巻き添えにしない。
function flush(): void {
  if (flushing) return; // 既に回している → 積まれた分は外側の while が拾う
  flushing = true;
  let firstError: unknown;
  let errored = false;
  let passes = 0;
  try {
    while (pendingEffects.size) {
      if (++passes > FLUSH_LIMIT) {
        pendingEffects.clear(); // 暴走したキューは捨てて回復可能にする
        throw new Error(
          "flush が収束しません（effect が自分の依存を書き換え続ける無限ループの可能性）",
        );
      }
      const list = [...pendingEffects];
      pendingEffects.clear();
      for (const node of list) {
        if (node.disposed) continue; // この世代の先行 effect に dispose 済み → 復活させない
        try {
          updateIfNecessary(node); // check を解決し、dirty なら再実行する
        } catch (err) {
          if (!errored) {
            firstError = err;
            errored = true;
          }
        }
      }
    }
  } finally {
    flushing = false;
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

// 依存していた全ての source の observers から自分を外す（古い依存の掃除）
function unsubscribe(node: Owner): void {
  for (const source of node.sources) source.observers.delete(node as Computation);
  node.sources.clear();
}

// node のサブツリーを掃除する: 子を再帰で畳む → onCleanup を実行 → 依存を解除。
// node 自身は親の children に残す（effect の再実行で同じ node を再利用するため）。
function cleanup(node: Owner): void {
  for (const child of node.children) cleanup(child); // 子を先に畳む（深い方から）
  node.children.clear();
  for (const fn of node.cleanups) fn(); // ユーザー登録の後始末
  node.cleanups.length = 0;
  unsubscribe(node); // 購読解除
}

// dispose 対象のサブツリー全体に「死んだ」印を付ける。flush 待ちのキューに
// 既に積まれている computation も、run の前に弾いて「復活」を防ぐため。
function markDisposed(node: Owner): void {
  for (const child of node.children) markDisposed(child);
  (node as Computation).disposed = true;
}

// node を完全に破棄する: サブツリーに死亡印を付け、掃除し、親の children からも外す。
function dispose(node: Owner): void {
  markDisposed(node); // 先にサブツリーを「死んだ」ことにする（cleanup より前）
  cleanup(node);
  if (node.owner) node.owner.children.delete(node as Computation);
}

// 読み取り中の computation を、いま触った source に相互登録する
function track(source: Source): void {
  if (activeComputation) {
    source.observers.add(activeComputation);
    activeComputation.sources.add(source);
  }
}

// source の直接の observer を dirty に、その下流を再帰的に check に印付けする（push）。
// memo は計算せず印を付けるだけ（読み時に pull で計算）。clean から非 clean に変わる
// effect だけを再実行キューに積む。値が小さい→大きい（clean→check→dirty）方向にしか
// 印を強めないので、同じノードを何度も辿っても無駄な伝播やキュー追加が起きない。
function stale(node: Computation, state: State): void {
  if (node.state >= state) return; // 既に同等以上に dirty → 何もしない（伝播の打ち切り）
  // clean だった effect が非 clean になる瞬間にだけキューへ積む（重複登録を避ける）。
  // memo は積まない＝誰かに読まれるまで計算しない（lazy）。
  if (node.state === CLEAN && !node.isMemo) pendingEffects.add(node);
  node.state = state;
  if (node.observers) {
    for (const obs of node.observers) stale(obs, CHECK); // 下流は「変わったかも」
  }
}

// 購読者へ変更を伝える（batch 内なら合流し、最後に一度だけ flush される）
function notify(source: Source): void {
  batch(() => {
    for (const obs of [...source.observers]) stale(obs, DIRTY);
  });
}

// computation の本体を実行する（effect の副作用 / memo の派生計算）。
// 実行前に前回の依存・子・後始末を捨て、state を clean に戻してから走らせる
// （実行中の自己更新で再び dirty に印付けされ得るように、リセットは「前」に行う）。
// memo の場合は結果をキャッシュと比較し、変わったときだけ下流を dirty にする（value-cutoff）。
function runComputation(node: Computation): void {
  cleanup(node); // 前回の子・後始末・依存を捨てる
  node.state = CLEAN; // 実行前に clean に（実行中の書き込みが再び dirty 化できる）
  const prevObserver = activeComputation;
  const prevOwner = currentOwner;
  activeComputation = node; // 依存追跡の対象を自分に
  currentOwner = node; // 所有ツリーの親も自分に
  try {
    const result = node.fn(); // fn 内の読み取りを依存として収集
    if (node.isMemo) {
      // 初回、または結果が変わったときだけキャッシュ更新＋下流を dirty 化。
      if (!node.initialized || !Object.is(result, node.value)) {
        node.value = result;
        node.initialized = true;
        // 下流（observer）を dirty に。これらは上流変更で既に check 以上に印付け＆
        // effect ならキュー済みなので、ここでの引き上げは「pull 中の確認」を通すためのもの。
        if (node.observers) {
          for (const obs of node.observers) obs.state = DIRTY;
        }
      }
    }
  } finally {
    activeComputation = prevObserver;
    currentOwner = prevOwner;
  }
}

// node を「読まれる直前の最新状態」にする（pull）。
//   - check: 上流の source を辿って最新化する。途中で本当に変わった入力があれば、その
//            source の再計算が自分を dirty に引き上げるので、それを見て自分も再計算する。
//            最後まで dirty に上がらなければ「結局変わっていない」→ clean に戻すだけ。
//   - dirty: 直接の入力が変わっている → 再計算する。
function updateIfNecessary(node: Computation): void {
  if (node.disposed) return;
  if (node.state === CHECK) {
    for (const source of node.sources) {
      source.updateIfNecessary?.(); // memo なら最新化（signal は no-op）
      // source の再計算が自分を dirty に引き上げることがある（closure 越しの変更なので
      // TS の絞り込みを外して読み直す）。
      if ((node.state as State) === DIRTY) break;
    }
  }
  if ((node.state as State) === DIRTY) runComputation(node);
  else node.state = CLEAN; // check のまま＝上流は結局変わらなかった
}

// --- signal -----------------------------------------------------------------
// signal() が返すセルに付ける非公開のブランド。isSignal はこの印で判定する。
// 値そのものに意味はなく、「この Symbol キーを持つか」だけを見る。外部からは
// この Symbol を参照できないので、偶然 peek を持つだけの無関係なオブジェクトを
// signal と誤認しない（duck typing の取りこぼし対策）。
const SIGNAL = Symbol("signal");

// 値ひとつ＋購読者リストひとつのリアクティブセル。
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const source: Source = { observers: new Set() }; // updateIfNecessary なし＝常に最新
  const cell: Signal<T> = {
    get value(): T {
      track(source); // 読まれた → 依存登録
      return value;
    },
    set value(next: T) {
      if (Object.is(next, value)) return; // 無変化なら何もしない
      value = next;
      notify(source); // 購読者へ通知（下流を印付けして effect を flush）
    },
    peek: () => value, // 追跡せずに読む
  };
  // ブランドを付ける。non-enumerable にして spread / Object.keys / JSON に漏らさない。
  Object.defineProperty(cell, SIGNAL, { value: true });
  return cell;
}

// signal() が返すセルかどうかを判定する。h / tags / html で「関数の穴」と同じく
// reactive に扱うため、シグナルを直接渡せる（${count} のように .value を省ける）。
// 非公開の SIGNAL ブランドの有無で判定する。peek の有無を見る duck typing だと
// peek を持つ無関係なオブジェクト（イテレータ系ライブラリ等）を誤って signal 扱い
// してしまうため、外部から付けられないブランドを目印にして判定を正確にする。
export function isSignal(x: unknown): x is Signal<unknown> {
  return typeof x === "object" && x !== null && SIGNAL in x;
}

// --- effect -----------------------------------------------------------------
// 依存が変わると再実行される副作用。戻り値を呼ぶと購読解除（dispose）。
// 依存(sources)・子(children)・後始末(cleanups)・作成時の親(owner) をノードに持つ。
export function effect(fn: () => void): () => void {
  const node: Computation = {
    fn,
    state: DIRTY,
    isMemo: false,
    disposed: false,
    sources: new Set(),
    children: new Set(),
    cleanups: [],
    owner: currentOwner, // 作成時の親（再実行では変わらない）
  };
  if (currentOwner) currentOwner.children.add(node); // 親にぶら下げる
  runComputation(node); // 初回は同期実行（依存を収集）
  return () => dispose(node); // dispose（サブツリーごと畳む）
}

// --- onCleanup --------------------------------------------------------------
// 現在の effect に後始末を登録する。effect が「再実行される直前」と「dispose される時」
// に呼ばれる。setInterval の clear、購読解除、AbortController.abort などに使う。
// effect の外で呼んでも何も起きない（捨てられる）。
export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

// --- untrack ----------------------------------------------------------------
// fn の実行中だけ依存追跡を止める。effect の中で「依存登録せずに signal を読みたい」
// ときに使う（読んだ signal が変わっても effect は再実行されない）。
// 単一セルなら .peek() で足りるが、関数呼び出しをまたいで複数の signal を素通しで
// 読むような場面はこちらが素直。所有ツリー（currentOwner）は触らないので、untrack の
// 中で作った effect / memo は従来どおり現在のスコープにぶら下がる。
export function untrack<T>(fn: () => T): T {
  const prev = activeComputation;
  activeComputation = null;
  try {
    return fn();
  } finally {
    activeComputation = prev;
  }
}

// --- createRoot -------------------------------------------------------------
// 所有ツリーの「独立した根」を作る。fn には dispose 関数が渡され、root の中で作った
// effect / memo はこの根にぶら下がる。dispose を呼ぶと、その配下をまとめて畳める。
// 親の所有ツリーには繋がない（＝自動では畳まれない、明示 dispose 用の独立スコープ）。
// リストの行のように「個別に生かしたり消したりしたい単位」を包むのに使う。
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Owner = { sources: new Set(), children: new Set(), cleanups: [], owner: null };
  const prevOwner = currentOwner;
  const prevObserver = activeComputation;
  currentOwner = owner;
  activeComputation = null; // 根の直下での生読みは追跡しない（untrack）
  try {
    return fn(() => dispose(owner));
  } finally {
    currentOwner = prevOwner;
    activeComputation = prevObserver;
  }
}

// --- memo -------------------------------------------------------------------
// 重い派生を「読まれたときだけ計算して共有・入力が変わるまでキャッシュ」したいとき。
// 読み口は派生関数と同じ関数なので、() => ... を memo(() => ...) に差し替えるだけ。
//   - lazy: 入力が変わっても印を付けるだけ。実際の計算は読まれた瞬間に行う
//           （誰も読んでいなければ計算しない）。
//   - 計算の共有: 何箇所から読んでも、入力変化ごとに高々1回しか計算しない。
//   - value-cutoff: 結果が前と同じなら（Object.is）下流は走らない。
//   - グリッチなし: 生入力と memo を同じ effect で読んでも、effect 実行前に memo を
//                   pull して最新化するので二重実行にならない。
// memo ノードは所有ツリーに乗るので、effect の中で作った memo は親と一緒に畳まれる。
// トップレベルで作った memo を明示的に止めたいときだけ read.dispose() を使う。
export function memo<T>(fn: () => T): Memo<T> {
  // 計算は遅延する: 生成時は dirty・未初期化のまま置き、最初の読みで計算する。
  const node: MemoNode = {
    fn,
    state: DIRTY,
    isMemo: true,
    disposed: false,
    sources: new Set(),
    children: new Set(),
    cleanups: [],
    owner: currentOwner,
    observers: new Set(), // 自分を読む computation（Source として観測される）
    value: undefined,
    initialized: false,
  };
  // source として pull できる入口。check 状態の observer がここを呼んで最新化する。
  node.updateIfNecessary = () => updateIfNecessary(node);
  if (currentOwner) currentOwner.children.add(node); // 親にぶら下げる
  const read = (() => {
    if (!node.disposed) {
      updateIfNecessary(node); // 必要なら（dirty/check）ここで計算する（pull）
      track(node); // 読み手を購読者に。最新化の「後」に登録するので、いま読んだ値で
      // 自分自身を dirty に引き上げてしまう取りこぼし（余計な再実行）が起きない。
    }
    return node.value as T;
  }) as Memo<T>;
  read.dispose = () => dispose(node); // 任意: ノードの解放用
  return read;
}
