// =============================================================================
// reactive.ts — ライブラリ非依存の最小リアクティブコア
//
//   signal    : 値を持ち、読まれたら依存登録・書かれたら購読者へ通知するセル
//   effect    : 依存が変わると再実行される副作用。dispose 関数を返す
//   batch     : 複数の変更を1回の再実行にまとめる
//   onCleanup : effect の後始末を登録する。再実行直前・dispose時に呼ばれる
//   onError   : スコープにエラーバウンダリを張る。配下の effect の例外を所有ツリー越しに受ける
//   cached    : 派生関数を計算共有＋value-cutoff 付きにする糖衣（読み口は () のまま）
//
// 派生値は「ただの関数」で書く:
//   const fullName = () => first.value + " " + last.value;
//   effect(() => console.log(fullName()));   // first / last の変化に反応する
// 関数は中間ノードを作らず、読まれた瞬間に最新値を計算するので、メモ化用の専用ノードは
// 持たない（lazy・グリッチなしが素のまま得られる）。重い派生を複数箇所で読むので計算を
// 共有したい・入力は変わるが結果が同じなら下流を止めたい（value-cutoff）といった場面だけ、
// 派生関数を cached() で包む（中身は signal + effect の薄い糖衣で、読み口は () のまま）:
//   const area = cached(() => w.value * h.value);
//   // area() を読む（計算は入力変化ごとに1回・複数読みでも共有・結果同値なら下流据え置き）
//
// 所有ツリー（ownership）:
//   effect を作ると、いま実行中の effect の「子」として自動登録される。
//   - 親が再実行されると、前回作った子は自動で dispose される（作り直しでリークしない）
//   - 親を dispose すると、子も連鎖して畳まれる
//   なので dispose を手で持ち回る必要はほぼなくなり、ツリーの根（トップレベルの
//   effect）の dispose を1つ握るだけで配下ごと片付く。
//   onCleanup(fn) は「再実行直前・dispose時に呼ぶ後始末」を現在の effect に登録する
//   （setInterval の clear、イベント購読の解除、fetch の abort など）。
//   onError(fn) は現在のスコープに「エラーバウンダリ」を張る。配下の effect が投げた例外は
//   所有ツリーを根へ辿り、最初に見つかった onError ハンドラへ渡る（なければ投げ直す）。
//
// 等価判定は Object.is 固定。
//
// 既知の限界（最小実装ゆえの割り切り）:
//   - effect が自分の依存を書き換え続ける無限ループは、flush が収束しないと検出して
//     例外を投げる（FLUSH_LIMIT 世代まで）。数パスで収束する正当な自己更新は許す。
//   - トップレベル（どの effect の中でもない場所）で作った effect は親がいないので
//     自動では畳まれない。戻り値（dispose）で手動解放する。これらを1か所にまとめたい
//     なら createRoot で囲み、返ってくる dispose を1つ握れば配下ごと畳める。
// =============================================================================

// --- 型 ---------------------------------------------------------------------
/** `.value` で読み書き、`.peek()` で追跡せずに読むリアクティブセル。 */
export interface Signal<T> {
  value: T;
  /** 依存登録せずに現在値を読む。 */
  peek(): T;
}

// 購読者リスト（ある signal を読んでいる computation の集合）。
type Subscribers = Set<Computation>;

// 所有ツリーのノード。effect の本体(run)と createRoot の根が共通で持つ。
// getOwner / runWithOwner では中身を触らない不透明ハンドルとして扱う。
export interface Owner {
  deps: Set<Subscribers>; // 自分が購読している購読者リスト（古い依存の掃除用）
  children: Set<Computation>; // 子ノード（自分の中で作られた effect）
  cleanups: Array<() => void>; // onCleanup で登録された後始末
  errors: Array<(err: unknown) => void>; // onError で登録したエラーハンドラ（このスコープのバウンダリ）
  owner: Owner | null; // 作成時の親
}

// 依存追跡の対象になる computation。run() で再実行される callable な Owner。
interface Computation extends Owner {
  (): void;
  disposed: boolean; // dispose 済みか（flush 中の「復活」を防ぐ印）
}

// --- 内部状態 ---------------------------------------------------------------
let activeComputation: Computation | null = null; // いま依存を集めている effect（observer）
let currentOwner: Owner | null = null; // いまの所有ツリーの親（effect か createRoot の根）
let batchDepth = 0; // batch() のネスト深さ
let flushing = false; // いま flush 中か（再入を1つに束ねる）
const pendingEffects = new Set<Computation>(); // バッチ終了時にまとめて走らせる effect
const FLUSH_LIMIT = 1000; // 1回の flush で許す「世代」数（暴走検出の閾値）

