/**
 * The canvas editing host — activation derived from the caret, the `beforeinput` chokepoint, and
 * caret capture/restore in model coordinates.
 *
 * Driven directly through a fake deps bag rather than through the bridge, so each contract is
 * asserted in isolation. What happy-dom CANNOT model is asserted in the browser instead: caret
 * placement from a click point, line-wrap-aware Up/Down, and `getTargetRanges()` (absent here, so
 * the host falls back to the live selection — which is why every test places a caret first).
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import {
  captureDocSelection,
  restoreDocSelection,
  startEditableRoot,
} from "../src/canvas/iframe-editable-root";
import { beforeInput, caretAt, caretInto, selectAcross } from "./harness";
import type { EditableRootDeps, EditableRootHandle } from "../src/canvas/iframe-editable-root";
import type { DocPos, EditablePredicate } from "../src/canvas/iframe-position";

const EDITABLE: EditablePredicate = (el) => ["h2", "li", "p"].includes(el.tagName.toLowerCase());

interface Recorded {
  activated: { tag: string; path: unknown }[];
  deactivated: number;
  selectionChanges: number;
  props: string[];
  splits: number;
  mergeBackward: DocPos[];
  mergeForward: DocPos[];
  replaced: { from: DocPos; to: DocPos; text: string }[];
}

let live: EditableRootHandle | null = null;

/** The `index`th element under `root` matching `selector`; throws rather than handing a test null. */
function nth(root: ParentNode, selector: string, index = 0): HTMLElement {
  const found = root.querySelectorAll(selector)[index];
  if (!(found instanceof HTMLElement)) {
    throw new TypeError(`expected an HTMLElement at ${selector}[${index}]`);
  }
  return found;
}

/** Mount `html` in a container and wire an editing host over it with recording deps. */
function mount(html: string, overrides: Partial<EditableRootDeps> = {}) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  const rec: Recorded = {
    activated: [],
    deactivated: 0,
    mergeBackward: [],
    mergeForward: [],
    props: [],
    replaced: [],
    selectionChanges: 0,
    splits: 0,
  };
  const root = startEditableRoot(container, {
    isEditableBlock: EDITABLE,
    onActivate: (el, path) => rec.activated.push({ path, tag: el.tagName.toLowerCase() }),
    onDeactivate: () => {
      rec.deactivated += 1;
    },
    onSelectionChange: () => {
      rec.selectionChanges += 1;
    },
    ...overrides,
  });
  live = root;
  return { container, rec, root };
}

