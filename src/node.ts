// node.ts — 穴・子の値を DOM ノードへ変換する共通処理（h.ts / html.ts で共用）
import { effect, isSignal, type Signal } from "./reactive.js";
import { isSafeHtml } from "./safe-html.js";

/**
 * reactive な入力を1つの accessor `() => T` に正規化する。
 * signal 直渡し（`span(state.user.name)`）と accessor（`span(() => ...)`）の両方を
 * 受ける穴・コンポーネント引数で、「読み口は関数」に揃えるために共用する。
 */
export function toAccessor<T>(v: Signal<T> | (() => T)): () => T {
  return isSignal(v) ? () => v.value : v;
}

/**
 * `<!--hole-->`〜`<!--/hole-->` の範囲（start / end）を、値 v に合わせて描き替える。
 * プリミティブで既存が単一テキストならそのテキストを使い回し（DOM 構造を変えない）、
 * そうでなければ範囲を空にして toNode(v) を入れ直す。新規描画（toNode）と採用（adoptChild）の
 * 「2回目以降の更新」で共通の核（create / adopt で挙動を1か所に揃える）。
 */
function updateRange(start: Comment, end: Comment, v: unknown): void {
  const cur = start.nextSibling;
  const isPrim = !(v instanceof Node) && !Array.isArray(v) && typeof v !== "function";
  if (isPrim && cur !== end && cur?.nodeType === 3 && cur.nextSibling === end) {
    (cur as Text).data = v == null || typeof v === "boolean" ? "" : String(v); // テキスト使い回し
    return;
  }
  while (start.nextSibling && start.nextSibling !== end) (start.nextSibling as ChildNode).remove();
  end.before(toNode(v));
}

/** 値を1つの Node に変換する。関数 / シグナルは reactive な範囲、配列はまとめて並べる。 */
export function toNode(child: unknown): Node {
  // 真偽値はどちらも非表示（属性側の true=空文字 とは別。子では false/true とも何も描かない）。
  if (child == null || typeof child === "boolean") return document.createTextNode("");
  // SafeHtml（emit 用の生 HTML 封筒）が DOM パスに紛れ込んだケース。素通しすると String(封筒) で
  // `"[object Object]"` というテキストになって黙って壊れるので、ここで loud に止める。
  if (isSafeHtml(child)) {
    throw new Error(
      "html/h: SafeHtml（emit 用の生 HTML 封筒）は DOM に挿入できません。" +
        "SafeHtml はサーバの emit 専用です。クライアントでは html`...` か文字列を渡してください。",
    );
  }
  if (isSignal(child)) child = toAccessor(child); // シグナル直接は関数に正規化
  if (typeof child === "function") {
    // コメント2つで範囲を作り、返り値が何であれその間を再描画する。
    // Node / 配列を返せば構造ごと入れ替わる（${() => list.value.map(...)} が書ける）。
    // 中で張られた effect は所有権ツリーが再実行時に自動 dispose する。
    const start = document.createComment("hole");
    const end = document.createComment("/hole");
    const frag = document.createDocumentFragment();
    frag.append(start, end);
    effect(() => updateRange(start, end, (child as () => unknown)()));
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
 * toNode の「adopt（採用）」版。サーバが出した既存の `<!--hole-->…<!--/hole-->` を start / end
 * として受け取り、**作り直さずに** reactive 子穴の effect を張り直す（docs の段階3）。
 * 初回の effect 実行では依存だけ購読して DOM は書かない（サーバ出力＝クライアント初期値が
 * 一致している前提なので、既存ノードをそのまま使う＝focus / 入力値 / スクロールを壊さない）。
 * 2回目以降は toNode と同じ updateRange で更新する。reactive な子（関数 / signal）専用で、
 * 静的な子はそもそもマーカーが無く配線不要なので呼ばれない。
 */
export function adoptChild(start: Comment, end: Comment, child: unknown): void {
  if (isSignal(child)) child = toAccessor(child); // signal 直渡しは関数に正規化（toNode と同じ）
  let first = true;
  effect(() => {
    const v = (child as () => unknown)();
    if (first) {
      first = false;
      return; // 初回はサーバ出力をそのまま採用（DOM は触らない）。依存購読だけ済ませる。
    }
    updateRange(start, end, v);
  });
}

/** class / style のオブジェクト形式かを見分ける（配列・null・Node は除く）。
 *  signal / 関数は呼び出し側で値に解決済みのものが届くのでここでは考慮しない。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Node);
}

/** `{ active: true, disabled: false }` → `"active"`（真のキーだけを space 結合）。 */
function classList(obj: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(obj)) if (v) out += (out ? " " : "") + k;
  return out;
}

/**
 * style オブジェクトを inline style に反映する。文字列形の `style` と同じく **style 属性を
 * 丸ごと置き換える**（object はそれを構造的に書けるだけ）ので、まず全消去してから入れ直す。
 * 結果として reactive 更新で消えたキーも inline に残らない。
 * キーに `-` を含むものは `setProperty`（`font-size` / `--custom` 両対応）、
 * 含まないものは JS プロパティ代入（`fontSize` / `WebkitTransform`）。null / false は不採用。
 */
function setStyle(el: HTMLElement, obj: Record<string, unknown>): void {
  el.style.cssText = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === false) continue;
    if (k.includes("-")) el.style.setProperty(k, String(v));
    else (el.style as unknown as Record<string, string>)[k] = String(v);
  }
}

