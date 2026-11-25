/**
 * The shared Y.Doc schema for a Jx document, and the JSON ↔ Y mapping.
 *
 * Layout (all top-level types, created on demand): - `meta: Y.Map` — schemaVersion,
 * structureSeeded, canonical ("structure" | "source"), canonicalRev (representation-flip counter —
 * distinct from the provider's wire docEpoch), sourceFormat. - `frontmatter: Y.Map` — per-field
 * plain-JSON values (LWW per field). - `structure: Y.Map` — the root JxMutableNode. - `source:
 * Y.Text` — the serialized source. THE authoritative file content: providers persist
 * `getText("source").toString()` and never parse or serialize Jx documents themselves; the
 * structure tree is a Studio-side projection kept in sync by the bridge.
 *
 * **CRDT granularity is deliberately FINER than Studio's op-log granularity.** Every node is a
 * Y.Map; within it, "children" is a Y.Array, {@link TEXT_KEYS} are `Y.Text`,
 * {@link GRANULAR_OBJECT_KEYS} are nested Y.Maps, {@link TEXT_OBJECT_KEYS} are a Y.Map of `Y.Text`,
 * and everything else is a whole-JSON LWW value.
 *
 * The two granularities used to match, on the reasoning that mutators emit whole-value set-keys so
 * deeper Y types would add merge surface nothing targets. That reasoning was wrong: it conflated
 * what an EDIT addresses with what a MERGE must resolve. Two authors typing in one paragraph, or
 * setting `color` and `padding` on one element, produce whole-value ops that a whole-value CRDT can
 * only resolve by discarding one of them. The bridge therefore diffs a whole-value op down onto the
 * granular representation ({@link applyTextEdit}, {@link mergeYObject}) and {@link yValueToJson}
 * reassembles whole values on the way out — so `JxDocOp`, the canvas patcher and the history ring
 * are unchanged, while concurrent edits actually merge.
 *
 * One rule, three writers. {@link toYNodeValue} is the per-key conversion. The first client's seed
 * ({@link seedStructure}) stores every key by it into fresh containers; every other write, the
 * bridge's `set-key` ({@link writeNodeKey}) and the whole-document write (`replaceYStructure`,
 * through {@link mergeYNode}), diffs onto the containers already there and falls back to
 * {@link toYNodeValue} only when the stored type changes.
 *
 * Key order. A `Y.Map` has none, and nothing here stores one. A style block is read in the
 * canonical order of {@link canonicalStyle}, a `state` block and a function entry in ascending key
 * order, so peers holding the same keys read the same block whatever order each wrote them in.
 * `$media` is a whole value and keeps its source order.
 *
 * Seeding contract: providers seed only `source` (from file bytes). Clients derive `structure` on
 * first sync via {@link seedStructure}, which is convergence-safe under concurrent seeders because
 * it only performs whole-key Y.Map sets (per-key LWW picks one seeder's subtrees wholesale) — never
 * array inserts, which would duplicate.
 */

import * as Y from "yjs";
import { cloneValue } from "@jxsuite/schema/doc-ops";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode, JxPath } from "@jxsuite/schema/types";
import { matchChildren } from "./diff-core.ts";
import { canonicalStyle } from "./style-order.ts";

export const META_KEY = "meta";
export const FRONTMATTER_KEY = "frontmatter";
export const STRUCTURE_KEY = "structure";
export const SOURCE_KEY = "source";

/**
 * Bumped to 2 when prose moved to `Y.Text` and style/attributes/$props to nested `Y.Map`s.
 *
 * Written into `meta` at seed time and not currently validated on load. A room persisted under 1
 * still READS correctly ({@link yValueToJson} passes plain values through) and self-heals on the
 * first edit to a given key, since the bridge replaces a non-granular container. Two clients
 * running DIFFERENT versions in one room would disagree about merge granularity — see §5 of
 * specs/collab.md on version skew, which this does not attempt to solve.
 *
 * Not bumped when a document's script texts moved to `Y.Text` ({@link TEXT_OBJECT_KEYS}): a client
 * from before reads the texts as the strings they are and writes `$script` as one value, which a
 * client from after reads as it is and turns back into texts on its next edit. Neither misreads the
 * other; they merge per script rather than per character, which is what both did before.
 */
