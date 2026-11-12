/// <reference lib="dom" />
/**
 * Inline-edit apply logic — turns the serializable result of a contenteditable session (committed
 * children/text, a split, or a slash-insert) into `transactDoc` mutations. The inline editing
 * session lives inside the canvas iframe, which posts these plain-JSON results across the bridge
 * for this apply. Every input here is plain JSON — no DOM, no Range — so it crosses the frame
 * boundary.
 */

import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { isNonNullObject, isNumber, isString, templateExpressions } from "@jxsuite/schema/guards";
import { childIndex, parentElementPath } from "../store";
import { isAncestor } from "../state";
import { isTabActive } from "../workspace/workspace";
import {
  mutateInsertNode,
  mutateRemoveNode,
  mutateUpdateProp,
  mutateUpdateProperty,
  transactDoc,
} from "../tabs/transact";
import { defaultDef } from "../panels/shared";
import { componentInstance, mutateImportComponent } from "./insert-component";

import { contentLength, contentOf, sliceContent, spliceAcross, toStored } from "./content-slice";
import type { Content, StoredContent } from "./content-slice";
import type { JxContentResult, SlashCommand } from "./inline-edit";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { SpliceCoordinate } from "../tabs/selection";

/**
 * Whether a committed inline-edit result is effectively empty (blank text / lone whitespace /
 * `<br>`).
 */
export function isEmptyContent(commitData?: JxContentResult): boolean {
  if (!commitData) {
    return true;
  }
  if (commitData.textContent != null && commitData.textContent.trim() === "") {
    return true;
  }
  const kids = commitData.children;
  if (!kids) {
    return false;
  }
  if (kids.length === 0) {
    return true;
  }
  const [only] = kids;
  if (kids.length === 1 && isString(only) && only.trim() === "") {
    return true;
  }
  // The result crossed the frame boundary as JSON, so a `null` child is excluded here explicitly.
  return kids.length === 1 && isNonNullObject(only) && only.tagName === "br";
}

// ─── Bindings a commit must not write over ───────────────────────────────────────

/**
 * Told the path of a block whose commit was refused because it would have dropped a binding.
 *
 * The document is unchanged when this runs, and the canvas may be showing what was not saved, so
 * the caller that owns the canvas draws the block again from the document and says so.
 */
export type CommitRefused = (path: JxPath) => void;

/** Add each `${…}` of `text`, as written, to `into`. */
function countBindings(text: string, into: Map<string, number>): void {
  for (const { start, end } of templateExpressions(text)) {
    const binding = text.slice(start, end);
    into.set(binding, (into.get(binding) ?? 0) + 1);
  }
}

/**
 * The bindings held by STRING MEMBERS of `children`, at any depth of inline markup.
 *
 * These are the ones the canvas draws resolved: a member string is rendered as a bound text node,
 * so what the caret meets, and what a commit serializes, is the value (`Ada`) and not the template
 * (`${state.name}`). A `textContent` template is not counted, here or in a nested element: it is
 * drawn as its binding and restored to its source when the caret enters, so it comes back from an
 * edit as itself, and one that does not was deleted by the author.
 */
function memberBindings(children: Content, into: Map<string, number>): Map<string, number> {
  for (const child of children) {
    if (isString(child)) {
      countBindings(child, into);
    } else if (isNonNullObject(child) && Array.isArray(child.children)) {
      memberBindings(child.children, into);
    }
  }
  return into;
}

/** Every binding `content` carries, wherever it sits: a member string or an element's own text. */
function carriedBindings(
  content: JxContentResult | StoredContent | undefined,
  into: Map<string, number>,
): void {
  if (!content) {
    return;
  }
  if (isString(content.textContent)) {
    countBindings(content.textContent, into);
  }
  for (const child of content.children ?? []) {
    if (isString(child)) {
      countBindings(child, into);
    } else if (isNonNullObject(child)) {
      carriedBindings(
        {
          children: Array.isArray(child.children) ? child.children : [],
          textContent: isString(child.textContent) ? child.textContent : null,
        },
        into,
      );
    }
  }
}

