/**
 * The slash menu — the element-insertion list that hangs under the caret.
 *
 * It is a Jx document (`surfaces/slash-menu.json`) over the kit's `jx-popover`, `jx-listbox` and
 * `jx-option`, so nothing here names a class or a Spectrum tag: a row is `[part="option"]` with
 * `role="option"`, and the active one is the one carrying `aria-selected="true"` — written by the
 * listbox from the single id the panel hands it. The panel deliberately does NOT take focus — the
 * caret it filters for is in the canvas — so "which row is active" is an attribute rather than
 * `document.activeElement`, and the arrow keys arrive at a document-level listener.
 */
import { flush, mountOverlayLayers } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";

import { dismissSlashMenu, isSlashMenuOpen, showSlashMenu } from "../src/editor/slash-menu";

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

/** Create a simple anchor element for positioning the menu */
function makeAnchor() {
  const el = document.createElement("p");
  el.textContent = "test";
  document.body.append(el);
  return el;
}

/** Dispatch a keyboard event on document (capturing phase, like real browser) */
function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
}

/** Every offered row, in order. A mounted document needs a few turns to reconcile. */
async function rows(): Promise<HTMLElement[]> {
  await flush(3);
  return [...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]')];
}

/** Which row is marked active, as an index; -1 when none is. */
function activeIndex(list: HTMLElement[]): number {
  return list.findIndex((el) => el.getAttribute("aria-selected") === "true");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Slash Menu", () => {
  let anchor: HTMLElement;

  beforeEach(() => {
    anchor = makeAnchor();
  });

  afterEach(async () => {
    dismissSlashMenu();
    anchor.remove();
    await flush();
  });

  // ─── State lifecycle ─────────────────────────────────────────────────────

  describe("state lifecycle", () => {
    test("starts closed", () => {
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("opens after showSlashMenu", () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      expect(isSlashMenuOpen()).toBe(true);
    });

    test("closes after dismissSlashMenu, and takes its panel with it", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      await flush(3);
      expect(document.querySelector("#layer-popover jx-popover")).not.toBeNull();
      dismissSlashMenu();
      expect(isSlashMenuOpen()).toBe(false);
      await flush();
      expect(document.querySelector("#layer-popover jx-popover")).toBeNull();
    });

    test("dismissSlashMenu is safe to call when already closed", () => {
      dismissSlashMenu();
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("the panel is one addressable region, not a selector the camera has to know", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      await flush(3);
      const carriers = [...document.querySelectorAll('[data-jx-region="overlay.menu:slash-menu"]')];
      expect(carriers.length).toBeGreaterThan(0);
      /* The LAST carrier is the panel itself, because that is the node with a box: the slot
         around a fixed-position popover measures empty, and the camera takes the last match. */
      expect(carriers.at(-1)?.localName).toBe("jx-popover");
    });
  });

  // ─── Filtering ───────────────────────────────────────────────────────────

  describe("filtering", () => {
    test("no filter shows all commands", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      const shown = await rows();
      expect(shown.length).toBe(15); // All SLASH_COMMANDS
    });

    test("filter narrows results", async () => {
      showSlashMenu(anchor, "head", { onSelect: () => {} });
      const shown = await rows();
      expect(shown.length).toBe(3); // H1, h2, h3
    });

    test("filter by tag name", async () => {
      showSlashMenu(anchor, "blockquote", { onSelect: () => {} });
      const shown = await rows();
      expect(shown.length).toBe(1);
    });

    test("no matches auto-dismisses", () => {
      showSlashMenu(anchor, "xyz", { onSelect: () => {} });
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("updating filter changes items", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      const shown = await rows();
      expect(shown.length).toBe(15);

      showSlashMenu(anchor, "img", { onSelect: () => {} });
      const shown2 = await rows();
      expect(shown2.length).toBe(1);
    });

    /* The tag is the row's `value` — the kit's own word for what a row stands for, and the detail
       of the `select` event a pick dispatches. It used to be a `data-tag` beside it, which was a
       second spelling of one fact for a test to read. */
    test("a row names the tag it inserts, so a test never matches its prose", async () => {
      showSlashMenu(anchor, "img", { onSelect: () => {} });
      const shown = await rows();
      expect(shown[0]!.getAttribute("value")).toBe("img");
    });
  });

  // ─── Keyboard navigation ─────────────────────────────────────────────────

  describe("keyboard navigation", () => {
    test("ArrowDown moves the active row", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      expect(activeIndex(await rows())).toBe(0);

      pressKey("ArrowDown");
      expect(activeIndex(await rows())).toBe(1);
    });

    test("ArrowUp wraps around to last item", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      await flush(3);
      pressKey("ArrowUp");
      const list = await rows();
      expect(activeIndex(list)).toBe(list.length - 1);
    });

    test("ArrowDown wraps around to first item", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      const list = await rows();
      // Navigate all the way round.
      for (const _row of list) {
        pressKey("ArrowDown");
      }
      expect(activeIndex(await rows())).toBe(0);
    });

    test("the pointer moves the same mark the arrow keys do", async () => {
      // The highlight follows one index, not `:hover` — so the mouse and the keyboard can never
      // Disagree about which row Enter would take.
      let selected: { tag: string } | null = null;
      showSlashMenu(anchor, "", { onSelect: (cmd) => (selected = cmd) });
      const list = await rows();
      list[4]!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      expect(activeIndex(await rows())).toBe(4);
      pressKey("Enter");
      expect(selected!.tag).toBe("ul");
    });

    test("exactly one row is ever active", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      await flush(3);
      pressKey("ArrowDown");
      pressKey("ArrowDown");
      const list = await rows();
      expect(list.filter((el) => el.getAttribute("aria-selected") === "true").length).toBe(1);
      /* And the row is marked WITHOUT the panel taking the keyboard. This surface is a listbox
         rather than a `jx-menu` precisely because the caret it filters for is in the canvas, and
         every character typed after the `/` has to keep landing there — so "active" here is an
         ARIA state on a row, never DOM focus moving into the panel. */
      const marked = list.find((el) => el.getAttribute("aria-selected") === "true")!;
      expect(marked.contains(document.activeElement)).toBe(false);
      expect(document.activeElement?.closest('[role="listbox"]')).toBeFalsy();
    });
  });

  // ─── The panel never takes the keyboard ──────────────────────────────────

  /* The reason this surface is a listbox rather than a `jx-menu`, asserted as a property rather
     than left to the prose. A conversion that only checked "the right row is marked" would pass
     while the author's next character went to the panel instead of the document being edited. */
  describe("the panel never takes the keyboard", () => {
    test("opening it leaves the caret where it was, and the list has no tab stop at all", async () => {
      // Stand in for the canvas's `contenteditable`: something that HOLDS the caret, so a panel
      // That took focus would be seen taking it rather than merely being seen not to have it.
      const caret = document.createElement("input");
      document.body.append(caret);
      caret.focus();
      expect(document.activeElement).toBe(caret);

      showSlashMenu(anchor, "", { onSelect: () => {} });
      await flush(3);
      const list = document.querySelector<HTMLElement>("#layer-popover jx-listbox");
      expect(list).not.toBeNull();

      expect(document.activeElement).toBe(caret);
      // Not "nothing is focused inside it" — nothing inside it COULD be.
      expect(list!.hasAttribute("tabindex")).toBe(false);
      expect(
        list!.querySelectorAll("[tabindex], a[href], button, input, select, textarea").length,
      ).toBe(0);

      // And driving it does not move the caret either: the keys are read where they landed.
      pressKey("ArrowDown");
      await flush(3);
      const shown = await rows();
      const marked = shown.find((el) => el.getAttribute("aria-selected") === "true")!;
      expect(marked).toBeDefined();
      expect(document.activeElement).toBe(caret);
      expect(marked.contains(document.activeElement)).toBe(false);

      caret.remove();
    });

    /* The other mode: opened BY NAME, with no caret to protect, so the panel grows a field of its
       own. The mark is still an ARIA state on a row — what moves is which element is FOCUSED, and
       the row is never it. One id reaches both readers: the listbox turns it into the row's
       `selected`, the field announces it, and neither computes it. */
    test("with a filter field, the field is focused and the row is only named", async () => {
      showSlashMenu(anchor, "", { onSelect: () => {}, showFilter: true });
      await flush(3);
      const field = document.querySelector<HTMLInputElement>('#layer-popover [part="filter"]')!;
      const list = document.querySelector<HTMLElement>("#layer-popover jx-listbox")!;
      expect(document.activeElement).toBe(field);
      expect(field.closest("jx-listbox")).toBeNull();

      const drawn = await rows();
      const marked = drawn.filter((el) => el.getAttribute("aria-selected") === "true");
      expect(marked.length).toBe(1);
      const [row] = marked;
      const { id } = row!;
      expect(id).not.toBe("");
      expect(field.getAttribute("aria-activedescendant")).toBe(id);
      expect(list.dataset.active).toBe(id);
      expect(row!.contains(document.activeElement)).toBe(false);

      // And the two stay one string when the mark moves.
      pressKey("ArrowDown");
      await flush(3);
      const after = await rows();
      const moved = after.find((el) => el.getAttribute("aria-selected") === "true")!;
      expect(moved.id).not.toBe(id);
      expect(field.getAttribute("aria-activedescendant")).toBe(moved.id);
      expect(list.dataset.active).toBe(moved.id);
      expect(document.activeElement).toBe(field);
    });
  });

  // ─── Enter selects ───────────────────────────────────────────────────────

  describe("Enter selects", () => {
    test("Enter calls onSelect with first item by default", () => {
      let selected: { tag: string; label: string } | null = null;
      showSlashMenu(anchor, "", { onSelect: (cmd) => (selected = cmd) });

      pressKey("Enter");
      expect(selected).not.toBeNull();
      expect(selected!.tag).toBe("h1");
      expect(selected!.label).toBe("Heading 1");
    });

    test("Enter after ArrowDown selects second item", () => {
      let selected: { tag: string } | null = null;
      showSlashMenu(anchor, "", { onSelect: (cmd) => (selected = cmd) });

      pressKey("ArrowDown");
      pressKey("Enter");
      expect(selected!.tag).toBe("h2");
    });

    /* The row that LOOKS active is the row Enter takes, at every step.
       These were two mechanisms until recently: the template declared the highlight on the first
       row while the arrow handler moved an attribute itself, off a live query of the host. They
       never disagreed on screen only because a dirty-check makes an imperative write STICK. One
       binding, driven by one index, is what makes the panel unable to lie — and this asserts the
       property that would break if a second writer ever appeared. */
    test("the active row is the row Enter takes, at every step", async () => {
      const taken: string[] = [];

      for (const steps of [0, 1, 2]) {
        let selected: { label: string } | null = null;
        showSlashMenu(anchor, "", { onSelect: (cmd) => (selected = cmd) });
        for (let i = 0; i < steps; i++) {
          pressKey("ArrowDown");
        }
        const list = await rows();
        const shown = activeIndex(list);
        const labels = list.map((el) => el.textContent?.trim() ?? "");
        expect(shown).toBe(steps);
        // Exactly one, so nothing is left behind by a previous move.
        expect(list.filter((el) => el.getAttribute("aria-selected") === "true").length).toBe(1);

        pressKey("Enter");
        expect(selected).not.toBeNull();
        expect(labels[shown]).toContain(selected!.label);
        taken.push(selected!.label);
        await flush();
      }

      // And the three steps really did land on three different commands.
      expect(new Set(taken).size).toBe(3);
    });

    test("Enter dismisses the menu", () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      pressKey("Enter");
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("Enter with filter selects first filtered item", () => {
      let selected: { tag: string } | null = null;
      showSlashMenu(anchor, "img", { onSelect: (cmd) => (selected = cmd) });

      pressKey("Enter");
      expect(selected!.tag).toBe("img");
    });

    test("a click on a row takes it, exactly as Enter does", async () => {
      let selected: { tag: string } | null = null;
      showSlashMenu(anchor, "", { onSelect: (cmd) => (selected = cmd) });
      const list = await rows();
      list[3]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(selected!.tag).toBe("p");
      expect(isSlashMenuOpen()).toBe(false);
    });
  });

  // ─── Escape dismisses ────────────────────────────────────────────────────

  describe("Escape dismisses", () => {
    test("Escape closes the menu", () => {
      showSlashMenu(anchor, "", { onSelect: () => {} });
      pressKey("Escape");
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("Escape does not call onSelect", () => {
      let called = false;
      showSlashMenu(anchor, "", { onSelect: () => (called = true) });
      pressKey("Escape");
      expect(called).toBe(false);
    });
  });

  // ─── Light dismissal is the platform's ───────────────────────────────────

  describe("light dismissal", () => {
    /* The `mousedown` capture listener this replaces was a hand-rolled outside-click handler on the
       document. The panel is a `popover=auto` now, so the platform closes it — and the flow finds
       out the same way any other closer does, through the element's own `toggle`. */
    test("an outside pointer press closes it, and the caller is told", async () => {
      let dismissed = 0;
      showSlashMenu(anchor, "", { onDismiss: () => (dismissed += 1), onSelect: () => {} });
      await flush(3);
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await flush(2);
      expect(isSlashMenuOpen()).toBe(false);
      expect(dismissed).toBe(1);
      expect(document.querySelector("#layer-popover jx-popover")).toBeNull();
    });

    test("the flow does not bind an outside-click listener of its own", async () => {
      const source = await Bun.file(new URL("../src/editor/slash-menu.ts", import.meta.url)).text();
      expect(source).not.toContain('addEventListener("mousedown"');
      expect(source).not.toContain("lit-html");
    });
  });

  // ─── Custom commands ────────────────────────────────────────────────────

  describe("custom commands", () => {
    const customCommands = [
      { description: "Plain text", label: "Paragraph", tag: "p" },
      { description: "Medium heading", label: "Heading 2", tag: "h2" },
      { description: "Small heading", label: "Heading 3", tag: "h3" },
    ];

    test("shows only custom commands when provided", async () => {
      showSlashMenu(anchor, "", {
        commands: customCommands,
        onSelect: () => {},
      });
      const shown = await rows();
      expect(shown.length).toBe(3);
    });

    test("filters within custom commands", async () => {
      showSlashMenu(anchor, "head", {
        commands: customCommands,
        onSelect: () => {},
      });
      const shown = await rows();
      expect(shown.length).toBe(2);
    });

    test("Enter selects from custom commands", () => {
      let selected: { tag: string; label: string } | null = null;
      showSlashMenu(anchor, "", {
        commands: customCommands,
        onSelect: (cmd) => (selected = cmd),
      });
      pressKey("Enter");
      expect(selected!.tag).toBe("p");
      expect(selected!.label).toBe("Paragraph");
    });

    test("no matches in custom commands auto-dismisses", () => {
      showSlashMenu(anchor, "xyz", {
        commands: customCommands,
        onSelect: () => {},
      });
      expect(isSlashMenuOpen()).toBe(false);
    });

    test("keyboard navigation works with custom commands", async () => {
      showSlashMenu(anchor, "", {
        commands: customCommands,
        onSelect: () => {},
      });
      expect(activeIndex(await rows())).toBe(0);

      pressKey("ArrowDown");
      expect(activeIndex(await rows())).toBe(1);

      pressKey("ArrowDown");
      expect(activeIndex(await rows())).toBe(2);

      // Wraps
      pressKey("ArrowDown");
      expect(activeIndex(await rows())).toBe(0);
    });
  });
});
