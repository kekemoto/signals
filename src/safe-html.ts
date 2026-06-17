// safe-html.ts — 「安全な（エスケープ済み・組み立て済みの）HTML 文字列」を表す封筒。
//
// emit / サーバ用 `For` / `Show` が組み立てた HTML を、別の emit の子穴へ入れたときに
// **二重エスケープしない**ための実行時タグ。通常の文字列の子はデータ扱いでエスケープされるが、
// `SafeHtml` に包まれた文字列は既に HTML として組み立て済み（信頼境界の内側）なのでそのまま流す。
//
// なぜ独立モジュールか:
//   `emit.ts`（サーバ・DOM 非依存）と `node.ts`（DOM 構築）の両方がこの型を必要とする。
//   `emit.ts` は `node.ts` を import しているので、もし `SafeHtml` を `emit.ts` に置くと
//   `node.ts → emit.ts` を足したとき循環参照になる。依存ゼロのリーフに切り出して両者から参照する。
//
// なぜ class か:
//   (1) `instanceof` で実行時に確実に判別でき、(2) private フィールドにより型レベルでも nominal に
//   なる（プレーンな `{ html }` を `SafeHtml` として代入できない）。「エスケープ済みか否か」は
//   文字列だけでは実行時に見分けられないので、このタグが原理的に要る。

/** エスケープ済み・組み立て済みの HTML 文字列を包む封筒（子穴へ入れても再エスケープされない）。 */
export class SafeHtml {
  constructor(private readonly value: string) {}
  /** 包んでいる生 HTML 文字列を取り出す。 */
  get html(): string {
    return this.value;
  }
}

/** 値が `SafeHtml`（エスケープ不要の組み立て済み HTML）かを判定する。 */
export function isSafeHtml(v: unknown): v is SafeHtml {
  return v instanceof SafeHtml;
}
