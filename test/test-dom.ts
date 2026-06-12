// test-dom.ts — h / tags / html / For / Show / defineElement の DOM テスト
// 実行: node --test dist/test/  (jsdom が必要)
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><body></body>");
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).customElements = dom.window.customElements;
(globalThis as any).MutationObserver = dom.window.MutationObserver;

const { signal } = await import("../src/reactive.js");
const { h } = await import("../src/h.js");
const { tags } = await import("../src/tags.js");
const { html } = await import("../src/html.js");
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");
const { defineElement } = await import("../src/element.js");

const mount = () => { const el = document.createElement("div"); document.body.append(el); return el; };

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
  btn.click(); btn.click();
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
  const el = (() => { builds++; return h("span", {}, () => count.value); })();
  count.value = 5;
  assert.ok(builds === 1 && el.textContent === "5", `h: 構築は1回 builds=${builds}`);
});
test("h: props 省略で関数を子に", () => {
  const count = signal(0);
  const el = h("div", () => count.value);       // props を省略
  assert.ok(el.tagName === "DIV" && el.textContent === "0", "h: props 省略で関数を子に");
  count.value = 4;
  assert.equal(el.textContent, "4", "h: props 省略の子も reactive");
});
test("h: props 省略で複数子を可変長で渡せる", () => {
  const el = h("ul", h("li", "a"), h("li", "b")); // props 省略 + 複数子（可変長）
  assert.equal(el.querySelectorAll("li").length, 2, "h: props 省略で複数子を可変長で渡せる");
});

