/**
 * JSON narrowing for the scripts that CI runs with no `node_modules`.
 *
 * `check-bun-nix.ts`, `check-electrobun-vendor.ts` and `ci/approve-held-runs.ts` run in jobs that
 * set up Bun with `install: "false"` (nix.yml, build-snap.yml, release-bun-nix.yml,
 * electrobun-vendor.yml). A runtime import of `@jxsuite/schema/guards` there is not resolved from
 * the workspace: Bun auto-installs the PUBLISHED `@jxsuite/schema`, which can lag the workspace and
 * lack a guard the workspace has, and the step then dies at import. So these two predicates live
 * here, with no package import but an erased `import type`. Keep it that way.
 */

import type { JsonObject } from "@jxsuite/schema/types";

/** A non-null, non-array object: the shape of a parsed JSON object. */
export function isJsonRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A string primitive. */
export function isText(value: unknown): value is string {
  return typeof value === "string";
}
