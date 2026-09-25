/**
 * Tests for src/panels/ai-chat/chat-markdown.ts — memoized markdown rendering: parse-once per
 * message id, re-parse on content growth (streaming finalize), and cache clearing. Uses the parser
 * package's real md-html pipeline (browser-safe, no mocks needed).
 *
 * It hands back MARKUP now rather than a lit template: the assistant is a Jx document, and
 * `surfaces/ai-chat.ts` puts this string into `[part="md"]` through the Trusted Types policy. So
 * the assertions parse what comes out instead of rendering it.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { clearMarkdownCache, renderMarkdown } from "../src/panels/ai-chat/chat-markdown";

/** The markup, as a tree — the same question the island's `innerHTML` will ask of it. */
function parse(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

beforeEach(() => {
  clearMarkdownCache();
});

describe("renderMarkdown", () => {
  test("renders markdown to sanitized HTML", () => {
    const md = parse(renderMarkdown("m1", "# Hi\n\n**bold** <script>x()</script>"));
    expect(md.querySelector("h1")?.textContent).toBe("Hi");
    expect(md.querySelector("strong")?.textContent).toBe("bold");
    expect(md.querySelector("script")).toBeNull();
  });

  test("memoizes by message id and content length", () => {
    const first = renderMarkdown("m1", "one **two**");
    // Same id + same length → cached (rendering again produces identical markup).
    expect(renderMarkdown("m1", "one **two**")).toBe(first);
    // Content growth (streaming finalize) re-parses.
    expect(parse(renderMarkdown("m1", "one **two** three")).textContent).toContain("three");
  });

  test("clearMarkdownCache drops cached entries", () => {
    renderMarkdown("m1", "alpha");
    clearMarkdownCache();
    expect(parse(renderMarkdown("m1", "*beta*")).querySelector("em")?.textContent).toBe("beta");
  });
});
