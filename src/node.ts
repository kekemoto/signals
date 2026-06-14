// node.ts — 穴・子の値を DOM ノードへ変換する共通処理（h.ts / html.ts で共用）
import { effect, isSignal, type Signal } from "./reactive.js";

/**
 * reactive な入力を1つの accessor `() => T` に正規化する。
 * signal 直渡し（`span(state.user.name)`）と accessor（`span(() => ...)`）の両方を
 * 受ける穴・コンポーネント引数で、「読み口は関数」に揃えるために共用する。
 */
export function toAccessor<T>(v: Signal<T> | (() => T)): () => T {
  return isSignal(v) ? () => v.value : v;
}

/** 値を1つの Node に変換する。関数 / シグナルは reactive な範囲、配列はまとめて並べる。 */
export function toNode(child: unknown): Node {
  // 真偽値はどちらも非表示（属性側の true=空文字 とは別。子では false/true とも何も描かない）。
  if (child == null || typeof child === "boolean") return document.createTextNode("");
  if (isSignal(child)) child = toAccessor(child); // シグナル直接は関数に正規化
  if (typeof child === "function") {
    // コメント2つで範囲を作り、返り値が何であれその間を再描画する。
    // Node / 配列を返せば構造ごと入れ替わる（${() => list.value.map(...)} が書ける）。
    // 中で張られた effect は所有権ツリーが再実行時に自動 dispose する。
    const start = document.createComment("hole");
    const end = document.createComment("/hole");
    const frag = document.createDocumentFragment();
    frag.append(start, end);
    effect(() => {
      const v = (child as () => unknown)();
      const cur = start.nextSibling;
      const isPrim = !(v instanceof Node) && !Array.isArray(v) && typeof v !== "function";
      if (isPrim && cur !== end && cur?.nodeType === 3 && cur.nextSibling === end) {
        (cur as Text).data = v == null || typeof v === "boolean" ? "" : String(v); // テキスト使い回し
        return;
      }
      while (start.nextSibling && start.nextSibling !== end)
        (start.nextSibling as ChildNode).remove();
      end.before(toNode(v));
    });
    return frag;
  }
  if (child instanceof Node) return child;
  if (Array.isArray(child)) {
    const frag = document.createDocumentFragment();
    for (const c of child.flat(Infinity)) frag.append(toNode(c));
    return frag;
  }
  return document.createTextNode(String(child));
}

// 属性を書いても「初期値」しか変わらないフォーム系のキー。
// （input.value 等は、ユーザー入力後は属性とプロパティが乖離する）
const FORM_PROPS = new Set(["value", "checked", "selected", "disabled"]);

/**
 * 属性を設定する。null / false は属性を外し、true は空文字（真偽属性）。
 * これは全キー共通の規則で、aria-* / data-* も例外にしない（false=削除なので付け外しできる）。
 * `aria-hidden="false"` のように "false" という文字列自体を残したいときは、真偽値ではなく
 * 文字列 "false" を渡す（文字列はそのまま属性に書かれる）。
 * ただし次の2つはプロパティ代入に切り替える（属性は文字列しか運べないため）:
 * - リッチな値（オブジェクト・関数・配列）→ `el[key] = v`（Custom Element への入力口）
 * - フォーム系の既知キー（value / checked / selected / disabled）→ 現在値を直接更新
 */
export function setAttr(el: Element, key: string, v: unknown): void {
  if ((typeof v === "object" && v !== null) || typeof v === "function") {
    (el as unknown as Record<string, unknown>)[key] = v;
  } else if (FORM_PROPS.has(key) && key in el) {
    // value だけは null/undefined を空文字に丸める（el.value = null は "null" 表示になるため）。
    // 真偽系（checked 等）は IDL 側の ToBoolean 変換に任せる。
    (el as unknown as Record<string, unknown>)[key] = key === "value" && v == null ? "" : v;
  } else if (v == null || v === false) el.removeAttribute(key);
  else el.setAttribute(key, v === true ? "" : String(v));
}