/**
 * Whether writing `committed` over `node`'s content would lose a binding that a string member of
 * its stored `children` holds.
 *
 * The canvas draws such a member resolved, and a contenteditable session commits when the caret
 * leaves whether or not anything was typed, so without this an author who clicked into `["Hello ",
 * "${state.name}"]` and out again had `"Hello Ada"` stored in its place: the template replaced by
 * one of its values, with nothing on screen changing. A commit that still carries every such
 * binding, as many times as the block held it, is an edit of the text around them and goes through.
 * `committed` is every piece the write keeps (a split keeps two).
 */
export function dropsMemberBinding(
  node: JxMutableNode | undefined | null,
  committed: readonly (JxContentResult | StoredContent | undefined)[],
): boolean {
  if (!node || !Array.isArray(node.children)) {
    return false;
  }
  const held = memberBindings(node.children, new Map<string, number>());
  if (held.size === 0) {
    return false;
  }
  const carried = new Map<string, number>();
  for (const content of committed) {
    carriedBindings(content, carried);
  }
  for (const [binding, count] of held) {
    if ((carried.get(binding) ?? 0) < count) {
      return true;
    }
  }
  return false;
}

/** The slot of the block at `path`. */
function blockSlot(path: JxPath): SpliceCoordinate {
  /* SAFETY: a block with a sibling position has an element path ending in `"children", <index>`, so
     it has a parent element path and its last segment is the numeric child index. A repeater's
     template root (`…, "map"`) is editable too; callers do not exclude that case yet, so it reaches
     here with a string segment exactly as before this cast. */
  return { index: childIndex(path) as number, parentPath: parentElementPath(path) as JxPath };
}

/**
 * Commit edited content to the node at `path` of `tab`'s document (children when rich, else
 * textContent). No-op if unchanged or the originating tab is gone. `tab` is the tab the edit
 * session belonged to (resolved host-side from the posting iframe) — NEVER the active tab at
 * message time, which may have changed while the commit was in flight.
 *
 * Refused, with the document untouched and `opts.onRefused` told, when the commit would drop a
 * binding a string member of the stored `children` holds ({@link dropsMemberBinding}).
 */
export function applyInlineCommit(
  tab: Tab | null,
  path: JxPath,
  children: (JxMutableNode | string)[] | null,
  textContent: string | null,
  opts: { coalesceKey?: string | null; onRefused?: CommitRefused } = {},
): void {
  if (!tab) {
    return;
  }
  const node = getNodeAtPath(tab.doc.document, path);
  if (
    (children || textContent != null) &&
    dropsMemberBinding(node, [children ? { children } : { textContent }])
  ) {
    opts.onRefused?.(path);
    return;
  }
  // Only clear the counterpart key when it actually exists: deleting an absent key is a semantic
  // No-op, but the recorded op isn't — a spurious `set-prop children` turns a cheap in-place text
  // Patch into a subtree re-render (and, pre-relaxation, forced a full render inside components).
  if (children) {
    if (node && JSON.stringify(node.children) === JSON.stringify(children)) {
      return;
    }
    transactDoc(
      tab,
      (t) => {
        if (node?.textContent != null) {
          mutateUpdateProperty(t, path, "textContent");
        }
        mutateUpdateProperty(t, path, "children", children);
      },
      { coalesceKey: opts.coalesceKey ?? null },
    );
  } else if (textContent != null) {
    if (node && node.textContent === textContent && !node.children) {
      return;
    }
    transactDoc(
      tab,
      (t) => {
        if (node?.children) {
          mutateUpdateProperty(t, path, "children");
        }
        mutateUpdateProperty(t, path, "textContent", textContent);
      },
      { coalesceKey: opts.coalesceKey ?? null },
    );
  }
}

/**
 * Commit a prop-bound inline edit: persist `value` into `$props[prop]` of the component instance at
 * `path`. The unchanged-value no-op is LOAD-BEARING, not cosmetic: Escape-cancel and
 * patch-disturbed sessions post unchanged values, and without the equality check a commit→patch→
 * disturb→re-commit cycle loops (and pollutes undo history). An empty value deletes the prop
 * (mutateUpdateProp), reverting the instance to the definition default — same as clearing the
 * sidebar field.
 *
 * @returns Whether it transacted. The caller needs to know: an in-place commit's patch is
 *   echo-suppressed so the caret survives, and the release that follows is expected to re-render
 *   the instance for real. When the release posts the same value it no-ops here, nothing
 *   re-renders, and the canvas keeps showing pre-edit output — see the reconcile in iframe-host.
 */
