/**
 * The `@docs <slug>` tag a source file carries to name the docs page that describes it.
 *
 * Two gates read it: `check-doc-refs.ts` fails a tag whose page does not exist, and
 * `check-doc-sync.ts` maps a changed source file to the pages its tags name. Both are scripts that
 * run on import, so neither can import the other, and the grammar lives here so the two cannot
 * disagree about what a slug is.
 */

/** A `@docs` tag; group 1 is the page slug. Global, so read it with `matchAll`. */
export const DOCS_TAG_RE = /@docs\s+([A-Za-z0-9/_-]+)/g;
