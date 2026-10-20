import { describe, expect, test } from "bun:test";

import { highlightCodeBlocks, highlightFence } from "../src/highlight";
import { processMarkdown } from "../src/md";
import { isString } from "@jxsuite/schema/guards";
import type { JxElement } from "@jxsuite/schema/types";

/** The element at `index`, failing the test when a string or nothing sits there instead. */
function elementAt(nodes: (JxElement | string)[], index: number): JxElement {
  const node = nodes[index];
  if (node === undefined || isString(node)) {
    throw new Error(`node ${index} is not an element`);
  }
  return node;
}

/** Child `index` of `el`, failing the test when its children are not a concrete array. */
function childAt(el: JxElement, index: number): JxElement {
  if (!Array.isArray(el.children)) {
    throw new TypeError("element has no children array");
  }
  return elementAt(el.children, index);
}

/** The source text a run of token spans spells back. */
const spell = (spans: (JxElement | string)[]) =>
  spans.map((s) => (isString(s) ? s : (s.textContent ?? ""))).join("");

// ─── highlightFence ───────────────────────────────────────────────────────────

describe("highlightFence", () => {
  test("tokenizes a known language into spans with dual-theme variables", () => {
    const spans = highlightFence('{ "a": 1 }', "json")!;
    expect(spans.length).toBeGreaterThan(1);
    const first = elementAt(spans, 0);
    expect(first.tagName).toBe("span");
    expect(first.textContent).toBeTypeOf("string");
    expect(first.style).toHaveProperty("--shiki-light");
    expect(first.style).toHaveProperty("--shiki-dark");
    expect(spell(spans)).toBe('{ "a": 1 }');
  });

  test("joins lines with newline strings, preserving the source text", () => {
    const code = '{\n  "a": 1\n}';
    const spans = highlightFence(code, "json")!;
    expect(spans.filter((s) => s === "\n")).toHaveLength(2);
    expect(spell(spans)).toBe(code);
  });

  test("resolves registered grammar aliases (bash → shellscript, ts → typescript)", () => {
    expect(highlightFence("echo hi", "bash")).not.toBeNull();
    expect(highlightFence("const x: number = 1;", "ts")).not.toBeNull();
    expect(highlightFence("# Title", "md")).not.toBeNull();
  });

  test("reads the language in any case, as an author types it", () => {
    for (const info of ["SQL", "Python", "BASH", "Ts"]) {
      expect(highlightFence("x", info)).not.toBeNull();
    }
    const { $children } = processMarkdown("```SQL\nSELECT 1;\n```\n", "/x/a.md");
    expect(childAt(elementAt($children, 0), 0).className).toContain("shiki");
  });

  test("tokenizes a whole line however slowly it goes: the output never depends on the clock", () => {
    /* Every clock read a full second later than the last: any per-line time limit would stop
       after the first scan and leave the template expression painted as part of the string. */
    const code = 'const html = `<div class="alert">${__("Pick one")}</div>`;';
    const steady = highlightFence(code, "js")!;
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => {
      now += 1000;
      return now;
    };
    let slow: (JxElement | string)[] | null;
    try {
      slow = highlightFence(code, "js");
    } finally {
      Date.now = realNow;
    }
    expect(JSON.stringify(slow)).toBe(JSON.stringify(steady));
    expect(spell(slow ?? [])).toBe(code);
    expect(steady.filter((s) => !isString(s) && s.textContent === "__")).toHaveLength(1);
  });

  test("returns null for unknown languages", () => {
    expect(highlightFence("PRINT 1", "cobol")).toBeNull();
    expect(highlightFence("x", "not-a-language")).toBeNull();
  });
});

