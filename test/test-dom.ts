// test-dom.ts — h / tags / html / For / Show / defineElement の DOM テスト
// 実行: node --test dist/test/  (jsdom が必要)

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><body></body>");
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).customElements = dom.window.customElements;
(globalThis as any).MutationObserver = dom.window.MutationObserver;

const { signal, effect } = await import("../src/reactive.js");
const { h } = await import("../src/h.js");
const { tags } = await import("../src/tags.js");
const { html } = await import("../src/html.js");
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");
const { defineElement } = await import("../src/element.js");

const mount = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

// === h ===
test("h: reactive 子", () => {
  const count = signal(0);
  const el = h("span", {}, () => `count: ${count.value}`);
  assert.equal(el.textContent, "count: 0", "h: reactive 子の初期値");
  count.value = 3;
  assert.equal(el.textContent, "count: 3", "h: reactive 子の更新");
});
test("h: onClick が発火する", () => {
  const count = signal(0);
  const btn = h("button", { onClick: () => count.value++ }, "+1");
  document.body.append(btn);
  btn.click();
  btn.click();
  assert.equal(count.value, 2, "h: onClick が発火する");
});
test("h: reactive 属性", () => {
  const on = signal(false);
  const el = h("div", { class: () => (on.value ? "active" : "idle") });
  assert.equal(el.getAttribute("class"), "idle", "h: reactive 属性 初期");
  on.value = true;
  assert.equal(el.getAttribute("class"), "active", "h: reactive 属性 更新");
});
test("h: 構築は1回（穴だけ更新）", () => {
  const count = signal(0);
  let builds = 0;
  const el = (() => {
    builds++;
    return h("span", {}, () => count.value);
  })();
  count.value = 5;
  assert.ok(builds === 1 && el.textContent === "5", `h: 構築は1回 builds=${builds}`);
});
test("h: props 省略で関数を子に", () => {
  const count = signal(0);
  const el = h("div", () => count.value); // props を省略
  assert.ok(el.tagName === "DIV" && el.textContent === "0", "h: props 省略で関数を子に");
  count.value = 4;
  assert.equal(el.textContent, "4", "h: props 省略の子も reactive");
});
test("h: props 省略で複数子を可変長で渡せる", () => {
  const el = h("ul", h("li", "a"), h("li", "b")); // props 省略 + 複数子（可変長）
  assert.equal(el.querySelectorAll("li").length, 2, "h: props 省略で複数子を可変長で渡せる");
});

// === class / style のオブジェクト形式（h / html 共通 setAttr）===
test("class: オブジェクトは真のキーだけ space 結合", () => {
  const el = h("div", { class: { active: true, disabled: false, big: 1 } });
  assert.equal(el.getAttribute("class"), "active big", "class: 真のキーだけ");
});
test("class: reactive オブジェクトで反転を追従", () => {
  const on = signal(false);
  const el = h("div", { class: () => ({ active: on.value, base: true }) });
  assert.equal(el.getAttribute("class"), "base", "class: 初期は base のみ");
  on.value = true;
  assert.equal(el.getAttribute("class"), "active base", "class: 反転で active 追加");
});
test("class: 文字列は従来どおり（回帰）", () => {
  const el = h("div", { class: "box" });
  assert.equal(el.getAttribute("class"), "box", "class: 文字列はそのまま");
});
test("style: オブジェクトは el.style へ個別代入（camelCase / kebab / --custom）", () => {
  const el = h("div", { style: { color: "red", fontSize: "12px", "--gap": "4px" } });
  assert.equal(el.style.color, "red", "style: camelCase color");
  assert.equal(el.style.fontSize, "12px", "style: camelCase fontSize");
  assert.equal(el.style.getPropertyValue("--gap"), "4px", "style: --custom");
});
test("style: reactive で消えたキーは inline からも消える", () => {
  const big = signal(true);
  const el = h("div", {
    style: () => (big.value ? { color: "red", fontSize: "20px" } : { color: "red" }),
  });
  assert.equal(el.style.fontSize, "20px", "style: 初期は fontSize あり");
  big.value = false;
  assert.equal(el.style.color, "red", "style: color は残る");
  assert.equal(el.style.fontSize, "", "style: 消えた fontSize は残らない");
});
test("style: html の穴でもオブジェクトが効く", () => {
  const c = signal("red");
  const el = html`<div style=${() => ({ color: c.value })}></div>` as HTMLElement;
  assert.equal(el.style.color, "red", "style(html): 初期 color");
  c.value = "blue";
  assert.equal(el.style.color, "blue", "style(html): 更新 color");
});

