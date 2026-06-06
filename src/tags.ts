// tags.ts — h.ts を Proxy で包んだ最小タグビルダー DSL（VanJS 風）
//   const { div, span, button } = tags;
//   div(button({ onClick }, "+1"), span(() => count.value))
import { h, type Props, type Child } from "./h.js";

/** タグビルダー: 第1引数が props ならそれを属性に、以降を子にする。 */
export type TagBuilder = (...args: [Props, ...Child[]] | Child[]) => HTMLElement;

// 第1引数が「props オブジェクトか、それとも子か」を見分ける。
// 文字列・数値・関数・配列・DOMノードは子。プレーンな {} だけ props 扱い。
function isProps(x: unknown): x is Props {
  return x != null
    && typeof x === "object"
    && !Array.isArray(x)
    && !(x instanceof Node)
    && typeof x !== "function";
}

export const tags: Record<string, TagBuilder> = new Proxy({} as Record<string, TagBuilder>, {
  get(_target, tag: string): TagBuilder {
    return (...args) => {
      const hasProps = isProps(args[0]);
      const props = hasProps ? (args[0] as Props) : {};
      const children = (hasProps ? args.slice(1) : args) as Child[];
      return h(tag, props, children);
    };
  },
});
