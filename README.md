# @kekemoto/signals

ライブラリ非依存の最小リアクティブシステム＋ DOM ユーティリティ。TypeScript で書かれ、型定義（`.d.ts`）を同梱している。

- **コア** — `signal` / `effect` / `batch` / `memo` / `store` / `onCleanup` / `createRoot` / `isSignal`
- **DOM** — `h` / `tags` / `` html`...` `` / `For` / `Show` / `defineElement`（Web Component）

## インストール

```bash
npm install @kekemoto/signals
```

## ブラウザ / CDN

### 素の `<script>`（グローバル変数 `Signals`）

ビルド不要で一番手軽。IIFE 版を読み込むと `window.Signals` にすべての API が生える。

```html
<script src="https://cdn.jsdelivr.net/npm/@kekemoto/signals"></script>
<script>
  const { signal, tags } = Signals;
  const { div, button, span } = tags;

  const count = signal(0);
  document.body.append(
    div(
      span(() => count.value),
      button({ onClick: () => count.value++ }, "+1"),
    ),
  );
</script>
```

> jsDelivr / unpkg はパッケージ名だけで IIFE 版（`dist/signals.global.min.js`）を返す。
> バージョン固定は `.../@kekemoto/signals@0.1.0` のように指定する。

### ES モジュール（`type="module"` + `import`）

モダンな書き方。CDN が ESM を配信するので `import` でそのまま使える。

```html
<script type="module">
  import { signal, tags } from "https://esm.sh/@kekemoto/signals";
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

### `memo(fn)`

重い派生を1回だけ計算して共有・キャッシュする。入力が変わるまで再計算しない。

```js
import { signal, effect, memo } from "@kekemoto/signals";

const a = signal(3), b = signal(4);

const hypotenuse = memo(() => Math.sqrt(a.value ** 2 + b.value ** 2));

effect(() => console.log(hypotenuse())); // → 5
effect(() => console.log(hypotenuse())); // 再計算なし、キャッシュを共有

a.value = 6; // → 両 effect に 10 が流れる（計算は1回）
```

> **軽い派生は普通の関数で書く**のが基本方針。複数箇所で読む重い計算だけ `memo` に差し替える。

### `store(obj)`

オブジェクトの **葉（プリミティブ等の非オブジェクト値）を `signal` に置き換えた、同じ形の木**を返す。ネストしたオブジェクト・配列は形を保ったまま再帰する。

```js
import { store, effect } from "@kekemoto/signals";

const state = store({ user: { name: "Alice", age: 20 }, ok: true });

effect(() => console.log(state.user.age.value)); // → 20

state.user.age.value++; // → 21（この葉を読む effect / 穴だけ反応）
```

葉が `signal` そのものなので、`h` / `tags` / `` html`...` `` の穴には **`() =>` で包まず直接渡せる**（`span(state.user.name)`）。読み書きは `.value` 経由になる。

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

## DOM API

> **reactive な穴の渡し方** — `h` / `tags` / `` html`...` `` はいずれも、穴に
> **関数**（`() => count.value`）か **シグナルそのもの**（`count`）を渡すと reactive に
> なる。単一のシグナルなら `count`、複数の値を組み合わせる派生は `() => a.value + b.value`
> のように関数で包む（`${...}` はその場で評価されるため、合成式は関数が必須）。

### `h(tag, props?, ...children)`

最小 hyperscript。props や子の値が関数 / シグナルなら reactive な属性・子になる。
子は可変長で渡せ、ネストした配列はフラット化される。**props は省略でき**、第2引数が
プレーンな `{}` でなければ（関数・シグナル・Node・文字列・配列なら）子として扱われる。

```js
import { h } from "@kekemoto/signals/h";
import { signal } from "@kekemoto/signals";

const count = signal(0);

const el = h("div", { class: "box" },
  h("span", () => `count: ${count.value}`),   // props 省略
  h("button", { onClick: () => count.value++ }, "+1"),
);

document.body.append(el);
```

### `tags`

`h` を Proxy で包んだタグビルダー DSL。第1引数が props ならそれを属性に、以降を子にする
（props は省略可）。**プロパティ名の camelCase は kebab-case のタグ名に変換される**ので、
ハイフン必須の Custom Element も `tags.myCard(...)`（→ `<my-card>`）と書ける。

```js
import { tags } from "@kekemoto/signals/tags";
import { signal } from "@kekemoto/signals";

const { div, button, span, myCard } = tags;
const count = signal(0);

const el = div(
  span(() => count.value),
  button({ onClick: () => count.value++ }, "+1"),
  myCard({ title: "hi" }),                      // → <my-card title="hi">
);

document.body.append(el);
```

### `` html`...` ``

タグ付きテンプレートリテラルで reactive な DOM を作る（lit / htm 風）。
静的な構造は `<template>` で一度だけパースし、`${...}` の穴だけを配線する。
関数 / シグナルの穴は reactive（属性・子テキスト）になり、`onXxx=${fn}` はイベントになる。

```js
import { html } from "@kekemoto/signals/html";
import { signal } from "@kekemoto/signals";

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
- 子の穴には文字列・数値のほか、`Node`・配列・ネストした `` html`...` `` を差し込める。
- ルート要素が1つならその要素を、複数なら `DocumentFragment` を返す。

