# ハイドレーション adopt の仕組み（#54 修正の解説）

このドキュメントは、`html` / `For` / `Show` の**ハイドレーション採用（adopt）**がどう動くかを、
TODO #54（カーソル / 順位モデルの破綻）の修正を題材に依存順で解説したもの。設計の「なぜ」を
残すのが目的。全体方針は `docs/ssr-hydration-plan.md`、残課題は `TODO.md` を参照。

関連シンボル: `src/hydration.ts`（カーソル基盤）、`src/html.ts`（`adoptTemplate` / `adoptChildren`）、
`src/for.ts`・`src/show.ts`（`forBody` / `showBody`）、`test/test-hydrate.ts`（#54-A/A'/B/C 回帰）。

---

## 見取り図（依存順）

1. 根本原因：タグ付きテンプレートの `${...}` は `html()` より**先に**評価される（eager 評価）。
2. 旧モデルと 3 症状（A: 入れ子の先食い / B: 複数ルート未配線 / C: 順位ドリフト）。
3. 新モデルの 3 本柱：
   - 3a. 兄弟方向カーソル（`claimElement` / `claimRange` / `withScope`）
   - 3b. 遅延 adopt（`deferAdopt` / `flushAdopt`）
   - 3c. 構造的走査（`adoptTemplate` / `adoptChildren`）
   - 3d. `withoutHydration`（新規行・枝の誤 claim 回避）
4. `For` / `Show` の分割（`forBody` / `showBody`）と遅延化。
5. 回帰テスト（どの症状を踏むか）。

---

## 1. 根本原因：タグ付きテンプレートは `html()` より先に評価される

```js
html`<ul class=${cls}>${For(items, key, render)}</ul>`
```

これは関数呼び出しの糖衣で、脱糖するとこうなる:

```js
html(
  ["<ul class=", ">", "</ul>"], // strings（静的部分）
  cls,                          // values[0]
  For(items, key, render),      // values[1] ← ここが先に「実行」される
);
```

JS は**全引数を評価し終えてから関数本体に入る**。よって順序は:

1. `cls`（変数参照）を評価。
2. **`For(items, key, render)` を実際に呼び出して**戻り値を得る。
3. **その後で**ようやく `html(strings, cls, ForResult)` の本体に入る。

つまり外側 `html` が「自分の枠（ルート・スコープ）」を確定させる**前に**、内側 `For` がもう
動き切っている。ハイドレーションでは両者とも「サーバ DOM のどこを担当するか」を**共有カーソル**
（`hydration.ts` の ambient な `cursor`）から読むため、この**逆順**が事故になる。

> 関数を渡す穴 `${() => count.value}` は「関数オブジェクトを作って渡すだけ」で本体は後で呼ばれる。
> 問題になるのは `For(...)` / `Show(...)` / `html(...)` のように**その場で呼び出して結果を得る**穴。

---

## 2. 旧モデルと 3 つの症状

### 旧カーソル

```js
interface Cursor {
  pointer: Node | null; // 次に claim する候補
  root: Node;           // DFS がこの内側だけを走る天井
}
```

`claimRange(name)` は `pointer` から **`nextInDoc`（文書順 DFS）で木を降りながら**マーカーを探した。
DFS なので要素の中へ潜っていくのが特徴（＝先食いを加速した）。

### 症状A: `For` / `Show` を `html` に入れ子にするとラッパ穴が配線されない

サーバ DOM:

```html
<ul class="box">
  <!--for-->
    <li><!--hole-->one<!--/hole--></li>
    <li><!--hole-->two<!--/hole--></li>
  <!--/for-->
</ul>
```

1. eager 評価で**まず `For(...)`** が実行され、`claimRange("for")` が `pointer`(=`<ul>`) から
   DFS で潜って `<!--for-->…<!--/for-->` を掴み、`pointer` を for 範囲の**先**へ進めてしまう。
2. **その後** `html()` 本体が走り、`claimRoot()` でルートを掴もうとするが `pointer` は既に飛んでいて
   `<ul>` を掴み損ね、`null`。
3. `html` は「採用ルートなし」とみなし、**捨てクローンを新規生成して配線**。

結果の非対称:

- 行（`<li>`）は `For` 自身が claim 済みなので**偶然 reactive に動く**。
- ラッパ `<ul>` の `class=${cls}` 穴は**捨てクローンに配線**され、`cls.value` を変えても実 DOM は
  変わらない。「動いてるのにラッパだけ静かに死ぬ」。