export const COLLAB_SCHEMA_VERSION = 2;

/**
 * What one slot of the structure tree holds: a node or granular-object `Y.Map`, a children
 * `Y.Array`, a prose `Y.Text`, or a whole-JSON LWW leaf. Every writer in this package goes through
 * {@link toYNode}, {@link toYChildren}, {@link toYObject} or a JSON clone, so nothing else is ever
 * stored there.
 */
export type YStructureValue =
  | Y.Map<YStructureValue>
  | Y.Array<YStructureValue>
  | Y.Text
  | JxDocumentValue;

/**
 * A plain object read out of, or written into, the structure tree: a node, a style block, an
 * attribute map. A key an editor cleared may still hold `undefined`, which every writer skips.
 */
export type DocumentRecord = Record<string, JxDocumentValue | undefined>;

/**
 * A plain object (not null, not an array). Only the shape is checked: its values are whatever the
 * document holds, including the `undefined` a cleared key leaves behind, which is why this narrows
 * to {@link DocumentRecord} rather than a fully-validated JSON object.
 */
function isDocumentRecord(value: JxDocumentValue | undefined): value is DocumentRecord {
  return isJsonObject(value);
}

export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

export function frontmatterMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(FRONTMATTER_KEY);
}

/**
 * The root node's `Y.Map`. Its type argument is the {@link YStructureValue} invariant the writers in
 * this module maintain; Yjs itself does not check what a map holds.
 */
export function structureMap(doc: Y.Doc): Y.Map<YStructureValue> {
  return doc.getMap<YStructureValue>(STRUCTURE_KEY);
}

export function sourceText(doc: Y.Doc): Y.Text {
  return doc.getText(SOURCE_KEY);
}

/**
 * Node keys whose STRING value is stored as a `Y.Text` rather than an opaque string.
 *
 * This is the character-level-collaboration decision. Whole-paragraph last-writer-wins was never a
 * Yjs limitation — it was this schema storing prose as a plain LWW value, so two people typing in
 * one paragraph clobbered each other and only `source` (which the canvas does not edit) merged per
 * character.
 *
 * `innerHTML` is deliberately absent: it is an opaque markup blob, never caret-edited.
 */
export const TEXT_KEYS: ReadonlySet<string> = new Set(["textContent"]);

/**
 * Node keys stored as a nested `Y.Map` so concurrent edits to DIFFERENT properties both survive.
 *
 * `mutateUpdateStyle` and friends record a whole-object `set-key`, so writing the object as one LWW
 * value meant A's `color` and B's `padding` raced and one lost. Per-property merge fixes that
 * without touching the op vocabulary: {@link yValueToJson} reassembles the whole object on the way
 * out, so `JxDocOp`, the canvas patcher and the history ring keep seeing whole values.
 *
 * Declaration VALUES stay plain (a CSS value is never partially edited); only the key space is
 * granular. Nesting recurses, which covers `style`'s media (`@--sm`) and pseudo (`&:hover`)
 * blocks.
 */
export const GRANULAR_OBJECT_KEYS: ReadonlySet<string> = new Set(["style", "attributes", "$props"]);

/**
 * Node keys stored as a nested `Y.Map` whose STRING values are each a `Y.Text`.
 *
 * `$script` is a document's own modules (`spec.md` §23.2): two texts, each of which may run to
 * hundreds of lines and is edited a character at a time. Stored whole, two people typing in one
 * script took turns losing everything the other had typed since the last keystroke that landed. The
 * key space is granular as well, so one person writing the client module and another the server
 * module are not in each other's way at all.
 */
