// test-dom.ts — html / For / Show / defineElement の DOM テスト
// 実行: node --test dist/test/  (jsdom が必要)

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><body></body>");
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).NodeFilter = dom.window.NodeFilter;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).customElements = dom.window.customElements;
(globalThis as any).MutationObserver = dom.window.MutationObserver;

const { signal, effect } = await import("../src/reactive.js");
const { html } = await import("../src/html.js");
const { For } = await import("../src/for.js");
const { Show } = await import("../src/show.js");
const { defineElement } = await import("../src/element.js");

const mount = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

// === html (tagged template literal) ===
test("html: 単一ルート要素と reactive 子", () => {
  const [count, setCount] = signal(0);
  const el = html`<span>count: ${count}</span>` as HTMLElement;
  assert.equal(el.tagName, "SPAN", "html: 単一ルート要素を返す");
  assert.equal(el.textContent, "count: 0", "html: reactive 子の初期値");
  setCount(7);
  assert.equal(el.textContent, "count: 7", "html: reactive 子の更新");
});
test("html: onClick", () => {
  const [count, setCount] = signal(0);
  const el = html`<button onClick=${() => setCount(count() + 1)}>+1</button>` as HTMLElement;
  assert.ok(!el.hasAttribute("onclick"), "html: onClick 属性を取り除く");
  el.click();
  el.click();
  assert.equal(count(), 2, "html: onClick が発火する");
});
test("html: reactive 属性", () => {
  const [on, setOn] = signal(false);
  const el = html`<div class=${() => (on() ? "active" : "idle")}></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "idle", "html: reactive 属性 初期");
  setOn(true);
  assert.equal(el.getAttribute("class"), "active", "html: reactive 属性 更新");
});
test("html: 部分埋め込み 属性", () => {
  const [on, setOn] = signal(false);
  const el = html`<div class="box ${() => (on() ? "on" : "off")}"></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "box off", "html: 部分埋め込み 属性 初期");
  setOn(true);
  assert.equal(el.getAttribute("class"), "box on", "html: 部分埋め込み 属性 更新");
});
test("html: 静的な穴で属性を設定 / false で外す", () => {
  const el = html`<input value=${"hello"} disabled=${false} title=${"t"}>` as HTMLInputElement;
  assert.equal(el.getAttribute("value"), "hello", "html: 接頭辞なしの穴は属性に入る");
  assert.equal(el.disabled, false, "html: false の穴で disabled が外れる");
  assert.ok(!el.hasAttribute("disabled"), "html: マーカー属性が残らない");
  assert.equal(el.getAttribute("title"), "t", "html: 通常キーは従来どおり属性");
});
test("html: `.value` 穴は DOM プロパティに入る（accessor 直渡し・入力後も反映）", () => {
  const [text, setText] = signal("first");
  const el = html`<input .value=${text}>` as HTMLInputElement; // accessor 直渡し
  assert.equal(el.value, "first", "html: .value 初期値");
  assert.ok(!el.hasAttribute(".value"), "html: `.value` という属性は残らない");
  assert.ok(!el.hasAttribute("value"), "html: プロパティ穴は属性に書かない");
  el.value = "user typed"; // ユーザー入力で乖離
  setText("second");
  assert.equal(el.value, "second", "html: 乖離後も signal の変更が反映される");
});
test("html: `.items` 穴はリッチな値を DOM プロパティに入れる", () => {
  const [items, setItems] = signal<string[]>(["x"]);
  const el = html`<x-rich .items=${items}></x-rich>` as HTMLElement; // accessor 直渡し
  assert.deepEqual((el as any).items, ["x"], "html: `.items` でプロパティ");
  assert.ok(!el.hasAttribute("items"), "html: プロパティ穴は属性に書かない");
  setItems(["x", "y"]);
  assert.deepEqual((el as any).items, ["x", "y"], "html: reactive にプロパティ更新");
});
test("html: `.items` 穴に静的なリッチ値も渡せる", () => {
  const arr = ["a", "b"];
  const el = html`<x-rich .items=${arr}></x-rich>` as HTMLElement;
  assert.equal((el as any).items, arr, "html: 静的な配列がそのままプロパティに入る");
  assert.ok(!el.hasAttribute("items"), "html: `.foo` は属性に書かない");
});
test("html: `.checked` 穴はプロパティ false で外れる", () => {
  const [on, setOn] = signal(true);
  const el = html`<input type="checkbox" .checked=${on}>` as HTMLInputElement;
  assert.equal(el.checked, true, "html: .checked 初期値");
  setOn(false);
  assert.equal(el.checked, false, "html: .checked false でプロパティが外れる");
});
test("html: 接頭辞なしの value は属性のまま（初期値だけ・入力後は乖離）", () => {
  const el = html`<input value=${"first"}>` as HTMLInputElement;
  assert.equal(el.getAttribute("value"), "first", "html: value は属性に書かれる");
  el.value = "user typed"; // ユーザー入力でプロパティが乖離
  assert.equal(el.getAttribute("value"), "first", "html: 属性は初期値のまま");
});
test("html: 構築は1回（穴だけ更新）", () => {
  const [count, setCount] = signal(0);
  let builds = 0;
  const el = ((): HTMLElement => {
    builds++;
    return html`<span>${count}</span>` as HTMLElement;
  })();
  setCount(5);
  assert.ok(builds === 1 && el.textContent === "5", `html: 構築は1回 builds=${builds}`);
});
test("html: Node / 配列の穴を差し込む", () => {
  const inner = html`<b>x</b>`;
  const el = html`<div>${inner}${[html`<i>a</i>`, html`<i>b</i>`]}</div>` as HTMLElement;
  assert.equal(el.querySelector("b")?.textContent, "x", "html: Node の穴を差し込む");
  assert.equal(el.querySelectorAll("i").length, 2, "html: 配列の穴を並べる");
});
test("html: 複数ルートは fragment", () => {
  const frag = html`<p>a</p><p>b</p>`; // 複数ルート（空白を挟む）は DocumentFragment を返す
  const host = mount();
  host.append(frag);
  assert.equal(host.querySelectorAll("p").length, 2, "html: 複数ルートは fragment");
});

