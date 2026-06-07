// element.ts — reactive.ts を Custom Element の中身づくりに繋ぐ薄いアダプタ。
//   defineElement("x-counter", (host) => {
//     const count = signal(0);
//     return div(span(() => count.value), button({ onClick: () => count.value++ }, "+1"));
//   });
//   document.body.append(document.createElement("x-counter"));
//
// 何を橋渡しするか:
//   - ライフサイクル: connected で createRoot を張って setup を走らせ、返ってきた DOM を
//     マウントする。disconnected でその root を dispose（中の effect / onCleanup を全部畳む）。
//     → h / For / Show が張る effect が「孤児」になってリークするのを防ぐ。
//   - 属性 → signal: ctx.attr(name) が属性値を映す signal を返す（内部は MutationObserver）。
//     外から <x-el foo="..."> を書き換えると signal 経由で再描画が走る。
//   - 描画先: options.shadow で Shadow DOM / light DOM を選ぶ（既定は light DOM）。
//
// 割り切り（最小実装ゆえ）:
//   - 再接続(disconnect→connect)では setup を作り直す。＝ローカル状態はリセットされる。
//     DOM 内で要素を「移動」させると一度 disconnect されるので状態が初期化される点に注意。
//     状態を跨いで保持したいものは host の外（モジュールスコープや親）に持つ。
import { createRoot, signal, onCleanup, type Signal } from "./reactive.js";

/** defineElement のオプション。 */
export interface DefineOptions {
  /** true で open な Shadow DOM に描画。ShadowRootInit を渡せば mode 等を細かく指定できる。既定は light DOM。 */
  shadow?: boolean | ShadowRootInit;
  /** customElements.define に渡す追加オプション（`is` ビルトイン拡張など）。 */
  elementOptions?: ElementDefinitionOptions;
}

/** setup に渡る文脈。操作対象の host と、属性を signal として読むヘルパーを持つ。 */
export interface SetupContext {
  /** 登録した Custom Element 自身（この要素）。イベント発火やプロパティ操作の入り口。 */
  host: HTMLElement;
  /** 属性 name を映す signal を返す（同じ name には同じ signal を返す）。属性が変わると .value も変わる。 */
  attr(name: string): Signal<string | null>;
}

/** Custom Element の中身を組む関数。createRoot 内で1回呼ばれ、返した Node がマウントされる。 */
export type Setup = (
  ctx: SetupContext,
) => Node | null | undefined | void;

// host に紐づく文脈（host + ヘルパー）を作る。
// MutationObserver は最初に attr() が呼ばれたとき1つだけ張り、onCleanup で dispose 時に外す。
function makeContext(host: HTMLElement): SetupContext {
  const signals = new Map<string, Signal<string | null>>();
  let observer: MutationObserver | null = null;

  return {
    host,
    attr(name: string): Signal<string | null> {
      let sig = signals.get(name);
      if (sig) return sig;                       // 同じ属性名には同じ signal を返す
      sig = signal(host.getAttribute(name));
      signals.set(name, sig);

      if (!observer) {                           // 初回だけ観測を開始
        observer = new MutationObserver((records) => {
          for (const r of records) {
            const key = r.attributeName;
            const target = key && signals.get(key);
            if (target) target.value = host.getAttribute(key); // 値が同じなら signal 側が無視する
          }
        });
        observer.observe(host, { attributes: true });
        onCleanup(() => observer!.disconnect());  // dispose 時（disconnected）に観測を止める
      }
      return sig;
    },
  };
}

/**
 * setup の中身を持つ Custom Element を登録する。
 * @param name   タグ名（ハイフン必須。例: "x-counter"）
 * @param setup  中身を組む関数。createRoot 内で1回呼ばれ、返した Node がマウントされる。
 * @param options 描画先（shadow / light）などの設定。
 * @returns 登録した要素のコンストラクタ。
 */
export function defineElement(
  name: string,
  setup: Setup,
  options: DefineOptions = {},
): CustomElementConstructor {
  const shadowInit: ShadowRootInit | null =
    options.shadow === true ? { mode: "open" }
    : options.shadow ? options.shadow
    : null;

  class ReactiveElement extends HTMLElement {
    #dispose: (() => void) | null = null;

    connectedCallback(): void {
      if (this.#dispose) return;            // 既にマウント済み（多重 connect 保護）

      // 描画先を決める: shadow なら（無ければ）attachShadow、なければ host 直下。
      const target: ParentNode =
        shadowInit ? (this.shadowRoot ?? this.attachShadow(shadowInit)) : this;

      createRoot((dispose) => {
        this.#dispose = dispose;
        const node = setup(makeContext(this));
        if (node != null) target.append(node);
      });
    }

    disconnectedCallback(): void {
      this.#dispose?.();                    // root を畳む（effect / MutationObserver / onCleanup を全解放）
      this.#dispose = null;
      // 描画した中身を片付ける（再接続時はまっさらから setup し直す）
      const target: ParentNode = this.shadowRoot ?? this;
      target.replaceChildren();
    }
  }

  customElements.define(name, ReactiveElement, options.elementOptions);
  return ReactiveElement;
}
