// show.js — 条件表示（Solid の <Show> 相当）。h.js / tags.js と組み合わせる。
//   Show(() => user.value != null,
//        () => h("p", {}, "ようこそ"),
//        () => h("p", {}, "ログインしてください"))   // 第3引数(fallback)は任意
// 要点:
//   - when が真なら render() を、偽なら fallback() を表示する
//   - 切り替え時に中身を createRoot で作り、消えるときは dispose（中の effect も止まる）
//   - when の「真偽」が変わったときだけ作り直す（同じ間は据え置き）
import { effect, createRoot } from "./reactive.js";

export function Show(whenFn, render, fallback = null) {
  const start = document.createComment("show");
  const end = document.createComment("/show");
  const frag = document.createDocumentFragment();
  frag.append(start, end);            // この2つの間に中身を出し入れする

  let shown;                          // 直前の真偽（初回は undefined）
  let current = null;                 // { node, dispose }

  effect(() => {
    const show = !!whenFn();          // when を購読
    if (show === shown) return;       // 真偽が変わらなければ何もしない（中身は据え置き）
    shown = show;
    const parent = end.parentNode;
    if (!parent) return;

    // 前の中身を片付ける（中の effect も dispose して止める）
    if (current) {
      current.dispose();
      if (current.node) current.node.remove();
      current = null;
    }

    // 新しい中身を作る（show なら render、そうでなければ fallback）
    const make = show ? render : fallback;
    if (make) {
      let node, dispose;
      createRoot((d) => { dispose = d; node = make(); });
      if (node) {
        parent.insertBefore(node, end);
        current = { node, dispose };
      }
    }
  });

  return frag;
}
