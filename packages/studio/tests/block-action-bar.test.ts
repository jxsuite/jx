/**
 * Tests for the block action bar — the floating toolbar above the selected element.
 *
 * The bar is a Jx document (`src/surfaces/block-action-bar.json`) mounted over the kit by
 * `src/surfaces/block-action-bar.ts`, and `src/panels/block-action-bar.ts` is the flow that decides
 * what it says. So every assertion here addresses a ROLE, a PART or a command id — never a class,
 * and never a Spectrum tag: `[part="bar"]`, `[part="tag"]`, `[data-command-id="selection.moveUp"]`.
 * A kit button's `disabled` lives on its own `[part="control"]`, which is also the node a press is
 * dispatched at, so both go through the helpers below.
 *
 * The bar drives its format state + position across the iframe bridge: selection structure
 * (badge/parent/move/convert/drag) comes from the doc + a mocked `getEditBarAnchorRect`,
 * pressed-state from a mocked `getEditSnapshot`, and format/link/merge-tag clicks post intents via
 * a mocked `postApplyFormat`. The parent never reads the iframe DOM. `../src/canvas/iframe-host` is
 * mocked so the three bridge functions are controllable per test.
 *
 * A mounted document reconciles in a microtask, so `render()` awaits and every test is async.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getConvertTargets } from "../src/editor/convert-targets";
import { dismissSlashMenu, isSlashMenuOpen } from "../src/editor/slash-menu";
import { componentRegistry } from "../src/files/components";
import { initLayers } from "../src/ui/layers";
import { setTransactGate } from "../src/tabs/transact";
import { view } from "../src/view";
import { activeTab } from "../src/workspace/workspace";

import type { JxPath } from "../src/state";
import type { JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";
import type { ApplyFormatIntent, SelectionSnapshot } from "../src/canvas/iframe-protocol";

// ─── DnD adapter mock (must precede the module-under-test import) ────────────

interface DragRegistration {
  element: HTMLElement;
  getInitialData: () => unknown;
  /** Asked at the PRESS: whether this selection may be dragged at all. */
  canDrag: () => boolean;
}

const dnd: { draggables: DragRegistration[] } = { draggables: [] };

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (opts: DragRegistration) => {
    dnd.draggables.push(opts);
    return () => {};
  },
}));

// ─── iframe-host bridge mock — controllable edit snapshot / anchor / applyFormat ─────

interface HostMock {
  editing: boolean;
  editingProp: string | null;
  snapshot: SelectionSnapshot | null;
  anchor: { left: number; top: number; width: number; height: number } | null;
  posted: ApplyFormatIntent[];
}
const host: HostMock = {
  anchor: null,
  editing: false,
  editingProp: null,
  posted: [],
  snapshot: null,
};

void mock.module("../src/canvas/iframe-host", () => ({
  getEditBarAnchorRect: () => host.anchor,
  getEditSnapshot: () => ({
    editing: host.editing,
    editingProp: host.editingProp,
    snapshot: host.snapshot,
  }),
  postApplyFormat: (intent: ApplyFormatIntent) => host.posted.push(intent),
  // Live-preview seam (transitively imported via the panels) — no iframe in this suite.
  requestCanvasEval: () => Promise.resolve(null),
}));

const {
  BLOCKBAR_MAX_ITEMS,
  dismissBlockActionBar,
  dismissLinkPopover,
  formatCommands,
  initBlockActionBar,
  isEditChromeTarget,
  isLinkPopoverOpen,
  onCanvasScroll,
  releaseBlockActionBar,
  renderBlockActionBar,
  selectionCommandRegistry,
  suppressBlockActionBar,
} = await import("../src/panels/block-action-bar");
const { makeContext } = await import("../src/commands/context");

// ─── Layer hosts ─────────────────────────────────────────────────────────────

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

// ─── Fixtures ────────────────────────────────────────────────────────────────

let canvasMode = "design";
let navigated: string[] = [];

/** Make a selection snapshot with the given active tags / collapsed / link state. */
function snapshotOf(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    activeTags: [],
    collapsed: false,
    kind: "selectionChanged",
    link: { active: false, href: null },
    localScope: null,
    path: [],
    rect: { height: 12, width: 30, x: 0, y: 0 },
    seq: 1,
    ...overrides,
  };
}

/** Place the toolbar anchor (parent-viewport space). Default keeps it well below the 80px headroom. */
function setAnchor(
  rect: Partial<{ left: number; top: number; width: number; height: number }> = {},
) {
  host.anchor = { height: 20, left: 30, top: 200, width: 100, ...rect };
}

/** Open one tab on `docNode` with `selection` selected. `opts.id` names it (a second document). */
function setup(docNode: JxMutableNode, selection: JxPath | null, opts: { id?: string } = {}) {
  const tab = resetWorkspaceWithTab(docNode, opts);
  tab.session.selection = selection ? [selection] : [];
  setAnchor();
  return tab;
}

function bar(): HTMLElement | null {
  return (view.blockActionBarEl?.querySelector('[part="bar"]') as HTMLElement) ?? null;
}

/** Render, then let the document reconcile: the bar is a mount, not a synchronous template. */
async function render(): Promise<void> {
  renderBlockActionBar();
  await flush(3);
}

/** One of the bar's own parts. */
function part(name: string): HTMLElement | null {
  return (bar()?.querySelector(`[part="${name}"]`) as HTMLElement) ?? null;
}

/**
 * A kit button's own control: the `<button>` that carries `disabled`, the `title` and the
 * accessible name, and the node a press is dispatched at.
 */
function control(el: Element | null): HTMLElement | null {
  return (el?.querySelector('[part="control"]') as HTMLElement) ?? null;
}

function isDisabled(el: Element | null): boolean {
  return control(el)?.hasAttribute("disabled") === true;
}

