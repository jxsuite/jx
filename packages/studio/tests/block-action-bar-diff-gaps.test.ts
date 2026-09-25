/**
 * Coverage-gap tests for src/panels/block-action-bar.ts — the refusals nothing reached.
 *
 * Four clusters:
 *
 * - **The structural verbs' own guards.** `registry.run()` throws before a disabled record's `run` is
 *   entered, so every `if (!target …) return;` inside the four movers is unreachable through the
 *   registry — which is precisely why the record carries it: `run` is a public field on a public
 *   record and the enablement gate is the CALLER's discipline, not the verb's. These tests invoke
 *   `record.run(ctx)` directly over states the enablement already refuses, and assert the document
 *   AND the selection both hold. Both, because a mover that runs anyway can leave the splice a
 *   no-op (`splice(-1, 0, node)` puts it back where it was) and still land the selection on a
 *   phantom index — the visible half of the verb firing over an unchanged document.
 * - **`structuralTarget` / `isContainerNode` saying no**: a path whose parent resolves to nothing,
 *   and a text sibling standing where "move into previous" wants a container. Each negative is
 *   paired with the positive it must not swallow.
 * - **The two chrome refusals**: the `⋮` menu's `onDismiss` (which is what stops a dismissed menu
 *   from still counting as edit chrome), and the toolbar arrows over a bar with nothing that can
 *   act.
 * - **The drag handle's re-registration** across two render passes — the one fact the bar's two
 *   release-before-install guards protect between them, asserted from the pragmatic-dnd
 *   registrations themselves.
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { componentRegistry } from "../src/files/components";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { initLayers } from "../src/ui/layers";

import type { AnyCommand, CommandRegistry } from "../src/commands/registry";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

// ─── Seams (both must precede the module-under-test import) ──────────────────

/**
 * One ordered log, so "released BEFORE the next install" is a fact and not two counts, plus the
 * elements each registration landed on.
 *
 * The element is kept rather than named: a registration is announced through `onNodeCreated`, which
 * fires BEFORE the runtime applies attributes, so the node has no `part` of its own yet at the
 * moment the mock sees it.
 */
const dnd: { log: string[]; elements: HTMLElement[] } = { elements: [], log: [] };

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: ({ element }: { element: HTMLElement }) => {
    const nth = dnd.log.filter((entry) => entry.startsWith("install")).length;
    dnd.elements.push(element);
    dnd.log.push(`install#${nth}`);
    return () => dnd.log.push(`release#${nth}`);
  },
}));

void mock.module("../src/canvas/iframe-host", () => ({
  getEditBarAnchorRect: () => ({ height: 20, left: 30, top: 200, width: 100 }),
  getEditSnapshot: () => ({ editing: false, editingProp: null, snapshot: null }),
  postApplyFormat: () => {},
  requestCanvasEval: () => Promise.resolve(null),
}));

const {
  dismissBlockActionBar,
  dismissBlockBarOverflow,
  dismissLinkPopover,
  initBlockActionBar,
  openLinkPopoverFromShortcut,
  handleBlockBarEntryKey,
  isEditChromeTarget,
  isLinkPopoverOpen,
  registerSelectionCommands,
  renderBlockActionBar,
  selectionCommandContext,
  showCommandOverflow,
  useCommandRegistry,
} = await import("../src/panels/block-action-bar");
const { view } = await import("../src/view");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TWO_PARAGRAPHS: JxMutableNode = {
  children: [
    { tagName: "p", textContent: "A" },
    { tagName: "p", textContent: "B" },
  ],
  tagName: "div",
};

const NESTED: JxMutableNode = {
  children: [
    {
      children: [
        { tagName: "p", textContent: "A" },
        { tagName: "p", textContent: "B" },
      ],
      tagName: "section",
    },
  ],
  tagName: "div",
};

function setup(node: JxMutableNode, selection: JxPath | null) {
  const tab = resetWorkspaceWithTab(structuredClone(node));
  tab.session.ui.canvasMode = "design";
  tab.session.selection = selection ? [selection] : [];
  return tab;
}

/** A registry holding exactly the structural verbs, over the surface's own live context. */
function movers(): CommandRegistry {
  const registry = createCommandRegistry({ getContext: selectionCommandContext });
  registerSelectionCommands(registry, {
    convertToComponent: () => {},
    navigateToComponent: () => {},
  });
  return registry;
}

/** Call the record's own `run`, past the registry's enablement gate. */
function invokeRecord(registry: CommandRegistry, id: string): void {
  const command = registry.get(id);
  if (!command) {
    throw new Error(`no record for "${id}"`);
  }
  void command.run(selectionCommandContext(), undefined as never);
}