export const TEXT_OBJECT_KEYS: ReadonlySet<string> = new Set(["$script"]);

/**
 * Rewrite a `Y.Text` to `next` with a minimal edit (common prefix/suffix trimmed).
 *
 * Minimal rather than replace-all for two reasons: the wire carries only the delta, and — the
 * load-bearing one — the surviving characters keep their identity, so a concurrent remote insert
 * inside the untouched region merges instead of being clobbered. Returns false when already equal.
 */
export function applyTextEdit(text: Y.Text, next: string): boolean {
  const current = text.toString();
  if (current === next) {
    return false;
  }
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }
  if (endCurrent > start) {
    text.delete(start, endCurrent - start);
  }
  if (endNext > start) {
    text.insert(start, next.slice(start, endNext));
  }
  return true;
}

/** Node keys that hold a state block: a `Y.Map` of entries, read in ascending key order. */
const STATE_KEY = "state";

/** Whether a node key holds an event-handler function (`onclick`, `oninput`, ...). */
function isHandlerKey(key: string): boolean {
  return key.length > 2 && key.startsWith("on");
}

/** A function entry or handler: a plain object holding a string `body`. */
function isFunctionEntry(value: JxDocumentValue | undefined): value is DocumentRecord {
  return (
    isDocumentRecord(value) &&
    Object.entries(value).some(([key, entry]) => key === "body" && isString(entry))
  );
}

/**
 * A plain object becomes a Y.Map, recursing into nested objects; other values stay plain JSON. No
 * key order is stored: a style block is read in {@link canonicalStyle} order.
 */
export function toYObject(value: DocumentRecord): Y.Map<YStructureValue> {
  const map = new Y.Map<YStructureValue>();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    map.set(key, isDocumentRecord(entry) ? toYObject(entry) : cloneValue(entry));
  }
  return map;
}

/**
 * Merge a plain object into an existing Y.Map per key: set changed keys, delete removed ones,
 * recurse into nested maps. Whole-value replacement would mint a new Y.Map and discard a peer's
 * concurrent edit to an untouched sibling property — the very thing granularity exists to prevent.
 */
export function mergeYObject(map: Y.Map<YStructureValue>, value: DocumentRecord): void {
  // Detached key list: deleting from a Y.Map while iterating its live keys is unsafe.
  // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point (mutation during iteration)
  for (const key of [...map.keys()]) {
    if (!(key in value) || value[key] === undefined) {
      map.delete(key);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    const existing = map.get(key);
    if (isDocumentRecord(entry)) {
      if (existing instanceof Y.Map) {
        mergeYObject(existing, entry);
      } else {
        map.set(key, toYObject(entry));
      }
    } else if (!map.has(key) || !deepEqualJson(existing, entry)) {
      map.set(key, cloneValue(entry));
    }
  }
}

/**
 * A function entry or handler becomes a Y.Map whose `body` is a `Y.Text`, so two authors typing in
 * one function body merge per character. Its other keys stay plain.
 */
export function toYFunction(value: DocumentRecord): Y.Map<YStructureValue> {
  const map = new Y.Map<YStructureValue>();
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      map.set(key, key === "body" && isString(entry) ? new Y.Text(entry) : cloneValue(entry));
    }
  }
  return map;
}

/** Merge a function entry onto the Y.Map already holding it: the body as a minimal text edit. */
export function mergeYFunction(map: Y.Map<YStructureValue>, value: DocumentRecord): void {
  // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point (mutation during iteration)
  for (const key of [...map.keys()]) {
    if (value[key] === undefined) {
      map.delete(key);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    const existing = map.get(key);
    if (key === "body" && isString(entry)) {
      if (existing instanceof Y.Text) {
        applyTextEdit(existing, entry);
      } else {
        map.set(key, new Y.Text(entry));
      }
    } else if (!map.has(key) || !deepEqualJson(existing, entry)) {
      map.set(key, cloneValue(entry));
    }
  }
}

/** A `state` block becomes a Y.Map; each function entry in it a {@link toYFunction}. */
export function toYState(value: DocumentRecord): Y.Map<YStructureValue> {
  const map = new Y.Map<YStructureValue>();
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      map.set(key, isFunctionEntry(entry) ? toYFunction(entry) : cloneValue(entry));
    }
  }
  return map;
}

