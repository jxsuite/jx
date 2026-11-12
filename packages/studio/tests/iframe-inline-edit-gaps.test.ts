/**
 * Iframe inline-edit gaps — dblclicks on unstamped trees (findPropBoundTarget/findEditableTarget
 * walk to null), a prop-bound marker with no custom-element owner, the permissive shadow-doc
 * contract when no accessor is provided, and the mode gate on the parent's enterEdit message.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { startIframeInlineEdit } from "../src/canvas/iframe-inline-edit";
import {
  abandonEditing,
  commitActiveBlock,
  isEditing,
  setSlashController,
  stopEditing,
} from "../src/editor/inline-edit";
import type { SlashCommand } from "../src/editor/inline-edit";
import { beforeInput, caretAt, caretInto, selectAcross } from "./harness";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";

let teardown: (() => void) | undefined;

function boot(opts?: Parameters<typeof startIframeInlineEdit>[2]) {
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const fromIframe: IframeToParent[] = [];
  pair.parent.onMessage((m) => fromIframe.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  teardown =
    opts === undefined
      ? startIframeInlineEdit(pair.iframe, container)
      : startIframeInlineEdit(pair.iframe, container, opts);
  return { container, fromIframe, pair };
}

/** Click into `el` — pointerdown (opens a prop-bound nested host) then the caret landing inside. */
function clickInto(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  caretInto(el);
}

/** The messages of one `kind` the iframe posted, narrowed to that variant. */
function ofKind<K extends IframeToParent["kind"]>(
  msgs: IframeToParent[],
  kind: K,
): Extract<IframeToParent, { kind: K }>[] {
  return msgs.filter((m): m is Extract<IframeToParent, { kind: K }> => m.kind === kind);
}

afterEach(() => {
  if (isEditing()) {
    stopEditing();
  }
  teardown?.();
  teardown = undefined;
  // Back to the no-op controller every other test here runs under.
  setSlashController({ dismiss: () => {}, isOpen: () => false, show: () => {} });
  document.body.innerHTML = "";
});

describe("dblclick target walks", () => {
  test("a dblclick on a fully unstamped tree starts nothing", () => {
    const { container, fromIframe, pair } = boot();
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    inner.textContent = "plain";
    outer.append(inner);
    container.append(outer);

    clickInto(inner);
    pair.flush();
    expect(isEditing()).toBe(false);
    expect(fromIframe.some((m) => m.kind === "editStart")).toBe(false);
  });

  test("a prop-bound marker without a custom-element owner is blocked", () => {
    const { container, fromIframe, pair } = boot();
    // The marker sits under plain divs only — ownerInstanceOf walks to null.
    const wrap = document.createElement("div");
    const marker = document.createElement("span");
    marker.dataset.jxBoundProp = "title";
    marker.textContent = "Card title";
    wrap.append(marker);
    container.append(wrap);

    clickInto(marker);
    pair.flush();
    expect(isEditing()).toBe(false);
    expect(fromIframe.some((m) => m.kind === "editStart")).toBe(false);
  });

  test("without a shadow-doc accessor, a prop-bound session starts permissively", () => {
    const { container, fromIframe, pair } = boot(); // No opts → getShadowDoc absent.
    const host = document.createElement("x-card");
    host.dataset.jxPath = '["children",0]';
    const marker = document.createElement("span");
    marker.dataset.jxBoundProp = "title";
    marker.textContent = "Card title";
    host.append(marker);
    container.append(host);

    clickInto(marker);
    pair.flush();
    expect(isEditing()).toBe(true);
    const [start] = ofKind(fromIframe, "editStart");
    expect(start).toMatchObject({ path: ["children", 0], prop: "title" });
    stopEditing();
  });
});

describe("range caching triggers", () => {
  test("mouseup, keyup, and blur all re-cache the live range during a session", () => {
    const { container, fromIframe, pair } = boot();
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    p.textContent = "cache me";
    container.append(p);
    clickInto(p);
    pair.flush();
    expect(isEditing()).toBe(true);

    // A non-collapsed selection inside the editable, then each aggressive cache trigger.
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
    document.dispatchEvent(new Event("blur", { bubbles: true }));
    pair.flush();

    // The session survived the triggers and posted at least the entry snapshot.
    expect(isEditing()).toBe(true);
    expect(fromIframe.some((m) => m.kind === "selectionChanged")).toBe(true);
    stopEditing();
  });
});

