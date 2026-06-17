// test-hydrate.ts — ハイドレーション（adopt）の DOM テスト（第3段階 / 方針②）
// 実行: node --test dist/test/test-hydrate.js  (jsdom が必要)
// docs/ssr-hydration-plan.md のテスト方針②「ハイドレーションテスト（jsdom）」に対応する。
//   - サーバ HTML（emit 出力 or 手組み）を container.innerHTML に据える。
//   - 掴んでおいた既存ノードと、ハイドレーション後のノードが同一（===）であること
//     （＝作り直していない証拠）。
//   - ハイドレーション中の childList ミューテーションが 0 件（属性 / リスナ付与のみ）であること。
//   - 配線後に signal 更新でテキスト・属性が更新され、click でハンドラが発火すること。

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><body></body>");
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).MutationObserver = dom.window.MutationObserver;

const { signal } = await import("../src/reactive.js");
const { html } = await import("../src/html.js");
const { emit } = await import("../src/emit.js");
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");
const { runHydration } = await import("../src/hydration.js");

// container に server HTML を据える。
const serve = (serverHtml: string): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = serverHtml;
  document.body.append(el);
  return el;
};

// hydrate 中の childList 変化（ノードの追加/削除）を数える。属性/リスナ付与は数えない。
const countChildListMutations = (target: Node, fn: () => void): number => {
  let count = 0;
  const obs = new MutationObserver((records) => {
    for (const r of records) count += r.addedNodes.length + r.removedNodes.length;
  });
  obs.observe(target, { childList: true, subtree: true });
  fn();
  // jsdom の MutationObserver は同期 takeRecords で確実に拾う。
  for (const r of obs.takeRecords()) count += r.addedNodes.length + r.removedNodes.length;
  obs.disconnect();
  return count;
};

// === 基本: reactive 子テキスト ===
test("hydrate: reactive 子のテキストノードを作り直さず採用する", () => {
  const count = signal(7);
  const server = emit`<span>count: ${() => count.value}</span>`;
  assert.equal(server, "<span>count: <!--hole-->7<!--/hole--></span>", "前提: emit 出力");
  const container = serve(server);
  const span = container.querySelector("span")!;
  // <!--hole-->, "7", <!--/hole--> のうちテキスト "7" を掴んでおく。
  const textNode = span.childNodes[2]; // "count: " | <!--hole--> | "7" | <!--/hole-->
  assert.equal(textNode.textContent, "7", "前提: 初期テキスト");

  let root!: Node;
  const mutations = countChildListMutations(container, () => {
    root = runHydration(container, () => html`<span>count: ${() => count.value}</span>`);
  });
  assert.equal(root, span, "ルート要素を作り直さず採用する（===）");
  assert.equal(mutations, 0, "hydrate 中の childList 変化は 0（採用＝再構築しない）");
  assert.equal(span.childNodes[2], textNode, "テキストノードも同一（===）");

  count.value = 42;
  assert.equal(span.textContent, "count: 42", "採用後に signal 更新が反映される");
  assert.equal(span.childNodes[2], textNode, "プリミティブ更新はテキストを使い回す（同一）");
});

// === reactive 属性 ===
test("hydrate: reactive 属性を採用し、初回は同値・以降は更新", () => {
  const cls = signal("box");
  const server = emit`<div class=${cls}><b>hi</b></div>`;
  assert.equal(server, '<div class="box"><b>hi</b></div>', "前提: emit 出力");
  const container = serve(server);
  const div = container.querySelector("div")!;

  let root!: Node;
  const mutations = countChildListMutations(container, () => {
    root = runHydration(container, () => html`<div class=${cls}><b>hi</b></div>`);
  });
  assert.equal(root, div, "ルートを採用（===）");
  assert.equal(mutations, 0, "属性配線では childList を変えない");
  assert.equal(div.getAttribute("class"), "box", "初回は同値（mismatch なし）");

  cls.value = "panel";
  assert.equal(div.getAttribute("class"), "panel", "採用後に属性が更新される");
});

// === イベント ===
test("hydrate: onClick を採用後に addEventListener して発火する", () => {
  const count = signal(0);
  const server = emit`<button onClick=${() => count.value++}>+1</button>`;
  assert.equal(server, "<button>+1</button>", "前提: イベント穴は属性を吐かない");
  const container = serve(server);
  const btn = container.querySelector("button")!;

  let root!: Node;
  const mutations = countChildListMutations(container, () => {
    root = runHydration(container, () => html`<button onClick=${() => count.value++}>+1</button>`);
  });
  assert.equal(root, btn, "ボタンを採用（===）");
  assert.equal(mutations, 0, "リスナ付与は childList を変えない");
  btn.click();
  btn.click();
  assert.equal(count.value, 2, "採用後に click が発火する");
});

// === ref ===
test("hydrate: ref に既存要素が渡る", () => {
  let captured: Element | null = null;
  const server = emit`<input ref=${(el: Element) => (captured = el)}>`;
  const container = serve(server);
  const input = container.querySelector("input")!;
  runHydration(container, () => html`<input ref=${(el: Element) => (captured = el)}>`);
  assert.equal(captured, input, "ref は採用した既存要素を受け取る（===）");
});

