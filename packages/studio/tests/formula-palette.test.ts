/**
 * Tests for src/surfaces/formula-palette.ts — the palette over the formula catalog: rendering,
 * grouped results, search filtering, keyboard navigation, and picking.
 *
 * The surface is a Jx document now, so every gesture is asserted a turn later than it used to be:
 * `mountSurface` settles after the kit is defined, and the `$switch` on `open` reconciles in a
 * microtask of its own. Everything is addressed by `part`, and the highlight by `data-selected` —
 * the document draws no classes at all.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { flush, mountOverlayLayers } from "./harness";
import { getLayerSlot, initLayers } from "../src/ui/layers";
import { closeFormulaPalette, openFormulaPalette } from "../src/surfaces/formula-palette";
import type { FormulaCatalogEntry } from "../src/ui/formula-catalog";

// Layer DOM is set up once — getLayerSlot caches its slot element, so the body must not be
// Replaced between tests (the cached slot would keep pointing into a detached subtree).
mountOverlayLayers(document.body);
initLayers();

// Happy-dom may not provide requestAnimationFrame in all versions.
(globalThis as Record<string, unknown>).requestAnimationFrame ??= (cb: (t: number) => void) =>
  setTimeout(() => cb(0), 0);

function entry(overrides: Partial<FormulaCatalogEntry>): FormulaCatalogEntry {
  return {
    description: "desc",
    group: "Group",
    insert: () => ({ operator: "!", target: null }),
    kind: "operator",
    label: "op",
    name: "op",
    parameters: [],
    ...overrides,
  };
}

const ENTRIES: FormulaCatalogEntry[] = [
  entry({ description: "Nullish coalescing", group: "Logical", label: "??", name: "??" }),
  entry({ description: "Conditional operator", group: "Conditional", label: "?:", name: "?:" }),
  entry({
    description: "Largest of the arguments",
    group: "Math",
    kind: "global",
    label: "Math.max",
    name: "Math/max",
  }),
];

const onPick = mock((_entry: FormulaCatalogEntry) => {});

/** The palette's own popover slot; every query is scoped to it. */
function slot(): HTMLElement {
  return getLayerSlot("popover", "formula-palette");
}

function overlay(): HTMLElement | null {
  return slot().querySelector('[part="overlay"]');
}

function searchInput(): HTMLInputElement {
  return slot().querySelector('[part="input"]') as HTMLInputElement;
}

function items(): HTMLElement[] {
  return [...slot().querySelectorAll('[part="item"]')] as HTMLElement[];
}

function partText(part: string): (string | null)[] {
  return [...slot().querySelectorAll(`[part="${part}"]`)].map((el) => el.textContent);
}

/** Open the palette and wait for the document to draw it. */
async function open(entries: FormulaCatalogEntry[] = ENTRIES): Promise<void> {
  openFormulaPalette({ entries, onPick });
  await flush();
}

async function typeQuery(q: string) {
  const input = searchInput();
  input.value = q;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

async function keydown(keyName: string) {
  searchInput().dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: keyName }),
  );
  await flush();
}

beforeEach(async () => {
  onPick.mockClear();
  closeFormulaPalette();
  await flush();
});

describe("formula palette — open/close", () => {
  test("open renders entries grouped with kind badges; close removes the overlay", async () => {
    await open();
    expect(overlay()).toBeTruthy();
    expect(items().length).toBe(3);
    expect(partText("section-label")).toEqual(["Logical", "Conditional", "Math"]);
    expect(partText("badge")).toEqual(["operator", "operator", "global"]);

    closeFormulaPalette();
    await flush();
    expect(overlay()).toBeNull();
  });

  test("clicking the backdrop closes; clicks inside the panel do not", async () => {
    await open();
    const panel = slot().querySelector('[part="panel"]') as HTMLElement;
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(overlay()).toBeTruthy();
    overlay()!.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    await flush();
    expect(overlay()).toBeNull();
  });

  test("Escape closes without picking", async () => {
    await open();
    await keydown("Escape");
    expect(overlay()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("empty entries render the empty state", async () => {
    await open([]);
    expect(slot().querySelector('[part="empty"]')?.textContent).toContain("No entries available");
  });
});

describe("formula palette — filtering", () => {
  test("filters by label, name, group, and description substrings", async () => {
    await open();

    await typeQuery("max");
    expect(items().length).toBe(1);
    expect(items()[0]!.textContent).toContain("Math.max");

    await typeQuery("conditional");
    expect(items().length).toBe(1);
    expect(items()[0]!.textContent).toContain("?:");

    await typeQuery("??");
    expect(items().length).toBe(1);

    await typeQuery("no-such-thing");
    expect(items().length).toBe(0);
    expect(slot().querySelector('[part="empty"]')?.textContent).toContain("No results");

    await typeQuery("");
    expect(items().length).toBe(3);
  });
});

describe("formula palette — picking", () => {
  test("Enter picks the keyboard-selected entry and closes", async () => {
    await open();
    await keydown("ArrowDown");
    await keydown("Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]!.label).toBe("?:");
    expect(overlay()).toBeNull();
  });

  test("arrow navigation clamps at the ends", async () => {
    await open();
    await keydown("ArrowUp");
    await keydown("ArrowDown");
    await keydown("ArrowDown");
    await keydown("ArrowDown");
    await keydown("Enter");
    expect(onPick.mock.calls[0]![0]!.label).toBe("Math.max");
  });

  test("clicking an entry picks it; mouseenter moves the selection", async () => {
    await open();
    items()[2]!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await flush();
    expect(items()[2]!.dataset.selected).toBe("");
    expect(items()[0]!.dataset.selected).toBeUndefined();
    items()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]!.label).toBe("??");
    expect(overlay()).toBeNull();
  });

  test("Enter with no matching entries is a no-op", async () => {
    await open();
    await typeQuery("zzz");
    await keydown("Enter");
    expect(onPick).not.toHaveBeenCalled();
    expect(overlay()).toBeTruthy();
  });
});

describe("formula palette — the anchored panel", () => {
  test("an anchor with a measured box pins the panel under it; no anchor centres it", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.getBoundingClientRect = () =>
      ({ bottom: 40, height: 20, left: 120, top: 20, width: 60 }) as DOMRect;

    openFormulaPalette({ anchor, entries: ENTRIES, onPick });
    await flush();
    const panel = slot().querySelector('[part="panel"]') as HTMLElement;
    expect(panel.dataset.anchored).toBe("");
    expect(panel.getAttribute("style")).toContain("--formula-palette-left:120px");
    expect(panel.getAttribute("style")).toContain("--formula-palette-top:44px");

    closeFormulaPalette();
    await flush();
    await open();
    const centred = slot().querySelector('[part="panel"]') as HTMLElement;
    expect(centred.dataset.anchored).toBeUndefined();
    anchor.remove();
  });
});
