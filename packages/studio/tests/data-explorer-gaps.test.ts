/**
 * Coverage for src/panels/data-explorer.ts — the type label, the per-tab expansion record and the
 * value tree.
 *
 * The panel's own row list is gone: plan §11.2 folds "definitions + live values into one row", so
 * the rows belong to `surfaces/panel-signals.json` and the cases that used to drive
 * `renderDataExplorerTemplate` drive that instead. What is left in this module is the machinery
 * those rows read, which is what this file exercises.
 *
 * **Both halves are documents now**, so two things follow. Everything is addressed by `part` — a
 * signal row is `[part="entry"]` and a tree line is `[part="row"]`, which is why the two do not
 * share a name — and every paint is awaited, because a document mounts asynchronously and a `$map`
 * re-renders on a microtask.
 */
import {
  clearSignalPanels,
  drawSignals,
  editorFor,
  marked,
  openEntry,
  settle,
  summaryText,
  summaryTone,
  toggleEntry,
} from "./signals-panel-fixture";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dataTreeRows, paintDataTree, resetDataRowExpansion } from "../src/panels/data-explorer";
import { activeTab } from "../src/workspace/workspace";

const containers: HTMLElement[] = [];

/** A container in the document, because a mounted document needs one that is connected. */
function stage(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  return container;
}

/** What the last {@link mountData} drew, and the hooks it was given. */
interface Mounted {
  container: HTMLElement;
  ctx: { renderLeftPanel: () => void };
  counts: { repaints: number; refreshes: number };
}

/** Mount the merged Data panel over a document with `state`, and a canvas that resolved `scope`. */
async function mountData(
  state: Record<string, unknown>,
  scope: Record<string, unknown> | null,
): Promise<Mounted> {
  const drawn = await drawSignals(state, { scope });
  drawn.resetCounts();
  return {
    container: drawn.panel,
    counts: drawn.counts,
    ctx: { renderLeftPanel: drawn.repaint },
  };
}

beforeEach(() => {
  clearSignalPanels();
});

