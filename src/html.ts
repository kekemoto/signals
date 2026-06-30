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

import { RANGE } from "./emitted-html.js";
import {
  claimElement,
  claimRange,
  deferAdopt,
  flushAdopt,
  isDeferred,
  isHydrating,
  withScope,
} from "./hydration.js";
import { adoptChild, bindProp, isRef, resolveSetter, toNode } from "./node.js";
import { DEV, effect, isSignal } from "./reactive.js";

/** 穴の目印。属性値・コメントの両方にこの文字列を埋めてパース後に拾う。 */
const MARK = "signals-hole-";
// 部分埋め込み属性値を [静的, 穴番号, 静的, ...] に割る split 用。`g` フラグは split には
// 不要なので付けない（lastIndex を持つ状態付き regex を避ける）。穴の有無の判定は
// value.includes(MARK) で行う。
const ATTR_SPLIT_RE = new RegExp(`${MARK}(\\d+)`);
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
  // ハイドレーション中はサーバが出した既存 DOM を採用する（作り直さない）。eager 評価で
  // 共有カーソルを先食いしないよう、その場では claim せず採用処理を遅延フラグメントに包んで返す。
  // 駆動側（runHydration / 外側 html の子走査 / For・Show の各行）がカーソルを合わせて flush する。
  if (isHydrating()) return deferAdopt(() => adoptTemplate(desc, values));
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
 *
 * inTag 走査はタグ / 引用符 / `<!-- -->` コメントを追う。`<script>` / `<textarea>` などの
 * raw text 要素の中身（中の `<` を文字として扱う等）は **対象外**［割り切り］。これらの中に穴を
 * 置く使い方は想定しない（コストに見合わないため非対応）。
 */
