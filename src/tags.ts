// tags.ts — h.ts を Proxy で包んだ最小タグビルダー DSL（VanJS 風）
//   const { div, span, button } = tags;
//   div(button({ onClick }, "+1"), span(() => count.value))
// props 省略や props/子の見分けは h.ts 側に集約してあるので、ここは
// 「プロパティ名 → タグ名」を解決して h に丸投げするだけ。
//   tags.myCard(...) → <my-card>（camelCase は kebab-case に変換。Custom Element 用）
import { type Child, h, type Props } from "./h.js";

/** タグビルダー: 第1引数が props ならそれを属性に、以降を子にする（props は省略可）。 */
export type TagBuilder<E extends HTMLElement = HTMLElement> = (
  ...args: [Props, ...Child[]] | Child[]
) => E;

/**
 * `tags` の型。既知の HTML タグは要素型を厳密にして返す（`tags.input(...)` は HTMLInputElement）。
 * `& Record<string, TagBuilder>` は Custom Element の camelCase ショートカット
 * （`tags.myCard(...)` → `<my-card>`）を残すための文字列フォールバック。
 */
export type Tags = {
  [K in keyof HTMLElementTagNameMap]: TagBuilder<HTMLElementTagNameMap[K]>;
} & Record<string, TagBuilder>;

// myCard → my-card / div → div / clipPath → clip-path。先頭が大文字でも先頭ダッシュは付かない。
const toKebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export const tags: Tags = new Proxy({} as Tags, {
  get(_target, key: string): TagBuilder {
    const tag = toKebab(key);
    return (...args) => h(tag, ...args);
  },
});
