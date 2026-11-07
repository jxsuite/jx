/**
 * Save a `.jxn` file without touching what did not change.
 *
 * `serializeJxn` knows what the file should say, canonically, and the previous source knows how the
 * author wrote it. This merges the two as KDL trees: a node that means the same in both keeps its
 * exact text, comments and blank lines included, and only what moved takes the writer's spelling.
 *
 * It works on KDL and knows no Jx rule, so a project file can use it by passing its own reader. The
 * library's own mutation API is not used, because removing a first child and appending both print
 * badly. Nothing here can lose data: a result that does not read back to the writer's meaning is
 * discarded for the writer's text, which costs comments and nothing else.
 *
 * @docs framework/concepts/jxn-files
 */
import { getLocation, parse } from "@bgotink/kdl";
import type { Document, Entry, Node } from "@bgotink/kdl";
import type { JsonValue } from "../../types.ts";
import { isJsonObject } from "../guards.ts";
import type { JxnSpan } from "./errors.ts";

/** What a grammar makes of a file: its value, and where each part of it came from. */
export interface JxnReading {
  document: JsonValue;
  spans: ReadonlyMap<string, JxnSpan>;
}

/** Read a file with a grammar. Throws when it does not read. */
export type JxnReader = (text: string) => JxnReading;

/** One side of the merge. */
interface Side {
  /** What each node means, by the offset it starts at, where the grammar says. */
  meanings: ReadonlyMap<number, string>;
  /** Which JSON Pointer each node or entry holds, by the offset it starts at. */
  pointers: ReadonlyMap<number, string>;
  text: string;
}

/** Both sides. */
interface Merge {
  next: Side;
  previous: Side;
}

/**
 * A value as text, equal only for values that mean the same. Key order means nothing except inside
 * `style`, where source order is the cascade.
 */