describe("Enter splits the block", () => {
  test("Enter mid-text posts editSplit with the before/after halves", () => {
    const { container, fromIframe, pair } = boot();
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    p.textContent = "before|after";
    container.append(p);
    clickInto(p);
    pair.flush();
    expect(isEditing()).toBe(true);

    // Enter reaches the editing host as `beforeinput`/insertParagraph, not as a keydown — the
    // Chokepoint is the one place structural intent is recognised.
    caretInto(p, "before|".length);
    const prevented = beforeInput(p, "insertParagraph");
    pair.flush();

    // The browser must NOT be allowed to split the DOM itself; the document model does it.
    expect(prevented).toBe(true);
    const [split] = ofKind(fromIframe, "editSplit");
    expect(split).toBeDefined();
    expect(split!.path).toEqual(["children", 0]);
    expect(split!.before).toEqual({ textContent: "before|" });
    expect(split!.after).toEqual({ textContent: "after" });
  });

  test("Shift+Enter stays inside the block and is left to the browser", () => {
    const { container, fromIframe, pair } = boot();
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    p.textContent = "one line";
    container.append(p);
    clickInto(p);
    caretInto(p, 3);

    const prevented = beforeInput(p, "insertLineBreak");
    pair.flush();

    expect(prevented).toBe(false);
    expect(fromIframe.some((m) => m.kind === "editSplit")).toBe(false);
  });
});

describe("block merges", () => {
  /** Two stamped paragraphs in the container, ready to be joined. */
  function twoBlocks(container: HTMLElement) {
    const first = document.createElement("p");
    first.dataset.jxPath = '["children",0]';
    first.textContent = "First";
    const second = document.createElement("p");
    second.dataset.jxPath = '["children",1]';
    second.textContent = "Second";
    container.append(first, second);
    return { first, second };
  }

  test("Backspace at a block start posts a merge onto the previous block", () => {
    const { container, fromIframe, pair } = boot();
    const { second } = twoBlocks(container);
    clickInto(second);
    caretInto(second, 0);

    const prevented = beforeInput(second, "deleteContentBackward");
    pair.flush();

    expect(prevented).toBe(true);
    expect(fromIframe.find((m) => m.kind === "editMerge")).toEqual({
      fromPath: ["children", 1],
      intoPath: ["children", 0],
      kind: "editMerge",
    });
  });

  test("Delete at a block end pulls the NEXT block up into this one", () => {
    const { container, fromIframe, pair } = boot();
    const { first } = twoBlocks(container);
    clickInto(first);
    caretInto(first, "First".length);

    const prevented = beforeInput(first, "deleteContentForward");
    pair.flush();

    expect(prevented).toBe(true);
    // Same join, approached from the other side: the earlier block always survives.
    expect(fromIframe.find((m) => m.kind === "editMerge")).toEqual({
      fromPath: ["children", 1],
      intoPath: ["children", 0],
      kind: "editMerge",
    });
  });

  test("Backspace in the FIRST block posts nothing — there is nothing to join onto", () => {
    const { container, fromIframe, pair } = boot();
    const { first } = twoBlocks(container);
    clickInto(first);
    caretInto(first, 0);

    const prevented = beforeInput(first, "deleteContentBackward");
    pair.flush();

    // Still suppressed: letting the browser act would restructure the DOM behind the model's back.
    expect(prevented).toBe(true);
    expect(fromIframe.some((m) => m.kind === "editMerge")).toBe(false);
  });

  test("Delete at the END of the last block posts nothing", () => {
    const { container, fromIframe, pair } = boot();
    const { second } = twoBlocks(container);
    clickInto(second);
    caretInto(second, "Second".length);

    beforeInput(second, "deleteContentForward");
    pair.flush();
    expect(fromIframe.some((m) => m.kind === "editMerge")).toBe(false);
  });

  test("a merge flushes uncommitted text first, so nothing typed is lost", () => {
    const { container, fromIframe, pair } = boot();
    const { first, second } = twoBlocks(container);
    clickInto(first);
    first.textContent = "First edited";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    // Move to the second block WITHOUT waiting for the idle tick, then merge back.
    clickInto(second);
    second.textContent = "Second edited";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    caretInto(second, 0);
    beforeInput(second, "deleteContentBackward");
    pair.flush();

    const commits = ofKind(fromIframe, "editCommit");
    // The block being merged away had its typed text committed before the join.
    expect(commits.some((c) => c.textContent === "Second edited")).toBe(true);
    expect(fromIframe.some((m) => m.kind === "editMerge")).toBe(true);
  });
});

