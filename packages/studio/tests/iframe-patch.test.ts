/**
 * In-iframe surgical patcher — applies value-carrying forward ops to the iframe's shadow doc and
 * its live DOM. Verifies in-place style/text fidelity (matching the full edit-mode render), event
 * no-ops, shadow-doc folding, and that any op it can't apply surgically throws (so the caller
 * reports a `patchError` and the parent escalates to a full render).
 */
import "./with-dom.js";
import { beforeAll, describe, expect, test } from "bun:test";
import {
  applyStyle,
  buildScope,
  defineElement,
  documentStyleText,
  resetDocumentStyles,
} from "@jxsuite/runtime";
import { applyIframePatch } from "../src/canvas/iframe-patch";
import { newRowView } from "../src/canvas/iframe-rows";
import { renderSubtreeIframe } from "../src/canvas/iframe-subtree";
import { parseJxPath, serializeJxPath } from "../src/canvas/path-mapping";
import { childList, getNodeAtPath } from "../src/state";
import { isString } from "@jxsuite/schema/guards";
import type { IframeRenderCtx } from "../src/canvas/iframe-render";
import type { JxDocument, JxMutableNode } from "@jxsuite/schema/types";
import type { JxDocOp } from "../src/tabs/patch-ops";
import { stubAriaLabel } from "./aria-reflection";

// A render context for the subtree-render ops (insert / set-child / re-render). The scope is empty
// (the test nodes carry no `$ref`/state bindings) and the mapper is the unwrapped page-doc default.
let CTX: IframeRenderCtx;
beforeAll(async () => {
  CTX = {
    defs: await buildScope({}, {}, "http://localhost/"),
    docBase: "http://localhost/",
    mapperCtx: {
      canvasMode: "design",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    },
    hooks: {},
    mode: "design",
    rows: newRowView(),
  };
});

/** A fixture rendered as stamped DOM, beside the shadow doc the forward ops are recorded against. */
interface Mounted {
  container: HTMLElement;
  shadow: JxMutableNode;
}

/** A fixture child as a node; these fixtures never hold bare-text children. */
function nodeOf(entry: JxMutableNode | string): JxMutableNode {
  if (isString(entry)) {
    throw new Error(`fixture child "${entry}" is text, not a node`);
  }
  return entry;
}

/** The literal tag a fixture node names; a fixture with an expression tag fails here. */
function tagOf(node: JxMutableNode): string {
  if (!isString(node.tagName)) {
    throw new Error("fixture node has no literal tagName");
  }
  return node.tagName;
}

/**
 * Build a container whose elements carry `data-jx-path` (as the iframe's full render stamps them)
 * for the given doc, plus the raw shadow doc the forward ops are recorded against. Only `children`
 * and top-level `textContent`/`style` are mirrored — enough to exercise the in-place patcher.
 */
function mount(doc: JxMutableNode): Mounted {
  resetDocumentStyles();
  const shadow = structuredClone(doc);
  const container = document.createElement("div");
  const root = document.createElement(tagOf(doc));
  root.dataset.jxPath = serializeJxPath([]);
  for (const [i, entry] of childList(doc).entries()) {
    const kid = nodeOf(entry);
    const el = document.createElement(tagOf(kid));
    el.dataset.jxPath = serializeJxPath(["children", i]);
    if (isString(kid.textContent)) {
      el.textContent = kid.textContent;
    }
    if (kid.style) {
      // The full render emits rules, not inline declarations — so the harness must too.
      applyStyle(el, kid.style);
    }
    root.append(el);
  }
  container.append(root);
  return { container, shadow };
}

function elAt(container: HTMLElement, path: (string | number)[]): HTMLElement {
  const el = container.querySelector(`[data-jx-path='${serializeJxPath(path)}']`);
  if (!(el instanceof HTMLElement)) {
    throw new TypeError(`no element rendered at ${serializeJxPath(path)}`);
  }
  return el;
}

/** The rules the stylesheet engine holds for one element — the replacement for `el.style`. */
function cssFor(el: HTMLElement): string {
  const handle = `[data-jx="${el.dataset.jx}"]`;
  return el.dataset.jx === undefined
    ? ""
    : documentStyleText()
        .split("\n")
        .filter((line) => line.includes(handle))
        .join("\n");
}

const BASE: JxMutableNode = {
  children: [
    { style: { color: "red" }, tagName: "p", textContent: "hello" },
    { tagName: "span", textContent: "world" },
  ],
  tagName: "div",
};

describe("applyIframePatch — set-style", () => {
  test("re-emits the node's style onto its element and folds the value into the shadow doc", () => {
    const { container, shadow } = mount(BASE);
    const op: JxDocOp = {
      key: "style",
      op: "set-key",
      path: ["children", 0],
      value: { color: "blue", fontWeight: "700" },
    };
    applyIframePatch(shadow, [op], container);

    const el = elAt(container, ["children", 0]);
    // The previous rule set was released, not merged.
    expect(cssFor(el)).toBe(`[data-jx="${el.dataset.jx}"] { color: blue; font-weight: 700 }`);
    expect(getNodeAtPath(shadow, ["children", 0])?.style).toEqual({
      color: "blue",
      fontWeight: "700",
    });
  });

  test("a bound style value is live, one that reads a repeater row included", () => {
    const { container, shadow } = mount(BASE);
    const op: JxDocOp = {
      key: "style",
      op: "set-key",
      path: ["children", 0],
      value: { color: "${state.c}", fontSize: "12px", width: "${item.w}" },
    };
    applyIframePatch(shadow, [op], container);

    const el = elAt(container, ["children", 0]);
    // Each binding reads a variable the element sets from its scope: the row's, inside a row.
    expect(cssFor(el)).toBe(
      `[data-jx="${el.dataset.jx}"] { color: var(--jx-s0); font-size: 12px; width: var(--jx-s1) }`,
    );
  });

  test("clearing the style releases the element's rules", () => {
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [{ key: "style", op: "set-key", path: ["children", 0], value: {} }],
      container,
    );
    expect(documentStyleText()).toBe("");
  });

  test("a non-object style value releases the element's rules", () => {
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [{ key: "style", op: "set-key", path: ["children", 0], value: null }],
      container,
    );
    expect(documentStyleText()).toBe("");
  });

  test("threads the doc's $media so an @--md block keeps a valid @media query (not `@media md`)", async () => {
    const { container, shadow } = mount(BASE);
    // The render ctx's built scope carries the merged $media (as resolveCanvasDocument → buildScope
    // Set state["$media"]). A surgical set-style on a media-bearing node must re-emit through it.
    const mediaCtx: IframeRenderCtx = {
      ...CTX,
      defs: await buildScope({ $media: { "--md": "(min-width: 768px)" } }, {}, "http://localhost/"),
    };
    const op: JxDocOp = {
      key: "style",
      op: "set-key",
      path: ["children", 0],
      value: { "@--md": { color: "blue" }, color: "red" },
    };
    applyIframePatch(shadow, [op], container, mediaCtx);

    const css = cssFor(elAt(container, ["children", 0]));
    // The named breakpoint resolved to its real query — NOT the invalid `@media --md` (the form
    // Emitted when the map is empty / not threaded).
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).not.toContain("@media --md");
  });
});

