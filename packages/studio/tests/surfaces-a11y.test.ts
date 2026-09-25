/**
 * Every Studio surface document passes the overlay, dialog and accessibility lints (spec §8.7,
 * §8.8). The same lints Studio files as Problems for an author's document, run over its own chrome
 * — studio.md §2 principle 4 made literal.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import { findDialogDefects } from "@jxsuite/schema/dialogs";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JxElement } from "@jxsuite/schema/types";

const dir = resolve(import.meta.dir, "../src/surfaces");
const documents = readdirSync(dir).filter((name) => name.endsWith(".json"));

describe("surface documents", () => {
  test("there are surfaces to judge", () => {
    expect(documents.length).toBeGreaterThan(0);
  });

  for (const name of documents) {
    test(`${name} passes the overlay, dialog and accessibility lints`, () => {
      const doc = JSON.parse(readFileSync(join(dir, name), "utf8")) as JxElement;
      expect(findPopoverDefects(doc)).toEqual([]);
      expect(findDialogDefects(doc)).toEqual([]);
      expect(findA11yDefects(doc)).toEqual([]);
    });
  }
});
