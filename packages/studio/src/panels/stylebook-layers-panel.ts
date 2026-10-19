/// <reference lib="dom" />
/**
 * The Outline panel while the pane is showing a document's Elements view — the element catalogue.
 *
 * A page or a component offers **Elements** in its Editor control, which styles that file's element
 * defaults (`docs/studio/design/stylebook.md`), and the Outline beside it lists the catalogue's
 * tags instead of the document's tree. `project.json` in the Styles workspace has its own
 * Navigator, the Styles panel (`panels/styles-panel.ts`), which lists the project's CSS custom
 * properties too; the variables list this body used to draw beside the Variables view went there
 * with it.
 *
 * **The body is a Jx document** (`surfaces/panel-stylebook-layers.json`, mounted by
 * `surfaces/panel-stylebook-layers.ts`), so this module renders nothing and projects everything.
 * What stays here is what is a DECISION: which tags the open file has already styled, and what each
 * row is called. The walk itself (how the catalogue's recursive `$sections` flatten into a list,
 * how a child's compound path is spelled, which children are duplicates of each other, and which
 * row the current selection marks) is `stylebook-doc.ts`'s `catalogueRows`, which the Styles
 * panel's Elements section draws from too. The surface reads values.
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
import { catalogueRows } from "./stylebook-doc";

import type { StylebookEntry } from "./stylebook-panel";
import type {
  StylebookLayersSurfaceHandle,
  StylebookLayersValues,
  StylebookRowView,
} from "../surfaces/panel-stylebook-layers";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { JxStyle } from "@jxsuite/schema/types";

/** What the panel is drawn from: the catalogue, and what selecting a row does. */
export interface StylebookLayersCtx {
  selectStylebookTag: (tag: string, media?: string | null, opts?: { panCanvas?: boolean }) => void;
  stylebookMeta: { $sections: { label: string; elements: StylebookEntry[] }[] };
}

/** The row's own padding at depth 0, and what each level of nesting adds (the Outline's too). */
export const INDENT_BASE = 8;
export const INDENT_STEP = 16;

/**
 * Whether the open file has already written a `& <tag>` block with something in it.
 *
 * @param {JxStyle} rootStyle
 * @param {string} tag
 */
function hasTagStyle(rootStyle: JxStyle, tag: string): boolean {
  const s = rootStyle[`& ${tag}`];
  return isNonNullObject(s) && Object.keys(s).length > 0;
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
  const rootStyle: JxStyle = tab?.doc.document?.style || {};
  const { selection } = shell.stylebook;

  /* The stylebook's own walk (`stylebook-doc.ts` `catalogueRows`), which the Styles panel's
     Elements section draws from too: the path, the nesting, the deduplication and the leaf mark
     are one decision, and only the dot and the label are this list's. */
  const entries = ctx.stylebookMeta.$sections.flatMap((section) => section.elements);
  const rows: StylebookRowView[] = catalogueRows(entries, selection).map((row) => ({
    customized: hasTagStyle(rootStyle, row.tag),
    indent: `${INDENT_BASE + row.depth * INDENT_STEP}px`,
    key: row.path,
    kind: "element",
    label: row.entry.text || `<${row.tag}>`,
    selected: row.selected,
    tag: row.tag,
  }));
  for (const comp of componentRegistry) {
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

  return { rows };
}

/**
 * The surface standing in the Navigator, and the node it was mounted into.
 *
 * One slot rather than a per-host map, for the reason `panels/elements-panel.ts` gives: there is
 * one Navigator, so a mount into a DIFFERENT node is the old one being replaced, and holding both
 * would leave the first one's effects running against a scope nobody writes any more.
 */
let standing: {
  /** The latest ctx: the handlers read it, not the one the first mount closed over. */
  ctx: StylebookLayersCtx;
  host: HTMLElement;
  handle: StylebookLayersSurfaceHandle;
} | null = null;

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
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    standing.ctx = ctx;
    standing.handle.update(values);
  } else {
    standing = {
      ctx,
      handle: mountStylebookLayersSurface(target, values, {
        selectRow: (path) => {
          (standing?.ctx ?? ctx).selectStylebookTag(path, undefined, { panCanvas: true });
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
 * Called by the Outline's record when the pane is no longer showing an Elements view. Without it
 * the document survives its own irrelevance: lit's branch renders into the range it owns inside
 * `.panel-content` and leaves everything appended after it exactly where it was.
 */
export function detachStylebookLayers(): void {
  standing?.handle.dispose();
  standing = null;
}
