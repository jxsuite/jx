import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import {
  PANE_PART,
  PANE_SELECTOR,
  STAGE_PART,
  STAGE_SELECTOR,
  mountPaneGridSurface,
} from "../src/surfaces/pane-grid";
import type { PaneCellPart, PaneGridRow } from "../src/surfaces/pane-grid";

/**
 * The pane grid's mount seam, on its own.
 *
 * `pane-grid.test.ts` drives the whole grid through `panels/pane-grid.ts`, which is the right level
 * for everything about panes. Three claims are about the SEAM instead, and none of them is visible
 * from there:
 *
 * 1. **Every box is announced as it is created, with the pane it belongs to.** The pane id comes from
 *    the row scope the runtime is rendering with, not from `data-pane-id` — `onNodeCreated` fires
 *    before the attributes are written, so an element read at that moment carries nothing.
 * 2. **A mount disposed before it settles leaves nothing behind.** The runtime renders one microtask
 *    after the kit is defined, so a caller that gives up in between — a project switch, an unmount
 *    — must not have a document appear in the host afterwards.
 * 3. **`part="pane"` and `part="stage"` are this document's alone.** Both are reached with `closest()`
 *    from OUTSIDE the surface: `panels/jump-bar.ts` and `panels/pane-context.ts` walk up to the
 *    cell to write a `--*-h` custom property, and `editor/shortcuts.ts` walks up from a wheel event
 *    to ask whether it happened over a stage. A pane hosts other surface documents — the Document
 *    Header, Project Settings, the grid frame — so a second document claiming either name would
 *    answer one of those walks with its own element, silently.
 */

const SRC = resolve(import.meta.dir, "..", "src");

function host(): HTMLElement {
  const el = document.createElement("div");
  el.id = "pane-grid";
  document.body.append(el);
  return el;
}

function rows(...ids: string[]): PaneGridRow[] {
  return ids.map((id, index) => ({
    id,
    region: `pane.${id}`,
    split: index > 0 ? "shown" : "hidden",
    stripRegion: `pane.${id}/tabs`,
  }));
}

