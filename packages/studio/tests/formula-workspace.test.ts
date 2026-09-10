/**
 * ⑪ · Logic — the Bottom dock's tab (`panels/formula-workspace.ts` over
 * `surfaces/logic-workspace.json`).
 *
 * It no longer takes over the canvas: P8.5 moved it into the dock so the page whose values it
 * computes stays on screen beside it, and this batch made it a **Jx document over the UI kit**. So
 * every assertion below is about a ROLE, a PART or a REGION — the surface names no class of its own
 * — and the tests drive the seam the dock drives: `syncLogicPanel` against a painted body that
 * carries the tab's region, which is exactly what `afterRender` is handed.
 *
 * What is pinned: the shared header and its two verbs, the chip pipeline with its live badges, the
 * expression editor and the value trees as ISLANDS the document announced, the result line's three
 * answers, and a Close that clears the target. Edits immutably replace the chip-selected sub-node
 * inside the root and write the whole node back through `transactDoc`, so undo restores the
 * previous tree. The wiring into the dock (reveal, strip, `afterRender`) is
 * `tests/bottom-dock.test.ts`; the adapter's own seam is `tests/logic-workspace-surface.test.ts`.
 */
import {
  flush,
  pointer,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initShellRefs } from "../src/store";
import { activeCanvasSurface } from "../src/canvas/canvas-surface";
import { bottomPanelRegion } from "../src/ui/regions";
import { undo } from "../src/tabs/transact";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { shell } from "../src/shell";

