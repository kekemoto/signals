// emit.ts — SSR / SSG 向けの文字列エミッタ（DOM 非依存）。docs/ssr-hydration-plan.md の第2段階。
//   const cls = signal("box");
//   emit`<div class=${cls}>${() => count.value}</div>`
//     → '<div class="box"><!--hole-->0<!--/hole--></div>'
//
// 何をするか:
//   - `html` と同じタグ付きテンプレートを受け取り、**値を埋めた HTML 文字列**を返す。
//   - effect は張らない。関数穴は 1 回呼ぶ・signal は `.value` を 1 回読むだけ（初期値）。
//     → reactive な配線（effect / addEventListener）はブラウザ側 `wire` の担当。サーバは
//       「計算後の初期値」を埋めるだけで、クライアントと同じ初期値になることで mismatch を防ぐ。
//   - ハイドレーション用のマーカーを残す:
//       - 子穴（reactive）は `<!--hole-->…<!--/hole-->` の開閉ペア（`node.ts` の toNode と同形）。
//         `wire` はこの間を担当ノードと認識して effect を張り直す。静的な子はペアを出さず素のテキスト。
//       - イベント / ref / プロパティ（`.foo`）穴は属性を一切吐かない（クライアントの DOM と同形）。
//         `wire` は descriptors の位置情報で要素を突き合わせるので、属性マーカーは要らない。
//   - XSS 対策のエスケープ: 本文は `&` `<`、属性値は `&` `"`。エスケープするのは**埋め込んだ値だけ**で、
//     テンプレート著者が書いた静的な文字列はそのまま通す（`html` と同じ信頼境界）。
//
// DOM 非依存:
//   このファイルは `document` / `customElements` 等のブラウザ API を一切呼ばない（import も
//   DOM に触れない `reactive.ts` / `node.ts` の純粋関数だけ）。サーバ / SSG ビルドからそのまま
//   import できる。テンプレ解釈は `html.ts` の DOM パース（`template.innerHTML`）を通らない別経路で、
//   自前の軽量トークナイザでチャンク＋穴に分ける。
import { isRef, resolveEvent } from "./node.js";
import { isSignal } from "./reactive.js";

/** 子穴（reactive）を囲む開閉コメント。node.ts の toNode が作るペアと同形にして wire を共用する。 */
const HOLE_OPEN = "<!--hole-->";
const HOLE_CLOSE = "<!--/hole-->";

/** 解釈結果の命令列。値に依存しない構造だけを持つのでテンプレ単位でキャッシュできる。 */
type Op =
  // 静的な出力（タグ構造・静的属性・本文テキスト）。そのまま連結する。
  | { kind: "lit"; text: string }
  // 子位置の穴。emit 時に values[i] を読んで（reactive ならペアで囲って）流し込む。
  | { kind: "child"; index: number }
  // 値ぜんぶが 1 つの穴の属性（`attr=${x}`）。種別（イベント / ref / プロパティ / 属性）は
  // 値に依存するので emit 時に解決する。出力は先頭スペース込み（空なら属性ごと省く）。
  | { kind: "attr"; name: string; index: number }
  // 部分埋め込みの属性（`class="box ${x}"`）。emit 時に各部分を合成して 1 つの属性値にする。
  | { kind: "attr-part"; name: string; parts: Part[] };

/** 部分埋め込み属性の構成要素。静的な断片か、穴番号のどちらか。 */
type Part = { lit: string } | { hole: number };

/** テンプレート（strings の同一参照）→ 命令列のキャッシュ。html.ts と同じく WeakMap でテンプレ単位。 */
const cache = new WeakMap<TemplateStringsArray, Op[]>();

/**
 * タグ付きテンプレートリテラルを値入りの HTML 文字列にする（サーバ / SSG 用）。
 * `html` と同じ書き味で、戻り値が Node ではなく文字列になる。effect は張らない。
 */
export function emit(strings: TemplateStringsArray, ...values: unknown[]): string {
  const ops = parse(strings);
  let out = "";
  for (const op of ops) {
    if (op.kind === "lit") out += op.text;
    else if (op.kind === "child") out += emitChild(values[op.index]);
    else if (op.kind === "attr") out += emitAttr(op.name, values[op.index]);
    else out += emitAttrPart(op.name, op.parts, values);
  }
  return out;
}

