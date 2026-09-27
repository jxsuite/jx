---
status: drafted
disposition: implement
claims:
  - site-architecture.md#4
requires: []
workspaces:
  - packages/site
  - packages/compiler
size: S
---

# Every page file's name derives a route pattern URLPattern reads exactly as the name says, and the build reports one that does not

## Context

`specs/site-architecture.md` §4, line 257:

> **Status: Partial.** File-based routing ships (`discoverPages` in `packages/compiler/src/site/pages-discovery.ts`, `fileToRoute` and `matchRoute` in `packages/site/src/routes.ts`). The standards note's SHOULD is unmet: no build step constructs a `URLPattern` from a route pattern, and `routes.ts` matches by its own segment comparison.

The standards note under it says every pattern in the spec conforms to WHATWG URLPattern and that "Compilers SHOULD validate patterns using `new URLPattern({ pathname: pattern })` at build time." The section was unmarked before the census. Re-verified against `84735a9f` on 2026-09-27 with `bun -e` probes.

**What exists**

- `fileToRoute` (`packages/site/src/routes.ts`) turns every `[name]` / `[...name]` it finds, anywhere in the path, into `:name` / `*` (`PARAM_SEGMENT = /\[\.\.\.(\w+)\]|\[(\w+)\]/g`) and copies every other character through. `matchPattern` reads a segment as a catch-all when it is exactly `*`, a parameter when it starts with `:`, and a literal otherwise; `routeHref` fills `:name` and a trailing `*` only.
- `buildSite` (`packages/compiler/src/site/site-build.ts`, step 3) calls `discoverPages` and checks nothing about the patterns. `jx dev`, Studio's build (`packages/server/src/studio-api.ts`) and the desktop all build through `buildSite`; the live preview (`routeTable` / `composeRoute` in `packages/site/src/compose.ts`) matches with `matchRoute`.
- The only `URLPattern` mentions in code are a comment in `packages/studio/src/grid/redirects.ts` and a description in `packages/schema/defs/project-config.schema.ts`. site-architecture.md §16's URLPattern row binds §11.1 only.

**What the probes show**

- URLPattern **throws** on patterns `fileToRoute` derives today: `[1st].json` → `/:1st`, `[id]/[id].json` → `/:id/:id` (duplicate name), `c++.json` → `/c++`, `what?.json` → `/what?`.
- It **parses to something the name never said** for others: `(marketing)/about.json` has a regexp group and matches `/marketing/about`, not `/(marketing)/about`; `foo:bar.json` declares a `bar` group (matches `/fooX`); `a*b.json` declares group `0`; `faq{old}.json` matches `/faqold`. `buildSite` also treats any pattern containing `:` or `*` as unexpanded (`concreteRoutes` and `isConcrete`), so `foo:bar.json` builds but drops out of the sitemap and translation sets.
- Two shapes URLPattern reads fine are ones `matchRoute` cannot: `post-[id].json` → `/post-:id` matches nothing in the live preview while the build expands it; `[...path]/edit.json` → `/*/edit`, which `matchRoute` answers for `/a/b` (URLPattern does not) and `routeHref` cannot fill.
- For whole-segment `[name]` and a final `[...name]`, `matchRoute` agrees with `new URLPattern` on a 9-page × 19-path table (hits, misses, `%20`, catch-alls) once the request path is tried with and without its trailing slash, with named values decoded and the catch-all's value as URLPattern's group `0`.
- No page under `sites/`, `examples/` or `packages/starters/` uses any refused shape (`git ls-files` scan); the dynamic pages are `[slug]`, `[sku]` and `docs/[...slug]`.