// === tags ===
test("tags: 要素と属性と reactive 子", () => {
  const { div, span } = tags;
  const count = signal(1);
  const el = div({ id: "box" }, span(() => count.value));
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
  el.click(); el.click();
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
  const el = html`<input value=${"hello"} disabled=${false}>` as HTMLElement;
  assert.equal(el.getAttribute("value"), "hello", "html: 静的な穴で属性を設定");
  assert.ok(!el.hasAttribute("disabled"), "html: false の穴で属性を外す");
});
test("html: 構築は1回（穴だけ更新）", () => {
  const count = signal(0);
  let builds = 0;
  const el = ((): HTMLElement => { builds++; return html`<span>${() => count.value}</span>` as HTMLElement; })();
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
  const el = span(count) as HTMLElement;       // 位置引数の signal は props でなく子
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
  count.value = 3; color.value = "blue";
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
  const items = signal([{ id: 1, t: "A" }, { id: 2, t: "B" }]);
  const el = html`<ul>${() => items.value.map(i => html`<li>${i.t}</li>`)}</ul>` as HTMLElement;
  const texts = () => [...el.querySelectorAll("li")].map(x => x.textContent).join("");
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
    ok.value ? html`<b>${() => { runs++; return inner.value; }}</b>` : null}</div>` as HTMLElement;
  assert.equal(el.querySelector("b")?.textContent, "0", "html: ネストした穴も reactive (値)");
  assert.equal(runs, 1, "html: ネストした穴も reactive (回数)");
  inner.value = 1;
  assert.equal(el.querySelector("b")?.textContent, "1", "html: ネストした穴の更新 (値)");
  assert.equal(runs, 2, "html: ネストした穴の更新 (回数)");
  ok.value = false;          // 分岐ごと除去
  inner.value = 2;           // 死んだ分岐の signal を更新しても…
  assert.equal(runs, 2, "html: 除去した分岐の effect は止まる");
});
test("html: プリミティブ穴はノード使い回し", () => {
  // プリミティブの関数穴はテキストノードを使い回す（fast path）
  const count = signal(0);
  const el = html`<span>${() => count.value}</span>` as HTMLElement;
  const t = [...el.childNodes].find(n => n.nodeType === 3);
  count.value = 9;
  assert.ok(el.textContent === "9" && [...el.childNodes].includes(t!), "html: プリミティブ穴はノード使い回し");
});
test("html: signal 直接で Node", () => {
  // シグナル直接の穴に Node が入っていても動く（関数に正規化される）
  const node = signal<Node>(html`<em>x</em>`);
  const el = html`<div>${node}</div>` as HTMLElement;
  assert.equal(el.querySelector("em")?.textContent, "x", "html: signal 直接で Node 初期");
  node.value = html`<strong>y</strong>`;
  assert.ok(el.querySelector("strong")?.textContent === "y" && el.querySelector("em") === null, "html: signal 直接で Node 更新");
});

// === h / tags: 関数の子が Node / 配列を返す（html と同じ範囲再描画）===
test("h: 関数子で .map リスト", () => {
  const items = signal(["A", "B"]);
  const el = h("ul", () => items.value.map(t => h("li", t)));
  const texts = () => [...el.querySelectorAll("li")].map(x => x.textContent).join("");
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
  const el = h("div", () => (ok.value ? h("b", () => { runs++; return inner.value; }) : null));
  assert.ok(el.querySelector("b")?.textContent === "0" && runs === 1, "h: ネストした関数子も reactive");
  ok.value = false;
  inner.value = 9;
  assert.equal(runs, 1, "h: 除去した分岐の effect は止まる");
});

// === For ===
test("For: 描画・並べ替え・追加・削除", () => {
  const { ul, li, b, button } = tags;
  const items = signal([{ id: "a", t: "A" }, { id: "b", t: "B" }, { id: "c", t: "C" }]);
  let rendered = 0;
  const el = mount();
  el.append(ul(For(() => items.value, i => i.id, (item) => {
    rendered++;
    const n = signal(0);
    return li({ "data-id": item.id }, b(() => n.value),
      button({ onClick: () => n.value++ }, "+"));
  })));
  const ids = () => [...el.querySelectorAll("li")].map(x => x.getAttribute("data-id")).join("");
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
test("For: 重複キーで throw", () => {
  const { ul, li } = tags;
  const items = signal([{ id: "x" }, { id: "x" }]);
  const el = mount();
  let threw = false;
  try {
    el.append(ul(For(() => items.value, (i: { id: string }) => i.id, (item: { id: string }) => li({}, item.id))));
  } catch { threw = true; }
  assert.ok(threw, "For: 重複キーで throw");
});

// === Show ===
test("Show: 本体と fallback の切替", () => {
  const { div, span } = tags;
  const visible = signal(true);
  let made = 0;
  const el = mount();
  el.append(div(Show(() => visible.value,
    () => { made++; return span({ class: "yes" }, "見える"); },
    () => span({ class: "no" }, "隠れた"))));
  assert.equal(el.querySelector(".yes")?.textContent, "見える", "Show: when=true で本体を表示 (内容)");
  assert.equal(made, 1, "Show: when=true で本体を表示 (回数)");
  visible.value = false;
  assert.ok(!el.querySelector(".yes") && !!el.querySelector(".no"), "Show: false で fallback に切替");
  visible.value = true;
  assert.ok(!!el.querySelector(".yes"), "Show: true で本体を再表示 (表示)");
  assert.equal(made, 2, "Show: true で本体を再表示 (回数)");
});
test("Show: false かつ fallback 省略で何も表示しない", () => {
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(div(Show(() => visible.value, () => span({ class: "yes" }, "見える"))));
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback 省略で何も表示しない");
  visible.value = true;
  assert.ok(!!el.querySelector(".yes"), "Show: その後 true で本体表示");
});
test("Show: false かつ fallback=null で何も表示しない", () => {
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(div(Show(() => visible.value, () => span({ class: "yes" }, "見える"), null)));
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback=null で何も表示しない");
});

// MutationObserver は jsdom でも非同期配信なので、属性変化の反映を待つ用。
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// === defineElement ===
test("defineElement: 基本（描画 + 内部 signal で reactive）", () => {
  const { div, span, button } = tags;
  defineElement("x-counter", () => {
    const count = signal(0);
    return div(span(() => count.value), button({ onClick: () => count.value++ }, "+1"));
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
    return div(() => { runs++; return ext.value; });
  });

  const el = document.createElement("x-life");
  document.body.append(el);
  assert.equal(runs, 1, "defineElement: マウント時に effect が1回走る");
  ext.value = 1;
  assert.equal(runs, 2, "defineElement: 接続中は外部 signal に反応 (回数)");
  assert.equal(el.querySelector("div")?.textContent, "1", "defineElement: 接続中は外部 signal に反応 (値)");

  el.remove();                       // disconnected → 次の microtask で dispose
  await tick();
  ext.value = 2;
  assert.equal(runs, 2, "defineElement: 切断確定後は effect が走らない（dispose 済み）");
});
test("defineElement: onCleanup が切断確定で呼ばれる", async () => {
  const { onCleanup } = await import("../src/reactive.js");
  const state = { cleaned: false };  // オブジェクト経由にして TS の literal 絞り込みを避ける
  defineElement("x-cleanup", () => {
    const { div } = tags;
    onCleanup(() => { state.cleaned = true; });
    return div("hi");
  });
  const el = document.createElement("x-cleanup");
  document.body.append(el);
  assert.equal(state.cleaned, false, "defineElement: 接続中は onCleanup 未発火");
  el.remove();
  await tick();                      // 遅延 dispose を確定させる
  assert.equal(state.cleaned, true, "defineElement: 切断確定で onCleanup 発火");
});
test("defineElement: ctx.attr で属性 → signal", async () => {
  const { p } = tags;
  defineElement("x-greet", ({ attr }) => {
    const name = attr("name");
    return p(() => `hello ${name.value ?? "?"}`);
  });
  const el = document.createElement("x-greet");
  el.setAttribute("name", "Alice");
  document.body.append(el);
  assert.equal(el.querySelector("p")?.textContent, "hello Alice", "defineElement: attr 初期値");
  el.setAttribute("name", "Bob");
  await tick();                      // MutationObserver の配信を待つ
  assert.equal(el.querySelector("p")?.textContent, "hello Bob", "defineElement: attr 変更で再描画");
  el.removeAttribute("name");
  await tick();
  assert.equal(el.querySelector("p")?.textContent, "hello ?", "defineElement: attr 削除で null");
});
test("defineElement: ctx.host で要素自身に触れる", () => {
  const { div } = tags;
  defineElement("x-host", ({ host }) => {
    host.classList.add("ready");          // host 自身を操作
    return div(host.getAttribute("data-x") ?? "");
  });
  const el = document.createElement("x-host");
  el.setAttribute("data-x", "yo");
  document.body.append(el);
  assert.ok(el.classList.contains("ready"), "defineElement: ctx.host で要素を操作");
  assert.equal(el.querySelector("div")?.textContent, "yo", "defineElement: ctx.host から属性を読む");
});
test("defineElement: 移動では setup を作り直さない", async () => {
  let setups = 0;
  defineElement("x-move", () => { setups++; const { div } = tags; return div("m"); });
  const a = mount(), b = mount();
  const el = document.createElement("x-move");
  a.append(el);
  assert.equal(setups, 1, "defineElement: 初回 setup");

  b.append(el);                      // 別の親へ移動（disconnect→connect が連続）
  await tick();                      // 遅延 dispose のタイミングを通過させる
  assert.equal(setups, 1, "defineElement: 移動では setup を作り直さない");
  assert.equal(el.querySelector("div")?.textContent, "m", "defineElement: 移動後も描画される");
});
test("defineElement: 切断確定後の再接続で setup し直す", async () => {
  let setups = 0;
  defineElement("x-reinit", () => { setups++; const { div } = tags; return div("r"); });
  const el = document.createElement("x-reinit");
  document.body.append(el);
  assert.equal(setups, 1, "defineElement: 初回 setup（reinit）");

  el.remove();
  await tick();                      // 切断を確定させて dispose
  document.body.append(el);          // 改めて接続
  assert.equal(setups, 2, "defineElement: 切断確定後の再接続で setup し直す");
  assert.equal(el.querySelector("div")?.textContent, "r", "defineElement: 再接続後も描画される");
});
test("defineElement: 拾われない light DOM の子は描画されない", async () => {
  defineElement("x-clears", () => { const { div } = tags; return div({ class: "own" }, "own"); });
  const el = document.createElement("x-clears");
  el.innerHTML = `<span class="user">u</span>`;          // 利用者が書いた子（slot で拾わない）
  document.body.append(el);
  assert.ok(!!el.querySelector(".own"), "defineElement: setup の出力は描画される");
  assert.ok(!el.querySelector(".user"), "defineElement: 拾われない light DOM の子は描画されない");

  el.append(Object.assign(document.createElement("span"), { className: "added" })); // 接続後に動的追加
  el.remove();
  await tick();                                          // 切断を確定させて dispose
  assert.ok(!el.querySelector(".own"), "defineElement: dispose で描画ノードが消える");
  assert.equal(el.childNodes.length, 0, "defineElement: dispose で動的追加した子も消える");
});
test("defineElement: ctx.slot で light DOM の子を投影", () => {
  const { div, header, section } = tags;
  defineElement("x-slotted", ({ slot }) =>
    div({ class: "card" },
      header({ class: "h" }, slot("title")),   // slot="title" の子
      section({ class: "b" }, slot()),         // 名前なしの子
    ));
  const el = document.createElement("x-slotted");
  el.innerHTML = `<h2 slot="title">見出し</h2><p>本文</p>`;
  document.body.append(el);

  const h = el.querySelector(".h");
  const b = el.querySelector(".b");
  assert.equal(h?.querySelector("h2")?.textContent, "見出し", "slot: 名前付きの子が header へ");
  assert.equal(b?.querySelector("p")?.textContent, "本文", "slot: 名前なしの子が section へ");
  assert.equal(el.querySelectorAll(".card h2").length, 1, "slot: 投影は移動なので元の位置には残らない");
});
test("defineElement: 拾われなかった子は撤去される", () => {
  const { div } = tags;
  defineElement("x-slot-rest", ({ slot }) =>
    div({ class: "named" }, slot("foo")));     // 名前なしの子は拾わない
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
  el.append(ul(For(items, (i: { id: string }) => i.id, (item: { id: string }) => li({ "data-id": item.id }, item.id))));
  assert.equal(el.querySelectorAll("li").length, 2, "For: signal 直渡しで描画");
  items.value = [...items.value, { id: "c" }];
  assert.equal(el.querySelectorAll("li").length, 3, "For: signal 直渡しで更新");
});
test("Show: signal 直渡し", () => {
  const { div, span } = tags;
  const visible = signal(true);
  const el = mount();
  el.append(div(Show(visible, () => span({ class: "yes" }, "見える"), () => span({ class: "no" }, "隠れた"))));
  assert.ok(!!el.querySelector(".yes"), "Show: signal 直渡し true で本体");
  visible.value = false;
  assert.ok(!el.querySelector(".yes") && !!el.querySelector(".no"), "Show: signal 直渡し false で fallback");
});