describe("cross-block range edits", () => {
  /** Four stamped paragraphs. */
  function fourBlocks(container: HTMLElement) {
    const els = ["AAAA", "BBBB", "CCCC", "DDDD"].map((t, i) => {
      const p = document.createElement("p");
      p.dataset.jxPath = JSON.stringify(["children", i]);
      p.textContent = t;
      container.append(p);
      return p;
    });
    return els;
  }

  test("deleting a selection across blocks posts the range with the blocks between", () => {
    const { container, fromIframe, pair } = boot();
    const els = fourBlocks(container);
    clickInto(els[0]!);
    selectAcross(els[0]!.firstChild!, 2, els[3]!.firstChild!, 2);

    const prevented = beforeInput(els[0]!, "deleteContentBackward");
    pair.flush();

    expect(prevented).toBe(true);
    expect(fromIframe.find((m) => m.kind === "editRangeReplace")).toEqual({
      between: [
        ["children", 1],
        ["children", 2],
      ],
      from: { offset: 2, path: ["children", 0] },
      kind: "editRangeReplace",
      text: "",
      to: { offset: 2, path: ["children", 3] },
    });
  });

  test("typing over a cross-block selection carries the typed text", () => {
    const { container, fromIframe, pair } = boot();
    const els = fourBlocks(container);
    clickInto(els[0]!);
    selectAcross(els[0]!.firstChild!, 1, els[1]!.firstChild!, 3);

    beforeInput(els[0]!, "insertText", "Z");
    pair.flush();

    expect(fromIframe.find((m) => m.kind === "editRangeReplace")).toMatchObject({
      between: [],
      text: "Z",
    });
  });

  test("a cut across blocks collapses the range", () => {
    const { container, fromIframe, pair } = boot();
    const els = fourBlocks(container);
    clickInto(els[1]!);
    selectAcross(els[1]!.firstChild!, 0, els[2]!.firstChild!, 4);

    beforeInput(els[1]!, "deleteByCut");
    pair.flush();

    expect(fromIframe.some((m) => m.kind === "editRangeReplace")).toBe(true);
  });

  test("a selection inside ONE block is left to the browser", () => {
    const { container, fromIframe, pair } = boot();
    const els = fourBlocks(container);
    clickInto(els[0]!);
    selectAcross(els[0]!.firstChild!, 1, els[0]!.firstChild!, 3);

    const prevented = beforeInput(els[0]!, "deleteContentBackward");
    pair.flush();

    expect(prevented).toBe(false);
    expect(fromIframe.some((m) => m.kind === "editRangeReplace")).toBe(false);
  });
});

describe("enterEdit mode gate", () => {
  test("a parent enterEdit is refused outside design/edit modes", () => {
    const { container, fromIframe, pair } = boot({ getMode: () => "stylebook" });
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    p.textContent = "specimen";
    container.append(p);

    pair.parent.post({ kind: "enterEdit", path: ["children", 0] });
    pair.flush();
    expect(isEditing()).toBe(false);
    expect(fromIframe.some((m) => m.kind === "editStart")).toBe(false);
  });
});

// ─── Bound text: chips survive an edit, and a deleted one is reported (studio.md §4.5) ────────