afterEach(() => {
  clearSignalPanels();
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("the resolved-value column", () => {
  /** What one row's summary says, when the summary is a resolved VALUE rather than a hint. */
  const typeOf = (el: HTMLElement, name: string) =>
    summaryTone(el, name) === "hint" ? undefined : summaryText(el, name);

  test("labels null, pending, arrays, objects and scalars", async () => {
    const { container } = await mountData(
      { arr: {}, flag: {}, missing: {}, nil: {}, obj: {}, txt: {} },
      { arr: [1, 2, 3], flag: true, nil: null, obj: { a: 1, b: 2 }, txt: "hello" },
    );
    expect(typeOf(container, "arr")).toBe("Array(3)");
    expect(typeOf(container, "flag")).toBe("boolean");
    expect(typeOf(container, "missing")).toBe("pending");
    expect(typeOf(container, "nil")).toBe("null");
    expect(typeOf(container, "obj")).toBe("{2}");
    expect(typeOf(container, "txt")).toBe("string");
  });

  test("unwraps Vue refs before labelling", async () => {
    const { container } = await mountData({ count: {} }, { count: { __v_isRef: true, value: 42 } });
    expect(typeOf(container, "count")).toBe("number");
  });

  test("marks null values as pending style", async () => {
    const { container } = await mountData({ nil: {} }, { nil: null });
    expect(summaryTone(container, "nil")).toBe("pending");
  });

  test("pending only PULSES while a refresh is in flight", async () => {
    /*
     * While you are editing, an automatic `Request` is deliberately not fetched, so `pending` is a
     * resting state and an endless pulse is a spinner for something that is not loading. It is also
     * why `probe.idle()` could never call this panel quiet: the screenshot lane timed out on
     * "2 animation(s) running" over a panel that had finished.
     */
    const { container, ctx } = await mountData({ nil: {} }, { nil: null });
    const panel = () => container.querySelector('[part="signals"]')!;
    expect(marked(panel(), "refreshing")).toBe(false);

    activeTab.value!.session.canvas.refreshing = true;
    ctx.renderLeftPanel();
    await settle();
    expect(marked(panel(), "refreshing")).toBe(true);
  });

  test("an entry that cannot HOLD a value never gets the column", async () => {
    // A function and an assignment expression are things the page DOES. They are absent from the
    // Resolved scope for that reason, and the column called every one of them "pending" — which
    // Reads as "still loading" for something that will never load.
    const { container } = await mountData(
      {
        held: { default: 1, type: "number" },
        runIt: { $prototype: "Function", body: "return 1;" },
        setIt: { $expression: { operator: "=", target: { $ref: "#/state/held" }, value: 2 } },
        sum: { $expression: { operator: "+", target: { $ref: "#/state/held" }, value: 2 } },
      },
      { held: 1, sum: 3 },
    );
    const slotFor = (name: string) => (summaryTone(container, name) === "hint" ? "hint" : "value");
    expect(slotFor("held")).toBe("value");
    // …and a formula expression DOES hold one, so it keeps the column.
    expect(slotFor("sum")).toBe("value");
    expect(slotFor("runIt")).toBe("hint");
    expect(slotFor("setIt")).toBe("hint");
  });

  test("with NO scope at all the row says how the entry is defined instead", async () => {
    // One slot, and the value wins it — but only when there is one. A panel opened before the
    // Canvas has rendered knows nothing about any entry, and labelling the whole list "pending"
    // There would be a fact about the panel dressed up as a fact about the data.
    const { container } = await mountData({ greeting: { default: "hi", type: "string" } }, null);
    expect(summaryTone(container, "greeting")).toBe("hint");
    expect(summaryText(container, "greeting")).toBe("string");
  });
});

describe("expansion", () => {
  test("a row shows the definition AND what it resolved to", async () => {
    // The whole point of the merge: one click, and you see how a value is defined next to the value
    // It became. These were two panels, listing the same names, one rail tab apart.
    const { container, counts } = await mountData({ post: {} }, { post: { id: 7, title: "Hi" } });
    expect(container.querySelector('[part="tree-host"]')).toBeNull();

    await toggleEntry(container, "post");
    expect(counts.repaints).toBeGreaterThan(0);

    const editor = editorFor(container, "post");
    expect(editor.querySelector('[part="field"][data-prop="Name"]')).not.toBeNull();
    const tree = editor.querySelector('[part="tree-host"]');
    expect(tree?.textContent).toContain("id:");
    expect(tree?.textContent).toContain("7");
    expect(tree?.textContent).toContain('"Hi"');

    await toggleEntry(container, "post");
    expect(container.querySelector('[part="tree-host"]')).toBeNull();
  });

  test("SEVERAL rows stay open at once — comparing two entries means seeing both", async () => {
    const { container } = await mountData({ a: {}, b: {} }, { a: 1, b: 2 });
    await openEntry(container, "a");
    await openEntry(container, "b");
    expect(container.querySelectorAll('[part="editor"]').length).toBe(2);
    // Two open rows are two documents, each mounted in its own host.
    expect(container.querySelectorAll('[part="tree"]').length).toBe(2);
  });

  test("expansion is PER TAB — it does not follow you to a document without that entry", async () => {
    const first = await mountData({ onlyHere: {} }, {});
    await openEntry(first.container, "onlyHere");
    expect(first.container.querySelectorAll('[part="editor"]').length).toBe(1);

    // A different document, and the module-global Set this replaced would have kept `onlyHere`
    // Marked open — a name the new document does not even define.
    const second = await mountData({ somethingElse: {} }, {});
    expect(second.container.querySelectorAll('[part="editor"]').length).toBe(0);
  });

  test("resetDataRowExpansion drops the focused tab's rows", async () => {
    const { container, ctx } = await mountData({ a: {} }, {});
    await openEntry(container, "a");
    expect(container.querySelectorAll('[part="editor"]').length).toBe(1);
    resetDataRowExpansion();
    ctx.renderLeftPanel();
    await settle();
    expect(container.querySelectorAll('[part="editor"]').length).toBe(0);
  });

  test("with no tab open, writing an expansion is a no-op rather than a crash", async () => {
    const { closeAllTabs } = await import("../src/workspace/workspace");
    closeAllTabs();
    const { isDataRowExpanded, setDataRowExpanded } = await import("../src/panels/data-explorer");
    setDataRowExpanded("ghost", true);
    expect(isDataRowExpanded("ghost")).toBe(false);
    resetDataRowExpansion();
  });
});

describe("the Refresh button", () => {
  test("re-fetches through refreshData, then re-renders the panel", async () => {
    const { container, counts } = await mountData({ a: {} }, {});
    (container.querySelector('[part="refresh"] [part="control"]') as HTMLElement).click();
    await settle();
    // RefreshData, not a plain repaint: automatic `Request` entries stay gated in edit/design, and
    // Re-firing them is exactly what this button promises.
    expect(counts.refreshes).toBe(1);
    expect(counts.repaints).toBeGreaterThan(0);
  });

  test("says it is refreshing until the canvas answers, not for 200ms", async () => {
    // It used to repaint on a `setTimeout(…, 200)`: a fetch slower than that repainted the OLD
    // Values and read as a Refresh that did nothing. `session.canvas.refreshing` is set by the verb
    // And cleared by the iframe's `dataScope` reply, so the button is honest for as long as it
    // Takes.
    const { container, ctx } = await mountData({ a: {} }, {});
    const btn = () => container.querySelector('[part="refresh"]') as HTMLElement;
    const control = () => btn().querySelector('[part="control"]') as HTMLElement;
    expect(btn().textContent?.trim()).toBe("Refresh");
    expect(control().hasAttribute("disabled")).toBe(false);

    activeTab.value!.session.canvas.refreshing = true;
    ctx.renderLeftPanel();
    await settle();
    expect(btn().textContent).toContain("Refreshing");
    // The kit's own spinner, swapped in for the glyph — the panel carries no second one.
    expect(btn().querySelector('[part="spinner"]')?.hasAttribute("hidden")).toBe(false);
    expect(control().hasAttribute("disabled")).toBe(true);

    activeTab.value!.session.canvas.refreshing = false;
    ctx.renderLeftPanel();
    await settle();
    expect(btn().textContent?.trim()).toBe("Refresh");
    expect(btn().querySelector('[part="spinner"]')?.hasAttribute("hidden")).toBe(true);
  });

  test("is not drawn over a document with no data — there is nothing to re-fetch", async () => {
    const { container } = await mountData({}, {});
    expect(container.querySelector('[part="refresh"]')).toBeNull();
  });
});

describe("truncation markers", () => {
  /** A row open over a list longer than the 20-item cap. */
  async function longList(n = 60) {
    const mounted = await mountData({ rows: {} }, { rows: Array.from({ length: n }, (_, i) => i) });
    await openEntry(mounted.container, "rows");
    mounted.counts.repaints = 0;
    return mounted;
  }

  test("a capped list ends in a marker that is a BUTTON, not a caption", async () => {
    // "… 40 more" used to be inert text: the panel saying it has the answer and will not show it,
    // In the one panel a reader opens BECAUSE item 40 is the surprising one.
    const { container } = await longList();
    expect(container.querySelectorAll('[part="row"]').length).toBe(20);
    const more = container.querySelector('[part="more"]') as HTMLButtonElement;
    expect(more.tagName).toBe("BUTTON");
    expect(more.textContent?.trim()).toBe("… 40 more");
    expect(more.getAttribute("title")).toBe("Show 50 more");
  });

  test("pressing it shows fifty more, and again shows the rest", async () => {
    const { container, counts } = await longList();
    // The press repaints the Navigator itself now — raising a limit is the surface's one action,
    // And the panel that owns the limit is the panel that redraws.
    (container.querySelector('[part="more"]') as HTMLElement).click();
    await settle();
    expect(counts.repaints).toBeGreaterThan(0);
    expect(container.querySelectorAll('[part="row"]').length).toBe(60);
    expect(container.querySelector('[part="more"]')).toBeNull();
  });

  test("the raised limit is per marker and per tab", async () => {
    const { container } = await longList();
    (container.querySelector('[part="more"]') as HTMLElement).click();
    await settle();
    expect(container.querySelectorAll('[part="row"]').length).toBe(60);

    // A different document with the same entry NAME does not inherit the reading position — the
    // Failure mode the row-expansion Set had before it moved onto the tab.
    const second = await mountData({ rows: {} }, { rows: Array.from({ length: 60 }, (_, i) => i) });
    await openEntry(second.container, "rows");
    expect(second.container.querySelectorAll('[part="row"]').length).toBe(20);
  });

  test("a capped OBJECT gets one too, at its own cap", async () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      big[`k${i}`] = i;
    }
    const { container } = await mountData({ obj: {} }, { obj: big });
    await openEntry(container, "obj");
    expect(container.querySelectorAll('[part="row"]').length).toBe(30);
    (container.querySelector('[part="more"]') as HTMLElement).click();
    await settle();
    expect(container.querySelectorAll('[part="row"]').length).toBe(40);
  });

  test("with no tab open, raising a limit is a no-op rather than a crash", async () => {
    const { closeAllTabs } = await import("../src/workspace/workspace");
    const { raiseDataLimit } = await import("../src/panels/data-explorer");
    closeAllTabs();
    expect(() => raiseDataLimit("ghost", "items")).not.toThrow();
  });
});

