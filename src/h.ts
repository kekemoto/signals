// h.ts — reactive.ts に乗る最小 hyperscript（h 関数方式）
// tagged template と違い、属性(props)と子(children)が引数で分かれているので
// 「穴が属性か子か」の文字列判定が要らない。穴ごとに effect を張るのは同じ。
import { effect, isSignal, type Signal } from "./reactive.js";

/** reactive な属性値・子テキストとして描画できるプリミティブ。 */
type Renderable = string | number | boolean | null | undefined;

/** props の値。関数 / シグナルなら reactive な属性、`onXxx` の関数はイベントハンドラ。 */
export type PropValue = Renderable | EventListenerOrEventListenerObject | (() => Renderable) | Signal<Renderable>;

/** h(tag, props, ...) の props。`onXxx` はイベント、関数 / シグナルは reactive 属性。 */
export type Props = Record<string, PropValue>;

/** h(tag, props, child) に渡せる子。関数 / シグナルは reactive なテキスト、配列はフラット化される。 */
export type Child = Node | Renderable | (() => Renderable) | Signal<Renderable> | Child[];

export function h(tag: string, props?: Props | null, children?: Child): HTMLElement {
  const el = document.createElement(tag);

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

  // children は単一の子か、子の配列。配列はネストしていてもフラット化する。
  for (const child of ([children] as unknown[]).flat(Infinity) as Child[]) appendChild(el, child);
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
