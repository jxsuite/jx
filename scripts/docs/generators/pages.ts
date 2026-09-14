/**
 * The derived reference pages: path under the repository → the generator that renders it.
 *
 * Its own module, with no side effect, so the set can be rendered without a working tree:
 * `generate-reference.ts` writes it to disk, and `shared.test.ts` renders it in memory to hold
 * every page to the frontmatter contract without depending on which pages a checkout happens to
 * carry. The pages are gitignored build outputs; this map is the one list of them.
 */

import { generateFormulas } from "./formulas.ts";
import { generateImplementationStatus } from "./implementation-status.ts";
import { generateOperators } from "./operators.ts";
import { generateSpecChangelog } from "./spec-changelog.ts";
import { generateStandards } from "./standards.ts";
import { generateStarters } from "./starters.ts";
import { generateCommands, generateShortcuts } from "./studio-commands.ts";
import { generateStudioRoutes } from "./studio-routes.ts";

export const PAGES: Readonly<Record<string, () => string>> = {
  "docs/extending/reference/studio-routes.md": generateStudioRoutes,
  "docs/extending/reference/implementation-status.md": generateImplementationStatus,
  "docs/extending/reference/spec-changelog.md": generateSpecChangelog,
  "docs/extending/reference/standards.md": generateStandards,
  "docs/framework/reference/formulas.md": generateFormulas,
  "docs/framework/reference/operators.md": generateOperators,
  "docs/studio/projects/starters.md": generateStarters,
  "docs/studio/interface/commands.md": generateCommands,
  "docs/studio/interface/shortcuts.md": generateShortcuts,
};
