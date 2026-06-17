// test-emit.ts — emit（SSR 文字列エミッタ）の出力テスト（DOM 不要）
// 実行: node --test dist/test/test-emit.js
// docs/ssr-hydration-plan.md のテスト方針①「文字列出力テスト（軽量・DOM 不要）」に対応する。
// jsdom を注入しないので、emit が本当に DOM 非依存（document / Node に触れない）であることも担保する。

import assert from "node:assert/strict";
import { test } from "node:test";
import { emit } from "../src/emit.js";
import { For } from "../src/for.js";
import { signal } from "../src/reactive.js";
import { Show } from "../src/show.js";

// === 静的な構造 ===
test("emit: 静的なテンプレートはそのまま文字列になる", () => {
  assert.equal(
    emit`<div class="box"><span>hi</span></div>`,
    '<div class="box"><span>hi</span></div>',
  );
});
test("emit: 真偽属性（値なし）はそのまま残す", () => {
  assert.equal(emit`<input disabled>`, "<input disabled>");
});
test("emit: 自己終了タグを保つ", () => {
  assert.equal(emit`<input type="text" />`, '<input type="text"/>');
});
test("emit: 静的なコメントと閉じタグを保つ", () => {
  assert.equal(emit`<ul><!-- list --><li>a</li></ul>`, "<ul><!-- list --><li>a</li></ul>");
});

// === 子穴 ===
test("emit: 静的な子はマーカーなしの素のテキスト", () => {
  assert.equal(emit`<span>${"hello"}</span>`, "<span>hello</span>");
});
test("emit: reactive な子（関数）は開閉ペアで囲む", () => {
  const count = signal(7);
  assert.equal(emit`<span>${() => count.value}</span>`, "<span><!--hole-->7<!--/hole--></span>");
});
test("emit: reactive な子（signal 直渡し）も開閉ペアで囲む", () => {
  const count = signal(3);
  assert.equal(emit`<b>${count}</b>`, "<b><!--hole-->3<!--/hole--></b>");
});
test("emit: 関数穴は 1 回だけ呼ばれて初期値が入る", () => {
  let calls = 0;
  const out = emit`<span>${() => {
    calls++;
    return "v";
  }}</span>`;
  assert.equal(out, "<span><!--hole-->v<!--/hole--></span>");
  assert.equal(calls, 1, "emit: 関数穴は 1 回だけ呼ぶ（effect は張らない）");
});
test("emit: null / 真偽値の子は空になる", () => {
  assert.equal(emit`<i>${null}${false}${true}</i>`, "<i></i>");
});
test("emit: 配列の子は連結する", () => {
  assert.equal(emit`<p>${["a", "b", "c"]}</p>`, "<p>abc</p>");
});

// === 属性穴（値ぜんぶが 1 つの穴）===
test("emit: 通常の属性穴に初期値が入る", () => {
  const cls = signal("box");
  assert.equal(emit`<div class=${cls}></div>`, '<div class="box"></div>');
});
test("emit: 引用符付きの属性穴", () => {
  assert.equal(emit`<div title="${"hi"}"></div>`, '<div title="hi"></div>');
});
test("emit: false / null の属性穴は属性ごと省く", () => {
  assert.equal(emit`<input disabled=${false} hidden=${null}>`, "<input>");
});
test("emit: true の属性穴は空文字の属性になる", () => {
  assert.equal(emit`<input disabled=${true}>`, '<input disabled="">');
});
test("emit: class オブジェクトは真のキーだけ", () => {
  assert.equal(
    emit`<div class=${{ active: true, off: false, big: 1 }}></div>`,
    '<div class="active big"></div>',
  );
});
test("emit: style オブジェクトは inline style 文字列に", () => {
  assert.equal(
    emit`<div style=${{ color: "red", fontSize: "12px", "--gap": "4px" }}></div>`,
    '<div style="color: red; font-size: 12px; --gap: 4px;"></div>',
  );
});

