# 作りこめていない箇所と改善案

このライブラリで現状「未実装・簡易実装・意図的な割り切り」になっている箇所の一覧。
各項目に、対応するならどう作るかの案を添える。
（調査時点: 2026-06-12 / `main` 相当のソースに基づく）

凡例:

- **[割り切り]** — ソースコメントや README で明示的に「対象外」と宣言しているもの
- **[未実装]** — 単に手が回っていない・簡易実装のままのもの
- **[バグ寄り]** — 仕様として意図していない挙動（リーク・誤動作）になっているもの
- **[改善]** — 動作は正しいが、仕様・実装がより素直に書けるもの
- **[検討]** — やるか否か自体を決める段階のもの（実装方針ではなく方針決定がゴール）

---

## 優先度の目安

| 優先 | 項目 | 理由 |
|---|---|---|
| 中 | #61 npm audit / 依存脆弱性 | dev 依存のみで配布物に影響は無いが既知の high。`npm audit fix` で低コストに解消でき、CI ゲートも無い |
| 中 | #59 prop() の型と属性=文字列 | 型 `Signal<T>` が実挙動（属性経路は文字列・削除で null）とズレる。利用者が踏みやすい |
| 低 | #57 raw text | レンダリングの機能ギャップ（割り切り）。必要になったときに |
| 低 | #58 reactive イベント | 体験改善。#13（イベントオプション）とは別軸 |
| 低 | #60 render 例外時の rooted リーク | エラー経路限定のエッジ。onError を売りにしている分、整合は取りたい |
| 低 | #62 パッケージング検証 | `exports` が6サブパス。publint / attw で型・サブパス解決を CI で固めたい |
| 低 | #13 イベントオプション | 体験改善。手が空いたとき |
| 低 | #26 インフラ整備 | 機能とは独立にいつでも |
| 最低 | #28 examples / デモページ | あると親切だが必須ではない。やる意味が薄く当面やらない |
| 最低 | #63〜#65 スコープ明文化 | 実装ではなく README に「対象外」を書くだけで足りるかの判断 |

---

## node.ts / html.ts

### 13. イベントオプション（capture / once / passive）を渡せない [検討]

`onClick` 形式は `addEventListener(type, fn)` 固定。

**対応案**: 値を `[fn, options]` のタプルでも受け付ける、または `onClickCapture` の
サフィックス対応。必要になってからで十分。

### 58. イベントハンドラを reactive に差し替えられない [未実装]

`resolveEvent` / `bindProp`（`src/node.ts`）は `onClick=${fn}` を「値が関数のとき」だけ
イベント扱いし、`addEventListener(type, fn)` で **一度だけ** 束ねる。signal / accessor を
渡してもハンドラは reactive にならず、後から差し替えられない（属性・プロパティ穴が
accessor を effect で張り直すのと非対称）。#13 がオプション（capture/once/passive）の話なのに
対し、こちらはハンドラ本体の差し替えの話。

**対応案**: 値が関数の代わりに「関数を返す accessor / signal」のときは、effect で
`addEventListener` / `removeEventListener` を張り替える。常時こうすると関数1個渡しの
ホットパスに effect が乗るので、`isReactiveInput` で reactive のときだけ effect 経路にする。
実用では固定ハンドラがほとんどなので優先度は低い。

---

## html.ts

### 57. raw text 要素（`<script>` / `<textarea>`）の中身を解釈しない [割り切り]

テンプレ走査（`parse` の inTag 追跡）はタグ・引用符・`<!-- -->` コメントは追うが、
`<script>` / `<textarea>` などの raw text 要素の中身を特別扱いしない。中の `<` を文字として
扱う等の HTML パーサ本来の挙動を再現しないため、これらの要素の中に穴（`${...}`）を置く使い方は
想定しない。`src/html.ts` の `parse` ドキュメントコメントに非対応として明記済み。

**対応案**: 実用上はほぼ不要なので非対応のままでよい。どうしても必要になったら、走査に
「`<script>` / `<textarea>` の開始タグを見たら対応する終了タグまで raw text モードで読み飛ばす」
状態を1つ足す（コメントモードと同じ立て付け）。コストに見合うかは要検討。

---

## element.ts

### 59. prop() の型 `Signal<T>` が属性経路と一致しない [バグ寄り]

`ctx.prop<T>(name, initial)` は `Signal<T>` を返すが、実際に入る値は経路で型が違う:

- プロパティ代入（`el.foo = 123`）… 素の値がそのまま入る（`T`）。
- 属性（`foo="..."` / `setAttribute`）… `getAttribute` の結果なので **常に文字列**（`src/element.ts:106,137`）。
- 属性の **削除** … MutationObserver が `getAttribute` の `null` を流す（`string | null`）。

つまり実体は `T | string | null` になりうるのに型は `Signal<T>` を名乗る。利用者が
`prop<number>("count")` として数値前提で計算すると、属性で書かれた瞬間に文字列が入って
静かにズレる。