describe("the value tree", () => {
  /**
   * One tree, drawn the way the panel draws it: a host, and `paintDataTree` filling it.
   *
   * The depth argument the lit host used to carry is gone — the panel opens a tree at the top of
   * one entry's value, and a deeper start was only ever reachable through the recursion the walk
   * now owns. A cap past the value's own depth is what the marker case is asserted with instead.
   */
  async function tree(value?: unknown, maxDepth = 5): Promise<HTMLElement> {
    const container = stage();
    paintDataTree(container, value, "", () => {}, maxDepth);
    await settle();
    return container;
  }

  const values = (el: HTMLElement) => [...el.querySelectorAll('[part="value"]')];
  const toned = (el: HTMLElement, tone: string) => [
    ...el.querySelectorAll(`[part="value"][data-tone="${tone}"]`),
  ];

  test("renders a marker past maxDepth", async () => {
    const el = await tree({ a: 1 }, -1);
    expect(el.querySelector('[part="more"]')?.textContent?.trim()).toBe("…");
    expect(el.querySelector('[part="more"]')?.getAttribute("title")).toBe("Show 50 more levels");
  });

  test("renders null and undefined leaves", async () => {
    const elNull = await tree(null);
    expect(toned(elNull, "null")[0]?.textContent?.trim()).toBe("null");
    const elUndef = await tree();
    expect(toned(elUndef, "null")[0]?.textContent?.trim()).toBe("undefined");
  });

  test("renders scalar leaves with JSON formatting", async () => {
    const el = await tree("hello");
    expect(toned(el, "string")[0]?.textContent).toContain('"hello"');
    const elNum = await tree(3.5);
    expect(toned(elNum, "number")[0]?.textContent).toContain("3.5");
  });

  test("truncates long scalar strings at 200 chars", async () => {
    const el = await tree("x".repeat(250));
    const text = toned(el, "string")[0]?.textContent ?? "";
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(230);
  });

  test("renders array items with index keys and caps at 20", async () => {
    const el = await tree(Array.from({ length: 25 }, (_, i) => i));
    expect(el.querySelectorAll('[part="row"]').length).toBe(20);
    expect(el.querySelector('[part="key"]')?.textContent).toContain("[0]");
    expect(el.querySelector('[part="more"]')?.textContent).toContain("5 more");
  });

  test("truncates long strings inside arrays at 80 chars", async () => {
    const el = await tree(["y".repeat(120)]);
    const text = values(el)[0]?.textContent ?? "";
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(100);
  });

  test("nested array items show labels and recurse", async () => {
    const el = await tree([[1, 2], { a: 1 }]);
    const labels = toned(el, "object").map((n) => n.textContent);
    expect(labels).toContain("Array(2)");
    expect(labels).toContain("{1}");
    // Recursed leaves rendered one level deeper
    expect(el.textContent).toContain("[0]");
    expect(el.textContent).toContain("a:");
  });

  test("renders object entries and caps at 30 keys", async () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 35; i++) {
      big[`k${i}`] = i;
    }
    const el = await tree(big);
    expect(el.querySelectorAll('[part="row"]').length).toBe(30);
    expect(el.querySelector('[part="more"]')?.textContent).toContain("5 more");
  });

  test("object values that are objects show labels and recurse", async () => {
    const el = await tree({ list: [1], meta: { x: 1, y: 2 } });
    const labels = toned(el, "object").map((n) => n.textContent);
    expect(labels).toContain("Array(1)");
    expect(labels).toContain("{2}");
    expect(el.textContent).toContain("x:");
  });

  test("truncates long object string values at 80 chars", async () => {
    const el = await tree({ body: "z".repeat(150) });
    const text = values(el)[0]?.textContent ?? "";
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(100);
  });

  test("null values inside objects and arrays use null styling", async () => {
    const el = await tree({ gone: null });
    expect(toned(el, "null")[0]?.textContent).toContain("null");
    const elArr = await tree([null]);
    expect(toned(elArr, "null").length).toBe(1);
  });

  test("a host is CLEARED before its tree is drawn, whatever was in it", async () => {
    // A document clears the host it is given, which is why a panel may not hand one that is
    // Already holding something it still wants.
    const container = stage();
    const stale = document.createElement("p");
    stale.id = "was-here";
    container.append(stale);
    paintDataTree(container, { a: 1 }, "", () => {});
    await settle();
    expect(container.querySelector("#was-here")).toBeNull();
    expect(container.querySelector('[part="tree"]')).not.toBeNull();
  });

  test("a deeper indent is carried by the row, not by the markup", async () => {
    // The tree is FLAT — a document maps a list — so depth reaches the document as a length on the
    // Row it belongs to. Two levels, two indents.
    const rows = dataTreeRows({ meta: { x: 1 } }, 0);
    expect(rows.map((r) => r.indent)).toEqual(["12px", "24px"]);
    expect(rows.map((r) => r.label)).toEqual(["meta: ", "x: "]);

    // …and it reaches the painted row as a custom property the shared padding rule reads, which
    // Is what keeps a hundred-row tree on ONE interned rule instead of one per row.
    const el = await tree({ meta: { x: 1 } });
    const painted = [...el.querySelectorAll<HTMLElement>('[part="row"]')];
    expect(painted.map((n) => n.style.getPropertyValue("--row-indent"))).toEqual(["12px", "24px"]);
  });
});
