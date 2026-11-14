/**
 * `KIT_DOCUMENT_LOADERS` is `documents` as thunks, and this is what keeps the two tables one table:
 * the same tags in the same order, and each loader resolving the very document the eager entry
 * holds.
 */
import { describe, expect, test } from "bun:test";

import { KIT_DOCUMENT_LOADERS, kitDocumentOf } from "../src/document-loaders.ts";
import { documents } from "../src/documents.ts";

describe("KIT_DOCUMENT_LOADERS", () => {
  test("names exactly the tags documents does, in registration order", () => {
    expect(Object.keys(KIT_DOCUMENT_LOADERS)).toEqual(Object.keys(documents));
  });

  test("each loader resolves the document the eager table holds", async () => {
    /* Sequential on purpose: Bun 1.4.0 drops a file's coverage record when two dynamic imports of
       it overlap (AGENTS.md, coverage policy). */
    const eagerTable = new Map(Object.entries(documents));
    for (const [tag, load] of Object.entries(KIT_DOCUMENT_LOADERS)) {
      const doc = kitDocumentOf(await load());
      expect(doc === eagerTable.get(tag), tag).toBe(true);
      expect(doc.tagName, tag).toBe(tag);
    }
  });
});
