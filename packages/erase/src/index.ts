/**
 * Erasing TypeScript from Jx function bodies (`spec.md` §23.1), for a server, a build or a CLI.
 *
 * The stripper is `ts-blank-space`, kept behind this package so it can be replaced, and it is
 * required the first time a body could be TypeScript rather than imported here: a project whose
 * bodies are all JavaScript never loads TypeScript's parser, and one that does pays for it once.
 *
 * @docs framework/concepts/functions
 */
import { createRequire } from "node:module";
import { setStripperLoader } from "./core.ts";
import type { Stripper } from "./core.ts";

setStripperLoader(() => {
  /* SAFETY: `ts-blank-space` is a dependency of this package, and its default export is the
     function the `Stripper` type describes. */
  const loaded = createRequire(import.meta.url)("ts-blank-space") as { default: Stripper };
  return loaded.default;
});

export * from "./core.ts";
