// h.ts — reactive.ts に乗る最小 hyperscript（h 関数方式）
// tagged template と違い、属性(props)と子(children)が引数で分かれているので
// 「穴が属性か子か」の文字列判定が要らない。穴ごとに effect を張るのは同じ。
// 第1引数の props は省略できる（h("div", () => count.value) のように直接子を渡せる）。
// 関数の子は Node / 配列も返せる（h("ul", () => list.value.map(...)) — html と同じ範囲再描画）。
// 行の状態を保ちたいリストは For（key 付き差分）を使う。

import { isProp, type Prop, resolveSetter, setProp, toNode } from "./node.js";
import { effect, isSignal, type Signal } from "./reactive.js";

// prop() は h / tags のオブジェクト記法で「DOM プロパティ代入」を指定する値ラッパー。
// `@kekemoto/signals/h` から使えるよう再公開する（実体は node.ts）。
export { type Prop, prop } from "./node.js";

/** reactive な属性値・子テキストとして描画できるプリミティブ。 */
type Renderable = string | number | boolean | null | undefined;

/**
 * props の値。関数 / シグナルなら reactive、`onXxx` の関数はイベントハンドラ。
 * キーが `.foo` 形式なら DOM プロパティ代入になり、オブジェクト・配列などリッチな値も渡せる。
 */
export type PropValue =
  | Renderable
  | EventListenerOrEventListenerObject
  | object
  | (() => unknown)
  | Signal<unknown>;

/**
 * h(tag, props, ...) の props。`onXxx` はイベント、`.foo` は DOM プロパティ、
 * それ以外のキーは属性。関数 / シグナルはいずれも reactive になる。
 */
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

  // 第1引数が props なら属性に、そうでなければ全部子として扱う（props 省略）。
  const hasProps = isProps(args[0]);
  const props = hasProps ? (args[0] as Props) : null;
  const children = hasProps ? args.slice(1) : args;

  for (const key in props || {}) {
    let v = (props as Props)[key];
    if (key.startsWith("on") && typeof v === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), v as EventListener); // onClick → click
      continue;
    }
    // 振り分け: キーの `.foo`（resolveSetter）か、値側の prop(...) で DOM プロパティ代入になる。
    const { key: name, set: attrSet } = resolveSetter(key);
    let set = attrSet;
    if (isProp(v)) {
      v = (v as Prop).value as PropValue; // 箱を外し、中身を従来どおり処理
      set = setProp;
    }
    if (typeof v === "function") {
      effect(() => set(el, name, (v as () => unknown)())); // reactive（関数）
    } else if (isSignal(v)) {
      effect(() => set(el, name, v.value)); // reactive（シグナル直接）
    } else {
      set(el, name, v); // 静的
    }
  }

  // 子はネストしていてもフラット化し、toNode で変換する（html と同じ挙動）。
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child == null || typeof child === "boolean") continue; // 真偽値はどちらも描かない
    el.append(toNode(child));
  }
  return el;
}