// dev ビルドでだけ出す注意喚起（cached の孤児検出など）を有効にするか。
// バンドラは process.env.NODE_ENV を置換するので prod では false に畳まれ警告は消える。
// 素のブラウザ global ビルドでは process 不在 → false（＝黙る）。
// html.ts の「未対応の穴」警告でも使うため export する（単一の真実点）。
export const DEV =
  typeof process !== "undefined" && process.env != null && process.env.NODE_ENV !== "production";

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
// 例外耐性: 1つの effect が投げても同じ世代の残りはすべて実行する。例外はまず所有ツリーの
// onError バウンダリへ渡し（routeError）、誰も拾わなければ最初の1件だけを最後に投げ直す。
// pending は世代ごとに実行前クリアするので、途中で抜けても無関係な effect を巻き添えにしない。
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
      for (const run of list) {
        if (run.disposed) continue; // この世代の先行 effect に dispose 済み → 復活させない
        try {
          run();
        } catch (err) {
          // 例外は所有ツリーの onError バウンダリへ渡す。誰も拾わなければ routeError が
          // 投げ直すので、ここで受けて最初の1件だけ最後に再送する（同じ世代の残りは続行）。
          // ハンドラ自身が投げた例外もこの経路で拾い直して再送する（握り潰さない）。
          try {
            routeError(run, err);
          } catch (unhandled) {
            if (!errored) {
              firstError = unhandled;
              errored = true;
            }
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
  for (const fn of node.cleanups) fn(); // ユーザー登録の後始末
  node.cleanups.length = 0;
  node.errors.length = 0; // エラーハンドラも捨てる（cleanups と同じく再実行で張り直す）
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

// effect 内で投げられた例外を所有ツリーの「エラーバウンダリ」へ届ける。
// 例外を投げたノード自身から根に向かって owner チェーンを辿り、最初に onError ハンドラを
// 持つスコープに渡す（自スコープで登録したハンドラも自分の例外を捕まえる）。
// どのスコープにもハンドラが無ければ、その例外をそのまま投げ直す（呼び出し側が受け取る）。
// ハンドラ自身が投げたら、その新しい例外を1つ上のスコープへ送る（＝握り潰さず、最終的に
// 拾い手がいなければ「新しい方の」例外が投げ直される）。
function routeError(node: Owner | null, err: unknown): void {
  for (let o = node; o; o = o.owner) {
    if (o.errors.length === 0) continue;
    try {
      for (const handler of o.errors) handler(err);
      return; // 捕捉成功
    } catch (next) {
      routeError(o.owner, next); // ハンドラが投げた → 上位へ（無ければ投げ直す）
      return;
    }
  }
  throw err; // バウンダリ無し → 投げ直す
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
// signal() が返すセルに付ける非公開のブランド。isSignal はこの印で判定する。
// 値そのものに意味はなく、「この Symbol キーを持つか」だけを見る。外部からは
// この Symbol を参照できないので、偶然 peek を持つだけの無関係なオブジェクトを
// signal と誤認しない（duck typing の取りこぼし対策）。
const SIGNAL = Symbol("signal");

// 値ひとつ＋購読者リストひとつのリアクティブセル。
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers: Subscribers = new Set();
  const cell: Signal<T> = {
    get value(): T {
      track(subscribers); // 読まれた → 依存登録
      return value;
    },
    set value(next: T) {
      if (Object.is(next, value)) return; // 無変化なら何もしない
      value = next;
      notify(subscribers); // 購読者へ通知
    },
    peek: () => value, // 追跡せずに読む
  };
  // ブランドを付ける。non-enumerable にして spread / Object.keys / JSON に漏らさない。
  Object.defineProperty(cell, SIGNAL, { value: true });
  return cell;
}

// signal() が返すセルかどうかを判定する。html で「関数の穴」と同じく
// reactive に扱うため、シグナルを直接渡せる（${count} のように .value を省ける）。
// 非公開の SIGNAL ブランドの有無で判定する。peek の有無を見る duck typing だと
// peek を持つ無関係なオブジェクト（イテレータ系ライブラリ等）を誤って signal 扱い
// してしまうため、外部から付けられないブランドを目印にして判定を正確にする。
export function isSignal(x: unknown): x is Signal<unknown> {
  return typeof x === "object" && x !== null && SIGNAL in x;
}

// --- effect -----------------------------------------------------------------
// 依存が変わると再実行される副作用。戻り値を呼ぶと購読解除（dispose）。
// run() 自身が「実行中の effect」の正体。依存(deps)・子(children)・後始末(cleanups)・
// 作成時の親(owner) をプロパティとして持ち回る。
export function effect(fn: () => void): () => void {
  const run = (() => {
    cleanup(run); // 毎回、前回の子・後始末・依存を捨ててから
    const prevObserver = activeComputation;
    const prevOwner = currentOwner;
    activeComputation = run; // 依存追跡の対象を自分に
    currentOwner = run; // 所有ツリーの親も自分に
    try {
      fn(); // fn 内の signal 読み取りを依存として収集
    } finally {
      activeComputation = prevObserver;
      currentOwner = prevOwner;
    }
  }) as Computation;
  run.deps = new Set();
  run.children = new Set();
  run.cleanups = [];
  run.errors = [];
  run.disposed = false;
  run.owner = currentOwner; // 作成時の親（再実行では変わらない）
  if (currentOwner) currentOwner.children.add(run); // 親にぶら下げる
  // 初回の同期実行も flush 時と同じく onError バウンダリへ通す。誰も拾わなければ routeError が
  // そのまま投げ直すので、「生成時に投げた effect」も再実行時と同じ経路でハンドリングできる。
  try {
    run();
  } catch (err) {
    routeError(run, err);
  }
  return () => dispose(run); // dispose（サブツリーごと畳む）
}

// --- onCleanup --------------------------------------------------------------
// 現在の effect に後始末を登録する。effect が「再実行される直前」と「dispose される時」
// に呼ばれる。setInterval の clear、購読解除、AbortController.abort などに使う。
// effect の外で呼んでも何も起きない（捨てられる）。
export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

// --- onError ----------------------------------------------------------------
// 現在のスコープ（effect / createRoot の根）に「エラーバウンダリ」を張る。このスコープと
// その配下の effect が投げた例外は、所有ツリーを根へ向かって辿り、最初に見つかった onError
// ハンドラへ届く（onCleanup と同じく、再実行ごとに張り直される）。どのスコープにも
// ハンドラが無ければ従来どおり例外は投げ直される。
//   createRoot(() => {
//     onError((e) => console.error("UI でエラー:", e)); // アプリ全体のバウンダリ
//     effect(() => { ...投げうる処理... });
//   });
// 注意: ハンドラは「壊れた effect の再実行を肩代わりする」ものではなく、例外を1か所に集める
// 通知口。状態を安全な値へ戻すなどの回復はハンドラ内で明示的に行う。
//
// オーナーが無い場所（トップレベル）で呼ぶと、ハンドラは登録先が無く捨てられる＝バウンダリを
// 張ったつもりで例外を捕捉できない静かな footgun になる（onCleanup の「何もしない」と違い、
// 期待と挙動がずれる）。cached と同じく dev ビルドではこれを console.warn で知らせる。
export function onError(handler: (err: unknown) => void): void {
  if (currentOwner) {
    currentOwner.errors.push(handler);
  } else if (DEV) {
    console.warn(
      "onError: オーナーがありません。ハンドラは登録されず例外を捕捉できません" +
        "（effect の中で呼ぶか createRoot で囲んでください）。",
    );
  }
}

// --- untrack ----------------------------------------------------------------
// fn の実行中だけ依存追跡を止める。effect の中で「依存登録せずに signal を読みたい」
// ときに使う（読んだ signal が変わっても effect は再実行されない）。
// 単一セルなら .peek() で足りるが、関数呼び出しをまたいで複数の signal を素通しで
// 読むような場面はこちらが素直。所有ツリー（currentOwner）は触らないので、untrack の
// 中で作った effect は従来どおり現在のスコープにぶら下がる。
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
// effect はこの根にぶら下がる。dispose を呼ぶと、その配下をまとめて畳める。
// 親の所有ツリーには繋がない（＝自動では畳まれない、明示 dispose 用の独立スコープ）。
// リストの行のように「個別に生かしたり消したりしたい単位」を包むのに使う。
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Owner = {
    deps: new Set(),
    children: new Set(),
    cleanups: [],
    errors: [],
    owner: null,
  };
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

// --- rooted -----------------------------------------------------------------
// createRoot の「中で値を1つ作り、その根の dispose も一緒に取り出す」定型を括り出した
// 内部ヘルパー。createRoot は引数のコールバックで dispose を受けるため、生成物（node など）と
// dispose の両方を外に出すには「外で宣言 → コールバック内で代入」になり non-null assertion が
// 要る。その footgun を1か所に閉じ込め、For / Show のような「作って後で畳む単位」を
// `const { value, dispose } = rooted(fn)` と宣言的に書けるようにする。公開はしない。
export function rooted<T>(fn: () => T): { value: T; dispose: () => void } {
  let value!: T;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    value = fn();
  });
  return { value, dispose };
}

// --- getOwner / runWithOwner ------------------------------------------------
// いまの所有ツリーの親（実行中の effect か createRoot の根）を取り出す。effect の
// 外・トップレベルでは null。setTimeout / await / fetch のコールバックに入る前に
// 掴んでおき、コールバックの中で runWithOwner に渡して元のツリーへ復帰するのに使う。
export function getOwner(): Owner | null {
  return currentOwner;
}

// owner を「現在の親」にして fn を実行する。非同期コールバックの中から元の所有ツリーへ
// 復帰し、そこで作った effect / cached を親にぶら下げたい（＝親 dispose で一緒に畳みたい）
// ときに使う。これがないと setTimeout / await 後に作る effect は親を失って孤児になり、
// 入力 signal にぶら下がり続けてリークする。
//
// 依存追跡(activeComputation)は止める: 非同期文脈には「いま依存を集めている effect」は
// 存在しないので、owner だけ差し替えて観測は張らない（untrack と同様）。owner は所有
// （誰の子か）を、activeComputation は観測（誰の依存か）を表す直交した軸で、復帰したいのは
// 前者だけ。
//
// dispose 済みの owner に再アタッチすると死んだ枝にぶら下げてしまい、二度と回収されない
// （静かなリーク）。これは弾いて owner なし（孤児）として実行し、dev では警告する。
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  if (owner && (owner as Computation).disposed) {
    if (DEV) {
      console.warn(
        "runWithOwner: dispose 済みの owner が渡されました。再アタッチせず owner なしで実行します。",
      );
    }
    owner = null;
  }
  const prevOwner = currentOwner;
  const prevObserver = activeComputation;
  currentOwner = owner;
  activeComputation = null; // 非同期文脈では依存を張らない（untrack 相当）
  try {
    return fn();
  } finally {
    currentOwner = prevOwner;
    activeComputation = prevObserver;
  }
}

