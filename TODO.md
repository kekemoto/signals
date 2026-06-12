# 作りこめていない箇所と改善案

このライブラリで現状「未実装・簡易実装・意図的な割り切り」になっている箇所の一覧。
各項目に、対応するならどう作るかの案を添える。
（調査時点: 2026-06-12 / `main` 相当のソースに基づく）

凡例:

- **[割り切り]** — ソースコメントや README で明示的に「対象外」と宣言しているもの
- **[未実装]** — 単に手が回っていない・簡易実装のままのもの

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

### 3. `untrack` が公開されていない [未実装]

`createRoot` の内部では `activeComputation = null` による untrack 相当を行っているが、
「effect の中で依存登録せずに signal を読みたい」だけの場面で使える公開 API がない
（現状は `.peek()` で代用できるが、関数呼び出しをまたぐ場合に不便）。

**対応案**: 数行で足せる。

```ts
export function untrack<T>(fn: () => T): T {
  const prev = activeComputation;
  activeComputation = null;
  try { return fn(); } finally { activeComputation = prev; }
}
```

### 4. 等価判定が `Object.is` 固定 [割り切り]

配列・オブジェクトを signal に入れると、中身が同じでも参照が変われば必ず通知される。

**対応案**: `signal(initial, { equals })` のオプション引数を追加する。
デフォルトは現行どおり `Object.is`、`equals: false` で常時通知、関数なら任意比較。
後方互換のまま追加できる。

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

### 8. 属性（setAttribute）のみで DOM プロパティを設定しない [未実装]

`value` / `checked` / `selected` などは属性を書いても「初期値」しか変わらない。
ユーザーが input に入力した後、signal 側の変更が画面に反映されない。

**対応案**: 予約キー方式が簡単で確実。`value:` 等のプレフィックスか、
よく使うキー（`value` / `checked` / `selected` / `disabled` 等）だけ `key in el` の判定で
プロパティ代入に切り替える。`setAttr` の冒頭に分岐を1つ足すだけで済む。

### 9. SVG 非対応 [未実装]

`document.createElement` 固定なので `h("svg", ...)` は `HTMLUnknownElement` になり描画されない。

**対応案**: SVG タグ名の集合（`svg`, `path`, `circle`, ...）を持ち、該当時と
「svg 要素の子を作るとき」は `createElementNS("http://www.w3.org/2000/svg", tag)` を使う。
ネスト文脈を追うのが面倒なら、`h.svg(tag, ...)` / `tags.svg.path(...)` の明示 API でもよい。

### 10. `style` / `class` のオブジェクト形式に未対応 [未実装]

`style: { color: "red" }` や `class: { active: isActive }` は `String(v)` で
`[object Object]` になる。現状は文字列を組み立てるしかない。

**対応案**: `setAttr` で `style` キーかつオブジェクトなら `el.style` へ個別代入、
`class` キーかつオブジェクトなら真のキーだけ `join(" ")` する分岐を足す。

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

プロパティ設定なし（#8）・SVG なし（#9）・`style` オブジェクトなし（#10）・`ref` なし（#11）は
`html` にも同様に当てはまる。`setAttr` / `toNode` は `node.ts` に共通化済みなので、
対応の際はそこに入れれば h.ts / html.ts の両方にまとめて効く。

---

## for.ts

### 16. 並べ替えが毎回「全ノードを insertBefore」 [未実装]

順序が変わっていなくても、更新のたびに全行を物理的に移動している
（`insertBefore` は同位置でも remove → insert になる）。行数が多いとコストが高く、
行が Custom Element の場合は不要な disconnect → connect も毎回発生する
（element.ts の遅延 dispose で実害は防いでいるが、無駄は残る）。

**対応案**: 段階的に。
1. **同位置スキップ**: 挿入前に「いまの位置が既に正しいか」（`node.nextSibling` 連鎖）を見て
   不要な `insertBefore` を省く。数行で大半のケース（変更なし・末尾追加）が無コスト化する。
2. **本格版**: 最長増加部分列（LIS）ベースの差分で移動回数を最小化する（Solid と同方式）。

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

### 22. `attr()` が `string | null` のみ・複雑なデータを渡す口がない [未実装]

数値・真偽への変換は呼び出し側任せ。属性に乗らないオブジェクト/関数を親から渡す
手段（プロパティ経由の入力）がない。

**対応案**:
- `attr(name, transform?)` の第2引数で `Number` / `(v) => v != null` 等の変換を受ける（小）。
- `ctx.prop(name)` を追加し、host にゲッター/セッターを定義して signal と双方向に繋ぐ。
  `el.items = [...]` のようにプロパティで複雑なデータを流し込めるようになる（中）。

### 23. SSR / ハイドレーション非対応 [割り切り]

`document` 前提・クライアントサイド専用。

**対応案**: スコープ外として README に明記するだけでよい（対応するならライブラリの
性格が変わるレベルの作業になるため、現状の「最小」方針とは両立しない）。

---

## テスト・インフラ

### 25. lint / format が未設定 [未実装]

**対応案**: 単一ツールで済む Biome（`biome check`）を devDependencies に足し、
CI に1ステップ追加する。

### 26. npm publish の自動化がない [未実装]

CI はテストのみで、リリースは手元の `npm publish` 頼み。

**対応案**: `v*` タグ push をトリガに `npm publish --provenance` する workflow を追加する。
あわせて CHANGELOG.md（手書きで十分）を置く。

### 27. `package.json` に `sideEffects: false` がない [未実装]

バンドラの tree-shaking が保守的になる。本ライブラリはトップレベル副作用がないので宣言できる。

**対応案**: `"sideEffects": false` を1行足す。

### 28. examples / デモページがない [未実装]

README のコード片だけで、動かして試せるものがない。

**対応案**: `examples/index.html`（IIFE 版を読み込む TODO リスト程度）を1枚置く。
ビルド後に `npx serve` で開けるようにし、README からリンクする。

---

## 優先度の目安

| 優先 | 項目 | 理由 |
|---|---|---|
| 高 | #8 プロパティ設定（input.value 等） | フォームを書くと即座に踏む |
| 高 | #17 For の同 key 新オブジェクト | immutable 更新が静かに壊れる |
| 中 | #1/#2 memo の lazy 化とグリッチ解消 | コアの質が上がるが書き換え規模が大きい |
| 中 | #16 For の同位置スキップ | 数行で大半の無駄が消える |
| 中 | #3 untrack / #4 equals / #27 sideEffects | 小さく足せて効果が確実 |
| 低 | #9 SVG / #21 shadow DOM / #22 prop | 必要になったときに |
| 低 | #25, #26, #28 インフラ整備 | 機能とは独立にいつでも |
