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
| 高 | #48, #49 emit / orchestrator のギャップ | adopt 本体は実装済み（カーソル / 順位モデルの破綻・要素対応づけのドリフトも解消済み）。`Node` 子・ネスト要素が emit に乗らず実用 SSR の律速。次はここ（`For` / `Show` の emit は対応済み） |
| 中 | #42, #51, #53, #58 [検討] の方針決定 | 実装より先に「やるか否か」を決める必要があり、他の作業（SSR スコープ・API 一本化・XSS 型安全）の前提になる。#58 は既知の穴（render が素の文字列を返すとサーバで未エスケープ＝ XSS）の塞ぎ方も兼ねる |
| 低 | #45, #46, #55, #56, #59 SSR の周辺強化 | state 直列化・slot 対応・サーバ実行ガード・`.foo` の初期表示・For/Show のパリティテスト（#59 は #55 が前提）。emit の穴（#48〜#49）が埋まってから／必要になってから |
| 低 | #21 shadow DOM / #57 raw text | レンダリングの機能ギャップ（未実装 / 割り切り）。必要になったときに |
| 低 | #7 store の構造変化追跡 | 割り切り（葉=signal）。可変長は `signal<T[]>` + `For` で回避、必要なら `storeArray` / Proxy 版 |
| 低 | #44 の [改善] | 可読性・一貫性。挙動は変わらない |
| 低 | #13 イベントオプション | 体験改善。手が空いたとき |
| 低 | #26 インフラ整備 | 機能とは独立にいつでも |
| 最低 | #9 SVG | `html` 経由なら元々動き、hyperscript（h / tags）固有のギャップ。やる意味が薄く当面やらない |
| 最低 | #28 examples / デモページ | あると親切だが必須ではない。やる意味が薄く当面やらない |

---

## store.ts

### 7. 構造変化（キー追加・削除、配列の push / splice）を追跡しない [割り切り]

signal は葉に張るため、入れ物の形が変わる操作には反応しない。

**対応案**（いずれか、併存も可）:

- **運用で回避**: 可変長のコレクションは `signal<T[]>` を丸ごと持ち、`For` と組み合わせる。
  README に推奨パターンとして明記する（最小コスト）。
- **`storeArray<T>()` ヘルパー**: 中身が `Signal<Store<T>[]>` の薄いラッパーを足し、
  `push` / `remove` 相当のメソッドで配列 signal を差し替える。`For` 直結で使える。
- **Proxy 版 `reactive()` の追加**: キー列挙・`length` も追跡する本格版を別モジュールで提供する。
  実装コストと Proxy のオーバーヘッドが乗るので、「葉=signal」モデルと併存させる場合のみ。

---

## h.ts / tags.ts

### 9. SVG 非対応 [未実装]

`document.createElement` 固定なので `h("svg", ...)` は `HTMLUnknownElement` になり描画されない。

**対応案**: SVG タグ名の集合（`svg`, `path`, `circle`, ...）を持ち、該当時と
「svg 要素の子を作るとき」は `createElementNS("http://www.w3.org/2000/svg", tag)` を使う。
ネスト文脈を追うのが面倒なら、`h.svg(tag, ...)` / `tags.svg.path(...)` の明示 API でもよい。

**厄介な点**: hyperscript は子が親より先に作られる（`h("svg", h("path"))` は内側の `h("path")` が
先に評価される）ため、「svg の中か」を子側から知って NS を伝播させる素直な方法がない。さらに
`a` / `title` / `script` / `style` は HTML/SVG 両方にあり、静的なタグ集合だけでは振り分けられない。
結局 `h.svg(...)` / `tags.svg.*` の明示 API に倒すのが現実的で、`createElement` の置き換え1行では
済まず設計判断を含む。なお `html` は `template.innerHTML` 経由でパースするので SVG は元々動き、
本項は hyperscript（h / tags）固有。

### 13. イベントオプション（capture / once / passive）を渡せない [検討]

`onClick` 形式は `addEventListener(type, fn)` 固定。

**対応案**: 値を `[fn, options]` のタプルでも受け付ける、または `onClickCapture` の
サフィックス対応。必要になってからで十分。

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

### 21. shadow DOM を選べない [割り切り]

light DOM 専用（スタイルはページ側、`<slot>` なし）。

**対応案**: `defineElement(name, setup, { shadow: "open" })` のオプションで
`attachShadow` に切り替えられるようにする。マウント先を `host` か `shadowRoot` かに
分岐するだけで、スタイル隔離が要るコンポーネントに対応できる。