export function applyInlinePropCommit(
  tab: Tab | null,
  path: JxPath,
  prop: string,
  value: string,
): boolean {
  if (!tab) {
    return false;
  }
  const node = getNodeAtPath(tab.doc.document, path);
  if (!node) {
    return false;
  }
  const current = node.$props?.[prop];
  if (`${current ?? ""}` === value) {
    return false;
  }
  transactDoc(tab, (t) => {
    mutateUpdateProp(t, path, prop, value);
  });
  return true;
}

/**
 * Join the block at `fromPath` onto the end of the block at `intoPath`, removing the former.
 *
 * Backspace at a block's start and Delete at a block's end are the same operation approached from
 * either side, so both land here. Returns the caret's document position at the seam — the join
 * point, not the end — or null when the merge was refused.
 *
 * Refused when either block is missing, or when one contains the other: a `<li>` and the `<p>`
 * inside it are adjacent in document order but merging them would mean a node absorbing its own
 * parent.
 */
export function applyBlockMerge(
  tab: Tab | null,
  fromPath: JxPath,
  intoPath: JxPath,
): { path: JxPath; offset: number } | null {
  if (!tab) {
    return null;
  }
  const from = getNodeAtPath(tab.doc.document, fromPath);
  const into = getNodeAtPath(tab.doc.document, intoPath);
  if (!from || !into) {
    return null;
  }
  if (isAncestor(fromPath, intoPath) || isAncestor(intoPath, fromPath)) {
    return null;
  }

  const head = contentOf(into);
  const tail = contentOf(from);
  const seam = contentLength(head);
  const merged = toStored([...head, ...tail]);

  transactDoc(tab, (t) => {
    // Write the joined content BEFORE removing the source: updating a node never shifts indices,
    // So `fromPath` is still valid when the removal runs.
    if (merged.children) {
      if (into.textContent != null) {
        mutateUpdateProperty(t, intoPath, "textContent");
      }
      mutateUpdateProperty(t, intoPath, "children", merged.children);
    } else {
      if (into.children) {
        mutateUpdateProperty(t, intoPath, "children");
      }
      mutateUpdateProperty(t, intoPath, "textContent", merged.textContent ?? "");
    }
    mutateRemoveNode(t, fromPath);
    /* A container emptied by the removal (the `<ul>` behind a list's last item) would otherwise
       linger as invisible structure that still occupies layout and shows up in the layers panel.
       SAFETY: `fromPath` is not the root (the ancestor check above refuses `[]`), and any node below
       the root is addressed by at least two segments (`"children", <index>`, `"cases", <name>`, or
       `"map"` under its repeater), so parentElementPath returns a path. */
    pruneEmptyAncestors(t, parentElementPath(fromPath) as JxPath);
    if (isTabActive(tab)) {
      t.session.selection = [intoPath];
    }
  });

  return { offset: seam, path: intoPath };
}

/**
 * Remove `path` and its now-childless ancestors, stopping at the document root or the first
 * ancestor that still has content.
 */
function pruneEmptyAncestors(tab: Tab, path: JxPath): void {
  let cur = path;
  while (cur.length > 0) {
    const node = getNodeAtPath(tab.doc.document, cur);
    const kids = node?.children;
    if (!node || !Array.isArray(kids) || kids.length > 0) {
      return;
    }
    const parent = parentElementPath(cur);
    mutateRemoveNode(tab, cur);
    if (!parent) {
      return;
    }
    cur = parent;
  }
}

/**
 * Apply a paragraph split to `tab`'s document: keep `before` in the node, insert a new `<p>` with
 * `after`. Returns its path (unchanged when `tab` is gone — the caller may still use it for
 * bookkeeping, but nothing is mutated).
 */
