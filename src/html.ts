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
//
// SSR / ハイドレーションに向けて、テンプレ解釈を 2 段に分ける（docs/ssr-hydration-plan.md）:
//   - parse(strings) → descriptors : 静的構造＋穴の記述（位置・種別・属性名）に落とす。
//     値に依存しないのでテンプレート単位でキャッシュできる（同一テンプレは strings が同一参照）。
//   - wire(descriptors, content, values) : パース済み DOM に値を配線（イベント / effect / 子）。
//     新規描画もハイドレーションも将来この同一パスを共有する。
//   この段では挙動は従来どおり（解釈を 1 回に畳んでキャッシュするだけ）。

import { bindProp, isRef, resolveSetter, toNode } from "./node.js";
import { effect, isSignal } from "./reactive.js";

/** 穴の目印。属性値・コメントの両方にこの文字列を埋めてパース後に拾う。 */
const MARK = "signals-hole-";
const ATTR_RE = new RegExp(`${MARK}(\\d+)`, "g");
const COMMENT_RE = new RegExp(`^${MARK}(\\d+)$`);

/**
 * 穴の記述（中間表現）。テンプレ単位で確定する値非依存の情報だけを持つ。
 * `node` は `wire` 側と同じ TreeWalker（SHOW_ELEMENT | SHOW_COMMENT）での走査順インデックス。
 */
type Hole =
  // value 全体が 1 つの穴の属性（`attr=${x}`）。種別（イベント / プロパティ / ref / 属性）は
  // 値に依存するので確定させず、name と穴番号だけ記録して wire 時に解決する。
  | { kind: "attr"; node: number; name: string; index: number }
  // 部分埋め込みの属性（`class="box ${x}"`）。マーカー入りの元の属性値をそのまま持ち、
  // wire 時に compose して設定する。
  | { kind: "attr-part"; node: number; name: string; value: string }
  // 子位置の穴（コメント `<!--signals-hole-N-->`）。wire 時に toNode の結果へ置換する。
  | { kind: "child"; node: number; index: number };

/** テンプレ解釈の結果。`template` はマーカー属性を除去済み（子穴コメントは残す）。 */
interface Descriptors {
  template: HTMLTemplateElement;
  holes: Hole[];
}

/** テンプレート（strings の同一参照）→ descriptors のキャッシュ。 */
const cache = new WeakMap<TemplateStringsArray, Descriptors>();

/**
 * タグ付きテンプレートリテラル。`${...}` の穴に値を差し込んで DOM を返す。
 * 単一のルート要素ならその要素を、複数なら DocumentFragment を返す。
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Node {
  const desc = parse(strings);
  const content = desc.template.content.cloneNode(true) as DocumentFragment;
  wire(desc, content, values);
  // 前後の空白だけのテキストを落とし、ルートが1つならその要素を返す。
  trimEdges(content);
  return content.childNodes.length === 1 ? content.firstChild! : content;
}

/**
 * `strings` を解釈して descriptors を作る（値に依存しないのでテンプレ単位でキャッシュ）。
 *   1. 穴に目印を埋めた HTML 文字列を組み立てる（タグの中なら値トークン、子位置ならコメント）。
 *   2. ブラウザに構造をパースさせる（穴は属性値 or コメントとして残る）。
 *   3. 走査して穴を分類し（属性 / 部分埋め込み / 子）、マーカー属性は template から除去する。
 */