> 構造そのものは作り直さず、穴だけを `effect` で更新する（`h` と同じ方針）。
> リスト・条件表示は `For` / `Show` を子の穴に置いて組み合わせる。

### `For(items, keyFn, render)`

key 付きリスト差分描画。存在し続ける行の `effect` は畳まれない。
第1引数は**配列のシグナルそのもの**でも、配列を返す関数（`() => items.value`）でもよい。

```js
import { For } from "@kekemoto/signals/for";
import { signal } from "@kekemoto/signals";
import { tags } from "@kekemoto/signals/tags";

const { ul, li } = tags;

const items = signal([
  { id: 1, text: "foo" },
  { id: 2, text: "bar" },
]);

const list = ul(
  For(
    items,                  // signal を直接渡せる（() => items.value でも可）
    item => item.id,
    item => li(item.text),
  ),
);
```

### `Show(when, render, fallback?)`

条件表示。真偽が切り替わったときだけ中身を作り直す（内部の `effect` も dispose される）。
第1引数は**シグナルそのもの**でも、真偽を返す関数（`() => loggedIn.value`）でもよい。

```js
import { Show } from "@kekemoto/signals/show";
import { signal } from "@kekemoto/signals";
import { tags } from "@kekemoto/signals/tags";

const { div, p } = tags;
const loggedIn = signal(false);

const view = div(
  Show(
    loggedIn,               // signal を直接渡せる（() => loggedIn.value でも可）
    () => p("ようこそ"),
    () => p("ログインしてください"),
  ),
);
```

### `defineElement(name, setup, options?)`

`setup` の中身を持つ Custom Element（Web Component）を登録する。
接続時に `createRoot` を張って `setup` を1回呼び、返した DOM をマウントする。
切断時にその root を dispose するので、`html` / `h` / `For` / `Show` が張った `effect` が孤児に
なってリークしない。

```js
import { defineElement } from "@kekemoto/signals/element";
import { signal } from "@kekemoto/signals";
import { html } from "@kekemoto/signals/html";

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

`setup` は文脈オブジェクト `ctx` を1つ受け取る。`ctx.host`（要素自身）と `ctx.attr`
（属性を読むヘルパー）が入っているので、必要なものを分割代入で取り出して使う。

**属性 → signal**: `ctx.attr(name)` は、その属性を映す `signal` を返す
（内部は `MutationObserver`、dispose 時に自動で外れる）。外から属性を書き換えると再描画される。

```js
defineElement("x-greet", ({ attr }) => {
  const name = attr("name");
  return html`<p>hello ${() => name.value ?? "?"}</p>`;
});
// <x-greet name="Alice"></x-greet> → "hello Alice"
// el.setAttribute("name", "Bob")    → "hello Bob"
```

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

描画先は host 直下（light DOM）。

> **再接続の挙動**: 切断（`disconnectedCallback`）では即 dispose せず、次のマイクロタスクまで
> 待ってから「まだ未接続なら本当に切り離された」と判断して root を dispose する。これにより
> DOM 内での**移動**（付け替え）は disconnect→connect が連続するだけなので状態が保たれる。
> 本当に切り離してから別の場所に再接続した場合は `setup` を走らせ直す（ローカル状態はリセット）。

## 所有ツリー（自動 dispose）

`effect` / `memo` を別の `effect` の中で作ると、外側の effect の「子」として自動登録される。
親が再実行されると前回の子は自動で dispose されるため、ネストした effect の解放を手で管理する必要はない。

```js
effect(() => {
  // この中で作った effect は、親が再実行されるたび自動で畳まれる
  effect(() => {
    console.log("child effect");
  });
});
```

トップレベル（どの effect にも属さない場所）で作った effect・memo は自動では畳まれない。
その場合は戻り値（dispose 関数）か `createRoot` で明示的に管理する。

## 開発

ソースは TypeScript。`src/` にライブラリ本体、`test/` にテストを置く。`tsc` で `dist/` に
構造を保ったままコンパイルする（`src/x.ts` → `dist/src/x.js`、`test/y.ts` → `dist/test/y.js`）。
出力は ESM（`.js`）と型定義（`.d.ts`）。続けて esbuild がブラウザ用のグローバル(IIFE)版
（`dist/signals.global.js` / `.min.js`）を束ねる。

```
src/    reactive.ts / store.ts / h.ts / tags.ts / html.ts / for.ts / show.ts / element.ts / index.ts
test/   test-core.ts / test-owner.ts / test-dom.ts
```

```bash
npm install         # devDependencies（typescript / esbuild / jsdom 等）
npm run build       # tsc で dist/ にコンパイル → esbuild で IIFE 版を生成
npm run build:global # IIFE 版だけ作り直す
```

## テスト

```bash
npm test       # build してから core / owner テストを実行（jsdom 不要）
npm run test:dom  # build してから DOM テストを実行（jsdom が必要）
```

## ライセンス

Apache-2.0
