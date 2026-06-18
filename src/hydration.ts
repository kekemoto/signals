// hydration.ts — ハイドレーション中の「採用（adopt）」を司るアンビエント文脈（第3段階）。
// docs/ssr-hydration-plan.md の段階3「wire を adopt 対応に」の土台。
//
// 何をするか:
//   - クライアントの新規描画（create）と、サーバ（emit）が出した DOM の採用（adopt）を
//     同じ wire パスで切り替えるための **フラグ + カーソル** を提供する。
//   - カーソルは「いま採用しようとしている既存 DOM の位置」を持つ。`html` が自分のルート要素を
//     claim し、その内側スコープで子穴（および入れ子の `For` / `Show` / `html`）を順に claim する。
//   - create 側（CSR）からは一切触らない（isHydrating() が false の間はすべて素通り）。
//
// カーソルは「兄弟方向のスコープ」:
//   1 つのカーソルは「ある親ノードの子を左から右へ順に claim する」位置を持つ（DFS で木全体を
//   一度に走らない）。木を降りるときは `withScope(elem)` で**その要素の子だけ**を見る新しいカーソルに
//   切り替える。これによりテンプレ木と実 DOM 木を**同時に降りる構造的カーソル**になり、サーバ DOM に
//   テンプレへ無い要素（投影済みカスタム要素の中身・`For` / `Show` 生成行など）があっても、その親の
//   外へ漏れて以降の穴を別要素へずらすことがない（フラット文書順位モデルだと順位がドリフトしていた）。
//
// なぜアンビエントか + なぜ遅延（defer）か:
//   タグ付きテンプレートの `${...}` は html() より先に評価される（`For(...)` / 入れ子の `html(...)` は
//   eager）。明示引数では配線時まで「どの DOM を採用するか」を運べないので、Solid の hydration
//   カーソルと同じくアンビエントな文脈に持たせる。さらに eager 評価される `For` / `Show` / `html` が
//   共有カーソルを**先食い**すると、外側の `html` が自分のルートを claim する前にカーソルが進んでしまう。
//   これを避けるため、ハイドレーション中の `html` / `For` / `Show` は**その場では
//   claim せず**、自分の採用処理を**遅延 thunk** にして空の DocumentFragment に持たせて返す。
//   駆動側（最上位の `runHydration`・外側 `html` の子走査・`For` / `Show` の各行）が、カーソルを
//   正しい位置に置いた状態で `flushAdopt` して thunk を実行する。

import { createRoot } from "./reactive.js";

/** ハイドレーション中の採用カーソル。pointer はいまの親スコープで次に claim する子の候補。 */
interface Cursor {
  /** 次に claim する候補ノード（兄弟方向＝nextSibling へ進む）。 */
  pointer: Node | null;
}

// 現在のハイドレーション文脈。null = 通常の新規描画（CSR）。
let cursor: Cursor | null = null;

/** いまハイドレーション（adopt）中か。create 側はこれが false なので一切影響を受けない。 */
export function isHydrating(): boolean {
  return cursor !== null;
}

// 遅延採用 thunk のレジストリ。eager 評価される `html` / `For` / `Show` は、採用処理を thunk に
// して空の DocumentFragment に紐づけて返す。駆動側が `flushAdopt` でカーソルを合わせてから実行する。
const deferred = new WeakMap<Node, () => unknown>();

/**
 * 採用処理を遅延させる。空の DocumentFragment を返し、`thunk` を紐づける。`thunk` は `flushAdopt`
 * 時（＝カーソルが正しい位置に置かれた後）に 1 度だけ実行され、その戻り値が `flushAdopt` の戻り値になる。
 * ハイドレーション中の `html` / `For` / `Show` が「その場では claim しない」ために使う。
 */
export function deferAdopt(thunk: () => unknown): DocumentFragment {
  const frag = document.createDocumentFragment();
  deferred.set(frag, thunk);
  return frag;
}

/** 値が `deferAdopt` の遅延フラグメントか（外側 `html` の子走査が静的な子と見分けるために使う）。 */
export function isDeferred(v: unknown): boolean {
  return v instanceof Node && deferred.has(v);
}

/**
 * 遅延フラグメントなら紐づいた thunk を（カーソルが整った今の位置で）実行して戻り値を返す。
 * そうでなければ値をそのまま返す。thunk は 1 度だけ実行する（実行後はレジストリから外す）。
 */
export function flushAdopt(v: unknown): unknown {
  if (v instanceof Node) {
    const thunk = deferred.get(v);
    if (thunk) {
      deferred.delete(v);
      return thunk();
    }
  }
  return v;
}

/**
 * `container` の子（サーバが出した既存 DOM）を採用範囲として fn を実行する。
 * fn の中で呼ばれる html / For / Show は新規生成せず、遅延フラグメントを返す。fn の戻り値が
 * 遅延フラグメントなら、カーソルを container の先頭に置いたまま `flushAdopt` して採用を実行する
 * （＝最上位の駆動）。stage 4 の `hydrate` エントリや defineElement の adopt モードはこの上に乗る。
 */
export function runHydration<T>(container: Node, fn: () => T): T {
  const prev = cursor;
  cursor = { pointer: container.firstChild };
  try {
    const result = fn();
    return flushAdopt(result) as T;
  } finally {
    cursor = prev;
  }
}

/**
 * `defineElement` の adopt（ハイドレーション）モードを起動するマーカー属性。
 * サーバはサーバ描画したカスタム要素の host にこの属性を付けて送る。クライアントの
 * `connectedCallback` は属性があれば既存の light DOM（サーバが出した setup の出力）を
 * 採用して配線し、無ければ通常どおり新規生成する。採用後はこの属性を strip する
 * （docs/ssr-hydration-plan.md のマーカー後始末・stage 4）。
 */