function fingerprint(value: JsonValue | undefined, ordered = false): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => fingerprint(item, ordered)).join(",")}]`;
  }
  if (!isJsonObject(value)) {
    return value === undefined ? "null" : JSON.stringify(value);
  }
  const keys = ordered ? Object.keys(value) : Object.keys(value).toSorted();
  const fields = keys.map(
    (key) => `${JSON.stringify(key)}:${fingerprint(value[key], ordered || key === "style")}`,
  );
  return `{${fields.join(",")}}`;
}

/** The value at a JSON Pointer. */
function valueAt(document: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = document;
  for (const part of pointer.split("/").slice(1)) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else {
      current = isJsonObject(current) ? current[key] : undefined;
    }
  }
  return current;
}

/** Which pointer starts where. Two can share a start, and the outer one is the node's. */
function pointersOf({ spans }: JxnReading): Map<number, string> {
  const outermost = new Map<number, string>();
  for (const [pointer, span] of spans) {
    const known = outermost.get(span.start);
    if (known === undefined || pointer.length < known.length) {
      outermost.set(span.start, pointer);
    }
  }
  return outermost;
}

/** One file, as the merge wants to ask about it. */
function sideOf(reading: JxnReading, text: string): Side {
  const pointers = pointersOf(reading);
  const meanings = new Map<number, string>();
  for (const [start, pointer] of pointers) {
    meanings.set(start, fingerprint(valueAt(reading.document, pointer)));
  }
  return { meanings, pointers, text };
}

/** Where a node or entry is. Parsing with `storeLocations` gives every one of them a place. */
function placeOf(item: Entry | Node): JxnSpan {
  const location = getLocation(item);
  return { end: location?.end.offset ?? 0, start: location?.start.offset ?? 0 };
}

/** A node's own text, without the whitespace a location can share with what follows it. */
function coreOf(node: Node, text: string): string {
  const { end, start } = placeOf(node);
  return text.slice(start, end).trimEnd();
}

/** An entry as written, with what sets it apart from the one before. */
function entryText(entry: Entry, text: string): string {
  const { end, start } = placeOf(entry);
  return `${entry.leading ?? " "}${text.slice(start, end).trimEnd()}`;
}

/** The same node's kids, or none. */
function kidsOf(node: Node): readonly Node[] {
  return node.children?.nodes ?? [];
}

/** What a node is, ignoring every comment and all spacing. */
function spellingFreeFormOf(node: Node): string {
  const entries = node.entries.map(
    (entry) =>
      `${entry.getName() ?? ""}=(${entry.getTag() ?? ""})${JSON.stringify(entry.getValue())}`,
  );
  const named = entries.filter((entry) => !entry.startsWith("=")).toSorted();
  const values = entries.filter((entry) => entry.startsWith("="));
  const kids = kidsOf(node).map((kid) => spellingFreeFormOf(kid));
  return `(${node.getTag() ?? ""})${node.getName()} ${[...named, ...values].join(" ")} {${kids.join(";")}}`;
}

/** Whether two nodes come to the same thing, however each was written. */
function same(merge: Merge, older: Node, newer: Node): boolean {
  if (spellingFreeFormOf(older) === spellingFreeFormOf(newer)) {
    return true;
  }
  const meaning = merge.previous.meanings.get(placeOf(older).start);
  return meaning !== undefined && meaning === merge.next.meanings.get(placeOf(newer).start);
}

/** What makes a node the same thing after an edit: its name, and the identity it declares. */
function identityOf(node: Node): string {
  const declared = node.entries.filter((entry) => ["$id", "key"].includes(entry.getName() ?? ""));
  const values = declared.map((entry) => JSON.stringify(entry.getValue()));
  return `(${node.getTag() ?? ""})${node.getName()} ${values.join(" ")}`;
}

/** The longest common subsequence, as pairs of indexes. */
function commonRun<T>(
  older: readonly T[],
  newer: readonly T[],
  equal: (a: T, b: T) => boolean,
): [number, number][] {
  const rows = older.length + 1;
  const columns = newer.length + 1;
  const table = new Int32Array(rows * columns);
  for (let row = older.length - 1; row >= 0; row -= 1) {
    for (let column = newer.length - 1; column >= 0; column -= 1) {
      const a = older[row];
      const b = newer[column];
      table[row * columns + column] =
        a !== undefined && b !== undefined && equal(a, b)
          ? (table[(row + 1) * columns + column + 1] ?? 0) + 1
          : Math.max(
              table[(row + 1) * columns + column] ?? 0,
              table[row * columns + column + 1] ?? 0,
            );
    }
  }
  const pairs: [number, number][] = [];
  let row = 0;
  let column = 0;
  while (row < older.length && column < newer.length) {
    const a = older[row];
    const b = newer[column];
    if (a !== undefined && b !== undefined && equal(a, b)) {
      pairs.push([row, column]);
      row += 1;
      column += 1;
    } else if (
      (table[(row + 1) * columns + column] ?? 0) >= (table[row * columns + column + 1] ?? 0)
    ) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return pairs;
}

/**
 * Which old node each new one continues.
 *
 * Nodes that did not change are the anchors, so removing the first of three `li`s leaves the other
 * two and their comments alone. Between anchors a node pairs with what has its name. A node with
 * nowhere left to pair and an exact twin elsewhere has moved, and takes its comments with it.
 */
function align(merge: Merge, older: readonly Node[], newer: readonly Node[]): Map<number, Node> {
  const paired = new Map<number, Node>();
  const used = new Set<number>();
  const pair = (oldIndex: number, newIndex: number): void => {
    const node = older[oldIndex];
    if (node) {
      paired.set(newIndex, node);
      used.add(oldIndex);
    }
  };
  const anchors = commonRun(older, newer, (a, b) => same(merge, a, b));
  let oldFrom = 0;
  let newFrom = 0;
  for (const [oldIndex, newIndex] of [...anchors, [older.length, newer.length] as const]) {
    const inGap = commonRun(
      older.slice(oldFrom, oldIndex),
      newer.slice(newFrom, newIndex),
      (a, b) => identityOf(a) === identityOf(b),
    );
    for (const [a, b] of inGap) {
      pair(oldFrom + a, newFrom + b);
    }
    if (oldIndex < older.length) {
      pair(oldIndex, newIndex);
    }
    oldFrom = oldIndex + 1;
    newFrom = newIndex + 1;
  }
  for (const [newIndex, node] of newer.entries()) {
    if (!paired.has(newIndex)) {
      const twin = older.findIndex((item, index) => !used.has(index) && same(merge, item, node));
      if (twin !== -1) {
        pair(twin, newIndex);
      }
    }
  }
  return paired;
}

/** The whitespace a node's line starts with, from what comes before it. */
function indentOf(node: Node): string {
  const leading = node.leading ?? "";
  return leading.slice(leading.lastIndexOf("\n") + 1);
}

/** Move a multi-line piece of the writer's text to another depth. */
function reindent(text: string, from: string, to: string): string {
  return text
    .split("\n")
    .map((line, index) =>
      index > 0 && line.startsWith(from) ? to + line.slice(from.length) : line,
    )
    .join("\n");
}

/** A node's entries once merged: each old one kept or changed in place, then any that are new. */
function mergeEntries(merge: Merge, older: Node, wanted: readonly Entry[]): string {
  const remaining = [...wanted];
  const take = (entry: Entry): Entry | undefined => {
    const name = entry.getName();
    const index = remaining.findIndex((item) => item.getName() === name);
    return index === -1 ? undefined : remaining.splice(index, 1)[0];
  };
  let out = "";
  for (const entry of older.entries) {
    const match = take(entry);
    if (match) {
      const unchanged = match.getTag() === entry.getTag() && match.getValue() === entry.getValue();
      out += unchanged
        ? entryText(entry, merge.previous.text)
        : `${entry.leading ?? " "}${entryText(match, merge.next.text).trimStart()}`;
    }
  }
  for (const entry of remaining) {
    out += ` ${entryText(entry, merge.next.text).trimStart()}`;
  }
  return out;
}

/**
 * An old child that says what a new entry says, keyed by what they both hold.
 *
 * The writer folds `state { count 0 }` into `state count=0` when it can, and the author's spelling
 * is the one with the comments in it. Only the grammar knows those are one key, and it says so by
 * giving them one JSON Pointer.
 */
function respelled(merge: Merge, older: Node, newer: Node): Map<Node, Entry> {
  const kids = new Map<string, Node>();
  for (const kid of kidsOf(older)) {
    const pointer = merge.previous.pointers.get(placeOf(kid).start);
    if (pointer !== undefined) {
      kids.set(pointer, kid);
    }
  }
  const found = new Map<Node, Entry>();
  for (const entry of newer.entries) {
    const pointer = merge.next.pointers.get(placeOf(entry).start);
    const kid = pointer === undefined ? undefined : kids.get(pointer);
    if (kid && entry.getName() !== null) {
      found.set(kid, entry);
    }
  }
  return found;
}

/** An old child, saying what a new entry says now, in as few changed characters as it can. */
function respell(merge: Merge, kid: Node, entry: Entry): string {
  const { text } = merge.previous;
  const value = entryText(entry, merge.next.text).trimStart().slice(`${entry.getName()}=`.length);
  const [only] = kid.entries;
  if (only?.getName() === null && kid.entries.length === 1 && !kid.children) {
    const unchanged = only.getValue() === entry.getValue() && only.getTag() === entry.getTag();
    if (unchanged) {
      return coreOf(kid, text);
    }
    return `${nameOf(kid, text)}${only.leading ?? " "}${value}`;
  }
  return `${nameOf(kid, text)} ${value}`;
}

/** Where a node's name stops: at its first entry, or its block, or its end. */
function nameOf(node: Node, text: string): string {
  const { start } = placeOf(node);
  const [first] = node.entries;
  if (first) {
    return text.slice(start, placeOf(first).start - (first.leading ?? "").length);
  }
  const block = node.children && getLocation(node.children);
  if (block) {
    // A block's location starts just inside its brace.
    return text.slice(start, block.start.offset - 1).trimEnd();
  }
  return coreOf(node, text);
}

/** Merge a changed node, keeping as much of how it was written as still holds. */
function mergeNode(merge: Merge, older: Node, newer: Node, indent: string): string {
  const moved = respelled(merge, older, newer);
  const taken = new Set(moved.values());
  const wanted = newer.entries.filter((entry) => !taken.has(entry));
  const head = `${nameOf(older, merge.previous.text)}${mergeEntries(merge, older, wanted)}`;
  const newKids = kidsOf(newer);
  if (newKids.length === 0 && moved.size === 0) {
    return head;
  }
  const inner = newKids[0] ? indentOf(newKids[0]) : `${indent}    `;
  const kept = older.children;
  const space = older.beforeChildren === "" ? " " : (older.beforeChildren ?? " ");
  if (kept && kept.nodes.length > 0 && blockIsLined(kept, merge.previous.text, older)) {
    const own = `${indent}${indentStep(kept, indent)}`;
    return `${head}${space}{${mergeBlock(merge, kept, newKids, own, inner, moved)}}`;
  }
  // A block on one line has nowhere to put a new line, and a comment cannot be inside one anyway.
  const fresh = newKids.map((node) => writeNew(merge, node, inner, `${indent}    `));
  return `${head}${space}{\n${fresh.join("")}${indent}}`;
}

/** The indentation one level of a kept block adds. */
function indentStep(block: Document, indent: string): string {
  const [first] = block.nodes;
  const own = first ? indentOf(first) : "";
  return own.startsWith(indent) ? own.slice(indent.length) : "    ";
}

/** Whether a block has a line for each of its nodes. */
function blockIsLined(block: Document, text: string, owner: Node): boolean {
  const { end, start } = placeOf(owner);
  const [first] = block.nodes;
  return (
    first !== undefined &&
    (first.leading ?? "").includes("\n") &&
    text.slice(start, end).includes("\n")
  );
}

/** A node the previous file did not have, in the writer's words, on its own line. */
function writeNew(merge: Merge, node: Node, from: string, to: string): string {
  return `${to}${reindent(coreOf(node, merge.next.text), from, to)}\n`;
}

/**
 * Merge a block's nodes.
 *
 * What follows an opening brace on its line belongs to the brace, not to the first node, so it
 * stays when that node goes.
 *
 * @param merge Both files.
 * @param older The block as it was.
 * @param newer What it should hold.
 * @param indent How deep this block's lines are in the previous file.
 * @param from How deep they are in the writer's text.
 * @param moved Old nodes that now say what an entry of the parent says.
 */
function mergeBlock(
  merge: Merge,
  older: Document,
  newer: readonly Node[],
  indent: string,
  from: string,
  moved: ReadonlyMap<Node, Entry>,
): string {
  const remaining = older.nodes.filter((node) => !moved.has(node));
  const paired = align(merge, remaining, newer);
  const firstLeading = older.nodes[0]?.leading ?? "";
  const lineEnd = firstLeading.indexOf("\n");
  const open = lineEnd === -1 ? "" : firstLeading.slice(0, lineEnd + 1);
  let out = open;
  let lastIndex = -1;

  const endLine = (): void => {
    if (out !== "" && !out.endsWith("\n") && !out.endsWith(";")) {
      out += "\n";
    }
  };
  /** An old node, with what was around it. One out of its old place starts a line of its own. */
  const keep = (node: Node, body: string): void => {
    const index = older.nodes.indexOf(node);
    const inPlace = index === lastIndex + 1 || index > lastIndex;
    lastIndex = Math.max(lastIndex, index);
    const leading =
      node === older.nodes[0] ? firstLeading.slice(open.length) : (node.leading ?? "");
    if (inPlace && (leading.includes("\n") || out === open || out.endsWith(";"))) {
      out += `${leading}${body}${node.trailing ?? ""}`;
      return;
    }
    if (!out.endsWith("\n")) {
      out += "\n";
    }
    const trailing = (node.trailing ?? "").replace(/^;/u, "");
    out += `${leading.includes("\n") ? leading : indent}${body}${trailing}`;
  };
  /** Every moved node the file had before this old one, in their old order. */
  const movedBefore = (limit: number): void => {
    for (const [index, node] of older.nodes.entries()) {
      const entry = moved.get(node);
      if (entry && index < limit && index > lastIndex) {
        endLine();
        keep(node, respell(merge, node, entry));
      }
    }
  };

  for (const [index, node] of newer.entries()) {
    const continued = paired.get(index);
    if (continued) {
      movedBefore(older.nodes.indexOf(continued));
      endLine();
      const body = same(merge, continued, node)
        ? coreOf(continued, merge.previous.text)
        : mergeNode(merge, continued, node, indentOf(continued));
      keep(continued, body);
    } else {
      endLine();
      out += writeNew(merge, node, from, indent);
    }
  }
  movedBefore(older.nodes.length);
  return `${out}${older.trailing ?? ""}`;
}

/**
 * Bring a file's text up to date with what the writer says it should mean.
 *
 * @param previous The file as it is.
 * @param next The writer's canonical text for the new document.
 * @param read The grammar both are read with.
 * @returns `previous` where it still holds, and `next` where it does not; all of `next` when the
 *   previous file does not read or the merge would not read back to the same meaning.
 */
export function reconcileJxn(previous: string, next: string, read: JxnReader): string {
  let older: JxnReading;
  try {
    older = read(previous);
  } catch {
    return next;
  }
  const newer = read(next);
  const wanted = fingerprint(newer.document);
  if (fingerprint(older.document) === wanted) {
    return previous;
  }
  const merge: Merge = { next: sideOf(newer, next), previous: sideOf(older, previous) };
  const merged = mergeBlock(
    merge,
    parse(previous, { storeLocations: true }),
    parse(next, { storeLocations: true }).nodes,
    "",
    "",
    new Map(),
  );
  try {
    return fingerprint(read(merged).document) === wanted ? merged : next;
  } catch {
    return next;
  }
}
