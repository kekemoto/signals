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
| 中 | #47, #48, #49 emit / orchestrator のギャップ | ハイドレーション本体は実装済み。`For` / `Show` / `Node` 子・ネスト要素が emit に乗らず、実用 SSR はここが律速。さらに進めるなら最優先 |
| 中 | #42, #51, #53 [検討] の方針決定 | 実装より先に「やるか否か」を決める必要があり、他の作業（SSR スコープ・API 一本化）の前提になる |
| 低 | #45, #46, #52 SSR の周辺強化 | state 直列化・slot 対応・mismatch 検出。emit の穴（#47〜#49）が埋まってから／必要になってから |
| 低 | #9 SVG / #21 shadow DOM | 必要になったときに |
| 低 | #37, #38, #44 の [改善] 各種 | 可読性・一貫性。挙動は変わらない |
| 低 | #13 イベントオプション / #43 README 構成 | 体験改善。手が空いたとき |
| 低 | #26, #28 インフラ整備 | 機能とは独立にいつでも |

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

### 13. イベントオプション（capture / once / passive）を渡せない [未実装]

`onClick` 形式は `addEventListener(type, fn)` 固定。

**対応案**: 値を `[fn, options]` のタプルでも受け付ける、または `onClickCapture` の
サフィックス対応。必要になってからで十分。

### 53. h / tags の SSR / ハイドレーション方針が未決定 [検討]

`html` は SSR / ハイドレーション対応済みだが、`h` / `tags`（hyperscript）は第1弾スコープ外で
扱いが未決定。docs/ssr-hydration-plan.md の「h / tags のハイドレーション」節に詳細があり、
**(a) 真のノード保存（カーソル方式 adopt）/ (b) render-on-connect で割り切り / (c) `h` / `tags`
自体を廃止して `html` に一本化** の3択が並んでいる。やるか否か・どの深さでやるかの**方針決定**が
ゴール（実装方針ではない）。

**対応案**: `html` の SSR 実装で得た知見を踏まえ、まず (a) / (b) / (c) を決める。(c)（廃止）なら
SSR スコープは `html` だけになり本項は不要になる。決定は #42（穴の signal 直渡し廃止）とも関連
（API を `html` に寄せる流れなら一括で判断）。

---

## html.ts

### 14. タグ内外判定のパーサが簡易 [割り切り]

`<` と `>` と引用符だけで inTag を追跡しているため、静的部分に HTML コメント
（特に `<!-- a > b -->` のように `>` を含むもの）があると属性穴/子穴の判定がずれる。

**対応案**: 走査に「`<!--` を見たらコメントモードに入り `-->` まで読み飛ばす」状態を
1つ足せばほぼ実用十分。完全対応（`<script>` / `<textarea>` の raw text 等）は
コストに見合わないので非対応と明記する。

---

## element.ts

### 21. shadow DOM を選べない [割り切り]

light DOM 専用（スタイルはページ側、`<slot>` なし）。

**対応案**: `defineElement(name, setup, { shadow: "open" })` のオプションで
`attachShadow` に切り替えられるようにする。マウント先を `host` か `shadowRoot` かに
分岐するだけで、スタイル隔離が要るコンポーネントに対応できる。

### 23. SSR / ハイドレーション [第1弾ほぼ実装済み・残りは⑤state 直列化（任意）]

`document` 前提・クライアントサイド専用。状態保存（ノード保存）型の真のハイドレーションを
入れる方針で設計を確定した。詳細な引き継ぎ資料は `docs/ssr-hydration-plan.md`。

**方針（要約）**: テンプレ解釈を 1 回だけ行って中間表現（descriptors）に落とし、
`emit(descriptors, values)`（サーバ & ブラウザ共有の文字列エミッタ）と
`wire(descriptors, root)`（新規描画と adopt で共通の配線パス）に分ける。ビルドレスは維持し
（Solid 式コンパイラは採らない）、境界・起動・初期 props は Custom Element（`connectedCallback` /
`ctx.prop`）に肩代わりさせてグローバルな hydrate 機構を自前で作らない。第1弾は `html` に絞り、
`h` / `tags` はスコープ外。マーカー戦略は Lit SSR を参照。

**対応案**: `docs/ssr-hydration-plan.md` の「段階的な実装計画」に沿って進める
（①descriptors 分離【実装済み: `html.ts` の `parse` / `wire` 分離・テンプレ単位キャッシュ。挙動は不変】
→ ②emit 追加【実装済み: `src/emit.ts`（`./emit` エントリ）。DOM 非依存の文字列エミッタ。
値埋め・エスケープ・イベント / ref / プロパティ穴のスキップ・子穴の開閉ペア・部分埋め込みを実装。
テストは `test/test-emit.ts`】
→ ③wire を adopt 対応【実装済み: `src/hydration.ts`（採用カーソル: `isHydrating` /
`runHydration` / `claimRoot` / `claimRange` / `withScope` / `withRoot` / `nodesBetween`）。
`node.ts` に `adoptChild`（toNode の adopt 版・初回は DOM を触らず採用）、`html.ts` に
adopt パス（属性は要素順位の突き合わせ・reactive 子穴は `<!--hole-->` を claim）、
`for.ts` / `show.ts` に既存行 / 既存中身の採用分岐を追加。テストは `test/test-hydrate.ts`
（ノード同一性 / childList 変化 0 件 / 採用後の reactivity・event / パリティ）】
→ ④hydrate / defineElement adopt【実装済み: `src/hydration.ts` に公開エントリ `hydrate`
（createRoot を重ねて dispose 可能にした採用ラッパ）と host マーカー `HYDRATE_ATTR`。
`element.ts` の `connectedCallback` に adopt モード（マーカーがあれば既存子をクリアせず
`runHydration` で setup の出力を配線し、append しない・採用後はマーカーを strip）。
`index.ts` から `hydrate` / `HYDRATE_ATTR` を公開。slot 投影は adopt 時は非対象（サーバが
投影済みの出力をそのまま採用）。テストは `test/test-hydrate.ts`】
→ ⑤state 直列化【未実装・任意。単純 props を超える初期データ用の規約。必要になってから。具体案は #45（`jsonAttr` / `prop.json`）】）。

