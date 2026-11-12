/// <reference lib="dom" />
/**
 * Render-path mapping — pure logic shared by the legacy in-realm path mapper (which stores paths in
 * the `elToPath` WeakMap) and the iframe host (which stamps them as `data-jx-path` attributes).
 *
 * The runtime fires `onNodeCreated(el, renderPath, def, state)` for every node. The render path is
 * not always the document path: layout-wrapped pages shift page content under a layout prefix, and
 * a mapped array (`$prototype: "Array"`) renders one instance of its template per item, at
 * `[…array, "map", index, …]`, where the document holds the template once, at `[…array, "map", …]`.
 * {@link classifyRenderNode} resolves a render path to either a document path plus the row it was
 * drawn in, or a "layout" marker; {@link serializeJxPath} encodes the path for the `data-jx-path`
 * attribute (studio.md §4.5).
 */

import { isJsonObject, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JxElement } from "@jxsuite/schema/types";
import type { JxPath } from "../state";

/**
 * A `[data-jx-path='…']` selector for a serialized path.
 *
 * Single quotes because the serialized path is JSON and only ever uses double ones; the two escapes
 * cover the characters that could still break out of an attribute-value selector. Shared because
 * two callers need the same string — `measureHits` locating a node to measure, and
 * `applyCanvasPopoverOpen` locating one to flip — and a second copy of an escaping rule is a second
 * chance to get an escape wrong.
 *
 * @param serialized A path already through {@link serializeJxPath}.
 * @returns The attribute selector, without a leading tag or combinator.
 */
export function jxPathSelector(serialized: string): string {
  return `[data-jx-path='${escapeAttrValue(serialized)}']`;
}

