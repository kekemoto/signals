// h.ts — reactive.ts に乗る最小 hyperscript（h 関数方式）
// tagged template と違い、props と子(children)が引数で分かれているので
// 「穴が props か子か」の文字列判定が要らない。穴ごとに effect を張るのは同じ。
// props は常に DOM プロパティに代入する（属性には書かない。node.ts の setProp 参照）。
// 第1引数の props は省略できる（h("div", () => count.value) のように直接子を渡せる）。
// 関数の子は Node / 配列も返せる（h("ul", () => list.value.map(...)) — html と同じ範囲再描画）。
// 行の状態を保ちたいリストは For（key 付き差分）を使う。

import { setProp, toNode } from "./node.js";
import { effect, isSignal, type Signal } from "./reactive.js";

/** reactive な子テキストとして描画できるプリミティブ。 */
type Renderable = string | number | boolean | null | undefined;

/** props の値。常に DOM プロパティに代入されるので何でも渡せる（リッチな値も OK）。
 *  関数 / シグナルなら reactive、`onXxx` の関数はイベントハンドラ。 */
export type PropValue = unknown;

/** h(tag, props, ...) の props。`onXxx` はイベント、それ以外は DOM プロパティ
 *  （キーはプロパティの本名で書く: `className` / `htmlFor` など）。 */
export type Props = Record<string, PropValue>;

/** h(tag, props, child) に渡せる子。関数 / シグナルは reactive な子（Node / 配列も返せる）、配列はフラット化される。 */
export type Child = Node | Renderable | (() => Child) | Signal<Child> | Child[];

/** 第1引数が「props オブジェクトか、それとも子か」を見分ける。
 *  文字列・数値・関数・配列・DOMノード・シグナルは子。プレーンな {} だけ props 扱い。 */
export function isProps(x: unknown): x is Props {
  return (
    x != null &&
    typeof x === "object" && // 関数は "function" なのでここで除外される
    !Array.isArray(x) &&
    !(x instanceof Node) &&
    !isSignal(x)
  );
}

export function h(tag: string, ...args: [Props, ...Child[]] | Child[]): HTMLElement {
  const el = document.createElement(tag);

  // 第1引数が props ならプロパティに、そうでなければ全部子として扱う（props 省略）。
  const hasProps = isProps(args[0]);
  const props = hasProps ? (args[0] as Props) : null;
  const children = hasProps ? args.slice(1) : args;

  for (const key in props || {}) {
    const v = (props as Props)[key];
    if (key.startsWith("on") && typeof v === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), v as EventListener); // onClick → click
    } else if (typeof v === "function") {
      effect(() => setProp(el, key, (v as () => unknown)())); // reactive なプロパティ（関数）
    } else if (isSignal(v)) {
      effect(() => setProp(el, key, v.value)); // reactive なプロパティ（シグナル直接）
    } else {
      setProp(el, key, v); // 静的なプロパティ
    }
  }

  // 子はネストしていてもフラット化し、toNode で変換する（html と同じ挙動）。
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child == null || typeof child === "boolean") continue; // 真偽値はどちらも描かない
    el.append(toNode(child));
  }
  return el;
}
