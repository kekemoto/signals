# @kekemoto/signals

**ビルド不要・依存ゼロで、ページにリアクティビティを追加するための小さなライブラリ。**
`<script>` を1行足すだけで、signal ベースのリアクティブな DOM・Web Components が使える。
signal による細粒度更新と素直な書き心地を足したものを目指している。

- **ビルド不要** — トランスパイラもバンドラも要らない。`<script src>` か `import` で即動く。
- **依存ゼロ** — ランタイム依存なし。TypeScript 製で型定義（`.d.ts`）を同梱。
- **MPA / アイランド向き** — SPA で全部を抱え込まず、サーバーが出した HTML に必要な部品だけ足す、という使い方もできる。

## まず動かす — `html` タグ付きテンプレート

1つの HTML ファイルに貼るだけで動く最小例。インストールもビルドも要らない。

```html
<!doctype html>
<script src="https://cdn.jsdelivr.net/npm/@kekemoto/signals"></script>
<script>
  const { signal, html } = Signals;

  const count = signal(0);
  document.body.append(html`
    <button onClick=${() => count.value++}>
      clicked ${count} times
    </button>`);
</script>
```

`count.value++` するだけでボタンのテキストが書き換わる。仮想 DOM の差分も全体再レンダーも
なく、`${count}` の箇所だけがピンポイントで更新される（細粒度更新）。

## まず動かす — `defineElement` で部品にする

ゼロから組む自己完結した部品は Custom Element が向く。`defineElement` で中身を定義し、
HTML に `<x-counter>` を置くだけで、接続時に動き出す。中身は `html` で組める。
これも1つの HTML ファイルに貼るだけで動く（グローバル変数 `Signals` を使う形）。

```html
<!doctype html>
<script src="https://cdn.jsdelivr.net/npm/@kekemoto/signals"></script>
<script>
  const { signal, defineElement, html } = Signals;

  defineElement("x-counter", () => {
    const count = signal(0);
    return html`<button onClick=${() => count.value++}>count: ${count}</button>`;
  });
</script>

<!-- 定義したタグを置くだけ（サーバーが出した HTML でも同じ） -->
<x-counter></x-counter>
```

---

## インストール

```bash
npm install @kekemoto/signals
```

## ブラウザ / CDN

### 素の `<script>`（グローバル変数 `Signals`）

