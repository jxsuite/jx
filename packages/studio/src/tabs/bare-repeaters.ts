/**
 * The repeaters a file wrote as a node's whole `children`, so a save can write them back that way.
 *
 * A node may hold a repeater two ways: as a member of its children array (`children: [{ $prototype:
 * "Array", … }]`) or as the whole children slot (`children: { $prototype: "Array", … }`). The two
 * render the same, and the editor works in the first form only: `normalizeArrayChildren` rewrites
 * every document a tab loads, because every mutation, path and history checkpoint assumes a
 * children array. Without a record of what the file said, a save then rewrote every bare repeater
 * in it into the member form, so one inserted paragraph produced a diff in a list nobody touched,
 * and undoing every edit still left the file different from the one on disk.
 *
 * **Two keys, either of which is enough.** The pointer of the node that held the repeater survives
 * an edit inside the repeater (a restyled template); the repeater's own JSON survives an edit that
 * moves it (a sibling inserted above an ancestor shifts every pointer below it). A repeater both
 * moved and changed loses both and is written in the member form, which renders the same. Only a
 * children array whose ONLY member is a repeater is unwrapped: a node that has gained a sibling of
 * its repeater can no longer be written the bare way at all.
 *
 * @docs studio/interface/tabs
 */

import { isJsonObject, isMappedArray } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxMutableNode } from "@jxsuite/schema/types";
import { normalizeArrayChildren, pointerToken } from "../state";

/** What a file said about its bare repeaters, in the normalized document's coordinates. */
export interface BareRepeaters {
  /** The JSON Pointer of each node whose `children` WAS the repeater. */
  readonly pointers: ReadonlySet<string>;
  /** `JSON.stringify` of each such repeater as it was read. */
  readonly fingerprints: ReadonlySet<string>;
}

/**
 * Normalize a freshly read document in place (`normalizeArrayChildren`) and return what it rewrote,
 * or null when the file held no bare repeater — the common case, which needs no record.
 */
export function normalizeDocument(document: JxMutableNode): BareRepeaters | null {
  const pointers = new Set<string>();
  const fingerprints = new Set<string>();
  normalizeArrayChildren(document, (pointer, repeater) => {
    pointers.add(pointer);
    fingerprints.add(JSON.stringify(repeater));
  });
  return pointers.size === 0 ? null : { fingerprints, pointers };
}

/**
 * The document as the file should hold it: every single-member children array whose repeater the
 * record names, written back as the node's whole `children`. Copy-on-write, so the tab's document
 * (a reactive tree the editor owns) is never touched, and a document with nothing to restore is
 * returned as it is.
 */
export function restoreBareRepeaters(
  document: JxMutableNode,
  record: BareRepeaters | null,
): JxMutableNode {
  if (!record) {
    return document;
  }
  /* SAFETY: a Jx document is JSON (it is read from, and written to, a JSON file); the restored copy
     is the same node with some `children` slots holding their sole repeater directly — the bare
     form the node's schema allows. */
  return restoreValue(document as JsonValue, "", record) as JxMutableNode;
}

/** Restore inside one value of the tree, returning it unchanged when nothing below it moved. */
function restoreValue(value: JsonValue, pointer: string, record: BareRepeaters): JsonValue {
  if (Array.isArray(value)) {
    let copy: JsonValue[] | null = null;
    for (const [i, item] of value.entries()) {
      const next = restoreValue(item, `${pointer}/${i}`, record);
      if (next !== item) {
        copy ??= [...value];
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  if (!isJsonObject(value)) {
    return value;
  }
  let copy: JsonObject | null = null;
  for (const [key, child] of Object.entries(value)) {
    let next = restoreValue(child, `${pointer}/${pointerToken(key)}`, record);
    if (key === "children" && Array.isArray(next) && next.length === 1) {
      const [only] = next;
      if (
        isMappedArray(only) &&
        (record.pointers.has(pointer) || record.fingerprints.has(JSON.stringify(only)))
      ) {
        next = only;
      }
    }
    if (next !== child) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  return copy ?? value;
}
