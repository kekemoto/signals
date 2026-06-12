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

## reactive.ts（コア）

### 1. `memo` が eager（未使用でも計算する） [割り切り]

`memo` は `signal` + `effect` の合成なので、誰も読んでいなくても入力が変わるたび計算が走る。

**対応案**: dirty フラグを持つ pull 型（lazy）評価に変える。入力変更時は「dirty を立てて下流に伝播するだけ」にし、実際の計算は読まれた瞬間に行う（Solid / Reactively の push-pull 方式）。
`Computation` にノード種別（effect / memo）と `state: clean | check | dirty` を持たせ、flush では effect だけ走らせて memo は読み時に再計算する。コアの書き換え規模は中程度だが、次項のグリッチも同時に解消できる。

### 2. 生入力と `memo` を同じ effect で読むと二重実行（グリッチ） [割り切り]

`a` と `memo(() => a.value * 2)` を同じ effect で読むと、`a` 変更時にその effect が
「a 由来で1回 + memo 由来で1回」の計2回走る。

**対応案**: 上記の push-pull 化で自然に解消する（effect 実行前に依存 memo を pull して
最新化するため、同一世代内で値が確定する）。push 型のまま直すなら「memo の内部 effect を
通常 effect より先に流す2フェーズ flush」でも実用上は足りる。

### 5. エラーハンドリングの仕組みがない [未実装]

flush は「同じ世代の残りを実行してから最初の例外を投げ直す」までは面倒を見るが、
その例外は **signal を書いた側**（無関係なコード）に飛ぶ。effect ごとのエラー捕捉や
エラーバウンダリに相当するものはない。

**対応案**: `Owner` に `onError` ハンドラを持たせ、effect 内の例外は所有ツリーを根に向かって
探索し、最初に見つかったハンドラに渡す（なければ現行どおり投げ直す）。
`createRoot(fn, { onError })` か `onError(fn)`（`onCleanup` と同型）として公開する。

### 6. トップレベルの effect / memo は手動解放 [割り切り]

親がいない場所で作った effect / memo は自動では畳まれない（README にも明記）。
`createRoot` で囲めば管理できるが、DOM ユーティリティ（h / html）を素で使うと
effect が孤児になりやすい（下記 DOM 側の項も参照）。

**対応案**: コア側はこのままでよい。利便のために `getOwner()` / `runWithOwner(owner, fn)` を
公開すると、非同期コールバックの中から元の所有ツリーに復帰でき、
`setTimeout` / `await` 後に作る effect のリークを防げる。

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

### 10. `style` / `class` のオブジェクト形式に未対応 [未実装]

`style: { color: "red" }` や `className: { active: isActive }` はオブジェクトのまま
プロパティに代入されて効かない。現状は文字列を組み立てるしかない。

**対応案**: `setProp` で `style` キーかつオブジェクトなら `el.style` へ個別代入、
`className` キーかつオブジェクトなら真のキーだけ `join(" ")` する分岐を足す。

### 11. `ref` がない [未実装]

作った要素への参照を外に取り出す公式な口がない（`h` は戻り値で取れるが、
`html` テンプレートの内側の要素は取れない）。

**対応案**: props の `ref: (el) => void` を予約キーにして要素生成直後に呼ぶ。
`html` 側も属性穴 `ref=${fn}` で同様に配線する。

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

### 15. 属性まわりの制限は h.ts と共通 [未実装]

SVG なし（#9）・`style` オブジェクトなし（#10）・`ref` なし（#11）は
`html` にも同様に当てはまる。`setProp` / `toNode` は `node.ts` に共通化済みなので、
対応の際はそこに入れれば h.ts / html.ts の両方にまとめて効く。

---

## for.ts

### 17. 同じ key で中身が新しいオブジェクトに変わっても行が更新されない [未実装]

entry は key で使い回すため、`items.value = items.value.map(x => ({ ...x, done: true }))` の
ような「同 key・新オブジェクト」の更新では `render` が再実行されず、行は古い item を映したまま。
（`store` の葉を行内で読む可変モデルなら問題ない。）

**対応案**: 行ごとに `signal(item)` を持ち、`render` には item ではなくその signal
（または accessor）を渡す。entry 再利用時に `itemSignal.value = item` で流し込めば、
行内の reactive な穴だけが更新される。`render(item: T)` → `render(item: Signal<T>)` の
破壊的変更になるので、入れるなら早いほうがよい。

### 18. `render` に index が渡らない [未実装]