/**
 * 属性を設定する。null / false は属性を外し、true は空文字（真偽属性）、それ以外は文字列化。
 * これは全キー共通の規則で、aria-* / data-* も例外にしない（false=削除なので付け外しできる）。
 * `aria-hidden="false"` のように "false" という文字列自体を残したいときは、真偽値ではなく
 * 文字列 "false" を渡す（文字列はそのまま属性に書かれる）。
 * 属性は文字列しか運べないので、value / checked のように DOM プロパティへ入れたい値や
 * オブジェクト・配列などリッチな値は、属性ではなく `.` 接頭辞のプロパティ穴（setProp）を使う。
 *
 * 例外として `style` / `class` はオブジェクトでも渡せる（`style: { color: "red" }` /
 * `class: { active: isOn }`）。どちらも文字列形と同じく **属性を丸ごと置き換える**（object は
 * それを構造的に書けるだけ）。この分岐は「丸ごと1穴」の位置でだけ効く（`html` の部分埋め込み
 * `class="box ${obj}"` は文字列化されるので対象外）。
 */
export function setAttr(el: Element, key: string, v: unknown): void {
  if (key === "style" && isPlainObject(v)) {
    setStyle(el as HTMLElement, v);
    return;
  }
  if (key === "class" && isPlainObject(v)) v = classList(v); // 文字列化して下の属性パスへ
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
 * イベントハンドラ穴かを判定する。`onClick`（値が関数）→ `"click"` のように
 * addEventListener へ渡すイベント型名を返す。`on` 始まりで値が関数のときだけイベント扱いにし、
 * そうでなければ null を返す（呼び出し側は属性 / プロパティ処理にフォールバックする）。
 * 型名は小文字化する。html は HTML パーサが属性名を小文字化するので元から小文字相当だが、
 * h / tags のキー（`onClick`）と同じ規則に揃えるためここで一括して小文字にする。
 * h.ts / html.ts のどちらからも同じ仕様で使う。
 */
export function resolveEvent(name: string, v: unknown): string | null {
  if (!name.startsWith("on") || typeof v !== "function") return null;
  return name.slice(2).toLowerCase(); // onClick → click
}

/** ref 穴の予約キー。要素生成後にその要素を1度だけ渡す callback の口。 */
export const REF_KEY = "ref";

/**
 * ref 穴かを判定する。予約キー `ref` で値が関数のときだけ ref 扱いにし、要素が完成した後に
 * `fn(el)` を1度だけ呼ぶ（reactive ではない）。値が関数でなければ false を返し、呼び出し側は
 * 従来どおり属性 / プロパティ処理にフォールバックする（`ref` という名の属性も書けるまま）。
 * 後始末は callback 内で `onCleanup` を使えば効く（h / html 実行時の所有者がそのまま生きる）。
 * h.ts / html.ts のどちらからも同じ仕様で使う。
 */
export function isRef(name: string, v: unknown): v is (el: Element) => void {
  return name === REF_KEY && typeof v === "function";
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

/**
 * 単一の値を1つの prop / 属性として要素へ配線する。h の props と html の「値ぜんぶが1つの穴」の
 * 属性で共用し、「onXxx → イベント / `.foo` → プロパティ / それ以外 → 属性」の規則を1か所に揃える。
 * 関数 / シグナル直渡しは accessor に正規化して effect で reactive にし、それ以外は一度だけ設定する。
 * （html の `class="box ${x}"` のような部分埋め込みは値を文字列合成する別処理なので対象外。）
 */
export function bindProp(el: Element, name: string, v: unknown): void {
  const event = resolveEvent(name, v);
  if (event) {
    el.addEventListener(event, v as EventListener); // onClick → click
    return;
  }
  // キー名に `.` を付けると DOM プロパティ代入、それ以外は属性（resolveSetter が振り分ける）。
  const { key, set } = resolveSetter(name);
  if (typeof v === "function" || isSignal(v)) {
    const acc = toAccessor(v as Signal<unknown> | (() => unknown)); // 関数穴も signal 直渡しも揃える
    effect(() => set(el, key, acc()));
  } else {
    set(el, key, v); // 静的（null/false/真偽の意味は setAttr が保つ）
  }
}
