// emitted-html.ts — 「emit が組み立て済みの HTML 文字列」を表す封筒。
//
// emit / サーバ用 `For` / `Show` が組み立てた HTML を、別の emit の子穴へ入れたときに
// **二重エスケープしない**ための実行時タグ。通常の文字列の子はデータ扱いでエスケープされるが、
// `EmittedHtml` に包まれた文字列は既に emit が組み立て済み（信頼境界の内側）なのでそのまま流す。
//
// セキュリティの SafeHtml ではない:
//   これは「型で XSS を防ぐ仕組み（escape が安全値を鋳造し、生 HTML シンクが安全値しか受けない）」
//   ではなく、「emit が既に作った HTML を再エスケープしない」という**合成の正しさ**のための内部
//   マーカー。本格的な型 XSS 防止を入れる検討は TODO.md #58 を参照（その場合 EmittedHtml は
//   SafeHtml に吸収されて消える見込み）。
//
// なぜ独立モジュールか:
//   `emit.ts`（サーバ・DOM 非依存）と `node.ts`（DOM 構築）の両方がこの型を必要とする。
//   `emit.ts` は `node.ts` を import しているので、もし `EmittedHtml` を `emit.ts` に置くと
//   `node.ts → emit.ts` を足したとき循環参照になる。依存ゼロのリーフに切り出して両者から参照する。
//
// なぜ class か:
//   `instanceof` で実行時に確実に判別するため。「組み立て済みか否か」は文字列だけでは実行時に
//   見分けられないので、このタグが原理的に要る。素のオブジェクト + Symbol ブランドでも書けるが、
//   class + `instanceof` の方が部品が少なく素直（Symbol 宣言・ファクトリ・冗長なガードが不要）。
//   型レベルの nominal 性（`{ html }` を弾く）は、本型を引数に取る公開 API が無く構築・判定とも
//   内部限定なので不要。将来 TODO.md #58 の型 XSS 防止をやるなら、その SafeHtml に吸収される。

/** emit が組み立て済みの HTML 文字列を包む封筒（子穴へ入れても再エスケープされない）。 */
export class EmittedHtml {
  constructor(readonly html: string) {}
}

/** 値が `EmittedHtml`（再エスケープ不要の組み立て済み HTML）かを判定する。 */
export function isEmittedHtml(v: unknown): v is EmittedHtml {
  return v instanceof EmittedHtml;
}

/**
 * 範囲マーカー名。サーバ文字列出力の `<!--name-->…<!--/name-->`・`document.createComment(name)`・
 * `claimRange(name)` の3者が**同じ名前**を使うよう一元化する（片方だけ書き換えてドリフトすると
 * claimRange が範囲を拾えずハイドレーションが黙って再構築に落ちるのを防ぐ）。
 */
export const RANGE = { hole: "hole", for: "for", show: "show" } as const;

/** 範囲の開きコメント文字列 `<!--name-->`（サーバ文字列出力用）。 */
export const rangeOpen = (name: string): string => `<!--${name}-->`;
/** 範囲の閉じコメント文字列 `<!--/name-->`（サーバ文字列出力用）。 */
export const rangeClose = (name: string): string => `<!--/${name}-->`;

/**
 * `inner`（組み立て済みの HTML 文字列）を `<!--name-->…<!--/name-->` で囲んだ生 HTML 封筒を返す。
 * `For` / `Show` のサーバ出力が使う。adopt 側の `claimRange(name)` が拾うのと同形。型は CSR と同じ
 * `DocumentFragment` を名乗る（サーバ経路は実装詳細で、この封筒→DocumentFragment のキャストはここ一箇所）。
 */
export const emitRange = (name: string, inner: string): DocumentFragment =>
  new EmittedHtml(rangeOpen(name) + inner + rangeClose(name)) as unknown as DocumentFragment;
