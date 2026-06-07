// h.ts — reactive.ts に乗る最小 hyperscript（h 関数方式）
// tagged template と違い、属性(props)と子(children)が引数で分かれているので
// 「穴が属性か子か」の文字列判定が要らない。穴ごとに effect を張るのは同じ。
// 第1引数の props は省略できる（h("div", () => count.value) のように直接子を渡せる）。
import { effect, isSignal, type Signal } from "./reactive.js";

/** reactive な属性値・子テキストとして描画できるプリミティブ。 */
type Renderable = string | number | boolean | null | undefined;

/** props の値。関数 / シグナルなら reactive な属性、`onXxx` の関数はイベントハンドラ。 */
export type PropValue = Renderable | EventListenerOrEventListenerObject | (() => Renderable) | Signal<Renderable>;

/** h(tag, props, ...) の props。`onXxx` はイベント、関数 / シグナルは reactive 属性。 */
export type Props = Record<string, PropValue>;

/** h(tag, props, child) に渡せる子。関数 / シグナルは reactive なテキスト、配列はフラット化される。 */
export type Child = Node | Renderable | (() => Renderable) | Signal<Renderable> | Child[];

/** 第1引数が「props オブジェクトか、それとも子か」を見分ける。
 *  文字列・数値・関数・配列・DOMノード・シグナルは子。プレーンな {} だけ props 扱い。 */
export function isProps(x: unknown): x is Props {
  return x != null
    && typeof x === "object"      // 関数は "function" なのでここで除外される
    && !Array.isArray(x)
    && !(x instanceof Node)
    && !isSignal(x);
}

export function h(tag: string, ...args: [Props, ...Child[]] | Child[]): HTMLElement {
  const el = document.createElement(tag);

  // 第1引数が props なら属性に、そうでなければ全部子として扱う（props 省略）。
  const hasProps = isProps(args[0]);
  const props = hasProps ? (args[0] as Props) : null;
  const children = hasProps ? args.slice(1) : args;

  for (const key in (props || {})) {
    const v = (props as Props)[key];
    if (key.startsWith("on") && typeof v === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), v as EventListener); // onClick → click
    } else if (typeof v === "function") {
      effect(() => setAttr(el, key, (v as () => Renderable)()));            // reactive な属性（関数）
    } else if (isSignal(v)) {
      effect(() => setAttr(el, key, v.value as Renderable));               // reactive な属性（シグナル直接）
    } else {
      setAttr(el, key, v);                                                  // 静的な属性
    }
  }

  // 子はネストしていてもフラット化する。
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) appendChild(el, child);
  return el;
}

function setAttr(el: Element, key: string, v: unknown): void {
  if (v == null || v === false) el.removeAttribute(key);
  else el.setAttribute(key, v === true ? "" : String(v));
}

function appendChild(el: Element, child: Child): void {
  if (child == null || child === false) return;
  if (typeof child === "function") {        // reactive な子: その穴だけ effect で更新
    const t = document.createTextNode("");
    el.append(t);
    effect(() => { t.data = String(child()); });
  } else if (isSignal(child)) {             // シグナル直接: .value を購読して更新
    const t = document.createTextNode("");
    el.append(t);
    effect(() => { t.data = String(child.value); });
  } else if (child instanceof Node) {
    el.append(child);                       // 既に DOM ノード（ネストした h(...)）
  } else {
    el.append(document.createTextNode(String(child)));
  }
}
