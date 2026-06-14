// node.ts — 穴・子の値を DOM ノードへ変換する共通処理（h.ts / html.ts で共用）
import { effect, isSignal } from "./reactive.js";

/** 値を1つの Node に変換する。関数 / シグナルは reactive な範囲、配列はまとめて並べる。 */
export function toNode(child: unknown): Node {
  // 真偽値はどちらも非表示（属性側の true=空文字 とは別。子では false/true とも何も描かない）。
  if (child == null || typeof child === "boolean") return document.createTextNode("");
  if (isSignal(child)) {
    const s = child;
    child = () => s.value;
  } // シグナル直接は関数に正規化
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

/**
 * 属性を設定する。null / false は属性を外し、true は空文字（真偽属性）、それ以外は文字列化。
 * これは全キー共通の規則で、aria-* / data-* も例外にしない（false=削除なので付け外しできる）。
 * `aria-hidden="false"` のように "false" という文字列自体を残したいときは、真偽値ではなく
 * 文字列 "false" を渡す（文字列はそのまま属性に書かれる）。
 * 属性は文字列しか運べないので、value / checked のように DOM プロパティへ入れたい値や
 * オブジェクト・配列などリッチな値は、属性ではなく `.` 接頭辞のプロパティ穴（setProp）を使う。
 */
export function setAttr(el: Element, key: string, v: unknown): void {
  if (v == null || v === false) el.removeAttribute(key);
  else el.setAttribute(key, v === true ? "" : String(v));
}

/**
 * DOM プロパティへ直接代入する（`el[key] = v`）。`.value` / `.checked` のように
 * 属性では「初期値」しか変えられないフォーム系の現在値や、Custom Element へ渡す
 * オブジェクト・配列・関数などのリッチな値の入口。値は丸めず素のまま代入する
 * （`.value=${null}` を空にしたいなら呼び出し側で `?? ""` する）。
 */
export function setProp(el: Element, key: string, v: unknown): void {
  (el as unknown as Record<string, unknown>)[key] = v;
}

/**
 * 属性名から「属性穴か、プロパティ穴か」を解く。`.` 始まりは `.` を外して DOM プロパティ、
 * それ以外は従来どおり属性。h / tags のキーでも `html` の属性名でも同じ規則で使える。
 */
export function resolveSetter(name: string): {
  key: string;
  set: (el: Element, key: string, v: unknown) => void;
} {
  return name.startsWith(".") ? { key: name.slice(1), set: setProp } : { key: name, set: setAttr };
}