ビルド不要で一番手軽。IIFE 版を読み込むと `window.Signals` にすべての API が生える
（[まず動かす](#まず動かす)の例がこれ）。

```html
<script src="https://cdn.jsdelivr.net/npm/@kekemoto/signals"></script>
<script>
  const { signal, html, defineElement } = Signals; // すべて Signals 配下
</script>
```

> jsDelivr / unpkg はパッケージ名だけで IIFE 版（`dist/signals.global.min.js`）を返す。
> バージョン固定は `.../@kekemoto/signals@0.1.0` のように指定する。

### ES モジュール（`type="module"` + `import`）

モダンな書き方。CDN が ESM を配信するので `import` でそのまま使える。

```html
<script type="module">
  import { signal, html } from "https://esm.sh/@kekemoto/signals";
  // jsDelivr なら: "https://cdn.jsdelivr.net/npm/@kekemoto/signals/+esm"
  // ...
</script>
```

## コア API

### `signal(initial)`

値を持つリアクティブセル。`.value` で読み書き、`.peek()` で追跡せずに読む。

```js
import { signal } from "@kekemoto/signals";

const count = signal(0);
console.log(count.value); // 0
count.value++;
console.log(count.value); // 1
console.log(count.peek()); // 1（依存登録なし）
```

### `effect(fn)`

依存が変わると自動再実行される副作用。戻り値を呼ぶと購読解除（dispose）。

```js
import { signal, effect } from "@kekemoto/signals";

const name = signal("Alice");
const dispose = effect(() => {
  console.log("hello,", name.value);
});
// → "hello, Alice"

name.value = "Bob";
// → "hello, Bob"

dispose(); // 購読解除
name.value = "Carol"; // 何も起きない
```

### `batch(fn)`

複数の変更をまとめ、`effect` の再実行を1回に抑える。

```js
import { signal, effect, batch } from "@kekemoto/signals";

const a = signal(1), b = signal(2);
effect(() => console.log(a.value + b.value));
// → 3

batch(() => {
  a.value = 10;
  b.value = 20;
});
// → 30（1回だけ再実行）
```

### 派生は「ただの関数」で書く

このライブラリに `memo` / `computed` はない。派生値は**普通の関数**で書く。関数は中間ノードを作らず、読まれた瞬間に最新値を計算するので、lazy（読まれなければ計算しない）でグリッチも起きない。

```js
import { signal, effect } from "@kekemoto/signals";

const a = signal(3), b = signal(4);
const hypotenuse = () => Math.sqrt(a.value ** 2 + b.value ** 2);

effect(() => console.log(hypotenuse())); // → 5
a.value = 6; // → 10
```

### `cached(fn)` — キャッシュ・共有・value-cutoff が要るとき

重い派生を複数箇所で読むので**計算を共有したい**、入力は変わるが結果が同じなら**下流を止めたい**（value-cutoff）——そういうホットパスだけ、派生関数を `cached` で包む。

```js
import { signal, effect, cached } from "@kekemoto/signals";

const w = signal(2), h = signal(3);

// const area = () => w.value * h.value;       // 素の派生（出発点）
const area = cached(() => w.value * h.value);  // ↑ をホット化（呼び出し側 area() は無変更）

effect(() => console.log(area())); // → 6
effect(() => console.log(area())); // 再計算なし・キャッシュを共有
w.value = 6;                       // → 両 effect に 18（=6*3）が流れる。計算は1回だけ
```

- **計算の共有** — 何箇所から読んでも、入力変化ごとに1回しか計算しない
- **value-cutoff** — 結果が前と同じなら（内部 signal の `Object.is` で）下流は走らない
- **代償** — eager（読まれなくても入力変化で計算する）／生入力と同じ `effect` で読むと二重実行

`cached` の戻り値は**ただの `() => T` 関数**。`.value` も `.dispose` も生やさないので、素の派生関数と完全に入れ替え可能（テンプレートの穴にもそのまま渡せる）。

- **追跡せずに読みたい**（`peek` 相当）→ `untrack(area)`
- **明示的に止めたい** → 内部 `effect` は所有ツリーに乗るので、`effect` の中で作れば親と一緒に畳まれる。トップレベルなら `createRoot` で囲んで返り値の `dispose` を握る。

> **dev 警告**: `cached` は dispose ハンドルを返さないため、オーナー（囲む `effect` / `createRoot`）が無い場所で作ると内部 `effect` が孤児になり回収できずリークする。dev ビルド（`process.env.NODE_ENV !== "production"`）ではこの状況を `console.warn` で知らせる。アプリ寿命の派生など意図的に永続させたい場合は `createRoot` で囲めば警告は消える（本番ビルドでは警告自体が消える）。

> 中身は `signal`（結果置き場）+ `effect`（入力が変われば計算して書き込む）の薄い糖衣。軽い派生は関数のままで十分で、`cached` はホットパスでだけ使う。

### `store(obj)`

オブジェクトの **葉（プリミティブ等の非オブジェクト値）を `signal` に置き換えた、同じ形の木**を返す。ネストしたオブジェクト・配列は形を保ったまま再帰する。

```js
import { store, effect } from "@kekemoto/signals";

const state = store({ user: { name: "Alice", age: 20 }, ok: true });

effect(() => console.log(state.user.age.value)); // → 20

state.user.age.value++; // → 21（この葉を読む effect / 穴だけ反応）
```

葉が `signal` そのものなので、`` html`...` `` の穴には **`() =>` で包まず直接渡せる**（`html`<span>${state.user.name}</span>``）。読み書きは `.value` 経由になる。

> **構造変化は追跡しない** — キーの追加・削除や配列の `push` / `splice` は反応しない（`signal` は葉に張るため）。構造ごと差し替えたいなら `signal(obj)` を丸ごと持つ方が向く。

### `onCleanup(fn)`

`effect` の再実行直前・dispose 時に呼ばれる後始末を登録する。

```js
import { signal, effect, onCleanup } from "@kekemoto/signals";

const id = signal(1);
effect(() => {
  const controller = new AbortController();
  fetch(`/api/item/${id.value}`, { signal: controller.signal });
  onCleanup(() => controller.abort()); // id が変わる前・dispose 時にキャンセル
});
```

### `onError(handler)`

いまのスコープ（`effect` / `createRoot` の根）に **エラーバウンダリ** を張る。このスコープと
その配下の `effect` が投げた例外は、所有ツリーを根に向かって辿り、最初に見つかった `onError`
ハンドラへ届く。どのスコープにもハンドラが無ければ、従来どおり例外は投げ直される
（`signal` を書いた側へ飛ぶ）。`onCleanup` と同じく `effect` の再実行ごとに張り直される。
オーナーの無いトップレベルで呼ぶとハンドラは登録されず（バウンダリを張れず）、dev ビルドでは
警告が出る — `effect` の中か `createRoot` の中で呼ぶこと。

```js
import { createRoot, effect, onError, signal } from "@kekemoto/signals";

const userId = signal(1);

createRoot(() => {
  onError((err) => console.error("画面の更新でエラー:", err)); // アプリ全体のバウンダリ

  effect(() => {
    if (userId.value < 0) throw new Error("不正な userId");
    // ... 描画など、投げうる処理 ...
  });
});

userId.value = -1; // effect の例外は↑のハンドラへ届く（書いた側へは飛ばない）
```

ハンドラは「壊れた `effect` の再実行を肩代わりする」ものではなく、例外を1か所に集める通知口。
状態を安全な値へ戻すなどの回復は、ハンドラの中で明示的に行う。ハンドラ自身が投げた例外は、
1つ上のスコープのバウンダリへ送られる。

### `untrack(fn)`

`fn` の実行中だけ依存追跡を止める。`effect` の中で「依存登録せずに signal を読みたい」
ときに使う（読んだ signal が変わっても再実行されない）。単一セルなら `.peek()` で足りるが、
関数呼び出しをまたいで複数の signal を素通しで読む場面はこちらが素直。

```js
import { signal, effect, untrack } from "@kekemoto/signals";

const value = signal(0);
const verbose = signal(true);

effect(() => {
  // value が変わったときだけログ。verbose の切り替えでは再実行させたくない
  if (untrack(() => verbose.value)) console.log("value:", value.value);
});

verbose.value = false; // 再実行されない（追跡していない）
value.value = 1;       // 再実行される（追跡している）
```

`untrack` は追跡を止めるだけで所有ツリー（現在のスコープ）は触らないので、`untrack` の
中で作った `effect` は従来どおり現在の `effect` の子としてぶら下がる。

### `createRoot(fn)`

所有ツリーの独立した根を作る。`fn` に渡される `dispose` を呼ぶと配下をまとめて畳める。

```js
import { createRoot, effect, signal } from "@kekemoto/signals";

const stop = createRoot(dispose => {
  effect(() => { /* ... */ });
  return dispose; // 外から呼べるよう返す
});

stop(); // 配下の effect をすべて解放
```

### `getOwner()` / `runWithOwner(owner, fn)`

いまの所有ツリーの親を取り出し（`getOwner`）、あとからその親の下で関数を実行する
（`runWithOwner`）。`setTimeout` / `await` / `fetch` のコールバックの中で `effect` や
`cached` を作ると、その時点ではもう所有ツリーの親がいないため **孤児**になり、親を
dispose しても畳まれずリークする。コールバックに入る前に `getOwner()` で親を掴んでおき、
コールバックの中で `runWithOwner` に渡すと、元のツリーへ復帰してそこで作った `effect` を
親に紐づけられる（＝親 dispose で一緒に畳まれる）。

```js
import { effect, getOwner, onCleanup, runWithOwner } from "@kekemoto/signals";

effect(() => {
  const owner = getOwner();          // いまの親を掴む
  const id = setTimeout(() => {
    runWithOwner(owner, () => {       // 元のツリーへ復帰
      effect(() => { /* この effect は親と一緒に畳まれる */ });
    });
  }, 1000);
  onCleanup(() => clearTimeout(id));
});
```

`runWithOwner` は所有（誰の子か）だけを復帰し、依存追跡（誰の依存か）は止める（`untrack`
相当）。非同期文脈には「いま依存を集めている effect」が無いので、`fn` 内での signal 読みは
依存にならない。`owner` が dispose 済みなら再アタッチせず（死んだ枝へのぶら下げを防ぐ）、
dev ビルドでは `console.warn` で知らせる。

## DOM API

> **reactive な穴の渡し方** — `` html`...` `` の穴に **関数**（`() => count.value`）か
> **シグナルそのもの**（`count`）を渡すと reactive になる。単一のシグナルなら `count`、
> 複数の値を組み合わせる派生は `() => a.value + b.value` のように関数で包む
> （`${...}` はその場で評価されるため、合成式は関数が必須）。

### `` html`...` ``

タグ付きテンプレートリテラルで reactive な DOM を作る（lit / htm 風）。
静的な構造は `<template>` で一度だけパースし、`${...}` の穴だけを配線する。
関数 / シグナルの穴は reactive（属性・子）になり、`onXxx=${fn}` はイベント、
`.foo=${v}` は DOM プロパティ代入になる。

```js
import { html, signal } from "@kekemoto/signals";

const count = signal(0);

const el = html`
  <div class="box">
    <span>count: ${count}</span>
    <button onClick=${() => count.value++}>+1</button>
  </div>`;

document.body.append(el);
```

- 関数 / シグナルの穴は reactive、それ以外は静的（`null` / `false` は属性を外す・子を描かない）。
- 属性は丸ごと（`class=${fn}`）でも部分（`class="box ${fn}"`）でも穴を置ける。
- `onXxx=${fn}` はイベント、`.foo=${v}` は DOM プロパティ代入、予約属性 `ref=${fn}` は**作った要素を受け取る callback**（後述）。
- 子の穴には文字列・数値のほか、`Node`・配列・ネストした `` html`...` `` を差し込める。
- 子の関数穴は `Node` / 配列も返せる。素の `.map` でリスト、三項演算子で条件分岐が書ける。
- ルート要素が1つならその要素を、複数なら `DocumentFragment` を返す。

> **属性とプロパティの振り分け**: 既定では値を**属性**として設定し（文字列化される）、
> **DOM プロパティ**へ入れたいときだけ**属性名に `.` を付ける**。値の型では判定しない（明示一本）。
>
> ```js
> // 属性（文字列化。null / false は属性を外し、true は空文字）
> html`<a href=${url} aria-hidden=${hidden}></a>`;
>
> // DOM プロパティ。オブジェクト・配列などリッチな値もそのまま渡せる（Custom Element の口）
> html`<x-list .items=${items}></x-list>`;   // el.items = items.value（シグナル直渡し）
> ```
>
> フォーム要素の **`value` / `checked` / `selected`** は、属性だと「初期値」しか変えられず
> ユーザー入力後は属性とプロパティが乖離する。signal の変更を常に画面へ反映したいなら
> プロパティとして渡す（穴と同じく**シグナル直渡し**でよい）:
>
> ```js
> html`<input .value=${text}>`;            // signal 直渡し。入力後も signal の変更が反映される
> html`<input value=${"既定値"}>`;         // 初期値だけ（入力後は更新しても効かない）
> ```
>
> プロパティは値を丸めず素のまま代入する。`null` を空にしたいなら
> `.value=${() => text.value ?? ""}` のように呼び出し側で処理する（ここは派生なので関数で包む）。

> **`class` / `style` はオブジェクトでも渡せる**。文字列形と同じく **属性を丸ごと置き換える**もので、
> オブジェクトはそれを構造的に書けるだけ。`class` は **真のキーだけ**を space 結合し、`style` は
> **`el.style` へ個別代入**する（キャメルケース `fontSize` も、ハイフン入りの `font-size` /
> CSS カスタムプロパティ `--gap` も書ける）。関数 / シグナルで包めば reactive になり、丸ごと置換
> なので `style` は更新で消えたキーも inline から自動で外れる。
>
> ```js
> html`<div class=${{ active: isOn, disabled: false }}></div>`;  // → class="active"
> html`<div style=${{ color: "red", fontSize: "12px" }}></div>`; // → el.style に個別代入
> html`<div class=${() => ({ active: on.value })}></div>`;       // reactive（関数で包む）
> html`<div style=${() => ({ color: c.value })}></div>`;
> ```
>
> オブジェクト形は**穴まるごと1つ**の位置でだけ効く。部分埋め込み（`class="box ${obj}"`）は
> 従来どおり文字列化されるので、その場合は文字列を渡す。

> **`ref=${fn}`** に関数を渡すと、**要素が完成した後（属性・子の配線まで済んだ状態）に1度だけ**
> その要素を受け取れる（戻り値では取れないテンプレート内側の要素にも届く）。reactive ではない
> （要素1つにつき1回）。後始末が要るなら callback 内で `onCleanup` を使う。
>
> ```js
> html`<input ref=${(e) => e.focus()} />`;
> ```

```js
const todos = signal([{ id: 1, text: "牛乳" }, { id: 2, text: "原稿" }]);
const ok = signal(false);

const view = html`
  <div>
    <ul>${() => todos.value.map(t => html`<li>${t.text}</li>`)}</ul>
    ${() => (ok.value ? html`<p>OK</p>` : null)}
  </div>`;
```

> 子の関数穴は更新のたびに範囲を**全部作り直す**（除去された中身の `effect` は自動 dispose）。
> 並べ替え・挿入しても行の状態（input・フォーカス・行ローカル signal）を保ちたいリストは、
> key 付き差分の `For` を子の穴に置く。

### `For(items, keyFn, render)`

key 付きリスト差分描画。存在し続ける行の `effect` は畳まれない。
第1引数は**配列のシグナルそのもの**でも、配列を返す関数（`() => items.value`）でもよい。

`render(item, index)` の `item` / `index` は **accessor（`() => 値`）** で渡される。
行内では `() => item().text` のように穴で読む（直接 `item.text` ではない）。こうすると、
行ノードを使い回したまま次の2つが正しく反映される。

- **同じ key で中身が新しいオブジェクトに差し替わった更新**
  （`items.value.map(x => ({ ...x, done: true }))` のような immutable 更新）でも、行内の穴が更新される。
- **並べ替え・挿入・削除で位置が変わった**とき、`index()` も追従する（順位表示などに使える）。

```js
import { For, html, signal } from "@kekemoto/signals";

const items = signal([
  { id: 1, text: "foo" },
  { id: 2, text: "bar" },
]);

const list = html`<ul>
  ${For(
    items,                  // signal を直接渡せる（() => items.value でも可）
    item => item.id,
    (item, index) => html`<li>${() => `${index() + 1}. ${item().text}`}</li>`, // item / index は accessor
  )}
</ul>`;
```

### `Show(when, render, fallback?)`

条件表示。真偽が切り替わったときだけ中身を作り直す（内部の `effect` も dispose される）。
第1引数は**シグナルそのもの**でも、真偽を返す関数（`() => loggedIn.value`）でもよい。

```js
import { Show, html, signal } from "@kekemoto/signals";

const loggedIn = signal(false);

const view = html`<div>
  ${Show(
    loggedIn,               // signal を直接渡せる（() => loggedIn.value でも可）
    () => html`<p>ようこそ</p>`,
    () => html`<p>ログインしてください</p>`,
  )}
</div>`;
```

`render` は「真だった値を返す accessor」を受け取る（Solid 同様）。`when` が値を返すなら、
その値が `null` 除去された形で渡るので、render 側で再度 null チェックを書かなくてよい。

```js
const user = signal(null); // { name } | null

const view = html`<div>
  ${Show(
    () => user.value,                                  // 真なら user オブジェクトが渡る
    (value) => html`<p>ようこそ ${() => value().name}</p>`, // value() は null でない user
  )}
</div>`;
```

### 使い分け — 関数穴 / `For` / `Show`

**基本は子の関数穴でよい。** `${() => list.value.map(...)}` でリスト、
`${() => cond.value ? a : b}` で条件分岐が、コンポーネントを足さずに書ける。
関数穴は更新のたびに範囲を**全部作り直す**ので、次のどちらかに当てはまるときだけ
`For` / `Show` に持ち替える。

- **`For`** — リストで「状態を保ちたい」または「行数が多い」とき。
  key 付き差分で、変わった行だけ動かす（並べ替え・挿入で input・フォーカス・
  行ローカル signal が保たれ、無関係な行を作り直さない）。
  逆に毎回まるごと差し替えてよい静的なリストなら関数穴 + `.map` で十分。

- **`Show`** — 条件表示で「真のあいだ部分木を据え置きたい」とき。
  真偽が**反転したときだけ**作り直すので、(1) 表示中の状態（input・フォーカス等）を保てる、
  (2) 条件のソースが頻繁に変わっても真偽が同じなら大きな部分木を作り直さずに済む。
  単純な boolean の出し入れだけなら関数穴の三項で足りる。

### `defineElement(name, setup, options?)`

`setup` の中身を持つ Custom Element（Web Component）を登録する。
接続時に `createRoot` を張って `setup` を1回呼び、返した DOM をマウントする。
切断時にその root を dispose するので、`html` / `For` / `Show` が張った `effect` が孤児に
なってリークしない。

```js
import { defineElement, html, signal } from "@kekemoto/signals";

defineElement("x-counter", () => {
  const count = signal(0);
  return html`
    <div>
      <span>${count}</span>
      <button onClick=${() => count.value++}>+1</button>
    </div>`;
});

document.body.append(document.createElement("x-counter"));
// または HTML に直接 <x-counter></x-counter>
```

`setup` は文脈オブジェクト `ctx` を1つ受け取る。`ctx.host`（要素自身）と `ctx.prop`
（外部からの入力を読むヘルパー）が入っているので、必要なものを分割代入で取り出して使う。

**入力 → signal**: `ctx.prop(name, initial?)` は、外部からの入力を映す `signal` を返す。
入力経路は2つあり、どちらも同じ signal に合流する:

- **プロパティ代入** — host に accessor を張るので、`el.name = v` がそのまま signal に入る。
  オブジェクト・配列などリッチな値もそのまま通る（`html` の `.foo=${...}` のリッチな値もこの経路で届く）。
  upgrade 前（接続前）に代入されていた値も初期値として拾う。
- **属性** — `MutationObserver` で観測し、変更を**文字列のまま** signal に流す
  （属性削除は `null`）。静的 HTML の `name="..."` は初期値として読む。型変換はしないので、
  数値などが欲しければ読む側で変換する。

初期値の優先順は「upgrade 前のプロパティ > 静的 HTML の属性 > `initial`」。
accessor / observer は dispose 時（切断確定）に自動で外れる。

```js
defineElement("x-greet", ({ prop }) => {
  const name = prop("name", "?");
  return html`<p>hello ${name}</p>`;
});
// <x-greet name="Alice"></x-greet>  → "hello Alice"
// el.setAttribute("name", "Bob")    → "hello Bob"（属性経由）
// el.name = "Carol"                 → "hello Carol"（プロパティ経由）

defineElement("x-list", ({ prop }) => {
  const items = prop("items", []); // リッチな値はプロパティ経由で届く
  return html`<ul>${() => items.value.map((x) => html`<li>${x}</li>`)}</ul>`;
});
// html`<x-list .items=${data}>` / el.items = [...] で流し込む
```

なお setter は signal に入れるだけで、**属性へは書き戻さない**（リフレクトしない）。

**host（要素自身）**: `ctx.host` で登録した要素そのものに触れる。イベント発火や
プロパティ操作など、属性以外の Web Component らしい操作の入り口。

```js
defineElement("x-toggle", ({ host }) => {
  const open = signal(false);
  const toggle = () => {
    open.value = !open.value;
    host.dispatchEvent(new CustomEvent("toggle", { detail: open.value })); // 外向きに通知
  };
  return html`<button onClick=${toggle}>${() => (open.value ? "閉じる" : "開く")}</button>`;
});
```

`ctx.host` 経由で状態を属性へ反映すれば、`x-toggle[open] { ... }` のような CSS 属性
セレクタでスタイルを当てられる（CSS は JS プロパティを見られないため）。`effect` で包めば
状態が変わるたび自動で反映される。

```js
// open（signal）の真偽を host の open 属性に反映する
effect(() => host.toggleAttribute("open", open.value));
```

**子の投影（slot）**: `ctx.slot(name?)` は、接続時に利用者が host 直下へ書いていた light DOM の
子を取り出して返す。返り値（`DocumentFragment`）を `setup` の出力の好きな位置に置けば、そこへ
子が差し込まれる。`slot("title")` は `slot="title"` を付けた子、`slot()`（引数なし）は `slot`
属性のない子（デフォルト）を拾う。

```js
defineElement("x-card", ({ slot }) => {
  return html`<div class="card">
    <header>${slot("title")}</header>  <!-- slot="title" の子がここへ -->
    <section>${slot()}</section>       <!-- 名前なしの子がここへ -->
  </div>`;
});
```

```html
<x-card>
  <h2 slot="title">見出し</h2>
  <p>本文</p>
</x-card>
<!-- ↓ 接続後 -->
<x-card>
  <div class="card">
    <header><h2 slot="title">見出し</h2></header>
    <section><p>本文</p></section>
  </div>
</x-card>
```

接続時に host 直下の light DOM の子はいったん取り外され、`slot()` が拾ったものだけが
`setup` の出力経由で描画される。どの `slot` でも拾わなかった子は描画されない（`<slot>` と同じ）。
Shadow DOM の `<slot>` と違い「接続時点の子を1回配置する静的投影」で、`slotchange` 相当の
動的追従はしない。取り出した子はそのノードごと**移動**する（複製ではない）。

描画先は既定では host 直下（light DOM）。

**Shadow DOM**: `options.shadow` を `true` にすると `attachShadow` して `shadowRoot` に
マウントする。スタイル隔離（`<style>` がページに漏れない／外の CSS を受けない）が要る
コンポーネント向け。

```js
defineElement(
  "x-badge",
  ({ slot }) => html`
    <style>:host { display: inline-block } span { color: tomato }</style>
    <span>${slot()}</span>`,
  { shadow: true },
);
// <x-badge>セール中</x-badge> → shadowRoot 内の span に "セール中" が投影される
```

`shadow` が変えるのは**マウント先（host → shadowRoot）とスタイル隔離だけ**で、**書き方も挙動も
light DOM と完全に同じ**。子の投影は light/shadow どちらでも `ctx.slot()`（静的投影）を使う
（shadow でもネイティブの `<slot>` 要素ではなく `${slot()}` で書く）。`prop` / `host` / 再接続の
挙動もそのまま。

> **再接続の挙動**: 切断（`disconnectedCallback`）では即 dispose せず、次のマイクロタスクまで
> 待ってから「まだ未接続なら本当に切り離された」と判断して root を dispose する。これにより
> DOM 内での**移動**（付け替え）は disconnect→connect が連続するだけなので状態が保たれる。
> 本当に切り離してから別の場所に再接続した場合は `setup` を走らせ直す（ローカル状態はリセット）。

## 所有ツリー（自動 dispose）

`effect` を別の `effect` の中で作ると、外側の effect の「子」として自動登録される。
親が再実行されると前回の子は自動で dispose されるため、ネストした effect の解放を手で管理する必要はない。

```js
effect(() => {
  // この中で作った effect は、親が再実行されるたび自動で畳まれる
  effect(() => {
    console.log("child effect");
  });
});
```

トップレベル（どの effect にも属さない場所）で作った effect は自動では畳まれない。
その場合は戻り値（dispose 関数）か `createRoot` で明示的に管理する。`setTimeout` / `await`
後のコールバックの中も「親がいない場所」になるので、元のツリーに紐づけたいときは
`getOwner()` で親を掴んでおき `runWithOwner` で復帰する。

## 開発

ソースは TypeScript。`src/` にライブラリ本体、`test/` にテストを置く。`tsc` で `dist/` に
構造を保ったままコンパイルする（`src/x.ts` → `dist/src/x.js`、`test/y.ts` → `dist/test/y.js`）。
出力は ESM（`.js`）と型定義（`.d.ts`）。続けて esbuild がブラウザ用のグローバル(IIFE)版
（`dist/signals.global.js` / `.min.js`）を束ねる。

```
src/    reactive.ts / store.ts / node.ts / html.ts / for.ts / show.ts /
        element.ts / index.ts
test/   test-core.ts / test-owner.ts / test-dom.ts
```

```bash
npm install         # devDependencies（typescript / esbuild / jsdom 等）
npm run build       # tsc で dist/ にコンパイル → esbuild で IIFE 版を生成
npm run build:global # IIFE 版だけ作り直す
```

## テスト

テストは Node 標準の [`node:test`](https://nodejs.org/api/test.html) ランナー（`node --test`）と
`node:assert/strict` で書かれている。追加の依存はない。フィルタ実行や TAP 出力は
`node --test` のオプションがそのまま使える。

```bash
npm test       # build してから core / owner テストを実行（jsdom 不要）
npm run test:dom  # build してから DOM テストを実行（jsdom が必要）

# 個別実行・フィルタの例
node --test dist/test/test-core.js            # 1ファイルだけ
node --test --test-name-pattern="batch" dist/test/test-core.js  # 名前で絞り込み
```

## Lint / Format

リンタとフォーマッタは [Biome](https://biomejs.dev/) に一本化している（設定は `biome.json`）。
`src/` と `test/` を対象に、整形チェックと lint をまとめて実行する。CI でも同じチェックが走る。

```bash
npm run lint    # 整形ずれ・lint 違反をチェック（書き換えなし）
npm run format  # 整形と安全な lint 修正を適用（biome check --write）
```

## ライセンス

Apache-2.0