根因：**eager 評価された `For` が、外側 `html` がルートを掴む前に共有カーソルを先食いした**
（DFS で潜る設計が加速）。

### 症状B: 複数ルート（fragment）の 2 つ目以降が未配線

```js
html`<i>${a}</i><b>${b}</b>`
```

旧 `hydrate` は `claimRoot()` で**最初の 1 ルートだけ**掴み、`wireAdopt` も単一 `root` 前提だった。
`<b>` は誰も掴まず、その中の `${b}` 穴に対応する `<!--hole-->` も「見つからない」と mismatch になり
配線されない。

### 症状C: 余分なサーバ要素で属性穴がドリフトする

旧 `wireAdopt` は属性穴を「**フラットな文書順位**」で要素に当てていた。
「フラット」＝木構造を無視して全要素を一列に通し番号付け（`SHOW_ELEMENT` の TreeWalker や
`querySelectorAll("*")` の順序）。深さの違いが番号から消える。

```
テンプレ:  <div><x-card></x-card><b class=${cls}>hi</b></div>   要素順位 div=0, x-card=1, b=2
サーバ:    <div><x-card><span>projected</span></x-card><b class="box">hi</b></div>
           フラット走査 → [div, x-card, span, b] → div=0, x-card=1, span=2, b=3
```

`class=${cls}` 穴はテンプレ順位 2（`<b>`）。だが `serverEls[2]` は **`<span>`**。
`<x-card>` の中の 1 要素が番号を 1 つ消費し、以降が全部ドリフト。

> 症状A はタイミング（カーソル先食い）、症状C は**要素対応づけのモデル**（フラット順位）の問題で別物。

---

## 3. 新モデルの 3 本柱

### 3a. 兄弟方向カーソル（DFS をやめる）

```js
interface Cursor { pointer: Node | null; } // root（DFS の天井）は廃止
```

claim 系はすべて **`nextSibling` 方向にしか進まない**（木に潜らない）:

- `claimElement()`: `pointer` から兄弟方向に進み、最初の**要素**を返す（テキスト/コメントは飛ばす）。
- `claimRange(name)`: `pointer` から兄弟方向に `<!--name-->…<!--/name-->` の開閉ペアを掴む。
  同名が同じ兄弟レベルで入れ子になっても深さを数える。
- `withScope(parent, fn)`: 木を 1 段降りるときだけ使う。`pointer` を `parent.firstChild` にした
  **新しいカーソル**へ差し替えて `fn` を実行し、終わったら元へ戻す。

「潜る」のは `withScope` の専任。claim は常に同じ親の兄弟だけを見るので、`claimRange("for")` が
`<ul>` の中まで勝手に潜って先食いする旧 DFS の事故が**構造的に起きない**。

### 3b. 遅延 adopt（eager 評価の順序を引き戻す）

eager で「先に呼ばれてしまう」のは JS の都合で変えられない。なら**「実行はするが、カーソルには
まだ触らない」**ようにする。実行（呼ばれた時）と claim（flush された時）を分離する。

```js
// 採用処理を thunk に包み、空の DocumentFragment に紐づけて返す
deferAdopt(thunk): DocumentFragment
// 遅延フラグメントなら、紐づいた thunk を「今この瞬間のカーソル位置で」1 度だけ実行する
flushAdopt(value): unknown
// 値が遅延フラグメントか（外側 html の子走査が静的な子と見分ける）
isDeferred(value): boolean
```

ハイドレーション中、`html` / `For` / `Show` は採用処理を**その場で実行せず** `deferAdopt` で
返すだけ。誰が thunk を実行するか＝**カーソルを正しい位置に置ける駆動側**:

- **最上位**: `runHydration(container, fn)` が `fn()` の戻り値（外側 `html` の遅延フラグメント）を
  `flushAdopt`。このとき `pointer = container.firstChild`。
- **入れ子**: 外側 `html` の thunk が自分のルートを掴み `withScope` で降りた後、子穴の位置で
  内側の `For` / `Show` / `html` の遅延フラグメントを `flushAdopt`。

症状A を新モデルで追うと:

1. `For(...)` 実行 → `deferAdopt(...)` を返すだけ。**カーソル無傷**。
2. `html(...)` 実行 → これも `deferAdopt(...)` を返すだけ。
3. `runHydration` が `html` の thunk を flush → `claimElement()` で **`<ul>` を掴む**（先食いされて
   いない）。`class=${cls}` を実 `<ul>` に配線。
4. `withScope(<ul>)` で降り、子穴の位置で `For` の遅延フラグメントを flush → **ここで初めて**
   `For` の `claimRange("for")` が `<ul>` 内側のカーソルから走り、行を採用。