**厄介な点**: マウント先の分岐だけでは済まない。現状の slot は `ctx.slot()` による light DOM の
静的投影（`element.ts` の退避→投影、disconnect 時の復元）で、shadow DOM のネイティブ `<slot>` とは
別モデル。shadow を入れると2つの slot モデルが併存／衝突し、#46（slot × ハイドレーション）と絡む。
さらにハイドレーションは declarative shadow DOM（`<template shadowrootmode>`）という別の adopt 経路が
要り、現状の light DOM 採用（`element.ts` の hydrating パス）と二本立てになる。着手前に slot モデル
（#46）との関係を決める必要がある。

---

## SSR / ハイドレーション

`html` 系の SSR（`emit`）とノード保存型ハイドレーション（adopt）に関する残課題をここに集約する
（旧 `## element.ts` 配下の #45 / #46 もここへ移した）。adopt 側 #55〜#56 は調査時点 2026-06-17 /
jsdom で挙動を再現確認済み、それ以外は 2026-06-12 時点。全体の実装状況・設計根拠は
docs/ssr-hydration-plan.md を参照。

### 55. サーバ実行ガード / 専用エントリが未整備 [未実装]

`emit` 自体は DOM 非依存だが、メインエントリ `.`（`index.ts`）は `document` / `customElements` に
触れる `html` / `element` も束ねて再エクスポートしている。サーバ（SSG / Node）からは `./emit` だけを
import すれば安全という前提だが、その保証（`isServer` 相当のガードや、サーバ専用エントリの明示）が
ドキュメント・実装の両面で弱い。`defineElement` をサーバで呼ぶと `customElements.define` で死ぬ。
docs/ssr-hydration-plan.md には「サーバ用エントリから切り離す／遅延ガードする」方針はあるが未着手。

**対応案**: (a) `isServer`（`typeof document === "undefined"` 等）を1つ公開し、`defineElement` などが
サーバで呼ばれたら no-op か明示エラーにする、(b) パッケージの `exports` で「サーバから安全に import
できるのは `./emit`（と純粋な `./reactive`）だけ」と README / docs に明記する。#49 の
orchestrator を作るならその DOM 非依存性とあわせて整理する。

### 59. `For` / `Show` の emit パリティ / ラウンドトリップテストが書けない [未実装]（#55 が前提）

`For` / `Show` は `typeof document` で環境を推測して emit（文字列）/ DOM を分岐するため、document の
ある jsdom 下では emit パスに入れない（実 DOM を作って throw する）。結果、プレーンなテンプレートでは
書けている次の2つが `For` / `Show` だけ書けず、`test-emit.ts`（document 無し）と `test-hydrate.ts`
（jsdom）に分割して**同形を人手で保っている**だけになっている:

- **(A) 機械検証パリティ**: `emit` の `For` / `Show` 出力 == CSR（`html`）の `outerHTML` を 1 つの
  `assert.equal` で比較する（プレーンは実施済み・`For` / `Show` は未実施）。今は emit 出力の文字列
  （`test-emit.ts`）と adopt が食う手組み文字列（`test-hydrate.ts`）を別々に固定し、両者が等しいことを
  機械が保証していない（片方だけ更新すると各ファイルは緑のまま実システムが壊れて気づけない）。
- **(B) 本物の emit 出力でのラウンドトリップ**: 手組み HTML ではなく、実際の `emit` の `For` / `Show`
  出力を据えて `hydrate` し、採用・reactivity を確認する（プレーンは実施済み）。

**対応案**: 根本原因は `typeof document` の環境推測。#55 で「emit 中」を示す明示シグナル（ハイドレーション
カーソルと同様のアンビエント文脈）にすれば、document があっても `For` / `Show` をサーバパスで動かせ、
jsdom の 1 プロセス内で (A)(B) が書ける。**#55 解消後に (A)(B) を追加する**。それまでの繋ぎとして、
`test-emit.ts` が emit 出力をフィクスチャに書き出し `test-hydrate.ts` が読んで hydrate する「共有
フィクスチャ」方式なら、#55 を待たずに (A)(B) の結線を機械化できる（低コストの代替）。

### 56. `.foo`（プロパティ穴）は SSR 初期表示に出ない [割り切り]

`emit` は `.value` などのプロパティ穴をスキップして属性に出さない（クライアントの DOM と同形に
するため）。そのため `.value` 等の値はサーバ HTML に乗らず、ハイドレーションの初回 `bindProp` で
クライアントから代入される。フォーム要素の現在値が SSR 初期表示に反映されない（`input` の値が一瞬
空など）。「DOM 状態を保つ真のハイドレーション」を謳う割に未記載だった制約。

