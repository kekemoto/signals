// store.ts — オブジェクトの「葉」を signal に置き換える小さなヘルパー。
//   const state = store({ user: { name: "a", age: 20 }, ok: true });
//   span(state.user.name)        // 葉は signal なので穴に直渡しできる（() => 不要）
//   state.user.age.value++       // その葉を読む effect / 穴だけが反応する（細粒度）
// 仕組み:
//   - 非オブジェクトの値（プリミティブ等）は signal() に包む＝それが「葉」
//   - オブジェクト / 配列は同じ形のまま再帰し、中の葉だけを signal にする
//   reactive() の Proxy と違い、プロパティアクセスは透過ではなく素の signal を返すので、
//   読み書きは .value 経由（state.user.age.value）。代わりに Proxy のオーバーヘッドや
//   キー列挙の追跡漏れがなく、「葉=signal」というモデルが型にもそのまま出る。
//
// 限界（割り切り）:
//   - 構造変化は追跡しない。キーの追加・削除や配列の push/splice は反応しない
//     （signal は葉に張るので、入れ物そのものの形が変わるのは対象外）。
//     構造ごと差し替えたいなら signal(obj) を丸ごと持つ方が向く。
import { signal, type Signal } from "./reactive.js";

/** store() の戻り値型。オブジェクトは同じ形のまま、葉は Signal<T> になる。 */
export type Store<T> =
  T extends (...args: never[]) => unknown ? Signal<T>   // 関数は葉として signal に
  : T extends object ? { [K in keyof T]: Store<T[K]> }  // オブジェクト / 配列は再帰
  : Signal<T>;                                          // プリミティブは葉

/** オブジェクトの葉を signal に置き換えた、同じ形の木を返す。 */
export function store<T>(obj: T): Store<T> {
  if (!obj || typeof obj !== "object") return signal(obj) as Store<T>; // 葉
  const out = (Array.isArray(obj) ? [] : {}) as Record<PropertyKey, unknown>;
  for (const key in obj) out[key] = store((obj as Record<string, unknown>)[key]);
  return out as Store<T>;
}