「`html` が先に枠を確定 → その内側で `For` が claim」という自然な順序が、遅延 + 駆動側 flush で実現。

### 3c. 構造的走査（`adoptTemplate` / `adoptChildren`）

`html()` がハイドレーション中に返す thunk の本体:

```js
if (isHydrating()) return deferAdopt(() => adoptTemplate(desc, values));
```

`adoptTemplate`:

1. `buildAdoptLookup(desc)`: テンプレの各**ノード参照**から穴を引く表を作る
   （`attrHolesByEl: Map<Element, Hole[]>` と `childHoleByComment: Map<Comment, 子穴>`）。
   旧モデルの「混在通し番号 → 要素順位」というフラット計算を捨て、**参照で直接引く**のでドリフトしない。
2. `adoptChildren(...)` を呼ぶ（本体）。
3. 戻り値は「最初に claim したルート要素」。
4. どのルートも掴めなければ DEV 警告して新規生成にフォールバック。

`adoptChildren`（テンプレ親と実 DOM を並走。`template*`=テンプレ側 / `server*`=実 DOM 側）:

```js
function adoptChildren(templateParent, values, lookup, refs): Element | null {
  let firstRoot = null;
  for (let templateChild = templateParent.firstChild;
       templateChild;
       templateChild = templateChild.nextSibling) {

    if (templateChild is TEXT) continue;          // テンプレの静的テキストは配線不要

    if (templateChild is COMMENT) {               // 子穴 <!--signals-hole-N--> の位置
      const hole = lookup.childHoleByComment.get(templateChild);
      if (!hole) continue;                        // 著者の静的コメント
      const value = values[hole.index];
      if (関数 or signal)        → claimRange("hole") して adoptChild   // reactive 子
      else if (isDeferred(value)) → flushAdopt(value)                  // 入れ子 For/Show/html
      // それ以外（静的な子）はカーソルを触らない（次の claim が前方走査で吸収）
    }
    else if (templateChild is ELEMENT) {
      const serverEl = claimElement();            // 実 DOM の同位置の要素を兄弟方向で掴む
      if (firstRoot == null) firstRoot = serverEl;
      // DEV: serverEl.tagName と templateEl.tagName を照合（旧 #52 の mismatch 検出）
      templateEl の属性穴を serverEl に配線
      withScope(serverEl, () => adoptChildren(templateChild, ...));    // ★1段潜って再帰
    }
  }
  return firstRoot;
}
```

- **症状B が直る**: トップレベルも「ある親の子の並び」として同じループで処理。`<i>` も `<b>` も順に
  `claimElement` で掴み、それぞれ `withScope` で中の穴を配線。「ルートは 1 つ」という前提が無い。
- **症状C が直る**: `<x-card>` を `claimElement` で掴んだ後 `withScope(<x-card>)` で潜って再帰するが、
  テンプレの `<x-card>` は**子が無い**のでループは 1 周もせず、**サーバの `<span>` を誰も
  `claimElement` しない**。`<x-card>` の処理後はカーソルが `<div>` のスコープに戻り、次の兄弟 `<b>` を
  掴む。`<span>` は `<x-card>` のスコープ内にいて `<div>` の子の列（`x-card`→`b`）に混ざらない。
  node 2c の「親ごとに数える列が分かれている」が `withScope` の入れ子として実装されている。

兄弟カーソル（3a）が効いている点に注意: `claimElement` / `claimRange` が兄弟方向にしか進まないから、
`withScope` で区切った親の範囲を超えて潜らない。**潜るのは `withScope` の明示再帰のときだけ**。

> 静的な子穴（`${"文字列"}` 等、マーカー無し）はカーソルを進めない。サーバ DOM 上のその静的内容は、
> 次の `claimElement` / `claimRange` の前方走査で読み飛ばされて自然に吸収される。

### 3d. `withoutHydration`（新規行・枝の誤 claim 回避）

サーバ DOM に対応物が無いノード（`For` でデータが増えた新規行、`Show` の mismatch 枝など）を作るとき、
ハイドレーション中のままだと `html` が遅延 → claim 経路に入り、無関係な既存ノードを誤って claim したり
空のまま描かれなかったりする。新規行は「ゼロから新規生成（CSR と同じ）」にしたい。

```js
export function withoutHydration(fn) {
  const prev = cursor;
  cursor = null;        // この間 isHydrating() が false
  try { return fn(); }
  finally { cursor = prev; }
}
```