describe("applyIframePatch — set-text", () => {
  test("writes the node's display text and folds it into the shadow doc", () => {
    const { container, shadow } = mount(BASE);
    const op: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 1],
      value: "updated",
    };
    applyIframePatch(shadow, [op], container);

    expect(elAt(container, ["children", 1]).textContent).toBe("updated");
    expect(getNodeAtPath(shadow, ["children", 1])?.textContent).toBe("updated");
  });

  test("one writer per property: text that becomes bound is re-rendered, never text-written", () => {
    const { container, shadow } = mount(BASE);
    const before = elAt(container, ["children", 1]);
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "Hi ${state.name}" }],
      container,
      CTX,
    );
    const after = elAt(container, ["children", 1]);
    // A new element, drawn by the transform the full render uses: a run and a chip.
    expect(after).not.toBe(before);
    expect(after.firstChild?.nodeValue).toBe("Hi ");
    const chip = after.querySelector("data");
    expect(chip?.dataset.jxTag).toBe("${state.name}");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    // The value is the runtime's, as the page would print it; the expression itself is never drawn.
    expect(after.textContent).toBe("Hi undefined");
  });

  test("an expression holding braces of its own is one chip, like the full render", () => {
    const { container, shadow } = mount(BASE);
    const value = 'On ${f(state.d, {"a":1})}';
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value }],
      container,
      CTX,
    );
    const chips = elAt(container, ["children", 1]).querySelectorAll("data");
    expect([...chips].map((chip) => chip.dataset.jxTag)).toEqual(['${f(state.d, {"a":1})}']);
  });

  test("bound text that becomes literal is re-rendered too, which takes its chips off", () => {
    const { container, shadow } = mount(BASE);
    const path = ["children", 1];
    const set = (value: string) =>
      applyIframePatch(
        shadow,
        [{ key: "textContent", op: "set-key", path, value }],
        container,
        CTX,
      );
    set("Hi ${state.name}");
    expect(Object.hasOwn(elAt(container, path).dataset, "jxBoundField")).toBe(true);
    set("Hi there");
    const el = elAt(container, path);
    expect(el.querySelector("data")).toBeNull();
    expect(Object.hasOwn(el.dataset, "jxBoundField")).toBe(false);
    expect(el.textContent).toBe("Hi there");
  });

  test("renders a null/undefined text value as empty string", () => {
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: null }],
      container,
    );
    expect(elAt(container, ["children", 1]).textContent).toBe("");
  });

  test("stringifies a non-string, non-$ref text value", () => {
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: 42 }],
      container,
    );
    expect(elAt(container, ["children", 1]).textContent).toBe("42");
  });

  test("a $ref text is re-rendered as one chip, and its block is closed to the caret", () => {
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [
        {
          key: "textContent",
          op: "set-key",
          path: ["children", 1],
          value: { $ref: "#/state/title" },
        },
      ],
      container,
      CTX,
    );
    const el = elAt(container, ["children", 1]);
    expect(el.querySelector("data")?.dataset.jxTagKind).toBe("ref");
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.textContent).not.toContain("title");
  });

  test("toggles the empty-text placeholder class when text is cleared and restored", () => {
    const { container, shadow } = mount(BASE);
    // Clearing a <span>'s text adds the empty-text placeholder.
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "" }],
      container,
    );
    const el = elAt(container, ["children", 1]);
    expect(el.classList.contains("empty-text-placeholder")).toBe(true);

    // Restoring text removes it again.
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "back" }],
      container,
    );
    expect(el.classList.contains("empty-text-placeholder")).toBe(false);
    expect(el.textContent).toBe("back");
  });
});

describe("applyIframePatch — event bindings and escalation", () => {
  test("event-handler keys are a no-op (stripped from the edit render)", () => {
    const { container, shadow } = mount(BASE);
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "onclick", op: "set-key", path: ["children", 0], value: "doThing()" }],
        container,
      ),
    ).not.toThrow();
    // The handler is folded into the shadow doc but never touches the DOM.
    expect(getNodeAtPath(shadow, ["children", 0])?.onclick).toBe("doThing()");
  });

  test("a row-bound hidden set by a patch is left out, like the full render leaves it out", () => {
    // An `attributes` write redraws the node through the edit-mode transform, so it cannot be hidden.
    const { container, shadow } = mount(BASE);
    applyIframePatch(
      shadow,
      [
        {
          key: "attributes",
          op: "set-key",
          path: ["children", 0],
          value: { hidden: "${!item.premium}", inert: "${item.off}", title: "t" },
        },
      ],
      container,
      CTX,
    );
    const el = elAt(container, ["children", 0]);
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.hasAttribute("inert")).toBe(false);
    expect(el.getAttribute("title")).toBe("t");
    // The document keeps the binding: only the picture leaves it out.
    expect(getNodeAtPath(shadow, ["children", 0])?.attributes).toEqual({
      hidden: "${!item.premium}",
      inert: "${item.off}",
      title: "t",
    });
  });

  test("throws when a subtree-render op arrives without a render context (caller escalates)", () => {
    const { container, shadow } = mount(BASE);
    // A `set-key` on a key that needs re-rendering, but no ctx passed (e.g. patch before a render).
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "attributes", op: "set-key", path: ["children", 0], value: { title: "x" } }],
        container,
      ),
    ).toThrow(/iframe-patch-no-render-ctx/);
  });

  test("throws when the target element is missing from the DOM (shadow has it, DOM doesn't)", () => {
    const { container, shadow } = mount(BASE);
    // Drop the element from the DOM while keeping the node in the shadow doc: the fold succeeds but
    // The DOM lookup fails — exactly the drift the patcher must escalate on.
    elAt(container, ["children", 1]).remove();
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "textContent", op: "set-key", path: ["children", 1], value: "x" }],
        container,
      ),
    ).toThrow(/iframe-patch-element-not-found/);
  });

  test("throws when the op targets a path absent from the shadow doc", () => {
    const { container, shadow } = mount(BASE);
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "textContent", op: "set-key", path: ["children", 9], value: "x" }],
        container,
      ),
    ).toThrow(/doc-op-node-not-found/);
  });
});