// --- cached -----------------------------------------------------------------
// 重い派生を「1回だけ計算して共有・入力が変わるまでキャッシュ」したいときに包む糖衣。
// 中身は signal（結果置き場）+ effect（依存が変われば計算して書き込む）の合成にすぎず、
// 読み口は素の派生関数とまったく同じ () => T。だから「まず関数で書き、ホットになったら
// 包む」が最小差分でできる（呼び出し側 foo() は変えなくてよい）:
//   const area = () => w.value * h.value;          // 素の派生
//   const area = cached(() => w.value * h.value);  // ホット化（area() は無変更）
//   - 計算の共有 : 何箇所から読んでも、入力変化ごとに1回しか計算しない
//   - value-cutoff: 結果が前と同じなら（中間 signal の Object.is で）下流は走らない
//   - 代償        : eager（未使用でも計算する）/ 生入力と同じ effect で読むと二重実行
// 解放は effect と同じ所有ツリー任せ: effect の中で作れば親と一緒に畳まれ、トップレベルで
// 明示的に止めたいときは createRoot で囲んで返り値の dispose を握る（read口にプロパティは
// 生やさない）。追跡せずに今の値だけ読みたい（peek 相当）ときは untrack(area) を使う。
//
// cached は dispose ハンドルを返さないので、オーナー（囲む effect / createRoot）が無い場所で
// 作ると内部 effect が孤児になり、回収する手段がないまま入力 signal にぶら下がり続ける
// （＝リーク）。dev ビルドではこれを console.warn で知らせる（prod では DEV が false に畳まれ
// 無音）。アプリ寿命の派生など意図的に永続させたいときは createRoot で囲めば警告は消える。
export function cached<T>(fn: () => T): () => T {
  if (DEV && currentOwner === null) {
    console.warn(
      "cached: オーナーがありません。内部 effect が孤児になり自動解放されません" +
        "（入力 signal にぶら下がり続けてリークします）。effect の中で作るか createRoot で囲んでください。",
    );
  }
  // effect は生成時に同期実行される（下の effect(...) が返る前に1度走る）。そこで初回は
  // 計算結果でそのまま signal を作り、2回目以降だけ書き込む。こうすると cell は常に T で
  // 持てる（undefined を T に偽る as キャストが要らない）し、初期値 undefined → 初回結果
  // の余計な1段差（spurious cutoff）も生じない。
  let cell: Signal<T> | undefined;
  effect(() => {
    const next = fn(); // 依存が変わるたび計算
    if (cell)
      cell.value = next; // 2回目以降: 書き込み（Object.is で下流を間引く）
    else cell = signal(next); // 初回: 結果で signal を作る
  });
  return () => cell!.value; // 読み口（素の派生関数と同じく area() で読む）
}
