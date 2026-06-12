// element.ts — reactive.ts を Custom Element の中身づくりに繋ぐ薄いアダプタ。
//   defineElement("x-counter", () => {
//     const count = signal(0);
//     return html`<button onClick=${() => count.value++}>${count}</button>`;
//   });
//   document.body.append(document.createElement("x-counter"));
//
// 何を橋渡しするか:
//   - ライフサイクル: connected で createRoot を張って setup を走らせ、返ってきた DOM を
//     host 直下（light DOM）にマウントする。本当に切り離されたら root を dispose
//     （中の effect / onCleanup を全部畳む）。
//     → html / h / For / Show が張る effect が「孤児」になってリークするのを防ぐ。
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
import { createRoot, onCleanup, type Signal, signal } from "./reactive.js";

/** defineElement のオプション。 */
export interface DefineOptions {
  /** customElements.define に渡す追加オプション（`is` ビルトイン拡張など）。 */
  elementOptions?: ElementDefinitionOptions;
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
   */
  slot(name?: string): DocumentFragment;
}

/** Custom Element の中身を組む関数。createRoot 内で1回呼ばれ、返した Node がマウントされる。 */
export type Setup = (ctx: SetupContext) => Node | null | undefined | void;

// host に紐づく文脈（host + ヘルパー）を作る。
// MutationObserver は最初に prop() が呼ばれたとき1つだけ張り、onCleanup で dispose 時に外す。
function makeContext(host: HTMLElement): SetupContext {
  const signals = new Map<string, Signal<unknown>>();
  let observer: MutationObserver | null = null;
  // 接続時点の light DOM の子を host から外して退避する（slot 入力）。
  // slot() が拾ったものだけが setup の出力経由で描画され、拾われなかったものは戻されない＝描画されない。
  const lightChildren = [...host.childNodes];
  host.replaceChildren();

  return {
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
}

/**
 * setup の中身を持つ Custom Element を登録する。描画先は host 直下（light DOM）。
 * @param name   タグ名（ハイフン必須。例: "x-counter"）
 * @param setup  中身を組む関数。createRoot 内で呼ばれ、返した Node がマウントされる。
 * @param options customElements.define に渡す追加設定。
 * @returns 登録した要素のコンストラクタ。
 */
export function defineElement(
  name: string,
  setup: Setup,
  options: DefineOptions = {},
): CustomElementConstructor {
  class ReactiveElement extends HTMLElement {
    #dispose: (() => void) | null = null;

    connectedCallback(): void {
      if (this.#dispose) return; // 既にマウント済み（移動による再接続もここで弾く）
      createRoot((dispose) => {
        this.#dispose = dispose;
        const node = setup(makeContext(this));
        if (node != null) this.append(node);
      });
    }

    disconnectedCallback(): void {
      // 即 dispose せず次のマイクロタスクまで待つ。DOM 内の「移動」は disconnect→connect が
      // 連続するだけなので、その時点でまだ未接続なら本当に切り離されたと判断して畳む。
      queueMicrotask(() => {
        if (this.isConnected) return; // 移動だった → 何もしない（状態を保つ）
        this.#dispose?.(); // root を畳む（effect / MutationObserver / onCleanup を全解放）
        this.#dispose = null;
        this.replaceChildren(); // 中身を空にする（通常タグ同様、サブツリーごと破棄）。再接続時は setup し直す
      });
    }
  }

  customElements.define(name, ReactiveElement, options.elementOptions);
  return ReactiveElement;
}
