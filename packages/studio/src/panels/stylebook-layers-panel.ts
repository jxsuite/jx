/// <reference lib="dom" />
/**
 * The Outline panel while the pane is showing Project Styles — the element catalogue and the
 * document's own custom properties.
 *
 * **The body is a Jx document** (`surfaces/panel-stylebook-layers.json`, mounted by
 * `surfaces/panel-stylebook-layers.ts`), so this module renders nothing and projects everything.
 * What stays here is what is a DECISION: how the catalogue's recursive `$sections` flatten into a
 * list, how a child's compound path is spelled, which children are duplicates of each other, which
 * tags the open file has already styled, and which row the current selection marks. The surface
 * reads values.
 *
 * The panel does not own the panel RECORD — `panels/layers-panel.ts` does, because the Outline is
 * one panel with two bodies and only the record can know which the pane is asking for. That module
 * calls {@link mountStylebookLayersPanel} on the stylebook side and {@link detachStylebookLayers}
 * on the other, which is what takes this document back out again: lit paints its own branch into
 * the same `.panel-content` and would otherwise leave the catalogue standing underneath the tree.
 *
 * @docs studio/design/stylebook
 */

import { activeTab } from "../workspace/workspace";
import { shell } from "../shell";
import { componentRegistry } from "../files/components";
import { mountStylebookLayersSurface } from "../surfaces/panel-stylebook-layers";

import type { StylebookEntry } from "./stylebook-panel";
import type {
  StylebookLayersSurfaceHandle,
  StylebookLayersValues,
  StylebookRowView,
  StylebookVariableView,
} from "../surfaces/panel-stylebook-layers";
import type { JxStyle } from "@jxsuite/schema/types";
import type { ComponentEntry } from "../files/components.js";

/** What the panel is drawn from: the catalogue, and what selecting a row does. */
export interface StylebookLayersCtx {
  selectStylebookTag: (tag: string, media?: string | null, opts?: { panCanvas?: boolean }) => void;
  stylebookMeta: { $sections: { label: string; elements: StylebookEntry[] }[] };
}

/** The row's own padding at depth 0, and what each level of nesting adds. */
const INDENT_BASE = 8;
const INDENT_STEP = 16;

/**
 * Whether the open file has already written a `& <tag>` block with something in it.
 *
 * @param {JxStyle} rootStyle
 * @param {string} tag
 */
function hasTagStyle(rootStyle: JxStyle, tag: string) {
  const s = rootStyle[`& ${tag}`];
  return Boolean(s) && typeof s === "object" && Object.keys(s as object).length > 0;
}

/**
 * The leaf of the current selection.
 *
 * A selection is a compound path (`"ul li"`) and the catalogue draws one row per TAG, so the row
 * that is marked is the one whose tag is the path's last segment. That is what the tree has always
 * done; it is written down here because "selected" meaning something other than "equal" is exactly
 * the kind of thing a reader assumes is a bug.
 */
function selectedLeaf(selection: string | null): string | null {
  if (!selection) {
    return null;
  }
  return selection.includes(" ") ? (selection.split(" ").pop() ?? null) : selection;
}

/**
 * Flatten one catalogue entry and everything under it into rows.
 *
 * Children are deduplicated by tag — a `<ul>` specimen carries two `<li>`s and they are one row,
 * because the row selects a TAG and there is only one `& li` to write.
 */
function elementRows(
  entry: StylebookEntry,
  rootStyle: JxStyle,
  leaf: string | null,
  depth: number,
  parentPath: string,
  out: StylebookRowView[],
): void {
  const { tag } = entry;
  const fullPath = parentPath ? `${parentPath} ${tag}` : tag;
  out.push({
    customized: hasTagStyle(rootStyle, tag),
    indent: `${INDENT_BASE + depth * INDENT_STEP}px`,
    key: fullPath,
    kind: "element",
    label: entry.text || `<${tag}>`,
    selected: tag === leaf,
    tag,
  });
  const children = entry.children
    ? [...new Map(entry.children.map((c: StylebookEntry) => [c.tag, c])).values()]
    : [];
  for (const child of children) {
    elementRows(child, rootStyle, leaf, depth + 1, fullPath, out);
  }
}

