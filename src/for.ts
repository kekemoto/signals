// for.ts — key 付きリスト差分（reconciliation）。html と組み合わせる。
//   For(() => items.value, item => item.id, item => html`<li>${() => item().text}</li>`)
// 要点:
//   - key ごとに DOM ノードを覚えておき、再描画では「作り直さず使い回す」
//   - 行は createRoot で独立スコープにするので、リスト全体が再評価されても
//     生き残る行の effect は畳まれない（＝行ごとの状態が保たれる）
//   - 消えた key の行だけ dispose して DOM から除去する
//   - render には item と index を **accessor（() => 値）** で渡す。行を使い回したまま
//     「同じ key・新しいオブジェクト」や並べ替えによる位置変化を流し込めるようにするため。
//     行内では html`${() => item().text}` / html`${() => index() + 1}` のように穴で読む。
import { toAccessor } from "./node.js";
import { effect, rooted, type Signal, signal } from "./reactive.js";

// リスト全体を囲む開閉コメント。`<!--for-->…<!--/for-->` の対で範囲を作り、その間に行を並べる。
const FOR = "for";

interface Entry<T> {
  node: Node;
  dispose: () => void;
  item: Signal<T>; // 行に流し込む現在の item（同 key・新オブジェクトでも差し替えられる）
  index: Signal<number>; // 行の現在位置（並べ替えで更新する）
}

export function For<T>(
  items: (() => T[]) | Signal<T[]>,
  keyFn: (item: T) => unknown,
  render: (item: () => T, index: () => number) => Node,
): DocumentFragment {
  const itemsFn = toAccessor(items); // signal なら .value を読む関数に正規化
  const start = document.createComment(FOR);
  const end = document.createComment(`/${FOR}`);
  const frag = document.createDocumentFragment();
  frag.append(start, end); // この2つの間にリストを並べる

  let entries = new Map<unknown, Entry<T>>(); // key -> Entry

  effect(() => {
    const items = itemsFn(); // ここで配列を購読（変わると再実行）
    const parent = end.parentNode;
    if (!parent) return; // まだ DOM に挿入されていない

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
        const { value: node, dispose } = rooted(() =>
          render(
            () => itemSig.value,
            () => indexSig.value,
          ),
        );
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
