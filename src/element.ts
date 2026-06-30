// element.ts — reactive.ts を Custom Element の中身づくりに繋ぐ薄いアダプタ。
//   defineElement("x-counter", () => {
//     const count = signal(0);
//     return html`<button onClick=${() => count.value++}>${count}</button>`;
//   });
//   document.body.append(document.createElement("x-counter"));
//
// 何を橋渡しするか:
//   - ライフサイクル: connected で createRoot を張って setup を走らせ、返ってきた DOM を
//     マウントする。マウント先は既定では host 直下（light DOM）だが、
//     `{ shadow: "open" | "closed" }` を渡すと attachShadow した shadowRoot にマウントする
//     （スタイル隔離が要るコンポーネント向け）。本当に切り離されたら root を dispose
//     （中の effect / onCleanup を全部畳む）。
//     → html / h / For / Show が張る effect が「孤児」になってリークするのを防ぐ。
//     shadow は「マウント先 + スタイル隔離」だけを変える。setup の書き方・slot・prop・再接続の
//     挙動は light DOM とまったく同じ（Lit が renderRoot を差し替えるだけなのと同じ考え方）。
//   - 入力 → signal: ctx.prop(name) が「プロパティ代入」と「属性の変更」を1つの signal に
//     合流させる。host に accessor を張って el.foo = v を捕まえ（リッチな値もそのまま通る）、
//     属性の変更は MutationObserver で観測して文字列のまま流し込む。
//     外から <x-el foo="..."> を書き換えても el.foo = v しても、同じ signal 経由で再描画が走る。
//
// 再接続の扱い:
//   - disconnected で即 dispose せず queueMicrotask まで待ち、その時点でまだ
//     isConnected=false なら本当に切り離されたと判断して dispose する。
//     DOM 内での「移動」は disconnect→connect が連続して起きるだけなので、状態は保たれる。
//     本当に切り離してから別の場所へ再接続した場合は setup を作り直す（状態はリセット）。
//   - dispose 時には、接続時に退避した元の light DOM の子（利用者が書いた slot 入力）を
//     host へ戻す。setup の出力や接続後に動的追加した子は破棄するが、利用者の入力は復元するので、
//     再接続は初回接続と同じ意味になる（slot の中身が再接続で永久に消えない）。
import { createRoot, onCleanup, type Signal, signal } from "./reactive.js";

/** defineElement のオプション。 */
export interface DefineOptions {
  /** customElements.define に渡す追加オプション（`is` ビルトイン拡張など）。 */
  elementOptions?: ElementDefinitionOptions;
  /**
   * 指定すると attachShadow して shadowRoot にマウントする（スタイル隔離が要るとき）。
   * - 省略時は host 直下（light DOM）にマウントする（従来どおり）。
   * - `"open"` … `el.shadowRoot` で外から参照できる shadow root。
   * - `"closed"` … 外から参照できない shadow root。
   * 変わるのは「マウント先 + スタイル隔離」だけ。setup の書き方・`ctx.slot()` による子の投影・
   * `prop`・再接続の挙動は light DOM とまったく同じ（shadow でもネイティブ `<slot>` ではなく
   * `${slot(...)}` で投影する）。
   */
  shadow?: ShadowRootMode;
}

