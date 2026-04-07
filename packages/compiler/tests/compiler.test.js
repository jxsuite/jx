import { describe, test, expect } from "bun:test";
import { compile, isDynamic } from "../compiler.js";

// ─── isDynamic — Five-Shape $defs Grammar ────────────────────────────────────

describe("isDynamic", () => {
  test("null → false", () => expect(isDynamic(null)).toBe(false));
  test("non-object → false", () => expect(isDynamic("string")).toBe(false));
  test("fully static node → false", () => {
    expect(isDynamic({ tagName: "div", textContent: "hello" })).toBe(false);
  });

  // Shape 1: Naked values in $defs → dynamic
  test("naked string in $defs → true", () => {
    expect(isDynamic({ $defs: { $name: "hello" } })).toBe(true);
  });
  test("naked number in $defs → true", () => {
    expect(isDynamic({ $defs: { $count: 42 } })).toBe(true);
  });
  test("naked boolean in $defs → true", () => {
    expect(isDynamic({ $defs: { $flag: false } })).toBe(true);
  });
  test("naked null in $defs → true", () => {
    expect(isDynamic({ $defs: { $x: null } })).toBe(true);
  });
  test("naked array in $defs → true", () => {
    expect(isDynamic({ $defs: { $items: [1, 2] } })).toBe(true);
  });

  // Shape 2: Expanded signal with default → dynamic
  test("object with default in $defs → true", () => {
    expect(isDynamic({ $defs: { $count: { type: "integer", default: 0 } } })).toBe(true);
  });

  // Shape 2b: Pure type def → static
  test("object with only schema keywords (no default) → false", () => {
    expect(isDynamic({ $defs: { email: { type: "string", format: "email" } } })).toBe(false);
  });

  // Shape 3: Template string in $defs → dynamic (it's a naked string with ${})
  test("template string in $defs → true", () => {
    expect(isDynamic({ $defs: { $label: "${$count.get()} items" } })).toBe(true);
  });

  // Shape 4 & 5: $prototype → dynamic
  test("$prototype in $defs → true", () => {
    expect(isDynamic({ $defs: { $r: { $prototype: "Request" } } })).toBe(true);
  });
  test('$prototype: "Function" in $defs → true', () => {
    expect(isDynamic({ $defs: { fn: { $prototype: "Function", body: "return 1;" } } })).toBe(true);
  });

  // Plain object in $defs → dynamic (Signal.State)
  test("plain object in $defs → true", () => {
    expect(isDynamic({ $defs: { $cfg: { x: 1, y: 2 } } })).toBe(true);
  });

  // Structural dynamic indicators
  test("$switch on node → true", () => {
    expect(isDynamic({ $switch: { $ref: "#/$defs/$x" } })).toBe(true);
  });
  test("children.$prototype Array → true", () => {
    expect(isDynamic({ children: { $prototype: "Array" } })).toBe(true);
  });
  test("$ref in non-reserved property → true", () => {
    expect(isDynamic({ tagName: "span", textContent: { $ref: "#/$defs/$x" } })).toBe(true);
  });

  // Template strings in properties → dynamic
  test("${} template string in textContent property → true", () => {
    expect(isDynamic({ tagName: "span", textContent: "${$count.get()}" })).toBe(true);
  });
  test("${} template string in className property → true", () => {
    expect(isDynamic({ tagName: "div", className: '${$active.get() ? "on" : "off"}' })).toBe(true);
  });

  // Static checks
  test("static property object without $ref → false", () => {
    expect(isDynamic({ tagName: "div", style: { color: "red" } })).toBe(false);
  });
  test("dynamic child in children array → true", () => {
    expect(
      isDynamic({
        tagName: "div",
        children: [{ tagName: "span" }, { tagName: "p", textContent: { $ref: "#/$defs/$x" } }],
      }),
    ).toBe(true);
  });
  test("all-static children array → false", () => {
    expect(
      isDynamic({
        tagName: "ul",
        children: [
          { tagName: "li", textContent: "A" },
          { tagName: "li", textContent: "B" },
        ],
      }),
    ).toBe(false);
  });
  test("empty $defs (no dynamic entries) → false", () => {
    expect(isDynamic({ $defs: {} })).toBe(false);
  });
});

// ─── compile — output structure ───────────────────────────────────────────────

