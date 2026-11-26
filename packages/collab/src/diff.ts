/**
 * `replaceYStructure` — the diff-overflow escape hatch, and the one export here that needs yjs.
 *
 * The alignment and equality logic this file used to hold lives in {@link file://./diff-core.ts} and
 * is re-exported below, so every importer of `@jxsuite/collab/diff` is unchanged. It moved because
 * THIS file's `./schema.ts` import is a value import and `schema.ts` imports yjs, while `diff.ts`'s
 * own `import type * as Y` made it look otherwise: `diffDocs` and `deepEqual` are pure, and a
 * caller that wanted them — the studio's diff highlighting — had no way to take them without taking
 * a yjs-sized chunk with them.
 */

import type { JxMutableNode } from "@jxsuite/schema/types";
import { metaMap, mergeYNode, structureMap } from "./schema.ts";
import type * as Y from "yjs";

export * from "./diff-core.ts";

/**
 * Write the whole document onto the structure tree (the diff-overflow escape hatch) and bump the
 * in-doc canonicalRev so stale mirror writes computed against the old tree are discarded. Every
 * container whose stored type is unchanged is kept and diffed in place ({@link mergeYNode}), so a
 * peer's concurrent edit to an untouched part survives.
 */
export function replaceYStructure(doc: Y.Doc, document: JxMutableNode, origin: string): void {
  doc.transact(() => {
    mergeYNode(structureMap(doc), document);
    const meta = metaMap(doc);
    meta.set("canonicalRev", Number(meta.get("canonicalRev") ?? 0) + 1);
  }, origin);
}
