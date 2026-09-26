---
status: stub
disposition: implement
claims:
  - site-architecture.md#4
size: S
workspaces:
  - packages/site
  - packages/compiler
---

# Every route pattern the build derives is checked as a URLPattern pathname

## Context

`specs/site-architecture.md` §4, line 255:

> **Status: Partial.** File-based routing ships (`discoverPages` in `packages/compiler/src/site/pages-discovery.ts`, `fileToRoute` and `matchRoute` in `packages/site/src/routes.ts`). The standards note's SHOULD is unmet: no build step constructs a `URLPattern` from a route pattern, and `routes.ts` matches by its own segment comparison.

The section was unmarked before the census. The standards note says every pattern in the spec conforms to the WHATWG URLPattern syntax and that compilers SHOULD validate with `new URLPattern({ pathname })` at build time. Route patterns are derived from filenames, so the realistic failure is a filename carrying URLPattern syntax (`(`, `{`, `?`, `+`) that becomes a pattern meaning something the author never wrote.

**What exists**

- `fileToRoute` and `PARAM_SEGMENT` in `packages/site/src/routes.ts` (`[param]` to `:param`, `[...rest]` to `*`), and `matchRoute`'s own segment matcher, used by the dev server and Studio.
- `discoverPages` in `packages/compiler/src/site/pages-discovery.ts`, and the tests in `packages/site/tests/routes.test.ts` and `packages/compiler/tests/pages-discovery.test.ts`.
- The only `URLPattern` mentions in code are Studio's redirects grid and schema descriptions.

**What is missing**

- A build-time check that constructs a `URLPattern` from each derived pattern and reports one that throws, or that parses to groups the filename did not declare, naming the page file. Whether that is an error or a warning is a detail-phase decision; a filename whose literal characters are pattern syntax may need escaping in `fileToRoute` rather than rejection.
- Confirmation that `URLPattern` is available in every host that builds (Bun, Node, the desktop), or a guarded fallback.

**Related**

- site-architecture.md §11 (redirect patterns, which the compiler deliberately passes through unvalidated) and site-architecture.md §16 (the WHATWG URLPattern row, bound to §11.1 only).
- site-architecture.md §4.4 (route priority, the other routing item).
