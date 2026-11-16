/**
 * Child-separator.test.ts — what the emitters write between an element's children (compiler.md
 * §8.1, "Whitespace between siblings").
 */

import { describe, expect, test } from "bun:test";
import {
  blockChildren,
  joinChildren,
  padChildren,
  separatorIsSafe,
} from "../src/child-separator.ts";

describe("separatorIsSafe", () => {
  test("is true beside a block-level element, whatever the other side is, unless it is text", () => {
    expect(separatorIsSafe("<p>a</p>", "<p>b</p>")).toBe(true);
    expect(separatorIsSafe("<p>a</p>", "<span>b</span>")).toBe(true);
    expect(separatorIsSafe("<span>a</span>", "<p>b</p>")).toBe(true);
    expect(separatorIsSafe("<p>a</p>", "<x-card></x-card>")).toBe(true);
    expect(separatorIsSafe("<DIV>a</DIV>", "<Section>b</Section>")).toBe(true);
  });

  test("is false between two inline-level elements", () => {
    expect(separatorIsSafe("<a>link</a>", "<code>x</code>")).toBe(false);
    expect(separatorIsSafe("<em>a</em>", "<strong>b</strong>")).toBe(false);
    expect(separatorIsSafe("<x-a></x-a>", "<x-b></x-b>")).toBe(false);
    expect(separatorIsSafe('<img src="a">', '<img src="b">')).toBe(false);
    expect(separatorIsSafe("<script></script>", "<style></style>")).toBe(false);
  });

  test("is false beside text, which the author wrote and a block does not excuse", () => {
    expect(separatorIsSafe("<a>link</a>", ".")).toBe(false);
    expect(separatorIsSafe("`", "<code>x</code>")).toBe(false);
    expect(separatorIsSafe("<p>a</p>", "text")).toBe(false);
    expect(separatorIsSafe("text", "<p>a</p>")).toBe(false);
    expect(separatorIsSafe("a", "b")).toBe(false);
    expect(separatorIsSafe("<p>a</p>", "${state.x}")).toBe(false);
    expect(separatorIsSafe("<p>a</p>", "&lt;b&gt;")).toBe(false);
  });

  test("reads a void element's tag from the end of the string", () => {
    expect(separatorIsSafe('<hr class="x">', "<span>a</span>")).toBe(true);
    expect(separatorIsSafe("<br>", "<span>a</span>")).toBe(true);
    expect(separatorIsSafe("<span>a</span>", "<br>")).toBe(true);
    expect(separatorIsSafe('<img alt="a" src="b">', "<span>a</span>")).toBe(false);
    expect(separatorIsSafe("<p>a</p>", '<input\n  type="text"\n>')).toBe(true);
    expect(separatorIsSafe('<input\n  type="text"\n>', "<b>x</b>")).toBe(false);
  });

  test("looks past comments, and never asks for a separator beside only comments", () => {
    expect(separatorIsSafe("<!--a--><p>a</p><!--/a-->", "<!--b--><p>b</p>")).toBe(true);
    expect(separatorIsSafe("<!--a--><b>a</b><!--/a-->", "<!--b--><i>b</i>")).toBe(false);
    expect(separatorIsSafe("<p>a</p><!--/a-->", "<!--b-->text")).toBe(false);
    expect(separatorIsSafe("<!--a-->", "<p>b</p>")).toBe(false);
    expect(separatorIsSafe("<p>a</p>", "<!--b-->")).toBe(false);
    expect(separatorIsSafe("<p>a</p><!--b", "<p>b</p>")).toBe(false);
    // A stray `-->` with no opener is text.
    expect(separatorIsSafe("<p>a</p> -->", "<p>b</p>")).toBe(false);
  });
});