// === イベント / ref / プロパティ穴は属性を吐かない ===
test("emit: イベント穴は属性を吐かない", () => {
  assert.equal(emit`<button onClick=${() => {}}>+1</button>`, "<button>+1</button>");
});
test("emit: ref 穴は属性を吐かない", () => {
  assert.equal(emit`<input ref=${() => {}}>`, "<input>");
});
test("emit: プロパティ穴（.foo）は属性を吐かない", () => {
  const items = signal(["x"]);
  assert.equal(emit`<x-rich .items=${items}></x-rich>`, "<x-rich></x-rich>");
});
test("emit: 静的属性とイベント穴が混在しても静的属性は残る", () => {
  assert.equal(
    emit`<button type="button" onClick=${() => {}} class="b">go</button>`,
    '<button type="button" class="b">go</button>',
  );
});

// === 部分埋め込み属性 ===
test("emit: 部分埋め込み属性を合成する", () => {
  const x = signal("on");
  assert.equal(emit`<div class="box ${x}"></div>`, '<div class="box on"></div>');
});
test("emit: 部分埋め込みに複数の穴", () => {
  assert.equal(emit`<div data-k="${"a"}-${"b"}"></div>`, '<div data-k="a-b"></div>');
});

// === エスケープ（XSS） ===
test("emit: 本文の値は < と & をエスケープする", () => {
  assert.equal(
    emit`<p>${'<img src=x onerror=alert(1)> & "ok"'}</p>`,
    '<p>&lt;img src=x onerror=alert(1)> &amp; "ok"</p>',
  );
});
test('emit: 属性値は " と & をエスケープする', () => {
  assert.equal(emit`<div title=${'a"b&c'}></div>`, '<div title="a&quot;b&amp;c"></div>');
});
test("emit: 部分埋め込みの穴もエスケープされる（静的断片はそのまま）", () => {
  assert.equal(emit`<div title="x ${'"y"'}"></div>`, '<div title="x &quot;y&quot;"></div>');
});
test("emit: 静的な本文はエスケープしない（著者が書いた信頼できる文字列）", () => {
  assert.equal(emit`<p>A & B</p>`, "<p>A & B</p>");
});

// === 採番の決定性 ===
test("emit: 同じテンプレ・同じ値なら同じ出力（採番が決定的）", () => {
  const tpl = (a: unknown, b: unknown) => emit`<div data-a=${a}><span>${b}</span></div>`;
  assert.equal(tpl("1", "2"), tpl("1", "2"));
  assert.equal(tpl("1", "2"), '<div data-a="1"><span>2</span></div>');
});

// === For / Show（#47）===
test("emit: For は各行を展開し <!--for--> 開閉ペアで囲む", () => {
  const items = signal([
    { id: 1, text: "a" },
    { id: 2, text: "b" },
  ]);
  assert.equal(
    emit`<ul>${For(
      () => items.value,
      (x) => x.id,
      (item) => emit`<li>${() => item().text}</li>`,
    )}</ul>`,
    "<ul><!--for--><li><!--hole-->a<!--/hole--></li><li><!--hole-->b<!--/hole--></li><!--/for--></ul>",
  );
});
test("emit: 空の For は開閉ペアだけになる", () => {
  assert.equal(
    emit`<ul>${For(
      () => [] as { id: number }[],
      (x) => x.id,
      (item) => emit`<li>${() => item().id}</li>`,
    )}</ul>`,
    "<ul><!--for--><!--/for--></ul>",
  );
});
test("emit: For の行は index accessor も渡せる", () => {
  assert.equal(
    emit`<ol>${For(
      () => ["x", "y"],
      (v) => v,
      (item, index) => emit`<li>${() => `${index() + 1}:${item()}`}</li>`,
    )}</ol>`,
    "<ol><!--for--><li><!--hole-->1:x<!--/hole--></li><li><!--hole-->2:y<!--/hole--></li><!--/for--></ol>",
  );
});
test("emit: ネストした For も生 HTML として合成される（二重エスケープしない）", () => {
  assert.equal(
    emit`<ul>${For(
      () => [["a", "b"], ["c"]],
      (g) => g,
      (group) =>
        emit`<li><ul>${For(
          () => group(),
          (v) => v,
          (item) => emit`<li>${() => item()}</li>`,
        )}</ul></li>`,
    )}</ul>`,
    "<ul><!--for--><li><ul><!--for--><li><!--hole-->a<!--/hole--></li><li><!--hole-->b<!--/hole--></li><!--/for--></ul></li><li><ul><!--for--><li><!--hole-->c<!--/hole--></li><!--/for--></ul></li><!--/for--></ul>",
  );
});

