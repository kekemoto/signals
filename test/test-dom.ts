// test-dom.ts — h / tags / For / Show の DOM テスト
// 実行: npm i jsdom してから  node dist/test/test-dom.js
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
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");
const { defineElement } = await import("../src/element.js");

let pass = 0, fail = 0;
const log: string[] = [];
function check(name: string, cond: unknown, detail = ""): void {
  if (cond) { pass++; log.push(`  ok  ${name}`); }
  else { fail++; log.push(`FAIL  ${name}  ${detail}`); }
}
const mount = () => { const el = document.createElement("div"); document.body.append(el); return el; };

// === h ===
{
  const count = signal(0);
  const el = h("span", {}, () => `count: ${count.value}`);
  check("h: reactive 子の初期値", el.textContent === "count: 0");
  count.value = 3;
  check("h: reactive 子の更新", el.textContent === "count: 3");
}
{
  const count = signal(0);
  const btn = h("button", { onClick: () => count.value++ }, "+1");
  document.body.append(btn);
  btn.click(); btn.click();
  check("h: onClick が発火する", count.value === 2, `count=${count.value}`);
}
{
  const on = signal(false);
  const el = h("div", { class: () => (on.value ? "active" : "idle") });
  check("h: reactive 属性 初期", el.getAttribute("class") === "idle");
  on.value = true;
  check("h: reactive 属性 更新", el.getAttribute("class") === "active");
}
{
  const count = signal(0);
  let builds = 0;
  const el = (() => { builds++; return h("span", {}, () => count.value); })();
  count.value = 5;
  check("h: 構築は1回（穴だけ更新）", builds === 1 && el.textContent === "5", `builds=${builds}`);
}

// === tags ===
{
  const { div, span } = tags;
  const count = signal(1);
  const el = div({ id: "box" }, span(() => count.value));
  check("tags: 要素と属性", el.tagName === "DIV" && el.id === "box");
  check("tags: reactive 子", el.querySelector("span")!.textContent === "1");
  count.value = 9;
  check("tags: 子の更新", el.querySelector("span")!.textContent === "9");
}

// === For ===
{
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

  check("For: 初期描画", ids() === "abc" && rendered === 3, `ids=${ids()} rendered=${rendered}`);

  liByID("a").querySelector("button")!.click();
  liByID("a").querySelector("button")!.click();
  check("For: 行ローカル状態を作る", liByID("a").querySelector("b")!.textContent === "2");

  const aBefore = liByID("a");
  items.value = [items.value[2], items.value[0], items.value[1]]; // → c, a, b
  check("For: 並べ替えで順序が更新", ids() === "cab", `ids=${ids()}`);
  check("For: ノードを使い回す（参照同一）", aBefore === liByID("a"));
  check("For: 並べ替えで状態が保たれる", liByID("a").querySelector("b")!.textContent === "2");
  check("For: 並べ替えでは再 render しない", rendered === 3, `rendered=${rendered}`);

  items.value = [...items.value, { id: "d", t: "D" }]; // 追加
  check("For: 追加は1回だけ render", rendered === 4, `rendered=${rendered}`);
  check("For: 追加で既存ノードは温存", liByID("a").querySelector("b")!.textContent === "2");

  items.value = items.value.filter((i) => i.id !== "a"); // 削除
  check("For: 削除で該当行だけ消える", liByID("a") === null && ids() === "cbd", `ids=${ids()}`);
}

// === For: 重複キーは throw（黙ってリークさせない）===
{
  const { ul, li } = tags;
  const items = signal([{ id: "x" }, { id: "x" }]);
  const el = mount();
  let threw = false;
  try {
    el.append(ul(For(() => items.value, (i: { id: string }) => i.id, (item: { id: string }) => li({}, item.id))));
  } catch { threw = true; }
  check("For: 重複キーで throw", threw, `threw=${threw}`);
}

// === Show ===
{
  const { div, span } = tags;
  const visible = signal(true);
  let made = 0;
  const el = mount();
  el.append(div(Show(() => visible.value,
    () => { made++; return span({ class: "yes" }, "見える"); },
    () => span({ class: "no" }, "隠れた"))));
  check("Show: when=true で本体を表示", el.querySelector(".yes")?.textContent === "見える" && made === 1, `made=${made}`);
  visible.value = false;
  check("Show: false で fallback に切替", !el.querySelector(".yes") && !!el.querySelector(".no"));
  visible.value = true;
  check("Show: true で本体を再表示", !!el.querySelector(".yes") && made === 2, `made=${made}`);
}

