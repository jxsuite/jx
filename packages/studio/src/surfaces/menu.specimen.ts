/**
 * The menu's specimen: a context menu over a canvas element, with a chord, a disabled row and its
 * reason, a checked row, a submenu and a destructive row (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { MenuScope, ProjectedRow } from "./menu";

/** What a row says beyond its id and title; everything left out reads as the plain row. */
interface RowFacts {
  chord?: string;
  requires?: string;
  checked?: "true" | "false";
  destructive?: boolean;
  dividerAbove?: boolean;
  children?: ProjectedRow[];
}

/** One row as the adapter's projection leaves it: every optional filled in, every flag derived. */
function row(id: string, title: string, facts: RowFacts = {}): ProjectedRow {
  const children = facts.children ?? [];
  const requires = facts.requires ?? "";
  const chord = facts.chord ?? "";
  const dividerAbove = facts.dividerAbove ?? false;
  return {
    checked: facts.checked ?? "",
    children,
    chord,
    destructive: facts.destructive ?? false,
    disabled: requires !== "",
    dividerAbove,
    enabled: requires === "",
    haspopup: children.length > 0,
    id,
    noChord: chord === "",
    noDivider: !dividerAbove,
    requires,
    submenuLabel: title,
    title,
  };
}

/** The rows of an element's context menu. */
function elementRows(): ProjectedRow[] {
  return [
    row("edit.copy", "Copy", { chord: "⌘C" }),
    row("edit.paste", "Paste", { chord: "⌘V", requires: "something on the clipboard" }),
    row("edit.duplicate", "Duplicate", { chord: "⌘D" }),
    row("canvas.setLayoutVisible", "Show layout", { checked: "true", dividerAbove: true }),
    row("selection.wrap", "Wrap in", {
      children: [row("selection.wrap.div", "Division"), row("selection.wrap.section", "Section")],
      dividerAbove: true,
    }),
    row("selection.delete", "Delete", { chord: "⌫", destructive: true, dividerAbove: true }),
  ];
}

/** The menu over `rows`, which marks the row a select names. */
function menu(rows: ProjectedRow[]): MenuScope {
  const scope: MenuScope = reactive<MenuScope>({
    floor: 0,
    label: "Element actions",
    placement: "",
    rows,
    select: (_scope, event) => {
      const id = event instanceof CustomEvent ? String(event.detail) : "";
      const chosen = scope.rows.find((candidate) => candidate.id === id);
      if (chosen) {
        chosen.checked = "true";
      }
    },
    x: 24,
    y: 24,
  });
  return scope;
}

export const specimen = defineSpecimen<MenuScope>({
  drive: (root) => {
    root.dispatchEvent(new CustomEvent("select", { detail: "edit.copy" }));
  },
  scope: () => menu(elementRows()),
  variants: { empty: () => menu([]) },
});
