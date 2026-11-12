/// <reference lib="dom" />
/**
 * Inline-edit apply logic — turns the serializable result of a contenteditable session (committed
 * children/text, a split, or a slash-insert) into `transactDoc` mutations. The inline editing
 * session lives inside the canvas iframe, which posts these plain-JSON results across the bridge
 * for this apply. Every input here is plain JSON — no DOM, no Range — so it crosses the frame
 * boundary.
 */

import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import {
  isNodeObject,
  isNonNullObject,
  isNumber,
  isRef,
  isString,
  templateExpressions,
} from "@jxsuite/schema/guards";
import { templateSegments } from "@jxsuite/schema/dynamic-tag";
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
import { isDocumentContainer } from "../utils/strip-events";
import { INNER_TEXT, needsEvaluation, refBindingKey } from "../utils/edit-display";
import { componentInstance, mutateImportComponent } from "./insert-component";

import {
  contentLength,
  contentOf,
  isAtomicInline,
  isWholeTemplate,
  normalizeContent,
  sameContent,
  sliceContent,
  spliceAcross,
  stableJson,
  toStored,
} from "./content-slice";
import type { Content, StoredContent } from "./content-slice";
import type { JxContentResult, SlashCommand } from "./inline-edit";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
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

/** A count of bindings, keyed by where each stands and how it is written. */
type BindingCounts = Map<string, number>;

/** What separates a binding's place from its spelling in a key. No document string holds it. */
const SLOT_SEPARATOR = "\u0000";

/** Count one more of `key`. */
function count(into: BindingCounts, key: string): void {
  into.set(key, (into.get(key) ?? 0) + 1);
}

/**
 * Count every binding in `value`, a property of an element other than its text, under `slot`: the
 * key path it sits at (`attributes/href`, `innerHTML`, `style/color`).
 *
 * The slot is part of the key because a binding is not only its spelling. A link's `href` bound to
 * `${state.url}` and the same expression typed into the paragraph's text are two different things,
 * and counting them alike let the second stand in for the first: the serializer rebuilt the link
 * with its resolved URL, the typed copy balanced the books, and the commit went through.
 */
function countSlot(value: JxDocumentValue | undefined, slot: string, into: BindingCounts): void {
  if (isString(value)) {
    for (const { start, end } of templateExpressions(value)) {
      count(into, slot + SLOT_SEPARATOR + value.slice(start, end));
    }
  } else if (isRef(value)) {
    count(into, slot + SLOT_SEPARATOR + refBindingKey(value.$ref));
  } else if (isDocumentContainer(value)) {
    // An array's members or an object's values: `Object.entries` reads either.
    for (const [key, member] of Object.entries(value)) {
      countSlot(member, `${slot}/${key}`, into);
    }
  }
}

/**
 * Count the bindings in a `textContent`: each `${…}` under its own spelling, and a `{ "$ref" }`
 * under {@link refBindingKey}. Text is one slot wherever it stands, because the author moves it: a
 * chip dragged into a `<strong>` is still that binding.
 */
function countText(value: JxDocumentValue | undefined, into: BindingCounts): void {
  if (isString(value)) {
    for (const { start, end } of templateExpressions(value)) {
      count(into, value.slice(start, end));
    }
  } else if (isRef(value)) {
    count(into, refBindingKey(value.$ref));
  }
}

/** Count the bindings an inline child holds: its text as text, every other property by its slot. */
function countElement(element: JxMutableNode, into: BindingCounts): void {
  for (const [key, value] of Object.entries(element)) {
    if (key === "textContent") {
      countText(value, into);
    } else if (key === "children" && Array.isArray(value)) {
      countMembers(value, into);
    } else {
      countSlot(value, key, into);
    }
  }
}

/**
 * The key a string member that is one whole `${…}` is ALSO counted under, beside its spelling.
 *
 * Such a member is the one string whose value may be nodes: an array there is spliced in as
 * elements (spec.md §8.4). Joined to the text beside it, or folded into a `textContent`, the same
 * expression is still there and the list it drew is its string form. So standing alone is counted
 * as something a write can lose, even though every `${…}` survives it.
 */
function memberKey(binding: string): string {
  return `member${SLOT_SEPARATOR}${binding}`;
}

/** Count the bindings the members of a `children` array hold. */
function countMembers(members: readonly JxDocumentValue[], into: BindingCounts): void {
  for (const member of members) {
    if (isString(member)) {
      countText(member, into);
      if (isWholeTemplate(member)) {
        count(into, memberKey(member));
      }
    } else if (isNodeObject(member)) {
      countElement(member, into);
    }
  }
}

/**
 * Count the bindings a block's CONTENT holds: its `textContent`, its `children`, and the two other
 * properties that draw content, `innerHTML` and `innerText`. Not its attributes or its style, which
 * a commit does not write.
 *
 * Children that are not an array (computed children, a `{ "$ref" }`), `innerHTML` and `innerText`
 * are counted under their own slots, which nothing a commit carries can match: a block that draws
 * its content from one of them has no text of its own to write, and any write to it is refused.
 */