afterEach(() => {
  live?.stop();
  live = null;
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

const TWO_BLOCKS = `<p data-jx-path='["children",0]'>First block</p><p data-jx-path='["children",1]'>Second</p>`;

describe("activation follows the caret", () => {
  test("a caret landing in a block activates it — there is no gesture to recognise", () => {
    const { container, rec } = mount(TWO_BLOCKS);
    caretInto(nth(container, "p"), 3);
    expect(rec.activated).toEqual([{ path: ["children", 0], tag: "p" }]);
    expect(rec.deactivated).toBe(0);
  });

  test("moving within the block reports a selection change, not a re-activation", () => {
    const { container, rec } = mount(TWO_BLOCKS);
    const p = nth(container, "p");
    caretInto(p, 1);
    const before = rec.selectionChanges;
    caretInto(p, 5);
    expect(rec.activated).toHaveLength(1);
    expect(rec.deactivated).toBe(0);
    expect(rec.selectionChanges).toBeGreaterThan(before);
  });

  test("moving to another block releases the first BEFORE activating the second", () => {
    // Order is the contract: releasing is what commits, so it has to happen while the old block is
    // Still the active one.
    const order: string[] = [];
    const { container } = mount(TWO_BLOCKS, {
      onActivate: (_el, path) => order.push(`activate:${JSON.stringify(path)}`),
      onDeactivate: () => order.push("deactivate"),
    });
    const [first, second] = [...container.querySelectorAll("p")];
    caretInto(first!, 2);
    caretInto(second!, 2);
    expect(order).toEqual(['activate:["children",0]', "deactivate", 'activate:["children",1]']);
  });

  test("a caret in canvas chrome releases the active block", () => {
    const { container, rec } = mount(`${TWO_BLOCKS}<div>chrome</div>`);
    caretInto(nth(container, "p"), 1);
    caretInto(nth(container, "div"));
    expect(rec.deactivated).toBe(1);
  });

  test("a caret outside the container releases the active block", () => {
    const { container, rec } = mount(TWO_BLOCKS);
    caretInto(nth(container, "p"), 1);
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    caretInto(outside, 2);
    expect(rec.deactivated).toBe(1);
  });

  test("an ABSENT selection is transient and does NOT release the block", () => {
    // A re-render, a removeAllRanges, or the window losing focus all momentarily empty the
    // Selection. Committing and dropping the block there would lose the caret mid-typing.
    const { container, rec } = mount(TWO_BLOCKS);
    caretInto(nth(container, "p"), 1);
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(rec.deactivated).toBe(0);
  });

  test("no caret exists outside design/edit modes", () => {
    const { container, rec } = mount(TWO_BLOCKS, { getMode: () => "preview" });
    caretInto(nth(container, "p"), 1);
    expect(rec.activated).toHaveLength(0);
  });

  test("leaving edit mode with a live block releases it", () => {
    let mode = "edit";
    const { container, rec } = mount(TWO_BLOCKS, { getMode: () => mode });
    caretInto(nth(container, "p"), 1);
    mode = "preview";
    document.dispatchEvent(new Event("selectionchange"));
    expect(rec.deactivated).toBe(1);
  });

  test("stop() releases the active block", () => {
    const { container, rec, root } = mount(TWO_BLOCKS);
    caretInto(nth(container, "p"), 1);
    root.stop();
    live = null;
    expect(rec.deactivated).toBe(1);
  });
});

describe("pressing on uneditable content", () => {
  // The browser leaves the selection alone when the press lands where no caret can go, so the caret
  // Went on blinking in the block clicked before while the component was the selected node.
  const WITH_ISLAND = `<p data-jx-path='["children",0]'>Page</p><x-card data-jx-path='["children",1]' contenteditable="false"><span>Internals</span><p data-jx-path='["children",1,"children",0]' contenteditable="true">Slot</p></x-card>`;

  test("a press inside a component island drops the stale caret", () => {
    const { container } = mount(WITH_ISLAND);
    caretInto(nth(container, "p"), 2);
    nth(container, "span").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  test("a press on slotted page content inside the island keeps the caret", () => {
    const { container } = mount(WITH_ISLAND, { onPropActivate: () => true });
    caretInto(nth(container, "p"), 2);
    nth(container, "p", 1).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  test("a press on an ordinary block keeps the caret", () => {
    const { container } = mount(WITH_ISLAND);
    caretInto(nth(container, "p"), 2);
    nth(container, "p").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  test("outside the editing modes the press leaves the selection alone", () => {
    const { container } = mount(WITH_ISLAND, { getMode: () => "preview" });
    caretInto(nth(container, "p"), 2);
    nth(container, "span").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(1);
  });
});

describe("a secondary press", () => {
  // A right-button press placed the caret, the caret activated the block, and the menu waited
  // Behind the edit start it caused, with the block left in edit mode after the menu closed.
  const WITH_PROP = `<p data-jx-path='["children",0]'>One</p><p data-jx-path='["children",1]'>Two</p><x-card data-jx-path='["children",2]' contenteditable="false"><span data-jx-bound-prop="title">Card</span></x-card>`;

  /** Press `el` with `button`; true when a listener cancelled the press's default. */
  function press(el: Element, button: number): boolean {
    return !el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button, cancelable: true }),
    );
  }

  test("on a block that is not being edited, it keeps the caret out of it", () => {
    const { container, rec } = mount(WITH_PROP);
    expect(press(nth(container, "p", 1), 2)).toBe(true);
    expect(rec.activated).toHaveLength(0);
  });

  test("inside the block being edited, it keeps its native press", () => {
    const { container, rec } = mount(WITH_PROP);
    caretInto(nth(container, "p"), 1);
    expect(press(nth(container, "p"), 2)).toBe(false);
    expect(rec.deactivated).toBe(0);
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  test("outside the block being edited, it leaves that block and drops the caret", () => {
    const { container, rec } = mount(WITH_PROP);
    caretInto(nth(container, "p"), 1);
    expect(press(nth(container, "p", 1), 2)).toBe(true);
    expect(rec.deactivated).toBe(1);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  test("a primary press is left to the browser", () => {
    const { container } = mount(WITH_PROP);
    expect(press(nth(container, "p", 1), 0)).toBe(false);
  });

  test("outside the editing modes it is left to the browser", () => {
    const { container } = mount(WITH_PROP, { getMode: () => "preview" });
    expect(press(nth(container, "p", 1), 2)).toBe(false);
  });

  test("on a prop marker, it does not open the nested host", () => {
    const { container, rec } = mount(WITH_PROP, {
      onPropActivate: (el) => {
        rec.props.push(el.dataset.jxBoundProp!);
        return true;
      },
    });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    expect(rec.props).toEqual([]);
  });

  test("stop() removes it", () => {
    const { container, root } = mount(WITH_PROP);
    root.stop();
    live = null;
    expect(press(nth(container, "p", 1), 2)).toBe(false);
  });
});

describe("entry-field nested hosts", () => {
  // A collection page's locked header around an entry: the title is one whole field of the entry.
  const WITH_FIELD = `<p data-jx-path='["children",0]'>Body</p><header contenteditable="false"><h1 data-jx-entry-field="title" contenteditable="false"><em>Spring</em> planting</h1><p>Sep 30 · Garden</p></header>`;

  test("a press on the field, or inside it, asks the bridge to open a nested host", () => {
    const fields: string[] = [];
    const { container } = mount(WITH_FIELD, {
      onFieldActivate: (el) => {
        fields.push(el.dataset.jxEntryField!);
        return true;
      },
    });
    nth(container, "em").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(fields).toEqual(["title"]);
    // The same host pressed again is already the active one: it is not opened twice.
    nth(container, "h1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(fields).toEqual(["title"]);
  });

  test("typing in an adopted field host is not prevented, and its first caret keeps it", () => {
    const { container, rec } = mount(WITH_FIELD, { onFieldActivate: () => true });
    const field = nth(container, "h1");
    field.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(field, 1);
    expect(rec.deactivated).toBe(0);
    expect(beforeInput(field, "insertText", "x")).toBe(false);
  });

  test("a refused field is not adopted, and a press elsewhere in the page never reaches it", () => {
    const fields: string[] = [];
    const { container, rec } = mount(WITH_FIELD, {
      onFieldActivate: (el) => {
        fields.push(el.dataset.jxEntryField!);
        return false;
      },
    });
    nth(container, "h1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(nth(container, "h1"), 1);
    expect(rec.activated).toHaveLength(0);
    nth(container, "header p").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(fields).toEqual(["title"]);
  });

  test("a press anywhere outside an open field ends it, locked chrome included", () => {
    const { container, rec } = mount(WITH_FIELD, { onFieldActivate: () => true });
    nth(container, "h1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    // A press on the locked line beside the title places no caret, but the title still closes.
    nth(container, "header p").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(rec.deactivated).toBe(1);
    // A press inside the open field does not.
    nth(container, "h1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    nth(container, "em").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(rec.deactivated).toBe(1);
  });

  test("without a field bridge the press is an ordinary press on locked text", () => {
    const { container } = mount(WITH_FIELD);
    caretInto(nth(container, "p"), 1);
    nth(container, "h1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});

describe("prop-bound nested hosts", () => {
  const WITH_PROP = `<p data-jx-path='["children",0]'>Page</p><x-card data-jx-path='["children",1]' contenteditable="false"><span data-jx-bound-prop="title">Card</span></x-card>`;

  test("a pointerdown on a marker asks the bridge to open a nested host", () => {
    const { container, rec } = mount(WITH_PROP, {
      onPropActivate: (el) => {
        rec.props.push(el.dataset.jxBoundProp!);
        return true;
      },
    });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(rec.props).toEqual(["title"]);
  });

  test("an adopted nested host is NOT torn down by its own first selectionchange", () => {
    // The marker has no `data-jx-path`, so a naive block lookup would find nothing and deactivate
    // The host the instant the caret arrived in it.
    const { container, rec } = mount(WITH_PROP, { onPropActivate: () => true });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(marker, 2);
    expect(rec.deactivated).toBe(0);
  });

  test("a REFUSED marker is not adopted, so the caret does not linger in it", () => {
    const { container, rec } = mount(WITH_PROP, { onPropActivate: () => false });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(marker, 2);
    expect(rec.activated).toHaveLength(0);
  });

  test("a pointerdown on ordinary page DOM never reaches the prop path", () => {
    const { container, rec } = mount(WITH_PROP, {
      onPropActivate: (el) => {
        rec.props.push(el.dataset.jxBoundProp!);
        return true;
      },
    });
    nth(container, "p").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(rec.props).toEqual([]);
  });

  /*
   * The wiring, dispatched for real rather than reasoned about.
   *
   * `inPropHost` is computed in this module (`activeEl !== null && activeKey === null`) and only
   * consumed by the pure classifier, so a classifier test alone cannot tell the flag apart from a
   * hardcoded `false` — which is exactly what it effectively WAS: a prop host has no path, so the
   * unresolvable-position rule rejected every keystroke and typing into a component slot did
   * nothing while showing a caret. These dispatch `beforeinput` at the marker.
   */
  test("typing in an adopted prop host is NOT prevented", () => {
    const { container } = mount(WITH_PROP, { onPropActivate: () => true });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(beforeInput(marker, "insertText", "x")).toBe(false);
  });

  test("a paragraph split in a prop host IS prevented — one plain string", () => {
    const { container } = mount(WITH_PROP, { onPropActivate: () => true });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(beforeInput(marker, "insertParagraph")).toBe(true);
  });

  test("without adoption the same keystroke is still refused", () => {
    /* The other half of the flag. A REFUSED marker is not a prop host, so the position stays
       unresolvable and the keystroke must not slip through — this is what proves the guard is the
       adoption state and not merely "the target has data-jx-bound-prop". */
    const { container } = mount(WITH_PROP, { onPropActivate: () => false });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(beforeInput(marker, "insertText", "x")).toBe(true);
  });

  test("after leaving for a page block, the prop exemption is gone", () => {
    // The flag must not outlive the session: once a real block is active, `activeKey` is set again
    // And the chokepoint judges by position as usual.
    const { container } = mount(WITH_PROP, { onPropActivate: () => true });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(nth(container, "p"), 1);
    expect(beforeInput(marker, "insertParagraph")).toBe(true);
  });

  test("leaving the nested host for a page block releases it", () => {
    const { container, rec } = mount(WITH_PROP, { onPropActivate: () => true });
    const marker = nth(container, "[data-jx-bound-prop]");
    marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    caretInto(nth(container, "p"), 1);
    expect(rec.deactivated).toBe(1);
    expect(rec.activated).toEqual([{ path: ["children", 0], tag: "p" }]);
  });
});

describe("the beforeinput chokepoint", () => {
  test("ordinary typing runs natively", () => {
    const { container } = mount(TWO_BLOCKS);
    const p = nth(container, "p");
    caretInto(p, 3);
    expect(beforeInput(p, "insertText", "x")).toBe(false);
  });

  test("Enter is prevented and routed to the split handler", () => {
    const { container, rec } = mount(TWO_BLOCKS, {
      onSplit: () => {
        rec.splits += 1;
        return true;
      },
    });
    const p = nth(container, "p");
    caretInto(p, 3);
    expect(beforeInput(p, "insertParagraph")).toBe(true);
    expect(rec.splits).toBe(1);
  });

  test("Backspace at a block start routes to the merge handler with the position", () => {
    const { container, rec } = mount(TWO_BLOCKS, {
      onMergeBackward: (at) => {
        rec.mergeBackward.push(at);
        return true;
      },
    });
    const second = nth(container, "p", 1);
    caretInto(second, 0);
    expect(beforeInput(second, "deleteContentBackward")).toBe(true);
    expect(rec.mergeBackward).toEqual([{ offset: 0, path: ["children", 1] }]);
  });

  test("Delete at a block end routes to the forward-merge handler", () => {
    const { container, rec } = mount(TWO_BLOCKS, {
      onMergeForward: (at) => {
        rec.mergeForward.push(at);
        return true;
      },
    });
    const p = nth(container, "p");
    caretInto(p, "First block".length);
    expect(beforeInput(p, "deleteContentForward")).toBe(true);
    expect(rec.mergeForward).toHaveLength(1);
  });

  test("a cross-block deletion routes to the range handler", () => {
    const { container, rec } = mount(TWO_BLOCKS, {
      onReplaceRange: (from, to, text) => {
        rec.replaced.push({ from, text, to });
        return true;
      },
    });
    const [first, second] = [...container.querySelectorAll("p")];
    selectAcross(first!.firstChild!, 2, second!.firstChild!, 3);
    expect(beforeInput(first!, "deleteContentBackward")).toBe(true);
    expect(rec.replaced).toEqual([
      {
        from: { offset: 2, path: ["children", 0] },
        text: "",
        to: { offset: 3, path: ["children", 1] },
      },
    ]);
  });

  test("an ABSENT handler suppresses the action instead of letting the browser restructure", () => {
    // The load-bearing default: an unimplemented merge must leave the document untouched, never
    // Silently let contenteditable join two blocks behind the model's back.
    const { container, rec } = mount(TWO_BLOCKS); // No structural handlers wired.
    const second = nth(container, "p", 1);
    caretInto(second, 0);
    expect(beforeInput(second, "deleteContentBackward")).toBe(true);
    expect(rec.mergeBackward).toHaveLength(0);
  });

  test("a cross-block Enter is suppressed when there is no range handler to delete with", () => {
    const { container, rec } = mount(TWO_BLOCKS, {
      onSplit: () => {
        rec.splits += 1;
        return true;
      },
    });
    const [first, second] = [...container.querySelectorAll("p")];
    selectAcross(first!.firstChild!, 2, second!.firstChild!, 3);
    expect(beforeInput(first!, "insertParagraph")).toBe(true);
    expect(rec.splits).toBe(0);
  });

  test("native formatting and history are refused", () => {
    const { container } = mount(TWO_BLOCKS);
    const p = nth(container, "p");
    caretInto(p, 3);
    expect(beforeInput(p, "formatBold")).toBe(true);
    expect(beforeInput(p, "historyUndo")).toBe(true);
  });

  test("input with no resolvable position is refused", () => {
    const { container } = mount(`${TWO_BLOCKS}<div>chrome</div>`);
    const chrome = nth(container, "div");
    caretInto(chrome);
    expect(beforeInput(chrome, "insertText", "x")).toBe(true);
  });

  test("beforeinput is inert outside design/edit modes", () => {
    const { container } = mount(TWO_BLOCKS, { getMode: () => "preview" });
    const p = nth(container, "p");
    expect(beforeInput(p, "insertParagraph")).toBe(false);
  });
});

describe("drag suppression", () => {
  test("a dragstart inside the canvas is cancelled — reordering is the bar's handle", () => {
    const { container } = mount(TWO_BLOCKS);
    const p = nth(container, "p");
    const e = new Event("dragstart", { bubbles: true, cancelable: true });
    p.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("the idle commit tick", () => {
  test("typing arms a tick that commits after the idle delay, without releasing the block", () => {
    let ticks = 0;
    const { container, rec } = mount(TWO_BLOCKS, {
      commitDelayMs: 5,
      onCommitTick: () => {
        ticks += 1;
      },
    });
    const p = nth(container, "p");
    caretInto(p, 3);
    p.dispatchEvent(new Event("input", { bubbles: true }));

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(ticks).toBe(1);
        // The point of an IN-PLACE commit: the block stays active and the caret stays put.
        expect(rec.deactivated).toBe(0);
        resolve();
      }, 30);
    });
  });

  test("continuous typing pushes the tick out — one commit per burst, not per keystroke", async () => {
    let ticks = 0;
    const { container } = mount(TWO_BLOCKS, {
      commitDelayMs: 20,
      onCommitTick: () => {
        ticks += 1;
      },
    });
    const p = nth(container, "p");
    caretInto(p, 1);
    for (let i = 0; i < 4; i++) {
      p.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise<void>((r) => {
        setTimeout(r, 8);
      });
    }
    expect(ticks).toBe(0); // Still typing.
    await new Promise<void>((r) => {
      setTimeout(r, 40);
    });
    expect(ticks).toBe(1); // One commit for the whole burst.
  });

  test("the tick preserves the caret across the commit's DOM normalization", async () => {
    // Committing normalizes inline content, rewriting the very text nodes the caret sits in. The
    // Host captures the caret in document coordinates and restores it, so a pause while typing
    // Never moves the cursor.
    const { container } = mount(TWO_BLOCKS, {
      commitDelayMs: 5,
      onCommitTick: () => {
        const p = nth(container, "p");
        p.replaceChildren(document.createTextNode("First block"));
      },
    });
    const p = nth(container, "p");
    caretInto(p, 6);
    p.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise<void>((r) => {
      setTimeout(r, 30);
    });

    expect(live!.capture()).toEqual({
      anchor: { offset: 6, path: ["children", 0] },
      head: { offset: 6, path: ["children", 0] },
    });
  });

  test("leaving the block cancels the pending tick — the release commits instead", async () => {
    let ticks = 0;
    const { container, rec } = mount(TWO_BLOCKS, {
      commitDelayMs: 20,
      onCommitTick: () => {
        ticks += 1;
      },
    });
    const [first, second] = [...container.querySelectorAll("p")];
    caretInto(first!, 2);
    first!.dispatchEvent(new Event("input", { bubbles: true }));
    caretInto(second!, 2);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    expect(ticks).toBe(0);
    expect(rec.deactivated).toBe(1);
  });

  test("flush() commits immediately and disarms the tick", async () => {
    let ticks = 0;
    const { container } = mount(TWO_BLOCKS, {
      commitDelayMs: 1000,
      onCommitTick: () => {
        ticks += 1;
      },
    });
    const p = nth(container, "p");
    caretInto(p, 3);
    p.dispatchEvent(new Event("input", { bubbles: true }));

    live!.flush();
    expect(ticks).toBe(1);
    await new Promise<void>((r) => {
      setTimeout(r, 30);
    });
    expect(ticks).toBe(1); // Not fired twice.
  });

  test("flush() with nothing pending is a no-op", () => {
    let ticks = 0;
    const { container } = mount(TWO_BLOCKS, {
      onCommitTick: () => {
        ticks += 1;
      },
    });
    caretInto(nth(container, "p"), 1);
    live!.flush();
    expect(ticks).toBe(0);
  });

  test("teardown cancels a pending tick rather than firing it against a dead host", async () => {
    let ticks = 0;
    const { container, root } = mount(TWO_BLOCKS, {
      commitDelayMs: 10,
      onCommitTick: () => {
        ticks += 1;
      },
    });
    const p = nth(container, "p");
    caretInto(p, 1);
    p.dispatchEvent(new Event("input", { bubbles: true }));
    root.stop();
    live = null;
    await new Promise<void>((r) => {
      setTimeout(r, 40);
    });
    expect(ticks).toBe(0);
  });
});

describe("caret capture and restore", () => {
  test("captureDocSelection returns both endpoints in document coordinates", () => {
    const { container } = mount(TWO_BLOCKS);
    const [first, second] = [...container.querySelectorAll("p")];
    selectAcross(first!.firstChild!, 2, second!.firstChild!, 4);
    expect(captureDocSelection(container, EDITABLE)).toEqual({
      anchor: { offset: 2, path: ["children", 0] },
      head: { offset: 4, path: ["children", 1] },
    });
  });

  test("captureDocSelection returns null with no selection, or one outside the canvas", () => {
    const { container } = mount(TWO_BLOCKS);
    window.getSelection()!.removeAllRanges();
    expect(captureDocSelection(container, EDITABLE)).toBeNull();

    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    caretInto(outside, 1);
    expect(captureDocSelection(container, EDITABLE)).toBeNull();
  });

  test("captureDocSelection returns null when an endpoint is not in an editable block", () => {
    const { container } = mount(`${TWO_BLOCKS}<div>chrome</div>`);
    caretInto(nth(container, "div"));
    expect(captureDocSelection(container, EDITABLE)).toBeNull();
  });

  test("a captured selection round-trips through restore", () => {
    const { container } = mount(TWO_BLOCKS);
    const [first, second] = [...container.querySelectorAll("p")];
    selectAcross(first!.firstChild!, 2, second!.firstChild!, 4);
    const captured = captureDocSelection(container, EDITABLE)!;

    window.getSelection()!.removeAllRanges();
    expect(restoreDocSelection(container, captured)).toBe(true);
    expect(captureDocSelection(container, EDITABLE)).toEqual(captured);
  });

  test("restore fails when the anchor's block no longer renders", () => {
    const { container } = mount(TWO_BLOCKS);
    const gone = { anchor: { offset: 0, path: ["children", 9] }, head: { offset: 0, path: [] } };
    expect(restoreDocSelection(container, gone)).toBe(false);
  });

  test("placeCaret puts the caret in a block and activates it in the same call", () => {
    // Synchronous activation matters: `selectionchange` is dispatched as a task, so a caller that
    // Needs the block live before it returns (the parent's post-split enterEdit) cannot wait for it.
    const { container, rec } = mount(TWO_BLOCKS);
    expect(container).toBeTruthy();
    expect(live!.placeCaret({ offset: 3, path: ["children", 1] })).toBe(true);
    expect(rec.activated).toEqual([{ path: ["children", 1], tag: "p" }]);
  });

  test("placeCaret reports false for a path that is not rendered", () => {
    mount(TWO_BLOCKS);
    expect(live!.placeCaret({ offset: 0, path: ["children", 42] })).toBe(false);
  });

  test("the handle's capture/restore pair survives a re-render of the block's DOM", () => {
    const { container, rec } = mount(TWO_BLOCKS);
    const first = nth(container, "p");
    caretInto(first, 5);
    const captured = live!.capture();
    expect(captured).toEqual({
      anchor: { offset: 5, path: ["children", 0] },
      head: { offset: 5, path: ["children", 0] },
    });

    // The patcher replaces the block's inner DOM, destroying the original text node.
    first.replaceChildren(document.createTextNode("First block"));
    expect(live!.restore(captured!)).toBe(true);
    expect(live!.capture()).toEqual(captured);
    expect(rec.deactivated).toBe(0);
  });

  test("sync() re-derives the active block after a programmatic selection move", () => {
    const { container, rec } = mount(TWO_BLOCKS);
    const second = nth(container, "p", 1);
    // Move the selection WITHOUT dispatching the event the browser would.
    caretAt(second.firstChild!, 2);
    rec.activated.length = 0;
    live!.sync();
    expect(rec.activated).toHaveLength(0); // Already active from the caretAt dispatch.
    expect(rec.deactivated).toBe(0);
  });
});

// ─── Chips are atomic (studio.md §4.5) ───────────────────────────────────────────────────────

describe("a chip is atomic to the arrow keys, Backspace and Delete", () => {
  /** `By ` + a chip + ` on ` + a chip that ends the block. */
  const BOUND =
    `<p data-jx-path='["children",0]'>By <data data-jx-tag="\${a}" contenteditable="false">Ada</data>` +
    ` on <data data-jx-tag="\${d}" contenteditable="false">March</data></p>` +
    `<p data-jx-path='["children",1]'>Second</p>`;

  /** Press `key` in the container; whether the host claimed it. */
  function press(container: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
    container.dispatchEvent(event);
    return event.defaultPrevented;
  }

  /** Where the caret is: its node's own text, or its tag, and the offset. */
  function caret(): [string, number] {
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const name = node instanceof Element ? node.tagName.toLowerCase() : (node?.nodeValue ?? "");
    return [name, sel?.anchorOffset ?? -1];
  }

  test("Right at the text before a chip lands in the text after it; Left comes back", () => {
    const { container } = mount(BOUND);
    const p = nth(container, "p");
    caretAt(p.firstChild!, 3);
    expect(press(container, "ArrowRight")).toBe(true);
    expect(caret()).toEqual([" on ", 0]);
    expect(press(container, "ArrowLeft")).toBe(true);
    expect(caret()).toEqual(["By ", 3]);
  });

  test("at a chip that ends its block the caret stands at the chip's own place", () => {
    const { container } = mount(BOUND);
    const p = nth(container, "p");
    caretAt(p.childNodes[2]!, 4);
    expect(press(container, "ArrowRight")).toBe(true);
    expect(caret()).toEqual(["p", 4]);
    expect(press(container, "ArrowLeft")).toBe(true);
    expect(caret()).toEqual([" on ", 4]);
  });

  test("an arrow with no chip beside the caret, or with a modifier, is the browser's", () => {
    const { container } = mount(BOUND);
    const p = nth(container, "p");
    caretAt(p.firstChild!, 1);
    expect(press(container, "ArrowRight")).toBe(false);
    caretAt(p.firstChild!, 3);
    expect(press(container, "ArrowRight", { shiftKey: true })).toBe(false);
    expect(press(container, "ArrowRight", { altKey: true })).toBe(false);
    expect(press(container, "ArrowDown")).toBe(false);
    expect(press(container, "a")).toBe(false);
    // A selection is not a caret, and neither is a caret outside any block.
    selectAcross(p.firstChild!, 1, p.firstChild!, 3);
    expect(press(container, "ArrowRight")).toBe(false);
    window.getSelection()?.removeAllRanges();
    expect(press(container, "ArrowRight")).toBe(false);
  });

  test("in a right-to-left block Left is forward", () => {
    const { container } = mount(BOUND);
    const p = nth(container, "p");
    p.style.direction = "rtl";
    caretAt(p.firstChild!, 3);
    expect(press(container, "ArrowRight")).toBe(false);
    expect(press(container, "ArrowLeft")).toBe(true);
    expect(caret()).toEqual([" on ", 0]);
  });

  test("the arrows are inert outside design/edit modes", () => {
    const { container } = mount(BOUND, { getMode: () => "preview" });
    caretAt(nth(container, "p").firstChild!, 3);
    expect(press(container, "ArrowRight")).toBe(false);
  });

  test("Backspace after a chip takes the chip whole and reports it", () => {
    const removed: string[][] = [];
    const inputs: string[] = [];
    const { container } = mount(BOUND, { onTagsRemoved: (sources) => removed.push(sources) });
    container.addEventListener("input", (e) =>
      inputs.push(e instanceof InputEvent ? e.inputType : ""),
    );
    const p = nth(container, "p");
    caretAt(p.childNodes[2]!, 0);
    expect(beforeInput(p, "deleteContentBackward")).toBe(true);
    expect(p.textContent).toBe("By  on March");
    expect(removed).toEqual([["${a}"]]);
    // The edit landed without the engine, so the input it would have fired is fired for it.
    expect(inputs).toEqual(["deleteContentBackward"]);
    expect(caret()).toEqual(["p", 1]);
  });

  test("Delete before a chip takes it too, and it is not a merge at the block's end", () => {
    const removed: string[][] = [];
    const merges: DocPos[] = [];
    const { container } = mount(BOUND, {
      onMergeForward: (at) => {
        merges.push(at);
        return true;
      },
      onTagsRemoved: (sources) => removed.push(sources),
    });
    const p = nth(container, "p");
    caretAt(p.childNodes[2]!, 4);
    expect(beforeInput(p, "deleteContentForward")).toBe(true);
    expect(p.textContent).toBe("By Ada on ");
    expect(removed).toEqual([["${d}"]]);
    expect(merges).toEqual([]);
  });

  test("a deletion with text beside the caret is the browser's, and reports nothing", () => {
    const removed: string[][] = [];
    const { container } = mount(BOUND, { onTagsRemoved: (sources) => removed.push(sources) });
    const p = nth(container, "p");
    caretAt(p.firstChild!, 2);
    expect(beforeInput(p, "deleteContentBackward")).toBe(false);
    container.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(removed).toEqual([]);
  });

  test("a chip an input removed is reported when the input lands: a cut, or typing over it", () => {
    const removed: string[][] = [];
    const { container } = mount(BOUND, { onTagsRemoved: (sources) => removed.push(sources) });
    const p = nth(container, "p");
    caretAt(p.firstChild!, 0);
    selectAcross(p.firstChild!, 0, p.childNodes[2]!, 2);
    // The engine applies a single-block cut itself; what it took is seen when its input lands.
    expect(beforeInput(p, "deleteByCut")).toBe(false);
    p.querySelector("data")?.remove();
    container.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteByCut" }));
    expect(removed).toEqual([["${a}"]]);
    // An input with no beforeinput ahead of it has nothing to compare against.
    p.querySelector("data")?.remove();
    container.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(removed).toHaveLength(1);
  });

  test("an input the chokepoint takes over compares nothing", () => {
    const removed: string[][] = [];
    const { container } = mount(BOUND, {
      onSplit: () => true,
      onTagsRemoved: (sources) => removed.push(sources),
    });
    const p = nth(container, "p");
    caretAt(p.firstChild!, 1);
    expect(beforeInput(p, "insertParagraph")).toBe(true);
    p.querySelector("data")?.remove();
    container.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(removed).toEqual([]);
  });
});

// ─── A selection never rests inside a chip, and a redrawn block is a new block ───────────────

describe("a press on a chip puts the caret at the chip's edge", () => {
  /** A heading that is one chip and nothing else, then a block closed to the caret holding one. */
  const HEADING =
    `<h2 data-jx-path='["children",0]'><data data-jx-tag="\${t}" contenteditable="false">Title</data></h2>` +
    `<p data-jx-path='["children",1]'>Second</p>` +
    `<section data-jx-path='["children",2]' contenteditable="false">` +
    `<data data-jx-tag="\${c}" contenteditable="false">Closed</data></section>`;

  /** The selection as `[anchor, anchorOffset, focus, focusOffset]`, nodes named by tag or text. */
  function selection(): (string | number)[] {
    const sel = window.getSelection();
    const name = (node: Node | null): string =>
      node instanceof Element ? node.tagName.toLowerCase() : (node?.nodeValue ?? "");
    return [
      name(sel?.anchorNode ?? null),
      sel?.anchorOffset ?? -1,
      name(sel?.focusNode ?? null),
      sel?.focusOffset ?? -1,
    ];
  }

  test("a caret the engine left in the chip's text moves to the nearer edge and opens the block", () => {
    const { container, rec } = mount(HEADING);
    const h2 = nth(container, "h2");
    const text = nth(container, "data").firstChild!;
    // The first half of the text: before the chip.
    caretAt(text, 1);
    expect(selection()).toEqual(["h2", 0, "h2", 0]);
    expect(rec.activated).toEqual([{ path: ["children", 0], tag: "h2" }]);
    // The second half: after it. Same block, so nothing is re-activated.
    caretAt(text, 4);
    expect(selection()).toEqual(["h2", 1, "h2", 1]);
    expect(rec.activated).toHaveLength(1);
    expect(h2.contains(window.getSelection()?.focusNode ?? null)).toBe(true);
  });

  test("a selection that reaches into a chip covers it whole, in the direction it was made", () => {
    const { container } = mount(HEADING);
    const text = nth(container, "data").firstChild!;
    selectAcross(text, 1, text, 3);
    expect(selection()).toEqual(["h2", 0, "h2", 1]);
    selectAcross(text, 3, text, 1);
    expect(selection()).toEqual(["h2", 1, "h2", 0]);
    // From the next block back into the chip: the focus goes to the chip's start.
    const second = nth(container, "p").firstChild!;
    selectAcross(second, 2, text, 3);
    expect(selection()).toEqual(["Second", 2, "h2", 0]);
  });

  test("the press itself does not drop the selection, as one on closed content does", () => {
    const { container } = mount(HEADING);
    caretAt(nth(container, "p").firstChild!, 1);
    nth(container, "h2 data").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(1);
    // A chip in a block that is closed to the caret is that block's: the selection is dropped.
    nth(container, "section data").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  test("a caret inside a chip of a closed block is left where it is", () => {
    const { container, rec } = mount(HEADING);
    const text = nth(container, "section data").firstChild!;
    caretAt(text, 2);
    expect(selection()).toEqual(["Closed", 2, "Closed", 2]);
    expect(rec.activated).toEqual([]);
  });
});

describe("a block redrawn under the caret is a new block", () => {
  test("the same path on a new element is activated again, the old one released", () => {
    const { container, rec } = mount(`<p data-jx-path='["children",0]'>First</p>`);
    const old = nth(container, "p");
    caretInto(old, 2);
    expect(rec.activated).toHaveLength(1);
    // A patch redraws the block: a new element at the same path (an undo over bound text).
    const next = document.createElement("p");
    next.dataset.jxPath = '["children",0]';
    next.textContent = "First";
    old.replaceWith(next);
    caretInto(next, 2);
    expect(rec.deactivated).toBe(1);
    expect(rec.activated).toEqual([
      { path: ["children", 0], tag: "p" },
      { path: ["children", 0], tag: "p" },
    ]);
    // And a move within the new element is only a selection change.
    caretInto(next, 3);
    expect(rec.activated).toHaveLength(2);
  });
});
