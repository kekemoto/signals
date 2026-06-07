// for.ts — key 付きリスト差分（reconciliation）。h.ts / tags.ts と組み合わせる。
//   For(() => items.value, item => item.id, item => h("li", {}, item.text))
// 要点:
//   - key ごとに DOM ノードを覚えておき、再描画では「作り直さず使い回す」
//   - 行は createRoot で独立スコープにするので、リスト全体が再評価されても
//     生き残る行の effect は畳まれない（＝行ごとの状態が保たれる）
//   - 消えた key の行だけ dispose して DOM から除去する
import { effect, createRoot, isSignal, type Signal } from "./reactive.js";

interface Entry {
  node: Node;
  dispose: () => void;
}

export function For<T>(
  items: (() => T[]) | Signal<T[]>,
  keyFn: (item: T) => unknown,
  render: (item: T) => Node,
): DocumentFragment {
  const itemsFn = isSignal(items) ? () => items.value : items; // signal なら .value を読む関数に
  const start = document.createComment("for");
  const end = document.createComment("/for");
  const frag = document.createDocumentFragment();
  frag.append(start, end);                  // この2つの間にリストを並べる

  let entries = new Map<unknown, Entry>();   // key -> { node, dispose }

  effect(() => {
    const items = itemsFn();                 // ここで配列を購読（変わると再実行）
    const parent = end.parentNode;
    if (!parent) return;                     // まだ DOM に挿入されていない

    const keys = items.map(keyFn);
    const next = new Map<unknown, Entry>();

    // 1. 各 item のノードを用意（既存は使い回し、新規だけ createRoot で作る）
    const nodes = items.map((item, i) => {
      const key = keys[i];
      if (next.has(key)) throw new Error(`For: duplicate key: ${String(key)}`);
      let entry = entries.get(key);
      if (!entry) {
        let node!: Node;
        let dispose!: () => void;
        createRoot((d) => { dispose = d; node = render(item); }); // 行ごとの独立スコープ
        entry = { node, dispose };
      }
      next.set(key, entry);
      return entry.node;
    });

    // 2. 消えた key の行だけ片付ける（dispose で行内の effect も止める）
    for (const [key, entry] of entries) {
      if (!next.has(key)) { entry.dispose(); (entry.node as ChildNode).remove(); }
    }

    // 3. 新しい順序に並べ替え（end の手前へ順に挿入＝使い回しノードは移動するだけ）
    for (const node of nodes) parent.insertBefore(node, end);

    entries = next;
  });

  return frag;
}