export function applyInlineSplit(
  tab: Tab | null,
  path: JxPath,
  before: JxContentResult,
  after: JxContentResult,
  onRefused?: CommitRefused,
): JxPath {
  const { parentPath, index: idx } = blockSlot(path);
  const newPath = [...parentPath, "children", idx + 1];
  if (!tab) {
    return newPath;
  }
  // Both halves come from the canvas, so a binding drawn resolved is in neither: the block stays.
  if (dropsMemberBinding(getNodeAtPath(tab.doc.document, path), [before, after])) {
    onRefused?.(path);
    return path;
  }
  const newNode: JxMutableNode = { tagName: "p" };
  if (after.textContent != null) {
    newNode.textContent = after.textContent;
  } else if (after.children) {
    newNode.children = after.children;
  } else {
    newNode.textContent = "";
  }

  transactDoc(tab, (t) => {
    if (before.textContent != null) {
      mutateUpdateProperty(t, path, "children");
      mutateUpdateProperty(t, path, "textContent", before.textContent);
    } else if (before.children) {
      mutateUpdateProperty(t, path, "textContent");
      mutateUpdateProperty(t, path, "children", before.children);
    }
    mutateInsertNode(t, parentPath, idx + 1, newNode);
    // A background tab's selection stays exactly as the user left it — only the visible tab's
    // Selection follows the split.
    if (isTabActive(tab)) {
      t.session.selection = [newPath];
    }
  });
  return newPath;
}

/**
 * A slash pick from the Components group (§5.7): the empty block the "/" was typed in is REPLACED
 * by an instance of the component, and a block with content keeps it and gets the instance after
 * it. Either way the component is imported, as a drop of the same component would import it. An
 * instance is a whole element with its own `$props` and slot content, so swapping a tag in place —
 * what an HTML pick does — would leave a paragraph's leftovers inside a component.
 */
function insertComponentBlock(
  tab: Tab | null,
  path: JxPath,
  instance: JxMutableNode,
  commitData: JxContentResult | undefined,
): JxPath {
  const { parentPath, index: idx } = blockSlot(path);
  const replace = isEmptyContent(commitData);
  const at = replace ? idx : idx + 1;
  const newPath = [...parentPath, "children", at];
  if (!tab) {
    return newPath;
  }
  transactDoc(tab, (t) => {
    if (replace) {
      mutateRemoveNode(t, path);
    } else if (commitData?.children) {
      mutateUpdateProperty(t, path, "textContent");
      mutateUpdateProperty(t, path, "children", commitData.children);
    } else if (commitData?.textContent != null) {
      mutateUpdateProperty(t, path, "children");
      mutateUpdateProperty(t, path, "textContent", commitData.textContent);
    }
    mutateInsertNode(t, parentPath, at, instance);
    mutateImportComponent(t, instance.tagName);
    if (isTabActive(tab)) {
      t.session.selection = [newPath];
    }
  });
  return newPath;
}

/**
 * Apply a slash-insert at `path` of `tab`'s document: swap the (empty) node's tag in place, or
 * commit pending content and insert a new element after it. Returns the path to edit next (the
 * swapped node or the new one); nothing is mutated when `tab` is gone.
 *
 * `commitData` is the block as the canvas drew it, and both branches write it (the empty one by
 * clearing the block), so an insert that would drop a binding is refused like a commit is: the
 * block is returned as the path to edit and `onRefused` is told.
 */
export function applyInlineInsert(
  tab: Tab | null,
  path: JxPath,
  cmd: SlashCommand,
  commitData: JxContentResult | undefined,
  onRefused?: CommitRefused,
): JxPath {
  if (tab && dropsMemberBinding(getNodeAtPath(tab.doc.document, path), [commitData])) {
    onRefused?.(path);
    return path;
  }
  const instance = cmd.component === true ? componentInstance(cmd.tag) : null;
  if (instance) {
    return insertComponentBlock(tab, path, instance, commitData);
  }
  if (isEmptyContent(commitData)) {
    if (!tab) {
      return path;
    }
    transactDoc(tab, (t) => {
      mutateUpdateProperty(t, path, "tagName", cmd.tag);
      mutateUpdateProperty(t, path, "children");
      const def = defaultDef(cmd.tag);
      if (def.textContent && def.textContent !== "Paragraph text") {
        mutateUpdateProperty(t, path, "textContent", def.textContent);
      } else {
        mutateUpdateProperty(t, path, "textContent");
      }
      if (isTabActive(tab)) {
        t.session.selection = [path];
      }
    });
    return path;
  }

  const { parentPath, index: idx } = blockSlot(path);
  const newPath = [...parentPath, "children", idx + 1];
  if (!tab) {
    return newPath;
  }
  const elementDef = defaultDef(cmd.tag);

  transactDoc(tab, (t) => {
    if (commitData?.children) {
      mutateUpdateProperty(t, path, "textContent");
      mutateUpdateProperty(t, path, "children", commitData.children);
    } else if (commitData?.textContent != null) {
      mutateUpdateProperty(t, path, "children");
      mutateUpdateProperty(t, path, "textContent", commitData.textContent);
    }
    mutateInsertNode(t, parentPath, idx + 1, structuredClone(elementDef));
    if (isTabActive(tab)) {
      t.session.selection = [newPath];
    }
  });
  return newPath;
}