// === 静的な子＋部分埋め込み属性 ===
test("hydrate: 静的な子は配線せず、部分埋め込み属性は採用更新できる", () => {
  const x = signal("on");
  const server = emit`<div class="box ${x}">static<span>${"s"}</span></div>`;
  assert.equal(
    server,
    '<div class="box on">static<span>s</span></div>',
    "前提: 静的子はマーカーなし",
  );
  const container = serve(server);
  const div = container.querySelector("div")!;
  const span = container.querySelector("span")!;
  const staticText = div.firstChild!; // "static"

  let root!: Node;
  const mutations = countChildListMutations(container, () => {
    root = runHydration(
      container,
      () => html`<div class="box ${x}">static<span>${"s"}</span></div>`,
    );
  });
  assert.equal(root, div, "ルート採用（===）");
  assert.equal(span, container.querySelector("span"), "子要素も採用（===）");
  assert.equal(div.firstChild, staticText, "静的テキストも同一（===）");
  assert.equal(mutations, 0, "childList は変えない");

  x.value = "off";
  assert.equal(div.getAttribute("class"), "box off", "部分埋め込み属性が更新される");
});

// === 複数の reactive 子（採番の対応） ===
test("hydrate: 複数の reactive 子穴が順番どおり採用される", () => {
  const a = signal("A");
  const b = signal("B");
  const tpl = () => html`<p>${() => a.value}-<i>${() => b.value}</i></p>`;
  const server = emit`<p>${() => a.value}-<i>${() => b.value}</i></p>`;
  const container = serve(server);

  runHydration(container, tpl);
  const p = container.querySelector("p")!;
  const i = container.querySelector("i")!;
  assert.equal(p.textContent, "A-B", "初期表示");
  a.value = "X";
  b.value = "Y";
  assert.equal(p.textContent, "X-Y", "両方の子穴が独立に更新される");
  assert.equal(container.querySelector("i"), i, "ネストした要素も作り直していない（===）");
});

// === For の採用 ===
// emit はまだ For をシリアライズできない（DOM の DocumentFragment を返すため）ので、
// サーバ DOM を手組みして採用を確認する（stage 4 の orchestrator が将来やる位置合わせを再現）。
test("For: 既存行を採用し、作り直さず reactive に動く", () => {
  const items = signal([
    { id: 1, text: "one" },
    { id: 2, text: "two" },
  ]);
  // サーバ相当の手組み HTML（<!--for-->…<!--/for--> と、各行に reactive 子の開閉ペア）。
  const container = serve(
    "<ul><!--for-->" +
      "<li><!--hole-->one<!--/hole--></li>" +
      "<li><!--hole-->two<!--/hole--></li>" +
      "<!--/for--></ul>",
  );
  const ul = container.querySelector("ul")!;
  const li1 = ul.children[0];
  const li2 = ul.children[1];

  const mutations = countChildListMutations(container, () => {
    runHydration(ul, () =>
      For(
        items,
        (it) => it.id,
        (it) => html`<li>${() => it().text}</li>`,
      ),
    );
  });
  assert.equal(mutations, 0, "既存行の採用では childList を変えない");
  assert.equal(ul.children[0], li1, "1行目を採用（===）");
  assert.equal(ul.children[1], li2, "2行目を採用（===）");

  // 採用後の reactivity: テキスト更新・並べ替え・追加。
  items.value = [
    { id: 1, text: "ONE" },
    { id: 2, text: "two" },
  ];
  assert.equal(li1.textContent, "ONE", "採用した行の reactive 子が更新される");

  items.value = [
    { id: 2, text: "two" },
    { id: 1, text: "ONE" },
  ];
  assert.equal(ul.children[0], li2, "並べ替えても行ノードを使い回す（===）");
  assert.equal(ul.children[1], li1, "並べ替えても行ノードを使い回す（===）");

  items.value = [{ id: 2, text: "two" }];
  assert.equal(ul.children.length, 1, "削除が反映される");
  assert.equal(ul.children[0], li2, "残った行はそのまま（===）");
});

// === Show の採用（真） ===
test("Show: 真の既存中身を採用し、reactive に切り替えできる", () => {
  const on = signal(true);
  const container = serve("<div><!--show--><p><!--hole-->yes<!--/hole--></p><!--/show--></div>");
  const wrap = container.querySelector("div")!;
  const p = wrap.querySelector("p")!;

  const mutations = countChildListMutations(container, () => {
    runHydration(wrap, () => Show(on, () => html`<p>${() => "yes"}</p>`));
  });
  assert.equal(mutations, 0, "真の中身の採用では childList を変えない");
  assert.equal(wrap.querySelector("p"), p, "中身を採用（===）");

  on.value = false;
  assert.equal(wrap.querySelector("p"), null, "false に切り替えると中身が消える");
  on.value = true;
  assert.ok(wrap.querySelector("p"), "true に戻すと再生成される");
});

// === Show の採用（偽 → fallback なし） ===
test("Show: 偽（中身なし）の採用後に真へ切り替えできる", () => {
  const on = signal(false);
  const container = serve("<div><!--show--><!--/show--></div>");
  const wrap = container.querySelector("div")!;

  runHydration(wrap, () => Show(on, () => html`<p>${() => "hi"}</p>`));
  assert.equal(wrap.querySelector("p"), null, "偽のあいだは中身なし");
  on.value = true;
  assert.equal(wrap.querySelector("p")?.textContent, "hi", "真にすると中身が出る");
});

// === パリティ: emit と CSR の構造が一致する ===
test("parity: emit 出力と CSR 描画の構造（reactive 子のマーカー）が一致する", () => {
  const count = signal(1);
  const server = emit`<span>n=${() => count.value}</span>`;
  // CSR 描画の outerHTML（reactive 子は <!--hole-->…<!--/hole-->）。
  const csr = html`<span>n=${() => count.value}</span>` as HTMLElement;
  assert.equal(server, csr.outerHTML, "emit と CSR で同じマーカー構造になる（mismatch 回帰検出）");
});