describe("joinChildren", () => {
  test("separates block siblings and leaves inline ones flush", () => {
    expect(joinChildren(["<p>a</p>", "<p>b</p>"])).toBe("<p>a</p>\n  <p>b</p>");
    expect(joinChildren(["<a>link</a>", ".", "<code>x</code>", ",", " ", "<em>y</em>"])).toBe(
      "<a>link</a>.<code>x</code>, <em>y</em>",
    );
    expect(joinChildren(["a", "b", "<i>c</i>"])).toBe("ab<i>c</i>");
  });

  test("writes the separator it is given", () => {
    expect(joinChildren(["<p>a</p>", "<p>b</p>"], { separator: "\n" })).toBe("<p>a</p>\n<p>b</p>");
    expect(joinChildren(["<p>a</p>", "<p>b</p>"], { separator: "" })).toBe("<p>a</p><p>b</p>");
  });

  test("concatenates inside a preformatted subtree", () => {
    expect(joinChildren(["<p>a</p>", "<p>b</p>"], { preformatted: true })).toBe("<p>a</p><p>b</p>");
  });

  test("skips a child that rendered nothing, and does not let it hide an inline neighbour", () => {
    expect(joinChildren(["<a>x</a>", "", "."])).toBe("<a>x</a>.");
    expect(joinChildren(["<p>a</p>", "", "<p>b</p>"])).toBe("<p>a</p>\n  <p>b</p>");
    expect(joinChildren([])).toBe("");
    expect(joinChildren([""])).toBe("");
  });

  test("keeps the first child's indent, and drops the next one's where no separator is written", () => {
    const lead = "    ";
    expect(joinChildren([`${lead}<p>a</p>`, `${lead}<p>b</p>`], { lead, separator: "\n" })).toBe(
      `${lead}<p>a</p>\n${lead}<p>b</p>`,
    );
    expect(
      joinChildren([`${lead}<a>x</a>`, `${lead}.`, `${lead}<b>y</b>`], { lead, separator: "\n" }),
    ).toBe(`${lead}<a>x</a>.<b>y</b>`);
    // A child that is only its indent says nothing.
    expect(joinChildren([`${lead}<a>x</a>`, lead, `${lead}.`], { lead, separator: "\n" })).toBe(
      `${lead}<a>x</a>.`,
    );
    // A child its emitter did not indent is used as it stands.
    expect(joinChildren([`${lead}<a>x</a>`, "."], { lead, separator: "\n" })).toBe(
      `${lead}<a>x</a>.`,
    );
  });
});

describe("padChildren", () => {
  const open = "\n";
  const close = "\n  ";

  test("opens and closes an element whose content begins and ends with a block", () => {
    expect(padChildren("<p>a</p>", { close, open })).toBe("\n<p>a</p>\n  ");
  });

  test("leaves an inline parent's content flush against its tags", () => {
    expect(padChildren("link", { close, open })).toBe("link");
    expect(padChildren("<b>a</b> and text", { close, open })).toBe("<b>a</b> and text");
    expect(padChildren("<p>a</p>text", { close, open })).toBe("\n<p>a</p>text");
    expect(padChildren("text<p>a</p>", { close, open })).toBe("text<p>a</p>\n  ");
  });

  test("has nothing to say about empty content", () => {
    expect(padChildren("", { close, open })).toBe("");
  });

  test("drops the first child's indent when no newline opens the content", () => {
    expect(padChildren("      link", { close, lead: "      ", open })).toBe("link");
    expect(padChildren("      <p>a</p>", { close, lead: "      ", open })).toBe(
      "\n      <p>a</p>\n  ",
    );
  });
});

describe("blockChildren", () => {
  test("joins, then pads", () => {
    expect(
      blockChildren(["<li>1</li>", "<li>2</li>"], { close: "\n", open: "\n", separator: "\n" }),
    ).toBe("\n<li>1</li>\n<li>2</li>\n");
    expect(blockChildren(["a", "<b>b</b>"], { close: "\n", open: "\n", separator: "\n" })).toBe(
      "a<b>b</b>",
    );
  });

  test("is bare inside a preformatted subtree", () => {
    expect(
      blockChildren(["<li>1</li>", "<li>2</li>"], {
        close: "\n",
        open: "\n",
        preformatted: true,
      }),
    ).toBe("<li>1</li><li>2</li>");
  });
});
