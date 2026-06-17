// emitted-html.ts — 「emit が組み立て済みの HTML 文字列」を表す封筒。
//
// emit / サーバ用 `For` / `Show` が組み立てた HTML を、別の emit の子穴へ入れたときに
// **二重エスケープしない**ための実行時タグ。通常の文字列の子はデータ扱いでエスケープされるが、
// `EmittedHtml` に包まれた文字列は既に emit が組み立て済み（信頼境界の内側）なのでそのまま流す。
//
// セキュリティの SafeHtml ではない:
//   これは「型で XSS を防ぐ仕組み（escape が安全値を鋳造し、生 HTML シンクが安全値しか受けない）」
//   ではなく、「emit が既に作った HTML を再エスケープしない」という**合成の正しさ**のための内部
//   マーカー。本格的な型 XSS 防止を入れる検討は TODO.md #57 を参照（その場合 EmittedHtml は
//   SafeHtml に吸収されて消える見込み）。
//
// なぜ独立モジュールか:
//   `emit.ts`（サーバ・DOM 非依存）と `node.ts`（DOM 構築）の両方がこの型を必要とする。
//   `emit.ts` は `node.ts` を import しているので、もし `EmittedHtml` を `emit.ts` に置くと
//   `node.ts → emit.ts` を足したとき循環参照になる。依存ゼロのリーフに切り出して両者から参照する。
//
// なぜ class か:
//   (1) `instanceof` で実行時に確実に判別でき、(2) private フィールドにより型レベルでも nominal に
//   なる（プレーンな `{ html }` を `EmittedHtml` として代入できない）。「組み立て済みか否か」は
//   文字列だけでは実行時に見分けられないので、このタグが原理的に要る。

/** emit が組み立て済みの HTML 文字列を包む封筒（子穴へ入れても再エスケープされない）。 */
export class EmittedHtml {
  constructor(private readonly value: string) {}
  /** 包んでいる生 HTML 文字列を取り出す。 */
  get html(): string {
    return this.value;
  }
}

/** 値が `EmittedHtml`（再エスケープ不要の組み立て済み HTML）かを判定する。 */
export function isEmittedHtml(v: unknown): v is EmittedHtml {
  return v instanceof EmittedHtml;
}