順位表示など index 依存の描画ができない。

**対応案**: #17 と同様に `Signal<number>` を第2引数で渡し、並べ替え時に更新する。

---

## show.ts

### 19. `render` に when の値が渡らない [未実装]

`Show(() => user.value, render)` で render 側がまた `user.value` を読む必要があり、
null 除去（narrowing）の旨みがない。

**対応案**: Solid と同様、`render(() => value)` の形で「真だった値を返す accessor」を渡す。
型は `Show<T>(when: () => T, render: (value: () => NonNullable<T>) => Node, ...)` にする。
引数を増やすだけなので後方互換にできる。

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

---

# 素直な仕様・実装にするための改善点

機能追加ではなく「直感に反する挙動」や「遠回りな実装」を直すもの。
（調査時点: 2026-06-12 / コードレビューによる）

## reactive.ts（コア）

### 30. `memo` の `cache!` 遅延初期化トリック [改善]

「effect が同期実行されることに依存して初回だけ signal を作る」のは読み手に
2段の前提を要求する。また初回の `fn()` が throw すると `cache` が未定義のまま
`read()` が TypeError になる。

**対応案**: `let cache: Signal<T> | undefined` ＋ 読み口での未初期化チェック、
あるいは sentinel 値を使った素直な初期化に書き換える。挙動は変えずに前提を減らせる。

### 32. `memo` の読み口が `signal` と非対称 [改善]

signal は `.value` / `.peek()`、memo は関数呼び出しで `peek` なし・`dispose`
プロパティ付き。「派生もただの関数」という思想は良いが、一貫性がない。

**対応案**: `Memo` にも読み取り専用 `value` と `peek()` を生やし、`Signal` としても
読めるようにする。穴への直渡し・`isSignal` 判定・untrack 代替がすべて一貫する。

## node.ts（h / html 共通）

### 34. accessor 正規化の重複 [改善]

`isSignal(x) ? () => x.value : x` というパターンが `for.ts` / `show.ts` / `node.ts` /
`html.ts` の4ファイルに散らばっている。

**対応案**: `node.ts` に `toAccessor(v)` を1つ置いて共用する。
`Signal | (() => T)` を受ける仕様の一貫性も型で表現できる。

## h.ts / html.ts

### 35. イベント判定の `startsWith("on")` が h と html で微妙に違う [改善]

`h` は `slice(2).toLowerCase()`、`html` は `slice(2)` のみ（HTML パーサが属性名を
小文字化するので結果的に同じだが、camelCase のカスタムイベントは `html` では
表現できない）。また `on` で始まる普通の属性名に関数を渡す道がない。

**対応案**: 判定とイベント名変換を `node.ts` に1関数として共通化し、両者で同じ
仕様にする。

### 37. グローバル regex の `lastIndex` リセットハック [改善]

`ATTR_RE` が `g` フラグ付きのモジュールグローバルで、`test()` 後に手動で
`lastIndex = 0` している。状態を持つ regex は典型的な footgun。

**対応案**: 判定は `value.includes(MARK)` にし、`split` 用の regex は使う場所で
作る（または `g` なしの判定用 regex を分ける）。

### 38. マジックナンバーと in ループ [改善]

`html.ts` の `0x1 | 0x80`・`nodeType === 8`、`h.ts` の
`for (const key in props || {})` ＋ 二重キャスト。

**対応案**: `NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT`、`Node.COMMENT_NODE`、
`if (props) for (const [key, v] of Object.entries(props))` に置き換える。

## show.ts / for.ts

### 40. `createRoot` の `let dispose!:` 受け渡し定型の重複 [改善]

non-null assertion 込みの同じ定型が `for.ts` / `show.ts` の2か所にある。

**対応案**: `function rooted<T>(fn: () => T): { value: T; dispose: () => void }` の
ような小ヘルパーに括り出し、`For` / `Show` 本体を宣言的にする。

---

## 優先度の目安

| 優先 | 項目 | 理由 |
|---|---|---|
| 高 | #17 For の同 key 新オブジェクト | immutable 更新が静かに壊れる |
| 中 | #1/#2 memo の lazy 化とグリッチ解消 | コアの質が上がるが書き換え規模が大きい |
| 低 | #9 SVG / #21 shadow DOM | 必要になったときに |
| 低 | #30〜#38 の [改善] 各種 | 可読性・一貫性。挙動は変わらない |
| 低 | #26, #28 インフラ整備 | 機能とは独立にいつでも |