/**
 * Replace a selection that spans blocks with `text` (empty for a deletion).
 *
 * Collapsing a cross-block range is a merge with both ends clipped: the first block keeps what
 * precedes the selection, the last keeps what follows it, the two are joined, and every block
 * between them is removed. `between` is supplied by the iframe because document order lives in the
 * rendered DOM — the same reason a boundary merge names its neighbour there.
 *
 * Returns the caret's position after the collapse (the join point, plus any typed text), or null
 * when the range does not resolve or the replace was refused.
 *
 * Refused over a binding a string member of either end holds. The content cut here is the stored
 * one, but the OFFSETS are the canvas's, counted over the resolved value: against `["Hi ",
 * "${state.name}"]` drawn as "Hi Ada" they fall anywhere in the template, and a cut through it
 * stores `"Hi ${sta"`. The two ends are judged apart, because they are cut on opposite sides:
 *
 * - The HEAD keeps what precedes its offset, so a head that holds such a binding is always refused.
 *   Either the cut loses the binding, or the offset lies past it and is wrong by the difference
 *   between the template's length and its value's: the binding would survive and the text around it
 *   would be cut somewhere the author did not point.
 * - The TAIL keeps what follows its offset, which is exact up to the first binding, so it is refused
 *   only when what it keeps has lost one. It is counted against its own kept part alone: a binding
 *   the head's text happens to spell the same way does not stand in for it.
 *
 * A block that is removed whole (`between`) is a deletion the author asked for and is not checked.
 */
export function applyRangeReplace(
  tab: Tab | null,
  from: { path: JxPath; offset: number },
  to: { path: JxPath; offset: number },
  between: JxPath[],
  text: string,
  onRefused?: CommitRefused,
): { path: JxPath; offset: number } | null {
  if (!tab) {
    return null;
  }
  const head = getNodeAtPath(tab.doc.document, from.path);
  const tail = getNodeAtPath(tab.doc.document, to.path);
  if (!head || !tail) {
    return null;
  }
  if (isAncestor(from.path, to.path) || isAncestor(to.path, from.path)) {
    return null;
  }

  const tailContent = contentOf(tail);
  const tailKept = sliceContent(tailContent, to.offset, contentLength(tailContent));
  if (dropsMemberBinding(head, []) || dropsMemberBinding(tail, [{ children: tailKept }])) {
    onRefused?.(from.path);
    return null;
  }
  const joined = toStored(spliceAcross(contentOf(head), from.offset, tailContent, to.offset, text));
  // Remove the deepest/last paths first so an earlier removal cannot shift a later one's index.
  const removals = [...between, to.path].toSorted(comparePathsDescending);

  transactDoc(tab, (t) => {
    if (joined.children) {
      if (head.textContent != null) {
        mutateUpdateProperty(t, from.path, "textContent");
      }
      mutateUpdateProperty(t, from.path, "children", joined.children);
    } else {
      if (head.children) {
        mutateUpdateProperty(t, from.path, "children");
      }
      mutateUpdateProperty(t, from.path, "textContent", joined.textContent ?? "");
    }
    for (const path of removals) {
      if (getNodeAtPath(t.doc.document, path)) {
        mutateRemoveNode(t, path);
        /* SAFETY: every removal is the range's tail or a rendered block the iframe named between its
           ends; none is the root, which contains both ends, and any node below the root is
           addressed by at least two segments, so parentElementPath returns a path. */
        pruneEmptyAncestors(t, parentElementPath(path) as JxPath);
      }
    }
    if (isTabActive(tab)) {
      t.session.selection = [from.path];
    }
  });

  return { offset: from.offset + text.length, path: from.path };
}

/**
 * Order two paths so the LATER one in the document sorts first — the order removals must run in,
 * since removing an earlier sibling renumbers every path after it.
 */
function comparePathsDescending(a: JxPath, b: JxPath): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) {
      continue;
    }
    if (isNumber(av) && isNumber(bv)) {
      return bv - av;
    }
    return String(bv).localeCompare(String(av));
  }
  return b.length - a.length;
}
