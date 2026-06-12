// html.ts — タグ付きテンプレートリテラルで reactive な DOM を作る（lit / htm 風）。
//   const count = signal(0);
//   const el = html`
//     <div class="box">
//       <span>count: ${() => count.value}</span>
//       <button onClick=${() => count.value++}>+1</button>
//     </div>`;
// 仕組み:
//   - 静的な構造は <template> でブラウザに一度だけパースさせる（構築は1回）
//   - 穴(${...})だけを「属性／イベント／子」として後から配線し、関数なら effect を張る
//   - 子の関数穴は Node / 配列も返せる（${() => list.value.map(...)} で素のループが書ける）。
//     ただし更新のたび範囲を作り直すので、行の状態を保ちたいリストは For を使う。
import { effect, isSignal } from "./reactive.js";
import { toNode, setAttr } from "./node.js";

/** 穴の目印。属性値・コメントの両方にこの文字列を埋めてパース後に拾う。 */
const MARK = "signals-hole-";
const ATTR_RE = new RegExp(`${MARK}(\\d+)`, "g");
const COMMENT_RE = new RegExp(`^${MARK}(\\d+)$`);

/**
 * タグ付きテンプレートリテラル。`${...}` の穴に値を差し込んで DOM を返す。
 * 単一のルート要素ならその要素を、複数なら DocumentFragment を返す。
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Node {
  // 1. 穴に目印を埋めた HTML 文字列を組み立てる。
  //    タグの中（属性位置）なら値トークン、それ以外（子位置）ならコメントを挿す。
  let src = "";
  let inTag = false;     // 今 <...> の内側か（属性位置か）
  let quote = "";        // タグ内で開いている引用符（" か '）
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {       // 直前の静的文字列を走査して inTag を更新
      const c = s[j];
      if (inTag) {
        if (quote) { if (c === quote) quote = ""; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === ">") inTag = false;
      } else if (c === "<") inTag = true;
    }
    src += s;
    if (i < values.length) src += inTag ? `${MARK}${i}` : `<!--${MARK}${i}-->`;
  }

  // 2. ブラウザに構造をパースさせる（穴は属性値 or コメントとして残る）。
  const tpl = document.createElement("template");
  tpl.innerHTML = src;
  const content = tpl.content;

  // 3. 要素とコメントを先に集めてから配線する（走査中に木を書き換えないため）。
  const walker = document.createTreeWalker(content, 0x1 | 0x80); // SHOW_ELEMENT | SHOW_COMMENT
  const elements: Element[] = [];
  const comments: Comment[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === 8) comments.push(n as Comment);
    else elements.push(n as Element);
  }

  // 3a. 属性の穴を配線する（onXxx はイベント、関数は reactive 属性）。
  for (const el of elements) {
    for (const attr of [...el.attributes]) {
      const { name, value } = attr;
      const m = value.match(COMMENT_RE);          // 値ぜんぶが1つの穴か
      if (m) {
        const v = values[Number(m[1])];
        if (name.startsWith("on") && typeof v === "function") {
          el.removeAttribute(name);
          el.addEventListener(name.slice(2), v as EventListener); // onclick → click
        } else if (typeof v === "function") {
          effect(() => setAttr(el, name, (v as () => unknown)()));
        } else if (isSignal(v)) {
          effect(() => setAttr(el, name, v.value)); // シグナル直接
        } else {
          setAttr(el, name, v);                   // null/false/真偽の意味を保つ
        }
      } else if (ATTR_RE.test(value)) {           // "btn ${...}" のような部分埋め込み
        ATTR_RE.lastIndex = 0;
        wireDynamicAttr(el, name, value, values);
      }
    }
  }

  // 3b. 子の穴を配線する（コメントを実際の中身に置き換える）。
  for (const comment of comments) {
    const m = comment.data.match(COMMENT_RE);
    if (!m) continue;
    comment.replaceWith(toNode(values[Number(m[1])]));
  }

  // 4. 前後の空白だけのテキストを落とし、ルートが1つならその要素を返す。
  trimEdges(content);
  return content.childNodes.length === 1 ? content.firstChild! : content;
}

/** 穴の値を読む。関数なら呼び、シグナルなら .value、それ以外はそのまま。 */
function read(v: unknown): unknown {
  return typeof v === "function" ? (v as () => unknown)() : isSignal(v) ? v.value : v;
}

/** "a ${x} b" のように穴を含む属性値を組み立てる。関数 / シグナルが混ざれば reactive。 */
function wireDynamicAttr(el: Element, name: string, value: string, values: unknown[]): void {
  const parts = value.split(ATTR_RE); // [lit, idx, lit, idx, lit, ...]
  const compose = () =>
    parts.map((p, i) => (i % 2 === 0 ? p : String(read(values[Number(p)])))).join(""); // 偶数=静的, 奇数=穴
  // どれか1つでも関数 / シグナルなら毎回再計算、そうでなければ一度だけ設定する。
  const reactive = parts.some((p, i) => {
    if (i % 2 === 0) return false;
    const v = values[Number(p)];
    return typeof v === "function" || isSignal(v);
  });
  if (reactive) effect(() => setAttr(el, name, compose()));
  else setAttr(el, name, compose());
}

/** DocumentFragment の先頭・末尾にある空白だけのテキストノードを取り除く。 */
function trimEdges(frag: DocumentFragment): void {
  const isBlank = (n: ChildNode | null) => n != null && n.nodeType === 3 && !/\S/.test(n.textContent || "");
  while (isBlank(frag.firstChild)) frag.firstChild!.remove();
  while (isBlank(frag.lastChild)) frag.lastChild!.remove();
}