**対応案**: 原理的に属性へ焼けない値なので、必要なら #45（state 直列化）と組み合わせて「属性 /
`<script type="application/json">` から seed → 初回 effect で DOM プロパティへ」の規約で補う。
表示専用なら属性側（`value="..."`）で素直に出すことも検討する。基本は割り切りとして明記でよい。

### 45. 状態直列化を `jsonAttr` / `prop.json` で対応 [未実装]

ハイドレーション第1弾（実装済み）で未着手のまま残した「state 直列化（任意）」の具体案。
単純 props（文字列属性）を超えるリッチな初期データ（配列・オブジェクト）を
サーバ→クライアントで JSON 経由で受け渡すヘルパーを足す。ハイドレーション本体（adopt / wire）
とは直交する **state seeding** で、MPA の「空 DOM + JSON 属性から CSR」にも、ノード保存型
ハイドレーションの初期データ補完にも使える。

**対応案**:

- **`jsonAttr(value)`（サーバ / DOM 非依存）** — エスケープ込みで属性値文字列を返す純粋関数。
  `<x-list items='${jsonAttr(rows)}'>` のように使う。属性クォート衝突・`&` / `<` の XSS を内蔵処理。
- **`prop.json(name, initial?)`（クライアント）** — `ctx.prop` の JSON 版。属性を `JSON.parse` して
  型付き signal を返す（素の `prop` は文字列のまま）。パース失敗時は `initial` フォールバック。

**留意**: DOM と JSON の二重ペイロードは置き場所（属性 / `<script type="application/json">`）を
変えても消えない構造的コスト。seed 対象を「クライアントで live state にする分だけ」に絞るのが
運用上のレバー（表示専用データは描いて seed しない）。ORM エンティティは直列化せず、表示に要る
プレーンな DTO に落としてから渡す。

### 46. slot × ハイドレーション [未実装]

adopt モードは **slot を使う Custom Element に未対応**。描画後の host 直下は
投影済みの構造（setup の出力に slot 入力を差し込んだ形）になり、元の平らな slot 入力は残らない。
採用するには `ctx.slot()` が「投影済み DOM の中の該当既存ノード」を突き合わせて返す機構（投影点の
突き合わせ）が要るが未実装。現状は採用中の `ctx.slot()` は空を返し DEV 警告するだけ。第1弾の対象は
slot を使わない要素（props / signal だけで中身を組むアイランド）に限る。あわせてサーバ側に
「投影済みの形」を出す機構も未整備（`emit` は単一テンプレートの文字列化のみで、`defineElement` の
setup 実行・slot 投影はしない）。

**対応案**: クライアントは `ctx.slot()` を「投影済み DOM の投影点にある既存ノードを claim して
返す」adopt 版にする。サーバは setup を実行して slot 入力を投影した形を出力する機構（#49 の
orchestrator と一体）が要る。state 直列化（#45）と並ぶ将来課題。

### 48. `Node` の子を `emit` でシリアライズできない [未実装]（現状は割り切りで throw）

`emit.ts` は子が `Node` のとき throw する（「SSR 第1弾はプリミティブのみ」）。ネストした
`` html`...` `` や `Node` 直挿しを含むテンプレートはサーバで文字列化できない。

**対応案**: ネストした断片はサーバでは `emit` 同士で合成する設計にする（`emit` の戻り値＝文字列を
子穴へ入れたときに二重エスケープしない「生 HTML」扱いの規約が要る）。ライブな DOM `Node` の直挿しは
サーバでは原理的に不可なので非対象を維持し、テンプレート断片の合成だけを対象にする。

### 49. ネストしたカスタム要素を走査するサーバ orchestrator が無い [未実装]

`emit` は `defineElement` の登録を知らず、単一テンプレートの文字列化しかしない。ネストした
カスタム要素（`<x-card>` の中の `<x-counter>` 等）の setup を辿って再帰的に SSR し、各 host に
`data-hydrate` を付けて出力する仕組みが無い。現状は「host タグ + `data-hydrate` + 中身 `emit`」を
手組みする必要がある。

**対応案**: サーバ用エントリに「タグ名 → setup」のレジストリを持ち、ツリーを辿って各カスタム要素を
`emit` で展開し host に `data-hydrate` を付ける orchestrator（`renderToString` 相当）を足す。
`customElements` / `document` に触れない DOM 非依存実装にする。slot 投影（#46）と一体で設計する。

### 53. h / tags の SSR / ハイドレーション方針が未決定 [検討]