function parse(strings: TemplateStringsArray): Descriptors {
  const hit = cache.get(strings);
  if (hit) return hit;

  // 1. 穴に目印を埋めた HTML 文字列を組み立てる。
  let src = "";
  let inTag = false; // 今 <...> の内側か（属性位置か）
  let quote = ""; // タグ内で開いている引用符（" か '）
  const holeCount = strings.length - 1; // タグ付きテンプレートでは values.length と一致
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      // 直前の静的文字列を走査して inTag を更新
      const c = s[j];
      if (inTag) {
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") inTag = false;
      } else if (c === "<") inTag = true;
    }
    src += s;
    if (i < holeCount) src += inTag ? `${MARK}${i}` : `<!--${MARK}${i}-->`;
  }

  // 2. ブラウザに構造をパースさせる。
  const template = document.createElement("template");
  template.innerHTML = src;

  // 3. 要素とコメントを走査して穴を分類する。マーカー属性は走査後にまとめて除去する
  //    （除去しても走査ノードの集合・順序は変わらないので wire 側のインデックスと揃う）。
  const holes: Hole[] = [];
  const dirty: Array<{ el: Element; name: string }> = [];
  const walker = document.createTreeWalker(template.content, 0x1 | 0x80); // SHOW_ELEMENT | SHOW_COMMENT
  let node = -1;
  while (walker.nextNode()) {
    node++;
    const n = walker.currentNode;
    if (n.nodeType === 8) {
      // 子位置の穴（コメント）
      const m = (n as Comment).data.match(COMMENT_RE);
      if (m) holes.push({ kind: "child", node, index: Number(m[1]) });
    } else {
      // 属性の穴（onXxx / `.foo` / ref / 通常属性、または部分埋め込み）
      const el = n as Element;
      for (const attr of [...el.attributes]) {
        const { name, value } = attr;
        const m = value.match(COMMENT_RE); // 値ぜんぶが1つの穴か
        if (m) {
          holes.push({ kind: "attr", node, name, index: Number(m[1]) });
          dirty.push({ el, name });
        } else if (ATTR_RE.test(value)) {
          // "btn ${...}" のような部分埋め込み
          ATTR_RE.lastIndex = 0;
          holes.push({ kind: "attr-part", node, name, value });
          dirty.push({ el, name });
        }
      }
    }
  }
  // マーカー入りの属性は template から外しておく（clone がきれいになる）。残すとマーカー
  // （や `.foo` という名の属性）が本物の属性として生きてしまう。子穴コメントは wire が置換する。
  for (const { el, name } of dirty) el.removeAttribute(name);

  const desc: Descriptors = { template, holes };
  cache.set(strings, desc);
  return desc;
}

/**
 * パース済み（クローン済み）の DOM に値を配線する。属性 / イベント / プロパティ / ref / 子穴を
 * descriptors に従って処理する。配線規則（onXxx=イベント / `.foo`=プロパティ / それ以外=属性、
 * 関数・signal は accessor 化して effect）は node.ts に集約して h と共用する。
 */
function wire(desc: Descriptors, content: DocumentFragment, values: unknown[]): void {
  // 走査して node 配列を作る（穴を処理して木を書き換える前に全ノード参照を確保する）。
  const nodes: Node[] = [];
  const walker = document.createTreeWalker(content, 0x1 | 0x80);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  // 属性の穴を配線する。ref は木が完成した後に呼びたいので退避し、子穴の置換後にまとめて実行する。
  const refs: Array<() => void> = [];
  for (const hole of desc.holes) {
    if (hole.kind === "attr") {
      const el = nodes[hole.node] as Element;
      const v = values[hole.index];
      if (isRef(hole.name, v)) {
        refs.push(() => v(el)); // 子穴の置換まで終えてから渡す
        continue;
      }
      bindProp(el, hole.name, v);
    } else if (hole.kind === "attr-part") {
      wireDynamicAttr(nodes[hole.node] as Element, hole.name, hole.value, values);
    }
  }

  // 子の穴を配線する（コメントを実際の中身に置き換える）。
  for (const hole of desc.holes) {
    if (hole.kind === "child") {
      (nodes[hole.node] as Comment).replaceWith(toNode(values[hole.index]));
    }
  }

  // ref はすべての穴の配線が済んでから（要素が完成した状態で）1度だけ呼ぶ。
  for (const run of refs) run();
}

/** 穴の値を読む。関数なら呼び、シグナルなら .value、それ以外はそのまま。 */
function read(v: unknown): unknown {
  return typeof v === "function" ? (v as () => unknown)() : isSignal(v) ? v.value : v;
}

/** "a ${x} b" のように穴を含む属性値を組み立てる。関数 / シグナルが混ざれば reactive。
 *  名前が `.foo` ならその文字列を DOM プロパティへ入れる（部分埋め込みは常に文字列になる）。 */
function wireDynamicAttr(el: Element, name: string, value: string, values: unknown[]): void {
  const { key, set } = resolveSetter(name);
  const parts = value.split(ATTR_RE); // [lit, idx, lit, idx, lit, ...]
  const compose = () =>
    parts.map((p, i) => (i % 2 === 0 ? p : String(read(values[Number(p)])))).join(""); // 偶数=静的, 奇数=穴
  // どれか1つでも関数 / シグナルなら毎回再計算、そうでなければ一度だけ設定する。
  const reactive = parts.some((p, i) => {
    if (i % 2 === 0) return false;
    const v = values[Number(p)];
    return typeof v === "function" || isSignal(v);
  });
  if (reactive) effect(() => set(el, key, compose()));
  else set(el, key, compose());
}

/** DocumentFragment の先頭・末尾にある空白だけのテキストノードを取り除く。 */
function trimEdges(frag: DocumentFragment): void {
  const isBlank = (n: ChildNode | null) =>
    n != null && n.nodeType === 3 && !/\S/.test(n.textContent || "");
  while (isBlank(frag.firstChild)) frag.firstChild!.remove();
  while (isBlank(frag.lastChild)) frag.lastChild!.remove();
}