// ─── Structural ops (Phase 3b-1: remove / move — no subtree render) ──────────────

/** Mount a doc as DOM with `data-jx-path` stamped recursively (the iframe full render's shape). */
function mountTree(doc: JxMutableNode): Mounted {
  const shadow = structuredClone(doc);
  const container = document.createElement("div");
  const build = (node: JxMutableNode, path: (string | number)[]): HTMLElement => {
    const el = document.createElement(tagOf(node));
    el.dataset.jxPath = serializeJxPath(path);
    if (isString(node.textContent)) {
      el.append(document.createTextNode(node.textContent));
    }
    for (const [i, k] of childList(node).entries()) {
      el.append(build(nodeOf(k), [...path, "children", i]));
    }
    return el;
  };
  container.append(build(doc, []));
  return { container, shadow };
}

/** Every stamped element resolves to a same-tag node in the shadow doc → DOM and shadow agree. */
function expectConsistent(container: HTMLElement, shadow: JxMutableNode): void {
  for (const el of container.querySelectorAll<HTMLElement>("[data-jx-path]")) {
    /* The lookup is typed for a live path; a stamp the shadow doc lost resolves to undefined,
       which is exactly the drift this check reports. */
    const node = getNodeAtPath(shadow, parseJxPath(el.dataset.jxPath!));
    expect(node, `no shadow node for ${el.dataset.jxPath}`).toBeDefined();
    expect(tagOf(node!).toLowerCase()).toBe(el.tagName.toLowerCase());
  }
}

const TREE: JxMutableNode = {
  children: [
    { tagName: "p", textContent: "a" },
    { tagName: "span", textContent: "b" },
    { children: [{ tagName: "em", textContent: "c" }], tagName: "div" },
  ],
  tagName: "div",
};

function rootChildTags(container: HTMLElement): string[] {
  return [...container.firstElementChild!.children].map((c) => c.tagName.toLowerCase());
}

describe("applyIframePatch — remove-child", () => {
  test("removes the element and shifts later siblings' paths (and descendants) down", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(shadow, [{ index: 0, op: "remove-child", parentPath: [] }], container);

    expect(container.querySelector("p")).toBeNull();
    expect(rootChildTags(container)).toEqual(["span", "div"]);
    expect(elAt(container, ["children", 0]).tagName.toLowerCase()).toBe("span");
    expect(elAt(container, ["children", 1]).tagName.toLowerCase()).toBe("div");
    // The descendant under the shifted div re-paths too.
    expect(elAt(container, ["children", 1, "children", 0]).tagName.toLowerCase()).toBe("em");
    expectConsistent(container, shadow);
  });
});

describe("applyIframePatch — move-child", () => {
  test("same-parent forward move re-paths the siblings between the slots", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(
      shadow,
      [{ fromIndex: 0, fromParentPath: [], op: "move-child", toIndex: 1, toParentPath: [] }],
      container,
    );
    // Shadow folds to [span, p, div]; the DOM order and paths must match.
    expect(rootChildTags(container)).toEqual(["span", "p", "div"]);
    expect(elAt(container, ["children", 0]).tagName.toLowerCase()).toBe("span");
    expect(elAt(container, ["children", 1]).tagName.toLowerCase()).toBe("p");
    expect(elAt(container, ["children", 2]).tagName.toLowerCase()).toBe("div");
    expectConsistent(container, shadow);
  });

  test("same-parent backward move carries the moved subtree's descendants", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(
      shadow,
      [{ fromIndex: 2, fromParentPath: [], op: "move-child", toIndex: 0, toParentPath: [] }],
      container,
    );
    // Shadow folds to [div, p, span].
    expect(rootChildTags(container)).toEqual(["div", "p", "span"]);
    expect(elAt(container, ["children", 0]).tagName.toLowerCase()).toBe("div");
    expect(elAt(container, ["children", 0, "children", 0]).tagName.toLowerCase()).toBe("em");
    expectConsistent(container, shadow);
  });

  test("cross-parent move reinserts the subtree under the destination and re-paths both", () => {
    const { container, shadow } = mountTree(TREE);
    // Move p (children/0) into the div (children/2, pre-mutation path) at index 0.
    applyIframePatch(
      shadow,
      [
        {
          fromIndex: 0,
          fromParentPath: [],
          op: "move-child",
          toIndex: 0,
          toParentPath: ["children", 2],
        },
      ],
      container,
    );
    // Shadow folds to [span, div[p, em]]; the div is now children/1.
    expect(rootChildTags(container)).toEqual(["span", "div"]);
    expect(elAt(container, ["children", 0]).tagName.toLowerCase()).toBe("span");
    expect(elAt(container, ["children", 1]).tagName.toLowerCase()).toBe("div");
    expect(elAt(container, ["children", 1, "children", 0]).tagName.toLowerCase()).toBe("p");
    expect(elAt(container, ["children", 1, "children", 1]).tagName.toLowerCase()).toBe("em");
    // DOM order inside the div: the moved p precedes the original em.
    expect(
      [...elAt(container, ["children", 1]).children].map((c) => c.tagName.toLowerCase()),
    ).toEqual(["p", "em"]);
    expectConsistent(container, shadow);
  });
});

// ─── Subtree-render ops (Phase 3b-2: insert / set-child / re-render) ─────────────