function parse(strings: TemplateStringsArray): Descriptors {
  const hit = cache.get(strings);
  if (hit) return hit;

  // 1. 穴に目印を埋めた HTML 文字列を組み立てる。
  let src = "";
  let inTag = false; // 今 <...> の内側か（属性位置か）
  let quote = ""; // タグ内で開いている引用符（" か '）
  let inComment = false; // 今 <!-- ... --> の内側か
  const holeCount = strings.length - 1; // タグ付きテンプレートでは values.length と一致
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      // 直前の静的文字列を走査して inTag を更新
      const c = s[j];
      if (inComment) {
        // コメント内は inTag / quote を一切触らず `-->` まで読み飛ばす。これが無いと
        // コメント中の `>` で inTag を誤って閉じたり、`'`（it's など）で quote が開いて
        // `-->` の `>` を飲み込み、以降の穴の属性/子の判定がずれる。
        if (c === "-" && s.startsWith("-->", j)) {
          inComment = false;
          j += 2; // `-->` の残り2文字を飛ばす
        }
      } else if (inTag) {
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") inTag = false;
      } else if (c === "<") {
        // 子位置の `<!--` はタグではなくコメント開始。タグと区別してコメントモードへ入る。
        if (s.startsWith("<!--", j)) {
          inComment = true;
          j += 3; // `<!--` の残り3文字を飛ばす
        } else inTag = true;
      }
    }
    src += s;
    // コメント内の穴（`<!-- ${x} -->`）は配線経路が無いので、属性でも子でもなく
    // 不活性なテキストマーカーとして置き（コメント本文に紛れて無視される）。
    if (i < holeCount) src += inTag || inComment ? `${MARK}${i}` : `<!--${MARK}${i}-->`;
  }

  // 2. ブラウザに構造をパースさせる。
  const template = document.createElement("template");
  template.innerHTML = src;

  // 3. 要素とコメントを走査して穴を分類する。マーカー属性は走査後にまとめて除去する
  //    （除去しても走査ノードの集合・順序は変わらないので wire 側のインデックスと揃う）。
  const holes: Hole[] = [];
  const dirty: Array<{ el: Element; name: string }> = [];
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );
  let node = -1;
  while (walker.nextNode()) {
    node++;
    const n = walker.currentNode;
    if (n.nodeType === Node.COMMENT_NODE) {
      // 子位置の穴（コメント）
      const m = (n as Comment).data.match(COMMENT_RE);
      if (m) holes.push({ kind: "child", node, index: Number(m[1]) });
    } else {
      // 属性の穴（onXxx / `.foo` / ref / 通常属性、または部分埋め込み）
      const el = n as Element;
      // タグ名の位置の穴（`<${tag}>`）はマーカーがタグ名に焼き込まれる。配線できず無視される。
      if (DEV && el.tagName.toLowerCase().includes(MARK))
        console.warn(
          "html: タグ名の位置にある穴は未対応です（動的なタグ名はできません）。この穴は無視されます。",
        );
      for (const attr of [...el.attributes]) {
        const { name, value } = attr;
        // 属性名の位置の穴（`<div ${x}>` / `<div data-${k}>`）はマーカーが名前に焼き込まれる。
        // 値マーカーと違い配線経路が無いので、dev で知らせて以降の判定はスキップする（挙動は従来と同じ＝無視）。
        if (name.includes(MARK)) {
          if (DEV)
            console.warn(
              "html: 属性名・スプレッド位置にある穴は未対応です（属性名のスプレッドはできません）。この穴は無視されます。",
            );
          continue;
        }
        const m = value.match(COMMENT_RE); // 値ぜんぶが1つの穴か
        if (m) {
          holes.push({ kind: "attr", node, name, index: Number(m[1]) });
          dirty.push({ el, name });
        } else if (value.includes(MARK)) {
          // "btn ${...}" のような部分埋め込み
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
  const walker = document.createTreeWalker(
    content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );
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

/** ハイドレーション用に、テンプレ各ノードの参照から穴を引けるルックアップ。 */
interface AdoptLookup {
  /** テンプレ要素 → その要素に付く属性 / 部分埋め込み穴。 */
  attrHolesByEl: Map<Element, Hole[]>;
  /** テンプレの子穴コメント（`<!--signals-hole-N-->`）→ 子穴記述。 */
  childHoleByComment: Map<Comment, Extract<Hole, { kind: "child" }>>;
}

/**
 * descriptors の穴を「テンプレノードの参照」で引けるよう整理する。`hole.node`（要素＋コメント
 * 混在の走査インデックス）を、`desc.template` を同じ TreeWalker で辿って実際のノード参照に解決する。
 * 構造的走査（adoptTemplate）は木を降りながらノード参照で穴を引くので、フラットな順位計算が要らない。
 */
function buildAdoptLookup(desc: Descriptors): AdoptLookup {
  const attrHolesByEl = new Map<Element, Hole[]>();
  const childHoleByComment = new Map<Comment, Extract<Hole, { kind: "child" }>>();
  // node インデックス → 穴（同じ要素に複数の属性穴が付くので配列）。
  const byNode = new Map<number, Hole[]>();
  for (const h of desc.holes) {
    const arr = byNode.get(h.node);
    if (arr) arr.push(h);
    else byNode.set(h.node, [h]);
  }
  const tw = document.createTreeWalker(
    desc.template.content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );
  let i = -1;
  while (tw.nextNode()) {
    i++;
    const hs = byNode.get(i);
    if (!hs) continue;
    const n = tw.currentNode;
    for (const h of hs) {
      if (h.kind === "child") childHoleByComment.set(n as Comment, h);
      else {
        // attr / attr-part のみがここへ来る（要素に付く穴）。
        const arr = attrHolesByEl.get(n as Element);
        if (arr) arr.push(h);
        else attrHolesByEl.set(n as Element, [h]);
      }
    }
  }
  return { attrHolesByEl, childHoleByComment };
}

/**
 * パース済みの descriptors を、サーバ（emit）が出した既存 DOM へ **採用（adopt）** して配線する
 * （新規生成しない＝段階3の wire の adopt パス）。`html` の遅延フラグメントが flush されたとき、
 * アンビエントカーソルが正しい位置に置かれた状態で呼ばれる。
 *
 * 走査は「テンプレ木と実 DOM 木を同時に降りる構造的カーソル」（adoptChildren）で行う:
 *   - テンプレ要素は `claimElement` で実 DOM の同位置の要素に突き合わせ、属性 / イベント /
 *     プロパティ / ref 穴を配線し、その要素の子を新スコープ（withScope）で再帰的に採用する。
 *   - reactive 子穴は `<!--hole-->…<!--/hole-->` を claim して adoptChild で effect を張り直す。
 *   - 入れ子の `For` / `Show` / `html`（遅延フラグメント）はその子穴位置で flush して採用させる。
 *   - 静的な子穴はマーカーが無く配線不要なので飛ばす（次の要素 / マーカー claim が前方走査で吸収する）。
 * 複数ルート（fragment テンプレ）はトップレベルの子を順に claim するので自然に全ルートが配線される。
 *
 * 戻り値は最初に claim したルート要素（最上位 `runHydration` の戻り値・テストの `===` 判定に使う）。
 * どのルートも claim できなければ DEV 警告のうえ新規生成にフォールバックする（mismatch を致命にしない）。
 */
function adoptTemplate(desc: Descriptors, values: unknown[]): Node {
  const lookup = buildAdoptLookup(desc);
  const refs: Array<() => void> = [];
  const firstRoot = adoptChildren(desc.template.content, values, lookup, refs);
  // ref はすべての穴の配線が済んでから（要素が完成した状態で）呼ぶ（wire と同じ）。
  for (const run of refs) run();
  if (firstRoot) return firstRoot;
  if (DEV)
    console.warn("html(hydrate): 採用するルートが見つかりません。新規生成にフォールバックします。");
  const content = desc.template.content.cloneNode(true) as DocumentFragment;
  wire(desc, content, values);
  trimEdges(content);
  return content.childNodes.length === 1 ? content.firstChild! : content;
}

/**
 * テンプレ親 `templateParent` の子を順に辿り、アンビエントカーソル（＝対応する実 DOM 親の
 * スコープ）から既存ノードを claim して配線する。最初に claim した要素を返す（複数ルートの
 * 先頭ルート用）。`template*` はテンプレ側のノード、`server*` はサーバが出した実 DOM 側のノード。
 */
function adoptChildren(
  templateParent: Node,
  values: unknown[],
  lookup: AdoptLookup,
  refs: Array<() => void>,
): Element | null {
  let firstRoot: Element | null = null;
  for (
    let templateChild = templateParent.firstChild;
    templateChild;
    templateChild = templateChild.nextSibling
  ) {
    if (templateChild.nodeType === Node.TEXT_NODE) continue; // テンプレの静的テキスト（配線不要）
    if (templateChild.nodeType === Node.COMMENT_NODE) {
      const hole = lookup.childHoleByComment.get(templateChild as Comment);
      if (!hole) continue; // 著者が書いた静的コメント
      const v = values[hole.index];
      if (typeof v === "function" || isSignal(v)) {
        // reactive 子穴: サーバの開閉ペアを claim して effect を張り直す。
        const range = claimRange(RANGE.hole);
        if (range) adoptChild(range.start, range.end, v);
        else if (DEV)
          console.warn(
            "html(hydrate): reactive な子穴に対応する <!--hole--> が見つかりません（mismatch）。",
          );
      } else if (isDeferred(v)) {
        // 入れ子の For / Show / html: この子穴位置のカーソルで自分の範囲を claim・採用させる。
        flushAdopt(v);
      }
      // それ以外（静的な子）はサーバ出力のまま。次の claim が前方走査で吸収するのでカーソルは触らない。
    } else if (templateChild.nodeType === Node.ELEMENT_NODE) {
      const templateEl = templateChild as Element;
      const serverEl = claimElement();
      if (!serverEl) {
        if (DEV)
          console.warn(
            `html(hydrate): <${templateEl.tagName.toLowerCase()}> に対応する要素が見つかりません（mismatch）。`,
          );
        continue;
      }
      if (firstRoot == null) firstRoot = serverEl;
      // 期待タグ vs 実ノードのタグを照合する mismatch 検出（DEV のみ。Lit / React の
      // hydration warning と同じ立て付け。本番では DEV が畳まれてゼロコスト）。
      if (DEV && serverEl.tagName !== templateEl.tagName)
        console.warn(
          `html(hydrate): タグ不一致（テンプレ <${templateEl.tagName.toLowerCase()}> ≠ 実 DOM ` +
            `<${serverEl.tagName.toLowerCase()}>）。以降の配線がずれる可能性があります。`,
        );
      const attrHoles = lookup.attrHolesByEl.get(templateEl);
      if (attrHoles) for (const hole of attrHoles) wireAttrHole(serverEl, hole, values, refs);
      // この要素の子は、その要素の中だけを見る新スコープで再帰的に採用する（構造的カーソル）。
      withScope(serverEl, () => adoptChildren(templateEl, values, lookup, refs));
    }
  }
  return firstRoot;
}

/** 採用時の属性 / 部分埋め込み穴を 1 つ配線する（wire の属性処理と同じ規則。ref は退避）。 */
function wireAttrHole(el: Element, hole: Hole, values: unknown[], refs: Array<() => void>): void {
  if (hole.kind === "attr") {
    const v = values[hole.index];
    if (isRef(hole.name, v)) {
      refs.push(() => v(el)); // 子穴の採用まで終えてから渡す
      return;
    }
    bindProp(el, hole.name, v);
  } else if (hole.kind === "attr-part") {
    wireDynamicAttr(el, hole.name, hole.value, values);
  }
}

/** 穴の値を読む。関数なら呼び、シグナルなら .value、それ以外はそのまま。 */
function read(v: unknown): unknown {
  return typeof v === "function" ? (v as () => unknown)() : isSignal(v) ? v.value : v;
}

/** "a ${x} b" のように穴を含む属性値を組み立てる。関数 / シグナルが混ざれば reactive。
 *  名前が `.foo` ならその文字列を DOM プロパティへ入れる（部分埋め込みは常に文字列になる）。 */
function wireDynamicAttr(el: Element, name: string, value: string, values: unknown[]): void {
  const { key, set } = resolveSetter(name);
  const parts = value.split(ATTR_SPLIT_RE); // [lit, idx, lit, idx, lit, ...]
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
    n != null && n.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent || "");
  while (isBlank(frag.firstChild)) frag.firstChild!.remove();
  while (isBlank(frag.lastChild)) frag.lastChild!.remove();
}