/** Merge a `state` block onto the Y.Map already holding it, entry by entry. */
export function mergeYState(map: Y.Map<YStructureValue>, value: DocumentRecord): void {
  // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point (mutation during iteration)
  for (const key of [...map.keys()]) {
    if (value[key] === undefined) {
      map.delete(key);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    const existing = map.get(key);
    if (isFunctionEntry(entry)) {
      if (existing instanceof Y.Map) {
        mergeYFunction(existing, entry);
      } else {
        map.set(key, toYFunction(entry));
      }
    } else if (!map.has(key) || !deepEqualJson(existing, entry)) {
      map.set(key, cloneValue(entry));
    }
  }
}

/** A plain object becomes a Y.Map whose string values are each a Y.Text; other values stay plain. */
export function toYTextObject(value: DocumentRecord): Y.Map<YStructureValue> {
  const map = new Y.Map<YStructureValue>();
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      map.set(key, isString(entry) ? new Y.Text(entry) : cloneValue(entry));
    }
  }
  return map;
}

/**
 * Merge a plain object into an existing Y.Map of texts: a string onto the `Y.Text` already there as
 * a minimal edit, so the characters a peer is typing into the same text keep their place. Removed
 * keys are deleted, and a value that is no longer a string replaces its text, since there is
 * nothing left to merge with.
 */