describe("compile — output structure", () => {
  test("returns a full HTML document string", async () => {
    const html = await compile({ tagName: "div", textContent: "hi" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  test('default title is "JSONsx App"', async () => {
    const html = await compile({ tagName: "div" });
    expect(html).toContain("<title>JSONsx App</title>");
  });

  test("custom title is escaped and inserted", async () => {
    const html = await compile({ tagName: "div" }, { title: "My <App>" });
    expect(html).toContain("My &lt;App&gt;");
  });
});

// ─── compile — static nodes ───────────────────────────────────────────────────

describe("compile — static nodes", () => {
  test("static node emits plain HTML element", async () => {
    const html = await compile({ tagName: "p", textContent: "hello" });
    expect(html).toContain("<p>hello</p>");
  });

  test("id attribute", async () => {
    const html = await compile({ tagName: "div", id: "main" });
    expect(html).toContain('id="main"');
  });

  test("className → class attribute", async () => {
    const html = await compile({ tagName: "div", className: "box card" });
    expect(html).toContain('class="box card"');
  });

  test("hidden attribute", async () => {
    const html = await compile({ tagName: "div", hidden: true });
    expect(html).toContain(" hidden");
  });

  test("tabIndex → tabindex attribute", async () => {
    const html = await compile({ tagName: "div", tabIndex: 0 });
    expect(html).toContain('tabindex="0"');
  });

  test("title attribute", async () => {
    const html = await compile({ tagName: "div", title: "tip" });
    expect(html).toContain('title="tip"');
  });

  test("lang attribute", async () => {
    const html = await compile({ tagName: "div", lang: "fr" });
    expect(html).toContain('lang="fr"');
  });

  test("dir attribute", async () => {
    const html = await compile({ tagName: "div", dir: "rtl" });
    expect(html).toContain('dir="rtl"');
  });

  test("inline style from style object", async () => {
    const html = await compile({
      tagName: "div",
      style: { backgroundColor: "red", fontSize: "16px" },
    });
    expect(html).toContain("background-color: red");
    expect(html).toContain("font-size: 16px");
  });

  test("style with nested selector excluded from inline", async () => {
    const html = await compile({
      tagName: "div",
      style: { color: "blue", ":hover": { color: "red" } },
    });
    const inlineMatch = html.match(/style="([^"]*)"/);
    if (inlineMatch) {
      expect(inlineMatch[1]).not.toContain(":hover");
    }
  });

  test("custom attributes block — string value", async () => {
    const html = await compile({ tagName: "div", attributes: { "data-id": "abc" } });
    expect(html).toContain('data-id="abc"');
  });

  test("custom attributes block — number value", async () => {
    const html = await compile({ tagName: "div", attributes: { "data-n": 42 } });
    expect(html).toContain('data-n="42"');
  });

  test("custom attributes block — boolean value", async () => {
    const html = await compile({ tagName: "div", attributes: { "data-flag": true } });
    expect(html).toContain('data-flag="true"');
  });

  test("textContent escaped", async () => {
    const html = await compile({ tagName: "p", textContent: '<b>bold</b> & "quotes"' });
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;");
  });

  test("innerHTML emitted as trusted raw HTML", async () => {
    const html = await compile({ tagName: "div", innerHTML: "<b>raw</b>" });
    expect(html).toContain("<b>raw</b>");
  });

  test("static children rendered recursively", async () => {
    const html = await compile({
      tagName: "ul",
      children: [
        { tagName: "li", textContent: "first" },
        { tagName: "li", textContent: "second" },
      ],
    });
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  test("node with no textContent, innerHTML, or children → empty inner", async () => {
    const html = await compile({ tagName: "br" });
    expect(html).toContain("<br></br>");
  });

  test("no $handlers → no module script in head", async () => {
    const html = await compile({ tagName: "div" });
    expect(html).not.toContain('src="');
  });

  test("pure type def $defs → no island (static)", async () => {
    const html = await compile({
      tagName: "div",
      $defs: { email: { type: "string", format: "email" } },
      textContent: "hello",
    });
    expect(html).not.toContain("data-jsonsx-island");
    expect(html).toContain("hello");
  });
});

// ─── compile — dynamic islands ───────────────────────────────────────────────

describe("compile — dynamic islands", () => {
  test("dynamic root with naked value $defs emits hydration island", async () => {
    const html = await compile({
      tagName: "my-counter",
      $defs: { $count: 0 },
    });
    expect(html).toContain("data-jsonsx-island");
    expect(html).toContain("application/jsonsx+json");
  });

  test("dynamic root with expanded signal emits island", async () => {
    const html = await compile({
      tagName: "my-widget",
      $defs: { $x: { type: "integer", default: 1 } },
    });
    expect(html).toContain("data-jsonsx-island");
    expect(html).toContain('"$x"');
  });

  test("dynamic island emits runtime bootstrap script", async () => {
    const html = await compile(
      { tagName: "div", $defs: { $n: 0 } },
      { runtimeSrc: "/dist/runtime.js" },
    );
    expect(html).toContain("import { JSONsx } from '/dist/runtime.js'");
    expect(html).toContain("data-jsonsx-island");
  });

  test("fully static doc has no runtime script", async () => {
    const html = await compile({ tagName: "div", textContent: "static" });
    expect(html).not.toContain("data-jsonsx-island");
    expect(html).not.toContain("import { JSONsx }");
  });

  test("static parent with dynamic child: child is island, parent is plain HTML", async () => {
    const html = await compile({
      tagName: "main",
      children: [
        { tagName: "p", textContent: "static" },
        { tagName: "span", $defs: { $v: 0 } },
      ],
    });
    expect(html).toContain("<p>static</p>");
    expect(html).toContain("data-jsonsx-island");
  });

  test("${} template string in property makes node dynamic", async () => {
    const html = await compile({
      tagName: "main",
      children: [
        { tagName: "p", textContent: "static" },
        { tagName: "span", textContent: "${$count.get()}" },
      ],
    });
    expect(html).toContain("<p>static</p>");
    expect(html).toContain("data-jsonsx-island");
  });
});

// ─── compile — CSS extraction ─────────────────────────────────────────────────

describe("compile — CSS extraction", () => {
  test("nested :selector extracted to <style> block", async () => {
    const html = await compile({
      tagName: "button",
      id: "btn",
      style: { color: "blue", ":hover": { color: "red" } },
    });
    expect(html).toContain("<style>");
    expect(html).toContain("#btn:hover");
    expect(html).toContain("color: red");
  });

  test(".class selector in style", async () => {
    const html = await compile({
      tagName: "div",
      className: "card hero",
      style: { ".inner": { padding: "1rem" } },
    });
    expect(html).toContain(".card.inner");
  });

  test("&.compound selector in style", async () => {
    const html = await compile({
      tagName: "div",
      id: "root",
      style: { "&.active": { outline: "2px solid blue" } },
    });
    expect(html).toContain("#root.active");
  });

  test("[attr] selector in style", async () => {
    const html = await compile({
      tagName: "input",
      id: "inp",
      style: { "[disabled]": { opacity: "0.5" } },
    });
    expect(html).toContain("#inp[disabled]");
  });

  test("node with no id or className uses tagName as selector", async () => {
    const html = await compile({
      tagName: "nav",
      style: { ":first-child": { fontWeight: "bold" } },
    });
    expect(html).toContain("nav:first-child");
  });

  test("no nested styles → no <style> block emitted", async () => {
    const html = await compile({ tagName: "div", style: { color: "red" } });
    expect(html).not.toContain("<style>");
  });

  test("nested styles in child nodes collected", async () => {
    const html = await compile({
      tagName: "div",
      children: [
        { tagName: "p", id: "para", style: { ":hover": { textDecoration: "underline" } } },
      ],
    });
    expect(html).toContain("#para:hover");
    expect(html).toContain("text-decoration: underline");
  });

  test("nested selector inside media block", async () => {
    const html = await compile({
      tagName: "div",
      id: "box",
      $media: { "--md": "(min-width: 768px)" },
      style: {
        "@--md": { fontSize: "2rem", ":hover": { color: "blue" } },
      },
    });
    expect(html).toContain("@media (min-width: 768px)");
    expect(html).toContain("font-size: 2rem");
    expect(html).toContain("#box:hover");
    expect(html).toContain("color: blue");
  });
});

// ─── escapeHtml (exercised via compile) ───────────────────────────────────────

describe("escapeHtml — via compile output", () => {
  test("& escaped", async () => {
    const html = await compile({ tagName: "p", textContent: "a & b" });
    expect(html).toContain("a &amp; b");
  });
  test("< escaped", async () => {
    const html = await compile({ tagName: "p", textContent: "a < b" });
    expect(html).toContain("a &lt; b");
  });
  test("> escaped", async () => {
    const html = await compile({ tagName: "p", textContent: "a > b" });
    expect(html).toContain("a &gt; b");
  });
  test('" escaped in title', async () => {
    const html = await compile({ tagName: "p" }, { title: 'say "hi"' });
    expect(html).toContain("say &quot;hi&quot;");
  });
  test("' escaped in title", async () => {
    const html = await compile({ tagName: "p" }, { title: "it's fine" });
    expect(html).toContain("it&#39;s fine");
  });
});