describe("a block whose bindings are chips is edited in place", () => {
  /** `By ` + a chip showing "Ada" + ` on ` + a chip that ends the block. */
  function boundBlock(container: HTMLElement, index = 0): HTMLParagraphElement {
    const p = document.createElement("p");
    p.dataset.jxPath = JSON.stringify(["children", index]);
    p.innerHTML =
      'By <data data-jx-tag="${a}" contenteditable="false">Ada</data> on ' +
      '<data data-jx-tag="${d}" contenteditable="false">March</data>';
    container.append(p);
    return p;
  }

  test("the caret entering shows the resolved value, never the expression", () => {
    const { container, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    pair.flush();
    expect(isEditing()).toBe(true);
    expect(p.textContent).toBe("By Ada on March");
  });

  test("a visit commits the template, so nothing is lost and nothing is refused", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    stopEditing();
    pair.flush();
    const [commit] = ofKind(fromIframe, "editCommit");
    expect(commit).toMatchObject({ children: null, textContent: "By ${a} on ${d}" });
    expect(commit).not.toHaveProperty("removedTags");
  });

  test("typing around a chip commits the new text with the chip still in it", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    p.firstChild!.nodeValue = "Written by ";
    commitActiveBlock();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit").at(-1)).toMatchObject({
      inPlace: true,
      textContent: "Written by ${a} on ${d}",
    });
  });

  test("Backspace over a chip is reported with the next commit, once", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    caretAt(p.childNodes[2]!, 0);
    expect(beforeInput(p, "deleteContentBackward")).toBe(true);
    commitActiveBlock();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit").at(-1)).toMatchObject({
      removedTags: ["${a}"],
      textContent: "By  on ${d}",
    });
    // The document has dropped the binding by now: the next commit has nothing left to excuse.
    commitActiveBlock();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit").at(-1)).not.toHaveProperty("removedTags");
  });

  test("a deletion belongs to the block it happened in", () => {
    const { container, fromIframe, pair } = boot();
    const first = boundBlock(container, 0);
    const second = boundBlock(container, 1);
    clickInto(first);
    caretAt(first.childNodes[2]!, 0);
    beforeInput(first, "deleteContentBackward");
    // Leaving commits the first block, with its deletion; the second starts with none.
    clickInto(second);
    stopEditing();
    pair.flush();
    const commits = ofKind(fromIframe, "editCommit");
    expect(commits.map((commit) => commit.removedTags)).toEqual([["${a}"], undefined]);
  });

  test("a split after a deletion carries it, and a chip is whole in one half", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    caretAt(p.childNodes[2]!, 0);
    beforeInput(p, "deleteContentBackward");
    caretAt(p.childNodes[1]!, 2);
    expect(beforeInput(p, "insertParagraph")).toBe(true);
    pair.flush();
    const [split] = ofKind(fromIframe, "editSplit");
    expect(split).toMatchObject({
      after: { textContent: "n ${d}" },
      before: { textContent: "By  o" },
      removedTags: ["${a}"],
    });
  });

  test("a range across blocks names the chips it covers in its two ends", () => {
    const { container, fromIframe, pair } = boot();
    const first = boundBlock(container, 0);
    const second = boundBlock(container, 1);
    clickInto(first);
    // From before the first block's first chip to just past the second block's first chip.
    selectAcross(first.firstChild!, 3, second.childNodes[2]!, 0);
    expect(beforeInput(first, "deleteContentBackward")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editRangeReplace")[0]).toEqual({
      between: [],
      from: { offset: 3, path: ["children", 0] },
      kind: "editRangeReplace",
      removedTags: ["${a}", "${d}", "${a}"],
      text: "",
      to: { offset: 7, path: ["children", 1] },
    });
  });
});