**Host availability** (the stub's second question). Bun has `URLPattern` (1.3.11 here; CI pins 1.4). The `jx` bin is `#!/usr/bin/env node`, `packages/compiler/package.json` declares no `engines`, and Node 22 has none (`node -e 'console.log(typeof URLPattern)'` prints `undefined` on 22.22). `bun-types` declares no `URLPattern` type either, and the root tsconfig's `lib` is `["ESNext"]`.

## Outcome

- site-architecture.md §4 → Implemented: every page file whose name would derive a pattern outside the subset routes use is a build error naming the file; the standards note says how the check is made and proven; §16's URLPattern row binds §4 too.
- site-architecture.md does not graduate: most of its other open items remain.

## Decisions

- **Open:** is a page file with a refused name a build error or a warning? Recommendation: an error, pushed to `errors` so `jx build` exits 1 while the rest of the site (and that page) still builds, because every refused shape is either a pattern the standard cannot parse or a URL the page does not answer on some surface, a rename is always the fix, and the build already treats the parallel case, a malformed BCP 47 locale, as an error for the same reason ("a typo does not degrade"). No page in the repository trips it.
- **Open:** a parameter inside a segment (`post-[id].json`, `[a]-[b].json`) and a catch-all before the last segment (`[...path]/edit.json`) build today; are they refused or supported? Recommendation: refused, because the live preview cannot match them and `routeHref` cannot fill the second, site-architecture.md §4.2 only ever shows whole segments, and nothing in the repository uses either. Supporting them is a `matchRoute` rewrite that can come later as an additive change; the sibling ordering plan (`plan:site-architecture/route-specificity-order`) already reads a mid-segment parameter as a literal and leaves it here.
- **Decided:** the check is string rules on the page path, `routePatternProblem` in `packages/site/src/routes.ts`, not a `new URLPattern` call at build time, and a test runs every accepted and refused shape through `new URLPattern` under Bun. A build that called `URLPattern` would pass or fail the same project depending on the Node release running `jx`, and `routes.ts` is import-free so every host (browser, Worker, Node) shares it. site-architecture.md §4's standards note is reworded to say this rather than keep a SHOULD the build does not follow literally.
- **Decided:** refuse rather than escape. Escaping `c++` as `/c\+\+` would give `urlPattern` a second spelling that `routeHref`, `routeToOutputPath`, `matchRoute`, the i18n segment reads and `buildSite`'s `includes(":")` concreteness test would each have to undo. The check reads the path, not the derived pattern, because after derivation a literal `:` is indistinguishable from a parameter.
- **Decided:** `matchRoute` stays a segment matcher, pinned to URLPattern by the parity test, and its trailing-slash rule is written down: `/docs/*` answers `/docs` because the matcher tries a path with and without its trailing slash, which is also what lets a paged catch-all put page 1 at `/blog`.
- **Decided:** only filename-derived patterns are checked. `$paths` values are URL segments, not patterns; redirect patterns keep §11's pass-through; the live preview and Studio do not check, and `routePatternProblem` is exported so a Studio Problem can call it later.

## Implementation

1. **`packages/site/src/routes.ts`**
   - Extract a private `routePath(relativePath: string): string` from the first half of `fileToRoute` (`pageRelativePath`, the real-extension drop, index folding, the leading `/`). `fileToRoute` calls it; its output is unchanged.
   - Add `const WHOLE_BRACKET = /^\[(\.\.\.)?([^\]]*)\]$/`, `const PARAM_NAME = /^[A-Za-z_]\w*$/` and `const PATTERN_SYNTAX = /[:*?+(){}]/`, commented as URLPattern's tokenizer characters; the ninth, `\`, never reaches a segment because `pageRelativePath` turns it into `/`.
   - `export function routePatternProblem(relativePath: string): string | null`. Walk `routePath(relativePath).split("/").filter(Boolean)` with its index and a `Set` of names, returning the first problem found, or `null`. Per segment, in order:
     1. `WHOLE_BRACKET` matches: a name failing `PARAM_NAME` → `` `${segment}` is not a parameter: a parameter name is letters, digits and _, and does not start with a digit ``; a name already seen → `` `[${name}]` is declared twice in one path ``; a spread that is not the last segment → `` `${segment}` is a catch-all, so it must be the last segment ``; otherwise record the name and continue.
     2. The segment contains `[` or `]` → `` `${segment}` has a bracket inside a segment: a parameter is a whole segment, like [id] ``.
     3. `PATTERN_SYNTAX` matches → `` `${segment}` contains "${char}", which URL pattern syntax reads as an operator ``.
   - Its docblock states the integration contract's guarantee and cites site-architecture.md §4 and §4.2.
   - Module docblock gains `@docs framework/site/routing` (already there if `plan:site-architecture/route-specificity-order` landed first).
2. **`packages/compiler/src/site/site-build.ts`**, step 3: import `pageRelativePath` and `routePatternProblem` from `@jxsuite/site/routes`. Right after `discoverPages`, for each route with a problem, `` const message = `pages/${pageRelativePath(route.relativePath)}: ${problem}. Rename the file.` ``, then `errors.push(message)` and `console.error(message)`, as the i18n errors are. The route stays in the table, as a declared translation conflict does, so the rest of the build is unchanged. A comment cites site-architecture.md §4.2.

**Integration contract.** `@jxsuite/site/routes` exports `routePatternProblem(relativePath)`, accepting the same path forms as `fileToRoute`. When it returns `null`, `fileToRoute(relativePath).urlPattern` is a URLPattern pathname with no regexp group whose groups are exactly the declared parameters (a catch-all as group `0`), built only from literal segments free of URLPattern syntax, whole-segment `:name`s and at most one `*`, which is last; and `matchRoute` answers a request path with no empty segment exactly when `new URLPattern({ pathname })` matches that path with or without its trailing slash. `buildSite` reports every other page file as an error beginning `pages/<path>:`. site-architecture.md §4.2 states the rules. A plan that adds a route shape (`plan:site-architecture/collection-pagination`'s `[...page]`) stays inside them.

## Tests

`bun test --isolate --coverage` from `packages/site` and from `packages/compiler`.

- **`packages/site/tests/routes.test.ts`**, new `describe("routePatternProblem")`:
  - `a whole-segment parameter and a final catch-all are sound`: `null` for `index.json`, `about/index.json`, `v1.2/index.json`, `blog/[slug].json`, `[category]/[id].json`, `docs/[...path].json`, `[...all].json`, `pages/blog/[slug]/comments.json` and `blog\[slug].json`.
  - `URL pattern syntax in a name is named`: `c++.json`, `(marketing)/about.json`, `faq{old}.json`, `foo:bar.json`, `what?.json`, `a*b.json`; each message contains the segment and the character.
  - `a bracket that is not a parameter is refused`: `[foo-bar].json`, `[1st].json`, `[].json`, `[...].json`.
  - `a parameter is a whole segment`: `post-[id].json`, `[a]-[b].json`, `a]b.json`.
  - `a catch-all is the last segment`: `[...path]/edit.json`.
  - `a parameter name is used once`: `[id]/[id].json`, `[id]/[...id].json`.
  - The existing `fileToRoute` cases pass unchanged (they cover `routePath`).
- **`packages/site/tests/route-urlpattern.test.ts`** (new test file). It reads the constructor as `(globalThis as { URLPattern?: new (init: { pathname: string }) => URLPatternLike }).URLPattern`, with `URLPatternLike` (`hasRegExpGroups`, `exec`, `test`) declared locally because `bun-types` has none.
  - `URLPattern is available to this suite`: the constructor is a function, so a Bun without it fails here instead of skipping.
  - `a sound page path parses to exactly the groups its name declares`: for the sound list above, construction succeeds, `hasRegExpGroups` is false, and `exec` on `routeHref(urlPattern, sample, "never")` returns group keys equal to `params` (a catch-all as `"0"`).
  - `a refused name is one URLPattern rejects or reads differently`: `[1st]`, `[id]/[id]`, `c++` and `what?` throw; `(marketing)/about` has `hasRegExpGroups` and matches `/marketing/about`; `foo:bar` returns a `bar` group for `/fooX`; `a*b` returns group `0` for `/axyzb`; `faq{old}` matches `/faqold`.
  - `a refused shape URLPattern accepts is one matchRoute cannot read`: `post-[id]` matches `/post-42` in URLPattern and not in `matchRoute`; `[...path]/edit` is answered by `matchRoute` for `/a/b` and not by URLPattern.
  - `matchRoute agrees with URLPattern on every sound pattern`: the 9 × 19 table from the probe (`/`, `/about`, `/about/`, `/blog`, `/blog/`, `/blog/hello`, `/blog/hello/`, `/blog/a%20b`, `/blog/a/b`, `/products/42`, `/docs`, `/docs/`, `/docs/a`, `/docs/a/b/`, `/v1.2`, `/v1.2/`, `/blog/x/comments`, `/blog/x/comments/`, `/x`): `matchRoute([shape], path)` is non-null exactly when `exec` matches the path with its trailing slash stripped or one added, named values equal `decodeURIComponent` of URLPattern's, and `params["*"]` equals group `0`.
- **`packages/compiler/tests/site-build-reporting.test.ts`**, new `describe("buildSite — a page named in URL pattern syntax")` with `scaffold` and `captured`: add `pages/(marketing)/about.json`; `result.errors` holds one entry beginning `pages/(marketing)/about.json:` and naming `(marketing)`, `console.error` received it, and `dist/index.html` exists.

Coverage: `packages/site/bunfig.toml` gates every file at lines 0.99, functions 1.0, so each branch of `routePatternProblem` has a case above. `packages/compiler/bunfig.toml` (lines 0.982, functions 0.98) gains one branch in `site-build.ts`, covered by the new build case and every clean build. No source file is added, so `bun scripts/check-coverage-manifest.ts` is unaffected in both workspaces. Ratchet only if a run shows a workspace's worst file rose.

## Specs & docs

**site-architecture.md**, in place (assuming both Open items take their recommendation):

- §4 marker becomes:

  ```markdown
  > **Status: Implemented.** File-based routing ships (`discoverPages` in `packages/compiler/src/site/pages-discovery.ts`; `fileToRoute`, `matchRoute` and `routePatternProblem` in `packages/site/src/routes.ts`), and `jx build` reports every page file whose name breaks the rules in §4.2.
  ```

- §4's standards note keeps its first sentence and replaces the SHOULD with: "A page route uses two of those forms, a `:param` that is a whole segment and a final `*`, and the build checks every page file's name against the rules in §4.2 that keep it inside them. The check is string rules rather than a `new URLPattern({ pathname: pattern })` call, because the `jx` CLI runs on Node releases that do not ship `URLPattern`; its tests run every accepted and refused shape through `new URLPattern` instead."
- §4.2, before "Dynamic route parameters are resolved at build time…", two paragraphs: "A parameter is a whole path segment, and a catch-all is the last segment. A parameter name is ASCII letters, digits and `_`, does not start with a digit, and appears once in a path. No file or directory name under `pages/` may contain `:`, `*`, `?`, `+`, `(`, `)`, `{` or `}`, which URLPattern reads as syntax. A page file that breaks one of these rules is a build error naming the file, because its pattern would fail to parse (`[1st]`, `[id]/[id]`, `c++`), would match URLs its name does not spell (`(marketing)/about` matches `/marketing/about`), or would be one the live preview cannot match (`post-[id]`, `[...path]/edit`). The rest of the site still builds." and "A trailing slash is not significant when a URL is matched against a route, so `/docs/*` answers `/docs` as well as `/docs/` and everything under it."
- §16, the WHATWG URLPattern row: Binds `§4, §11.1`; Evidence `packages/site/src/routes.ts, packages/site/tests/route-urlpattern.test.ts, packages/compiler/src/site/site-build.ts`; Note: "Page routes (§4) use two pathname forms, a `:name` group that is a whole segment and a final `*`, and the build reports a page file whose name would derive anything else; a test runs every accepted and refused shape through `new URLPattern`. The route matcher tries a request path with and without its trailing slash, so `/docs/*` also answers `/docs`. Redirect pattern strings (§11) are passed through to `_redirects` verbatim; the compiler neither parses nor validates them, so a malformed redirect pattern is a deploy-time failure rather than a build-time one." Class stays **Subset**; no gap id.
- Fragment: `bun run spec:change site-architecture.md minor -m "§4 page routes are checked at build time: a page file whose name would derive a pattern outside the URLPattern forms routes use (a parameter that is not a whole segment, a catch-all before the end, a malformed or repeated parameter name, or a character URLPattern reads as syntax) is a build error naming the file."`

No other spec cites §4's standards note.

**Docs** (no em dashes):

- `docs/framework/site/routing.md` (`spec: site-architecture.md#4`): `code:` gains `packages/site/src/routes.ts` unless already there. Under "Dynamic routes", after the `[param]` / `[...param]` paragraph: "A parameter is always a whole path segment and a catch-all is always the last one, so `post-[id].json` and `[...path]/edit.json` are refused. Parameter names use letters, digits and `_`, don't start with a digit, and appear once per path. Route patterns follow the [URLPattern](https://urlpattern.spec.whatwg.org/) standard, so the characters it reads as syntax (`:` `*` `?` `+` `(` `)` `{` `}`) can't appear in a file or directory name under `pages/`. `jx build` reports a file that breaks one of these rules as an error naming it."
- `docs/framework/build.md` (`code:` lists `site-build.ts`): step 2 gains "A file whose name breaks the [routing rules](/docs/framework/site/routing#dynamic-routes) is reported as a build error."
- `docs/extending/reference/standards.md` is generated from §16 and needs no edit. Other pages listing `site-build.ts` (seo, redirects, deployment, color-schemes) do not change.

On landing: delete this file. No plan requires it.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/site` and `packages/compiler`; `bun scripts/check-coverage-manifest.ts packages/site` and `bun scripts/check-coverage-manifest.ts packages/compiler` are green.
- `bun -e 'import { routePatternProblem } from "./packages/site/src/routes.ts"; for (const p of ["blog/[slug].json", "docs/[...path].json", "c++.json", "post-[id].json", "[id]/[id].json"]) console.log(p, routePatternProblem(p))'` prints `null` for the first two and a message naming the segment for the rest.
- In a scratch site, adding `pages/(marketing)/about.json` makes `jx build` exit 1 with a line beginning `pages/(marketing)/about.json:`; renaming it to `pages/marketing/about.json` makes it exit 0.
- `jx build` in `sites/jxsuite.com` prints no `Rename the file.` line.
- `bun run docs:status`, `bun run docs:check`, `bun run docs:standards`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run plans:check` are green; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#4`.