/** A serialized path as the inside of a single-quoted attribute-value selector. */
function escapeAttrValue(serialized: string): string {
  return serialized.replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`);
}

/**
 * The attribute a node carries its document path in when it is drawn in a repeater row that is not
 * the active one (studio.md §4.5). An **echo row** draws the same document nodes as the active row,
 * so stamping it with `data-jx-path` would give one path two elements, and every lookup that takes
 * the first match would act on whichever came first in the document. The runtime de-links a node
 * carrying either attribute (`carriesCanvasStamp` in `packages/runtime/src/runtime.ts`).
 */
export const ECHO_PATH_ATTR = "data-jx-echo-path";

/** The attribute a node drawn inside a repeater carries its row coordinates in, as JSON. */
export const ROW_ATTR = "data-jx-row";

/** A selector for every element drawn for a document node: the active rows' and the echo rows'. */
export const STAMPED_SELECTOR = `[data-jx-path],[${ECHO_PATH_ATTR}]`;

/**
 * A selector for EVERY element drawn for a serialized document path: the one that carries it as
 * `data-jx-path`, and each echo row's. See {@link jxPathSelector} for the escaping.
 */
export function jxInstanceSelector(serialized: string): string {
  const escaped = escapeAttrValue(serialized);
  return `[data-jx-path='${escaped}'],[${ECHO_PATH_ATTR}='${escaped}']`;
}

/**
 * The serialized document path an element was drawn for, whichever attribute holds it, or undefined
 * for an element that is no node of the document.
 */
export function stampedPathOf(el: HTMLElement): string | undefined {
  return el.dataset.jxPath ?? el.dataset.jxEchoPath;
}

/** The row coordinates an element was drawn at, outermost repeater first; empty outside a row. */
export function rowsOf(el: HTMLElement): number[] {
  const raw = el.dataset.jxRow;
  if (raw === undefined) {
    return [];
  }
  // SAFETY: only the stamper and the row restamp write `data-jx-row`, as JSON of a number array.
  return JSON.parse(raw) as number[];
}

/** Context the mapper needs, computed once per render by whoever prepared the document. */
export interface PathMapCtx {
  canvasMode: string;
  layoutWrapped: boolean;
  pageContentPrefix: JxPath | null;
  pageContentOffset: number | null;
}

/**
 * The marker `markLayoutNodes` stamps on every node of a resolved layout document (see
 * {@link file://./canvas-live-render.ts}). It names the layout FILE and the node's own path inside
 * that file — enough for the editor to select the node, label it, and open the layout at it. It
 * used to be a bare `true`, which is why clicking layout chrome on a fresh project selected nothing
 * at all: the render had thrown away the only two facts needed to act on the click.
 */
export interface LayoutMarker {
  /** Project-relative path of the layout document, e.g. `layouts/base.json`. */
  file: string;
  /** The node's path WITHIN the layout document. */
  path: JxPath;
}

/**
 * A render node either belongs to the layout (carrying its origin in the layout file, since it has
 * no page-document path) or maps to a page-document path.
 *
 * `chrome` distinguishes the two very different kinds of layout node. Most are chrome — a header, a
 * footer, a `<noscript>` — regions the page cannot edit in place. But the nodes on the path down to
 * the `<slot>` (the layout root, the `<main>` around it) WRAP the page content, so they must stay
 * transparent: dimming or freezing them would dim and freeze the whole document. Only chrome is
 * dimmed, labelled, and made `contenteditable="false"`.
 */
export type RenderNodeClass =
  | { kind: "layout"; layoutFile: string; layoutPath: JxPath; chrome: boolean }
  | { kind: "path"; path: JxPath; rows: number[] };

/** A node's document path, and the row each enclosing repeater drew it in, outermost first. */
export interface RowAddress {
  path: JxPath;
  rows: number[];
}

/**
 * A render path with its row indices taken out: the document path, and the index of the row each
 * enclosing repeater drew this node in, outermost first.
 *
 * A row hop is a `"map"` segment followed by a number. The document never holds that shape (a
 * repeater's `map` is one template, so the segment after it is a key of that template), and the one
 * other place a segment may be spelled `map` is a `$switch` case of that name, whose body is a node
 * and so is never followed by a number either; a `cases` key is skipped all the same.
 */
export function stripRowIndices(path: JxPath): RowAddress {
  const out: JxPath = [];
  const rows: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    out.push(seg);
    const next = path[i + 1];
    if (seg === "map" && isNumber(next) && path[i - 1] !== "cases") {
      rows.push(next);
      i += 1;
    }
  }
  return { path: out, rows };
}

/**
 * The document path of every repeater that encloses the node at `path`, outermost first: the prefix
 * before each `map` segment the document holds as a repeater's template.
 */
export function enclosingRepeaterPaths(path: JxPath): JxPath[] {
  const repeaters: JxPath[] = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "map" && path[i - 1] !== "cases") {
      repeaters.push(path.slice(0, i));
    }
  }
  return repeaters;
}

/**
 * The inverse of {@link stripRowIndices}: `path` with `rows` put back after each repeater's `map`
 * segment, which is the path the runtime renders that row's instance at. Rows beyond the repeaters
 * the path crosses are ignored, and a repeater with no row named is left without one.
 */
export function withRowIndices(path: JxPath, rows: readonly number[]): JxPath {
  const out: JxPath = [];
  let depth = 0;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    out.push(seg);
    if (seg === "map" && path[i - 1] !== "cases") {
      const row = rows[depth];
      if (row !== undefined) {
        out.push(row);
      }
      depth += 1;
    }
  }
  return out;
}

/**
 * Whether `path` is the page-content container or one of its ancestors — i.e. whether this node's
 * subtree contains the distributed page content. `prefix` is the render path of the container whose
 * children hold that content (`PathMapCtx.pageContentPrefix`).
 */
export function wrapsPageContent(path: JxPath, prefix: JxPath | null): boolean {
  if (!prefix) {
    return false;
  }
  return path.length <= prefix.length && path.every((seg, i) => prefix[i] === seg);
}

/**
 * Resolve a runtime render path to a document path and its rows (or flag it as layout-originated).
 * Pure — the caller decides whether to record the result in a WeakMap or `data-jx-*` attributes.
 */
export function classifyRenderNode(
  path: JxPath,
  def: JxElement | string,
  ctx: PathMapCtx,
): RenderNodeClass {
  // Layout-originated nodes have no page-document path; the caller stamps their origin instead
  // (data-jx-layout-path / data-jx-layout-file).
  const marker = ctx.layoutWrapped && isNonNullObject(def) ? def["$__layout"] : undefined;
  if (marker) {
    // A legacy bare `true` marker carries no origin, so it reads as an empty one.
    const origin = isJsonObject(marker) ? marker : {};
    const { file, path: originPath } = origin;
    return {
      // The root is never chrome even when the layout distributed nothing: it IS the render, and a
      // Dimmed, frozen root would be a canvas nobody can touch.
      chrome: path.length > 0 && !wrapsPageContent(path, ctx.pageContentPrefix),
      kind: "layout",
      layoutFile: isString(file) ? file : "",
      /* SAFETY: markLayoutNodes (canvas-live-render.ts) is the only writer of `$__layout`, and the
       * `path` it stamps is a LayoutMarker's JxPath. */
      layoutPath: Array.isArray(originPath) ? (originPath as JxPath) : [],
    };
  }

  return { kind: "path", ...stripRowIndices(pageDocPath(path, ctx)) };
}

/**
 * A render path with the layout prefix taken off, so it is relative to the page document. Row
 * indices are left in: see {@link stripRowIndices}.
 */
export function pageDocPath(path: JxPath, ctx: PathMapCtx): JxPath {
  let mappedPath = path;

  // Strip the layout prefix so paths are relative to the original page document.
  // Page children render at indices [offset, offset+1, …] when the layout places siblings before
  // The <slot>, so subtract the offset to recover the page's 0-based child indices.
  if (ctx.layoutWrapped && ctx.pageContentPrefix) {
    const pfx = ctx.pageContentPrefix;
    if (path.length >= pfx.length && pfx.every((seg, i) => path[i] === seg)) {
      const rest = path.slice(pfx.length);
      const [containerIdx] = rest;
      mappedPath = isNumber(containerIdx)
        ? ["children", containerIdx - (ctx.pageContentOffset ?? 0), ...rest.slice(1)]
        : ["children", ...rest];
    }
  }

  return mappedPath;
}

/** Encode a document path for the `data-jx-path` attribute (preserves string-vs-number segments). */
export function serializeJxPath(path: JxPath): string {
  return JSON.stringify(path);
}

/** Decode a `data-jx-path` attribute back into a document path. */
export function parseJxPath(serialized: string): JxPath {
  // SAFETY: only serializeJxPath writes `data-jx-path`, and it is JSON.stringify of a JxPath.
  return JSON.parse(serialized) as JxPath;
}
