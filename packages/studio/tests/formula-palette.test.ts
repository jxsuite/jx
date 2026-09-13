/**
 * Tests for src/surfaces/formula-palette.ts — the palette over the formula catalog: rendering,
 * grouped results, search filtering, keyboard navigation, and picking.
 *
 * The surface is a Jx document now, so every gesture is asserted a turn later than it used to be:
 * `mountSurface` settles after the kit is defined, and the `$switch` on `open` reconciles in a
 * microtask of its own. Everything is addressed by `part`; the document draws no classes at all.
 *
 * The rows are the kit's `jx-listbox` and `jx-option`, so the highlight is asserted through
 * `aria-selected` and nothing else. There is no `data-selected` beside it any more: the id in
 * `active` IS the highlight, the listbox's sidecar is its single writer, and the two tests at the
 * bottom of this file are what hold that — one that the field, the list and the row all name the
 * same string, and one that moving the caret does not re-rank the catalog.
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
  return [...slot().querySelectorAll('[part="option"]')] as HTMLElement[];
}

/** The row the caret is on, as the kit's sidecar marks it. */
function selected(): HTMLElement | null {
  return slot().querySelector('[part="option"][aria-selected="true"]');
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
    expect(partText("group-heading")).toEqual(["Logical", "Conditional", "Math"]);
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
    expect(selected()).toBe(items()[2]!);
    expect(items()[0]!.getAttribute("aria-selected")).toBe("false");
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
    /* Computed, not the element's own `style` attribute: the position is declared in the document's
       own style object and reaches the panel as a custom property set on the mount's root. */
    const placed = globalThis.getComputedStyle(panel);
    expect(placed.left.trim()).toBe("120px");
    expect(placed.top.trim()).toBe("44px");

    closeFormulaPalette();
    await flush();
    await open();
    const centred = slot().querySelector('[part="panel"]') as HTMLElement;
    expect(centred.dataset.anchored).toBeUndefined();
    anchor.remove();
  });
});

describe("formula palette — the highlight is one id", () => {
  test("the field, the list and the row all name the same string, and no row carries a second flag", async () => {
    /*
     * The duplication this closed: the document used to write
     * `aria-selected="${$map.item.index === state.selectedIndex ? 'true' : 'false'}"` and a
     * `data-selected` beside it, once per row, with nothing keeping the pair in agreement. Now the
     * surface writes ONE string. `active` reaches the listbox, `aria-activedescendant` reaches the
     * field, and the listbox's sidecar is the only thing that writes a row's flag.
     */
    await open();
    await keydown("ArrowDown");

    const field = searchInput();
    const list = slot().querySelector('[part="results"]') as HTMLElement;
    const active = field.getAttribute("aria-activedescendant");

    expect(active).toBe("formula-palette-option-1");
    expect(list.dataset.active).toBe(active!);
    expect(list.getAttribute("aria-label")).toBe("Formulas");
    expect(field.getAttribute("aria-controls")).toBe(list.id);
    expect(selected()!.id).toBe(active!);
    expect(slot().querySelectorAll("[data-selected]")).toHaveLength(0);
  });

  test("an empty result set points the field at no row at all", async () => {
    await open();
    await typeQuery("no-such-thing");
    expect(searchInput().hasAttribute("aria-activedescendant")).toBe(false);
    expect(searchInput().getAttribute("aria-expanded")).toBe("false");

    // And an arrow key over nothing moves nothing: clamping an empty list lands on index 0, which
    // Would name a row that is not there now that the id IS the highlight.
    await keydown("ArrowDown");
    expect(searchInput().hasAttribute("aria-activedescendant")).toBe(false);
    expect((slot().querySelector('[part="results"]') as HTMLElement).dataset.active).toBe("");
  });

  test("a key moves the caret without re-ranking the catalog", async () => {
    /*
     * The property `groups` and `activeId` are separate fields FOR. `groupRows` reads every entry's
     * `description` exactly once per projection, so a getter on one entry counts projections — and
     * an arrow key must cost none of them. Typing does, which is what proves the counter works.
     */
    let projections = 0;
    const counted: FormulaCatalogEntry = {
      ...entry({ group: "Logical", label: "??", name: "??" }),
      get description() {
        projections += 1;
        return "Nullish coalescing";
      },
    };
    openFormulaPalette({ entries: [counted, ENTRIES[1]!, ENTRIES[2]!], onPick });
    await flush();

    const projected = projections;
    expect(projected).toBeGreaterThan(0);

    await keydown("ArrowDown");
    await keydown("ArrowDown");
    expect(projections).toBe(projected);
    expect(selected()!.id).toBe("formula-palette-option-2");

    await typeQuery("?");
    expect(projections).toBeGreaterThan(projected);
  });
});