// === class / style のオブジェクト形式（html の穴・node.ts setAttr）===
test("class: オブジェクトは真のキーだけ space 結合", () => {
  const el = html`<div class=${{ active: true, disabled: false, big: 1 }}></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "active big", "class: 真のキーだけ");
});
test("class: reactive オブジェクトで反転を追従", () => {
  const [on, setOn] = signal(false);
  const el = html`<div class=${() => ({ active: on(), base: true })}></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "base", "class: 初期は base のみ");
  setOn(true);
  assert.equal(el.getAttribute("class"), "active base", "class: 反転で active 追加");
});
test("class: 文字列は従来どおり（回帰）", () => {
  const el = html`<div class=${"box"}></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "box", "class: 文字列はそのまま");
});
test("style: オブジェクトは el.style へ個別代入（camelCase / kebab / --custom）", () => {
  const el =
    html`<div style=${{ color: "red", fontSize: "12px", "--gap": "4px" }}></div>` as HTMLElement;
  assert.equal(el.style.color, "red", "style: camelCase color");
  assert.equal(el.style.fontSize, "12px", "style: camelCase fontSize");
  assert.equal(el.style.getPropertyValue("--gap"), "4px", "style: --custom");
});
test("style: reactive で消えたキーは inline からも消える", () => {
  const [big, setBig] = signal(true);
  const el = html`<div
    style=${() => (big() ? { color: "red", fontSize: "20px" } : { color: "red" })}
  ></div>` as HTMLElement;
  assert.equal(el.style.fontSize, "20px", "style: 初期は fontSize あり");
  setBig(false);
  assert.equal(el.style.color, "red", "style: color は残る");
  assert.equal(el.style.fontSize, "", "style: 消えた fontSize は残らない");
});

// === 静的部分の HTML コメント（パーサの inTag 判定）===
// コメントは `<!-- ... -->` まで読み飛ばし、中身の `'` / `>` / `<` で inTag を誤らない。
test("html: アポストロフィを含むコメントの後の reactive 子穴が配線される", () => {
  const [count, setCount] = signal(5);
  // `it's` の `'` で quote が開き `-->` の `>` を飲み込むと、続く穴が属性扱いになって壊れる回帰。
  const el = html`<div><!-- it's a note -->${count}</div>` as HTMLElement;
  assert.equal(el.textContent, "5", "html: コメント直後の子穴が reactive に描画される");
  setCount(9);
  assert.equal(el.textContent, "9", "html: コメント直後の子穴が更新に追従する");
});
test("html: `>` を含むコメントの後の属性穴が正しい要素に配線される", () => {
  const [cls, setCls] = signal("on");
  const el = html`<div><!-- a > b --></div><span class=${cls}></span>` as DocumentFragment;
  const span = (el as unknown as DocumentFragment).querySelector("span")!;
  assert.equal(span.getAttribute("class"), "on", "html: コメント後の属性穴が span に乗る");
  setCls("off");
  assert.equal(span.getAttribute("class"), "off", "html: コメント後の属性穴が更新に追従する");
});
test("html: コメント内の `<` でタグ開始扱いにならない", () => {
  const [count] = signal(1);
  const el = html`<div><!-- <button> -->${count}</div>` as HTMLElement;
  assert.equal(
    el.querySelectorAll("button").length,
    0,
    "html: コメント内の <button> は要素化しない",
  );
  assert.equal(el.textContent, "1", "html: コメント直後の子穴が配線される");
});

// === ref ===
test("html: ref が完成した要素を1度だけ受け取る", () => {
  let got: Element | null = null;
  let calls = 0;
  const el = html`<div
    ref=${(e: Element) => {
      got = e;
      calls++;
    }}
  ><span>child</span></div>` as HTMLElement;
  assert.equal(got, el, "html: ref に作った要素そのものが渡る");
  assert.equal(calls, 1, "html: ref は1度だけ呼ばれる");
  // ref が呼ばれた時点で子まで配線済み（完成後に渡す不変条件）。
  assert.equal(
    (got as unknown as Element).querySelector("span")!.textContent,
    "child",
    "html: 子が揃っている",
  );
});
test("html: ref が内側の要素を完成後に受け取る", () => {
  const [count] = signal(2);
  let got: Element | null = null;
  const root = html`<div><input ref=${(e: Element) => (got = e)} /><span>${count}</span></div>`;
  assert.ok(got != null && (got as Element).tagName === "INPUT", "html: ref に内側の input が渡る");
  // テンプレート全体の配線が済んだ後に呼ばれる（兄弟の reactive 子も解決済み）。
  assert.equal(
    (root as Element).querySelector("span")!.textContent,
    "2",
    "html: 兄弟の穴も配線済み",
  );
});

// === accessor を直接渡す（関数ラップ不要）===
test("html: accessor を子・属性に直接渡す", () => {
  const [count, setCount] = signal(0);
  const [color, setColor] = signal("red");
  const el = html`<div class=${color}>${count}</div>` as HTMLElement;
  assert.equal(el.textContent, "0", "html: accessor を子に直接");
  assert.equal(el.getAttribute("class"), "red", "html: accessor を属性に直接");
  setCount(3);
  setColor("blue");
  assert.equal(el.textContent, "3", "html: accessor 子の更新");
  assert.equal(el.getAttribute("class"), "blue", "html: accessor 属性の更新");
});
test("html: 丸ごとの属性穴では false/null で属性を外す", () => {
  // 丸ごとの属性穴では false / null は属性を外す（真偽属性の意味）
  const [on, setOn] = signal<boolean>(false);
  const el = html`<input disabled=${on}>` as HTMLElement;
  assert.ok(!el.hasAttribute("disabled"), "html: accessor=false で属性を外す");
  setOn(true);
  assert.equal(el.getAttribute("disabled"), "", "html: accessor=true で属性を付ける");
});
test("html: 部分埋め込みに accessor", () => {
  const [cls, setCls] = signal("a");
  const el = html`<div class="box ${cls}"></div>` as HTMLElement;
  assert.equal(el.getAttribute("class"), "box a", "html: 部分埋め込みに accessor 初期");
  setCls("b");
  assert.equal(el.getAttribute("class"), "box b", "html: 部分埋め込みに accessor 更新");
});
test("setAttr: aria-*/data-* も真偽値は全キー共通（false=削除で付け外しできる）", () => {
  // 真偽値の意味は他の属性と同じ: true=空文字（present）/ false=削除（absent）。
  const [on, setOn] = signal(true);
  const el = html`<div data-on=${on}></div>` as HTMLElement;
  assert.equal(el.getAttribute("data-on"), "", "setAttr: data-* の true は空文字");
  setOn(false);
  assert.equal(
    el.hasAttribute("data-on"),
    false,
    "setAttr: data-* の false で外れる（付け外し可）",
  );
  setOn(true);
  assert.equal(el.hasAttribute("data-on"), true, "setAttr: data-* を再び付けられる");
});
test('setAttr: "false" という文字列はそのまま属性に書ける（aria-hidden=false）', () => {
  // "false" 自体を残したいときは真偽値ではなく文字列を渡す。
  const el = html`<div aria-hidden=${"false"} data-flag=${"true"}></div>` as HTMLElement;
  assert.equal(el.getAttribute("aria-hidden"), "false", 'setAttr: 文字列 "false" はそのまま');
  assert.equal(el.getAttribute("data-flag"), "true", 'setAttr: 文字列 "true" はそのまま');
});
test("toNode: 子の true / false はどちらも非表示", () => {
  const [flag, setFlag] = signal<boolean>(true);
  const el = html`<span>[${flag}]</span>` as HTMLElement;
  assert.equal(el.textContent, "[]", "toNode: true の子は描かない（false と対称）");
  setFlag(false);
  assert.equal(el.textContent, "[]", "toNode: false の子も描かない");
});

// === html: 関数の穴が Node / 配列を返す（範囲再描画）===
test("html: 関数穴で .map リスト", () => {
  const [items, setItems] = signal([
    { id: 1, t: "A" },
    { id: 2, t: "B" },
  ]);
  const el = html`<ul>${() => items().map((i) => html`<li>${i.t}</li>`)}</ul>` as HTMLElement;
  const texts = () => [...el.querySelectorAll("li")].map((x) => x.textContent).join("");
  assert.equal(texts(), "AB", "html: 関数穴で .map リスト初期");
  setItems([...items(), { id: 3, t: "C" }]);
  assert.equal(texts(), "ABC", "html: 関数穴で .map リスト更新");
  setItems([]);
  assert.equal(texts(), "", "html: 関数穴で空配列");
});
test("html: 関数穴の条件分岐", () => {
  const [ok, setOk] = signal(false);
  const el = html`<div>${() => (ok() ? html`<p>yes</p>` : null)}</div>` as HTMLElement;
  assert.equal(el.querySelector("p"), null, "html: 関数穴の条件分岐 初期(null)");
  setOk(true);
  assert.equal(el.querySelector("p")?.textContent, "yes", "html: 関数穴の条件分岐 表示");
  setOk(false);
  assert.equal(el.querySelector("p"), null, "html: 関数穴の条件分岐 非表示");
});
test("html: 除去した分岐の effect は止まる", () => {
  // 消えた分岐の effect は所有権ツリーで自動 dispose される
  const [ok, setOk] = signal(true);
  const [inner, setInner] = signal(0);
  let runs = 0;
  const el = html`<div>${() =>
    ok()
      ? html`<b>${() => {
          runs++;
          return inner();
        }}</b>`
      : null}</div>` as HTMLElement;
  assert.equal(el.querySelector("b")?.textContent, "0", "html: ネストした穴も reactive (値)");
  assert.equal(runs, 1, "html: ネストした穴も reactive (回数)");
  setInner(1);
  assert.equal(el.querySelector("b")?.textContent, "1", "html: ネストした穴の更新 (値)");
  assert.equal(runs, 2, "html: ネストした穴の更新 (回数)");
  setOk(false); // 分岐ごと除去
  setInner(2); // 死んだ分岐の signal を更新しても…
  assert.equal(runs, 2, "html: 除去した分岐の effect は止まる");
});
test("html: プリミティブ穴はノード使い回し", () => {
  // プリミティブの関数穴はテキストノードを使い回す（fast path）
  const [count, setCount] = signal(0);
  const el = html`<span>${count}</span>` as HTMLElement;
  const t = [...el.childNodes].find((n) => n.nodeType === 3);
  setCount(9);
  assert.ok(
    el.textContent === "9" && [...el.childNodes].includes(t!),
    "html: プリミティブ穴はノード使い回し",
  );
});
test("html: accessor が Node を返す", () => {
  // accessor の穴が Node を返しても動く（関数穴として範囲を作り替える）
  const [node, setNode] = signal<Node>(html`<em>x</em>`);
  const el = html`<div>${node}</div>` as HTMLElement;
  assert.equal(el.querySelector("em")?.textContent, "x", "html: accessor で Node 初期");
  setNode(html`<strong>y</strong>`);
  assert.ok(
    el.querySelector("strong")?.textContent === "y" && el.querySelector("em") === null,
    "html: accessor で Node 更新",
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
    // 属性名／スプレッド位置の穴は配線できず無視される。
    const el = html`<div ${"x"}>hi</div>` as HTMLElement;
    assert.equal(el.textContent, "hi", "html: スプレッド位置の穴は無視される");
    assert.equal(warns >= (dev ? 1 : 0), true, "無視するときは dev で警告する");
  } finally {
    console.warn = orig;
  }
});

// === For ===
test("For: 描画・並べ替え・追加・削除", () => {
  const [items, setItems] = signal([
    { id: "a", t: "A" },
    { id: "b", t: "B" },
    { id: "c", t: "C" },
  ]);
  let rendered = 0;
  const el = mount();
  el.append(
    html`<ul>${For(
      items,
      (i) => i.id,
      (item) => {
        rendered++;
        const [n, setN] = signal(0);
        return html`<li data-id=${() => item().id}>
          <b>${n}</b>
          <button onClick=${() => setN(n() + 1)}>+</button>
        </li>`;
      },
    )}</ul>`,
  );
  const ids = () => [...el.querySelectorAll("li")].map((x) => x.getAttribute("data-id")).join("");
  const liByID = (id: string) => el.querySelector(`li[data-id="${id}"]`)!;

  assert.ok(ids() === "abc" && rendered === 3, `For: 初期描画 ids=${ids()} rendered=${rendered}`);

  liByID("a").querySelector("button")!.click();
  liByID("a").querySelector("button")!.click();
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 行ローカル状態を作る");

  const aBefore = liByID("a");
  setItems([items()[2], items()[0], items()[1]]); // → c, a, b
  assert.equal(ids(), "cab", "For: 並べ替えで順序が更新");
  assert.ok(aBefore === liByID("a"), "For: ノードを使い回す（参照同一）");
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 並べ替えで状態が保たれる");
  assert.equal(rendered, 3, "For: 並べ替えでは再 render しない");

  setItems([...items(), { id: "d", t: "D" }]); // 追加
  assert.equal(rendered, 4, "For: 追加は1回だけ render");
  assert.equal(liByID("a").querySelector("b")!.textContent, "2", "For: 追加で既存ノードは温存");

  setItems(items().filter((i) => i.id !== "a")); // 削除
  assert.ok(liByID("a") === null && ids() === "cbd", `For: 削除で該当行だけ消える ids=${ids()}`);
});
test("For: 同位置のノードは insertBefore しない", () => {
  const [items, setItems] = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const el = mount();
  const list = html`<ul>${For(
    items,
    (i) => i.id,
    (item) => html`<li data-id=${() => item().id}>${() => item().id}</li>`,
  )}</ul>` as HTMLElement;
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
  setItems([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(inserts, 0, "For: 順序不変なら insertBefore しない");
  assert.equal(ids(), "abc", "For: 順序不変で並びも保たれる");

  // 末尾追加 → 追加した1ノードだけ insertBefore
  inserts = 0;
  setItems([...items(), { id: "d" }]);
  assert.equal(inserts, 1, "For: 末尾追加は1回だけ insertBefore");
  assert.equal(ids(), "abcd", "For: 末尾追加で並びが正しい");

  // 並べ替え → 結果が正しい（移動回数は最小でなくてよい）
  inserts = 0;
  setItems([items()[3], items()[0], items()[1], items()[2]]); // d,a,b,c
  assert.equal(ids(), "dabc", "For: 並べ替えで順序が更新");
  assert.ok(inserts > 0 && inserts < 4, `For: 全ノード移動はしない inserts=${inserts}`);
});
test("For: 重複キーで throw", () => {
  const [items] = signal([{ id: "x" }, { id: "x" }]);
  const el = mount();
  let threw = false;
  try {
    el.append(
      html`<ul>${For(
        items,
        (i: { id: string }) => i.id,
        (item: () => { id: string }) => html`<li>${() => item().id}</li>`,
      )}</ul>`,
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, "For: 重複キーで throw");
});
test("For: 同じ key・新オブジェクトで行内が更新される（#17）", () => {
  const [items, setItems] = signal([
    { id: "a", done: false },
    { id: "b", done: false },
  ]);
  let rendered = 0;
  const el = mount();
  el.append(
    html`<ul>${For(
      items,
      (i) => i.id,
      (item) => {
        rendered++;
        return html`<li data-id=${() => item().id}>${() => (item().done ? "✓" : "・")}</li>`;
      },
    )}</ul>`,
  );
  const cell = (id: string) => el.querySelector(`li[data-id="${id}"]`)!.textContent;
  const aBefore = el.querySelector('li[data-id="a"]');
  assert.ok(cell("a") === "・" && cell("b") === "・", "For#17: 初期描画");

  // immutable 更新（同 key・新オブジェクト）
  setItems(items().map((x) => ({ ...x, done: true })));
  assert.ok(cell("a") === "✓" && cell("b") === "✓", "For#17: 同 key 新オブジェクトで穴が更新");
  assert.ok(aBefore === el.querySelector('li[data-id="a"]'), "For#17: 行ノードは使い回す");
  assert.equal(rendered, 2, "For#17: 再 render はしない（穴だけ更新）");
});
test("For: render に index が渡る（#18）", () => {
  const [items, setItems] = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const el = mount();
  el.append(
    html`<ul>${For(
      items,
      (i) => i.id,
      (item, index) =>
        html`<li data-id=${() => item().id}>${() => `${index() + 1}:${item().id}`}</li>`,
    )}</ul>`,
  );
  const cell = (id: string) => el.querySelector(`li[data-id="${id}"]`)!.textContent;
  assert.ok(
    cell("a") === "1:a" && cell("b") === "2:b" && cell("c") === "3:c",
    "For#18: 初期 index",
  );

  // 並べ替え → index が更新される
  setItems([items()[2], items()[0], items()[1]]); // c, a, b
  assert.ok(
    cell("c") === "1:c" && cell("a") === "2:a" && cell("b") === "3:b",
    "For#18: 並べ替えで index が更新",
  );

  // 先頭削除 → 後続の index が繰り上がる
  setItems(items().filter((i) => i.id !== "c")); // a, b
  assert.ok(cell("a") === "1:a" && cell("b") === "2:b", "For#18: 削除で index が繰り上がる");
});
test("For: accessor 直渡し", () => {
  const [items, setItems] = signal([{ id: "a" }, { id: "b" }]);
  const el = mount();
  el.append(
    html`<ul>${For(
      items,
      (i: { id: string }) => i.id,
      (item: () => { id: string }) => html`<li data-id=${() => item().id}>${() => item().id}</li>`,
    )}</ul>`,
  );
  assert.equal(el.querySelectorAll("li").length, 2, "For: accessor 直渡しで描画");
  setItems([...items(), { id: "c" }]);
  assert.equal(el.querySelectorAll("li").length, 3, "For: accessor 直渡しで更新");
});

// === Show ===
test("Show: 本体と fallback の切替", () => {
  const [visible, setVisible] = signal(true);
  let made = 0;
  const el = mount();
  el.append(
    html`<div>${Show(
      visible,
      () => {
        made++;
        return html`<span class="yes">見える</span>`;
      },
      () => html`<span class="no">隠れた</span>`,
    )}</div>`,
  );
  assert.equal(
    el.querySelector(".yes")?.textContent,
    "見える",
    "Show: when=true で本体を表示 (内容)",
  );
  assert.equal(made, 1, "Show: when=true で本体を表示 (回数)");
  setVisible(false);
  assert.ok(
    !el.querySelector(".yes") && !!el.querySelector(".no"),
    "Show: false で fallback に切替",
  );
  setVisible(true);
  assert.ok(!!el.querySelector(".yes"), "Show: true で本体を再表示 (表示)");
  assert.equal(made, 2, "Show: true で本体を再表示 (回数)");
});
test("Show: false かつ fallback 省略で何も表示しない", () => {
  const [visible, setVisible] = signal(false);
  const el = mount();
  el.append(html`<div>${Show(visible, () => html`<span class="yes">見える</span>`)}</div>`);
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback 省略で何も表示しない");
  setVisible(true);
  assert.ok(!!el.querySelector(".yes"), "Show: その後 true で本体表示");
});
test("Show: false かつ fallback=null で何も表示しない", () => {
  const [visible] = signal(false);
  const el = mount();
  el.append(html`<div>${Show(visible, () => html`<span class="yes">見える</span>`, null)}</div>`);
  assert.ok(!el.querySelector(".yes"), "Show: false かつ fallback=null で何も表示しない");
});
test("Show: render が null を返しても内部 effect が dispose される (#39)", () => {
  const [visible, setVisible] = signal(true);
  const [dep, setDep] = signal(0);
  let runs = 0;
  const el = mount();
  el.append(
    html`<div>${Show(visible, () => {
      // node は作らず（null を返す）、内部で effect だけ張る
      effect(() => {
        dep();
        runs++;
      });
      return null;
    })}</div>`,
  );
  assert.equal(runs, 1, "Show: 初回に内部 effect が走る");
  setDep(dep() + 1);
  assert.equal(runs, 2, "Show: 表示中は内部 effect が反応する");
  // when を false にすると前の中身（node=null でも）を dispose する
  setVisible(false);
  setDep(dep() + 1);
  assert.equal(runs, 2, "Show: 切替後は内部 effect が dispose され反応しない");
});
test("Show: render に真だった値の accessor が渡る (#19)", () => {
  const [user, setUser] = signal<{ name: string } | null>(null);
  const el = mount();
  el.append(
    html`<div>${Show(
      user,
      // value() は NonNullable に絞られ、null チェックの再記述が要らない
      (value) => html`<span class="name">${() => value().name}</span>`,
    )}</div>`,
  );
  assert.ok(!el.querySelector(".name"), "Show: 初期は null で本体なし");
  setUser({ name: "ada" });
  assert.equal(
    el.querySelector(".name")?.textContent,
    "ada",
    "Show: 真になったら value() の値で本体を表示",
  );
  // 真のまま値が変わったら（部分木は据え置きのまま）accessor 経由で追従する
  setUser({ name: "grace" });
  assert.equal(
    el.querySelector(".name")?.textContent,
    "grace",
    "Show: 真のまま値が変わると accessor が追従する",
  );
  // 偽に戻したら本体は消える（accessor から偽値が読まれて落ちたりしない）
  setUser(null);
  assert.ok(!el.querySelector(".name"), "Show: 偽に戻すと本体が消える");
});
test("Show: accessor 直渡し", () => {
  const [visible, setVisible] = signal(true);
  const el = mount();
  el.append(
    html`<div>${Show(
      visible,
      () => html`<span class="yes">見える</span>`,
      () => html`<span class="no">隠れた</span>`,
    )}</div>`,
  );
  assert.ok(!!el.querySelector(".yes"), "Show: accessor 直渡し true で本体");
  setVisible(false);
  assert.ok(
    !el.querySelector(".yes") && !!el.querySelector(".no"),
    "Show: accessor 直渡し false で fallback",
  );
});

// MutationObserver は jsdom でも非同期配信なので、属性変化の反映を待つ用。
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// === defineElement ===
test("defineElement: 基本（描画 + 内部 signal で reactive）", () => {
  defineElement("x-counter", () => {
    const [count, setCount] = signal(0);
    return html`<div>
      <span>${count}</span>
      <button onClick=${() => setCount(count() + 1)}>+1</button>
    </div>`;
  });
  const el = document.createElement("x-counter");
  document.body.append(el);
  assert.equal(el.querySelector("span")?.textContent, "0", "defineElement: connected で描画");
  el.querySelector("button")!.click();
  assert.equal(el.querySelector("span")?.textContent, "1", "defineElement: 内部 signal で再描画");
});
test("defineElement: 切断確定で root を畳む（遅延 dispose）", async () => {
  const [ext, setExt] = signal(0);
  let runs = 0;
  defineElement("x-life", () => {
    return html`<div>${() => {
      runs++;
      return ext();
    }}</div>`;
  });

  const el = document.createElement("x-life");
  document.body.append(el);
  assert.equal(runs, 1, "defineElement: マウント時に effect が1回走る");
  setExt(1);
  assert.equal(runs, 2, "defineElement: 接続中は外部 signal に反応 (回数)");
  assert.equal(
    el.querySelector("div")?.textContent,
    "1",
    "defineElement: 接続中は外部 signal に反応 (値)",
  );

  el.remove(); // disconnected → 次の microtask で dispose
  await tick();
  setExt(2);
  assert.equal(runs, 2, "defineElement: 切断確定後は effect が走らない（dispose 済み）");
});
test("defineElement: onCleanup が切断確定で呼ばれる", async () => {
  const { onCleanup } = await import("../src/reactive.js");
  const state = { cleaned: false }; // オブジェクト経由にして TS の literal 絞り込みを避ける
  defineElement("x-cleanup", () => {
    onCleanup(() => {
      state.cleaned = true;
    });
    return html`<div>hi</div>`;
  });
  const el = document.createElement("x-cleanup");
  document.body.append(el);
  assert.equal(state.cleaned, false, "defineElement: 接続中は onCleanup 未発火");
  el.remove();
  await tick(); // 遅延 dispose を確定させる
  assert.equal(state.cleaned, true, "defineElement: 切断確定で onCleanup 発火");
});
test("defineElement: ctx.prop に属性の変更が流れ込む", async () => {
  defineElement("x-greet", ({ prop }) => {
    const [name] = prop("name");
    return html`<p>${() => `hello ${name() ?? "?"}`}</p>`;
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
  defineElement("x-list", ({ prop }) => {
    const [items] = prop<string[]>("items", []);
    return html`<ul>${() => items().map((x) => html`<li>${x}</li>`)}</ul>`;
  });
  const el = document.createElement("x-list");
  document.body.append(el);
  assert.equal(el.querySelectorAll("li").length, 0, "defineElement: prop 初期値（initial）");
  (el as any).items = ["a", "b"]; // accessor 経由で signal に入る（同期）
  assert.equal(el.querySelectorAll("li").length, 2, "defineElement: プロパティ代入で再描画");
  assert.equal((el as any).items.length, 2, "defineElement: プロパティ読み出しは signal から");
});
test("defineElement: upgrade 前のプロパティ代入を初期値として拾う", () => {
  const el = document.createElement("x-early");
  (el as any).label = "early"; // define 前＝ただの data property
  defineElement("x-early", ({ prop }) => {
    const [label] = prop("label", "default");
    return html`<span>${() => String(label())}</span>`;
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
test("defineElement: ctx.host で要素自身に触れる", () => {
  defineElement("x-host", ({ host }) => {
    host.classList.add("ready"); // host 自身を操作
    return html`<div>${host.getAttribute("data-x") ?? ""}</div>`;
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
    return html`<div>m</div>`;
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
    return html`<div>r</div>`;
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
    return html`<div class="own">own</div>`;
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
  defineElement("x-reslot", ({ slot }) => html`<div class="named">${slot("title")}</div>`);
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
  defineElement(
    "x-slotted",
    ({ slot }) =>
      html`<div class="card">
      <header class="h">${slot("title")}</header>
      <section class="b">${slot()}</section>
    </div>`,
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
  defineElement("x-slot-rest", ({ slot }) => html`<div class="named">${slot("foo")}</div>`); // 名前なしの子は拾わない
  const el = document.createElement("x-slot-rest");
  el.innerHTML = `<p class="loose">消える</p>`;
  document.body.append(el);

  assert.equal(el.querySelector(".named")?.childNodes.length, 0, "slot: 一致しない slot は空");
  assert.ok(!el.querySelector(".loose"), "slot: 拾われない子は撤去される");
});
test("defineElement: shadow DOM に描画する", () => {
  defineElement(
    "x-shadow",
    () => {
      const [count] = signal(0);
      return html`<span class="c">${count}</span>`;
    },
    { shadow: true },
  );
  const el = document.createElement("x-shadow");
  document.body.append(el);
  assert.ok(el.shadowRoot, "shadow: open で shadowRoot が生える");
  assert.equal(el.shadowRoot?.querySelector(".c")?.textContent, "0", "shadow: shadowRoot に描画");
  assert.equal(el.querySelector(".c"), null, "shadow: light DOM には描画しない");
});
test("defineElement: shadow DOM 内の signal で再描画", () => {
  const [ext, setExt] = signal(0);
  defineElement("x-shadow-reactive", () => html`<b class="v">${ext}</b>`, {
    shadow: true,
  });
  const el = document.createElement("x-shadow-reactive");
  document.body.append(el);
  assert.equal(el.shadowRoot?.querySelector(".v")?.textContent, "0", "shadow: 初期値");
  setExt(5);
  assert.equal(el.shadowRoot?.querySelector(".v")?.textContent, "5", "shadow: signal で再描画");
});
test("defineElement: shadow DOM でも ctx.slot() は light DOM と同じに動く", () => {
  defineElement(
    "x-shadow-slot",
    ({ slot }) =>
      html`<div class="card">
        <header class="h">${slot("title")}</header>
        <section class="b">${slot()}</section>
      </div>`,
    { shadow: true },
  );
  const el = document.createElement("x-shadow-slot");
  el.innerHTML = `<h2 slot="title">見出し</h2><p>本文</p>`;
  document.body.append(el);
  // light DOM 時とまったく同じ静的投影。投影先が shadowRoot 内になるだけ。
  const root = el.shadowRoot;
  assert.equal(root?.querySelector(".h h2")?.textContent, "見出し", "shadow: 名前付き slot を投影");
  assert.equal(root?.querySelector(".b p")?.textContent, "本文", "shadow: 名前なし slot を投影");
  // 子は退避→投影で移動するので、host の light DOM には残らない（light DOM 時と同じ挙動）。
  assert.equal(el.querySelector("h2"), null, "shadow: 投影は移動なので host には残らない");
});
test("defineElement: shadow DOM の切断確定で root を畳む", async () => {
  const [ext, setExt] = signal(0);
  let runs = 0;
  defineElement(
    "x-shadow-life",
    () =>
      html`<div>${() => {
        runs++;
        return ext();
      }}</div>`,
    { shadow: true },
  );
  const el = document.createElement("x-shadow-life");
  document.body.append(el);
  assert.equal(runs, 1, "shadow: マウントで effect が1回");
  el.remove();
  await tick();
  setExt(1);
  assert.equal(runs, 1, "shadow: 切断確定後は effect が走らない");
  assert.equal(el.shadowRoot?.childNodes.length, 0, "shadow: 切断確定で shadowRoot を畳む");
});
test("defineElement: shadow DOM の再接続で setup し直す（attachShadow は1回）", async () => {
  let setups = 0;
  defineElement(
    "x-shadow-reinit",
    () => {
      setups++;
      return html`<div class="r">r</div>`;
    },
    { shadow: true },
  );
  const el = document.createElement("x-shadow-reinit");
  document.body.append(el);
  const firstRoot = el.shadowRoot;
  assert.equal(setups, 1, "shadow: 初回 setup");
  el.remove();
  await tick();
  document.body.append(el);
  assert.equal(setups, 2, "shadow: 再接続で setup し直す");
  assert.equal(el.shadowRoot, firstRoot, "shadow: 再接続でも同じ shadowRoot を使い回す");
  assert.equal(el.shadowRoot?.querySelector(".r")?.textContent, "r", "shadow: 再接続後も描画");
});
test("defineElement: shadow DOM の再接続で slot 内容が復元される", async () => {
  defineElement("x-shadow-reslot", ({ slot }) => html`<div class="named">${slot("title")}</div>`, {
    shadow: true,
  });
  const el = document.createElement("x-shadow-reslot");
  el.innerHTML = `<h2 slot="title">見出し</h2>`;
  document.body.append(el);
  assert.equal(
    el.shadowRoot?.querySelector(".named h2")?.textContent,
    "見出し",
    "shadow reslot: 初回接続で slot が投影される",
  );
  el.remove();
  await tick(); // 切断確定で dispose（退避していた子を host へ戻す）
  document.body.append(el); // 再接続
  assert.equal(
    el.shadowRoot?.querySelector(".named h2")?.textContent,
    "見出し",
    "shadow reslot: 再接続でも slot の中身が復元される",
  );
});
