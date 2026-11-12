import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import {
  isTagActiveInSelection,
  normalizeInlineContent,
  toggleInlineFormat,
} from "../src/editor/inline-format";

function mount(html: string) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function selectContents(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTagActiveInSelection — selection outside the editable root", () => {
  test("returns false when the anchor is not contained by the root", () => {
    const root = mount("text");
    const outside = document.createElement("div");
    outside.textContent = "outside";
    document.body.append(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(isTagActiveInSelection("strong", root)).toBe(false);
  });
});

describe("toggleInlineFormat — no active range", () => {
  test("does nothing when the selection has no ranges", () => {
    const root = mount("hello");
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    toggleInlineFormat("strong", root);
    expect(root.querySelectorAll("strong").length).toBe(0);
  });
});

describe("wrapRangeInTag — whitespace handling", () => {
  test("trims and re-emits leading/trailing whitespace around the wrapper", () => {
    const root = mount("  world  ");
    selectContents(root);
    toggleInlineFormat("strong", root);
    const strong = root.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("world");
    // Surrounding whitespace stays outside the wrapper.
    expect(root.textContent).toBe("  world  ");
  });

  test("removes pure-whitespace edge text nodes and keeps inner element", () => {
    const root = mount(" <em>mid</em> ");
    selectContents(root);
    toggleInlineFormat("strong", root);
    const strong = root.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.querySelector("em")).not.toBeNull();
  });

  test("all-whitespace selection re-inserts the whitespace and bails", () => {
    const root = mount("   ");
    selectContents(root);
    toggleInlineFormat("strong", root);
    expect(root.querySelectorAll("strong").length).toBe(0);
    expect(root.textContent).toBe("   ");
  });

  test("element-bounded selection skips text-node whitespace trimming", () => {
    const root = mount("<em>x</em>more");
    selectContents(root);
    toggleInlineFormat("strong", root);
    const strong = root.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.querySelector("em")).not.toBeNull();
    expect(strong!.textContent).toBe("xmore");
  });
});

describe("findIntersectingElements — skips non-matching tags", () => {
  test("unwraps only the matching tag among mixed siblings", () => {
    const root = mount("<strong>bold</strong><em>ital</em>");
    const strong = root.querySelector("strong")!;
    const em = root.querySelector("em")!;
    const range = document.createRange();
    range.setStart(strong.firstChild!, 0);
    range.setEnd(em.firstChild!, 4);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    toggleInlineFormat("strong", root);
    expect(root.querySelectorAll("strong").length).toBe(0);
    // The non-matching <em> is left intact.
    expect(root.querySelector("em")).not.toBeNull();
  });
});

describe("normalizeInlineContent — lift edge whitespace", () => {
  test("lifts leading and trailing whitespace out of a format element", () => {
    const root = mount("<strong>  lead <em>x</em> trail  </strong>");
    normalizeInlineContent(root);
    const strong = root.querySelector("strong");
    expect(strong).not.toBeNull();
    // Inner edges no longer carry whitespace (it was lifted outside the element).
    expect(strong?.firstChild?.textContent?.startsWith(" ")).toBe(false);
    expect(strong?.lastChild?.textContent?.endsWith(" ")).toBe(false);
    // Text content is preserved overall.
    expect(root.textContent).toContain("lead");
    expect(root.textContent).toContain("trail");
  });
});

// ─── Chips are exempt from every normalization (studio.md §4.5, §8.2.7) ────────────────────────

