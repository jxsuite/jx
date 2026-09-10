/**
 * The grid's cell value picker — `grid/cell-popovers.ts` over `surfaces/grid-cell.json`.
 *
 * Two kinds edit this way rather than in the cell: an image and a relationship both pick from a
 * list that is bigger than a cell, and Tabulator's range module blur-cancels an editor session the
 * moment the pointer leaves it. The panel is a document, so a row is `[part]`; the media picker
 * inside it is still a lit surface, and it arrives through the document's island seam — which is
 * what `[part="picker-host"]` is, and what this file checks is actually filled.
 */
import { flush, installMockPlatform, mountOverlayLayers, resetStudioState } from "./harness";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { html } from "lit-html";
import { initLayers } from "../src/ui/layers";
import type { GridColumn } from "../src/grid/grid-source";

// The real media picker drags in caches/timers — a stub input keeps the contract observable.
void mock.module("../src/ui/media-picker.js", () => ({
  renderMediaPicker: (_prop: string, value: string, onCommit: (val: string) => void) =>
    html`<input
      data-testid="media"
      .value=${value}
      @change=${(e: Event) => onCommit((e.target as HTMLInputElement).value)}
    />`,
}));

const { hasPopoverEditor, openCellValuePopover, referenceTargetType } =
  await import("../src/grid/cell-popovers");
const { setFormats } = await import("../src/format/format-host");

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

const MD_FORMAT = {
  capabilities: { parse: { identifier: "parse", timing: [] } },
  documentKinds: ["content"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "Markdown",
  remote: false,
  studio: null,
} as never;

const col = (kind: GridColumn["kind"], schema?: GridColumn["schema"]): GridColumn => ({
  editable: true,
  field: "f",
  kind,
  title: "Field",
  ...(schema ? { schema } : {}),
});

/** The open panel, in the popover layer where every overlay of its kind lives. */
const panel = () => document.querySelector<HTMLElement>('#layer-popover [part="cell-panel"]');

function part(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[part="${name}"]`);
}

beforeEach(() => {
  resetStudioState();
  setFormats([MD_FORMAT]);
  /* Empty the whole layer rather than the panel inside it: a named slot is reused while it is still
     parented, so leaving an orphaned one behind hands the next mount a container the previous
     surface still believes it owns. */
  document.querySelector("#layer-popover")?.replaceChildren();
});

describe("popover editor selection", () => {
  test("image and reference kinds use popovers; others do not", () => {
    expect(hasPopoverEditor(col("image"))).toBeTrue();
    expect(hasPopoverEditor(col("reference"))).toBeTrue();
    expect(hasPopoverEditor(col("string"))).toBeFalse();
    expect(hasPopoverEditor(col("array"))).toBeFalse();
  });

  test("referenceTargetType parses #/content/<name> schema refs only", () => {
    expect(referenceTargetType(col("reference", { $ref: "#/content/authors" } as never))).toBe(
      "authors",
    );
    expect(referenceTargetType(col("reference", { $ref: "#/data/users" } as never))).toBeNull();
    expect(referenceTargetType(col("reference"))).toBeNull();
  });
});

describe("openCellValuePopover — reference", () => {
  test("lists target-collection entry ids, names the target, and commits picks", async () => {
    installMockPlatform(
      {},
      {
        "content/authors/jane.md": "---\ntitle: Jane\n---\n",
        "content/authors/mark.md": "---\ntitle: Mark\n---\n",
      },
    );
    resetStudioState({
      projectConfig: {
        content: { authors: { format: "Markdown", schema: {}, source: "./content/authors/" } },
      },
    });

    const commits: unknown[] = [];
    await openCellValuePopover({
      anchor: { bottom: 40, left: 10 },
      column: col("reference", { $ref: "#/content/authors" } as never),
      commit: (v) => commits.push(v),
      value: "jane",
    });
    await flush(3);

    const box = panel()!;
    expect(box).not.toBeNull();
    // The panel says WHICH collection it is listing; "an id" with no target is unreadable.
    expect(part(box, "hint")?.textContent).toContain("Entries of “authors”");
    const select = box.querySelector("select")!;
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "",
      "jane",
      "mark",
    ]);
    expect(select.value).toBe("jane");
    // A listed value belongs in the list, not duplicated into the free-text field beside it.
    expect(box.querySelector<HTMLInputElement>('[part="custom"] input')!.value).toBe("");

    select.value = "mark";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits).toEqual(["mark"]);

    // The em-dash row is how a reference is cleared, and cleared means null rather than "".
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits).toEqual(["mark", null]);
  });

  test("an id the collection does not hold survives in the free-text field", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { content: {} } });
    const commits: unknown[] = [];
    await openCellValuePopover({
      anchor: { bottom: 0, left: 0 },
      column: col("reference"),
      commit: (v) => commits.push(v),
      value: "elsewhere",
    });
    await flush(3);

    const box = panel()!;
    // No target type to name, so no hint is drawn at all.
    expect(part(box, "hint")).toBeNull();
    const input = box.querySelector<HTMLInputElement>('[part="custom"] input')!;
    expect(input.value).toBe("elsewhere");

    input.value = "  custom-entry ";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits).toEqual(["custom-entry"]);
  });

  test("Done takes the panel down", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { content: {} } });
    await openCellValuePopover({
      anchor: { bottom: 0, left: 0 },
      column: col("reference"),
      commit: () => {},
      value: null,
    });
    await flush(3);
    const box = panel()!;
    (part(box, "done")!.querySelector('[part="control"]') as HTMLElement).click();
    await flush(3);
    expect(panel()).toBeNull();
  });
});

describe("openCellValuePopover — image", () => {
  test("the media picker is mounted into the island the document drew", async () => {
    installMockPlatform();
    const commits: unknown[] = [];
    await openCellValuePopover({
      anchor: { bottom: 0, left: 0 },
      column: col("image"),
      commit: (v) => commits.push(v),
      value: "/img/a.png",
    });
    await flush(3);

    const box = panel()!;
    // The document draws the box; the caller fills it. Neither knows the other's markup.
    const host = part(box, "picker-host")!;
    expect(host).not.toBeNull();
    expect(part(box, "custom")).toBeNull();
    const input = host.querySelector<HTMLInputElement>('[data-testid="media"]')!;
    expect(input.value).toBe("/img/a.png");

    input.value = "/img/b.png";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commits).toEqual(["/img/b.png", null]);
  });
});
