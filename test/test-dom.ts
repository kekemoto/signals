// test-dom.ts — h / tags / For / Show の DOM テスト
// 実行: npm i jsdom してから  node dist/test/test-dom.js
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!DOCTYPE html><body></body>");
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;

const { signal } = await import("../src/reactive.js");
const { h } = await import("../src/h.js");
const { tags } = await import("../src/tags.js");
const { html } = await import("../src/html.js");
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");

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

// === html (tagged template literal) ===
{
  const count = signal(0);
  const el = html`<span>count: ${() => count.value}</span>` as HTMLElement;
  check("html: 単一ルート要素を返す", el.tagName === "SPAN");
  check("html: reactive 子の初期値", el.textContent === "count: 0");
  count.value = 7;
  check("html: reactive 子の更新", el.textContent === "count: 7");
}
{
  const count = signal(0);
  const el = html`<button onClick=${() => count.value++}>+1</button>` as HTMLElement;
  check("html: onClick 属性を取り除く", !el.hasAttribute("onclick"));
  el.click(); el.click();
  check("html: onClick が発火する", count.value === 2, `count=${count.value}`);
}
{
  const on = signal(false);
  const el = html`<div class=${() => (on.value ? "active" : "idle")}></div>` as HTMLElement;
  check("html: reactive 属性 初期", el.getAttribute("class") === "idle");
  on.value = true;
  check("html: reactive 属性 更新", el.getAttribute("class") === "active");
}
{
  const on = signal(false);
  const el = html`<div class="box ${() => (on.value ? "on" : "off")}"></div>` as HTMLElement;
  check("html: 部分埋め込み 属性 初期", el.getAttribute("class") === "box off");
  on.value = true;
  check("html: 部分埋め込み 属性 更新", el.getAttribute("class") === "box on");
}
{
  const el = html`<input value=${"hello"} disabled=${false}>` as HTMLElement;
  check("html: 静的な穴で属性を設定", el.getAttribute("value") === "hello");
  check("html: false の穴で属性を外す", !el.hasAttribute("disabled"));
}
{
  const count = signal(0);
  let builds = 0;
  const el = ((): HTMLElement => { builds++; return html`<span>${() => count.value}</span>` as HTMLElement; })();
  count.value = 5;
  check("html: 構築は1回（穴だけ更新）", builds === 1 && el.textContent === "5", `builds=${builds}`);
}
{
  // 子の穴に Node / 配列 / ネストした html を差し込める
  const inner = html`<b>x</b>`;
  const el = html`<div>${inner}${[h("i", {}, "a"), h("i", {}, "b")]}</div>` as HTMLElement;
  check("html: Node の穴を差し込む", el.querySelector("b")?.textContent === "x");
  check("html: 配列の穴を並べる", el.querySelectorAll("i").length === 2);
}
{
  // 複数ルート（空白を挟む）は DocumentFragment を返す
  const frag = html`<p>a</p><p>b</p>`;
  const host = mount();
  host.append(frag);
  check("html: 複数ルートは fragment", host.querySelectorAll("p").length === 2);
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

console.log(log.join("\n"));
console.log(`\npass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