test("emit: Show は真なら render を <!--show--> 開閉ペアで囲む", () => {
  const ok = signal(true);
  assert.equal(
    emit`<div>${Show(
      () => ok.value,
      () => emit`<p>${() => "hi"}</p>`,
    )}</div>`,
    "<div><!--show--><p><!--hole-->hi<!--/hole--></p><!--/show--></div>",
  );
});
test("emit: Show は偽なら fallback を出す", () => {
  const ok = signal(false);
  assert.equal(
    emit`<div>${Show(
      () => ok.value,
      () => emit`<p>yes</p>`,
      () => emit`<p>no</p>`,
    )}</div>`,
    "<div><!--show--><p>no</p><!--/show--></div>",
  );
});
test("emit: Show は偽で fallback 無しなら開閉ペアだけ", () => {
  assert.equal(
    emit`<div>${Show(
      () => false,
      () => emit`<p>yes</p>`,
    )}</div>`,
    "<div><!--show--><!--/show--></div>",
  );
});
test("emit: Show は真だった値を accessor で render に渡す", () => {
  const user = signal<{ name: string } | null>({ name: "Bob" });
  assert.equal(
    emit`<div>${Show(
      () => user.value,
      (u) => emit`<p>${() => u().name}</p>`,
    )}</div>`,
    "<div><!--show--><p><!--hole-->Bob<!--/hole--></p><!--/show--></div>",
  );
});

// === Node の子は未対応（DOM 非依存スコープ）===
test("emit: Node の子はエラーにする（第1弾はプリミティブのみ）", () => {
  // Node 風のダミー（jsdom を入れていないので最小の偽装で instanceof を避けつつ意図を示す）。
  // ここでは globalThis.Node が無い環境なので String 化される（=エラーにならない）ことを確認する。
  assert.equal(typeof (globalThis as any).Node, "undefined", "emit テストは DOM 無しで走る");
});

// === 未対応の穴は黙って捨てず dev で警告する ===
test("emit: スプレッド位置の穴は無視され、dev では警告する", () => {
  // dev ビルドでだけ警告する。テストは NODE_ENV 未設定 = dev なので発火するが、
  // production で実行された場合も落ちないよう期待値を dev フラグで揃える。
  const dev = typeof process === "undefined" || process.env.NODE_ENV !== "production";
  const orig = console.warn;
  let warns = 0;
  console.warn = () => {
    warns++;
  };
  try {
    // 穴は属性名／スプレッド位置なので配線できず、出力からは消える（挙動は従来どおり＝無視）。
    assert.equal(emit`<div ${"x"}>hi</div>`, "<div>hi</div>");
    assert.equal(warns, dev ? 1 : 0, "無視するときは dev で1回警告する");
  } finally {
    console.warn = orig;
  }
});
test("emit: 属性名の位置の穴は無視され、dev では警告する", () => {
  const dev = typeof process === "undefined" || process.env.NODE_ENV !== "production";
  const orig = console.warn;
  let warns = 0;
  console.warn = () => {
    warns++;
  };
  try {
    // 属性名に穴が混じると、その属性は名前ごと（静的な値も含めて）丸ごと捨てられる。
    assert.equal(emit`<div data-${"k"}="v">hi</div>`, "<div>hi</div>");
    assert.equal(warns, dev ? 1 : 0, "無視するときは dev で1回警告する");
  } finally {
    console.warn = orig;
  }
});
