import { describe, expect, test } from "bun:test";

import { highlightCodeBlocks, highlightFence } from "../src/highlight";
import { processMarkdown } from "../src/md";
import type { JxElement } from "@jxsuite/schema/types";

/** Read an element's children as a concrete array (these tests never build a JxMappedArray). */
const kids = (el: JxElement) => el.children as (JxElement | string)[];

// ─── highlightFence ───────────────────────────────────────────────────────────

describe("highlightFence", () => {
  test("tokenizes a known language into spans with dual-theme variables", () => {
    const spans = highlightFence('{ "a": 1 }', "json")!;
    expect(spans.length).toBeGreaterThan(1);
    const first = spans[0] as JxElement;
    expect(first.tagName).toBe("span");
    expect(typeof first.textContent).toBe("string");
    expect(first.style).toHaveProperty("--shiki-light");
    expect(first.style).toHaveProperty("--shiki-dark");
    const joined = spans
      .map((s) => (typeof s === "string" ? s : ((s as JxElement).textContent ?? "")))
      .join("");
    expect(joined).toBe('{ "a": 1 }');
  });

  test("joins lines with newline strings, preserving the source text", () => {
    const code = '{\n  "a": 1\n}';
    const spans = highlightFence(code, "json")!;
    expect(spans.filter((s) => s === "\n")).toHaveLength(2);
    const joined = spans
      .map((s) => (typeof s === "string" ? s : ((s as JxElement).textContent ?? "")))
      .join("");
    expect(joined).toBe(code);
  });

  test("resolves registered grammar aliases (bash → shellscript, ts → typescript)", () => {
    expect(highlightFence("echo hi", "bash")).not.toBeNull();
    expect(highlightFence("const x: number = 1;", "ts")).not.toBeNull();
    expect(highlightFence("# Title", "md")).not.toBeNull();
  });

  test("returns null for unknown languages", () => {
    expect(highlightFence("PRINT 1", "cobol")).toBeNull();
    expect(highlightFence("x", "not-a-language")).toBeNull();
  });
});

describe("the knowledge-base language set", () => {
  const samples: Record<string, string> = {
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
      const text = spans
        .map((s) => (typeof s === "string" ? s : ((s as JxElement).textContent ?? "")))
        .join("");
      expect(text).toBe(code);
      expect(
        spans.some(
          (s) => typeof s === "object" && Object.keys(s.style ?? {}).includes("--shiki-light"),
        ),
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
    )! as (JxElement | string)[];
    const colorOf = (text: string) =>
      (spans.find((s) => typeof s === "object" && s.textContent === text) as JxElement | undefined)
        ?.style?.["--shiki-light"];
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
      expect(colorOf(token)).toBeDefined();
      expect(colorOf(token)).not.toBe(plain);
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
  const fence = (lang: string | null, text: string): JxElement => ({
    children: [
      {
        tagName: "code",
        textContent: text,
        ...(lang ? { className: `language-${lang}` } : {}),
      },
    ],
    tagName: "pre",
  });

  test("replaces fence text with token spans and marks the code element", () => {
    const tree: (JxElement | string)[] = [fence("json", '{ "a": 1 }')];
    highlightCodeBlocks(tree);
    const code = kids(tree[0] as JxElement)[0] as JxElement;
    expect(code.className).toBe("language-json shiki");
    expect(code.textContent).toBeUndefined();
    expect(Array.isArray(code.children)).toBe(true);
    expect((kids(code)[0] as JxElement).tagName).toBe("span");
  });

  test("leaves unknown languages and bare fences untouched", () => {
    const unknown = fence("cobol", "PRINT 1");
    const bare = fence(null, "plain text");
    highlightCodeBlocks([unknown, bare]);
    expect((kids(unknown)[0] as JxElement).textContent).toBe("PRINT 1");
    expect((kids(bare)[0] as JxElement).textContent).toBe("plain text");
  });

  test("recurses into nested containers", () => {
    const tree: (JxElement | string)[] = [
      { children: ["intro", fence("json", "{}")], tagName: "div" },
    ];
    highlightCodeBlocks(tree);
    const pre = kids(tree[0] as JxElement)[1] as JxElement;
    const code = kids(pre)[0] as JxElement;
    expect(code.className).toContain("shiki");
  });

  test("ignores strings and empty code elements", () => {
    const empty = fence("json", "");
    highlightCodeBlocks(["hello", empty]);
    expect((kids(empty)[0] as JxElement).textContent).toBe("");
  });
});

// ─── processMarkdown integration ──────────────────────────────────────────────

describe("processMarkdown highlighting", () => {
  test("fenced blocks come out highlighted, prose untouched", () => {
    const source = ["Some prose.", "", "```json", '{ "a": 1 }', "```", ""].join("\n");
    const result = processMarkdown(source, "/x.md");
    expect(result.$children[0]).toEqual({ tagName: "p", textContent: "Some prose." });
    const pre = result.$children[1] as JxElement;
    expect(pre.tagName).toBe("pre");
    const code = kids(pre)[0] as JxElement;
    expect(code.className).toBe("language-json shiki");
    expect((kids(code)[0] as JxElement).style).toHaveProperty("--shiki-light");
  });

  test("unknown fence languages keep plain text output", () => {
    const source = ["```cobol", "PRINT 1", "```", ""].join("\n");
    const result = processMarkdown(source, "/x.md");
    const code = kids(result.$children[0] as JxElement)[0] as JxElement;
    expect(code.className).toBe("language-cobol");
    expect(code.textContent).toBe("PRINT 1");
  });
});