`html` は SSR / ハイドレーション対応済みだが、`h` / `tags`（hyperscript）は第1弾スコープ外で
扱いが未決定。docs/ssr-hydration-plan.md の「h / tags のハイドレーション」節に詳細があり、
**(a) 真のノード保存（カーソル方式 adopt）/ (b) render-on-connect で割り切り / (c) `h` / `tags`
自体を廃止して `html` に一本化** の3択が並んでいる。やるか否か・どの深さでやるかの**方針決定**が
ゴール（実装方針ではない）。

**対応案**: `html` の SSR 実装で得た知見を踏まえ、まず (a) / (b) / (c) を決める。(c)（廃止）なら
SSR スコープは `html` だけになり本項は不要になる。決定は #42（穴の signal 直渡し廃止）とも関連
（API を `html` に寄せる流れなら一括で判断）。

### 58. 型で XSS を防ぐ SafeHtml 体制を入れるか [検討]

現状、生 HTML を「再エスケープしない」印として `EmittedHtml`（`src/emitted-html.ts`）があるが、これは
合成の正しさ（二重エスケープ防止）のための内部マーカーで、**型で XSS を防ぐ仕組みではない**。本格的に
やるなら html / emit を横断する system-wide な体制になる:

- **エスケープ＝安全値の鋳造口にする**: emit の `escapeText` / `escapeAttr` の戻り値を「安全な値」型
  （`SafeHtml`）にし、エスケープを安全値を作る正規ルートにする。
- **生 HTML シンクの引数を安全値型に絞る**: 生 HTML として挿す箇所（emit の生 HTML 合成、
  `template.innerHTML` 代入、`.innerHTML` プロパティ穴など）の引数を `SafeHtml` に限定する。`string` を
  受けたままだと型は何も保証せず、未エスケープ文字列を渡せて XSS になる（型はシンクで絞って初めて効く）。
- **合成と抜け穴**: 安全値 + 安全値 → 安全値、および明示的な `unsafeHtml(s: string)`（信頼を宣言する
  唯一の入口）が要る。
- **文脈別の型**: 「安全」はテキスト / 属性 / URL / style / script で別物なので、単一 `SafeHtml` では
  足りず `SafeUrl` / `SafeStyle` 等に分かれうる（cf. Google safevalues / Trusted Types）。

**EmittedHtml との関係**: `emit` 出力は埋め込み値を全部エスケープ済み＝安全なので、本格版では `emit` の
戻り値が `SafeHtml` になり、「再エスケープしない」判定は「もう SafeHtml だから安全・そのまま出す」に
統合される。その結果 `EmittedHtml` は `SafeHtml` に**吸収されて消える**見込み。

**既知の穴（#47 由来 / 本体の最小ステップ）**: `For` / `Show` のサーバ経路は `emit.ts` の `toHtml` で
render の戻り値をほどくが、`toHtml` は**素の文字列を「emit が組んだ HTML」として再エスケープせず通す**。
`emit` の戻り値が `string` である今、データ文字列と emit 出力を実行時に区別できないため（区別して
エスケープすると emit 出力が二重エスケープされる）。結果、render が素のデータ文字列を返すと
（型が `Node | string` なので書けてしまう）**サーバで未エスケープ注入＝ XSS** になりうる（同じ render は
クライアントでは `insertBefore(string)` でクラッシュするだけ、という非対称も危険）。これを塞ぐ最小ステップが
本項の入口: **(1)** `emit` を `EmittedHtml`（将来の `SafeHtml`）返しにして「emit 出力」と「素の文字列」を
型・実行時の両方で区別する、**(2)** `For` / `Show` の render 型を `Node | string` → `Node | EmittedHtml`
に締めて素のデータ文字列をコンパイルエラーにする、**(3)** `toHtml` は素の文字列を `escapeText` でエスケープ
できるようになる（emit 出力は `EmittedHtml` なので二重エスケープしない）。(1) は `emit` の戻り値型を変える
破壊的変更（`toString()` で `String(emit(...))` は救えるが assert 等は移行）なので、#58 本体として進める。

**対応案 / 判断**: ビルドレス・最小主義の方針と費用対効果を天秤にかける、横断的で大きめの変更。まず
「やるか否か」を決めるのがゴール。やらないなら `EmittedHtml` は現状の内部マーカーのままとし、XSS 対策は
「`emit` は埋め込み値を既定でエスケープする」という現行の実行時保証に委ねる旨を明記する。

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

# 素直な仕様・実装にするための改善点

機能追加ではなく「直感に反する挙動」や「遠回りな実装」を直すもの。
（調査時点: 2026-06-12 / コードレビューによる）

## node.ts（h / html 共通）

### 42. 穴への signal 直渡しを廃止し「穴=関数」の単一ルールにするか [検討]