describe("applyIframePatch — subtree render", () => {
  test("insert-child renders the new node and splices it in, shifting siblings up", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(
      shadow,
      [
        {
          index: 1,
          node: { tagName: "b", textContent: "NEW" },
          op: "insert-child",
          parentPath: [],
        },
      ],
      container,
      CTX,
    );
    expect(rootChildTags(container)).toEqual(["p", "b", "span", "div"]);
    const inserted = elAt(container, ["children", 1]);
    expect(inserted.tagName.toLowerCase()).toBe("b");
    expect(inserted.textContent).toBe("NEW");
    expect(inserted.dataset.jxPath).toBe(serializeJxPath(["children", 1]));
    expect(elAt(container, ["children", 2]).tagName.toLowerCase()).toBe("span");
    // The descendant under the shifted div re-paths to children/3.
    expect(elAt(container, ["children", 3, "children", 0]).tagName.toLowerCase()).toBe("em");
    expectConsistent(container, shadow);
  });

  test("set-child re-renders and replaces the node in place", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(
      shadow,
      [
        {
          index: 0,
          node: { tagName: "h2", textContent: "Replaced" },
          op: "set-child",
          parentPath: [],
        },
      ],
      container,
      CTX,
    );
    expect(rootChildTags(container)).toEqual(["h2", "span", "div"]);
    const el = elAt(container, ["children", 0]);
    expect(el.tagName.toLowerCase()).toBe("h2");
    expect(el.textContent).toBe("Replaced");
    expectConsistent(container, shadow);
  });

  test("set-key on a non-style/text key re-renders the node's subtree", () => {
    const { container, shadow } = mountTree(TREE);
    applyIframePatch(
      shadow,
      [{ key: "attributes", op: "set-key", path: ["children", 0], value: { title: "hi" } }],
      container,
      CTX,
    );
    const el = elAt(container, ["children", 0]);
    expect(el.tagName.toLowerCase()).toBe("p"); // Same tag, re-rendered with the new attribute.
    expect(el.getAttribute("title")).toBe("hi");
    expect(el.textContent).toBe("a"); // Existing text preserved.
    expectConsistent(container, shadow);
  });

  test("inserting into an empty container clears its empty-container placeholder", () => {
    // A doc whose div child is empty (gets the placeholder class in mountTree-equivalent render).
    const doc: JxMutableNode = {
      children: [{ children: [], tagName: "div" }],
      tagName: "div",
    };
    const { container, shadow } = mountTree(doc);
    const emptyDiv = elAt(container, ["children", 0]);
    emptyDiv.classList.add("empty-container-placeholder");

    applyIframePatch(
      shadow,
      [
        {
          index: 0,
          node: { tagName: "span", textContent: "x" },
          op: "insert-child",
          parentPath: ["children", 0],
        },
      ],
      container,
      CTX,
    );
    expect(emptyDiv.classList.contains("empty-container-placeholder")).toBe(false);
    expect(elAt(container, ["children", 0, "children", 0]).tagName.toLowerCase()).toBe("span");
    expectConsistent(container, shadow);
  });
});

// ─── Echo suppression ────────────────────────────────────────────────────────

describe("applyIframePatch — echoed ops", () => {
  test("folds an echoed op into the shadow doc but leaves the DOM alone", () => {
    // The echo of this frame's OWN commit: the DOM already holds what the user typed, so applying
    // The patch would re-render the subtree the caret lives in and throw them out of it.
    const { container, shadow } = mount(BASE);
    const el = elAt(container, ["children", 0]);
    el.textContent = "hello there"; // What the user typed.

    const op: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 0],
      value: "hello there",
    };
    applyIframePatch(shadow, [op], container, CTX, [["children", 0]]);

    // Shadow doc took it (it is the patch source of truth) …
    expect(getNodeAtPath(shadow, ["children", 0])?.textContent).toBe("hello there");
    // … and the DOM was not touched by the patcher.
    expect(elAt(container, ["children", 0])).toBe(el);
    expect(el.textContent).toBe("hello there");
  });

  test("suppression is per PATH — other ops in the same batch still patch the DOM", () => {
    const { container, shadow } = mount(BASE);
    const echoed: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 0],
      value: "typed",
    };
    const other: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 1],
      value: "remote",
    };
    applyIframePatch(shadow, [echoed, other], container, CTX, [["children", 0]]);

    expect(elAt(container, ["children", 0]).textContent).toBe("hello"); // Untouched.
    expect(elAt(container, ["children", 1]).textContent).toBe("remote"); // Applied.
  });

  test("an empty or absent echo list patches everything, as normal", () => {
    for (const echo of [undefined, []]) {
      const { container, shadow } = mount(BASE);
      const op: JxDocOp = {
        key: "textContent",
        op: "set-key",
        path: ["children", 0],
        value: "changed",
      };
      applyIframePatch(shadow, [op], container, CTX, echo);
      expect(elAt(container, ["children", 0]).textContent).toBe("changed");
    }
  });

  test("reconciles the placeholder class of the block being typed in, without touching its text", () => {
    // The screenshot bug: the class is stamped from the DOCUMENT, and typing into an empty block
    // Reaches the DOM natively — so the block the author is writing in kept `empty-text-placeholder`
    // For the whole session (its own commit comes back as an echo, which is never re-rendered), and
    // "Click here to add text..." sat beside the text they had just typed. The class is model-derived
    // State, so an echo still gets to correct it; only the CONTENT is the author's to own.
    const { container, shadow } = mount(BASE);
    const el = elAt(container, ["children", 1]);
    el.classList.add("empty-text-placeholder"); // Stamped when the span rendered empty.
    el.textContent = "asdfasdf"; // What the user typed, already in the DOM.

    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "asdfasdf" }],
      container,
      CTX,
      [["children", 1]],
    );

    expect(el.classList.contains("empty-text-placeholder")).toBe(false);
    expect(el.textContent).toBe("asdfasdf"); // Not rewritten — the caret lives in this text node.
    expect(elAt(container, ["children", 1])).toBe(el); // Nor re-rendered.
  });

  test("an echo that empties the block puts the placeholder class back", () => {
    const { container, shadow } = mount(BASE);
    const el = elAt(container, ["children", 1]);
    el.textContent = ""; // The user deleted it.

    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "" }],
      container,
      CTX,
      [["children", 1]],
    );

    expect(el.classList.contains("empty-text-placeholder")).toBe(true);
  });

  test("an echoed op for a path this render never drew is a no-op, not an escalation", () => {
    // Reconciling a class is best-effort: throwing here would be reported as a `patchError`, and
    // The parent's full render would take the caret with it.
    // `mount` mirrors only the top-level children, so this nested node exists in the doc with no
    // Element of its own — the shape a patch for an unrendered subtree arrives in.
    const { container, shadow } = mount({
      children: [{ children: [{ tagName: "em", textContent: "deep" }], tagName: "p" }],
      tagName: "div",
    });
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "textContent", op: "set-key", path: ["children", 0, "children", 0], value: "x" }],
        container,
        CTX,
        [["children", 0, "children", 0]],
      ),
    ).not.toThrow();
    // The shadow doc still took it — an echo is folded whether or not this render drew it.
    expect(getNodeAtPath(shadow, ["children", 0, "children", 0])?.textContent).toBe("x");
  });

  test("only set-key ops are suppressed — a structural op at an echoed path still applies", () => {
    // Echo suppression exists for the commit shape (set-key on textContent/children). A structural
    // Op arriving for the same path is something else entirely and must not be silently dropped.
    const { container, shadow } = mount(BASE);
    const op: JxDocOp = {
      index: 0,
      node: { tagName: "em", textContent: "new" },
      op: "insert-child",
      parentPath: [],
    };
    applyIframePatch(shadow, [op], container, CTX, [[]]);
    expect(childList(shadow)).toHaveLength(3);
    expect(container.querySelector("em")?.textContent).toBe("new");
  });
});