/** The custom properties the open file declares, in the order it declares them. */
function variableRows(rootStyle: JxStyle): StylebookVariableView[] {
  return Object.entries(rootStyle)
    .filter(([k]) => k.startsWith("--"))
    .map(([name, value]) => ({ key: name, name, value: String(value) }));
}

/**
 * What the surface should be showing right now.
 *
 * Exported because it is the whole of this module that is worth testing on its own: it is a pure
 * function of the open document, the shell's stylebook state and the component registry.
 *
 * @param {StylebookLayersCtx} ctx
 * @returns {StylebookLayersValues}
 */
export function stylebookLayersValues(ctx: StylebookLayersCtx): StylebookLayersValues {
  const tab = activeTab.value;
  const rootStyle = (tab?.doc.document?.style || {}) as JxStyle;
  const { selection } = shell.stylebook;
  const leaf = selectedLeaf(selection);

  const rows: StylebookRowView[] = [];
  for (const section of ctx.stylebookMeta.$sections) {
    for (const entry of section.elements) {
      elementRows(entry, rootStyle, leaf, 0, "", rows);
    }
  }
  for (const comp of componentRegistry as ComponentEntry[]) {
    rows.push({
      customized: false,
      indent: `${INDENT_BASE}px`,
      key: comp.tagName,
      kind: "component",
      label: comp.tagName,
      selected: comp.tagName === selection,
      /* The glyph, not the tag: a component's tag IS its label here, and a badge repeating it
         would be the same word twice on one 24px row. */
      tag: "⬡",
    });
  }

  const variables = variableRows(rootStyle);
  return {
    hasVariables: variables.length > 0,
    rows,
    tab: shell.stylebook.tab,
    variables,
  };
}

/**
 * The surface standing in the Navigator, and the node it was mounted into.
 *
 * One slot rather than a per-host map, for the reason `panels/elements-panel.ts` gives: there is
 * one Navigator, so a mount into a DIFFERENT node is the old one being replaced, and holding both
 * would leave the first one's effects running against a scope nobody writes any more.
 */
let standing: { host: HTMLElement; handle: StylebookLayersSurfaceHandle } | null = null;

/**
 * Keep the selected row on screen after a repaint.
 *
 * On a microtask, because the document is what draws the row: a scope written on this tick is a
 * binding that runs on the next one, so a query made here and now would find the row the PREVIOUS
 * projection marked (or, on the first paint, no rows at all).
 */
function revealSelectedRow(host: HTMLElement): void {
  queueMicrotask(() => {
    host
      .querySelector('[part="row"][aria-current="true"]')
      ?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  });
}

/**
 * Draw the catalogue — mounting the document the first time, updating it every time after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed, for the
 * reason `panels/elements-panel.ts` states: only one of them is the node lit renders this panel's
 * body into, and appending to the other would leave the catalogue drawn under whatever the
 * Navigator paints next.
 *
 * The second parameter is `host` rather than `container` deliberately — see
 * `scripts/check-pane-singletons.ts`'s {@link PANE_PARAM_NAMES}. This is the NAVIGATOR's node, not
 * a pane's stage, and "which document is open" is the whole question the projection answers.
 *
 * @param {StylebookLayersCtx} ctx
 * @param {HTMLElement} host - The painted `.panel-body`
 */
export function mountStylebookLayersPanel(ctx: StylebookLayersCtx, host: HTMLElement): void {
  const target = host.querySelector<HTMLElement>(".panel-content") ?? host;
  if (standing && (standing.host !== target || !standing.handle.connected())) {
    standing.handle.dispose();
    standing = null;
  }
  const values = stylebookLayersValues(ctx);
  if (standing) {
    standing.handle.update(values);
  } else {
    standing = {
      handle: mountStylebookLayersSurface(target, values, {
        selectRow: (path) => {
          ctx.selectStylebookTag(path, undefined, { panCanvas: true });
        },
      }),
      host: target,
    };
  }
  revealSelectedRow(target);
}

/**
 * Take the catalogue down.
 *
 * Called by the Outline's record when the pane is no longer showing Project Styles. Without it the
 * document survives its own irrelevance: lit's branch renders into the range it owns inside
 * `.panel-content` and leaves everything appended after it exactly where it was.
 */
export function detachStylebookLayers(): void {
  standing?.handle.dispose();
  standing = null;
}
