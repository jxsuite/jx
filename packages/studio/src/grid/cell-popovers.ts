/**
 * Popover cell editors — media paths and relationship pickers.
 *
 * These kinds bypass Tabulator's in-cell editor session entirely: their pickers render OUTSIDE the
 * cell, which Tabulator's range module treats as an outside interaction and blur-cancels. Instead,
 * a dblclick on the cell opens `surfaces/grid-cell.json` anchored at the cell, and every pick
 * writes straight through the edit buffer via `commit`.
 *
 * **What is left here is the decision, not the markup.** The panel is a document; this module says
 * which of the two pickers it draws, what the relationship column points at, and what a pick means.
 * The media picker is a document of its own now (`surfaces/media-field.json`), so it still arrives
 * through the panel's island seam (specs/studio-ui-guidelines.md §9.4) — the box is drawn by one
 * document and filled by another, and nothing in this file renders anything.
 */
import { openGridCellSurface } from "../surfaces/grid-cell";
import { mountMediaPicker } from "../ui/media-picker";
import { listCollectionEntryIds } from "./sources/content-source";
import { cellToText } from "./schema-columns";
import type { GridCellValue, GridColumn } from "./grid-source";

/** Whether this column edits through an anchored popover instead of an in-cell editor. */
export function hasPopoverEditor(column: GridColumn): boolean {
  return column.kind === "image" || column.kind === "reference";
}

/** Target content-type name of a relationship column (`#/content/<name>` on the schema). */
export function referenceTargetType(column: GridColumn): string | null {
  const ref = (column.schema as { $ref?: string } | undefined)?.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/content/")) {
    return null;
  }
  return ref.slice("#/content/".length);
}

export interface CellPopoverArgs {
  /** Viewport rect of the cell the popover anchors to. */
  anchor: { left: number; bottom: number };
  column: GridColumn;
  value: GridCellValue;
  /** Write the new value through the edit buffer (called on every pick/commit). */
  commit: (value: GridCellValue) => void;
}

/**
 * Where the panel opens: at the cell, kept inside the viewport on both axes.
 *
 * The clamp is the panel's own width and a floor for its height, because a cell near the right edge
 * of a wide grid is exactly where a relationship column tends to be.
 */
function placement(anchor: CellPopoverArgs["anchor"]): { x: number; y: number } {
  return {
    x: Math.max(4, Math.min(anchor.left, window.innerWidth - 340)),
    y: Math.max(4, Math.min(anchor.bottom + 2, window.innerHeight - 200)),
  };
}

/**
 * Open the popover editor for an image or reference cell. Resolves target-entry ids up front for
 * relationship columns so the picker renders complete.
 */
export async function openCellValuePopover(args: CellPopoverArgs): Promise<void> {
  const { anchor, column, commit, value } = args;
  const current = cellToText(value);
  const at = placement(anchor);
  /* The empty string is what every control here says for "no value", and null is what the buffer
     stores — a cell cleared through this panel must be indistinguishable from one never set. The
     trim is for the free-text field: an id with a stray space is a reference that resolves to
     nothing, and it is never what was meant. */
  const pick = (picked: string) => {
    const trimmed = picked.trim();
    commit(trimmed === "" ? null : trimmed);
  };

  if (column.kind === "reference") {
    const targetType = referenceTargetType(column);
    const ids = targetType ? await listCollectionEntryIds(targetType) : [];
    const listed = ids.includes(current);
    openGridCellSurface({
      pick,
      view: {
        /* An id the target collection does not hold is still a legal reference — a draft entry, or
           one another repository owns — so it shows in the free-text field rather than being
           silently dropped by a list that has no row for it. */
        custom: listed ? "" : current,
        hint: targetType ? `Entries of “${targetType}”` : "",
        hintState: targetType ? "shown" : "hidden",
        kind: "reference",
        options: [{ label: "—", value: "" }, ...ids.map((id) => ({ label: id, value: id }))],
        title: column.title,
        value: listed ? current : "",
        ...at,
      },
    });
    return;
  }

  openGridCellSurface({
    island: (host) => {
      mountMediaPicker(host, column.field, current, pick);
    },
    pick,
    view: {
      custom: "",
      hint: "",
      hintState: "hidden",
      kind: "image",
      options: [],
      title: column.title,
      value: current,
      ...at,
    },
  });
}