// === Show: fallback 省略 / null のとき false で何も表示しない ===
{
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(div(Show(() => visible.value, () => span({ class: "yes" }, "見える"))));
  check("Show: false かつ fallback 省略で何も表示しない", !el.querySelector(".yes"));
  visible.value = true;
  check("Show: その後 true で本体表示", !!el.querySelector(".yes"));
}
{
  const { div, span } = tags;
  const visible = signal(false);
  const el = mount();
  el.append(div(Show(() => visible.value, () => span({ class: "yes" }, "見える"), null)));
  check("Show: false かつ fallback=null で何も表示しない", !el.querySelector(".yes"));
}

// MutationObserver は jsdom でも非同期配信なので、属性変化の反映を待つ用。
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// === defineElement: 基本（描画 + 内部 signal で reactive）===
{
  const { div, span, button } = tags;
  defineElement("x-counter", () => {
    const count = signal(0);
    return div(span(() => count.value), button({ onClick: () => count.value++ }, "+1"));
  });
  const el = document.createElement("x-counter");
  document.body.append(el);
  check("defineElement: connected で描画", el.querySelector("span")?.textContent === "0");
  el.querySelector("button")!.click();
  check("defineElement: 内部 signal で再描画", el.querySelector("span")?.textContent === "1");
}

// === defineElement: disconnected で root を畳む（effect / onCleanup を解放）===
{
  const ext = signal(0);
  let runs = 0;
  defineElement("x-life", () => {
    const { div } = tags;
    return div(() => { runs++; return ext.value; });
  });

  const el = document.createElement("x-life");
  document.body.append(el);
  check("defineElement: マウント時に effect が1回走る", runs === 1, `runs=${runs}`);
  ext.value = 1;
  check("defineElement: 接続中は外部 signal に反応", runs === 2 && el.querySelector("div")?.textContent === "1");

  el.remove();                       // disconnected → dispose
  ext.value = 2;
  check("defineElement: 切断後は effect が走らない（dispose 済み）", runs === 2, `runs=${runs}`);
}

// === defineElement: onCleanup が disconnected で呼ばれる ===
{
  const { onCleanup } = await import("../src/reactive.js");
  const state = { cleaned: false };  // オブジェクト経由にして TS の literal 絞り込みを避ける
  defineElement("x-cleanup", () => {
    const { div } = tags;
    onCleanup(() => { state.cleaned = true; });
    return div("hi");
  });
  const el = document.createElement("x-cleanup");
  document.body.append(el);
  check("defineElement: 接続中は onCleanup 未発火", state.cleaned === false);
  el.remove();
  check("defineElement: 切断で onCleanup 発火", state.cleaned === true);
}

// === defineElement: ctx.attr で属性 → signal ===
{
  const { p } = tags;
  defineElement("x-greet", (_host, { attr }) => {
    const name = attr("name");
    return p(() => `hello ${name.value ?? "?"}`);
  });
  const el = document.createElement("x-greet");
  el.setAttribute("name", "Alice");
  document.body.append(el);
  check("defineElement: attr 初期値", el.querySelector("p")?.textContent === "hello Alice");
  el.setAttribute("name", "Bob");
  await tick();                      // MutationObserver の配信を待つ
  check("defineElement: attr 変更で再描画", el.querySelector("p")?.textContent === "hello Bob",
    `text=${el.querySelector("p")?.textContent}`);
  el.removeAttribute("name");
  await tick();
  check("defineElement: attr 削除で null", el.querySelector("p")?.textContent === "hello ?");
}

// === defineElement: shadow オプション ===
{
  const { span } = tags;
  defineElement("x-shadow", () => span("内側"), { shadow: true });
  const el = document.createElement("x-shadow");
  document.body.append(el);
  check("defineElement: shadow に描画（host は空）", el.childNodes.length === 0);
  check("defineElement: shadowRoot に中身がある", el.shadowRoot?.querySelector("span")?.textContent === "内側");
}

// === defineElement: 再接続で setup し直す ===
{
  let setups = 0;
  defineElement("x-reconnect", () => { setups++; const { div } = tags; return div("r"); });
  const el = document.createElement("x-reconnect");
  document.body.append(el);
  check("defineElement: 初回 setup", setups === 1);
  el.remove();
  document.body.append(el);          // 再接続
  check("defineElement: 再接続で setup し直す", setups === 2, `setups=${setups}`);
  check("defineElement: 再接続後も描画される", el.querySelector("div")?.textContent === "r");
}

console.log(log.join("\n"));
console.log(`\npass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