function titleOf(el: Element | null): string | null {
  return control(el)?.getAttribute("title") ?? null;
}

/** Type into the kit's field the way a reader does: the control reports, and the event bubbles. */
function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Whether the bar is hidden because its anchor left the stage. */
function isOffscreen(): boolean {
  return bar()!.dataset.offscreen !== undefined;
}

/** The bar's placed inline-start edge, as the document's own custom property. */
function barX(): string {
  return bar()!.style.getPropertyValue("--jx-bar-x").trim();
}

/** The bar's placed block-start edge. */
function barY(): string {
  return bar()!.style.getPropertyValue("--jx-bar-y").trim();
}

function press(el: Element | null): void {
  (control(el) ?? el)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * A registry verb by command id.
 *
 * The verb cluster is `registry.forPlacement("blockbar")`, so its buttons are addressed by the
 * record that produced them — their tooltip is the record's (chord when it can act, the `requires`
 * sentence when it cannot) and belongs to the record, not to this surface.
 */
function cmdButton(id: string): HTMLElement {
  const btn = bar()?.querySelector(`[data-command-id="${id}"]`) as HTMLElement | null;
  if (!btn) {
    throw new Error(`bar command not rendered: ${id}`);
  }
  return btn;
}

function doc(): JxMutableNode {
  return activeTab.value!.doc.document;
}

/** The link panel, when the document is drawing it. It lives inside the bar's own document. */
function linkPanel(): HTMLElement | null {
  return part("link");
}

/** The link panel's URL field — the kit textfield's own input. */
function linkField(): HTMLInputElement | null {
  return (linkPanel()?.querySelector('[part="input"]') as HTMLInputElement) ?? null;
}

/** The link panel's buttons, by their visible text. */
function linkButtons(): HTMLElement[] {
  const panel = linkPanel();
  return panel ? [...panel.querySelectorAll<HTMLElement>("jx-action-button")] : [];
}

/**
 * The slash menu's rows, once its document has reconciled.
 *
 * The menu is a listbox (`surfaces/slash-menu.json`) rather than a `jx-menu`: it filters a caret
 * that stays in the canvas, so it marks its active row instead of taking focus.
 */
async function slashRows(): Promise<HTMLElement[]> {
  await flush(3);
  return [...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]')];
}

/** Put the bar into the editing state with a snapshot (default: non-collapsed, no active tags). */
async function startEditingState(snapshot: Partial<SelectionSnapshot> = {}) {
  host.editing = true;
  host.snapshot = snapshotOf(snapshot);
  await render();
}

// ─── Pre-init behavior ───────────────────────────────────────────────────────

test("renderBlockActionBar is a no-op before initBlockActionBar", async () => {
  await render();
  expect(view.blockActionBarEl).toBeNull();
});

// ─── Initialized behavior ────────────────────────────────────────────────────

