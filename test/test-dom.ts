// test-dom.ts — h / tags / html / For / Show / defineElement の DOM テスト
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
const { html } = await import("../src/html.js");
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

// === h: props 省略（第1引数から子を直接渡せる）===
{
  const count = signal(0);
  const el = h("div", () => count.value);       // props を省略
  check("h: props 省略で関数を子に", el.tagName === "DIV" && el.textContent === "0");
  count.value = 4;
  check("h: props 省略の子も reactive", el.textContent === "4");
}
{
  const el = h("ul", h("li", "a"), h("li", "b")); // props 省略 + 複数子（可変長）
  check("h: props 省略で複数子を可変長で渡せる", el.querySelectorAll("li").length === 2);
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

// === tags: camelCase → kebab-case 変換（Custom Element 用）===
{
  const el = tags.myCard({ id: "c" }, "x");
  check("tags: myCard → my-card", el.tagName.toLowerCase() === "my-card");
  check("tags: kebab 要素にも props/子が効く", el.id === "c" && el.textContent === "x");
  check("tags: 単語1つはそのまま", tags.div().tagName === "DIV");
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

// === signal を直接渡す（関数ラップ不要）===
{
  const count = signal(0);
  // h: 子・属性ともにシグナルそのものを渡せる
  const el = h("div", { "data-n": count }, count);
  check("h: signal を子に直接", el.textContent === "0");
  check("h: signal を属性に直接", el.getAttribute("data-n") === "0");
  count.value = 4;
  check("h: signal 子の更新", el.textContent === "4");
  check("h: signal 属性の更新", el.getAttribute("data-n") === "4");
}
{
  const { span } = tags;
  const count = signal(1);
  const el = span(count) as HTMLElement;       // 位置引数の signal は props でなく子
  check("tags: signal を子に直接", el.tagName === "SPAN" && el.textContent === "1");
  count.value = 8;
  check("tags: signal 子の更新", el.textContent === "8");
}
{
  const count = signal(0);
  const color = signal("red");
  const el = html`<div class=${color}>${count}</div>` as HTMLElement;
  check("html: signal を子に直接", el.textContent === "0");
  check("html: signal を属性に直接", el.getAttribute("class") === "red");
  count.value = 3; color.value = "blue";
  check("html: signal 子の更新", el.textContent === "3");
  check("html: signal 属性の更新", el.getAttribute("class") === "blue");
}
{
  // 丸ごとの属性穴では false / null は h と同じく属性を外す（真偽属性の意味）
  const on = signal<boolean>(false);
  const el = html`<input disabled=${on}>` as HTMLElement;
  check("html: signal=false で属性を外す", !el.hasAttribute("disabled"));
  on.value = true;
  check("html: signal=true で属性を付ける", el.getAttribute("disabled") === "");
}
{
  const cls = signal("a");
  const el = html`<div class="box ${cls}"></div>` as HTMLElement;
  check("html: 部分埋め込みに signal 初期", el.getAttribute("class") === "box a");
  cls.value = "b";
  check("html: 部分埋め込みに signal 更新", el.getAttribute("class") === "box b");
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

// === defineElement: 本当に切断されたら root を畳む（遅延 dispose）===
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

  el.remove();                       // disconnected → 次の microtask で dispose
  await tick();
  ext.value = 2;
  check("defineElement: 切断確定後は effect が走らない（dispose 済み）", runs === 2, `runs=${runs}`);
}

// === defineElement: onCleanup が切断確定で呼ばれる ===
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
  await tick();                      // 遅延 dispose を確定させる
  check("defineElement: 切断確定で onCleanup 発火", state.cleaned === true);
}

// === defineElement: ctx.attr で属性 → signal ===
{
  const { p } = tags;
  defineElement("x-greet", ({ attr }) => {
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

// === defineElement: ctx.host で要素自身に触れる ===
{
  const { div } = tags;
  defineElement("x-host", ({ host }) => {
    host.classList.add("ready");          // host 自身を操作
    return div(host.getAttribute("data-x") ?? "");
  });
  const el = document.createElement("x-host");
  el.setAttribute("data-x", "yo");
  document.body.append(el);
  check("defineElement: ctx.host で要素を操作", el.classList.contains("ready"));
  check("defineElement: ctx.host から属性を読む", el.querySelector("div")?.textContent === "yo");
}

// === defineElement: 移動（同期 remove→append）では setup を作り直さず状態を保つ ===
{
  let setups = 0;
  defineElement("x-move", () => { setups++; const { div } = tags; return div("m"); });
  const a = mount(), b = mount();
  const el = document.createElement("x-move");
  a.append(el);
  check("defineElement: 初回 setup", setups === 1);

  b.append(el);                      // 別の親へ移動（disconnect→connect が連続）
  await tick();                      // 遅延 dispose のタイミングを通過させる
  check("defineElement: 移動では setup を作り直さない", setups === 1, `setups=${setups}`);
  check("defineElement: 移動後も描画される", el.querySelector("div")?.textContent === "m");
}

// === defineElement: 本当に切断してからの再接続は setup し直す ===
{
  let setups = 0;
  defineElement("x-reinit", () => { setups++; const { div } = tags; return div("r"); });
  const el = document.createElement("x-reinit");
  document.body.append(el);
  check("defineElement: 初回 setup（reinit）", setups === 1);

  el.remove();
  await tick();                      // 切断を確定させて dispose
  document.body.append(el);          // 改めて接続
  check("defineElement: 切断確定後の再接続で setup し直す", setups === 2, `setups=${setups}`);
  check("defineElement: 再接続後も描画される", el.querySelector("div")?.textContent === "r");
}

// === For / Show: signal を直接渡す（() => sig.value のラップ不要）===
{
  const { ul, li } = tags;
  const items = signal([{ id: "a" }, { id: "b" }]);
  const el = mount();
  el.append(ul(For(items, (i: { id: string }) => i.id, (item: { id: string }) => li({ "data-id": item.id }, item.id))));
  check("For: signal 直渡しで描画", el.querySelectorAll("li").length === 2);
  items.value = [...items.value, { id: "c" }];
  check("For: signal 直渡しで更新", el.querySelectorAll("li").length === 3);
}
{
  const { div, span } = tags;
  const visible = signal(true);
  const el = mount();
  el.append(div(Show(visible, () => span({ class: "yes" }, "見える"), () => span({ class: "no" }, "隠れた"))));
  check("Show: signal 直渡し true で本体", !!el.querySelector(".yes"));
  visible.value = false;
  check("Show: signal 直渡し false で fallback", !el.querySelector(".yes") && !!el.querySelector(".no"));
}

console.log(log.join("\n"));
console.log(`\npass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