export const HYDRATE_ATTR = "data-hydrate";

/**
 * ハイドレーションの公開エントリ（stage 4）。`container` の既存子（サーバが出した DOM）を
 * 採用範囲として `fn`（html / For / Show を返すテンプレ）を実行し、reactive を配線する。
 *   const dispose = hydrate(document.querySelector("#app")!, () => html`...`);
 * - `createRoot` で所有ツリーを張るので、戻り値の dispose を呼べば配線した effect を畳める。
 * - `fn` の中の html / For / Show は新規生成せず、既存ノードを claim して使い回す
 *   （focus・入力値・スクロール等の DOM 状態を壊さない）。
 * `runHydration` は採用カーソルを張るだけの素のプリミティブで、こちらは createRoot を
 * 重ねて「公開 API・dispose 可能」にしたもの。defineElement の adopt モードは自前で
 * createRoot を持つので `runHydration` を直接使う。
 */
export function hydrate(container: Node, fn: () => unknown): () => void {
  return createRoot((dispose) => {
    runHydration(container, fn);
    return dispose;
  });
}

/** 空白だけのテキストノードか（整形用の改行・インデントを採用時に読み飛ばすため）。 */
function isBlankText(n: Node): boolean {
  return n.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent || "");
}

/**
 * いまのスコープのカーソル位置から「次の要素ノード」を claim して返す（兄弟方向へ前進）。
 * 整形用の空白テキスト・静的な子テキスト・著者コメントなど、要素でないものは読み飛ばす。
 * テンプレ要素を実 DOM の同位置の要素へ突き合わせるために使う（`html` の構造的走査）。
 * テンプレ順＝実 DOM 順という前提のもとで、より前のテンプレ穴は既に claim 済みでカーソルが
 * その先へ進んでいるため、読み飛ばしが「後続の穴のマーカー」を食うことはない。
 */
export function claimElement(): Element | null {
  if (!cursor) return null;
  let n = cursor.pointer;
  while (n && n.nodeType !== Node.ELEMENT_NODE) n = n.nextSibling;
  if (!n) return null;
  cursor.pointer = n.nextSibling;
  return n as Element;
}

/**
 * いまのスコープのカーソル位置から兄弟方向に走査し、`<!--name-->` … `<!--/name-->` の開閉ペアを
 * 1 つ claim する。同名のペアが（同じ兄弟レベルで）入れ子になっても深さを数えて正しい閉じを拾う。
 * 見つけたらカーソルを閉じコメントの次の兄弟へ進め、開閉のコメントノードを返す。無ければ null。
 *
 * サーバの reactive 子穴は `<!--hole-->…<!--/hole-->`（node.ts / emit と同形）、
 * For は `<!--for-->…<!--/for-->`、Show は `<!--show-->…<!--/show-->` で囲まれている前提。
 * 開きを見つけるまでの前方ノード（静的な子テキストなど）は読み飛ばす。
 */
export function claimRange(name: string): { start: Comment; end: Comment } | null {
  if (!cursor) return null;
  const open = name;
  const close = `/${name}`;
  let n: Node | null = cursor.pointer;
  let start: Comment | null = null;
  let depth = 0;
  while (n) {
    if (n.nodeType === Node.COMMENT_NODE) {
      const data = (n as Comment).data;
      if (!start) {
        if (data === open) {
          start = n as Comment;
          depth = 1;
        }
      } else if (data === open) {
        depth++;
      } else if (data === close) {
        depth--;
        if (depth === 0) {
          const end = n as Comment;
          cursor.pointer = end.nextSibling;
          return { start, end };
        }
      }
    }
    n = n.nextSibling; // 兄弟方向のみ（木を降りるのは withScope の役目）
  }
  return null;
}

/**
 * `parent` の子だけを採用範囲として fn を実行する（カーソルを parent.firstChild に置き直す）。
 * `html` が、claim した自分のルート要素の「中の子穴」を採用するために木を 1 段降りるのに使う。
 * fn の後は元のスコープ（親レベルのカーソル）へ戻す。
 */
export function withScope<T>(parent: Node, fn: () => T): T {
  const prev = cursor;
  cursor = { pointer: parent.firstChild };
  try {
    return fn();
  } finally {
    cursor = prev;
  }
}

/**
 * 次の claim が `node` から始まるよう、現在のスコープのカーソル位置だけを一時的に合わせて
 * fn を実行する。`For` の各行・`Show` の枝を、その既存ノードへ採用させるために使う。
 * fn の後はカーソル位置を元へ戻す。
 */
export function withRoot<T>(node: Node, fn: () => T): T {
  if (!cursor) return fn();
  const prev = cursor.pointer;
  cursor.pointer = node;
  try {
    return fn();
  } finally {
    cursor.pointer = prev;
  }
}

/**
 * ハイドレーション中でも一時的にカーソルを外して fn を実行する（fn 内の html / For / Show は
 * 通常の新規生成になる）。サーバ DOM に無い行・枝をクライアントが新たに作る（mismatch や
 * クライアント側で増えたデータ）ときに、誤って既存ノードを claim しないよう新規生成へ倒す。
 */
export function withoutHydration<T>(fn: () => T): T {
  const prev = cursor;
  cursor = null;
  try {
    return fn();
  } finally {
    cursor = prev;
  }
}

/**
 * start と end の間にある実ノード（整形用の空白テキストは除く）を文書順で集める。
 * For の既存行・Show の既存中身を採用するときに使う。
 */
export function nodesBetween(start: Node, end: Node): Node[] {
  const out: Node[] = [];
  for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) {
    if (isBlankText(n)) continue;
    out.push(n);
  }
  return out;
}