test("h: ref が完成した要素を1度だけ受け取る", () => {
  let got: Element | null = null;
  let calls = 0;
  const el = h(
    "div",
    {
      ref: (e) => {
        got = e;
        calls++;
      },
    },
    h("span", "child"),
  );
  assert.equal(got, el, "h: ref に作った要素そのものが渡る");
  assert.equal(calls, 1, "h: ref は1度だけ呼ばれる");
  // ref が呼ばれた時点で子まで配線済み（完成後に渡す不変条件）。
  assert.equal(
    (got as unknown as Element).querySelector("span")!.textContent,
    "child",
    "h: 子が揃っている",
  );
});
test("tags: ref が効く", () => {
  let got: Element | null = null;
  const el = tags.input({ ref: (e) => (got = e) });
  assert.equal(got, el, "tags: ref に input 要素が渡る");
});
// === tags ===
test("tags: 要素と属性と reactive 子", () => {
  const { div, span } = tags;
  const count = signal(1);
  const el = div(
    { id: "box" },
    span(() => count.value),
  );
  assert.ok(el.tagName === "DIV" && el.id === "box", "tags: 要素と属性");
  assert.equal(el.querySelector("span")!.textContent, "1", "tags: reactive 子");
  count.value = 9;
  assert.equal(el.querySelector("span")!.textContent, "9", "tags: 子の更新");
});
test("tags: camelCase → kebab-case 変換", () => {
  const el = tags.myCard({ id: "c" }, "x");
  assert.equal(el.tagName.toLowerCase(), "my-card", "tags: myCard → my-card");
  assert.ok(el.id === "c" && el.textContent === "x", "tags: kebab 要素にも props/子が効く");
  assert.equal(tags.div().tagName, "DIV", "tags: 単語1つはそのまま");
});
// === html (tagged template literal) ===
test("html: 単一ルート要素と reactive 子", () => {
  const count = signal(0);
  const el = html`<span>count: ${() => count.value}</span>` as HTMLElement;
  assert.equal(el.tagName, "SPAN", "html: 単一ルート要素を返す");
  assert.equal(el.textContent, "count: 0", "html: reactive 子の初期値");
  count.value = 7;
  assert.equal(el.textContent, "count: 7", "html: reactive 子の更新");
});
test("html: onClick", () => {
  const count = signal(0);
  const el = html`<button onClick=${() => count.value++}>+1</button>` as HTMLElement;
  assert.ok(!el.hasAttribute("onclick"), "html: onClick 属性を取り除く");
  el.click();
  el.click();
  assert.equal(count.value, 2, "html: onClick が発火する");
});
test("html: reactive 属性", () => {
  const on = signal(false);
  const el = html`<div class=${() => (on.value ? "active" : "idle")}></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "idle", "html: reactive 属性 初期");
  on.value = true;
  assert.equal(el.getAttribute("class"), "active", "html: reactive 属性 更新");
});
test("html: 部分埋め込み 属性", () => {
  const on = signal(false);
  const el = html`<div class="box ${() => (on.value ? "on" : "off")}"></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "box off", "html: 部分埋め込み 属性 初期");
  on.value = true;
  assert.equal(el.getAttribute("class"), "box on", "html: 部分埋め込み 属性 更新");
});
test("html: 静的な穴で属性を設定 / false で外す", () => {
  const el = html`<input value=${"hello"} disabled=${false} title=${"t"}>` as HTMLInputElement;
  assert.equal(el.getAttribute("value"), "hello", "html: 接頭辞なしの穴は属性に入る");
  assert.equal(el.disabled, false, "html: false の穴で disabled が外れる");
  assert.ok(!el.hasAttribute("disabled"), "html: マーカー属性が残らない");
  assert.equal(el.getAttribute("title"), "t", "html: 通常キーは従来どおり属性");
});
test("html: `.value` 穴は DOM プロパティに入る（シグナル直渡し・入力後も反映）", () => {
  const text = signal("first");
  const el = html`<input .value=${text}>` as HTMLInputElement; // シグナル直渡し
  assert.equal(el.value, "first", "html: .value 初期値");
  assert.ok(!el.hasAttribute(".value"), "html: `.value` という属性は残らない");
  assert.ok(!el.hasAttribute("value"), "html: プロパティ穴は属性に書かない");
  el.value = "user typed"; // ユーザー入力で乖離
  text.value = "second";
  assert.equal(el.value, "second", "html: 乖離後も signal の変更が反映される");
});
test("html: `.items` 穴はリッチな値を DOM プロパティに入れる", () => {
  const items = signal<string[]>(["x"]);
  const el = html`<x-rich .items=${items}></x-rich>` as HTMLElement; // シグナル直渡し
  assert.deepEqual((el as any).items, ["x"], "html: `.items` でプロパティ");
  assert.ok(!el.hasAttribute("items"), "html: プロパティ穴は属性に書かない");
  items.value = ["x", "y"];
  assert.deepEqual((el as any).items, ["x", "y"], "html: reactive にプロパティ更新");
});
test("html: 構築は1回（穴だけ更新）", () => {
  const count = signal(0);
  let builds = 0;
  const el = ((): HTMLElement => {
    builds++;
    return html`<span>${() => count.value}</span>` as HTMLElement;
  })();
  count.value = 5;
  assert.ok(builds === 1 && el.textContent === "5", `html: 構築は1回 builds=${builds}`);
});
test("html: Node / 配列の穴を差し込む", () => {
  const inner = html`<b>x</b>`;
  const el = html`<div>${inner}${[h("i", {}, "a"), h("i", {}, "b")]}</div>` as HTMLElement;
  assert.equal(el.querySelector("b")?.textContent, "x", "html: Node の穴を差し込む");
  assert.equal(el.querySelectorAll("i").length, 2, "html: 配列の穴を並べる");
});
test("html: 複数ルートは fragment", () => {
  const frag = html`<p>a</p><p>b</p>`; // 複数ルート（空白を挟む）は DocumentFragment を返す
  const host = mount();
  host.append(frag);
  assert.equal(host.querySelectorAll("p").length, 2, "html: 複数ルートは fragment");
});