// --- 値の解決・直列化（DOM を使わない） ----------------------------------------------------

/** 穴の値を 1 回だけ読む。関数なら呼び、signal なら `.value`、それ以外はそのまま（html.ts と同じ）。 */
function read(v: unknown): unknown {
  return typeof v === "function" ? (v as () => unknown)() : isSignal(v) ? v.value : v;
}

/** 本文（テキストノード）向けエスケープ。`<` と `&` を実体参照にする。 */
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** 属性値向けエスケープ。`"` と `&` を実体参照にする（属性は二重引用符で括る前提）。 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * class / style のオブジェクト形式かを見分ける（配列・null・Node は除く）。
 * node.ts と違い `Node` の存在を確認してから判定するので、DOM の無いサーバでも安全に呼べる。
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return typeof Node === "undefined" || !(v instanceof Node);
}

/** `{ active: true }` → `"active"`（真のキーだけを space 結合。node.ts の classList と同等）。 */
function classString(obj: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(obj)) if (v) out += (out ? " " : "") + k;
  return out;
}

/**
 * style オブジェクトを inline style 文字列にする（node.ts の setStyle と同じ規則を文字列で再現）。
 * キーに `-` を含むものはそのまま、含まないものは camelCase → kebab-case に変換する。null / false は不採用。
 */
function styleString(obj: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false) continue;
    const prop = k.includes("-") ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    out += `${prop}: ${String(v)}; `;
  }
  return out.trim();
}

/** 子穴の値を文字列にする。関数 / signal / 配列は再帰的に解決し、null / 真偽値は空にする。 */
function serializeChild(v: unknown): string {
  if (typeof v === "function") return serializeChild((v as () => unknown)());
  if (isSignal(v)) return serializeChild(v.value);
  if (v == null || typeof v === "boolean") return ""; // 子の true / false はどちらも非表示
  if (Array.isArray(v)) return v.flat(Infinity).map(serializeChild).join("");
  if (typeof Node !== "undefined" && v instanceof Node) {
    // DOM 非依存のため Node はシリアライズできない。SSR 第1弾はプリミティブな子のみが対象。
    throw new Error("emit: Node の子はサポートしていません（SSR 第1弾はプリミティブのみ）");
  }
  return escapeText(String(v));
}

/** 子穴を出力する。reactive（関数 / signal）なら開閉ペアで囲み、静的なら素のテキストにする。 */
function emitChild(raw: unknown): string {
  const reactive = typeof raw === "function" || isSignal(raw);
  const content = serializeChild(raw);
  return reactive ? HOLE_OPEN + content + HOLE_CLOSE : content;
}

/**
 * 「値ぜんぶが 1 つの穴」の属性を出力する（先頭スペース込み。省くときは空文字）。
 * イベント / ref / プロパティ（`.foo`）穴は属性を吐かない（クライアントの DOM と同形）。
 * 通常属性は setAttr と同じ意味づけ: null / false は省略、true は空文字、class / style はオブジェクトも可。
 */
function emitAttr(name: string, raw: unknown): string {
  if (resolveEvent(name, raw) || isRef(name, raw) || name.startsWith(".")) return "";
  let v = read(raw);
  if (name === "class" && isPlainObject(v)) v = classString(v);
  else if (name === "style" && isPlainObject(v)) v = styleString(v);
  if (v == null || v === false) return "";
  if (v === true) return ` ${name}=""`;
  return ` ${name}="${escapeAttr(String(v))}"`;
}

/** 部分埋め込み属性を合成して出力する（先頭スペース込み）。静的断片はそのまま、穴は読み値をエスケープ。 */
function emitAttrPart(name: string, parts: Part[], values: unknown[]): string {
  if (name.startsWith(".")) return ""; // プロパティ穴は属性へ反映しない
  let value = "";
  for (const p of parts) {
    value += "lit" in p ? p.lit : escapeAttr(String(read(values[p.hole])));
  }
  return ` ${name}="${value}"`;
}

// --- テンプレ解釈（DOM 非依存の軽量トークナイザ） -------------------------------------------