**対応案**（いずれか）:

- **型で正直に出す**: 戻り値を `Signal<T | string | null>` 寄りにし、利用者に
  「属性は文字列」を型で意識させる。冗長になる代償あり。
- **coerce を受ける**: `prop<T>(name, initial, parse?: (raw: string) => T)` のように
  属性文字列→T の変換関数を任意で受け、属性経路を `parse` 通しで `T` に揃える。
- **最小対応**: 実装は据え置き、README と doc コメントに「属性経由の値は文字列・削除で null」
  を明記して期待値を合わせる。

---

## reactive.ts

### 60. render が例外を投げると rooted の root がリークしうる [バグ寄り]

`rooted`（`src/reactive.ts:368`）は `createRoot` のコールバック内で `fn()` を呼び、
`{ value, dispose }` を返す。`fn`（= `For` / `Show` の `render`、`src/for.ts:55` /
`src/show.ts:65`）が throw すると、dispose を呼び出し側へ返す前に例外が伝播する。
作られた root は親を持たない独立スコープなので所有ツリーで自動回収されず、`fn` 内で
例外までに張った effect が孤児として残る（静かなリーク）。エラーバウンダリ（onError）を
売りにしている割に、ここだけ整合が取れていない。

**対応案**: `rooted` を try/catch で囲み、`fn()` が投げたら掴んでおいた `dispose()` を
呼んでから再 throw する（部分的に作られた root を畳んでから例外を上げる）。エラー経路
限定のエッジなので優先度は低いが、修正コストも小さい。

---

## テスト・インフラ

### 26. npm publish の自動化がない [未実装]

CI はテストのみで、リリースは手元の `npm publish` 頼み。

**対応案**: `v*` タグ push をトリガに `npm publish --provenance` する workflow を追加する。
あわせて CHANGELOG.md（手書きで十分）を置く。

### 28. examples / デモページがない [検討]

README のコード片だけで、動かして試せるものがない。

**対応案**: `examples/index.html`（IIFE 版を読み込む TODO リスト程度）を1枚置く。
ビルド後に `npx serve` で開けるようにし、README からリンクする。

### 61. 依存に既知脆弱性があり、CI に audit ゲートも無い [未実装]

`npm audit` で high 1 件（undici）・low 1 件（esbuild）が出ている。いずれも
devDependencies 配下（jsdom / esbuild 経由）で、本体は runtime 依存ゼロのため
**配布パッケージには影響しない**。が、放置されているうえ CI（`.github/workflows/ci.yml`）に
`npm audit` のステップが無いので、今後増えても気づけない。

**対応案**: `npm audit fix` で現状を解消し、CI に `npm audit --omit=dev` か
`--audit-level=high` のステップを足す（dev のみの指摘で止めたくないなら閾値を調整）。

### 62. パッケージング検証（publint / attw）と独立 typecheck が無い [未実装]

`package.json` の `exports` はサブパスが6つ（`.` / `./reactive` / `./html` / `./for` /
`./show` / `./element`）あるが、型やサブパス解決が壊れても CI で検知できない。また
`typecheck` スクリプトはあるが CI からは独立に呼ばれていない（`build` の `tsc` 任せ）。

**対応案**: CI に `publint` と `@arethetypeswrong/cli`（attw）を足して exports / 型の
出力を固める。あわせて `npm run typecheck` を独立ステップにする（emit 前に型だけ見る）。

# スコープ外の明文化（やる/やらないの判断）

機能ギャップではあるが、最小主義として意図的に持たない可能性が高いもの。実装するかではなく
「対象外と README に1行書くか、やるか」を決めるのがゴール。

### 63. 非同期プリミティブ（resource / Suspense 相当）が無い [検討]

fetch の loading / error / data 状態を宣言的に扱う口が無く、利用者が signal を手で並べる。

**対応案**: 最小主義として意図的に持たないなら README に「非同期は利用者側で signal +
effect」と明記する。やるなら `resource(fetcher)` が `{ loading, error, data }` の signal を
返す薄いヘルパー1個に留める（Suspense までは踏み込まない）。

### 64. SSR / `renderToString` が無い [検討]

`document` 前提でクライアント専用。サーバレンダリング・hydration の経路を持たない。

**対応案**: クライアント専用と割り切るなら README にスコープとして明記する（誤解を防ぐ）。
本格 SSR は設計が大きく、最小ライブラリの範囲を超えるので当面は非対応宣言で十分。

### 65. 双方向バインドの糖衣が無い [検討]

`<input>` は `value=${() => s.value}` の読みと `onInput=${e => s.value = e.target.value}` の
書きを毎回手で書く。

**対応案**: 明示的で良いと割り切るならこのまま。糖衣を入れるなら `bind`（`value` + `onInput` を
1つにまとめる ref / ヘルパー）を検討するが、要素種別（checkbox / select / radio）ごとの
分岐を抱えるので、最小主義との兼ね合いで要判断。