describe("a deletion reaches the document with the write that makes it", () => {
  /** `By ` + a chip showing "Ada" + ` on ` + a chip that ends the block. */
  function boundBlock(container: HTMLElement, index = 0): HTMLParagraphElement {
    const p = document.createElement("p");
    p.dataset.jxPath = JSON.stringify(["children", index]);
    p.innerHTML =
      'By <data data-jx-tag="${a}" contenteditable="false">Ada</data> on ' +
      '<data data-jx-tag="${d}" contenteditable="false">March</data>';
    container.append(p);
    return p;
  }

  test("Enter over a selection that covers a chip names the chip in the split", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    // From "B|y " across the first chip into " o|n ".
    selectAcross(p.firstChild!, 1, p.childNodes[2]!, 2);
    expect(beforeInput(p, "insertParagraph")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editSplit")).toEqual([
      {
        after: { textContent: "n ${d}" },
        before: { textContent: "B" },
        kind: "editSplit",
        path: ["children", 0],
        removedTags: ["${a}"],
      },
    ]);
  });

  test("a slash insert carries the chips deleted before it", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    const picks: ((cmd: SlashCommand) => void)[] = [];
    setSlashController({
      dismiss: () => {},
      isOpen: () => false,
      show: (_el, _filter, menu) => {
        picks.push(menu.onSelect);
      },
    });
    clickInto(p);
    caretAt(p.childNodes[2]!, 0);
    expect(beforeInput(p, "deleteContentBackward")).toBe(true);
    pair.parent.post({ kind: "openSlash" });
    pair.flush();
    picks.at(-1)?.({ description: "", label: "Heading", tag: "h2" });
    pair.flush();
    expect(ofKind(fromIframe, "editInsert")).toEqual([
      {
        cmd: { description: "", label: "Heading", tag: "h2" },
        commitData: { textContent: "By  on ${d}" },
        kind: "editInsert",
        path: ["children", 0],
        removedTags: ["${a}"],
      },
    ]);
  });

  test("a deletion never committed is forgotten when the caret enters another block", () => {
    const { container, fromIframe, pair } = boot();
    const first = boundBlock(container, 0);
    const second = boundBlock(container, 1);
    clickInto(first);
    caretAt(first.childNodes[2]!, 0);
    expect(beforeInput(first, "deleteContentBackward")).toBe(true);
    // What an undo's redraw does: the block is released with nothing written.
    abandonEditing();
    clickInto(second);
    second.firstChild!.nodeValue = "Written by ";
    stopEditing();
    pair.flush();
    // The second block lost no chip, so its commit excuses none: `${a}` is still in it.
    expect(ofKind(fromIframe, "editCommit")).toEqual([
      {
        children: null,
        kind: "editCommit",
        path: ["children", 1],
        textContent: "Written by ${a} on ${d}",
      },
    ]);
  });

  test("the commit that deletes a chip is not left in place; the one after it is", () => {
    const { container, fromIframe, pair } = boot();
    const p = boundBlock(container);
    clickInto(p);
    caretAt(p.childNodes[2]!, 0);
    expect(beforeInput(p, "deleteContentBackward")).toBe(true);
    commitActiveBlock();
    p.firstChild!.nodeValue = "Written by  on ";
    commitActiveBlock();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit")).toEqual([
      {
        children: null,
        kind: "editCommit",
        path: ["children", 0],
        removedTags: ["${a}"],
        textContent: "By  on ${d}",
      },
      {
        children: null,
        inPlace: true,
        kind: "editCommit",
        path: ["children", 0],
        textContent: "Written by  on ${d}",
      },
    ]);
  });

  test("a URL typed over a bound link's is reported like a deleted chip", () => {
    const { container, fromIframe, pair } = boot();
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    // The link carries what its node holds, and no path: the paragraph is the caret's block.
    p.innerHTML =
      `See <a data-jx-href="/RESOLVED" ` +
      `data-jx-keep='{"attributes":{"href":"\${state.url}"}}'>the link</a>`;
    container.append(p);
    const anchor = p.querySelector("a")!;
    clickInto(p);
    selectAcross(anchor.firstChild!, 0, anchor.firstChild!, 3);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    pair.parent.post({ intent: { command: "link", href: "/new" }, kind: "applyFormat" });
    pair.flush();
    stopEditing();
    pair.flush();
    expect(anchor.dataset.jxHref).toBe("/new");
    expect(ofKind(fromIframe, "editCommit").at(-1)).toEqual({
      children: ["See ", { attributes: { href: "/new" }, tagName: "a", textContent: "the link" }],
      kind: "editCommit",
      path: ["children", 0],
      removedTags: ["attributes/href\u0000${state.url}"],
      textContent: null,
    });
  });
});