function countContent(
  content: JxContentResult | StoredContent | JxMutableNode | undefined | null,
  into: BindingCounts,
): BindingCounts {
  if (!content) {
    return into;
  }
  countText(content.textContent, into);
  if (Array.isArray(content.children)) {
    countMembers(content.children, into);
  } else {
    countSlot(content.children, "children", into);
  }
  if ("innerHTML" in content) {
    countSlot(content.innerHTML, "innerHTML", into);
  }
  if (INNER_TEXT in content) {
    countSlot(content[INNER_TEXT], INNER_TEXT, into);
  }
  return into;
}

/** A block whose content a write replaces, or nothing where the path did not resolve. */
type HeldContent = JxMutableNode | StoredContent | undefined | null;

/** Whether {@link dropsBinding} was handed several blocks rather than one. */
function isContentList(
  nodes: HeldContent | readonly HeldContent[],
): nodes is readonly HeldContent[] {
  return Array.isArray(nodes);
}

/**
 * Whether writing `committed` over the content of `nodes` would lose a binding that content holds
 * (studio.md §4.5, §8.2.7): the third of the three guards that keep a commit from storing a value
 * where a binding was, and the one that does not depend on the canvas having drawn anything right.
 *
 * The canvas draws a binding resolved, inside a chip, and serializes the chip as the expression it
 * carries. So a write that took its content from the canvas carries every binding the block held,
 * as many times as it held it and each in the place it held it, unless something went wrong (a chip
 * the canvas did not draw, an element rebuilt without the attribute that held a binding, a `{
 * "$ref" }` written as its value) or the author deleted the chip. `removed` is the second case,
 * reported by the editing session, and each entry excuses one copy of a binding in text. Anything
 * else that is missing is refused: silently storing "Hello Ada" where `Hello ${state.name}` stood
 * is the failure this exists to make impossible.
 *
 * `nodes` is every block the write replaces the content of (a merge and a range replace read two),
 * and `committed` every piece the write keeps (a split keeps two).
 */