describe("applyIframePatch — bound text is drawn again", () => {
  /** A collection's page: a ContentEntry in state, and two text children. */
  const ENTRY_PAGE: JxMutableNode = {
    children: [
      { tagName: "h1", textContent: "Draft" },
      { tagName: "p", textContent: "Plain" },
    ],
    state: { entry: { $prototype: "ContentEntry", contentType: "posts" } },
    tagName: "article",
  };

  test("text set to an entry field is drawn again, as a named chip", () => {
    const { container, shadow } = mount(ENTRY_PAGE);
    applyIframePatch(
      shadow,
      [
        {
          key: "textContent",
          op: "set-key",
          path: ["children", 0],
          value: "${state.entry.data.title}",
        },
      ],
      container,
      CTX,
    );
    const h1 = elAt(container, ["children", 0]);
    expect(h1.dataset.jxBoundField).toBe("Title");
    expect(h1.hasAttribute("contenteditable")).toBe(false);
    // No entry resolves in this scope, so the chip is empty; it still names its field.
    expect(h1.textContent).toBe("");
    expect(h1.querySelector("data")?.dataset.jxTagLabel).toBe("Title");
  });

  test("text that stops being bound loses its mark", () => {
    const { container, shadow } = mount(ENTRY_PAGE);
    elAt(container, ["children", 1]).dataset.jxBoundField = "excerpt";
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "Written by hand" }],
      container,
      CTX,
    );
    const p = elAt(container, ["children", 1]);
    expect(p.dataset.jxBoundField).toBeUndefined();
    expect(p.textContent).toBe("Written by hand");
  });

  test("without a render context the redraw cannot happen, and says so", () => {
    const { container, shadow } = mount(ENTRY_PAGE);
    expect(() =>
      applyIframePatch(
        shadow,
        [
          {
            key: "textContent",
            op: "set-key",
            path: ["children", 0],
            value: "${state.entry.data.title}",
          },
        ],
        container,
      ),
    ).toThrow("iframe-patch-no-render-ctx");
  });
});

// ─── Component instances: a `$props` edit written in place ───────────────────

/** Let the instances' async connectedCallbacks finish. */
const settle = (ms = 40) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let cardCount = 0;

/**
 * Define a component that draws its `label` prop in an `h3` above its slot, under a tag no other
 * test registered (a custom element cannot be defined twice in one realm).
 */
async function defineCard(onMount = false): Promise<string> {
  cardCount += 1;
  const tagName = `patch-card-${cardCount}`;
  const state: NonNullable<JxDocument["state"]> = { label: "Default", mounted: false };
  if (onMount) {
    state.onMount = {
      $prototype: "Function",
      body: [{ operator: "=", target: { $ref: "#/state/mounted" }, value: true }],
    };
  }
  await defineElement({
    children: [{ tagName: "h3", textContent: "${state.label}" }, { tagName: "slot" }],
    state,
    tagName,
  });
  return tagName;
}

/** A page holding one instance of `tagName` with one slotted paragraph. */
function cardPage(tagName: string, $props?: JxMutableNode["$props"]): JxMutableNode {
  return { children: [cardNode(tagName, $props)], tagName: "div" };
}

/** One instance of `tagName` with one slotted paragraph; no `$props` key when none is given. */
function cardNode(tagName: string, $props: JxMutableNode["$props"]): JxMutableNode {
  const node: JxMutableNode = { children: [{ tagName: "p", textContent: "slotted" }], tagName };
  if ($props !== undefined) {
    node.$props = $props;
  }
  return node;
}

/** A page whose instance is the SECOND child, behind a plain paragraph. */
function cardBehindLead(tagName: string, $props: JxMutableNode["$props"]): JxMutableNode {
  return {
    children: [{ tagName: "p", textContent: "lead" }, cardNode(tagName, $props)],
    tagName: "div",
  };
}

/**
 * Draw a doc the way a subtree patch does (the edit-mode transform, the runtime renderer and the
 * `data-jx-path` stamper), connected, with its instances settled.
 */
async function mountLive(doc: JxMutableNode, ctx: IframeRenderCtx = CTX): Promise<Mounted> {
  resetDocumentStyles();
  const shadow = structuredClone(doc);
  const container = document.createElement("div");
  container.append(renderSubtreeIframe(shadow, [], ctx));
  document.body.append(container);
  await settle();
  return { container, shadow };
}

const CARD = ["children", 0];
const SLOTTED = ["children", 0, "children", 0];
const SECOND = ["children", 1];

