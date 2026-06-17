// for.ts — key 付きリスト差分（reconciliation）。h.ts / tags.ts と組み合わせる。
//   For(() => items.value, item => item.id, item => h("li", {}, item()))
// 要点:
//   - key ごとに DOM ノードを覚えておき、再描画では「作り直さず使い回す」
//   - 行は createRoot で独立スコープにするので、リスト全体が再評価されても
//     生き残る行の effect は畳まれない（＝行ごとの状態が保たれる）
//   - 消えた key の行だけ dispose して DOM から除去する
//   - render には item と index を **accessor（() => 値）** で渡す。行を使い回したまま
//     「同じ key・新しいオブジェクト」や並べ替えによる位置変化を流し込めるようにするため。
//     行内では li(() => item().text) / li(() => index() + 1) のように穴で読む。
import { toHtml } from "./emit.js";
import { emitRange, RANGE } from "./emitted-html.js";
import { claimRange, isHydrating, nodesBetween, withRoot } from "./hydration.js";
import { toAccessor } from "./node.js";
import { effect, rooted, type Signal, signal } from "./reactive.js";

interface Entry<T> {
  node: Node;
  dispose: () => void;
  item: Signal<T>; // 行に流し込む現在の item（同 key・新オブジェクトでも差し替えられる）
  index: Signal<number>; // 行の現在位置（並べ替えで更新する）
}

export function For<T>(
  items: (() => T[]) | Signal<T[]>,
  keyFn: (item: T) => unknown,
  // render はクライアントでは Node（`html` / `h`）を、サーバ（emit）では文字列を返す
  // アイソモーフィックな関数。CSR 経路は Node 前提で扱う。
  render: (item: () => T, index: () => number) => Node | string,
): DocumentFragment {
  const itemsFn = toAccessor(items); // signal なら .value を読む関数に正規化
  // サーバ（DOM 無し）では emit 用に文字列化する。items を 1 回読み、各行を render（= emit を返す
  // 関数）で展開して `<!--for-->…<!--/for-->` で囲む（emitRange が adopt 側 claimRange(RANGE.for) と
  // 同形のマーカーで包む）。effect は張らず、行は出現順に並べる（key は CSR の差分用で、サーバ出力
  // には不要）。戻り値は生 HTML 封筒で、emit の子穴に入れても再エスケープされない。
  if (typeof document === "undefined") {
    const list = itemsFn();
    let rows = "";
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      rows += toHtml(
        render(
          () => item,
          () => i,
        ),
      );
    }
    return emitRange(RANGE.for, rows);
  }
  // ハイドレーション中はサーバが出した `<!--for-->…<!--/for-->` を採用する（作り直さない）。
  // 採用できたときは既存の行ノードを使い回し（initialRows）、初回 effect だけ render を
  // 既存行へ adopt 配線する。採用先が無ければ通常どおり新規生成にフォールバックする。
  const adopted = isHydrating() ? claimRange(RANGE.for) : null;
  const start = adopted ? adopted.start : document.createComment(RANGE.for);
  const end = adopted ? adopted.end : document.createComment(`/${RANGE.for}`);
  const frag = document.createDocumentFragment();
  // 採用時は start / end は既にホスト内にあるので frag には入れない（移動させない＝childList を
  // 変えない）。新規時だけ frag にこの2つを入れて、呼び出し側が挿入する。
  if (!adopted) frag.append(start, end); // この2つの間にリストを並べる
  let initialRows: Node[] | null = adopted ? nodesBetween(start, end) : null;

  let entries = new Map<unknown, Entry<T>>(); // key -> Entry

  effect(() => {
    const items = itemsFn(); // ここで配列を購読（変わると再実行）
    const parent = end.parentNode;
    if (!parent) return; // まだ DOM に挿入されていない
    const rows = initialRows; // この実行で採用する既存行（初回だけ非 null）
    initialRows = null; // 採用は初回のみ。以降は通常生成。

    const keys = items.map(keyFn);
    const next = new Map<unknown, Entry<T>>();

    // 1. 各 item のノードを用意（既存は使い回し、新規だけ createRoot で作る）
    const nodes = items.map((item, i) => {
      const key = keys[i];
      if (next.has(key)) throw new Error(`For: duplicate key: ${String(key)}`);
      let entry = entries.get(key);
      if (!entry) {
        const itemSig = signal(item); // 行ローカルに item / index を保持
        const indexSig = signal(i);
        // 行ごとの独立スコープ。accessor で渡すことで、行内の穴が itemSig / indexSig を
        // 購読し、値の差し替えに反応する。
        const row = rows?.[i]; // 採用時の既存行（あれば作り直さず adopt 配線する）
        const { value: node, dispose } = rooted(() => {
          const make = () =>
            render(
              () => itemSig.value,
              () => indexSig.value,
            );
          // 採用時は既存行へ向けて render を実行し（行内の html が adopt 配線する）、
          // ノードは既存行そのものを使う（render の戻り値は捨てる）。新規時は普通に生成。
          // CSR では render は Node を返す（string はサーバ経路のみ）。
          if (!row) return make() as Node;
          withRoot(row, make);
          return row;
        });
        entry = { node, dispose, item: itemSig, index: indexSig };
      } else {
        // 使い回す行: 中身と位置を流し込む（Object.is で無変化なら通知は起きない）。
        entry.item.value = item; // 同 key・新オブジェクトでも行内の穴が更新される（#17）
        entry.index.value = i; // 並べ替えで位置が変われば index 依存の穴も更新される（#18）
      }
      next.set(key, entry);
      return entry.node;
    });

    // 2. 消えた key の行だけ片付ける（dispose で行内の effect も止める）
    for (const [key, entry] of entries) {
      if (!next.has(key)) {
        entry.dispose();
        (entry.node as ChildNode).remove();
      }
    }

    // 3. 新しい順序に並べ替える。末尾から見て、既に正しい位置にあるノードは動かさない。
    //    （変更なし・末尾追加は insertBefore ゼロ回で済む。Custom Element の無駄な
    //     disconnect → connect も避けられる。）
    let nextNode: Node = end;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.nextSibling !== nextNode) parent.insertBefore(node, nextNode);
      nextNode = node;
    }

    entries = next;
  });

  return frag;
}
