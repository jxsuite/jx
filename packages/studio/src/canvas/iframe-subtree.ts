/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * In-iframe subtree rendering for surgical structural patches (insert / replace / attribute edits).
 * The cross-frame analog of `canvas-subtree-render.ts`: it re-renders a single shadow-doc node into
 * fresh DOM using the SAME edit-mode transform, runtime renderer, scope (`$defs`), path mapping,
 * and mode the full render used — so a patched subtree is indistinguishable from a full re-render.
 *
 * Dependency-light (runtime + reactivity + the pure path/edit helpers) so it stays inside the slim
 * canvas-iframe bundle. Where the legacy patcher records render scopes in the `elToRenderScope`
 * WeakMap, this stamps `data-jx-path` and tracks per-subtree effect scopes locally.
 */

import { releaseElementStyles, renderNode, runScoped } from "@jxsuite/runtime";
import { isNumber, isString } from "@jxsuite/schema/guards";
import { getNodeAtPath } from "../state";
import { makeStamper } from "./iframe-render";
import { withRowIndices } from "./path-mapping";
import { prepareForEditMode, prepareTextMember } from "../utils/edit-display";
import { stripEventHandlers } from "../utils/strip-events";
import type { IframeRenderCtx } from "./iframe-render";
import type { JxPath } from "../state";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";

/**
 * Which drawn instance of a node a subtree render stands in for: the scope the runtime rendered the
 * old one with, and the row of each repeater around it. A node outside every repeater has one
 * instance, the page's scope and no rows.
 */
export interface SubtreeInstance {
  scope: JxScope;
  rows: readonly number[];
}

/**
 * The scope disposer each surgically-rendered subtree root owns (for disposal on remove/replace).
 * Disposers come from the RUNTIME's runScoped — renderNode's effects belong to the runtime's copy
 * of vue-reactivity, so a studio-instance effectScope here would collect nothing and leak every
 * binding effect of a superseded subtree (they keep firing against detached DOM).
 */
const elScope = new WeakMap<HTMLElement, () => void>();
/** Every live subtree disposer, so a full re-render can stop them all (they're detached roots). */
const liveScopes = new Set<() => void>();

/**
 * Render the shadow-doc node at `docPath` into a detached DOM subtree, stamped and
 * edit-mode-prepared exactly like the full render. Throws when the path resolves to nothing.
 *
 * Inside a repeater the node has an element per row, and `instance` says which one is being drawn:
 * it is rendered with THAT row's scope, at that row's render path, so its bindings read its own
 * item and its stamps name its own row (studio.md §4.5). The page's scope there, which is what this
 * used before rows were drawn, resolves `item` to nothing.
 */
export function renderSubtreeIframe(
  shadowDoc: JxMutableNode,
  docPath: JxPath,
  ctx: IframeRenderCtx,
  instance?: SubtreeInstance,
): HTMLElement | Text {
  /* SAFETY: a widening of getNodeAtPath's declared return. A patch path addresses an entry of a
   * `children` array, which the schema types as `JxMutableNode | string`, and a missing step
   * answers undefined, so those three cases are the whole range. */
  const node = getNodeAtPath(shadowDoc, docPath) as JxMutableNode | string | undefined;
  if (node === undefined) {
    throw new Error(`iframe-patch-node-not-found:${docPath.join("/")}`);
  }
  // A string member is prepared too: a templated one is a chip or a text run, never a bare
  // Resolved value.
  const def = isString(node)
    ? prepareTextMember(node)
    : prepareForEditMode(stripEventHandlers(node));
  /* A draw: what it creates is settled by the patch that asked for it, and a row one of its lists
     draws is drawn from the document as it now is (`RowView.drawing`). */
  ctx.rows.drawing += 1;
  let drawn: { result: HTMLElement | Text; stop: () => void };
  try {
    drawn = runScoped(() =>
      renderNode(def, instance?.scope ?? ctx.defs, {
        ...ctx.hooks,
        _path: docPathToRenderPath(withRowIndices(docPath, instance?.rows ?? []), ctx),
        onNodeCreated: makeStamper(ctx.mapperCtx, ctx.rows),
      }),
    );
  } finally {
    ctx.rows.drawing -= 1;
  }
  const { result: rendered, stop } = drawn;
  // Track the disposer for bulk dispose on full re-render; element disposers are also keyed by their
  // Root element so a targeted remove/replace can stop just that subtree (a bare text node owns none).
  liveScopes.add(stop);
  if (rendered instanceof HTMLElement) {
    elScope.set(rendered, stop);
  }
  return rendered;
}

/**
 * Release a removed/replaced subtree: stop the effect scopes rooted inside it and hand every
 * element's rule set back to the runtime's stylesheet engine (otherwise its rules orphan in the
 * iframe's adopted sheet).
 */
export function disposeSubtree(el: Element): void {
  const targets: Element[] = [el, ...el.querySelectorAll("*")];
  for (const t of targets) {
    if (!(t instanceof HTMLElement)) {
      continue;
    }
    releaseElementStyles(t);
    const stop = elScope.get(t);
    if (stop) {
      stop();
      liveScopes.delete(stop);
      elScope.delete(t);
    }
  }
}

/** Stop every live subtree scope — called before a full re-render replaces the whole document. */
export function disposeAllSubtrees(): void {
  for (const stop of liveScopes) {
    stop();
  }
  liveScopes.clear();
}

/**
 * Inverse of the path mapper's layout-prefix strip: shadow-doc paths are page-relative, render
 * paths are layout-merged. Re-applies the slot-container offset so the runtime renders the subtree
 * at the same render path the full render used. The path may carry row indices; they sit below the
 * prefix and pass through. (`$switch` paths never reach here — they escalate.)
 */
function docPathToRenderPath(docPath: JxPath, ctx: IframeRenderCtx): (string | number)[] {
  const { mapperCtx } = ctx;
  if (mapperCtx.layoutWrapped && mapperCtx.pageContentPrefix && docPath[0] === "children") {
    const [, idx] = docPath;
    return isNumber(idx)
      ? [
          ...mapperCtx.pageContentPrefix,
          idx + (mapperCtx.pageContentOffset ?? 0),
          ...docPath.slice(2),
        ]
      : [...mapperCtx.pageContentPrefix, ...docPath.slice(1)];
  }
  return docPath;
}