describe("the knowledge-base language set", () => {
  const samples = {
    caddyfile: 'example.com {\n    reverse_proxy {host} # note\n    header "X-A" "b"\n}',
    diff: "- old\n+ new",
    dockerfile: "FROM node:22\nRUN npm ci",
    ini: "[main]\nkey = value",
    jsonc: '{ // comment\n  "a": 1 }',
    nginx: "server { listen 80; }",
    nix: "{ pkgs }: { x = pkgs.hello; }",
    php: "<?php echo 1;",
    python: "def f(x):\n    return x",
    ruby: "puts 1",
    sql: "SELECT 1 FROM t;",
    toml: "[a]\nb = 1",
    xml: "<a b='1'>x</a>",
  };

  for (const [lang, code] of Object.entries(samples)) {
    test(`highlights ${lang} into dual-theme spans that spell the source back`, () => {
      const spans = highlightFence(code, lang)!;
      expect(spans).not.toBeNull();
      expect(spell(spans)).toBe(code);
      expect(
        spans.some((s) => !isString(s) && Object.keys(s.style ?? {}).includes("--shiki-light")),
      ).toBe(true);
    });
  }

  test("resolves the aliases authors actually type", () => {
    for (const alias of ["py", "rb", "yml", "sh", "shell", "docker"]) {
      expect(highlightFence("x", alias)).not.toBeNull();
    }
  });

  test("a plain text fence stays plain", () => {
    expect(highlightFence("anything", "text")).toBeNull();
  });

  test("the caddyfile grammar colors directives, placeholders, matchers, durations and comments", () => {
    const spans = highlightFence(
      [
        "{",
        "\tauto_https off",
        "}",
        "",
        "example.com, :8080 {",
        "    reverse_proxy {host} {$ENV_VAR}",
        "    timeout 30s # five",
        "    @api path /api/*",
        '    header "X-A" `raw`',
        "}",
      ].join("\n"),
      "caddyfile",
    )!;
    const colorOf = (text: string) =>
      spans.find((s): s is JxElement => !isString(s) && s.textContent === text)?.style?.[
        "--shiki-light"
      ];
    const plain = colorOf(" ");
    for (const token of [
      "reverse_proxy",
      "{host}",
      "{$ENV_VAR}",
      "30s",
      "# five",
      "@api",
      '"X-A"',
      "`raw`",
      "example.com, :8080",
    ]) {
      const color = colorOf(token);
      expect(color).toBeDefined();
      expect(color).not.toBe(plain);
    }
  });

  test("tokenizes every fence of a vault-shaped document without throwing", () => {
    const fences = [
      ["bash", "fallocate -l 4G /swapfile && swapon /swapfile"],
      ["python", 'print("{{ doc.name }} ${x}")'],
      ["sql", "SELECT `name` FROM tabUser WHERE 1 = 1;"],
      ["php", "<?php add_action('init', fn() => 1);"],
      ["nix", "{ config, ... }: { services.nginx.enable = true; }"],
      ["ini", "[mysqld]\ninnodb_buffer_pool_size=1G"],
      ["nginx", "location / { proxy_pass http://127.0.0.1:8000; }"],
    ];
    for (const [lang, code] of fences) {
      expect(() => highlightFence(code!, lang!)).not.toThrow();
    }
  });
});

// ─── highlightCodeBlocks ──────────────────────────────────────────────────────

describe("highlightCodeBlocks", () => {
  const fence = (lang: string | null, text: string): JxElement => {
    const code: JxElement = { tagName: "code", textContent: text };
    if (lang) {
      code.className = `language-${lang}`;
    }
    return { children: [code], tagName: "pre" };
  };

  test("replaces fence text with token spans and marks the code element", () => {
    const tree: (JxElement | string)[] = [fence("json", '{ "a": 1 }')];
    highlightCodeBlocks(tree);
    const code = childAt(elementAt(tree, 0), 0);
    expect(code.className).toBe("language-json shiki");
    expect(code.textContent).toBeUndefined();
    expect(Array.isArray(code.children)).toBe(true);
    expect(childAt(code, 0).tagName).toBe("span");
  });

  test("leaves unknown languages and bare fences untouched", () => {
    const unknown = fence("cobol", "PRINT 1");
    const bare = fence(null, "plain text");
    highlightCodeBlocks([unknown, bare]);
    expect(childAt(unknown, 0).textContent).toBe("PRINT 1");
    expect(childAt(bare, 0).textContent).toBe("plain text");
  });

  test("recurses into nested containers", () => {
    const tree: (JxElement | string)[] = [
      { children: ["intro", fence("json", "{}")], tagName: "div" },
    ];
    highlightCodeBlocks(tree);
    const code = childAt(childAt(elementAt(tree, 0), 1), 0);
    expect(code.className).toContain("shiki");
  });

  test("ignores strings and empty code elements", () => {
    const empty = fence("json", "");
    highlightCodeBlocks(["hello", empty]);
    expect(childAt(empty, 0).textContent).toBe("");
  });
});

// ─── processMarkdown integration ──────────────────────────────────────────────

describe("processMarkdown highlighting", () => {
  test("fenced blocks come out highlighted, prose untouched", () => {
    const source = ["Some prose.", "", "```json", '{ "a": 1 }', "```", ""].join("\n");
    const result = processMarkdown(source, "/x.md");
    expect(result.$children[0]).toEqual({ tagName: "p", textContent: "Some prose." });
    const pre = elementAt(result.$children, 1);
    expect(pre.tagName).toBe("pre");
    const code = childAt(pre, 0);
    expect(code.className).toBe("language-json shiki");
    expect(childAt(code, 0).style).toHaveProperty("--shiki-light");
  });

  test("unknown fence languages keep plain text output", () => {
    const source = ["```cobol", "PRINT 1", "```", ""].join("\n");
    const result = processMarkdown(source, "/x.md");
    const code = childAt(elementAt(result.$children, 0), 0);
    expect(code.className).toBe("language-cobol");
    expect(code.textContent).toBe("PRINT 1");
  });
});