import type { JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";

/**
 * The code surface is DOUBLED, and the double is what makes the seam assertable.
 *
 * `panels/editors.ts` mounts a real Monaco against a real `StudioPlatform`, neither of which
 * belongs in a test about this tab's markup — and the mount is driven by the painted DOM rather
 * than by a render call, so the only thing this file can honestly say about it is _what it was
 * handed and when_. That is exactly what the double records: every element `syncFunctionEditor` was
 * given, in order.
 */
const monacoSyncs: HTMLElement[] = [];
let functionCloses = 0;
void mock.module("../src/panels/editors.js", () => ({
  CODE_HOST_SELECTOR: '[part="code-host"]',
  closeFunctionEditor: async () => {
    functionCloses += 1;
  },
  syncFunctionEditor: (host: HTMLElement) => {
    monacoSyncs.push(host);
  },
}));

const {
  closeFormulaWorkspace,
  formulaRoot,
  logicTarget,
  openLogicTarget,
  revealLogicPanel,
  syncLogicPanel,
  syncLogicView,
  workspaceView,
} = await import("../src/panels/formula-workspace");

/**
 * Take the tab down the way the dock does, and the ONLY way it can be taken down.
 *
 * There is no exported disposer, on purpose: the teardown is a repaint whose body is not Logic's —
 * another tab selected, or a collapsed dock handing every tab the emptied host — and an export that
 * only tests reached would be a second answer to that (`tests/reachability.test.ts`).
 */
function unmountLogicTab(): void {
  delete dock.dataset["jxRegion"];
  syncLogicPanel(dock);
}

/* The panels of the FOCUSED pane's stage. Panels belong to a pane's surface now, not to the
   app (`src/canvas/canvas-surface.ts`); the array identity is stable, so a module-level
   binding still sees what the render mutated. */
const canvasPanels = activeCanvasSurface().panels;

document.body.innerHTML = `<div id="app"><div class="pane-stage" data-jx-region="pane.primary"></div><div id="logic"></div></div>`;
initShellRefs();
/* The primary pane's stage. It is the `.pane-stage` the fixture above wrote, adopted rather than
   queried by id: there is no `#canvas-wrap`, and the surface record is what every renderer
   resolves through. */
const canvasWrap = registerPrimaryStage().wrap;
/**
 * Stands in for the dock's `[part="dock-body"]`.
 *
 * The region stamp is not decoration: the dock runs EVERY tab's `afterRender` against one body, so
 * "is this mine?" is a question `syncLogicPanel` answers off this attribute. Clearing it is how a
 * test says "Problems is showing now".
 */
const dock = document.querySelector("#logic") as HTMLElement;

function docFixture(): JxMutableNode {
  return {
    children: [
      {
        onclick: {
          $expression: { operator: "+=", target: { $ref: "#/state/count" }, value: 1 },
        },
        tagName: "button",
        textContent: "Add",
      },
    ],
    state: {
      count: { default: 2, type: "integer" },
      mathArgs: {
        $expression: {
          operator: "call",
          target: { $ref: "window#/Math/max" },
          value: [{ operator: "+", target: 1, value: 2 }, 5],
        },
      },
      total: {
        $expression: {
          operator: "*",
          target: { operator: "+", target: { $ref: "#/state/count" }, value: 1 },
          value: 10,
        },
      },
    },
    tagName: "div",
  } as unknown as JxMutableNode;
}

/** One dock paint of the Logic tab, exactly as `panels/bottom-dock.ts` runs it. */
async function paint(): Promise<void> {
  syncLogicPanel(dock);
  // `mountSurface` resolves when the DOCUMENT has rendered; the kit elements inside it settle
  // Their own templates a connectedCallback later, and a `$switch` toggles on a microtask.
  await flush(3);
}

/** Open a fixture tab with a canvas dataScope snapshot and a workspace target, then paint. */
async function openWorkspace(
  editing?: Record<string, unknown> | null,
  scope?: Record<string, unknown> | null,
): Promise<Tab> {
  const tab = resetWorkspaceWithTab(docFixture(), { id: "fw-tab" });
  tab.session.canvas.scope = scope === undefined ? { count: 2 } : scope;
  tab.session.ui.editingFormula = (
    editing === undefined ? { defName: "total", type: "def" } : editing
  ) as never;
  await paint();
  return tab;
}

function part(name: string): HTMLElement | null {
  return dock.querySelector<HTMLElement>(`[part="${name}"]`);
}

function parts(name: string): HTMLElement[] {
  return [...dock.querySelectorAll<HTMLElement>(`[part="${name}"]`)];
}

function text(name: string): string {
  return part(name)?.textContent?.trim() ?? "";
}

/**
 * The name a kit control announces itself with.
 *
 * Read off the inner `[part="control"]` — the node the kit forwards ARIA to, and the one a screen
 * reader reaches — because a `label` passed as a property never becomes an attribute on the host.
 */
function accessibleName(name: string): string | null | undefined {
  return part(name)?.querySelector('[part="control"]')?.getAttribute("aria-label");
}

/** One chip of the pipeline, by the label it reads. */
function chipByLabel(label: string): HTMLElement {
  const chip = parts("chip").find((c) => c.getAttribute("title") === label);
  if (!chip) {
    throw new Error(
      `no chip labelled "${label}" — the strip reads: ${parts("chip")
        .map((c) => c.getAttribute("title"))
        .join(", ")}`,
    );
  }
  return chip;
}

/**
 * A row of the formula palette, by its name.
 *
 * The palette is a Jx document mounted in its own popover slot (`surfaces/formula-palette.ts`), so
 * it is addressed by `part` inside that slot rather than by the `.quick-search-*` classes it used
 * to borrow from the command palette's stylesheet.
 */
function paletteItem(name: string): HTMLElement | undefined {
  const host = document.querySelector('[data-jx-region="overlay.menu:formula-palette"]');
  return [...(host?.querySelectorAll('[part="item"]') ?? [])].find(
    (el) => el.querySelector('[part="name"]')?.textContent === name,
  ) as HTMLElement | undefined;
}

/**
 * The selected sub-node form's operator picker.
 *
 * Inside `[part="editor-host"]`, which is where it must be: the expression editor is still a lit
 * surface over Spectrum, so it reaches this document as an ISLAND rather than as markup
 * (studio-ui-guidelines.md §9.4), and asserting on the host is what says the seam held.
 */
/**
 * The operator picker of the node the editor is showing — the FIRST one in the island.
 *
 * The editor is a document now and nests by emitting more rows, so a formula with an operand
 * formula inside it has two operator pickers side by side; the selected node's is the first.
 */
function operatorPicker(): HTMLSelectElement {
  const picker = part("editor-host")?.querySelector('[part="operator"] [part="control"]');
  if (!picker) {
    throw new Error("no operator picker in the editor island");
  }
  return picker as HTMLSelectElement;
}

function changeValue(el: HTMLElement & { value: string }, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function docState(): Record<string, never> {
  return (activeTab.value?.doc.document.state ?? {}) as Record<string, never>;
}

beforeEach(() => {
  resetStudioState();
  unmountLogicTab();
  monacoSyncs.length = 0;
  functionCloses = 0;
  dock.replaceChildren();
  dock.dataset["jxRegion"] = bottomPanelRegion("logic");
  canvasWrap.textContent = "";
  // @ts-expect-error -- _$litPart$ is Lit's private render-part marker, not in the DOM types
  delete canvasWrap["_$litPart$"];
});

afterEach(() => {
  // The mount is module state — one dock, one tab — so a suite that left one standing would hand
  // The next test a document projecting a tab it has already closed.
  unmountLogicTab();
});

// ─── Layout ───────────────────────────────────────────────────────────────────

describe("def-type target", () => {
  test("draws the header, the chips with their live badges, the editor island, the rail and the result", async () => {
    await openWorkspace();

    expect(part("workspace")).not.toBeNull();
    expect(text("title")).toContain("total");
    expect(text("kind")).toBe("state expression");

    // Chip pipeline: head operand (count), then the + and * operator links.
    expect(parts("chip").map((c) => c.getAttribute("title"))).toEqual(["count", "+", "*"]);
    // Live badges from the dataScope snapshot: count=2 → 2, 3, 30 along the chain.
    // Scoped to the strip: the editor beside it draws badges of its own on the rows it shows.
    expect(
      [...part("chips")!.querySelectorAll('[part="badge"]')].map((b) => b.textContent?.trim()),
    ).toEqual(["2", "3", "30"]);

    // Main pane: the selected sub-node form (root by default), drawn into the announced island.
    expect(part("editor-host")?.querySelector('[part="expression"]')).not.toBeNull();
    expect(text("selected-node")).toBe("root");
    expect(operatorPicker().value).toBe("*");

    // The data rail: one entry per name in the snapshot, each with its own value tree.
    expect(parts("entry-name").map((e) => e.textContent)).toEqual(["count"]);
    expect(part("tree-host")?.textContent).toContain("2");

    // The result line, and the tone that says which of its three answers this is.
    expect(text("result")).toContain("= 30");
    expect(part("result")?.dataset["tone"]).toBe("value");

    // Header affordances: the catalog browser and Close, each named for what it does, on the
    // Control the reader actually focuses rather than on the wrapper.
    expect(accessibleName("catalog")).toBe("Browse catalog");
    expect(text("catalog")).toBe("Catalog");
    expect(accessibleName("close")).toBe("Close");
  });

  test("leaves the canvas alone — the page it computes is the whole point of the move", async () => {
    const tab = resetWorkspaceWithTab(docFixture(), { id: "fw-tab" });
    canvasPanels.push({ ready: true } as never);
    canvasWrap.textContent = "the rendered page";

    tab.session.ui.editingFormula = { defName: "total", type: "def" } as never;
    await paint();

    // The takeover cleared the stage before drawing itself over it. Nothing here touches the
    // Mounted panels or the painted DOM, which is what keeps the canvas patchable and on screen.
    expect(canvasPanels).toHaveLength(1);
    expect(canvasWrap.textContent).toBe("the rendered page");
    expect(part("workspace")).not.toBeNull();
  });

  test("says the preview is unavailable, and draws no badges, without a scope snapshot", async () => {
    await openWorkspace({ defName: "total", type: "def" }, null);
    expect(part("result")?.dataset["tone"]).toBe("pending");
    expect(text("result")).toContain("Preview unavailable");
    expect(parts("badge")).toHaveLength(0);
    // The rail says what it is FOR rather than that it is empty (§11.1).
    expect(text("rail")).toContain("appear here once the canvas has rendered");
    expect(part("tree-host")).toBeNull();
  });

  test("draws the evaluation error in the result line, in the error tone", async () => {
    const tab = await openWorkspace();
    // An unknown operator makes the engine throw during preview.
    (docState().total! as { $expression: Record<string, unknown> }).$expression = {
      operator: "bogus",
      target: null,
    };
    tab.session.ui.editingFormula = { defName: "total", type: "def" } as never;
    await paint();
    expect(part("result")?.dataset["tone"]).toBe("error");
    expect(text("result")).not.toBe("");
  });

  test("shows the empty state — and keeps the header and its Close — when the target holds no expression", async () => {
    await openWorkspace({ defName: "missing", type: "def" });
    expect(text("empty-message")).toContain("No expression found");
    // The header is the shared one: a target that resolved to nothing is still a target, and
    // Taking the Close away would strand the reader in a tab they cannot leave.
    expect(text("title")).toContain("missing");
    expect(part("close")).not.toBeNull();
    expect(part("chips")).toBeNull();
  });
});

// ─── Chip selection ───────────────────────────────────────────────────────────

describe("chip selection", () => {
  test("clicking an operator chip selects that sub-node in the form", async () => {
    await openWorkspace();
    pointer(chipByLabel("+"), "click");
    await flush();
    expect(operatorPicker().value).toBe("+");
    expect(text("selected-node")).toBe("count › +");
  });

  test("clicking the head operand chip resolves to its enclosing operator node", async () => {
    await openWorkspace();
    pointer(chipByLabel("count"), "click");
    await flush();
    // The head chip targets a $ref operand; the nearest expression-node ancestor is the + link.
    expect(operatorPicker().value).toBe("+");
  });

  test("the selection does not carry across a retarget", async () => {
    const tab = await openWorkspace();
    pointer(chipByLabel("+"), "click");
    await flush();
    expect(operatorPicker().value).toBe("+");

    tab.session.ui.editingFormula = {
      eventKey: "onclick",
      path: ["children", 0],
      type: "event",
    } as never;
    await flush(2);
    // The stored selection is KEYED by target rather than reset during the projection — a
    // Projection that writes the state it reads is a reactive loop, and this surface IS an effect.
    expect(operatorPicker().value).toBe("+=");
  });

  test("a selection kept for one target does not leak into another tab's identical one", async () => {
    await openWorkspace();
    pointer(chipByLabel("+"), "click");
    await flush();
    expect(operatorPicker().value).toBe("+");

    const other = resetWorkspaceWithTab(docFixture(), { id: "other-tab" });
    other.session.canvas.scope = { count: 2 };
    other.session.ui.editingFormula = { defName: "total", type: "def" } as never;
    await flush(2);
    expect(operatorPicker().value).toBe("*");
  });
});

// ─── Write-through ────────────────────────────────────────────────────────────

describe("editing", () => {
  test("editing a sub-node writes the whole root back and preserves the rest of the tree", async () => {
    const tab = await openWorkspace();
    pointer(chipByLabel("+"), "click");
    await flush();
    changeValue(operatorPicker(), "-");
    await flush(2);

    const expr = (docState().total! as { $expression: Record<string, unknown> }).$expression;
    // The selected sub-node changed…
    expect((expr.target as Record<string, unknown>).operator).toBe("-");
    // …while the untouched siblings/parents survived intact.
    expect(expr.operator).toBe("*");
    expect(expr.value).toBe(10);

    // The surface re-projected against the updated document, with no repaint asked for.
    expect(operatorPicker().value).toBe("-");

    // The write went through transactDoc: one undo step restores the previous tree.
    undo(tab);
    const restored = (docState().total! as { $expression: Record<string, unknown> }).$expression;
    expect((restored.target as Record<string, unknown>).operator).toBe("+");
    expect((restored.target as Record<string, unknown>).value).toBe(1);
  });

  test("picking a catalog entry replaces the selected sub-node", async () => {
    await openWorkspace();
    pointer(part("catalog")!, "click");
    await flush();
    const item = paletteItem("?:");
    expect(item).toBeTruthy();
    pointer(item!, "click");

    const expr = (docState().total! as { $expression: Record<string, unknown> }).$expression;
    expect(expr.operator).toBe("?:");
  });

  test("picking a packaged formula vendors its state def before inserting the call", async () => {
    await openWorkspace();
    pointer(part("catalog")!, "click");
    await flush();
    const item = paletteItem("sum");
    expect(item).toBeTruthy();
    pointer(item!, "click");

    // The packaged def was copied into document state (the project owns the copy)…
    const sum = docState().sum as { $expression?: unknown; parameters?: unknown[] } | undefined;
    expect(sum?.$expression).toBeTruthy();
    expect(Array.isArray(sum?.parameters)).toBe(true);
    // …and the selected node became a call to it.
    const expr = (docState().total! as { $expression: Record<string, unknown> }).$expression;
    expect(expr).toMatchObject({ operator: "call", target: { $ref: "#/state/sum" } });
  });

  test("editing a sub-node inside an array operand writes through the array index", async () => {
    await openWorkspace({ defName: "mathArgs", type: "def" });
    // The first call argument is an expression node → a parenthesized group chip.
    pointer(chipByLabel("(1 › +)"), "click");
    await flush();
    changeValue(operatorPicker(), "-");

    const expr = (docState().mathArgs! as { $expression: Record<string, unknown> }).$expression;
    const args = expr.value as Record<string, unknown>[];
    expect(args[0]!.operator).toBe("-");
    expect(args[0]!.target).toBe(1);
    // The sibling argument and the call node itself survived intact.
    expect(args[1]).toBe(5 as never);
    expect(expr.operator).toBe("call");
  });
});

// ─── Close ────────────────────────────────────────────────────────────────────

describe("close", () => {
  test("the Close button clears editingFormula", async () => {
    const tab = await openWorkspace();
    pointer(part("close")!, "click");
    expect(tab.session.ui.editingFormula).toBeNull();
  });

  test("with no target the tab says what it is for instead of painting a blank box", async () => {
    const tab = await openWorkspace();
    closeFormulaWorkspace();
    expect(tab.session.ui.editingFormula).toBeNull();
    await flush(2);
    expect(part("frame")).toBeNull();
    expect(text("empty-message")).toContain("Open a formula or a function to edit it here");
  });
});

// ─── The dock seam ────────────────────────────────────────────────────────────

describe("syncLogicPanel", () => {
  test("mounts nothing into a body another tab was painted into", async () => {
    await openWorkspace();
    expect(part("workspace")).not.toBeNull();

    // What the dock does when Problems is selected: it paints that tab into the same body and
    // Stamps ITS region. Logic's `afterRender` still runs, and must take itself down.
    dock.dataset["jxRegion"] = bottomPanelRegion("problems");
    await paint();
    expect(part("workspace")).toBeNull();
  });

  test("re-mounts after a repaint took the document away", async () => {
    await openWorkspace();
    const first = part("workspace");
    expect(first).not.toBeNull();

    // A collapsed dock disposes its whole chrome, which takes this document with it — and the
    // Handle is left holding a root that is no longer in the page.
    dock.replaceChildren();
    await paint();
    const second = part("workspace");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  test("is idempotent: a repaint of the tab already showing keeps the same root", async () => {
    await openWorkspace();
    const first = part("workspace");
    await paint();
    expect(part("workspace")).toBe(first);
  });
});

// ─── The code surface ─────────────────────────────────────────────────────────

describe("the code surface", () => {
  test("draws Monaco's host instead of the pipeline, and hands the dock body to its mount", async () => {
    const tab = await openWorkspace();
    monacoSyncs.length = 0;
    tab.session.ui.editingFunction = { defName: "count", type: "def" } as never;
    await flush(2);

    expect(part("code-host")).not.toBeNull();
    expect(part("chips")).toBeNull();
    expect(part("result")).toBeNull();
    /* Monaco MEASURES its container, so the announcement only says the surface now exists: the
       mount is handed the DOCK BODY a microtask later, by which time the host it will find in
       there is actually in the page. Handing over the announced node would mount an editor into a
       fragment and measure zero. */
    expect(monacoSyncs.at(-1)).toBe(dock);
    expect(part("code-host")!.isConnected).toBe(true);
  });

  test("Close on the code surface closes the FUNCTION editor, and leaves the formula alone", async () => {
    const tab = await openWorkspace();
    tab.session.ui.editingFunction = { defName: "count", type: "def" } as never;
    await flush(2);

    pointer(part("close")!, "click");
    expect(functionCloses).toBe(1);
    // One tab, two surfaces: the formula target is still there underneath, and the code editor's
    // Own close is what clears its field.
    expect(tab.session.ui.editingFormula).not.toBeNull();
  });

  test("a repaint for another tab still reaches the code editor — that is how it is torn down", async () => {
    await openWorkspace();
    monacoSyncs.length = 0;

    dock.dataset["jxRegion"] = bottomPanelRegion("problems");
    syncLogicPanel(dock);

    // No `[part="code-host"]` under this element any more, which is exactly the question
    // `syncFunctionEditor` asks in order to drop an instance attached to DOM nobody can see.
    expect(monacoSyncs).toEqual([dock]);
  });
});

// ─── The data rail ────────────────────────────────────────────────────────────

describe("the data rail", () => {
  test("gives every entry in the snapshot its own announced tree, filled with that value", async () => {
    await openWorkspace({ defName: "total", type: "def" }, { count: 2, items: ["a", "b"] });

    expect(parts("entry").map((e) => e.dataset["entry"])).toEqual(["count", "items"]);
    expect(parts("entry-name").map((e) => e.textContent)).toEqual(["count", "items"]);

    /* The trees are the repair, not the port: the takeover rendered a host that nothing ever
       filled, so this box had been empty since the value tree became a document of its own. */
    const trees = parts("tree-host");
    expect(trees).toHaveLength(2);
    expect(trees[0]!.textContent).toContain("2");
    expect(trees[1]!.textContent).toContain("a");
    expect(trees[1]!.textContent).toContain("b");
  });
});

// ─── The callbacks that are not signals ───────────────────────────────────────

describe("syncLogicView", () => {
  test("a raised limit inside a value tree redraws that tree in place", async () => {
    const items = Array.from({ length: 25 }, (_, i) => `row-${i}`);
    await openWorkspace({ defName: "total", type: "def" }, { items });

    const tree = part("tree-host")!;
    // The tree caps an array at 20 and ends in a real button, because the reader opened this rail
    // BECAUSE item 24 was the surprising one.
    expect(tree.textContent).toContain("row-19");
    expect(tree.textContent).not.toContain("row-24");
    const more = tree.querySelector<HTMLElement>('[part="more"]')!;
    expect(more.textContent).toContain("5 more");

    /* Nothing reactive changed here — a raised limit is module state inside the value tree — so
       this is the path `syncLogicView` exists for: the projection is pushed by the callback, and
       the tree the flow is HOLDING is repainted rather than re-found. */
    pointer(more, "click");
    await flush(2);
    expect(part("tree-host")!.textContent).toContain("row-24");
  });

  test("is inert with nothing mounted, rather than throwing at a preview that lands late", () => {
    // A live preview resolves ~100ms after the projection that asked for it, and the dock may have
    // Been collapsed in between. The callback outlives the mount by construction.
    unmountLogicTab();
    expect(() => syncLogicView()).not.toThrow();
  });
});

describe("a control that outlives the formula it belongs to", () => {
  test("a control INSIDE the surface cannot: closing the target takes it away in the same turn", async () => {
    await openWorkspace();
    expect(part("catalog")).not.toBeNull();
    expect(parts("chip")).not.toHaveLength(0);

    /* The projection is an effect and the runtime reconciles it synchronously, so there is no
       frame in which the target is gone and its buttons are still pressable. That is what makes
       every in-surface control safe without a staleness check of its own — and it is a fact about
       this seam rather than an assumption, so it is asserted with no `await` between the two. */
    closeFormulaWorkspace();
    expect(part("catalog")).toBeNull();
    expect(parts("chip")).toHaveLength(0);
  });

  test("an OVERLAY can, and a catalog pick that lands after the target closed writes nothing", async () => {
    const tab = await openWorkspace();
    pointer(part("catalog")!, "click");
    await flush();
    const item = paletteItem("?:");
    expect(item).toBeTruthy();

    // The palette is an overlay: it outlives the surface that opened it, and the pick it hands
    // Back names a sub-node of a formula that is no longer open.
    closeFormulaWorkspace();
    await flush(2);
    pointer(item!, "click");

    const expr = (docState().total! as { $expression: Record<string, unknown> }).$expression;
    expect(expr.operator).toBe("*");
    expect(tab.doc.dirty).toBe(false);
  });
});

// ─── The projection ───────────────────────────────────────────────────────────

describe("workspaceView", () => {
  test("is the empty state with no tab open at all", () => {
    closeAllTabs();
    const view = workspaceView();
    expect(view.state).toBe("empty");
    expect(view.emptyMessage).toContain("beside the page it computes");
  });

  test("the function target draws the code surface, with no chips and no catalog", async () => {
    const tab = await openWorkspace();
    tab.session.ui.editingFunction = { defName: "count", type: "def" } as never;
    const view = workspaceView();
    expect(view.surface).toBe("code");
    expect(view.glyph).toBe("ƒ");
    expect(view.kind).toBe("function body");
    expect(view.hasCatalog).toBe(false);
    expect(view.chips).toEqual([]);
  });

  test("an event-type function target is named by its event key", async () => {
    const tab = await openWorkspace();
    tab.session.ui.editingFunction = {
      eventKey: "onclick",
      path: ["children", 0],
      type: "event",
    } as never;
    const view = workspaceView();
    expect(view.name).toBe("onclick");
    expect(view.kind).toBe("event handler");
    expect(view.titleHint).toBe("onclick");
  });

  test("a mutating root reports the effect as a note rather than as a value", async () => {
    await openWorkspace({ eventKey: "onclick", path: ["children", 0], type: "event" });
    const view = workspaceView();
    expect(view.resultTone).toBe("value");
    expect(view.hasResultNote).toBe(true);
    expect(view.resultNote).toBe("(mutates target)");
  });
});

// ─── The target, and the reveal ───────────────────────────────────────────────

describe("logicTarget", () => {
  test("is null with no tab and null with no target", () => {
    expect(logicTarget(null)).toBeNull();
    resetWorkspaceWithTab(docFixture(), { id: "fw-tab" });
    expect(logicTarget()).toBeNull();
  });

  test("the function editor wins when both fields are set", async () => {
    const tab = await openWorkspace();
    tab.session.ui.editingFunction = { defName: "count", type: "def" } as never;
    expect(logicTarget()?.surface).toBe("function");
    await flush(2);
    // One tab, two surfaces: Monaco's island replaces the chip pipeline.
    expect(part("code-host")).not.toBeNull();
    expect(part("chips")).toBeNull();
    expect(text("title")).toContain("count");
  });
});

describe("revealLogicPanel", () => {
  // The canvas no longer calls anything when a formula opens: it keeps rendering the page, and the
  // Dock reveals its own tab. This is the reveal itself, and the stage is untouched by it.
  test("selects the Logic tab, opens the dock, and leaves the stage alone", async () => {
    await openWorkspace();
    canvasWrap.textContent = "the rendered page";
    shell.bottomTab = "problems";
    shell.docks.bottom.collapsed = true;

    revealLogicPanel();

    expect(shell.bottomTab).toBe("logic");
    expect(shell.docks.bottom.collapsed).toBe(false);
    expect(canvasWrap.textContent).toBe("the rendered page");
  });
});

/**
 * The one WRITER of the two fields {@link logicTarget} reads, and therefore the one place the "one
 * tab, one target" rule can be kept. Every opener used to set its own field and leave the other
 * alone, and `logicTarget` gives the function editor the tie — so "Open in formula workspace" while
 * a Function body was open did nothing visible at all.
 */
describe("openLogicTarget", () => {
  test("opening a formula takes the target from an open function", async () => {
    const tab = await openWorkspace();
    tab.session.ui.editingFunction = { defName: "count", type: "def" } as never;
    expect(logicTarget()?.surface).toBe("function");

    openLogicTarget({ editing: { defName: "mathArgs", type: "def" }, surface: "formula" });

    expect(tab.session.ui.editingFunction).toBeNull();
    expect(tab.session.ui.editingFormula).toEqual({ defName: "mathArgs", type: "def" });
    expect(logicTarget()?.surface).toBe("formula");
    await flush(2);
    expect(text("title")).toContain("mathArgs");
  });

  test("opening a function takes the target from an open formula", async () => {
    const tab = await openWorkspace();
    expect(logicTarget()?.surface).toBe("formula");

    openLogicTarget({
      editing: { eventKey: "onclick", path: ["children", 0], type: "event" },
      surface: "function",
    });

    expect(tab.session.ui.editingFormula).toBeNull();
    expect(logicTarget()?.surface).toBe("function");
  });

  test("reveals the surface itself, so a closed dock is not a dead click", async () => {
    await openWorkspace();
    shell.bottomTab = "problems";
    shell.docks.bottom.collapsed = true;

    // Same target the tab already holds: nothing CHANGES, so the dock's once-per-target effect has
    // Nothing to fire on. The gesture is a separate event and says so.
    openLogicTarget({ editing: { defName: "total", type: "def" }, surface: "formula" });

    expect(shell.bottomTab).toBe("logic");
    expect(shell.docks.bottom.collapsed).toBe(false);
  });

  test("is inert with no tab open rather than throwing", () => {
    closeAllTabs();
    expect(() =>
      openLogicTarget({ editing: { defName: "total", type: "def" }, surface: "formula" }),
    ).not.toThrow();
  });
});

// ─── Event-type target ────────────────────────────────────────────────────────

describe("event-type target", () => {
  test("resolves the element event binding's $expression and edits write through", async () => {
    const tab = await openWorkspace({ eventKey: "onclick", path: ["children", 0], type: "event" });

    expect(text("title")).toContain("onclick");
    expect(operatorPicker().value).toBe("+=");

    changeValue(operatorPicker(), "=");
    const button = (tab.doc.document.children as Record<string, unknown>[])[0]!;
    const binding = button.onclick as { $expression: Record<string, unknown> };
    expect(binding.$expression.operator).toBe("=");
    expect(binding.$expression.value).toBe(1);
  });

  test("formulaRoot returns null for a non-expression binding", async () => {
    const tab = await openWorkspace();
    const editing = { eventKey: "onmissing", path: ["children", 0], type: "event" } as const;
    expect(formulaRoot(tab, editing as never)).toBeNull();
  });

  test("formulaRoot returns null when the target names neither a def nor a full event", async () => {
    const tab = await openWorkspace();
    // Def target without a defName, and an event target without a path — both fall through.
    expect(formulaRoot(tab, { type: "def" } as never)).toBeNull();
    expect(formulaRoot(tab, { eventKey: "onclick", type: "event" } as never)).toBeNull();
  });
});