test("html: ref が内側の要素を完成後に受け取る", () => {
  const count = signal(2);
  let got: Element | null = null;
  const root = html`<div><input ref=${(e: Element) => (got = e)} /><span>${() => count.value}</span></div>`;
  assert.ok(got != null && (got as Element).tagName === "INPUT", "html: ref に内側の input が渡る");
  // テンプレート全体の配線が済んだ後に呼ばれる（兄弟の reactive 子も解決済み）。
  assert.equal(
    (root as Element).querySelector("span")!.textContent,
    "2",
    "html: 兄弟の穴も配線済み",
  );
});
// === signal を直接渡す（関数ラップ不要）===
test("h: signal を子・属性に直接渡す", () => {
  const count = signal(0);
  const el = h("div", { "data-n": count }, count); // 子・属性ともにシグナルそのものを渡せる
  assert.equal(el.textContent, "0", "h: signal を子に直接");
  assert.equal(el.getAttribute("data-n"), "0", "h: signal を属性に直接");
  count.value = 4;
  assert.equal(el.textContent, "4", "h: signal 子の更新");
  assert.equal(el.getAttribute("data-n"), "4", "h: signal 属性の更新");
});
test("tags: signal を子に直接渡す", () => {
  const { span } = tags;
  const count = signal(1);
  const el = span(count) as HTMLElement; // 位置引数の signal は props でなく子
  assert.ok(el.tagName === "SPAN" && el.textContent === "1", "tags: signal を子に直接");
  count.value = 8;
  assert.equal(el.textContent, "8", "tags: signal 子の更新");
});
test("html: signal を子・属性に直接渡す", () => {
  const count = signal(0);
  const color = signal("red");
  const el = html`<div class=${color}>${count}</div>` as HTMLElement;
  assert.equal(el.textContent, "0", "html: signal を子に直接");
  assert.equal(el.getAttribute("class"), "red", "html: signal を属性に直接");
  count.value = 3;
  color.value = "blue";
  assert.equal(el.textContent, "3", "html: signal 子の更新");
  assert.equal(el.getAttribute("class"), "blue", "html: signal 属性の更新");
});
test("html: 丸ごとの属性穴では false/null で属性を外す", () => {
  // 丸ごとの属性穴では false / null は h と同じく属性を外す（真偽属性の意味）
  const on = signal<boolean>(false);
  const el = html`<input disabled=${on}>` as HTMLElement;
  assert.ok(!el.hasAttribute("disabled"), "html: signal=false で属性を外す");
  on.value = true;
  assert.equal(el.getAttribute("disabled"), "", "html: signal=true で属性を付ける");
});
test("html: 部分埋め込みに signal", () => {
  const cls = signal("a");
  const el = html`<div class="box ${cls}"></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "box a", "html: 部分埋め込みに signal 初期");
  cls.value = "b";
  assert.equal(el.getAttribute("class"), "box b", "html: 部分埋め込みに signal 更新");
});

// === html: 関数の穴が Node / 配列を返す（範囲再描画）===
test("html: 関数穴で .map リスト", () => {
  const items = signal([
    { id: 1, t: "A" },
    { id: 2, t: "B" },
  ]);
  const el = html`<ul>${() => items.value.map((i) => html`<li>${i.t}</li>`)}</ul>` as HTMLElement;
  const texts = () => [...el.querySelectorAll("li")].map((x) => x.textContent).join("");
  assert.equal(texts(), "AB", "html: 関数穴で .map リスト初期");
  items.value = [...items.value, { id: 3, t: "C" }];
  assert.equal(texts(), "ABC", "html: 関数穴で .map リスト更新");
  items.value = [];
  assert.equal(texts(), "", "html: 関数穴で空配列");
});
test("html: 関数穴の条件分岐", () => {
  const ok = signal(false);
  const el = html`<div>${() => (ok.value ? html`<p>yes</p>` : null)}</div>` as HTMLElement;
  assert.equal(el.querySelector("p"), null, "html: 関数穴の条件分岐 初期(null)");
  ok.value = true;
  assert.equal(el.querySelector("p")?.textContent, "yes", "html: 関数穴の条件分岐 表示");
  ok.value = false;
  assert.equal(el.querySelector("p"), null, "html: 関数穴の条件分岐 非表示");
});
test("html: 除去した分岐の effect は止まる", () => {
  // 消えた分岐の effect は所有権ツリーで自動 dispose される
  const ok = signal(true);
  const inner = signal(0);
  let runs = 0;
  const el = html`<div>${() =>
    ok.value
      ? html`<b>${() => {
          runs++;
          return inner.value;
        }}</b>`
      : null}</div>` as HTMLElement;
  assert.equal(el.querySelector("b")?.textContent, "0", "html: ネストした穴も reactive (値)");
  assert.equal(runs, 1, "html: ネストした穴も reactive (回数)");
  inner.value = 1;
  assert.equal(el.querySelector("b")?.textContent, "1", "html: ネストした穴の更新 (値)");
  assert.equal(runs, 2, "html: ネストした穴の更新 (回数)");
  ok.value = false; // 分岐ごと除去
  inner.value = 2; // 死んだ分岐の signal を更新しても…
  assert.equal(runs, 2, "html: 除去した分岐の effect は止まる");
});
test("html: プリミティブ穴はノード使い回し", () => {
  // プリミティブの関数穴はテキストノードを使い回す（fast path）
  const count = signal(0);
  const el = html`<span>${() => count.value}</span>` as HTMLElement;
  const t = [...el.childNodes].find((n) => n.nodeType === 3);
  count.value = 9;
  assert.ok(
    el.textContent === "9" && [...el.childNodes].includes(t!),
    "html: プリミティブ穴はノード使い回し",
  );
});
test("html: signal 直接で Node", () => {
  // シグナル直接の穴に Node が入っていても動く（関数に正規化される）
  const node = signal<Node>(html`<em>x</em>`);
  const el = html`<div>${node}</div>` as HTMLElement;
  assert.equal(el.querySelector("em")?.textContent, "x", "html: signal 直接で Node 初期");
  node.value = html`<strong>y</strong>`;
  assert.ok(
    el.querySelector("strong")?.textContent === "y" && el.querySelector("em") === null,
    "html: signal 直接で Node 更新",
  );
});

test("html: 属性名・スプレッド位置の穴は無視され、dev では警告する", () => {
  // dev ビルドでだけ警告する。テストは NODE_ENV 未設定 = dev なので発火するが、
  // production で実行された場合も落ちないよう期待値を dev フラグで揃える。
  const dev = typeof process === "undefined" || process.env.NODE_ENV !== "production";
  const orig = console.warn;
  let warns = 0;
  console.warn = () => {
    warns++;
  };
  try {
    // 属性名／スプレッド位置の穴は配線できず無視される（emit と同じ非対応スコープ）。
    const el = html`<div ${"x"}>hi</div>` as HTMLElement;
    assert.equal(el.textContent, "hi", "html: スプレッド位置の穴は無視される");
    assert.equal(warns >= (dev ? 1 : 0), true, "無視するときは dev で警告する");
  } finally {
    console.warn = orig;
  }
});

// === h / tags: 関数の子が Node / 配列を返す（html と同じ範囲再描画）===
test("h: 関数子で .map リスト", () => {
  const items = signal(["A", "B"]);
  const el = h("ul", () => items.value.map((t) => h("li", t)));
  const texts = () => [...el.querySelectorAll("li")].map((x) => x.textContent).join("");
  assert.equal(texts(), "AB", "h: 関数子で .map リスト初期");
  items.value = [...items.value, "C"];
  assert.equal(texts(), "ABC", "h: 関数子で .map リスト更新");
});
test("tags: 関数子の条件分岐", () => {
  const { div, p } = tags;
  const ok = signal(false);
  const el = div(() => (ok.value ? p("yes") : null));
  assert.equal(el.querySelector("p"), null, "tags: 関数子の条件分岐 初期(null)");
  ok.value = true;
  assert.equal(el.querySelector("p")?.textContent, "yes", "tags: 関数子の条件分岐 表示");
  ok.value = false;
  assert.equal(el.querySelector("p"), null, "tags: 関数子の条件分岐 非表示");
});
test("h: 除去した分岐の effect は止まる", () => {
  // 消えた分岐の effect は h でも自動 dispose される
  const ok = signal(true);
  const inner = signal(0);
  let runs = 0;
  const el = h("div", () =>
    ok.value
      ? h("b", () => {
          runs++;
          return inner.value;
        })
      : null,
  );
  assert.ok(
    el.querySelector("b")?.textContent === "0" && runs === 1,
    "h: ネストした関数子も reactive",
  );
  ok.value = false;
  inner.value = 9;
  assert.equal(runs, 1, "h: 除去した分岐の effect は止まる");
});

// === For ===
test("For: 描画・並べ替え・追加・削除", () => {
  const { ul, li, b, button } = tags;
  const items = signal([
    { id: "a", t: "A" },
    { id: "b", t: "B" },
    { id: "c", t: "C" },
  ]);
  let rendered = 0;
  const el = mount();
  el.append(
    ul(
      For(
        () => items.value,
        (i) => i.id,
        (item) => {
          rendered++;
          const n = signal(0);
          return li(
            { "data-id": item().id },
            b(() => n.value),
            button({ onClick: () => n.value++ }, "+"),
          );
        },
      ),
    ),
  );
  const ids = () => [...el.querySelectorAll("li")].map((x) => x.getAttribute("data-id")).join("");
  const liByID = (id: string) => el.querySelector(`li[data-id="${id}"]`)!;

  assert.ok(ids() === "abc" && rendered === 3, `For: 初期描画 ids=${ids()} rendered=${rendered}`);

  liByID("a").querySelector("button")!.click();
  liByID("a").querySelector("button")!.click();
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 行ローカル状態を作る");

  const aBefore = liByID("a");
  items.value = [items.value[2], items.value[0], items.value[1]]; // → c, a, b
  assert.equal(ids(), "cab", "For: 並べ替えで順序が更新");
  assert.ok(aBefore === liByID("a"), "For: ノードを使い回す（参照同一）");
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 並べ替えで状態が保たれる");
  assert.equal(rendered, 3, "For: 並べ替えでは再 render しない");

  items.value = [...items.value, { id: "d", t: "D" }]; // 追加
  assert.equal(rendered, 4, "For: 追加は1回だけ render");
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 追加で既存ノードは温存");

  items.value = items.value.filter((i) => i.id !== "a"); // 削除
  assert.ok(liByID("a") === null && ids() === "cbd", `For: 削除で該当行だけ消える ids=${ids()}`);
});
test("For: 同位置のノードは insertBefore しない", () => {
  const { ul, li } = tags;
  const items = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const el = mount();
  const list = ul(
    For(
      () => items.value,
      (i) => i.id,
      (item) => li({ "data-id": item().id }, item().id),
    ),
  );
  el.append(list);

  // insertBefore を数える（DocumentFragment 挿入後の並べ替えだけを観測したい）
  let inserts = 0;
  const orig = list.insertBefore.bind(list);
  list.insertBefore = ((node: Node, ref: Node | null) => {
    inserts++;
    return orig(node, ref);
  }) as typeof list.insertBefore;

  const ids = () => [...el.querySelectorAll("li")].map((x) => x.getAttribute("data-id")).join("");

  // 同じ配列を入れ替えるが順序は不変 → insertBefore はゼロ回
  items.value = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(inserts, 0, "For: 順序不変なら insertBefore しない");
  assert.equal(ids(), "abc", "For: 順序不変で並びも保たれる");

  // 末尾追加 → 追加した1ノードだけ insertBefore
  inserts = 0;
  items.value = [...items.value, { id: "d" }];
  assert.equal(inserts, 1, "For: 末尾追加は1回だけ insertBefore");
  assert.equal(ids(), "abcd", "For: 末尾追加で並びが正しい");

  // 並べ替え → 結果が正しい（移動回数は最小でなくてよい）
  inserts = 0;
  items.value = [items.value[3], items.value[0], items.value[1], items.value[2]]; // d,a,b,c
  assert.equal(ids(), "dabc", "For: 並べ替えで順序が更新");
  assert.ok(inserts > 0 && inserts < 4, `For: 全ノード移動はしない inserts=${inserts}`);
});
test("For: 重複キーで throw", () => {
  const { ul, li } = tags;
  const items = signal([{ id: "x" }, { id: "x" }]);
  const el = mount();
  let threw = false;
  try {
    el.append(
      ul(
        For(
          () => items.value,
          (i: { id: string }) => i.id,
          (item: () => { id: string }) => li({}, item().id),
        ),
      ),
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, "For: 重複キーで throw");
});
test("For: 同じ key・新オブジェクトで行内が更新される（#17）", () => {
  const { ul, li } = tags;
  const items = signal([
    { id: "a", done: false },
    { id: "b", done: false },
  ]);
  let rendered = 0;
  const el = mount();
  el.append(
    ul(
      For(
        items,
        (i) => i.id,
        (item) => {
          rendered++;
          return li({ "data-id": item().id }, () => (item().done ? "✓" : "・"));
        },
      ),
    ),
  );
  const cell = (id: string) => el.querySelector(`li[data-id="${id}"]`)!.textContent;
  const aBefore = el.querySelector('li[data-id="a"]');
  assert.ok(cell("a") === "・" && cell("b") === "・", "For#17: 初期描画");

  // immutable 更新（同 key・新オブジェクト）
  items.value = items.value.map((x) => ({ ...x, done: true }));
  assert.ok(cell("a") === "✓" && cell("b") === "✓", "For#17: 同 key 新オブジェクトで穴が更新");
  assert.ok(aBefore === el.querySelector('li[data-id="a"]'), "For#17: 行ノードは使い回す");
  assert.equal(rendered, 2, "For#17: 再 render はしない（穴だけ更新）");
});
test("For: render に index が渡る（#18）", () => {
  const { ul, li } = tags;
  const items = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const el = mount();
  el.append(
    ul(
      For(
        items,
        (i) => i.id,
        (item, index) => li({ "data-id": item().id }, () => `${index() + 1}:${item().id}`),
      ),
    ),
  );
  const cell = (id: string) => el.querySelector(`li[data-id="${id}"]`)!.textContent;
  assert.ok(
    cell("a") === "1:a" && cell("b") === "2:b" && cell("c") === "3:c",
    "For#18: 初期 index",
  );

  // 並べ替え → index が更新される
  items.value = [items.value[2], items.value[0], items.value[1]]; // c, a, b
  assert.ok(
    cell("c") === "1:c" && cell("a") === "2:a" && cell("b") === "3:b",
    "For#18: 並べ替えで index が更新",
  );

  // 先頭削除 → 後続の index が繰り上がる
  items.value = items.value.filter((i) => i.id !== "c"); // a, b
  assert.ok(cell("a") === "1:a" && cell("b") === "2:b", "For#18: 削除で index が繰り上がる");
});

// === Show ===
test("Show: 本体と fallback の切替", () => {
  const { div, span } = tags;
  const visible = signal(true);
  let made = 0;
  const el = mount();
  el.append(
    div(
      Show(
        () => visible.value,
        () => {
          made++;
          return span({ class: "yes" }, "見える");
        },
        () => span({ class: "no" }, "隠れた"),
      ),
    ),
  );
  assert.equal(
    el.querySelector(".yes")?.textContent,
    "見える",
    "Show: when=true で本体を表示 (内容)",
  );
  assert.equal(made, 1, "Show: when=true で本体を表示 (回数)");
  visible.value = false;
  assert.ok(
    !el.querySelector(".yes") && !!el.querySelector(".no"),
    "Show: false で fallback に切替",
  );
  visible.value = true;
  assert.ok(!!el.querySelector(".yes"), "Show: true で本体を再表示 (表示)");
  assert.equal(made, 2, "Show: true で本体を再表示 (回数)");
});
test("Show: false かつ fallback 省略で何も表示しない", () => {
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(
    div(
      Show(
        () => visible.value,
        () => span({ class: "yes" }, "見える"),
      ),
    ),
  );
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback 省略で何も表示しない");
  visible.value = true;
  assert.ok(!!el.querySelector(".yes"), "Show: その後 true で本体表示");
});
test("Show: false かつ fallback=null で何も表示しない", () => {
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(
    div(
      Show(
        () => visible.value,
        () => span({ class: "yes" }, "見える"),
        null,
      ),
    ),
  );
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback=null で何も表示しない");
});
test("Show: render が null を返しても内部 effect が dispose される (#39)", () => {
  const { div } = tags;
  const visible = signal(true);
  const dep = signal(0);
  let runs = 0;
  const el = mount();
  el.append(
    div(
      Show(
        () => visible.value,
        () => {
          // node は作らず（null を返す）、内部で effect だけ張る
          effect(() => {
            dep.value;
            runs++;
          });
          return null;
        },
      ),
    ),
  );
  assert.equal(runs, 1, "Show: 初回に内部 effect が走る");
  dep.value++;
  assert.equal(runs, 2, "Show: 表示中は内部 effect が反応する");
  // when を false にすると前の中身（node=null でも）を dispose する
  visible.value = false;
  dep.value++;
  assert.equal(runs, 2, "Show: 切替後は内部 effect が dispose され反応しない");
});
test("Show: render に真だった値の accessor が渡る (#19)", () => {
  const { div, span } = tags;
  const user = signal<{ name: string } | null>(null);
  const el = mount();
  el.append(
    div(
      Show(
        () => user.value,
        // value() は NonNullable に絞られ、null チェックの再記述が要らない
        (value) => span({ class: "name" }, () => value().name),
      ),
    ),
  );
  assert.ok(!el.querySelector(".name"), "Show: 初期は null で本体なし");
  user.value = { name: "ada" };
  assert.equal(
    el.querySelector(".name")?.textContent,
    "ada",
    "Show: 真になったら value() の値で本体を表示",
  );
  // 真のまま値が変わったら（部分木は据え置きのまま）accessor 経由で追従する
  user.value = { name: "grace" };
  assert.equal(
    el.querySelector(".name")?.textContent,
    "grace",
    "Show: 真のまま値が変わると accessor が追従する",
  );
  // 偽に戻したら本体は消える（accessor から偽値が読まれて落ちたりしない）
  user.value = null;
  assert.ok(!el.querySelector(".name"), "Show: 偽に戻すと本体が消える");
});

// MutationObserver は jsdom でも非同期配信なので、属性変化の反映を待つ用。
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// === defineElement ===
test("defineElement: 基本（描画 + 内部 signal で reactive）", () => {
  const { div, span, button } = tags;
  defineElement("x-counter", () => {
    const count = signal(0);
    return div(
      span(() => count.value),
      button({ onClick: () => count.value++ }, "+1"),
    );
  });
  const el = document.createElement("x-counter");
  document.body.append(el);
  assert.equal(el.querySelector("span")?.textContent, "0", "defineElement: connected で描画");
  el.querySelector("button")!.click();
  assert.equal(el.querySelector("span")?.textContent, "1", "defineElement: 内部 signal で再描画");
});
test("defineElement: 切断確定で root を畳む（遅延 dispose）", async () => {
  const ext = signal(0);
  let runs = 0;
  defineElement("x-life", () => {
    const { div } = tags;
    return div(() => {
      runs++;
      return ext.value;
    });
  });

  const el = document.createElement("x-life");
  document.body.append(el);
  assert.equal(runs, 1, "defineElement: マウント時に effect が1回走る");
  ext.value = 1;
  assert.equal(runs, 2, "defineElement: 接続中は外部 signal に反応 (回数)");
  assert.equal(
    el.querySelector("div")?.textContent,
    "1",
    "defineElement: 接続中は外部 signal に反応 (値)",
  );

  el.remove(); // disconnected → 次の microtask で dispose
  await tick();
  ext.value = 2;
  assert.equal(runs, 2, "defineElement: 切断確定後は effect が走らない（dispose 済み）");
});
test("defineElement: onCleanup が切断確定で呼ばれる", async () => {
  const { onCleanup } = await import("../src/reactive.js");
  const state = { cleaned: false }; // オブジェクト経由にして TS の literal 絞り込みを避ける
  defineElement("x-cleanup", () => {
    const { div } = tags;
    onCleanup(() => {
      state.cleaned = true;
    });
    return div("hi");
  });
  const el = document.createElement("x-cleanup");
  document.body.append(el);
  assert.equal(state.cleaned, false, "defineElement: 接続中は onCleanup 未発火");
  el.remove();
  await tick(); // 遅延 dispose を確定させる
  assert.equal(state.cleaned, true, "defineElement: 切断確定で onCleanup 発火");
});
test("defineElement: ctx.prop に属性の変更が流れ込む", async () => {
  const { p } = tags;
  defineElement("x-greet", ({ prop }) => {
    const name = prop("name");
    return p(() => `hello ${name.value ?? "?"}`);
  });
  const el = document.createElement("x-greet");
  el.setAttribute("name", "Alice");
  document.body.append(el);
  assert.equal(el.querySelector("p")?.textContent, "hello Alice", "defineElement: prop 属性初期値");
  el.setAttribute("name", "Bob");
  await tick(); // MutationObserver の配信を待つ
  assert.equal(el.querySelector("p")?.textContent, "hello Bob", "defineElement: 属性変更で再描画");
  el.removeAttribute("name");
  await tick();
  assert.equal(el.querySelector("p")?.textContent, "hello ?", "defineElement: 属性削除で null");
});
test("defineElement: ctx.prop はプロパティ代入を捕まえる（リッチな値）", () => {
  const { ul, li } = tags;
  defineElement("x-list", ({ prop }) => {
    const items = prop<string[]>("items", []);
    return ul(() => items.value.map((x) => li(x)));
  });
  const el = document.createElement("x-list");
  document.body.append(el);
  assert.equal(el.querySelectorAll("li").length, 0, "defineElement: prop 初期値（initial）");
  (el as any).items = ["a", "b"]; // accessor 経由で signal に入る（同期）
  assert.equal(el.querySelectorAll("li").length, 2, "defineElement: プロパティ代入で再描画");
  assert.equal((el as any).items.length, 2, "defineElement: プロパティ読み出しは signal から");
});
test("defineElement: upgrade 前のプロパティ代入を初期値として拾う", () => {
  const { span } = tags;
  const el = document.createElement("x-early");
  (el as any).label = "early"; // define 前＝ただの data property
  defineElement("x-early", ({ prop }) => {
    const label = prop("label", "default");
    return span(() => String(label.value));
  });
  document.body.append(el); // upgrade → connect
  assert.equal(
    el.querySelector("span")?.textContent,
    "early",
    "defineElement: upgrade 前の代入が初期値になる",
  );
  (el as any).label = "late";
  assert.equal(
    el.querySelector("span")?.textContent,
    "late",
    "defineElement: accessor 設置後の代入も signal に入る",
  );
});
test("prop: `.foo` キーはリッチな値を DOM プロパティに入れる（h 経由）", () => {
  const items = signal<string[]>(["x"]);
  const el = h("x-rich", { ".items": items } as any); // シグナル直渡し
  assert.deepEqual((el as any).items, ["x"], "prop: 配列はプロパティに入る");
  assert.equal(el.hasAttribute("items"), false, "prop: `.foo` は属性に書かない");
  items.value = ["x", "y"];
  assert.deepEqual((el as any).items, ["x", "y"], "prop: reactive にプロパティ更新");
});
test("prop: `.value` はプロパティを更新する（ユーザー入力後も反映）", () => {
  const text = signal("first");
  const el = h("input", { ".value": text }) as HTMLInputElement; // シグナル直渡し
  assert.equal(el.value, "first", "prop: .value 初期値");
  el.value = "user typed"; // ユーザー入力で属性とプロパティが乖離した状態
  text.value = "second";
  assert.equal(el.value, "second", "prop: 乖離後も signal の変更が画面に反映される");
});
test("prop: 静的なリッチ値も `.foo` で渡せる", () => {
  const arr = ["a", "b"];
  const el = h("x-rich", { ".items": arr } as any);
  assert.equal((el as any).items, arr, "prop: 静的な配列がそのままプロパティに入る");
});
test("prop: `.checked` はプロパティ false で外れる", () => {
  const on = signal(true);
  const el = h("input", { type: "checkbox", ".checked": () => on.value }) as HTMLInputElement;
  assert.equal(el.checked, true, "prop: .checked 初期値");
  on.value = false;
  assert.equal(el.checked, false, "prop: .checked false でプロパティが外れる");
});
test("attr: 接頭辞なしの value は属性のまま（初期値だけ・入力後は乖離）", () => {
  const el = h("input", { value: "first" }) as HTMLInputElement;
  assert.equal(el.getAttribute("value"), "first", "attr: value は属性に書かれる");
  el.value = "user typed"; // ユーザー入力でプロパティが乖離
  assert.equal(el.getAttribute("value"), "first", "attr: 属性は初期値のまま");
});
test("setAttr: aria-*/data-* も真偽値は全キー共通（false=削除で付け外しできる）", () => {
  // 真偽値の意味は他の属性と同じ: true=空文字（present）/ false=削除（absent）。
  const on = signal(true);
  const el = h("div", { "data-on": () => on.value });
  assert.equal(el.getAttribute("data-on"), "", "setAttr: data-* の true は空文字");
  on.value = false;
  assert.equal(
    el.hasAttribute("data-on"),
    false,
    "setAttr: data-* の false で外れる（付け外し可）",
  );
  on.value = true;
  assert.equal(el.hasAttribute("data-on"), true, "setAttr: data-* を再び付けられる");
});
test('setAttr: "false" という文字列はそのまま属性に書ける（aria-hidden=false）', () => {
  // "false" 自体を残したいときは真偽値ではなく文字列を渡す。
  const el = h("div", { "aria-hidden": "false", "data-flag": "true" });
  assert.equal(el.getAttribute("aria-hidden"), "false", 'setAttr: 文字列 "false" はそのまま');
  assert.equal(el.getAttribute("data-flag"), "true", 'setAttr: 文字列 "true" はそのまま');
});
test("toNode: 子の true / false はどちらも非表示", () => {
  const flag = signal<boolean>(true);
  const el = h("span", "[", () => flag.value, "]");
  assert.equal(el.textContent, "[]", "toNode: true の子は描かない（false と対称）");
  flag.value = false;
  assert.equal(el.textContent, "[]", "toNode: false の子も描かない");
  // 静的な真偽値の子もスキップ（empty text すら足さない）
  const el2 = h("span", "x", true, false);
  assert.equal(el2.childNodes.length, 1, "h: 静的な真偽値の子は append しない");
});
test("defineElement: ctx.host で要素自身に触れる", () => {
  const { div } = tags;
  defineElement("x-host", ({ host }) => {
    host.classList.add("ready"); // host 自身を操作
    return div(host.getAttribute("data-x") ?? "");
  });
  const el = document.createElement("x-host");
  el.setAttribute("data-x", "yo");
  document.body.append(el);
  assert.ok(el.classList.contains("ready"), "defineElement: ctx.host で要素を操作");
  assert.equal(
    el.querySelector("div")?.textContent,
    "yo",
    "defineElement: ctx.host から属性を読む",
  );
});
test("defineElement: 移動では setup を作り直さない", async () => {
  let setups = 0;
  defineElement("x-move", () => {
    setups++;
    const { div } = tags;
    return div("m");
  });
  const a = mount(),
    b = mount();
  const el = document.createElement("x-move");
  a.append(el);
  assert.equal(setups, 1, "defineElement: 初回 setup");

  b.append(el); // 別の親へ移動（disconnect→connect が連続）
  await tick(); // 遅延 dispose のタイミングを通過させる
  assert.equal(setups, 1, "defineElement: 移動では setup を作り直さない");
  assert.equal(el.querySelector("div")?.textContent, "m", "defineElement: 移動後も描画される");
});
test("defineElement: 切断確定後の再接続で setup し直す", async () => {
  let setups = 0;
  defineElement("x-reinit", () => {
    setups++;
    const { div } = tags;
    return div("r");
  });
  const el = document.createElement("x-reinit");
  document.body.append(el);
  assert.equal(setups, 1, "defineElement: 初回 setup（reinit）");

  el.remove();
  await tick(); // 切断を確定させて dispose
  document.body.append(el); // 改めて接続
  assert.equal(setups, 2, "defineElement: 切断確定後の再接続で setup し直す");
  assert.equal(el.querySelector("div")?.textContent, "r", "defineElement: 再接続後も描画される");
});
test("defineElement: 拾われない light DOM の子は描画されない", async () => {
  defineElement("x-clears", () => {
    const { div } = tags;
    return div({ class: "own" }, "own");
  });
  const el = document.createElement("x-clears");
  el.innerHTML = `<span class="user">u</span>`; // 利用者が書いた子（slot で拾わない）
  document.body.append(el);
  assert.ok(!!el.querySelector(".own"), "defineElement: setup の出力は描画される");
  assert.ok(!el.querySelector(".user"), "defineElement: 拾われない light DOM の子は描画されない");

  el.append(Object.assign(document.createElement("span"), { className: "added" })); // 接続後に動的追加
  el.remove();
  await tick(); // 切断を確定させて dispose
  assert.ok(!el.querySelector(".own"), "defineElement: dispose で描画ノードが消える");
  assert.ok(!el.querySelector(".added"), "defineElement: dispose で動的追加した子も消える");
  // 利用者が書いた元の light DOM の子は dispose 時に host へ戻る（再接続のため）。
  assert.equal(el.childNodes.length, 1, "defineElement: dispose で元の light DOM の子は戻る");
  assert.ok(!!el.querySelector(".user"), "defineElement: 戻るのは退避していた元の子");
});
test("defineElement: 再接続で slot 内容が復元される", async () => {
  const { div } = tags;
  defineElement("x-reslot", ({ slot }) => div({ class: "named" }, slot("title")));
  const el = document.createElement("x-reslot");
  el.innerHTML = `<h2 slot="title">見出し</h2>`;
  document.body.append(el);
  assert.equal(
    el.querySelector(".named h2")?.textContent,
    "見出し",
    "reslot: 初回接続で slot が投影される",
  );

  el.remove();
  await tick(); // 切断を確定させて dispose（元の子を host へ戻す）
  document.body.append(el); // 別の場所へ再接続
  assert.equal(
    el.querySelector(".named h2")?.textContent,
    "見出し",
    "reslot: 再接続でも slot の中身が復元される（永久に消えない）",
  );
});
test("defineElement: ctx.slot で light DOM の子を投影", () => {
  const { div, header, section } = tags;
  defineElement("x-slotted", ({ slot }) =>
    div(
      { class: "card" },
      header({ class: "h" }, slot("title")), // slot="title" の子
      section({ class: "b" }, slot()), // 名前なしの子
    ),
  );
  const el = document.createElement("x-slotted");
  el.innerHTML = `<h2 slot="title">見出し</h2><p>本文</p>`;
  document.body.append(el);

  const h = el.querySelector(".h");
  const b = el.querySelector(".b");
  assert.equal(h?.querySelector("h2")?.textContent, "見出し", "slot: 名前付きの子が header へ");
  assert.equal(b?.querySelector("p")?.textContent, "本文", "slot: 名前なしの子が section へ");
  assert.equal(
    el.querySelectorAll(".card h2").length,
    1,
    "slot: 投影は移動なので元の位置には残らない",
  );
});
test("defineElement: 拾われなかった子は撤去される", () => {
  const { div } = tags;
  defineElement("x-slot-rest", ({ slot }) => div({ class: "named" }, slot("foo"))); // 名前なしの子は拾わない
  const el = document.createElement("x-slot-rest");
  el.innerHTML = `<p class="loose">消える</p>`;
  document.body.append(el);

  assert.equal(el.querySelector(".named")?.childNodes.length, 0, "slot: 一致しない slot は空");
  assert.ok(!el.querySelector(".loose"), "slot: 拾われない子は撤去される");
});

// === For / Show: signal を直接渡す（() => sig.value のラップ不要）===
test("For: signal 直渡し", () => {
  const { ul, li } = tags;
  const items = signal([{ id: "a" }, { id: "b" }]);
  const el = mount();
  el.append(
    ul(
      For(
        items,
        (i: { id: string }) => i.id,
        (item: () => { id: string }) => li({ "data-id": item().id }, item().id),
      ),
    ),
  );
  assert.equal(el.querySelectorAll("li").length, 2, "For: signal 直渡しで描画");
  items.value = [...items.value, { id: "c" }];
  assert.equal(el.querySelectorAll("li").length, 3, "For: signal 直渡しで更新");
});
test("Show: signal 直渡し", () => {
  const { div, span } = tags;
  const visible = signal(true);
  const el = mount();
  el.append(
    div(
      Show(
        visible,
        () => span({ class: "yes" }, "見える"),
        () => span({ class: "no" }, "隠れた"),
      ),
    ),
  );
  assert.ok(!!el.querySelector(".yes"), "Show: signal 直渡し true で本体");
  visible.value = false;
  assert.ok(
    !el.querySelector(".yes") && !!el.querySelector(".no"),
    "Show: signal 直渡し false で fallback",
  );
});