/** The heading the instance's own definition drew. */
function headingOf(container: HTMLElement): string | undefined {
  return elAt(container, CARD).querySelector("h3")?.textContent;
}

describe("applyIframePatch — $props on a component instance", () => {
  test("a changed literal is written into the live instance; host and slotted child are kept", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);
    const slotted = elAt(container, SLOTTED);
    expect(headingOf(container)).toBe("First");

    // No render context: the in-place path needs none, so a rebuild here would throw.
    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Second" } }],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(elAt(container, SLOTTED)).toBe(slotted);
    expect(headingOf(container)).toBe("Second");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("a $props op that changes nothing draws the instance again", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "Same" }));
    const host = elAt(container, CARD);

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Same" } }],
      container,
      CTX,
    );
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(headingOf(container)).toBe("Same");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Same" });
    container.remove();
  });

  test("a no-diff $props op without a render context escalates rather than doing nothing", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "Same" }));
    expect(() =>
      applyIframePatch(
        shadow,
        [{ key: "$props", op: "set-key", path: CARD, value: { label: "Same" } }],
        container,
      ),
    ).toThrow(/iframe-patch-no-render-ctx/);
    container.remove();
  });

  test("a prop changed to a template is not written in place: the instance is rebuilt", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "Literal" }));
    const host = elAt(container, CARD);

    const value = { label: "${state.title}" };
    applyIframePatch(shadow, [{ key: "$props", op: "set-key", path: CARD, value }], container, CTX);
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual(value);
    container.remove();
  });

  test("a prop changed to a $ref is not written in place: the instance is rebuilt", async () => {
    const tag = await defineCard();
    const ctx: IframeRenderCtx = {
      ...CTX,
      defs: await buildScope({ state: { title: "From state" } }, {}, "http://localhost/"),
    };
    const page = { ...cardPage(tag, { label: "Literal" }), state: { title: "From state" } };
    const { container, shadow } = await mountLive(page, ctx);
    const host = elAt(container, CARD);

    const value = { label: { $ref: "#/state/title" } };
    applyIframePatch(shadow, [{ key: "$props", op: "set-key", path: CARD, value }], container, ctx);
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual(value);
    container.remove();
  });

  test("a prop that WAS bound is not written in place when it becomes a literal", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "${state.title}" }));
    const host = elAt(container, CARD);

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Literal" } }],
      container,
      CTX,
    );
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(headingOf(container)).toBe("Literal");
    container.remove();
  });

  test("an instance whose definition has onMount is rebuilt, so the hook reads the new props", async () => {
    const tag = await defineCard(true);
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Second" } }],
      container,
      CTX,
    );
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(headingOf(container)).toBe("Second");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("two $props ops in one batch each diff against the block the previous op left", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);
    const slotted = elAt(container, SLOTTED);

    // A run of distinct values lands on the last one, in place (no render context to rebuild with).
    applyIframePatch(
      shadow,
      [
        { key: "$props", op: "set-key", path: CARD, value: { label: "Second" } },
        { key: "$props", op: "set-key", path: CARD, value: { label: "Third" } },
      ],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(elAt(container, SLOTTED)).toBe(slotted);
    expect(headingOf(container)).toBe("Third");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Third" });
    container.remove();
  });

  test("a batch that ends on the block it started from writes each op's own value in place", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);
    const slotted = elAt(container, SLOTTED);

    /* Each op is diffed from the block it replaced to its OWN value, not to the folded doc: both
       are changes, so both are written and nothing is rebuilt (no render context to rebuild with). */
    applyIframePatch(
      shadow,
      [
        { key: "$props", op: "set-key", path: CARD, value: { label: "Second" } },
        { key: "$props", op: "set-key", path: CARD, value: { label: "First" } },
      ],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(elAt(container, SLOTTED)).toBe(slotted);
    expect(headingOf(container)).toBe("First");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "First" });
    container.remove();
  });

  test("a $props op followed by a removal before it writes the instance it named", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardBehindLead(tag, { label: "First" }));
    const host = elAt(container, SECOND);

    // After the fold nothing sits at the path the op named; the op's own value is what counts.
    applyIframePatch(
      shadow,
      [
        { key: "$props", op: "set-key", path: SECOND, value: { label: "Second" } },
        { index: 0, op: "remove-child", parentPath: [] },
      ],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(host.isConnected).toBe(true);
    expect(host.querySelector("h3")?.textContent).toBe("Second");
    expect(container.querySelector(`[data-jx-path='${serializeJxPath(SECOND)}']`)).toBeNull();
    expect(childList(shadow)).toHaveLength(1);
    expect(getNodeAtPath(shadow, CARD)?.tagName).toBe(tag);
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("a $props op followed by an insertion before it writes the instance it named", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardBehindLead(tag, { label: "First" }));
    const host = elAt(container, SECOND);
    const lead = elAt(container, CARD);

    // The folded doc holds the lead paragraph at the op's path by the time the DOM is patched.
    applyIframePatch(
      shadow,
      [
        { key: "$props", op: "set-key", path: SECOND, value: { label: "Second" } },
        {
          index: 0,
          node: { tagName: "b", textContent: "NEW" },
          op: "insert-child",
          parentPath: [],
        },
      ],
      container,
      CTX,
    );
    await settle();

    const third = ["children", 2];
    expect(elAt(container, third)).toBe(host);
    expect(host.isConnected).toBe(true);
    expect(host.querySelector("h3")?.textContent).toBe("Second");
    expect(elAt(container, SECOND)).toBe(lead);
    expect(lead.textContent).toBe("lead");
    expect(elAt(container, CARD).textContent).toBe("NEW");
    expect(getNodeAtPath(shadow, SECOND)?.$props).toBeUndefined();
    expect(getNodeAtPath(shadow, third)?.tagName).toBe(tag);
    expect(getNodeAtPath(shadow, third)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("a path the sender asked to have drawn again replaces the host, changed block or not", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Second" } }],
      container,
      CTX,
      undefined,
      [CARD],
    );
    await settle();

    expect(elAt(container, CARD)).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(headingOf(container)).toBe("Second");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("a redraw path without a render context escalates rather than writing in place", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    expect(() => {
      applyIframePatch(
        shadow,
        [{ key: "$props", op: "set-key", path: CARD, value: { label: "Second" } }],
        container,
        undefined,
        undefined,
        [CARD],
      );
    }).toThrow(/iframe-patch-no-render-ctx/);
    container.remove();
  });

  test("a redraw path that names another node leaves an in-place write alone", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardBehindLead(tag, { label: "First" }));
    const host = elAt(container, SECOND);
    const lead = elAt(container, CARD);

    // No render context: only the in-place path can succeed.
    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: SECOND, value: { label: "Second" } }],
      container,
      undefined,
      undefined,
      [CARD, SLOTTED],
    );
    await settle();

    expect(elAt(container, SECOND)).toBe(host);
    expect(elAt(container, CARD)).toBe(lead);
    expect(host.querySelector("h3")?.textContent).toBe("Second");
    expect(getNodeAtPath(shadow, SECOND)?.$props).toEqual({ label: "Second" });
    container.remove();
  });

  test("a node that hands a prop over as a props.* attribute is rebuilt, not written in place", async () => {
    const tag = await defineCard();
    const page = cardPage(tag, { label: "First" });
    nodeOf(childList(page)[0]!).attributes = { "props.label": "From attribute" };
    const { container, shadow } = await mountLive(page);
    const host = elAt(container, CARD);

    const op: JxDocOp = { key: "$props", op: "set-key", path: CARD, value: { label: "Second" } };
    // Without a render context the refusal has nothing to rebuild with, which proves it refused.
    expect(() => {
      applyIframePatch(structuredClone(shadow), [op], container);
    }).toThrow(/iframe-patch-no-render-ctx/);
    expect(elAt(container, CARD)).toBe(host);

    applyIframePatch(shadow, [op], container, CTX);
    await settle();

    const rebuilt = elAt(container, CARD);
    expect(rebuilt).not.toBe(host);
    expect(host.isConnected).toBe(false);
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Second" });
    // The rebuilt instance shows what a fresh render of the folded node shows.
    const fresh = await mountLive(shadow);
    expect(headingOf(container)).toBe(headingOf(fresh.container));
    fresh.container.remove();
    container.remove();
  });

  test("a removed $props block puts the declared default back in place", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);
    const slotted = elAt(container, SLOTTED);

    // No render context: the default is restored by a write, not by a rebuild.
    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: undefined }],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(elAt(container, SLOTTED)).toBe(slotted);
    expect(headingOf(container)).toBe("Default");
    expect(getNodeAtPath(shadow, CARD)?.$props).toBeUndefined();
    container.remove();
  });

  test("a $props block added to an instance drawn without one is written in place", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag));
    const host = elAt(container, CARD);
    expect(headingOf(container)).toBe("Default");

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Given" } }],
      container,
    );
    await settle();

    expect(elAt(container, CARD)).toBe(host);
    expect(headingOf(container)).toBe("Given");
    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Given" });
    container.remove();
  });

  test("an echoed $props op is folded and leaves the instance alone", async () => {
    const tag = await defineCard();
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    const host = elAt(container, CARD);

    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: CARD, value: { label: "Typed" } }],
      container,
      CTX,
      [CARD],
    );
    await settle();

    expect(getNodeAtPath(shadow, CARD)?.$props).toEqual({ label: "Typed" });
    // Neither rebuilt nor written: the instance still draws the value it connected with.
    expect(elAt(container, CARD)).toBe(host);
    expect(headingOf(container)).toBe("First");
    container.remove();
  });

  test("$props on an element that is not a Jx instance re-renders it, as before", () => {
    const { container, shadow } = mountTree(TREE);
    const el = elAt(container, ["children", 0]);
    applyIframePatch(
      shadow,
      [{ key: "$props", op: "set-key", path: ["children", 0], value: { title: "x" } }],
      container,
      CTX,
    );
    expect(elAt(container, ["children", 0])).not.toBe(el);
    expect(getNodeAtPath(shadow, ["children", 0])?.$props).toEqual({ title: "x" });
  });
});