// タグ内のサブ状態。属性をバッファして「種別が判明してから」出すために要素ごとに走査する。
enum S {
  text = 0, // タグの外（子位置）
  tagName = 1, // `<` 直後、タグ名を読んでいる
  beforeAttr = 2, // 属性の前（空白 / 次の属性名 / `>` / `/` 待ち）
  attrName = 3, // 属性名を読んでいる
  afterName = 4, // 属性名の後（`=` か、次の属性 / `>` 待ち）
  beforeValue = 5, // `=` の後（引用符 / 値の開始待ち）
  valueQuoted = 6, // 引用符付きの値の中
  valueUnquoted = 7, // 引用符なしの値の中
}

/**
 * `strings` を命令列に解釈する（値に依存しないのでテンプレ単位でキャッシュ）。
 * `html.ts` の DOM パースとは独立した別経路で、自前の軽量トークナイザでタグ構造を追う。
 * タグ内では属性を 1 つずつバッファして、イベント / プロパティ等の「吐かない属性」を出力前に判定する。
 */
function parse(strings: TemplateStringsArray): Op[] {
  const hit = cache.get(strings);
  if (hit) return hit;

  const ops: Op[] = [];
  let buf = ""; // 静的出力のバッファ（lit にまとめて flush する）
  const flush = () => {
    if (buf) ops.push({ kind: "lit", text: buf });
    buf = "";
  };

  let state: S = S.text;
  let tagName = "";
  let selfClose = false;
  // 構築中の属性
  let attrName = "";
  let attrNameHole = false; // 属性名側に穴が混じった（`<div ${x}>` 等）→ その属性は捨てる
  let attrParts: Part[] = []; // 値の構成要素（lit / hole の並び）
  let quote = ""; // 引用符付き値の引用符

  const resetAttr = () => {
    attrName = "";
    attrNameHole = false;
    attrParts = [];
    quote = "";
  };

  // バッファ済みの 1 属性を命令列へ確定する（吐かない属性はここで捨てる / 静的属性は lit に畳む）。
  const commitAttr = (hasValue: boolean) => {
    if (!attrName || attrNameHole) {
      resetAttr();
      return; // 名前が無い / 名前に穴 → 捨てる
    }
    if (!hasValue) {
      buf += ` ${attrName}`; // 値なし（真偽属性）。静的なので lit に畳む。
      resetAttr();
      return;
    }
    const holes = attrParts.filter((p): p is { hole: number } => "hole" in p);
    if (holes.length === 0) {
      // 値も静的 → そのまま lit に畳む（著者が書いた文字列なのでエスケープしない）。
      const lit = attrParts.map((p) => ("lit" in p ? p.lit : "")).join("");
      buf += ` ${attrName}="${lit}"`;
    } else if (attrParts.length === 1) {
      // 値ぜんぶが 1 つの穴 → 種別は値依存なので emit 時に解決する。
      flush();
      ops.push({ kind: "attr", name: attrName, index: holes[0].hole });
    } else {
      // 部分埋め込み → emit 時に合成する。
      flush();
      ops.push({ kind: "attr-part", name: attrName, parts: attrParts });
    }
    resetAttr();
  };

  // 開いたタグを確定して出力する（`<tag ...>` の `<tag` と `>` は lit、属性は commitAttr 済み）。
  const closeTag = () => {
    buf += selfClose ? "/>" : ">";
    state = S.text;
    tagName = "";
    selfClose = false;
  };

  const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

  const holeCount = strings.length - 1;
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    let j = 0;
    while (j < s.length) {
      const c = s[j];
      if (state === S.text) {
        if (c === "<") {
          const next = s[j + 1];
          if (next === "/") {
            // 閉じタグ。`>` まで丸ごと静的にコピーする（穴は跨がない前提）。
            const end = s.indexOf(">", j);
            if (end === -1) {
              buf += s.slice(j);
              j = s.length;
            } else {
              buf += s.slice(j, end + 1);
              j = end + 1;
            }
            continue;
          }
          if (next === "!") {
            // コメント `<!-- -->` か doctype `<! >`。丸ごと静的にコピーする。
            const term = s.startsWith("<!--", j) ? "-->" : ">";
            const end = s.indexOf(term, j);
            if (end === -1) {
              buf += s.slice(j);
              j = s.length;
            } else {
              buf += s.slice(j, end + term.length);
              j = end + term.length;
            }
            continue;
          }
          // 開きタグ。タグ名の読み取りへ。
          buf += "<";
          state = S.tagName;
          tagName = "";
          selfClose = false;
          resetAttr();
          j++;
          continue;
        }
        buf += c; // 静的な本文は著者が書いた文字列なのでそのまま（エスケープは穴の値だけ）
        j++;
        continue;
      }

      // --- タグ内 ---
      if (state === S.tagName) {
        if (isSpace(c)) {
          buf += tagName;
          state = S.beforeAttr;
        } else if (c === ">") {
          buf += tagName;
          closeTag();
        } else if (c === "/") {
          buf += tagName;
          selfClose = true;
          state = S.beforeAttr;
        } else {
          tagName += c;
        }
        j++;
        continue;
      }

      if (state === S.beforeAttr) {
        if (isSpace(c)) {
          // skip
        } else if (c === ">") {
          closeTag();
        } else if (c === "/") {
          selfClose = true;
        } else {
          state = S.attrName;
          attrName = c;
        }
        j++;
        continue;
      }

      if (state === S.attrName) {
        if (isSpace(c)) {
          state = S.afterName;
        } else if (c === "=") {
          state = S.beforeValue;
        } else if (c === ">") {
          commitAttr(false);
          closeTag();
        } else if (c === "/") {
          commitAttr(false);
          selfClose = true;
          state = S.beforeAttr;
        } else {
          attrName += c;
        }
        j++;
        continue;
      }

      if (state === S.afterName) {
        if (isSpace(c)) {
          // skip
        } else if (c === "=") {
          state = S.beforeValue;
        } else if (c === ">") {
          commitAttr(false);
          closeTag();
        } else if (c === "/") {
          commitAttr(false);
          selfClose = true;
          state = S.beforeAttr;
        } else {
          // 値なし属性の直後に次の属性が始まった。
          commitAttr(false);
          state = S.attrName;
          attrName = c;
        }
        j++;
        continue;
      }

      if (state === S.beforeValue) {
        if (isSpace(c)) {
          // skip（`name= "x"` のような空白）
        } else if (c === '"' || c === "'") {
          quote = c;
          state = S.valueQuoted;
        } else if (c === ">") {
          // `name=` で値が来なかった → 空値の属性として確定。
          attrParts.push({ lit: "" });
          commitAttr(true);
          closeTag();
        } else {
          state = S.valueUnquoted;
          attrParts.push({ lit: c });
        }
        j++;
        continue;
      }

      if (state === S.valueQuoted) {
        if (c === quote) {
          commitAttr(true);
          state = S.beforeAttr;
        } else {
          appendLit(attrParts, c);
        }
        j++;
        continue;
      }

      // S.valueUnquoted
      if (isSpace(c)) {
        commitAttr(true);
        state = S.beforeAttr;
      } else if (c === ">") {
        commitAttr(true);
        closeTag();
      } else {
        appendLit(attrParts, c);
      }
      j++;
    }

    // --- 文字列の境界 = 穴 i ---
    if (i < holeCount) {
      switch (state) {
        case S.text:
          flush();
          ops.push({ kind: "child", index: i });
          break;
        case S.beforeValue:
          // `name=${x}`（引用符なし・値ぜんぶが穴）。後続の静的があれば部分埋め込みになる。
          attrParts.push({ hole: i });
          state = S.valueUnquoted;
          break;
        case S.valueQuoted:
        case S.valueUnquoted:
          attrParts.push({ hole: i });
          break;
        case S.attrName:
          attrNameHole = true; // 属性名に穴 → その属性は捨てる
          break;
        // tagName / beforeAttr / afterName での穴（動的タグ名・スプレッド等）は未対応。捨てる。
        default:
          break;
      }
    }
  }
  flush();

  cache.set(strings, ops);
  return ops;
}

/** 値の構成要素列の末尾が静的断片ならそこへ連結、そうでなければ新しい断片を足す。 */
function appendLit(parts: Part[], c: string): void {
  const last = parts[parts.length - 1];
  if (last && "lit" in last) last.lit += c;
  else parts.push({ lit: c });
}