describe("block action bar", () => {
  beforeAll(() => {
    initBlockActionBar({
      getCanvasMode: () => canvasMode,
      navigateToComponent: (path: string) => navigated.push(path),
    });
  });

  beforeEach(() => {
    canvasMode = "design";
    navigated = [];
    dnd.draggables.length = 0;
    componentRegistry.length = 0;
    host.editing = false;
    host.editingProp = null;
    host.snapshot = null;
    host.anchor = null;
    host.posted.length = 0;
  });

  afterEach(() => {
    dismissSlashMenu();
    dismissLinkPopover();
    dismissBlockActionBar();
    if (view.selDragCleanup) {
      view.selDragCleanup();
      view.selDragCleanup = null;
    }
  });

  // ─── Dismissal conditions ──────────────────────────────────────────────────

  test("renders nothing outside design/edit modes, without selection, or without an anchor", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);

    canvasMode = "preview";
    await render();
    expect(bar()).toBeNull();

    canvasMode = "design";
    activeTab.value!.session.selection = [];
    await render();
    expect(bar()).toBeNull();

    activeTab.value!.session.selection = [["children", 0]] as never;
    host.anchor = null; // No anchor rect from the bridge → nothing to position from.
    await render();
    expect(bar()).toBeNull();
  });

  test("renders nothing when the selected doc node does not exist", async () => {
    setup({ children: [], tagName: "div" }, ["children", 0]);
    await render();
    expect(bar()).toBeNull();
  });

  test("dismissBlockActionBar clears the bar", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(bar()).not.toBeNull();
    dismissBlockActionBar();
    await flush();
    expect(bar()).toBeNull();
  });

  // ─── Structure ─────────────────────────────────────────────────────────────

  test("child selection renders badge, parent selector, drag handle, arrows, and convert", async () => {
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    await render();

    expect(part("tag")!.textContent!.trim()).toBe("p");
    // The badge is a control on a tag that has somewhere to go, and DISABLED where it has not.
    expect(isDisabled(part("tag"))).toBe(false);
    expect(control(part("tag"))!.getAttribute("aria-haspopup")).toBe("menu");
    expect(part("parent")).not.toBeNull(); // Parent selector
    expect(part("drag-handle")!.textContent).toContain("⠿");
    expect(isDisabled(cmdButton("selection.moveUp"))).toBe(true); // Idx 0
    expect(isDisabled(cmdButton("selection.moveDown"))).toBe(false);
    expect(cmdButton("selection.convertToComponent")).not.toBeNull();
    // ONE bar: the format group is part of it whenever the block can carry inline markup, whether
    // Or not a caret is in the block yet.
    expect(part("format")).not.toBeNull();
    /* The region the screenshot manifest crops. `resolveRegion` takes the LAST match in document
       order, so it must be on the bar's own box: the layer slot above it carries the same id and
       is zero-height, because everything in it is `position: fixed`. */
    expect(bar()!.dataset.jxRegion).toBe("overlay.menu:block-action-bar");
  });

  test("positions from the bridge anchor rect (viewport space), above when there is headroom", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    setAnchor({ height: 50, left: 30, top: 200, width: 100 });
    await render();
    expect(bar()!.style.getPropertyValue("--jx-bar-x").trim()).toBe("30px");
    expect(bar()!.style.getPropertyValue("--jx-bar-y").trim()).toBe("162px"); // 200 - 38
  });

  test("positions below the anchor when near the top of the viewport", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    setAnchor({ height: 20, left: 12, top: 10, width: 100 });
    await render();
    expect(bar()!.style.getPropertyValue("--jx-bar-x").trim()).toBe("12px");
    expect(bar()!.style.getPropertyValue("--jx-bar-y").trim()).toBe("34px"); // 10 + 20 + 4
  });

  test("the root selection keeps the bar's shape and disables what cannot act", async () => {
    // §8.6 is normative: ONE shape. The bar used to drop the parent selector, the drag handle and
    // Every verb at the root, so selecting the document rearranged the toolbar under the cursor.
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, []);
    await render();
    expect(part("tag")!.textContent!.trim()).toBe("div");

    expect(isDisabled(part("parent"))).toBe(true);
    const handle = part("drag-handle")!;
    // Still drawn, still named, and refused out loud — never removed.
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(handle.getAttribute("role")).toBe("button");
    expect(handle.getAttribute("title")).toContain("the document root cannot move");

    for (const id of ["selection.moveUp", "selection.moveDown"]) {
      expect(isDisabled(cmdButton(id))).toBe(true);
    }
    // `selection.duplicate` now declares the same gate `selection.delete` has, so the root
    // Disables it here instead of offering a button whose only effect is nothing.
    const dup = cmdButton("selection.duplicate");
    expect(isDisabled(dup)).toBe(true);
    expect(titleOf(dup)).toBe("Duplicate — requires an element that has a sibling position");
    // Delete arrives from the registry with the one sentence that refuses the document root.
    const del = cmdButton("selection.delete");
    expect(isDisabled(del)).toBe(true);
    expect(titleOf(del)).toBe(
      "Delete — requires an element selection that is not the document root",
    );
    // The name stays the bare name.
    expect(control(del)!.getAttribute("aria-label")).toBe("Delete");
    expect(isDisabled(cmdButton("selection.convertToComponent"))).toBe(true);
  });

  test("the verb cluster is the blockbar placement, in group order, with Delete last", async () => {
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 1],
    );
    await render();
    const ids = [...bar()!.querySelectorAll<HTMLElement>('[part="verb"]')].map(
      (b) => b.dataset.commandId,
    );
    expect(ids).toEqual([
      "selection.moveUp",
      "selection.moveDown",
      "selection.duplicate",
      "selection.convertToComponent",
      "selection.delete",
    ]);
    // Exactly the cap, so nothing folds away: no ⋮ on a default selection.
    expect(ids.length).toBe(BLOCKBAR_MAX_ITEMS);
    expect(part("overflow")).toBeNull();
  });

  test("Delete removes the selected element and leaves its parent selected", async () => {
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 1],
    );
    await render();
    press(cmdButton("selection.delete"));
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["A"]);
    expect(activeTab.value!.session.selection).toEqual([[]]);
  });

  test("Delete over a row that names no splice coordinate moves nothing at all", async () => {
    // A repeater's map template is a first-class Outline row and therefore a selectable target,
    // But `structuralBatch` filters it out: there is no `children/<n>` to splice. The bar used to
    // Run the transaction anyway and THEN move the selection to `parentElementPath(path)` —
    // `["children"]`, which addresses no node — so the author watched their selection jump to a
    // Dangling path while the document, and the delete they asked for, stood still.
    const tab = setup(
      {
        children: [{ $prototype: "Array", map: { tagName: "li", textContent: "A" } }],
        tagName: "ul",
      },
      ["children", 0, "map"],
    );
    tab.doc.dirty = false;
    const historyBefore = tab.history.index;
    await render();
    press(cmdButton("selection.delete"));

    expect(activeTab.value!.session.selection).toEqual([["children", 0, "map"]]);
    expect((doc().children as JxMutableNode[])[0]!.map).toEqual({
      tagName: "li",
      textContent: "A",
    });
    // No transaction ran, so there is no empty undo step and no unsaved-changes mark to explain.
    expect(tab.history.index).toBe(historyBefore);
    expect(tab.doc.dirty).toBe(false);
  });

  test("Delete leaves the selection where it was when the transaction is declined", async () => {
    // `transactDoc` refuses while a peer holds source-canonical. The document is untouched, so the
    // Selection must be too — the move is conditional on the transaction having changed something,
    // Not on it having been attempted.
    const tab = setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 1],
    );
    await render();
    setTransactGate(() => "source-canonical");
    try {
      press(cmdButton("selection.delete"));
    } finally {
      setTransactGate(null);
    }

    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["A", "B"]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });

  test("Duplicate inserts a copy after the selection", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();
    press(cmdButton("selection.duplicate"));
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["A", "A"]);
  });

  test("Delete on a multi-selection removes every one, in ONE undo step (§6.5)", async () => {
    const tab = setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
          { tagName: "p", textContent: "C" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    tab.session.selection = [
      ["children", 0],
      ["children", 2],
    ];
    const before = tab.history.index;
    await render();
    press(cmdButton("selection.delete"));
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["B"]);
    expect(tab.history.index).toBe(before + 1);
  });

  test("Duplicate on a multi-selection copies every one, in ONE undo step", async () => {
    const tab = setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    const before = tab.history.index;
    await render();
    press(cmdButton("selection.duplicate"));
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual([
      "A",
      "A",
      "B",
      "B",
    ]);
    expect(tab.history.index).toBe(before + 1);
  });

  test("badge prefers the node $id over the tag name", async () => {
    setup({ children: [{ $id: "hero", tagName: "section" } as never], tagName: "div" }, [
      "children",
      0,
    ]);
    await render();
    expect(part("tag")!.textContent!.trim()).toBe("hero");
  });

  // ─── Bar mousedown focus guard ─────────────────────────────────────────────

  test("bar mousedown is prevented except on the drag handle and the badge", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();

    const down = (target: Element) => {
      const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // The guard keeps the caret in the canvas; the two exceptions NEED the press — a native drag
    // Never starts from a prevented mousedown, and the badge opens a menu that takes focus.
    const parentControl = control(part("parent"))!;
    const badgeControl = control(part("tag"))!;
    expect(down(parentControl)).toBe(true);
    expect(down(part("drag-handle")!)).toBe(false);
    expect(down(badgeControl)).toBe(false);
  });

  // ─── Parent selection & movement ───────────────────────────────────────────

  test("parent selector click selects the parent path", async () => {
    setup({ children: [{ children: [{ tagName: "em" }], tagName: "p" }], tagName: "div" }, [
      "children",
      0,
      "children",
      0,
    ]);
    await render();
    press(part("parent"));
    expect(activeTab.value!.session.selection).toEqual([["children", 0]]);
  });

  test("Move down and Move up reorder siblings and track the selection", async () => {
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    await render();

    press(cmdButton("selection.moveDown"));
    let children = doc().children as JxMutableNode[];
    expect(children.map((c) => c.textContent)).toEqual(["B", "A"]);
    expect(activeTab.value!.session.selection).toEqual([["children", 1]]);

    await render(); // Selection now at idx 1
    press(cmdButton("selection.moveUp"));
    children = doc().children as JxMutableNode[];
    expect(children.map((c) => c.textContent)).toEqual(["A", "B"]);
    expect(activeTab.value!.session.selection).toEqual([["children", 0]]);
  });

  test("Move up at the first index and Move down at the last index are no-ops", async () => {
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    await render();
    press(cmdButton("selection.moveUp")); // Disabled guard
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["A", "B"]);

    activeTab.value!.session.selection = [["children", 1]] as never;
    await render();
    expect(isDisabled(cmdButton("selection.moveDown"))).toBe(true);
    press(cmdButton("selection.moveDown"));
    expect((doc().children as JxMutableNode[]).map((c) => c.textContent)).toEqual(["A", "B"]);
  });

  // ─── Tag badge conversion ──────────────────────────────────────────────────

  test("badge click opens a slash menu of convert targets; Enter retags the node", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();

    const targets = getConvertTargets("p", false);
    press(part("tag"));
    expect(isSlashMenuOpen()).toBe(true);
    // The slash menu is a listbox document now (`surfaces/slash-menu.json`): its rows are
    // `[part="option"]`, and they land a couple of turns after the press that asked for them.
    const shown = await slashRows();
    expect(shown.length).toBe(targets.length);

    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush();
    expect((doc().children as JxMutableNode[])[0]!.tagName).toBe(targets[0]!.tag);
  });

  test("empty nodes (no children or a lone br) offer the wider when-empty target set", async () => {
    const emptyTargets = getConvertTargets("p", true);
    expect(emptyTargets.length).toBeGreaterThan(getConvertTargets("p", false).length);

    setup({ children: [{ children: [], tagName: "p" }], tagName: "div" }, ["children", 0]);
    await render();
    press(part("tag"));
    const shown = await slashRows();
    expect(shown.length).toBe(emptyTargets.length);
    dismissSlashMenu();

    setup({ children: [{ children: [{ tagName: "br" }], tagName: "p" }], tagName: "div" }, [
      "children",
      0,
    ]);
    await render();
    press(part("tag"));
    const shown2 = await slashRows();
    expect(shown2.length).toBe(emptyTargets.length);
  });

  // ─── Component nodes ───────────────────────────────────────────────────────

  test("registered components get a non-interactive badge and an Edit Component button", async () => {
    componentRegistry.push({ path: "components/card.json", tagName: "x-card" } as never);
    setup({ children: [{ tagName: "x-card" }], tagName: "div" }, ["children", 0]);
    await render();

    const badge = part("tag")!;
    expect(badge.textContent!.trim()).toBe("x-card");
    // A component instance has no tag to convert to, so the badge is refused rather than removed.
    expect(isDisabled(badge)).toBe(true);
    expect(control(badge)!.getAttribute("aria-haspopup")).toBeNull();
    expect(bar()!.querySelector('[data-command-id="selection.convertToComponent"]')).toBeNull();

    press(cmdButton("selection.editComponent"));
    expect(navigated).toEqual(["components/card.json"]);
  });

  test("a live prop session suffixes the badge with the prop and shows no format group", async () => {
    componentRegistry.push({ path: "components/card.json", tagName: "x-card" } as never);
    setup({ children: [{ $props: { title: "Local" }, tagName: "x-card" }], tagName: "div" }, [
      "children",
      0,
    ]);
    host.editing = true;
    host.editingProp = "title";
    await render();

    expect(part("tag")!.textContent!.trim()).toBe("x-card · title");
    expect(part("format")).toBeNull();
  });

  // ─── Repeater ($prototype:"Array") pseudo-element badge ────────────────────

  test("repeater (Array) node shows the nodeLabel badge and is not interactive", async () => {
    setup(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/excavators" },
            map: { tagName: "li", textContent: "${item}" },
          } as never,
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    await render();

    const badge = part("tag")!;
    // NodeLabel(node) → "Repeater → <items-ref>" instead of falling through to "div".
    expect(badge.textContent!.trim()).toBe("Repeater → #/state/excavators");
    // Repeaters offer no tag-conversion targets, so the badge is inert. Refused twice over: the
    // Control cannot be activated, and a click that reaches the host anyway opens nothing — an
    // Empty convert list is a menu with no rows in it, which is worse than no menu.
    expect(isDisabled(badge)).toBe(true);
    badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isSlashMenuOpen()).toBe(false);
  });

  test("a normal div node still shows its tag name and is interactive", async () => {
    // Contrast with the repeater: a plain element keeps the bare tag badge + convert targets.
    setup({ children: [{ children: [], tagName: "div" }], tagName: "section" }, ["children", 0]);
    await render();

    const badge = part("tag")!;
    expect(badge.textContent!.trim()).toBe("div");
    expect(isDisabled(badge)).toBe(false);
  });

  // ─── Drag handle ───────────────────────────────────────────────────────────

  test("drag handle registers a draggable carrying the selection path", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();

    expect(view.selDragCleanup).toBeInstanceOf(Function);
    expect(dnd.draggables.length).toBe(1);
    expect(dnd.draggables[0]!.element.getAttribute("part")).toBe("drag-handle");
    expect(dnd.draggables[0]!.getInitialData()).toEqual({
      path: ["children", 0],
      type: "tree-node",
    });
  });

  test("a repaint leaves ONE registration on the standing handle", async () => {
    /* The document reconciles by assignment, so the handle's node survives every repaint and its
       registration with it — which is the fact the lit bar's release-before-install dance existed
       to protect and could only ever approximate. Two live registrations on one handle is a drag
       that fires twice; the count is what says there is exactly one. */
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();
    const handle = part("drag-handle");
    await render();
    await render();
    expect(dnd.draggables.length).toBe(1);
    expect(part("drag-handle")).toBe(handle);
    expect(view.selDragCleanup).toBeInstanceOf(Function);
  });

  test("dismissing releases it, and drawing again installs exactly one more", async () => {
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(dnd.draggables.length).toBe(1);

    // A dismissal takes the handle's node away with the rest of the bar; leaving the registration
    // Live would leave a dnd listener on a detached node for the life of the window.
    dismissBlockActionBar();
    await flush();
    expect(view.selDragCleanup).toBeNull();
    expect(part("drag-handle")).toBeNull();

    await render();
    expect(dnd.draggables.length).toBe(2);
    expect(view.selDragCleanup).toBeInstanceOf(Function);
  });

  test("the handle refuses a drag at the document root", async () => {
    // `canDrag` is asked at the PRESS, so the handle greys and refuses without re-registering.
    setup({ children: [{ tagName: "p", textContent: "A" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(dnd.draggables[0]!.canDrag()).toBe(true);
    activeTab.value!.session.selection = [[]] as never;
    await render();
    expect(dnd.draggables[0]!.canDrag()).toBe(false);
    expect(part("drag-handle")!.getAttribute("aria-disabled")).toBe("true");
  });

  // ─── Inline formatting (snapshot-driven) ───────────────────────────────────

  test("format buttons are always present for a block that can carry markup", async () => {
    // The bar used to rearrange itself under the author's cursor the moment they started typing.
    // With a document-wide caret there is no session to be in or out of.
    setup({ children: [{ tagName: "p", textContent: "hello" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(part("format")).not.toBeNull();
    // …but inert until there is a range to apply them to.
    expect(isDisabled(cmdButton("format.bold"))).toBe(true);

    await startEditingState();
    const group = part("format")!;
    const titles = [...group.querySelectorAll('[part="format-button"]')].map((b) => titleOf(b));
    /* The chord comes from the KEYMAP now, so it is formatted for the platform the test is running
       on. This asserted the literal "Bold (Cmd+B)", which is the string
       `data/elements-meta.json` hardcoded into every tooltip on every machine — the exact defect
       plan §5.3 names ("one function formats chords, which kills the hardcoded ⌘P shown to Windows
       and Linux users"). Asserting the formatter's own answer is what makes the tooltip provably
       not a hardcoded one. */
    const chord = selectionCommandRegistry().keymap.formatBinding("format.bold");
    expect(titles).toContain(`Bold (${chord})`);
    // A verb with no chord prints its bare name — not an empty pair of brackets.
    expect(titles).toContain("Strikethrough");
    expect(titles.length).toBe(8); // P inline actions
  });

  test("pressed-state comes from the snapshot's activeTags", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState({ activeTags: ["strong"] });
    /* The pressed state is announced per button — `aria-pressed` on each toggle's own control —
       rather than as a group-wide `selected` list, which is what the Spectrum group carried and
       what no assistive technology could read off it. The tag the snapshot named is the pressed
       one, and every other format button is unpressed. */
    const pressedTags = [...part("format")!.querySelectorAll<HTMLElement>('[part="format-button"]')]
      .filter((b) => control(b)!.getAttribute("aria-pressed") === "true")
      .map((b) => b.dataset.tag);
    expect(pressedTags).toEqual(["strong"]);
  });

  test("a Bold click posts an applyFormat bold intent across the bridge", async () => {
    setup({ children: [{ tagName: "p", textContent: "hello" }], tagName: "div" }, ["children", 0]);
    await startEditingState();
    press(cmdButton("format.bold"));
    expect(host.posted).toEqual([{ command: "bold" }]);
  });

  test("a collapsed caret disables format buttons (link stays enabled)", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState({ collapsed: true });
    expect(isDisabled(cmdButton("format.bold"))).toBe(true);
    expect(isDisabled(cmdButton("format.link"))).toBe(false);
  });

  test("a block selected with NO caret has the group, disabled", async () => {
    // Selecting from the layers panel, or a structural edit moving the selection: formatting
    // Applies to a range, and there is not one.
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(part("format")).not.toBeNull();
    expect(isDisabled(cmdButton("format.bold"))).toBe(true);
  });

  test("a component block still has no format group", async () => {
    // Component tags carry no inline actions — there is nothing to format.
    setup({ children: [{ tagName: "x-card" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(part("format")).toBeNull();
  });

  test("format button mousedown is prevented (focus guard)", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState();
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    control(cmdButton("format.bold"))!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  // ─── Merge tags ──────────────────────────────────────────────────────────

  async function setupEditingWithState(state: Record<string, JxStateDefinition>) {
    setup({ children: [{ tagName: "p", textContent: "hello" }], state, tagName: "div" }, [
      "children",
      0,
    ]);
    await startEditingState();
  }

  test("Insert data rides with the format group, disabled without a range", async () => {
    setup(
      { children: [{ tagName: "p", textContent: "A" }], state: { title: "x" }, tagName: "div" },
      ["children", 0],
    );
    await render();
    expect(part("insert-data")).not.toBeNull();
  });

  test("Insert data button appears while editing and opens a merge-tag menu", async () => {
    await setupEditingWithState({ count: 5, title: "Hello" });
    const btn = part("insert-data")!;
    expect(control(btn)!.getAttribute("aria-label")).toBe("Insert data");
    // The region a shot addresses to photograph the open merge-tag list.
    expect(btn.dataset.jxRegion).toBe("overlay.menu:block-action-bar/insertData");

    press(btn);
    expect(isSlashMenuOpen()).toBe(true);
    // Two top-level state names → two merge tags (no live scope → no nested walk).
    const shown = await slashRows();
    expect(shown.length).toBe(2);
  });

  test("selecting a merge tag posts an insertData intent", async () => {
    await setupEditingWithState({ title: "Hello" });
    press(part("insert-data"));
    expect(isSlashMenuOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush();
    expect(isSlashMenuOpen()).toBe(false);
    expect(host.posted).toEqual([{ command: "insertData", token: "state.title" }]);
  });

  test("merge-tag menu offers repeater item.data.<field> tokens when editing inside a repeater", async () => {
    // Doc: div > ul > Array(items:#/state/$docs) whose map template is <li>${item.data.title}</li>.
    const arrayNode = {
      $prototype: "Array",
      items: { $ref: "#/state/$docs" },
      map: { children: ["${item.data.title}"], tagName: "li" },
    };
    setup(
      {
        children: [{ children: [arrayNode], tagName: "ul" }],
        state: { $docs: { $prototype: "ContentCollection", contentType: "docs" } },
        tagName: "div",
      },
      // Selection resolves to a real node (the <li> map template) so the bar renders.
      ["children", 0, "children", 0, "map"],
    );
    // The content type's frontmatter schema drives the item fields.
    resetStudioState({
      projectConfig: {
        content: {
          docs: { schema: { properties: { title: { type: "string" } } } },
        },
      },
    });
    // The snapshot path (caret) sits inside the repeater map — carries the `map` segment.
    await startEditingState({ path: ["children", 0, "children", 0, "map", "children", 0] });

    press(part("insert-data"));
    expect(isSlashMenuOpen()).toBe(true);
    const slashed = await slashRows();
    const labels = slashed.map((el) => el.querySelector('[part="name"]')!.textContent!.trim());
    expect(labels).toContain("item");
    expect(labels).toContain("index");
    expect(labels).toContain("item.data.title");

    resetStudioState(); // Reset projectConfig so it does not leak into later tests.
  });

  // ─── Link popover ──────────────────────────────────────────────────────────

  test("Link button opens the popover; Apply posts a link intent", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState();

    press(cmdButton("format.link"));
    await flush(2);
    expect(isLinkPopoverOpen()).toBe(true);
    const field = linkField()!;
    expect(field.value).toBe("");
    expect(linkButtons().map((b) => b.textContent!.trim())).toEqual(["Apply"]);

    type(field, "https://example.com");
    press(linkButtons()[0]!);
    await flush();
    expect(host.posted).toEqual([{ command: "link", href: "https://example.com" }]);
    expect(isLinkPopoverOpen()).toBe(false);
  });

  test("inside an existing link the popover prefills and offers Update + Remove", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState({ link: { active: true, href: "https://old" } });

    press(cmdButton("format.link"));
    await flush(2);
    expect(linkField()!.value).toBe("https://old");
    expect(linkButtons().map((b) => b.textContent!.trim())).toEqual(["Update", "Remove"]);

    // Update posts a link intent with the new href.
    type(linkField()!, "https://new");
    press(linkButtons()[0]!);
    await flush();
    expect(host.posted).toEqual([{ command: "link", href: "https://new" }]);
    expect(isLinkPopoverOpen()).toBe(false);

    // Reopen and Remove posts a null-href link intent.
    host.posted.length = 0;
    press(cmdButton("format.link"));
    await flush(2);
    press(linkButtons()[1]!);
    await flush();
    expect(host.posted).toEqual([{ command: "link", href: null }]);
  });

  test("Enter applies and Escape dismisses from the URL field", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState();

    press(cmdButton("format.link"));
    await flush(2);
    type(linkField()!, "https://kbd.example");
    linkField()!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush();
    expect(host.posted).toEqual([{ command: "link", href: "https://kbd.example" }]);
    expect(isLinkPopoverOpen()).toBe(false);

    host.posted.length = 0;
    press(cmdButton("format.link"));
    await flush(2);
    linkField()!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await flush();
    expect(isLinkPopoverOpen()).toBe(false);
    expect(host.posted).toEqual([]); // Escape did not apply
  });

  test("an open link panel and the URL in it survive a snapshot-driven re-render", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState();
    press(cmdButton("format.link"));
    await flush(2);
    const fieldBefore = linkField();
    type(fieldBefore!, "https://half-typed.example");

    /* The refusal the lit bar needed a whole render guard for. A document reconciles by
       assignment, so a snapshot-, pan- or zoom-driven repaint cannot re-create the field: the
       caret, and what the author has typed into it so far, are both still there afterwards. */
    await render();
    await render();
    expect(isLinkPopoverOpen()).toBe(true);
    expect(linkField()).toBe(fieldBefore);
    expect(linkField()!.value).toBe("https://half-typed.example");
  });

  test("dismissLinkPopover closes the panel", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await startEditingState();
    press(cmdButton("format.link"));
    await flush(2);
    expect(isLinkPopoverOpen()).toBe(true);
    dismissLinkPopover();
    expect(isLinkPopoverOpen()).toBe(false);
  });

  // ─── Inline formatting, as records ─────────────────────────────────────────

  /**
   * These replace a `describe("handleParentFormatShortcut")` that drove a hand-written keydown
   * switch — eight cases over a control that RETURNED EARLY whenever focus was inside the canvas
   * iframe, which is the only place a canvas caret can be. Every one of them passed, because each
   * dispatched its event at a parent-realm `<input>`; none could see that ⌘B in the page did
   * nothing. The capability moved onto records, so the tests move with it: what is asserted now is
   * the record's declaration and what running it posts.
   */
  describe("formatCommands", () => {
    const byId = () => new Map(formatCommands().map((command) => [command.id, command]));

    test("the whole `$inlineActions` vocabulary has a record, and nothing else does", async () => {
      expect([...byId().keys()].toSorted()).toEqual([
        "format.bold",
        "format.code",
        "format.italic",
        "format.link",
        "format.strikethrough",
        "format.subscript",
        "format.superscript",
        "format.underline",
      ]);
    });

    test("selection level, caret scope — the case §5.1 uses to justify two fields", async () => {
      for (const command of formatCommands()) {
        expect(command.level).toBe("selection");
        expect(command.keyScope).toBe("caret");
        expect(command.menus).toContain("blockbar/format");
        expect(command.requires).toBeTruthy();
      }
    });

    test("the four documented chords are the records', formatted by the one formatter", async () => {
      const map = byId();
      expect(map.get("format.bold")?.keybinding).toBe("mod+b");
      expect(map.get("format.italic")?.keybinding).toBe("mod+i");
      expect(map.get("format.underline")?.keybinding).toBe("mod+u");
      expect(map.get("format.code")?.keybinding).toBe("mod+`");
      expect(map.get("format.link")?.keybinding).toBe("mod+k");
      // The three with no chord declare none rather than an unbindable placeholder.
      expect(map.get("format.strikethrough")?.keybinding).toBeUndefined();
    });

    test("running one posts the intent the iframe already understands", async () => {
      const registry = selectionCommandRegistry();
      host.editing = true;
      void registry.run("format.bold");
      void registry.run("format.code");
      expect(host.posted).toEqual([{ command: "bold" }, { command: "code" }]);
    });

    test("format.link opens the link popover, anchored by record id", async () => {
      setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
      await startEditingState();
      void selectionCommandRegistry().run("format.link");
      await flush(2);
      expect(isLinkPopoverOpen()).toBe(true);
      dismissLinkPopover();
    });

    test("`when` is the CANVAS caret, not any caret", async () => {
      // The distinction the record exists to make: `caret.active` is also true while focus is in a
      // Parent text field — including the link popover's own URL box, where ⌘K would re-mount the
      // Popover being typed into.
      const command = byId().get("format.bold")!;
      expect(command.when?.(makeContext({ caret: { active: true, inCanvas: false } }))).toBe(false);
      expect(command.when?.(makeContext({ caret: { active: true, inCanvas: true } }))).toBe(true);
    });
  });
});

// ─── Scroll tracking: rAF-throttled fast-path reposition + hide-out-of-view ─────

describe("scroll tracking", () => {
  const raf = () =>
    new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });

  /** Dispatch a scroll whose target is the document (a window/document-level scroll). */
  const scrollDoc = () => {
    const e = new Event("scroll");
    Object.defineProperty(e, "target", { configurable: true, value: document });
    onCanvasScroll(e);
  };

  beforeEach(async () => {
    canvasMode = "edit";
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    await flush();
  });

  /** The bar's placed position, as the two custom properties the document's `left`/`top` read. */
  const at = () => [barX(), barY()];

  test("a document-target scroll repositions the existing bar from a fresh anchor", async () => {
    expect(bar()).toBeTruthy();
    const before = barY();
    host.anchor = { height: 20, left: 44, top: 400, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(barY()).not.toBe(before);
    expect(at()).toEqual(["44px", `${400 - 38}px`]);
  });

  test("repositioning is rAF-throttled: many scroll events, one anchor application", async () => {
    host.anchor = { height: 20, left: 71, top: 300, width: 100 };
    scrollDoc();
    host.anchor = { height: 20, left: 99, top: 500, width: 100 };
    scrollDoc();
    scrollDoc();
    await raf();
    await flush();
    // The single frame read the LATEST anchor (one reposition, not three).
    expect(barX()).toBe("99px");
  });

  test("a vanished anchor hides the bar without tearing it down; a returning one restores it", async () => {
    const handle = part("drag-handle");
    host.anchor = null;
    scrollDoc();
    await raf();
    await flush();
    /* `data-offscreen` is `visibility: hidden`, NOT the `visible` switch: the anchor is coming
       back on the next scroll frame, and rebuilding the bar would take the drag registration and
       anything holding the caret with it. The node is still the one it was. */
    expect(isOffscreen()).toBe(true);
    expect(part("drag-handle")).toBe(handle);

    host.anchor = { height: 20, left: 30, top: 250, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(isOffscreen()).toBe(false);
    expect(barY()).toBe(`${250 - 38}px`);
  });

  test("scrolls are ignored in preview mode / without a selection / from unrelated targets", async () => {
    const before = at();

    canvasMode = "preview";
    host.anchor = { height: 20, left: 1, top: 999, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(at()).toEqual(before);

    canvasMode = "edit";
    const unrelated = document.createElement("div");
    document.body.append(unrelated);
    const e = new Event("scroll");
    Object.defineProperty(e, "target", { configurable: true, value: unrelated });
    onCanvasScroll(e);
    await raf();
    await flush();
    expect(at()).toEqual(before);
  });
});

// ─── Suppression: the bar follows the canvas ─────────────────────────────────

/**
 * The reported defect, in the author's words: the bar "persists, potentially blocking a part of the
 * interface that the user needs to utilize" — they were working in the Inspector's Logic tab while
 * the bar sat over the canvas, and it is `position: fixed` and clamped into the window, so it can
 * overlap the Document Header card, the pane context bar and the docks.
 *
 * What these tests are really about is why a dismiss is not the fix. The bar is re-rendered from
 * the `toolbarRefresh` seam on every selection snapshot and from `renderOnly("overlays")` on
 * zoom/pan, so a bar that is merely dismissed flashes back on the next repaint. The state has to
 * survive those, and end on its own — by the selection moving, or by the canvas taking a pointer.
 */
describe("suppression", () => {
  beforeEach(async () => {
    canvasMode = "design";
    host.editing = false;
    host.snapshot = null;
    setup(
      {
        children: [
          { tagName: "p", textContent: "A" },
          { tagName: "p", textContent: "B" },
        ],
        tagName: "div",
      },
      ["children", 0],
    );
    await render();
  });

  // Also drops the suppression, so no test here can leak one into the next.
  afterEach(() => dismissBlockActionBar());

  test("a chrome pointerdown hides the bar, and a repaint does not bring it back", async () => {
    expect(bar()).not.toBeNull();
    suppressBlockActionBar();
    await flush();
    expect(bar()).toBeNull();
    // The snapshot- and overlay-driven repaints, which is what `dismissBlockActionBar` alone
    // Could not survive.
    await render();
    await render();
    expect(bar()).toBeNull();
  });

  test("the selection is untouched — the Inspector still edits what the author selected", async () => {
    suppressBlockActionBar();
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 0]] as never);
  });

  test("a different selection releases it — an Outline row click hides the bar and shows it", async () => {
    suppressBlockActionBar();
    await flush();
    // One click, both halves: it is chrome (so it suppresses) AND it moves the selection (so the
    // Suppression is already over by the time the bar renders).
    activeTab.value!.session.selection = [["children", 1]] as never;
    await render();
    expect(bar()).not.toBeNull();
    // Released for good, not for one pass.
    await render();
    expect(bar()).not.toBeNull();
  });

  test("clicking the SAME element again brings it back — the door the selection cannot open", async () => {
    suppressBlockActionBar();
    await flush();
    // The `hit` for the already-selected block posts the same path back, so the render path has
    // Nothing to compare and the bar would stay hidden for as long as the author kept clicking it.
    await render();
    expect(bar()).toBeNull();
    // Which is why the frame's own pointerdown is a second, independent signal.
    releaseBlockActionBar();
    await flush(3);
    expect(bar()).not.toBeNull();
  });

  test("a release with nothing suppressed renders nothing at all", async () => {
    dismissBlockActionBar();
    await flush();
    releaseBlockActionBar();
    // A canvas pointerdown is the most frequent event in the app; unsuppressed it must cost a null
    // Check, not a re-render of a bar that was deliberately taken down.
    expect(bar()).toBeNull();
  });

  test("a dismiss drops the suppression, so it cannot leak into the next document", async () => {
    suppressBlockActionBar();
    await flush();
    // What a mode switch or a stage teardown does. `["children",0]` names a node in every document,
    // So a key that outlived this one would hide the bar over a node nobody clicked away from.
    dismissBlockActionBar();
    await render();
    expect(bar()).not.toBeNull();
  });

  test("the same path in another document is another node — the key carries the tab", async () => {
    suppressBlockActionBar();
    await flush();
    // Switching tabs is itself a chrome click, so it arrives suppressed. `["children",0]` names a
    // Node in every document there has ever been; keyed on the path alone the bar would come up
    // Hidden over a block in a document the author has not touched.
    setup({ children: [{ tagName: "p", textContent: "C" }], tagName: "div" }, ["children", 0], {
      id: "other-doc",
    });
    await render();
    expect(bar()).not.toBeNull();
  });

  test("nothing selected is not the document root: the two keys must not collide", async () => {
    activeTab.value!.session.selection = [];
    await render();
    suppressBlockActionBar();
    await flush();
    activeTab.value!.session.selection = [[]] as never;
    await render();
    expect(bar()).not.toBeNull();
  });

  test("the link popover goes with the bar — it is anchored to a button that is gone", async () => {
    await startEditingState();
    press(cmdButton("format.link"));
    await flush(2);
    expect(isLinkPopoverOpen()).toBe(true);
    suppressBlockActionBar();
    await flush();
    expect(bar()).toBeNull();
    expect(isLinkPopoverOpen()).toBe(false);
    // And the popover's own render guard cannot strand the bar: a suppressed bar stays suppressed.
    await render();
    expect(bar()).toBeNull();
  });
});

// ─── Edit-chrome hit test (the parent pointerdown commit-guard's exclusion set) ──

describe("isEditChromeTarget", () => {
  test("recognizes the bar and its popovers; rejects outside targets and non-nodes", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    await flush();
    expect(isEditChromeTarget(bar())).toBe(true);
    const outside = document.createElement("div");
    document.body.append(outside);
    expect(isEditChromeTarget(outside)).toBe(false);
    expect(isEditChromeTarget(null)).toBe(false);
  });
});