/** A recorder for both actions, in call order. */
function recorder() {
  const parts: string[] = [];
  const splitters: HTMLElement[] = [];
  return {
    actions: {
      cellPart: (paneId: string, part: PaneCellPart, element: HTMLElement) => {
        parts.push(`${paneId}:${part}:${element.tagName.toLowerCase()}`);
      },
      splitter: (element: HTMLElement) => {
        splitters.push(element);
      },
    },
    parts,
    splitters,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("what the mount announces", () => {
  test("every cell box arrives named by its pane, in document order", async () => {
    const rec = recorder();
    const surface = mountPaneGridSurface(host(), rows("primary"), rec.actions);
    await surface.ready;

    /* The CELL first, then its four boxes: the runtime creates a row depth-first, so the outermost
       box is reported before anything inside it. `panels/pane-grid.ts` relies on that — it builds
       the record on `pane` and fills it in on the rest. */
    expect(rec.parts).toEqual([
      "primary:pane:div",
      "primary:strip:div",
      "primary:jump:div",
      "primary:chrome:div",
      "primary:stage:div",
    ]);
    // One pane, so no splitter at all — the `$switch` renders no case rather than a hidden one.
    expect(rec.splitters).toHaveLength(0);
    surface.dispose();
  });

  test("a second row brings a splitter, and the first row's boxes are not re-announced", async () => {
    const rec = recorder();
    const el = host();
    const surface = mountPaneGridSurface(el, rows("primary"), rec.actions);
    await surface.ready;
    rec.parts.length = 0;

    surface.update(rows("primary", "secondary"));
    await Promise.resolve();

    /* Only the new row. A keyed repeater REUSES the row it already has, which is the whole reason
       a split does not reload the primary pane's `<iframe>`; re-announcing its boxes would mean it
       had been rebuilt. */
    expect(rec.parts).toEqual([
      "secondary:pane:div",
      "secondary:strip:div",
      "secondary:jump:div",
      "secondary:chrome:div",
      "secondary:stage:div",
    ]);
    expect(rec.splitters).toHaveLength(1);
    expect(rec.splitters[0]!.getAttribute("role")).toBe("separator");
    expect(rec.splitters[0]!.getAttribute("aria-orientation")).toBe("vertical");
    // And it is between the two cells, in neither.
    expect(rec.splitters[0]!.closest(PANE_SELECTOR)).toBeNull();
    surface.dispose();
  });

  test("the region ids the projection carries are the ones stamped", async () => {
    const rec = recorder();
    const el = host();
    const surface = mountPaneGridSurface(el, rows("primary"), rec.actions);
    await surface.ready;

    const cell = el.querySelector<HTMLElement>(PANE_SELECTOR)!;
    expect(cell.dataset["paneId"]).toBe("primary");
    expect(el.querySelector<HTMLElement>(STAGE_SELECTOR)!.dataset["jxRegion"]).toBe("pane.primary");
    expect(el.querySelector<HTMLElement>('[part="strip"]')!.dataset["jxRegion"]).toBe(
      "pane.primary/tabs",
    );
    surface.dispose();
  });
});

describe("giving up before the mount settles", () => {
  test("a dispose before `ready` leaves the host empty", async () => {
    /* The runtime waits for the kit to be defined and renders one microtask later, so there is a
       real window in which a caller can change its mind — `panels/pane-grid.ts`'s `unmount()` in a
       project switch is exactly that. The handle that arrives afterwards has to dispose itself
       rather than paint into a host nobody is holding any more. */
    const rec = recorder();
    const el = host();
    const surface = mountPaneGridSurface(el, rows("primary"), rec.actions);
    surface.dispose();
    await surface.ready;
    await Promise.resolve();

    expect(el.childElementCount).toBe(0);
    // Idempotent: a second dispose is what an `unmount()` after an `unmount()` does.
    expect(() => {
      surface.dispose();
    }).not.toThrow();
    expect(el.childElementCount).toBe(0);
  });

  test("the host is cleared on the way IN, so a stale mount cannot be left beside the new one", async () => {
    const el = host();
    const stale = document.createElement("div");
    stale.id = "stale";
    el.append(stale);

    const rec = recorder();
    const surface = mountPaneGridSurface(el, rows("primary"), rec.actions);
    await surface.ready;

    expect(el.querySelector("#stale")).toBeNull();
    expect(el.querySelectorAll(PANE_SELECTOR)).toHaveLength(1);
    surface.dispose();
  });
});

describe("the two parts other modules reach for", () => {
  test("the exported selectors are the names the document actually writes", () => {
    /* JSON cannot import a constant, so the document and the selectors beside it are two writers of
       one name. This is the join: rename either and it goes red here rather than in a `closest()`
       that quietly answers null. */
    const doc = readFileSync(join(SRC, "surfaces", "pane-grid.json"), "utf8");
    expect(doc).toContain(`"part": "${PANE_PART}"`);
    expect(doc).toContain(`"part": "${STAGE_PART}"`);
    expect(PANE_SELECTOR).toBe('[part="pane"]');
    expect(STAGE_SELECTOR).toBe('[part="pane-stage"]');
  });

  test("no other surface document claims either name", () => {
    /* Both are resolved with `closest()` from inside a pane, and a pane hosts other documents — so
       whichever name the stage carries would otherwise be answered by the first document inside it
       that happens to use the same word. It is `pane-stage` for exactly that reason: `stage` was
       taken, three times over — `surfaces/canvas-stage.json` mounts INTO this box and its own root
       carries it, and the media pane and the git panel use it too. This is the check that found
       that, and the one that keeps the next such name out. */
    const glob = new Glob("*.json");
    const offenders: string[] = [];
    for (const file of glob.scanSync({ cwd: join(SRC, "surfaces") })) {
      if (file === "pane-grid.json") {
        continue;
      }
      const text = readFileSync(join(SRC, "surfaces", file), "utf8");
      for (const part of [PANE_PART, STAGE_PART]) {
        if (text.includes(`"part": "${part}"`)) {
          offenders.push(`${file} — part="${part}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
