// node.ts — 穴・子の値を DOM ノードへ変換する共通処理（h.ts / html.ts で共用）
import { effect, isSignal } from "./reactive.js";

/** 値を1つの Node に変換する。関数 / シグナルは reactive な範囲、配列はまとめて並べる。 */
export function toNode(child: unknown): Node {
  // 真偽値はどちらも非表示（属性側の true=空文字 とは別。子では false/true とも何も描かない）。
  if (child == null || typeof child === "boolean") return document.createTextNode("");
  if (isSignal(child)) {
    const s = child;
    child = () => s.value;
  } // シグナル直接は関数に正規化
  if (typeof child === "function") {
    // コメント2つで範囲を作り、返り値が何であれその間を再描画する。
    // Node / 配列を返せば構造ごと入れ替わる（${() => list.value.map(...)} が書ける）。
    // 中で張られた effect は所有権ツリーが再実行時に自動 dispose する。
    const start = document.createComment("hole");
    const end = document.createComment("/hole");
    const frag = document.createDocumentFragment();
    frag.append(start, end);
    effect(() => {
      const v = (child as () => unknown)();
      const cur = start.nextSibling;
      const isPrim = !(v instanceof Node) && !Array.isArray(v) && typeof v !== "function";
      if (isPrim && cur !== end && cur?.nodeType === 3 && cur.nextSibling === end) {
        (cur as Text).data = v == null || typeof v === "boolean" ? "" : String(v); // テキスト使い回し
        return;
      }
      while (start.nextSibling && start.nextSibling !== end)
        (start.nextSibling as ChildNode).remove();
      end.before(toNode(v));
    });
    return frag;
  }
  if (child instanceof Node) return child;
  if (Array.isArray(child)) {
    const frag = document.createDocumentFragment();
    for (const c of child.flat(Infinity)) frag.append(toNode(c));
    return frag;
  }
  return document.createTextNode(String(child));
}

/**
 * props・属性穴の値は常に DOM プロパティへ代入する（`el[key] = v`）。属性には書かない。
 * 値の型やキー名で属性とプロパティを振り分ける暗黙の規則は持たない。プロパティなら
 * リッチな値（オブジェクト・配列）も壊れず、value / checked は「初期値」でなく現在値が動く。
 * 帰結:
 * - キーはプロパティの本名で書く: `className`（× class）、`htmlFor`（× for）。
 *   id / title / hidden / disabled など多くのプロパティは属性へ反映される（CSS からも見える）。
 * - data-* / aria-* / SVG など「対応するプロパティがない属性」は、静的に書くか
 *   `effect(() => el.setAttribute(...))` のイディオムで手書きする（README 参照）。
 * - `null` をクリアの意味で渡さない（文字列プロパティでは "null" になりうる）。空にするなら ""。
 */
export function setProp(el: Element, key: string, v: unknown): void {
  (el as unknown as Record<string, unknown>)[key] = v;
}
