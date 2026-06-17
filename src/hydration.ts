// hydration.ts — ハイドレーション中の「採用（adopt）」を司るアンビエント文脈（第3段階）。
// docs/ssr-hydration-plan.md の段階3「wire を adopt 対応に」の土台。
//
// 何をするか:
//   - クライアントの新規描画（create）と、サーバ（emit）が出した DOM の採用（adopt）を
//     同じ wire パスで切り替えるための **フラグ + カーソル** を提供する。
//   - カーソルは「いま採用しようとしている既存 DOM の位置」を持つ。`toNode` の adopt 相当
//     （node.ts の adoptChild）・`For`・`Show`・`html` が、新規生成のかわりに
//     カーソルから既存ノードを **claim（請求）** して使い回す。
//   - create 側（CSR）からは一切触らない（isHydrating() が false の間はすべて素通り）。
//
// なぜアンビエントか:
//   タグ付きテンプレートの `${...}` は html() より先に評価される（For(...) などは eager）。
//   明示引数では配線時まで「どの DOM を採用するか」を運べないので、Solid の hydration
//   カーソルと同じくアンビエントな文脈に持たせ、各構築子が実行時に拾う。

/** ハイドレーション中の採用カーソル。 */
interface Cursor {
  /** 次に claimRoot で採用する候補ノード（兄弟方向＝nextSibling へ進む）。 */
  pointer: Node | null;
  /** claimRange の文書順 DFS が外へ出ない探索範囲（このノードの内側だけを走る）。 */
  root: Node;
}

// 現在のハイドレーション文脈。null = 通常の新規描画（CSR）。
let cursor: Cursor | null = null;

/** いまハイドレーション（adopt）中か。create 側はこれが false なので一切影響を受けない。 */
export function isHydrating(): boolean {
  return cursor !== null;
}

/**
 * `container` の子（サーバが出した既存 DOM）を採用範囲として fn を実行する。
 * fn の中で呼ばれる html / For / Show / toNode（adoptChild）は、新規生成せず
 * 既存ノードを claim して配線する。stage 4 の `hydrate` エントリや defineElement の
 * adopt モードはこの上に薄く乗る（本段ではテストからも直接使う）。
 */
export function runHydration<T>(container: Node, fn: () => T): T {
  const prev = cursor;
  cursor = { pointer: container.firstChild, root: container };
  try {
    return fn();
  } finally {
    cursor = prev;
  }
}

/** 空白だけのテキストノードか（整形用の改行・インデントを採用時に読み飛ばすため）。 */
function isBlankText(n: Node): boolean {
  return n.nodeType === 3 && !/\S/.test(n.textContent || "");
}

/**
 * いまのカーソル位置から「採用すべきルートノード」を1つ取り出して返す（兄弟方向へ前進）。
 * 整形用の空白テキストは読み飛ばす。html の adopt 入口（テンプレ1つ＝ルート1つ）と、
 * For / Show が各行・各枝を採用するとき（withRoot で位置を合わせてから）に使う。
 */
export function claimRoot(): Node | null {
  if (!cursor) return null;
  let n = cursor.pointer;
  while (n && isBlankText(n)) n = n.nextSibling;
  if (!n) {
    cursor.pointer = null;
    return null;
  }
  cursor.pointer = n.nextSibling;
  return n;
}

/** node から文書順（DFS）で次のノードを返す。root の外へは出ない。 */
function nextInDoc(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild;
  let n: Node | null = node;
  while (n && n !== root) {
    if (n.nextSibling) return n.nextSibling;
    n = n.parentNode;
  }
  return null;
}

/**
 * カーソル位置から文書順に走査し、`<!--name-->` … `<!--/name-->` の開閉ペアを1つ請求する。
 * 同名のペアが入れ子になっても深さを数えて正しい閉じを拾う（`For` の入れ子など）。
 * 見つけたらカーソルを閉じコメントの次へ進め、開閉のコメントノードを返す。無ければ null。
 *
 * サーバの reactive 子穴は `<!--hole-->…<!--/hole-->`（node.ts / emit と同形）、
 * For は `<!--for-->…<!--/for-->`、Show は `<!--show-->…<!--/show-->` で囲まれている前提。
 */
export function claimRange(name: string): { start: Comment; end: Comment } | null {
  if (!cursor) return null;
  const open = name;
  const close = `/${name}`;
  let n: Node | null = cursor.pointer;
  let start: Comment | null = null;
  let depth = 0;
  while (n) {
    if (n.nodeType === 8) {
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
          cursor.pointer = nextInDoc(end, cursor.root);
          return { start, end };
        }
      }
    }
    n = nextInDoc(n, cursor.root);
  }
  return null;
}

/**
 * `root` の内側だけを採用範囲として fn を実行する（claimRange の DFS をこの部分木に閉じる）。
 * html の adopt が、自分のルートを掴んだあと「そのルートの中の子穴」を請求するために使う。
 */
export function withScope<T>(root: Node, fn: () => T): T {
  const prev = cursor;
  cursor = { pointer: root.firstChild, root };
  try {
    return fn();
  } finally {
    cursor = prev;
  }
}

/**
 * 次の claimRoot が `node` を返すよう、現在のスコープのカーソル位置だけを一時的に合わせて
 * fn を実行する（探索範囲 root は据え置き）。For の各行・Show の枝を、その既存ノードへ
 * 採用させるために使う。fn の後はカーソル位置を元へ戻す。
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
