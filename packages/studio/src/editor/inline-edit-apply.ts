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
  mutateUpdateInstanceProp,
  mutateUpdateProperty,
  transactDoc,
} from "../tabs/transact";
import { defaultDef } from "../panels/shared";
import {
  INNER_TEXT,
  holdsOpaqueLiteral,
  needsEvaluation,
  openMarkup,
  refBindingKey,
  slotBindingKeys,
} from "../utils/edit-display";
import { propSource } from "../utils/prop-source";
import { componentInstance, mutateImportComponent } from "./insert-component";

import {
  contentLength,
  contentOf,
  isAtomicInline,
  isWholeTemplate,
  piecesOf,
  sameContent,
  spliceAcross,
  stableJson,
  storePieces,
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
export type CommitRefused = (path: JxPath, reason: RefusalReason) => void;

/**
 * Why a write was refused ({@link bindingRefusal}).
 *
 * - `lost`: it would have dropped a binding the content holds, which is how a binding's current value
 *   comes to be stored in its place.
 * - `alone`: it would have left a binding that is printed standing as a string member of its own,
 *   where an array it yields is spliced in as nodes instead (spec.md §8.4).
 * - `markup`: a block it writes to, or removes, spells its content as a literal `innerHTML` or
 *   `innerText` the canvas cannot be read back for (`utils/plain-markup.ts`), so there is no stored
 *   content to join or cut and the write would have replaced markup nobody edited.
 */
export type RefusalReason = "lost" | "alone" | "markup";

/** Told the path of a block whose commit wrote nothing because it only re-spelled the block. */
export type CommitRespelled = (path: JxPath) => void;

/** A count of bindings, keyed by where each stands and how it is written. */
type BindingCounts = Map<string, number>;

/** What separates the member mark from a binding's spelling in a {@link memberKey}. */
const MEMBER_PREFIX = "member\u0000";

/** Count one more of `key`. */
function count(into: BindingCounts, key: string): void {
  into.set(key, (into.get(key) ?? 0) + 1);
}

/**
 * Count every binding in `value`, a property of an element other than its text, under `slot`: the
 * key path it sits at (`attributes/href`, `innerHTML`, `style/color`). The slot is part of the key
 * ({@link slotBindingKeys}): the serializer rebuilt a link with its resolved URL, a copy of the
 * expression typed into the paragraph's text balanced the books, and the commit went through.
 */
function countSlot(value: JxDocumentValue | undefined, slot: string, into: BindingCounts): void {
  for (const key of slotBindingKeys(value, slot)) {
    count(into, key);
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
  return MEMBER_PREFIX + binding;
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
  const held = heldBindings(nodes);
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
  const carried = carriedBindings(committed);
  for (const [binding, had] of held) {
    if ((carried.get(binding) ?? 0) < had) {
      return true;
    }
  }
  return false;
}

/** Every binding the content of `nodes` holds, counted. */
function heldBindings(nodes: HeldContent | readonly HeldContent[]): BindingCounts {
  const held: BindingCounts = new Map<string, number>();
  for (const node of isContentList(nodes) ? nodes : [nodes]) {
    countContent(node, held);
  }
  return held;
}

/** Every binding the pieces a write keeps hold, counted. */
function carriedBindings(
  committed: readonly (JxContentResult | StoredContent | undefined)[],
): BindingCounts {
  const carried: BindingCounts = new Map<string, number>();
  for (const content of committed) {
    countContent(content, carried);
  }
  return carried;
}

/**
 * Why writing `committed` over the content of `nodes` must be refused, or null when it may stand:
 * it would lose a binding ({@link dropsBinding}), leave one that is printed standing as a member of
 * its own ({@link promotesBinding}), or write over literal markup that is not content a commit
 * carries (`holdsOpaqueLiteral`).
 */
export function bindingRefusal(
  nodes: HeldContent | readonly HeldContent[],
  committed: readonly (JxContentResult | StoredContent | undefined)[],
  removed: readonly string[] = [],
): RefusalReason | null {
  for (const node of isContentList(nodes) ? nodes : [nodes]) {
    if (node && holdsOpaqueLiteral(node)) {
      return "markup";
    }
  }
  if (dropsBinding(nodes, committed, removed)) {
    return "lost";
  }
  return promotesBinding(heldBindings(nodes), carriedBindings(committed)) ? "alone" : null;
}

/**
 * Whether `carried` holds, standing as a whole member, a binding that `held` holds only printed.
 *
 * The other direction of what {@link memberKey} guards. A `${…}` inside a longer string, or as a
 * `textContent`, is interpolated into text; the same expression as a string member of its own is
 * spliced in as nodes when it yields an array (spec.md §8.4). So a write that leaves a printed
 * binding standing alone (the text beside it deleted, wrapped or split off) loses nothing and still
 * changes what the page draws. A member is allowed for each copy of the binding the write ADDS,
 * since a binding the author just put there has no earlier meaning to change.
 */
function promotesBinding(held: BindingCounts, carried: BindingCounts): boolean {
  for (const [key, members] of carried) {
    if (!key.startsWith(MEMBER_PREFIX)) {
      continue;
    }
    const binding = key.slice(MEMBER_PREFIX.length);
    const added = Math.max(0, (carried.get(binding) ?? 0) - (held.get(binding) ?? 0));
    if (members > (held.get(key) ?? 0) + added) {
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
      // One position, with nothing inside it to cut.
      pos += 1;
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
 * Whether `path` addresses a member of a `children` array, which is what a merge or a range replace
 * can remove. A `$switch` case (`…, "cases", <name>`) and a repeater's template (`…, "map"`) are
 * blocks the caret can stand in and are no member of anything.
 */
function isChildSlot(path: JxPath): boolean {
  return path.length >= 2 && path.at(-2) === "children" && isNumber(path.at(-1));
}

/** The two keys that spell a block's content, as `content` holds them: absent where it is empty. */
function contentKeys(content: JxMutableNode | JxContentResult): StoredContent {
  const out: StoredContent = {};
  if (Array.isArray(content.children)) {
    out.children = content.children;
  }
  if (isString(content.textContent) && content.textContent !== "") {
    out.textContent = content.textContent;
  }
  return out;
}

/**
 * Remove the `innerHTML` of the block at `path`, in a transaction that writes its content.
 *
 * `innerHTML` is content too, and the one spelling no write here produces: content is stored as
 * `children` or `textContent`. A block left holding both draws its content twice on the canvas and
 * once, stale, in a build. Only where the key exists, for the reason the counterpart key is only
 * cleared where it exists ({@link applyInlineCommit}).
 */
function dropMarkup(t: Tab, path: JxPath, node: JxMutableNode | undefined | null): void {
  if (node && "innerHTML" in node) {
    mutateUpdateProperty(t, path, "innerHTML");
  }
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
    /**
     * Told the block's path when the commit says what the block holds in another spelling, so
     * nothing was written: the canvas now holds the commit's spelling (two text nodes joined into
     * one, say) where the document holds its own, and the surgical patcher finds a child's place by
     * counting DOM nodes against stored members. The caller draws the block again.
     */
    onRespelled?: CommitRespelled;
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
  const refusal = committed ? bindingRefusal(node, [committed], opts.removedTags) : null;
  if (refusal) {
    opts.onRefused?.(path, refusal);
    return;
  }
  if (committed && node && sameContent(node, committed)) {
    /* Markup the canvas drew and nobody typed in is no other spelling of the canvas: it IS what the
       canvas holds, and there is nothing to draw again. */
    const spelled = openMarkup(node) !== null;
    if (!spelled && stableJson(contentKeys(node)) !== stableJson(contentKeys(committed))) {
      opts.onRespelled?.(path);
    }
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
        dropMarkup(t, path, node);
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
        dropMarkup(t, path, node);
        mutateUpdateProperty(t, path, "textContent", textContent);
      },
      { coalesceKey: opts.coalesceKey ?? null },
    );
  }
}

/**
 * Commit a prop-bound inline edit: persist `value` where the component instance at `path` delivers
 * `prop` (`mutateUpdateInstanceProp`: `$props`, or the top-level key, attribute or payload that
 * holds it, studio.md §8.2.6), so the edit never adds a second source for one rendered value. The
 * unchanged-value no-op is LOAD-BEARING, not cosmetic: Escape-cancel and patch-disturbed sessions
 * post unchanged values, and without the equality check a commit→patch→ disturb→re-commit cycle
 * loops (and pollutes undo history). An empty value on `$props` deletes the prop, reverting the
 * instance to the definition default; on any other route it is kept where it is — both as the
 * sidebar field does.
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
  const current = propSource(node, prop)?.value;
  if (`${current ?? ""}` === value) {
    return false;
  }
  transactDoc(tab, (t) => {
    mutateUpdateInstanceProp(t, path, prop, value);
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

  if (!isChildSlot(fromPath)) {
    // The block to remove is not a member of a `children` array (a `$switch` case, a repeater's
    // Template): there is no removing it, and joining its text on would leave that text twice.
    return null;
  }

  const head = piecesOf(into);
  const tail = piecesOf(from);
  const seam = contentLength(head);
  const merged = storePieces([...head, ...tail]);
  /* Asked of the two BLOCKS, not of the content read from them: a block whose content is computed
     children, a `{ "$ref" }` text, bound `innerHTML`, or a template beside children has no content
     that reading yields, and the join would have written over it unasked. No stored form at all
     means a printed template would have had to stand as a member (`storePieces`). */
  const refusal = merged ? bindingRefusal([into, from], [merged]) : "alone";
  if (!merged || refusal) {
    onRefused?.(intoPath, refusal ?? "alone");
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
      dropMarkup(t, intoPath, into);
      mutateUpdateProperty(t, intoPath, "children", merged.children);
    } else {
      if (into.children) {
        mutateUpdateProperty(t, intoPath, "children");
      }
      dropMarkup(t, intoPath, into);
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
  const node = getNodeAtPath(tab.doc.document, path);
  const refusal = bindingRefusal(node, [before, after], removedTags);
  if (refusal) {
    onRefused?.(path, refusal);
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
      dropMarkup(t, path, node);
      mutateUpdateProperty(t, path, "textContent", before.textContent);
    } else if (before.children) {
      mutateUpdateProperty(t, path, "textContent");
      dropMarkup(t, path, node);
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
      dropMarkup(t, path, getNodeAtPath(t.doc.document, path));
      mutateUpdateProperty(t, path, "children", commitData.children);
    } else if (commitData?.textContent != null) {
      mutateUpdateProperty(t, path, "children");
      dropMarkup(t, path, getNodeAtPath(t.doc.document, path));
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
  const refusal = tab
    ? bindingRefusal(getNodeAtPath(tab.doc.document, path), [commitData], removedTags)
    : null;
  if (refusal) {
    onRefused?.(path, refusal);
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
      dropMarkup(t, path, getNodeAtPath(t.doc.document, path));
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
      dropMarkup(t, path, getNodeAtPath(t.doc.document, path));
      mutateUpdateProperty(t, path, "children", commitData.children);
    } else if (commitData?.textContent != null) {
      mutateUpdateProperty(t, path, "children");
      dropMarkup(t, path, getNodeAtPath(t.doc.document, path));
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
 *   escape: that would store half an expression, or half an escape, on each side. A piece cut whole
 *   from a template and left with no `${` is stored as the text its escapes spell
 *   (`editor/content-slice.ts`), since it is literal text from then on.
 * - What the block is left holding must carry every binding the two ends held, except those in
 *   `removedTags`: the chips the selection covered, which the session reports. A binding lost and
 *   not reported was not the author's deletion. Nor may a binding that was printed come to stand as
 *   a member of its own, where an array it yields would be spliced in as nodes.
 *
 * A block that is removed whole (`between`) is a deletion the author asked for and is not checked.
 * A path in `between` that lies inside either end is that end's own content (the frame lists an
 * inline link as a block, since the caret can stand in one) and is not removed. Refused too, with
 * nothing told, when a block to remove is no member of a `children` array (a `$switch` case).
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

  // A block inside either end (a link, a `<span>`) is that end's own content, not a block between.
  const removable = between.filter(
    (path) => !isAncestor(from.path, path) && !isAncestor(to.path, path),
  );
  if (![...removable, to.path].every((path) => isChildSlot(path))) {
    // See `applyBlockMerge`: a block that is no member of a `children` array cannot be removed.
    return null;
  }

  const headPieces = piecesOf(head);
  const spliced = spliceAcross(headPieces, from.offset, piecesOf(tail), to.offset, text);
  const joined = spliced ? storePieces(spliced) : null;
  if (cutsBinding(contentOf(head), from.offset) || cutsBinding(contentOf(tail), to.offset)) {
    onRefused?.(from.path, "lost");
    return null;
  }
  // Asked of the two BLOCKS: see `applyBlockMerge`.
  const refusal = joined ? bindingRefusal([head, tail], [joined], removedTags) : "alone";
  if (!joined || refusal) {
    onRefused?.(from.path, refusal ?? "alone");
    return null;
  }
  // The first block is kept whole and nothing is joined on: its content stands as it is spelled.
  const rewrite = stableJson(joined) !== stableJson(storePieces(headPieces) ?? {});
  // Remove the deepest/last paths first so an earlier removal cannot shift a later one's index.
  const removals = [...removable, to.path].toSorted(comparePathsDescending);

  transactDoc(tab, (t) => {
    if (!rewrite) {
      // Only the blocks after it are removed, below.
    } else if (joined.children) {
      if (head.textContent != null) {
        mutateUpdateProperty(t, from.path, "textContent");
      }
      dropMarkup(t, from.path, head);
      mutateUpdateProperty(t, from.path, "children", joined.children);
    } else {
      if (head.children) {
        mutateUpdateProperty(t, from.path, "children");
      }
      dropMarkup(t, from.path, head);
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