export function dropsBinding(
  nodes: HeldContent | readonly HeldContent[],
  committed: readonly (JxContentResult | StoredContent | undefined)[],
  removed: readonly string[] = [],
): boolean {
  const held: BindingCounts = new Map<string, number>();
  for (const node of isContentList(nodes) ? nodes : [nodes]) {
    countContent(node, held);
  }
  if (held.size === 0) {
    return false;
  }
  for (const binding of removed) {
    // A deleted chip excuses one copy of its binding, and one whole member if it was one.
    for (const key of [binding, memberKey(binding)]) {
      const had = held.get(key);
      if (had !== undefined) {
        held.set(key, had - 1);
      }
    }
  }
  const carried: BindingCounts = new Map<string, number>();
  for (const content of committed) {
    countContent(content, carried);
  }
  for (const [binding, had] of held) {
    if ((carried.get(binding) ?? 0) < had) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `offset` falls strictly inside a part of `content` that is one unit, counted as the
 * canvas counts: a `${…}`, or a literal run of a template that only reads right evaluated (the
 * canvas draws both as chips, `utils/edit-display.ts`). A cut there would leave half an expression,
 * or half an escape, on each side.
 */
function cutsBinding(content: Content, offset: number): boolean {
  let pos = 0;
  for (const child of content) {
    if (isString(child)) {
      if (cutsTemplate(child, offset - pos)) {
        return true;
      }
      pos += child.length;
      continue;
    }
    if (isAtomicInline(child)) {
      continue;
    }
    const inner = contentOf(child);
    if (cutsBinding(inner, offset - pos)) {
      return true;
    }
    pos += contentLength(inner);
  }
  return false;
}

/** {@link cutsBinding} for one string. */
function cutsTemplate(text: string, offset: number): boolean {
  if (!text.includes("${")) {
    return false;
  }
  let pos = 0;
  for (const segment of templateSegments(text)) {
    const length = segment.type === "literal" ? segment.text.length : segment.source.length;
    const atomic = segment.type !== "literal" || needsEvaluation(segment.text);
    if (atomic && offset > pos && offset < pos + length) {
      return true;
    }
    pos += length;
  }
  return false;
}

/**
 * Whether a piece cut from a template would change meaning by being stored: it no longer holds a
 * `${`, so it would be read as literal text, and it holds a backslash or a backtick, which the
 * template it came from read as an escape. `C:\\temp ${state.x}` cut after the space leaves
 * `C:\\temp `, a string that now shows both backslashes.
 */
function losesEscapes(kept: Content, from: Content): boolean {
  const templated = from.some((child) => isString(child) && child.includes("${"));
  return (
    templated &&
    kept.some(
      (child) =>
        isString(child) && !child.includes("${") && (child.includes("\\") || child.includes("`")),
    )
  );
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
 * binding the stored content holds that `opts.removedTags` does not name ({@link dropsBinding}).
 *
 * A commit that says what the block already holds writes nothing, however the two spell it: the
 * canvas hands back a templated `["Hello ", "${state.name}"]` as one joined string, and a caret
 * that only visited the block must not dirty the document by re-spelling it.
 */
export function applyInlineCommit(
  tab: Tab | null,
  path: JxPath,
  children: (JxMutableNode | string)[] | null,
  textContent: string | null,
  opts: {
    coalesceKey?: string | null;
    onRefused?: CommitRefused;
    removedTags?: readonly string[];
  } = {},
): void {
  if (!tab) {
    return;
  }
  const node = getNodeAtPath(tab.doc.document, path);
  const committed: JxContentResult | null = children
    ? { children }
    : textContent == null
      ? null
      : { textContent };
  if (committed && dropsBinding(node, [committed], opts.removedTags)) {
    opts.onRefused?.(path);
    return;
  }
  if (committed && node && sameContent(node, committed)) {
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
 * parent. Refused too, with `onRefused` told, if the joined content would hold fewer bindings than
 * the two blocks did ({@link dropsBinding}): a join of two blocks of text cannot, since it joins
 * STORED content, but a block that draws its content from data (computed children, a `{ "$ref" }`
 * text, bound `innerHTML`) has none to join, and writing the other block's text into it would
 * replace what it draws.
 */
export function applyBlockMerge(
  tab: Tab | null,
  fromPath: JxPath,
  intoPath: JxPath,
  onRefused?: CommitRefused,
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
  /* Asked of the two BLOCKS, not of the content read from them: a block whose content is computed
     children, a `{ "$ref" }` text, bound `innerHTML`, or a template beside children has no content
     that reading yields, and the join would have written over it unasked. */
  if (dropsBinding([into, from], [merged])) {
    onRefused?.(intoPath);
    return null;
  }
  // Nothing joined on: the surviving block keeps its content exactly as it is spelled.
  const rewrite = tail.length > 0;

  transactDoc(tab, (t) => {
    // Write the joined content BEFORE removing the source: updating a node never shifts indices,
    // So `fromPath` is still valid when the removal runs.
    if (!rewrite) {
      // The source is removed below; the surviving block's content stands.
    } else if (merged.children) {
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
  removedTags?: readonly string[],
): JxPath {
  const { parentPath, index: idx } = blockSlot(path);
  const newPath = [...parentPath, "children", idx + 1];
  if (!tab) {
    return newPath;
  }
  // Both halves come from the canvas, and a chip is whole in one of them or deleted: else refused.
  if (dropsBinding(getNodeAtPath(tab.doc.document, path), [before, after], removedTags)) {
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
  removedTags?: readonly string[],
): JxPath {
  if (tab && dropsBinding(getNodeAtPath(tab.doc.document, path), [commitData], removedTags)) {
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
 * Refused when it would lose a binding the selection did not cover. An offset is counted over the
 * canvas, where a chip is as long as the expression it stands for (`canvas/iframe-position.ts`), so
 * it is the same offset into the stored content and the cut is exact. Two things are still checked,
 * because a wrong offset here is silent damage to the author's source:
 *
 * - Neither offset may fall inside a `${…}`, or inside a literal run of a template that holds an
 *   escape: that would store half an expression, or half an escape, on each side. And no piece cut
 *   from a template may be left holding an escape and no `${`, since it would then be read as
 *   literal text and show the backslash.
 * - What the two ends keep must carry every binding they held, except those in `removedTags`: the
 *   chips the selection covered, which the session reports. A binding lost and not reported was not
 *   the author's deletion.
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
  removedTags?: readonly string[],
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

  const headContent = contentOf(head);
  const tailContent = contentOf(tail);
  const keptHead = sliceContent(headContent, 0, from.offset);
  const keptTail = sliceContent(tailContent, to.offset, contentLength(tailContent));
  if (
    cutsBinding(headContent, from.offset) ||
    cutsBinding(tailContent, to.offset) ||
    losesEscapes(keptHead, headContent) ||
    losesEscapes(keptTail, tailContent) ||
    // Asked of the two BLOCKS: see `applyBlockMerge`.
    dropsBinding([head, tail], [{ children: keptHead }, { children: keptTail }], removedTags)
  ) {
    onRefused?.(from.path);
    return null;
  }
  const spliced = spliceAcross(headContent, from.offset, tailContent, to.offset, text);
  const joined = toStored(spliced);
  // The first block is kept whole and nothing is joined on: its content stands as it is spelled.
  const rewrite = stableJson(spliced) !== stableJson(normalizeContent(headContent));
  // Remove the deepest/last paths first so an earlier removal cannot shift a later one's index.
  const removals = [...between, to.path].toSorted(comparePathsDescending);

  transactDoc(tab, (t) => {
    if (!rewrite) {
      // Only the blocks after it are removed, below.
    } else if (joined.children) {
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
