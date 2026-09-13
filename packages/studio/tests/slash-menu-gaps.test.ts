/**
 * Gap tests for the slash menu — the filter-field mode (`showFilter`), light dismissal, click
 * selection, and the keyboard edge cases with an empty result list.
 *
 * The panel is a Jx document over `jx-popover`, `jx-listbox` and `jx-option`
 * (`surfaces/slash-menu.json`), so a row is `[part="option"]` and the field is `[part="filter"]`;
 * there is no class and no Spectrum tag to name. Two behaviours moved OUT of the flow with the
 * markup and are asserted here as the platform's: the outside press that closes an `auto` popover,
 * and the fact that a keystroke no longer rebuilds the field it was typed into.
 */
import { flush, mountOverlayLayers, stubRect } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { dismissSlashMenu, isSlashMenuOpen, showSlashMenu } from "../src/editor/slash-menu";

// ─── Environment ──────────────────────────────────────────────────────────────

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
}) as typeof requestAnimationFrame;

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

let anchor: HTMLElement;

beforeEach(() => {
  anchor = document.createElement("p");
  anchor.textContent = "anchor";
  document.body.append(anchor);
});

afterEach(async () => {
  dismissSlashMenu();
  anchor.remove();
  await flush();
});

/** Every offered row, once the document has reconciled. */
async function rows(): Promise<HTMLElement[]> {
  await flush(3);
  return [...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]')];
}

function filterInput() {
  return document.querySelector<HTMLInputElement>('#layer-popover [part="filter"]');
}

function panel() {
  return document.querySelector<HTMLElement & { x?: number; y?: number }>(
    "#layer-popover jx-popover",
  );
}

function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
}

/** Type into the filter field the way a person does: set the value, then fire `input`. */
function typeFilter(value: string): void {
  const input = filterInput()!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─── Filter input mode ────────────────────────────────────────────────────────

describe("showFilter mode", () => {
  test("renders a filter field and focuses it", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {}, showFilter: true });
    await flush(3);
    expect(filterInput()).not.toBeNull();
    expect(document.activeElement).toBe(filterInput());
  });

  test("typing in the filter narrows the items", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {}, showFilter: true });
    await flush(3);
    typeFilter("img");
    const list = await rows();
    expect(list.length).toBe(1);
    expect(list[0]!.getAttribute("value")).toBe("img");
  });

  test("clearing the filter restores the full list", async () => {
    showSlashMenu(anchor, "head", { onSelect: () => {}, showFilter: true });
    const shown = await rows();
    expect(shown.length).toBe(3);
    typeFilter("");
    const shown2 = await rows();
    expect(shown2.length).toBe(15);
  });

  test("no matches says so and stays open, with no row to take", async () => {
    showSlashMenu(anchor, "zzz", { onSelect: () => {}, showFilter: true });
    expect(isSlashMenuOpen()).toBe(true);
    const shown = await rows();
    expect(shown.length).toBe(0);
    expect(document.querySelector('#layer-popover [part="empty"]')?.textContent).toContain(
      "No matches",
    );
    /* No row to take means no row NAMED either. The flow still counts its active row from zero
       with nothing to count, so the id that reaches both readers has to be the empty one — a
       field pointing `aria-activedescendant` at an element that is not in the document announces
       a choice that cannot be made. */
    expect(filterInput()!.hasAttribute("aria-activedescendant")).toBe(false);
    expect(document.querySelector<HTMLElement>("#layer-popover jx-listbox")!.dataset.active).toBe(
      "",
    );
  });

  /* The field used to be rebuilt by every keystroke — a lit re-render replaced the `<input>`, and
     an `requestAnimationFrame` afterwards put the caret back and restored the selection offsets.
     A document reconciles in place, so the node the reader is typing into is the same node it was
     before, and the whole apparatus is gone rather than reimplemented. */
  test("a keystroke does not replace the field, so nothing has to put the caret back", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {}, showFilter: true });
    await flush(3);
    const before = filterInput()!;
    typeFilter("h");
    await flush(3);
    expect(filterInput()).toBe(before);
    expect(document.activeElement).toBe(before);
  });

  test("Enter with an empty result list selects nothing and stays open", () => {
    let selected: unknown = null;
    showSlashMenu(anchor, "zzz", {
      onSelect: (cmd) => {
        selected = cmd;
      },
      showFilter: true,
    });
    pressKey("Enter");
    expect(selected).toBeNull();
    expect(isSlashMenuOpen()).toBe(true);
  });

  test("arrow keys with an empty result list are inert", () => {
    showSlashMenu(anchor, "zzz", { onSelect: () => {}, showFilter: true });
    pressKey("ArrowDown");
    pressKey("ArrowUp");
    expect(isSlashMenuOpen()).toBe(true);
  });

  test("filtering within custom commands via the field", async () => {
    const commands = [
      { description: "Custom A", label: "Alpha", tag: "a1" },
      { description: "Custom B", label: "Beta", tag: "b1" },
    ];
    showSlashMenu(anchor, "", { commands, onSelect: () => {}, showFilter: true });
    await flush(3);
    typeFilter("bet");
    const list = await rows();
    expect(list.length).toBe(1);
    expect(list[0]!.getAttribute("value")).toBe("b1");
  });
});

// ─── Light dismissal is the platform's ────────────────────────────────────────

describe("outside press", () => {
  test("a press outside the panel dismisses the menu", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {} });
    await flush(3);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush(2);
    expect(isSlashMenuOpen()).toBe(false);
  });

  test("a press inside the panel keeps it open", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {} });
    const [row] = await rows();
    row!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush(2);
    expect(isSlashMenuOpen()).toBe(true);
  });
});

// ─── Click selection ──────────────────────────────────────────────────────────

describe("click selection", () => {
  test("clicking a row selects its command and closes the menu", async () => {
    let selected: { tag: string } | null = null;
    showSlashMenu(anchor, "img", {
      onSelect: (cmd) => {
        selected = cmd;
      },
    });
    const [row] = await rows();
    row!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(selected as unknown).toEqual({
      description: "Insert image",
      label: "Image",
      tag: "img",
    });
    expect(isSlashMenuOpen()).toBe(false);
  });
});

// ─── Re-show while open ───────────────────────────────────────────────────────

describe("re-show while open", () => {
  test("updating an open menu keeps a single keydown handler", () => {
    let count = 0;
    showSlashMenu(anchor, "", {
      onSelect: () => {
        count += 1;
      },
    });
    showSlashMenu(anchor, "img", {
      onSelect: () => {
        count += 1;
      },
    });
    pressKey("Enter");
    expect(count).toBe(1);
    expect(isSlashMenuOpen()).toBe(false);
  });

  test("updating an open menu reuses its panel rather than stacking a second", async () => {
    showSlashMenu(anchor, "", { onSelect: () => {} });
    await flush(3);
    const first = panel();
    showSlashMenu(anchor, "img", { onSelect: () => {} });
    await flush(3);
    expect(document.querySelectorAll("#layer-popover jx-popover").length).toBe(1);
    expect(panel()).toBe(first);
  });

  test("the panel is placed from the anchor rect, as a coordinate rather than a class", async () => {
    stubRect(anchor, { bottom: 60, height: 20, left: 40, right: 140, top: 40, width: 100 });
    showSlashMenu(anchor, "", { onSelect: () => {} });
    await flush(3);
    const el = panel()!;
    expect(el).not.toBeNull();
    expect(el.x).toBe(40);
    expect(el.y).toBe(60);
  });
});
