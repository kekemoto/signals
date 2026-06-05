# @kekemoto/signals

ライブラリ非依存の最小リアクティブシステム＋ DOM ユーティリティ。

- **コア** — `signal` / `effect` / `batch` / `memo` / `reactive` / `onCleanup` / `createRoot`
- **DOM** — `h` / `tags` / `For` / `Show`

## インストール

```bash
npm install @kekemoto/signals
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

### `h(tag, props, ...children)`

最小 hyperscript。props の値が関数なら reactive な属性・子になる。

```js
import { h } from "@kekemoto/signals/h";
import { signal } from "@kekemoto/signals";

const count = signal(0);

const el = h("div", { class: "box" },
  h("span", {}, () => `count: ${count.value}`),
  h("button", { onClick: () => count.value++ }, "+1"),
);

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

### `For(itemsFn, keyFn, render)`

key 付きリスト差分描画。存在し続ける行の `effect` は畳まれない。

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
    () => items.value,
    item => item.id,
    item => li(item.text),
  ),
);
```

### `Show(whenFn, render, fallback?)`

条件表示。真偽が切り替わったときだけ中身を作り直す（内部の `effect` も dispose される）。

```js
import { Show } from "@kekemoto/signals/show";
import { signal } from "@kekemoto/signals";
import { tags } from "@kekemoto/signals/tags";

const { div, p } = tags;
const loggedIn = signal(false);

const view = div(
  Show(
    () => loggedIn.value,
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

## テスト

```bash
npm test
```

## ライセンス

Apache-2.0