function childTexts(node: JxMutableNode): (string | undefined)[] {
  // Non-string `textContent` — a `$ref`, or nothing at all — reads back as undefined, not coerced.
  // A child that stopped carrying literal text therefore cannot pass for one that still does.
  return (node.children as JxMutableNode[]).map((c) =>
    typeof c.textContent === "string" ? c.textContent : undefined,
  );
}

beforeEach(() => {
  useCommandRegistry(null);
});

afterEach(() => {
  dismissBlockBarOverflow();
  useCommandRegistry(null);
});

// ─── The movers' own guards ──────────────────────────────────────────────────

describe("a mover invoked past the registry's gate refuses on its own", () => {
  test("Move Up at the first index moves neither the node nor the selection", () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 0]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveUp")).toBe(false);

    invokeRecord(registry, "selection.moveUp");

    expect(childTexts(tab.doc.document)).toEqual(["A", "B"]);
    expect(tab.session.selection).toEqual([["children", 0]]);
  });

  test("Move Down at the last index moves neither the node nor the selection", () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 1]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveDown")).toBe(false);

    invokeRecord(registry, "selection.moveDown");

    expect(childTexts(tab.doc.document)).toEqual(["A", "B"]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });

  test("Move Into Previous over a void element leaves the <img> childless", () => {
    const tab = setup(
      { children: [{ tagName: "img" }, { tagName: "p", textContent: "A" }], tagName: "div" },
      ["children", 1],
    );
    const registry = movers();
    expect(registry.isEnabled("selection.moveIn")).toBe(false);

    invokeRecord(registry, "selection.moveIn");

    const children = tab.doc.document.children as JxMutableNode[];
    expect(children.map((c) => c.tagName)).toEqual(["img", "p"]);
    expect(children[0]!.children).toBeUndefined();
    expect(tab.session.selection).toEqual([["children", 1]]);
  });

  test("Move Out with the selection gone touches nothing", () => {
    const tab = setup(NESTED, null);
    const registry = movers();
    expect(registry.isEnabled("selection.moveOut")).toBe(false);

    invokeRecord(registry, "selection.moveOut");

    const children = tab.doc.document.children as JxMutableNode[];
    expect(children.map((c) => c.tagName)).toEqual(["section"]);
    expect(childTexts(children[0]!)).toEqual(["A", "B"]);
    expect(tab.session.selection).toEqual([]);
  });

  test("Move Out of a top-level child has no grandparent to land beside", () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 1]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveOut")).toBe(false);

    invokeRecord(registry, "selection.moveOut");

    expect(childTexts(tab.doc.document)).toEqual(["A", "B"]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });
});

// ─── …and really moves when it can (the same guards, not inverted) ───────────

describe("the same verbs, over a state that admits them", () => {
  test("Move Up reorders the siblings and follows the node", () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 1]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveUp")).toBe(true);

    void registry.run("selection.moveUp");

    expect(childTexts(tab.doc.document)).toEqual(["B", "A"]);
    expect(tab.session.selection).toEqual([["children", 0]]);
  });

  test("Move Down reorders the siblings and follows the node", () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 0]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveDown")).toBe(true);

    void registry.run("selection.moveDown");

    expect(childTexts(tab.doc.document)).toEqual(["B", "A"]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });

  test("Move Out lifts the node to sit directly after its old parent", () => {
    const tab = setup(NESTED, ["children", 0, "children", 0]);
    const registry = movers();
    expect(registry.isEnabled("selection.moveOut")).toBe(true);

    void registry.run("selection.moveOut");

    const children = tab.doc.document.children as JxMutableNode[];
    expect(children.map((c) => c.tagName)).toEqual(["section", "p"]);
    expect(childTexts(children[0]!)).toEqual(["B"]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });
});

// ─── What counts as a container, and what counts as a parent ─────────────────