describe("normalizeInlineContent leaves chips alone", () => {
  /** A chip standing for `source`, holding `inner` markup. */
  const chip = (source: string, inner = "v"): string =>
    `<data data-jx-tag="${source}" contenteditable="false">${inner}</data>`;

  test("chips are exempt from mergeAdjacentSiblings: two adjacent ones stay two", () => {
    const root = mount(`${chip("${a}")}${chip("${b}")}`);
    normalizeInlineContent(root);
    expect([...root.querySelectorAll("data")].map((el) => el.dataset.jxTag)).toEqual([
      "${a}",
      "${b}",
    ]);
    // Nor are the formatting tags a chip's VALUE drew merged with each other.
    const list = mount(chip("${nodes}", "<strong>one</strong><strong>two</strong>"));
    normalizeInlineContent(list);
    expect(list.querySelectorAll("strong")).toHaveLength(2);
  });

  test("chips are exempt from collapseRedundantNesting: a value's own nesting is kept", () => {
    const root = mount(
      `<strong>${chip("${a}", "<strong><strong>deep</strong></strong>")}</strong>`,
    );
    normalizeInlineContent(root);
    expect(root.querySelectorAll("strong")).toHaveLength(3);
    expect(root.querySelector("strong > data")).not.toBeNull();
  });

  test("chips are exempt from removeEmptyInlines: an empty chip, and empties inside one, stay", () => {
    const root = mount(`a${chip("${empty}", "")}b${chip("${holds}", "<em></em><span></span>")}`);
    normalizeInlineContent(root);
    expect(root.querySelectorAll("data")).toHaveLength(2);
    expect(root.querySelector("data em")).not.toBeNull();
    // The bare span a value drew is not unwrapped, and its edge whitespace is not lifted.
    expect(root.querySelector("data span")).not.toBeNull();
    const spaced = mount(chip("${s}", "<strong> padded </strong>"));
    normalizeInlineContent(spaced);
    expect(spaced.querySelector("strong")?.textContent).toBe(" padded ");
  });

  test("the text node a chip's binding writes to is kept, even while it is empty", () => {
    const root = mount(`a${chip("${empty}", "")}`);
    const anchor = document.createTextNode("");
    root.querySelector("data")?.append(anchor);
    normalizeInlineContent(root);
    // The runtime holds this node and writes the value into it: removed, the chip never updates.
    expect(anchor.isConnected).toBe(true);
    anchor.data = "late value";
    expect(root.textContent).toBe("alate value");
  });

  test("outside a chip, adjacent text is still joined and empty text removed", () => {
    const root = mount(`<em>x</em>${chip("${a}")}`);
    root.prepend(
      document.createTextNode("one "),
      document.createTextNode(""),
      document.createTextNode("two"),
    );
    root.querySelector("em")?.append(document.createTextNode("y"), document.createTextNode("z"));
    normalizeInlineContent(root);
    expect(root.firstChild?.nodeValue).toBe("one two");
    expect(root.querySelector("em")?.childNodes).toHaveLength(1);
    expect(root.querySelector("em")?.textContent).toBe("xyz");
  });

  test("a caret in a text node that is joined onto its neighbour moves with its character", () => {
    const root = mount("");
    const first = document.createTextNode("Hello ");
    const second = document.createTextNode("world");
    root.append(first, second);
    window.getSelection()?.setBaseAndExtent(second, 2, second, 4);
    normalizeInlineContent(root);
    const sel = window.getSelection();
    expect(sel?.anchorNode).toBe(first);
    expect([sel?.anchorOffset, sel?.focusOffset]).toEqual([8, 10]);
    // An endpoint elsewhere is left where it was.
    const tail = document.createTextNode("!");
    root.append(tail);
    window.getSelection()?.setBaseAndExtent(first, 1, tail, 1);
    normalizeInlineContent(root);
    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(window.getSelection()?.focusOffset).toBe(12);
  });
});

describe("normalizeInlineContent leaves an element closed to the caret alone", () => {
  /** An `<em>` closed to the caret, holding `text`: an inline whose content is drawn from data. */
  const closed = (text: string): string => `<em contenteditable="false">${text}</em>`;

  test("it is not merged with a same-tag inline beside it, on either side", () => {
    const after = mount(`<em>x</em>${closed("VALUE")}`);
    normalizeInlineContent(after);
    expect(after.innerHTML).toBe(`<em>x</em>${closed("VALUE")}`);
    const before = mount(`${closed("VALUE")}<em>x</em>`);
    normalizeInlineContent(before);
    expect(before.innerHTML).toBe(`${closed("VALUE")}<em>x</em>`);
    // Two open ones still are.
    const open = mount("<em>x</em><em>y</em>");
    normalizeInlineContent(open);
    expect(open.innerHTML).toBe("<em>xy</em>");
  });

  test("it is not collapsed into a same-tag wrapper, nor is what it holds collapsed into it", () => {
    const inner = mount(`<em>${closed("VALUE")}</em>`);
    normalizeInlineContent(inner);
    expect(inner.innerHTML).toBe(`<em>${closed("VALUE")}</em>`);
    const outer = mount(closed("<em>VALUE</em>"));
    normalizeInlineContent(outer);
    expect(outer.innerHTML).toBe(closed("<em>VALUE</em>"));
    // Three open wrappers of one tag collapse to one, and none of it throws.
    const triple = mount("<em><em><em>x</em></em></em>");
    expect(() => normalizeInlineContent(triple)).not.toThrow();
    expect(triple.innerHTML).toBe("<em>x</em>");
  });
});