export function mergeYTextObject(map: Y.Map<YStructureValue>, value: DocumentRecord): void {
  // Detached key list: deleting from a Y.Map while iterating its live keys is unsafe.
  // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point (mutation during iteration)
  for (const key of [...map.keys()]) {
    if (value[key] === undefined) {
      map.delete(key);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    const existing = map.get(key);
    if (!isString(entry)) {
      if (!map.has(key) || !deepEqualJson(existing, entry)) {
        map.set(key, cloneValue(entry));
      }
    } else if (existing instanceof Y.Text) {
      applyTextEdit(existing, entry);
    } else {
      map.set(key, new Y.Text(entry));
    }
  }
}

/** Structural equality over plain JSON, used to skip no-op key writes. */
function deepEqualJson(a: YStructureValue | undefined, b: JxDocumentValue): boolean {
  if (a === b) {
    return true;
  }
  if (a instanceof Y.Map || a instanceof Y.Array || a instanceof Y.Text) {
    return false;
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * A child value: a bare string becomes a Y.Text (per-character merge), a node becomes a Y.Map.
 * Anything else is not a child, and {@link toYNode} throws for it.
 */
export function toYChild(child: JxDocumentValue | undefined): Y.Text | Y.Map<YStructureValue> {
  return isString(child) ? new Y.Text(child) : toYNode(child);
}

/** A children array becomes a Y.Array of node Y.Maps and Y.Texts. */
export function toYChildren(children: readonly JxDocumentValue[]): Y.Array<YStructureValue> {
  const arr = new Y.Array<YStructureValue>();
  arr.insert(
    0,
    children.map((child) => toYChild(child)),
  );
  return arr;
}

/**
 * The conversion rule for one node key, shared by every writer: a `children` array becomes a
 * `Y.Array`, a {@link TEXT_KEYS} string a `Y.Text`, `style` and the other
 * {@link GRANULAR_OBJECT_KEYS} nested `Y.Map`s, {@link TEXT_OBJECT_KEYS} a `Y.Map` of texts,
 * `state` a `Y.Map` of entries, a function handler a `Y.Map` with a `Y.Text` body, and anything
 * else a whole-JSON LWW value.
 */
export function toYNodeValue(key: string, value: JxDocumentValue): YStructureValue {
  if (key === "children" && Array.isArray(value)) {
    return toYChildren(value);
  }
  if (TEXT_KEYS.has(key) && isString(value)) {
    return new Y.Text(value);
  }
  if (GRANULAR_OBJECT_KEYS.has(key) && isDocumentRecord(value)) {
    return toYObject(value);
  }
  if (TEXT_OBJECT_KEYS.has(key) && isDocumentRecord(value)) {
    return toYTextObject(value);
  }
  if (key === STATE_KEY && isDocumentRecord(value)) {
    return toYState(value);
  }
  if (isHandlerKey(key) && isFunctionEntry(value)) {
    return toYFunction(value);
  }
  return cloneValue(value);
}

/** A node object becomes a Y.Map whose every key is stored by {@link toYNodeValue}. */
export function toYNode(node: JxDocumentValue | undefined): Y.Map<YStructureValue> {
  if (!isDocumentRecord(node)) {
    throw new TypeError("collab-schema: a document node must be a plain object");
  }
  const map = new Y.Map<YStructureValue>();
  for (const [key, value] of Object.entries(node)) {
    if (value !== undefined) {
      map.set(key, toYNodeValue(key, value));
    }
  }
  return map;
}

/**
 * Write a node key, preserving CRDT identity wherever the schema stores it granularly.
 *
 * Studio's mutators record whole-value `set-key` ops, and a whole-document write carries whole
 * values too. Writing those straight through with `Y.Map.set` mints a fresh Y type each time and
 * throws away whatever a peer concurrently did to the old one. So a whole value is diffed down onto
 * the existing container: text through {@link applyTextEdit}, objects through {@link mergeYObject},
 * {@link mergeYState} and {@link mergeYFunction}, children through {@link mergeYChildren}. Only a TYPE
 * change falls back to {@link toYNodeValue}, because then no shared structure is left to preserve. A
 * plain value equal to the stored one is not rewritten, so a whole-document write never restores a
 * key a peer changed at the same moment.
 */
export function writeNodeKey(
  node: Y.Map<YStructureValue>,
  key: string,
  value: JxDocumentValue,
): void {
  const existing = node.get(key);
  if (key === "children" && Array.isArray(value) && existing instanceof Y.Array) {
    mergeYChildren(existing, value);
    return;
  }
  if (TEXT_KEYS.has(key) && isString(value) && existing instanceof Y.Text) {
    applyTextEdit(existing, value);
    return;
  }
  if (existing instanceof Y.Map && isDocumentRecord(value)) {
    if (GRANULAR_OBJECT_KEYS.has(key)) {
      mergeYObject(existing, value);
      return;
    }
    if (TEXT_OBJECT_KEYS.has(key)) {
      mergeYTextObject(existing, value);
      return;
    }
    if (key === STATE_KEY) {
      mergeYState(existing, value);
      return;
    }
    if (isHandlerKey(key) && isFunctionEntry(value)) {
      mergeYFunction(existing, value);
      return;
    }
  }
  if (node.has(key) && deepEqualJson(existing, value)) {
    return;
  }
  node.set(key, toYNodeValue(key, value));
}

/**
 * Write a whole node value onto an existing node `Y.Map`: delete the keys it no longer has, then
 * {@link writeNodeKey} each one it does.
 */
export function mergeYNode(node: Y.Map<YStructureValue>, value: DocumentRecord): void {
  // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the point (mutation during iteration)
  for (const key of [...node.keys()]) {
    if (value[key] === undefined) {
      node.delete(key);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      writeNodeKey(node, key, entry);
    }
  }
}

/**
 * Write a children array onto the `Y.Array` already holding it, element by element. Children align
 * as the structural differ aligns them ({@link matchChildren}), so an unchanged element is kept, an
 * element with the same tag and id is merged in place, and a bare string is edited per character.
 * Everything unpaired is removed and inserted, because `Y.Array` has no move.
 */
export function mergeYChildren(
  array: Y.Array<YStructureValue>,
  next: readonly JxDocumentValue[],
): void {
  const nextChildren = next.map((item) => (isString(item) ? item : toChildNode(item)));
  const current = array.toArray().map((item) => yChildToJson(toChildItem(item)));
  const matches = matchChildren(current, nextChildren);
  const matchedA = new Set(matches.map((match) => match.aIndex));
  const byB = new Map(matches.map((match) => [match.bIndex, match]));
  for (let i = current.length - 1; i >= 0; i--) {
    if (!matchedA.has(i)) {
      array.delete(i, 1);
    }
  }
  for (const [i, item] of next.entries()) {
    const match = byB.get(i);
    if (!match) {
      array.insert(i, [toYChild(item)]);
      continue;
    }
    if (match.identical) {
      continue;
    }
    const existing = array.get(i);
    if (existing instanceof Y.Text && isString(item)) {
      applyTextEdit(existing, item);
    } else if (existing instanceof Y.Map && isDocumentRecord(item)) {
      mergeYNode(existing, item);
    } else {
      array.delete(i, 1);
      array.insert(i, [toYChild(item)]);
    }
  }
}

function toChildNode(value: JxDocumentValue): JxMutableNode {
  if (!isDocumentRecord(value)) {
    throw new TypeError("collab-schema: a document node must be a plain object");
  }
  /* SAFETY: a document node is a plain object; JxMutableNode is its open-keyed shape. */
  return value as JxMutableNode;
}

function toChildItem(item: YStructureValue): Y.Text | Y.Map<YStructureValue> | string {
  if (item instanceof Y.Text || item instanceof Y.Map || isString(item)) {
    return item;
  }
  throw new TypeError("collab-schema: a children array holds only nodes and text");
}

/**
 * A node Y.Map back to its plain object (deep, detached copy), each key read by
 * {@link yNodeKeyToJson}.
 */
function yMapToJson(map: Y.Map<YStructureValue>): DocumentRecord {
  return Object.fromEntries(
    [...map.keys()].map((key) => [key, yNodeKeyToJson(key, map.get(key), map.doc)]),
  );
}

/** The key order of the document's `$media` map, which orders breakpoint blocks in a style. */
function mediaOrder(doc: Y.Doc | null | undefined): string[] {
  if (!doc) {
    return [];
  }
  const media = yValueToJson(structureMap(doc).get("$media"));
  return isDocumentRecord(media) ? Object.keys(media) : [];
}

/**
 * A granular-object Y.Map back to a plain object, nested maps included, with its keys in Yjs's own
 * order or, when `sorted`, ascending.
 */
function yObjectToJson(map: Y.Map<YStructureValue>, sorted: boolean): DocumentRecord {
  const keys = sorted ? [...map.keys()].toSorted() : [...map.keys()];
  return Object.fromEntries(
    keys.map((key) => {
      const entry = map.get(key);
      return [key, entry instanceof Y.Map ? yObjectToJson(entry, sorted) : yValueToJson(entry)];
    }),
  );
}

/**
 * The value held under a node key, back to JSON, with the key order specs/collab.md §3.1 gives it.
 * `style` reads in {@link canonicalStyle} order, whether stored granularly or, by a client from
 * before the schema went granular, as one value; `state` and a function handler read their keys
 * ascending, since only `style` and `$media` give key order a meaning (`spec.md`, Jx Notation).
 * `$media` is a whole value and arrives in the order it was written; the `@--` breakpoint blocks of
 * a style follow its key order. `doc` is the document `$media` is read from; a `Y.Map` value brings
 * its own.
 */
export function yNodeKeyToJson(
  key: string,
  value: YStructureValue | undefined,
  doc?: Y.Doc | null,
): JxDocumentValue | undefined {
  if (key === "style") {
    const media = () => mediaOrder(value instanceof Y.Map ? (value.doc ?? doc) : doc);
    if (value instanceof Y.Map) {
      return canonicalStyle(yObjectToJson(value, false), media());
    }
    if (value instanceof Y.Array || value instanceof Y.Text) {
      return yValueToJson(value);
    }
    return isDocumentRecord(value) ? canonicalStyle(value, media()) : value;
  }
  if (value instanceof Y.Map) {
    return yObjectToJson(value, key === STATE_KEY || isHandlerKey(key));
  }
  return yValueToJson(value);
}

/**
 * A children-array member back to JSON: a Y.Text is a bare-string child, a Y.Map a node. A plain
 * string is a bare-string child written under schema version 1, before prose moved to Y.Text.
 */
export function yChildToJson(
  child: Y.Text | Y.Map<YStructureValue> | string,
): JxMutableNode | string {
  if (isString(child)) {
    return child;
  }
  return child instanceof Y.Text ? child.toString() : yMapToJson(child);
}

/** Convert any structure value (Y.Map, Y.Array, Y.Text, or plain leaf) back to JSON. */
export function yValueToJson(value: YStructureValue): JxDocumentValue;
export function yValueToJson(value: YStructureValue | undefined): JxDocumentValue | undefined;
export function yValueToJson(value: YStructureValue | undefined): JxDocumentValue | undefined {
  if (value instanceof Y.Map) {
    return yMapToJson(value);
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((entry) => yValueToJson(entry));
  }
  if (value instanceof Y.Text) {
    return value.toString();
  }
  return value;
}

/** The whole structure tree as a plain document (deep, detached copy). */
export function yDocToJson(doc: Y.Doc): JxMutableNode {
  return yMapToJson(structureMap(doc));
}

/**
 * Resolve a JxPath against the structure tree. Returns the Y value at the path (a node Y.Map, a
 * children Y.Array, a string child, or a plain leaf) or undefined when any segment is missing.
 */
export function resolveYPath(doc: Y.Doc, path: JxPath): YStructureValue | undefined {
  let current: YStructureValue | undefined = structureMap(doc);
  for (const segment of path) {
    if (current instanceof Y.Map) {
      current = current.get(String(segment));
    } else if (current instanceof Y.Array) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current.get(index);
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Update the source Y.Text to `next` with a minimal edit (common prefix/suffix trimmed), so mirror
 * refreshes don't ship the whole document over the wire. Returns false when already identical.
 */
export function updateSourceText(doc: Y.Doc, next: string, origin?: string): boolean {
  const text = sourceText(doc);
  if (text.toString() === next) {
    return false;
  }
  doc.transact(() => {
    applyTextEdit(text, next);
  }, origin);
  return true;
}

/**
 * Populate the structure tree (and frontmatter/meta) from a parsed document — the client-side
 * first-sync step. Safe under concurrent seeders: every write is a whole-key Y.Map set, so two
 * racing seeds converge to one seeder's subtrees via per-key LWW with no duplication. No-op when
 * another seeder already won.
 */
export function seedStructure(
  doc: Y.Doc,
  document: JxMutableNode,
  opts: {
    frontmatter?: DocumentRecord;
    sourceFormat?: string | null;
    origin?: string;
  } = {},
): boolean {
  const meta = metaMap(doc);
  if (meta.get("structureSeeded") === true) {
    return false;
  }
  doc.transact(() => {
    const structure = structureMap(doc);
    for (const [key, value] of Object.entries(document)) {
      if (value !== undefined) {
        structure.set(key, toYNodeValue(key, value));
      }
    }
    const frontmatter = frontmatterMap(doc);
    for (const [key, value] of Object.entries(opts.frontmatter ?? {})) {
      if (value !== undefined) {
        frontmatter.set(key, cloneValue(value));
      }
    }
    meta.set("schemaVersion", COLLAB_SCHEMA_VERSION);
    meta.set("canonical", "structure");
    meta.set("canonicalRev", 0);
    meta.set("sourceFormat", opts.sourceFormat ?? null);
    meta.set("structureSeeded", true);
  }, opts.origin);
  return true;
}