カーソルが `null` の間は `isHydrating()` が `false` → 中の `html` / `For` / `Show` は通常の新規生成。
**「採用しない」を明示的に選ぶスイッチ**。

ハイドレーション中の 3 分岐:

| 状況 | 道具 | 意味 |
|---|---|---|
| 既存ノードを使い回す | `flushAdopt` / `claimRange` 等 | サーバ DOM を採用 |
| カーソル位置を一時的に合わせる | `withRoot` | 「次はこの既存行から claim」 |
| 対応物が無いので新規生成 | `withoutHydration` | 「ここだけ通常描画に戻す」 |

---

## 4. `For` / `Show` の分割（forBody / showBody）と遅延化

旧 `For` は入口で `claimRange` をその場で呼んでいた（＝ eager 先食いの原因）。これを
**「環境判定（入口）」と「描画ロジック（本体）」の分離**で解く。claim は本体の**引数**として注入する。

```js
export function For(items, keyFn, render) {
  const itemsFn = toAccessor(items);
  if (typeof document === "undefined") { /* サーバ: emit 文字列を返す */ }

  // ハイドレーション: その場で claim せず、claim 込みの本体呼び出しを thunk に包む
  if (isHydrating())
    return deferAdopt(() => forBody(itemsFn, keyFn, render, claimRange(RANGE.for)));

  // CSR: adopted=null で本体を即実行
  return forBody(itemsFn, keyFn, render, null);
}
```

肝: `claimRange(RANGE.for)` は **`deferAdopt` の thunk の中**にある。`For(...)` 呼び出し時には実行されず、
**駆動側が `flushAdopt` した瞬間**に走る。そのときカーソルは外側 `html` が `withScope` で降りた後なので
正しく `<!--for-->` の位置にある。遅延（3b）が `claimRange` の実行タイミングを適切な位置へ運ぶ。

`forBody` の行ノード用意は node 3d の 3 分岐:

```js
const row = rows?.[i];                         // 採用すべき既存行（あれば）
if (row) {
  withRoot(row, () => flushAdopt(make()));     // ① 既存行を採用（行内 html を flush して adopt）
  return row;
}
return (isHydrating() ? withoutHydration(make) : make()) as Node;  // ② 新規行は新規生成
```

`Show` も同型: `Show`（入口）＋ `showBody`（本体、`adopted` を引数で受ける）に分割し、入口で
ハイドレーション時だけ `deferAdopt(() => showBody(..., claimRange(RANGE.show)))` を返す。本体は
「既存中身があれば `withRoot` + `flushAdopt`、無ければ `withoutHydration` で新規生成して `start`/`end`
の間へ挿入」。

---

## 5. 回帰テスト（`test/test-hydrate.ts`）

旧実装では次の 5 件が fail（修正後は全て pass）。各テストがどの症状を踏むか:

- **#54-A**: `For` を `html` テンプレに入れ子にしてもラッパ属性と行を両方採用する（症状A）。
  `cls.value` を変えて**実** `<ul>` の class が変わることを確認（捨てクローンでない証拠）。
- **#54-A'**: `Show` を `html` に入れ子にしてもラッパ属性と中身を採用する（症状A の Show 版）。
- **#54-B**: 複数ルート（fragment）テンプレートの全ルートを採用・配線する（症状B）。
  2 つ目のルート `<b>` の穴も更新されることを確認。
- **#54-C**: 葉要素の中にサーバ投影があっても後続の属性穴がずれない（症状C）。
  `class` 穴が `<b>` に当たり、投影済み `<span>` へ誤配線されないことを確認。
- **#54（入れ子 html）**: 子穴に入れ子の `html` 断片を入れても採用・配線できる。

いずれも「ハイドレーション中の childList ミューテーションが 0 件（＝作り直していない）」「採用後に
signal 更新が反映される」を併せて確認している。

---

## まとめ（1 行ずつ）

- 根本原因は eager 評価＝外側 `html` より内側 `For`/`Show`/`html` が先に走ること。
- 解は「実行（呼ばれた時）と claim（flush された時）の分離」＝**遅延 adopt**。
- カーソルは DFS をやめ**兄弟方向**にし、降りるのは `withScope` の専任にした。
- 要素対応づけはフラット順位をやめ、テンプレ木と実 DOM 木を同時に降りる**構造的走査**にした。
- これで症状A（先食い）・B（複数ルート）・C（順位ドリフト）が一括で解消し、入れ 子 `html`・
  要素タグの mismatch 検出（旧 #52）も同経路で得られた。