/** setup に渡る文脈。操作対象の host と、外部からの入力を signal として読むヘルパーを持つ。 */
export interface SetupContext {
  /** 登録した Custom Element 自身（この要素）。イベント発火やプロパティ操作の入り口。 */
  host: HTMLElement;
  /**
   * 外部からの入力 name を映す signal を返す（同じ name には同じ signal を返す）。
   * - host にプロパティ accessor を張るので、`el.foo = v` の代入が signal に入る（リッチな値 OK）。
   * - 属性 `foo="..."` の変更も MutationObserver で観測して signal に入る（値は文字列のまま）。
   * - 初期値の優先順: upgrade 前に代入されていたプロパティ > 静的 HTML の属性 > initial。
   * プロパティ・属性のどちらで書かれても、読み出しは常にこの signal（または `host.foo`）から。
   */
  prop<T = unknown>(name: string, initial?: T): Signal<T>;
  /**
   * 接続時に利用者が host 直下へ書いていた light DOM の子を取り出す（静的投影）。
   * - `slot()` … `slot` 属性のない子（デフォルトスロット）。
   * - `slot("title")` … `slot="title"` を付けた子。
   * 戻り値（DocumentFragment）を setup の出力の好きな位置に置けば、そこへ子が差し込まれる。
   * 接続時の light DOM の子は一旦 host から外され、slot() が拾ったものだけが描画される。
   * 取り出した子はそのノードごと移動する（複製ではない）。どの slot でも拾わなかった子は描画されない。
   * shadow DOM（`{ shadow }` 指定時）でも同じ。投影先が shadowRoot 内になるだけで使い方は変わらない。
   */
  slot(name?: string): DocumentFragment;
}

/** Custom Element の中身を組む関数。createRoot 内で1回呼ばれ、返した Node がマウントされる。 */
export type Setup = (ctx: SetupContext) => Node | null | undefined | void;

// host に紐づく文脈（host + ヘルパー）と、退避した元の light DOM の子を作る。
// MutationObserver は最初に prop() が呼ばれたとき1つだけ張り、onCleanup で dispose 時に外す。
// lightChildren は dispose 時に host へ戻すため呼び出し側へ返す（再接続を初回接続と同じにする）。
// shadow / light の違いはここには現れない（マウント先が変わるだけで投影モデルは共通）。
function makeContext(host: HTMLElement): {
  ctx: SetupContext;
  lightChildren: ChildNode[];
} {
  const signals = new Map<string, Signal<unknown>>();
  let observer: MutationObserver | null = null;
  // 接続時点の light DOM の子を host から外して退避する（slot 入力）。
  // slot() が拾ったものだけが setup の出力経由で描画され、拾われなかったものは表示されない。
  // 退避した子は dispose 時に host へ戻され、再接続時に改めて投影される。
  const lightChildren = [...host.childNodes];
  host.replaceChildren();

  const ctx: SetupContext = {
    host,
    slot(name?: string): DocumentFragment {
      const frag = document.createDocumentFragment();
      for (const n of lightChildren) {
        // Element だけが slot 属性を持てる。テキスト/コメントは常にデフォルトスロット行き。
        const slotName = (n as Partial<Element>).getAttribute?.("slot") ?? null;
        const match = name != null ? slotName === name : slotName == null;
        if (match) frag.append(n); // 退避済みの子を frag へ移す
      }
      return frag;
    },
    prop<T = unknown>(name: string, initial?: T): Signal<T> {
      let sig = signals.get(name);
      if (sig) return sig as Signal<T>; // 同じ name には同じ signal を返す

      // 初期値の優先順: upgrade 前に代入されていたプロパティ > 静的 HTML の属性 > initial。
      let init: unknown = initial;
      if (host.hasAttribute(name)) init = host.getAttribute(name);
      const own = Object.getOwnPropertyDescriptor(host, name);
      if (own && "value" in own) {
        // upgrade（accessor 設置）前の el.foo = v はただの data property として host に乗っている。
        // 拾って初期値に昇格し、accessor を張れるよう削除する（Lit の instance property 退避と同じ）。
        init = own.value;
        delete (host as unknown as Record<string, unknown>)[name];
      }
      sig = signal(init);
      signals.set(name, sig);

      // el.foo の読み書きを signal に直結する。setter は signal に入れるだけで、
      // 属性へは書き戻さない（out 反映が要るなら利用者が effect + toggleAttribute 等で書く）。
      const s = sig;
      Object.defineProperty(host, name, {
        configurable: true,
        enumerable: true,
        get: () => s.value,
        set: (v: unknown) => {
          s.value = v;
        },
      });
      // dispose 時（disconnected）に accessor を外す。再接続時は setup ごと作り直す。
      onCleanup(() => delete (host as unknown as Record<string, unknown>)[name]);

      if (!observer) {
        // 初回だけ観測を開始。prop された name に対応する属性変更を文字列のまま signal へ流す。
        observer = new MutationObserver((records) => {
          for (const r of records) {
            const key = r.attributeName;
            const target = key && signals.get(key);
            if (target) target.value = host.getAttribute(key); // 値が同じなら signal 側が無視する
          }
        });
        observer.observe(host, { attributes: true });
        onCleanup(() => observer!.disconnect()); // dispose 時（disconnected）に観測を止める
      }
      return sig as Signal<T>;
    },
  };

  return { ctx, lightChildren };
}