describe("an inline link is part of its paragraph, not a block beside it", () => {
  /** `See <a>docs</a> now` and a paragraph reading "Tail", both stamped. */
  function linked(container: HTMLElement) {
    const first = document.createElement("p");
    first.dataset.jxPath = '["children",0]';
    first.innerHTML = `See <a data-jx-path='["children",0,"children",1]'>docs</a> now`;
    const second = document.createElement("p");
    second.dataset.jxPath = '["children",1]';
    second.textContent = "Tail";
    container.append(first, second);
    return { anchor: first.querySelector("a")!, first, second };
  }

  test("a selection from after the link into the next paragraph has no block between", () => {
    const { container, fromIframe, pair } = boot();
    const { first, second } = linked(container);
    clickInto(first);
    selectAcross(first.lastChild!, 2, second.firstChild!, 1);
    expect(beforeInput(first, "deleteContentBackward")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editRangeReplace")).toEqual([
      {
        between: [],
        from: { offset: 10, path: ["children", 0] },
        kind: "editRangeReplace",
        text: "",
        to: { offset: 1, path: ["children", 1] },
      },
    ]);
  });

  test("a selection that starts inside the link is counted in the link's paragraph", () => {
    const { container, fromIframe, pair } = boot();
    const { anchor, second } = linked(container);
    clickInto(anchor);
    selectAcross(anchor.firstChild!, 2, second.firstChild!, 1);
    expect(beforeInput(anchor, "deleteContentBackward")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editRangeReplace")).toEqual([
      {
        between: [],
        from: { offset: 6, path: ["children", 0] },
        kind: "editRangeReplace",
        text: "",
        to: { offset: 1, path: ["children", 1] },
      },
    ]);
  });

  test("Backspace at the start of the next paragraph joins it onto the paragraph, not the link", () => {
    const { container, fromIframe, pair } = boot();
    const { second } = linked(container);
    clickInto(second);
    caretInto(second, 0);
    expect(beforeInput(second, "deleteContentBackward")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editMerge")).toEqual([
      { fromPath: ["children", 1], intoPath: ["children", 0], kind: "editMerge" },
    ]);
  });

  test("Backspace at the start of the link's own text joins nothing", () => {
    const { container, fromIframe, pair } = boot();
    const { anchor } = linked(container);
    clickInto(anchor);
    caretInto(anchor, 0);
    expect(beforeInput(anchor, "deleteContentBackward")).toBe(true);
    pair.flush();
    expect(ofKind(fromIframe, "editMerge")).toEqual([]);
  });
});

describe("the parent ending the session", () => {
  const doc = () => ({
    children: [
      { tagName: "p", textContent: "Removed block" },
      { tagName: "p", textContent: "Second plain" },
    ],
    tagName: "div",
  });

  /** A canvas over {@link doc} with the caret in its first paragraph. */
  function caretInFirst() {
    const booted = boot({ getShadowDoc: doc });
    const first = document.createElement("p");
    first.dataset.jxPath = '["children",0]';
    first.textContent = "Removed block";
    booted.container.append(first);
    clickInto(first);
    booted.pair.flush();
    expect(isEditing()).toBe(true);
    booted.fromIframe.length = 0;
    return { ...booted, first };
  }

  test("a block that holds nothing new is released without a commit", () => {
    const { fromIframe, pair } = caretInFirst();
    // Ahead of a whole render: the document may already hold another block at this path.
    pair.parent.post({ kind: "endEdit" });
    pair.flush();
    pair.flush();
    expect(isEditing()).toBe(false);
    expect(fromIframe.map((m) => m.kind)).toEqual(["editEnd"]);
  });

  test("typing the document has not been given is committed on the way out", () => {
    const { first, fromIframe, pair } = caretInFirst();
    first.textContent = "Removed block, edited";
    pair.parent.post({ kind: "endEdit" });
    pair.flush();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit")).toEqual([
      {
        children: null,
        kind: "editCommit",
        path: ["children", 0],
        textContent: "Removed block, edited",
      },
    ]);
    expect(fromIframe.at(-1)).toEqual({ kind: "editEnd" });
  });

  test("with no document to measure against, the session is committed as it always was", () => {
    const { container, fromIframe, pair } = boot();
    const p = document.createElement("p");
    p.dataset.jxPath = '["children",0]';
    p.textContent = "Text";
    container.append(p);
    clickInto(p);
    pair.parent.post({ kind: "endEdit" });
    pair.flush();
    pair.flush();
    expect(ofKind(fromIframe, "editCommit")).toHaveLength(1);
  });
});
