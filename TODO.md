# 作りこめていない箇所と改善案

このライブラリで現状「未実装・簡易実装・意図的な割り切り」になっている箇所の一覧。
各項目に、対応するならどう作るかの案を添える。
（調査時点: 2026-06-12 / `main` 相当のソースに基づく）

凡例:

- **[割り切り]** — ソースコメントや README で明示的に「対象外」と宣言しているもの
- **[未実装]** — 単に手が回っていない・簡易実装のままのもの
- **[バグ寄り]** — 仕様として意図していない挙動（リーク・誤動作）になっているもの
- **[改善]** — 動作は正しいが、仕様・実装がより素直に書けるもの

---

## 優先度の目安

| 優先 | 項目 | 理由 |
|---|---|---|
| 低 | #9 SVG / #21 shadow DOM | 必要になったときに |
| 低 | #37, #38, #44, #45 の [改善] 各種 | 可読性・一貫性。挙動は変わらない |
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

### 12. `tags` の型が `Record<string, TagBuilder>` [未実装]

タイポ（`tags.dvi`）がコンパイルも実行も素通りして `<dvi>` を作る。戻り値も常に `HTMLElement`。

**対応案**: `HTMLElementTagNameMap` を使ったマップ型
（`{ [K in keyof HTMLElementTagNameMap]: (...args) => HTMLElementTagNameMap[K] } & Record<string, TagBuilder>`）
にする。既知タグは厳密に、Custom Element 用に文字列フォールバックは残す。型だけの変更で済む。

### 13. イベントオプション（capture / once / passive）を渡せない [未実装]

`onClick` 形式は `addEventListener(type, fn)` 固定。

**対応案**: 値を `[fn, options]` のタプルでも受け付ける、または `onClickCapture` の
サフィックス対応。必要になってからで十分。

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

### 23. SSR / ハイドレーション非対応 [割り切り]

`document` 前提・クライアントサイド専用。

**対応案**: スコープ外として README に明記するだけでよい（対応するならライブラリの
性格が変わるレベルの作業になるため、現状の「最小」方針とは両立しない）。

---

## テスト・インフラ

### 26. npm publish の自動化がない [未実装]

CI はテストのみで、リリースは手元の `npm publish` 頼み。

**対応案**: `v*` タグ push をトリガに `npm publish --provenance` する workflow を追加する。
あわせて CHANGELOG.md（手書きで十分）を置く。

### 28. examples / デモページがない [未実装]

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

---

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
  `Child` / `PropValue` 型の `Signal` union が消え、#44・#45 で node.ts に寄せた正規化処理も
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

### 45. 「reactive な穴か」の判定述語を node.ts に共通化 [改善]

`typeof v === "function" || isSignal(v)`（＝この入力は reactive か）の判定が、node.ts の
`bindProp` と html.ts の `wireDynamicAttr`（`parts.some(...)` の中）に重複している。

**対応案**: node.ts に述語（例 `isReactiveInput(v)`）を1つ置き、両方から使う。#44 と一体で
「穴入力の正規化・判定・読み取り」を node.ts に揃えられる。#42 を「残す」で決めるなら、この判定が
唯一の reactive 入口になるので、なおさら1か所にしておく価値がある。

## h.ts / html.ts

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