現状、穴は `() => T`（関数穴）と `Signal`（bare 直渡し、ブランド Symbol で判定）の2系統を
受け付ける（`li(count)` ≡ `li(() => count.value)`）。これを「reactive な穴は関数だけ」に
一本化すべきか、という**やるか否かの判断事項**。実装方針ではなく方針決定がここでのゴール。

メインのトレードオフは **書き心地・読み心地 ↔ メンタルモデルの一貫性**。

- **残す（直渡しを許す）**: signal をそのまま `span(count)` と書けて短く、読むときも余計な
  `() =>` のノイズがない。代償として「穴は関数 **または** signal」の2系統をユーザーが覚える。
- **廃止する（関数のみ）**: 「穴が reactive ⇔ 関数」という単一ルールになりメンタルモデルが
  一貫する。代償として `span(() => count.value)` と毎回書くことになり、素の signal を手で
  並べるのと変わらない冗長さが出る。README の `h("div", { "data-n": count }, count)` 等の例も
  全面的に `() =>` 必須になる。

判断に効く周辺事情:

- **footgun はもう論点ではない**: 以前は `isSignal` の duck typing が「signal っぽいオブジェクト」
  を誤判定する危険が廃止側の理由だったが、ブランド Symbol 判定に直して解消済み（旧 #31）。
  直渡しを残しても誤判定は起きないので、footgun は判断材料から外れる。
- **For / Show との非対称**: `For` / `Show` の `items` / `when` は `(() => T) | Signal<T>` の
  両対応（accessor に正規化）。穴だけ関数強制にすると「穴は関数のみ、コンポーネント引数は両対応」
  という非対称が残る。一貫性を本気で取るなら穴だけでなく For / Show の signal 直渡しも併せて畳む話。
- **For の穴の書き味は不変**: `For` の `item` / `index` は accessor なので、直渡しの有無に関わらず
  穴は `() => item().text`。これは純粋に「素の値の穴」の API 問題。
- **実装・型の単純化（廃止側の小さな利点）**: 廃止すれば `toNode` / `bindProp` の signal 分岐と
  `Child` / `PropValue` 型の `Signal` union が消え、#44 で node.ts に寄せた正規化処理も
  「関数か否か」だけになる。
- **store への影響は副次的**: `store` の「葉=signal を直渡し」（`span(state.user.name)`）も廃止で
  失われるが、`store` を主力に据えるかは別の話。ここでは判断の決め手にはしない。

**判断の軸**: 短く書ける・読めるを最優先するなら**残す**。系統が2つあることの認知コストを嫌い、
メンタルモデルの一貫性を最優先するなら**廃止**する。footgun は解消済みなので、いまや純粋な
書き心地 ↔ 一貫性のトレードオフ。まず残す/廃止を決める。

### 44. 穴の値を「今読む」処理 `read()` を `toAccessor` に寄せる [改善]

`html.ts` の `read(v)`（`typeof v === "function" ? v() : isSignal(v) ? v.value : v`）は、node.ts の
`toAccessor`（遅延版 `() => T`）の **eager 版**を別実装したもの。「関数 / signal 直渡し / 静的」の
正規化ルールが node.ts と html.ts に二重に存在している。

**対応案**: 読み取りルールは node.ts に一元化する。`wireDynamicAttr` の `read(values[i])` を
`toAccessor(...)()` 経由にするか、node.ts に eager 版ヘルパー（例 `readInput`）を1つ置いて
両方から使う。穴入力の読み取り規則が完全に1か所に集まる。

## h.ts / html.ts

### 51. テンプレ解釈を html.ts と emit.ts で二重に実装している [改善 / 検討]

同じタグ付きテンプレ方言を、`html.ts` は `template.innerHTML` + TreeWalker で、`emit.ts` は
自前の軽量トークナイザで、**別々に解釈**している。docs/ssr-hydration-plan.md の段階1は
「テンプレ解釈は 1 回・共有（descriptors に IR 化）」を目標にしていたが、実装では emit が独自
パーサを持つ形に落ち着いた。パリティテスト（emit 出力 == CSR の outerHTML）で**挙動**は守られて
いるが、**構造的には共有されておらず**、片方だけ直すと drift する（属性 / 穴の分類規則・コメント
スキップ・raw text 要素の扱いなどが二か所に散る）。

**対応案**: 段階1の方針どおり「`strings` → descriptors」を 1 か所に切り出し、`html`（DOM 構築）と
`emit`（文字列化）の両方が同じ descriptors を消費する形に寄せる。コスト次第では「共有はせず
パリティテストで担保する」現状維持も選択肢（その場合は二重実装である旨を明記して割り切る）。
まず寄せるか割り切るかを決める。
