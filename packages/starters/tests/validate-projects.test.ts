/**
 * Composed-schema validation of every shipped starter: each project.json must validate against its
 * committed, generated project.schema.json (written by `jx schema`). In-repo starters may lack
 * their own node_modules — validateProjectFile's host-resolution fallback keeps the relative
 * `./node_modules/...` refs resolvable either way.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import { findDialogDefects } from "@jxsuite/schema/dialogs";
import { findPopoverDefects } from "@jxsuite/schema/overlays";

import { validateProjectFile } from "@jxsuite/schema/validate-project";
import { listStarters, SITES_DIR } from "../index";

const starters = listStarters();

describe("starter project.json files validate against their generated schemas", () => {
  for (const starter of starters) {
    test(starter.id, async () => {
      const result = await validateProjectFile(join(SITES_DIR, starter.id));
      expect(result.errors, `${starter.id} project.json is invalid`).toBeNull();
      expect(result.valid).toBe(true);
    });
  }
});

/**
 * Every `.json` document under a starter's `components`, `pages` and `layouts`, recursively.
 *
 * @yields {string} One document path
 */
function* documentsOf(root: string): Generator<string> {
  for (const dir of ["components", "pages", "layouts"]) {
    const base = join(root, dir);
    const stack = [base];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        continue;
      }
      for (const name of entries) {
        const path = join(current, name);
        if (statSync(path).isDirectory()) {
          stack.push(path);
        } else if (name.endsWith(".json") && !name.endsWith("schema.json")) {
          yield path;
        }
      }
    }
  }
}

describe("starter documents pass the overlay, dialog and accessibility lints", () => {
  // A starter is what a person scaffolds from, so a defect here is one every new site inherits.
  for (const starter of starters) {
    test(starter.id, () => {
      const findings: string[] = [];
      for (const file of documentsOf(join(SITES_DIR, starter.id))) {
        const doc = JSON.parse(readFileSync(file, "utf8")) as Parameters<typeof findA11yDefects>[0];
        for (const defect of [
          ...findPopoverDefects(doc),
          ...findDialogDefects(doc),
          ...findA11yDefects(doc),
        ]) {
          findings.push(`${file}: ${defect.message}`);
        }
      }
      expect(findings).toEqual([]);
    });
  }
});
