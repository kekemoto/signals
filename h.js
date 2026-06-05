// h.mjs — reactive.js に乗る最小 hyperscript（h 関数方式）
// tagged template と違い、属性(props)と子(children)が引数で分かれているので
// 「穴が属性か子か」の文字列判定が要らない。穴ごとに effect を張るのは同じ。
import { effect } from "./reactive.js";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);

  for (const key in (props || {})) {
    const v = props[key];
    if (key.startsWith("on") && typeof v === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), v); // onClick → click
    } else if (typeof v === "function") {
      effect(() => setAttr(el, key, v()));                // reactive な属性
    } else {
      setAttr(el, key, v);                                // 静的な属性
    }
  }

  for (const child of children.flat(Infinity)) appendChild(el, child);
  return el;
}

function setAttr(el, key, v) {
  if (v == null || v === false) el.removeAttribute(key);
  else el.setAttribute(key, v === true ? "" : String(v));
}

function appendChild(el, child) {
  if (child == null || child === false) return;
  if (typeof child === "function") {        // reactive な子: その穴だけ effect で更新
    const t = document.createTextNode("");
    el.append(t);
    effect(() => { t.data = String(child()); });
  } else if (child instanceof Node) {
    el.append(child);                       // 既に DOM ノード（ネストした h(...)）
  } else {
    el.append(document.createTextNode(String(child)));
  }
}
