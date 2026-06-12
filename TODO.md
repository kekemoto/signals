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

### 29. dispose 済みの effect が「復活」する [バグ寄り]

`dispose()` は購読解除と親からの切り離しはするが、`pendingEffects` に積まれた分は
取り消さず、run 自体に「死んだ」印もない。そのため flush 中に先行の effect
（例: `Show` の切り替え）が後続の effect を dispose しても、後続はそのまま実行され、
signal を読んで再購読＝生き返る。「同じ signal に Show と行内 effect の両方が
ぶら下がる」よくある構成で実害が出る。

**対応案**: `Computation` に `disposed` フラグを1つ持たせ、`dispose()` で立てて
flush（または `run` の冒頭）で弾く。数行で済む。

### 30. `memo` の `cache!` 遅延初期化トリック [改善]

「effect が同期実行されることに依存して初回だけ signal を作る」のは読み手に
2段の前提を要求する。また初回の `fn()` が throw すると `cache` が未定義のまま
`read()` が TypeError になる。

**対応案**: `let cache: Signal<T> | undefined` ＋ 読み口での未初期化チェック、
あるいは sentinel 値を使った素直な初期化に書き換える。挙動は変えずに前提を減らせる。

### 31. `isSignal` が duck typing（`peek` を持てば signal 扱い） [バグ寄り]

`peek` メソッドを持つ無関係なオブジェクト（イテレータ系ライブラリ等）を穴に渡すと
誤って reactive 扱いになる。

**対応案**: `const SIGNAL = Symbol()` のブランドプロパティを signal に付けて判定する。
仕様として明確になり、型ガードも正確になる。

### 32. `memo` の読み口が `signal` と非対称 [改善]

signal は `.value` / `.peek()`、memo は関数呼び出しで `peek` なし・`dispose`
プロパティ付き。「派生もただの関数」という思想は良いが、一貫性がない。

**対応案**: `Memo` にも読み取り専用 `value` と `peek()` を生やし、`Signal` としても
読めるようにする。穴への直渡し・`isSignal` 判定・untrack 代替がすべて一貫する。

## node.ts（h / html 共通）

### 33. 真偽値の扱いが属性と子で非対称・aria-\* で困る [バグ寄り]

属性では `false` =削除・`true` =空文字だが、子では `false` =非表示なのに `true` は
`"true"` と描画される。さらに `aria-hidden: false` のような「文字列の "false" を
設定したい」属性（aria-\*/data-\*）では削除されてしまい回避策がない。

**対応案**: 子の `true` も非表示にして対称にする。aria-\*/data-\* は `setAttr` で
真偽値を文字列化する例外分岐を足すか、非対応と README に明記する。

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

### 36. `tags` の kebab 変換が標準タグを壊す（`tags.textArea` → `<text-area>`） [バグ寄り]

`tags.textArea` が `<textarea>` ではなく未知の Custom Element `<text-area>` になる。
タイポと違いユーザーは「正しい camelCase を書いた」つもりなので、静かに壊れる罠。

**対応案**: 小文字化のみで `HTMLElementTagNameMap` のタグ名に一致するものは
kebab 変換しない、という1分岐を `toKebab` の前に足す。

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

### 39. `Show` の `render` が null を返すと dispose が捨てられる [バグ寄り]

`make()` が null を返した場合、`createRoot` で作った dispose を `current` に
保存しないため、render 内で張られた effect が二度と畳まれずリークする。

**対応案**: node の有無にかかわらず常に `{ node, dispose }` を current として持つ。

### 40. `createRoot` の `let dispose!:` 受け渡し定型の重複 [改善]

non-null assertion 込みの同じ定型が `for.ts` / `show.ts` の2か所にある。

**対応案**: `function rooted<T>(fn: () => T): { value: T; dispose: () => void }` の
ような小ヘルパーに括り出し、`For` / `Show` 本体を宣言的にする。

## element.ts

### 41. 再接続すると slot 内容が永久に消える [バグ寄り]

接続時に light DOM の子を退避し、dispose 時に `replaceChildren()` で全消去するため、
再接続時の setup は空の lightChildren で走る。「再接続で状態リセット」は仕様どおり
でも、ユーザーが書いた slot の子まで消えるのは予想外。

**対応案**: 退避した元の子を dispose 時に host へ戻す。再接続が初回接続と同じ意味になる。

---

## 優先度の目安

| 優先 | 項目 | 理由 |
|---|---|---|
| 高 | #29 dispose 済み effect の復活 | Show + 行内 effect の構成で誤動作する |
| 高 | #39 Show の render null でリーク | dispose が捨てられ effect が畳まれない |
| 高 | #8 プロパティ設定（input.value 等） | フォームを書くと即座に踏む |
| 高 | #17 For の同 key 新オブジェクト | immutable 更新が静かに壊れる |
| 中 | #1/#2 memo の lazy 化とグリッチ解消 | コアの質が上がるが書き換え規模が大きい |
| 中 | #16 For の同位置スキップ | 数行で大半の無駄が消える |
| 中 | #3 untrack / #4 equals | 小さく足せて効果が確実 |
| 中 | #36 tags.textArea の罠 / #33 真偽値の非対称 | 静かに壊れる仕様の罠。1分岐で直る |
| 低 | #9 SVG / #21 shadow DOM / #22 prop | 必要になったときに |
| 低 | #30〜#38 の [改善] 各種 | 可読性・一貫性。挙動は変わらない |
| 低 | #26, #28 インフラ整備 | 機能とは独立にいつでも |