// ─── Component instances: a prop the node hands over by another route ────────

let routedCount = 0;

/**
 * Define a component that draws every declared prop, in declaration order, as `name=value` segments
 * of one `h3` above its slot, under a tag no other test registered.
 */
async function defineRouted(state: NonNullable<JxDocument["state"]>): Promise<string> {
  routedCount += 1;
  const tagName = `patch-routed-${routedCount}`;
  const textContent = Object.keys(state)
    .map((key) => `${key}=\${state.${key}}`)
    .join("|");
  await defineElement({
    children: [{ tagName: "h3", textContent }, { tagName: "slot" }],
    state,
    tagName,
  });
  return tagName;
}

/** A page holding one instance built from `extra` (attributes, top-level keys) and `$props`. */
function routedPage(
  tagName: string,
  $props: JxMutableNode["$props"],
  extra: JxMutableNode,
): JxMutableNode {
  return { children: [{ ...cardNode(tagName, $props), ...extra }], tagName: "div" };
}

/** A `set-key $props` op on the page's one instance; with no value, one that removes the block. */
function propsOp(value?: Extract<JxDocOp, { op: "set-key" }>["value"]): JxDocOp {
  return { key: "$props", op: "set-key", path: CARD, value };
}

/**
 * Assert the op is REFUSED in place and the instance rebuilt, and that the rebuilt instance shows
 * what a fresh render of the folded document shows.
 *
 * The refusal is proved without a render context: the only thing a refusal can do there is ask for
 * one, and the instance is left as it was.
 */
async function expectRebuilt(mounted: Mounted, op: JxDocOp): Promise<void> {
  const { container, shadow } = mounted;
  const host = elAt(container, CARD);
  const drawn = headingOf(container);
  expect(() => {
    applyIframePatch(structuredClone(shadow), [op], container);
  }).toThrow(/iframe-patch-no-render-ctx/);
  expect(elAt(container, CARD)).toBe(host);
  expect(headingOf(container)).toBe(drawn);

  applyIframePatch(shadow, [op], container, CTX);
  await settle();

  expect(elAt(container, CARD)).not.toBe(host);
  expect(host.isConnected).toBe(false);
  const patched = headingOf(container);
  expect(patched).toBeDefined();
  const fresh = await mountLive(shadow);
  expect(patched).toBe(headingOf(fresh.container));
  fresh.container.remove();
  container.remove();
}