describe("the preconditions the movers read", () => {
  test("a text sibling is not a container — Move Into Previous refuses over a string child", () => {
    const tab = setup(
      { children: ["lead-in", { tagName: "p", textContent: "A" }], tagName: "div" },
      ["children", 1],
    );
    const registry = movers();
    expect(registry.isEnabled("selection.moveIn")).toBe(false);

    invokeRecord(registry, "selection.moveIn");

    expect(tab.doc.document.children).toEqual(["lead-in", { tagName: "p", textContent: "A" }]);
    expect(tab.session.selection).toEqual([["children", 1]]);
  });

  test("…and an element sibling with room for a block takes it", () => {
    const tab = setup(
      {
        children: [
          { children: [], tagName: "section" },
          { tagName: "p", textContent: "A" },
        ],
        tagName: "div",
      },
      ["children", 1],
    );
    const registry = movers();
    expect(registry.isEnabled("selection.moveIn")).toBe(true);

    void registry.run("selection.moveIn");

    const children = tab.doc.document.children as JxMutableNode[];
    expect(children.map((c) => c.tagName)).toEqual(["section"]);
    expect(childTexts(children[0]!)).toEqual(["A"]);
    expect(tab.session.selection).toEqual([["children", 0, "children", 0]]);
  });

  test("a selection whose parent path resolves to no node is not movable", () => {
    const tab = setup(NESTED, ["children", 7, "children", 2]);
    const registry = movers();
    // `children[7]` does not exist, so there are no siblings to count an index against — even
    // Though the path itself carries a perfectly well-formed `["children", 2]` tail.
    expect(registry.isEnabled("selection.moveUp")).toBe(false);

    // The same document, addressed at a node that IS there, answers the other way.
    tab.session.selection = [["children", 0, "children", 1]];
    expect(registry.isEnabled("selection.moveUp")).toBe(true);
  });
});

// ─── The ⋮ menu's dismissal ──────────────────────────────────────────────────

/** A minimal selection-level record, so a test decides exactly what the menu is asked to draw. */
function record(id: string): AnyCommand {
  return {
    category: "Selection",
    group: "5_test",
    id,
    level: "selection",
    menus: ["blockbar"],
    run: () => {},
    title: id.split(".")[1] ?? id,
  } as AnyCommand;
}

const raf = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

describe("the ⋮ menu released by an outside click", () => {
  test("the dismissed menu's host stops counting as edit chrome", async () => {
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true }, selection: { count: 1 } }),
    });
    registry.registerAll([record("test.only")]);
    const anchor = document.createElement("button");
    document.body.append(anchor);

    showCommandOverflow(anchor, registry, registry.list());
    await flush(3);
    const menu = document.querySelector("#layer-popover jx-menu-item");
    expect(menu).not.toBeNull();
    const host = menu!.closest<HTMLElement>("[data-jx-region]")!;
    // While it is open the menu IS edit chrome: a press inside it operates ON the caret session
    // Rather than committing it.
    expect(isEditChromeTarget(host)).toBe(true);

    // The kit's menu is an `auto` popover, so the platform light-dismisses it on an outside press.
    await raf();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush(2);

    expect(document.querySelector("#layer-popover jx-menu-item")).toBeNull();
    // The handle is released, so the detached host is nobody's chrome any more — a stale one would
    // Keep swallowing the commit-guard for a menu the author already closed.
    expect(isEditChromeTarget(host)).toBe(false);
    anchor.remove();
  });
});

// ─── Entering a bar whose every control is refused ───────────────────────────

/**
 * What `onToolbarKeydown`'s two "nothing can act" branches stood for, re-authored against the
 * contract rather than against the ring that used to implement it.
 *
 * The roving caret is `jx-action-group`'s now, and it refuses to land on a control that cannot act.
 * ONE shape (§8.6) means such a bar still draws every control, so the honest statement is: the
 * chord is claimed, the bar is still whole, and the keyboard does not stop on a refusal.
 */
describe("⌥↑ into a bar where nothing can act", () => {
  test("claims the key, keeps every control, and lands on none of them", async () => {
    initBlockActionBar({ getCanvasMode: () => "design", navigateToComponent: () => {} });
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true }, selection: { count: 1 } }),
    });
    registry.registerAll([record("test.refused")]);
    // Every record refused, and the fixed chrome refused with it: the root has no parent to
    // Select and no tag to convert to.
    registry.get("test.refused")!.enablement = () => false;
    useCommandRegistry(registry);
    /* A component instance AT THE ROOT is the one selection on which every control is refused: no
       parent to select, no tag to convert to, no inline markup to format — and the one registry
       verb above is refused too. */
    componentRegistry.push({ path: "components/card.json", tagName: "x-card" } as never);
    setup({ tagName: "x-card" } as JxMutableNode, []);

    const sentinel = document.createElement("button");
    document.body.append(sentinel);
    sentinel.focus();

    renderBlockActionBar();
    await flush(3);
    const buttons = [
      ...document.querySelectorAll<HTMLElement>('#layer-popover [part="tools"] jx-action-button'),
    ];
    expect(buttons.length).toBeGreaterThan(0);
    expect(
      buttons.every((b) => b.querySelector('[part="control"]')!.hasAttribute("disabled")),
    ).toBe(true);

    const e = new KeyboardEvent("keydown", { altKey: true, cancelable: true, key: "ArrowUp" });
    handleBlockBarEntryKey(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(sentinel);

    sentinel.remove();
    componentRegistry.length = 0;
    dismissBlockActionBar();
    await flush();
  });
});

