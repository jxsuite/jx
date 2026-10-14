/**
 * `KIT_LOADERS` is `KIT_MODULES` as thunks, and this is what keeps the two tables one table: the
 * same specifiers, and each loader importing the namespace the eager entry already holds.
 */
import { describe, expect, test } from "bun:test";

import type { JxScope } from "@jxsuite/runtime/types";

import { KIT_MODULES } from "../src/index.ts";
import { KIT_LOADERS } from "../src/loaders.ts";

describe("KIT_LOADERS", () => {
  test("names exactly the specifiers KIT_MODULES does", () => {
    expect(Object.keys(KIT_LOADERS).toSorted()).toEqual(Object.keys(KIT_MODULES).toSorted());
  });

  test("each loader imports the namespace the eager table holds", async () => {
    /* Sequential on purpose: Bun 1.4.0 drops a file's coverage record when two dynamic imports of
       it overlap (AGENTS.md, coverage policy), and the eager table has already loaded each one. */
    const eagerTable = new Map<string, JxScope>(Object.entries(KIT_MODULES));
    for (const [specifier, load] of Object.entries(KIT_LOADERS)) {
      const mod: JxScope = await load();
      const eager = eagerTable.get(specifier);
      if (eager === undefined) {
        throw new Error(`KIT_MODULES has no entry for ${specifier}`);
      }
      expect(Object.keys(mod).toSorted(), specifier).toEqual(Object.keys(eager).toSorted());
      for (const key of Object.keys(eager)) {
        expect(mod[key], `${specifier}#${key}`).toBe(eager[key]);
      }
    }
  });
});
