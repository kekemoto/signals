# @kekemoto/signals

ライブラリ非依存の最小リアクティブシステム＋ DOM ユーティリティ。TypeScript で書かれ、型定義（`.d.ts`）を同梱している。

- **コア** — `signal` / `effect` / `batch` / `memo` / `reactive` / `onCleanup` / `createRoot` / `isSignal`
- **DOM** — `h` / `tags` / `For` / `Show`

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

### `reactive(target)`

オブジェクトを Proxy で包み、プロパティ単位でリアクティブにする。

```js
import { reactive, effect } from "@kekemoto/signals";

const state = reactive({ count: 0, name: "Alice" });

effect(() => console.log(state.count));
// → 0

state.count++; // → 1（count だけ再実行、name を読む effect は無反応）
```

ネストしたオブジェクトも自動で reactive になる。キーの追加・削除も追跡する。

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

### `h(tag, props, children)`

最小 hyperscript。props や子の値が関数 / シグナルなら reactive な属性・子になる。
`children` は単一の子、または子の配列（ネストしていてもフラット化される）。

```js
import { h } from "@kekemoto/signals/h";
import { signal } from "@kekemoto/signals";

const count = signal(0);

const el = h("div", { class: "box" }, [
  h("span", {}, () => `count: ${count.value}`),
  h("button", { onClick: () => count.value++ }, "+1"),
]);

document.body.append(el);
```

### `tags`

`h` を Proxy で包んだタグビルダー DSL。

```js
import { tags } from "@kekemoto/signals/tags";
import { signal } from "@kekemoto/signals";

const { div, button, span } = tags;
const count = signal(0);

const el = div(
  span(() => count.value),
  button({ onClick: () => count.value++ }, "+1"),
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
src/    reactive.ts / h.ts / tags.ts / html.ts / for.ts / show.ts / index.ts
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