// ─── The drag handle across a re-render ──────────────────────────────────────

/**
 * The handle's `ref` carries its own release-before-install guard, and it is SHADOWED:
 * {@link renderBlockActionBar} releases `view.selDragCleanup` at the top of the very pass that
 * re-mounts the handle, so by the time the `ref` runs the field is always null. What the two guards
 * protect between them is one fact — a re-render never leaves two pragmatic-dnd registrations live
 * on the handle — and that fact is what this pins, from the registrations themselves rather than
 * from a stand-in assigned to `view.selDragCleanup` by hand.
 */
describe("the drag handle across a re-render", () => {
  const handle = () =>
    document.querySelector('#layer-popover [part="drag-handle"]') as HTMLElement | null;

  beforeEach(() => {
    dnd.log.length = 0;
    dnd.elements.length = 0;
    initBlockActionBar({ getCanvasMode: () => "design", navigateToComponent: () => {} });
  });

  afterEach(async () => {
    dismissBlockActionBar();
    await flush();
    if (view.selDragCleanup) {
      view.selDragCleanup();
      view.selDragCleanup = null;
    }
  });

  test("a repaint installs nothing new: one handle, one registration", async () => {
    setup(TWO_PARAGRAPHS, ["children", 1]);

    renderBlockActionBar();
    await flush(3);
    const first = handle();
    expect(first).not.toBeNull();
    expect(dnd.log).toEqual(["install#0"]);
    expect(dnd.elements).toEqual([first!]);

    /* The document reconciles by assignment, so the handle's node is the one it was and its
       registration is untouched. The lit bar re-created the node on every pass and had to release
       before installing to keep the count at one; the mount removes the race rather than ordering
       it. */
    renderBlockActionBar();
    await flush(3);
    expect(handle()).toBe(first);
    expect(dnd.log).toEqual(["install#0"]);
    expect(view.selDragCleanup).toBeInstanceOf(Function);
  });

  test("a pass that dismisses the bar releases, because the handle's node goes with it", async () => {
    const tab = setup(TWO_PARAGRAPHS, ["children", 1]);
    renderBlockActionBar();
    await flush(3);
    expect(dnd.log).toEqual(["install#0"]);

    /* Clearing the selection sends the bar down one of the dismissal paths, and `visible: false`
       takes the handle's node out of the document. A registration left live there is a dnd
       listener on a detached node for the life of the window. */
    tab.session.selection = [];
    renderBlockActionBar();
    await flush(3);

    expect(handle()).toBeNull();
    expect(dnd.log).toEqual(["install#0", "release#0"]);
    expect(view.selDragCleanup).toBeNull();

    // …and drawing again installs exactly one more, on the new node.
    tab.session.selection = [["children", 1]];
    renderBlockActionBar();
    await flush(3);
    expect(dnd.log).toEqual(["install#0", "release#0", "install#1"]);
    expect(dnd.elements[1]!.getAttribute("part")).toBe("drag-handle");
  });

  test("a repaint while the Link popover is open leaves the handle draggable", async () => {
    setup(TWO_PARAGRAPHS, ["children", 1]);
    renderBlockActionBar();
    await flush(3);
    const first = handle();
    expect(dnd.log).toEqual(["install#0"]);

    openLinkPopoverFromShortcut();
    await flush(2);
    expect(isLinkPopoverOpen()).toBe(true);

    /* Every repaint reaches here (`applyTransform` → `renderOnly("overlays")` → this), so a pan, a
       zoom or a pane resize runs it while the URL field holds the caret. Releasing the drag
       registration on such a pass stranded the ⠿ handle on screen and inert, because dismissing
       the popover does not re-render the bar. */
    renderBlockActionBar();
    await flush(3);

    expect(handle()).toBe(first);
    expect(dnd.log).toEqual(["install#0"]);
    expect(view.selDragCleanup).toBeInstanceOf(Function);

    // And closing the popover leaves it still draggable, without a re-render having been needed.
    dismissLinkPopover();
    expect(view.selDragCleanup).toBeInstanceOf(Function);
  });
});
