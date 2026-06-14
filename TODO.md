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
| 低 | #37, #38 の [改善] 各種 | 可読性・一貫性。挙動は変わらない |
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

### 23. SSR / ハイドレーション [設計済み・未実装]

`document` 前提・クライアントサイド専用。状態保存（ノード保存）型の真のハイドレーションを
入れる方針で設計を確定した。詳細な引き継ぎ資料は `docs/ssr-hydration-plan.md`。

**方針（要約）**: テンプレ解釈を 1 回だけ行って中間表現（descriptors）に落とし、
`emit(descriptors, values)`（サーバ & ブラウザ共有の文字列エミッタ）と
`wire(descriptors, root)`（新規描画と adopt で共通の配線パス）に分ける。ビルドレスは維持し
（Solid 式コンパイラは採らない）、境界・起動・初期 props は Custom Element（`connectedCallback` /
`ctx.prop`）に肩代わりさせてグローバルな hydrate 機構を自前で作らない。第1弾は `html` に絞り、
`h` / `tags` はスコープ外。マーカー戦略は Lit SSR を参照。

**対応案**: `docs/ssr-hydration-plan.md` の「段階的な実装計画」に沿って進める
（①descriptors 分離 → ②emit 追加 → ③wire を adopt 対応 → ④hydrate / defineElement adopt →
⑤state 直列化）。テストは「文字列出力 / ハイドレーション（ノード同一性）/ パリティ」の 3 層。

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

現状、穴は `() => T`（関数穴）と `Signal`（bare 直渡し、`isSignal` の duck typing で判定）の
2系統を受け付ける（`li(count)` ≡ `li(() => count.value)`）。これを「reactive な穴は関数だけ」に
一本化すべきか、という**やるか否かの判断事項**。実装方針ではなく方針決定がここでのゴール。

- **廃止する利点**: 「穴が reactive ⇔ 関数」という単一ルールになり、ユーザーのメンタルモデルが
  一貫する。`isSignal` の duck typing（#31）も判定自体が不要になり footgun が根本から消える。
- **廃止の代償**: `store` の売りである「葉=signal を穴に bare 直渡し」（`span(state.user.name)`）が
  失われ、`span(() => state.user.name.value)` になる＝素の signal を手で並べるのと変わらなくなる。
  README の `h("div", { "data-n": count }, count)` 等の例も全面的に `() =>` 必須になる。
- **For への影響はない**: `For` の `item` / `index` は accessor なので、bare 直渡しの有無に関わらず
  穴の書き味（`() => item().text`）は変わらない。これは純粋に穴の一般 API と `store` の扱いの問題。

**判断の軸**: `store` の bare 直渡しモデルを主力として守るなら**残す**（その場合 #31 はブランド
Symbol 判定に直せば、直渡しを残したまま誤判定の footgun だけ消せる）。`store` を主力に据えず
「穴=関数」の単純さと #31 解消を優先するなら**廃止**する。まず残す/廃止を決める。

## h.ts / html.ts

### 37. グローバル regex の `lastIndex` リセットハック [改善]

`ATTR_RE` が `g` フラグ付きのモジュールグローバルで、`test()` 後に手動で
`lastIndex = 0` している。状態を持つ regex は典型的な footgun。

**対応案**: 判定は `value.includes(MARK)` にし、`split` 用の regex は使う場所で
作る（または `g` なしの判定用 regex を分ける）。

### 38. マジックナンバー [改善]

`html.ts` の `0x1 | 0x80`・`nodeType === 8`。

**対応案**: `NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT`、`Node.COMMENT_NODE` に
置き換える。
（h.ts の `for..in` ＋ 二重キャストは、prop 配線の node.ts 共通化のときに
`Object.entries` へ移行済み。）