**既知の制約（slot × ハイドレーション）**: → #46 に分離。
テストは「文字列出力 / ハイドレーション（ノード同一性）/ パリティ」の 3 層。

### 45. 状態直列化を `jsonAttr` / `prop.json` で対応 [未実装]

#23 ⑤ の具体案。単純 props（文字列属性）を超えるリッチな初期データ（配列・オブジェクト）を
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

（#23 から分離）adopt モードは **slot を使う Custom Element に未対応**。描画後の host 直下は
投影済みの構造（setup の出力に slot 入力を差し込んだ形）になり、元の平らな slot 入力は残らない。
採用するには `ctx.slot()` が「投影済み DOM の中の該当既存ノード」を突き合わせて返す機構（投影点の
突き合わせ）が要るが未実装。現状は採用中の `ctx.slot()` は空を返し DEV 警告するだけ。第1弾の対象は
slot を使わない要素（props / signal だけで中身を組むアイランド）に限る。あわせてサーバ側に
「投影済みの形」を出す機構も未整備（`emit` は単一テンプレートの文字列化のみで、`defineElement` の
setup 実行・slot 投影はしない）。

**対応案**: クライアントは `ctx.slot()` を「投影済み DOM の投影点にある既存ノードを claim して
返す」adopt 版にする。サーバは setup を実行して slot 入力を投影した形を出力する機構（#49 の
orchestrator と一体）が要る。state 直列化（#45）と並ぶ将来課題。

---

## emit.ts / hydration（SSR）

### 47. `For` / `Show` を `emit` で文字列化できない [未実装]

`emit` は `For` / `Show` をシリアライズできない（両者は DOM の `DocumentFragment` を返すため、
`emit` の純粋文字列経路に乗らない）。adopt 側（`hydration.ts` の `claimRange` が `<!--for-->` /
`<!--show-->` の開閉ペアを拾う）は実装済みなので、サーバ HTML を手組みすればハイドレーションは
動くが、`emit` で自動生成できない。リスト / 条件を含むコンポーネントの SSR はここがギャップ。

**対応案**: `emit` 側に `For` / `Show` を受ける経路を足す。`For` は `items` を 1 回読んで各行を
`emit` で再帰展開し `<!--for-->…<!--/for-->` で囲む、`Show` は `when` を 1 回読んで真の枝だけ
`emit` し `<!--show-->…<!--/show-->` で囲む。adopt 側のマーカーと同形を保ち、パリティテストで担保する。

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

### 52. ハイドレーションの mismatch 検出が部分的 [改善]

adopt 時の不一致検出が穴抜け。`html.ts` には「採用ルートが見つからない → 新規生成フォールバック」
（`:210`）と「reactive 子穴に対応する `<!--hole-->` が無い → DEV 警告」（`:267`）はあるが、
**claim した既存ノードのタグが期待と違っても検証せず採用する**（サーバ `<span>` をクライアント
`<div>` テンプレで採用しても黙って進み、以降の配線が静かにずれる）。

**対応案**: adopt の `claimRoot` / 各要素の採用時に、DEV ビルドで「期待タグ名 vs 実ノードの
`tagName`」を照合し、不一致なら `console.warn`（必要なら新規生成へフォールバック）。本番では
DEV が畳まれてゼロコスト。Lit / React の hydration warning と同じ立て付け。

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

### 43. README の構成を「動く例 → 特徴の出る例 → 解説」の順にしたい [未実装]

いまの README は API の説明が先に来ていて、「何ができて何が嬉しいか」が伝わる前に
細かい使い方に入ってしまう。最初に手を動かせる入口がほしい。

**対応案**: README 冒頭を次の順に組み替える。

1. **ミニマムな 1 HTML で済む例** — `<script src>` で IIFE 版を読み込み、コピペで
   そのまま動く最小サンプル（カウンタ程度）。ビルド不要で試せる入口にする。
2. **このライブラリの特徴が良く出た例** — signal 直渡し / 葉=signal の store /
   `For` の key 差分など、「この設計だからこう書ける」が伝わるサンプル。
3. その後に **signal の使い方**（API リファレンス的な説明）が続くようにする。

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

### 37. グローバル regex の `lastIndex` リセットハック [改善]

`ATTR_RE` が `g` フラグ付きのモジュールグローバルで、`test()` 後に手動で
`lastIndex = 0` している。状態を持つ regex は典型的な footgun。

**対応案**: 判定は `value.includes(MARK)` にし、`split` 用の regex は使う場所で
作る（または `g` なしの判定用 regex を分ける）。

### 38. マジックナンバー [改善]

`html.ts` の `0x1 | 0x80`・`nodeType === 8`、および `nodeType === 3`（Text）。
後者は html.ts の `trimEdges` だけでなく **node.ts の `toNode`（テキスト使い回し判定）にもある**。

**対応案**: `NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT`、`Node.COMMENT_NODE`、
`Node.TEXT_NODE` に置き換える。node.ts 側の `nodeType === 3` もこのとき一緒に直す。
（h.ts の `for..in` ＋ 二重キャストは、prop 配線の node.ts 共通化のときに
`Object.entries` へ移行済み。）
