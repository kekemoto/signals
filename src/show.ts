// show.ts — 条件表示（Solid の <Show> 相当）。h.ts / tags.ts と組み合わせる。
//   Show(() => user.value != null,
//        () => h("p", {}, "ようこそ"),
//        () => h("p", {}, "ログインしてください"))   // 第3引数(fallback)は任意
// render は「真だった値を返す accessor」を受け取れる（Solid 同様）。null 除去した値を
// そのまま使える:
//   Show(() => user.value, (user) => h("p", {}, user().name))  // user() は NonNullable
// 要点:
//   - when が真なら render() を、偽なら fallback() を表示する
//   - 切り替え時に中身を createRoot で作り、消えるときは dispose（中の effect も止まる）
//   - when の「真偽」が変わったときだけ作り直す（同じ間は据え置き）
import { toHtml } from "./emit.js";
import { emitRange, RANGE } from "./emitted-html.js";
import {
  claimRange,
  deferAdopt,
  flushAdopt,
  isHydrating,
  nodesBetween,
  withoutHydration,
  withRoot,
} from "./hydration.js";
import { toAccessor } from "./node.js";
import { effect, rooted, type Signal } from "./reactive.js";

// 枝の戻り値。クライアントでは Node（`html` / `h`）、サーバ（emit）では文字列を返せる
// アイソモーフィックな型。null / undefined は「何も描かない」。
type Branch = () => Node | string | null | undefined;
// render 用の枝。「真だった値を返す accessor」を受け取る（引数を読まなくてもよいので
// 従来の `() => ...` もそのまま渡せる＝後方互換）。
type RenderBranch<T> = (value: () => NonNullable<T>) => Node | string | null | undefined;

interface Current {
  node: Node | null | undefined;
  dispose: () => void;
}

export function Show<T>(
  when: (() => T) | Signal<T>,
  render: RenderBranch<T>,
  fallback: Branch | null = null,
): DocumentFragment {
  const whenFn = toAccessor(when); // signal なら .value を読む関数に正規化
  // 「真だった値」を返す accessor。render は show が真の間だけ生きる部分木から読むので、
  // whenFn() は常に真値として扱える（型上も NonNullable<T> に絞る）。真偽が偽に変わる時は
  // 先に外側の effect がこの部分木を dispose するため、ここから偽値が読まれることはない。
  const value = () => whenFn() as NonNullable<T>;
  // サーバ（DOM 無し）では emit 用に文字列化する。when を 1 回読み、真なら render(value)、偽なら
  // fallback だけを展開して `<!--show-->…<!--/show-->` で囲む（emitRange が adopt 側 claimRange(RANGE.show)
  // と同形のマーカーで包む）。effect は張らない。戻り値は生 HTML 封筒で、emit の子穴に入れても
  // 再エスケープされない。
  if (typeof document === "undefined") {
    const branch = whenFn() ? render(value) : fallback ? fallback() : null;
    return emitRange(RANGE.show, toHtml(branch));
  }
  // ハイドレーション中はサーバが出した `<!--show-->…<!--/show-->` を採用する（作り直さない）。
  // eager 評価で共有カーソルを先食いしないよう、その場では claim せず採用処理を遅延フラグメントに
  // 包んで返す。駆動側（runHydration / 外側 html の子走査）がカーソルを `<!--show-->` の位置に
  // 合わせて flush したとき、claimRange でこの Show の範囲を claim して showBody を組み立てる。
  if (isHydrating())
    return deferAdopt(() => showBody(value, whenFn, render, fallback, claimRange(RANGE.show)));
  return showBody(value, whenFn, render, fallback, null);
}

/**
 * Show の本体。新規描画（adopted=null）と採用（adopted=claim した開閉ペア）で共通。
 * 採用時は既存の中身を作り直さず、初回 effect だけ render / fallback を既存ノードへ adopt 配線する。
 */
function showBody<T>(
  value: () => NonNullable<T>,
  whenFn: () => T,
  render: RenderBranch<T>,
  fallback: Branch | null,
  adopted: { start: Comment; end: Comment } | null,
): DocumentFragment {
  const start = adopted ? adopted.start : document.createComment(RANGE.show);
  const end = adopted ? adopted.end : document.createComment(`/${RANGE.show}`);
  const frag = document.createDocumentFragment();
  // 採用時は start / end は既にホスト内にあるので frag には入れない（移動させない）。
  if (!adopted) frag.append(start, end); // この2つの間に中身を出し入れする
  // 採用時の既存中身（render / fallback が出した単一ノード。無ければ undefined）。
  let initialNode: Node | undefined = adopted ? nodesBetween(start, end)[0] : undefined;
  let adopting = adopted != null; // 初回 effect だけ既存中身を採用するフラグ

  let shown: boolean | undefined; // 直前の真偽（初回は undefined）
  let current: Current | null = null; // { node, dispose }

  effect(() => {
    const show = !!whenFn(); // when を購読

    // 採用（初回のみ）: 既存中身を作り直さず、render / fallback を既存ノードへ adopt 配線する。
    if (adopting) {
      adopting = false;
      shown = show;
      const node = initialNode;
      initialNode = undefined;
      const make: Branch | null = show ? () => render(value) : fallback;
      if (make) {
        let built: Node | null = node ?? null;
        const { dispose } = rooted(() => {
          // 既存ノードがあればそこへカーソルを合わせて配線（中の html を flush して adopt）。
          if (node) {
            withRoot(node, () => flushAdopt(make()));
            return;
          }
          // 既存中身が無い（サーバは空・クライアントは描画したい mismatch）。カーソルを外して
          // 新規生成し、start / end の間へ挿入する（誤って既存ノードを claim しない）。
          const fresh = withoutHydration(make) as Node | null | undefined;
          if (fresh) {
            end.parentNode?.insertBefore(fresh, end);
            built = fresh;
          }
        });
        current = { node: built, dispose };
      }
      return;
    }

    if (show === shown) return; // 真偽が変わらなければ何もしない（中身は据え置き）
    shown = show;
    const parent = end.parentNode;
    if (!parent) return;

    // 前の中身を片付ける（中の effect も dispose して止める）
    if (current) {
      current.dispose();
      if (current.node) (current.node as ChildNode).remove();
      current = null;
    }

    // 新しい中身を作る（show なら render に value accessor を渡す、そうでなければ fallback）
    const make: Branch | null = show ? () => render(value) : fallback;
    if (make) {
      // CSR では make は Node（または null）を返す（string はサーバ経路のみ）。
      const { value: node, dispose } = rooted(make) as {
        value: Node | null | undefined;
        dispose: () => void;
      };
      if (node) parent.insertBefore(node, end);
      // node の有無にかかわらず dispose は必ず保持する。
      // node が null でも render 内で張った effect を次の切り替えで畳めるようにするため。
      current = { node, dispose };
    }
  });

  return frag;
}