/**
 * Assert the op is WRITTEN in place (no render context, so a rebuild would throw), that host and
 * slotted child survive, and that the instance shows what a fresh render of the folded document
 * shows.
 */
async function expectInPlace(mounted: Mounted, op: JxDocOp, heading: string): Promise<void> {
  const { container, shadow } = mounted;
  const host = elAt(container, CARD);
  const slotted = elAt(container, SLOTTED);

  applyIframePatch(shadow, [op], container);
  await settle();

  expect(elAt(container, CARD)).toBe(host);
  expect(elAt(container, SLOTTED)).toBe(slotted);
  const patched = headingOf(container);
  expect(patched).toBe(heading);
  const fresh = await mountLive(shadow);
  expect(patched).toBe(headingOf(fresh.container));
  fresh.container.remove();
  container.remove();
}

describe("applyIframePatch — $props a node also delivers by another route", () => {
  test("a top-level key equal to the changed prop rebuilds the instance", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(routedPage(tag, { label: "First" }, { label: "Top" }));
    await expectRebuilt(mounted, propsOp({ label: "Second" }));
  });

  test("a top-level key naming ANOTHER prop leaves the write in place", async () => {
    const tag = await defineRouted({ label: "Default", note: "None" });
    const mounted = await mountLive(routedPage(tag, { label: "First" }, { note: "Top" }));
    await expectInPlace(mounted, propsOp({ label: "Second" }), "label=Second|note=Top");
  });

  test("an attribute named like a reflected DOM property rebuilds the instance", async () => {
    const tag = await defineRouted({ title: "Default" });
    const mounted = await mountLive(
      routedPage(tag, { title: "First" }, { attributes: { title: "x" } }),
    );
    await expectRebuilt(mounted, propsOp({ title: "Second" }));
  });

  test("the kebab attribute of a camelCase DOM property rebuilds the instance", async () => {
    const restore = stubAriaLabel();
    try {
      const tag = await defineRouted({ ariaLabel: "Default" });
      const mounted = await mountLive(
        routedPage(tag, { ariaLabel: "First" }, { attributes: { "aria-label": "x" } }),
      );
      await expectRebuilt(mounted, propsOp({ ariaLabel: "Second" }));
    } finally {
      restore();
    }
  });

  test("an attribute named like a prop that is no DOM property leaves the write in place", async () => {
    // The runtime's merge asks `key in this`, so `label="x"` writes no property and delivers nothing.
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(
      routedPage(tag, { label: "First" }, { attributes: { label: "x" } }),
    );
    await expectInPlace(mounted, propsOp({ label: "Second" }), "label=Second");
  });

  test("a data-jx-props payload naming the changed prop rebuilds the instance", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(
      routedPage(
        tag,
        { label: "First" },
        { attributes: { "data-jx-props": JSON.stringify({ label: "Payload" }) } },
      ),
    );
    await expectRebuilt(mounted, propsOp({ label: "Second" }));
  });

  test("a data-jx-props payload naming only OTHER props leaves the write in place", async () => {
    const tag = await defineRouted({ label: "Default", note: "None" });
    const mounted = await mountLive(
      routedPage(
        tag,
        { label: "First" },
        { attributes: { "data-jx-props": JSON.stringify({ note: "Payload" }) } },
      ),
    );
    await expectInPlace(mounted, propsOp({ label: "Second" }), "label=Second|note=Payload");
  });

  test("an unparseable data-jx-props payload delivers nothing, so the write stays in place", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(
      routedPage(tag, { label: "First" }, { attributes: { "data-jx-props": "{label" } }),
    );
    await expectInPlace(mounted, propsOp({ label: "Second" }), "label=Second");
  });

  test("a props.label attribute rebuilds the instance when label changes", async () => {
    const tag = await defineRouted({ label: "Default", note: "None" });
    const mounted = await mountLive(
      routedPage(
        tag,
        { label: "First", note: "A" },
        { attributes: { "props.label": "From attribute" } },
      ),
    );
    await expectRebuilt(mounted, propsOp({ label: "Second", note: "A" }));
  });

  test("a props.label attribute leaves an edit to a DIFFERENT prop in place", async () => {
    const tag = await defineRouted({ label: "Default", note: "None" });
    const mounted = await mountLive(
      routedPage(tag, { note: "A" }, { attributes: { "props.label": "From attribute" } }),
    );
    await expectInPlace(mounted, propsOp({ note: "B" }), "label=From attribute|note=B");
  });

  test("a prop REMOVED from the block while another route still delivers it rebuilds the instance", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(
      routedPage(tag, { label: "First" }, { attributes: { "props.label": "From attribute" } }),
    );
    await expectRebuilt(mounted, propsOp());
  });
});

describe("applyIframePatch — $props the instance cannot take in place", () => {
  test("an op whose value is an array falls back to a rebuild", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(cardPage(tag, { label: "First" }));
    await expectRebuilt(mounted, propsOp(["label", "Second"]));
  });

  test("an op whose value is a string falls back to a rebuild", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(cardPage(tag, { label: "First" }));
    await expectRebuilt(mounted, propsOp("Second"));
  });

  test("a prop changed to an object is rebuilt, and shows what a fresh render shows", async () => {
    const tag = await defineRouted({ label: "Default", meta: { size: "s" } });
    const mounted = await mountLive(cardPage(tag, { label: "First", meta: { size: "m" } }));
    await expectRebuilt(mounted, propsOp({ label: "First", meta: { size: "l" } }));
  });

  test("a scalar prop changed to an array is rebuilt, and shows what a fresh render shows", async () => {
    const tag = await defineRouted({ label: "Default" });
    const mounted = await mountLive(cardPage(tag, { label: "First" }));
    await expectRebuilt(mounted, propsOp({ label: ["a", "b"] }));
  });

  test("a $props op for a path this render has no element for escalates", async () => {
    const tag = await defineRouted({ label: "Default" });
    const { container, shadow } = await mountLive(cardPage(tag, { label: "First" }));
    elAt(container, CARD).remove();
    expect(() => {
      applyIframePatch(shadow, [propsOp({ label: "Second" })], container, CTX);
    }).toThrow(/iframe-patch-element-not-found/);
    container.remove();
  });
});
