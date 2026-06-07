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
//   - 属性 → signal: ctx.attr(name) が属性値を映す signal を返す（内部は MutationObserver）。
//     外から <x-el foo="..."> を書き換えると signal 経由で再描画が走る。
//
// 再接続の扱い:
//   - disconnected で即 dispose せず queueMicrotask まで待ち、その時点でまだ
//     isConnected=false なら本当に切り離されたと判断して dispose する。
//     DOM 内での「移動」は disconnect→connect が連続して起きるだけなので、状態は保たれる。
//     本当に切り離してから別の場所へ再接続した場合は setup を作り直す（状態はリセット）。
import { createRoot, signal, onCleanup, type Signal } from "./reactive.js";

/** defineElement のオプション。 */
export interface DefineOptions {
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
      if (this.#dispose) return;            // 既にマウント済み（移動による再接続もここで弾く）
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
        if (this.isConnected) return;       // 移動だった → 何もしない（状態を保つ）
        this.#dispose?.();                  // root を畳む（effect / MutationObserver / onCleanup を全解放）
        this.#dispose = null;
        this.replaceChildren();             // 描画した中身を片付ける（再接続時は setup し直す）
      });
    }
  }

  customElements.define(name, ReactiveElement, options.elementOptions);
  return ReactiveElement;
}
