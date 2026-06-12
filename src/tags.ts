// tags.ts — h.ts を Proxy で包んだ最小タグビルダー DSL（VanJS 風）
//   const { div, span, button } = tags;
//   div(button({ onClick }, "+1"), span(() => count.value))
// props 省略や props/子の見分けは h.ts 側に集約してあるので、ここは
// 「プロパティ名 → タグ名」を解決して h に丸投げするだけ。
//   tags.myCard(...) → <my-card>（camelCase は kebab-case に変換。Custom Element 用）
import { type Child, h, type Props } from "./h.js";

/** タグビルダー: 第1引数が props ならそれを DOM プロパティに、以降を子にする（props は省略可）。 */
export type TagBuilder = (...args: [Props, ...Child[]] | Child[]) => HTMLElement;

// myCard → my-card / div → div / clipPath → clip-path。先頭が大文字でも先頭ダッシュは付かない。
const toKebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export const tags: Record<string, TagBuilder> = new Proxy({} as Record<string, TagBuilder>, {
  get(_target, key: string): TagBuilder {
    const tag = toKebab(key);
    return (...args) => h(tag, ...args);
  },
});
