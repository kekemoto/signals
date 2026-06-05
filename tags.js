// tags.mjs — h.mjs を Proxy で包んだ最小タグビルダー DSL（VanJS 風）
//   const { div, span, button } = tags;
//   div(button({ onClick }, "+1"), span(() => count.value))
import { h } from "./h.js";

// 第1引数が「props オブジェクトか、それとも子か」を見分ける。
// 文字列・数値・関数・配列・DOMノードは子。プレーンな {} だけ props 扱い。
function isProps(x) {
  return x != null
    && typeof x === "object"
    && !Array.isArray(x)
    && !(x instanceof Node)
    && typeof x !== "function";
}

export const tags = new Proxy({}, {
  get(_target, tag) {
    return (...args) => {
      const hasProps = isProps(args[0]);
      const props = hasProps ? args[0] : {};
      const children = hasProps ? args.slice(1) : args;
      return h(tag, props, ...children);
    };
  },
});