/**
 * setup の中身を持つ Custom Element を登録する。
 * 描画先は既定では host 直下（light DOM）。`{ shadow: "open" | "closed" }` で shadowRoot にできる。
 * @param name   タグ名（ハイフン必須。例: "x-counter"）
 * @param setup  中身を組む関数。createRoot 内で呼ばれ、返した Node がマウントされる。
 * @param options customElements.define に渡す追加設定 / shadow DOM の指定。
 * @returns 登録した要素のコンストラクタ。
 */
export function defineElement(
  name: string,
  setup: Setup,
  options: DefineOptions = {},
): CustomElementConstructor {
  const shadowMode = options.shadow;

  class ReactiveElement extends HTMLElement {
    #dispose: (() => void) | null = null;
    // 接続時に退避した元の light DOM の子。dispose 時に host へ戻すため保持する。
    #lightChildren: ChildNode[] | null = null;
    // shadow 指定時のマウント先。attachShadow は1要素1回だけなので保持して再接続でも使い回す。
    #shadow: ShadowRoot | null = null;

    connectedCallback(): void {
      if (this.#dispose) return; // 既にマウント済み（移動による再接続もここで弾く）
      createRoot((dispose) => {
        this.#dispose = dispose;
        // shadow 指定時は shadowRoot を、未指定なら host 自身をマウント先にする。マウント先が
        // 変わるだけで、退避→投影（slot）も prop も以降の流れは light/shadow で完全に同じ。
        // attachShadow は1要素につき1回だけ許されるので、再接続では既存の shadowRoot を使う。
        let mount: HTMLElement | ShadowRoot = this;
        if (shadowMode) {
          if (!this.#shadow) this.#shadow = this.attachShadow({ mode: shadowMode });
          mount = this.#shadow;
        }
        const { ctx, lightChildren } = makeContext(this);
        this.#lightChildren = lightChildren;
        const node = setup(ctx);
        if (node != null) mount.append(node);
      });
    }

    disconnectedCallback(): void {
      // 即 dispose せず次のマイクロタスクまで待つ。DOM 内の「移動」は disconnect→connect が
      // 連続するだけなので、その時点でまだ未接続なら本当に切り離されたと判断して畳む。
      queueMicrotask(() => {
        if (this.isConnected) return; // 移動だった → 何もしない（状態を保つ）
        this.#dispose?.(); // root を畳む（effect / MutationObserver / onCleanup を全解放）
        this.#dispose = null;
        // shadow 指定時は描画出力が shadowRoot にあるので畳む（light DOM では host 直下にある）。
        this.#shadow?.replaceChildren();
        // 退避した元の子（利用者が書いた slot 入力）を host へ戻す。setup の出力や接続後に動的追加
        // した子は捨てるが、利用者の入力は復元するので再接続が初回接続と同じになる。host は接続時に
        // 空にしてあるので、light/shadow どちらでもこの一手で元の light DOM へ戻る。
        const saved = this.#lightChildren ?? [];
        this.#lightChildren = null;
        this.replaceChildren(...saved);
      });
    }
  }

  customElements.define(name, ReactiveElement, options.elementOptions);
  return ReactiveElement;
}
